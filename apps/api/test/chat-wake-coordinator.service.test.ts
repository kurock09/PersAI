import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CATCHUP_IDLE_PAUSE_MS,
  ChatWakeCoordinator
} from "../src/modules/workspace-management/application/chat-wake-coordinator.service";

describe("ChatWakeCoordinator", () => {
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

  test("recordUserTurnStarted stamps assistant_chats.lastUserTurnStartedAt", async () => {
    const updates: Array<{ id: string; at: Date }> = [];
    const coordinator = new ChatWakeCoordinator(
      {
        assistantChat: {
          update: async (args: {
            where: { id: string };
            data: { lastUserTurnStartedAt: Date };
          }) => {
            updates.push({ id: args.where.id, at: args.data.lastUserTurnStartedAt });
            return {};
          }
        }
      } as never,
      {} as never,
      {} as never
    );
    const at = new Date("2026-07-19T11:59:00.000Z");
    await coordinator.recordUserTurnStarted("chat-9", at);
    assert.deepEqual(updates, [{ id: "chat-9", at }]);
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
});
