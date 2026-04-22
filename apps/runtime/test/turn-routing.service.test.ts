import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import type { RuntimeNativeToolProjection } from "../src/modules/turns/native-tool-projection";
import { TurnRoutingService } from "../src/modules/turns/turn-routing.service";

class FakeProviderGatewayClientService {
  calls: ProviderGatewayTextGenerateRequest[] = [];
  result: ProviderGatewayTextGenerateResult = {
    provider: "openai",
    model: "gpt-4.1",
    text: JSON.stringify({
      executionMode: "premium",
      retrievalHint: false,
      toolHints: "none",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: "normal",
      reasonCode: "classifier_result"
    }),
    respondedAt: "2026-04-18T12:00:00.000Z",
    usage: {
      providerKey: "openai",
      modelKey: "gpt-4.1",
      inputTokens: 9,
      outputTokens: 5,
      totalTokens: 14
    },
    stopReason: "completed",
    toolCalls: []
  };

  isConfigured(): boolean {
    return true;
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.calls.push(input);
    return this.result;
  }
}

function createBundle(routerPolicyOverride?: {
  enabled?: boolean;
  mode?: "shadow" | "active";
  classifierFailureFallbackMode?: "normal" | "premium" | "reasoning";
  clarifyOnMissingContext?: boolean;
  precheckRuleOverrides?: {
    continueTerms: string[];
    retrievalTerms: string[];
    reasoningTerms: string[];
    premiumTerms: string[];
    toolTerms: string[];
  } | null;
}) {
  return compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      publishedVersion: 1,
      algorithmVersion: 73,
      configGeneration: 5
    },
    persona: {
      displayName: "Nova",
      instructions: "Stay helpful.",
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
      runtimeAssignment: { effectiveTier: "paid_shared_restricted" },
      runtimeProviderProfile: {
        mode: "admin_managed",
        primary: { provider: "openai", model: "gpt-5.4" }
      },
      runtimeProviderRouting: {
        primaryPath: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          active: true,
          inactiveReason: null
        }
      },
      routingFastModelKey: "gpt-4.1",
      routerPolicy: {
        enabled: true,
        mode: "active",
        classifierFailureFallbackMode: "normal",
        clarifyOnMissingContext: true,
        precheckRuleOverrides: null,
        ...routerPolicyOverride
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
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
        telegramAutoSummarizeEnabled: true
      },
      knowledgeAccess: {
        searchToolCode: "knowledge_search",
        fetchToolCode: "knowledge_fetch",
        executionModes: ["inline"],
        ragMode: "pattern_only",
        sources: []
      },
      workerTools: { tools: [] },
      browser: {
        toolCode: "browser",
        executionMode: "worker",
        credentialToolCode: "browser",
        providerIds: ["browserless"],
        defaultProviderId: "browserless",
        actions: ["snapshot"],
        confirmationRequiredActions: []
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
        planCode: "starter_trial",
        workspaceQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
    },
    channels: {
      bindings: null,
      telegram: {
        enabled: false,
        autoCompactionEnabled: false,
        dmPolicy: "off",
        groupReplyMode: "mentions_only",
        parseMode: "HTML",
        inbound: false,
        outbound: false,
        accessMode: "owner_only",
        ownerClaimStatus: "unclaimed",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: null,
        ownerTelegramUsername: null,
        ownerTelegramChatId: null
      }
    },
    promptDocuments: {
      soul: "# Soul",
      user: "# User",
      identity: "# Identity",
      tools: "# Tools",
      agents: "",
      heartbeat: "",
      routerClassifier: "You are the hidden PersAI early router.",
      preview: "# Preview",
      welcome: "# Welcome"
    }
  }).bundle;
}

function createRequest(text: string): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    runtimeTier: "paid_shared_restricted",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "conversation-1",
      externalUserKey: null,
      mode: "direct"
    },
    bundle: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bundleId: "bundle-1",
      bundleHash: "bundle-hash-1",
      publishedVersionId: "version-1",
      compiledAt: "2026-04-18T12:00:00.000Z"
    },
    message: {
      text,
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-18T12:00:00.000Z"
    },
    deepMode: false,
    idempotencyKey: "idem-1"
  };
}

const projectedTools: RuntimeNativeToolProjection = {
  tools: [
    {
      name: "knowledge_search",
      description: "Search knowledge",
      inputSchema: { type: "object" }
    },
    {
      name: "web_search",
      description: "Search the web",
      inputSchema: { type: "object" }
    }
  ],
  knowledgeSearchSources: [],
  knowledgeFetchSources: []
};

async function run(): Promise<void> {
  const providerGatewayClient = new FakeProviderGatewayClientService();
  const service = new TurnRoutingService(
    providerGatewayClient as unknown as ProviderGatewayClientService
  );

  const continueDecision = await service.decide({
    bundle: createBundle(),
    request: createRequest("ok"),
    projectedTools
  });
  assert.equal(continueDecision.executionMode, "normal");
  assert.equal(continueDecision.source, "precheck");
  assert.equal(providerGatewayClient.calls.length, 0);

  const premiumDecision = await service.decide({
    bundle: createBundle({
      precheckRuleOverrides: {
        continueTerms: [],
        retrievalTerms: [],
        reasoningTerms: [],
        premiumTerms: ["cover letter"],
        toolTerms: []
      }
    }),
    request: createRequest("Draft a polished cover letter for this role."),
    projectedTools
  });
  assert.equal(premiumDecision.executionMode, "premium");
  assert.equal(premiumDecision.source, "precheck");
  assert.equal(premiumDecision.reasonCode, "premium_writing");
  assert.equal(providerGatewayClient.calls.length, 0);

  const ambiguousDecision = await service.decide({
    bundle: createBundle(),
    request: createRequest(
      "I need help choosing between option A and option B for next month because each one changes several business details, several team details, several customer details, and several timeline details, and I have not organized the background clearly enough for a quick default choice yet."
    ),
    projectedTools
  });
  assert.equal(ambiguousDecision.executionMode, "premium");
  assert.equal(ambiguousDecision.source, "classifier");
  assert.equal(providerGatewayClient.calls.length, 1);
  assert.equal(providerGatewayClient.calls[0]?.requestMetadata?.classification, "turn_routing");
  assert.equal(providerGatewayClient.calls[0]?.outputSchema?.name, "turn_route_decision");
  assert.doesNotMatch(
    String(providerGatewayClient.calls[0]?.messages[0]?.content ?? ""),
    /Recent conversation tail/
  );
  assert.match(
    String(providerGatewayClient.calls[0]?.messages[0]?.content ?? ""),
    /Current user message:/
  );
}

void run();
