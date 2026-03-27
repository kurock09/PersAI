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

export interface AssistantChannelSurfaceBindingRepository {
  findByAssistantProviderSurface(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType
  ): Promise<AssistantChannelSurfaceBinding | null>;
  upsert(input: UpsertAssistantChannelSurfaceBindingInput): Promise<AssistantChannelSurfaceBinding>;
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
