import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../../platform-core/application/platform-http-metrics.service";
import {
  ASSISTANT_RUNTIME_FACADE,
  describeRuntimeMediaArtifact,
  readRuntimeMediaArtifactFilename,
  type AssistantRuntimeFacade
} from "../assistant-runtime.facade";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../../domain/assistant-chat-message-attachment.repository";
import type { AssistantWebChatMessageAttachmentState } from "../web-chat.types";
import {
  CHANNEL_MEDIA_ADAPTERS,
  type ChannelMediaAdapter
} from "./channel-adapters/channel-media-adapter.interface";
import {
  buildStoredAttachmentMetadata,
  inferMimeFromUrlAndType,
  type DeliveredMedia,
  type MediaArtifact,
  type OutboundMediaDeliverParams
} from "./media.types";
import { ResolveAssistantRuntimeTierService } from "../resolve-assistant-runtime-tier.service";
import { validatePersaiMediaFile } from "./media-security-policy";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

@Injectable()
export class MediaDeliveryService {
  private readonly logger = new Logger(MediaDeliveryService.name);
  private readonly adapterMap: Map<string, ChannelMediaAdapter>;

  constructor(
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(CHANNEL_MEDIA_ADAPTERS)
    adapters: ChannelMediaAdapter[],
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService
  ) {
    this.adapterMap = new Map(adapters.map((a) => [a.channel, a]));
  }

  async deliver(params: OutboundMediaDeliverParams): Promise<DeliveredMedia> {
    if (params.artifacts.length === 0) {
      return { attachments: [] };
    }

    const adapter = this.adapterMap.get(params.channel);
    if (!adapter) {
      this.logger.warn(`No media adapter for channel "${params.channel}", persisting only.`);
    }

    const results: AssistantWebChatMessageAttachmentState[] = [];

    for (const artifact of params.artifacts) {
      const startedAt = process.hrtime.bigint();
      let outcome: "success" | "failure" = "failure";
      try {
        const persisted = await this.persistArtifact(artifact, params);

        if (adapter && params.channelTarget) {
          await this.sendViaAdapter(adapter, artifact, persisted.buffer, persisted.filename);
        }

        results.push(persisted.state);
        outcome = "success";
      } catch (err) {
        this.logger.warn(
          `Failed to deliver media artifact "${describeRuntimeMediaArtifact(artifact)}": ${String(err)}`
        );
      } finally {
        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        this.platformHttpMetricsService.recordMediaStage({
          stage: "delivery_persist",
          channel: params.channel,
          outcome,
          latencyMs: Number(latencyMs.toFixed(2))
        });
      }
    }

    return { attachments: results };
  }

  private async persistArtifact(
    artifact: MediaArtifact,
    params: OutboundMediaDeliverParams
  ): Promise<{
    state: AssistantWebChatMessageAttachmentState;
    buffer: Buffer;
    filename: string;
  }> {
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      params.assistantId
    );
    const downloadResult = await this.downloadArtifactSource(
      artifact,
      params.assistantId,
      runtimeTier
    );
    if (!downloadResult) {
      throw new Error(`Media file not found on storage: ${describeRuntimeMediaArtifact(artifact)}`);
    }

    const candidateMimeType =
      artifact.source === "persai_object_storage" && artifact.mimeType.trim().length > 0
        ? artifact.mimeType
        : downloadResult.contentType !== "application/octet-stream"
          ? downloadResult.contentType
          : inferMimeFromUrlAndType(
              artifact.source === "runtime_url" ? artifact.url : artifact.objectKey,
              artifact.type
            );
    const sourceFilename = readRuntimeMediaArtifactFilename(artifact) ?? "media";
    const validated = await validatePersaiMediaFile({
      buffer: downloadResult.buffer,
      mimeType: candidateMimeType,
      originalFilename: sourceFilename,
      surface: "tool_output_persist"
    });
    const objectKey = this.mediaObjectStorage.buildChatMessageObjectKey({
      assistantId: params.assistantId,
      chatId: params.chatId,
      messageId: params.messageId,
      extension: validated.normalizedExtension
    });
    const uploadResult = await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer: downloadResult.buffer,
      mimeType: validated.effectiveMimeType
    });

    const attachmentType = artifact.audioAsVoice ? "voice" : artifact.type;
    const filename = validated.originalFilename ?? sourceFilename;

    const attachment = await this.attachmentRepository.create({
      messageId: params.messageId,
      chatId: params.chatId,
      assistantId: params.assistantId,
      workspaceId: params.workspaceId,
      attachmentType,
      storagePath: uploadResult.objectKey,
      originalFilename: filename,
      mimeType: validated.effectiveMimeType,
      sizeBytes: BigInt(uploadResult.sizeBytes),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
      transcription: null,
      metadata: buildStoredAttachmentMetadata({
        source: "tool_output",
        ...(artifact.source === "runtime_url" ? { originalUrl: artifact.url } : {})
      })
    });
    if (
      artifact.source === "persai_object_storage" &&
      artifact.objectKey !== uploadResult.objectKey
    ) {
      await this.mediaObjectStorage.deleteObject(artifact.objectKey);
    }

    return {
      state: {
        id: attachment.id,
        attachmentType: attachment.attachmentType,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        sizeBytes: Number(attachment.sizeBytes),
        processingStatus: attachment.processingStatus,
        createdAt: attachment.createdAt.toISOString()
      },
      buffer: downloadResult.buffer,
      filename
    };
  }

  private async downloadArtifactSource(
    artifact: MediaArtifact,
    assistantId: string,
    runtimeTier: Awaited<ReturnType<ResolveAssistantRuntimeTierService["resolveByAssistantId"]>>
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (artifact.source === "persai_object_storage") {
      return this.mediaObjectStorage.downloadObject(artifact.objectKey);
    }
    return this.assistantRuntime.downloadChatMedia(assistantId, artifact.url, runtimeTier);
  }

  private async sendViaAdapter(
    adapter: ChannelMediaAdapter,
    artifact: MediaArtifact,
    buffer: Buffer,
    filename: string
  ): Promise<void> {
    const target = { channel: adapter.channel, chatId: "", threadId: "" };

    switch (artifact.type) {
      case "image":
        await adapter.sendImage(target, buffer, filename, artifact.caption);
        break;
      case "audio":
        if (artifact.audioAsVoice) {
          await adapter.sendVoice(target, buffer, filename);
        } else {
          await adapter.sendAudio(target, buffer, filename, artifact.caption);
        }
        break;
      case "video":
        await adapter.sendVideo(target, buffer, filename, artifact.caption);
        break;
      case "document":
        await adapter.sendDocument(target, buffer, filename, artifact.caption);
        break;
    }
  }
}
