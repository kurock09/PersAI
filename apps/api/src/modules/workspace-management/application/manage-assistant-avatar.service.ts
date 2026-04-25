import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";

const AVATAR_URL_PREFIX = "/api/avatar/";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif"
};

function avatarExtensionForMimeType(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? "bin";
}

function computeAvatarHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/**
 * ADR-076 Slice 4 — content-addressed avatar URL emitted into lifecycle state.
 * Format: `/api/avatar/<hash>.<ext>`. The hash is a SHA-256 prefix of the bytes
 * and the extension comes from the validated mime type. The web BFF
 * (`apps/web/app/api/avatar/[hash]/route.ts`) reads this URL and proxies the
 * request back to `apps/api` with the bearer token.
 */
export function buildAssistantAvatarUrl(buffer: Buffer, mimeType: string): string {
  const hash = computeAvatarHash(buffer);
  const ext = avatarExtensionForMimeType(mimeType);
  return `${AVATAR_URL_PREFIX}${hash}.${ext}`;
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
    const assistantPrefix = this.mediaObjectStorage.buildAssistantPrefix(assistant.id);
    await this.mediaObjectStorage.deletePrefix(`${assistantPrefix}avatar/`);
    await this.mediaObjectStorage.saveObject({
      objectKey: `${assistantPrefix}avatar/current`,
      buffer: params.fileBuffer,
      mimeType: validated.effectiveMimeType
    });

    const avatarUrl = buildAssistantAvatarUrl(params.fileBuffer, validated.effectiveMimeType);
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
}
