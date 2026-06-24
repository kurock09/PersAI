import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeMemoryWriteItem,
  RuntimeTurnRequest,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import type { PersaiInternalApiClientService } from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeMemoryWriteToolService } from "../src/modules/turns/runtime-memory-write-tool.service";

const KNOWLEDGE_ACCESS_EMPTY = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: []
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = {
  tools: []
} satisfies RuntimeWorkerToolsConfig;

const BROWSER_CONFIG = {
  toolCode: "browser",
  executionMode: "worker",
  credentialToolCode: "browser",
  providerIds: ["browserless"],
  defaultProviderId: "browserless",
  actions: ["snapshot", "act"],
  confirmationRequiredActions: ["act"]
} satisfies RuntimeBrowserConfig;

function createBundle() {
  return compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      assistantHandle: "a-test",
      siblingAssistantHandles: [],
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
      assistantGender: null,
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "en-US",
        deliveryKind: "voice_note",
        elevenlabs: {
          voiceId: null
        },
        yandex: {
          voice: "jane",
          role: null
        },
        openai: {
          voice: "marin"
        }
      }
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
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true,
        crossSessionCarryOverTtlDays: 7,
        crossSessionCarryOverIdleHours: 4,
        crossSessionCarryOverCooldownHours: 12
      },
      knowledgeAccess: KNOWLEDGE_ACCESS_EMPTY,
      workerTools: WORKER_TOOLS_CONFIG,
      browser: BROWSER_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
        telegramAutoSummarizeEnabled: true
      }
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
      toolPolicies: [
        {
          toolCode: "memory_write",
          displayName: "Memory write",
          description: "Persist a durable user fact, preference, or open loop.",
          usageGuidance: null,
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        }
      ],
      quota: {
        planCode: "paid",
        workspaceQuotaBytes: 1024,
        sharedQuotaBytes: 1024,
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
      soul: "",
      user: "",
      identity: "",
      tools: "",
      agents: "",
      heartbeat: "",
      preview: "",
      welcome: ""
    }
  }).bundle;
}

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-memory-write-1",
    name: "memory_write",
    arguments: argumentsObject
  };
}

class FakePersaiInternalApiClientService {
  writeCalls: Array<Record<string, unknown>> = [];
  // ADR-074 Slice M3 — track explicit close-open-loop follow-ups so the
  // closeOpenLoop branch can be asserted from the test body.
  closeOpenLoopCalls: Array<Record<string, unknown>> = [];
  closeOpenLoopOutcome: {
    closed: boolean;
    closedItemId: string | null;
    reason: "matched" | "no_active_open_loop_matched";
  } = { closed: true, closedItemId: "loop-1", reason: "matched" };
  closeOpenLoopError: Error | null = null;
  // ADR-074 Slice M3.1 — track structured close-by-ref calls so the
  // memory_write `action: "close"` branch can be asserted from the test
  // body.
  closeByRefCalls: Array<Record<string, unknown>> = [];
  closeByRefOutcome: {
    closed: boolean;
    closedItemId: string | null;
    reason: "closed" | "already_closed" | "cooldown_active" | "not_open_loop" | "not_found";
  } = { closed: true, closedItemId: "loop-1", reason: "closed" };
  closeByRefError: Error | null = null;
  outcome: {
    written: boolean;
    code: string | null;
    message: string | null;
    item: RuntimeMemoryWriteItem | null;
  } = {
    written: true,
    code: null,
    message: null,
    item: {
      id: "memory-1",
      summary: "User prefers concise answers.",
      kind: "preference",
      layer: "long",
      confidence: 0.91,
      sourceLabel: "Long memory write: preference",
      createdAt: "2026-04-14T19:00:00.000Z",
      chatId: null
    }
  };
  error: Error | null = null;
  // ADR-074 Slice L1.1 — memory_write now consumes the daily-quota
  // counter for observability. The fake records the calls and returns
  // an `allowed: true` outcome by default; tests that need to exercise
  // the rejection branch can override `quotaOutcome`.
  quotaCalls: Array<Record<string, unknown>> = [];
  quotaOutcome:
    | { allowed: true; currentCount: number; limit: number | null }
    | { allowed: false; code: string; message: string } = {
    allowed: true,
    currentCount: 1,
    limit: null
  };

  async writeMemory(input: Record<string, unknown>) {
    this.writeCalls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.outcome;
  }

  async consumeToolDailyLimit(input: Record<string, unknown>) {
    this.quotaCalls.push(input);
    return this.quotaOutcome;
  }

  async closeMostSimilarOpenLoop(input: Record<string, unknown>) {
    this.closeOpenLoopCalls.push(input);
    if (this.closeOpenLoopError !== null) {
      throw this.closeOpenLoopError;
    }
    return this.closeOpenLoopOutcome;
  }

  async closeAssistantMemoryByRef(input: Record<string, unknown>) {
    this.closeByRefCalls.push(input);
    if (this.closeByRefError !== null) {
      throw this.closeByRefError;
    }
    return this.closeByRefOutcome;
  }
}

export async function runRuntimeMemoryWriteToolServiceTest(): Promise<void> {
  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  const hiddenProjection = projectRuntimeNativeTools(bundle, {
    allowModelToolExposure: false
  });
  assert.equal(
    projection.tools.some((tool) => tool.name === "memory_write"),
    true
  );
  const memoryWriteDefinition = projection.tools.find((tool) => tool.name === "memory_write");
  assert.ok(memoryWriteDefinition);
  const memoryWriteSchema = memoryWriteDefinition?.inputSchema as {
    properties?: Record<string, { description?: string }>;
  };
  assert.ok(memoryWriteSchema.properties?.layer);
  assert.match(memoryWriteSchema.properties?.memory?.description ?? "", /genuinely durable/i);
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "memory_write"),
    false
  );

  const internalApi = new FakePersaiInternalApiClientService();
  const service = new RuntimeMemoryWriteToolService(
    internalApi as unknown as PersaiInternalApiClientService
  );
  const directWebConversation: RuntimeTurnRequest["conversation"] = {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey: "thread-1",
    externalUserKey: "user-1",
    mode: "direct"
  };

  const success = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "preference",
      memory: "User prefers concise answers.",
      layer: "long",
      confidence: 0.91
    }),
    conversation: directWebConversation,
    currentUserMessageId: "not-a-uuid",
    requestId: "request-1"
  });
  assert.equal(success.payload.action, "remembered");
  assert.equal(success.payload.item?.summary, "User prefers concise answers.");
  assert.deepEqual(internalApi.writeCalls.at(-1), {
    assistantId: "assistant-1",
    kind: "preference",
    summary: "User prefers concise answers.",
    layer: "long",
    confidence: 0.91,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: null,
    requestId: "request-1",
    provenance: "system_inferred"
  });

  const invalid = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "preference",
      memory: 42 as unknown as string,
      layer: "long"
    }),
    conversation: directWebConversation,
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(invalid.payload.action, "skipped");
  assert.equal(invalid.payload.reason, "invalid_arguments");
  assert.equal(invalid.isError, true);

  const unsupportedSurface = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "fact",
      memory: "User works in finance.",
      layer: "long"
    }),
    conversation: {
      ...directWebConversation,
      channel: "max_ru"
    },
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(unsupportedSurface.payload.action, "skipped");
  assert.equal(unsupportedSurface.payload.reason, "surface_unavailable");

  internalApi.outcome = {
    written: false,
    code: "memory_group_global_write_denied",
    message: "Global memory cannot be written from group sources.",
    item: null
  };
  const denied = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "open_loop",
      memory: "Follow up on the analytics dashboard migration.",
      layer: "short",
      confidence: 0.77
    }),
    conversation: {
      ...directWebConversation,
      channel: "telegram",
      mode: "group"
    },
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(denied.payload.action, "skipped");
  assert.equal(denied.payload.reason, "memory_group_global_write_denied");
  assert.equal(denied.payload.warning, "Global memory cannot be written from group sources.");

  internalApi.outcome = {
    written: true,
    code: null,
    message: null,
    item: {
      id: "memory-2",
      summary: "User prefers concise answers.",
      kind: "preference",
      layer: "long",
      confidence: 0.91,
      sourceLabel: "Long memory write: preference",
      createdAt: "2026-04-14T19:00:00.000Z",
      chatId: null
    }
  };
  internalApi.error = new Error("PersAI internal API memory write request failed.");
  const failed = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      kind: "fact",
      memory: "User works in finance.",
      layer: "long"
    }),
    conversation: directWebConversation,
    currentUserMessageId: null,
    requestId: "request-1"
  });
  assert.equal(failed.payload.action, "skipped");
  assert.equal(failed.payload.reason, "memory_write_failed");
  assert.equal(failed.isError, true);

  // ADR-074 Slice M3 — closeOpenLoop branches.
  // (a) Default behaviour: closeOpenLoop omitted → defaults to false →
  //     closeMostSimilarOpenLoop NOT called even on a successful write.
  {
    const apiNoClose = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(
      apiNoClose as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "User lives in Berlin.",
        layer: "long"
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-noclose"
    });
    assert.equal(result.payload.action, "remembered");
    assert.equal(apiNoClose.writeCalls.length, 1);
    assert.equal(
      apiNoClose.closeOpenLoopCalls.length,
      0,
      "default closeOpenLoop=false must NOT trigger the explicit close follow-up"
    );
  }

  // (b) closeOpenLoop:false explicit → same behaviour, no follow-up.
  {
    const apiExplicitFalse = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(
      apiExplicitFalse as unknown as PersaiInternalApiClientService
    );
    await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "User lives in Berlin.",
        layer: "long",
        closeOpenLoop: false
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-false"
    });
    assert.equal(apiExplicitFalse.closeOpenLoopCalls.length, 0);
  }

  // (c) closeOpenLoop:true on successful write → exactly one follow-up call
  //     with the same memory text as referenceText, the runtime requestId,
  //     and the bundle's assistantId. The outer payload still reports
  //     "remembered" — the follow-up does not change the user-visible
  //     response.
  {
    const apiTrue = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(
      apiTrue as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "Booked the Barcelona retreat venue.",
        layer: "short",
        closeOpenLoop: true
      }),
      conversation: directWebConversation,
      // ADR-120 Slice 2 — a valid current user message id is forwarded so the
      // API can scope the close-by-similarity match to the current chat.
      currentUserMessageId: "11111111-1111-4111-8111-111111111111",
      requestId: "request-true"
    });
    assert.equal(result.payload.action, "remembered");
    assert.equal(apiTrue.writeCalls.length, 1);
    assert.equal(apiTrue.closeOpenLoopCalls.length, 1);
    assert.deepEqual(apiTrue.closeOpenLoopCalls[0], {
      assistantId: "assistant-1",
      referenceText: "Booked the Barcelona retreat venue.",
      relatedUserMessageId: "11111111-1111-4111-8111-111111111111",
      requestId: "request-true"
    });
  }

  // (d) closeOpenLoop:true but the underlying write was DENIED (written:false)
  //     → no follow-up call (we only attempt close on a successful write).
  {
    const apiDenied = new FakePersaiInternalApiClientService();
    apiDenied.outcome = {
      written: false,
      code: "memory_write_denied",
      message: "Denied",
      item: null
    };
    const svc = new RuntimeMemoryWriteToolService(
      apiDenied as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "Confirmed the venue.",
        layer: "short",
        closeOpenLoop: true
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-denied"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "memory_write_denied");
    assert.equal(
      apiDenied.closeOpenLoopCalls.length,
      0,
      "denied write must NOT attempt closeMostSimilarOpenLoop"
    );
  }

  // (e) closeOpenLoop:true and the follow-up THROWS → the outer write
  //     payload is still "remembered" (we swallow + log close failures so a
  //     downstream M3 hiccup never erases a successful memory_write).
  {
    const apiCloseFails = new FakePersaiInternalApiClientService();
    apiCloseFails.closeOpenLoopError = new Error("boom");
    const svc = new RuntimeMemoryWriteToolService(
      apiCloseFails as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "open_loop",
        memory: "Confirmed the venue.",
        layer: "short",
        closeOpenLoop: true
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-fail"
    });
    assert.equal(result.payload.action, "remembered");
    assert.equal(result.isError, false);
    assert.equal(apiCloseFails.closeOpenLoopCalls.length, 1);
  }

  // (f) closeOpenLoop with non-boolean value → invalid_arguments (the
  //     tool refuses to silently coerce a string/number into a boolean).
  {
    const apiInvalid = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(
      apiInvalid as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "Some fact.",
        layer: "long",
        closeOpenLoop: "yes" as unknown as boolean
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-bad-type"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(apiInvalid.writeCalls.length, 0);
    assert.equal(apiInvalid.closeOpenLoopCalls.length, 0);
  }

  // ADR-074 Slice M3.1 — structured close-by-ref branches.
  const SAMPLE_REF_UUID = "11111111-2222-4333-8444-555555555555";

  // (g) action:"close" + valid ref → calls closeAssistantMemoryByRef with
  //     the runtime-resolved bundle.assistantId, the ref forwarded as
  //     itemId, and the requestId. The outer payload reports
  //     action:"closed" with the server-confirmed closedItemRef and no
  //     write-side fields.
  {
    const apiClose = new FakePersaiInternalApiClientService();
    apiClose.closeByRefOutcome = {
      closed: true,
      closedItemId: SAMPLE_REF_UUID,
      reason: "closed"
    };
    const svc = new RuntimeMemoryWriteToolService(
      apiClose as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "close",
        ref: SAMPLE_REF_UUID
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-ref"
    });
    assert.equal(result.payload.action, "closed");
    assert.equal(result.payload.requestedKind, null);
    assert.equal(result.payload.item, null);
    assert.equal(result.payload.closedItemRef, SAMPLE_REF_UUID);
    assert.equal(result.payload.reason, "closed");
    assert.equal(result.isError, false);
    assert.equal(apiClose.writeCalls.length, 0, "action:close MUST NOT call writeMemory");
    assert.equal(
      apiClose.closeOpenLoopCalls.length,
      0,
      "action:close MUST NOT call the M3 lexical closeMostSimilarOpenLoop"
    );
    assert.equal(apiClose.closeByRefCalls.length, 1);
    assert.deepEqual(apiClose.closeByRefCalls[0], {
      assistantId: "assistant-1",
      itemId: SAMPLE_REF_UUID,
      requestId: "request-close-ref"
    });
  }

  // (h) action:"close" with already_closed reason → still action:"closed"
  //     (idempotent success), closedItemRef is the server-returned id, no
  //     error.
  {
    const apiAlready = new FakePersaiInternalApiClientService();
    apiAlready.closeByRefOutcome = {
      closed: true,
      closedItemId: SAMPLE_REF_UUID,
      reason: "already_closed"
    };
    const svc = new RuntimeMemoryWriteToolService(
      apiAlready as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "close",
        ref: SAMPLE_REF_UUID
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-already"
    });
    assert.equal(result.payload.action, "closed");
    assert.equal(result.payload.reason, "already_closed");
    assert.equal(result.isError, false);
  }

  // (i) action:"close" with not_found / not_open_loop reason → mapped to a
  //     skipped payload so the model can adjust without crashing the turn.
  {
    const apiMissing = new FakePersaiInternalApiClientService();
    apiMissing.closeByRefOutcome = {
      closed: false,
      closedItemId: null,
      reason: "not_found"
    };
    const svc = new RuntimeMemoryWriteToolService(
      apiMissing as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "close",
        ref: SAMPLE_REF_UUID
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-missing"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "memory_close_ref_not_found");
    assert.equal(result.payload.requestedKind, null);
    assert.equal(result.payload.closedItemRef, null);
    assert.equal(result.isError, false);
  }

  // (i.1) action:"close" with cooldown_active reason -> soft skipped payload,
  //       not an error, so the model sees a controlled no-op instead of a
  //       failing tool call.
  {
    const apiCooldown = new FakePersaiInternalApiClientService();
    apiCooldown.closeByRefOutcome = {
      closed: false,
      closedItemId: SAMPLE_REF_UUID,
      reason: "cooldown_active"
    };
    const svc = new RuntimeMemoryWriteToolService(
      apiCooldown as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "close",
        ref: SAMPLE_REF_UUID
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-cooldown"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "memory_close_ref_cooldown_active");
    assert.equal(
      result.payload.warning,
      `Open-loop ref "${SAMPLE_REF_UUID}" was created too recently to close. Keep it active for now.`
    );
    assert.equal(result.isError, false);
  }

  // (j) action:"close" but the API call THROWS → action:"skipped",
  //     reason:"memory_close_failed", isError true (mirrors the write
  //     failure path).
  {
    const apiThrow = new FakePersaiInternalApiClientService();
    apiThrow.closeByRefError = new Error("boom");
    const svc = new RuntimeMemoryWriteToolService(
      apiThrow as unknown as PersaiInternalApiClientService
    );
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "close",
        ref: SAMPLE_REF_UUID
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-throw"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "memory_close_failed");
    assert.equal(result.isError, true);
  }

  // (k) action:"close" missing ref → invalid_arguments.
  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({ action: "close" }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-no-ref"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(api.closeByRefCalls.length, 0);
  }

  // (l) action:"close" with a non-UUID ref → invalid_arguments. The runtime
  //     refuses to forward malformed refs because the API endpoint expects
  //     a registry uuid; bouncing here gives the model a clean signal.
  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({ action: "close", ref: "ol_not_a_uuid" }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-bad-ref"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(api.closeByRefCalls.length, 0);
  }

  // (m) action:"close" + extra write-side fields (kind/memory/closeOpenLoop)
  //     → invalid_arguments per schema contract.
  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "close",
        ref: SAMPLE_REF_UUID,
        kind: "open_loop"
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-close-extra"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(api.closeByRefCalls.length, 0);
    assert.equal(api.writeCalls.length, 0);
  }

  // (n) action:"write" explicit (default) — same behaviour as omitting it.
  //     Confirms the runtime accepts both shapes from the model.
  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "write",
        kind: "fact",
        memory: "User uses metric units.",
        layer: "long"
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-explicit-write"
    });
    assert.equal(result.payload.action, "remembered");
    assert.equal(api.writeCalls.length, 1);
    assert.equal(api.closeByRefCalls.length, 0);
  }

  // (o) action:"write" + ref → invalid_arguments. ref MUST NOT be supplied
  //     on a write call.
  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "write",
        kind: "fact",
        memory: "User uses metric units.",
        layer: "long",
        ref: SAMPLE_REF_UUID
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-write-with-ref"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(api.writeCalls.length, 0);
    assert.equal(api.closeByRefCalls.length, 0);
  }

  // (p) Unknown action value → invalid_arguments.
  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        action: "delete" as unknown as "write" | "close"
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-bad-action"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(result.isError, true);
  }

  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "User likes tea.",
        confidence: null
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-missing-layer"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(api.writeCalls.length, 0);
  }

  {
    const api = new FakePersaiInternalApiClientService();
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "User likes tea.",
        layer: "sometimes"
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-invalid-layer"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(api.writeCalls.length, 0);
  }

  {
    const api = new FakePersaiInternalApiClientService();
    api.outcome = {
      written: false,
      code: "not_durable",
      message: "Memory is not durable enough to store.",
      item: null
    };
    const svc = new RuntimeMemoryWriteToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle,
      toolCall: createToolCall({
        kind: "fact",
        memory: "ok",
        layer: "long"
      }),
      conversation: directWebConversation,
      currentUserMessageId: null,
      requestId: "request-not-durable"
    });
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "not_durable");
    assert.equal(result.payload.warning, "Memory is not durable enough to store.");
  }
}
