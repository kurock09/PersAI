import { Inject, Injectable } from "@nestjs/common";
import type {
  AssistantRuntimeApplyInput,
  AssistantRuntimeAvatarUploadInput,
  AssistantRuntimeAvatarUploadResult,
  AssistantRuntimeCronControlInput,
  AssistantRuntimeFacade,
  AssistantRuntimeMediaDownloadResult,
  AssistantRuntimePreflightResult,
  AssistantRuntimeSetupPreviewTurnInput,
  AssistantRuntimeSetupPreviewTurnResult,
  AssistantRuntimeWebChatSessionDeleteInput,
  AssistantRuntimeWebChatTurnInput,
  AssistantRuntimeWebChatTurnResult,
  AssistantRuntimeWebChatTurnStreamChunk,
  AssistantRuntimeWorkspaceStorageUsageResult
} from "./assistant-runtime.facade";
import {
  OPENCLAW_RUNTIME_BRIDGE,
  type OpenClawRuntimeBridge
} from "./assistant-runtime-adapter.types";
import type { RuntimeTier } from "./runtime-assignment";

@Injectable()
export class OpenClawAssistantRuntimeFacade implements AssistantRuntimeFacade {
  constructor(
    @Inject(OPENCLAW_RUNTIME_BRIDGE)
    private readonly openClawRuntimeBridge: OpenClawRuntimeBridge
  ) {}

  preflight(runtimeTier?: RuntimeTier): Promise<AssistantRuntimePreflightResult> {
    return this.openClawRuntimeBridge.preflight(runtimeTier);
  }

  applyMaterializedSpec(input: AssistantRuntimeApplyInput): Promise<void> {
    // Keep the legacy OpenClaw payload confined to the facade edge until native execution lands.
    return this.openClawRuntimeBridge.applyMaterializedSpec({
      assistantId: input.assistantId,
      publishedVersionId: input.publishedVersionId,
      contentHash: input.adapterPayload.contentHash,
      openclawBootstrap: input.adapterPayload.assistantConfig,
      openclawWorkspace: input.adapterPayload.assistantWorkspace,
      ...(input.runtimeTier === undefined ? {} : { runtimeTier: input.runtimeTier }),
      reapply: input.reapply
    });
  }

  cleanupWorkspace(assistantId: string): Promise<void> {
    return this.openClawRuntimeBridge.cleanupWorkspace(assistantId);
  }

  consumeBootstrapWorkspace(assistantId: string, runtimeTier?: RuntimeTier): Promise<void> {
    return this.openClawRuntimeBridge.consumeBootstrapWorkspace(assistantId, runtimeTier);
  }

  resetWorkspace(assistantId: string): Promise<void> {
    return this.openClawRuntimeBridge.resetWorkspace(assistantId);
  }

  resetMemoryWorkspace(assistantId: string): Promise<void> {
    return this.openClawRuntimeBridge.resetMemoryWorkspace(assistantId);
  }

  deleteWebChatSession(input: AssistantRuntimeWebChatSessionDeleteInput): Promise<void> {
    return this.openClawRuntimeBridge.deleteWebChatSession(input);
  }

  sendWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult> {
    return this.openClawRuntimeBridge.sendWebChatTurn(input);
  }

  previewSetupTurn(
    input: AssistantRuntimeSetupPreviewTurnInput
  ): Promise<AssistantRuntimeSetupPreviewTurnResult> {
    return this.openClawRuntimeBridge.previewSetupTurn({
      assistantId: input.assistantId,
      userMessage: input.userMessage,
      openclawBootstrap: input.adapterPayload.assistantConfig,
      openclawWorkspace: input.adapterPayload.assistantWorkspace,
      ...(input.runtimeTier === undefined ? {} : { runtimeTier: input.runtimeTier }),
      ...(input.userTimezone === undefined ? {} : { userTimezone: input.userTimezone }),
      ...(input.currentTimeIso === undefined ? {} : { currentTimeIso: input.currentTimeIso })
    });
  }

  streamWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk> {
    return this.openClawRuntimeBridge.streamWebChatTurn(input);
  }

  controlCronJob(input: AssistantRuntimeCronControlInput): Promise<unknown> {
    return this.openClawRuntimeBridge.controlCronJob(input);
  }

  downloadChatMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeMediaDownloadResult | null> {
    return this.openClawRuntimeBridge.downloadChatMedia(assistantId, storagePath, runtimeTier);
  }

  listMemoryItems(assistantId: string, runtimeTier?: RuntimeTier): Promise<unknown> {
    return this.openClawRuntimeBridge.listMemoryItems(assistantId, runtimeTier);
  }

  addMemoryItem(assistantId: string, content: string, runtimeTier?: RuntimeTier): Promise<unknown> {
    return this.openClawRuntimeBridge.addMemoryItem(assistantId, content, runtimeTier);
  }

  editMemoryItem(
    assistantId: string,
    itemId: string,
    content: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown> {
    return this.openClawRuntimeBridge.editMemoryItem(assistantId, itemId, content, runtimeTier);
  }

  forgetMemoryItem(
    assistantId: string,
    itemId: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown> {
    return this.openClawRuntimeBridge.forgetMemoryItem(assistantId, itemId, runtimeTier);
  }

  searchMemory(assistantId: string, query: string, runtimeTier?: RuntimeTier): Promise<unknown> {
    return this.openClawRuntimeBridge.searchMemory(assistantId, query, runtimeTier);
  }

  getWorkspaceStorageUsage(
    assistantId: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeWorkspaceStorageUsageResult> {
    return this.openClawRuntimeBridge.getWorkspaceStorageUsage(assistantId, runtimeTier);
  }

  uploadWorkspaceAvatar(
    input: AssistantRuntimeAvatarUploadInput
  ): Promise<AssistantRuntimeAvatarUploadResult> {
    return this.openClawRuntimeBridge.uploadWorkspaceAvatar(input);
  }

  downloadWorkspaceAvatar(
    assistantId: string
  ): Promise<AssistantRuntimeMediaDownloadResult | null> {
    return this.openClawRuntimeBridge.downloadWorkspaceAvatar(assistantId);
  }
}
