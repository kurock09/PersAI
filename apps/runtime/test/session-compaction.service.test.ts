import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeKnowledgeAccessConfig,
  RuntimeCompactionRequest,
  RuntimeSessionSummary
} from "@persai/runtime-contract";
import type { RuntimeBundleRegistryService } from "../src/modules/bundles/runtime-bundle-registry.service";
import {
  type RuntimeSessionLease,
  SessionLeaseService
} from "../src/modules/sessions/session-lease.service";
import type { SessionStoreService } from "../src/modules/sessions/session-store.service";
import type { RuntimeStatePostgresService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import { SessionCompactionService } from "../src/modules/turns/session-compaction.service";
import { REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA } from "../src/modules/turns/shared-compaction-state";
import type {
  RuntimeCompactionMessageSource,
  TurnContextHydrationService
} from "../src/modules/turns/turn-context-hydration.service";

const KNOWLEDGE_ACCESS_CONFIG = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: [
    {
      source: "web",
      searchAliasToolCode: "web_search",
      fetchAliasToolCode: "web_fetch",
      searchCredentialToolCode: "web_search",
      fetchCredentialToolCode: "web_fetch"
    },
    {
      source: "memory",
      searchAliasToolCode: "memory_search",
      fetchAliasToolCode: "memory_get",
      searchCredentialToolCode: "memory_search",
      fetchCredentialToolCode: null
    }
  ]
} satisfies RuntimeKnowledgeAccessConfig;

const VALID_COMPACTION_SECTIONS = {
  stableFacts: ["User is working on the PersAI runtime."],
  userPreferences: ["Prefers direct production-safe fixes."],
  assistantCommitments: ["Assistant owes a verified shared compaction fix."],
  openThreads: ["Need to stabilize native shared compaction semantics."],
  importantReferences: ["Session thread key is thread-1."]
};

const VALID_COMPACTION_OUTPUT = JSON.stringify(VALID_COMPACTION_SECTIONS);

const RENDERED_COMPACTION_SUMMARY = [
  "Stable facts:",
  "- User is working on the PersAI runtime.",
  "User preferences:",
  "- Prefers direct production-safe fixes.",
  "Assistant commitments:",
  "- Assistant owes a verified shared compaction fix.",
  "Open threads:",
  "- Need to stabilize native shared compaction semantics.",
  "Important references:",
  "- Session thread key is thread-1."
].join("\n");

function createCompactionRequest(input?: {
  instructions?: string | null;
  channel?: "web" | "telegram";
}): RuntimeCompactionRequest {
  return {
    runtimeTier: "paid_shared_restricted",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: input?.channel ?? "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    instructions: input?.instructions ?? null
  };
}

function createResolvedSession(currentTokens: number | null): RuntimeSessionSummary {
  return {
    sessionId: "session-1",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    currentTokens,
    totalTokensFresh: true,
    compactionCount: 2,
    compactionHintTokens: null,
    providerKey: "openai",
    modelKey: "gpt-5.4",
    updatedAt: "2026-04-12T12:00:00.000Z"
  };
}

function createBundleEntry() {
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
      displayName: "Mira",
      instructions: "Be helpful.",
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
        mode: "admin_managed",
        primary: { provider: "openai", model: "gpt-5.4" }
      },
      runtimeProviderRouting: {
        primaryPath: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          active: true
        }
      },
      optimizationPolicy: null,
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
        suggestByMessageCount: false,
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
      toolPolicies: [],
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
        enabled: true,
        autoCompactionEnabled: true,
        dmPolicy: "owner_only",
        groupReplyMode: "mention_reply",
        parseMode: "plain_text",
        inbound: true,
        outbound: true,
        accessMode: "owner_only",
        ownerClaimStatus: "connected",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: 123,
        ownerTelegramUsername: "alex",
        ownerTelegramChatId: "123"
      }
    },
    promptDocuments: {
      soul: "",
      user: "",
      identity: "",
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
      compiledAt: "2026-04-12T12:00:00.000Z"
    },
    bundleDocument: artifact.document,
    parsedBundle: artifact.bundle,
    warmedAt: "2026-04-12T12:00:01.000Z"
  };
}

class FakeRuntimeBundleRegistryService {
  entry = createBundleEntry();

  findBundleByAssistantVersion() {
    return this.entry;
  }
}

class FakeProviderGatewayClientService {
  requests: ProviderGatewayTextGenerateRequest[] = [];
  textOutput = VALID_COMPACTION_OUTPUT;
  queuedTextOutputs: string[] = [];

  async generateText(input: ProviderGatewayTextGenerateRequest) {
    this.requests.push(input);
    const textOutput =
      this.queuedTextOutputs.length > 0
        ? (this.queuedTextOutputs.shift() ?? this.textOutput)
        : this.textOutput;
    return {
      provider: "openai" as const,
      model: input.model,
      text: textOutput,
      respondedAt: "2026-04-12T12:00:02.000Z",
      usage: {
        providerKey: "openai",
        modelKey: input.model,
        inputTokens: 120,
        outputTokens: 40,
        totalTokens: 160
      },
      stopReason: "completed" as const,
      toolCalls: []
    };
  }
}

class FakeTurnContextHydrationService {
  source: RuntimeCompactionMessageSource = {
    messages: [
      { role: "user", content: "Older user message." },
      { role: "assistant", content: "Older assistant answer." },
      { role: "user", content: "Another older user message." },
      { role: "assistant", content: "Another older assistant answer." }
    ],
    summarizedMessageCount: 4,
    preservedRecentMessageCount: 8
  };
  inputs: Array<{ keepRecentMessageCount: number }> = [];

  async buildCompactionMessages(input: { keepRecentMessageCount: number }) {
    this.inputs.push(input);
    return this.source;
  }
}

class FakeSessionStoreService {
  resolvedSession = createResolvedSession(30_000);
  updatedSession = {
    ...createResolvedSession(null),
    compactionCount: 3,
    compactionHintTokens: 30_000,
    totalTokensFresh: false
  };
  updateCalls: Array<{
    compactionCount?: number;
    compactionHintTokens?: number | null;
    currentTokens?: number | null;
    totalTokensFresh?: boolean;
  }> = [];

  async resolveSession() {
    return {
      conversationKey: "conversation-key-1",
      found: true,
      session: this.resolvedSession
    };
  }

  async updateSessionSummary(input: {
    compactionCount?: number;
    compactionHintTokens?: number | null;
    currentTokens?: number | null;
    totalTokensFresh?: boolean;
  }) {
    this.updateCalls.push(input);
    return this.updatedSession;
  }
}

class FakeSessionLeaseService {
  lease: RuntimeSessionLease | null = {
    sessionId: "session-1",
    ownerToken: "lease-owner-1"
  };
  acquireCalls: string[] = [];
  released: RuntimeSessionLease[] = [];

  async acquireLease(sessionId: string) {
    this.acquireCalls.push(sessionId);
    return this.lease;
  }

  async releaseLease(lease: RuntimeSessionLease) {
    this.released.push(lease);
    return true;
  }
}

class FakeRuntimeStatePostgresService {
  appendCalls: unknown[] = [];

  async findSessionById() {
    return {
      id: "session-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      currentPublishedVersionId: "version-1",
      currentBundleHash: createBundleEntry().bundle.bundleHash,
      compactionCount: 2
    };
  }

  async appendSessionCompaction(input: unknown) {
    this.appendCalls.push(input);
    return {
      id: `compaction-${String(this.appendCalls.length)}`,
      ...((input ?? {}) as Record<string, unknown>)
    };
  }
}

export async function runSessionCompactionServiceTest(): Promise<void> {
  const bundleRegistry = new FakeRuntimeBundleRegistryService();
  const providerGateway = new FakeProviderGatewayClientService();
  const hydration = new FakeTurnContextHydrationService();
  const sessionStore = new FakeSessionStoreService();
  const leaseService = new FakeSessionLeaseService();
  const postgres = new FakeRuntimeStatePostgresService();
  const service = new SessionCompactionService(
    bundleRegistry as unknown as RuntimeBundleRegistryService,
    providerGateway as unknown as ProviderGatewayClientService,
    hydration as unknown as TurnContextHydrationService,
    sessionStore as unknown as SessionStoreService,
    leaseService as unknown as SessionLeaseService,
    postgres as unknown as RuntimeStatePostgresService
  );

  sessionStore.resolvedSession = createResolvedSession(7000);
  const belowThreshold = await service.compactSession({
    ...createCompactionRequest({ channel: "telegram" }),
    trigger: "auto_compaction"
  });
  assert.equal(belowThreshold.compacted, false);
  assert.equal(belowThreshold.reason, "threshold_not_reached");
  assert.equal(belowThreshold.toolResult.action, "skipped");
  assert.equal(providerGateway.requests.length, 0);
  assert.equal(postgres.appendCalls.length, 0);

  sessionStore.resolvedSession = createResolvedSession(7000);
  const manualWebCompaction = await service.compactSession(createCompactionRequest());
  assert.equal(manualWebCompaction.compacted, true);
  assert.equal(manualWebCompaction.reason, "compacted");
  assert.equal(manualWebCompaction.toolResult.action, "compacted");
  assert.equal(manualWebCompaction.toolResult.compactionRecordId, "compaction-1");
  assert.equal(manualWebCompaction.toolResult.reusableInLaterTurns, true);
  assert.equal(manualWebCompaction.session?.currentTokens, null);
  assert.equal(manualWebCompaction.session?.totalTokensFresh, false);
  assert.equal(providerGateway.requests.length, 1);
  assert.deepEqual(providerGateway.requests[0]?.requestMetadata, {
    classification: "manual_compaction",
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    toolLoopIteration: null,
    compactionToolCode: "compact_context"
  });
  assert.deepEqual(
    providerGateway.requests[0]?.outputSchema,
    REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA
  );
  assert.equal(providerGateway.requests[0]?.maxOutputTokens, 1_200);
  assert.deepEqual(postgres.appendCalls.at(-1), {
    runtimeSessionId: "session-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    requestId: null,
    reason: "manual_compaction",
    instructions: null,
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v2",
      toolCode: "compact_context",
      sections: VALID_COMPACTION_SECTIONS,
      summarizedMessageCount: 4,
      preservedRecentMessageCount: 8
    },
    tokensBefore: 7000,
    tokensAfter: null
  });

  sessionStore.resolvedSession = createResolvedSession(30000);
  const compacted = await service.compactSession(
    createCompactionRequest({ instructions: "Keep commitments and open questions." })
  );
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.reason, "compacted");
  assert.equal(compacted.tokensBefore, 30000);
  assert.equal(compacted.tokensAfter, null);
  assert.equal(compacted.session?.compactionCount, 3);
  assert.equal(compacted.toolResult.action, "compacted");
  assert.equal(compacted.toolResult.summaryText, RENDERED_COMPACTION_SUMMARY);
  assert.equal(compacted.toolResult.preservedRecentTurns, 4);
  assert.equal(hydration.inputs.at(-1)?.keepRecentMessageCount, 8);
  assert.equal(providerGateway.requests.length, 2);
  assert.deepEqual(providerGateway.requests[1]?.requestMetadata, {
    classification: "manual_compaction",
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    toolLoopIteration: null,
    compactionToolCode: "compact_context"
  });
  assert.deepEqual(
    providerGateway.requests[1]?.outputSchema,
    REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA
  );
  assert.equal(providerGateway.requests[1]?.maxOutputTokens, 1_200);
  assert.match(
    providerGateway.requests[1]?.systemPrompt ?? "",
    /Additional operator instructions: Keep commitments and open questions\./
  );
  assert.deepEqual(sessionStore.updateCalls.at(-1), {
    sessionId: "session-1",
    compactionCount: 3,
    compactionHintTokens: 30000,
    currentTokens: null,
    totalTokensFresh: false
  });
  assert.deepEqual(postgres.appendCalls.at(-1), {
    runtimeSessionId: "session-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    requestId: null,
    reason: "manual_compaction",
    instructions: "Keep commitments and open questions.",
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v2",
      toolCode: "compact_context",
      sections: VALID_COMPACTION_SECTIONS,
      summarizedMessageCount: 4,
      preservedRecentMessageCount: 8
    },
    tokensBefore: 30000,
    tokensAfter: null
  });
  assert.equal(leaseService.released.length, 3);

  sessionStore.resolvedSession = sessionStore.updatedSession;
  const autoAfterCompaction = await service.compactSession({
    ...createCompactionRequest({ channel: "telegram" }),
    trigger: "auto_compaction",
    runtimeRequestId: "request-auto-1"
  });
  assert.equal(autoAfterCompaction.compacted, false);
  assert.equal(autoAfterCompaction.reason, "threshold_not_reached");
  assert.equal(providerGateway.requests.length, 2);

  const retryRequestCountBefore = providerGateway.requests.length;
  const retryAppendCountBefore = postgres.appendCalls.length;
  const retryUpdateCountBefore = sessionStore.updateCalls.length;
  providerGateway.queuedTextOutputs = [
    "Sure, here's a helpful summary for you.",
    VALID_COMPACTION_OUTPUT
  ];
  sessionStore.resolvedSession = createResolvedSession(30000);
  const recoveredSummary = await service.compactSession(
    createCompactionRequest({ instructions: "Keep durable facts only." })
  );
  assert.equal(recoveredSummary.compacted, true);
  assert.equal(recoveredSummary.reason, "compacted");
  assert.equal(recoveredSummary.toolResult.summaryText, RENDERED_COMPACTION_SUMMARY);
  assert.equal(providerGateway.requests.length, retryRequestCountBefore + 2);
  assert.equal(postgres.appendCalls.length, retryAppendCountBefore + 1);
  assert.equal(sessionStore.updateCalls.length, retryUpdateCountBefore + 1);
  assert.match(
    providerGateway.requests.at(-1)?.systemPrompt ?? "",
    /Previous attempt was rejected because the output was not valid JSON\./
  );

  const invalidRequestCountBefore = providerGateway.requests.length;
  const invalidAppendCountBefore = postgres.appendCalls.length;
  const invalidUpdateCountBefore = sessionStore.updateCalls.length;
  providerGateway.queuedTextOutputs = [
    "Sure, here's a helpful summary for you.",
    "Still not valid JSON."
  ];
  sessionStore.resolvedSession = createResolvedSession(30000);
  const invalidSummary = await service.compactSession(
    createCompactionRequest({ instructions: "Keep durable facts only." })
  );
  assert.equal(invalidSummary.compacted, false);
  assert.equal(invalidSummary.reason, "invalid_summary_output");
  assert.equal(providerGateway.requests.length, invalidRequestCountBefore + 2);
  assert.equal(postgres.appendCalls.length, invalidAppendCountBefore);
  assert.equal(sessionStore.updateCalls.length, invalidUpdateCountBefore);
  providerGateway.textOutput = VALID_COMPACTION_OUTPUT;
  providerGateway.queuedTextOutputs = [];

  const summarized = await service.summarizeContext(
    createCompactionRequest({ instructions: "Keep durable facts only." })
  );
  assert.equal(summarized.compacted, false);
  assert.equal(summarized.reason, "summarized");
  assert.equal(summarized.toolResult.action, "summarized");
  assert.equal(summarized.toolResult.compactionRecordId, null);
  assert.equal(summarized.toolResult.reusableInLaterTurns, false);
  assert.equal(summarized.toolResult.summaryText, RENDERED_COMPACTION_SUMMARY);
  assert.deepEqual(providerGateway.requests.at(-1)?.requestMetadata, {
    classification: "manual_compaction",
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    toolLoopIteration: null,
    compactionToolCode: "summarize_context"
  });
  assert.deepEqual(
    providerGateway.requests.at(-1)?.outputSchema,
    REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA
  );
  assert.equal(postgres.appendCalls.length, 3);
  assert.equal(sessionStore.updateCalls.length, 3);

  const acquireCallsBeforeHeldLease = leaseService.acquireCalls.length;
  const releasedBeforeHeldLease = leaseService.released.length;
  const summarizedWithHeldLease = await service.summarizeContext({
    ...createCompactionRequest({ instructions: "Reuse the accepted turn lease." }),
    heldLease: {
      sessionId: "session-1",
      ownerToken: "accepted-turn-lease"
    }
  });
  assert.equal(summarizedWithHeldLease.reason, "summarized");
  assert.equal(leaseService.acquireCalls.length, acquireCallsBeforeHeldLease);
  assert.equal(leaseService.released.length, releasedBeforeHeldLease);
}

void runSessionCompactionServiceTest();
