import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextMessage,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeMemoryWriteItem,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { AutoExtractToMemoryService } from "../src/modules/turns/auto-extract-to-memory.service";
import type {
  InternalMemoryWriteInput,
  InternalMemoryWriteOutcome,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";

const KNOWLEDGE_ACCESS_EMPTY = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: []
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = { tools: [] } satisfies RuntimeWorkerToolsConfig;

const BROWSER_CONFIG = {
  toolCode: "browser",
  executionMode: "worker",
  credentialToolCode: "browser",
  providerIds: ["browserless"],
  defaultProviderId: "browserless",
  actions: ["snapshot"],
  confirmationRequiredActions: []
} satisfies RuntimeBrowserConfig;

function createBundle() {
  return compileAssistantRuntimeBundle({
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
        defaultLocale: "en-US",
        deliveryKind: "voice_note",
        elevenlabs: { voiceId: null },
        yandex: { voice: "jane", role: null },
        openai: { voice: "marin" }
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
        primary: { provider: "openai", model: "gpt-5.4" }
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
        autoCompactionWeb: true,
        autoCompactionTelegram: true
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
      toolPolicies: [],
      quota: { planCode: "paid", workspaceQuotaBytes: 1024, quotaHook: null },
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

class FakeProviderGateway {
  public requests: ProviderGatewayTextGenerateRequest[] = [];
  public nextResult: ProviderGatewayTextGenerateResult = {
    provider: "openai",
    model: "gpt-5.4",
    text: '{"items":[]}',
    respondedAt: "2026-04-12T00:00:00.000Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    },
    stopReason: "completed",
    toolCalls: []
  };
  public throwNext: Error | null = null;

  async generateText(input: ProviderGatewayTextGenerateRequest) {
    this.requests.push(input);
    if (this.throwNext) {
      const e = this.throwNext;
      this.throwNext = null;
      throw e;
    }
    return this.nextResult;
  }
}

class FakeInternalApi {
  public writeCalls: InternalMemoryWriteInput[] = [];
  public outcomes: InternalMemoryWriteOutcome[] = [];
  public throwOnIndex: number | null = null;

  async writeMemory(input: InternalMemoryWriteInput): Promise<InternalMemoryWriteOutcome> {
    const callIndex = this.writeCalls.length;
    this.writeCalls.push(input);
    if (this.throwOnIndex === callIndex) {
      throw new Error("write boom");
    }
    const next = this.outcomes.shift();
    if (!next) {
      throw new Error("no outcome queued");
    }
    return next;
  }
}

function makeWrittenItem(id: string): RuntimeMemoryWriteItem {
  return {
    id,
    summary: "stub",
    kind: "fact",
    sourceLabel: null,
    createdAt: "2026-04-12T00:00:00.000Z",
    chatId: null
  };
}

const SAMPLE_MESSAGES: ProviderGatewayTextMessage[] = [
  { role: "user", content: "I love productivity tips for Saturday mornings." },
  { role: "assistant", content: "Got it — I'll keep Saturday mornings sacred for planning calls." }
];

function buildService(): {
  service: AutoExtractToMemoryService;
  gateway: FakeProviderGateway;
  api: FakeInternalApi;
} {
  const gateway = new FakeProviderGateway();
  const api = new FakeInternalApi();
  const service = new AutoExtractToMemoryService(
    gateway as unknown as ProviderGatewayClientService,
    api as unknown as PersaiInternalApiClientService
  );
  return { service, gateway, api };
}

async function runWritesAcceptedCandidates(): Promise<void> {
  const { service, gateway, api } = buildService();
  const bundle = createBundle();
  gateway.nextResult = {
    ...gateway.nextResult,
    text: JSON.stringify({
      items: [
        { kind: "preference", summary: "She prefers Saturday mornings for planning calls." },
        { kind: "fact", summary: "User works on PersAI runtime." },
        { kind: "open_loop", summary: "Need to circle back on Step 12 transcription." }
      ]
    })
  };
  api.outcomes = [
    { written: true, code: null, message: null, item: makeWrittenItem("m1") },
    { written: true, code: null, message: null, item: makeWrittenItem("m2") },
    { written: true, code: null, message: null, item: makeWrittenItem("m3") }
  ];

  const result = await service.execute({
    bundle,
    channel: "web",
    conversationMode: "direct",
    compactedMessages: SAMPLE_MESSAGES,
    rollingSynopsisText: null,
    runtimeRequestId: "req-1",
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });

  assert.equal(result.attempted, true);
  assert.equal(result.written, 3);
  assert.equal(result.dedupSkipped, 0);
  assert.equal(result.policySkipped, 0);
  assert.equal(result.invalidSkipped, 0);
  assert.equal(result.kindCounts.fact, 1);
  assert.equal(result.kindCounts.preference, 1);
  assert.equal(result.kindCounts.open_loop, 1);
  assert.equal(result.entries.length, 3);
  assert.equal(result.reason, "ok");
  assert.equal(api.writeCalls.length, 3);
  assert.equal(api.writeCalls[0]?.transportSurface, "web");
  assert.equal(api.writeCalls[0]?.sourceTrust, "trusted_1to1");
  assert.equal(api.writeCalls[0]?.requestId, "req-1");
  assert.equal(api.writeCalls[0]?.relatedUserMessageId, null);

  // Provider request must use auto_extract_to_memory classification and
  // respect human-voice instructions.
  assert.equal(gateway.requests.length, 1);
  assert.equal(gateway.requests[0]?.requestMetadata?.classification, "auto_extract_to_memory");
  const systemPrompt = gateway.requests[0]?.systemPrompt ?? "";
  assert.match(systemPrompt, /warm, attentive friend/i);
  assert.match(systemPrompt, /Never write in the user's voice/);
  assert.match(systemPrompt, /STRICT JSON/);
}

async function runDeduplicateCandidatesBeforeWrite(): Promise<void> {
  const { service, gateway, api } = buildService();
  gateway.nextResult = {
    ...gateway.nextResult,
    text: JSON.stringify({
      items: [
        { kind: "fact", summary: "User likes espresso." },
        { kind: "fact", summary: "  user likes ESPRESSO. " },
        { kind: "preference", summary: "User likes espresso." }
      ]
    })
  };
  api.outcomes = [
    { written: true, code: null, message: null, item: makeWrittenItem("m1") },
    { written: true, code: null, message: null, item: makeWrittenItem("m2") }
  ];

  const result = await service.execute({
    bundle: createBundle(),
    channel: "web",
    conversationMode: "direct",
    compactedMessages: SAMPLE_MESSAGES,
    rollingSynopsisText: null,
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });

  assert.equal(api.writeCalls.length, 2);
  assert.equal(result.written, 2);
}

async function runHonoursServerSideDuplicateOutcome(): Promise<void> {
  const { service, gateway, api } = buildService();
  gateway.nextResult = {
    ...gateway.nextResult,
    text: JSON.stringify({
      items: [
        { kind: "fact", summary: "User likes espresso." },
        { kind: "preference", summary: "User prefers vinyl." }
      ]
    })
  };
  api.outcomes = [
    { written: false, code: "duplicate", message: "exists", item: makeWrittenItem("m-dup") },
    { written: true, code: null, message: null, item: makeWrittenItem("m1") }
  ];

  const result = await service.execute({
    bundle: createBundle(),
    channel: "web",
    conversationMode: "direct",
    compactedMessages: SAMPLE_MESSAGES,
    rollingSynopsisText: null,
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });

  assert.equal(result.written, 1);
  assert.equal(result.dedupSkipped, 1);
  assert.equal(result.policySkipped, 0);
  assert.equal(result.invalidSkipped, 0);
}

async function runHonoursServerSidePolicyDenial(): Promise<void> {
  const { service, gateway, api } = buildService();
  gateway.nextResult = {
    ...gateway.nextResult,
    text: JSON.stringify({
      items: [{ kind: "fact", summary: "Some fact about a group user." }]
    })
  };
  api.outcomes = [
    {
      written: false,
      code: "memory_group_global_write_denied",
      message: "denied",
      item: null
    }
  ];

  const result = await service.execute({
    bundle: createBundle(),
    channel: "telegram",
    conversationMode: "group",
    compactedMessages: SAMPLE_MESSAGES,
    rollingSynopsisText: null,
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });

  assert.equal(result.written, 0);
  assert.equal(result.policySkipped, 1);
  assert.equal(result.dedupSkipped, 0);
  assert.equal(result.reason, "all_skipped");
  assert.equal(api.writeCalls[0]?.transportSurface, "telegram");
  assert.equal(api.writeCalls[0]?.sourceTrust, "group");
}

async function runEnforcesSoftCap(): Promise<void> {
  const { service, gateway, api } = buildService();
  const items = Array.from({ length: 12 }, (_, i) => ({
    kind: "fact" as const,
    summary: `Stable fact number ${String(i + 1)} about the user.`
  }));
  gateway.nextResult = { ...gateway.nextResult, text: JSON.stringify({ items }) };
  api.outcomes = Array.from({ length: 12 }, (_, i) => ({
    written: true as const,
    code: null,
    message: null,
    item: makeWrittenItem(`m${String(i + 1)}`)
  }));

  const result = await service.execute({
    bundle: createBundle(),
    channel: "web",
    conversationMode: "direct",
    compactedMessages: SAMPLE_MESSAGES,
    rollingSynopsisText: null,
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });

  assert.equal(api.writeCalls.length, 8);
  assert.equal(result.written, 8);
}

async function runReturnsEmptyWhenProviderFails(): Promise<void> {
  const { service, gateway, api } = buildService();
  gateway.throwNext = new Error("provider exploded");

  const result = await service.execute({
    bundle: createBundle(),
    channel: "web",
    conversationMode: "direct",
    compactedMessages: SAMPLE_MESSAGES,
    rollingSynopsisText: null,
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });

  assert.equal(result.attempted, true);
  assert.equal(result.written, 0);
  assert.equal(result.reason, "provider_error");
  assert.equal(api.writeCalls.length, 0);
}

async function runShortCircuitsForUnsupportedTransport(): Promise<void> {
  const { service, gateway, api } = buildService();
  const result = await service.execute({
    bundle: createBundle(),
    channel: "max_ru",
    conversationMode: "direct",
    compactedMessages: SAMPLE_MESSAGES,
    rollingSynopsisText: null,
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });
  assert.equal(result.attempted, false);
  assert.equal(result.reason, "transport_surface_unavailable");
  assert.equal(gateway.requests.length, 0);
  assert.equal(api.writeCalls.length, 0);
}

async function runShortCircuitsWhenNoMessages(): Promise<void> {
  const { service, gateway, api } = buildService();
  const result = await service.execute({
    bundle: createBundle(),
    channel: "web",
    conversationMode: "direct",
    compactedMessages: [],
    rollingSynopsisText: null,
    runtimeRequestId: null,
    runtimeSessionId: "session-1",
    providerSelection: { provider: "openai", model: "gpt-5.4" }
  });
  assert.equal(result.attempted, false);
  assert.equal(result.reason, "no_messages_to_extract");
  assert.equal(gateway.requests.length, 0);
  assert.equal(api.writeCalls.length, 0);
}

async function run(): Promise<void> {
  await runWritesAcceptedCandidates();
  await runDeduplicateCandidatesBeforeWrite();
  await runHonoursServerSideDuplicateOutcome();
  await runHonoursServerSidePolicyDenial();
  await runEnforcesSoftCap();
  await runReturnsEmptyWhenProviderFails();
  await runShortCircuitsForUnsupportedTransport();
  await runShortCircuitsWhenNoMessages();
}

void run();
