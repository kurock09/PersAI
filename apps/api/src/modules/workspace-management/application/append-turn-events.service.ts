import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { TurnEvent, TurnEventDraft } from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { projectTurnEventForWire, type PublicTurnEvent } from "./turn-event-wire-projection";

type PrismaTransactionClient = Prisma.TransactionClient;

/**
 * ADR-170 D3.3 — hard ceiling on a single message's pending buffer, far above
 * any real turn's draft count. Only a pathological loop (or a sustained
 * database outage that never lets a single append for the message succeed)
 * could reach it; on overflow the buffer is cleared rather than grown
 * further (see `append()`), because turn-completion reconciliation already
 * exists as the net for whatever is lost, and an unbounded map entry in a
 * long-lived pod is a worse outcome than a rare, logged, healed gap.
 */
const PENDING_DRAFTS_MAX_LENGTH = 500;

export type AppendTurnEventsInput = {
  messageId: string;
  drafts: TurnEventDraft[];
};

/**
 * ADR-170 D3/D3.1/D3.3/D5.1/D2.1 — the ONLY writer of an assistant message's
 * `turnEvents` log. `turnEvents` lives as one more key inside the existing
 * `AssistantChatMessage.metadata` JSONB column (no migration, no new model).
 *
 * Atomicity across pods reuses the exact serialization approach
 * `DeliverChatAttachmentOnceService` already relies on (ADR-167 D5): lock the
 * `assistant_chat_messages` row with `SELECT ... FOR UPDATE` inside a
 * transaction, re-read the row's current metadata under that lock, compute
 * the new log, then write it back in the same transaction. Two concurrent
 * appenders for the same message serialize on the row lock — Postgres blocks
 * the second transaction's `FOR UPDATE` until the first commits, and the
 * second then re-reads the already-updated metadata, so `seq` allocation can
 * never produce a duplicate or a gap.
 *
 * D5.1 coalescing (appending `answer_text` extends the last event when that
 * event is also `answer_text`) is decided here, and only here.
 *
 * D3.3 idempotency by `draftKey` — the fix for a real gap this ADR closes: a
 * live mid-stream append can fail (DB hiccup, pod death, soft-detached
 * connection), and once the log is the only source of truth a lost draft is
 * a sentence the user never sees again. Every runtime-emitted draft (every
 * kind except `delivery`) carries a turn-scoped `draftKey`, stamped once by
 * the runtime's single push point, used ONLY as an idempotency key — never
 * for ordering (`seq` remains the sole ordering authority). A draft whose key
 * is already present on the stored log is a no-op, which is exactly what
 * makes completion-time reconciliation of `RuntimeTurnResult.turnEvents`
 * safe: in the healthy case every key the log already has is skipped and
 * reconciliation appends nothing; when a live append failed, reconciliation
 * appends exactly the missing drafts and heals the gap. A stored event that
 * D5.1 coalesced from more than one draft carries every merged draft's key
 * (`draftKeys`), so a replay of ANY one of those keys is still recognized as
 * already-present. `delivery` events are server-created (never carry a
 * `draftKey`) and keep their own idempotency by durable `attachmentId`.
 *
 * D3.3 ordered pending buffer — healing must never break chronology, which
 * rules out "append what was missed at the tail later": a single failed
 * draft sandwiched between two successes would otherwise land after events
 * that chronologically followed it. `pendingDraftsByMessageId` keeps, per
 * message (a message id IS a live turn's identity here — the same id every
 * live append and every `delivery` append for that turn already targets, per
 * D3.2), the ordered drafts that did not make it into a prior successful
 * write. Every `append()` call — live or `delivery` — first prepends this
 * message's pending drafts to its own new drafts and processes the combined
 * list as ONE atomic write: either everything commits together in order
 * (clearing the buffer), or nothing does and the whole combined list stays
 * pending together for the next attempt. Nothing newer is ever numbered
 * while something older for the same message is still waiting. This is a
 * same-pod, in-memory, best-effort mechanism only — it cannot survive the
 * pod holding it dying — which is exactly the case turn-completion
 * reconciliation (in `stream-web-chat-turn.service.ts`) exists to cover.
 *
 * Two bounds keep this map from leaking in a long-lived pod: `releasePending`
 * lets the caller drop a message's entry once completion reconciliation has
 * run (durable log is as complete as it will ever get by then — see the
 * method doc), and `PENDING_DRAFTS_MAX_LENGTH` caps how large one message's
 * buffer can grow before a sustained failure gets it cleared instead of
 * grown further.
 */
@Injectable()
export class AppendTurnEventsService {
  private readonly logger = new Logger(AppendTurnEventsService.name);
  private readonly pendingDraftsByMessageId = new Map<string, TurnEventDraft[]>();

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  /**
   * Appends one or more drafts and returns exactly the events that changed as
   * a result — newly allocated events, plus a coalesced `answer_text` event
   * when a draft extended it, plus any previously-pending draft this call
   * happened to drain. A draft whose idempotency key (`draftKey` for
   * ordinary drafts, `attachmentId` for `delivery`) is already present on the
   * message's log produces no entry in the returned array (idempotent
   * no-op), so callers must not assume `result.length === input.drafts.length`.
   *
   * Pass `tx` to run inside a transaction the caller already holds (e.g. the
   * same lock a caller is already serializing other writes on); otherwise a
   * new transaction is opened.
   */
  async append(
    input: AppendTurnEventsInput,
    tx?: PrismaTransactionClient
  ): Promise<PublicTurnEvent[]> {
    const pending = this.pendingDraftsByMessageId.get(input.messageId) ?? [];
    const combinedDrafts = [...pending, ...input.drafts];
    if (combinedDrafts.length === 0) {
      return [];
    }
    try {
      const appended =
        tx !== undefined
          ? await this.appendLocked(tx, input.messageId, combinedDrafts)
          : await this.prisma.$transaction((innerTx) =>
              this.appendLocked(innerTx, input.messageId, combinedDrafts)
            );
      // The whole combined batch (previously-pending + new) is now durable
      // (or was already idempotently present) — nothing left waiting.
      this.pendingDraftsByMessageId.delete(input.messageId);
      return appended;
    } catch (error) {
      if (combinedDrafts.length > PENDING_DRAFTS_MAX_LENGTH) {
        // D3.3 — a sustained failure (or a pathological loop) has grown this
        // message's buffer past any real turn's draft count. Growing it
        // further is an unbounded in-memory leak in a long-lived pod, and it
        // is worst exactly when the system is already unhealthy. Clear it —
        // turn-completion reconciliation is already the net for whatever is
        // lost — and log loudly so the condition is visible, not silent.
        this.pendingDraftsByMessageId.delete(input.messageId);
        this.logger.error(
          `ADR-170 turn_event pending buffer overflow messageId=${input.messageId} draftCount=${String(combinedDrafts.length)} cap=${String(PENDING_DRAFTS_MAX_LENGTH)} — buffer cleared, relying on completion reconciliation`
        );
        throw error;
      }
      // D3.3 — keep EVERYTHING that did not make it, in original order, so
      // the next append for this message drains it first. Never drop a
      // draft and never let a newer one skip ahead of it.
      this.pendingDraftsByMessageId.set(input.messageId, combinedDrafts);
      throw error;
    }
  }

  /**
   * ADR-170 D3.3 — releases a message's pending buffer, if any, regardless of
   * whether anything was actually pending. Call this once turn-completion
   * reconciliation has run for a message (success or failure of that
   * reconciling `append()` call): by then the durable log is as complete as
   * it will ever get for this turn on this pod, so anything still pending is
   * already lost, and holding it in memory for the rest of the pod's
   * lifetime helps nobody. Exposed explicitly rather than left for callers
   * to reach into the map themselves.
   */
  releasePending(messageId: string): void {
    this.pendingDraftsByMessageId.delete(messageId);
  }

  /** The full durable log for a message, in `seq` order. Empty when the message has none (D7). */
  async getLog(messageId: string): Promise<PublicTurnEvent[]> {
    const row = await this.prisma.assistantChatMessage.findUnique({
      where: { id: messageId },
      select: { metadata: true }
    });
    return readStoredTurnEventsFromMetadata(row?.metadata ?? null).map(projectTurnEventForWire);
  }

  /** Events with `seq` strictly greater than `sinceSeq`, in `seq` order (D8 catch-up). */
  async getSince(messageId: string, sinceSeq: number): Promise<PublicTurnEvent[]> {
    const log = await this.getLog(messageId);
    return log.filter((event) => event.seq > sinceSeq);
  }

  private async appendLocked(
    tx: PrismaTransactionClient,
    messageId: string,
    drafts: TurnEventDraft[]
  ): Promise<PublicTurnEvent[]> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM assistant_chat_messages WHERE id = ${messageId}::uuid FOR UPDATE`
    );
    if (locked.length !== 1) {
      throw new NotFoundException("chat_message_not_found");
    }

    const current = await tx.assistantChatMessage.findUniqueOrThrow({
      where: { id: messageId },
      select: { metadata: true }
    });
    const existingMetadata = asMetadataRecord(current.metadata);
    const existingLog = readStoredTurnEventsFromMetadata(current.metadata);

    const { log, appended } = applyDrafts(existingLog, drafts);
    if (appended.length === 0) {
      // Every draft was an idempotent no-op (already-present draftKey, or a
      // repeat `delivery` attachmentId); no write needed.
      return [];
    }

    await tx.assistantChatMessage.update({
      where: { id: messageId },
      data: {
        metadata: {
          ...existingMetadata,
          turnEvents: log
        } as unknown as Prisma.InputJsonValue
      }
    });

    return appended;
  }
}

/**
 * ADR-170 D3.3 — the durable on-disk shape: a `TurnEvent` plus every
 * `draftKey` D5.1 coalescing ever folded into it (always at least one entry
 * for a runtime-emitted kind). `delivery` events carry no `draftKeys` — they
 * are keyed by durable `attachmentId` instead. A non-coalesced event also
 * still carries the ORIGINATING draft's own singular `draftKey` (from
 * spreading the draft onto the stored event below) — both fields are
 * internal to the append primitive; D3.3.1's `projectTurnEventForWire`
 * strips both before any event reaches an external caller (and, via
 * `metadata.turnEvents`, before the web-chat mapper projects a historical
 * message).
 */
type StoredTurnEvent = TurnEvent & { draftKey?: string; draftKeys?: string[] };

function applyDrafts(
  existingLog: StoredTurnEvent[],
  drafts: TurnEventDraft[]
): { log: StoredTurnEvent[]; appended: PublicTurnEvent[] } {
  const log = [...existingLog];
  const appended: PublicTurnEvent[] = [];
  let nextSeq = log.reduce((max, event) => Math.max(max, event.seq), 0) + 1;

  for (const draft of drafts) {
    if (draft.kind === "delivery") {
      const alreadyDelivered = log.some(
        (event) => event.kind === "delivery" && event.attachmentId === draft.attachmentId
      );
      if (alreadyDelivered) {
        // D2.1 idempotency — a repeat delivery for the same durable
        // attachment id is a no-op, not a duplicate.
        continue;
      }
      const event: StoredTurnEvent = { ...draft, seq: nextSeq };
      nextSeq += 1;
      log.push(event);
      appended.push(projectTurnEventForWire(event));
      continue;
    }

    // D3.3 — a draft whose key is already folded into any stored event
    // (including one D5.1-coalesced from several drafts) is a no-op: it was
    // already durably appended, most likely by a prior live mid-stream
    // append that this call — e.g. turn-completion reconciliation — is now
    // safely re-confirming rather than duplicating.
    const alreadyPresent = log.some((event) => event.draftKeys?.includes(draft.draftKey) === true);
    if (alreadyPresent) {
      continue;
    }

    const last = log[log.length - 1];
    if (draft.kind === "answer_text" && last !== undefined && last.kind === "answer_text") {
      // D5.1 — extend the open answer_text segment; keep its seq, refresh
      // nothing else. Every merged draft's key survives in `draftKeys` so a
      // later replay of any one of them is still recognized as present.
      const extended: StoredTurnEvent = {
        ...last,
        text: last.text + draft.text,
        draftKeys: [...(last.draftKeys ?? []), draft.draftKey]
      };
      log[log.length - 1] = extended;
      appended.push(projectTurnEventForWire(extended));
      continue;
    }

    const event: StoredTurnEvent = { ...draft, seq: nextSeq, draftKeys: [draft.draftKey] };
    nextSeq += 1;
    log.push(event);
    appended.push(projectTurnEventForWire(event));
  }

  return { log, appended };
}

function asMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function readStoredTurnEventsFromMetadata(metadata: unknown): StoredTurnEvent[] {
  const record = asMetadataRecord(metadata);
  const value = record.turnEvents;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isStoredTurnEvent);
}

const TURN_EVENT_KINDS = new Set([
  "note",
  "tool_call",
  "answer_text",
  "delivery",
  "job_accepted",
  "turn_stopped",
  "turn_failed"
]);

function isStoredTurnEvent(value: unknown): value is StoredTurnEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.kind !== "string" ||
    !TURN_EVENT_KINDS.has(row.kind) ||
    typeof row.seq !== "number" ||
    !Number.isInteger(row.seq) ||
    typeof row.at !== "string"
  ) {
    return false;
  }
  // `draftKeys`, when present, must be a string array — legacy/malformed
  // shapes are otherwise still accepted as a valid stored event (D7 has no
  // special-case branch for historical data), just with no keys to match
  // against, which only means a future replay of that draft's key will not
  // recognize it and will append a fresh event instead of a no-op.
  return row.draftKeys === undefined || isStringArray(row.draftKeys);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
