import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AssistantChatMessage } from "../src/modules/workspace-management/domain/assistant-chat-message.entity";
import type { AssistantChatRepository } from "../src/modules/workspace-management/domain/assistant-chat.repository";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import { CloseMostSimilarOpenLoopService } from "../src/modules/workspace-management/application/close-most-similar-open-loop.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";

function buildAssistant(overrides: Partial<Assistant> = {}): Assistant {
  const now = new Date("2026-04-22T00:00:00.000Z");
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftVoiceProfile: null,
    draftArchetypeKey: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded",
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    sandboxEgressMode: "restricted",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function buildOpenLoop(
  overrides: Partial<AssistantMemoryRegistryItem>
): AssistantMemoryRegistryItem {
  return {
    id: "loop-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-A",
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: "Pick a venue for the retreat",
    sourceType: "memory_write",
    sourceLabel: "Memory write: open loop",
    memoryClass: "core",
    kind: "open_loop",
    durability: "episodic",
    stability: "time_bound",
    confidence: null,
    lastUsedAt: null,
    resolvedAt: null,
    forgottenAt: null,
    supersededAt: null,
    supersededByMemoryId: null,
    createdAt: new Date("2026-04-21T00:00:00.000Z"),
    ...overrides
  };
}

function buildMessage(overrides: Partial<AssistantChatMessage> = {}): AssistantChatMessage {
  return {
    id: "msg-1",
    chatId: "chat-A",
    assistantId: "assistant-1",
    author: "user",
    content: "Picked the venue",
    metadata: null,
    ...(overrides as AssistantChatMessage)
  };
}

function createHarness(options?: {
  assistant?: Assistant | null;
  candidate?: AssistantMemoryRegistryItem | null;
  setResolvedReturns?: boolean;
  // ADR-120 Slice 2 — the message that the supplied relatedUserMessageId
  // resolves to (or null to simulate "not found"). Its chatId scopes the
  // close-by-similarity match.
  relatedMessage?: AssistantChatMessage | null;
}) {
  const findCalls: Array<{
    assistantId: string;
    userId: string;
    chatId: string | null;
    referenceText: string;
  }> = [];
  const messageLookups: Array<{ messageId: string; assistantId: string }> = [];
  const setCalls: Array<{ id: string; assistantId: string }> = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const assistant = options?.assistant === undefined ? buildAssistant() : options.assistant;
  const relatedMessage =
    options?.relatedMessage === undefined ? buildMessage() : options.relatedMessage;
  const assistantRepository: Pick<AssistantRepository, "findById"> = {
    async findById(id) {
      return assistant !== null && assistant.id === id ? assistant : null;
    }
  };
  const memoryRegistryRepository: Pick<
    AssistantMemoryRegistryRepository,
    "findMostSimilarActiveOpenLoop" | "setResolvedAtById"
  > = {
    async findMostSimilarActiveOpenLoop(assistantId, userId, chatId, referenceText) {
      findCalls.push({ assistantId, userId, chatId, referenceText });
      const candidate = options?.candidate ?? null;
      // Mirror the real repository: a null chat scope matches nothing, and a
      // candidate that belongs to a different chat is never returned.
      if (candidate === null || chatId === null || candidate.chatId !== chatId) {
        return null;
      }
      return candidate;
    },
    async setResolvedAtById(id, assistantId) {
      setCalls.push({ id, assistantId });
      return options?.setResolvedReturns ?? true;
    }
  };
  const chatRepository: Pick<AssistantChatRepository, "findMessageByIdForAssistant"> = {
    async findMessageByIdForAssistant(messageId, assistantId) {
      messageLookups.push({ messageId, assistantId });
      return relatedMessage;
    }
  };
  const appendAuditService: Pick<AppendAssistantAuditEventService, "execute"> = {
    async execute(input) {
      auditCalls.push(input as Record<string, unknown>);
    }
  };
  return {
    service: new CloseMostSimilarOpenLoopService(
      assistantRepository as AssistantRepository,
      memoryRegistryRepository as AssistantMemoryRegistryRepository,
      chatRepository as AssistantChatRepository,
      appendAuditService as AppendAssistantAuditEventService
    ),
    findCalls,
    messageLookups,
    setCalls,
    auditCalls
  };
}

async function run(): Promise<void> {
  const validate = createHarness();

  // parseInput rejects junk
  assert.throws(
    () => validate.service.parseInput(null),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => validate.service.parseInput({ assistantId: "a" }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => validate.service.parseInput({ assistantId: "a", referenceText: "  ", requestId: null }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () =>
      validate.service.parseInput({
        assistantId: "a",
        referenceText: "x",
        requestId: null,
        unknown: 1
      }),
    (err) => err instanceof BadRequestException
  );

  // parseInput trims whitespace, collapses spaces, accepts a non-empty payload
  const parsed = validate.service.parseInput({
    assistantId: "  assistant-1  ",
    referenceText: "  Picked   the   venue  ",
    relatedUserMessageId: "  msg-1  ",
    requestId: null
  });
  assert.equal(parsed.assistantId, "assistant-1");
  assert.equal(parsed.referenceText, "Picked the venue");
  assert.equal(parsed.relatedUserMessageId, "msg-1");
  assert.equal(parsed.requestId, null);
  // relatedUserMessageId is optional and defaults to null.
  assert.equal(
    validate.service.parseInput({ assistantId: "a", referenceText: "x", requestId: null })
      .relatedUserMessageId,
    null
  );

  // execute throws on missing assistant
  const missing = createHarness({ assistant: null });
  await assert.rejects(
    () =>
      missing.service.execute({
        assistantId: "assistant-1",
        referenceText: "hello",
        relatedUserMessageId: "msg-1",
        requestId: null
      }),
    (err) => err instanceof NotFoundException
  );

  // no candidate → returns no_active_open_loop_matched, audit logs no-match,
  // setResolvedAtById is NOT called
  const noMatch = createHarness({ candidate: null });
  const noMatchResult = await noMatch.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat",
    relatedUserMessageId: "msg-1",
    requestId: "req-1"
  });
  assert.deepEqual(noMatchResult, {
    closed: false,
    closedItemId: null,
    reason: "no_active_open_loop_matched"
  });
  assert.equal(noMatch.findCalls.length, 1);
  // ADR-120 Slice 2 — the close match is scoped to the resolved current chat.
  assert.equal(noMatch.findCalls[0]?.chatId, "chat-A");
  assert.equal(noMatch.messageLookups.length, 1);
  assert.equal(noMatch.setCalls.length, 0);
  assert.equal(noMatch.auditCalls.length, 1);
  assert.equal(noMatch.auditCalls[0]?.eventCode, "assistant.open_loop_close_no_match");

  // fresh candidate within cooldown window -> soft no-op, no update, no audit
  const cooldown = createHarness({
    candidate: buildOpenLoop({ id: "loop-cooldown", createdAt: new Date(Date.now() - 2_000) })
  });
  const cooldownResult = await cooldown.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat",
    relatedUserMessageId: "msg-1",
    requestId: "req-cooldown"
  });
  assert.deepEqual(cooldownResult, {
    closed: false,
    closedItemId: "loop-cooldown",
    reason: "cooldown_active"
  });
  assert.equal(cooldown.setCalls.length, 0);
  assert.equal(cooldown.auditCalls.length, 0);

  // happy path: candidate found → setResolvedAtById called, audit explicit
  const candidate = buildOpenLoop({ id: "loop-42" });
  const happy = createHarness({ candidate, setResolvedReturns: true });
  const happyResult = await happy.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat in Barcelona",
    relatedUserMessageId: "msg-1",
    requestId: "req-2"
  });
  assert.deepEqual(happyResult, {
    closed: true,
    closedItemId: "loop-42",
    reason: "matched"
  });
  assert.equal(happy.setCalls.length, 1);
  assert.deepEqual(happy.setCalls[0], { id: "loop-42", assistantId: "assistant-1" });
  // ownership: setResolvedAtById receives the assistantId (not userId), so the
  // repository can scope the update to the assistant.
  assert.equal(happy.auditCalls.length, 1);
  assert.equal(happy.auditCalls[0]?.eventCode, "assistant.open_loop_closed_explicit");
  const details = happy.auditCalls[0]?.details as Record<string, unknown>;
  assert.equal(details.closedItemId, "loop-42");
  assert.equal(details.requestId, "req-2");
  // ADR-074 Slice M3.1 — every close path must stamp a distinct closeSource
  // so ops can tell the legacy `closeOpenLoop:true` lexical match apart from
  // the M3.1 deterministic `memory_write({ action: "close", ref })` path and
  // the M3 implicit close-by-overwrite.
  assert.equal(details.closeSource, "closeOpenLoop_flag");

  // race: candidate found but setResolvedAtById returns false (already
  // resolved by a concurrent writer). Treated as success, no extra audit.
  const race = createHarness({ candidate, setResolvedReturns: false });
  const raceResult = await race.service.execute({
    assistantId: "assistant-1",
    referenceText: "Anything",
    relatedUserMessageId: "msg-1",
    requestId: null
  });
  assert.deepEqual(raceResult, {
    closed: true,
    closedItemId: "loop-42",
    reason: "matched"
  });
  assert.equal(race.setCalls.length, 1);
  assert.equal(race.auditCalls.length, 0, "race path skips the explicit-close audit event");

  // ADR-120 Slice 2 — chat scoping: the user message resolves to chat-B, but
  // the only candidate belongs to chat-A. The repository never returns it, so
  // the model cannot close a loop from a chat it cannot see.
  const crossChat = createHarness({
    candidate: buildOpenLoop({ id: "loop-a", chatId: "chat-A" }),
    relatedMessage: buildMessage({ id: "msg-b", chatId: "chat-B" })
  });
  const crossChatResult = await crossChat.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat",
    relatedUserMessageId: "msg-b",
    requestId: "req-cross"
  });
  assert.deepEqual(crossChatResult, {
    closed: false,
    closedItemId: null,
    reason: "no_active_open_loop_matched"
  });
  assert.equal(crossChat.findCalls[0]?.chatId, "chat-B");
  assert.equal(crossChat.setCalls.length, 0);

  // ADR-120 Slice 2 — a null relatedUserMessageId yields a null chat scope:
  // the chat lookup is skipped and nothing is closed.
  const noChat = createHarness({ candidate: buildOpenLoop({ id: "loop-a", chatId: "chat-A" }) });
  const noChatResult = await noChat.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat",
    relatedUserMessageId: null,
    requestId: "req-no-chat"
  });
  assert.deepEqual(noChatResult, {
    closed: false,
    closedItemId: null,
    reason: "no_active_open_loop_matched"
  });
  assert.equal(noChat.messageLookups.length, 0, "null relatedUserMessageId must skip chat lookup");
  assert.equal(noChat.findCalls[0]?.chatId, null);
  assert.equal(noChat.setCalls.length, 0);

  // A message that does not resolve to a user-authored row also yields a null
  // chat scope (fail-soft: nothing is closed).
  const nonUser = createHarness({
    candidate: buildOpenLoop({ id: "loop-a", chatId: "chat-A" }),
    relatedMessage: buildMessage({ author: "assistant" })
  });
  const nonUserResult = await nonUser.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat",
    relatedUserMessageId: "msg-1",
    requestId: "req-non-user"
  });
  assert.equal(nonUserResult.reason, "no_active_open_loop_matched");
  assert.equal(nonUser.findCalls[0]?.chatId, null);
}

void run();
