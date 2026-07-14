import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  RuntimeBundleSkillScenario,
  RuntimeSkillDecisionState,
  RuntimeTodoItem
} from "@persai/runtime-contract";
import {
  BuildActiveScenarioBlockService,
  resolveCurrentStepIndex
} from "../src/modules/turns/build-active-scenario-block.service";

function makeTodo(overrides: Partial<RuntimeTodoItem> & { id: string }): RuntimeTodoItem {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? null,
    content: overrides.content ?? `Task ${overrides.id}`,
    status: overrides.status ?? "pending"
  };
}

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

const activeStateWithScenario: RuntimeSkillDecisionState = {
  status: "active",
  activeSkillId: "skill-marketer",
  activeSkillName: "Marketer",
  activeScenarioKey: "instagram_carousel",
  activeScenarioDisplayName: "Instagram Carousel",
  topicSummary: null
};

const activeStateNoScenario: RuntimeSkillDecisionState = {
  status: "active",
  activeSkillId: "skill-marketer",
  activeSkillName: "Marketer",
  activeScenarioKey: null,
  activeScenarioDisplayName: null,
  topicSummary: null
};

const inactiveState: RuntimeSkillDecisionState = {
  status: "inactive",
  activeSkillId: null,
  activeSkillName: null,
  activeScenarioKey: null,
  activeScenarioDisplayName: null,
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

  // (e) Happy path: active scenario resolves correctly — XML format
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
    // Summary line (human-readable inside the outer wrapper tag)
    assert.match(content, /Active: Instagram Carousel \(Skill: Marketer\)/);
    // XML step structure
    assert.match(content, /<step number="1">/);
    assert.match(content, /<\/step>/);
    assert.match(
      content,
      /<directive>CALL image_generate with outputMode=series, count=8<\/directive>/
    );
    // recommended_tool_call present for step 1
    assert.match(content, /<recommended_tool_call>image_generate<\/recommended_tool_call>/);
    // negative_guards present for step 1
    assert.match(content, /<guard>Do NOT collapse into one call<\/guard>/);
    // exit_condition present
    assert.match(content, /<exit_condition>All 8 slides confirmed\.<\/exit_condition>/);
    // No Markdown headings
    assert.doesNotMatch(content, /## Active Scenario/);
    assert.doesNotMatch(content, /Follow steps in order/);
    assert.doesNotMatch(content, /Recommended tool:/);
    assert.doesNotMatch(content, /Guards:/);
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

  // (h) Step without recommendedToolCall — tag absent (not empty)
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
    assert.doesNotMatch(content, /<recommended_tool_call>/);
    assert.doesNotMatch(content, /<negative_guards>/);
  }

  // (i) ADR-119 Slice 4 — XML step number tag
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    assert.notEqual(result, null);
    const content = result!.content as string;
    assert.match(content, /<step number="1">/, "must emit <step number=N> opening tag");
    assert.match(content, /<\/step>/, "must emit </step> closing tag");
  }

  // (j) recommendedToolCall present → tag present; null → tag absent
  {
    const scenarioWithTool: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "with_tool",
      steps: [
        {
          number: 1,
          directive: "Do the thing.",
          recommendedToolCall: "image_edit",
          mayBeSkippedIf: null,
          negativeGuards: []
        }
      ]
    };
    const scenarioNoTool: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "no_tool",
      steps: [
        {
          number: 1,
          directive: "Do the other thing.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: []
        }
      ]
    };
    const bundleWith = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioWithTool] }
    ]);
    const bundleNo = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioNoTool] }
    ]);
    const stateWith: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "with_tool"
    };
    const stateNo: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "no_tool"
    };

    const rWith = svc.buildBlock({ bundle: bundleWith, skillDecisionState: stateWith });
    assert.match(
      rWith!.content as string,
      /<recommended_tool_call>image_edit<\/recommended_tool_call>/,
      "recommendedToolCall present → tag present"
    );

    const rNo = svc.buildBlock({ bundle: bundleNo, skillDecisionState: stateNo });
    assert.doesNotMatch(
      rNo!.content as string,
      /<recommended_tool_call>/,
      "recommendedToolCall null → tag absent"
    );
  }

  // (k) expectedUserResponse present → tag present; null/absent → tag absent
  {
    const scenarioWithEUR: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "with_eur",
      steps: [
        {
          number: 1,
          directive: "Ask for brief.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: [],
          expectedUserResponse: "4 brief items",
          nextStepTrigger: null,
          recoveryGuidance: null
        }
      ]
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioWithEUR] }
    ]);
    const state: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "with_eur"
    };
    const result = svc.buildBlock({ bundle, skillDecisionState: state });
    assert.notEqual(result, null);
    assert.match(
      result!.content as string,
      /<expected_user_response>4 brief items<\/expected_user_response>/,
      "expectedUserResponse present → tag present with correct content"
    );
  }

  // (l) expectedUserResponse null → tag absent
  {
    const scenarioNoEUR: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "no_eur",
      steps: [
        {
          number: 1,
          directive: "No expected response.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: [],
          expectedUserResponse: null,
          nextStepTrigger: null,
          recoveryGuidance: null
        }
      ]
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioNoEUR] }
    ]);
    const state: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "no_eur"
    };
    const result = svc.buildBlock({ bundle, skillDecisionState: state });
    assert.doesNotMatch(
      result!.content as string,
      /<expected_user_response>/,
      "expectedUserResponse null → tag absent"
    );
  }

  // (m) nextStepTrigger present → tag present; null → tag absent
  {
    const scenarioWithNST: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "with_nst",
      steps: [
        {
          number: 1,
          directive: "Do something.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: [],
          expectedUserResponse: null,
          nextStepTrigger: "All items collected.",
          recoveryGuidance: null
        }
      ]
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioWithNST] }
    ]);
    const state: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "with_nst"
    };
    const result = svc.buildBlock({ bundle, skillDecisionState: state });
    assert.match(
      result!.content as string,
      /<next_step_trigger>All items collected\.<\/next_step_trigger>/,
      "nextStepTrigger present → tag present"
    );

    const scenarioNoNST: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "no_nst",
      steps: [
        {
          number: 1,
          directive: "Do something else.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: [],
          expectedUserResponse: null,
          nextStepTrigger: null,
          recoveryGuidance: null
        }
      ]
    };
    const bundleNo = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioNoNST] }
    ]);
    const stateNo: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "no_nst"
    };
    const resultNo = svc.buildBlock({ bundle: bundleNo, skillDecisionState: stateNo });
    assert.doesNotMatch(
      resultNo!.content as string,
      /<next_step_trigger>/,
      "nextStepTrigger null → tag absent"
    );
  }

  // (n) recoveryGuidance present → tag present; null → tag absent
  {
    const scenarioWithRG: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "with_rg",
      steps: [
        {
          number: 1,
          directive: "Do something.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: [],
          expectedUserResponse: null,
          nextStepTrigger: null,
          recoveryGuidance: "Ask the user to clarify."
        }
      ]
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioWithRG] }
    ]);
    const state: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "with_rg"
    };
    const result = svc.buildBlock({ bundle, skillDecisionState: state });
    assert.match(
      result!.content as string,
      /<recovery_guidance>Ask the user to clarify\.<\/recovery_guidance>/,
      "recoveryGuidance present → tag present"
    );

    const scenarioNoRG: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "no_rg",
      steps: [
        {
          number: 1,
          directive: "Do something else.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: [],
          expectedUserResponse: null,
          nextStepTrigger: null,
          recoveryGuidance: null
        }
      ]
    };
    const bundleNo = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioNoRG] }
    ]);
    const stateNo: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "no_rg"
    };
    const resultNo = svc.buildBlock({ bundle: bundleNo, skillDecisionState: stateNo });
    assert.doesNotMatch(
      resultNo!.content as string,
      /<recovery_guidance>/,
      "recoveryGuidance null → tag absent"
    );
  }

  // (o) negativeGuards empty → <negative_guards> tag absent entirely
  {
    const scenarioNoGuards: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "no_guards",
      steps: [
        {
          number: 1,
          directive: "No guards here.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: []
        }
      ]
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioNoGuards] }
    ]);
    const state: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "no_guards"
    };
    const result = svc.buildBlock({ bundle, skillDecisionState: state });
    assert.doesNotMatch(
      result!.content as string,
      /<negative_guards>/,
      "empty negativeGuards → <negative_guards> tag absent"
    );
  }

  // (p) negativeGuards non-empty → <guard>Do NOT X</guard> format exactly
  {
    const scenarioWithGuards: RuntimeBundleSkillScenario = {
      ...CAROUSEL_SCENARIO,
      key: "with_guards",
      steps: [
        {
          number: 1,
          directive: "With guards.",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: ["skip this step", "call image_edit yet"]
        }
      ]
    };
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [scenarioWithGuards] }
    ]);
    const state: RuntimeSkillDecisionState = {
      ...activeStateWithScenario,
      activeScenarioKey: "with_guards"
    };
    const result = svc.buildBlock({ bundle, skillDecisionState: state });
    assert.match(
      result!.content as string,
      /<guard>Do NOT skip this step<\/guard>/,
      "first guard rendered as <guard>Do NOT X</guard>"
    );
    assert.match(
      result!.content as string,
      /<guard>Do NOT call image_edit yet<\/guard>/,
      "second guard rendered as <guard>Do NOT X</guard>"
    );
  }

  // (q) exit_condition tag at end
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    assert.match(
      result!.content as string,
      /<exit_condition>All 8 slides confirmed\.<\/exit_condition>/,
      "output ends with <exit_condition> tag"
    );
  }

  // (r) Byte-stability: same input → identical string
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const r1 = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    const r2 = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    assert.equal(r1!.content, r2!.content, "byte-stability: same input → identical output");
  }

  // ADR-130 Slice 4 — the block owns only the CURRENT step + exit condition.

  // (s) No chat plan (pre-seed) → renders step 1 only; step 2 body is NOT repeated.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({ bundle, skillDecisionState: activeStateWithScenario });
    const content = result!.content as string;
    assert.match(content, /<step number="1">/, "pre-seed → current step is step 1");
    assert.match(
      content,
      /<directive>CALL image_generate with outputMode=series, count=8<\/directive>/
    );
    // Step 2's body must NOT appear (single-owner: chat plan / intake own the list).
    assert.doesNotMatch(content, /<step number="2">/, "step 2 body must not be repeated here");
    assert.doesNotMatch(content, /Call skill\(\{ action: release \}\) when done\./);
    // exit condition is still owned by this block.
    assert.match(content, /<exit_condition>All 8 slides confirmed\.<\/exit_condition>/);
  }

  // (t) in_progress row at index 1 → renders step 2 only; step 1 body absent.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({
      bundle,
      skillDecisionState: activeStateWithScenario,
      chatPlanTodos: [
        makeTodo({ id: "t1", status: "completed", content: "Generate slides" }),
        makeTodo({ id: "t2", status: "in_progress", content: "Release" })
      ]
    });
    const content = result!.content as string;
    assert.match(content, /<step number="2">/, "in_progress index 1 → current step is step 2");
    assert.match(content, /Call skill\(\{ action: release \}\) when done\./);
    assert.doesNotMatch(content, /<step number="1">/, "step 1 body must not be repeated here");
    assert.doesNotMatch(content, /CALL image_generate with outputMode=series/);
  }

  // (u) No in_progress row but one completed → completed-count fallback → step 2.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({
      bundle,
      skillDecisionState: activeStateWithScenario,
      chatPlanTodos: [
        makeTodo({ id: "t1", status: "completed", content: "Generate slides" }),
        makeTodo({ id: "t2", status: "pending", content: "Release" })
      ]
    });
    const content = result!.content as string;
    assert.match(content, /<step number="2">/, "completed-count fallback → step 2");
    assert.doesNotMatch(content, /<step number="1">/);
  }

  // (v) Deviating plan (in_progress index beyond step range) → clamped to last step.
  {
    const bundle = createBundle([
      { id: "skill-marketer", name: "Marketer", scenarios: [CAROUSEL_SCENARIO] }
    ]);
    const result = svc.buildBlock({
      bundle,
      skillDecisionState: activeStateWithScenario,
      chatPlanTodos: [
        makeTodo({ id: "a", status: "completed" }),
        makeTodo({ id: "b", status: "completed" }),
        makeTodo({ id: "c", status: "completed" }),
        makeTodo({ id: "d", status: "in_progress" })
      ]
    });
    const content = result!.content as string;
    assert.match(content, /<step number="2">/, "out-of-range current step clamps to last step");
    assert.doesNotMatch(content, /<step number="1">/);
  }

  // (w) resolveCurrentStepIndex unit coverage.
  {
    assert.equal(resolveCurrentStepIndex(0, null), 0, "no steps → 0");
    assert.equal(resolveCurrentStepIndex(3, null), 0, "null todos → step 1");
    assert.equal(resolveCurrentStepIndex(3, []), 0, "empty todos → step 1");
    assert.equal(
      resolveCurrentStepIndex(3, [
        makeTodo({ id: "1", status: "completed" }),
        makeTodo({ id: "2", status: "in_progress" }),
        makeTodo({ id: "3", status: "pending" })
      ]),
      1,
      "in_progress at index 1 → 1"
    );
    assert.equal(
      resolveCurrentStepIndex(3, [
        makeTodo({ id: "1", status: "completed" }),
        makeTodo({ id: "2", status: "completed" }),
        makeTodo({ id: "3", status: "pending" })
      ]),
      2,
      "two completed, none in_progress → 2"
    );
    assert.equal(
      resolveCurrentStepIndex(2, [
        makeTodo({ id: "1", status: "completed" }),
        makeTodo({ id: "2", status: "completed" }),
        makeTodo({ id: "3", status: "completed" })
      ]),
      1,
      "completed count beyond range clamps to last step"
    );
    // Child rows are ignored in favour of top-level ordering.
    assert.equal(
      resolveCurrentStepIndex(3, [
        makeTodo({ id: "p1", status: "completed" }),
        makeTodo({ id: "p2", status: "in_progress" }),
        makeTodo({ id: "c1", parentId: "p2", status: "pending" })
      ]),
      1,
      "top-level in_progress index wins over nested rows"
    );
  }
}
