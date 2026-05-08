import type {
  AssistantChannelSurfaceBinding,
  AssistantIntegrationProviderKey,
  AssistantIntegrationSurfaceType
} from "./assistant-channel-surface-binding.entity";

export const ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY = Symbol(
  "ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY"
);

export interface UpsertAssistantChannelSurfaceBindingInput {
  assistantId: string;
  providerKey: AssistantIntegrationProviderKey;
  surfaceType: AssistantIntegrationSurfaceType;
  bindingState: "active" | "inactive" | "unconfigured";
  tokenFingerprint: string | null;
  tokenLastFour: string | null;
  policy: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}

export type CompletedWebTurnReplayState = {
  clientTurnId: string;
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  followUpAssistantMessageId?: string | null;
  respondedAt: string;
  degradedByQuotaFallback: boolean;
  quotaFallbackReason: string | null;
  quotaFallbackModel: string | null;
  turnRouting?: {
    mode: "shadow" | "active";
    executionMode: "normal" | "premium" | "reasoning";
    source: "precheck" | "llm" | "fallback";
  } | null;
  completedAt: string;
};

export type CompletedReminderReplayState = {
  replayKey: string;
  deliveredTo: "telegram" | "web" | "fallback_web" | "none";
  completedAt: string;
};

export interface AssistantChannelSurfaceBindingRepository {
  findByAssistantProviderSurface(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType
  ): Promise<AssistantChannelSurfaceBinding | null>;
  upsert(input: UpsertAssistantChannelSurfaceBindingInput): Promise<AssistantChannelSurfaceBinding>;
  claimTelegramUpdateProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    updateId: number,
    claimedAt: Date,
    staleAfterMs: number
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight" | "missing_binding">;
  completeTelegramUpdateProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    updateId: number,
    completedAt: Date
  ): Promise<void>;
  releaseTelegramUpdateProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    updateId: number
  ): Promise<void>;
  claimWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    clientTurnId: string,
    claimedAt: Date,
    staleAfterMs: number
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight">;
  getCompletedWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    clientTurnId: string
  ): Promise<CompletedWebTurnReplayState | null>;
  completeWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    state: CompletedWebTurnReplayState
  ): Promise<void>;
  releaseWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    clientTurnId: string
  ): Promise<void>;
  claimReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    replayKey: string,
    claimedAt: Date,
    staleAfterMs: number
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight">;
  getCompletedReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    replayKey: string
  ): Promise<CompletedReminderReplayState | null>;
  completeReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    state: CompletedReminderReplayState
  ): Promise<void>;
  releaseReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    replayKey: string
  ): Promise<void>;
  patchMetadata(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    patch: Record<string, unknown>
  ): Promise<void>;
  hasActiveBindingForProvider(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey
  ): Promise<boolean>;
}
