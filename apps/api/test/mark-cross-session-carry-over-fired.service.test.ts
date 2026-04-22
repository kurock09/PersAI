import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MarkCrossSessionCarryOverFiredService } from "../src/modules/workspace-management/application/mark-cross-session-carry-over-fired.service";
import type { AssistantChat } from "../src/modules/workspace-management/domain/assistant-chat.entity";
import type { AssistantChatRepository } from "../src/modules/workspace-management/domain/assistant-chat.repository";

const NOW = new Date("2026-04-22T12:00:00.000Z");

function buildChat(overrides: Partial<AssistantChat> = {}): AssistantChat {
  return {
    id: "chat-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    surface: "web",
    surfaceThreadKey: "thread-1",
    title: null,
    deepModeEnabled: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastMessageAt: NOW,
    ...overrides
  } as AssistantChat;
}

interface HarnessOptions {
  chat?: AssistantChat | null;
  setReturns?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const findCalls: string[] = [];
  const setCalls: Array<{ chatId: string; firedAt: Date }> = [];

  const repository: Pick<
    AssistantChatRepository,
    "findChatById" | "setLastCrossSessionCarryOverAt"
  > = {
    async findChatById(chatId: string) {
      findCalls.push(chatId);
      return options.chat === undefined ? buildChat() : options.chat;
    },
    async setLastCrossSessionCarryOverAt(chatId: string, firedAt: Date) {
      setCalls.push({ chatId, firedAt });
      return options.setReturns ?? true;
    }
  };

  const service = new MarkCrossSessionCarryOverFiredService(repository as AssistantChatRepository);
  return { service, findCalls, setCalls };
}

async function runParseInputAccepts(): Promise<void> {
  const { service } = createHarness();
  const parsed = service.parseInput({
    assistantChatId: " chat-1 ",
    firedAt: "2026-04-22T12:00:00.000Z",
    requestId: "req-1"
  });
  assert.equal(parsed.assistantChatId, "chat-1");
  assert.equal(parsed.firedAt.toISOString(), "2026-04-22T12:00:00.000Z");
  assert.equal(parsed.requestId, "req-1");
}

async function runParseInputAcceptsNullRequestId(): Promise<void> {
  const { service } = createHarness();
  const parsed = service.parseInput({
    assistantChatId: "chat-1",
    firedAt: "2026-04-22T12:00:00.000Z",
    requestId: null
  });
  assert.equal(parsed.requestId, null);
}

async function runParseInputRejectsNonObject(): Promise<void> {
  const { service } = createHarness();
  assert.throws(() => service.parseInput("nope"), BadRequestException);
  assert.throws(() => service.parseInput([]), BadRequestException);
  assert.throws(() => service.parseInput(null), BadRequestException);
}

async function runParseInputRejectsMissingFields(): Promise<void> {
  const { service } = createHarness();
  assert.throws(
    () => service.parseInput({ firedAt: "2026-04-22T12:00:00.000Z" }),
    BadRequestException
  );
  assert.throws(() => service.parseInput({ assistantChatId: "chat-1" }), BadRequestException);
  assert.throws(
    () => service.parseInput({ assistantChatId: "chat-1", firedAt: "not-a-date" }),
    BadRequestException
  );
}

async function runParseInputRejectsUnknownKeys(): Promise<void> {
  const { service } = createHarness();
  assert.throws(
    () =>
      service.parseInput({
        assistantChatId: "chat-1",
        firedAt: "2026-04-22T12:00:00.000Z",
        requestId: null,
        somethingElse: 1
      }),
    BadRequestException
  );
}

async function runParseInputTrimsLongRequestId(): Promise<void> {
  const { service } = createHarness();
  const huge = "x".repeat(500);
  const parsed = service.parseInput({
    assistantChatId: "chat-1",
    firedAt: "2026-04-22T12:00:00.000Z",
    requestId: huge
  });
  assert.equal(parsed.requestId?.length, 128);
}

async function runExecuteHappyPathAdvanced(): Promise<void> {
  const { service, findCalls, setCalls } = createHarness({ setReturns: true });
  const result = await service.execute({
    assistantChatId: "chat-1",
    firedAt: NOW,
    requestId: "req-1"
  });
  assert.deepEqual(result, { outcome: "advanced" });
  assert.deepEqual(findCalls, ["chat-1"]);
  assert.deepEqual(setCalls, [{ chatId: "chat-1", firedAt: NOW }]);
}

async function runExecuteHappyPathNoopAlreadyNewer(): Promise<void> {
  const { service, setCalls } = createHarness({ setReturns: false });
  const result = await service.execute({
    assistantChatId: "chat-1",
    firedAt: NOW,
    requestId: null
  });
  assert.deepEqual(result, { outcome: "noop_already_newer" });
  assert.equal(setCalls.length, 1);
}

async function runExecuteRejectsMissingChat(): Promise<void> {
  const { service, setCalls } = createHarness({ chat: null });
  await assert.rejects(
    () =>
      service.execute({
        assistantChatId: "chat-missing",
        firedAt: NOW,
        requestId: null
      }),
    (err) => err instanceof NotFoundException
  );
  assert.equal(
    setCalls.length,
    0,
    "must not bump the bookkeeping cell when the chat row does not exist"
  );
}

async function run(): Promise<void> {
  await runParseInputAccepts();
  await runParseInputAcceptsNullRequestId();
  await runParseInputRejectsNonObject();
  await runParseInputRejectsMissingFields();
  await runParseInputRejectsUnknownKeys();
  await runParseInputTrimsLongRequestId();
  await runExecuteHappyPathAdvanced();
  await runExecuteHappyPathNoopAlreadyNewer();
  await runExecuteRejectsMissingChat();
}

void run();
