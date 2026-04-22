import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";

const MAX_REQUEST_ID_CHARS = 128;

export interface MarkCrossSessionCarryOverFiredInput {
  assistantChatId: string;
  firedAt: Date;
  requestId: string | null;
}

export interface MarkCrossSessionCarryOverFiredResult {
  outcome: "advanced" | "noop_already_newer";
}

/**
 * ADR-074 Slice M3.2 — bumps the per-thread cooldown bookkeeping cell
 * (`assistant_chats.last_cross_session_carry_over_at`) after the runtime
 * renders a non-empty cross-session carry-over block.
 *
 * Idempotent against fire-and-forget retries by deferring to the repository's
 * conditional `setLastCrossSessionCarryOverAt` (only advances when the new
 * value is strictly greater than the stored one). Returns a structured
 * outcome so callers can distinguish a real bump from a no-op (used by the
 * unit tests; the runtime ignores the difference).
 */
@Injectable()
export class MarkCrossSessionCarryOverFiredService {
  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  parseInput(payload: unknown): MarkCrossSessionCarryOverFiredInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException(
        "mark-cross-session-carry-over-fired payload must be an object."
      );
    }
    const row = payload as Record<string, unknown>;

    const assistantChatId = this.asNonEmptyString(row.assistantChatId);
    const firedAt = this.asTimestamp(row.firedAt);
    const requestId = this.asNullableString(row.requestId);

    const knownKeys = new Set(["assistantChatId", "firedAt", "requestId"]);
    const unknownKeys = Object.keys(row).filter((key) => !knownKeys.has(key));
    if (unknownKeys.length > 0 || assistantChatId === null || firedAt === null) {
      throw new BadRequestException("mark-cross-session-carry-over-fired payload is invalid.");
    }

    return {
      assistantChatId,
      firedAt,
      requestId:
        requestId !== null && requestId.length > MAX_REQUEST_ID_CHARS
          ? requestId.slice(0, MAX_REQUEST_ID_CHARS)
          : requestId
    };
  }

  async execute(
    input: MarkCrossSessionCarryOverFiredInput
  ): Promise<MarkCrossSessionCarryOverFiredResult> {
    const chat = await this.assistantChatRepository.findChatById(input.assistantChatId);
    if (chat === null) {
      throw new NotFoundException("Assistant chat not found.");
    }
    const advanced = await this.assistantChatRepository.setLastCrossSessionCarryOverAt(
      input.assistantChatId,
      input.firedAt
    );
    return { outcome: advanced ? "advanced" : "noop_already_newer" };
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asNullableString(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return this.asNonEmptyString(value);
  }

  private asTimestamp(value: unknown): Date | null {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }
}
