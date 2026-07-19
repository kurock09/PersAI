/**
 * ADR-158 — durable turn-stream event store (memory or Redis).
 *
 * Ephemeral catch-up plane for web SSE events. Postgres
 * `AssistantWebChatTurnAttempt` remains status/terminal authority.
 */

export type TurnStreamEnvelope = {
  seq: number;
  event: string;
  payload: unknown;
};

export type TurnStreamMeta = {
  userId: string;
  terminalPublished: boolean;
};

export const TURN_STREAM_EVENT_STORE = Symbol("TURN_STREAM_EVENT_STORE");

export const TURN_STREAM_TERMINAL_EVENTS = new Set(["completed", "interrupted", "failed"]);

export interface TurnStreamEventStore {
  registerTurn(input: { turnKey: string; userId: string }): Promise<void>;
  append(input: {
    turnKey: string;
    userId: string;
    event: string;
    payload: unknown;
  }): Promise<TurnStreamEnvelope | null>;
  listFrom(turnKey: string, fromSeq?: number): Promise<TurnStreamEnvelope[]>;
  getMeta(turnKey: string): Promise<TurnStreamMeta | null>;
  subscribe(turnKey: string, onEvent: (envelope: TurnStreamEnvelope) => void): Promise<() => void>;
  /**
   * Drop or TTL-bound the buffer. When `shortGrace` is true (terminal already
   * published), keep a short replay window then expire.
   */
  release(turnKey: string, options?: { shortGrace?: boolean }): Promise<void>;
  exists(turnKey: string): Promise<boolean>;
  destroy?(): Promise<void>;
}

export function buildTurnStreamKey(assistantId: string, clientTurnId: string): string {
  return `${assistantId}:${clientTurnId}`;
}

export function isTurnStreamTerminalEvent(event: string): boolean {
  return TURN_STREAM_TERMINAL_EVENTS.has(event);
}
