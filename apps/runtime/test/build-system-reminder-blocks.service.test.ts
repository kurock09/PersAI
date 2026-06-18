import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  RuntimeBundleSkillScenario,
  RuntimeSkillDecisionState
} from "@persai/runtime-contract";
import { BuildSystemReminderBlocksService } from "../src/modules/turns/build-system-reminder-blocks.service";
import type { ToolBudgetSnapshot } from "../src/modules/turns/tool-budget-policy";

// ---------------------------------------------------------------------------
// Bundle factory
// ---------------------------------------------------------------------------

const CAROUSEL_SCENARIO: RuntimeBundleSkillScenario = {
  key: "instagram_carousel",
  displayName: "Instagram Carousel",
  description: "Create an 8-slide Instagram carousel.",
  iconEmoji: "📸",
  intentExamples: ["carousel post"],
  steps: [
    {
      number: 1,
      directive: "Collect brief from user.",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: ["skip brief collection"]
    },
    {
      number: 2,
      directive: "Generate carousel images.",
      recommendedToolCall: "image_generate",
      mayBeSkippedIf: null,
      negativeGuards: []
    },
    {
      number: 3,
      directive: "Release scenario.",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: []
    }
  ],
  recommendedTools: ["image_generate"],
  exitCondition: "All slides confirmed."
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
              body: "",
              guardrails: [],
              examples: [],
              ...(s.scenarios !== undefined ? { scenarios: s.scenarios } : {})
            }))
          }
        }
      : {})
  }).bundle;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

const ACTIVE_STATE_WITH_SCENARIO: RuntimeSkillDecisionState = {
  status: "active",
  activeSkillId: "skill-marketer",
  activeSkillName: "Marketer",
  activeScenarioKey: "instagram_carousel",
  activeScenarioDisplayName: "Instagram Carousel",
  topicSummary: null
};

const ACTIVE_STATE_NO_SCENARIO: RuntimeSkillDecisionState = {
  status: "active",
  activeSkillId: "skill-marketer",
  activeSkillName: "Marketer",
  activeScenarioKey: null,
  activeScenarioDisplayName: null,
  topicSummary: null
};

const INACTIVE_STATE: RuntimeSkillDecisionState = {
  status: "inactive",
  activeSkillId: null,
  activeSkillName: null,
  activeScenarioKey: null,
  activeScenarioDisplayName: null,
  topicSummary: null
};

const EMPTY_SNAPSHOT: ToolBudgetSnapshot = [];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

export async function runBuildSystemReminderBlocksServiceTest(): Promise<void> {
  const svc = new BuildSystemReminderBlocksService();

  // (1) Returns empty array when no scenario active, no image, no budget pressure.
  {
    const bundle = createBundle([{ id: "skill-marketer", name: "Marketer" }]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    });
    assert.equal(result.length, 0, "no reminders when scenario inactive, no image, empty budget");
  }

  // (1b) Null skillDecisionState → no reminders.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: null,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    });
    assert.equal(result.length, 0, "null skillDecisionState → no reminders");
  }

  // (2) Reminder #1 — scenario active, uses 'N steps total' variant (activeStepNumber unavailable
  //     in RuntimeSkillDecisionState; step-number variant deferred to a future contract extension).
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    });
    assert.equal(result.length, 1, "one reminder when scenario active");
    const msg = result[0]!;
    assert.equal(msg.volatileKind, "system_reminder");
    assert.equal(msg.cacheRole, "volatile_context");
    assert.equal(msg.role, "user");
    assert.match(
      String(msg.content),
      /Active scenario: Instagram Carousel, 3 steps total/,
      "reminder #1 uses N steps total format"
    );
    assert.match(String(msg.content), /Follow steps in order/);
    assert.match(String(msg.content), /Negative guards from each step apply/);
  }

  // (3) Reminder #1 — 'N steps total' format carries the correct step count.
  {
    const twoStepScenario: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "two_step",
      displayName: "Two-Step Flow",
      steps: CAROUSEL_SCENARIO.steps.slice(0, 2)
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [twoStepScenario] }
    ]);
    const twoStepState: RuntimeSkillDecisionState = {
      ...ACTIVE_STATE_WITH_SCENARIO,
      activeScenarioKey: "two_step",
      activeScenarioDisplayName: "Two-Step Flow"
    };
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: twoStepState,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    });
    assert.equal(result.length, 1);
    assert.match(String(result[0]!.content), /Two-Step Flow, 2 steps total/);
  }

  // (4) Reminder #2 — emitted only when scenario is active AND image is attached.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: true,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    });
    assert.equal(result.length, 2, "reminder #1 + reminder #2 when scenario + image");
    const imageReminder = result[1]!;
    assert.equal(imageReminder.volatileKind, "system_reminder");
    assert.match(String(imageReminder.content), /Reference image attached this turn/);
    assert.match(String(imageReminder.content), /Verify scenario step/);
  }

  // (5) Does NOT emit reminder #2 when image attached but no scenario.
  {
    const bundle = createBundle([{ id: "skill-marketer", name: "Marketer" }]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_NO_SCENARIO,
      currentTurnHasUserAttachedImage: true,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    });
    assert.equal(result.length, 0, "no image reminder when scenario not active (even with image)");
  }

  // (6) Reminder #3 — emits one message per tool at ≥ 80% cap.
  {
    const bundle = createBundle([]);
    const snapshot80: ToolBudgetSnapshot = [
      { toolName: "image_edit", perToolCap: 5, perToolUsed: 4 }, // 80%
      { toolName: "web_search", perToolCap: 3, perToolUsed: 3 }, // 100%
      { toolName: "web_fetch", perToolCap: 5, perToolUsed: 2 } // 40% — below threshold
    ];
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: snapshot80
    });
    assert.equal(result.length, 2, "2 budget reminders at 80%+ (image_edit + web_search)");
    const names = result.map((m) => {
      const match = /^(\w+) tool has/.exec(String(m.content));
      return match?.[1] ?? "";
    });
    assert.deepEqual(names, ["image_edit", "web_search"], "alphabetical order");
    assert.match(String(result[0]!.content), /image_edit tool has 1 of 5 invocations remaining/);
    assert.match(String(result[1]!.content), /web_search tool has 0 of 3 invocations remaining/);
  }

  // (7) Does NOT emit reminder #3 when budget below 80%.
  {
    const bundle = createBundle([]);
    const snapshotLow: ToolBudgetSnapshot = [
      { toolName: "image_edit", perToolCap: 5, perToolUsed: 3 }, // 60% — below
      { toolName: "web_search", perToolCap: 3, perToolUsed: 2 } // 66.7% — below
    ];
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: snapshotLow
    });
    assert.equal(result.length, 0, "no budget reminders when all tools < 80%");
  }

  // (8) Stable ordering: scenario tick → image → budget reminders (alpha by tool name).
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const snapshot: ToolBudgetSnapshot = [
      { toolName: "web_search", perToolCap: 3, perToolUsed: 3 }, // 100%
      { toolName: "image_edit", perToolCap: 5, perToolUsed: 4 } // 80%
    ];
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: true,
      toolBudgetSnapshot: snapshot
    });
    assert.equal(
      result.length,
      4,
      "4 reminders: #1 scenario + #2 image + #3 image_edit + #3 web_search"
    );
    assert.match(String(result[0]!.content), /Active scenario/);
    assert.match(String(result[1]!.content), /Reference image attached/);
    assert.match(String(result[2]!.content), /image_edit/);
    assert.match(String(result[3]!.content), /web_search/);
  }

  // (9) Every returned message has cacheRole: "volatile_context" and volatileKind: "system_reminder".
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const snapshot: ToolBudgetSnapshot = [
      { toolName: "image_edit", perToolCap: 5, perToolUsed: 4 }
    ];
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: true,
      toolBudgetSnapshot: snapshot
    });
    for (const msg of result) {
      assert.equal(msg.cacheRole, "volatile_context", "cacheRole must be volatile_context");
      assert.equal(msg.volatileKind, "system_reminder", "volatileKind must be system_reminder");
    }
  }

  // (10) Byte stability: same input → same outputs.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const snapshot: ToolBudgetSnapshot = [
      { toolName: "image_edit", perToolCap: 5, perToolUsed: 4 }
    ];
    const params = {
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: snapshot
    };
    const first = svc.buildBlocks(params);
    const second = svc.buildBlocks(params);
    assert.deepEqual(
      first.map((m) => m.content),
      second.map((m) => m.content),
      "byte stability: same input produces identical outputs"
    );
  }

  // (11) Scenario not found in bundle → no reminder #1 emitted (graceful degradation).
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer" } // no scenarios
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    });
    assert.equal(
      result.length,
      0,
      "no reminder when scenario key not found in bundle (graceful degradation)"
    );
  }
}

void runBuildSystemReminderBlocksServiceTest();
