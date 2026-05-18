import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  TELEGRAM_ALBUM_CLAIM_TTL_MS,
  TELEGRAM_ALBUM_FINALIZE_DELAY_MS,
  type ClaimedTelegramAlbumCollector,
  type TelegramAlbumPart
} from "./telegram-album.types";

export type AppendTelegramAlbumPartInput = {
  assistantId: string;
  workspaceId: string;
  chatId: string;
  telegramChatId: string;
  telegramChatType: "private" | "group" | "supergroup";
  telegramUserId: string;
  mediaGroupId: string;
  caption: string | null;
  part: TelegramAlbumPart;
};

function isTelegramAlbumPart(value: unknown): value is TelegramAlbumPart {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.fileId === "string" &&
    row.fileId.length > 0 &&
    typeof row.mimeType === "string" &&
    row.mimeType.length > 0 &&
    (row.originalFilename === null || typeof row.originalFilename === "string") &&
    (row.turnKind === "photo" || row.turnKind === "document")
  );
}

function readPartsJson(value: unknown): TelegramAlbumPart[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isTelegramAlbumPart);
}

function mergeAlbumParts(
  existing: TelegramAlbumPart[],
  incoming: TelegramAlbumPart
): TelegramAlbumPart[] {
  if (existing.some((part) => part.fileId === incoming.fileId)) {
    return existing;
  }
  return [...existing, incoming];
}

@Injectable()
export class TelegramAlbumCollectorService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async appendPart(input: AppendTelegramAlbumPartInput): Promise<"appended" | "ignored"> {
    const now = new Date();
    const existing = await this.prisma.assistantTelegramAlbumCollector.findUnique({
      where: {
        assistantId_telegramChatId_mediaGroupId: {
          assistantId: input.assistantId,
          telegramChatId: input.telegramChatId,
          mediaGroupId: input.mediaGroupId
        }
      },
      select: {
        id: true,
        status: true,
        partsJson: true,
        caption: true
      }
    });

    if (existing !== null && existing.status !== "collecting") {
      return "ignored";
    }

    const nextCaption =
      input.caption !== null && input.caption.trim().length > 0
        ? input.caption.trim()
        : (existing?.caption ?? null);

    if (existing === null) {
      try {
        await this.prisma.assistantTelegramAlbumCollector.create({
          data: {
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            telegramChatId: input.telegramChatId,
            telegramChatType: input.telegramChatType,
            telegramUserId: input.telegramUserId,
            mediaGroupId: input.mediaGroupId,
            caption: nextCaption,
            partsJson: [input.part] as Prisma.InputJsonValue,
            firstSeenAt: now,
            lastPartAt: now,
            status: "collecting"
          }
        });
        return "appended";
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return this.appendPart(input);
        }
        throw error;
      }
    }

    const mergedParts = mergeAlbumParts(readPartsJson(existing.partsJson), input.part);
    await this.prisma.assistantTelegramAlbumCollector.update({
      where: { id: existing.id },
      data: {
        caption: nextCaption,
        partsJson: mergedParts as Prisma.InputJsonValue,
        lastPartAt: now
      }
    });
    return "appended";
  }

  async claimAndFinalizeReady(now: Date, limit: number): Promise<ClaimedTelegramAlbumCollector[]> {
    const finalizeBefore = new Date(now.getTime() - TELEGRAM_ALBUM_FINALIZE_DELAY_MS);
    const claimExpiresAt = new Date(now.getTime() + TELEGRAM_ALBUM_CLAIM_TTL_MS);
    const batchLimit = Math.max(1, Math.floor(limit));

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          workspaceId: string;
          chatId: string;
          telegramChatId: string;
          telegramChatType: string;
          telegramUserId: string;
          mediaGroupId: string;
          caption: string | null;
          partsJson: unknown;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id" AS "assistantId",
          "workspace_id" AS "workspaceId",
          "chat_id" AS "chatId",
          "telegram_chat_id" AS "telegramChatId",
          "telegram_chat_type" AS "telegramChatType",
          "telegram_user_id" AS "telegramUserId",
          "media_group_id" AS "mediaGroupId",
          "caption",
          "parts_json" AS "partsJson"
        FROM "assistant_telegram_album_collectors"
        WHERE (
            "status" = 'collecting'
            AND "last_part_at" <= ${finalizeBefore}
          )
          OR (
            "status" = 'finalizing'
            AND "scheduler_claim_expires_at" IS NOT NULL
            AND "scheduler_claim_expires_at" <= ${now}
          )
        ORDER BY "last_part_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchLimit}
      `);

      const claimed: ClaimedTelegramAlbumCollector[] = [];
      for (const row of rows) {
        const parts = readPartsJson(row.partsJson);
        if (parts.length === 0) {
          await tx.assistantTelegramAlbumCollector.delete({ where: { id: row.id } });
          continue;
        }
        const claimToken = randomUUID();
        const updated = await tx.assistantTelegramAlbumCollector.updateMany({
          where: {
            id: row.id,
            status: { in: ["collecting", "finalizing"] }
          },
          data: {
            status: "finalizing",
            schedulerClaimToken: claimToken,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt
          }
        });
        if (updated.count !== 1) {
          continue;
        }
        claimed.push({
          id: row.id,
          assistantId: row.assistantId,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          telegramChatId: row.telegramChatId,
          telegramChatType: row.telegramChatType as "private" | "group" | "supergroup",
          telegramUserId: row.telegramUserId,
          mediaGroupId: row.mediaGroupId,
          caption: row.caption,
          parts,
          claimToken
        });
      }
      return claimed;
    });
  }

  async deleteClaimed(id: string, claimToken: string): Promise<void> {
    await this.prisma.assistantTelegramAlbumCollector.deleteMany({
      where: {
        id,
        status: "finalizing",
        schedulerClaimToken: claimToken
      }
    });
  }

  async releaseClaim(id: string, claimToken: string): Promise<void> {
    await this.prisma.assistantTelegramAlbumCollector.updateMany({
      where: {
        id,
        status: "finalizing",
        schedulerClaimToken: claimToken
      },
      data: {
        status: "collecting",
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastPartAt: new Date()
      }
    });
  }
}
