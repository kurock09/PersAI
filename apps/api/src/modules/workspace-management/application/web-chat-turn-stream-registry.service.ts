import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

interface RegisteredStream {
  userId: string;
  registeredAt: number;
  sinks: Map<string, (event: string, payload: unknown) => void>;
}

@Injectable()
export class WebChatTurnStreamRegistry {
  private readonly logger = new Logger(WebChatTurnStreamRegistry.name);
  private readonly streams = new Map<string, RegisteredStream>();

  register(input: { clientTurnId: string; userId: string }): void {
    const existing = this.streams.get(input.clientTurnId);
    if (existing !== undefined) {
      this.logger.warn(
        `[web-turn-stream-registry] reregister clientTurnId=${input.clientTurnId} userId=${input.userId}`
      );
    }
    this.streams.set(input.clientTurnId, {
      userId: input.userId,
      registeredAt: Date.now(),
      sinks: new Map()
    });
  }

  release(input: { clientTurnId: string; userId: string }): void {
    const existing = this.streams.get(input.clientTurnId);
    if (existing === undefined || existing.userId !== input.userId) {
      return;
    }
    this.streams.delete(input.clientTurnId);
  }

  attach(input: {
    clientTurnId: string;
    userId: string;
    onEvent: (event: string, payload: unknown) => void;
  }): (() => void) | null {
    const existing = this.streams.get(input.clientTurnId);
    if (existing === undefined || existing.userId !== input.userId) {
      return null;
    }
    const sinkId = randomUUID();
    existing.sinks.set(sinkId, input.onEvent);
    return () => {
      existing.sinks.delete(sinkId);
    };
  }

  publish(input: { clientTurnId: string; userId: string; event: string; payload: unknown }): void {
    const existing = this.streams.get(input.clientTurnId);
    if (existing === undefined || existing.userId !== input.userId) {
      return;
    }
    for (const sink of existing.sinks.values()) {
      sink(input.event, input.payload);
    }
  }

  hasForTesting(clientTurnId: string): boolean {
    return this.streams.has(clientTurnId);
  }
}
