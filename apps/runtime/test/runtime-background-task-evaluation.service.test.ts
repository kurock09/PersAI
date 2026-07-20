import assert from "node:assert/strict";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeBackgroundTaskEvaluationRequest,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";
import { RuntimeBackgroundTaskEvaluationService } from "../src/modules/turns/runtime-background-task-evaluation.service";
import type { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

class FakeTurnExecutionService {
  requests: RuntimeTurnRequest[] = [];

  async createBackgroundTaskToolRun(request: RuntimeTurnRequest): Promise<RuntimeTurnResult> {
    this.requests.push(request);
    return {
      requestId: request.requestId,
      sessionId: "background-task-session-1",
      assistantText: "Evidence report.",
      artifacts: [],
      respondedAt: "2026-05-01T20:00:00.000Z",
      usage: null,
      toolInvocations: []
    };
  }
}

class FakeProviderGatewayClientService {
  requests: ProviderGatewayTextGenerateRequest[] = [];
  queue: Array<
    | {
        type: "result";
        value: {
          text: string;
          usage: null;
          provider?: "openai" | "anthropic";
          model?: string;
        };
      }
    | { type: "error"; value: Error }
  > = [];

  async generateText(request: ProviderGatewayTextGenerateRequest) {
    this.requests.push(request);
    const queued = this.queue.shift();
    if (queued?.type === "error") {
      throw queued.value;
    }
    if (queued?.type === "result") {
      return {
        provider: queued.value.provider ?? request.provider,
        model: queued.value.model ?? request.model,
        text: queued.value.text,
        usage: queued.value.usage,
        respondedAt: "2026-05-01T20:00:01.000Z",
        stopReason: "completed",
        toolCalls: []
      };
    }
    return {
      provider: request.provider,
      model: request.model,
      text: JSON.stringify({
        decision: "no_push",
        pushText: null,
        rationale: "Not enough evidence.",
        confidence: "medium"
      }),
      usage: null
    };
  }
}

function createRuntimeBundleDocument(): string {
  return JSON.stringify({
    metadata: {
      assistantId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      publishedVersionId: "33333333-3333-4333-8333-333333333333"
    },
    persona: {
      displayName: "PersAI"
    },
    userContext: {
      locale: "en",
      timezone: "UTC"
    },
    runtime: {
      runtimeProviderRouting: {
        modelSlots: {
          premiumReply: {
            providerKey: "openai",
            modelKey: "premium-slot-model",
            promptCachePolicy: { mode: "automatic", retention: "in_memory" }
          },
          systemTool: {
            providerKey: "openai",
            modelKey: "system-tool-slot-model",
            promptCachePolicy: { mode: "automatic", retention: "in_memory" }
          }
        },
        primaryPath: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          active: true
        }
      }
    },
    promptConstructor: {
      ordinary: {
        systemPrompt: "Answer as PersAI.",
        sections: {
          backgroundTaskEvaluation: "Use the background evaluator prompt.",
          heartbeat: "Stay concise."
        }
      }
    }
  });
}

function createEvaluationRequest(): RuntimeBackgroundTaskEvaluationRequest {
  const longIdleReengagementTaskId =
    "idle_reengagement:" +
    "11111111-1111-4111-8111-111111111111:" +
    "44444444-4444-4444-8444-444444444444:" +
    "2026-05-01T18:22:45.123Z";

  return {
    assistantId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    runtimeTier: "paid_shared_restricted",
    runtimeBundleDocument: createRuntimeBundleDocument(),
    task: {
      id: longIdleReengagementTaskId,
      title: "Idle reengagement",
      brief: "Decide whether to reengage the idle user.",
      scheduleJson: { kind: "idle_reengagement" },
      pushPolicyJson: null,
      scheduledRunAt: "2026-05-01T20:00:00.000Z",
      runCount: 0,
      lastRunStatus: null,
      lastRunAt: null
    }
  };
}

export async function runRuntimeBackgroundTaskEvaluationServiceTest(): Promise<void> {
  const turnExecution = new FakeTurnExecutionService();
  const providerGateway = new FakeProviderGatewayClientService();
  const runtimeExecutionAdmissionService = new RuntimeExecutionAdmissionService(
    new RuntimeObservabilityService()
  );
  const service = new RuntimeBackgroundTaskEvaluationService(
    providerGateway as unknown as ProviderGatewayClientService,
    turnExecution as unknown as TurnExecutionService,
    runtimeExecutionAdmissionService
  );

  const input = createEvaluationRequest();
  const result = await service.evaluate(input);

  assert.equal(result.decision, "no_push");
  assert.equal(turnExecution.requests.length, 1);
  const toolRunRequest = turnExecution.requests[0]!;
  assert.equal(toolRunRequest.requestId, toolRunRequest.idempotencyKey);
  assert.equal(
    toolRunRequest.requestId.length <= 128,
    true,
    "background-task requestId must fit runtime_turn_receipts.request_id"
  );
  assert.equal(
    toolRunRequest.idempotencyKey.length <= 128,
    true,
    "background-task idempotencyKey must fit runtime_turn_receipts.idempotency_key"
  );
  assert.match(toolRunRequest.requestId, /^background-task-tool-run:[0-9a-f]{40}$/);
  assert.equal(
    toolRunRequest.requestId.includes(input.task.id),
    false,
    "the long task id must not be embedded directly in receipt keys"
  );
  assert.equal(providerGateway.requests.length, 1);
  const providerRequest = providerGateway.requests[0];
  assert.ok(providerRequest !== undefined);
  assert.ok(providerRequest.requestMetadata !== undefined);
  assert.equal(providerRequest.requestMetadata.runtimeRequestId, toolRunRequest.requestId);
  assert.equal(toolRunRequest.modelRoleOverride, "system_tool");
  assert.equal(providerRequest.model, "system-tool-slot-model");
  assert.doesNotMatch(String(providerRequest.systemPrompt ?? ""), /Answer as PersAI\./);
  assert.match(String(providerRequest.systemPrompt ?? ""), /Use the background evaluator prompt\./);
  assert.equal(providerRequest.requestMetadata.classification, "background_task_evaluation");
  assert.equal(providerRequest.developerInstructions ?? null, null);
}

export async function runQuotaAdvisoryClassificationTest(): Promise<void> {
  const turnExecution = new FakeTurnExecutionService();
  const providerGateway = new FakeProviderGatewayClientService();
  const runtimeExecutionAdmissionService = new RuntimeExecutionAdmissionService(
    new RuntimeObservabilityService()
  );
  const service = new RuntimeBackgroundTaskEvaluationService(
    providerGateway as unknown as ProviderGatewayClientService,
    turnExecution as unknown as TurnExecutionService,
    runtimeExecutionAdmissionService
  );

  await service.evaluate({
    ...createEvaluationRequest(),
    evaluationKind: "quota_advisory"
  });

  assert.equal(
    providerGateway.requests[0]?.requestMetadata?.classification,
    "quota_advisory_evaluation"
  );
  assert.equal(providerGateway.requests[0]?.outputSchema?.name, "quota_advisory_evaluation");
}

// ADR-090: unique externalThreadKey when evaluationAttemptId is provided
export async function runUniqueExternalThreadKeyTest(): Promise<void> {
  const turnExecution = new FakeTurnExecutionService();
  const providerGateway = new FakeProviderGatewayClientService();
  const runtimeExecutionAdmissionService = new RuntimeExecutionAdmissionService(
    new RuntimeObservabilityService()
  );
  const service = new RuntimeBackgroundTaskEvaluationService(
    providerGateway as unknown as ProviderGatewayClientService,
    turnExecution as unknown as TurnExecutionService,
    runtimeExecutionAdmissionService
  );

  const attemptId = "aabbccdd-0000-4000-8000-112233445566";
  const input: RuntimeBackgroundTaskEvaluationRequest = {
    ...createEvaluationRequest(),
    task: {
      ...createEvaluationRequest().task,
      evaluationAttemptId: attemptId
    }
  };

  await service.evaluate(input);

  assert.equal(turnExecution.requests.length, 1);
  const req = turnExecution.requests[0]!;

  assert.ok(
    req.conversation.externalThreadKey.endsWith(`:${attemptId}`),
    `externalThreadKey must end with evaluationAttemptId. Got: ${req.conversation.externalThreadKey}`
  );
  assert.ok(
    !req.conversation.externalThreadKey.includes(input.task.scheduledRunAt),
    "externalThreadKey must NOT include scheduledRunAt when evaluationAttemptId is provided"
  );
}

// Legacy fallback: without evaluationAttemptId the key uses task.id only
export async function runLegacyThreadKeyFallbackTest(): Promise<void> {
  const turnExecution = new FakeTurnExecutionService();
  const providerGateway = new FakeProviderGatewayClientService();
  const runtimeExecutionAdmissionService = new RuntimeExecutionAdmissionService(
    new RuntimeObservabilityService()
  );
  const service = new RuntimeBackgroundTaskEvaluationService(
    providerGateway as unknown as ProviderGatewayClientService,
    turnExecution as unknown as TurnExecutionService,
    runtimeExecutionAdmissionService
  );

  const input = createEvaluationRequest();

  await service.evaluate(input);

  assert.equal(turnExecution.requests.length, 1);
  const req = turnExecution.requests[0]!;

  assert.ok(
    req.conversation.externalThreadKey.startsWith("system:background-task:"),
    `externalThreadKey must start with 'system:background-task:'. Got: ${req.conversation.externalThreadKey}`
  );
  // Without evaluationAttemptId the key ends with the task id alone
  assert.ok(
    req.conversation.externalThreadKey.endsWith(input.task.id),
    `legacy externalThreadKey must end with task.id. Got: ${req.conversation.externalThreadKey}`
  );
}

// ADR-090: empty / whitespace-only evaluationAttemptId falls back to the legacy
// key (no `::` suffix is ever produced). This is the defensive behaviour:
// callers passing blank attempt ids should never appear to "succeed" with a
// degenerate per-attempt key that collides on the empty suffix; instead they
// behave indistinguishably from "no attempt id provided at all".
export async function runEmptyAttemptIdFallsBackToLegacyKeyTest(): Promise<void> {
  const turnExecution = new FakeTurnExecutionService();
  const providerGateway = new FakeProviderGatewayClientService();
  const runtimeExecutionAdmissionService = new RuntimeExecutionAdmissionService(
    new RuntimeObservabilityService()
  );
  const service = new RuntimeBackgroundTaskEvaluationService(
    providerGateway as unknown as ProviderGatewayClientService,
    turnExecution as unknown as TurnExecutionService,
    runtimeExecutionAdmissionService
  );

  for (const blank of ["", "   ", "\n\t"]) {
    turnExecution.requests.length = 0;
    const input: RuntimeBackgroundTaskEvaluationRequest = {
      ...createEvaluationRequest(),
      task: {
        ...createEvaluationRequest().task,
        evaluationAttemptId: blank
      }
    };

    await service.evaluate(input);

    assert.equal(turnExecution.requests.length, 1);
    const req = turnExecution.requests[0]!;
    assert.ok(
      !req.conversation.externalThreadKey.includes(blank.trim() === "" ? "::" : blank),
      `blank evaluationAttemptId must not produce '::' suffix. Got: ${req.conversation.externalThreadKey}`
    );
    assert.ok(
      req.conversation.externalThreadKey.endsWith(input.task.id),
      `blank evaluationAttemptId must collapse to legacy key. Got: ${req.conversation.externalThreadKey}`
    );
  }
}

export async function runBackgroundTaskEvaluationFallbackTest(): Promise<void> {
  const turnExecution = new FakeTurnExecutionService();
  const providerGateway = new FakeProviderGatewayClientService();
  providerGateway.queue = [
    { type: "error", value: new Error("HTTP 503: upstream unavailable") },
    {
      type: "result",
      value: {
        provider: "anthropic",
        model: "fallback-model",
        text: JSON.stringify({
          decision: "no_push",
          pushText: null,
          rationale: "Fallback succeeded.",
          confidence: "high"
        }),
        usage: null
      }
    }
  ];
  const runtimeExecutionAdmissionService = new RuntimeExecutionAdmissionService(
    new RuntimeObservabilityService()
  );
  const service = new RuntimeBackgroundTaskEvaluationService(
    providerGateway as unknown as ProviderGatewayClientService,
    turnExecution as unknown as TurnExecutionService,
    runtimeExecutionAdmissionService
  );

  const result = await service.evaluate(createEvaluationRequest());
  assert.equal(result.decision, "no_push");
  assert.equal(providerGateway.requests.length, 2);
  assert.equal(providerGateway.requests[0]?.provider, "openai");
  assert.equal(providerGateway.requests[1]?.provider, "anthropic");
  assert.equal(providerGateway.requests[1]?.model, "fallback-model");
}
