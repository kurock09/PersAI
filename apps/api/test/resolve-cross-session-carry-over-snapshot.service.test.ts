import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ResolveCrossSessionCarryOverSnapshotService } from "../src/modules/workspace-management/application/resolve-cross-session-carry-over-snapshot.service";
import type { AssistantChatRepository } from "../src/modules/workspace-management/domain/assistant-chat.repository";

export async function runResolveCrossSessionCarryOverSnapshotServiceTest(): Promise<void> {
  const stored = new Map<string, string>();
  const repository = {
    async resolveCrossSessionCarryOverSnapshot(
      chatId: string,
      proposedSnapshot: string
    ): Promise<string | null> {
      if (chatId === "missing") {
        return null;
      }
      const existing = stored.get(chatId);
      if (existing !== undefined) {
        return existing;
      }
      stored.set(chatId, proposedSnapshot);
      return proposedSnapshot;
    }
  } as unknown as AssistantChatRepository;
  const service = new ResolveCrossSessionCarryOverSnapshotService(repository);

  assert.deepEqual(service.parseInput({ assistantChatId: " chat-1 ", snapshot: "" }), {
    assistantChatId: "chat-1",
    snapshot: ""
  });
  await assert.rejects(
    async () => service.parseInput({ assistantChatId: "chat-1", snapshot: "x".repeat(32_001) }),
    BadRequestException
  );

  assert.deepEqual(await service.execute({ assistantChatId: "chat-1", snapshot: "first" }), {
    snapshot: "first"
  });
  assert.deepEqual(await service.execute({ assistantChatId: "chat-1", snapshot: "changed" }), {
    snapshot: "first"
  });
  assert.deepEqual(await service.execute({ assistantChatId: "chat-empty", snapshot: "" }), {
    snapshot: ""
  });
  await assert.rejects(
    service.execute({ assistantChatId: "missing", snapshot: "value" }),
    NotFoundException
  );
}

void runResolveCrossSessionCarryOverSnapshotServiceTest();
