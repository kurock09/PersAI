import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  resolveRuntimeSharedCompactionSummaryBudgetTokens,
  type ProviderGatewayTextGenerateRequest,
  type RuntimeBrowserConfig,
  type RuntimeKnowledgeAccessConfig,
  type RuntimeCompactionRequest,
  type RuntimeSessionSummary,
  type RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import type { RuntimeBundleRegistryService } from "../src/modules/bundles/runtime-bundle-registry.service";
import {
  type RuntimeSessionLease,
  SessionLeaseService
} from "../src/modules/sessions/session-lease.service";
import type { SessionStoreService } from "../src/modules/sessions/session-store.service";
import type { RuntimeStatePostgresService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import type { RuntimeBundleAutoRefreshService } from "../src/modules/turns/runtime-bundle-auto-refresh.service";
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
    },
    {
      source: "chat",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "preset",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "subscription",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "global",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    }
  ]
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = {
  tools: [
    {
      toolCode: "browser",
      family: "browser_interaction",
      outcomeKind: "structured_output",
      timeoutMs: 120000,
      confirmationRule: "required_for_mutations",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    }
  ]
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

const VALID_COMPACTION_SECTIONS = {
  stableFacts: ["User is working on the PersAI runtime."],
  userPreferences: ["Prefers direct production-safe fixes."],
  assistantCommitments: ["Assistant owes a verified shared compaction fix."],
  openThreads: ["Need to stabilize native shared compaction semantics."],
  importantReferences: ["Session thread key is thread-1."]
};

const VALID_COMPACTION_OUTPUT = JSON.stringify(VALID_COMPACTION_SECTIONS);

const PARTIAL_COMPACTION_SECTIONS = {
  stableFacts: ["User is working on the PersAI runtime."],
  userPreferences: [],
  assistantCommitments: [],
  openThreads: ["Need to stabilize native shared compaction semantics."],
  importantReferences: ["Session thread key is thread-1."]
};

const PARTIAL_COMPACTION_OUTPUT = JSON.stringify({
  sections: {
    stableFacts: PARTIAL_COMPACTION_SECTIONS.stableFacts,
    openThreads: PARTIAL_COMPACTION_SECTIONS.openThreads,
    importantReferences: PARTIAL_COMPACTION_SECTIONS.importantReferences
  }
});

const LONG_COMPACTION_SECTIONS = {
  stableFacts: [
    "User Alexey interacts with assistant Jarvis in Russian, often testing latency and behavior of a new PersAI-native runtime replacing OpenClaw.",
    "A large ADR-072 describes a multi-step migration from OpenClaw to a PersAI-native runtime, with steps 1-11 partially implemented, especially native attachments in Step 11.",
    "PersAI-native runtime is now handling the assistant responses for the user; previously the OpenClaw path caused higher latency and extra token usage.",
    "Native attachment storage has been cut over to PersAI-owned object storage for active web chat; STT and some legacy tool artifacts still temporarily use OpenClaw paths.",
    "Jarvis has internal tools summarize_context and compact_context used for summarizing and compacting dialogue context; no external tools like web search are currently exposed in this session.",
    "User is technically savvy, deeply involved in the PersAI and OpenClaw migration, and comfortable discussing ADRs, steps, and architecture details."
  ],
  userPreferences: [
    "User prefers concise, direct explanations with optional deeper detail on architecture and runtime behavior.",
    "User often switches between Russian and English but generally communicates in Russian.",
    "User is sensitive to latency and cares a lot about fast, snappy responses.",
    "User likes short, human-readable translations of technical changelogs and ADR fragments.",
    "User tests tools and background behavior, including reminders and context tools, out of curiosity."
  ],
  assistantCommitments: [
    "Assistant will help interpret ADR-072 and subsequent steps into clear, human language and suggest small executable sub-steps.",
    "Assistant will help summarize or compact context when requested using internal summarize_context and compact_context tools.",
    "Assistant will assist in reasoning about performance, latency, and token-usage improvements after cutover from OpenClaw to PersAI runtime.",
    "Assistant will help draft or refine ADR text, commit messages, and execution ledger entries when the user asks."
  ],
  openThreads: [
    "Step 11 native attachment staging is in progress; the next sub-step is richer native attachment context hydration for current and historical turns and removal of remaining legacy seams.",
    "Step 12 native STT is planned: move transcription fully off OpenClaw once Step 11 storage is solid.",
    "Later steps will cut over Telegram, tools, and sandbox and then fully remove OpenClaw in Steps 13-18, but detailed planning per step is not yet finalized in this chat.",
    "Background task jarvis_background_habits timing and semantics were discussed; user may later decide to pause or adjust it.",
    "Potential future work includes streaming TTS with Yandex for web and non-streamed voice messages for Telegram bots."
  ],
  importantReferences: [
    "docs/ADR/072-persai-native-multichannel-runtime-replacement.md defines the PersAI-native runtime target architecture and steps 1-18.",
    "The ADR-072 step ledger says Step 11 is now in progress and implements PersAI-native attachment staging and storage.",
    "PersaiMediaObjectStorageService and related media services in apps/api handle the new PersAI object storage attachment path.",
    "assistant_chat_message_attachments.storage_path now stores PersAI object keys instead of OpenClaw workspace paths."
  ]
};

const LONG_COMPACTION_OUTPUT = JSON.stringify(LONG_COMPACTION_SECTIONS);

const FULL_CAPACITY_COMPACTION_SECTIONS = {
  stableFacts: Array.from(
    { length: 6 },
    (_, index) => `Stable fact ${String(index + 1)} retained for later turns.`
  ),
  userPreferences: Array.from(
    { length: 6 },
    (_, index) => `User preference ${String(index + 1)} retained for later turns.`
  ),
  assistantCommitments: Array.from(
    { length: 6 },
    (_, index) => `Assistant commitment ${String(index + 1)} retained for later turns.`
  ),
  openThreads: Array.from(
    { length: 6 },
    (_, index) => `Open thread ${String(index + 1)} retained for later turns.`
  ),
  importantReferences: Array.from(
    { length: 6 },
    (_, index) => `Important reference ${String(index + 1)} retained for later turns.`
  )
};

const FULL_CAPACITY_COMPACTION_OUTPUT = JSON.stringify(FULL_CAPACITY_COMPACTION_SECTIONS);

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

const RENDERED_PARTIAL_COMPACTION_SUMMARY = [
  "Stable facts:",
  "- User is working on the PersAI runtime.",
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

function createBundleEntry(input?: { sharedCompactionSummaryBudgetTokens?: number }) {
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
      assistantGender: null,
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "ru-RU",
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
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        ...(input?.sharedCompactionSummaryBudgetTokens === undefined
          ? {}
          : {
              sharedCompactionSummaryBudgetTokens: input.sharedCompactionSummaryBudgetTokens
            }),
        autoCompactionWeb: false,
        autoCompactionTelegram: true
      },
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
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
      toolCredentialRefs: {
        browser: {
          refKey: "persai:persai-runtime:tool/browser/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/browser/api-key"
          },
          configured: false,
          providerId: "browserless"
        }
      },
      toolPolicies: [
        {
          toolCode: "browser",
          displayName: "Browser",
          description: "Navigate and interact with web pages.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "forbidden",
          enabled: false,
          visibleToModel: false,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        }
      ],
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
      preview: "",
      welcome: ""
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
    {
      async ensureAssistantVersionBundle() {
        return false;
      }
    } as Pick<
      RuntimeBundleAutoRefreshService,
      "ensureAssistantVersionBundle"
    > as RuntimeBundleAutoRefreshService,
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
  assert.equal(providerGateway.requests[0]?.promptCache?.retention, "in_memory");
  assert.match(providerGateway.requests[0]?.promptCache?.key ?? "", /^ps1:sc:[a-f0-9]{32}:b\d{2}$/);
  assert.ok((providerGateway.requests[0]?.promptCache?.key?.length ?? 0) <= 64);
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
  assert.match(
    providerGateway.requests[1]?.systemPrompt ?? "",
    /30 retained notes total; prefer fewer and keep only the most durable facts and open threads\./
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

  const partialRequestCountBefore = providerGateway.requests.length;
  const partialAppendCountBefore = postgres.appendCalls.length;
  const partialUpdateCountBefore = sessionStore.updateCalls.length;
  providerGateway.queuedTextOutputs = [PARTIAL_COMPACTION_OUTPUT];
  sessionStore.resolvedSession = createResolvedSession(30000);
  const partialSummary = await service.compactSession(
    createCompactionRequest({ instructions: "Keep durable facts only." })
  );
  assert.equal(partialSummary.compacted, true);
  assert.equal(partialSummary.reason, "compacted");
  assert.equal(partialSummary.toolResult.summaryText, RENDERED_PARTIAL_COMPACTION_SUMMARY);
  assert.deepEqual(partialSummary.toolResult.summaryPayload, {
    schema: "persai.runtimeSessionCompaction.v2",
    toolCode: "compact_context",
    sections: PARTIAL_COMPACTION_SECTIONS,
    summarizedMessageCount: 4,
    preservedRecentMessageCount: 8
  });
  assert.equal(providerGateway.requests.length, partialRequestCountBefore + 1);
  assert.equal(postgres.appendCalls.length, partialAppendCountBefore + 1);
  assert.equal(sessionStore.updateCalls.length, partialUpdateCountBefore + 1);

  const longRequestCountBefore = providerGateway.requests.length;
  const longAppendCountBefore = postgres.appendCalls.length;
  const longUpdateCountBefore = sessionStore.updateCalls.length;
  providerGateway.queuedTextOutputs = [LONG_COMPACTION_OUTPUT];
  sessionStore.resolvedSession = createResolvedSession(30000);
  const longSummary = await service.compactSession(
    createCompactionRequest({ instructions: "Keep durable facts only." })
  );
  assert.equal(longSummary.compacted, true);
  assert.equal(longSummary.reason, "compacted");
  assert.deepEqual(longSummary.toolResult.summaryPayload, {
    schema: "persai.runtimeSessionCompaction.v2",
    toolCode: "compact_context",
    sections: LONG_COMPACTION_SECTIONS,
    summarizedMessageCount: 4,
    preservedRecentMessageCount: 8
  });
  const longSummaryText = longSummary.toolResult.summaryText ?? "";
  const defaultSummaryCharBudget =
    resolveRuntimeSharedCompactionSummaryBudgetTokens({
      targetContextBudget: 24_000
    }) * 4;
  assert.ok(longSummaryText.length > 0);
  assert.ok(longSummaryText.length > 2_500);
  assert.ok(longSummaryText.length <= defaultSummaryCharBudget);
  assert.match(longSummaryText, /^Stable facts:/);
  assert.match(longSummaryText, /User Alexey interacts with assistant Jarvis in Russian/);
  assert.equal(providerGateway.requests.length, longRequestCountBefore + 1);
  assert.equal(postgres.appendCalls.length, longAppendCountBefore + 1);
  assert.equal(sessionStore.updateCalls.length, longUpdateCountBefore + 1);

  const fullCapacityRequestCountBefore = providerGateway.requests.length;
  const fullCapacityAppendCountBefore = postgres.appendCalls.length;
  const fullCapacityUpdateCountBefore = sessionStore.updateCalls.length;
  providerGateway.queuedTextOutputs = [FULL_CAPACITY_COMPACTION_OUTPUT];
  sessionStore.resolvedSession = createResolvedSession(30000);
  const fullCapacitySummary = await service.compactSession(
    createCompactionRequest({ instructions: "Keep durable facts only." })
  );
  assert.equal(fullCapacitySummary.compacted, true);
  assert.equal(fullCapacitySummary.reason, "compacted");
  assert.deepEqual(fullCapacitySummary.toolResult.summaryPayload, {
    schema: "persai.runtimeSessionCompaction.v2",
    toolCode: "compact_context",
    sections: FULL_CAPACITY_COMPACTION_SECTIONS,
    summarizedMessageCount: 4,
    preservedRecentMessageCount: 8
  });
  assert.equal(fullCapacitySummary.toolResult.summaryText?.includes("Important reference 6"), true);
  assert.equal(providerGateway.requests.length, fullCapacityRequestCountBefore + 1);
  assert.equal(postgres.appendCalls.length, fullCapacityAppendCountBefore + 1);
  assert.equal(sessionStore.updateCalls.length, fullCapacityUpdateCountBefore + 1);

  bundleRegistry.entry = createBundleEntry({
    sharedCompactionSummaryBudgetTokens: 300
  });
  const customBudgetRequestCountBefore = providerGateway.requests.length;
  const customBudgetAppendCountBefore = postgres.appendCalls.length;
  const customBudgetUpdateCountBefore = sessionStore.updateCalls.length;
  providerGateway.queuedTextOutputs = [LONG_COMPACTION_OUTPUT];
  sessionStore.resolvedSession = createResolvedSession(30000);
  const customBudgetSummary = await service.compactSession(
    createCompactionRequest({ instructions: "Keep durable facts only." })
  );
  assert.equal(customBudgetSummary.compacted, true);
  assert.equal(customBudgetSummary.reason, "compacted");
  const customBudgetSummaryText = customBudgetSummary.toolResult.summaryText ?? "";
  assert.ok(customBudgetSummaryText.length > 0);
  assert.ok(customBudgetSummaryText.length <= 1200);
  assert.match(customBudgetSummaryText, /\.\.\.$/);
  assert.equal(providerGateway.requests.length, customBudgetRequestCountBefore + 1);
  assert.equal(postgres.appendCalls.length, customBudgetAppendCountBefore + 1);
  assert.equal(sessionStore.updateCalls.length, customBudgetUpdateCountBefore + 1);

  const summarizedAppendCountBefore = postgres.appendCalls.length;
  const summarizedUpdateCountBefore = sessionStore.updateCalls.length;
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
  assert.equal(postgres.appendCalls.length, summarizedAppendCountBefore);
  assert.equal(sessionStore.updateCalls.length, summarizedUpdateCountBefore);

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
