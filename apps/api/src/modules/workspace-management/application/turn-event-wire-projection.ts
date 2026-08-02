import type { TurnEvent } from "@persai/runtime-contract";

/**
 * ADR-170 D3.3.1 — internal server-side bookkeeping never reaches the wire.
 * `draftKey` (a single runtime-emitted draft's turn-scoped idempotency key —
 * present because the D3.3 append primitive spreads the originating draft
 * onto the stored event) and `draftKeys` (the D5.1 coalescing bookkeeping —
 * every `draftKey` a stored `answer_text` event merged) both exist ONLY to
 * make the append primitive's idempotent appends safe. The client, and every
 * SSE payload, must see only `seq`, `at`, `kind` and that kind's own
 * payload.
 *
 * This is the ONE shared projection every read path uses:
 *  - `AppendTurnEventsService` — for the durable log read (`getLog`/
 *    `getSince`, which also feeds reconnect catch-up) AND for the events it
 *    returns from `append()` (which is exactly what the live SSE
 *    `turn_event` payload is built from in `assistant.controller.ts`'s
 *    `onTurnEvent` callback).
 *  - `web-chat-message-state.mapper.ts` — the historical-message client
 *    projection, which reads `metadata.turnEvents` directly.
 *
 * so there is exactly one place this stripping can drift, not two.
 */
export type TurnEventWithInternalBookkeeping = TurnEvent & {
  draftKey?: string;
  draftKeys?: string[];
};

// Mirrors the `DistributiveOmit` pattern `turn-execution.service.ts` already
// uses for `TurnEventDraftWithoutKey`: `TurnEvent` is a union
// (`TurnEventDraft & { seq: number }`), and a naked conditional type
// parameter distributes over it, so the result is a proper union with
// `draftKey`/`draftKeys` removed from EVERY member rather than one flattened
// (and therefore wrong) object type.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * ADR-170 D3.3.1 — the public wire shape: every `TurnEvent` member minus the
 * server-only `draftKey`/`draftKeys` idempotency bookkeeping. This is what
 * `AssistantWebChatMessageState.turnEvents`, the live SSE `turn_event`
 * payload, and every `onTurnEvent` callback actually carry.
 */
export type PublicTurnEvent = DistributiveOmit<TurnEvent, "draftKey" | "draftKeys">;

export function projectTurnEventForWire(event: TurnEventWithInternalBookkeeping): PublicTurnEvent {
  const { draftKey: _draftKey, draftKeys: _draftKeys, ...rest } = event;
  return rest as PublicTurnEvent;
}
