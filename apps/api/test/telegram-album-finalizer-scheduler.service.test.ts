import assert from "node:assert/strict";
import test from "node:test";
import { TelegramAlbumFinalizerSchedulerService } from "../src/modules/workspace-management/application/telegram-album-finalizer-scheduler.service";

test("processDueAlbumsBatch finalizes claimed albums once", async () => {
  let finalizeCalls = 0;
  let deleteCalls = 0;

  const scheduler = new TelegramAlbumFinalizerSchedulerService(
    {
      async claimAndFinalizeReady() {
        return [
          {
            id: "collector-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            chatId: "chat-1",
            telegramChatId: "12345",
            telegramChatType: "private",
            telegramUserId: "777",
            mediaGroupId: "album-1",
            caption: "task",
            parts: [
              {
                fileId: "photo-1",
                mimeType: "image/jpeg",
                originalFilename: "photo.jpg",
                turnKind: "photo"
              },
              {
                fileId: "photo-2",
                mimeType: "image/jpeg",
                originalFilename: "photo-2.jpg",
                turnKind: "photo"
              }
            ],
            claimToken: "claim-1"
          }
        ];
      },
      async deleteClaimed() {
        deleteCalls += 1;
      },
      async releaseClaim() {
        throw new Error("releaseClaim should not run on success");
      }
    } as never,
    {
      async finalizeCollectedAlbum() {
        finalizeCalls += 1;
        return "ok" as const;
      }
    } as never,
    {
      async getLeaseState() {
        return null;
      },
      async acquire() {
        return { token: "lease-1" };
      },
      async heartbeat() {
        return true;
      },
      async release() {
        return undefined;
      }
    } as never,
    {
      recordLeaseLost() {
        return undefined;
      },
      recordTickSkipped() {
        return undefined;
      },
      recordLeaseExpiredRecovered() {
        return undefined;
      },
      recordTickAcquired() {
        return undefined;
      }
    } as never
  );

  const processed = await scheduler.processDueAlbumsBatch();
  assert.equal(processed, 1);
  assert.equal(finalizeCalls, 1);
  assert.equal(deleteCalls, 1);
});

test("processDueAlbumsBatch releases claim when finalize returns failed", async () => {
  let deleteCalls = 0;
  let releaseCalls = 0;

  const scheduler = new TelegramAlbumFinalizerSchedulerService(
    {
      async claimAndFinalizeReady() {
        return [
          {
            id: "collector-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            chatId: "chat-1",
            telegramChatId: "12345",
            telegramChatType: "private",
            telegramUserId: "777",
            mediaGroupId: "album-1",
            caption: "task",
            parts: [
              {
                fileId: "photo-1",
                mimeType: "image/jpeg",
                originalFilename: "photo.jpg",
                turnKind: "photo"
              }
            ],
            claimToken: "claim-1"
          }
        ];
      },
      async deleteClaimed() {
        deleteCalls += 1;
      },
      async releaseClaim() {
        releaseCalls += 1;
      }
    } as never,
    {
      async finalizeCollectedAlbum() {
        return "failed" as const;
      }
    } as never,
    {
      async getLeaseState() {
        return null;
      },
      async acquire() {
        return { token: "lease-1" };
      },
      async heartbeat() {
        return true;
      },
      async release() {
        return undefined;
      }
    } as never,
    {
      recordLeaseLost() {
        return undefined;
      },
      recordTickSkipped() {
        return undefined;
      },
      recordLeaseExpiredRecovered() {
        return undefined;
      },
      recordTickAcquired() {
        return undefined;
      }
    } as never
  );

  const processed = await scheduler.processDueAlbumsBatch();
  assert.equal(processed, 0);
  assert.equal(deleteCalls, 0);
  assert.equal(releaseCalls, 1);
});
