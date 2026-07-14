import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  RuntimeBundleSkillScenario,
  RuntimeSkillDecisionState,
  RuntimeTodoItem
} from "@persai/runtime-contract";
import { BuildSystemReminderBlocksService } from "../src/modules/turns/build-system-reminder-blocks.service";
import type { ToolBudgetSnapshot } from "../src/modules/turns/tool-budget-policy";

function makeTodo(overrides: Partial<RuntimeTodoItem> & { id: string }): RuntimeTodoItem {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? null,
    content: overrides.content ?? `Task ${overrides.id}`,
    status: overrides.status ?? "pending"
  };
}

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
    effectiveRoleId: "role-test",
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

  // Shared placeholder: a single completed todo silences the open-plan lifecycle
  // branch and now triggers the scenario completion/release reminder. Used by
  // tests that focus on reminder ordering around active scenarios.
  const SILENT_PLAN = [makeTodo({ id: "noise", status: "completed", content: "Done" })];

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
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: SILENT_PLAN
    });
    assert.equal(result.length, 3, "scenario tick + intake + release on completed-only plan");
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
    assert.match(String(result[1]!.content), /Scenario "Instagram Carousel" is active/);
    assert.match(String(result[2]!.content), /skill\(\{action:"release"\}\)/);
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
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: SILENT_PLAN
    });
    assert.equal(result.length, 3);
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
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: SILENT_PLAN
    });
    assert.equal(
      result.length,
      4,
      "scenario tick + image + intake + release when scenario + image + completed-only plan"
    );
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

  // (8) Stable ordering: scenario → image → scenario-plan-intake (suppressed when plan
  //     non-empty) → chat-plan lifecycle → budget reminders (alpha by tool name).
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
      toolBudgetSnapshot: snapshot,
      chatPlanTodos: [
        makeTodo({ id: "p1", status: "in_progress", content: "Draft outline" }),
        makeTodo({ id: "p2", status: "pending", content: "Send draft" })
      ]
    });
    assert.equal(
      result.length,
      5,
      "5 reminders: scenario + image + chat-plan + image_edit + web_search (intake suppressed when plan non-empty)"
    );
    assert.match(String(result[0]!.content), /Active scenario/);
    assert.match(String(result[1]!.content), /Reference image attached/);
    assert.match(String(result[2]!.content), /Active plan task \(in_progress\): "Draft outline"/);
    assert.match(String(result[3]!.content), /image_edit/);
    assert.match(String(result[4]!.content), /web_search/);
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
      toolBudgetSnapshot: snapshot,
      chatPlanTodos: SILENT_PLAN
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
      toolBudgetSnapshot: snapshot,
      chatPlanTodos: SILENT_PLAN
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

  // ADR-125 follow-up: chat-plan lifecycle reminder.

  // (12) Chat-plan lifecycle — `in_progress` row present.
  //
  // This is the main path: when the windowed plan has an in_progress row, the
  // reminder names that row (id + truncated title) and demands the model call
  // `todo_write` complete BEFORE replying to the user, never batching.
  {
    const bundle = createBundle([]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [
        makeTodo({ id: "todo-1", status: "completed", content: "Collect brief" }),
        makeTodo({ id: "todo-2", status: "in_progress", content: "Generate slides" }),
        makeTodo({ id: "todo-3", status: "pending", content: "Send for review" })
      ]
    });
    assert.equal(result.length, 1, "one chat-plan lifecycle reminder");
    const msg = result[0]!;
    assert.equal(msg.cacheRole, "volatile_context");
    assert.equal(msg.volatileKind, "system_reminder");
    assert.match(
      String(msg.content),
      /Active plan task \(in_progress\): "Generate slides" — id todo-2/,
      "names the in_progress row by id + title"
    );
    assert.match(String(msg.content), /BEFORE writing your reply to the user/);
    assert.match(String(msg.content), /Do not batch completions/);
    assert.match(
      String(msg.content),
      /todo_write\(\{action:"complete", id:"todo-2"\}\)/,
      "spells out the exact tool call with the row id"
    );
  }

  // (13) Chat-plan lifecycle — only pending rows, none in_progress.
  //
  // Branch 2: the model must pick the next pending row and switch it to
  // `in_progress` BEFORE substantive work.
  {
    const bundle = createBundle([]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [
        makeTodo({ id: "todo-a", status: "completed", content: "Done already" }),
        makeTodo({ id: "todo-b", status: "pending", content: "Next step" }),
        makeTodo({ id: "todo-c", status: "pending", content: "Then this" })
      ]
    });
    assert.equal(result.length, 1, "one chat-plan reminder when only pending");
    const msg = result[0]!;
    assert.match(
      String(msg.content),
      /Plan has 2 pending items, none in_progress\. Next is "Next step" — id todo-b/,
      "names the first pending row + pending count"
    );
    assert.match(
      String(msg.content),
      /todo_write\(\{action:"update", id:"todo-b", status:"in_progress"\}\)/,
      "spells out the exact update call with the first pending row id"
    );
    assert.match(String(msg.content), /BEFORE substantive work on it/);
    assert.match(String(msg.content), /Only one in_progress sibling per parent/);
  }

  // (14) Chat-plan lifecycle — every row already completed → no reminder.
  //
  // Silence when the plan is finished. The model should not be nudged about
  // a plan that is already closed.
  {
    const bundle = createBundle([]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [
        makeTodo({ id: "todo-x", status: "completed", content: "First" }),
        makeTodo({ id: "todo-y", status: "completed", content: "Second" })
      ]
    });
    assert.equal(result.length, 0, "no reminder when every row is completed");
  }

  // (15) Chat-plan lifecycle — null / undefined / empty todos → no reminder.
  {
    const bundle = createBundle([]);
    const baseParams = {
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT
    };
    assert.equal(svc.buildBlocks({ ...baseParams, chatPlanTodos: null }).length, 0);
    assert.equal(svc.buildBlocks({ ...baseParams, chatPlanTodos: [] }).length, 0);
    assert.equal(svc.buildBlocks(baseParams).length, 0, "absent chatPlanTodos → no reminder");
  }

  // (16) Chat-plan lifecycle — overlong content is truncated for the reminder.
  {
    const bundle = createBundle([]);
    const longContent = "X".repeat(400);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "long-1", status: "in_progress", content: longContent })]
    });
    assert.equal(result.length, 1);
    const msg = result[0]!;
    const titleMatch = /"([^"]+)" — id long-1/.exec(String(msg.content));
    assert.ok(titleMatch !== null, "reminder must contain quoted title");
    const renderedTitle = titleMatch![1]!;
    assert.ok(
      renderedTitle.length <= 140,
      `reminder title must be capped near 140 chars, got ${String(renderedTitle.length)}`
    );
    assert.ok(renderedTitle.endsWith("…"), "long content must end with an ellipsis");
  }

  // (17) Chat-plan lifecycle — works alongside an inactive scenario state.
  //
  // The reminder is independent of the skill/scenario state — it fires purely
  // on the chat plan, even when no skill is engaged.
  {
    const bundle = createBundle([]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "free-1", status: "in_progress", content: "Free task" })]
    });
    assert.equal(result.length, 1, "chat-plan reminder fires even without active scenario");
  }

  // ADR-125 Option A: scenario plan intake reminder.

  // (18) Scenario plan intake — fires when scenario active + plan empty.
  //
  // This is the main motivation for the reminder: after `skill.engage` returns
  // a scenario, tool-catalog PLAN INTAKE guidance alone wasn't enough — the
  // per-turn reminder injects an imperative + the full step list so the model
  // has every input it needs to author the `todo_write({action:"add", …})`
  // call as its very next move.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    });
    assert.equal(
      result.length,
      2,
      "reminder #1 (scenario tick) + reminder #3 (intake) when plan empty + scenario active"
    );
    const tick = result[0]!;
    assert.match(String(tick.content), /Active scenario: Instagram Carousel/);
    const intake = result[1]!;
    assert.equal(intake.cacheRole, "volatile_context");
    assert.equal(intake.volatileKind, "system_reminder");
    assert.match(
      String(intake.content),
      /Scenario "Instagram Carousel" is active but the chat plan is empty/
    );
    assert.match(String(intake.content), /VERY NEXT action MUST be a single todo_write/);
    assert.match(String(intake.content), /action:"add"/);
    assert.match(String(intake.content), /first item status:"in_progress"/);
    assert.match(
      String(intake.content),
      /BEFORE replying to the user and BEFORE any other tool call/
    );
    assert.match(String(intake.content), /The scenario IS the plan/);
    // All three CAROUSEL_SCENARIO steps must be rendered in order.
    assert.match(String(intake.content), /1\. Collect brief from user\./);
    assert.match(String(intake.content), /2\. Generate carousel images\./);
    assert.match(String(intake.content), /3\. Release scenario\./);
    // Example shape uses the first step's derived title.
    assert.match(
      String(intake.content),
      /Example shape: todo_write\(\{action:"add", items:\[\{content:"Collect brief from user\.", status:"in_progress"\}/
    );
  }

  // (19) Scenario plan intake — null chatPlanTodos is treated as empty.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: null
    });
    assert.equal(result.length, 2, "intake reminder fires when chatPlanTodos is null");
    assert.match(String(result[1]!.content), /chat plan is empty/);
  }

  // (20) Scenario plan intake — absent chatPlanTodos is treated as empty.
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
    assert.equal(result.length, 2, "intake reminder fires when chatPlanTodos is absent");
  }

  // (21) Scenario plan intake — suppressed when plan already has an in_progress row.
  //
  // The intake nudge is suppressed only by open rows. Once an in_progress row
  // exists, the chat-plan lifecycle reminder takes over.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [
        makeTodo({ id: "existing-1", status: "in_progress", content: "Already started" })
      ]
    });
    assert.equal(result.length, 2, "scenario tick + chat-plan lifecycle (no intake)");
    assert.match(String(result[0]!.content), /Active scenario/);
    assert.match(String(result[1]!.content), /Active plan task \(in_progress\)/);
    for (const msg of result) {
      assert.doesNotMatch(
        String(msg.content),
        /VERY NEXT action MUST be a single todo_write/,
        "intake reminder must NOT fire when plan has an in_progress row"
      );
    }
  }

  // (22) Scenario plan intake — suppressed when scenario is inactive.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: INACTIVE_STATE,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    });
    assert.equal(result.length, 0, "no intake reminder when scenario inactive");
  }

  // (23) Scenario plan intake — suppressed when scenario active but key not found in bundle.
  //
  // Mirrors reminder #1's graceful-degradation behavior so we never reference a
  // scenario the model cannot actually see.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer" } // no scenarios
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    });
    assert.equal(result.length, 0, "no intake reminder when scenario unresolvable in bundle");
  }

  // (24) Scenario plan intake — long directives are truncated for the step list.
  {
    const longScenario: RuntimeBundleSkillScenario = {
      key: "long_scenario",
      displayName: "Long Scenario",
      description: "Long.",
      iconEmoji: null,
      intentExamples: [],
      steps: [
        {
          number: 1,
          directive: `${"verbose ".repeat(40)}finally`.trim(), // ~320+ chars, no early sentence terminator
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: []
        }
      ],
      recommendedTools: [],
      exitCondition: "done"
    };
    const longState: RuntimeSkillDecisionState = {
      ...ACTIVE_STATE_WITH_SCENARIO,
      activeScenarioKey: "long_scenario",
      activeScenarioDisplayName: "Long Scenario"
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [longScenario] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: longState,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    });
    assert.equal(result.length, 2);
    const intake = result[1]!;
    const titleMatch = /1\. ([^\n]+)/.exec(String(intake.content));
    assert.ok(titleMatch !== null, "step title must be on its own line");
    const renderedTitle = titleMatch![1]!;
    assert.ok(
      renderedTitle.length <= 80,
      `step title must be capped near 80 chars, got ${String(renderedTitle.length)}`
    );
    assert.ok(renderedTitle.endsWith("…"), "long directive must end with an ellipsis");
  }

  // (25) Scenario plan intake — many steps get a “…and N more” trailer.
  {
    const manyStepScenario: RuntimeBundleSkillScenario = {
      key: "many_steps",
      displayName: "Many Steps",
      description: "Many.",
      iconEmoji: null,
      intentExamples: [],
      steps: Array.from({ length: 15 }, (_, i) => ({
        number: i + 1,
        directive: `Step ${String(i + 1)} directive.`,
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: []
      })),
      recommendedTools: [],
      exitCondition: "done"
    };
    const manyState: RuntimeSkillDecisionState = {
      ...ACTIVE_STATE_WITH_SCENARIO,
      activeScenarioKey: "many_steps",
      activeScenarioDisplayName: "Many Steps"
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [manyStepScenario] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: manyState,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    });
    assert.equal(result.length, 2);
    const intake = result[1]!;
    assert.match(String(intake.content), /1\. Step 1 directive\./);
    assert.match(String(intake.content), /12\. Step 12 directive\./);
    assert.doesNotMatch(String(intake.content), /13\. Step 13/);
    assert.match(
      String(intake.content),
      /…and 3 more — include every step in the add call\./,
      "trailer must mention the remaining step count"
    );
  }

  // (26) Scenario plan intake — byte stability: same input → identical output.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const params = {
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    };
    const first = svc.buildBlocks(params);
    const second = svc.buildBlocks(params);
    assert.deepEqual(
      first.map((m) => m.content),
      second.map((m) => m.content),
      "byte stability across invocations"
    );
  }

  // (27) Cut 1 — intake fires when active scenario has only completed rows from a previous engagement.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "done-old", status: "completed", content: "Old run done" })]
    });
    assert.equal(result.length, 3, "scenario tick + intake + release on completed-only window");
    assert.match(String(result[1]!.content), /VERY NEXT action MUST be a single todo_write/);
    assert.match(String(result[2]!.content), /skill\(\{action:"release"\}\)/);
  }

  // (28) Cut 1 control — intake is still suppressed when at least one pending row exists.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "pending-1", status: "pending", content: "Still open" })]
    });
    assert.equal(result.length, 2, "scenario tick + pending lifecycle reminder only");
    assert.doesNotMatch(String(result.map((m) => m.content).join("\n")), /chat plan is empty/);
    assert.match(String(result[1]!.content), /Plan has 1 pending item/);
  }

  // (29) Cut 1 control — intake is still suppressed when at least one in_progress row exists.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [
        makeTodo({ id: "progress-1", status: "in_progress", content: "Still working" })
      ]
    });
    assert.equal(result.length, 2, "scenario tick + in_progress lifecycle reminder only");
    assert.doesNotMatch(String(result.map((m) => m.content).join("\n")), /chat plan is empty/);
    assert.match(String(result[1]!.content), /Active plan task \(in_progress\)/);
  }

  // (30) Cut 2 — release reminder fires when active scenario has an all-completed window.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [
        makeTodo({ id: "done-1", status: "completed", content: "First" }),
        makeTodo({ id: "done-2", status: "completed", content: "Second" })
      ]
    });
    const release = result.at(-1)!;
    assert.match(String(release.content), /exit condition: All slides confirmed\./);
    assert.match(String(release.content), /fully completed \(2 rows\)/);
    assert.match(String(release.content), /skill\(\{action:"release"\}\)/);
  }

  // (31) Cut 2 control — release reminder is absent when at least one row is open.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const pendingResult = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "pending-open", status: "pending", content: "Open" })]
    });
    const inProgressResult = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "progress-open", status: "in_progress", content: "Open" })]
    });
    assert.doesNotMatch(String(pendingResult.map((m) => m.content).join("\n")), /action:"release"/);
    assert.doesNotMatch(
      String(inProgressResult.map((m) => m.content).join("\n")),
      /action:"release"/
    );
  }

  // (32) Cut 2 control — release reminder is absent when the plan is empty; intake fires instead.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    });
    assert.equal(result.length, 2, "scenario tick + intake, no release on empty plan");
    assert.match(String(result[1]!.content), /chat plan is empty/);
    assert.doesNotMatch(String(result.map((m) => m.content).join("\n")), /action:"release"/);
  }

  // (33) Cut 2 truncation — overlong exit conditions are capped with an ellipsis.
  {
    const longExitScenario: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "long_exit",
      displayName: "Long Exit",
      exitCondition: "x".repeat(320)
    };
    const longExitState: RuntimeSkillDecisionState = {
      ...ACTIVE_STATE_WITH_SCENARIO,
      activeScenarioKey: "long_exit",
      activeScenarioDisplayName: "Long Exit"
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [longExitScenario] }
    ]);
    const result = svc.buildBlocks({
      bundle,
      skillDecisionState: longExitState,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "done-long-exit", status: "completed", content: "Done" })]
    });
    const release = result.at(-1)!;
    assert.match(String(release.content), new RegExp(`exit condition: ${"x".repeat(299)}…\\.`));
    assert.doesNotMatch(String(release.content), new RegExp("x".repeat(320)));
  }

  // (34) Ordering — empty-plan intake and all-completed release are distinguishable.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const emptyResult = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: []
    });
    const completedResult = svc.buildBlocks({
      bundle,
      skillDecisionState: ACTIVE_STATE_WITH_SCENARIO,
      currentTurnHasUserAttachedImage: false,
      toolBudgetSnapshot: EMPTY_SNAPSHOT,
      chatPlanTodos: [makeTodo({ id: "done-order", status: "completed", content: "Done" })]
    });
    assert.match(String(emptyResult[1]!.content), /chat plan is empty/);
    assert.doesNotMatch(String(emptyResult.map((m) => m.content).join("\n")), /action:"release"/);
    assert.match(String(completedResult[1]!.content), /chat plan is empty/);
    assert.match(String(completedResult[2]!.content), /action:"release"/);
  }
}

void runBuildSystemReminderBlocksServiceTest();
