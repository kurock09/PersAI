import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  assertActiveBackgroundJobCap,
  type AssertActiveBackgroundJobCapOptions
} from "./assert-active-background-job-cap";
import { SandboxControlPlaneClientService } from "./sandbox-control-plane.client.service";
import { toWebNotifyState, type AssistantWebChatActiveSandboxJobState } from "./web-chat.types";

export const MAX_ASYNC_CONTINUATION_DEPTH = 4;
export const ASYNC_CONTINUATION_MAX_RETRIES = 8;

/** Chat-scoped active-job admission (media/document/sandbox, including foreground). */
export async function assertChatBackgroundJobCap(
  prisma: { $transaction: WorkspaceManagementPrismaService["$transaction"] },
  chatId: string,
  options?: AssertActiveBackgroundJobCapOptions
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveBackgroundJobCap(tx, chatId, options);
  });
}

/** Honest opaque user-visible copy for permanent continuation failure. */
export const ASYNC_CONTINUATION_PERMANENT_FAILURE_TEXT =
  "I couldn't complete the follow-up update for this job.";

export type PermanentFailureObservation = {
  handleId: string;
  assistantMessageId: string;
  channel: "web" | "telegram";
  assistantId: string;
  workspaceId: string;
  chatId: string;
};

export type FailClaimResult = {
  applied: boolean;
  observation: PermanentFailureObservation | null;
};

export type AsyncJobTerminalStatus = "completed" | "failed" | "cancelled";
export type AsyncJobNarrationOwner = "current_turn" | "continuation" | "legacy";
export type AsyncJobDeliveryDecision = "legacy_frame" | "skip_legacy_frame";

export type SandboxTerminalResult = {
  toolCode: "shell" | "exec";
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  paths: string[];
};

type LockedHandle = {
  id: string;
  kind: "media" | "document" | "sandbox";
  canonicalJobId: string;
  state: string;
  narrationOwner: AsyncJobNarrationOwner | null;
  narrationDecision: string | null;
  sourceFinalizedAt: Date | null;
  runtimeSessionId: string | null;
  continuationDepth: number;
  continuationClientTurnId: string | null;
  claimToken: string | null;
  retryCount: number;
  maxRetries: number;
  lastErrorCode: string | null;
};

export type ObserveTerminalOutcome =
  | {
      outcome: "pending";
      jobRef: string;
      kind: "media" | "document" | "sandbox";
    }
  | {
      outcome: "claimed_current_turn" | "already_owned";
      owner: AsyncJobNarrationOwner;
      jobRef: string;
      kind: "media" | "document" | "sandbox";
      status: AsyncJobTerminalStatus;
      errorCode: string | null;
      message: string;
      sandboxResult: SandboxTerminalResult | null;
    }
  | { outcome: "not_found" };

export type SubscribePendingOutcome =
  | { outcome: "subscribed"; continuationClientTurnId: string; duplicate: boolean }
  | {
      outcome: "terminal_inline";
      kind: "media" | "document" | "sandbox";
      status: AsyncJobTerminalStatus;
      errorCode: string | null;
      message: string;
      sandboxResult: SandboxTerminalResult | null;
    }
  | { outcome: "depth_exhausted" }
  | { outcome: "already_owned"; owner: AsyncJobNarrationOwner }
  | { outcome: "not_found" };

@Injectable()
export class AssistantAsyncJobHandleStateService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Optional()
    private readonly sandboxControlPlane?: SandboxControlPlaneClientService
  ) {}

  async listOwnedSnapshotJobRefs(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram";
    threadKey: string;
    sourceClientTurnId: string;
  }): Promise<{ overflow: boolean; jobRefs: string[] }> {
    const rows = await this.prisma.assistantAsyncJobHandle.findMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        channel: input.channel,
        threadKey: input.threadKey,
        chat: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          surface: input.channel,
          surfaceThreadKey: input.threadKey
        },
        OR: [
          { sourceClientTurnId: input.sourceClientTurnId },
          { state: { in: ["none", "subscribed", "ready", "claimed", "dispatched"] } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 96,
      select: {
        jobRef: true,
        kind: true,
        canonicalJobId: true,
        sourceClientTurnId: true
      }
    });
    await this.refreshSandboxJobs(
      rows.filter((row) => row.kind === "sandbox").map((row) => row.canonicalJobId)
    );
    const nonCurrent = rows.filter((row) => row.sourceClientTurnId !== input.sourceClientTurnId);
    const openCanonicalKeys = await this.selectCurrentlyOpenCanonicalKeys(nonCurrent);
    const filtered = rows.filter(
      (row) =>
        row.sourceClientTurnId === input.sourceClientTurnId ||
        openCanonicalKeys.has(`${row.kind}:${row.canonicalJobId}`)
    );
    return {
      overflow: filtered.length > 32,
      jobRefs: filtered.slice(0, 32).map((row) => row.jobRef)
    };
  }

  async listOpenSandboxJobsForWebChat(input: {
    assistantId: string;
    chatId: string;
  }): Promise<AssistantWebChatActiveSandboxJobState[]> {
    // Keep Working + history poll alive through continuation: include handles
    // still subscribed/ready/claimed/dispatched (and briefly failed/cancelled)
    // even after the canonical SandboxJob leaves queued|running|detached.
    const continuationCutoff = new Date(Date.now() - 5 * 60_000);
    const rows = await this.prisma.assistantAsyncJobHandle.findMany({
      where: {
        assistantId: input.assistantId,
        chatId: input.chatId,
        kind: "sandbox",
        OR: [
          { state: { in: ["none", "subscribed", "ready", "claimed", "dispatched"] } },
          {
            state: { in: ["failed", "cancelled"] },
            updatedAt: { gte: continuationCutoff }
          }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 8,
      select: {
        jobRef: true,
        state: true,
        createdAt: true,
        updatedAt: true,
        canonicalJobId: true,
        continuationClientTurnId: true
      }
    });
    // Detached SandboxJob rows stay pending in DB until sandbox poll/inspect
    // finalizes them. Refresh on Working/history reads so the pill cannot
    // linger after the pod process is already gone.
    await this.refreshSandboxJobs(rows.map((row) => row.canonicalJobId));
    const jobs = await this.prisma.sandboxJob.findMany({
      where: {
        id: { in: rows.map((row) => row.canonicalJobId) },
        toolCode: { in: ["shell", "exec"] }
      },
      select: { id: true, toolCode: true, status: true, startedAt: true }
    });
    const byId = new Map(jobs.map((job) => [job.id, job]));
    return rows.flatMap((row) => {
      const job = byId.get(row.canonicalJobId);
      if (job === undefined || (job.toolCode !== "shell" && job.toolCode !== "exec")) {
        return [];
      }
      const jobOpen =
        job.status === "queued" || job.status === "running" || job.status === "detached";
      const handleHoldsObservation =
        row.state === "subscribed" ||
        row.state === "ready" ||
        row.state === "claimed" ||
        row.state === "dispatched" ||
        row.state === "failed" ||
        row.state === "cancelled";
      if (!jobOpen && !handleHoldsObservation) {
        return [];
      }
      const status: AssistantWebChatActiveSandboxJobState["status"] =
        job.status === "queued" || job.status === "running" || job.status === "detached"
          ? job.status
          : "detached";
      const continuationClientTurnId =
        row.continuationClientTurnId !== null &&
        (row.state === "subscribed" ||
          row.state === "ready" ||
          row.state === "claimed" ||
          row.state === "dispatched")
          ? row.continuationClientTurnId
          : undefined;
      return [
        {
          jobRef: row.jobRef,
          toolCode: job.toolCode,
          status,
          notifyState: toWebNotifyState(row.state),
          createdAt: row.createdAt.toISOString(),
          startedAt: job.startedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
          ...(continuationClientTurnId === undefined ? {} : { continuationClientTurnId })
        }
      ];
    });
  }

  async registerSandboxJob(input: {
    canonicalJobId: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram";
    threadKey: string;
    sourceClientTurnId: string;
    sourceUserMessageId: string;
    runtimeRequestId: string;
    runtimeSessionId: string;
    toolCode: "shell" | "exec";
  }): Promise<{ registered: true; jobRef: string } | { registered: false }> {
    return this.prisma.$transaction(async (tx) => {
      const [chat, job, sourceMessage, runtimeSession] = await Promise.all([
        tx.assistantChat.findFirst({
          where: {
            id: input.chatId,
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            surface: input.channel,
            surfaceThreadKey: input.threadKey
          },
          select: { userId: true }
        }),
        tx.sandboxJob.findFirst({
          where: {
            id: input.canonicalJobId,
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            runtimeRequestId: input.runtimeRequestId,
            runtimeSessionId: input.runtimeSessionId,
            toolCode: input.toolCode,
            status: "detached"
          },
          select: { id: true, status: true }
        }),
        tx.assistantChatMessage.findFirst({
          where: {
            id: input.sourceUserMessageId,
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: "user"
          },
          select: { id: true }
        }),
        tx.runtimeSession.findFirst({
          where: {
            id: input.runtimeSessionId,
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            channel: input.channel,
            externalThreadKey: input.threadKey,
            closedAt: null
          },
          select: { id: true }
        })
      ]);
      if (
        chat === null ||
        job === null ||
        sourceMessage === null ||
        runtimeSession === null ||
        input.sourceClientTurnId.length === 0
      ) {
        return { registered: false };
      }
      const existing = await tx.assistantAsyncJobHandle.findUnique({
        where: {
          kind_canonicalJobId: { kind: "sandbox", canonicalJobId: input.canonicalJobId }
        },
        select: { jobRef: true }
      });
      if (existing !== null) return { registered: true, jobRef: existing.jobRef };
      await assertActiveBackgroundJobCap(tx, input.chatId, {
        excludeSandboxJobId: input.canonicalJobId
      });
      const created = await tx.assistantAsyncJobHandle.create({
        data: {
          jobRef: `jr1.sandbox.${randomBytes(24).toString("base64url")}`,
          kind: "sandbox",
          canonicalJobId: input.canonicalJobId,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          userId: chat.userId,
          chatId: input.chatId,
          channel: input.channel,
          threadKey: input.threadKey,
          sourceClientTurnId: input.sourceClientTurnId,
          sourceUserMessageId: input.sourceUserMessageId,
          runtimeSessionId: input.runtimeSessionId
        },
        select: { jobRef: true }
      });
      return { registered: true, jobRef: created.jobRef };
    });
  }

  async observeForCurrentTurn(input: {
    jobRef: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram";
    threadKey: string;
  }): Promise<ObserveTerminalOutcome> {
    // Refresh before the ownership transaction so await wait/status sees
    // post-exit detached→terminal truth instead of stale pending forever.
    await this.refreshOwnedSandboxJob(input);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockOwned(tx, input);
      if (row === null) return { outcome: "not_found" };
      const canonical = await this.readCanonical(tx, row);
      if (canonical === null) return { outcome: "not_found" };
      if (canonical.status === "pending") {
        return {
          outcome: "pending",
          jobRef: input.jobRef,
          kind: row.kind
        };
      }
      const terminal = canonical as {
        status: AsyncJobTerminalStatus;
        errorCode: string | null;
        message: string;
        sandboxResult: SandboxTerminalResult | null;
      };
      if (row.narrationOwner !== null) {
        // Observe path must finalize open handles (esp. sandbox state=none) so
        // completed unobserved jobs do not linger and reappear in later snapshots.
        await this.finalizeTerminalHandleInTx(tx, row, terminal);
        return {
          outcome: "already_owned",
          owner: row.narrationOwner,
          jobRef: input.jobRef,
          kind: row.kind,
          ...terminal
        };
      }
      const now = new Date();
      await tx.assistantAsyncJobHandle.update({
        where: { id: row.id },
        data: {
          narrationOwner: "current_turn",
          narrationDecision: "current_turn_inline",
          narrationDecisionAt: now,
          terminalObservedAt: now,
          terminalSnapshotJson: terminal,
          ...this.terminalStateData(terminal.status, now)
        }
      });
      return {
        outcome: "claimed_current_turn",
        owner: "current_turn",
        jobRef: input.jobRef,
        kind: row.kind,
        ...terminal
      };
    });
  }

  async subscribePending(input: {
    jobRef: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram";
    threadKey: string;
  }): Promise<SubscribePendingOutcome> {
    await this.refreshOwnedSandboxJob(input);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockOwned(tx, input);
      if (row === null) return { outcome: "not_found" };
      const canonical = await this.readCanonical(tx, row);
      if (canonical === null) return { outcome: "not_found" };
      if (
        row.narrationDecision === "continuation_depth_exhausted" ||
        (row.state === "failed" && row.lastErrorCode === "continuation_depth_exhausted")
      ) {
        return { outcome: "depth_exhausted" };
      }
      if (row.narrationOwner === "continuation" && row.narrationDecision === "notify_subscribed") {
        return {
          outcome: "subscribed",
          continuationClientTurnId:
            row.continuationClientTurnId ?? this.continuationClientTurnId(row.id),
          duplicate: true
        };
      }
      if (row.narrationOwner !== null) {
        return { outcome: "already_owned", owner: row.narrationOwner };
      }
      if (canonical.status !== "pending") {
        const terminal = canonical as {
          status: AsyncJobTerminalStatus;
          errorCode: string | null;
          message: string;
          sandboxResult: SandboxTerminalResult | null;
        };
        const now = new Date();
        await tx.assistantAsyncJobHandle.update({
          where: { id: row.id },
          data: {
            narrationOwner: "current_turn",
            narrationDecision: "current_turn_inline",
            narrationDecisionAt: now,
            terminalObservedAt: now,
            terminalSnapshotJson: terminal,
            ...this.terminalStateData(terminal.status, now)
          }
        });
        return {
          outcome: "terminal_inline",
          kind: row.kind,
          ...terminal
        };
      }
      if (row.sourceFinalizedAt !== null) {
        return { outcome: "already_owned", owner: "legacy" };
      }
      if (row.continuationDepth >= MAX_ASYNC_CONTINUATION_DEPTH) {
        const now = new Date();
        await tx.assistantAsyncJobHandle.update({
          where: { id: row.id },
          data: {
            narrationOwner: "continuation",
            narrationDecision: "continuation_depth_exhausted",
            narrationDecisionAt: now,
            state: "failed",
            failedAt: now,
            lastErrorCode: "continuation_depth_exhausted",
            lastErrorMessage: "The unattended continuation depth limit was reached."
          }
        });
        return { outcome: "depth_exhausted" };
      }
      const now = new Date();
      const continuationClientTurnId = this.continuationClientTurnId(row.id);
      await tx.assistantAsyncJobHandle.update({
        where: { id: row.id },
        data: {
          narrationOwner: "continuation",
          narrationDecision: "notify_subscribed",
          narrationDecisionAt: now,
          continuationClientTurnId,
          state: "subscribed",
          maxRetries: ASYNC_CONTINUATION_MAX_RETRIES
        }
      });
      return { outcome: "subscribed", continuationClientTurnId, duplicate: false };
    });
  }

  async finalizeSourceTurn(input: {
    assistantId: string;
    chatId: string;
    sourceClientTurnId: string;
    outcome: "persisted" | "failed" | "stopped";
    assistantMessageId?: string;
  }): Promise<{
    finalized: number;
    legacyChosen: number;
    currentTurnPreserved: number;
    currentTurnReleased: number;
  }> {
    return this.prisma.$transaction(async (tx) => {
      if (input.outcome === "persisted") {
        if (input.assistantMessageId === undefined) {
          throw new Error("Persisted source-turn finalization requires assistantMessageId.");
        }
        const message = await tx.assistantChatMessage.findFirst({
          where: {
            id: input.assistantMessageId,
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: "assistant"
          },
          select: { id: true }
        });
        if (message === null) {
          throw new Error("Persisted source-turn assistant output could not be proven.");
        }
      }
      const now = new Date();
      const finalized = await tx.assistantAsyncJobHandle.updateMany({
        where: {
          assistantId: input.assistantId,
          chatId: input.chatId,
          sourceClientTurnId: input.sourceClientTurnId,
          sourceFinalizedAt: null
        },
        data: { sourceFinalizedAt: now }
      });
      const released =
        input.outcome === "persisted"
          ? { count: 0 }
          : await tx.assistantAsyncJobHandle.updateMany({
              where: {
                assistantId: input.assistantId,
                chatId: input.chatId,
                sourceClientTurnId: input.sourceClientTurnId,
                narrationOwner: "current_turn"
              },
              data: {
                narrationOwner: "legacy",
                narrationDecision: "legacy_completion",
                narrationDecisionAt: now,
                lastErrorCode:
                  input.outcome === "stopped"
                    ? "current_turn_stopped_before_persistence"
                    : "current_turn_failed_before_persistence",
                lastErrorMessage:
                  "Current-turn narration was released because durable assistant output was not proven."
              }
            });
      const legacy = await tx.assistantAsyncJobHandle.updateMany({
        where: {
          assistantId: input.assistantId,
          chatId: input.chatId,
          sourceClientTurnId: input.sourceClientTurnId,
          narrationOwner: null
        },
        data: {
          narrationOwner: "legacy",
          narrationDecision: "legacy_completion",
          narrationDecisionAt: now
        }
      });
      const preserved =
        input.outcome !== "persisted"
          ? 0
          : await tx.assistantAsyncJobHandle.count({
              where: {
                assistantId: input.assistantId,
                chatId: input.chatId,
                sourceClientTurnId: input.sourceClientTurnId,
                narrationOwner: "current_turn"
              }
            });
      return {
        finalized: finalized.count,
        legacyChosen: legacy.count,
        currentTurnPreserved: preserved,
        currentTurnReleased: released.count
      };
    });
  }

  async prepareDelivery(input: {
    kind: "media" | "document" | "sandbox";
    canonicalJobId: string;
  }): Promise<AsyncJobDeliveryDecision> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockCanonical(tx, input);
      if (row === null) return "legacy_frame";
      if (row.narrationOwner === "legacy") return "legacy_frame";
      // ADR-157: unresolved narration must not block artifact delivery. Bytes
      // proceed with skip_legacy_frame; chat-model / continuation owns text.
      return "skip_legacy_frame";
    });
  }

  async recordCanonicalCompletion(input: {
    kind: "media" | "document" | "sandbox";
    canonicalJobId: string;
    terminalStatus: AsyncJobTerminalStatus;
    terminalSnapshot: Prisma.InputJsonValue;
  }): Promise<{ decision: AsyncJobDeliveryDecision; state: string }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockCanonical(tx, input);
      if (row === null) return { decision: "legacy_frame", state: input.terminalStatus };
      const now = new Date();
      const decision: AsyncJobDeliveryDecision =
        row.narrationOwner === "legacy" ? "legacy_frame" : "skip_legacy_frame";
      const continuationReady =
        row.narrationOwner === "continuation" &&
        row.narrationDecision === "notify_subscribed" &&
        row.state !== "failed";
      const terminalData = continuationReady
        ? {
            state: "ready" as const,
            readyAt: now,
            nextRetryAt: now,
            terminalObservedAt: now
          }
        : this.terminalStateData(input.terminalStatus, now);
      await tx.assistantAsyncJobHandle.update({
        where: { id: row.id },
        data: {
          terminalSnapshotJson: input.terminalSnapshot,
          ...terminalData
        }
      });
      return { decision, state: terminalData.state };
    });
  }

  async claimReady(input: {
    limit: number;
    claimTtlMs: number;
  }): Promise<Array<{ id: string; claimToken: string }>> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "assistant_async_job_handles"
        WHERE "state" = 'ready'
          AND "source_finalized_at" IS NOT NULL
          AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          AND "retry_count" < "max_retries"
        ORDER BY "ready_at" ASC NULLS LAST, "updated_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(input.limit))}
      `);
      const now = new Date();
      const expires = new Date(now.getTime() + input.claimTtlMs);
      const claimed: Array<{ id: string; claimToken: string }> = [];
      for (const row of rows) {
        const claimToken = randomUUID();
        await tx.assistantAsyncJobHandle.update({
          where: { id: row.id },
          data: {
            state: "claimed",
            claimToken,
            claimedAt: now,
            claimExpiresAt: expires
          }
        });
        claimed.push({ id: row.id, claimToken });
      }
      return claimed;
    });
  }

  async markDispatched(input: {
    id: string;
    claimToken: string;
    receiptRequestId: string;
    dispatchExpiresAt: Date;
  }): Promise<boolean> {
    const result = await this.prisma.assistantAsyncJobHandle.updateMany({
      where: { id: input.id, state: "claimed", claimToken: input.claimToken },
      data: {
        state: "dispatched",
        dispatchedAt: new Date(),
        dispatchReceiptRequestId: input.receiptRequestId,
        claimExpiresAt: input.dispatchExpiresAt
      }
    });
    return result.count === 1;
  }

  async requeueBusyNotStarted(input: {
    id: string;
    claimToken: string;
    receiptRequestId: string;
    retryAt: Date;
  }): Promise<"requeued" | "lost"> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedHandle[]>(Prisma.sql`
        SELECT "id", "state"::text AS "state", "narration_owner" AS "narrationOwner",
          "narration_decision" AS "narrationDecision",
          "source_finalized_at" AS "sourceFinalizedAt",
          "continuation_depth" AS "continuationDepth",
          "continuation_client_turn_id" AS "continuationClientTurnId",
          "claim_token" AS "claimToken", "retry_count" AS "retryCount",
          "max_retries" AS "maxRetries"
        FROM "assistant_async_job_handles"
        WHERE "id" = ${input.id}::uuid
          AND "state" = 'dispatched'
          AND "claim_token" = ${input.claimToken}
          AND "dispatch_receipt_request_id" = ${input.receiptRequestId}
        FOR UPDATE
      `);
      const row = rows[0];
      if (row === undefined) return "lost";
      // Busy-before-acceptance must not consume the continuation retry budget.
      await tx.assistantAsyncJobHandle.update({
        where: { id: row.id },
        data: {
          state: "ready",
          claimToken: null,
          claimedAt: null,
          claimExpiresAt: null,
          dispatchedAt: null,
          dispatchReceiptRequestId: null,
          nextRetryAt: input.retryAt,
          lastErrorCode: "continuation_busy",
          lastErrorMessage:
            "Runtime rejected the continuation before acceptance because the session was busy."
        }
      });
      return "requeued";
    });
  }

  async claimDeliveryAttempt(input: {
    id: string;
    claimToken: string;
    kind: "artifacts" | "external";
  }): Promise<"claimed" | "already_attempted" | "lost"> {
    const attemptedField =
      input.kind === "artifacts"
        ? "continuation_artifacts_attempted_at"
        : "continuation_external_attempted_at";
    const resultField =
      input.kind === "artifacts" ? "continuation_artifacts_result" : "continuation_external_result";
    const rows = await this.prisma.$queryRaw<Array<{ outcome: string }>>(Prisma.sql`
      WITH target AS (
        SELECT "id", ${Prisma.raw(`"${attemptedField}"`)} AS "attemptedAt"
        FROM "assistant_async_job_handles"
        WHERE "id" = ${input.id}::uuid
          AND "state" = 'dispatched'
          AND "claim_token" = ${input.claimToken}
        FOR UPDATE
      ), claimed AS (
        UPDATE "assistant_async_job_handles" h
        SET ${Prisma.raw(`"${attemptedField}"`)} = NOW(),
            ${Prisma.raw(`"${resultField}"`)} = 'attempting',
            "updated_at" = NOW()
        FROM target
        WHERE h."id" = target."id" AND target."attemptedAt" IS NULL
        RETURNING h."id"
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM claimed) THEN 'claimed'
        WHEN EXISTS (SELECT 1 FROM target) THEN 'already_attempted'
        ELSE 'lost'
      END AS "outcome"
    `);
    const outcome = rows[0]?.outcome;
    return outcome === "claimed" || outcome === "already_attempted" ? outcome : "lost";
  }

  async recordDeliveryAttemptResult(input: {
    id: string;
    claimToken: string;
    kind: "artifacts" | "external";
    result: "delivered" | "failed" | "ambiguous" | "not_needed";
    error?: string;
  }): Promise<boolean> {
    const data =
      input.kind === "artifacts"
        ? {
            continuationArtifactsResult: input.result,
            continuationArtifactsError: input.error?.slice(0, 1000) ?? null,
            ...(input.result === "delivered" || input.result === "not_needed"
              ? { continuationArtifactsDeliveredAt: new Date() }
              : {})
          }
        : {
            continuationExternalResult: input.result,
            continuationExternalError: input.error?.slice(0, 1000) ?? null
          };
    const result = await this.prisma.assistantAsyncJobHandle.updateMany({
      where: { id: input.id, state: "dispatched", claimToken: input.claimToken },
      data
    });
    return result.count === 1;
  }

  async requeueClaim(input: {
    id: string;
    claimToken: string;
    retryAt: Date;
    errorCode: string;
    errorMessage: string;
    dispatchedProof?: { receiptAbsent: boolean; leaseAbsent: boolean; outputAbsent: boolean };
  }): Promise<"requeued" | "exhausted" | "ambiguous" | "lost"> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          state: string;
          claimToken: string | null;
          retryCount: number;
          maxRetries: number;
          assistantId: string;
          workspaceId: string;
          chatId: string;
          channel: "web" | "telegram";
          continuationClientTurnId: string | null;
          continuationAssistantMessageId: string | null;
        }>
      >(Prisma.sql`
        SELECT "id", "state"::text AS "state",
          "claim_token" AS "claimToken", "retry_count" AS "retryCount",
          "max_retries" AS "maxRetries",
          "assistant_id" AS "assistantId",
          "workspace_id" AS "workspaceId",
          "chat_id" AS "chatId",
          "channel"::text AS "channel",
          "continuation_client_turn_id" AS "continuationClientTurnId",
          "continuation_assistant_message_id" AS "continuationAssistantMessageId"
        FROM "assistant_async_job_handles"
        WHERE "id" = ${input.id}::uuid
        FOR UPDATE
      `);
      const row = rows[0];
      if (row === undefined || row.claimToken !== input.claimToken) return "lost";
      if (row.state === "dispatched") {
        const proof = input.dispatchedProof;
        if (
          proof === undefined ||
          !proof.receiptAbsent ||
          !proof.leaseAbsent ||
          !proof.outputAbsent
        ) {
          return "ambiguous";
        }
      } else if (row.state !== "claimed") {
        return "lost";
      }
      const retryCount = row.retryCount + 1;
      const exhausted = retryCount >= row.maxRetries;
      const messageId = exhausted
        ? await this.persistPermanentFailureMessage(tx, row)
        : row.continuationAssistantMessageId;
      await tx.assistantAsyncJobHandle.update({
        where: { id: row.id },
        data: exhausted
          ? {
              state: "failed",
              failedAt: new Date(),
              retryCount,
              claimToken: null,
              claimExpiresAt: null,
              nextRetryAt: null,
              lastErrorCode: "continuation_retry_exhausted",
              lastErrorMessage: input.errorMessage,
              continuationAssistantMessageId: messageId
            }
          : {
              state: "ready",
              retryCount,
              claimToken: null,
              claimedAt: null,
              claimExpiresAt: null,
              nextRetryAt: input.retryAt,
              lastErrorCode: input.errorCode,
              lastErrorMessage: input.errorMessage
            }
      });
      return exhausted ? "exhausted" : "requeued";
    });
  }

  async completeClaim(input: { id: string; claimToken: string }): Promise<boolean> {
    const result = await this.prisma.assistantAsyncJobHandle.updateMany({
      where: { id: input.id, state: "dispatched", claimToken: input.claimToken },
      data: {
        state: "completed",
        completedAt: new Date(),
        claimToken: null,
        claimExpiresAt: null,
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });
    return result.count === 1;
  }

  async failClaim(input: {
    id: string;
    claimToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<FailClaimResult> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          state: string;
          claimToken: string | null;
          assistantId: string;
          workspaceId: string;
          chatId: string;
          channel: "web" | "telegram";
          continuationClientTurnId: string | null;
          continuationAssistantMessageId: string | null;
        }>
      >(Prisma.sql`
        SELECT "id", "state"::text AS "state",
          "claim_token" AS "claimToken",
          "assistant_id" AS "assistantId",
          "workspace_id" AS "workspaceId",
          "chat_id" AS "chatId",
          "channel"::text AS "channel",
          "continuation_client_turn_id" AS "continuationClientTurnId",
          "continuation_assistant_message_id" AS "continuationAssistantMessageId"
        FROM "assistant_async_job_handles"
        WHERE "id" = ${input.id}::uuid
        FOR UPDATE
      `);
      const row = rows[0];
      if (row === undefined) {
        return { applied: false, observation: null };
      }
      if (
        row.state === "failed" &&
        row.continuationAssistantMessageId !== null &&
        (row.channel === "web" || row.channel === "telegram")
      ) {
        // Idempotent: observation already persisted; callers may still deliver Telegram once.
        return {
          applied: true,
          observation: {
            handleId: row.id,
            assistantMessageId: row.continuationAssistantMessageId,
            channel: row.channel,
            assistantId: row.assistantId,
            workspaceId: row.workspaceId,
            chatId: row.chatId
          }
        };
      }
      if (
        row.claimToken !== input.claimToken ||
        (row.state !== "claimed" && row.state !== "dispatched") ||
        (row.channel !== "web" && row.channel !== "telegram")
      ) {
        return { applied: false, observation: null };
      }
      const messageId = await this.persistPermanentFailureMessage(tx, row);
      await tx.assistantAsyncJobHandle.update({
        where: { id: row.id },
        data: {
          state: "failed",
          failedAt: new Date(),
          claimToken: null,
          claimExpiresAt: null,
          nextRetryAt: null,
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage,
          continuationAssistantMessageId: messageId
        }
      });
      return {
        applied: true,
        observation: {
          handleId: row.id,
          assistantMessageId: messageId,
          channel: row.channel,
          assistantId: row.assistantId,
          workspaceId: row.workspaceId,
          chatId: row.chatId
        }
      };
    });
  }

  async getPermanentFailureObservation(
    handleId: string
  ): Promise<PermanentFailureObservation | null> {
    const row = await this.prisma.assistantAsyncJobHandle.findUnique({
      where: { id: handleId },
      select: {
        id: true,
        state: true,
        channel: true,
        assistantId: true,
        workspaceId: true,
        chatId: true,
        continuationAssistantMessageId: true
      }
    });
    if (
      row === null ||
      row.state !== "failed" ||
      row.continuationAssistantMessageId === null ||
      (row.channel !== "web" && row.channel !== "telegram")
    ) {
      return null;
    }
    return {
      handleId: row.id,
      assistantMessageId: row.continuationAssistantMessageId,
      channel: row.channel,
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      chatId: row.chatId
    };
  }

  async claimFailedHandleExternalNotice(handleId: string): Promise<boolean> {
    const result = await this.prisma.assistantAsyncJobHandle.updateMany({
      where: {
        id: handleId,
        state: "failed",
        channel: "telegram",
        continuationExternalAttemptedAt: null,
        continuationAssistantMessageId: { not: null }
      },
      data: {
        continuationExternalAttemptedAt: new Date(),
        continuationExternalResult: "attempting"
      }
    });
    return result.count === 1;
  }

  async recordFailedHandleExternalNoticeResult(input: {
    id: string;
    result: "delivered" | "failed" | "ambiguous";
    error?: string;
  }): Promise<boolean> {
    const result = await this.prisma.assistantAsyncJobHandle.updateMany({
      where: {
        id: input.id,
        state: "failed",
        continuationExternalResult: "attempting"
      },
      data: {
        continuationExternalResult: input.result,
        continuationExternalError: input.error?.slice(0, 1000) ?? null
      }
    });
    return result.count === 1;
  }

  private async persistPermanentFailureMessage(
    tx: Prisma.TransactionClient,
    row: {
      chatId: string;
      assistantId: string;
      continuationClientTurnId: string | null;
      continuationAssistantMessageId: string | null;
    }
  ): Promise<string> {
    if (row.continuationAssistantMessageId !== null) {
      return row.continuationAssistantMessageId;
    }
    const message = await tx.assistantChatMessage.create({
      data: {
        chatId: row.chatId,
        assistantId: row.assistantId,
        author: "assistant",
        content: ASYNC_CONTINUATION_PERMANENT_FAILURE_TEXT,
        metadata: {
          ...(row.continuationClientTurnId === null
            ? {}
            : { asyncContinuationClientTurnId: row.continuationClientTurnId }),
          asyncContinuationPermanentFailure: true
        } as Prisma.InputJsonValue
      }
    });
    return message.id;
  }

  private async lockOwned(
    tx: Prisma.TransactionClient,
    input: {
      jobRef: string;
      assistantId: string;
      workspaceId: string;
      chatId: string;
      channel: "web" | "telegram";
      threadKey: string;
    }
  ): Promise<LockedHandle | null> {
    const rows = await tx.$queryRaw<LockedHandle[]>(Prisma.sql`
      SELECT h."id", h."kind"::text AS "kind", h."canonical_job_id" AS "canonicalJobId",
        h."state"::text AS "state", h."narration_owner" AS "narrationOwner",
        h."narration_decision" AS "narrationDecision",
        h."source_finalized_at" AS "sourceFinalizedAt",
        h."runtime_session_id" AS "runtimeSessionId",
        h."continuation_depth" AS "continuationDepth",
        h."continuation_client_turn_id" AS "continuationClientTurnId",
        h."claim_token" AS "claimToken", h."retry_count" AS "retryCount",
        h."max_retries" AS "maxRetries", h."last_error_code" AS "lastErrorCode"
      FROM "assistant_async_job_handles" h
      INNER JOIN "assistant_chats" c ON c."id" = h."chat_id"
      WHERE h."job_ref" = ${input.jobRef}
        AND h."assistant_id" = ${input.assistantId}::uuid
        AND h."workspace_id" = ${input.workspaceId}::uuid
        AND h."chat_id" = ${input.chatId}::uuid
        AND h."user_id" = c."user_id"
        AND h."channel" = ${input.channel}::"AssistantChatSurface"
        AND h."thread_key" = ${input.threadKey}
        AND c."assistant_id" = h."assistant_id"
        AND c."workspace_id" = h."workspace_id"
        AND c."surface" = h."channel"
        AND c."surface_thread_key" = h."thread_key"
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockCanonical(
    tx: Prisma.TransactionClient,
    input: { kind: "media" | "document" | "sandbox"; canonicalJobId: string }
  ): Promise<LockedHandle | null> {
    const rows = await tx.$queryRaw<LockedHandle[]>(Prisma.sql`
      SELECT "id", "kind"::text AS "kind", "canonical_job_id" AS "canonicalJobId",
        "state"::text AS "state", "narration_owner" AS "narrationOwner",
        "narration_decision" AS "narrationDecision",
        "source_finalized_at" AS "sourceFinalizedAt",
        "runtime_session_id" AS "runtimeSessionId",
        "continuation_depth" AS "continuationDepth",
        "continuation_client_turn_id" AS "continuationClientTurnId",
        "claim_token" AS "claimToken", "retry_count" AS "retryCount",
        "max_retries" AS "maxRetries", "last_error_code" AS "lastErrorCode"
      FROM "assistant_async_job_handles"
      WHERE "kind" = ${input.kind}::"AssistantAsyncJobHandleKind"
        AND "canonical_job_id" = ${input.canonicalJobId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  /**
   * Ask sandbox to poll/refresh detached supervisors before reading DB
   * canonical status. Best-effort: missing control-plane config or network
   * failure leaves the prior row untouched (scheduler may still catch up).
   */
  private async refreshOwnedSandboxJob(input: {
    jobRef: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram";
    threadKey: string;
  }): Promise<void> {
    if (this.sandboxControlPlane === undefined) return;
    const handle = await this.prisma.assistantAsyncJobHandle.findFirst({
      where: {
        jobRef: input.jobRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        channel: input.channel,
        threadKey: input.threadKey,
        kind: "sandbox"
      },
      select: { canonicalJobId: true }
    });
    if (handle === null) return;
    await this.refreshSandboxJobs([handle.canonicalJobId]);
  }

  private async refreshSandboxJobs(canonicalJobIds: string[]): Promise<void> {
    if (this.sandboxControlPlane === undefined || canonicalJobIds.length === 0) return;
    const uniqueIds = [...new Set(canonicalJobIds)];
    const open = await this.prisma.sandboxJob.findMany({
      where: {
        id: { in: uniqueIds },
        status: { in: ["queued", "running", "detached"] }
      },
      select: { id: true }
    });
    if (open.length === 0) return;
    await Promise.all(open.map((job) => this.sandboxControlPlane!.inspectJob(job.id)));
  }

  /**
   * Shared canonical terminal truth for observe/subscribe and continuation
   * scheduler validation/reconcile. Failure/cancel beats delivery-visible
   * success so a Telegram failure-notice `deliveredAt` cannot become completed.
   */
  async readCanonicalTerminal(input: {
    kind: "media" | "document" | "sandbox";
    canonicalJobId: string;
    runtimeSessionId?: string | null;
  }): Promise<{
    status: "pending" | AsyncJobTerminalStatus;
    errorCode: string | null;
    message: string;
    sandboxResult: SandboxTerminalResult | null;
  } | null> {
    return this.prisma.$transaction(async (tx) =>
      this.readCanonical(tx, {
        kind: input.kind,
        canonicalJobId: input.canonicalJobId,
        runtimeSessionId: input.runtimeSessionId ?? null
      })
    );
  }

  private async readCanonical(
    tx: Prisma.TransactionClient,
    row: Pick<LockedHandle, "kind" | "canonicalJobId" | "runtimeSessionId">
  ): Promise<{
    status: "pending" | AsyncJobTerminalStatus;
    errorCode: string | null;
    message: string;
    sandboxResult: SandboxTerminalResult | null;
  } | null> {
    if (row.kind === "sandbox") {
      const job = await tx.sandboxJob.findUnique({
        where: { id: row.canonicalJobId },
        select: {
          status: true,
          toolCode: true,
          resultPayload: true,
          assistantId: true,
          workspaceId: true,
          runtimeSessionId: true
        }
      });
      if (
        job === null ||
        (job.toolCode !== "shell" && job.toolCode !== "exec") ||
        job.runtimeSessionId === null ||
        job.runtimeSessionId !== row.runtimeSessionId
      ) {
        return null;
      }
      if (job.status === "queued" || job.status === "running" || job.status === "detached") {
        return {
          status: "pending",
          errorCode: null,
          message: "Sandbox job is still running.",
          sandboxResult: null
        };
      }
      const payload = this.object(job.resultPayload);
      const terminalStatus =
        job.status === "completed"
          ? "completed"
          : job.status === "cancelled"
            ? "cancelled"
            : "failed";
      return {
        status: terminalStatus,
        errorCode: this.text(payload?.reason),
        message:
          terminalStatus === "completed"
            ? "Sandbox job completed."
            : terminalStatus === "cancelled"
              ? "Sandbox job was cancelled."
              : "Sandbox job failed.",
        sandboxResult: {
          toolCode: job.toolCode,
          exitCode: typeof payload?.exitCode === "number" ? payload.exitCode : null,
          stdout: this.boundedText(payload?.stdout),
          stderr: this.boundedText(payload?.stderr),
          paths: this.boundedPaths(payload?.producedFiles)
        }
      };
    }
    if (row.kind === "media") {
      const canonical = await tx.assistantMediaJob.findUnique({
        where: { id: row.canonicalJobId },
        select: {
          status: true,
          lastErrorCode: true,
          deliveredAt: true,
          completionAssistantMessageId: true
        }
      });
      if (canonical === null) return null;
      // Terminal failure/cancel must win over deliveredAt from failure notices.
      if (canonical.status === "failed" || canonical.status === "expired") {
        return {
          status: "failed",
          errorCode: canonical.lastErrorCode,
          message: "Job failed.",
          sandboxResult: null
        };
      }
      if (canonical.status === "canceled") {
        return {
          status: "cancelled",
          errorCode: null,
          message: "Job was cancelled.",
          sandboxResult: null
        };
      }
      const attachmentVisible =
        canonical.completionAssistantMessageId != null &&
        (await tx.assistantChatMessageAttachment.findFirst({
          where: { messageId: canonical.completionAssistantMessageId },
          select: { id: true }
        })) != null;
      const deliveryVisibleSuccess =
        canonical.status === "delivered" || canonical.deliveredAt != null || attachmentVisible;
      if (deliveryVisibleSuccess) {
        return {
          status: "completed",
          errorCode: null,
          message: "Job completed and was delivered.",
          sandboxResult: null
        };
      }
      return { status: "pending", errorCode: null, message: "", sandboxResult: null };
    }
    const canonical = await tx.assistantDocumentRenderJob.findUnique({
      where: { id: row.canonicalJobId },
      select: { status: true, lastErrorCode: true, deliveredAt: true }
    });
    if (canonical === null) return null;
    if (canonical.status === "failed" || canonical.status === "expired") {
      return {
        status: "failed",
        errorCode: canonical.lastErrorCode,
        message: "Job failed.",
        sandboxResult: null
      };
    }
    if (canonical.status === "canceled") {
      return {
        status: "cancelled",
        errorCode: null,
        message: "Job was cancelled.",
        sandboxResult: null
      };
    }
    if (canonical.status === "delivered" || canonical.deliveredAt != null) {
      return {
        status: "completed",
        errorCode: null,
        message: "Job completed and was delivered.",
        sandboxResult: null
      };
    }
    return { status: "pending", errorCode: null, message: "", sandboxResult: null };
  }

  private object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private text(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private boundedText(value: unknown): string | null {
    return typeof value === "string" ? value.slice(0, 16_384) : null;
  }

  private boundedPaths(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.object(entry)?.storagePath)
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, 64);
  }

  private terminalStateData(status: AsyncJobTerminalStatus, now: Date) {
    return status === "completed"
      ? { state: "completed" as const, completedAt: now }
      : status === "cancelled"
        ? { state: "cancelled" as const, cancelledAt: now }
        : { state: "failed" as const, failedAt: now };
  }

  private async finalizeTerminalHandleInTx(
    tx: Prisma.TransactionClient,
    row: LockedHandle,
    terminal: {
      status: AsyncJobTerminalStatus;
      errorCode: string | null;
      message: string;
      sandboxResult: SandboxTerminalResult | null;
    }
  ): Promise<void> {
    if (
      row.state !== "none" &&
      !(
        row.state === "subscribed" &&
        row.narrationOwner === "continuation" &&
        row.narrationDecision === "notify_subscribed"
      )
    ) {
      return;
    }
    const now = new Date();
    // After the guard above, state is only `none` or continuation-subscribed.
    const continuationReady =
      row.narrationOwner === "continuation" && row.narrationDecision === "notify_subscribed";
    await tx.assistantAsyncJobHandle.update({
      where: { id: row.id },
      data: {
        terminalSnapshotJson: terminal,
        ...(continuationReady
          ? {
              state: "ready" as const,
              readyAt: now,
              nextRetryAt: now,
              terminalObservedAt: now
            }
          : {
              terminalObservedAt: now,
              ...this.terminalStateData(terminal.status, now)
            })
      }
    });
  }

  private async selectCurrentlyOpenCanonicalKeys(
    rows: Array<{ kind: "media" | "document" | "sandbox"; canonicalJobId: string }>
  ): Promise<Set<string>> {
    const open = new Set<string>();
    if (rows.length === 0) return open;
    const sandboxIds = rows
      .filter((row) => row.kind === "sandbox")
      .map((row) => row.canonicalJobId);
    const mediaIds = rows.filter((row) => row.kind === "media").map((row) => row.canonicalJobId);
    const documentIds = rows
      .filter((row) => row.kind === "document")
      .map((row) => row.canonicalJobId);
    if (sandboxIds.length > 0) {
      const jobs = await this.prisma.sandboxJob.findMany({
        where: {
          id: { in: sandboxIds },
          status: { in: ["queued", "running", "detached"] }
        },
        select: { id: true }
      });
      for (const job of jobs) open.add(`sandbox:${job.id}`);
    }
    if (mediaIds.length > 0) {
      const jobs = await this.prisma.assistantMediaJob.findMany({
        where: {
          id: { in: mediaIds },
          status: { in: ["queued", "running", "completion_pending"] },
          deliveredAt: null
        },
        select: { id: true, status: true, completionAssistantMessageId: true }
      });
      const messageIds = jobs
        .map((job) => job.completionAssistantMessageId)
        .filter((id): id is string => id != null);
      const visibleMessageIds = new Set<string>();
      if (messageIds.length > 0) {
        const attachments = await this.prisma.assistantChatMessageAttachment.findMany({
          where: { messageId: { in: messageIds } },
          select: { messageId: true }
        });
        for (const row of attachments) visibleMessageIds.add(row.messageId);
      }
      for (const job of jobs) {
        // Match observe: delivery-visible (attachment) is terminal, not open.
        if (
          job.completionAssistantMessageId != null &&
          visibleMessageIds.has(job.completionAssistantMessageId)
        ) {
          continue;
        }
        open.add(`media:${job.id}`);
      }
    }
    if (documentIds.length > 0) {
      const jobs = await this.prisma.assistantDocumentRenderJob.findMany({
        where: {
          id: { in: documentIds },
          status: {
            in: [
              "queued",
              "running",
              "provider_processing",
              "fetching_output",
              "ready_for_delivery"
            ]
          },
          deliveredAt: null
        },
        select: { id: true }
      });
      for (const job of jobs) open.add(`document:${job.id}`);
    }
    return open;
  }

  private continuationClientTurnId(id: string): string {
    return `async-cont:${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
  }
}
