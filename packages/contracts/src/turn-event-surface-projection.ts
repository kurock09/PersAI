import type { TurnEvent } from "./generated/model/turnEvent";

/**
 * ADR-170 D6 — the closed, shared declaration of which durable turn-event
 * kinds each product surface presents. This deliberately declares visibility
 * only: each surface keeps ownership of its existing visual form.
 */
export type TurnEventProjectionSurface = "web" | "telegram";
export type TurnEventKind = TurnEvent["kind"];

export const TURN_EVENT_SURFACE_VISIBILITY = {
  web: {
    note: true,
    tool_call: true,
    answer_text: true,
    delivery: true,
    job_accepted: false,
    turn_stopped: false,
    turn_failed: false
  },
  telegram: {
    note: true,
    tool_call: false,
    answer_text: true,
    delivery: false,
    job_accepted: false,
    turn_stopped: false,
    turn_failed: false
  }
} as const satisfies Record<TurnEventProjectionSurface, Record<TurnEventKind, boolean>>;

export function isTurnEventVisibleOnSurface(
  surface: TurnEventProjectionSurface,
  kind: TurnEventKind
): boolean {
  return TURN_EVENT_SURFACE_VISIBILITY[surface][kind];
}
