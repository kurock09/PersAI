import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";

const AVATAR_URL_PREFIX = "/api/avatar/";

const AVATAR_NORMALIZED_MIME_TYPE = "image/jpeg";
const AVATAR_NORMALIZED_EXTENSION = "jpg";
const AVATAR_NORMALIZED_DIMENSION = 1024;
const AVATAR_NORMALIZED_QUALITY = 85;

function computeAvatarHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/**
 * ADR-076 Slice 4 — content-addressed avatar URL emitted into lifecycle state.
 * Format: `/api/avatar/<hash>.<ext>`. The hash is a SHA-256 prefix of the
 * normalized bytes and the extension matches the normalized MIME type.
 *
 * ADR-076 follow-up (2026-04-25): we always normalize avatars to a square
 * 1024×1024 JPEG before hashing/storing. This keeps the BFF cache key stable
 * across browsers (no HEIC/WebP display gaps), shrinks heavy phone uploads
 * (≤300KB on the wire), and lets the Telegram `setMyProfilePhoto` flow
 * receive a JPG that satisfies its `InputProfilePhotoStatic` contract.
 */
export function buildAssistantAvatarUrl(buffer: Buffer): string {
  const hash = computeAvatarHash(buffer);
  return `${AVATAR_URL_PREFIX}${hash}.${AVATAR_NORMALIZED_EXTENSION}`;
}

export function extractAvatarHashFromUrl(url: string | null): string | null {
  if (url === null || !url.startsWith(AVATAR_URL_PREFIX)) {
    return null;
  }
  const tail = url.slice(AVATAR_URL_PREFIX.length);
  const dotIndex = tail.indexOf(".");
  const hash = dotIndex === -1 ? tail : tail.slice(0, dotIndex);
  return /^[a-f0-9]{8,64}$/i.test(hash) ? hash : null;
}

@Injectable()
export class ManageAssistantAvatarService {
  private readonly logger = new Logger(ManageAssistantAvatarService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async upload(params: {
    userId: string;
    fileBuffer: Buffer;
    mimeType: string;
    originalFilename: string;
  }): Promise<{ avatarUrl: string }> {
    const assistant = await this.assistantRepository.findByUserId(params.userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const validated = await validatePersaiMediaFile({
      buffer: params.fileBuffer,
      mimeType: params.mimeType,
      originalFilename: params.originalFilename,
      surface: "chat_upload"
    });

    const normalized = await this.normalizeAvatarBuffer(
      params.fileBuffer,
      validated.effectiveMimeType
    );

    const assistantPrefix = this.mediaObjectStorage.buildAssistantPrefix(assistant.id);
    await this.mediaObjectStorage.deletePrefix(`${assistantPrefix}avatar/`);
    await this.mediaObjectStorage.saveObject({
      objectKey: `${assistantPrefix}avatar/current`,
      buffer: normalized,
      mimeType: AVATAR_NORMALIZED_MIME_TYPE
    });

    const avatarUrl = buildAssistantAvatarUrl(normalized);
    const updated = await this.assistantRepository.updateDraft(params.userId, {
      draftDisplayName: assistant.draftDisplayName,
      draftInstructions: assistant.draftInstructions,
      draftAvatarUrl: avatarUrl
    });
    if (updated === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    return { avatarUrl };
  }

  /**
   * Hash-validated download for the web BFF route. Returns null when the
   * supplied hash does not match the assistant's current avatar URL — that
   * signals "stale or unknown version" so the BFF can return 404 instead of
   * silently leaking out-of-date bytes.
   */
  async downloadByHash(
    userId: string,
    hash: string
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const currentHash = extractAvatarHashFromUrl(assistant.draftAvatarUrl);
    if (currentHash === null || currentHash !== hash) {
      return null;
    }

    return this.mediaObjectStorage.downloadObject(
      `${this.mediaObjectStorage.buildAssistantPrefix(assistant.id)}avatar/current`
    );
  }

  /**
   * Normalize any supported image input (HEIC, PNG, WebP, GIF, JPEG) into
   * a square 1024×1024 JPEG. We rely on the runtime-resolved `sharp` shared
   * with `MediaPreprocessorService`. If sharp ever fails to load (should not
   * happen in production — it is in the workspace tree), we fall back to the
   * original bytes so uploads never regress to broken state.
   */
  private async normalizeAvatarBuffer(buffer: Buffer, mimeType: string): Promise<Buffer> {
    const sharpFn = await this.loadSharp();
    if (sharpFn === null) {
      this.logger.warn(`sharp not available — storing avatar (${mimeType}) without normalization.`);
      return buffer;
    }
    try {
      return await sharpFn(buffer)
        .rotate()
        .resize(AVATAR_NORMALIZED_DIMENSION, AVATAR_NORMALIZED_DIMENSION, {
          fit: "cover",
          position: "attention",
          withoutEnlargement: false
        })
        .jpeg({ quality: AVATAR_NORMALIZED_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      this.logger.warn(
        `Avatar normalization failed for ${mimeType}, falling back to original bytes: ${String(err)}`
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
}
