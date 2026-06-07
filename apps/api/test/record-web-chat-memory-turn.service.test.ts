import assert from "node:assert/strict";
import { createDefaultMemoryControlEnvelope } from "../src/modules/workspace-management/domain/assistant-memory-control.defaults";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import { RecordWebChatMemoryTurnService } from "../src/modules/workspace-management/application/record-web-chat-memory-turn.service";
import {
  buildWebChatMemorySummary,
  shouldSkipWebChatMemoryTurn
} from "../src/modules/workspace-management/application/memory-summary.util";

function createHarness() {
  const createdInputs: Array<Record<string, unknown>> = [];
  const governanceRepository: Pick<AssistantGovernanceRepository, "findByAssistantId"> = {
    async findByAssistantId() {
      return {
        id: "gov-1",
        assistantId: "assistant-1",
        capabilityEnvelope: null,
        secretRefs: null,
        policyEnvelope: null,
        memoryControl: createDefaultMemoryControlEnvelope(),
        tasksControl: null,
        quotaHook: null,
        auditHook: null,
        assistantPlanOverrideCode: null,
        quotaPlanCode: null,
        createdAt: new Date("2026-06-07T00:00:00.000Z"),
        updatedAt: new Date("2026-06-07T00:00:00.000Z")
      };
    }
  };
  const memoryRepository: Pick<AssistantMemoryRegistryRepository, "create"> = {
    async create(input) {
      createdInputs.push(input as Record<string, unknown>);
      return {
        id: "memory-1",
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        relatedUserMessageId: input.relatedUserMessageId,
        relatedAssistantMessageId: input.relatedAssistantMessageId,
        summary: input.summary,
        sourceType: input.sourceType,
        sourceLabel: input.sourceLabel,
        memoryClass: input.memoryClass,
        kind: input.kind,
        durability: input.durability,
        stability: input.stability,
        confidence: input.confidence,
        lastUsedAt: null,
        resolvedAt: null,
        forgottenAt: null,
        createdAt: new Date("2026-06-07T00:00:00.000Z")
      };
    }
  };

  return {
    service: new RecordWebChatMemoryTurnService(
      memoryRepository as AssistantMemoryRegistryRepository,
      governanceRepository as AssistantGovernanceRepository
    ),
    createdInputs
  };
}

async function run(): Promise<void> {
  assert.equal(shouldSkipWebChatMemoryTurn("Привет", "Привет"), true);
  assert.equal(shouldSkipWebChatMemoryTurn("Hello", "Thanks"), true);
  assert.equal(
    shouldSkipWebChatMemoryTurn(
      "I prefer terse 3-bullet answers and no fluff.",
      "Understood, I'll keep future replies terse."
    ),
    false
  );

  const greetingHarness = createHarness();
  await greetingHarness.service.execute({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    userMessageId: "message-user-1",
    assistantMessageId: "message-assistant-1",
    userContent: "Привет",
    assistantContent: "Привет",
    memoryWriteContext: {
      transportSurface: "web",
      sourceTrust: "trusted_1to1"
    }
  });
  assert.equal(greetingHarness.createdInputs.length, 0);

  const englishAckHarness = createHarness();
  await englishAckHarness.service.execute({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    userMessageId: "message-user-2",
    assistantMessageId: "message-assistant-2",
    userContent: "Hello",
    assistantContent: "Thanks",
    memoryWriteContext: {
      transportSurface: "web",
      sourceTrust: "trusted_1to1"
    }
  });
  assert.equal(englishAckHarness.createdInputs.length, 0);

  const substantiveHarness = createHarness();
  await substantiveHarness.service.execute({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    userMessageId: "message-user-3",
    assistantMessageId: "message-assistant-3",
    userContent: "I prefer terse 3-bullet answers and no fluff.",
    assistantContent: "Understood, I'll keep future replies terse.",
    memoryWriteContext: {
      transportSurface: "web",
      sourceTrust: "trusted_1to1"
    }
  });
  assert.equal(substantiveHarness.createdInputs.length, 1);
  assert.deepEqual(substantiveHarness.createdInputs[0], {
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    relatedUserMessageId: "message-user-3",
    relatedAssistantMessageId: "message-assistant-3",
    summary: buildWebChatMemorySummary(
      "I prefer terse 3-bullet answers and no fluff.",
      "Understood, I'll keep future replies terse."
    ),
    sourceType: "web_chat",
    sourceLabel: "Web chat",
    memoryClass: "contextual",
    kind: null,
    durability: null,
    stability: null,
    confidence: null
  });
}

void run();
