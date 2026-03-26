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

    const userContext = await this.resolveUserContext(assistant.userId, assistant.workspaceId);
    const bootstrapDocuments = this.generateBootstrapDocuments({
      publishedVersion,
      governance,
      toolAvailability,
      toolQuotaPolicy,
      memoryControl,
      tasksControl,
      effectiveCapabilities,
      userContext
    });

    const openclawWorkspace = {
      schema: OPENCLAW_WORKSPACE_SCHEMA,
      workspace: {
        assistantId: assistant.id,
        publishedVersionId: publishedVersion.id,
        publishedVersion: publishedVersion.version
      },
      persona: {
        displayName: publishedVersion.snapshotDisplayName,
        instructions: publishedVersion.snapshotInstructions,
        traits: publishedVersion.snapshotTraits,
        avatarEmoji: publishedVersion.snapshotAvatarEmoji,
        avatarUrl: publishedVersion.snapshotAvatarUrl
      },
      effectiveCapabilities,
      toolAvailability,
      openclawCapabilityEnvelope,
      memoryControl,
      tasksControl,
      userContext,
      bootstrapDocuments
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
    Record<
      string,
      {
        refKey: string;
        secretRef: { source: string; provider: string; id: string };
        configured: boolean;
      }
    >
  > {
    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys(
      ALL_TOOL_CREDENTIAL_KEYS as unknown as string[]
    );
    const refs: Record<
      string,
      {
        refKey: string;
        secretRef: { source: string; provider: string; id: string };
        configured: boolean;
      }
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
  ): Promise<Array<{ toolCode: string; dailyCallLimit: number | null; activationStatus: string }>> {
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

  private async resolveUserContext(
    userId: string,
    workspaceId: string
  ): Promise<{
    displayName: string | null;
    birthday: string | null;
    gender: string | null;
    locale: string;
    timezone: string;
  }> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { displayName: true, birthday: true, gender: true }
    });
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { locale: true, timezone: true }
    });
    return {
      displayName: user?.displayName ?? null,
      birthday: user?.birthday ? user.birthday.toISOString().split("T")[0]! : null,
      gender: user?.gender ?? null,
      locale: workspace?.locale ?? "en",
      timezone: workspace?.timezone ?? "UTC"
    };
  }

  private generateBootstrapDocuments(ctx: {
    publishedVersion: AssistantPublishedVersion;
    governance: AssistantGovernance;
    toolAvailability: Record<string, unknown>;
    toolQuotaPolicy: Array<{
      toolCode: string;
      dailyCallLimit: number | null;
      activationStatus: string;
    }>;
    memoryControl: unknown;
    tasksControl: unknown;
    effectiveCapabilities: Record<string, unknown>;
    userContext: {
      displayName: string | null;
      birthday: string | null;
      gender: string | null;
      locale: string;
      timezone: string;
    };
  }): Record<string, string> {
    return {
      soulDocument: this.generateSoulMd(ctx.publishedVersion),
      userDocument: this.generateUserMd(ctx.userContext),
      identityDocument: this.generateIdentityMd(ctx.publishedVersion),
      toolsDocument: this.generateToolsMd(ctx.toolQuotaPolicy),
      agentsDocument: this.generateAgentsMd(ctx),
      heartbeatDocument: this.generateHeartbeatMd(ctx.tasksControl),
      bootstrapDocument: this.generateBootstrapMd(ctx.publishedVersion, ctx.userContext)
    };
  }

  private generateSoulMd(pv: AssistantPublishedVersion): string {
    const lines: string[] = ["# SOUL.md"];
    lines.push("");
    lines.push(`You are **${pv.snapshotDisplayName ?? "an assistant"}**.`);
    lines.push("");

    const traits = pv.snapshotTraits;
    if (traits && Object.keys(traits).length > 0) {
      lines.push("## Personality Traits");
      lines.push("");
      for (const [trait, value] of Object.entries(traits)) {
        const label = this.traitLabel(trait, value);
        lines.push(`- **${trait}**: ${String(value)}/100 — ${label}`);
      }
      lines.push("");
    }

    if (pv.snapshotInstructions) {
      lines.push("## Instructions");
      lines.push("");
      lines.push(pv.snapshotInstructions);
      lines.push("");
    }

    return lines.join("\n");
  }

  private traitLabel(trait: string, value: number): string {
    const low = value < 35;
    const high = value > 65;
    const labels: Record<string, [string, string, string]> = {
      formality: ["very casual", "balanced", "very formal"],
      verbosity: ["concise and brief", "balanced detail", "detailed and thorough"],
      playfulness: ["serious and focused", "balanced tone", "playful and fun"],
      initiative: ["waits for instructions", "balanced initiative", "highly proactive"],
      warmth: ["neutral and professional", "friendly", "warm and caring"]
    };
    const entry = labels[trait];
    if (!entry) return `${String(value)}/100`;
    return low ? entry[0] : high ? entry[2] : entry[1];
  }

  private generateUserMd(userCtx: {
    displayName: string | null;
    birthday: string | null;
    gender: string | null;
    locale: string;
    timezone: string;
  }): string {
    const lines: string[] = ["# USER.md — About Your Human"];
    lines.push("");
    if (userCtx.displayName) lines.push(`- **Name**: ${userCtx.displayName}`);
    if (userCtx.birthday) lines.push(`- **Birthday**: ${userCtx.birthday}`);
    if (userCtx.gender) lines.push(`- **Gender**: ${userCtx.gender}`);
    lines.push(`- **Locale**: ${userCtx.locale}`);
    lines.push(`- **Timezone**: ${userCtx.timezone}`);
    lines.push("");
    lines.push("Use this information to personalize your communication.");
    lines.push("Greet on birthdays. Respect timezone for scheduling.");
    lines.push("");
    return lines.join("\n");
  }

  private generateIdentityMd(pv: AssistantPublishedVersion): string {
    const lines: string[] = ["# IDENTITY.md"];
    lines.push("");
    lines.push(`- **Name**: ${pv.snapshotDisplayName ?? "Assistant"}`);
    if (pv.snapshotAvatarEmoji) lines.push(`- **Avatar**: ${pv.snapshotAvatarEmoji}`);
    if (pv.snapshotAvatarUrl) lines.push(`- **Avatar URL**: ${pv.snapshotAvatarUrl}`);
    lines.push("");
    return lines.join("\n");
  }

  private generateToolsMd(
    toolQuotaPolicy: Array<{
      toolCode: string;
      dailyCallLimit: number | null;
      activationStatus: string;
    }>
  ): string {
    const lines: string[] = ["# TOOLS.md — Your Available Tools"];
    lines.push("");

    const active = toolQuotaPolicy.filter((t) => t.activationStatus === "active");
    const inactive = toolQuotaPolicy.filter((t) => t.activationStatus !== "active");

    if (active.length > 0) {
      lines.push("## Active Tools");
      lines.push("");
      for (const tool of active) {
        const limit =
          tool.dailyCallLimit !== null ? ` (daily limit: ${String(tool.dailyCallLimit)})` : "";
        lines.push(`- **${tool.toolCode}**${limit}`);
      }
      lines.push("");
    }

    if (inactive.length > 0) {
      lines.push("## Disabled Tools");
      lines.push("");
      for (const tool of inactive) {
        lines.push(`- ~~${tool.toolCode}~~ — not available on current plan`);
      }
      lines.push("");
    }

    if (toolQuotaPolicy.length === 0) {
      lines.push("No tools configured yet.");
      lines.push("");
    }

    return lines.join("\n");
  }

  private generateAgentsMd(ctx: {
    governance: AssistantGovernance;
    effectiveCapabilities: Record<string, unknown>;
    memoryControl: unknown;
    tasksControl: unknown;
  }): string {
    const lines: string[] = ["# AGENTS.md — Governance & Capabilities"];
    lines.push("");

    const mc = ctx.memoryControl as Record<string, unknown> | null;
    if (mc) {
      lines.push("## Memory Policy");
      lines.push("");
      lines.push("- Remember important facts about your human from conversations");
      lines.push("- Update MEMORY.md with key information you learn");
      lines.push("- Daily conversation notes go in memory/ directory");
      lines.push("");
    }

    const tc = ctx.tasksControl as Record<string, unknown> | null;
    if (tc) {
      lines.push("## Tasks Policy");
      lines.push("");
      lines.push("- You may manage reminders and recurring tasks for your human");
      lines.push("- Track tasks in HEARTBEAT.md");
      lines.push("");
    }

    return lines.join("\n");
  }

  private generateHeartbeatMd(tasksControl: unknown): string {
    const tc = tasksControl as Record<string, unknown> | null;
    if (!tc) {
      return "# HEARTBEAT.md\n\nNo tasks configured.\n";
    }
    return "# HEARTBEAT.md\n\nCheck in periodically. Review pending tasks and reminders.\n";
  }

  private generateBootstrapMd(
    pv: AssistantPublishedVersion,
    userCtx: { displayName: string | null }
  ): string {
    const assistantName = pv.snapshotDisplayName ?? "Assistant";
    const humanName = userCtx.displayName ?? "your human";
    const traits = pv.snapshotTraits;

    const lines: string[] = ["# BOOTSTRAP.md — Hello, World"];
    lines.push("");
    lines.push("You just came online for the first time!");
    lines.push("");
    lines.push(`Your name is **${assistantName}**. Your human's name is **${humanName}**.`);

    if (traits && Object.keys(traits).length > 0) {
      const traitDesc = Object.entries(traits)
        .map(([t, v]) => `${t}: ${String(v)}/100`)
        .join(", ");
      lines.push(`They set your personality to: ${traitDesc}.`);
    }

    lines.push("");
    lines.push("Introduce yourself naturally. Don't interrogate — just talk.");
    lines.push("");
    lines.push("After your first conversation:");
    lines.push("- Update SOUL.md with what you learned about yourself");
    lines.push("- Update USER.md with what you learned about your human");
    lines.push("- Then delete this file — you won't need it again.");
    lines.push("");

    return lines.join("\n");
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
