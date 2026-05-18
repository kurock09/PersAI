import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { TelegramAlbumCollectorService } from "../src/modules/workspace-management/application/telegram-album-collector.service";
import { TELEGRAM_ALBUM_FINALIZE_DELAY_MS } from "../src/modules/workspace-management/application/telegram-album.types";

type CollectorRow = {
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
  firstSeenAt: Date;
  lastPartAt: Date;
  status: string;
  schedulerClaimToken: string | null;
  schedulerClaimedAt: Date | null;
  schedulerClaimExpiresAt: Date | null;
};

function createInMemoryCollectorPrisma() {
  const rows = new Map<string, CollectorRow>();
  let evaluationNow = new Date();

  const keyFor = (assistantId: string, telegramChatId: string, mediaGroupId: string) =>
    `${assistantId}:${telegramChatId}:${mediaGroupId}`;

  const api = {
    assistantTelegramAlbumCollector: {
      findUnique: async ({
        where
      }: {
        where: {
          assistantId_telegramChatId_mediaGroupId: {
            assistantId: string;
            telegramChatId: string;
            mediaGroupId: string;
          };
        };
      }) => {
        const key = keyFor(
          where.assistantId_telegramChatId_mediaGroupId.assistantId,
          where.assistantId_telegramChatId_mediaGroupId.telegramChatId,
          where.assistantId_telegramChatId_mediaGroupId.mediaGroupId
        );
        return rows.get(key) ?? null;
      },
      create: async ({ data }: { data: Omit<CollectorRow, "id"> & { partsJson: unknown } }) => {
        const id = randomUUID();
        const row: CollectorRow = { id, ...data };
        const key = keyFor(row.assistantId, row.telegramChatId, row.mediaGroupId);
        rows.set(key, row);
        return row;
      },
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<CollectorRow> & { partsJson?: unknown };
      }) => {
        const existing = [...rows.values()].find((row) => row.id === where.id);
        if (existing === undefined) {
          throw new Error("row not found");
        }
        const updated = { ...existing, ...data };
        rows.set(
          keyFor(updated.assistantId, updated.telegramChatId, updated.mediaGroupId),
          updated
        );
        return updated;
      },
      updateMany: async ({
        where,
        data
      }: {
        where: { id: string; status?: { in: string[] } };
        data: Partial<CollectorRow>;
      }) => {
        const existing = [...rows.values()].find((row) => row.id === where.id);
        if (existing === undefined) {
          return { count: 0 };
        }
        if (where.status && !where.status.in.includes(existing.status)) {
          return { count: 0 };
        }
        const updated = { ...existing, ...data };
        rows.set(
          keyFor(updated.assistantId, updated.telegramChatId, updated.mediaGroupId),
          updated
        );
        return { count: 1 };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        for (const [key, row] of rows.entries()) {
          if (row.id === where.id) {
            rows.delete(key);
            return row;
          }
        }
        throw new Error("row not found");
      },
      deleteMany: async ({
        where
      }: {
        where: { id: string; status: string; schedulerClaimToken: string };
      }) => {
        for (const [key, row] of rows.entries()) {
          if (
            row.id === where.id &&
            row.status === where.status &&
            row.schedulerClaimToken === where.schedulerClaimToken
          ) {
            rows.delete(key);
            return { count: 1 };
          }
        }
        return { count: 0 };
      }
    },
    $transaction: async <T>(callback: (tx: typeof api) => Promise<T>) => callback(api),
    $queryRaw: async () => {
      const now = evaluationNow;
      const finalizeBefore = new Date(now.getTime() - TELEGRAM_ALBUM_FINALIZE_DELAY_MS);
      return [...rows.values()]
        .filter(
          (row) =>
            (row.status === "collecting" && row.lastPartAt <= finalizeBefore) ||
            (row.status === "finalizing" &&
              row.schedulerClaimExpiresAt !== null &&
              row.schedulerClaimExpiresAt <= now)
        )
        .sort((left, right) => left.lastPartAt.getTime() - right.lastPartAt.getTime())
        .map((row) => ({
          id: row.id,
          assistantId: row.assistantId,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          telegramChatId: row.telegramChatId,
          telegramChatType: row.telegramChatType,
          telegramUserId: row.telegramUserId,
          mediaGroupId: row.mediaGroupId,
          caption: row.caption,
          partsJson: row.partsJson
        }));
    }
  };

  return {
    api,
    rows,
    setEvaluationNow(value: Date) {
      evaluationNow = value;
    }
  };
}

test("appendPart is idempotent per media file id", async () => {
  const { api, setEvaluationNow } = createInMemoryCollectorPrisma();
  const service = new TelegramAlbumCollectorService(api as never);
  const baseInput = {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    telegramChatId: "12345",
    telegramChatType: "private" as const,
    telegramUserId: "777",
    mediaGroupId: "album-1",
    caption: "task",
    part: {
      fileId: "photo-1",
      mimeType: "image/jpeg",
      originalFilename: "photo.jpg",
      turnKind: "photo" as const
    }
  };

  assert.equal(await service.appendPart(baseInput), "appended");
  assert.equal(await service.appendPart(baseInput), "appended");

  const readyAt = new Date(Date.now() + TELEGRAM_ALBUM_FINALIZE_DELAY_MS + 10);
  setEvaluationNow(readyAt);
  const claimed = await service.claimAndFinalizeReady(readyAt, 4);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.parts.length, 1);
  assert.equal(claimed[0]?.caption, "task");
});

test("claimAndFinalizeReady returns albums only after finalize delay", async () => {
  const { api, setEvaluationNow } = createInMemoryCollectorPrisma();
  const service = new TelegramAlbumCollectorService(api as never);
  await service.appendPart({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    telegramChatId: "12345",
    telegramChatType: "private",
    telegramUserId: "777",
    mediaGroupId: "album-2",
    caption: null,
    part: {
      fileId: "photo-1",
      mimeType: "image/jpeg",
      originalFilename: "photo.jpg",
      turnKind: "photo"
    }
  });

  const earlyAt = new Date();
  setEvaluationNow(earlyAt);
  const tooEarly = await service.claimAndFinalizeReady(earlyAt, 4);
  assert.equal(tooEarly.length, 0);

  const readyAt = new Date(Date.now() + TELEGRAM_ALBUM_FINALIZE_DELAY_MS + 5);
  setEvaluationNow(readyAt);
  const ready = await service.claimAndFinalizeReady(readyAt, 4);
  assert.equal(ready.length, 1);
  assert.equal(ready[0]?.parts.length, 1);
});
