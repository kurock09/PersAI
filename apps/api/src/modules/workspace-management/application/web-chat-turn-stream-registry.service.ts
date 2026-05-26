import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

interface RegisteredStream {
  assistantId: string;
  userId: string;
  registeredAt: number;
  sinks: Map<string, (event: string, payload: unknown) => void>;
}

function buildStreamKey(assistantId: string, clientTurnId: string): string {
  return `${assistantId}:${clientTurnId}`;
}

@Injectable()
export class WebChatTurnStreamRegistry {
  private readonly logger = new Logger(WebChatTurnStreamRegistry.name);
  private readonly streams = new Map<string, RegisteredStream>();

  register(input: { assistantId: string; clientTurnId: string; userId: string }): void {
    const key = buildStreamKey(input.assistantId, input.clientTurnId);
    const existing = this.streams.get(key);
    if (existing !== undefined) {
      this.logger.warn(
        `[web-turn-stream-registry] reregister assistantId=${input.assistantId} clientTurnId=${input.clientTurnId} userId=${input.userId}`
      );
    }
    this.streams.set(key, {
      assistantId: input.assistantId,
      userId: input.userId,
      registeredAt: Date.now(),
      sinks: new Map()
    });
  }

  release(input: { assistantId: string; clientTurnId: string; userId: string }): void {
    const key = buildStreamKey(input.assistantId, input.clientTurnId);
    const existing = this.streams.get(key);
    if (existing === undefined || existing.userId !== input.userId) {
      return;
    }
    this.streams.delete(key);
  }

  attach(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    onEvent: (event: string, payload: unknown) => void;
  }): (() => void) | null {
    const existing = this.streams.get(buildStreamKey(input.assistantId, input.clientTurnId));
    if (existing === undefined || existing.userId !== input.userId) {
      return null;
    }
    const sinkId = randomUUID();
    existing.sinks.set(sinkId, input.onEvent);
    return () => {
      existing.sinks.delete(sinkId);
    };
  }

  publish(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    event: string;
    payload: unknown;
  }): void {
    const existing = this.streams.get(buildStreamKey(input.assistantId, input.clientTurnId));
    if (existing === undefined || existing.userId !== input.userId) {
      return;
    }
    for (const sink of existing.sinks.values()) {
      sink(input.event, input.payload);
    }
  }

  hasForTesting(assistantId: string, clientTurnId: string): boolean {
    return this.streams.has(buildStreamKey(assistantId, clientTurnId));
  }
}
