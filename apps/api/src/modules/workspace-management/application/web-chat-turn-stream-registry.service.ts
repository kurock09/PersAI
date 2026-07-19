import { Injectable } from "@nestjs/common";
import { WebChatTurnStreamBusService } from "./web-chat-turn-stream-bus.service";

/**
 * ADR-158 — thin facade over {@link WebChatTurnStreamBusService}.
 *
 * Controllers and continuation keep calling register/publish/attach/release;
 * the bus owns durable Redis (or memory) catch-up plus same-pod sinks.
 */
@Injectable()
export class WebChatTurnStreamRegistry {
  constructor(private readonly bus: WebChatTurnStreamBusService) {}

  async register(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
  }): Promise<void> {
    await this.bus.registerTurn(input);
  }

  release(input: { assistantId: string; clientTurnId: string; userId: string }): void {
    this.bus.release(input);
  }

  async attach(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    onEvent: (event: string, payload: unknown) => void;
    fromSeq?: number;
  }): Promise<(() => void) | null> {
    return this.bus.attach(input);
  }

  publish(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    event: string;
    payload: unknown;
  }): void {
    this.bus.publish(input);
  }

  async hasActiveStream(assistantId: string, clientTurnId: string): Promise<boolean> {
    return this.bus.hasActiveStream(assistantId, clientTurnId);
  }

  hasForTesting(assistantId: string, clientTurnId: string): boolean {
    return this.bus.hasLocalRegistrationForTesting(assistantId, clientTurnId);
  }
}
