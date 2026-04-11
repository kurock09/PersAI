import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent
} from "@persai/runtime-contract";
import type { RuntimeBundleCacheEntry } from "../src/modules/bundles/bundle.types";
import type { RuntimeBundleRegistryService } from "../src/modules/bundles/runtime-bundle-registry.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import type { TurnContextHydrationService } from "../src/modules/turns/turn-context-hydration.service";
import type {
  AcceptedRuntimeTurn,
  ReplayedRuntimeTurn,
  TurnAcceptanceResult,
  TurnAcceptanceService
} from "../src/modules/turns/turn-acceptance.service";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";
import type {
  FinalizedRuntimeTurn,
  TurnFinalizationService
} from "../src/modules/turns/turn-finalization.service";

function createRuntimeTurnRequest(): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    idempotencyKey: "turn-1",
    runtimeTier: "paid_shared_restricted",
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: "bundle-hash-placeholder",
      compiledAt: "2026-04-11T12:00:00.000Z"
    },
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    message: {
      text: "hello runtime",
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-11T12:00:00.000Z"
    }
  };
}

function createBundleEntry(): RuntimeBundleCacheEntry {
  const artifact = compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
    },
    persona: {
      displayName: "PersAI",
      instructions: "Answer as a concise assistant.",
      traits: null,
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: null
    },
    userContext: {
      displayName: "Alex",
      birthday: null,
      gender: null,
      locale: "en",
      timezone: "UTC"
    },
    runtime: {
      runtimeAssignment: { tier: "paid_shared_restricted" },
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        }
      },
      runtimeProviderRouting: {
        schema: "persai.runtimeProviderRouting.v1",
        primaryPath: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          active: true,
          inactiveReason: null
        }
      },
      optimizationPolicy: null
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      effectiveCapabilities: null,
      toolAvailability: null,
      memoryControl: null,
      tasksControl: null,
      toolCredentialRefs: {},
      toolQuotaPolicy: [],
      quota: {
        planCode: "paid",
        workspaceQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
    },
    channels: {
      bindings: null,
      telegram: {
        enabled: false,
        autoCompactionEnabled: true,
        dmPolicy: "owner_only",
        groupReplyMode: "mentions_only",
        parseMode: "plain_text",
        inbound: false,
        outbound: false,
        accessMode: "disabled",
        ownerClaimStatus: "unclaimed",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: null,
        ownerTelegramUsername: null,
        ownerTelegramChatId: null
      }
    },
    promptDocuments: {
      soul: "# SOUL\nStay on mission.",
      user: "# USER\nBe mindful of user context.",
      identity: "# IDENTITY\nYou are PersAI.",
      tools: "",
      agents: "",
      heartbeat: "",
      bootstrap: ""
    }
  });

  return {
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: artifact.hash,
      compiledAt: "2026-04-11T12:00:00.000Z"
    },
    bundleDocument: artifact.document,
    parsedBundle: artifact.bundle,
    warmedAt: "2026-04-11T12:01:00.000Z"
  };
}

function createAcceptedTurn(): AcceptedRuntimeTurn {
  return {
    outcome: "accepted",
    conversationKey: "conversation-key-1",
    session: {
      sessionId: "session-1",
      conversation: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        channel: "web",
        externalThreadKey: "thread-1",
        externalUserKey: "user-1",
        mode: "direct"
      },
      currentTokens: null,
      totalTokensFresh: true,
      compactionCount: 0,
      compactionHintTokens: null,
      providerKey: null,
      modelKey: null,
      updatedAt: "2026-04-11T12:00:00.000Z"
    },
    receipt: {
      requestId: "request-1",
      sessionId: "session-1",
      publishedVersionId: "version-1",
      status: "accepted",
      bundleHash: "bundle-hash-placeholder",
      resultPayload: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null
    },
    lease: {
      sessionId: "session-1",
      ownerToken: "lease-owner-1"
    }
  };
}

class FakeRuntimeBundleRegistryService {
  entry: RuntimeBundleCacheEntry | null = createBundleEntry();

  getBundle(): RuntimeBundleCacheEntry | null {
    return this.entry;
  }
}

class FakeProviderGatewayClientService {
  calls: ProviderGatewayTextGenerateRequest[] = [];
  streamCalls: ProviderGatewayTextGenerateRequest[] = [];
  result: ProviderGatewayTextGenerateResult = {
    provider: "openai",
    model: "gpt-5.4",
    text: "runtime reply",
    respondedAt: "2026-04-11T12:00:02.000Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30
    }
  };
  error: Error | null = null;
  streamError: Error | null = null;
  streamEvents: ProviderGatewayTextStreamEvent[] = [
    {
      type: "text_delta",
      delta: "runtime ",
      accumulatedText: "runtime "
    },
    {
      type: "completed",
      result: {
        provider: "openai",
        model: "gpt-5.4",
        text: "runtime reply",
        respondedAt: "2026-04-11T12:00:02.000Z",
        usage: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
      }
    }
  ];

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.calls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.result;
  }

  async streamText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<AsyncGenerator<ProviderGatewayTextStreamEvent>> {
    this.streamCalls.push(input);
    if (this.streamError !== null) {
      throw this.streamError;
    }

    const events = [...this.streamEvents];
    return (async function* (): AsyncGenerator<ProviderGatewayTextStreamEvent> {
      for (const event of events) {
        yield event;
      }
    })();
  }
}

class FakeTurnAcceptanceService {
  result: TurnAcceptanceResult = createAcceptedTurn();

  async acceptTurn(): Promise<TurnAcceptanceResult> {
    return this.result;
  }
}

class FakeTurnContextHydrationService {
  messages: ProviderGatewayTextGenerateRequest["messages"] = [
    {
      role: "user",
      content: "hello runtime"
    }
  ];

  async buildMessages(): Promise<ProviderGatewayTextGenerateRequest["messages"]> {
    return this.messages;
  }
}

class FakeTurnFinalizationService {
  completed: Array<{ acceptedTurn: AcceptedRuntimeTurn; result: RuntimeTurnResult }> = [];
  failed: Array<{ acceptedTurn: AcceptedRuntimeTurn; code: string; message: string }> = [];

  async completeAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    result: RuntimeTurnResult
  ): Promise<FinalizedRuntimeTurn> {
    this.completed.push({ acceptedTurn, result });
    return {
      receiptStatus: "completed",
      session: acceptedTurn.session,
      leaseReleased: true
    };
  }

  async failAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    event: { code: string; message: string }
  ): Promise<FinalizedRuntimeTurn> {
    this.failed.push({ acceptedTurn, code: event.code, message: event.message });
    return {
      receiptStatus: "failed",
      session: acceptedTurn.session,
      leaseReleased: true
    };
  }
}

async function collectStreamEvents(
  generator: AsyncGenerator<RuntimeTurnStreamEvent>
): Promise<RuntimeTurnStreamEvent[]> {
  const events: RuntimeTurnStreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

export async function runTurnExecutionServiceTest(): Promise<void> {
  const bundleRegistry = new FakeRuntimeBundleRegistryService();
  const providerGatewayClient = new FakeProviderGatewayClientService();
  const turnContextHydrationService = new FakeTurnContextHydrationService();
  const turnAcceptanceService = new FakeTurnAcceptanceService();
  const turnFinalizationService = new FakeTurnFinalizationService();
  const service = new TurnExecutionService(
    bundleRegistry as unknown as RuntimeBundleRegistryService,
    providerGatewayClient as unknown as ProviderGatewayClientService,
    turnContextHydrationService as unknown as TurnContextHydrationService,
    turnAcceptanceService as unknown as TurnAcceptanceService,
    turnFinalizationService as unknown as TurnFinalizationService
  );

  const request = createRuntimeTurnRequest();
  request.bundle.bundleHash = bundleRegistry.entry?.bundle.bundleHash ?? request.bundle.bundleHash;
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;

  const completed = await service.createTurn(request);
  assert.equal(completed.assistantText, "runtime reply");
  assert.equal(providerGatewayClient.calls.length, 1);
  assert.equal(providerGatewayClient.calls[0]?.provider, "openai");
  assert.equal(providerGatewayClient.calls[0]?.model, "gpt-5.4");
  assert.deepEqual(providerGatewayClient.calls[0]?.messages, turnContextHydrationService.messages);
  assert.equal(turnFinalizationService.completed.length, 1);
  assert.equal(turnFinalizationService.failed.length, 0);

  const overrideRequest = createRuntimeTurnRequest();
  overrideRequest.bundle.bundleHash = request.bundle.bundleHash;
  overrideRequest.providerOverride = "anthropic";
  overrideRequest.modelOverride = "claude-sonnet-4-5";
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.result = {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    text: "override reply",
    respondedAt: "2026-04-11T12:00:03.000Z",
    usage: {
      providerKey: "anthropic",
      modelKey: "claude-sonnet-4-5",
      inputTokens: 11,
      outputTokens: 22,
      totalTokens: 33
    }
  };
  const overrideCompleted = await service.createTurn(overrideRequest);
  assert.equal(overrideCompleted.assistantText, "override reply");
  assert.equal(providerGatewayClient.calls[1]?.provider, "anthropic");
  assert.equal(providerGatewayClient.calls[1]?.model, "claude-sonnet-4-5");

  const replayedResult = {
    ...completed,
    assistantText: "cached reply"
  };
  const replayedTurn: ReplayedRuntimeTurn = {
    outcome: "replayed",
    conversationKey: "conversation-key-1",
    session: createAcceptedTurn().session,
    receipt: {
      requestId: "request-1",
      sessionId: "session-1",
      publishedVersionId: "version-1",
      status: "completed",
      bundleHash: request.bundle.bundleHash,
      resultPayload: replayedResult,
      errorCode: null,
      errorMessage: null,
      completedAt: "2026-04-11T12:00:02.000Z"
    }
  };
  turnAcceptanceService.result = replayedTurn;
  const replayed = await service.createTurn(request);
  assert.equal(replayed.assistantText, "cached reply");
  assert.equal(providerGatewayClient.calls.length, 2);

  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  providerGatewayClient.error = new ServiceUnavailableException("gateway down");
  await assert.rejects(() => service.createTurn(request), /gateway down/);
  assert.equal(turnFinalizationService.failed.length, 1);
  assert.equal(turnFinalizationService.failed[0]?.code, "turn_execution_failed");

  providerGatewayClient.error = null;
  turnAcceptanceService.result = createAcceptedTurn();
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash =
    request.bundle.bundleHash;
  turnContextHydrationService.messages = [
    {
      role: "user",
      content: "earlier user"
    },
    {
      role: "assistant",
      content: "earlier assistant"
    },
    {
      role: "user",
      content: "hello runtime"
    }
  ];
  const completedBeforeStream = turnFinalizationService.completed.length;
  const stream = await service.streamTurn(request);
  const streamEvents = await collectStreamEvents(stream);
  assert.deepEqual(
    streamEvents.map((event) => event.type),
    ["started", "text_delta", "completed"]
  );
  assert.equal(providerGatewayClient.streamCalls.length, 1);
  assert.deepEqual(
    providerGatewayClient.streamCalls[0]?.messages,
    turnContextHydrationService.messages
  );
  assert.equal(turnFinalizationService.completed.length, completedBeforeStream + 1);
  const completedEvent = streamEvents[2];
  assert.equal(completedEvent?.type, "completed");
  if (completedEvent?.type === "completed") {
    assert.equal(completedEvent.result.assistantText, "runtime reply");
  }
}
