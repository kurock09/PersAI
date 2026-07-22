import assert from "node:assert/strict";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextMessage,
  ProviderGatewayToolExchange
} from "@persai/runtime-contract";

function createBareTurnExecutionService(): TurnExecutionService {
  const deps = Array.from({ length: 33 }, () => ({})) as unknown as ConstructorParameters<
    typeof TurnExecutionService
  >;
  deps[4] = {
    pruneClosedOpenLoopRefsDeveloperBlock(content: string | null) {
      return content;
    }
  } as never;
  deps[29] = new RuntimeObservabilityService() as never;
  deps[30] = new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()) as never;
  return new TurnExecutionService(...deps);
}

type FreezeState = {
  frozenDeveloperInstructions: string | null;
  lastLiveFingerprint: string | null;
  liveAppendMessages: ProviderGatewayTextMessage[];
};

type BuildToolLoopProviderRequest = (
  baseRequest: ProviderGatewayTextGenerateRequest,
  input: {
    baseDeveloperInstructionSections: Array<{ key: string; content: string }>;
    toolHistory: ProviderGatewayToolExchange[];
    availableToolNames: string[];
    availableWorkingFileHandles: unknown[];
    closedOpenLoopRefs: string[];
    forceFinalTextOnly?: boolean;
    deferredMediaJobs?: Array<{
      jobId: string;
      toolCode: "image_generate";
      kind: "image";
      action: "pending_delivery";
      canSendFileNow: false;
      messageToUser: string | null;
      requestedCount: number | null;
      expectedResultCount: number | null;
    }>;
    deferredDocumentJobs?: [];
    requestMetadata: ProviderGatewayTextGenerateRequest["requestMetadata"];
    deepseekToolLoopDeveloperFreeze?: FreezeState;
  }
) => ProviderGatewayTextGenerateRequest;

function baseRequest(provider: "deepseek" | "openai"): ProviderGatewayTextGenerateRequest {
  return {
    provider,
    model: provider === "deepseek" ? "deepseek-v4-pro" : "gpt-5.6-terra",
    systemPrompt: "Be helpful.",
    messages: [{ role: "user", content: "run tools" }],
    developerInstructions: "base developer",
    requestMetadata: {
      classification: "main_turn",
      runtimeRequestId: "req-1",
      runtimeSessionId: "sess-1",
      toolLoopIteration: 0,
      compactionToolCode: null
    }
  };
}

function exchange(id: string): ProviderGatewayToolExchange {
  return {
    toolCall: { id, name: "skill", arguments: { action: "list" } },
    toolResult: {
      toolCallId: id,
      name: "skill",
      content: '{"action":"list","count":6}',
      isError: false
    }
  };
}

export async function runDeepseekToolLoopDeveloperFreezeTest(): Promise<void> {
  const service = createBareTurnExecutionService() as unknown as {
    buildToolLoopProviderRequest: BuildToolLoopProviderRequest;
  };
  const freeze: FreezeState = {
    frozenDeveloperInstructions: null,
    lastLiveFingerprint: null,
    liveAppendMessages: []
  };
  const sections = [{ key: "presence", content: "Presence baseline." }];

  const main = service.buildToolLoopProviderRequest(baseRequest("deepseek"), {
    baseDeveloperInstructionSections: sections,
    toolHistory: [],
    availableToolNames: ["skill"],
    availableWorkingFileHandles: [],
    closedOpenLoopRefs: [],
    deferredMediaJobs: [],
    deferredDocumentJobs: [],
    requestMetadata: {
      classification: "main_turn",
      runtimeRequestId: "req-1",
      runtimeSessionId: "sess-1",
      toolLoopIteration: 0,
      compactionToolCode: null
    },
    deepseekToolLoopDeveloperFreeze: freeze
  });
  assert.equal(main.developerInstructions, "Presence baseline.");
  assert.equal(freeze.frozenDeveloperInstructions, main.developerInstructions);
  assert.equal(freeze.liveAppendMessages.length, 0);

  const followup = service.buildToolLoopProviderRequest(baseRequest("deepseek"), {
    baseDeveloperInstructionSections: sections,
    toolHistory: [exchange("call-1")],
    availableToolNames: ["skill"],
    availableWorkingFileHandles: [],
    closedOpenLoopRefs: [],
    deferredMediaJobs: [
      {
        jobId: "job-1",
        toolCode: "image_generate",
        kind: "image",
        action: "pending_delivery",
        canSendFileNow: false,
        messageToUser: "Accepted. The image will be delivered separately.",
        requestedCount: 1,
        expectedResultCount: 1
      }
    ],
    deferredDocumentJobs: [],
    requestMetadata: {
      classification: "tool_loop_followup",
      runtimeRequestId: "req-1",
      runtimeSessionId: "sess-1",
      toolLoopIteration: 1,
      compactionToolCode: null
    },
    deepseekToolLoopDeveloperFreeze: freeze
  });

  assert.equal(followup.developerInstructions, main.developerInstructions);
  assert.equal(freeze.liveAppendMessages.length, 1);
  const live = freeze.liveAppendMessages[0]!;
  assert.equal(live.cacheRole, "volatile_context");
  assert.equal(live.volatileKind, "system_reminder");
  assert.ok(String(live.content).includes("accepted for async background processing"));
  assert.ok(String(live.content).includes("After using tools, always return a concise"));
  assert.equal(followup.messages.length, 2);
  assert.equal(followup.messages[1], live);

  const followupSameLive = service.buildToolLoopProviderRequest(baseRequest("deepseek"), {
    baseDeveloperInstructionSections: sections,
    toolHistory: [exchange("call-1"), exchange("call-2")],
    availableToolNames: ["skill"],
    availableWorkingFileHandles: [],
    closedOpenLoopRefs: [],
    deferredMediaJobs: [
      {
        jobId: "job-1",
        toolCode: "image_generate",
        kind: "image",
        action: "pending_delivery",
        canSendFileNow: false,
        messageToUser: "Accepted. The image will be delivered separately.",
        requestedCount: 1,
        expectedResultCount: 1
      }
    ],
    deferredDocumentJobs: [],
    requestMetadata: {
      classification: "tool_loop_followup",
      runtimeRequestId: "req-1",
      runtimeSessionId: "sess-1",
      toolLoopIteration: 2,
      compactionToolCode: null
    },
    deepseekToolLoopDeveloperFreeze: freeze
  });
  assert.equal(followupSameLive.developerInstructions, main.developerInstructions);
  assert.equal(
    freeze.liveAppendMessages.length,
    1,
    "identical live guidance must not append a duplicate block"
  );

  const followupNewJob = service.buildToolLoopProviderRequest(baseRequest("deepseek"), {
    baseDeveloperInstructionSections: sections,
    toolHistory: [exchange("call-1"), exchange("call-2")],
    availableToolNames: ["skill"],
    availableWorkingFileHandles: [],
    closedOpenLoopRefs: [],
    deferredMediaJobs: [
      {
        jobId: "job-1",
        toolCode: "image_generate",
        kind: "image",
        action: "pending_delivery",
        canSendFileNow: false,
        messageToUser: "Accepted. The image will be delivered separately.",
        requestedCount: 1,
        expectedResultCount: 1
      },
      {
        jobId: "job-2",
        toolCode: "image_generate",
        kind: "image",
        action: "pending_delivery",
        canSendFileNow: false,
        messageToUser: "Second image accepted.",
        requestedCount: 1,
        expectedResultCount: 1
      }
    ],
    deferredDocumentJobs: [],
    requestMetadata: {
      classification: "tool_loop_followup",
      runtimeRequestId: "req-1",
      runtimeSessionId: "sess-1",
      toolLoopIteration: 3,
      compactionToolCode: null
    },
    deepseekToolLoopDeveloperFreeze: freeze
  });
  assert.equal(followupNewJob.developerInstructions, main.developerInstructions);
  assert.equal(freeze.liveAppendMessages.length, 2);
  assert.ok(String(freeze.liveAppendMessages[1]!.content).includes("The media requests"));
  assert.equal(followupNewJob.messages.at(-1), freeze.liveAppendMessages.at(-1));

  const openaiRequest = service.buildToolLoopProviderRequest(baseRequest("openai"), {
    baseDeveloperInstructionSections: [{ key: "presence", content: "Presence baseline." }],
    toolHistory: [exchange("call-1")],
    availableToolNames: ["skill"],
    availableWorkingFileHandles: [],
    closedOpenLoopRefs: [],
    deferredMediaJobs: [
      {
        jobId: "job-1",
        toolCode: "image_generate",
        kind: "image",
        action: "pending_delivery",
        canSendFileNow: false,
        messageToUser: "Accepted. The image will be delivered separately.",
        requestedCount: 1,
        expectedResultCount: 1
      }
    ],
    deferredDocumentJobs: [],
    requestMetadata: {
      classification: "tool_loop_followup",
      runtimeRequestId: "req-1",
      runtimeSessionId: "sess-1",
      toolLoopIteration: 1,
      compactionToolCode: null
    }
  });
  assert.ok(openaiRequest.developerInstructions?.includes("Presence baseline."));
  assert.ok(
    openaiRequest.developerInstructions?.includes("accepted for async background processing")
  );
  assert.equal(openaiRequest.messages.length, 1);
}
