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
const CATCHUP_CANDIDATE_PAGE_SIZE = 32;
const CATCHUP_CANDIDATE_SCAN_CAP = 256;

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
type ScannedCatchUpCandidate = CatchUpCandidate & {
  readyAt: Date | null;
  scanAt: Date | null;
  headId: string;
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
    const candidates = await this.listCatchUpEligibleChats(limit);
    const claimed: CatchUpClaim[] = [];
    for (const candidate of candidates) {
      if (claimed.length >= limit) break;
      await this.recordCatchUpScan(candidate.chatId);
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
   * USER_TURN and JOB_CATCHUP serialize on the same chat row. A committed
   * user-side update wins over a later catch-up CAS; a catch-up whose CAS
   * committed first is already admitted and cannot be preempted retroactively.
   */
  async admitUserTurn(chatId: string, at: Date = new Date()): Promise<void> {
    if (
      typeof (this.prisma.assistantChat as { update?: unknown }).update !== "function" ||
      typeof chatId !== "string" ||
      chatId.length === 0
    ) {
      throw new Error("USER_TURN admission requires assistant_chats persistence.");
    }
    await this.prisma.assistantChat.update({
      where: { id: chatId },
      data: { lastUserTurnStartedAt: at }
    });
  }

  async abandonUserTurnAdmission(chatId: string, at: Date = new Date()): Promise<void> {
    if (
      typeof (this.prisma.assistantChat as { update?: unknown }).update !== "function" ||
      typeof chatId !== "string" ||
      chatId.length === 0
    ) {
      throw new Error("USER_TURN admission close requires assistant_chats persistence.");
    }
    await this.prisma.assistantChat.update({
      where: { id: chatId },
      data: { lastUserTurnTerminalAt: at }
    });
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

  /**
   * The successful UPDATE is the durable admission linearization boundary:
   * USER_TURNs whose preparing stamp commits first make its predicate fail;
   * a USER_TURN that begins after this CAS cannot preempt an already-admitted
   * catch-up. Runtime's session lease remains an execution guard only.
   */
  async admitCatchUpAtBoundary(input: CatchUpCandidate): Promise<CatchUpGateResult> {
    const gate = await this.evaluateCatchUpGate(input);
    if (!gate.allowed) return gate;
    const updated = await this.prisma.$executeRaw`
      UPDATE "assistant_chats"
      SET "catch_up_admission_fence" = "catch_up_admission_fence" + 1,
          "updated_at" = NOW()
      WHERE "id" = ${input.chatId}::uuid
        AND (
          "last_user_turn_started_at" IS NULL
          OR (
            "last_user_turn_terminal_at" IS NOT NULL
            AND "last_user_turn_started_at" <= "last_user_turn_terminal_at"
          )
        )
        AND (
          "last_user_turn_terminal_at" IS NULL
          OR "last_user_turn_terminal_at" <= NOW() - (${CATCHUP_IDLE_PAUSE_MS} * INTERVAL '1 millisecond')
        )
    `;
    return updated === 1 ? { allowed: true } : { allowed: false, reason: "user_turn_active" };
  }

  private async recordCatchUpScan(chatId: string, at: Date = new Date()): Promise<void> {
    if (typeof (this.prisma.assistantChat as { update?: unknown }).update !== "function") {
      return;
    }
    await this.prisma.assistantChat.update({
      where: { id: chatId },
      data: { catchUpLastScannedAt: at }
    });
  }

  private async listCatchUpEligibleChats(limit: number): Promise<CatchUpCandidate[]> {
    if (typeof (this.prisma as { $queryRaw?: unknown }).$queryRaw !== "function") {
      return [];
    }
    const wanted = Math.max(1, Math.floor(limit));
    const scanCap = Math.max(
      CATCHUP_CANDIDATE_PAGE_SIZE,
      Math.min(CATCHUP_CANDIDATE_SCAN_CAP, wanted * 8)
    );
    const candidates: CatchUpCandidate[] = [];
    const seenChatIds = new Set<string>();
    let scanned = 0;
    let cursorScanAt: Date | null = null;
    let cursorReadyAt: Date | null = null;
    let cursorChatId: string | null = null;
    let cursorHeadId: string | null = null;
    while (scanned < scanCap) {
      const pageSize = Math.min(CATCHUP_CANDIDATE_PAGE_SIZE, scanCap - scanned);
      const page: ScannedCatchUpCandidate[] = await this.prisma.$queryRaw<
        ScannedCatchUpCandidate[]
      >`
      SELECT "chatId", "assistantId", "userId", "surfaceThreadKey", "readyAt", "scanAt", "headId"
      FROM (
        SELECT DISTINCT ON ("chat_id")
          "chat_id" AS "chatId",
          "assistant_id" AS "assistantId",
          "user_id" AS "userId",
          "thread_key" AS "surfaceThreadKey",
          "ready_at" AS "readyAt",
          c."catch_up_last_scanned_at" AS "scanAt",
          "id" AS "headId"
        FROM "assistant_async_job_handles"
        INNER JOIN "assistant_chats" c ON c."id" = "assistant_async_job_handles"."chat_id"
        WHERE "state" = 'ready'
          AND "source_finalized_at" IS NOT NULL
          AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          AND "retry_count" < "max_retries"
        ORDER BY "chat_id", "ready_at" ASC NULLS LAST, "updated_at" ASC, "id" ASC
      ) AS eligible
      WHERE (
        ${cursorChatId}::uuid IS NULL
        OR (
          COALESCE("scanAt", '-infinity'::timestamptz),
          COALESCE("readyAt", 'infinity'::timestamptz),
          "chatId", "headId"
        ) > (
          COALESCE(${cursorScanAt}::timestamptz, '-infinity'::timestamptz),
          COALESCE(${cursorReadyAt}::timestamptz, 'infinity'::timestamptz),
          ${cursorChatId}::uuid, ${cursorHeadId}::uuid
        )
      )
      ORDER BY "scanAt" ASC NULLS FIRST, "readyAt" ASC NULLS LAST, "chatId" ASC, "headId" ASC
      LIMIT ${pageSize}
    `;
      if (page.length === 0) break;
      for (const { readyAt: _readyAt, scanAt: _scanAt, headId: _headId, ...candidate } of page) {
        if (!seenChatIds.has(candidate.chatId)) {
          seenChatIds.add(candidate.chatId);
          candidates.push(candidate);
        }
      }
      scanned += page.length;
      const last = page[page.length - 1]!;
      cursorScanAt = last.scanAt;
      cursorReadyAt = last.readyAt;
      cursorChatId = last.chatId;
      cursorHeadId = last.headId;
      if (page.length < pageSize) break;
    }
    return candidates;
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
