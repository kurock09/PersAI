import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export const MAX_ASYNC_CONTINUATION_DEPTH = 4;
export const ASYNC_CONTINUATION_MAX_RETRIES = 8;

export type AsyncJobTerminalStatus = "completed" | "failed" | "cancelled";
export type AsyncJobNarrationOwner = "current_turn" | "continuation" | "legacy";
export type AsyncJobDeliveryDecision = "legacy_frame" | "skip_legacy_frame" | "defer";

type LockedHandle = {
  id: string;
  kind: "media" | "document";
  canonicalJobId: string;
  state: string;
  narrationOwner: AsyncJobNarrationOwner | null;
  narrationDecision: string | null;
  sourceFinalizedAt: Date | null;
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
      kind: "media" | "document";
    }
  | {
      outcome: "claimed_current_turn" | "already_owned";
      owner: AsyncJobNarrationOwner;
      jobRef: string;
      kind: "media" | "document";
      status: AsyncJobTerminalStatus;
      errorCode: string | null;
      message: string;
    }
  | { outcome: "not_found" };

export type SubscribePendingOutcome =
  | { outcome: "subscribed"; continuationClientTurnId: string; duplicate: boolean }
  | {
      outcome: "terminal_inline";
      kind: "media" | "document";
      status: AsyncJobTerminalStatus;
      errorCode: string | null;
      message: string;
    }
  | { outcome: "depth_exhausted" }
  | { outcome: "already_owned"; owner: AsyncJobNarrationOwner }
  | { outcome: "not_found" };

@Injectable()
export class AssistantAsyncJobHandleStateService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async observeForCurrentTurn(input: {
    jobRef: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram";
    threadKey: string;
  }): Promise<ObserveTerminalOutcome> {
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
      };
      if (row.narrationOwner !== null) {
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
    kind: "media" | "document";
    canonicalJobId: string;
  }): Promise<AsyncJobDeliveryDecision> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockCanonical(tx, input);
      if (row === null) return "legacy_frame";
      if (row.narrationOwner === "legacy") return "legacy_frame";
      if (row.narrationOwner === "current_turn" || row.narrationOwner === "continuation") {
        return "skip_legacy_frame";
      }
      return "defer";
    });
  }

  async recordCanonicalCompletion(input: {
    kind: "media" | "document";
    canonicalJobId: string;
    terminalStatus: AsyncJobTerminalStatus;
    terminalSnapshot: Prisma.InputJsonValue;
  }): Promise<{ decision: AsyncJobDeliveryDecision; state: string }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockCanonical(tx, input);
      if (row === null) return { decision: "legacy_frame", state: input.terminalStatus };
      const now = new Date();
      const decision: AsyncJobDeliveryDecision =
        row.narrationOwner === "legacy"
          ? "legacy_frame"
          : row.narrationOwner === null
            ? "defer"
            : "skip_legacy_frame";
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
  }): Promise<"requeued" | "exhausted" | "lost"> {
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
      const retryCount = row.retryCount + 1;
      const exhausted = retryCount >= row.maxRetries;
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
              lastErrorMessage: "Continuation remained busy until retries were exhausted."
            }
          : {
              state: "ready",
              retryCount,
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
      return exhausted ? "exhausted" : "requeued";
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
              lastErrorMessage: input.errorMessage
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
  }): Promise<boolean> {
    const result = await this.prisma.assistantAsyncJobHandle.updateMany({
      where: {
        id: input.id,
        state: { in: ["claimed", "dispatched"] },
        claimToken: input.claimToken
      },
      data: {
        state: "failed",
        failedAt: new Date(),
        claimToken: null,
        claimExpiresAt: null,
        nextRetryAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage
      }
    });
    return result.count === 1;
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
    input: { kind: "media" | "document"; canonicalJobId: string }
  ): Promise<LockedHandle | null> {
    const rows = await tx.$queryRaw<LockedHandle[]>(Prisma.sql`
      SELECT "id", "kind"::text AS "kind", "canonical_job_id" AS "canonicalJobId",
        "state"::text AS "state", "narration_owner" AS "narrationOwner",
        "narration_decision" AS "narrationDecision",
        "source_finalized_at" AS "sourceFinalizedAt",
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

  private async readCanonical(
    tx: Prisma.TransactionClient,
    row: Pick<LockedHandle, "kind" | "canonicalJobId">
  ): Promise<{
    status: "pending" | AsyncJobTerminalStatus;
    errorCode: string | null;
    message: string;
  } | null> {
    const canonical =
      row.kind === "media"
        ? await tx.assistantMediaJob.findUnique({
            where: { id: row.canonicalJobId },
            select: { status: true, lastErrorCode: true }
          })
        : await tx.assistantDocumentRenderJob.findUnique({
            where: { id: row.canonicalJobId },
            select: { status: true, lastErrorCode: true }
          });
    if (canonical === null) return null;
    if (canonical.status === "delivered") {
      return {
        status: "completed",
        errorCode: null,
        message: "Job completed and was delivered."
      };
    }
    if (canonical.status === "failed" || canonical.status === "expired") {
      return {
        status: "failed",
        errorCode: canonical.lastErrorCode,
        message: "Job failed."
      };
    }
    if (canonical.status === "canceled") {
      return {
        status: "cancelled",
        errorCode: null,
        message: "Job was cancelled."
      };
    }
    return { status: "pending", errorCode: null, message: "" };
  }

  private terminalStateData(status: AsyncJobTerminalStatus, now: Date) {
    return status === "completed"
      ? { state: "completed" as const, completedAt: now }
      : status === "cancelled"
        ? { state: "cancelled" as const, cancelledAt: now }
        : { state: "failed" as const, failedAt: now };
  }

  private continuationClientTurnId(id: string): string {
    return `async-cont:${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
  }
}
