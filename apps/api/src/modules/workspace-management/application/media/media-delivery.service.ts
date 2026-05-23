import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../../platform-core/application/platform-http-metrics.service";
import {
  describeRuntimeMediaArtifact,
  readRuntimeMediaArtifactFilename
} from "../assistant-runtime.facade";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../../domain/assistant-chat-message-attachment.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../../domain/assistant.repository";
import type { Assistant } from "../../domain/assistant.entity";
import type { WorkspaceMonthlyToolQuotaToolCode } from "../../domain/workspace-quota-accounting.repository";
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
import { validatePersaiMediaFile } from "./media-security-policy";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { downloadRuntimeMediaUrl } from "./runtime-media-download";
import { AssistantFileRegistryService } from "../assistant-file-registry.service";
import { AssistantUploadMicroDescriptionJobService } from "../assistant-upload-micro-description-job.service";
import { TrackWorkspaceQuotaUsageService } from "../track-workspace-quota-usage.service";
import {
  RecordModelCostLedgerService,
  type ModelCostLedgerSurface
} from "../record-model-cost-ledger.service";
import type { MediaChannel } from "./media.types";

@Injectable()
export class MediaDeliveryService {
  private readonly logger = new Logger(MediaDeliveryService.name);
  private readonly adapterMap: Map<string, ChannelMediaAdapter>;

  constructor(
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(CHANNEL_MEDIA_ADAPTERS)
    adapters: ChannelMediaAdapter[],
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly assistantFileRegistryService: AssistantFileRegistryService,
    private readonly assistantUploadMicroDescriptionJobService: AssistantUploadMicroDescriptionJobService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService
  ) {
    this.adapterMap = new Map(adapters.map((a) => [a.channel, a]));
  }

  private resolveLedgerSurface(channel: MediaChannel): ModelCostLedgerSurface | null {
    return channel === "web" || channel === "telegram" ? channel : null;
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
    const assistant = await this.assistantRepository.findById(params.assistantId);

    for (const artifact of params.artifacts) {
      const startedAt = process.hrtime.bigint();
      let outcome: "success" | "failure" = "failure";
      const monthlyQuotaToolCode = this.resolveMonthlyMediaQuotaToolCode(artifact);
      try {
        const persisted = await this.persistArtifact(artifact, params);

        if (adapter && params.channelTarget) {
          await this.sendViaAdapter(
            adapter,
            params.channelTarget,
            artifact,
            persisted.buffer,
            persisted.filename
          );
        }

        results.push(persisted.state);
        await this.settleMonthlyMediaQuotaBestEffort({
          assistant,
          toolCode: monthlyQuotaToolCode
        });
        outcome = "success";
      } catch (err) {
        await this.markMonthlyMediaQuotaReconciliationBestEffort({
          assistant,
          toolCode: monthlyQuotaToolCode
        });
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

  async markUndeliveredArtifactsReconciliationRequired(params: {
    assistantId: string;
    artifacts: MediaArtifact[];
    reason: string;
  }): Promise<void> {
    if (params.artifacts.length === 0) {
      return;
    }
    const assistant = await this.assistantRepository.findById(params.assistantId);
    if (assistant === null) {
      this.logger.warn(
        `Cannot reconcile undelivered media reservations for missing assistant ${params.assistantId}.`
      );
      return;
    }

    const unitsByToolCode = new Map<WorkspaceMonthlyToolQuotaToolCode, number>();
    for (const artifact of params.artifacts) {
      const toolCode = this.resolveMonthlyMediaQuotaToolCode(artifact);
      if (toolCode === null) {
        continue;
      }
      unitsByToolCode.set(toolCode, (unitsByToolCode.get(toolCode) ?? 0) + 1);
    }

    for (const [toolCode, units] of unitsByToolCode) {
      try {
        await this.trackWorkspaceQuotaUsageService.markAssistantMonthlyMediaQuotaReconciliationRequired(
          {
            assistant,
            toolCode,
            units
          }
        );
      } catch (error) {
        this.logger.warn(
          `Failed to reconcile undelivered monthly media quota for ${toolCode} (${params.reason}): ${String(
            error
          )}`
        );
      }
    }
  }

  async settleUserStoppedArtifacts(params: {
    assistantId: string;
    artifacts: MediaArtifact[];
    reason: string;
  }): Promise<void> {
    if (params.artifacts.length === 0) {
      return;
    }
    const assistant = await this.assistantRepository.findById(params.assistantId);
    if (assistant === null) {
      this.logger.warn(
        `Cannot settle user-stopped media reservations for missing assistant ${params.assistantId}.`
      );
      return;
    }

    const unitsByToolCode = new Map<WorkspaceMonthlyToolQuotaToolCode, number>();
    for (const artifact of params.artifacts) {
      const toolCode = this.resolveMonthlyMediaQuotaToolCode(artifact);
      if (toolCode === null) {
        continue;
      }
      unitsByToolCode.set(toolCode, (unitsByToolCode.get(toolCode) ?? 0) + 1);
    }

    for (const [toolCode, units] of unitsByToolCode) {
      try {
        await this.trackWorkspaceQuotaUsageService.settleAssistantMonthlyMediaQuota({
          assistant,
          toolCode,
          units
        });
      } catch (error) {
        this.logger.warn(
          `Failed to settle user-stopped monthly media quota for ${toolCode} (${params.reason}): ${String(
            error
          )}`
        );
      }
    }
  }

  private resolveMonthlyMediaQuotaToolCode(
    artifact: MediaArtifact
  ): WorkspaceMonthlyToolQuotaToolCode | null {
    if (
      artifact.sourceToolCode === "image_generate" ||
      artifact.sourceToolCode === "image_edit" ||
      artifact.sourceToolCode === "video_generate"
    ) {
      return artifact.sourceToolCode;
    }
    return null;
  }

  private async settleMonthlyMediaQuotaBestEffort(params: {
    assistant: Assistant | null;
    toolCode: WorkspaceMonthlyToolQuotaToolCode | null;
  }): Promise<void> {
    if (params.assistant === null || params.toolCode === null) {
      return;
    }
    try {
      await this.trackWorkspaceQuotaUsageService.settleAssistantMonthlyMediaQuota({
        assistant: params.assistant,
        toolCode: params.toolCode,
        units: 1
      });
    } catch (error) {
      this.logger.warn(
        `Failed to settle monthly media quota for ${params.toolCode}: ${String(error)}`
      );
    }
  }

  private async markMonthlyMediaQuotaReconciliationBestEffort(params: {
    assistant: Assistant | null;
    toolCode: WorkspaceMonthlyToolQuotaToolCode | null;
  }): Promise<void> {
    if (params.assistant === null || params.toolCode === null) {
      return;
    }
    try {
      await this.trackWorkspaceQuotaUsageService.markAssistantMonthlyMediaQuotaReconciliationRequired(
        {
          assistant: params.assistant,
          toolCode: params.toolCode,
          units: 1
        }
      );
    } catch (error) {
      this.logger.warn(
        `Failed to mark monthly media quota reconciliation for ${params.toolCode}: ${String(error)}`
      );
    }
  }

  private async persistArtifact(
    artifact: MediaArtifact,
    params: OutboundMediaDeliverParams
  ): Promise<{
    state: AssistantWebChatMessageAttachmentState;
    buffer: Buffer;
    filename: string;
  }> {
    const downloadResult = await this.downloadArtifactSource(artifact);
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
    const uploadResult =
      artifact.source === "persai_object_storage" && typeof artifact.fileRef === "string"
        ? {
            objectKey: artifact.objectKey,
            sizeBytes: downloadResult.buffer.length,
            mimeType: validated.effectiveMimeType
          }
        : await this.mediaObjectStorage.saveObject({
            objectKey: this.mediaObjectStorage.buildChatMessageObjectKey({
              assistantId: params.assistantId,
              chatId: params.chatId,
              messageId: params.messageId,
              extension: validated.normalizedExtension
            }),
            buffer: downloadResult.buffer,
            mimeType: validated.effectiveMimeType
          });

    const attachmentType = artifact.audioAsVoice ? "voice" : artifact.type;
    const filename = validated.originalFilename ?? sourceFilename;
    const persistedBillingFacts =
      artifact.sourceToolCode === "tts" ? (artifact.billingFacts ?? null) : null;

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
      billingFacts: persistedBillingFacts,
      metadata: buildStoredAttachmentMetadata({
        source: "tool_output",
        ...(artifact.source === "runtime_url" ? { originalUrl: artifact.url } : {})
      })
    });
    if (persistedBillingFacts !== null) {
      const ledgerSurface = this.resolveLedgerSurface(params.channel);
      if (ledgerSurface !== null) {
        const assistant = await this.assistantRepository.findById(params.assistantId);
        if (assistant !== null) {
          try {
            await this.recordModelCostLedgerService.recordPersistedBillingFactsEvent({
              workspaceId: params.workspaceId,
              assistantId: params.assistantId,
              userId: assistant.userId,
              surface: ledgerSurface,
              source: "attachment_tts_deliver",
              sourceEventId: `attachment:${attachment.id}`,
              billingFacts: persistedBillingFacts
            });
          } catch (error) {
            this.logger.warn(
              `attachment_tts_ledger_append_failed attachmentId=${attachment.id} message=${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    }

    if (artifact.source === "persai_object_storage" && typeof artifact.fileRef === "string") {
      await this.assistantFileRegistryService.linkAttachmentToExistingFile({
        assistantId: attachment.assistantId,
        workspaceId: attachment.workspaceId,
        sourceAttachmentId: attachment.id,
        fileRef: artifact.fileRef
      });
      attachment.assistantFileId = artifact.fileRef;
    } else {
      attachment.assistantFileId = (
        await this.assistantFileRegistryService.ensureAttachmentFile({
          assistantId: attachment.assistantId,
          workspaceId: attachment.workspaceId,
          origin: "runtime_output",
          sourceAttachmentId: attachment.id,
          sourceMessageId: attachment.messageId,
          sourceChatId: attachment.chatId,
          objectKey: uploadResult.objectKey,
          filename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          contentBuffer: downloadResult.buffer,
          source: "tool_output"
        })
      ).fileRef;
    }
    if (
      artifact.source === "persai_object_storage" &&
      typeof artifact.fileRef !== "string" &&
      artifact.objectKey !== uploadResult.objectKey &&
      this.isEphemeralRuntimeOutputObjectKey(artifact.objectKey)
    ) {
      await this.mediaObjectStorage.deleteObject(artifact.objectKey);
    }
    if (artifact.source === "persai_object_storage") {
      await this.assistantUploadMicroDescriptionJobService.enqueueGeneratedFileIfNeeded({
        assistantId: attachment.assistantId,
        workspaceId: attachment.workspaceId,
        assistantFileId: attachment.assistantFileId,
        attachmentId: attachment.id
      });
    }

    return {
      state: {
        id: attachment.id,
        fileRef: attachment.assistantFileId,
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
    artifact: MediaArtifact
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (artifact.source === "persai_object_storage") {
      return this.mediaObjectStorage.downloadObject(artifact.objectKey);
    }
    return (
      (await downloadRuntimeMediaUrl(artifact.url)) ??
      this.mediaObjectStorage.downloadObject(artifact.url)
    );
  }

  private async sendViaAdapter(
    adapter: ChannelMediaAdapter,
    target: OutboundMediaDeliverParams["channelTarget"],
    artifact: MediaArtifact,
    buffer: Buffer,
    filename: string
  ): Promise<void> {
    if (!target) {
      return;
    }

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

  private isEphemeralRuntimeOutputObjectKey(objectKey: string): boolean {
    const normalized = objectKey.trim();
    if (normalized.length === 0) {
      return false;
    }

    return (
      normalized.startsWith("runtime-output/") ||
      normalized.startsWith("assistant-media/runtime-output/") ||
      normalized.includes("/runtime-output/")
    );
  }
}
