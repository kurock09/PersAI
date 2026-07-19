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
  /** Defense-in-depth on notify; attach already fences by meta.userId. */
  userId?: string;
};

export type TurnStreamMeta = {
  userId: string;
  terminalPublished: boolean;
};

export type TurnStreamRegistrationResult = "registered" | "idempotent" | "conflict" | "unavailable";

export const TURN_STREAM_EVENT_STORE = Symbol("TURN_STREAM_EVENT_STORE");

export const TURN_STREAM_TERMINAL_EVENTS = new Set(["completed", "interrupted", "failed"]);

export interface TurnStreamEventStore {
  registerTurn(input: { turnKey: string; userId: string }): Promise<TurnStreamRegistrationResult>;
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
   * Bound the buffer with a short replay grace window. Never hard-deletes a
   * registered turn buffer (pending publish tails must remain readable).
   */
  release(turnKey: string, options?: { shortGrace?: boolean }): Promise<void>;
  /**
   * True when meta exists. Throws when the store cannot determine existence
   * (e.g. Redis configured but unreachable) so callers can fail closed.
   */
  exists(turnKey: string): Promise<boolean>;
  /** Refresh buffer TTL (heartbeat / activity). Optional on memory store. */
  touch?(turnKey: string): Promise<void>;
  destroy?(): Promise<void>;
}

/** Tenant-fenced stream key: matches DB uniqueness on assistant + user + turn. */
export function buildTurnStreamKey(
  assistantId: string,
  userId: string,
  clientTurnId: string
): string {
  return `${assistantId}:${userId}:${clientTurnId}`;
}

export function isTurnStreamTerminalEvent(event: string): boolean {
  return TURN_STREAM_TERMINAL_EVENTS.has(event);
}
