import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  buildTurnStreamKey,
  isTurnStreamTerminalEvent,
  TURN_STREAM_EVENT_STORE,
  type TurnStreamEnvelope,
  type TurnStreamEventStore
} from "./turn-stream-event-store";

interface LocalTurnRegistration {
  assistantId: string;
  clientTurnId: string;
  userId: string;
  registeredAt: number;
  terminalPublished: boolean;
  /** Fallback seq when the durable store is unavailable. */
  nextSeq: number;
  sinks: Map<string, (envelope: TurnStreamEnvelope) => void>;
}

/**
 * ADR-158 — durable multi-pod web turn stream bus.
 *
 * Owning path appends every SSE-facing event to the injectable store and fans
 * out to same-pod sinks. Reattach on any pod replays the buffer then follows
 * live appends. Soft-detach semantics are unchanged (SSE death ≠ Stop).
 */
@Injectable()
export class WebChatTurnStreamBusService implements OnModuleDestroy {
  private readonly logger = new Logger(WebChatTurnStreamBusService.name);
  private readonly localTurns = new Map<string, LocalTurnRegistration>();
  private readonly publishQueues = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(TURN_STREAM_EVENT_STORE)
    private readonly store: TurnStreamEventStore
  ) {}

  async registerTurn(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
  }): Promise<void> {
    const key = buildTurnStreamKey(input.assistantId, input.clientTurnId);
    const existing = this.localTurns.get(key);
    if (existing !== undefined) {
      this.logger.warn(
        `[turn-stream-bus] reregister assistantId=${input.assistantId} clientTurnId=${input.clientTurnId} userId=${input.userId}`
      );
    }
    this.localTurns.set(key, {
      assistantId: input.assistantId,
      clientTurnId: input.clientTurnId,
      userId: input.userId,
      registeredAt: Date.now(),
      terminalPublished: false,
      nextSeq: 1,
      sinks: new Map()
    });
    try {
      await this.store.registerTurn({ turnKey: key, userId: input.userId });
    } catch (error) {
      this.logger.warn(`[turn-stream-bus] registerTurn store failed: ${String(error)}`);
    }
  }

  publish(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    event: string;
    payload: unknown;
  }): void {
    void this.publishAsync(input).catch((error: unknown) => {
      this.logger.warn(`[turn-stream-bus] publish failed: ${String(error)}`);
    });
  }

  async publishAsync(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    event: string;
    payload: unknown;
  }): Promise<void> {
    const key = buildTurnStreamKey(input.assistantId, input.clientTurnId);
    return this.enqueuePublish(key, () => this.publishUnlocked(input, key));
  }

  async attach(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    onEvent: (event: string, payload: unknown) => void;
    fromSeq?: number;
  }): Promise<(() => void) | null> {
    const key = buildTurnStreamKey(input.assistantId, input.clientTurnId);
    const local = this.localTurns.get(key);
    if (local !== undefined && local.userId !== input.userId) {
      return null;
    }

    const meta = await this.store.getMeta(key);
    if (meta !== null && meta.userId !== input.userId) {
      return null;
    }

    const canServeLocal = local !== undefined;
    const canServeStore = meta !== null;
    if (!canServeLocal && !canServeStore) {
      return null;
    }

    if (canServeLocal) {
      return this.attachLocal(input, local, key);
    }
    return this.attachRemote(input, key);
  }

  release(input: { assistantId: string; clientTurnId: string; userId: string }): void {
    void this.releaseAsync(input).catch((error: unknown) => {
      this.logger.warn(`[turn-stream-bus] release failed: ${String(error)}`);
    });
  }

  async releaseAsync(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
  }): Promise<void> {
    const key = buildTurnStreamKey(input.assistantId, input.clientTurnId);
    const local = this.localTurns.get(key);
    let terminalPublished = false;
    if (local !== undefined) {
      if (local.userId !== input.userId) {
        return;
      }
      terminalPublished = local.terminalPublished;
      this.localTurns.delete(key);
      this.publishQueues.delete(key);
    } else {
      const meta = await this.store.getMeta(key);
      if (meta === null || meta.userId !== input.userId) {
        return;
      }
      terminalPublished = meta.terminalPublished;
    }
    await this.store.release(key, { shortGrace: terminalPublished });
  }

  async hasActiveStream(assistantId: string, clientTurnId: string): Promise<boolean> {
    const key = buildTurnStreamKey(assistantId, clientTurnId);
    if (this.localTurns.has(key)) {
      return true;
    }
    return this.store.exists(key);
  }

  hasLocalRegistrationForTesting(assistantId: string, clientTurnId: string): boolean {
    return this.localTurns.has(buildTurnStreamKey(assistantId, clientTurnId));
  }

  async onModuleDestroy(): Promise<void> {
    this.localTurns.clear();
    this.publishQueues.clear();
    if (typeof this.store.destroy === "function") {
      await this.store.destroy();
    }
  }

  private async publishUnlocked(
    input: {
      assistantId: string;
      clientTurnId: string;
      userId: string;
      event: string;
      payload: unknown;
    },
    key: string
  ): Promise<void> {
    const local = this.localTurns.get(key);
    if (local !== undefined && local.userId !== input.userId) {
      return;
    }
    if (local !== undefined && isTurnStreamTerminalEvent(input.event)) {
      local.terminalPublished = true;
    }

    let envelope: TurnStreamEnvelope | null = null;
    try {
      envelope = await this.store.append({
        turnKey: key,
        userId: input.userId,
        event: input.event,
        payload: input.payload
      });
    } catch (error) {
      this.logger.warn(`[turn-stream-bus] store append failed: ${String(error)}`);
    }

    // Same-pod sinks still receive events when the durable store is unavailable.
    if (local !== undefined) {
      if (envelope === null) {
        envelope = {
          seq: local.nextSeq,
          event: input.event,
          payload: input.payload
        };
        local.nextSeq += 1;
      } else {
        local.nextSeq = envelope.seq + 1;
      }
      for (const sink of local.sinks.values()) {
        sink(envelope);
      }
    }
  }

  private enqueuePublish(turnKey: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.publishQueues.get(turnKey) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.publishQueues.set(
      turnKey,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  private async attachLocal(
    input: {
      assistantId: string;
      clientTurnId: string;
      userId: string;
      onEvent: (event: string, payload: unknown) => void;
      fromSeq?: number;
    },
    local: LocalTurnRegistration,
    key: string
  ): Promise<() => void> {
    let lastSeq = input.fromSeq ?? 0;
    const pending: TurnStreamEnvelope[] = [];
    let replaying = true;

    const deliver = (envelope: TurnStreamEnvelope): void => {
      if (envelope.seq <= lastSeq) {
        return;
      }
      lastSeq = envelope.seq;
      input.onEvent(envelope.event, envelope.payload);
    };

    const sinkId = randomUUID();
    local.sinks.set(sinkId, (envelope) => {
      if (replaying) {
        pending.push(envelope);
        return;
      }
      deliver(envelope);
    });

    try {
      const history = await this.store.listFrom(key, input.fromSeq ?? 0);
      for (const envelope of history) {
        deliver(envelope);
      }
      replaying = false;
      for (const envelope of pending) {
        deliver(envelope);
      }
    } catch (error) {
      local.sinks.delete(sinkId);
      throw error;
    }

    return () => {
      local.sinks.delete(sinkId);
    };
  }

  private async attachRemote(
    input: {
      assistantId: string;
      clientTurnId: string;
      userId: string;
      onEvent: (event: string, payload: unknown) => void;
      fromSeq?: number;
    },
    key: string
  ): Promise<() => void> {
    let lastSeq = input.fromSeq ?? 0;
    const pending: TurnStreamEnvelope[] = [];
    let replaying = true;

    const deliver = (envelope: TurnStreamEnvelope): void => {
      if (envelope.seq <= lastSeq) {
        return;
      }
      lastSeq = envelope.seq;
      input.onEvent(envelope.event, envelope.payload);
    };

    const unsubscribe = await this.store.subscribe(key, (envelope) => {
      if (replaying) {
        pending.push(envelope);
        return;
      }
      deliver(envelope);
    });

    try {
      const history = await this.store.listFrom(key, input.fromSeq ?? 0);
      for (const envelope of history) {
        deliver(envelope);
      }
      replaying = false;
      for (const envelope of pending) {
        deliver(envelope);
      }
    } catch (error) {
      unsubscribe();
      throw error;
    }

    return unsubscribe;
  }
}
