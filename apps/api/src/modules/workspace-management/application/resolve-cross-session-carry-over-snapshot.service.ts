import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";

const MAX_SNAPSHOT_CHARS = 32_000;

@Injectable()
export class ResolveCrossSessionCarryOverSnapshotService {
  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  parseInput(payload: unknown): { assistantChatId: string; snapshot: string } {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException(
        "resolve-cross-session-carry-over-snapshot payload is invalid."
      );
    }
    const row = payload as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => key !== "assistantChatId" && key !== "snapshot") ||
      typeof row.assistantChatId !== "string" ||
      row.assistantChatId.trim().length === 0 ||
      typeof row.snapshot !== "string" ||
      row.snapshot.length > MAX_SNAPSHOT_CHARS
    ) {
      throw new BadRequestException(
        "resolve-cross-session-carry-over-snapshot payload is invalid."
      );
    }
    return { assistantChatId: row.assistantChatId.trim(), snapshot: row.snapshot };
  }

  async execute(input: {
    assistantChatId: string;
    snapshot: string;
  }): Promise<{ snapshot: string }> {
    const snapshot = await this.assistantChatRepository.resolveCrossSessionCarryOverSnapshot(
      input.assistantChatId,
      input.snapshot
    );
    if (snapshot === null) {
      throw new NotFoundException("Assistant chat not found.");
    }
    return { snapshot };
  }
}
