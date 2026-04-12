import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
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
import type {
  RuntimeCompactionMessageSource,
  TurnContextHydrationService
} from "../src/modules/turns/turn-context-hydration.service";

function createCompactionRequest(instructions: string | null = null): RuntimeCompactionRequest {
  return {
    runtimeTier: "paid_shared_restricted",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    instructions
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

  async generateText(input: ProviderGatewayTextGenerateRequest) {
    this.requests.push(input);
    return {
      provider: "openai" as const,
      model: "gpt-5.4",
      text: "Compacted summary text",
      respondedAt: "2026-04-12T12:00:02.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4",
        inputTokens: 120,
        outputTokens: 40,
        totalTokens: 160
      }
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
    ...createResolvedSession(30_000),
    compactionCount: 3,
    compactionHintTokens: 30_000
  };
  updateCalls: Array<{ compactionCount?: number; compactionHintTokens?: number | null }> = [];

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
  released: RuntimeSessionLease[] = [];

  async acquireLease() {
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
    return input;
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
  const belowThreshold = await service.compactSession(createCompactionRequest());
  assert.equal(belowThreshold.compacted, false);
  assert.equal(belowThreshold.reason, "threshold_not_reached");
  assert.equal(providerGateway.requests.length, 0);
  assert.equal(postgres.appendCalls.length, 0);

  sessionStore.resolvedSession = createResolvedSession(30000);
  const compacted = await service.compactSession(
    createCompactionRequest("Keep commitments and open questions.")
  );
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.reason, "compacted");
  assert.equal(compacted.tokensBefore, 30000);
  assert.equal(compacted.tokensAfter, null);
  assert.equal(compacted.session?.compactionCount, 3);
  assert.equal(hydration.inputs.at(-1)?.keepRecentMessageCount, 8);
  assert.equal(providerGateway.requests.length, 1);
  assert.match(
    providerGateway.requests[0]?.systemPrompt ?? "",
    /Additional operator instructions: Keep commitments and open questions\./
  );
  assert.deepEqual(sessionStore.updateCalls.at(-1), {
    sessionId: "session-1",
    compactionCount: 3,
    compactionHintTokens: 30000
  });
  assert.deepEqual(postgres.appendCalls.at(-1), {
    runtimeSessionId: "session-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    reason: "manual_request",
    instructions: "Keep commitments and open questions.",
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v1",
      summarizeToolCode: "summarize_context",
      toolCode: "compact_context",
      summaryText: "Compacted summary text",
      summarizedMessageCount: 4,
      preservedRecentMessageCount: 8
    },
    tokensBefore: 30000,
    tokensAfter: null
  });
  assert.equal(leaseService.released.length, 2);
}

void runSessionCompactionServiceTest();
