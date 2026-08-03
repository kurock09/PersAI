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
 *
 * D5.2.2 — the open-utterance gate lives in the log itself, not in pod
 * memory. See `openUtterance()` and the reserved-slot fill logic in
 * `applyDrafts()` below for the mechanism; there is no per-process gate map,
 * no held-delivery buffer, and no bounded timer, because a deferred
 * `delivery` appended by a scheduler-leased worker on a DIFFERENT API pod
 * must never depend on THIS pod's in-memory state to be ordered correctly.
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

  /**
   * ADR-170 D5.2.2 — reserves the `seq` for a not-yet-classified provider
   * utterance by appending a numbered text event with EMPTY text through the
   * SAME append primitive every other draft uses. Because the reservation is
   * a real, durable, numbered log entry, any pod appending a `delivery`
   * afterward is serialized behind it by the row lock alone — there is
   * nothing pod-local left to miss. `draftKey` must be a stable per-utterance
   * identity (the caller derives it, e.g. from the message id plus an
   * incrementing utterance index) so a retried reserve is a no-op, and the
   * NEXT numbered text event (`note` or `answer_text`) fills this reserved
   * slot in place — see `applyDrafts()`'s reserved-slot fill branch. One
   * awaited call per utterance; never call this per token.
   */
  async openUtterance(messageId: string, draftKey: string): Promise<PublicTurnEvent[]> {
    return this.append({
      messageId,
      drafts: [{ kind: "answer_text", at: new Date().toISOString(), draftKey, text: "" }]
    });
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

    if (concatenateNumberedTextEvents(existingLog) === persistedBody) {
      // D5.3 — already the same string: no write, no log line, no seq churn.
      return [];
    }

    const { log, changed, discardedNarration } = reconcileNumberedTextToPersistedBody(
      existingLog,
      persistedBody
    );

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
      discardedNarration
        ? `ADR-170 D5.4.1 turn_event narration discarded by settled-body rewrite messageId=${messageId}`
        : `ADR-170 turn_event answer_text reconciled to persisted body messageId=${messageId}`
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

    const { log, appended, mutated } = applyDrafts(existingLog, drafts);
    if (!mutated) {
      // Every draft was an idempotent no-op (already-present draftKey, or a
      // repeat `delivery` attachmentId); no write needed. Distinct from
      // `appended` being empty: a late/duplicate D5.2.2 reserve DOES mutate
      // the log (its key merges onto the utterance's existing text event so
      // a future replay of that same key is recognized too) but reports no
      // wire-visible change, since the merge alters no seq/kind/text.
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

/** ADR-170 D5.4 — plain text projection in durable sequence order. */
function concatenateNumberedTextEvents(log: StoredTurnEvent[]): string {
  return log
    .filter(
      (event): event is StoredTurnEvent & { kind: "note" | "answer_text" } =>
        event.kind === "note" || event.kind === "answer_text"
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
function reconcileNumberedTextToPersistedBody(
  existingLog: StoredTurnEvent[],
  persistedBody: string
): { log: StoredTurnEvent[]; changed: PublicTurnEvent[]; discardedNarration: boolean } {
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
    return {
      log: [...existingLog, tailEvent],
      changed: [projectTurnEventForWire(tailEvent)],
      discardedNarration: false
    };
  }

  const [first, ...rest] = answerEntries as [
    { index: number; event: StoredAnswerTextEvent },
    ...Array<{ index: number; event: StoredAnswerTextEvent }>
  ];
  const noteText = existingLog
    .filter((event): event is StoredTurnEvent & { kind: "note" } => event.kind === "note")
    .map((event) => event.text)
    .join("");
  // The question is only ever asked of the NOTES: whichever narration the
  // settled body still opens with survives, and the answer is the rest. Asking
  // it of notes-plus-answer would compare a stale answer against a corrected
  // one and drop the characters between them.
  const narrationSurvived = persistedBody.startsWith(noteText);
  const survivingNoteLength = narrationSurvived
    ? noteText.length
    : longestCommonPrefix(noteText, persistedBody);
  const discardedNarration = noteText.length > 0 && !narrationSurvived;
  let remainingSurvivingLength = survivingNoteLength;
  const reconciledNotes = discardedNarration
    ? existingLog.map((event) => {
        if (event.kind !== "note") return event;
        const text = event.text.slice(0, Math.max(0, remainingSurvivingLength));
        remainingSurvivingLength -= event.text.length;
        return { ...event, text };
      })
    : existingLog;
  const answerText = persistedBody.slice(survivingNoteLength);
  const mergedDraftKeys = Array.from(
    new Set(answerEntries.flatMap(({ event }) => event.draftKeys ?? []))
  );
  const collapsedEvent: StoredAnswerTextEvent = {
    ...first.event,
    text: answerText,
    ...(mergedDraftKeys.length > 0 ? { draftKeys: mergedDraftKeys } : {})
  };
  const removeAtIndex = new Set(rest.map(({ index }) => index));
  const log = reconciledNotes
    .map((event, index) => (index === first.index ? collapsedEvent : event))
    .filter((_event, index) => !removeAtIndex.has(index));

  return {
    log,
    changed: log
      .filter((event) => event.kind === "note" || event.kind === "answer_text")
      .map(projectTurnEventForWire),
    discardedNarration
  };
}

function longestCommonPrefix(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index;
}

/**
 * ADR-170 D2.1/D5.2.2 — `delivery` is a different axis from narration order:
 * "no delivery is ever held" means a `delivery` landing between an open
 * utterance's reserved slot and its eventual fill must not stop that fill
 * from finding and reusing the reserved `seq`. This scans backward from the
 * tail SKIPPING OVER `delivery` events (and only `delivery` events) to find
 * the nearest event that actually participates in narration/answer order.
 * D5.1's answer_text-extend rule is deliberately NOT routed through this —
 * it keeps using the literal last event, so an intervening non-delivery kind
 * (e.g. `tool_call`) still closes an open answer_text segment as documented.
 */
function findNearestNonDeliveryEvent(
  log: readonly StoredTurnEvent[]
): { index: number; event: StoredTurnEvent } | null {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const event = log[index]!;
    if (event.kind !== "delivery") {
      return { index, event };
    }
  }
  return null;
}

function applyDrafts(
  existingLog: StoredTurnEvent[],
  drafts: TurnEventDraft[]
): { log: StoredTurnEvent[]; appended: PublicTurnEvent[]; mutated: boolean } {
  const log = [...existingLog];
  const appended: PublicTurnEvent[] = [];
  let mutated = false;
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
      mutated = true;
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
    const nearestNonDelivery = findNearestNonDeliveryEvent(log);

    if ((draft.kind === "note" || draft.kind === "answer_text") && draft.text === "") {
      // ADR-170 D5.2.2 — an empty-text draft is a RESERVE (only
      // `openUtterance` ever produces one; a real note/answer_text is never
      // emitted empty). It contributes no text of its own, so it either joins
      // an existing reservation or opens one:
      //  - an unfilled reservation already sits at the tail (possibly with a
      //    `delivery` after it): this reserve merges its `draftKey` onto that
      //    slot and allocates nothing, because one utterance needs one number.
      //  - otherwise it allocates a fresh empty slot below. That includes the
      //    case where the nearest numbered text already carries real text:
      //    treating "already has text" as "this utterance is settled" would be
      //    a guess, and a wrong one the moment two utterances close without an
      //    intervening tool call — the second utterance would silently lose its
      //    reservation and a cross-pod delivery could outrun its narration
      //    again. A reserve that turns out to be late is harmless: an empty
      //    slot renders nothing on every surface and the next numbered text
      //    fills it.
      const reservation =
        nearestNonDelivery !== null &&
        (nearestNonDelivery.event.kind === "note" ||
          nearestNonDelivery.event.kind === "answer_text") &&
        nearestNonDelivery.event.text === ""
          ? nearestNonDelivery
          : null;
      if (reservation !== null) {
        const target = reservation.event;
        const merged: StoredTurnEvent = {
          ...target,
          draftKeys: [...(target.draftKeys ?? []), draft.draftKey]
        };
        log[reservation.index] = merged;
        mutated = true;
        continue;
      }
    } else if (
      nearestNonDelivery !== null &&
      (nearestNonDelivery.event.kind === "note" ||
        nearestNonDelivery.event.kind === "answer_text") &&
      nearestNonDelivery.event.text === ""
    ) {
      // ADR-170 D5.2.2 — the nearest non-`delivery` event is a reserved
      // empty-text slot, possibly with one or more `delivery` events already
      // appended after it (D2.1: no delivery is ever held). This numbered
      // text event FILLS it in place — same `seq`, kind and text replaced,
      // no new `seq` allocated, at its ORIGINAL position — instead of
      // appending a new event at the tail. A slot counts as reserved only
      // while it is empty, so at most one can ever exist per message.
      const target = nearestNonDelivery.event;
      const filled: StoredTurnEvent = {
        ...draft,
        seq: target.seq,
        at: target.at,
        draftKeys: [...(target.draftKeys ?? []), draft.draftKey]
      };
      log[nearestNonDelivery.index] = filled;
      mutated = true;
      appended.push(projectTurnEventForWire(filled));
      continue;
    } else if (draft.kind === "answer_text" && last !== undefined && last.kind === "answer_text") {
      // D5.1 — extend the open answer_text segment; keep its seq, refresh
      // nothing else. Every merged draft's key survives in `draftKeys` so a
      // later replay of any one of them is still recognized as present.
      // Deliberately the STRICT literal-last check (not delivery-skipping):
      // appending any other kind — `delivery` included — still closes an
      // already-filled open segment, exactly as before this ADR.
      const extended: StoredTurnEvent = {
        ...last,
        text: last.text + draft.text,
        draftKeys: [...(last.draftKeys ?? []), draft.draftKey]
      };
      log[log.length - 1] = extended;
      mutated = true;
      appended.push(projectTurnEventForWire(extended));
      continue;
    }

    const event: StoredTurnEvent = { ...draft, seq: nextSeq, draftKeys: [draft.draftKey] };
    nextSeq += 1;
    log.push(event);
    mutated = true;
    appended.push(projectTurnEventForWire(event));
  }

  return { log, appended, mutated };
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
