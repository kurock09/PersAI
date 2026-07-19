import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  TURN_STREAM_EVENT_STORE,
  type TurnStreamEnvelope,
  type TurnStreamEventStore
} from "./turn-stream-event-store";

export type WebChatContinuationDiscovery = {
  seq: number;
  clientTurnId: string;
};

function buildDiscoveryKey(input: {
  assistantId: string;
  userId: string;
  chatId: string;
  threadKey: string;
}): string {
  const threadDigest = createHash("sha256").update(input.threadKey).digest("hex").slice(0, 24);
  return `continuation-discovery:${input.assistantId}:${input.userId}:${input.chatId}:${threadDigest}`;
}

function parseDiscovery(envelope: TurnStreamEnvelope): WebChatContinuationDiscovery | null {
  if (envelope.event !== "continuation_ready" || typeof envelope.payload !== "object") {
    return null;
  }
  const clientTurnId = (envelope.payload as { clientTurnId?: unknown }).clientTurnId;
  if (
    typeof clientTurnId !== "string" ||
    !clientTurnId.startsWith("async-cont:") ||
    clientTurnId.length > 200
  ) {
    return null;
  }
  return { seq: envelope.seq, clientTurnId };
}

/**
 * Chat-scoped discovery plane for synthetic async-cont turns.
 *
 * The existing ADR-158 bus remains the token/event stream. This small,
 * replayable channel only tells an already-open owning chat which exact
 * clientTurnId is now registered and safe to attach.
 */
@Injectable()
export class WebChatContinuationDiscoveryService {
  constructor(
    @Inject(TURN_STREAM_EVENT_STORE)
    private readonly store: TurnStreamEventStore
  ) {}

  async publishReady(input: {
    assistantId: string;
    userId: string;
    chatId: string;
    threadKey: string;
    clientTurnId: string;
  }): Promise<void> {
    if (!input.clientTurnId.startsWith("async-cont:") || input.clientTurnId.length > 200) {
      throw new Error("Invalid continuation discovery identity.");
    }
    const turnKey = buildDiscoveryKey(input);
    const registration = await this.store.registerTurn({ turnKey, userId: input.userId });
    if (registration === "conflict" || registration === "unavailable") {
      throw new Error(`Continuation discovery registration ${registration}.`);
    }

    // Retry/reconciliation may revisit the same attempt. Keep replay bounded
    // semantically by publishing one discovery envelope per synthetic turn.
    const existing = await this.store.listFrom(turnKey);
    if (
      existing.some((envelope) => parseDiscovery(envelope)?.clientTurnId === input.clientTurnId)
    ) {
      return;
    }
    const appended = await this.store.append({
      turnKey,
      userId: input.userId,
      event: "continuation_ready",
      payload: { clientTurnId: input.clientTurnId }
    });
    if (appended === null) {
      throw new Error("Continuation discovery publish unavailable.");
    }
  }

  async attach(input: {
    assistantId: string;
    userId: string;
    chatId: string;
    threadKey: string;
    fromSeq?: number;
    onDiscovery: (discovery: WebChatContinuationDiscovery) => void;
  }): Promise<() => void> {
    const turnKey = buildDiscoveryKey(input);
    const registration = await this.store.registerTurn({ turnKey, userId: input.userId });
    if (registration === "conflict" || registration === "unavailable") {
      throw new Error(`Continuation discovery registration ${registration}.`);
    }

    let lastSeq = input.fromSeq ?? 0;
    const pending: TurnStreamEnvelope[] = [];
    let replaying = true;
    const deliver = (envelope: TurnStreamEnvelope): void => {
      if (envelope.seq <= lastSeq || envelope.userId !== input.userId) return;
      lastSeq = envelope.seq;
      const discovery = parseDiscovery(envelope);
      if (discovery !== null) input.onDiscovery(discovery);
    };
    const unsubscribe = await this.store.subscribe(turnKey, (envelope) => {
      if (replaying) pending.push(envelope);
      else deliver(envelope);
    });
    try {
      const replay = await this.store.listFrom(turnKey, lastSeq);
      for (const envelope of replay) deliver(envelope);
      replaying = false;
      for (const envelope of pending) deliver(envelope);
      const keepalive = setInterval(() => {
        void this.store.touch?.(turnKey);
      }, 300_000);
      return () => {
        clearInterval(keepalive);
        unsubscribe();
      };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }
}
