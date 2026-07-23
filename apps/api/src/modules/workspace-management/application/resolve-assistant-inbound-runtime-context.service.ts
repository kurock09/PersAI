import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { Assistant } from "../domain/assistant.entity";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import {
  readRuntimeAssignmentStateFromMaterializedLayers,
  type RuntimeTier
} from "./runtime-assignment";
import type { RuntimeProviderRoutingState } from "./runtime-provider-routing.types";
import { normalizeModelKey } from "./model-key-normalization";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

type RuntimeModelOverride = {
  provider: "openai" | "anthropic" | "deepseek" | "kimi";
  model: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseRuntimeModelOverrideFromRuntimeBundle(
  runtimeBundle: unknown,
  trigger: "cost_driving_restricted"
): RuntimeModelOverride | null {
  const root = asObject(runtimeBundle);
  const runtime = asObject(root?.runtime);
  const routing = runtime?.runtimeProviderRouting as RuntimeProviderRoutingState | undefined;
  const target = routing?.fallbackMatrix.find((item) => item.trigger === trigger);
  if (!target?.eligible) {
    return null;
  }
  if (target.target.providerKey !== "openai" && target.target.providerKey !== "anthropic") {
    return null;
  }
  if (typeof target.target.modelKey !== "string" || target.target.modelKey.trim().length === 0) {
    return null;
  }
  return {
    provider: target.target.providerKey,
    model: normalizeModelKey(target.target.modelKey)
  };
}

function parseWelcomeFirstTurnPromptFromRuntimeBundle(runtimeBundle: unknown): string | null {
  const root = asObject(runtimeBundle);
  const promptConstructor = asObject(root?.promptConstructor);
  const onboarding = asObject(promptConstructor?.onboarding);
  const welcomeTurnPrompt = onboarding?.welcomeTurnPrompt;
  if (typeof welcomeTurnPrompt === "string" && welcomeTurnPrompt.trim().length > 0) {
    return welcomeTurnPrompt.trim();
  }
  const legacyFirstTurnPrompt = onboarding?.firstTurnPrompt;
  if (typeof legacyFirstTurnPrompt === "string" && legacyFirstTurnPrompt.trim().length > 0) {
    return legacyFirstTurnPrompt.trim();
  }
  const promptDocuments = asObject(root?.promptDocuments);
  const welcomeDocument = promptDocuments?.welcome;
  if (typeof welcomeDocument === "string" && welcomeDocument.trim().length > 0) {
    return welcomeDocument.trim();
  }
  const legacyBootstrapDocument = promptDocuments?.bootstrap;
  return typeof legacyBootstrapDocument === "string" && legacyBootstrapDocument.trim().length > 0
    ? legacyBootstrapDocument.trim()
    : null;
}

export interface ResolvedAssistantInboundRuntimeContext {
  assistant: Assistant;
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  quotaDegradeModelOverride: RuntimeModelOverride | null;
  welcomeFirstTurnPrompt: string | null;
  userId: string;
  workspaceId: string;
}

@Injectable()
export class ResolveAssistantInboundRuntimeContextService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  async resolveByUserId(userId: string): Promise<ResolvedAssistantInboundRuntimeContext> {
    const resolved = await this.resolveActiveAssistantService.execute({ userId });
    return this.resolveFromAssistant(resolved.assistant);
  }

  async resolveByAssistantId(assistantId: string): Promise<ResolvedAssistantInboundRuntimeContext> {
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return this.resolveFromAssistant(assistant);
  }

  private async resolveFromAssistant(
    assistant: Assistant
  ): Promise<ResolvedAssistantInboundRuntimeContext> {
    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
    if (latestPublishedVersion === null) {
      throw createAssistantInboundConflict(
        "assistant_not_live",
        "Assistant transport is unavailable until at least one version is published."
      );
    }

    if (
      assistant.applyStatus !== "succeeded" ||
      assistant.applyAppliedVersionId !== latestPublishedVersion.id
    ) {
      throw createAssistantInboundConflict(
        "assistant_not_live",
        "Assistant transport requires the latest published version to be successfully applied."
      );
    }

    const freshness = await this.ensureAssistantMaterializedSpecCurrentService.resolveFreshness(
      assistant,
      latestPublishedVersion,
      { mode: "rollout_aware" }
    );
    if (freshness.activationBlock !== null) {
      throw createAssistantInboundConflict(
        freshness.activationBlock.reason === "hard_rollout_failed"
          ? "assistant_activation_failed"
          : "assistant_activating",
        freshness.activationBlock.reason === "hard_rollout_failed"
          ? "Assistant settings activation failed. Retry the rollout from Admin > Rollouts before accepting new turns."
          : "Assistant settings are still activating. Please wait a moment and try again.",
        {
          rolloutId: freshness.activationBlock.rolloutId,
          rolloutStatus: freshness.activationBlock.rolloutStatus,
          itemStatus: freshness.activationBlock.itemStatus,
          targetGeneration: freshness.activationBlock.targetGeneration
        }
      );
    }
    const materializedSpec = freshness.materializedSpec;
    const runtimeAssignment = readRuntimeAssignmentStateFromMaterializedLayers(
      materializedSpec?.layers ?? null
    );

    return {
      assistant,
      assistantId: assistant.id,
      publishedVersionId: latestPublishedVersion.id,
      runtimeTier: runtimeAssignment?.effectiveTier ?? "free_shared_restricted",
      quotaDegradeModelOverride: parseRuntimeModelOverrideFromRuntimeBundle(
        materializedSpec?.runtimeBundle ?? null,
        "cost_driving_restricted"
      ),
      welcomeFirstTurnPrompt: parseWelcomeFirstTurnPromptFromRuntimeBundle(
        materializedSpec?.runtimeBundle ?? null
      ),
      userId: assistant.userId,
      workspaceId: assistant.workspaceId
    };
  }
}
