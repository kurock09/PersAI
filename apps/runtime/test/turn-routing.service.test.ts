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
      retrievalHint: true,
      toolHints: "knowledge",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: "normal",
      reasonCode: "classifier_result",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-accounting", "skill-unknown", "skill-accounting"],
        useUserKnowledge: true,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "high",
        reasonCode: "classifier_skill_plan"
      }
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

function createBundle(
  routerPolicyOverride?: {
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
  },
  includeSkills = true
) {
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
    },
    skills: {
      enabled: includeSkills
        ? [
            {
              id: "skill-accounting",
              name: "Accountant",
              description: "Accounting and tax support",
              category: "finance",
              tags: ["tax", "books"],
              iconEmoji: "🧾",
              routingExamples: ["Explain quarterly tax categories", "Compare bookkeeping options"]
            },
            {
              id: "skill-legal",
              name: "Lawyer",
              description: "Legal drafting support",
              category: "law",
              tags: ["contracts", "risk"],
              iconEmoji: "⚖️",
              routingExamples: ["Draft a contract clause", "Review legal risk"]
            }
          ]
        : []
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

function withSkillRoutingContext(
  request: RuntimeTurnRequest,
  context: NonNullable<RuntimeTurnRequest["skillRoutingContext"]>
): RuntimeTurnRequest {
  return {
    ...request,
    skillRoutingContext: context
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
  const skillClassifierResult = providerGatewayClient.result;
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
  assert.deepEqual(continueDecision.retrievalPlan, {
    useSkills: false,
    selectedSkillIds: [],
    useUserKnowledge: false,
    useProductKnowledge: false,
    useWeb: false,
    confidence: "low",
    reasonCode: "continue_term"
  });
  assert.equal(providerGatewayClient.calls.length, 0);

  const premiumDecision = await service.decide({
    bundle: createBundle(
      {
        precheckRuleOverrides: {
          continueTerms: [],
          retrievalTerms: [],
          reasoningTerms: [],
          premiumTerms: ["cover letter"],
          toolTerms: []
        }
      },
      false
    ),
    request: createRequest("Draft a polished cover letter for this role."),
    projectedTools
  });
  assert.equal(premiumDecision.executionMode, "premium");
  assert.equal(premiumDecision.source, "precheck");
  assert.equal(premiumDecision.reasonCode, "premium_writing");
  assert.equal(providerGatewayClient.calls.length, 0);

  const skillRetrievalTermDecision = await service.decide({
    bundle: createBundle(),
    request: createRequest("найди в документах правила по квартальным налоговым категориям"),
    projectedTools
  });
  assert.equal(skillRetrievalTermDecision.source, "classifier");
  assert.deepEqual(skillRetrievalTermDecision.retrievalPlan, {
    useSkills: true,
    selectedSkillIds: ["skill-accounting"],
    useUserKnowledge: true,
    useProductKnowledge: false,
    useWeb: false,
    confidence: "high",
    reasonCode: "classifier_skill_plan"
  });
  assert.equal(providerGatewayClient.calls.length, 1);
  assert.match(
    String(providerGatewayClient.calls[0]?.messages[0]?.content ?? ""),
    /routingExamples=explain quarterly tax categories/
  );

  const semanticSkillDecision = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(
      createRequest("Какие принципы питания учитывать при диабете 1 типа?"),
      {
        state: null,
        currentUserMessageIndex: 2,
        recentMessages: [
          { role: "user", text: "У меня диабет 1 типа" },
          { role: "user", text: "Какие принципы питания учитывать при диабете 1 типа?" }
        ],
        forceCheck: true
      }
    ),
    projectedTools
  });
  assert.equal(semanticSkillDecision.source, "classifier");
  assert.deepEqual(semanticSkillDecision.retrievalPlan, {
    useSkills: true,
    selectedSkillIds: ["skill-accounting"],
    useUserKnowledge: true,
    useProductKnowledge: false,
    useWeb: false,
    confidence: "high",
    reasonCode: "classifier_skill_plan"
  });
  assert.equal(providerGatewayClient.calls.length, 2);

  const simpleEnabledSkillTurn = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(createRequest("Привет, как дела?"), {
      state: null,
      currentUserMessageIndex: 1,
      recentMessages: [{ role: "user", text: "Привет, как дела?" }]
    }),
    projectedTools
  });
  assert.equal(simpleEnabledSkillTurn.source, "precheck");
  assert.equal(simpleEnabledSkillTurn.reasonCode, "simple_turn");
  assert.equal(simpleEnabledSkillTurn.retrievalPlan.useSkills, false);
  assert.equal(providerGatewayClient.calls.length, 2);

  const stickySkillDecision = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(createRequest("А если изменить срок?"), {
      state: {
        status: "active",
        activeSkillId: "skill-accounting",
        activeSkillName: "Accountant",
        topicSummary: "quarterly tax categories",
        confidence: "high",
        checkedAtMessageIndex: 3,
        messageCountSinceCheck: 2
      },
      currentUserMessageIndex: 4,
      recentMessages: [
        { role: "user", text: "Explain quarterly tax categories" },
        { role: "assistant", text: "Let's compare the categories." },
        { role: "user", text: "А если изменить срок?" }
      ]
    }),
    projectedTools
  });
  assert.equal(stickySkillDecision.source, "precheck");
  assert.equal(stickySkillDecision.reasonCode, "sticky_skill_reuse");
  assert.deepEqual(stickySkillDecision.retrievalPlan.selectedSkillIds, ["skill-accounting"]);
  assert.equal(stickySkillDecision.autoSkillState?.messageCountSinceCheck, 3);
  assert.equal(providerGatewayClient.calls.length, 2);

  providerGatewayClient.result = {
    ...skillClassifierResult,
    text: JSON.stringify({
      executionMode: "normal",
      retrievalHint: false,
      toolHints: "none",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: "normal",
      reasonCode: "classifier_result",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: false,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "medium",
        reasonCode: "classifier_topic_drift"
      }
    })
  };
  const driftRecheckDecision = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(createRequest("Теперь хочу обсудить B2B воронку"), {
      state: {
        status: "active",
        activeSkillId: "skill-accounting",
        activeSkillName: "Accountant",
        topicSummary: "quarterly tax categories",
        confidence: "high",
        checkedAtMessageIndex: 3,
        messageCountSinceCheck: 5
      },
      currentUserMessageIndex: 9,
      recentMessages: [
        { role: "user", text: "Explain quarterly tax categories" },
        { role: "assistant", text: "Let's compare the categories." },
        { role: "user", text: "Теперь хочу обсудить B2B воронку" }
      ],
      forceCheck: true
    }),
    projectedTools
  });
  assert.equal(driftRecheckDecision.source, "classifier");
  assert.deepEqual(driftRecheckDecision.retrievalPlan.selectedSkillIds, []);
  assert.equal(driftRecheckDecision.autoSkillState?.status, "inactive");
  assert.equal(driftRecheckDecision.autoSkillState?.activeSkillId, null);
  assert.equal(driftRecheckDecision.autoSkillState?.checkedAtMessageIndex, 9);
  assert.equal(driftRecheckDecision.autoSkillState?.messageCountSinceCheck, 0);
  assert.match(
    String(providerGatewayClient.calls[2]?.messages[0]?.content ?? ""),
    /Current auto Skill state: status=active/
  );
  providerGatewayClient.result = skillClassifierResult;

  const noSkillsDecision = await service.decide({
    bundle: createBundle(undefined, false),
    request: withSkillRoutingContext(createRequest("Привет, как дела?"), {
      state: null,
      currentUserMessageIndex: 1,
      recentMessages: [{ role: "user", text: "Привет, как дела?" }],
      forceCheck: true
    }),
    projectedTools
  });
  assert.equal(noSkillsDecision.source, "precheck");
  assert.equal(noSkillsDecision.reasonCode, "simple_turn");
  assert.equal(providerGatewayClient.calls.length, 3);

  const ambiguousDecision = await service.decide({
    bundle: createBundle(),
    request: createRequest(
      "I need help choosing between option A and option B for next month because each one changes several business details, several team details, several customer details, and several timeline details, and I have not organized the background clearly enough for a quick default choice yet."
    ),
    projectedTools
  });
  assert.equal(ambiguousDecision.executionMode, "premium");
  assert.equal(ambiguousDecision.source, "classifier");
  assert.deepEqual(ambiguousDecision.retrievalPlan, {
    useSkills: true,
    selectedSkillIds: ["skill-accounting"],
    useUserKnowledge: true,
    useProductKnowledge: false,
    useWeb: false,
    confidence: "high",
    reasonCode: "classifier_skill_plan"
  });
  assert.equal(providerGatewayClient.calls.length, 4);
  assert.equal(providerGatewayClient.calls[3]?.requestMetadata?.classification, "turn_routing");
  assert.equal(providerGatewayClient.calls[3]?.outputSchema?.name, "turn_route_decision");
  assert.doesNotMatch(
    String(providerGatewayClient.calls[3]?.messages[0]?.content ?? ""),
    /Recent conversation tail/
  );
  assert.match(
    String(providerGatewayClient.calls[3]?.messages[0]?.content ?? ""),
    /Current user message:/
  );
  assert.match(
    String(providerGatewayClient.calls[3]?.messages[0]?.content ?? ""),
    /Enabled Skills summary: id=skill-accounting/
  );
  assert.doesNotMatch(
    String(providerGatewayClient.calls[1]?.messages[0]?.content ?? ""),
    /Use accounting knowledge carefully/
  );
}

void run();
