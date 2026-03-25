import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import { resolveEffectiveMemoryControlFromGovernance } from "../domain/memory-control-resolve";
import { resolveEffectiveTasksControlFromGovernance } from "../domain/tasks-control-resolve";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import type { AssistantMaterializationSourceAction } from "../domain/assistant-materialized-spec.entity";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type { Assistant } from "../domain/assistant.entity";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveToolAvailabilityService } from "./resolve-effective-tool-availability.service";
import { ResolveOpenClawChannelSurfaceBindingsService } from "./resolve-openclaw-channel-surface-bindings.service";
import { ResolveOpenClawCapabilityEnvelopeService } from "./resolve-openclaw-capability-envelope.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { ResolveRuntimeProviderRoutingService } from "./resolve-runtime-provider-routing.service";
import { buildPlatformRuntimeProviderProfileState } from "./platform-runtime-provider-settings";
import { resolveRuntimeProviderProfileState } from "./runtime-provider-profile";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  TOOL_CODE_BY_CREDENTIAL_KEY,
  buildToolCredentialSecretRef
} from "./tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const MATERIALIZATION_ALGORITHM_VERSION = 1;
const MATERIALIZATION_SCHEMA = "persai.materialization.v1";
const OPENCLAW_BOOTSTRAP_SCHEMA = "openclaw.bootstrap.v1";
const OPENCLAW_WORKSPACE_SCHEMA = "openclaw.workspace.v1";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, nestedValue] of entries) {
      sorted[key] = sortKeysDeep(nestedValue);
    }
    return sorted;
  }

  return value;
}

function toDeterministicDocument(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

@Injectable()
export class MaterializeAssistantPublishedVersionService {
  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly resolveEffectiveToolAvailabilityService: ResolveEffectiveToolAvailabilityService,
    private readonly resolveOpenClawChannelSurfaceBindingsService: ResolveOpenClawChannelSurfaceBindingsService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly resolveRuntimeProviderRoutingService: ResolveRuntimeProviderRoutingService,
    private readonly resolveOpenClawCapabilityEnvelopeService: ResolveOpenClawCapabilityEnvelopeService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(
    assistant: Assistant,
    publishedVersion: AssistantPublishedVersion,
    sourceAction: AssistantMaterializationSourceAction
  ): Promise<void> {
    const existingSpec = await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
      publishedVersion.id
    );

    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));

    const memoryControl = resolveEffectiveMemoryControlFromGovernance(governance);
    const tasksControl = resolveEffectiveTasksControlFromGovernance(governance);
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant,
      governance
    });
    const toolAvailability = await this.resolveEffectiveToolAvailabilityService.execute({
      effectiveCapabilities
    });
    const channelSurfaceBindings = await this.resolveOpenClawChannelSurfaceBindingsService.execute({
      assistantId: assistant.id,
      effectiveCapabilities
    });
    const platformRuntimeProviderSettings =
      await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const runtimeProviderProfile =
      platformRuntimeProviderSettings.mode === "global_settings"
        ? buildPlatformRuntimeProviderProfileState(platformRuntimeProviderSettings)
        : resolveRuntimeProviderProfileState({
            policyEnvelope: governance.policyEnvelope,
            secretRefs: governance.secretRefs
          });
    const runtimeProviderRouting = this.resolveRuntimeProviderRoutingService.execute({
      effectiveCapabilities,
      policyEnvelope: governance.policyEnvelope,
      runtimeProviderProfile
    });
    const openclawCapabilityEnvelope = this.resolveOpenClawCapabilityEnvelopeService.execute({
      effectiveCapabilities,
      effectiveToolAvailability: toolAvailability,
      channelSurfaceBindings,
      runtimeProviderRouting
    });

    const layers = {
      schema: MATERIALIZATION_SCHEMA,
      algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
      layers: {
        ownership: {
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId
        },
        userOwnedVersion: {
          publishedVersionId: publishedVersion.id,
          publishedVersion: publishedVersion.version,
          snapshot: {
            displayName: publishedVersion.snapshotDisplayName,
            instructions: publishedVersion.snapshotInstructions
          }
        },
        governance: this.toGovernanceLayer(
          governance,
          effectiveCapabilities,
          toolAvailability,
          openclawCapabilityEnvelope,
          runtimeProviderProfile
        ),
        applyState: {
          status: assistant.applyStatus,
          targetPublishedVersionId: assistant.applyTargetVersionId,
          appliedPublishedVersionId: assistant.applyAppliedVersionId
        }
      }
    };

    const toolCredentialRefs = await this.resolveToolCredentialRefs();
    const toolQuotaPolicy = await this.resolveToolQuotaPolicy(governance.quotaPlanCode);

    const openclawBootstrap = {
      schema: OPENCLAW_BOOTSTRAP_SCHEMA,
      assistant: {
        id: assistant.id,
        workspaceId: assistant.workspaceId
      },
      governance: {
        capabilityEnvelope: governance.capabilityEnvelope,
        policyEnvelope: governance.policyEnvelope,
        quota: {
          planCode: governance.quotaPlanCode,
          hook: governance.quotaHook
        },
        effectiveCapabilities,
        toolAvailability,
        openclawCapabilityEnvelope,
        runtimeProviderProfile,
        toolCredentialRefs,
        toolQuotaPolicy,
        secretRefs: governance.secretRefs,
        auditHook: governance.auditHook
      }
    };

    const openclawWorkspace = {
      schema: OPENCLAW_WORKSPACE_SCHEMA,
      workspace: {
        assistantId: assistant.id,
        publishedVersionId: publishedVersion.id,
        publishedVersion: publishedVersion.version
      },
      persona: {
        displayName: publishedVersion.snapshotDisplayName,
        instructions: publishedVersion.snapshotInstructions
      },
      effectiveCapabilities,
      toolAvailability,
      openclawCapabilityEnvelope,
      memoryControl,
      tasksControl
    };

    const layersDocument = toDeterministicDocument(layers);
    const openclawBootstrapDocument = toDeterministicDocument(openclawBootstrap);
    const openclawWorkspaceDocument = toDeterministicDocument(openclawWorkspace);
    const contentHash = createHash("sha256")
      .update(`${layersDocument}\n${openclawBootstrapDocument}\n${openclawWorkspaceDocument}`)
      .digest("hex");

    await this.assistantMaterializedSpecRepository.create({
      assistantId: assistant.id,
      publishedVersionId: publishedVersion.id,
      sourceAction: existingSpec?.sourceAction ?? sourceAction,
      algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
      layers,
      openclawBootstrap,
      openclawWorkspace,
      layersDocument,
      openclawBootstrapDocument,
      openclawWorkspaceDocument,
      contentHash
    });
  }

  private async resolveToolCredentialRefs(): Promise<
    Record<string, { refKey: string; secretRef: { source: string; provider: string; id: string }; configured: boolean }>
  > {
    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys(
      ALL_TOOL_CREDENTIAL_KEYS as unknown as string[]
    );
    const refs: Record<
      string,
      { refKey: string; secretRef: { source: string; provider: string; id: string }; configured: boolean }
    > = {};
    for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
      const toolCode = TOOL_CODE_BY_CREDENTIAL_KEY[credentialKey];
      const secretRef = buildToolCredentialSecretRef(credentialKey);
      refs[toolCode] = {
        ...secretRef,
        configured: keyMetadata[credentialKey]?.configured ?? false
      };
    }
    return refs;
  }

  private async resolveToolQuotaPolicy(
    planCode: string | null
  ): Promise<
    Array<{ toolCode: string; dailyCallLimit: number | null; activationStatus: string }>
  > {
    if (planCode === null) {
      return [];
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { id: true }
    });
    if (plan === null) {
      return [];
    }
    const activations = await this.prisma.planCatalogToolActivation.findMany({
      where: { planId: plan.id },
      select: {
        activationStatus: true,
        dailyCallLimit: true,
        tool: {
          select: { code: true }
        }
      }
    });
    return activations.map((activation) => ({
      toolCode: activation.tool.code,
      dailyCallLimit: activation.dailyCallLimit,
      activationStatus: activation.activationStatus
    }));
  }

  private toGovernanceLayer(
    governance: AssistantGovernance,
    effectiveCapabilities: Record<string, unknown>,
    toolAvailability: Record<string, unknown>,
    openclawCapabilityEnvelope: Record<string, unknown>,
    runtimeProviderProfile: unknown
  ): Record<string, unknown> {
    return {
      capabilityEnvelope: governance.capabilityEnvelope,
      secretRefs: governance.secretRefs,
      policyEnvelope: governance.policyEnvelope,
      runtimeProviderProfile,
      effectiveCapabilities,
      toolAvailability,
      openclawCapabilityEnvelope,
      memoryControl: governance.memoryControl,
      tasksControl: governance.tasksControl,
      quota: {
        planCode: governance.quotaPlanCode,
        hook: governance.quotaHook
      },
      auditHook: governance.auditHook
    };
  }
}
