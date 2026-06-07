import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  WORKSPACE_VIDEO_CLONED_VOICE_REPOSITORY,
  type WorkspaceVideoClonedVoiceRecord,
  type WorkspaceVideoClonedVoiceRepository
} from "../../domain/workspace-video-cloned-voice.repository";
import {
  WORKSPACE_VCOIN_BALANCE_REPOSITORY,
  type WorkspaceVcoinBalanceRepository
} from "../../domain/workspace-vcoin-balance.repository";
import {
  WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY,
  type WorkspaceVcoinLedgerEventRepository
} from "../../domain/workspace-vcoin-ledger-event.repository";
import { validatePersaiMediaFile } from "../media/media-security-policy";
import { ResolvePlatformRuntimeProviderSettingsService } from "../resolve-platform-runtime-provider-settings.service";
import { TOOL_CREDENTIAL_IDS } from "../tool-credential-settings";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { HeyGenProviderGatewayClient } from "./heygen-provider-gateway.client";

export type WorkspaceVideoClonedVoiceDto = {
  id: string;
  displayName: string;
  status: "pending" | "ready" | "failed";
  languageHint: string | null;
  isDefault: boolean;
  previewAudioUrl: string | null;
  createdAt: string;
};

export type CreateClonedVoiceResult = {
  clonedVoice: WorkspaceVideoClonedVoiceDto;
  walletBalanceVc: number;
};

@Injectable()
export class ManageWorkspaceVideoClonedVoicesService {
  private readonly logger = new Logger(ManageWorkspaceVideoClonedVoicesService.name);

  constructor(
    @Inject(WORKSPACE_VIDEO_CLONED_VOICE_REPOSITORY)
    private readonly clonedVoiceRepository: WorkspaceVideoClonedVoiceRepository,
    @Inject(WORKSPACE_VCOIN_BALANCE_REPOSITORY)
    private readonly vcoinBalanceRepository: WorkspaceVcoinBalanceRepository,
    @Inject(WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY)
    private readonly ledgerEventRepository: WorkspaceVcoinLedgerEventRepository,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly heygenProviderGatewayClient: HeyGenProviderGatewayClient
  ) {}

  async createClonedVoice(input: {
    workspaceId: string;
    displayName: string;
    audioFile: { buffer: Buffer; mimeType: string; originalFilename: string };
    languageHint?: string | null;
    removeBackgroundNoise?: boolean;
  }): Promise<CreateClonedVoiceResult> {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const limit = settings.heygenVoiceCloneWorkspaceLimit;
    const cost = settings.heygenVoiceCloneCreationVcoin;
    const displayNameLower = input.displayName.toLowerCase();
    const validated = await validatePersaiMediaFile({
      buffer: input.audioFile.buffer,
      mimeType: input.audioFile.mimeType,
      originalFilename: input.audioFile.originalFilename,
      surface: "voice_transcription"
    });
    this.assertHeyGenVoiceCloneAudioMimeType(validated.effectiveMimeType);

    const preActiveCount = await this.clonedVoiceRepository.countActiveForWorkspace(
      input.workspaceId
    );
    if (preActiveCount >= limit) {
      throw new BadRequestException({
        message: `Cloned voice limit of ${String(limit)} reached for this workspace.`,
        code: "cloned_voice_limit_reached"
      });
    }
    const preDuplicate = await this.clonedVoiceRepository.findActiveByLowerName(
      input.workspaceId,
      displayNameLower
    );
    if (preDuplicate !== null) {
      throw new BadRequestException({
        message: `A cloned voice named "${input.displayName}" already exists in this workspace.`,
        code: "cloned_voice_duplicate_name"
      });
    }
    if (cost > 0) {
      const walletRow = await this.vcoinBalanceRepository.getOrCreate(input.workspaceId);
      if (walletRow.balanceVc < cost) {
        throw new BadRequestException({
          message: `Insufficient VC balance. Required: ${String(cost)}, available: ${String(walletRow.balanceVc)}.`,
          code: "vcoin_balance_exhausted"
        });
      }
    }

    const clonedVoiceId = randomUUID();
    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const activeCount = await this.clonedVoiceRepository.countActiveForWorkspace(
        input.workspaceId,
        tx
      );
      if (activeCount >= limit) {
        throw new BadRequestException({
          message: `Cloned voice limit of ${String(limit)} reached for this workspace.`,
          code: "cloned_voice_limit_reached"
        });
      }
      const duplicate = await this.clonedVoiceRepository.findActiveByLowerName(
        input.workspaceId,
        displayNameLower,
        tx
      );
      if (duplicate !== null) {
        throw new BadRequestException({
          message: `A cloned voice named "${input.displayName}" already exists in this workspace.`,
          code: "cloned_voice_duplicate_name"
        });
      }
      return this.clonedVoiceRepository.create(
        {
          id: clonedVoiceId,
          workspaceId: input.workspaceId,
          displayName: input.displayName,
          displayNameLower,
          languageHint: this.normalizeOptionalString(input.languageHint),
          status: "pending",
          isDefault: false,
          previewAudioUrl: null,
          sourceMetadata: {
            source: {
              kind: "upload",
              originalFilename: validated.originalFilename,
              mimeType: validated.effectiveMimeType,
              sniffedMimeType: validated.sniffedMimeType,
              sizeBytes: input.audioFile.buffer.length
            },
            removeBackgroundNoise: input.removeBackgroundNoise === true
          }
        },
        tx
      );
    });

    let providerResult: { voiceCloneId: string; previewAudioUrl: string | null } | null = null;
    try {
      providerResult = await this.heygenProviderGatewayClient.createVoiceClone({
        credentialSecretId: TOOL_CREDENTIAL_IDS.tool_video_generate_heygen,
        displayName: input.displayName,
        audioBytesBase64: input.audioFile.buffer.toString("base64"),
        audioMimeType: this.toHeyGenVoiceCloneAudioMimeType(validated.effectiveMimeType),
        languageHint: this.normalizeOptionalString(input.languageHint),
        removeBackgroundNoise: input.removeBackgroundNoise === true
      });
    } catch (error) {
      await this.markCloneFailed(created, {
        providerStatus: "failed",
        providerError: this.extractErrorPayload(error)
      });
      throw error;
    }

    try {
      const txResult = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await this.clonedVoiceRepository.update(
          {
            workspaceId: input.workspaceId,
            clonedVoiceId: created.id,
            heygenVoiceCloneId: providerResult.voiceCloneId,
            languageHint: this.normalizeOptionalString(input.languageHint),
            status: "ready",
            previewAudioUrl: providerResult.previewAudioUrl,
            sourceMetadata: this.mergeMetadata(created.sourceMetadata, {
              provider: {
                providerId: "heygen",
                status: "complete",
                voiceCloneId: providerResult.voiceCloneId
              }
            })
          },
          tx
        );
        if (updated === null) {
          throw new NotFoundException({
            message: `Cloned voice "${created.id}" not found in this workspace.`,
            code: "cloned_voice_not_found"
          });
        }

        let walletBalanceVc: number;
        if (cost > 0) {
          const ledgerResult = await this.ledgerEventRepository.recordEvent({
            workspaceId: input.workspaceId,
            kind: "voice_clone_creation",
            amountVc: -cost,
            referenceKey: created.id,
            tx
          });
          if (!ledgerResult.recorded) {
            throw new Error("Voice-clone debit already recorded for this cloned voice.");
          }
          const debitResult = await tx.workspaceVcoinBalance.updateMany({
            where: { workspaceId: input.workspaceId, balanceVc: { gte: cost } },
            data: { balanceVc: { decrement: cost } }
          });
          if (debitResult.count === 0) {
            throw new BadRequestException({
              message: `Insufficient VC balance. Required: ${String(cost)}.`,
              code: "vcoin_balance_exhausted"
            });
          }
          const walletRow = await tx.workspaceVcoinBalance.findUnique({
            where: { workspaceId: input.workspaceId }
          });
          walletBalanceVc = walletRow?.balanceVc ?? 0;
        } else {
          const walletRow = await this.vcoinBalanceRepository.getOrCreate(input.workspaceId);
          walletBalanceVc = walletRow.balanceVc;
        }

        return { updated, walletBalanceVc };
      });

      return {
        clonedVoice: this.toDto(txResult.updated),
        walletBalanceVc: txResult.walletBalanceVc
      };
    } catch (error) {
      this.logger.warn(
        `[voice-clone] HeyGen clone succeeded but local finalize failed. workspace_id=${input.workspaceId} local_id=${created.id} provider_voice_clone_id=${providerResult.voiceCloneId}`
      );
      await this.markCloneFailed(created, {
        providerStatus: "complete",
        providerVoiceCloneId: providerResult.voiceCloneId,
        providerError: this.extractErrorPayload(error)
      });
      throw error;
    }
  }

  async listClonedVoices(input: { workspaceId: string }): Promise<{
    clonedVoices: WorkspaceVideoClonedVoiceDto[];
    limit: number;
    creationVcoinCost: number;
  }> {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const rows = await this.clonedVoiceRepository.listActive(input.workspaceId);
    return {
      clonedVoices: rows.map((row) => this.toDto(row)),
      limit: settings.heygenVoiceCloneWorkspaceLimit,
      creationVcoinCost: settings.heygenVoiceCloneCreationVcoin
    };
  }

  async archiveClonedVoice(input: {
    workspaceId: string;
    clonedVoiceId: string;
  }): Promise<{ archived: true; clonedVoiceId: string }> {
    const archived = await this.clonedVoiceRepository.archive(
      input.workspaceId,
      input.clonedVoiceId
    );
    if (archived === null) {
      throw new NotFoundException({
        message: `Cloned voice "${input.clonedVoiceId}" not found in this workspace.`,
        code: "cloned_voice_not_found"
      });
    }
    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    return { archived: true, clonedVoiceId: archived.id };
  }

  async setDefaultClonedVoice(input: {
    workspaceId: string;
    clonedVoiceId: string;
  }): Promise<{ clonedVoice: WorkspaceVideoClonedVoiceDto }> {
    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await this.clonedVoiceRepository.findById(
        input.workspaceId,
        input.clonedVoiceId,
        tx
      );
      if (existing === null || existing.archived) {
        throw new NotFoundException({
          message: `Cloned voice "${input.clonedVoiceId}" not found in this workspace.`,
          code: "cloned_voice_not_found"
        });
      }
      if (existing.status !== "ready") {
        throw new BadRequestException({
          message: "Only ready cloned voices can be marked as default.",
          code: "cloned_voice_not_ready"
        });
      }
      return this.clonedVoiceRepository.setDefault(input.workspaceId, input.clonedVoiceId, tx);
    });
    if (updated === null) {
      throw new NotFoundException({
        message: `Cloned voice "${input.clonedVoiceId}" not found in this workspace.`,
        code: "cloned_voice_not_found"
      });
    }
    return { clonedVoice: this.toDto(updated) };
  }

  private async markCloneFailed(
    created: WorkspaceVideoClonedVoiceRecord,
    details: {
      providerStatus: "failed" | "complete";
      providerVoiceCloneId?: string;
      providerError: { code: string | null; message: string };
    }
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await this.clonedVoiceRepository.update(
          {
            workspaceId: created.workspaceId,
            clonedVoiceId: created.id,
            heygenVoiceCloneId: details.providerVoiceCloneId ?? null,
            status: "failed",
            previewAudioUrl: null,
            sourceMetadata: this.mergeMetadata(created.sourceMetadata, {
              provider: {
                providerId: "heygen",
                status: details.providerStatus,
                voiceCloneId: details.providerVoiceCloneId ?? null
              },
              failure: {
                code: details.providerError.code,
                message: details.providerError.message
              }
            })
          },
          tx
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[voice-clone] Failed to persist failed status for cloned voice ${created.id}: ${message}`
      );
    }
  }

  private extractErrorPayload(error: unknown): { code: string | null; message: string } {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      const response = error.getResponse();
      if (response !== null && typeof response === "object" && !Array.isArray(response)) {
        const record = response as Record<string, unknown>;
        const nested = record["error"];
        if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
          const errorRecord = nested as Record<string, unknown>;
          return {
            code: typeof errorRecord["code"] === "string" ? errorRecord["code"] : null,
            message:
              typeof errorRecord["message"] === "string" ? errorRecord["message"] : error.message
          };
        }
        return {
          code: typeof record["code"] === "string" ? record["code"] : null,
          message: typeof record["message"] === "string" ? record["message"] : error.message
        };
      }
      return { code: null, message: error.message };
    }
    if (error instanceof Error) {
      return { code: null, message: error.message };
    }
    return { code: null, message: "Unknown error." };
  }

  private normalizeOptionalString(value: string | null | undefined): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private assertHeyGenVoiceCloneAudioMimeType(mimeType: string): void {
    if (
      mimeType === "audio/mpeg" ||
      mimeType === "audio/wav" ||
      mimeType === "audio/wave" ||
      mimeType === "audio/x-wav"
    ) {
      return;
    }
    throw new BadRequestException({
      error: {
        code: "voice_clone_audio_format_unsupported",
        message: "Voice clone samples must be MP3 or WAV audio."
      }
    });
  }

  private toHeyGenVoiceCloneAudioMimeType(mimeType: string): string {
    if (mimeType === "audio/wav" || mimeType === "audio/wave" || mimeType === "audio/x-wav") {
      return "audio/x-wav";
    }
    return mimeType;
  }

  /**
   * Best-effort: flag every assistant in the workspace as config-dirty so the
   * next runtime turn re-materializes its spec and refreshes model-visible
   * cloned-voice labels after archive. Never throws.
   */
  private async markWorkspaceAssistantsConfigDirty(workspaceId: string): Promise<void> {
    try {
      await this.prisma.assistant.updateMany({
        where: { workspaceId },
        data: { configDirtyAt: new Date() }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[voice-clone] Failed to mark workspace ${workspaceId} assistants config-dirty after cloned-voice archive: ${message}. ` +
          `The cloned-voice catalog will refresh on the next global spec regeneration.`
      );
    }
  }

  private mergeMetadata(
    existing: Prisma.JsonValue,
    patch: Record<string, unknown>
  ): Prisma.InputJsonValue {
    const base =
      existing !== null && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    return { ...base, ...patch } as Prisma.InputJsonObject;
  }

  private toDto(row: WorkspaceVideoClonedVoiceRecord): WorkspaceVideoClonedVoiceDto {
    return {
      id: row.id,
      displayName: row.displayName,
      status: row.status,
      languageHint: row.languageHint,
      isDefault: row.isDefault,
      previewAudioUrl: row.previewAudioUrl,
      createdAt: row.createdAt.toISOString()
    };
  }
}
