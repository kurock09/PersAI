import { createHash, createHmac } from "node:crypto";
import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import {
  compileAssistantRuntimeBundle,
  type AssistantRuntimeBundle,
  type AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
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
  findRuntimeProviderCatalogProfile,
  getRuntimeProviderCatalogModelsByCapability,
  resolveRuntimeProviderProfileState,
  VIDEO_GENERATE_PROVIDERS,
  type RuntimeProviderProfileState,
  type VideoGenerateRuntimeProvider
} from "./runtime-provider-profile";
import { resolveRuntimeToolPolicies } from "./runtime-tool-policy";
import { buildRuntimeBrowserConfig } from "./runtime-browser";
import {
  buildRuntimeContextHydrationConfig,
  resolveStoredPlanContextHydrationPolicy
} from "./context-hydration-policy";
import { resolveStoredPlanSandboxPolicy } from "./sandbox-policy";
import { buildRuntimeKnowledgeAccessConfig } from "./runtime-knowledge-access";
import { buildRuntimeWorkerToolsConfig } from "./runtime-worker-tools";
import { buildRuntimeSharedCompactionConfig } from "./runtime-shared-compaction";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  DEFAULT_MEDIA_RESERVE_BASE_URL,
  DOCUMENT_PROVIDER_CONFIG_KEYS,
  MEDIA_RESERVE_CONFIG_KEYS,
  DEFAULT_TTS_PRIMARY_PROVIDER,
  TTS_PRIMARY_PROVIDER_STORAGE_KEY,
  TTS_PROVIDER_TO_CREDENTIAL_KEY,
  TOOL_CODE_BY_CREDENTIAL_KEY,
  TOOL_DEFAULT_PROVIDER,
  TOOL_PROVIDER_OPTIONS,
  type ToolCredentialKey,
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
import {
  resolveEnabledSkillPromptCards,
  resolveEnabledSkillScenariosForBundle,
  type EnabledSkillPromptCandidate,
  type EnabledSkillPromptInstructionCard,
  type EnabledSkillScenarioCandidate
} from "./enabled-skills-prompt-materialization";
import { ManagePersonaArchetypesService } from "./manage-persona-archetypes.service";
import {
  modulateVoiceDna,
  resolveVoiceDnaLocale,
  type VoiceDnaResolved
} from "./voice-dna-modulator";
import { KlingVoiceCatalogService } from "./kling/kling-voice-catalog.service";
import { HeyGenVoiceCatalogService } from "./heygen/heygen-voice-catalog.service";
import {
  WORKSPACE_VIDEO_PERSONA_REPOSITORY,
  type WorkspaceVideoPersonaRepository
} from "../domain/workspace-video-persona.repository";
import type { RuntimeVideoPersonaCatalog } from "@persai/runtime-contract";
import type { PersonaArchetype } from "../domain/persona-archetype.entity";
import type { AssistantPublishedVersionSnapshotVoiceDna } from "../domain/assistant-published-version.entity";
import { buildSyntheticPromptToolOverrideMap } from "./prompt-constructor-tool-metadata";
import { type PersaiRuntimeTtsProviderId } from "@persai/runtime-contract";

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

type MaterializedDocumentProviderConfig = {
  pdfmonkeyTemplateId: string | null;
};

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

export function resolveAllowedPlanCapabilityModelKey(params: {
  runtimeProviderProfile: RuntimeProviderProfileState;
  planModelKey: string | null;
  capability: "image" | "video";
}): string | null {
  const normalized = params.planModelKey?.trim() || null;
  if (normalized === null) {
    return null;
  }
  if (params.runtimeProviderProfile.mode !== "admin_managed") {
    return normalized;
  }
  const catalog = params.runtimeProviderProfile.availableModelCatalogByProvider;
  const providers =
    params.capability === "video" ? VIDEO_GENERATE_PROVIDERS : (["openai", "anthropic"] as const);
  const models = providers.flatMap((providerId) =>
    getRuntimeProviderCatalogModelsByCapability(catalog[providerId], params.capability)
  );
  return models.includes(normalized) ? normalized : null;
}

export function resolveVideoGenerateProviderSelection(params: {
  runtimeProviderProfile: RuntimeProviderProfileState;
  modelKey: string;
}): {
  providerId: VideoGenerateRuntimeProvider;
  modelKey: string;
} {
  if (params.runtimeProviderProfile.mode !== "admin_managed") {
    throw new Error(
      `Selected video model "${params.modelKey}" cannot be resolved without an admin-managed runtime provider catalog.`
    );
  }
  const matches = VIDEO_GENERATE_PROVIDERS.filter((providerId) =>
    params.runtimeProviderProfile.availableModelCatalogByProvider[providerId].models.some(
      (profile) =>
        profile.active &&
        profile.model === params.modelKey &&
        profile.capabilities.includes("video")
    )
  );
  if (matches.length === 1) {
    const providerId = matches[0];
    if (providerId === undefined) {
      throw new Error(
        `Selected video model "${params.modelKey}" could not be resolved from the active runtime video catalog.`
      );
    }
    return {
      providerId,
      modelKey: params.modelKey
    };
  }
  if (matches.length === 0) {
    throw new Error(
      `Selected video model "${params.modelKey}" is not present in the active runtime video catalog.`
    );
  }
  throw new Error(
    `Selected video model "${params.modelKey}" resolves ambiguously across active video providers: ${matches.join(", ")}.`
  );
}

const VIDEO_PROVIDER_CREDENTIAL_KEY: Record<VideoGenerateRuntimeProvider, ToolCredentialKey> = {
  openai: "tool_image_generate",
  runway: "tool_video_generate_runway",
  kling: "tool_video_generate_kling",
  heygen: "tool_video_generate_heygen"
};

function cloneToolCredentialRef(
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

function buildMediaModelFallbackPatch(
  ref: AssistantRuntimeBundle["governance"]["toolCredentialRefs"][string],
  fallbackModelKey: string | null
):
  | Pick<AssistantRuntimeBundle["governance"]["toolCredentialRefs"][string], "fallbacks">
  | Record<never, never> {
  if (fallbackModelKey === null) {
    return {};
  }
  const fallback = cloneToolCredentialRef(ref);
  return {
    fallbacks: [
      {
        ...fallback,
        modelKey: fallbackModelKey
      }
    ]
  };
}

export function buildImageGenerateToolCredentialRef(params: {
  imageCredentialRef: AssistantRuntimeBundleToolCredentialRef;
  imageGenerateModelKey: string | null;
  imageGenerateFallbackModelKey: string | null;
  mediaReserveTransport?: {
    configured: boolean;
    secretRef: AssistantRuntimeBundleToolCredentialRef["secretRef"];
    baseUrl: string;
  } | null;
}): AssistantRuntimeBundleToolCredentialRef {
  return {
    ...params.imageCredentialRef,
    ...(params.imageGenerateModelKey !== null ? { modelKey: params.imageGenerateModelKey } : {}),
    ...(params.mediaReserveTransport
      ? {
          reserveTransport: {
            secretRef: { ...params.mediaReserveTransport.secretRef },
            configured: params.mediaReserveTransport.configured,
            baseUrl: params.mediaReserveTransport.baseUrl
          }
        }
      : {}),
    ...buildMediaModelFallbackPatch(params.imageCredentialRef, params.imageGenerateFallbackModelKey)
  };
}

export function buildImageEditToolCredentialRef(params: {
  imageCredentialRef: AssistantRuntimeBundleToolCredentialRef;
  imageEditModelKey: string | null;
  imageEditFallbackModelKey: string | null;
  mediaReserveTransport?: {
    configured: boolean;
    secretRef: AssistantRuntimeBundleToolCredentialRef["secretRef"];
    baseUrl: string;
  } | null;
}): AssistantRuntimeBundleToolCredentialRef {
  return {
    ...cloneToolCredentialRef(params.imageCredentialRef),
    ...(params.imageEditModelKey !== null ? { modelKey: params.imageEditModelKey } : {}),
    ...(params.mediaReserveTransport
      ? {
          reserveTransport: {
            secretRef: { ...params.mediaReserveTransport.secretRef },
            configured: params.mediaReserveTransport.configured,
            baseUrl: params.mediaReserveTransport.baseUrl
          }
        }
      : {}),
    ...buildMediaModelFallbackPatch(params.imageCredentialRef, params.imageEditFallbackModelKey)
  };
}

export function buildVideoGenerateToolCredentialRef(params: {
  runtimeProviderProfile: RuntimeProviderProfileState;
  keyMetadata: Record<string, { configured: boolean } | undefined>;
  imageCredentialRef: AssistantRuntimeBundleToolCredentialRef;
  videoGenerateModelKey: string | null;
  videoGenerateFallbackModelKey: string | null;
}): AssistantRuntimeBundleToolCredentialRef {
  const primaryRef =
    params.videoGenerateModelKey === null
      ? cloneToolCredentialRef(params.imageCredentialRef)
      : buildVideoProviderToolCredentialRef({
          runtimeProviderProfile: params.runtimeProviderProfile,
          keyMetadata: params.keyMetadata,
          modelKey: params.videoGenerateModelKey
        });
  if (params.videoGenerateFallbackModelKey === null) {
    return primaryRef;
  }
  const fallbackRef = buildVideoProviderToolCredentialRef({
    runtimeProviderProfile: params.runtimeProviderProfile,
    keyMetadata: params.keyMetadata,
    modelKey: params.videoGenerateFallbackModelKey
  });
  return {
    ...primaryRef,
    fallbacks: [fallbackRef]
  };
}

export function resolveTtsModelKeyForProvider(params: {
  runtimeProviderProfile: RuntimeProviderProfileState;
  providerId: PersaiRuntimeTtsProviderId;
}): string | null {
  if (params.runtimeProviderProfile.mode !== "admin_managed" || params.providerId !== "openai") {
    return null;
  }
  const models = getRuntimeProviderCatalogModelsByCapability(
    params.runtimeProviderProfile.availableModelCatalogByProvider.openai,
    "text_to_speech"
  );
  return models[0] ?? null;
}

function buildVideoProviderToolCredentialRef(params: {
  runtimeProviderProfile: RuntimeProviderProfileState;
  keyMetadata: Record<string, { configured: boolean } | undefined>;
  modelKey: string;
}): AssistantRuntimeBundleToolCredentialRef {
  const selection = resolveVideoGenerateProviderSelection({
    runtimeProviderProfile: params.runtimeProviderProfile,
    modelKey: params.modelKey
  });
  const credentialKey = VIDEO_PROVIDER_CREDENTIAL_KEY[selection.providerId];
  const ref = buildToolCredentialSecretRef(credentialKey);
  const profile = findRuntimeProviderCatalogProfile(
    params.runtimeProviderProfile.availableModelCatalogByProvider[selection.providerId],
    selection.modelKey
  );
  return {
    ...ref,
    configured: params.keyMetadata[credentialKey]?.configured ?? false,
    providerId: selection.providerId,
    modelKey: selection.modelKey,
    videoModelParameters: profile?.videoModelParameters ?? null
  };
}

// ADR-109 Slice 10c: separate talking-avatar credential ref key (Fix #3).
export const VIDEO_GENERATE_TALKING_AVATAR_TOOL_KEY = "video_generate_talking_avatar" as const;

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
    @Inject(forwardRef(() => ResolveEffectiveSubscriptionStateService))
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly compilePromptConstructorService: CompilePromptConstructorService,
    private readonly managePersonaArchetypesService: ManagePersonaArchetypesService,
    private readonly klingVoiceCatalogService: KlingVoiceCatalogService,
    private readonly heyGenVoiceCatalogService: HeyGenVoiceCatalogService,
    @Inject(WORKSPACE_VIDEO_PERSONA_REPOSITORY)
    private readonly workspaceVideoPersonaRepository: WorkspaceVideoPersonaRepository
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
    const rawPlanSystemToolModelKey = await this.resolvePlanSystemToolModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planSystemToolModelKey = resolveAllowedPlanModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanSystemToolModelKey
    });
    const rawPlanRetrievalModelKey = await this.resolvePlanRetrievalModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planRetrievalModelKey = resolveAllowedPlanModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanRetrievalModelKey
    });
    const rawPlanImageGenerateModelKey = await this.resolvePlanImageGenerateModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const rawPlanImageGenerateFallbackModelKey =
      await this.resolvePlanImageGenerateFallbackModelKey(
        effectiveCapabilities.derivedFrom.planCode
      );
    const planImageGenerateModelKey = resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanImageGenerateModelKey,
      capability: "image"
    });
    const planImageGenerateFallbackModelKey = resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanImageGenerateFallbackModelKey,
      capability: "image"
    });
    const rawPlanImageEditModelKey = await this.resolvePlanImageEditModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const rawPlanImageEditFallbackModelKey = await this.resolvePlanImageEditFallbackModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planImageEditModelKey = resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanImageEditModelKey,
      capability: "image"
    });
    const planImageEditFallbackModelKey = resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanImageEditFallbackModelKey,
      capability: "image"
    });
    const rawPlanVideoGenerateModelKey = await this.resolvePlanVideoGenerateModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const rawPlanVideoGenerateFallbackModelKey =
      await this.resolvePlanVideoGenerateFallbackModelKey(
        effectiveCapabilities.derivedFrom.planCode
      );
    const planTalkingVideoEnabled = await this.resolvePlanTalkingVideoEnabled(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planMediaCompletionVisionEnabled = await this.resolvePlanMediaCompletionVisionEnabled(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planVideoGenerateModelKey = resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanVideoGenerateModelKey,
      capability: "video"
    });
    const planVideoGenerateFallbackModelKey = resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile,
      planModelKey: rawPlanVideoGenerateFallbackModelKey,
      capability: "video"
    });
    // ADR-109 Slice 10c: talking-avatar model keys (stored in billingProviderHints JSON).
    const planTalkingAvatarModelKey = await this.resolvePlanTalkingAvatarModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    const planTalkingAvatarFallbackModelKey = await this.resolvePlanTalkingAvatarFallbackModelKey(
      effectiveCapabilities.derivedFrom.planCode
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
    if (rawPlanSystemToolModelKey !== null && planSystemToolModelKey === null) {
      this.logger.warn(
        `Skipping stale plan system-tool model "${rawPlanSystemToolModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime provider catalog.`
      );
    }
    if (rawPlanRetrievalModelKey !== null && planRetrievalModelKey === null) {
      this.logger.warn(
        `Skipping stale plan retrieval model "${rawPlanRetrievalModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime provider catalog.`
      );
    }
    if (rawPlanImageGenerateModelKey !== null && planImageGenerateModelKey === null) {
      this.logger.warn(
        `Skipping stale plan image-generate model "${rawPlanImageGenerateModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime image catalog.`
      );
    }
    if (
      rawPlanImageGenerateFallbackModelKey !== null &&
      planImageGenerateFallbackModelKey === null
    ) {
      this.logger.warn(
        `Skipping stale plan image-generate fallback model "${rawPlanImageGenerateFallbackModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime image catalog.`
      );
    }
    if (rawPlanImageEditModelKey !== null && planImageEditModelKey === null) {
      this.logger.warn(
        `Skipping stale plan image-edit model "${rawPlanImageEditModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime image catalog.`
      );
    }
    if (rawPlanImageEditFallbackModelKey !== null && planImageEditFallbackModelKey === null) {
      this.logger.warn(
        `Skipping stale plan image-edit fallback model "${rawPlanImageEditFallbackModelKey}" for assistant ${assistant.id}; it is no longer present in the active runtime image catalog.`
      );
    }
    if (rawPlanVideoGenerateModelKey !== null && planVideoGenerateModelKey === null) {
      throw new Error(
        `Plan video model "${rawPlanVideoGenerateModelKey}" for assistant ${assistant.id} is not present in the active runtime video catalog.`
      );
    }
    if (
      rawPlanVideoGenerateFallbackModelKey !== null &&
      planVideoGenerateFallbackModelKey === null
    ) {
      throw new Error(
        `Plan video fallback model "${rawPlanVideoGenerateFallbackModelKey}" for assistant ${assistant.id} is not present in the active runtime video catalog.`
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
      planSystemToolModelKey,
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
      runtimeProviderProfile,
      voiceProfile,
      imageGenerateModelKey: planImageGenerateModelKey,
      imageGenerateFallbackModelKey: planImageGenerateFallbackModelKey,
      imageEditModelKey: planImageEditModelKey,
      imageEditFallbackModelKey: planImageEditFallbackModelKey,
      videoGenerateModelKey: planVideoGenerateModelKey,
      videoGenerateFallbackModelKey: planVideoGenerateFallbackModelKey,
      talkingAvatarModelKey: planTalkingAvatarModelKey,
      talkingAvatarFallbackModelKey: planTalkingAvatarFallbackModelKey,
      workspaceId: assistant.workspaceId,
      talkingVideoEnabled: planTalkingVideoEnabled
    });
    const documentProviderConfig = await this.resolveDocumentProviderConfig();
    const planToolQuotaPolicy = await this.resolveToolQuotaPolicy(effectivePlanCode);
    const promptTemplateRows = await this.loadPromptTemplateRows();
    const runtimeToolQuotaPolicy = this.resolveRuntimeToolQuotaPolicy(
      toolAvailability.tools,
      planToolQuotaPolicy
    );
    const knowledgeAccess = buildRuntimeKnowledgeAccessConfig();
    const sandboxPolicy = await this.resolvePlanSandboxPolicy(effectivePlanCode);
    const rawToolPolicies = resolveRuntimeToolPolicies({
      tools: toolAvailability.tools,
      planToolQuotaPolicy,
      toolCredentialRefs,
      knowledgeAccessEnabled: knowledgeAccess.sources.length > 0,
      sandboxEnabled: sandboxPolicy.enabled,
      syntheticToolOverrides: buildSyntheticPromptToolOverrideMap(promptTemplateRows)
    });
    // ADR-109 Slice 8: inject `talkingVideoEnabled` from the plan into the
    // `video_generate` tool policy so the runtime gate in Slice 7 fires correctly.
    const toolPolicies = rawToolPolicies.map((p) => {
      if (p.toolCode === "video_generate") {
        return { ...p, talkingVideoEnabled: planTalkingVideoEnabled };
      }
      if (p.toolCode === "image_generate" || p.toolCode === "image_edit") {
        return { ...p, mediaCompletionVisionEnabled: planMediaCompletionVisionEnabled };
      }
      return p;
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
    const planToolBudgets = await this.resolvePlanToolBudgets(effectivePlanCode);
    const hasAnyLoopOverride =
      planToolBudgets.loopLimitByMode.normal !== null ||
      planToolBudgets.loopLimitByMode.premium !== null ||
      planToolBudgets.loopLimitByMode.reasoning !== null;

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
    const voiceDna = await this.resolveVoiceDnaForPublishedVersion(
      publishedVersion,
      userContext.locale
    );
    const enabledSkillCards = await this.resolveEnabledSkillPromptCards({
      assistant,
      effectivePlanCode,
      locale: userContext.locale
    });
    const enabledSkillScenarios = await this.resolveEnabledSkillScenariosForBundle({
      skillIds: enabledSkillCards.map((card) => card.id),
      locale: userContext.locale
    });
    // Inject resolved scenarios into the prompt cards so the catalog renders in the cached prefix.
    const enabledSkillCardsWithScenarios = enabledSkillCards.map((card) => ({
      ...card,
      scenarios: enabledSkillScenarios.get(card.id) ?? []
    }));
    const compiledPromptConstructor = this.compilePromptConstructorService.compile({
      publishedVersion,
      userContext,
      toolPolicies,
      enabledSkillCards: enabledSkillCardsWithScenarios,
      promptTemplates,
      voiceDna
    });
    const onboardingDocuments = {
      soulDocument: compiledPromptConstructor.promptDocuments.soul,
      userDocument: compiledPromptConstructor.promptDocuments.user,
      identityDocument: compiledPromptConstructor.promptDocuments.identity,
      enabledSkillsDocument: compiledPromptConstructor.promptDocuments.enabledSkills ?? "",
      toolsDocument: compiledPromptConstructor.promptDocuments.tools,
      agentsDocument: compiledPromptConstructor.promptDocuments.agents,
      backgroundTaskEvaluationDocument:
        compiledPromptConstructor.promptDocuments.backgroundTaskEvaluation ??
        compiledPromptConstructor.promptDocuments.heartbeat,
      presenceDocument: compiledPromptConstructor.promptDocuments.presence,
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
        browser,
        sandbox: sandboxPolicy,
        ...(hasAnyLoopOverride
          ? {
              toolBudgets: {
                loopLimitByMode: planToolBudgets.loopLimitByMode
              }
            }
          : {})
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
        documentProviderConfig,
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
      skills: {
        enabled: enabledSkillCards.map((card) => ({
          id: card.id,
          name: card.name,
          description: card.description,
          category: card.category,
          tags: card.tags.slice(0, 2),
          iconEmoji: card.iconEmoji,
          body: card.body,
          guardrails: card.guardrails,
          examples: card.examples,
          scenarios: enabledSkillScenarios.get(card.id) ?? []
        }))
      },
      promptDocuments: {
        soul: onboardingDocuments.soulDocument,
        user: onboardingDocuments.userDocument,
        identity: onboardingDocuments.identityDocument,
        enabledSkills: onboardingDocuments.enabledSkillsDocument,
        tools: onboardingDocuments.toolsDocument,
        agents: onboardingDocuments.agentsDocument,
        backgroundTaskEvaluation: onboardingDocuments.backgroundTaskEvaluationDocument,
        heartbeat: onboardingDocuments.backgroundTaskEvaluationDocument,
        presence: onboardingDocuments.presenceDocument ?? "",
        routerClassifier: promptTemplates.router_classifier ?? "",
        skillStateClassifier: promptTemplates.skill_state_classifier ?? "",
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
    runtimeProviderProfile: RuntimeProviderProfileState;
    voiceProfile: AssistantRuntimeBundle["persona"]["voiceProfile"];
    imageGenerateModelKey: string | null;
    imageGenerateFallbackModelKey: string | null;
    imageEditModelKey: string | null;
    imageEditFallbackModelKey: string | null;
    videoGenerateModelKey: string | null;
    videoGenerateFallbackModelKey: string | null;
    talkingAvatarModelKey: string | null;
    talkingAvatarFallbackModelKey: string | null;
    workspaceId: string;
    talkingVideoEnabled: boolean;
  }): Promise<AssistantRuntimeBundle["governance"]["toolCredentialRefs"]> {
    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys(
      ALL_TOOL_CREDENTIAL_KEYS as unknown as string[]
    );
    const refs: AssistantRuntimeBundle["governance"]["toolCredentialRefs"] = {};
    const documentProviderRefs: AssistantRuntimeBundleToolCredentialRef[] = [];
    for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
      const toolCode = TOOL_CODE_BY_CREDENTIAL_KEY[credentialKey];
      if (
        toolCode === "tts" ||
        credentialKey === "tool_video_generate_runway" ||
        credentialKey === "tool_video_generate_kling"
      ) {
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

      const ref: AssistantRuntimeBundleToolCredentialRef = {
        ...secretRef,
        configured: keyMetadata[credentialKey]?.configured ?? false,
        ...(providerId ? { providerId } : {})
      };
      if (toolCode === "document") {
        documentProviderRefs.push(ref);
        continue;
      }
      refs[toolCode] = ref;
    }
    if (documentProviderRefs.length > 0) {
      const [primary, ...fallbacks] = documentProviderRefs;
      if (primary === undefined) {
        throw new Error("Document credential refs are missing a primary provider entry.");
      }
      const documentRef: AssistantRuntimeBundleToolCredentialRef = {
        ...primary
      };
      if (fallbacks.length > 0) {
        documentRef.fallbacks = fallbacks.map((fallback) => this.cloneToolCredentialRef(fallback));
      }
      refs.document = documentRef;
    }
    const imageCredentialRef = refs.image_generate;
    if (imageCredentialRef) {
      const mediaReserveTransport = await this.resolveMaterializedMediaReserveTransport();
      refs.image_generate = buildImageGenerateToolCredentialRef({
        imageCredentialRef,
        imageGenerateModelKey: input.imageGenerateModelKey,
        imageGenerateFallbackModelKey: input.imageGenerateFallbackModelKey,
        mediaReserveTransport
      });
      refs.image_edit = buildImageEditToolCredentialRef({
        imageCredentialRef,
        imageEditModelKey: input.imageEditModelKey,
        imageEditFallbackModelKey: input.imageEditFallbackModelKey,
        mediaReserveTransport
      });
      refs.video_generate = buildVideoGenerateToolCredentialRef({
        runtimeProviderProfile: input.runtimeProviderProfile,
        keyMetadata,
        imageCredentialRef,
        videoGenerateModelKey: input.videoGenerateModelKey,
        videoGenerateFallbackModelKey: input.videoGenerateFallbackModelKey
      });
      // Cinematic video_generate ref: attach Kling voice catalog only (HeyGen voice/persona
      // catalogs now live on the talking-avatar ref — see ADR-109 Slice 10c Fix #3d).
      if (refs.video_generate.providerId !== "heygen") {
        refs.video_generate = await this.attachMaterializedVideoVoiceCatalog(refs.video_generate);
      }
      // ADR-109 Slice 10c Fix #3d: build separate talking-avatar credential ref.
      const talkingAvatarRef = await this.buildTalkingAvatarCredentialRef({
        runtimeProviderProfile: input.runtimeProviderProfile,
        keyMetadata,
        talkingAvatarModelKey: input.talkingAvatarModelKey,
        talkingAvatarFallbackModelKey: input.talkingAvatarFallbackModelKey,
        talkingVideoEnabled: input.talkingVideoEnabled,
        workspaceId: input.workspaceId
      });
      if (talkingAvatarRef !== null) {
        refs[VIDEO_GENERATE_TALKING_AVATAR_TOOL_KEY] = talkingAvatarRef;
      }
    }
    refs.tts = this.buildTtsToolCredentialRef(
      keyMetadata,
      input.runtimeProviderProfile,
      await this.resolveTtsPrimaryProviderId(),
      input.voiceProfile
    );
    return refs;
  }

  private async resolveMaterializedMediaReserveTransport(): Promise<{
    configured: boolean;
    secretRef: AssistantRuntimeBundleToolCredentialRef["secretRef"];
    baseUrl: string;
  } | null> {
    const [enabledRaw, baseUrlRaw, metadata] = await Promise.all([
      this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        MEDIA_RESERVE_CONFIG_KEYS.enabled
      ),
      this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        MEDIA_RESERVE_CONFIG_KEYS.baseUrl
      ),
      this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
        MEDIA_RESERVE_CONFIG_KEYS.apiKey
      ])
    ]);
    if (enabledRaw !== "true") {
      return null;
    }
    return {
      configured: metadata[MEDIA_RESERVE_CONFIG_KEYS.apiKey]?.configured ?? false,
      secretRef: {
        source: "persai",
        provider: "persai-runtime",
        id: MEDIA_RESERVE_CONFIG_KEYS.apiKey
      },
      baseUrl:
        typeof baseUrlRaw === "string" && baseUrlRaw.trim().length > 0
          ? baseUrlRaw.trim()
          : DEFAULT_MEDIA_RESERVE_BASE_URL
    };
  }

  private async attachMaterializedVideoVoiceCatalog(
    ref: AssistantRuntimeBundleToolCredentialRef
  ): Promise<AssistantRuntimeBundleToolCredentialRef> {
    if (ref.providerId === "kling") {
      const catalog = await this.klingVoiceCatalogService.getMaterializedVoiceCatalog();
      if (catalog === null || catalog.shortlist.length === 0) {
        return ref;
      }
      return {
        ...ref,
        videoVoiceCatalog: catalog
      };
    }
    if (ref.providerId === "heygen") {
      const catalog = await this.heyGenVoiceCatalogService.getMaterializedVoiceCatalog();
      if (catalog === null || catalog.shortlist.length === 0) {
        return ref;
      }
      return {
        ...ref,
        videoVoiceCatalog: catalog
      };
    }
    return ref;
  }

  // ADR-109 Slice 10: attach persona shortlist from workspace_video_personas onto the
  // video_generate credential ref so the tool description can render the inline persona table.
  // Gate 1: only fires for HeyGen (provider === "heygen").
  // Gate 2: only fires when talkingVideoEnabled === true (plan toggle).
  // On empty list attaches an empty-personas catalog; when gates fail returns ref unchanged.
  private async attachMaterializedVideoPersonaCatalog(
    ref: AssistantRuntimeBundleToolCredentialRef,
    workspaceId: string,
    talkingVideoEnabled: boolean
  ): Promise<AssistantRuntimeBundleToolCredentialRef> {
    if (ref.providerId !== "heygen") {
      return ref;
    }
    if (talkingVideoEnabled !== true) {
      return ref;
    }
    const rows = await this.workspaceVideoPersonaRepository.listActive(workspaceId);
    const catalog: RuntimeVideoPersonaCatalog = {
      provider: "heygen",
      schema: "persai.runtimeVideoPersonaCatalog.v1",
      personas: rows.map((row) => ({
        personaId: row.id,
        displayName: row.displayName,
        voiceLabel:
          row.linkedClonedVoiceArchived === false &&
          row.linkedClonedVoiceStatus === "ready" &&
          row.linkedClonedVoiceDisplayName !== null
            ? row.linkedClonedVoiceDisplayName
            : row.heygenVoiceLabel,
        presetVoiceLabel: row.heygenVoiceLabel,
        linkedClonedVoiceDisplayName:
          row.linkedClonedVoiceArchived === false && row.linkedClonedVoiceStatus === "ready"
            ? row.linkedClonedVoiceDisplayName
            : null
      }))
    };
    return {
      ...ref,
      videoPersonaCatalog: catalog
    };
  }

  // ADR-109 Slice 10c Fix #3d: build a dedicated talking-avatar credential ref.
  // Returns null when any prerequisite is missing (HeyGen secret unconfigured, toggle off, no rows).
  private async buildTalkingAvatarCredentialRef(input: {
    runtimeProviderProfile: RuntimeProviderProfileState;
    keyMetadata: Record<string, { configured: boolean } | undefined>;
    talkingAvatarModelKey: string | null;
    talkingAvatarFallbackModelKey: string | null;
    talkingVideoEnabled: boolean;
    workspaceId: string;
  }): Promise<AssistantRuntimeBundleToolCredentialRef | null> {
    const heygenCredentialKey = VIDEO_PROVIDER_CREDENTIAL_KEY.heygen;
    if (input.keyMetadata[heygenCredentialKey]?.configured !== true) {
      return null;
    }
    if (input.talkingVideoEnabled !== true) {
      return null;
    }
    const heygenCatalog =
      input.runtimeProviderProfile.availableModelCatalogByProvider.heygen?.models ?? [];
    const activeHeygenRows = heygenCatalog.filter((m) => m.active);
    if (activeHeygenRows.length === 0) {
      return null;
    }
    // Resolve model key: plan setting → first active HeyGen row (Variant C fallback).
    const resolvedModelKey =
      input.talkingAvatarModelKey !== null &&
      activeHeygenRows.some((m) => m.model === input.talkingAvatarModelKey)
        ? input.talkingAvatarModelKey
        : (activeHeygenRows[0]?.model ?? null);
    if (resolvedModelKey === null) {
      return null;
    }
    const secretRef = buildToolCredentialSecretRef(heygenCredentialKey);
    const profile = findRuntimeProviderCatalogProfile(
      input.runtimeProviderProfile.availableModelCatalogByProvider.heygen,
      resolvedModelKey
    );
    let ref: AssistantRuntimeBundleToolCredentialRef = {
      ...secretRef,
      configured: true,
      providerId: "heygen",
      modelKey: resolvedModelKey,
      videoModelParameters: profile?.videoModelParameters ?? null
    };
    // Fallback key (optional).
    if (input.talkingAvatarFallbackModelKey !== null) {
      const fallbackProfile = findRuntimeProviderCatalogProfile(
        input.runtimeProviderProfile.availableModelCatalogByProvider.heygen,
        input.talkingAvatarFallbackModelKey
      );
      ref = {
        ...ref,
        fallbacks: [
          {
            ...secretRef,
            configured: true,
            providerId: "heygen",
            modelKey: input.talkingAvatarFallbackModelKey,
            videoModelParameters: fallbackProfile?.videoModelParameters ?? null
          }
        ]
      };
    }
    // Attach HeyGen voice catalog to the talking-avatar ref.
    const voiceCatalog = await this.heyGenVoiceCatalogService.getMaterializedVoiceCatalog();
    if (voiceCatalog !== null && voiceCatalog.shortlist.length > 0) {
      ref = { ...ref, videoVoiceCatalog: voiceCatalog };
    }
    // Attach workspace persona catalog to the talking-avatar ref.
    ref = await this.attachMaterializedVideoPersonaCatalog(
      ref,
      input.workspaceId,
      input.talkingVideoEnabled
    );
    return ref;
  }

  private async resolveDocumentProviderConfig(): Promise<MaterializedDocumentProviderConfig> {
    const pdfmonkeyTemplateId =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        DOCUMENT_PROVIDER_CONFIG_KEYS.pdfmonkeyTemplateId
      );
    return {
      pdfmonkeyTemplateId:
        pdfmonkeyTemplateId === null || pdfmonkeyTemplateId.trim().length === 0
          ? null
          : pdfmonkeyTemplateId.trim()
    };
  }

  private cloneToolCredentialRef(
    ref: AssistantRuntimeBundle["governance"]["toolCredentialRefs"][string]
  ): AssistantRuntimeBundle["governance"]["toolCredentialRefs"][string] {
    return cloneToolCredentialRef(ref);
  }

  private buildTtsToolCredentialRef(
    keyMetadata: Record<string, { configured: boolean } | undefined>,
    runtimeProviderProfile: RuntimeProviderProfileState,
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
    const primaryModelKey = this.resolveTtsModelKey(runtimeProviderProfile, materializedProviderId);

    return {
      ...primarySecretRef,
      configured: providerChain.length > 0,
      providerId: materializedProviderId,
      ...(primaryModelKey === null ? {} : { modelKey: primaryModelKey }),
      fallbacks: providerChain.slice(1, 2).map((providerId) => {
        const credentialKey = TTS_PROVIDER_TO_CREDENTIAL_KEY[providerId];
        const secretRef = buildToolCredentialSecretRef(credentialKey);
        const modelKey = this.resolveTtsModelKey(runtimeProviderProfile, providerId);
        return {
          ...secretRef,
          configured: true,
          providerId,
          ...(modelKey === null ? {} : { modelKey })
        };
      })
    };
  }

  private resolveTtsModelKey(
    runtimeProviderProfile: RuntimeProviderProfileState,
    providerId: PersaiRuntimeTtsProviderId
  ): string | null {
    return resolveTtsModelKeyForProvider({ runtimeProviderProfile, providerId });
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

  private async resolvePlanSystemToolModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "systemToolModelKey");
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
      | "systemToolModelKey"
      | "retrievalModelKey"
      | "imageGenerateModelKey"
      | "imageGenerateFallbackModelKey"
      | "imageEditModelKey"
      | "imageEditFallbackModelKey"
      | "videoGenerateModelKey"
      | "videoGenerateFallbackModelKey"
      | "talkingAvatarModelKey"
      | "talkingAvatarFallbackModelKey"
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

  private async resolvePlanTalkingAvatarModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "talkingAvatarModelKey");
  }

  private async resolvePlanTalkingAvatarFallbackModelKey(
    planCode: string | null
  ): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "talkingAvatarFallbackModelKey");
  }

  private async resolvePlanImageGenerateModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "imageGenerateModelKey");
  }

  private async resolvePlanImageEditModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "imageEditModelKey");
  }

  private async resolvePlanImageGenerateFallbackModelKey(
    planCode: string | null
  ): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "imageGenerateFallbackModelKey");
  }

  private async resolvePlanImageEditFallbackModelKey(
    planCode: string | null
  ): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "imageEditFallbackModelKey");
  }

  private async resolvePlanVideoGenerateModelKey(planCode: string | null): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "videoGenerateModelKey");
  }

  private async resolvePlanVideoGenerateFallbackModelKey(
    planCode: string | null
  ): Promise<string | null> {
    return this.resolvePlanBillingHintString(planCode, "videoGenerateFallbackModelKey");
  }

  private async resolvePlanTalkingVideoEnabled(planCode: string | null): Promise<boolean> {
    if (planCode === null) {
      return false;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return false;
    }
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) {
      return false;
    }
    return (hints as Record<string, unknown>).talkingVideoEnabled === true;
  }

  private async resolvePlanMediaCompletionVisionEnabled(planCode: string | null): Promise<boolean> {
    if (planCode === null) {
      return false;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return false;
    }
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) {
      return false;
    }
    return (hints as Record<string, unknown>).mediaCompletionVisionEnabled === true;
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

  private async resolvePlanSandboxPolicy(planCode: string | null) {
    if (planCode === null) {
      return resolveStoredPlanSandboxPolicy(null);
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return resolveStoredPlanSandboxPolicy(null);
    }
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) {
      return resolveStoredPlanSandboxPolicy(null);
    }
    const record = hints as Record<string, unknown>;
    return resolveStoredPlanSandboxPolicy(record.sandboxPolicy);
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

  private async resolveToolQuotaPolicy(planCode: string | null): Promise<
    Array<{
      toolCode: string;
      dailyCallLimit: number | null;
      perTurnCap: number | null;
      maxFilePreviewBytes: number | null;
      maxFilePreviewEdgePx: number | null;
      activationStatus: string;
    }>
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
        perTurnCap: true,
        maxFilePreviewBytes: true,
        maxFilePreviewEdgePx: true,
        tool: {
          select: { code: true }
        }
      }
    });
    return activations.map((activation) => ({
      toolCode: activation.tool.code,
      dailyCallLimit: activation.dailyCallLimit,
      perTurnCap: activation.perTurnCap,
      maxFilePreviewBytes: activation.maxFilePreviewBytes,
      maxFilePreviewEdgePx: activation.maxFilePreviewEdgePx,
      activationStatus: activation.activationStatus
    }));
  }

  /**
   * ADR-074 Slice L1 — read per-plan tool-loop iteration limit overrides.
   * Returns NULL leaves when the plan has no override; the runtime then
   * falls back to TOOL_LOOP_LIMIT_BY_MODE code defaults. The whole
   * `runtime.toolBudgets` object is omitted from the bundle when every
   * leaf is NULL (see `buildRuntimeArtifacts`), keeping the bundle JSON
   * compact for the common case.
   */
  private async resolvePlanToolBudgets(planCode: string | null): Promise<{
    loopLimitByMode: { normal: number | null; premium: number | null; reasoning: number | null };
  }> {
    const empty = {
      loopLimitByMode: { normal: null, premium: null, reasoning: null }
    } as const;
    if (planCode === null) return empty;
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) return empty;
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) return empty;
    const record = hints as Record<string, unknown>;
    const raw = record.toolBudgets;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return empty;
    const rawLoop = (raw as Record<string, unknown>).loopLimitByMode;
    if (rawLoop === null || typeof rawLoop !== "object" || Array.isArray(rawLoop)) return empty;
    const loop = rawLoop as Record<string, unknown>;
    const sanitize = (v: unknown): number | null => {
      if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
        return null;
      }
      return v;
    };
    return {
      loopLimitByMode: {
        normal: sanitize(loop.normal),
        premium: sanitize(loop.premium),
        reasoning: sanitize(loop.reasoning)
      }
    };
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

  private async resolveEnabledSkillPromptCards(params: {
    assistant: Assistant;
    effectivePlanCode: string | null;
    locale: string;
  }) {
    const [assignments, limit] = await Promise.all([
      this.prisma.assistantSkillAssignment.findMany({
        where: {
          assistantId: params.assistant.id,
          userId: params.assistant.userId,
          status: "active",
          skill: {
            status: "active"
          }
        },
        include: {
          skill: true
        }
      }),
      this.resolveEnabledSkillLimitForPlan(params.effectivePlanCode)
    ]);
    const candidates: EnabledSkillPromptCandidate[] = assignments.map((assignment) => ({
      id: assignment.skill.id,
      name: normalizeStringRecord(assignment.skill.name),
      description: normalizeStringRecord(assignment.skill.description),
      category: assignment.skill.category,
      tags: normalizeStringArray(assignment.skill.tags),
      displayOrder: assignment.skill.displayOrder,
      status: assignment.skill.status,
      instructionCard: normalizeInstructionCard(assignment.skill.instructionCard),
      iconEmoji: assignment.skill.iconEmoji,
      assignmentStatus: assignment.status,
      assignmentEnabledAt: assignment.enabledAt
    }));
    return resolveEnabledSkillPromptCards({
      candidates,
      locale: params.locale,
      limit
    });
  }

  private async resolveEnabledSkillScenariosForBundle(params: {
    skillIds: string[];
    locale: string;
  }): Promise<
    Map<string, import("@persai/runtime-bundle").AssistantRuntimeEnabledSkillSummary["scenarios"]>
  > {
    if (params.skillIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.skillScenario.findMany({
      where: {
        skillId: { in: params.skillIds },
        status: "active"
      },
      orderBy: [{ skillId: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
    const scenarioCandidates: EnabledSkillScenarioCandidate[] = rows.map((row) => ({
      skillId: row.skillId,
      key: row.key,
      displayName: normalizeStringRecord(row.displayName),
      description: normalizeStringRecord(row.description),
      iconEmoji: row.iconEmoji,
      intentExamples: normalizeStringArray(row.intentExamples),
      steps: normalizeSkillScenarioSteps(row.steps),
      recommendedTools: normalizeStringArray(row.recommendedTools),
      exitCondition: row.exitCondition
    }));
    return resolveEnabledSkillScenariosForBundle({
      candidates: scenarioCandidates,
      locale: params.locale
    });
  }

  private async resolveEnabledSkillLimitForPlan(planCode: string | null): Promise<number | null> {
    if (planCode === null) {
      return null;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: {
        billingProviderHints: true,
        entitlement: {
          select: {
            limitsPermissions: true
          }
        }
      }
    });
    return (
      readEnabledSkillLimitFromBillingHints(plan?.billingProviderHints ?? null) ??
      readEnabledSkillLimitFromLimitsPermissions(plan?.entitlement?.limitsPermissions ?? null)
    );
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

  private async resolveVoiceDnaForPublishedVersion(
    publishedVersion: AssistantPublishedVersion,
    rawLocale: string
  ): Promise<VoiceDnaResolved | null> {
    const archetypeKey = publishedVersion.snapshotArchetypeKey;
    if (archetypeKey === null && publishedVersion.snapshotVoiceDna === null) {
      return null;
    }

    const locale = resolveVoiceDnaLocale(rawLocale);
    let archetype: PersonaArchetype | null = null;
    if (archetypeKey !== null) {
      archetype = await this.managePersonaArchetypesService.findByKey(archetypeKey);
    }
    if (archetype === null && publishedVersion.snapshotVoiceDna !== null) {
      archetype = this.toArchetypeFromSnapshot(publishedVersion.snapshotVoiceDna);
    }
    if (archetype === null) {
      return null;
    }

    return modulateVoiceDna({
      archetype,
      traits: (publishedVersion.snapshotTraits ?? null) as Record<string, number> | null,
      locale
    });
  }

  private toArchetypeFromSnapshot(
    snapshot: AssistantPublishedVersionSnapshotVoiceDna
  ): PersonaArchetype {
    return {
      key: snapshot.key,
      displayOrder: snapshot.displayOrder,
      label: snapshot.label,
      description: snapshot.description,
      voice: snapshot.voice,
      openingsAllowed: snapshot.openingsAllowed,
      openingsForbidden: snapshot.openingsForbidden,
      behaviors: snapshot.behaviors,
      silenceRule: snapshot.silenceRule,
      examples: snapshot.examples,
      defaultTraits: snapshot.defaultTraits as PersonaArchetype["defaultTraits"],
      createdAt: new Date(0),
      updatedAt: new Date(0)
    };
  }

  private toPromptTemplateMap(presets: Array<{ id: string; template: string }>): PromptTemplateMap {
    const map: PromptTemplateMap = {
      system: null,
      soul: null,
      user: null,
      identity: null,
      enabled_skills: null,
      agents: null,
      tools: null,
      heartbeat: null,
      presence: null,
      router_classifier: null,
      skill_state_classifier: null,
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

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === "string") {
      result[key.toLowerCase()] = text;
    }
  }
  return result;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeSkillScenarioSteps(
  value: unknown
): import("@persai/runtime-contract").RuntimeBundleSkillScenarioStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item !== null && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        number: typeof row.number === "number" ? row.number : 0,
        directive: typeof row.directive === "string" ? row.directive : "",
        recommendedToolCall:
          typeof row.recommendedToolCall === "string" ? row.recommendedToolCall : null,
        mayBeSkippedIf: typeof row.mayBeSkippedIf === "string" ? row.mayBeSkippedIf : null,
        negativeGuards: normalizeStringArray(row.negativeGuards)
      };
    });
}

function normalizeInstructionCard(value: unknown): EnabledSkillPromptInstructionCard {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { title: "", body: "", guardrails: [], examples: [], whenToUse: "" };
  }
  const row = value as Record<string, unknown>;
  return {
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    guardrails: normalizeStringArray(row.guardrails),
    examples: normalizeStringArray(row.examples),
    whenToUse: typeof row.whenToUse === "string" ? row.whenToUse : ""
  };
}

function readEnabledSkillLimitFromBillingHints(value: unknown): number | null {
  const row = asRecord(value);
  const skillPolicy = asRecord(row?.skillPolicy ?? null);
  return (
    asNonNegativeInteger(skillPolicy?.maxEnabledSkills) ??
    asNonNegativeInteger(row?.maxEnabledSkills)
  );
}

function readEnabledSkillLimitFromLimitsPermissions(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    const row = asRecord(item);
    if (
      row?.key === "enabled_skills_limit" ||
      row?.key === "max_enabled_skills" ||
      row?.key === "skill_assignments_limit"
    ) {
      const limit = asNonNegativeInteger(row.limit) ?? asNonNegativeInteger(row.value);
      if (limit !== null) {
        return limit;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
