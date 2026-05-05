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
      productPriorityTerms?: string[];
      webPriorityTerms?: string[];
      personalPriorityTerms?: string[];
    } | null;
  },
  includeSkills = true,
  enabledSkills?: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    iconEmoji: string;
    routingExamples: string[];
  }>
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
        ? (enabledSkills ?? [
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
          ])
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
  context: NonNullable<RuntimeTurnRequest["skillStateContext"]>
): RuntimeTurnRequest {
  return {
    ...request,
    skillStateContext: context
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

export async function runTurnRoutingServiceTest(): Promise<void> {
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
    ordinarySourcePriorityMode: "not_applicable",
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
  assert.equal(skillRetrievalTermDecision.source, "precheck");
  assert.deepEqual(skillRetrievalTermDecision.retrievalPlan, {
    useSkills: false,
    selectedSkillIds: [],
    useUserKnowledge: true,
    useProductKnowledge: true,
    useWeb: false,
    ordinarySourcePriorityMode: "personal_first",
    confidence: "high",
    reasonCode: "knowledge_retrieval"
  });
  assert.equal(providerGatewayClient.calls.length, 0);

  const semanticSkillDecision = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(
      createRequest("Какие принципы питания учитывать при диабете 1 типа?"),
      {
        decision: null,
        cadence: null,
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
  assert.equal(semanticSkillDecision.source, "precheck");
  assert.deepEqual(semanticSkillDecision.retrievalPlan, {
    useSkills: false,
    selectedSkillIds: [],
    useUserKnowledge: false,
    useProductKnowledge: false,
    useWeb: false,
    ordinarySourcePriorityMode: "not_applicable",
    confidence: "low",
    reasonCode: "simple_turn"
  });
  assert.equal(providerGatewayClient.calls.length, 0);

  const routerDisabledSkillDecision = await service.decide({
    bundle: createBundle({ enabled: false }),
    request: withSkillRoutingContext(
      createRequest("Какие принципы питания учитывать при диабете 1 типа?"),
      {
        decision: null,
        cadence: null,
        currentUserMessageIndex: 3,
        recentMessages: [
          { role: "user", text: "У меня диабет 1 типа" },
          { role: "assistant", text: "Поняла, давай говорить про питание." },
          { role: "user", text: "Какие принципы питания учитывать при диабете 1 типа?" }
        ],
        forceCheck: true
      }
    ),
    projectedTools
  });
  assert.equal(routerDisabledSkillDecision.source, "precheck");
  assert.equal(routerDisabledSkillDecision.retrievalPlan.useSkills, false);
  assert.deepEqual(routerDisabledSkillDecision.retrievalPlan.selectedSkillIds, []);
  assert.equal(providerGatewayClient.calls.length, 0);

  const simpleEnabledSkillTurn = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(createRequest("Привет, как дела?"), {
      decision: null,
      cadence: null,
      currentUserMessageIndex: 1,
      recentMessages: [{ role: "user", text: "Привет, как дела?" }]
    }),
    projectedTools
  });
  assert.equal(simpleEnabledSkillTurn.source, "precheck");
  assert.equal(simpleEnabledSkillTurn.reasonCode, "simple_turn");
  assert.equal(simpleEnabledSkillTurn.retrievalPlan.useSkills, false);
  assert.equal(providerGatewayClient.calls.length, 0);

  const inactiveAutoSkillDecision = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(createRequest("Привет, как дела?"), {
      decision: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        topicSummary: null,
        confidence: "low",
        checkedAtMessageIndex: 0
      },
      cadence: {
        messageCountSinceCheck: 2,
        backgroundCheckQueuedAtMessageIndex: null,
        needsBootstrap: false,
        bootstrapReason: null
      },
      currentUserMessageIndex: 3,
      recentMessages: [{ role: "user", text: "Привет, как дела?" }]
    }),
    projectedTools
  });
  assert.equal(inactiveAutoSkillDecision.reasonCode, "simple_turn");
  assert.equal(inactiveAutoSkillDecision.skillState?.status, "inactive");

  providerGatewayClient.result = {
    ...skillClassifierResult,
    text: JSON.stringify({
      executionMode: "normal",
      retrievalHint: true,
      toolHints: "knowledge",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: "normal",
      reasonCode: "classifier_result",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-dietitian"],
        useUserKnowledge: true,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "high",
        reasonCode: "classifier_skill_plan"
      }
    })
  };
  const metadataSkillMatchDecision = await service.decide({
    bundle: createBundle(undefined, true, [
      {
        id: "skill-dietitian",
        name: "Диетолог",
        description: "Помощник по питанию и составлению рациона под цели",
        category: "personal",
        tags: ["nutrition", "meal-planning"],
        iconEmoji: "🥦",
        routingExamples: ["Объясни, почему вес стоит при текущем количестве калорий."]
      }
    ]),
    request: withSkillRoutingContext(createRequest("Сколько калорий?"), {
      decision: null,
      cadence: null,
      currentUserMessageIndex: 3,
      recentMessages: [{ role: "user", text: "Сколько калорий?" }]
    }),
    projectedTools
  });
  assert.equal(metadataSkillMatchDecision.source, "precheck");
  assert.equal(metadataSkillMatchDecision.reasonCode, "simple_turn");
  assert.equal(metadataSkillMatchDecision.retrievalPlan.useSkills, false);
  assert.equal(providerGatewayClient.calls.length, 0);

  providerGatewayClient.result = {
    ...skillClassifierResult,
    text: JSON.stringify({
      executionMode: "normal",
      retrievalHint: false,
      toolHints: "none",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: "normal",
      reasonCode: "classifier_no_retrieval",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: false,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "low",
        reasonCode: "classifier_no_retrieval"
      }
    })
  };
  const ordinaryNoSkillDecision = await service.decide({
    bundle: createBundle(undefined, false),
    request: createRequest("Please tell me a short friendly fact about coffee."),
    projectedTools
  });
  assert.equal(ordinaryNoSkillDecision.executionMode, "normal");
  assert.equal(ordinaryNoSkillDecision.retrievalPlan.useSkills, false);
  providerGatewayClient.result = {
    ...skillClassifierResult,
    text: JSON.stringify({
      executionMode: "normal",
      retrievalHint: true,
      toolHints: "knowledge",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: "normal",
      reasonCode: "classifier_result",
      retrievalPlan: {
        useSkills: true,
        selectedSkillIds: ["skill-dietitian"],
        useUserKnowledge: true,
        useProductKnowledge: false,
        useWeb: false,
        confidence: "high",
        reasonCode: "classifier_skill_plan"
      }
    })
  };

  const assistantContextSkillMatchDecision = await service.decide({
    bundle: createBundle(undefined, true, [
      {
        id: "skill-dietitian",
        name: "Диетолог",
        description: "Помощник по питанию и составлению рациона под цели",
        category: "personal",
        tags: ["nutrition", "meal-planning"],
        iconEmoji: "🥦",
        routingExamples: ["Объясни, почему вес стоит при текущем количестве калорий."]
      }
    ]),
    request: withSkillRoutingContext(createRequest("А подешевле?"), {
      decision: null,
      cadence: null,
      currentUserMessageIndex: 4,
      recentMessages: [
        { role: "user", text: "Посчитай мой рацион" },
        { role: "assistant", text: "Я посчитала калории и предложила рацион на неделю." },
        { role: "user", text: "А подешевле?" }
      ]
    }),
    projectedTools
  });
  assert.equal(assistantContextSkillMatchDecision.source, "precheck");
  assert.equal(assistantContextSkillMatchDecision.reasonCode, "simple_turn");
  assert.equal(assistantContextSkillMatchDecision.retrievalPlan.useSkills, false);
  assert.equal(providerGatewayClient.calls.length, 0);

  const longTail = "tail-segment ".repeat(40);
  const assembledClassifierRequest = (
    service as unknown as {
      buildClassifierRequest: (input: {
        bundle: ReturnType<typeof createBundle>;
        request: RuntimeTurnRequest;
        projectedTools: RuntimeNativeToolProjection;
        provider: "openai" | "anthropic";
        model: string;
        prompt: string;
        fallbackMode: "normal" | "premium" | "reasoning";
      }) => ProviderGatewayTextGenerateRequest;
    }
  ).buildClassifierRequest({
    bundle: createBundle(),
    request: withSkillRoutingContext(createRequest("Нужен роутинг по теме"), {
      decision: null,
      cadence: null,
      currentUserMessageIndex: 5,
      recentMessages: [
        { role: "user", text: "Собери рацион на неделю" },
        { role: "assistant", text: `Очень длинный ответ ${longTail}` },
        { role: "user", text: "Сделай список покупок" }
      ],
      forceCheck: true
    }),
    projectedTools,
    provider: "openai",
    model: "gpt-4.1",
    prompt: "Router prompt",
    fallbackMode: "normal"
  });
  assert.equal(assembledClassifierRequest.maxOutputTokens, 1200);
  const assembledContent = String(assembledClassifierRequest.messages[0]?.content ?? "");
  assert.match(assembledContent, /Current user message:/);
  assert.match(assembledContent, /Нужен роутинг по теме/);
  assert.doesNotMatch(assembledContent, /Очень длинный ответ/);
  assert.doesNotMatch(assembledContent, /tail-segment/);

  const stickySkillDecision = await service.decide({
    bundle: createBundle(),
    request: withSkillRoutingContext(createRequest("А если изменить срок?"), {
      decision: {
        status: "active",
        activeSkillId: "skill-accounting",
        activeSkillName: "Accountant",
        topicSummary: "quarterly tax categories",
        confidence: "high",
        checkedAtMessageIndex: 3
      },
      cadence: {
        messageCountSinceCheck: 2,
        backgroundCheckQueuedAtMessageIndex: null,
        needsBootstrap: false,
        bootstrapReason: null
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
  assert.equal(providerGatewayClient.calls.length, 0);

  const stickySkillWithFileRequest = withSkillRoutingContext(createRequest("Use this file too."), {
    decision: {
      status: "active",
      activeSkillId: "skill-accounting",
      activeSkillName: "Accountant",
      topicSummary: "quarterly tax categories",
      confidence: "high",
      checkedAtMessageIndex: 4
    },
    cadence: {
      messageCountSinceCheck: 1,
      backgroundCheckQueuedAtMessageIndex: null,
      needsBootstrap: false,
      bootstrapReason: null
    },
    currentUserMessageIndex: 5,
    recentMessages: [
      { role: "user", text: "Explain quarterly tax categories" },
      { role: "assistant", text: "Let's compare the categories." },
      { role: "user", text: "Use this file too." }
    ]
  });
  stickySkillWithFileRequest.message.attachments = [
    {
      attachmentId: "attachment-1",
      kind: "file",
      objectKey: "assistant-media/assistants/assistant-1/uploads/tax.pdf",
      mimeType: "application/pdf",
      filename: "tax.pdf",
      sizeBytes: 1024,
      fileRef: "file-1"
    }
  ];
  const stickySkillWithFileDecision = await service.decide({
    bundle: createBundle(),
    request: stickySkillWithFileRequest,
    projectedTools
  });
  assert.equal(stickySkillWithFileDecision.source, "precheck");
  assert.equal(stickySkillWithFileDecision.executionMode, "premium");
  assert.match(stickySkillWithFileDecision.reasonCode, /sticky_skill_reuse/);
  assert.deepEqual(stickySkillWithFileDecision.retrievalPlan.selectedSkillIds, [
    "skill-accounting"
  ]);
  assert.equal(providerGatewayClient.calls.length, 0);

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
      decision: {
        status: "active",
        activeSkillId: "skill-accounting",
        activeSkillName: "Accountant",
        topicSummary: "quarterly tax categories",
        confidence: "high",
        checkedAtMessageIndex: 3
      },
      cadence: {
        messageCountSinceCheck: 5,
        backgroundCheckQueuedAtMessageIndex: null,
        needsBootstrap: false,
        bootstrapReason: null
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
  assert.equal(driftRecheckDecision.source, "precheck");
  assert.deepEqual(driftRecheckDecision.retrievalPlan.selectedSkillIds, []);
  assert.equal(driftRecheckDecision.skillState?.status, "active");
  assert.equal(driftRecheckDecision.skillState?.activeSkillId, "skill-accounting");
  assert.equal(driftRecheckDecision.skillState?.checkedAtMessageIndex, 3);
  assert.equal(providerGatewayClient.calls.length, 0);
  providerGatewayClient.result = skillClassifierResult;

  const noSkillsDecision = await service.decide({
    bundle: createBundle(undefined, false),
    request: withSkillRoutingContext(createRequest("Привет, как дела?"), {
      decision: null,
      cadence: null,
      currentUserMessageIndex: 1,
      recentMessages: [{ role: "user", text: "Привет, как дела?" }],
      forceCheck: true
    }),
    projectedTools
  });
  assert.equal(noSkillsDecision.source, "precheck");
  assert.equal(noSkillsDecision.reasonCode, "simple_turn");
  assert.equal(providerGatewayClient.calls.length, 0);

  const ambiguousDecision = await service.decide({
    bundle: createBundle(),
    request: createRequest(
      "I need help choosing between option A and option B for next month because each one changes several business details, several team details, several customer details, and several timeline details, and I have not organized the background clearly enough for a quick default choice yet."
    ),
    projectedTools
  });
  assert.equal(ambiguousDecision.executionMode, "premium");
  assert.equal(ambiguousDecision.source, "llm");
  assert.deepEqual(ambiguousDecision.retrievalPlan, {
    useSkills: false,
    selectedSkillIds: [],
    useUserKnowledge: true,
    useProductKnowledge: false,
    useWeb: false,
    ordinarySourcePriorityMode: "personal_first",
    confidence: "high",
    reasonCode: "classifier_skill_plan"
  });
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
  assert.doesNotMatch(
    String(providerGatewayClient.calls[0]?.messages[0]?.content ?? ""),
    /Enabled Skills summary:/
  );
  assert.doesNotMatch(
    String(providerGatewayClient.calls[2]?.messages[0]?.content ?? ""),
    /Use accounting knowledge carefully/
  );

  await runOrdinarySourcePriorityModeTests();
  await runAutoSkillRoutingHardeningTests();
}

async function runOrdinarySourcePriorityModeTests(): Promise<void> {
  const providerGatewayClient = new FakeProviderGatewayClientService();
  const service = new TurnRoutingService(
    providerGatewayClient as unknown as ProviderGatewayClientService
  );
  const bundle = createBundle(undefined, false);

  const productPriorityDecision = await service.decide({
    bundle,
    request: createRequest("найди в документах какой у меня тариф и лимит на квоту"),
    projectedTools
  });
  assert.equal(productPriorityDecision.source, "precheck");
  assert.equal(productPriorityDecision.reasonCode, "knowledge_retrieval");
  assert.equal(productPriorityDecision.retrievalPlan.ordinarySourcePriorityMode, "product_first");

  const personalPriorityDecision = await service.decide({
    bundle,
    request: createRequest("найди в памяти что я говорил вчера про мою маму"),
    projectedTools
  });
  assert.equal(personalPriorityDecision.source, "precheck");
  assert.equal(personalPriorityDecision.reasonCode, "knowledge_retrieval");
  assert.equal(personalPriorityDecision.retrievalPlan.ordinarySourcePriorityMode, "personal_first");

  const webPriorityDecision = await service.decide({
    bundle,
    request: createRequest("Latest news today, please browse the web"),
    projectedTools
  });
  assert.equal(webPriorityDecision.source, "precheck");
  assert.equal(webPriorityDecision.reasonCode, "tool_hint_web");
  assert.equal(webPriorityDecision.retrievalPlan.ordinarySourcePriorityMode, "web_first");

  const ambiguousMixedDecision = await service.decide({
    bundle,
    request: createRequest("найди в памяти про мой тариф пожалуйста"),
    projectedTools
  });
  assert.equal(ambiguousMixedDecision.source, "precheck");
  assert.equal(ambiguousMixedDecision.reasonCode, "knowledge_retrieval");
  assert.equal(ambiguousMixedDecision.retrievalPlan.ordinarySourcePriorityMode, "mixed_ambiguous");

  const adminProductOverrideDecision = await service.decide({
    bundle: createBundle(
      {
        precheckRuleOverrides: {
          continueTerms: [],
          retrievalTerms: [],
          reasoningTerms: [],
          premiumTerms: [],
          toolTerms: [],
          productPriorityTerms: ["custom-product-keyword"]
        }
      },
      false
    ),
    request: createRequest("найди в документах custom-product-keyword по подключению"),
    projectedTools
  });
  assert.equal(
    adminProductOverrideDecision.retrievalPlan.ordinarySourcePriorityMode,
    "product_first"
  );

  const continueTurnPriority = await service.decide({
    bundle,
    request: createRequest("ok"),
    projectedTools
  });
  assert.equal(continueTurnPriority.reasonCode, "continue_term");
  assert.equal(continueTurnPriority.retrievalPlan.ordinarySourcePriorityMode, "not_applicable");
}

async function runAutoSkillRoutingHardeningTests(): Promise<void> {
  const providerGatewayClient = new FakeProviderGatewayClientService();
  providerGatewayClient.result = {
    ...providerGatewayClient.result,
    text: "{invalid json"
  };
  const service = new TurnRoutingService(
    providerGatewayClient as unknown as ProviderGatewayClientService
  );
  const enabledSkills = Array.from({ length: 6 }, (_, index) => ({
    id: `skill-${index + 1}`,
    name: `Very Long Specialist Name ${index + 1} For Overflow Checks`,
    description:
      "Extremely verbose description that should never be copied into the routing prompt because it wastes tokens.",
    category: "health-and-wellness",
    tags: ["nutrition", "metabolism", "diabetes"],
    iconEmoji: "x",
    routingExamples: [
      "Build a detailed weekly plan with constraints and substitutions",
      "Review supplements and calories for a health goal"
    ]
  }));
  const decision = await service.decide({
    bundle: createBundle(undefined, true, enabledSkills),
    request: withSkillRoutingContext(createRequest("Давай диету"), {
      decision: null,
      cadence: null,
      currentUserMessageIndex: 3,
      recentMessages: [
        { role: "user", text: "OLD-ROUTING-MESSAGE-1 ".repeat(20) },
        { role: "assistant", text: "OLD-ROUTING-MESSAGE-2 ".repeat(20) },
        { role: "user", text: "Мне нужен план питания без рыбы и молока" },
        { role: "assistant", text: "Напиши цель и ограничения" },
        { role: "user", text: "Хочу похудеть и держать сахар стабильно" },
        { role: "assistant", text: "Укажи вес и рост" },
        { role: "user", text: "Вес 92, рост 178" },
        { role: "assistant", text: "Сколько тренировок в неделю?" }
      ],
      forceCheck: true
    }),
    projectedTools
  });
  assert.equal(decision.source, "precheck");
  assert.equal(decision.reasonCode, "simple_turn");
  assert.equal(decision.skillState, null);
  assert.equal(providerGatewayClient.calls.length, 0);
}
