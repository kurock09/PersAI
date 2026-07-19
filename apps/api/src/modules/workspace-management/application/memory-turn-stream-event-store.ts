import {
  isTurnStreamTerminalEvent,
  type TurnStreamEnvelope,
  type TurnStreamEventStore,
  type TurnStreamMeta
} from "./turn-stream-event-store";

type MemoryTurnBuffer = {
  userId: string;
  nextSeq: number;
  events: TurnStreamEnvelope[];
  terminalPublished: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
};

const RELEASE_GRACE_MS = 30_000;

/**
 * Process-local (or test-shared) turn-stream buffer with in-process pub/sub.
 * Two bus instances can share one store to simulate multi-pod fanout in tests.
 * Appends are serialized per turn key so concurrent publishers get unique seq.
 */
export class MemoryTurnStreamEventStore implements TurnStreamEventStore {
  private readonly buffers = new Map<string, MemoryTurnBuffer>();
  private readonly listeners = new Map<string, Set<(envelope: TurnStreamEnvelope) => void>>();
  private readonly appendQueues = new Map<string, Promise<unknown>>();

  async registerTurn(input: { turnKey: string; userId: string }): Promise<void> {
    const existing = this.buffers.get(input.turnKey);
    if (existing !== undefined && existing.userId !== input.userId) {
      // Fail closed — never overwrite another tenant's buffer.
      return;
    }
    if (existing?.graceTimer !== null && existing?.graceTimer !== undefined) {
      clearTimeout(existing.graceTimer);
    }
    this.buffers.set(input.turnKey, {
      userId: input.userId,
      nextSeq: 1,
      events: [],
      terminalPublished: false,
      graceTimer: null
    });
  }

  async append(input: {
    turnKey: string;
    userId: string;
    event: string;
    payload: unknown;
  }): Promise<TurnStreamEnvelope | null> {
    return this.enqueueAppend(input.turnKey, () => this.appendUnlocked(input));
  }

  async listFrom(turnKey: string, fromSeq?: number): Promise<TurnStreamEnvelope[]> {
    const buffer = this.buffers.get(turnKey);
    if (buffer === undefined) {
      return [];
    }
    const minSeq = fromSeq ?? 0;
    return buffer.events.filter((envelope) => envelope.seq > minSeq);
  }

  async getMeta(turnKey: string): Promise<TurnStreamMeta | null> {
    const buffer = this.buffers.get(turnKey);
    if (buffer === undefined) {
      return null;
    }
    return {
      userId: buffer.userId,
      terminalPublished: buffer.terminalPublished
    };
  }

  async subscribe(
    turnKey: string,
    onEvent: (envelope: TurnStreamEnvelope) => void
  ): Promise<() => void> {
    let set = this.listeners.get(turnKey);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(turnKey, set);
    }
    set.add(onEvent);
    return () => {
      const current = this.listeners.get(turnKey);
      if (current === undefined) {
        return;
      }
      current.delete(onEvent);
      if (current.size === 0) {
        this.listeners.delete(turnKey);
      }
    };
  }

  async release(turnKey: string, _options?: { shortGrace?: boolean }): Promise<void> {
    const buffer = this.buffers.get(turnKey);
    if (buffer === undefined) {
      return;
    }
    if (buffer.graceTimer !== null) {
      clearTimeout(buffer.graceTimer);
      buffer.graceTimer = null;
    }
    // Always short grace — never hard-delete undrained events.
    buffer.graceTimer = setTimeout(() => {
      this.buffers.delete(turnKey);
      this.listeners.delete(turnKey);
      this.appendQueues.delete(turnKey);
    }, RELEASE_GRACE_MS);
    if (typeof buffer.graceTimer.unref === "function") {
      buffer.graceTimer.unref();
    }
  }

  async exists(turnKey: string): Promise<boolean> {
    return this.buffers.has(turnKey);
  }

  async touch(_turnKey: string): Promise<void> {
    // Memory buffers have no TTL; no-op.
  }

  async destroy(): Promise<void> {
    for (const buffer of this.buffers.values()) {
      if (buffer.graceTimer !== null) {
        clearTimeout(buffer.graceTimer);
      }
    }
    this.buffers.clear();
    this.listeners.clear();
    this.appendQueues.clear();
  }

  private appendUnlocked(input: {
    turnKey: string;
    userId: string;
    event: string;
    payload: unknown;
  }): TurnStreamEnvelope | null {
    const buffer = this.buffers.get(input.turnKey);
    if (buffer === undefined || buffer.userId !== input.userId) {
      return null;
    }
    const envelope: TurnStreamEnvelope = {
      seq: buffer.nextSeq,
      event: input.event,
      payload: input.payload,
      userId: input.userId
    };
    buffer.nextSeq += 1;
    buffer.events.push(envelope);
    if (isTurnStreamTerminalEvent(input.event)) {
      buffer.terminalPublished = true;
    }
    const listeners = this.listeners.get(input.turnKey);
    if (listeners !== undefined) {
      for (const listener of listeners) {
        listener(envelope);
      }
    }
    return envelope;
  }

  private enqueueAppend<T>(turnKey: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.appendQueues.get(turnKey) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.appendQueues.set(
      turnKey,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }
}
