import assert from "node:assert/strict";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayToolExchange
} from "@persai/runtime-contract";
import { DeepSeekAppendTraceCoordinatorService } from "../src/modules/turns/deepseek-append-trace-coordinator.service";
import type {
  InternalDeepSeekAppendTrace,
  InternalDeepSeekAppendTraceEvent,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";

function request(
  input: {
    developerInstructions?: string;
    toolFollowUpUserContent?: ProviderGatewayTextGenerateRequest["toolFollowUpUserContent"];
    toolHistory?: ProviderGatewayToolExchange[];
    classification?: "main_turn" | "tool_loop_followup";
    runtimeRequestId?: string;
  } = {}
): ProviderGatewayTextGenerateRequest {
  return {
    provider: "deepseek",
    model: "deepseek-v4",
    systemPrompt: "stable system",
    developerInstructions: input.developerInstructions ?? "volatile v1",
    messages: [{ role: "user", content: "current user" }],
    ...(input.toolHistory === undefined ? {} : { toolHistory: input.toolHistory }),
    ...(input.toolFollowUpUserContent === undefined
      ? {}
      : { toolFollowUpUserContent: input.toolFollowUpUserContent }),
    requestMetadata: {
      classification: input.classification ?? "tool_loop_followup",
      runtimeRequestId: input.runtimeRequestId ?? "request-1",
      runtimeSessionId: "session-1",
      toolLoopIteration: 1,
      compactionToolCode: null
    }
  };
}

function exchange(id: string, content: string): ProviderGatewayToolExchange {
  return {
    toolCall: {
      id,
      name: id === "describe" ? "files" : "knowledge_search",
      arguments: id === "describe" ? { action: "describe" } : { query: id }
    },
    toolResult: {
      toolCallId: id,
      name: id === "describe" ? "files" : "knowledge_search",
      content,
      isError: false
    },
    reasoningContent: `reasoning ${id}`,
    assistantText: `calling ${id}`
  };
}

class FakeTraceApi {
  trace: InternalDeepSeekAppendTrace | null = null;

  async readDeepSeekAppendTrace(): Promise<InternalDeepSeekAppendTrace | null> {
    return this.trace === null ? null : structuredClone(this.trace);
  }

  async resetDeepSeekAppendTrace(input: {
    configHash: string;
    seedEvents: Omit<InternalDeepSeekAppendTraceEvent, "ordinal">[];
  }): Promise<InternalDeepSeekAppendTrace> {
    this.trace = {
      activeEpoch: 1,
      nextOrdinal: input.seedEvents.length,
      configHash: input.configHash,
      events: input.seedEvents.map((event, ordinal) => ({ ...event, ordinal }))
    };
    return structuredClone(this.trace);
  }

  async appendDeepSeekAppendTrace(input: {
    expectedOrdinal: number;
    events: Omit<InternalDeepSeekAppendTraceEvent, "ordinal">[];
  }): Promise<InternalDeepSeekAppendTrace> {
    assert.ok(this.trace !== null);
    const existing = input.events.every((candidate) =>
      this.trace!.events.some(
        (event) =>
          event.sourceKey === candidate.sourceKey &&
          event.kind === candidate.kind &&
          event.role === candidate.role &&
          event.contentText === candidate.contentText &&
          JSON.stringify(event.contentJson) === JSON.stringify(candidate.contentJson)
      )
    );
    if (existing) return structuredClone(this.trace);
    assert.equal(input.expectedOrdinal, this.trace.nextOrdinal);
    this.trace.events.push(
      ...input.events.map((event, index) => ({ ...event, ordinal: input.expectedOrdinal + index }))
    );
    this.trace.nextOrdinal += input.events.length;
    return structuredClone(this.trace);
  }
}

export async function runDeepSeekAppendTraceCoordinatorServiceTest(): Promise<void> {
  const api = new FakeTraceApi();
  const coordinator = new DeepSeekAppendTraceCoordinatorService(
    api as unknown as PersaiInternalApiClientService
  );
  const describedContract = JSON.stringify({
    action: "described_contract",
    toolCode: "files",
    inputSchema: {
      type: "object",
      properties: { deeplyNested: { type: "string", description: "full contract retained" } },
      required: ["deeplyNested"]
    }
  });
  const rawHistory = [exchange("describe", describedContract)];
  const compactDescribe = rawHistory[0]!;

  const first = await coordinator.resolve({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    request: request({
      toolHistory: [
        { ...compactDescribe, toolResult: { ...compactDescribe.toolResult, content: "compact" } }
      ]
    }),
    rawToolHistory: rawHistory
  });
  assert.equal(first.messages.length, 0);
  assert.equal(first.toolHistory, undefined);
  assert.ok(
    JSON.stringify(first.deepSeekAppendTrace).includes("full contract retained"),
    "trace must retain the complete catalog describe result, not the generic compact spine"
  );
  assert.deepEqual(
    first.deepSeekAppendTrace?.events.slice(0, 3).map((event) => event.message.role),
    ["system", "system", "user"],
    "the initial runtime context must remain a system instruction before the first user message"
  );

  for (const id of ["two", "three", "four", "five"]) {
    rawHistory.push(exchange(id, `full ${id}`));
    await coordinator.resolve({
      assistantChatId: "11111111-1111-4111-8111-111111111111",
      request: request({
        toolHistory: [
          {
            ...rawHistory.at(-1)!,
            toolResult: { ...rawHistory.at(-1)!.toolResult, content: "compact" }
          }
        ]
      }),
      rawToolHistory: rawHistory
    });
  }
  assert.ok(
    JSON.stringify(api.trace).includes("full contract retained"),
    "full describe schema must remain after more than three subsequent exchanges"
  );
  assert.ok(
    JSON.stringify(api.trace).includes("reasoning four"),
    "raw exchange reasoning_content must be persisted"
  );

  const beforeNoOp = api.trace!.events.length;
  await coordinator.resolve({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    request: request(),
    rawToolHistory: rawHistory
  });
  assert.equal(api.trace!.events.length, beforeNoOp, "unchanged context must not revise");
  await coordinator.resolve({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    request: request({ developerInstructions: "volatile v2" }),
    rawToolHistory: rawHistory
  });
  assert.equal(
    api.trace!.events.filter((event) => event.stateKey === "runtime_context").length,
    2,
    "changed context must append exactly one revision"
  );
  assert.match(
    api.trace!.events.at(-1)?.contentText ?? "",
    /supersedes="runtime-context:/,
    "a later context revision must explicitly supersede the prior model-visible state"
  );

  const previewRequest = request({ toolFollowUpUserContent: "sanitized preview text" });
  await coordinator.resolve({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    request: previewRequest,
    rawToolHistory: rawHistory
  });
  await coordinator.resolve({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    request: previewRequest,
    rawToolHistory: rawHistory
  });
  assert.equal(
    api.trace!.events.filter((event) => event.sourceKey.startsWith("tool-follow-up-user:")).length,
    1,
    "follow-up preview must be append-only and consume once"
  );
  await assert.rejects(
    coordinator.resolve({
      assistantChatId: "11111111-1111-4111-8111-111111111111",
      request: request({
        toolFollowUpUserContent: [
          { type: "image", mimeType: "image/png", dataBase64: "AAAA", filename: null }
        ]
      }),
      rawToolHistory: rawHistory
    }),
    /cannot safely persist non-text/
  );

  await coordinator.appendFinalAssistant({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    requestId: "request-1",
    text: "final answer"
  });
  await coordinator.appendFinalAssistant({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    requestId: "request-1",
    text: "final answer"
  });
  assert.equal(
    api.trace!.events.filter((event) => event.sourceKey === "final-assistant:request-1").length,
    1,
    "a final reply must remain idempotent across self-check and completion persistence"
  );

  await coordinator.resolve({
    assistantChatId: "11111111-1111-4111-8111-111111111111",
    request: request({
      classification: "main_turn",
      runtimeRequestId: "request-2",
      developerInstructions: "volatile v3"
    }),
    rawToolHistory: rawHistory
  });
  assert.equal(
    api.trace!.events.filter((event) => event.sourceKey === "user-turn:request-2").length,
    1,
    "a repeated user text in a later turn must append as a new event, not deduplicate by content"
  );
  const tail = api.trace!.events.slice(-2);
  assert.equal(tail[0]?.stateKey, "runtime_context");
  assert.equal(tail[1]?.sourceKey, "user-turn:request-2");
}
