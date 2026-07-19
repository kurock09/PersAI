import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  CATCHUP_IDLE_PAUSE_MS,
  ChatWakeCoordinator
} from "../src/modules/workspace-management/application/chat-wake-coordinator.service";

describe("ChatWakeCoordinator", () => {
  const postgresIntegrationUrl =
    process.env.PERSAI_POSTGRES_INTEGRATION_URL ??
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";

  test("PostgreSQL parses eligible-chat SQL with overlapping joined-table columns", async () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: postgresIntegrationUrl } }
    });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE "assistant_chats" (
              "id" uuid PRIMARY KEY,
              "assistant_id" uuid NOT NULL,
              "user_id" uuid NOT NULL,
              "thread_key" text,
              "ready_at" timestamptz,
              "updated_at" timestamptz NOT NULL DEFAULT NOW(),
              "catch_up_last_scanned_at" timestamptz
            ) ON COMMIT DROP
          `);
        await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE "assistant_async_job_handles" (
              "id" uuid PRIMARY KEY,
              "chat_id" uuid NOT NULL,
              "assistant_id" uuid NOT NULL,
              "user_id" uuid NOT NULL,
              "thread_key" text,
              "ready_at" timestamptz,
              "state" text NOT NULL,
              "source_finalized_at" timestamptz,
              "next_retry_at" timestamptz,
              "retry_count" integer NOT NULL,
              "max_retries" integer NOT NULL,
              "updated_at" timestamptz NOT NULL
            ) ON COMMIT DROP
          `);
        await tx.$executeRawUnsafe(`
            INSERT INTO "assistant_chats"
              ("id", "assistant_id", "user_id", "thread_key", "ready_at", "updated_at")
            VALUES
              ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010',
               '00000000-0000-0000-0000-000000000020', 'chat-thread', NOW(), NOW())
          `);
        await tx.$executeRawUnsafe(`
            INSERT INTO "assistant_async_job_handles"
              ("id", "chat_id", "assistant_id", "user_id", "thread_key", "ready_at", "state",
               "source_finalized_at", "next_retry_at", "retry_count", "max_retries", "updated_at")
            VALUES
              ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
               '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020',
               'handle-thread', NOW(), 'ready', NOW(), NULL, 0, 1, NOW())
          `);
        const coordinator = new ChatWakeCoordinator(
          { $queryRaw: tx.$queryRaw.bind(tx) } as never,
          {} as never,
          {} as never
        );
        const candidates = await (
          coordinator as unknown as {
            listCatchUpEligibleChats(limit: number): Promise<
              Array<{
                chatId: string;
                assistantId: string;
                userId: string;
                surfaceThreadKey: string | null;
              }>
            >;
          }
        ).listCatchUpEligibleChats(1);
        assert.deepEqual(candidates, [
          {
            chatId: "00000000-0000-0000-0000-000000000001",
            assistantId: "00000000-0000-0000-0000-000000000010",
            userId: "00000000-0000-0000-0000-000000000020",
            surfaceThreadKey: "handle-thread"
          }
        ]);
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("skips catch-up when a non-continuation web user turn is accepted/running", async () => {
    const locks: string[] = [];
    const prisma = {
      $queryRaw: async () => [
        {
          chatId: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "thread-1"
        }
      ],
      assistantWebChatTurnAttempt: {
        findFirst: async () => ({ id: "user-attempt-1" })
      },
      runtimeTurnReceipt: {
        findFirst: async () => null
      },
      assistantChat: {
        findUnique: async () => ({
          lastUserTurnStartedAt: null,
          lastUserTurnTerminalAt: null
        })
      }
    };
    const handleState = {
      claimReadyHeadForChat: async () => {
        throw new Error("must not claim while user turn active");
      }
    };
    const schedulerLease = {
      acquireOrCreate: async (key: string) => {
        locks.push(key);
        return { token: "lock-1" };
      },
      releaseKey: async () => undefined
    };
    const coordinator = new ChatWakeCoordinator(
      prisma as never,
      handleState as never,
      schedulerLease as never
    );
    const claims = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.deepEqual(claims, []);
    assert.deepEqual(locks, []);
  });

  test("skips catch-up when Telegram USER_TURN started_at is open (preparing)", async () => {
    const locks: string[] = [];
    const startedAt = new Date(Date.now() - 100);
    const prisma = {
      $queryRaw: async () => [
        {
          chatId: "chat-tg-prep",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "telegram:1:session:main"
        }
      ],
      assistantWebChatTurnAttempt: {
        findFirst: async () => null
      },
      runtimeTurnReceipt: {
        findFirst: async () => null
      },
      assistantChat: {
        findUnique: async () => ({
          lastUserTurnStartedAt: startedAt,
          lastUserTurnTerminalAt: null
        })
      }
    };
    const coordinator = new ChatWakeCoordinator(
      prisma as never,
      {
        claimReadyHeadForChat: async () => {
          throw new Error("must not claim while telegram preparing");
        }
      } as never,
      {
        acquireOrCreate: async (key: string) => {
          locks.push(key);
          return { token: "lock-1" };
        },
        releaseKey: async () => undefined
      } as never
    );
    const claims = await coordinator.claimReadyCatchUps({ limit: 2, claimTtlMs: 60_000 });
    assert.deepEqual(claims, []);
    assert.deepEqual(locks, []);
  });

  test("skips catch-up when Telegram has an accepted non-async-cont receipt", async () => {
    const locks: string[] = [];
    const prisma = {
      $queryRaw: async () => [
        {
          chatId: "chat-tg",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "telegram:1:session:main"
        }
      ],
      assistantWebChatTurnAttempt: {
        findFirst: async () => null
      },
      runtimeTurnReceipt: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          assert.equal(args.where.channel, "telegram");
          assert.equal(args.where.status, "accepted");
          return { id: "receipt-1" };
        }
      },
      assistantChat: {
        findUnique: async () => ({
          lastUserTurnStartedAt: null,
          lastUserTurnTerminalAt: null
        })
      }
    };
    const coordinator = new ChatWakeCoordinator(
      prisma as never,
      {
        claimReadyHeadForChat: async () => {
          throw new Error("must not claim while telegram user turn active");
        }
      } as never,
      {
        acquireOrCreate: async (key: string) => {
          locks.push(key);
          return { token: "lock-1" };
        },
        releaseKey: async () => undefined
      } as never
    );
    const claims = await coordinator.claimReadyCatchUps({ limit: 2, claimTtlMs: 60_000 });
    assert.deepEqual(claims, []);
    assert.deepEqual(locks, []);
  });

  test("skips catch-up during durable idle-pause after user terminal", async () => {
    const locks: string[] = [];
    const terminalAt = new Date(Date.now() - 500);
    const prisma = {
      $queryRaw: async () => [
        {
          chatId: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "thread-1"
        }
      ],
      assistantWebChatTurnAttempt: {
        findFirst: async () => null
      },
      runtimeTurnReceipt: {
        findFirst: async () => null
      },
      assistantChat: {
        findUnique: async () => ({
          lastUserTurnStartedAt: terminalAt,
          lastUserTurnTerminalAt: terminalAt
        })
      }
    };
    const coordinator = new ChatWakeCoordinator(
      prisma as never,
      {
        claimReadyHeadForChat: async () => {
          throw new Error("must not claim during idle pause");
        }
      } as never,
      {
        acquireOrCreate: async (key: string) => {
          locks.push(key);
          return { token: "lock-1" };
        },
        releaseKey: async () => undefined
      } as never
    );
    assert.equal(await coordinator.isIdlePauseActive("chat-1"), true);
    assert.ok(CATCHUP_IDLE_PAUSE_MS >= 1_000 && CATCHUP_IDLE_PAUSE_MS <= 3_000);
    const claims = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.deepEqual(claims, []);
    assert.deepEqual(locks, []);
  });

  test("allows catch-up after idle-pause window elapses", async () => {
    const terminalAt = new Date(Date.now() - CATCHUP_IDLE_PAUSE_MS - 50);
    const prisma = {
      $queryRaw: async () => [
        {
          chatId: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "thread-1"
        }
      ],
      assistantWebChatTurnAttempt: {
        findFirst: async () => null
      },
      runtimeTurnReceipt: {
        findFirst: async () => null
      },
      assistantChat: {
        findUnique: async () => ({
          lastUserTurnStartedAt: terminalAt,
          lastUserTurnTerminalAt: terminalAt
        })
      }
    };
    const coordinator = new ChatWakeCoordinator(
      prisma as never,
      {
        claimReadyHeadForChat: async () => ({ id: "handle-1", claimToken: "claim-1" })
      } as never,
      {
        acquireOrCreate: async () => ({ token: "lock-1" }),
        releaseKey: async () => undefined
      } as never
    );
    assert.equal(await coordinator.isIdlePauseActive("chat-1"), false);
    const claims = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.deepEqual(claims, [
      {
        id: "handle-1",
        claimToken: "claim-1",
        chatId: "chat-1",
        lockToken: "lock-1"
      }
    ]);
  });

  test("scans beyond the old 2x window so blocked oldest chats cannot starve a later eligible chat", async () => {
    const candidates = Array.from({ length: 9 }, (_, index) => ({
      chatId: `chat-${index + 1}`,
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: `thread-${index + 1}`,
      readyAt: new Date(Date.now() + index)
    }));
    const claimed: string[] = [];
    const coordinator = new ChatWakeCoordinator(
      {
        $queryRaw: async () => candidates,
        assistantWebChatTurnAttempt: {
          findFirst: async (input: { where: { OR: Array<{ chatId: string }> } }) =>
            input.where.OR[0]?.chatId !== "chat-9" ? { id: "active-user-turn" } : null
        },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          findUnique: async () => ({
            lastUserTurnStartedAt: null,
            lastUserTurnTerminalAt: null
          })
        }
      } as never,
      {
        claimReadyHeadForChat: async ({ chatId }: { chatId: string }) => {
          claimed.push(chatId);
          return { id: "handle-later", claimToken: "claim-later" };
        }
      } as never,
      {
        acquireOrCreate: async () => ({ token: "lock-later" }),
        releaseKey: async () => undefined
      } as never
    );
    const claims = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.deepEqual(claimed, ["chat-9"]);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.chatId, "chat-9");
  });

  test("durable scan recency reaches a later eligible chat on the next bounded tick", async () => {
    const blocked = Array.from({ length: 32 }, (_, index) => ({
      chatId: `blocked-${index + 1}`,
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: `thread-blocked-${index + 1}`,
      readyAt: new Date(Date.now() + index),
      scanAt: null
    }));
    const later = {
      chatId: "later-eligible",
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-later",
      readyAt: new Date(Date.now() + 33),
      scanAt: null
    };
    let queryCalls = 0;
    const scanned: string[] = [];
    const claimed: string[] = [];
    const coordinator = new ChatWakeCoordinator(
      {
        $queryRaw: async () => {
          queryCalls += 1;
          if (queryCalls === 1) return blocked;
          if (queryCalls === 2) return [later];
          return [];
        },
        assistantWebChatTurnAttempt: {
          findFirst: async (input: { where: { OR: Array<{ chatId: string }> } }) =>
            input.where.OR[0]?.chatId.startsWith("blocked-") ? { id: "active" } : null
        },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          update: async ({ where }: { where: { id: string } }) => {
            scanned.push(where.id);
            return {};
          },
          findUnique: async () => ({
            lastUserTurnStartedAt: null,
            lastUserTurnTerminalAt: null
          })
        }
      } as never,
      {
        claimReadyHeadForChat: async ({ chatId }: { chatId: string }) => {
          claimed.push(chatId);
          return { id: "later-handle", claimToken: "later-claim" };
        }
      } as never,
      {
        acquireOrCreate: async () => ({ token: "lock" }),
        releaseKey: async () => undefined
      } as never
    );
    assert.deepEqual(await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 }), []);
    const second = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.equal(scanned.length, 33);
    assert.deepEqual(claimed, ["later-eligible"]);
    assert.equal(second[0]?.chatId, "later-eligible");
  });

  test("acquires async-catchup lock and claims one FIFO head per eligible chat", async () => {
    const acquired: string[] = [];
    const released: string[] = [];
    const prisma = {
      $queryRaw: async () => [
        {
          chatId: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "thread-1"
        }
      ],
      assistantWebChatTurnAttempt: {
        findFirst: async () => null
      },
      runtimeTurnReceipt: {
        findFirst: async () => null
      },
      assistantChat: {
        findUnique: async () => ({
          lastUserTurnStartedAt: null,
          lastUserTurnTerminalAt: null
        })
      }
    };
    const handleState = {
      claimReadyHeadForChat: async (input: { chatId: string }) => {
        assert.equal(input.chatId, "chat-1");
        return { id: "handle-1", claimToken: "claim-1" };
      }
    };
    const schedulerLease = {
      acquireOrCreate: async (key: string) => {
        acquired.push(key);
        return { token: "lock-1" };
      },
      releaseKey: async (key: string, token: string) => {
        released.push(`${key}:${token}`);
      }
    };
    const coordinator = new ChatWakeCoordinator(
      prisma as never,
      handleState as never,
      schedulerLease as never
    );
    const claims = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.deepEqual(claims, [
      {
        id: "handle-1",
        claimToken: "claim-1",
        chatId: "chat-1",
        lockToken: "lock-1"
      }
    ]);
    assert.deepEqual(acquired, ["async-catchup:chat-1"]);
    assert.deepEqual(released, []);
  });

  test("releases catch-up lock when head claim is empty", async () => {
    const released: string[] = [];
    const coordinator = new ChatWakeCoordinator(
      {
        $queryRaw: async () => [
          {
            chatId: "chat-2",
            assistantId: "assistant-1",
            userId: "user-1",
            surfaceThreadKey: "thread-2"
          }
        ],
        assistantWebChatTurnAttempt: { findFirst: async () => null },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          findUnique: async () => ({
            lastUserTurnStartedAt: null,
            lastUserTurnTerminalAt: null
          })
        }
      } as never,
      { claimReadyHeadForChat: async () => null } as never,
      {
        acquireOrCreate: async () => ({ token: "lock-2" }),
        releaseKey: async (key: string, token: string) => {
          released.push(`${key}:${token}`);
        }
      } as never
    );
    const claims = await coordinator.claimReadyCatchUps({ limit: 2, claimTtlMs: 60_000 });
    assert.deepEqual(claims, []);
    assert.deepEqual(released, ["async-catchup:chat-2:lock-2"]);
  });

  test("TOCTOU: releases lock without claim when user becomes active after lock acquire", async () => {
    let attemptCalls = 0;
    const released: string[] = [];
    const claimedHeads: string[] = [];
    const coordinator = new ChatWakeCoordinator(
      {
        $queryRaw: async () => [
          {
            chatId: "chat-1",
            assistantId: "assistant-1",
            userId: "user-1",
            surfaceThreadKey: "thread-1"
          }
        ],
        assistantWebChatTurnAttempt: {
          findFirst: async () => {
            attemptCalls += 1;
            // First gate (pre-lock) clear; post-lock gate sees user active.
            return attemptCalls >= 2 ? { id: "user-attempt" } : null;
          }
        },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          findUnique: async () => ({
            lastUserTurnStartedAt: null,
            lastUserTurnTerminalAt: null
          })
        }
      } as never,
      {
        claimReadyHeadForChat: async () => {
          claimedHeads.push("claimed");
          return { id: "handle-1", claimToken: "claim-1" };
        }
      } as never,
      {
        acquireOrCreate: async () => ({ token: "lock-1" }),
        releaseKey: async (key: string, token: string) => {
          released.push(`${key}:${token}`);
        }
      } as never
    );
    const claims = await coordinator.claimReadyCatchUps({ limit: 2, claimTtlMs: 60_000 });
    assert.deepEqual(claims, []);
    assert.deepEqual(claimedHeads, []);
    assert.deepEqual(released, ["async-catchup:chat-1:lock-1"]);
  });

  test("FIFO: at most one head claim per chat while exclusive lock is held", async () => {
    const held = new Set<string>();
    const claimCalls: string[] = [];
    const prisma = {
      $queryRaw: async () => [
        {
          chatId: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "thread-1"
        },
        {
          chatId: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          surfaceThreadKey: "thread-1"
        }
      ],
      assistantWebChatTurnAttempt: { findFirst: async () => null },
      runtimeTurnReceipt: { findFirst: async () => null },
      assistantChat: {
        findUnique: async () => ({
          lastUserTurnStartedAt: null,
          lastUserTurnTerminalAt: null
        })
      }
    };
    const schedulerLease = {
      acquireOrCreate: async (key: string) => {
        if (held.has(key)) return null;
        held.add(key);
        return { token: `lock-${held.size}` };
      },
      releaseKey: async (key: string) => {
        held.delete(key);
      }
    };
    const handleState = {
      claimReadyHeadForChat: async (input: { chatId: string }) => {
        claimCalls.push(input.chatId);
        return { id: `handle-${claimCalls.length}`, claimToken: `claim-${claimCalls.length}` };
      }
    };
    const coordinator = new ChatWakeCoordinator(
      prisma as never,
      handleState as never,
      schedulerLease as never
    );
    const first = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.chatId, "chat-1");
    // Second pass while lock still held (not released) must not claim another head.
    const second = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.deepEqual(second, []);
    assert.deepEqual(claimCalls, ["chat-1"]);
    await coordinator.releaseCatchUp("chat-1", first[0]!.lockToken);
    const third = await coordinator.claimReadyCatchUps({ limit: 4, claimTtlMs: 60_000 });
    assert.equal(third.length, 1);
    assert.deepEqual(claimCalls, ["chat-1", "chat-1"]);
  });

  test("recordUserTurnTerminal stamps assistant_chats.lastUserTurnTerminalAt", async () => {
    const updates: Array<{ id: string; at: Date }> = [];
    const coordinator = new ChatWakeCoordinator(
      {
        assistantChat: {
          update: async (args: {
            where: { id: string };
            data: { lastUserTurnTerminalAt: Date };
          }) => {
            updates.push({ id: args.where.id, at: args.data.lastUserTurnTerminalAt });
            return {};
          }
        }
      } as never,
      {} as never,
      {} as never
    );
    const at = new Date("2026-07-19T12:00:00.000Z");
    await coordinator.recordUserTurnTerminal("chat-9", at);
    assert.deepEqual(updates, [{ id: "chat-9", at }]);
  });

  test("evaluateCatchUpGate reports idle_pause vs user_turn_active", async () => {
    const coordinator = new ChatWakeCoordinator(
      {
        assistantWebChatTurnAttempt: {
          findFirst: async () => ({ id: "a1" })
        },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          findUnique: async () => ({
            lastUserTurnStartedAt: null,
            lastUserTurnTerminalAt: new Date(Date.now() - 500)
          })
        }
      } as never,
      {} as never,
      {} as never
    );
    const active = await coordinator.evaluateCatchUpGate({
      chatId: "chat-1",
      assistantId: "a",
      userId: "u",
      surfaceThreadKey: "t"
    });
    assert.deepEqual(active, { allowed: false, reason: "user_turn_active" });

    const idleOnly = new ChatWakeCoordinator(
      {
        assistantWebChatTurnAttempt: { findFirst: async () => null },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          findUnique: async () => ({
            lastUserTurnStartedAt: new Date(Date.now() - 10_000),
            lastUserTurnTerminalAt: new Date(Date.now() - 500)
          })
        }
      } as never,
      {} as never,
      {} as never
    );
    const paused = await idleOnly.evaluateCatchUpGate({
      chatId: "chat-1",
      assistantId: "a",
      userId: "u",
      surfaceThreadKey: "t"
    });
    assert.deepEqual(paused, { allowed: false, reason: "idle_pause" });

    const preparing = new ChatWakeCoordinator(
      {
        assistantWebChatTurnAttempt: { findFirst: async () => null },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          findUnique: async () => ({
            lastUserTurnStartedAt: new Date(Date.now() - 100),
            lastUserTurnTerminalAt: new Date(Date.now() - 10_000)
          })
        }
      } as never,
      {} as never,
      {} as never
    );
    const open = await preparing.evaluateCatchUpGate({
      chatId: "chat-1",
      assistantId: "a",
      userId: "u",
      surfaceThreadKey: "t"
    });
    assert.deepEqual(open, { allowed: false, reason: "user_turn_active" });
  });

  test("durable admission CAS yields to a user turn that reached the boundary first", async () => {
    let executeRawCalls = 0;
    const coordinator = new ChatWakeCoordinator(
      {
        $executeRaw: async () => {
          executeRawCalls += 1;
          // Simulates another API replica stamping USER_TURN preparing between
          // the initial read and this conditional admission mutation.
          return 0;
        },
        assistantWebChatTurnAttempt: { findFirst: async () => null },
        runtimeTurnReceipt: { findFirst: async () => null },
        assistantChat: {
          findUnique: async () => ({
            lastUserTurnStartedAt: null,
            // Fixed far-past timestamp ensures the pre-CAS idle gate always
            // passes; the asserted rejection comes only from the simulated
            // concurrent USER_TURN update at the CAS boundary.
            lastUserTurnTerminalAt: new Date("2020-01-01T00:00:00.000Z")
          })
        }
      } as never,
      {} as never,
      {} as never
    );
    const result = await coordinator.admitCatchUpAtBoundary({
      chatId: "chat-race",
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-race"
    });
    assert.equal(executeRawCalls, 1);
    assert.deepEqual(result, { allowed: false, reason: "user_turn_active" });
  });
});
