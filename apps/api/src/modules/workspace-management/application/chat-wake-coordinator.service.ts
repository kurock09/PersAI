import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AssistantAsyncJobHandleStateService } from "./assistant-async-job-handle-state.service";
import { LEASE_HEARTBEAT_INTERVAL_MS, LEASE_TTL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const CATCHUP_LOCK_PREFIX = "async-catchup:";

/**
 * ADR-159 S2 — bounded idle pause after a USER_TURN becomes terminal before
 * catch-up may acquire the per-chat lock / claim a ready head. Lets the user
 * send a follow-up without racing докат.
 * Tunable once; keep in the founder ~1–3s band.
 */
export const CATCHUP_IDLE_PAUSE_MS = 2_000;

export type CatchUpClaim = {
  id: string;
  claimToken: string;
  chatId: string;
  lockToken: string;
};

export type CatchUpGateDenial = "user_turn_active" | "idle_pause";

export type CatchUpGateResult = { allowed: true } | { allowed: false; reason: CatchUpGateDenial };

type CatchUpCandidate = {
  chatId: string;
  assistantId: string;
  userId: string;
  surfaceThreadKey: string | null;
};

/**
 * ADR-159 — per-chat serial catch-up: exclusive SchedulerLease lock
 * `async-catchup:{chatId}` + FIFO head claim + user priority + idle-pause.
 */
@Injectable()
export class ChatWakeCoordinator {
  private readonly logger = new Logger(ChatWakeCoordinator.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly handleState: AssistantAsyncJobHandleStateService,
    private readonly schedulerLease: SchedulerLeaseService
  ) {}

  catchUpLockKey(chatId: string): string {
    return `${CATCHUP_LOCK_PREFIX}${chatId}`;
  }

  catchUpHeartbeatIntervalMs(): number {
    return LEASE_HEARTBEAT_INTERVAL_MS;
  }

  idlePauseMs(): number {
    return CATCHUP_IDLE_PAUSE_MS;
  }

  /**
   * Select catch-up-eligible chats, take per-chat lock, claim at most one ready
   * head handle per chat (oldest readyAt). Skips chats with an active user turn
   * or inside the post-user idle-pause window. Re-checks the gate after lock
   * acquire (TOCTOU) before claiming the head.
   */
  async claimReadyCatchUps(input: { limit: number; claimTtlMs: number }): Promise<CatchUpClaim[]> {
    const limit = Math.max(1, Math.floor(input.limit));
    const candidates = await this.listCatchUpEligibleChats(limit * 2);
    const claimed: CatchUpClaim[] = [];
    for (const candidate of candidates) {
      if (claimed.length >= limit) break;
      const preGate = await this.evaluateCatchUpGate(candidate);
      if (!preGate.allowed) {
        this.logger.log(
          `chat_wake_skip_${preGate.reason} chatId=${candidate.chatId} assistantId=${candidate.assistantId}`
        );
        continue;
      }
      const lockKey = this.catchUpLockKey(candidate.chatId);
      const lock = await this.schedulerLease.acquireOrCreate(lockKey, { ttlMs: LEASE_TTL_MS });
      if (lock === null) continue;
      const postLockGate = await this.evaluateCatchUpGate(candidate);
      if (!postLockGate.allowed) {
        this.logger.log(
          `chat_wake_skip_${postLockGate.reason}_after_lock chatId=${candidate.chatId} assistantId=${candidate.assistantId}`
        );
        await this.schedulerLease.releaseKey(lockKey, lock.token);
        continue;
      }
      const head = await this.handleState.claimReadyHeadForChat({
        chatId: candidate.chatId,
        claimTtlMs: input.claimTtlMs
      });
      if (head === null) {
        await this.schedulerLease.releaseKey(lockKey, lock.token);
        continue;
      }
      claimed.push({
        id: head.id,
        claimToken: head.claimToken,
        chatId: candidate.chatId,
        lockToken: lock.token
      });
    }
    return claimed;
  }

  async heartbeatCatchUp(chatId: string, lockToken: string): Promise<boolean> {
    return this.schedulerLease.heartbeatKey(this.catchUpLockKey(chatId), lockToken, {
      ttlMs: LEASE_TTL_MS
    });
  }

  async releaseCatchUp(chatId: string, lockToken: string): Promise<void> {
    await this.schedulerLease.releaseKey(this.catchUpLockKey(chatId), lockToken);
  }

  /**
   * Stamp durable USER_TURN open-window origin (preparing/running). Must not
   * be called for async_continuation. Terminal stamp is separate; leave
   * started_at for idle-pause comparison (started > terminal = open).
   */
  async recordUserTurnStarted(chatId: string, at: Date = new Date()): Promise<void> {
    if (
      typeof (this.prisma.assistantChat as { update?: unknown }).update !== "function" ||
      typeof chatId !== "string" ||
      chatId.length === 0
    ) {
      return;
    }
    try {
      await this.prisma.assistantChat.update({
        where: { id: chatId },
        data: { lastUserTurnStartedAt: at }
      });
    } catch (error) {
      this.logger.warn(
        `chat_wake_record_user_started_failed chatId=${chatId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Stamp durable idle-pause origin when a USER_TURN becomes terminal
   * (completed / interrupted / failed). Must not be called for async_continuation.
   */
  async recordUserTurnTerminal(chatId: string, at: Date = new Date()): Promise<void> {
    if (
      typeof (this.prisma.assistantChat as { update?: unknown }).update !== "function" ||
      typeof chatId !== "string" ||
      chatId.length === 0
    ) {
      return;
    }
    try {
      await this.prisma.assistantChat.update({
        where: { id: chatId },
        data: { lastUserTurnTerminalAt: at }
      });
    } catch (error) {
      this.logger.warn(
        `chat_wake_record_user_terminal_failed chatId=${chatId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Combined user-priority + idle-pause gate. Call again immediately before
   * runtime accept (TOCTOU) — not only before lock / claim.
   */
  async evaluateCatchUpGate(input: CatchUpCandidate): Promise<CatchUpGateResult> {
    if (await this.isUserTurnActive(input)) {
      return { allowed: false, reason: "user_turn_active" };
    }
    if (await this.isIdlePauseActive(input.chatId)) {
      return { allowed: false, reason: "idle_pause" };
    }
    return { allowed: true };
  }

  private async listCatchUpEligibleChats(limit: number): Promise<CatchUpCandidate[]> {
    if (typeof (this.prisma as { $queryRaw?: unknown }).$queryRaw !== "function") {
      return [];
    }
    return this.prisma.$queryRaw<CatchUpCandidate[]>`
      SELECT "chatId", "assistantId", "userId", "surfaceThreadKey"
      FROM (
        SELECT DISTINCT ON ("chat_id")
          "chat_id" AS "chatId",
          "assistant_id" AS "assistantId",
          "user_id" AS "userId",
          "thread_key" AS "surfaceThreadKey",
          "ready_at" AS "readyAt"
        FROM "assistant_async_job_handles"
        WHERE "state" = 'ready'
          AND "source_finalized_at" IS NOT NULL
          AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          AND "retry_count" < "max_retries"
        ORDER BY "chat_id", "ready_at" ASC NULLS LAST, "updated_at" ASC
      ) AS eligible
      ORDER BY "readyAt" ASC NULLS LAST
      LIMIT ${Math.max(1, Math.floor(limit))}
    `;
  }

  /**
   * USER_TURN preparing/running:
   * - Durable open window: `last_user_turn_started_at` without terminal, or
   *   started after last terminal (covers Telegram pre-runtime-accept)
   * - Web: non-`async_continuation` attempt accepted/running
   * - Telegram: durable accepted RuntimeTurnReceipt on the thread whose
   *   idempotencyKey is not a catch-up `async-cont:*` key (no TG attempt row)
   */
  async isUserTurnActive(input: CatchUpCandidate): Promise<boolean> {
    if (await this.isDurableUserTurnOpen(input.chatId)) {
      return true;
    }
    if (await this.isWebUserTurnActive(input)) {
      return true;
    }
    return this.isTelegramUserTurnActive(input);
  }

  async isIdlePauseActive(chatId: string, now: Date = new Date()): Promise<boolean> {
    if (typeof (this.prisma.assistantChat as { findUnique?: unknown }).findUnique !== "function") {
      return false;
    }
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: { lastUserTurnTerminalAt: true }
    });
    const terminalAt = chat?.lastUserTurnTerminalAt;
    if (!(terminalAt instanceof Date)) {
      return false;
    }
    return now.getTime() < terminalAt.getTime() + CATCHUP_IDLE_PAUSE_MS;
  }

  /**
   * Open USER_TURN window from chat columns: started without terminal, or
   * started after the last terminal stamp.
   */
  private async isDurableUserTurnOpen(chatId: string): Promise<boolean> {
    if (typeof (this.prisma.assistantChat as { findUnique?: unknown }).findUnique !== "function") {
      return false;
    }
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: {
        lastUserTurnStartedAt: true,
        lastUserTurnTerminalAt: true
      }
    });
    const startedAt = chat?.lastUserTurnStartedAt;
    if (!(startedAt instanceof Date)) {
      return false;
    }
    const terminalAt = chat?.lastUserTurnTerminalAt;
    if (!(terminalAt instanceof Date)) {
      return true;
    }
    return startedAt.getTime() > terminalAt.getTime();
  }

  private async isWebUserTurnActive(input: CatchUpCandidate): Promise<boolean> {
    if (
      typeof (this.prisma.assistantWebChatTurnAttempt as { findFirst?: unknown }).findFirst !==
      "function"
    ) {
      return false;
    }
    const threadKey = input.surfaceThreadKey;
    const attempt = await this.prisma.assistantWebChatTurnAttempt.findFirst({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        status: { in: ["accepted", "running"] },
        NOT: { surfaceClient: "async_continuation" },
        OR: [
          { chatId: input.chatId },
          ...(threadKey !== null && threadKey.length > 0 ? [{ surfaceThreadKey: threadKey }] : [])
        ]
      },
      select: { id: true }
    });
    return attempt !== null;
  }

  /**
   * Telegram has no web turn-attempt row. An accepted RuntimeTurnReceipt for
   * the thread (non-`async-cont:*` idempotency) is the durable in-flight signal
   * after runtime accept; pre-accept races fail closed via busy → ready reclaim.
   */
  private async isTelegramUserTurnActive(input: CatchUpCandidate): Promise<boolean> {
    const threadKey = input.surfaceThreadKey;
    if (threadKey === null || threadKey.length === 0) {
      return false;
    }
    if (
      typeof (this.prisma.runtimeTurnReceipt as { findFirst?: unknown }).findFirst !== "function"
    ) {
      return false;
    }
    const receipt = await this.prisma.runtimeTurnReceipt.findFirst({
      where: {
        assistantId: input.assistantId,
        channel: "telegram",
        externalThreadKey: threadKey,
        status: "accepted",
        NOT: { idempotencyKey: { startsWith: "async-cont:" } }
      },
      select: { id: true }
    });
    return receipt !== null;
  }
}
