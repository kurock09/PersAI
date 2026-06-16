import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  RuntimeBundleSkillScenario,
  RuntimeSkillDecisionState
} from "@persai/runtime-contract";
import { BuildActiveScenarioBlockService } from "../src/modules/turns/build-active-scenario-block.service";

const CAROUSEL_SCENARIO: RuntimeBundleSkillScenario = {
  key: "instagram_carousel",
  displayName: "Instagram Carousel",
  description: "Create an 8-slide Instagram carousel.",
  iconEmoji: "📸",
  intentExamples: ["carousel post"],
  steps: [
    {
      number: 1,
      directive: "CALL image_generate with outputMode=series, count=8",
      recommendedToolCall: "image_generate",
      mayBeSkippedIf: null,
      negativeGuards: ["collapse into one call"]
    },
    {
      number: 2,
      directive: "Call skill({ action: release }) when done.",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: []
    }
  ],
  recommendedTools: ["image_generate"],
  exitCondition: "All 8 slides confirmed."
};

function createBundle(
  skills?: Array<{ id: string; name: string; scenarios?: RuntimeBundleSkillScenario[] }>
) {
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
      displayName: "PersAI",
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
        autoCompactionWeb: false,
        autoCompactionTelegram: true,
        crossSessionCarryOverTtlDays: 7,
        crossSessionCarryOverIdleHours: 4,
        crossSessionCarryOverCooldownHours: 12
      },
      knowledgeAccess: {
        searchToolCode: "knowledge_search",
        fetchToolCode: "knowledge_fetch",
        executionModes: ["inline", "worker"],
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
        actions: ["snapshot", "act"],
        confirmationRequiredActions: ["act"]
      },
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
    },
    ...(skills !== undefined && skills.length > 0
      ? {
          skills: {
            enabled: skills.map((s) => ({
              id: s.id,
              name: s.name,
              description: null,
              category: "general",
              tags: [],
              ...(s.scenarios !== undefined ? { scenarios: s.scenarios } : {})
            }))
          }
        }
      : {})
  }).bundle;
}

const activeStateWithScenario: RuntimeSkillDecisionState = {
  status: "active",
  activeSkillId: "skill-marketer",
  activeSkillName: "Marketer",
  activeScenarioKey: "instagram_carousel",
  topicSummary: null
};

const activeStateNoScenario: RuntimeSkillDecisionState = {
  status: "active",
  activeSkillId: "skill-marketer",
  activeSkillName: "Marketer",
  activeScenarioKey: null,
  topicSummary: null
};

const inactiveState: RuntimeSkillDecisionState = {
  status: "inactive",
  activeSkillId: null,
  activeSkillName: null,
  activeScenarioKey: null,
  topicSummary: null
};

export async function runBuildActiveScenarioBlockServiceTest(): Promise<void> {
  const svc = new BuildActiveScenarioBlockService();

  // (a) Null state → no block
  {
    const bundle = createBundle([{ id: "skill-marketer", name: "Marketer" }]);
    const result = svc.buildBlock({ bundle, skillDecisionState: null });
    assert.equal(result, null, "null state must produce no block");
  }

  // (b) Undefined state → no block
  {
    const bundle = createBundle([{ id: "skill-marketer", name: "Marketer" }]);
    const result = svc.buildBlock({ bundle, skillDecisionState: undefined });
    assert.equal(result, null, "undefined state must produce no block");
  }

  // (c) Inactive state → no block
  {
    const bundle = createBundle([{ id: "skill-marketer", name: "Marketer" }]);
    const result = svc.buildBlock({ bundle, skillDecisionState: inactiveState });
    assert.equal(result, null, "inactive state must produce no block");
  }

  // (d) Active but no active scenario → no block
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({ bundle, skillDecisionState: activeStateNoScenario });
    assert.equal(result, null, "active state with null activeScenarioKey must produce no block");
  }

  // (e) Happy path: active scenario resolves correctly
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    assert.notEqual(result, null, "active scenario must produce a block");
    assert.equal(result!.cacheRole, "volatile_context");
    assert.equal(result!.volatileKind, "active_scenario");
    assert.equal(result!.role, "user");
    const content = result!.content as string;
    assert.match(content, /## Active Scenario: Instagram Carousel \(Skill: Marketer\)/);
    assert.match(content, /Follow steps in order/);
    assert.match(content, /1\. CALL image_generate/);
    assert.match(content, /Recommended tool: image_generate/);
    assert.match(content, /Guards: Do NOT collapse into one call/);
    assert.match(content, /Exit condition: All 8 slides confirmed\./);
  }

  // (f) Graceful degrade: scenario key in state but skill not in bundle → no block
  {
    const bundle = createBundle([{ id: "skill-other", name: "Other" }]);
    const result = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    assert.equal(result, null, "skill not in bundle must degrade gracefully (no block)");
  }

  // (g) Graceful degrade: scenario was archived between turns → no block
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [] } // scenario removed
    ]);
    const result = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    assert.equal(result, null, "missing scenario must degrade gracefully (no block)");
  }

  // (h) Step without recommendedToolCall — omits the line
  {
    const scenarioNoTool: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "simple_post",
      steps: [
        {
          number: 1,
          directive: "Write the caption.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: []
        }
      ]
    };
    const bundle = createBundle([
      {
        id: "skill-marketer",
        name: "Marketer",
        scenarios: [scenarioNoTool]
      }
    ]);
    const state: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "simple_post"
    };
    const result = svc.buildBlock({ bundle, skillDecisionState: state });
    assert.notEqual(result, null);
    const content = result!.content as string;
    assert.doesNotMatch(content, /Recommended tool:/);
    assert.doesNotMatch(content, /Guards:/);
  }
}
