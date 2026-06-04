import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  WORKSPACE_VIDEO_PERSONA_REPOSITORY,
  type WorkspaceVideoPersonaRecord,
  type WorkspaceVideoPersonaRepository
} from "../../domain/workspace-video-persona.repository";
import {
  WORKSPACE_VCOIN_BALANCE_REPOSITORY,
  type WorkspaceVcoinBalanceRepository
} from "../../domain/workspace-vcoin-balance.repository";
import {
  WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY,
  type WorkspaceVcoinLedgerEventRepository
} from "../../domain/workspace-vcoin-ledger-event.repository";
import { validatePersaiMediaFile } from "../media/media-security-policy";
import { PersaiMediaObjectStorageService } from "../media/persai-media-object-storage.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "../resolve-platform-runtime-provider-settings.service";
import { HeyGenVoiceCatalogService } from "./heygen-voice-catalog.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

const PORTRAIT_NORMALIZED_MIME_TYPE = "image/jpeg";
const PORTRAIT_NORMALIZED_DIMENSION = 1024;
const PORTRAIT_NORMALIZED_QUALITY = 85;
const PORTRAIT_URL_PREFIX = "/api/persona-portrait/";

export type WorkspaceVideoPersonaDto = {
  id: string;
  displayName: string;
  portraitImageUrl: string;
  heygenVoiceId: string;
  heygenVoiceLabel: string;
  createdAt: string;
};

export type PersonaListItem = {
  id: string;
  displayName: string;
  portraitImageUrl: string;
  heygenVoiceId: string;
  heygenVoiceLabel: string;
  heygenAvatarId: string | null;
  createdAt: string;
};

export type CreatePersonaResult = {
  persona: WorkspaceVideoPersonaDto;
  walletBalanceVc: number;
  storageWarning: string | null;
};

/**
 * ADR-109 Slice 5 — manages workspace video persona CRUD.
 *
 * Persona creation is REST-only (cross-slice invariant #14). The runtime MUST
 * NOT call this service or mutate `workspace_video_personas` directly.
 *
 * Transactional discipline (mirrors ADR-108 Slice 3 grant-monthly-vcoin):
 *   1. Count active personas → reject if ≥ limit.
 *   2. Duplicate-name check (lowercase equality, no regex — invariant #15).
 *   3. Insert persona row.
 *   4. If cost > 0: record ledger event, read balance, reject if insufficient,
 *      then debit wallet. All inside ONE prisma.$transaction block.
 *   5. Save portrait to object storage AFTER tx commits (so a rollback does
 *      not leave orphan blobs). If storage fails, the persona row is kept
 *      (committed) but a `storageWarning` is surfaced to the caller.
 */
@Injectable()
export class ManageWorkspaceVideoPersonasService {
  private readonly logger = new Logger(ManageWorkspaceVideoPersonasService.name);

  constructor(
    @Inject(WORKSPACE_VIDEO_PERSONA_REPOSITORY)
    private readonly personaRepository: WorkspaceVideoPersonaRepository,
    @Inject(WORKSPACE_VCOIN_BALANCE_REPOSITORY)
    private readonly vcoinBalanceRepository: WorkspaceVcoinBalanceRepository,
    @Inject(WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY)
    private readonly ledgerEventRepository: WorkspaceVcoinLedgerEventRepository,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly heyGenVoiceCatalogService: HeyGenVoiceCatalogService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async createPersona(input: {
    workspaceId: string;
    userId: string;
    displayName: string;
    portraitImageFile: { buffer: Buffer; mimeType: string; originalFilename: string };
    heygenVoiceId: string;
  }): Promise<CreatePersonaResult> {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const limit = settings.heygenPersonaWorkspaceLimit;
    const cost = settings.heygenPersonaCreationVcoin;

    const catalog = await this.heyGenVoiceCatalogService.getMaterializedVoiceCatalog();
    if (catalog === null || catalog.shortlist.length === 0) {
      throw new BadRequestException({
        message: "HeyGen voice catalog is unavailable. Please try again later.",
        code: "voice_not_found"
      });
    }
    const matchedVoice = catalog.shortlist.find(
      (entry) => entry.providerVoiceId === input.heygenVoiceId
    );
    if (matchedVoice === undefined) {
      throw new BadRequestException({
        message: `Voice "${input.heygenVoiceId}" not found in the HeyGen voice catalog.`,
        code: "voice_not_found"
      });
    }
    const heygenVoiceLabel = matchedVoice.displayName;

    const validated = await validatePersaiMediaFile({
      buffer: input.portraitImageFile.buffer,
      mimeType: input.portraitImageFile.mimeType,
      originalFilename: input.portraitImageFile.originalFilename,
      surface: "chat_upload"
    });

    const normalizedPortrait = await this.normalizePortraitBuffer(
      input.portraitImageFile.buffer,
      validated.effectiveMimeType
    );

    const personaId = randomUUID();
    const contentHash = createHash("sha256").update(normalizedPortrait).digest("hex").slice(0, 16);
    const storageKey = `workspaces/${input.workspaceId}/personas/${personaId}/portrait/current`;
    const portraitImageUrl = `${PORTRAIT_URL_PREFIX}${input.workspaceId}/${personaId}/${contentHash}.jpg`;
    const displayNameLower = input.displayName.toLowerCase();

    let committedPersona: WorkspaceVideoPersonaRecord;
    let walletBalanceVc: number;

    try {
      const txResult = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const activeCount = await this.personaRepository.countActiveForWorkspace(
          input.workspaceId,
          tx
        );
        if (activeCount >= limit) {
          throw Object.assign(
            new BadRequestException({
              message: `Persona limit of ${String(limit)} reached for this workspace.`,
              code: "persona_limit_reached"
            }),
            { _personaError: true }
          );
        }

        const duplicate = await this.personaRepository.findActiveByLowerName(
          input.workspaceId,
          displayNameLower,
          tx
        );
        if (duplicate !== null) {
          throw Object.assign(
            new BadRequestException({
              message: `A persona named "${input.displayName}" already exists in this workspace.`,
              code: "persona_duplicate_name"
            }),
            { _personaError: true }
          );
        }

        const persona = await this.personaRepository.create(
          {
            id: personaId,
            workspaceId: input.workspaceId,
            displayName: input.displayName,
            displayNameLower,
            portraitImageUrl,
            portraitImageStorageKey: storageKey,
            heygenVoiceId: input.heygenVoiceId,
            heygenVoiceLabel
          },
          tx
        );

        let balanceAfterVc: number;

        if (cost > 0) {
          await this.ledgerEventRepository.recordEvent({
            workspaceId: input.workspaceId,
            kind: "persona_creation",
            amountVc: -cost,
            referenceKey: personaId,
            tx
          });

          const walletRow = await tx.workspaceVcoinBalance.findUnique({
            where: { workspaceId: input.workspaceId }
          });
          const currentBalance = walletRow?.balanceVc ?? 0;

          if (currentBalance < cost) {
            throw Object.assign(
              new BadRequestException({
                message: `Insufficient VC balance. Required: ${String(cost)}, available: ${String(currentBalance)}.`,
                code: "vcoin_balance_exhausted"
              }),
              { _personaError: true }
            );
          }

          const debitResult = await this.vcoinBalanceRepository.debit({
            workspaceId: input.workspaceId,
            amountVc: cost,
            tx
          });
          balanceAfterVc = debitResult.balanceVc;
        } else {
          const walletRow = await this.vcoinBalanceRepository.getOrCreate(input.workspaceId);
          balanceAfterVc = walletRow.balanceVc;
        }

        return { persona, balanceAfterVc };
      });

      committedPersona = txResult.persona;
      walletBalanceVc = txResult.balanceAfterVc;
    } catch (error) {
      if (
        error instanceof BadRequestException &&
        (error as BadRequestException & { _personaError?: boolean })._personaError
      ) {
        throw error;
      }
      throw error;
    }

    let storageWarning: string | null = null;
    try {
      await this.mediaObjectStorage.saveObject({
        objectKey: storageKey,
        buffer: normalizedPortrait,
        mimeType: PORTRAIT_NORMALIZED_MIME_TYPE
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[persona] Portrait storage failed for persona ${personaId} (workspace ${input.workspaceId}): ${message}. ` +
          `Persona row is committed. Re-upload portrait via a future endpoint.`
      );
      storageWarning = "persona_created_storage_failed";
    }

    return {
      persona: this.toDto(committedPersona),
      walletBalanceVc,
      storageWarning
    };
  }

  async listPersonas(input: {
    workspaceId: string;
  }): Promise<{ personas: PersonaListItem[]; limit: number }> {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const limit = settings.heygenPersonaWorkspaceLimit;
    const rows = await this.personaRepository.listActive(input.workspaceId);
    return {
      personas: rows.map((row) => this.toListItem(row)),
      limit
    };
  }

  async archivePersona(input: {
    workspaceId: string;
    personaId: string;
  }): Promise<{ archived: true; personaId: string }> {
    const updated = await this.personaRepository.archive(input.workspaceId, input.personaId);
    if (updated === null) {
      throw new NotFoundException({
        message: `Persona "${input.personaId}" not found in this workspace.`,
        code: "persona_not_found"
      });
    }
    return { archived: true, personaId: updated.id };
  }

  /**
   * Normalize any supported image input to a square 1024×1024 JPEG.
   * Mirrors the approach in `ManageAssistantAvatarService.normalizeAvatarBuffer`.
   * If sharp is unavailable (should not happen in production), falls back to
   * original bytes without normalization.
   */
  private async normalizePortraitBuffer(buffer: Buffer, mimeType: string): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharpFn = await this.loadSharp();
    if (sharpFn === null) {
      this.logger.warn(
        `[persona] sharp not available — storing portrait (${mimeType}) without normalization.`
      );
      return buffer;
    }
    try {
      return await sharpFn(buffer)
        .rotate()
        .resize(PORTRAIT_NORMALIZED_DIMENSION, PORTRAIT_NORMALIZED_DIMENSION, {
          fit: "cover",
          position: "center",
          withoutEnlargement: false
        })
        .jpeg({ quality: PORTRAIT_NORMALIZED_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      this.logger.warn(
        `[persona] Portrait normalization failed for ${mimeType}, falling back to original bytes: ${String(err)}`
      );
      return buffer;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadSharp(): Promise<any | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("sharp");
    } catch {
      return null;
    }
  }

  private toDto(row: WorkspaceVideoPersonaRecord): WorkspaceVideoPersonaDto {
    return {
      id: row.id,
      displayName: row.displayName,
      portraitImageUrl: row.portraitImageUrl,
      heygenVoiceId: row.heygenVoiceId,
      heygenVoiceLabel: row.heygenVoiceLabel,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toListItem(row: WorkspaceVideoPersonaRecord): PersonaListItem {
    return {
      id: row.id,
      displayName: row.displayName,
      portraitImageUrl: row.portraitImageUrl,
      heygenVoiceId: row.heygenVoiceId,
      heygenVoiceLabel: row.heygenVoiceLabel,
      heygenAvatarId: row.heygenAvatarId,
      createdAt: row.createdAt.toISOString()
    };
  }
}
