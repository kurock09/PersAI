import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeBillingFacts } from "@persai/runtime-contract";
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
import {
  WORKSPACE_VCOIN_BALANCE_REPOSITORY,
  type WorkspaceVcoinBalanceRepository
} from "../../domain/workspace-vcoin-balance.repository";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
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
import {
  MAX_TOOL_OUTPUT_PRESENTATION_FILE_BYTES,
  validatePersaiMediaFile
} from "./media-security-policy";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { downloadRuntimeMediaUrl } from "./runtime-media-download";
import { AssistantFileRegistryService } from "../assistant-file-registry.service";
import { AssistantUploadMicroDescriptionJobService } from "../assistant-upload-micro-description-job.service";
import { TrackWorkspaceQuotaUsageService } from "../track-workspace-quota-usage.service";
import {
  RecordModelCostLedgerService,
  type ModelCostLedgerSurface
} from "../record-model-cost-ledger.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "../resolve-platform-runtime-provider-settings.service";
import {
  findRuntimeProviderCatalogProfileForTimestamp,
  type RuntimeProviderModelCatalogByProvider
} from "../runtime-provider-profile";
import { computeVideoVcoinCost } from "../vcoin/compute-video-vcoin-cost";
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
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService,
    // ADR-108 Slice 2 — video-only settle path needs the platform exchange
    // rate + provider catalog (`vcoinExchangeRate` from
    // PlatformRuntimeProviderSettings; per `(providerKey, modelKey,
    // occurredAt)` catalog lookup), the VC wallet repository (debit
    // primitive), and direct prisma access so the settle + debit can share
    // ONE `$transaction` block (ADR-108 cross-slice invariant 4).
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    @Inject(WORKSPACE_VCOIN_BALANCE_REPOSITORY)
    private readonly workspaceVcoinBalanceRepository: WorkspaceVcoinBalanceRepository,
    private readonly prisma: WorkspaceManagementPrismaService
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
    const externalDeliveries: NonNullable<DeliveredMedia["externalDeliveries"]> = [];
    const assistant = await this.assistantRepository.findById(params.assistantId);

    for (const artifact of params.artifacts) {
      const startedAt = process.hrtime.bigint();
      let outcome: "success" | "failure" = "failure";
      const isVcoinPricedArtifact = artifact.sourceToolCode === "video_generate";
      const monthlyQuotaToolCode = this.resolveMonthlyMediaQuotaToolCode(artifact);
      try {
        const persisted = await this.persistArtifact(artifact, params);
        if ("externalDelivery" in persisted) {
          externalDeliveries.push(persisted.externalDelivery);
          if (isVcoinPricedArtifact) {
            await this.settleVideoGenerateWithVcoinDebit({
              assistant,
              artifact,
              workspaceId: params.workspaceId
            });
          } else {
            await this.settleMonthlyMediaQuotaBestEffort({
              assistant,
              toolCode: monthlyQuotaToolCode
            });
          }
          outcome = "success";
          continue;
        }

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
        // ADR-108 Slice 8 — split between two accounting surfaces:
        //   * `video_generate` → VC wallet debit only (no monthly-unit
        //     counter; the legacy unit-priced gate was retired).
        //   * image / image_edit (and other unit-priced monthly tools)
        //     → existing best-effort monthly-counter settle.
        if (isVcoinPricedArtifact) {
          await this.settleVideoGenerateWithVcoinDebit({
            assistant,
            artifact,
            workspaceId: params.workspaceId
          });
        } else {
          await this.settleMonthlyMediaQuotaBestEffort({
            assistant,
            toolCode: monthlyQuotaToolCode
          });
        }
        outcome = "success";
      } catch (err) {
        // ADR-108 Slice 8 — only unit-priced tools have a reservation
        // to reconcile. Video failures only need to be logged because
        // no reservation was ever taken on enqueue.
        if (!isVcoinPricedArtifact) {
          await this.markMonthlyMediaQuotaReconciliationBestEffort({
            assistant,
            toolCode: monthlyQuotaToolCode
          });
        }
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

    return {
      attachments: results,
      ...(externalDeliveries.length > 0 ? { externalDeliveries } : {})
    };
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

  /**
   * ADR-108 Slice 8 — `video_generate` is VC-priced after Slice 8 and
   * has no row in the monthly_media_quota counter table, so it is
   * intentionally excluded here. Callers that need to know whether an
   * artifact is video should branch on
   * `artifact.sourceToolCode === "video_generate"` directly.
   */
  private resolveMonthlyMediaQuotaToolCode(
    artifact: MediaArtifact
  ): WorkspaceMonthlyToolQuotaToolCode | null {
    if (artifact.sourceToolCode === "image_generate" || artifact.sourceToolCode === "image_edit") {
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

  /**
   * ADR-108 Slice 2 + Slice 8 — video-only success-delivery debit path.
   *
   * Slice 2 introduced the VC wallet debit on success delivery. Slice 8
   * removes the legacy monthly-unit-counter settle entirely: the VC
   * wallet is now the SOLE user-facing surface for `video_generate`
   * accounting. The `prisma.$transaction(...)` wrapper is preserved so
   * `ensureRow` + `update` inside `WorkspaceVcoinBalanceRepository.debit`
   * remain atomic, and so future ledger-event composition can plug in
   * without re-shaping callers.
   *
   * Failure semantics (mirrors the original Slice 2 lifecycle):
   *   - Missing assistant → no-op, no debit.
   *   - Missing billing facts on the artifact → throws so the outer
   *     `deliver()` loop catches and logs. Silent zero-VC fallback is
   *     forbidden by ADR-108 Slice 2.
   *   - Non-time-metered metering kind → throws.
   *   - Missing catalog row at `(providerKey, modelKey, occurredAt)` →
   *     throws (catalog/runtime drift; reconciliation required by ops).
   *   - Transaction failure → the transaction rolls back and the outer
   *     `deliver()` catch handles logging.
   *
   * Notes:
   *   - The VC pre-check (`balance_vc > 0`) lives at enqueue, not here.
   *     A settle that drives `balance_vc` below zero is permitted exactly
   *     once per the wallet lifecycle rule; the next enqueue is rejected
   *     with `vcoin_balance_exhausted`.
   *   - `usdMicros` is computed but not written to the USD COGS ledger
   *     here. The ledger write for `video_generate` already happens in
   *     `assistant-media-job-scheduler.service.ts::recordPersistedBillingFactsEvent`
   *     on job completion (cross-slice invariant 2: ledger writes / shape
   *     unchanged). This local `usdMicros` is logged on debit so admins
   *     can spot drift between the two paths.
   */
  private async settleVideoGenerateWithVcoinDebit(params: {
    assistant: Assistant | null;
    artifact: MediaArtifact;
    workspaceId: string;
  }): Promise<void> {
    if (params.assistant === null) {
      return;
    }
    const billingFacts = params.artifact.billingFacts ?? null;
    if (billingFacts === null) {
      throw new Error(
        `video_generate settle requires billingFacts on the delivered artifact but none was present (artifact=${describeRuntimeMediaArtifact(params.artifact)}). ADR-108 Slice 2 forbids silent 0-VC fallback; this artifact must be reconciled.`
      );
    }
    const platformSettings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const catalogForProvider = this.resolveCatalogForProvider(
      platformSettings.availableModelCatalogByProvider,
      billingFacts.providerKey
    );
    if (catalogForProvider === null) {
      throw new Error(
        `video_generate settle: no provider catalog for "${billingFacts.providerKey}". Catalog/runtime drift; reconciliation required.`
      );
    }
    const profile = findRuntimeProviderCatalogProfileForTimestamp(
      catalogForProvider,
      billingFacts.modelKey,
      new Date(billingFacts.occurredAt)
    );
    if (profile === null) {
      throw new Error(
        `video_generate settle: no catalog row for (providerKey="${billingFacts.providerKey}", modelKey="${billingFacts.modelKey}", occurredAt="${billingFacts.occurredAt}"). Catalog/runtime drift; reconciliation required.`
      );
    }
    const { vcCost, usdMicros } = computeVideoVcoinCost({
      billingFacts: billingFacts as RuntimeBillingFacts,
      profile,
      vcoinExchangeRate: platformSettings.vcoinExchangeRate
    });

    // Single `prisma.$transaction` keeps `ensureRow` + balance update
    // atomic inside the wallet repository. ADR-108 Slice 8 removed the
    // monthly-unit-counter settle that previously composed with this
    // debit; the VC wallet is now the only user-facing accounting
    // surface for `video_generate`.
    const debitResult = await this.prisma.$transaction(async (tx) => {
      return this.workspaceVcoinBalanceRepository.debit({
        workspaceId: params.workspaceId,
        amountVc: vcCost,
        tx
      });
    });

    this.logger.log(
      `adr108_video_settle workspaceId=${params.workspaceId} provider=${billingFacts.providerKey} model=${profile.model} durationSeconds=${String(
        billingFacts.metering.meteringKind === "time_metered"
          ? billingFacts.metering.durationSeconds
          : "n/a"
      )} usdMicros=${usdMicros.toString()} vcDebited=${String(vcCost)} previousBalanceVc=${String(debitResult.previousBalanceVc)} balanceVc=${String(debitResult.balanceVc)}`
    );
  }

  private resolveCatalogForProvider(
    catalogByProvider: RuntimeProviderModelCatalogByProvider,
    providerKey: string
  ): RuntimeProviderModelCatalogByProvider[keyof RuntimeProviderModelCatalogByProvider] | null {
    if (
      providerKey === "openai" ||
      providerKey === "anthropic" ||
      providerKey === "runway" ||
      providerKey === "kling"
    ) {
      return catalogByProvider[providerKey];
    }
    return null;
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
  ): Promise<
    | {
        state: AssistantWebChatMessageAttachmentState;
        buffer: Buffer;
        filename: string;
      }
    | {
        externalDelivery: {
          type: MediaArtifact["type"];
          url: string;
          filename: string | null;
          reason: "file_too_large_for_inline_delivery";
        };
      }
  > {
    const downloadResult = await this.downloadArtifactSource(artifact);
    if (!downloadResult) {
      throw new Error(`Media file not found on storage: ${describeRuntimeMediaArtifact(artifact)}`);
    }

    if (
      artifact.type === "video" &&
      downloadResult.buffer.length > MAX_TOOL_OUTPUT_PRESENTATION_FILE_BYTES &&
      typeof artifact.downloadUrl === "string" &&
      artifact.downloadUrl.trim().length > 0
    ) {
      return {
        externalDelivery: {
          type: artifact.type,
          url: artifact.downloadUrl.trim(),
          filename: readRuntimeMediaArtifactFilename(artifact),
          reason: "file_too_large_for_inline_delivery"
        }
      };
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
