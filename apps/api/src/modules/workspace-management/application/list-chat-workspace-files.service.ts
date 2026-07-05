// ADR-127 W1 — manifest is the authoritative file index. Attachment table is
// joined LEFT for display metadata (chat origin, thumbnail). Files written by
// the model via files.write have no attachment row → chatId/messageId nullable.

import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { buildAssistantSessionRoot, buildAssistantWorkspaceRoot } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EXTERNAL_DOWNLOAD_STORAGE_PATH_PREFIX } from "./media/media.types";
import { normalizeActiveWorkspaceFilePath } from "./workspace-visible-paths";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { WebRuntimeSessionStateClientService } from "./web-runtime-session-state-client.service";

export type WorkspaceFilesGalleryTypeFilter = "image" | "video" | "document";

export type WorkspaceFilesGalleryScope = "session" | "assistant" | "workspace";

export type ChatWorkspaceFileTile = {
  storagePath: string;
  thumbnailStoragePath: string | null;
  posterStoragePath: string | null;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  attachmentType: string;
  createdAt: string;
  // Nullable per ADR-127 D4 — files written by the model via `files.write`
  // have a manifest row but no chat-attachment row, so they cannot be
  // attributed to any chat or assistant message.
  chatId: string | null;
  messageId: string | null;
  /** ISO timestamp when a pending session_subtree GC purge will remove this file. */
  purgeScheduledAt: string | null;
};

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 100;
const MANIFEST_MAX_FETCH = 1_000;
const GALLERY_ATTACHMENT_TYPES = new Set(["image", "video", "document", "audio"]);

type ManifestRow = {
  path: string;
  mimeType: string;
  sizeBytes: bigint;
  createdAt: Date;
  updatedAt: Date;
  originChatId: string | null;
};

type AttachmentRow = {
  id: string;
  messageId: string;
  chatId: string;
  assistantId: string;
  workspaceId: string;
  attachmentType: string;
  storagePath: string | null;
  thumbnailStoragePath: string | null;
  posterStoragePath: string | null;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  processingStatus: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

function isVoiceNoteAttachment(attachment: AttachmentRow): boolean {
  if (attachment.attachmentType === "voice") {
    return true;
  }
  const metadata = attachment.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return metadata.source === "voice_input" || metadata.audioAsVoice === true;
}

function inferAttachmentTypeFromMime(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "document";
}

function basenameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx === -1 || idx === trimmed.length - 1) {
    return trimmed;
  }
  return trimmed.slice(idx + 1);
}

function matchesTypeFilter(
  attachmentType: string,
  type: WorkspaceFilesGalleryTypeFilter | undefined
): boolean {
  if (type === undefined) {
    return true;
  }
  return attachmentType === type;
}

@Injectable()
export class ListChatWorkspaceFilesService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly webRuntimeSessionStateClientService: WebRuntimeSessionStateClientService
  ) {}

  async execute(input: {
    userId: string;
    chatId?: string | null;
    scope?: string | null;
    type?: string | null;
    cursor?: string | null;
    limit?: number | null;
  }): Promise<{ files: ChatWorkspaceFileTile[]; nextCursor: string | null }> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId: input.userId }))
      .assistant;
    const chatId =
      typeof input.chatId === "string" && input.chatId.trim().length > 0 ? input.chatId : null;
    const typeFilter = this.parseTypeFilter(input.type);
    let scope = this.parseScopeFilter(input.scope);
    if (chatId === null) {
      if (scope === "session") {
        scope = "assistant";
      }
    }

    let chat: Awaited<ReturnType<AssistantChatRepository["findChatById"]>> = null;
    if (chatId !== null) {
      chat = await this.chatRepository.findChatById(chatId);
      if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
        throw new NotFoundException("Web chat does not exist for this assistant.");
      }
    }

    const limit = this.parseLimit(input.limit);
    const assistantRoot = buildAssistantWorkspaceRoot(assistant.id);
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );
    const runtimeSessionState =
      chat === null
        ? { session: null }
        : await this.webRuntimeSessionStateClientService.execute({
            assistantId: assistant.id,
            workspaceId: assistant.workspaceId,
            runtimeTier,
            surfaceThreadKey: chat.surfaceThreadKey,
            userId: assistant.userId
          });
    const sessionRoot =
      runtimeSessionState.session === null
        ? null
        : buildAssistantSessionRoot(assistant.id, runtimeSessionState.session.sessionId);
    const [manifestRowsRaw, attachmentRowsRaw, pendingSessionPurges] = await Promise.all([
      this.prisma.workspaceFileMetadata.findMany({
        where: { workspaceId: assistant.workspaceId },
        orderBy: { createdAt: "desc" },
        take: MANIFEST_MAX_FETCH
      }),
      this.prisma.assistantChatMessageAttachment.findMany({
        where: {
          workspaceId: assistant.workspaceId,
          assistantId: assistant.id,
          NOT: { storagePath: null }
        },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.sandboxWorkspaceGcLease.findMany({
        where: {
          kind: "session_subtree",
          purgedAt: null,
          AND: [
            {
              metadata: {
                path: ["workspaceId"],
                equals: assistant.workspaceId
              }
            },
            {
              metadata: {
                path: ["assistantId"],
                equals: assistant.id
              }
            }
          ]
        },
        select: {
          scheduledAt: true,
          metadata: true
        }
      })
    ]);
    const pendingPurgeBySessionRoot = this.buildPendingSessionPurgeMap({
      assistantId: assistant.id,
      pendingLeases: pendingSessionPurges
    });
    const manifestRows: ManifestRow[] = [];
    for (const raw of manifestRowsRaw) {
      const normalized = this.normalizeManifestRow(raw);
      if (normalized !== null) {
        manifestRows.push(normalized);
      }
    }
    const attachmentRows: unknown[] = attachmentRowsRaw;

    const attachmentByPath = new Map<string, AttachmentRow>();
    for (const raw of attachmentRows) {
      const row = this.normalizeAttachmentRow(raw);
      if (row === null) {
        continue;
      }
      if (row.storagePath === null) {
        continue;
      }
      const existing = attachmentByPath.get(row.storagePath);
      if (existing === undefined || row.createdAt > existing.createdAt) {
        attachmentByPath.set(row.storagePath, row);
      }
    }

    const tiles: ChatWorkspaceFileTile[] = [];
    for (const manifest of manifestRows) {
      if (normalizeActiveWorkspaceFilePath(manifest.path) === null) {
        continue;
      }
      if (manifest.path.startsWith(EXTERNAL_DOWNLOAD_STORAGE_PATH_PREFIX)) {
        continue;
      }
      const attachment = attachmentByPath.get(manifest.path);
      if (attachment !== undefined) {
        if (attachment.processingStatus !== "ready") {
          continue;
        }
        if (attachment.attachmentType === "tool_output") {
          continue;
        }
        if (isVoiceNoteAttachment(attachment)) {
          continue;
        }
        if (!GALLERY_ATTACHMENT_TYPES.has(attachment.attachmentType)) {
          continue;
        }
        if (!matchesTypeFilter(attachment.attachmentType, typeFilter)) {
          continue;
        }
        tiles.push({
          storagePath: manifest.path,
          thumbnailStoragePath: attachment.thumbnailStoragePath,
          posterStoragePath: attachment.posterStoragePath,
          originalFilename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          sizeBytes: Number(attachment.sizeBytes),
          attachmentType: attachment.attachmentType,
          createdAt: attachment.createdAt.toISOString(),
          chatId: attachment.chatId,
          messageId: attachment.messageId,
          purgeScheduledAt: this.resolvePurgeScheduledAt(manifest.path, pendingPurgeBySessionRoot)
        });
        continue;
      }
      // Orphan manifest entry: model `files.write` produced this file with no
      // chat attachment row. Use manifest origin when present.
      const orphanChatId =
        manifest.originChatId !== null && manifest.originChatId.length > 0
          ? manifest.originChatId
          : null;
      const inferredType = inferAttachmentTypeFromMime(manifest.mimeType);
      if (!GALLERY_ATTACHMENT_TYPES.has(inferredType)) {
        continue;
      }
      if (!matchesTypeFilter(inferredType, typeFilter)) {
        continue;
      }
      tiles.push({
        storagePath: manifest.path,
        thumbnailStoragePath: null,
        posterStoragePath: null,
        originalFilename: basenameFromPath(manifest.path),
        mimeType: manifest.mimeType,
        sizeBytes: Number(manifest.sizeBytes),
        attachmentType: inferredType,
        createdAt: manifest.createdAt.toISOString(),
        chatId: orphanChatId,
        messageId: null,
        purgeScheduledAt: this.resolvePurgeScheduledAt(manifest.path, pendingPurgeBySessionRoot)
      });
    }

    const scopedTiles =
      scope === "workspace"
        ? tiles
        : sessionRoot === null && scope === "session"
          ? []
          : tiles.filter((tile) =>
              this.isPathAtOrUnderRoot(
                tile.storagePath,
                scope === "assistant" ? assistantRoot : sessionRoot!
              )
            );

    scopedTiles.sort((left, right) => {
      const leftMs = Date.parse(left.createdAt);
      const rightMs = Date.parse(right.createdAt);
      if (rightMs !== leftMs) {
        return rightMs - leftMs;
      }
      return left.storagePath.localeCompare(right.storagePath);
    });

    let startIndex = 0;
    if (typeof input.cursor === "string" && input.cursor.trim().length > 0) {
      const cursorPath = input.cursor.trim();
      const cursorIndex = scopedTiles.findIndex((row) => row.storagePath === cursorPath);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = scopedTiles.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < scopedTiles.length && page.length > 0
        ? (page[page.length - 1]?.storagePath ?? null)
        : null;

    return {
      files: page,
      nextCursor
    };
  }

  private parseScopeFilter(value: string | null | undefined): WorkspaceFilesGalleryScope {
    if (value === undefined || value === null || value.trim().length === 0 || value === "session") {
      return "session";
    }
    if (value === "assistant") {
      return "assistant";
    }
    if (value === "workspace") {
      return "workspace";
    }
    throw new BadRequestException(
      'Query param "scope" must be one of: session, assistant, workspace.'
    );
  }

  private parseTypeFilter(
    value: string | null | undefined
  ): WorkspaceFilesGalleryTypeFilter | undefined {
    if (value === undefined || value === null || value.trim().length === 0 || value === "all") {
      return undefined;
    }
    if (value === "image" || value === "video" || value === "document") {
      return value;
    }
    throw new BadRequestException(
      'Query param "type" must be one of: all, image, video, document.'
    );
  }

  private parseLimit(value: number | null | undefined): number {
    if (value === undefined || value === null) {
      return DEFAULT_LIMIT;
    }
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('Query param "limit" must be a positive integer.');
    }
    return Math.min(Math.floor(value), MAX_LIMIT);
  }

  private normalizeManifestRow(raw: unknown): ManifestRow | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const row = raw as Record<string, unknown>;
    if (
      typeof row.path !== "string" ||
      typeof row.mimeType !== "string" ||
      typeof row.sizeBytes !== "bigint" ||
      !(row.createdAt instanceof Date) ||
      !(row.updatedAt instanceof Date)
    ) {
      return null;
    }
    return {
      path: row.path,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      originChatId: typeof row.originChatId === "string" ? row.originChatId : null
    };
  }

  private normalizeAttachmentRow(raw: unknown): AttachmentRow | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const row = raw as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.messageId !== "string" ||
      typeof row.chatId !== "string" ||
      typeof row.assistantId !== "string" ||
      typeof row.workspaceId !== "string" ||
      typeof row.attachmentType !== "string" ||
      typeof row.mimeType !== "string" ||
      typeof row.processingStatus !== "string" ||
      !(row.createdAt instanceof Date)
    ) {
      return null;
    }
    const sizeBytes = row.sizeBytes;
    if (typeof sizeBytes !== "bigint") {
      return null;
    }
    const storagePath = typeof row.storagePath === "string" ? row.storagePath : null;
    const thumbnailStoragePath =
      typeof row.thumbnailStoragePath === "string" ? row.thumbnailStoragePath : null;
    const posterStoragePath =
      typeof row.posterStoragePath === "string" ? row.posterStoragePath : null;
    const originalFilename = typeof row.originalFilename === "string" ? row.originalFilename : null;
    const metadata =
      row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null;
    return {
      id: row.id,
      messageId: row.messageId,
      chatId: row.chatId,
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      attachmentType: row.attachmentType,
      storagePath,
      thumbnailStoragePath,
      posterStoragePath,
      originalFilename,
      mimeType: row.mimeType,
      sizeBytes,
      processingStatus: row.processingStatus,
      metadata,
      createdAt: row.createdAt
    };
  }

  private isPathAtOrUnderRoot(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}/`);
  }

  private buildPendingSessionPurgeMap(input: {
    assistantId: string;
    pendingLeases: Array<{ scheduledAt: Date; metadata: unknown }>;
  }): Map<string, Date> {
    const pendingBySessionRoot = new Map<string, Date>();
    for (const lease of input.pendingLeases) {
      if (
        lease.metadata === null ||
        typeof lease.metadata !== "object" ||
        Array.isArray(lease.metadata)
      ) {
        continue;
      }
      const metadata = lease.metadata as Record<string, unknown>;
      if (metadata.assistantId !== input.assistantId) {
        continue;
      }
      const sessionId = typeof metadata.sessionId === "string" ? metadata.sessionId : null;
      if (sessionId === null) {
        continue;
      }
      const sessionRoot = buildAssistantSessionRoot(input.assistantId, sessionId);
      const existing = pendingBySessionRoot.get(sessionRoot);
      if (existing === undefined || lease.scheduledAt > existing) {
        pendingBySessionRoot.set(sessionRoot, lease.scheduledAt);
      }
    }
    return pendingBySessionRoot;
  }

  private resolvePurgeScheduledAt(
    path: string,
    pendingBySessionRoot: Map<string, Date>
  ): string | null {
    for (const [sessionRoot, scheduledAt] of pendingBySessionRoot) {
      if (this.isPathAtOrUnderRoot(path, sessionRoot)) {
        return scheduledAt.toISOString();
      }
    }
    return null;
  }
}
