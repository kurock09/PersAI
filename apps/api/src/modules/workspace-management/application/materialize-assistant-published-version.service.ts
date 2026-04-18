import { createHash, createHmac } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { compileAssistantRuntimeBundle, type AssistantRuntimeBundle } from "@persai/runtime-bundle";
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
import {
  PROMPT_TEMPLATE_REPOSITORY,
  type PromptTemplateRepository
} from "../domain/bootstrap-document-preset.repository";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type { Assistant } from "../domain/assistant.entity";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveToolAvailabilityService } from "./resolve-effective-tool-availability.service";
import { ResolveAssistantChannelSurfaceBindingsService } from "./resolve-assistant-channel-surface-bindings.service";
import { ResolveAssistantCapabilityEnvelopeService } from "./resolve-assistant-capability-envelope.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { ResolveRuntimeProviderRoutingService } from "./resolve-runtime-provider-routing.service";
import { buildPlatformRuntimeProviderProfileState } from "./platform-runtime-provider-settings";
import {
  resolveRuntimeProviderProfileState,
  type RuntimeProviderProfileState
} from "./runtime-provider-profile";
import { resolveRuntimeToolPolicies } from "./runtime-tool-policy";
import { buildRuntimeBrowserConfig } from "./runtime-browser";
import {
  buildRuntimeContextHydrationConfig,
  resolveStoredPlanContextHydrationPolicy
} from "./context-hydration-policy";
import { buildRuntimeKnowledgeAccessConfig } from "./runtime-knowledge-access";
import { buildRuntimeWorkerToolsConfig } from "./runtime-worker-tools";
import { buildRuntimeSharedCompactionConfig } from "./runtime-shared-compaction";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  DEFAULT_TTS_PRIMARY_PROVIDER,
  TTS_PRIMARY_PROVIDER_STORAGE_KEY,
  TTS_PROVIDER_TO_CREDENTIAL_KEY,
  TOOL_CODE_BY_CREDENTIAL_KEY,
  TOOL_DEFAULT_PROVIDER,
  TOOL_PROVIDER_OPTIONS,
  buildToolCredentialSecretRef,
  providerStorageKey
} from "./tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  applyAssistantGenderVoiceDefaults,
  normalizeAssistantVoiceProfile
} from "./assistant-voice-profile";
import { normalizeAssistantGender } from "./assistant-gender";
import { resolveStableTtsProviderChain } from "./tts-provider-selection";
import { resolveRuntimeAssignmentState } from "./runtime-assignment";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { resolveTelegramBindingMetadataState } from "./telegram-integration.metadata";
import {
  CompilePromptConstructorService,
  type PromptTemplateMap
} from "./compile-prompt-constructor.service";
import { buildSyntheticPromptToolOverrideMap } from "./prompt-constructor-tool-metadata";
import {
  isPersaiRuntimeVideoGenerateModelKey,
  type PersaiRuntimeTtsProviderId,
  type PersaiRuntimeVideoGenerateModelKey
} from "@persai/runtime-contract";

const MATERIALIZATION_ALGORITHM_VERSION = 1;
const MATERIALIZATION_SCHEMA = "persai.materialization.v1";
const ASSISTANT_CONFIG_SCHEMA = "persai.assistantConfig.v1";
const ASSISTANT_WORKSPACE_SCHEMA = "persai.assistantWorkspace.v1";

export interface AssistantRuntimeArtifacts {
  currentConfigGeneration: number;
  layers: Record<string, unknown>;
  runtimeBundle: AssistantRuntimeBundle;
  assistantConfig: Record<string, unknown>;
  assistantWorkspace: Record<string, unknown>;
  layersDocument: string;
  runtimeBundleDocument: string;
  runtimeBundleHash: string;
  assistantConfigDocument: string;
  assistantWorkspaceDocument: string;
  contentHash: string;
}

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

function resolveAllowedPlanModelKey(params: {
  runtimeProviderProfile: RuntimeProviderProfileState;
  planModelKey: string | null;
}): string | null {
  const planModelKey = params.planModelKey?.trim() || null;
  if (planModelKey === null) {
    return null;
  }
  if (
    params.runtimeProviderProfile.mode !== "admin_managed" ||
    params.runtimeProviderProfile.primary === null
  ) {
    return planModelKey;
  }
  const providerCatalog =
    params.runtimeProviderProfile.availableModelsByProvider[
      params.runtimeProviderProfile.primary.provider
    ] ?? [];
  return providerCatalog.includes(planModelKey) ? planModelKey : null;
}

export function resolveAllowedPlanPrimaryModelKey(params: {
  runtimeProviderProfile: RuntimeProviderProfileState;
  planPrimaryModelKey: string | null;
}): string | null {
  return resolveAllowedPlanModelKey({
    runtimeProviderProfile: params.runtimeProviderProfile,
    planModelKey: params.planPrimaryModelKey
  });
}

export function resolveAllowedPlanVideoGenerateModelKey(
  planVideoGenerateModelKey: string | null
): PersaiRuntimeVideoGenerateModelKey | null {
  const normalized = planVideoGenerateModelKey?.trim() || null;
  if (normalized === null) {
    return null;
  }
  return isPersaiRuntimeVideoGenerateModelKey(normalized) ? normalized : null;
}

@Injectable()
export class MaterializeAssistantPublishedVersionService {
  private readonly logger = new Logger(MaterializeAssistantPublishedVersionService.name);

  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(PROMPT_TEMPLATE_REPOSITORY)
    private readonly promptTemplateRepository: PromptTemplateRepository,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly resolveEffectiveToolAvailabilityService: ResolveEffectiveToolAvailabilityService,
    private readonly resolveAssistantChannelSurfaceBindingsService: ResolveAssistantChannelSurfaceBindingsService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly resolveRuntimeProviderRoutingService: ResolveRuntimeProviderRoutingService,
    private readonly resolveAssistantCapabilityEnvelopeService: ResolveAssistantCapabilityEnvelopeService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly compilePromptConstructorService: CompilePromptConstructorService
  ) {}

  async execute(
    assistant: Assistant,
    publishedVersion: AssistantPublishedVersion,
    sourceAction: AssistantMaterializationSourceAction
  ): Promise<void> {
    const existingSpec = await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
      publishedVersion.id
    );
    const artifacts = await this.buildRuntimeArtifacts(assistant, publishedVersion);

    await this.assistantMaterializedSpecRepository.create({
      assistantId: assistant.id,
      publishedVersionId: publishedVersion.id,
      sourceAction: existingSpec?.sourceAction ?? sourceAction,
      algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
      materializedAtConfigGeneration: artifacts.currentConfigGeneration,
      layers: artifacts.layers,
      runtimeBundle: artifacts.runtimeBundle,
      assistantConfig: artifacts.assistantConfig,
      assistantWorkspace: artifacts.assistantWorkspace,
      layersDocument: artifacts.layersDocument,
      runtimeBundleDocument: artifacts.runtimeBundleDocument,
      runtimeBundleHash: artifacts.runtimeBundleHash,
      assistantConfigDocument: artifacts.assistantConfigDocument,
      assistantWorkspaceDocument: artifacts.assistantWorkspaceDocument,
      contentHash: artifacts.contentHash
    });

    await this.prisma.assistant.update({
      where: { id: assistant.id },
      data: { configDirtyAt: null }
    });
  }

  async buildRuntimeArtifacts(
    assistant: Assistant,
    publishedVersion: AssistantPublishedVersion
  ): Promise<AssistantRuntimeArtifacts> {
    const currentConfigGeneration = await this.bumpConfigGenerationService.current();

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
    const channelSurfaceBindings = await this.resolveAssistantChannelSurfaceBindingsService.execute(
      {
        assistantId: assistant.id,
        effectiveCapabilities
      }
    );
    const platformRuntimeProviderSettings =
      await this.resolvePlatformRuntimeProviderSettingsService.execute();
    let runtimeProviderProfile =
      platformRuntimeProviderSettings.mode === "global_settings"
        ? buildPlatformRuntimeProviderProfileState(platformRuntimeProviderSettings)
        : resolveRuntimeProviderProfileState({
            policyEnvelope: governance.policyEnvelope,
            secretRefs: governance.secretRefs
          });
    const planRuntimeTierDefault = await this.resolvePlanRuntimeTierDefault(
      effectiveCapabilities.derivedFrom.planCode
    );
    const runtimeAssignment = resolveRuntimeAssignmentState({
      billingProviderHints:
        planRuntimeTierDefault === null ? null : { runtimeTierDefault: planRuntimeTierDefault },
      policyEnvelope: governance.policyEnvelope
    });
    const rawPlanPrimaryModelKey = await this.resolvePlanPrimaryModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planPrimaryModelKey = resolveAllowedPlanPrimaryModelKey({
      runtimeProviderProfile,
      planPrimaryModelKey: rawPlanPrimaryModelKey
    });
    const rawPlanPremiumModelKey = await this.resolvePlanPremiumModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planPremiumModelKey = resolveAllowedPlanModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanPremiumModelKey
    });
    const rawPlanReasoningModelKey = await this.resolvePlanReasoningModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planReasoningModelKey = resolveAllowedPlanModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanReasoningModelKey
    });
    const rawPlanRetrievalModelKey = await this.resolvePlanRetrievalModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planRetrievalModelKey = resolveAllowedPlanModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanRetrievalModelKey
    });
    const rawPlanVideoGenerateModelKey = await this.resolvePlanVideoGenerateModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planVideoGenerateModelKey = resolveAllowedPlanVideoGenerateModelKey(
      rawPlanVideoGenerateModelKey
    );
    if (rawPlanPrimaryModelKey !== null && planPrimaryModelKey === null) {
      this.logger.warn(
        `Skipping stale plan primary model "${rawPlanPrimaryModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime provider catalog.`
      );
    }
    if (rawPlanPremiumModelKey !== null && planPremiumModelKey === null) {
      this.logger.warn(
        `Skipping stale plan premium model "${rawPlanPremiumModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime provider catalog.`
      );
    }
    if (rawPlanReasoningModelKey !== null && planReasoningModelKey === null) {
      this.logger.warn(
        `Skipping stale plan reasoning model "${rawPlanReasoningModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime provider catalog.`
      );
    }
    if (rawPlanRetrievalModelKey !== null && planRetrievalModelKey === null) {
      this.logger.warn(
        `Skipping stale plan retrieval model "${rawPlanRetrievalModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime provider catalog.`
      );
    }
    if (rawPlanVideoGenerateModelKey !== null && planVideoGenerateModelKey === null) {
      this.logger.warn(
        `Skipping stale plan video model "${rawPlanVideoGenerateModelKey}" for assistant ${assistant.id}; it is not supported by the active runtime video catalog.`
      );
    }
    if (
      planPrimaryModelKey &&
      runtimeProviderProfile.mode === "admin_managed" &&
      runtimeProviderProfile.primary
    ) {
      runtimeProviderProfile = {
        ...runtimeProviderProfile,
        primary: {
          ...runtimeProviderProfile.primary,
          model: planPrimaryModelKey
        }
      };
    }
    const runtimeProviderRouting = this.resolveRuntimeProviderRoutingService.execute({
      effectiveCapabilities,
      policyEnvelope: governance.policyEnvelope,
      runtimeProviderProfile,
      planPrimaryModelKey,
      planPremiumModelKey,
      planReasoningModelKey,
      planRetrievalModelKey
    });
    const assistantCapabilityEnvelope = this.resolveAssistantCapabilityEnvelopeService.execute({
      effectiveCapabilities,
      effectiveToolAvailability: toolAvailability,
      channelSurfaceBindings,
      runtimeProviderRouting
    });
    const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const effectivePlanCode = effectiveSubscription.planCode;

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
          assistantCapabilityEnvelope,
          runtimeProviderProfile,
          runtimeAssignment,
          effectivePlanCode
        ),
        applyState: {
          status: assistant.applyStatus,
          targetPublishedVersionId: assistant.applyTargetVersionId,
          appliedPublishedVersionId: assistant.applyAppliedVersionId
        }
      }
    };

    const assistantGender = normalizeAssistantGender(publishedVersion.snapshotAssistantGender);
    const voiceProfile = applyAssistantGenderVoiceDefaults({
      assistantGender,
      voiceProfile: normalizeAssistantVoiceProfile(publishedVersion.snapshotVoiceProfile)
    });
    const toolCredentialRefs = await this.resolveToolCredentialRefs({
      voiceProfile,
      videoGenerateModelKey: planVideoGenerateModelKey
    });
    const planToolQuotaPolicy = await this.resolveToolQuotaPolicy(effectivePlanCode);
    const promptTemplateRows = await this.loadPromptTemplateRows();
    const runtimeToolQuotaPolicy = this.resolveRuntimeToolQuotaPolicy(
      toolAvailability.tools,
      planToolQuotaPolicy
    );
    const knowledgeAccess = buildRuntimeKnowledgeAccessConfig();
    const toolPolicies = resolveRuntimeToolPolicies({
      tools: toolAvailability.tools,
      planToolQuotaPolicy,
      toolCredentialRefs,
      knowledgeAccessEnabled: knowledgeAccess.sources.length > 0,
      syntheticToolOverrides: buildSyntheticPromptToolOverrideMap(promptTemplateRows)
    });
    const telegramChannel = await this.resolveTelegramChannelConfig(assistant.id);
    const planContextHydrationPolicy =
      await this.resolvePlanContextHydrationPolicy(effectivePlanCode);
    const contextHydration = buildRuntimeContextHydrationConfig({
      policy: planContextHydrationPolicy,
      telegramAutoCompactionEnabled: telegramChannel.autoCompactionEnabled
    });
    const browser = buildRuntimeBrowserConfig();
    const workerTools = buildRuntimeWorkerToolsConfig(toolPolicies);
    const sharedCompaction = buildRuntimeSharedCompactionConfig(contextHydration);

    const apiConfig = loadApiConfig(process.env);
    const workspaceQuotaBytes = await this.resolveWorkspaceQuotaBytes(
      effectivePlanCode,
      apiConfig.QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT
    );

    const assistantConfig = {
      schema: ASSISTANT_CONFIG_SCHEMA,
      assistant: {
        id: assistant.id,
        workspaceId: assistant.workspaceId
      },
      governance: {
        configGeneration: currentConfigGeneration,
        capabilityEnvelope: governance.capabilityEnvelope,
        policyEnvelope: governance.policyEnvelope,
        quota: {
          planCode: effectivePlanCode,
          hook: governance.quotaHook
        },
        effectiveCapabilities,
        toolAvailability,
        assistantCapabilityEnvelope,
        runtimeAssignment,
        runtimeProviderProfile,
        toolCredentialRefs,
        toolQuotaPolicy: runtimeToolQuotaPolicy,
        workspaceQuotaBytes,
        secretRefs: governance.secretRefs,
        auditHook: governance.auditHook
      },
      channels: {
        telegram: telegramChannel
      }
    };

    const userContext = await this.resolveUserContext(assistant.userId, assistant.workspaceId);
    const promptTemplates = this.toPromptTemplateMap(promptTemplateRows);
    const compiledPromptConstructor = this.compilePromptConstructorService.compile({
      publishedVersion,
      userContext,
      toolPolicies,
      promptTemplates
    });
    const onboardingDocuments = {
      soulDocument: compiledPromptConstructor.promptDocuments.soul,
      userDocument: compiledPromptConstructor.promptDocuments.user,
      identityDocument: compiledPromptConstructor.promptDocuments.identity,
      toolsDocument: compiledPromptConstructor.promptDocuments.tools,
      agentsDocument: compiledPromptConstructor.promptDocuments.agents,
      heartbeatDocument: compiledPromptConstructor.promptDocuments.heartbeat,
      previewDocument: compiledPromptConstructor.promptDocuments.preview,
      welcomeDocument: compiledPromptConstructor.promptDocuments.welcome,
      bootstrapDocument: compiledPromptConstructor.promptDocuments.welcome
    };

    const assistantWorkspace = {
      schema: ASSISTANT_WORKSPACE_SCHEMA,
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
        avatarUrl: publishedVersion.snapshotAvatarUrl,
        assistantGender,
        voiceProfile
      },
      effectiveCapabilities,
      toolAvailability,
      assistantCapabilityEnvelope,
      runtimeAssignment,
      memoryControl,
      tasksControl,
      userContext,
      bootstrapDocuments: onboardingDocuments
    };

    const runtimeBundleArtifact = compileAssistantRuntimeBundle({
      metadata: {
        assistantId: assistant.id,
        workspaceId: assistant.workspaceId,
        publishedVersionId: publishedVersion.id,
        publishedVersion: publishedVersion.version,
        algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
        configGeneration: currentConfigGeneration
      },
      persona: {
        displayName: publishedVersion.snapshotDisplayName,
        instructions: publishedVersion.snapshotInstructions,
        traits: publishedVersion.snapshotTraits,
        avatarEmoji: publishedVersion.snapshotAvatarEmoji,
        avatarUrl: publishedVersion.snapshotAvatarUrl,
        assistantGender,
        voiceProfile
      },
      userContext,
      runtime: {
        runtimeAssignment,
        runtimeProviderProfile,
        runtimeProviderRouting,
        routingFastModelKey: platformRuntimeProviderSettings.routingFastModelKey,
        routerPolicy: platformRuntimeProviderSettings.routerPolicy,
        contextHydration,
        sharedCompaction,
        knowledgeAccess,
        workerTools,
        browser
      },
      governance: {
        capabilityEnvelope: governance.capabilityEnvelope,
        secretRefs: governance.secretRefs,
        policyEnvelope: governance.policyEnvelope,
        effectiveCapabilities,
        toolAvailability,
        memoryControl,
        tasksControl,
        toolCredentialRefs,
        toolPolicies,
        quota: {
          planCode: effectivePlanCode,
          workspaceQuotaBytes,
          quotaHook: governance.quotaHook
        },
        auditHook: governance.auditHook
      },
      channels: {
        bindings: channelSurfaceBindings,
        telegram: {
          enabled: telegramChannel.enabled,
          autoCompactionEnabled: telegramChannel.autoCompactionEnabled,
          dmPolicy: telegramChannel.dmPolicy,
          groupReplyMode: telegramChannel.groupReplyMode,
          parseMode: telegramChannel.parseMode,
          inbound: telegramChannel.inbound,
          outbound: telegramChannel.outbound,
          accessMode: telegramChannel.accessMode,
          ownerClaimStatus: telegramChannel.ownerClaimStatus,
          ownerClaimCode: telegramChannel.ownerClaimCode,
          ownerClaimCodeExpiresAt: telegramChannel.ownerClaimCodeExpiresAt,
          ownerTelegramUserId: telegramChannel.ownerTelegramUserId,
          ownerTelegramUsername: telegramChannel.ownerTelegramUsername,
          ownerTelegramChatId: telegramChannel.ownerTelegramChatId
        }
      },
      promptDocuments: {
        soul: onboardingDocuments.soulDocument,
        user: onboardingDocuments.userDocument,
        identity: onboardingDocuments.identityDocument,
        tools: onboardingDocuments.toolsDocument,
        agents: onboardingDocuments.agentsDocument,
        heartbeat: onboardingDocuments.heartbeatDocument,
        routerClassifier: promptTemplates.router_classifier ?? "",
        preview: onboardingDocuments.previewDocument,
        welcome: onboardingDocuments.welcomeDocument,
        bootstrap: onboardingDocuments.bootstrapDocument
      },
      promptConstructor: compiledPromptConstructor.promptConstructor
    });

    const layersDocument = toDeterministicDocument(layers);
    const runtimeBundleDocument = runtimeBundleArtifact.document;
    const assistantConfigDocument = toDeterministicDocument(assistantConfig);
    const assistantWorkspaceDocument = toDeterministicDocument(assistantWorkspace);
    const contentHash = createHash("sha256")
      .update(`${layersDocument}\n${assistantConfigDocument}\n${assistantWorkspaceDocument}`)
      .digest("hex");

    return {
      currentConfigGeneration,
      layers,
      runtimeBundle: runtimeBundleArtifact.bundle,
      assistantConfig,
      assistantWorkspace,
      layersDocument,
      runtimeBundleDocument,
      runtimeBundleHash: runtimeBundleArtifact.hash,
      assistantConfigDocument,
      assistantWorkspaceDocument,
      contentHash
    };
  }

  private async resolveToolCredentialRefs(input: {
    voiceProfile: AssistantRuntimeBundle["persona"]["voiceProfile"];
    videoGenerateModelKey: PersaiRuntimeVideoGenerateModelKey | null;
  }): Promise<AssistantRuntimeBundle["governance"]["toolCredentialRefs"]> {
    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys(
      ALL_TOOL_CREDENTIAL_KEYS as unknown as string[]
    );
    const refs: AssistantRuntimeBundle["governance"]["toolCredentialRefs"] = {};
    for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
      const toolCode = TOOL_CODE_BY_CREDENTIAL_KEY[credentialKey];
      if (toolCode === "tts") {
        continue;
      }
      const secretRef = buildToolCredentialSecretRef(credentialKey);

      let providerId: string | undefined;
      if (TOOL_PROVIDER_OPTIONS[credentialKey]) {
        const stored =
          await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
            providerStorageKey(credentialKey)
          );
        providerId = stored ?? TOOL_DEFAULT_PROVIDER[credentialKey] ?? undefined;
      }

      refs[toolCode] = {
        ...secretRef,
        configured: keyMetadata[credentialKey]?.configured ?? false,
        ...(providerId ? { providerId } : {})
      };
    }
    const imageCredentialRef = refs.image_generate;
    if (imageCredentialRef) {
      refs.image_edit = this.cloneToolCredentialRef(imageCredentialRef);
      refs.video_generate = {
        ...this.cloneToolCredentialRef(imageCredentialRef),
        ...(input.videoGenerateModelKey !== null ? { modelKey: input.videoGenerateModelKey } : {})
      };
    }
    refs.tts = this.buildTtsToolCredentialRef(
      keyMetadata,
      await this.resolveTtsPrimaryProviderId(),
      input.voiceProfile
    );
    return refs;
  }

  private cloneToolCredentialRef(
    ref: AssistantRuntimeBundle["governance"]["toolCredentialRefs"][string]
  ): AssistantRuntimeBundle["governance"]["toolCredentialRefs"][string] {
    return {
      ...ref,
      secretRef: { ...ref.secretRef },
      ...(ref.fallbacks
        ? {
            fallbacks: ref.fallbacks.map((fallback) => ({
              ...fallback,
              secretRef: { ...fallback.secretRef }
            }))
          }
        : {})
    };
  }

  private buildTtsToolCredentialRef(
    keyMetadata: Record<string, { configured: boolean } | undefined>,
    primaryProviderId: PersaiRuntimeTtsProviderId,
    voiceProfile: AssistantRuntimeBundle["persona"]["voiceProfile"]
  ): AssistantRuntimeBundle["governance"]["toolCredentialRefs"][string] {
    const credentialConfiguredByProvider: Record<PersaiRuntimeTtsProviderId, boolean> = {
      elevenlabs: keyMetadata[TTS_PROVIDER_TO_CREDENTIAL_KEY.elevenlabs]?.configured ?? false,
      yandex: keyMetadata[TTS_PROVIDER_TO_CREDENTIAL_KEY.yandex]?.configured ?? false,
      openai: keyMetadata[TTS_PROVIDER_TO_CREDENTIAL_KEY.openai]?.configured ?? false
    };
    const providerChain = resolveStableTtsProviderChain({
      primaryProviderId,
      credentialConfiguredByProvider,
      voiceProfile
    });
    const materializedProviderId = providerChain[0] ?? primaryProviderId;
    const primaryCredentialKey = TTS_PROVIDER_TO_CREDENTIAL_KEY[materializedProviderId];
    const primarySecretRef = buildToolCredentialSecretRef(primaryCredentialKey);

    return {
      ...primarySecretRef,
      configured: providerChain.length > 0,
      providerId: materializedProviderId,
      fallbacks: providerChain.slice(1, 2).map((providerId) => {
        const credentialKey = TTS_PROVIDER_TO_CREDENTIAL_KEY[providerId];
        const secretRef = buildToolCredentialSecretRef(credentialKey);
        return {
          ...secretRef,
          configured: true,
          providerId
        };
      })
    };
  }

  private async resolveTtsPrimaryProviderId(): Promise<PersaiRuntimeTtsProviderId> {
    const stored =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        TTS_PRIMARY_PROVIDER_STORAGE_KEY
      );
    if (stored === "elevenlabs" || stored === "yandex" || stored === "openai") {
      return stored;
    }
    return DEFAULT_TTS_PRIMARY_PROVIDER;
  }

  private async resolvePlanPrimaryModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "primaryModelKey");
  }

  private async resolvePlanPremiumModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "premiumModelKey");
  }

  private async resolvePlanReasoningModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "reasoningModelKey");
  }

  private async resolvePlanRetrievalModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "retrievalModelKey");
  }

  private async resolvePlanBillingHintString(
    planCode: string | null,
    key:
      | "primaryModelKey"
      | "premiumModelKey"
      | "reasoningModelKey"
      | "retrievalModelKey"
      | "videoGenerateModelKey"
  ): Promise<string | null> {
    if (planCode === null) {
      return null;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return null;
    }
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) {
      return null;
    }
    const record = hints as Record<string, unknown>;
    return typeof record[key] === "string" && record[key].trim().length > 0
      ? record[key].trim()
      : null;
  }

  private async resolvePlanVideoGenerateModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "videoGenerateModelKey");
  }

  private async resolvePlanRuntimeTierDefault(
    planCode: string | null
  ): Promise<"free_shared_restricted" | "paid_shared_restricted" | "paid_isolated" | null> {
    if (planCode === null) {
      return null;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return null;
    }
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) {
      return null;
    }
    const record = hints as Record<string, unknown>;
    return record.runtimeTierDefault === "free_shared_restricted" ||
      record.runtimeTierDefault === "paid_shared_restricted" ||
      record.runtimeTierDefault === "paid_isolated"
      ? record.runtimeTierDefault
      : null;
  }

  private async resolvePlanContextHydrationPolicy(
    planCode: string | null
  ): Promise<ReturnType<typeof resolveStoredPlanContextHydrationPolicy>> {
    if (planCode === null) {
      return resolveStoredPlanContextHydrationPolicy(null);
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return resolveStoredPlanContextHydrationPolicy(null);
    }
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) {
      return resolveStoredPlanContextHydrationPolicy(null);
    }
    const record = hints as Record<string, unknown>;
    return resolveStoredPlanContextHydrationPolicy(record.contextPolicy);
  }

  private async resolveWorkspaceQuotaBytes(
    planCode: string | null,
    envDefault: number
  ): Promise<number> {
    if (planCode === null) return envDefault;
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) return envDefault;
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) return envDefault;
    const record = hints as Record<string, unknown>;
    const qa =
      record.quotaAccounting !== null &&
      typeof record.quotaAccounting === "object" &&
      !Array.isArray(record.quotaAccounting)
        ? (record.quotaAccounting as Record<string, unknown>)
        : null;
    if (!qa) return envDefault;
    const raw = qa.workspaceStorageBytesLimit;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : envDefault;
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

  private resolveRuntimeToolQuotaPolicy(
    tools: Array<{
      code: string;
      policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
      effectiveActivation: "active" | "inactive";
      visibleInPlanEditor: boolean;
    }>,
    planToolQuotaPolicy: Array<{
      toolCode: string;
      dailyCallLimit: number | null;
      activationStatus: string;
    }>
  ): Array<{
    toolCode: string;
    dailyCallLimit: number | null;
    activationStatus: string;
    policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
    visibleInPlanEditor: boolean;
  }> {
    const planQuotaByCode = new Map(
      planToolQuotaPolicy.map((tool) => [tool.toolCode, tool.dailyCallLimit] as const)
    );
    return tools.map((tool) => ({
      toolCode: tool.code,
      dailyCallLimit: planQuotaByCode.get(tool.code) ?? null,
      activationStatus: tool.effectiveActivation,
      policyClass: tool.policyClass,
      visibleInPlanEditor: tool.visibleInPlanEditor
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

  private async loadPromptTemplateRows() {
    try {
      return await this.promptTemplateRepository.findAll();
    } catch (err) {
      this.logger.warn("Failed to load prompt templates from DB, using hardcoded fallbacks", err);
      return [];
    }
  }

  private toPromptTemplateMap(presets: Array<{ id: string; template: string }>): PromptTemplateMap {
    const map: PromptTemplateMap = {
      system: null,
      soul: null,
      user: null,
      identity: null,
      agents: null,
      tools: null,
      heartbeat: null,
      router_classifier: null,
      preview_bootstrap: null,
      welcome_bootstrap: null,
      bootstrap: null
    };
    for (const p of presets) {
      if (p.id in map) {
        map[p.id as keyof PromptTemplateMap] = p.template;
      }
    }
    return map;
  }

  private async resolveTelegramChannelConfig(assistantId: string): Promise<{
    enabled: boolean;
    botToken: string | null;
    webhookUrl: string | null;
    webhookSecret: string | null;
    autoCompactionEnabled: boolean;
    dmPolicy: string;
    groupReplyMode: string;
    parseMode: string;
    inbound: boolean;
    outbound: boolean;
    accessMode: string;
    ownerClaimStatus: string;
    ownerClaimCode: string | null;
    ownerClaimCodeExpiresAt: string | null;
    ownerTelegramUserId: number | null;
    ownerTelegramUsername: string | null;
    ownerTelegramChatId: string | null;
    runtimeHealth: string;
  }> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
      where: {
        assistantId,
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active"
      }
    });
    if (!binding) {
      return {
        enabled: false,
        botToken: null,
        webhookUrl: null,
        webhookSecret: null,
        autoCompactionEnabled: true,
        dmPolicy: "open",
        groupReplyMode: "mention_reply",
        parseMode: "plain_text",
        inbound: false,
        outbound: false,
        accessMode: "owner_only",
        ownerClaimStatus: "not_started",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: null,
        ownerTelegramUsername: null,
        ownerTelegramChatId: null,
        runtimeHealth: "ok"
      };
    }

    const botToken = await this.platformRuntimeProviderSecretStoreService
      .resolveSecretValueByProviderKey(`telegram_bot:${assistantId}`)
      .catch(() => null);

    const config = loadApiConfig(process.env);
    const baseUrl = config.TELEGRAM_WEBHOOK_BASE_URL ?? null;
    const hmacSecret = config.TELEGRAM_WEBHOOK_HMAC_SECRET ?? null;

    let webhookUrl: string | null = null;
    let webhookSecret: string | null = null;
    if (baseUrl && hmacSecret) {
      webhookUrl = `${baseUrl}/telegram-webhook/${assistantId}`;
      webhookSecret = createHmac("sha256", hmacSecret)
        .update(assistantId)
        .digest("hex")
        .slice(0, 64);
    }

    const bindingConfig =
      binding.config && typeof binding.config === "object" && !Array.isArray(binding.config)
        ? (binding.config as Record<string, unknown>)
        : {};
    const bindingPolicy =
      binding.policy && typeof binding.policy === "object" && !Array.isArray(binding.policy)
        ? (binding.policy as Record<string, unknown>)
        : {};
    const bindingMetadata = resolveTelegramBindingMetadataState(binding.metadata);

    return {
      enabled: botToken !== null,
      botToken,
      webhookUrl,
      webhookSecret,
      autoCompactionEnabled: bindingConfig.autoCompactionEnabled !== false,
      dmPolicy: "owner_only",
      groupReplyMode:
        typeof bindingConfig.groupReplyMode === "string"
          ? bindingConfig.groupReplyMode
          : "mention_reply",
      parseMode:
        typeof bindingConfig.defaultParseMode === "string"
          ? bindingConfig.defaultParseMode
          : "plain_text",
      inbound: bindingPolicy.inboundUserMessages !== false,
      outbound: bindingPolicy.outboundAssistantMessages !== false,
      accessMode: bindingMetadata.telegramAccessMode,
      ownerClaimStatus: bindingMetadata.telegramOwnerClaimStatus,
      ownerClaimCode: bindingMetadata.telegramOwnerClaimCode,
      ownerClaimCodeExpiresAt: bindingMetadata.telegramOwnerClaimExpiresAt,
      ownerTelegramUserId: bindingMetadata.telegramOwnerTelegramUserId,
      ownerTelegramUsername: bindingMetadata.telegramOwnerTelegramUsername,
      ownerTelegramChatId: bindingMetadata.telegramOwnerTelegramChatId,
      runtimeHealth: bindingMetadata.telegramRuntimeHealth
    };
  }

  private toGovernanceLayer(
    governance: AssistantGovernance,
    effectiveCapabilities: Record<string, unknown>,
    toolAvailability: Record<string, unknown>,
    assistantCapabilityEnvelope: Record<string, unknown>,
    runtimeProviderProfile: unknown,
    runtimeAssignment: unknown,
    effectivePlanCode: string | null
  ): Record<string, unknown> {
    return {
      capabilityEnvelope: governance.capabilityEnvelope,
      secretRefs: governance.secretRefs,
      policyEnvelope: governance.policyEnvelope,
      runtimeAssignment,
      runtimeProviderProfile,
      effectiveCapabilities,
      toolAvailability,
      assistantCapabilityEnvelope,
      memoryControl: governance.memoryControl,
      tasksControl: governance.tasksControl,
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
      quota: {
        planCode: effectivePlanCode,
        hook: governance.quotaHook
      },
      auditHook: governance.auditHook
    };
  }
}
