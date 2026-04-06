import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../../platform-core/application/platform-http-metrics.service";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "../assistant-runtime-adapter.types";
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
  inferMimeFromUrlAndType,
  type DeliveredMedia,
  type MediaArtifact,
  type OutboundMediaDeliverParams
} from "./media.types";
import { ResolveAssistantRuntimeTierService } from "../resolve-assistant-runtime-tier.service";
import { validatePersaiMediaFile } from "./media-security-policy";

@Injectable()
export class MediaDeliveryService {
  private readonly logger = new Logger(MediaDeliveryService.name);
  private readonly adapterMap: Map<string, ChannelMediaAdapter>;

  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(CHANNEL_MEDIA_ADAPTERS)
    adapters: ChannelMediaAdapter[],
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
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
        this.logger.warn(`Failed to deliver media artifact "${artifact.url}": ${String(err)}`);
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
    const downloadResult = await this.runtimeAdapter.downloadChatMedia(
      params.assistantId,
      artifact.url,
      runtimeTier
    );
    if (!downloadResult) {
      throw new Error(`Media file not found on storage: ${artifact.url}`);
    }

    const candidateMimeType =
      downloadResult.contentType !== "application/octet-stream"
        ? downloadResult.contentType
        : inferMimeFromUrlAndType(artifact.url, artifact.type);
    const validated = await validatePersaiMediaFile({
      buffer: downloadResult.buffer,
      mimeType: candidateMimeType,
      originalFilename: artifact.url.split("/").pop() ?? "media",
      surface: "tool_output_persist"
    });
    const uploadResult = await this.runtimeAdapter.uploadChatMedia({
      assistantId: params.assistantId,
      runtimeTier,
      chatId: params.chatId,
      messageId: params.messageId,
      fileBuffer: downloadResult.buffer,
      mimeType: validated.effectiveMimeType
    });

    const attachmentType = artifact.audioAsVoice ? "voice" : artifact.type;
    const filename = validated.originalFilename ?? artifact.url.split("/").pop() ?? "media";

    const attachment = await this.attachmentRepository.create({
      messageId: params.messageId,
      chatId: params.chatId,
      assistantId: params.assistantId,
      workspaceId: params.workspaceId,
      attachmentType,
      storagePath: uploadResult.storagePath,
      originalFilename: filename,
      mimeType: validated.effectiveMimeType,
      sizeBytes: BigInt(uploadResult.sizeBytes),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
      transcription: null,
      metadata: { source: "tool_output", originalUrl: artifact.url }
    });

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
