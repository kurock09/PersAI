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
/**
 * Five seconds is deliberately far longer than normal provider delta gaps,
 * yet short enough that a lost/stalled stream cannot visibly hold a receipt
 * behind an utterance for an open-ended period.
 */
const OPEN_UTTERANCE_GATE_MS = 5_000;

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
  private readonly gateHeldDeliveriesByMessageId = new Map<string, TurnEventDraft[]>();
  private readonly openUtterancesByMessageId = new Map<string, ReturnType<typeof setTimeout>>();

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
    const gateHeld = this.gateHeldDeliveriesByMessageId.get(input.messageId) ?? [];
    const closesUtterance = input.drafts.some(
      (draft) => draft.kind === "note" || draft.kind === "answer_text"
    );
    const utteranceOpen = this.openUtterancesByMessageId.has(input.messageId);
    if (utteranceOpen && input.drafts.every((draft) => draft.kind === "delivery")) {
      const held = [...gateHeld, ...input.drafts];
      if (held.length > PENDING_DRAFTS_MAX_LENGTH) {
        this.gateHeldDeliveriesByMessageId.delete(input.messageId);
        this.releaseOpenUtterance(input.messageId);
        this.logger.error(
          `ADR-170 text_tail pending buffer overflow messageId=${input.messageId} draftCount=${String(held.length)} cap=${String(PENDING_DRAFTS_MAX_LENGTH)} — gate released`
        );
        return this.append({ messageId: input.messageId, drafts: held }, tx);
      }
      this.gateHeldDeliveriesByMessageId.set(input.messageId, held);
      return [];
    }
    // A held delivery happened during the utterance that this text event now
    // closes, so the text must receive its seq before that delivery. Ordinary
    // D3.3 failure-pending drafts still drain before newer work when no
    // utterance gate is involved.
    const combinedDrafts = closesUtterance
      ? [...pending, ...input.drafts, ...gateHeld]
      : [...pending, ...input.drafts, ...gateHeld];
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
      this.gateHeldDeliveriesByMessageId.delete(input.messageId);
      if (closesUtterance) {
        this.releaseOpenUtterance(input.messageId);
      }
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
    this.gateHeldDeliveriesByMessageId.delete(messageId);
    this.releaseOpenUtterance(messageId);
  }

  /**
   * D5.2.1 — marks the current unclassified provider utterance as live. A
   * delivery is held separately from the D3.3 failure buffer until a note or
   * answer_text closes it. The timeout is a safety valve for a stalled stream:
   * after five seconds, held delivery resumes rather than waiting indefinitely.
   */
  openUtterance(messageId: string): void {
    if (this.openUtterancesByMessageId.has(messageId)) {
      return;
    }
    const timeout = setTimeout(() => {
      this.openUtterancesByMessageId.delete(messageId);
      const held = this.gateHeldDeliveriesByMessageId.get(messageId);
      if (held === undefined || held.length === 0) {
        return;
      }
      void this.append({ messageId, drafts: [] }).catch((error) => {
        this.logger.warn(
          `ADR-170 text_tail bounded gate flush failed messageId=${messageId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }, OPEN_UTTERANCE_GATE_MS);
    timeout.unref?.();
    this.openUtterancesByMessageId.set(messageId, timeout);
  }

  /** D5.2.1 terminal path: stop gating and drain any held delivery. */
  async closeUtterance(messageId: string): Promise<PublicTurnEvent[]> {
    this.releaseOpenUtterance(messageId);
    return this.append({ messageId, drafts: [] });
  }

  private releaseOpenUtterance(messageId: string): void {
    const timeout = this.openUtterancesByMessageId.get(messageId);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      this.openUtterancesByMessageId.delete(messageId);
    }
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

  /**
   * ADR-170 D5.3 — reconciles a message's `answer_text` log segments to its
   * actual, already-settled `content` column, which by the time any caller
   * reaches this method is the one and only source of truth for what the
   * turn's answer really is: the runtime's own draft text for the ordinary
   * case, or a server-side rewrite for the two documented exceptions (the
   * API's delivery-honesty correction stripping a technical summary / an
   * undelivered local link, or a substituted body for a genuinely silent
   * reply) — see `apps/api/.../final-delivery-honesty.ts` and its call
   * sites. Reading `content` directly from the row under the same lock,
   * rather than trusting a string a caller computed, means every caller can
   * call this unconditionally once it has finished settling a turn's body,
   * with no risk of passing a body that does not match what actually landed
   * through a call site's own anti-wipe / reuse guards.
   *
   * Exactly one equality check, one defined fallback, both deterministic —
   * no similarity matching, no prefix guessing, no partial-segment surgery:
   *  - If the plain concatenation of the log's `answer_text` events (in
   *    their existing order) already equals `content`, this is a no-op: no
   *    write, no log line, no `seq` churn. This is the overwhelmingly common
   *    case (the model's own text survived uncorrected).
   *  - Otherwise every `answer_text` event in the log collapses into ONE
   *    corrected segment carrying the FIRST such event's `seq`, holding
   *    `content` verbatim. Every non-`answer_text` event keeps its own
   *    `seq` and its exact relative position — nothing is renumbered,
   *    re-sorted, or dropped (a `delivery` that landed between two answer
   *    segments simply ends up next to the single collapsed one instead of
   *    inside it, exactly as D5.3 documents as the accepted cost).
   *  - If the log has NO `answer_text` event at all (a silent turn) and
   *    `content` is non-empty, a single `answer_text` event is appended at
   *    the tail — never inserted at an invented position.
   *
   * Idempotent: once the collapsed/tail event's text equals `content`, the
   * concatenation check above is true on every later call, so running this
   * twice for the same settled body is a no-op the second time.
   *
   * Reuses the exact same `SELECT ... FOR UPDATE` row-lock serialization
   * `append()`/`appendLocked` already use, so a concurrent `delivery` append
   * for the same message cannot interleave with this collapse. Pass `tx` to
   * run inside a transaction the caller already holds; otherwise a new one
   * is opened.
   */
  async reconcileAnswerTextToPersistedBody(
    input: { messageId: string },
    tx?: PrismaTransactionClient
  ): Promise<PublicTurnEvent[]> {
    return tx !== undefined
      ? this.reconcileLocked(tx, input.messageId)
      : this.prisma.$transaction((innerTx) => this.reconcileLocked(innerTx, input.messageId));
  }

  private async reconcileLocked(
    tx: PrismaTransactionClient,
    messageId: string
  ): Promise<PublicTurnEvent[]> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM assistant_chat_messages WHERE id = ${messageId}::uuid FOR UPDATE`
    );
    if (locked.length !== 1) {
      throw new NotFoundException("chat_message_not_found");
    }

    const current = await tx.assistantChatMessage.findUniqueOrThrow({
      where: { id: messageId },
      select: { metadata: true, content: true }
    });
    const existingMetadata = asMetadataRecord(current.metadata);
    const existingLog = readStoredTurnEventsFromMetadata(current.metadata);
    const persistedBody = current.content;

    if (concatenateAnswerTextEvents(existingLog) === persistedBody) {
      // D5.3 — already the same string: no write, no log line, no seq churn.
      return [];
    }

    const { log, changed } = collapseAnswerTextToPersistedBody(existingLog, persistedBody);

    await tx.assistantChatMessage.update({
      where: { id: messageId },
      data: {
        metadata: {
          ...existingMetadata,
          turnEvents: log
        } as unknown as Prisma.InputJsonValue
      }
    });

    this.logger.log(
      `ADR-170 turn_event answer_text reconciled to persisted body messageId=${messageId}`
    );

    return changed;
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

/**
 * ADR-170 D5.3 — the idempotency key stamped on an `answer_text` event this
 * reconciliation creates (a brand-new tail event, or an existing event whose
 * `draftKeys` union is empty for some reason). Never collides with a
 * runtime-issued key (`${requestId}#${n}`, always containing `#`), so a real
 * draft replay can never be mistaken for a reconciliation artifact or vice
 * versa.
 */
const RECONCILED_ANSWER_TEXT_DRAFT_KEY = "adr170-d5.3:reconciled-answer-text";

/** ADR-170 D5.3 — the plain concatenation of a log's `answer_text` events, in their existing (already `seq`-ordered) array order. */
function concatenateAnswerTextEvents(log: StoredTurnEvent[]): string {
  return log
    .filter(
      (event): event is StoredTurnEvent & { kind: "answer_text" } => event.kind === "answer_text"
    )
    .map((event) => event.text)
    .join("");
}

/**
 * ADR-170 D5.3 — the deterministic collapse itself, factored out of
 * `reconcileLocked` for the same reason `applyDrafts` is factored out of
 * `appendLocked`: pure input/output, no Prisma, trivially unit-testable.
 * Called only once the caller has confirmed the plain concatenation of the
 * log's existing `answer_text` events does not already equal `persistedBody`.
 */
function collapseAnswerTextToPersistedBody(
  existingLog: StoredTurnEvent[],
  persistedBody: string
): { log: StoredTurnEvent[]; changed: PublicTurnEvent[] } {
  type StoredAnswerTextEvent = StoredTurnEvent & { kind: "answer_text" };
  const answerEntries: Array<{ index: number; event: StoredAnswerTextEvent }> = [];
  existingLog.forEach((event, index) => {
    if (event.kind === "answer_text") {
      answerEntries.push({ index, event });
    }
  });

  if (answerEntries.length === 0) {
    // D5.3 — a silent turn: no answer_text event exists to collapse, so one
    // is appended at the tail rather than invented at some earlier position.
    const nextSeq = existingLog.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
    const tailEvent: StoredAnswerTextEvent = {
      kind: "answer_text",
      at: new Date().toISOString(),
      seq: nextSeq,
      draftKey: RECONCILED_ANSWER_TEXT_DRAFT_KEY,
      draftKeys: [RECONCILED_ANSWER_TEXT_DRAFT_KEY],
      text: persistedBody
    };
    return { log: [...existingLog, tailEvent], changed: [projectTurnEventForWire(tailEvent)] };
  }

  const [first, ...rest] = answerEntries as [
    { index: number; event: StoredAnswerTextEvent },
    ...Array<{ index: number; event: StoredAnswerTextEvent }>
  ];
  const mergedDraftKeys = Array.from(
    new Set(answerEntries.flatMap(({ event }) => event.draftKeys ?? []))
  );
  const collapsedEvent: StoredAnswerTextEvent = {
    ...first.event,
    text: persistedBody,
    ...(mergedDraftKeys.length > 0 ? { draftKeys: mergedDraftKeys } : {})
  };
  const removeAtIndex = new Set(rest.map(({ index }) => index));
  const log = existingLog
    .map((event, index) => (index === first.index ? collapsedEvent : event))
    .filter((_event, index) => !removeAtIndex.has(index));

  return { log, changed: [projectTurnEventForWire(collapsedEvent)] };
}

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
