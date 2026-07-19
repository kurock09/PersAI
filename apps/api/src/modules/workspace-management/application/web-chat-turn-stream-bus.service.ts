import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  buildTurnStreamKey,
  isTurnStreamTerminalEvent,
  TURN_STREAM_EVENT_STORE,
  type TurnStreamEnvelope,
  type TurnStreamEventStore
} from "./turn-stream-event-store";

export class TurnStreamRegistrationError extends Error {
  constructor(readonly reason: "conflict" | "unavailable") {
    super(`turn stream registration ${reason}`);
    this.name = "TurnStreamRegistrationError";
  }
}

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
    const key = buildTurnStreamKey(input.assistantId, input.userId, input.clientTurnId);
    const existingLocal = this.localTurns.get(key);
    if (existingLocal !== undefined && existingLocal.userId !== input.userId) {
      throw new TurnStreamRegistrationError("conflict");
    }
    const registerStore = async (): Promise<void> => {
      const result = await this.store.registerTurn({ turnKey: key, userId: input.userId });
      if (result === "conflict" || result === "unavailable") {
        throw new TurnStreamRegistrationError(result);
      }
    };
    try {
      const meta = await this.store.getMeta(key);
      if (meta !== null && meta.userId !== input.userId) {
        throw new TurnStreamRegistrationError("conflict");
      }
    } catch (error) {
      if (error instanceof TurnStreamRegistrationError) {
        throw error;
      }
      throw new TurnStreamRegistrationError("unavailable");
    }
    if (existingLocal !== undefined) {
      // Preserve local sinks and fallback sequencing during idempotent
      // registration. The durable store owns cross-replica replay.
      await registerStore();
      return;
    }
    await registerStore();
    this.localTurns.set(key, {
      assistantId: input.assistantId,
      clientTurnId: input.clientTurnId,
      userId: input.userId,
      registeredAt: Date.now(),
      terminalPublished: false,
      nextSeq: 1,
      sinks: new Map()
    });
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
    const key = buildTurnStreamKey(input.assistantId, input.userId, input.clientTurnId);
    return this.enqueuePublish(key, () => this.publishUnlocked(input, key));
  }

  async attach(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    onEvent: (event: string, payload: unknown) => void;
    fromSeq?: number;
  }): Promise<(() => void) | null> {
    const key = buildTurnStreamKey(input.assistantId, input.userId, input.clientTurnId);
    const local = this.localTurns.get(key);
    if (local !== undefined && local.userId !== input.userId) {
      return null;
    }

    let meta;
    try {
      meta = await this.store.getMeta(key);
    } catch (error) {
      // Redis is only the ephemeral live plane. The caller must fall back to
      // durable attempt status/history rather than turning reattach into 500.
      this.logger.warn(`[turn-stream-bus] attach meta unavailable: ${String(error)}`);
      return null;
    }
    if (meta !== null && meta.userId !== input.userId) {
      return null;
    }

    const canServeLocal = local !== undefined;
    const canServeStore = meta !== null;
    if (!canServeLocal && !canServeStore) {
      return null;
    }

    try {
      if (canServeLocal) {
        return await this.attachLocal(input, local, key);
      }
      return await this.attachRemote(input, key);
    } catch (error) {
      this.logger.warn(`[turn-stream-bus] attach live plane unavailable: ${String(error)}`);
      return null;
    }
  }

  release(input: { assistantId: string; clientTurnId: string; userId: string }): void {
    void this.releaseAsync(input).catch((error: unknown) => {
      this.logger.warn(`[turn-stream-bus] release failed: ${String(error)}`);
    });
  }

  /**
   * Drain the per-turn publish queue (including terminal), then grace-release
   * the store buffer. Prefer awaiting this from controller/continuation finally.
   */
  async releaseAsync(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
  }): Promise<void> {
    const key = buildTurnStreamKey(input.assistantId, input.userId, input.clientTurnId);
    await this.enqueuePublish(key, () => this.releaseUnlocked(input, key));
  }

  async touch(input: { assistantId: string; clientTurnId: string; userId: string }): Promise<void> {
    const key = buildTurnStreamKey(input.assistantId, input.userId, input.clientTurnId);
    if (typeof this.store.touch !== "function") {
      return;
    }
    try {
      await this.store.touch(key);
    } catch (error) {
      this.logger.warn(`[turn-stream-bus] touch failed: ${String(error)}`);
    }
  }

  /**
   * True when a local registration or durable buffer exists.
   * On store probe failure (e.g. Redis unreachable), returns true so orphan
   * reconcile does not claim the turn inactive.
   */
  async hasActiveStream(
    assistantId: string,
    userId: string,
    clientTurnId: string
  ): Promise<boolean> {
    const key = buildTurnStreamKey(assistantId, userId, clientTurnId);
    if (this.localTurns.has(key)) {
      return true;
    }
    try {
      return await this.store.exists(key);
    } catch (error) {
      this.logger.warn(
        `[turn-stream-bus] hasActiveStream store probe failed (treat active): ${String(error)}`
      );
      return true;
    }
  }

  hasLocalRegistrationForTesting(
    assistantId: string,
    userId: string,
    clientTurnId: string
  ): boolean {
    return this.localTurns.has(buildTurnStreamKey(assistantId, userId, clientTurnId));
  }

  async onModuleDestroy(): Promise<void> {
    this.localTurns.clear();
    this.publishQueues.clear();
    if (typeof this.store.destroy === "function") {
      await this.store.destroy();
    }
  }

  private async releaseUnlocked(
    input: {
      assistantId: string;
      clientTurnId: string;
      userId: string;
    },
    key: string
  ): Promise<void> {
    const local = this.localTurns.get(key);
    if (local !== undefined) {
      if (local.userId !== input.userId) {
        return;
      }
      this.localTurns.delete(key);
    } else {
      try {
        const meta = await this.store.getMeta(key);
        if (meta === null || meta.userId !== input.userId) {
          return;
        }
      } catch (error) {
        this.logger.warn(`[turn-stream-bus] release getMeta failed: ${String(error)}`);
        return;
      }
    }
    // Always shortGrace after a registered turn — never wipe undrained events.
    await this.store.release(key, { shortGrace: true });
    this.publishQueues.delete(key);
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

    const appendInput = {
      turnKey: key,
      userId: input.userId,
      event: input.event,
      payload: input.payload
    };
    let envelope: TurnStreamEnvelope | null = null;
    try {
      envelope = await this.store.append(appendInput);
      if (envelope === null) {
        envelope = await this.store.append(appendInput);
      }
    } catch (error) {
      this.logger.error(`[turn-stream-bus] store append threw: ${String(error)}`);
    }
    if (envelope === null) {
      // Durable plane missed — do not pretend Redis success. Local fanout below
      // still serves same-pod sinks; localTurns keeps hasActiveStream true.
      this.logger.error(
        `[turn-stream-bus] durable append failed after retry assistantId=${input.assistantId} clientTurnId=${input.clientTurnId} event=${input.event}`
      );
    }

    // Same-pod sinks still receive events when the durable store is unavailable.
    if (local !== undefined) {
      if (envelope === null) {
        envelope = {
          seq: local.nextSeq,
          event: input.event,
          payload: input.payload,
          userId: input.userId
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

  private envelopeAllowed(envelope: TurnStreamEnvelope, userId: string): boolean {
    return envelope.userId === undefined || envelope.userId === userId;
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
      if (!this.envelopeAllowed(envelope, input.userId)) {
        return;
      }
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
      if (!this.envelopeAllowed(envelope, input.userId)) {
        return;
      }
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
