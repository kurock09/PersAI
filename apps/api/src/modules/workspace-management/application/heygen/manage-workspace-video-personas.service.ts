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
import { HeyGenProviderGatewayClient } from "./heygen-provider-gateway.client";
import { TOOL_CREDENTIAL_IDS } from "../tool-credential-settings";
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
  createdAt: string;
};

export type CreatePersonaResult = {
  persona: WorkspaceVideoPersonaDto;
  walletBalanceVc: number;
  storageWarning: string | null;
};

/**
 * ADR-109 Slice 5 / Slice 5b — manages workspace video persona CRUD.
 *
 * Persona creation is REST-only (cross-slice invariant #14). The runtime MUST
 * NOT call this service or mutate `workspace_video_personas` directly.
 *
 * Slice 5b (E12) — eager HeyGen avatar creation flow:
 *
 * ```
 * 1. settings + voice-catalog pre-checks (unchanged)
 * 2. validatePersaiMediaFile + normalizePortraitBuffer (unchanged)
 * 3. Pre-checks (best-effort, before HeyGen call):
 *    a. activeCount < limit
 *    b. no duplicate name
 *    c. balance >= cost (when cost > 0)
 * 4. Call heygenProviderGatewayClient.createPhotoAvatar → { avatarId }
 *    ⚠ OUTSIDE the tx. If HeyGen succeeds but the tx later fails (rare race),
 *    the orphan HeyGen avatar is logged as a warning and the exception propagates.
 *    No compensation job. (Slice 5b trade-off: avatar is $1, races are rare.)
 * 5. Open prisma.$transaction:
 *    a. Re-check activeCount (authoritative race guard)
 *    b. Re-check duplicate name
 *    c. Insert persona row WITH heygenAvatarId = avatarId
 *    d. Ledger event + balance re-check + debit
 * 6. Save portrait to object storage AFTER tx commits (unchanged)
 * ```
 *
 * The pre-check + re-check pattern (option i) means we can reject obvious
 * violations before paying HeyGen. In the rare case of a concurrent create that
 * squeezes through the pre-check window, the authoritative in-tx check catches
 * it, the tx rolls back, and we log the orphan avatar ID as a warning. The
 * caller sees the correct error code.
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
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly heygenProviderGatewayClient: HeyGenProviderGatewayClient
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

    // ── Step 3: Pre-checks (best-effort, before HeyGen call) ─────────────────
    // These are intentionally racy: the authoritative checks run inside the tx.
    // The purpose is to reject obvious violations cheaply BEFORE paying HeyGen.
    const preActiveCount = await this.personaRepository.countActiveForWorkspace(input.workspaceId);
    if (preActiveCount >= limit) {
      throw Object.assign(
        new BadRequestException({
          message: `Persona limit of ${String(limit)} reached for this workspace.`,
          code: "persona_limit_reached"
        }),
        { _personaError: true }
      );
    }

    const preDuplicate = await this.personaRepository.findActiveByLowerName(
      input.workspaceId,
      displayNameLower
    );
    if (preDuplicate !== null) {
      throw Object.assign(
        new BadRequestException({
          message: `A persona named "${input.displayName}" already exists in this workspace.`,
          code: "persona_duplicate_name"
        }),
        { _personaError: true }
      );
    }

    if (cost > 0) {
      const walletRow = await this.vcoinBalanceRepository.getOrCreate(input.workspaceId);
      if (walletRow.balanceVc < cost) {
        throw Object.assign(
          new BadRequestException({
            message: `Insufficient VC balance. Required: ${String(cost)}, available: ${String(walletRow.balanceVc)}.`,
            code: "vcoin_balance_exhausted"
          }),
          { _personaError: true }
        );
      }
    }

    // ── Step 4: Call HeyGen to create the photo avatar (OUTSIDE the tx) ──────
    // The HeyGen credential is the platform-level key.
    const { avatarId } = await this.heygenProviderGatewayClient.createPhotoAvatar({
      credentialSecretId: TOOL_CREDENTIAL_IDS.tool_video_generate_heygen,
      name: input.displayName,
      portraitImageBytesBase64: normalizedPortrait.toString("base64"),
      portraitImageMimeType: PORTRAIT_NORMALIZED_MIME_TYPE
    });

    // ── Step 5: Open tx — authoritative re-checks + persist persona row ───────
    let committedPersona: WorkspaceVideoPersonaRecord;
    let walletBalanceVc: number;

    try {
      const txResult = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // 5a. Re-check activeCount (authoritative race guard).
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

        // 5b. Re-check duplicate name.
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

        // 5c. Insert persona WITH the newly created HeyGen avatar ID.
        const persona = await this.personaRepository.create(
          {
            id: personaId,
            workspaceId: input.workspaceId,
            displayName: input.displayName,
            displayNameLower,
            portraitImageUrl,
            portraitImageStorageKey: storageKey,
            heygenVoiceId: input.heygenVoiceId,
            heygenVoiceLabel,
            heygenAvatarId: avatarId
          },
          tx
        );

        let balanceAfterVc: number;

        // 5d. Ledger event + conditional atomic debit.
        // The updateMany with WHERE balance_vc >= cost is atomic at the DB level —
        // only one concurrent request can succeed. count=0 means the race was lost.
        if (cost > 0) {
          await this.ledgerEventRepository.recordEvent({
            workspaceId: input.workspaceId,
            kind: "persona_creation",
            amountVc: -cost,
            referenceKey: personaId,
            tx
          });

          const debitResult = await tx.workspaceVcoinBalance.updateMany({
            where: { workspaceId: input.workspaceId, balanceVc: { gte: cost } },
            data: { balanceVc: { decrement: cost } }
          });

          if (debitResult.count === 0) {
            throw Object.assign(
              new BadRequestException({
                message: `Insufficient VC balance. Required: ${String(cost)}.`,
                code: "vcoin_balance_exhausted"
              }),
              { _personaError: true }
            );
          }

          const walletRow = await tx.workspaceVcoinBalance.findUnique({
            where: { workspaceId: input.workspaceId }
          });
          balanceAfterVc = walletRow?.balanceVc ?? 0;
        } else {
          const walletRow = await this.vcoinBalanceRepository.getOrCreate(input.workspaceId);
          balanceAfterVc = walletRow.balanceVc;
        }

        return { persona, balanceAfterVc };
      });

      committedPersona = txResult.persona;
      walletBalanceVc = txResult.balanceAfterVc;
    } catch (error) {
      // Any error after HeyGen succeeded means the avatar we just created is orphaned.
      // Log a greppable warning regardless of error type (guard race, infra error, etc.)
      // then re-throw the original error unchanged.
      const errorCode =
        error instanceof BadRequestException
          ? String((error.getResponse() as Record<string, unknown>)["code"] ?? "unknown")
          : error instanceof Error
            ? error.constructor.name
            : "unknown";
      this.logger.warn(
        `[persona] Orphan HeyGen avatar created but tx rejected. ` +
          `avatar_id=${avatarId} persona_name=${input.displayName} workspace_id=${input.workspaceId} ` +
          `error_type=${errorCode}. ` +
          `The HeyGen avatar will remain unused. No compensation is performed (ADR-109 Slice 5b trade-off).`
      );
      throw error;
    }

    // ── Step 6: Save portrait to object storage AFTER tx commits ──────────────
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
  }): Promise<{ personas: PersonaListItem[]; limit: number; creationVcoinCost: number }> {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const limit = settings.heygenPersonaWorkspaceLimit;
    const creationVcoinCost = settings.heygenPersonaCreationVcoin;
    const rows = await this.personaRepository.listActive(input.workspaceId);
    return {
      personas: rows.map((row) => this.toListItem(row)),
      limit,
      creationVcoinCost
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
      createdAt: row.createdAt.toISOString()
    };
  }
}
