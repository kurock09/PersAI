import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayToolCall, RuntimeBundleSkillScenario } from "@persai/runtime-contract";
import type { PersaiInternalApiClientService } from "../src/modules/turns/persai-internal-api.client.service";
import {
  RuntimeSkillToolService,
  type RuntimeSkillEngageInstruction,
  type RuntimeSkillEngageScenario
} from "../src/modules/turns/runtime-skill-tool.service";

const INSTAGRAM_CAROUSEL_SCENARIO: RuntimeBundleSkillScenario = {
  key: "instagram_carousel",
  displayName: "Instagram Carousel",
  description: "Create an Instagram carousel post.",
  iconEmoji: "📸",
  intentExamples: ["carousel", "instagram post"],
  steps: [
    {
      number: 1,
      directive: "CALL image_generate with outputMode=series, count=8",
      recommendedToolCall: "image_generate",
      mayBeSkippedIf: null,
      negativeGuards: ["Do not collapse into one call"]
    }
  ],
  recommendedTools: ["image_generate"],
  exitCondition: "All 8 slides are confirmed and the user is satisfied.",
  guardrails: ["Keep the claims supportable."],
  examples: ["Create an 8-slide launch carousel."],
  firstStepPreview: "Collect the brief before generating assets."
};

function createBundle(opts?: {
  effectiveRoleId?: string;
  enabledSkills?: Array<{
    id: string;
    name: string;
    description?: string | null;
    whenToUse?: string | null;
    category?: string;
    tags?: string[];
    body?: string;
    guardrails?: string[];
    examples?: string[];
    scenarios?: RuntimeBundleSkillScenario[];
  }>;
}) {
  const enabledSkills = (opts?.enabledSkills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    whenToUse: s.whenToUse ?? null,
    category: s.category ?? "general",
    tags: s.tags ?? [],
    body: s.body ?? "",
    guardrails: s.guardrails ?? [],
    examples: s.examples ?? [],
    ...(s.scenarios !== undefined ? { scenarios: s.scenarios } : {})
  }));
  return compileAssistantRuntimeBundle({
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
      toolPolicies: [
        {
          toolCode: "skill",
          displayName: "Skill",
          description: "Engage or release a Skill.",
          usageGuidance: null,
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        }
      ],
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
    effectiveRoleId: opts?.effectiveRoleId ?? "role-test",
    ...(enabledSkills.length > 0 ? { skills: { enabled: enabledSkills } } : {})
  }).bundle;
}

function createToolCall(args: Record<string, unknown>): ProviderGatewayToolCall {
  return { id: "tc-skill-1", name: "skill", arguments: args };
}

const webConversation = {
  assistantId: "assistant-1",
  workspaceId: "workspace-1",
  channel: "web" as const,
  externalThreadKey: "thread-1",
  externalUserKey: "user-1",
  mode: "direct" as const
};

class FakeInternalApi {
  callOrder: string[] = [];
  skillStateCalls: Array<Record<string, unknown>> = [];
  skillStateResult: {
    applied: boolean;
    action: "engaged" | "released" | "stale";
    code: string | null;
    message: string | null;
    skillId: string;
    skillDisplayName: string;
    previousSkillId: string | null;
  } = {
    applied: true,
    action: "engaged",
    code: null,
    message: null,
    skillId: "skill-finance",
    skillDisplayName: "Finance",
    previousSkillId: null
  };
  skillStateError: Error | null = null;

  async updateSkillState(input: Record<string, unknown>) {
    this.callOrder.push("updateSkillState");
    this.skillStateCalls.push(input);
    if (this.skillStateError !== null) {
      throw this.skillStateError;
    }
    if (input.action === "release" && this.skillStateResult.action === "engaged") {
      return { ...this.skillStateResult, action: "released" as const };
    }
    return this.skillStateResult;
  }
}

export async function runRuntimeSkillToolServiceTest(): Promise<void> {
  const internalClientSource = readFileSync(
    join(process.cwd(), "src/modules/turns/persai-internal-api.client.service.ts"),
    "utf8"
  );
  assert.match(internalClientSource, /typeof payload\.applied === "boolean"/);
  assert.doesNotMatch(internalClientSource, /payload\.applied !== false/);
  const bundleWithSkill = createBundle({
    effectiveRoleId: "role-1",
    enabledSkills: [
      {
        id: "skill-finance",
        name: "Finance",
        body: "Finance body content.",
        guardrails: ["Do not guarantee returns."],
        examples: ["Explain the tax rule."]
      }
    ]
  });
  const bundleWithSkillAndScenarios = createBundle({
    effectiveRoleId: "role-2",
    enabledSkills: [
      {
        id: "skill-marketer",
        name: "Marketer",
        description: "Marketing strategy and campaign planning.",
        whenToUse: "Use for campaigns, launches, and social posts.",
        category: "work",
        tags: ["marketing", "campaigns"],
        body: "Marketer body content.",
        guardrails: ["No unsupported claims."],
        examples: ["Describe the campaign."],
        scenarios: [INSTAGRAM_CAROUSEL_SCENARIO]
      }
    ]
  });
  const bundleEmpty = createBundle({ enabledSkills: [] });

  // (a0) Read-only list action exposes bounded enabled-skill catalog detail without side effects.
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({ action: "list" }),
      conversation: webConversation,
      requestId: "req-list"
    });
    const payload = result.payload as {
      action: "listed";
      category: string | null;
      skills: Array<{
        id: string;
        displayName: string;
        summary: string | null;
        whenToUse: string | null;
        category: string;
        tags: string[];
        scenarios: Array<{ key: string; name: string }>;
      }>;
      truncated: boolean;
    };
    assert.equal(payload.action, "listed");
    assert.equal(payload.category, null);
    assert.equal(payload.skills.length, 1);
    assert.equal(payload.skills[0]?.id, "skill-marketer");
    assert.equal(payload.skills[0]?.summary, "Marketing strategy and campaign planning.");
    assert.equal(payload.skills[0]?.whenToUse, "Use for campaigns, launches, and social posts.");
    assert.equal(payload.skills[0]?.category, "work");
    assert.deepEqual(payload.skills[0]?.tags, ["marketing", "campaigns"]);
    assert.deepEqual(payload.skills[0]?.scenarios, [
      { key: "instagram_carousel", name: "Instagram Carousel" }
    ]);
    assert.equal(payload.truncated, false);
    assert.equal(result.isError, false);
    assert.equal(api.skillStateCalls.length, 0, "list must be read-only");
  }

  // (a0b) list category filter is read-only and returns no side effects.
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({ action: "list", category: "work" }),
      conversation: webConversation,
      requestId: "req-list-category"
    });
    const payload = result.payload as { action: "listed"; skills: unknown[] };
    assert.equal(payload.action, "listed");
    assert.equal(payload.skills.length, 1);
    assert.equal(api.skillStateCalls.length, 0, "list(category) must be read-only");
  }

  // (a0c) Read-only describe action exposes the moved-out detail without engaging the skill.
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({ action: "describe", skillId: "skill-marketer" }),
      conversation: webConversation,
      requestId: "req-describe"
    });
    const payload = result.payload as {
      action: "described";
      skillId: string;
      skillDisplayName: string;
      summary: string | null;
      whenToUse: string | null;
      category: string;
      tags: string[];
      body: string;
      guardrails: string[];
      examples: string[];
      scenarios: Array<{
        key: string;
        oneLine: string;
        firstStepPreview: string | null;
        recommendedTools: string[];
        guardrails: string[];
        examples: string[];
        intentExamples: string[];
      }>;
      scenario: null;
      truncated: boolean;
    };
    assert.equal(payload.action, "described");
    assert.equal(payload.skillId, "skill-marketer");
    assert.equal(payload.skillDisplayName, "Marketer");
    assert.equal(payload.summary, "Marketing strategy and campaign planning.");
    assert.equal(payload.whenToUse, "Use for campaigns, launches, and social posts.");
    assert.equal(payload.category, "work");
    assert.deepEqual(payload.tags, ["marketing", "campaigns"]);
    assert.equal(payload.body, "Marketer body content.");
    assert.deepEqual(payload.guardrails, ["No unsupported claims."]);
    assert.deepEqual(payload.examples, ["Describe the campaign."]);
    assert.equal(payload.scenario, null);
    assert.equal(payload.scenarios[0]?.key, "instagram_carousel");
    assert.equal(payload.scenarios[0]?.oneLine, "Create an Instagram carousel post.");
    assert.equal(
      payload.scenarios[0]?.firstStepPreview,
      "Collect the brief before generating assets."
    );
    assert.deepEqual(payload.scenarios[0]?.recommendedTools, ["image_generate"]);
    assert.deepEqual(payload.scenarios[0]?.guardrails, ["Keep the claims supportable."]);
    assert.deepEqual(payload.scenarios[0]?.examples, ["Create an 8-slide launch carousel."]);
    assert.deepEqual(payload.scenarios[0]?.intentExamples, ["carousel", "instagram post"]);
    assert.equal(payload.truncated, false);
    assert.equal(result.isError, false);
    assert.equal(api.skillStateCalls.length, 0, "describe must be read-only");
  }

  // (a0d) describe with scenarioKey returns the selected scenario detail and stays read-only.
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({
        action: "describe",
        skillId: "skill-marketer",
        scenarioKey: "instagram_carousel"
      }),
      conversation: webConversation,
      requestId: "req-describe-scenario"
    });
    const payload = result.payload as {
      action: "described";
      scenario: { key: string; recommendedTools: string[] } | null;
    };
    assert.equal(payload.action, "described");
    assert.equal(payload.scenario?.key, "instagram_carousel");
    assert.deepEqual(payload.scenario?.recommendedTools, ["image_generate"]);
    assert.equal(api.skillStateCalls.length, 0, "describe(scenario) must be read-only");
  }

  // (a) Happy path: engage without scenarioKey — includes instruction, scenario:null
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({ action: "engage", skillId: "skill-finance" }),
      conversation: webConversation,
      requestId: "req-1"
    });
    const engagePayload = result.payload as {
      action: "engaged";
      skillId: string;
      skillDisplayName: string;
      scenarioKey: null;
      instruction: RuntimeSkillEngageInstruction;
      scenario: null;
    };
    assert.equal(engagePayload.action, "engaged");
    assert.equal(engagePayload.skillId, "skill-finance");
    assert.equal(engagePayload.skillDisplayName, "Finance");
    assert.equal(engagePayload.scenarioKey, null);
    assert.equal(result.isError, false);

    // ADR-119 Slice 3 — instruction payload
    assert.ok(engagePayload.instruction !== undefined, "instruction must be present");
    assert.equal(
      engagePayload.instruction.body,
      "Finance body content.",
      "instruction.body must match bundle field"
    );
    assert.deepEqual(
      engagePayload.instruction.guardrails,
      ["Do not guarantee returns."],
      "instruction.guardrails must match bundle field"
    );
    assert.deepEqual(
      engagePayload.instruction.examples,
      ["Explain the tax rule."],
      "instruction.examples must match bundle field"
    );
    assert.equal(engagePayload.scenario, null, "scenario must be null when no scenarioKey");

    assert.equal(api.skillStateCalls.length, 1);
    assert.deepEqual(api.skillStateCalls[0], {
      assistantId: "assistant-1",
      channel: "web",
      surfaceThreadKey: "thread-1",
      action: "engage",
      expectedRoleId: "role-1",
      skillId: "skill-finance",
      scenarioKey: null
    });
  }

  // (b) Happy path: release
  {
    const api = new FakeInternalApi();
    api.skillStateResult = {
      applied: true,
      action: "released",
      code: null,
      message: null,
      skillId: "",
      skillDisplayName: "",
      previousSkillId: "skill-finance"
    };
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({ action: "release" }),
      conversation: webConversation,
      requestId: "req-2"
    });
    const releasePayload = result.payload as { action: "released"; previousSkillId: string | null };
    assert.equal(releasePayload.action, "released");
    assert.equal(releasePayload.previousSkillId, "skill-finance");
    assert.equal(result.isError, false);
    assert.equal(api.skillStateCalls.length, 1);
    assert.equal(api.skillStateCalls[0]?.action, "release");
    assert.equal(api.skillStateCalls[0]?.expectedRoleId, "role-1");
  }

  {
    const api = new FakeInternalApi();
    api.skillStateResult = {
      applied: false,
      action: "stale",
      code: "stale_assistant_role_snapshot",
      message: "Assistant role changed while this turn was running.",
      skillId: "",
      skillDisplayName: "",
      previousSkillId: null
    };
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({ action: "engage", skillId: "skill-finance" }),
      conversation: webConversation,
      requestId: "req-stale"
    });
    assert.deepEqual(result.payload, {
      error: "stale_assistant_role_snapshot",
      reason: "Assistant role changed while this turn was running."
    });
    assert.equal(result.isError, false);
  }

  // (c) Error: skill_not_enabled — skillId not in bundle.skills.enabled
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({ action: "engage", skillId: "skill-legal" }),
      conversation: webConversation,
      requestId: "req-3"
    });
    assert.equal((result.payload as { error: string }).error, "skill_not_enabled");
    assert.equal((result.payload as { error: string; skillId: string }).skillId, "skill-legal");
    assert.equal(result.isError, false);
    assert.equal(api.skillStateCalls.length, 0, "must not call API when skill is not enabled");
  }

  // (d) scenario_not_found when the skill has no scenarios in the bundle
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({
        action: "engage",
        skillId: "skill-finance",
        scenarioKey: "instagram_carousel"
      }),
      conversation: webConversation,
      requestId: "req-4"
    });
    assert.equal((result.payload as { error: string }).error, "scenario_not_found");
    assert.equal(
      (result.payload as { error: string; scenarioKey: string }).scenarioKey,
      "instagram_carousel"
    );
    assert.deepEqual(
      (result.payload as { error: string; availableScenarios: unknown[] }).availableScenarios,
      [],
      "availableScenarios is empty when the skill has no scenarios"
    );
    assert.equal(result.isError, false);
    assert.equal(
      api.skillStateCalls.length,
      0,
      "must not call API when scenario is not in catalog"
    );
  }

  // (d2) scenario_not_found with populated availableScenarios when the skill has other scenarios
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({
        action: "engage",
        skillId: "skill-marketer",
        scenarioKey: "nonexistent_scenario"
      }),
      conversation: webConversation,
      requestId: "req-4b"
    });
    assert.equal((result.payload as { error: string }).error, "scenario_not_found");
    assert.deepEqual(
      (result.payload as { availableScenarios: string[] }).availableScenarios,
      ["instagram_carousel"],
      "availableScenarios lists what is actually in the bundle"
    );
    assert.equal(result.isError, false);
    assert.equal(
      api.skillStateCalls.length,
      0,
      "must not call API when scenario is not in catalog"
    );
  }

  // (j) Happy path: engage-with-scenario — returns instruction + full scenario object
  {
    const api = new FakeInternalApi();
    api.skillStateResult = {
      applied: true,
      action: "engaged",
      code: null,
      message: null,
      skillId: "skill-marketer",
      skillDisplayName: "Marketer",
      previousSkillId: null
    };
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({
        action: "engage",
        skillId: "skill-marketer",
        scenarioKey: "instagram_carousel"
      }),
      conversation: webConversation,
      requestId: "req-10"
    });
    assert.equal(result.isError, false);
    const payload = result.payload as {
      action: "engaged";
      skillId: string;
      skillDisplayName: string;
      scenarioKey: string;
      instruction: RuntimeSkillEngageInstruction;
      scenario: RuntimeSkillEngageScenario;
    };
    assert.equal(payload.action, "engaged");
    assert.equal(payload.skillId, "skill-marketer");
    assert.equal(payload.skillDisplayName, "Marketer");
    assert.equal(payload.scenarioKey, "instagram_carousel");

    // ADR-119 Slice 3 — instruction payload present on engage-with-scenario
    assert.ok(payload.instruction !== undefined, "instruction must be present");
    assert.equal(payload.instruction.body, "Marketer body content.");
    assert.deepEqual(payload.instruction.guardrails, ["No unsupported claims."]);
    assert.deepEqual(payload.instruction.examples, ["Describe the campaign."]);

    // ADR-119 Slice 3 — nested scenario object
    assert.ok(
      payload.scenario !== null && payload.scenario !== undefined,
      "scenario must be present"
    );
    assert.equal(payload.scenario.key, "instagram_carousel");
    assert.equal(payload.scenario.displayName, "Instagram Carousel");
    assert.equal(payload.scenario.description, "Create an Instagram carousel post.");
    assert.equal(payload.scenario.steps.length, 1);
    assert.equal(payload.scenario.steps[0]?.number, 1);
    assert.equal(
      payload.scenario.steps[0]?.directive,
      "CALL image_generate with outputMode=series, count=8"
    );
    assert.equal(payload.scenario.steps[0]?.recommendedToolCall, "image_generate");
    assert.equal(payload.scenario.steps[0]?.mayBeSkippedIf, null);
    assert.deepEqual(payload.scenario.steps[0]?.negativeGuards, ["Do not collapse into one call"]);
    assert.deepEqual(payload.scenario.recommendedTools, ["image_generate"]);
    assert.equal(
      payload.scenario.exitCondition,
      "All 8 slides are confirmed and the user is satisfied."
    );

    assert.equal(api.skillStateCalls.length, 1);
    assert.deepEqual(api.skillStateCalls[0], {
      assistantId: "assistant-1",
      channel: "web",
      surfaceThreadKey: "thread-1",
      action: "engage",
      expectedRoleId: "role-2",
      skillId: "skill-marketer",
      scenarioKey: "instagram_carousel"
    });

    // ADR-125 follow-up — the model now owns scenario intake. The engage
    // result carries the full scenario object (verified above), and the
    // `todo_write` tool guidance instructs the model to call `todo_write`
    // itself with one row per scenario step. Runtime no longer seeds.
    assert.deepEqual(api.callOrder, ["updateSkillState"]);
  }

  // (j2) instruction payload content is byte-for-byte match to bundle fields
  {
    const bundleWithRichSkill = createBundle({
      enabledSkills: [
        {
          id: "skill-rich",
          name: "Rich Skill",
          body: "SENTINEL_BODY_CONTENT",
          guardrails: ["SENTINEL_GUARDRAIL_1", "SENTINEL_GUARDRAIL_2"],
          examples: ["SENTINEL_EXAMPLE_1"]
        }
      ]
    });
    const api = new FakeInternalApi();
    api.skillStateResult = {
      applied: true,
      action: "engaged",
      code: null,
      message: null,
      skillId: "skill-rich",
      skillDisplayName: "Rich Skill",
      previousSkillId: null
    };
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithRichSkill,
      toolCall: createToolCall({ action: "engage", skillId: "skill-rich" }),
      conversation: webConversation,
      requestId: "req-j2"
    });
    const p = result.payload as { instruction: RuntimeSkillEngageInstruction };
    assert.equal(
      p.instruction.body,
      "SENTINEL_BODY_CONTENT",
      "instruction.body must be byte-for-byte from bundle"
    );
    assert.deepEqual(
      p.instruction.guardrails,
      ["SENTINEL_GUARDRAIL_1", "SENTINEL_GUARDRAIL_2"],
      "instruction.guardrails must be byte-for-byte from bundle"
    );
    assert.deepEqual(
      p.instruction.examples,
      ["SENTINEL_EXAMPLE_1"],
      "instruction.examples must be byte-for-byte from bundle"
    );
  }

  // (e) Error: invalid_arguments — unknown extra key
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({
        action: "engage",
        skillId: "skill-finance",
        extraField: "bad"
      }),
      conversation: webConversation,
      requestId: "req-5"
    });
    assert.equal((result.payload as { error: string }).error, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(api.skillStateCalls.length, 0);
  }

  // (f) Error: invalid_arguments — missing skillId on engage
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({ action: "engage" }),
      conversation: webConversation,
      requestId: "req-6"
    });
    assert.equal((result.payload as { error: string }).error, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(api.skillStateCalls.length, 0);
  }

  // (g) Error: invalid_arguments — bad action value
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({ action: "activate" }),
      conversation: webConversation,
      requestId: "req-7"
    });
    assert.equal((result.payload as { error: string }).error, "invalid_arguments");
    assert.equal(result.isError, true);
  }

  // (h) Error: API call throws → returns invalid_arguments with isError:true
  {
    const api = new FakeInternalApi();
    api.skillStateError = new Error("Internal error");
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleWithSkill,
      toolCall: createToolCall({ action: "engage", skillId: "skill-finance" }),
      conversation: webConversation,
      requestId: "req-8"
    });
    assert.equal((result.payload as { error: string }).error, "invalid_arguments");
    assert.equal(result.isError, true);
  }

  // (i) release with extra fields → invalid_arguments
  {
    const api = new FakeInternalApi();
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const result = await svc.executeToolCall({
      bundle: bundleEmpty,
      toolCall: createToolCall({ action: "release", skillId: "skill-finance" }),
      conversation: webConversation,
      requestId: "req-9"
    });
    assert.equal((result.payload as { error: string }).error, "invalid_arguments");
    assert.equal(result.isError, true);
    assert.equal(api.skillStateCalls.length, 0);
  }

  // ADR-125 follow-up — re-engages no longer need server-side idempotency
  // because there is no server-side seed. The model is responsible for not
  // duplicating its plan; the engage tool surface stays a pure switch.
  {
    const api = new FakeInternalApi();
    api.skillStateResult = {
      applied: true,
      action: "engaged",
      code: null,
      message: null,
      skillId: "skill-marketer",
      skillDisplayName: "Marketer",
      previousSkillId: null
    };
    const svc = new RuntimeSkillToolService(api as unknown as PersaiInternalApiClientService);
    const first = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({
        action: "engage",
        skillId: "skill-marketer",
        scenarioKey: "instagram_carousel"
      }),
      conversation: webConversation,
      requestId: "req-m1"
    });
    const second = await svc.executeToolCall({
      bundle: bundleWithSkillAndScenarios,
      toolCall: createToolCall({
        action: "engage",
        skillId: "skill-marketer",
        scenarioKey: "instagram_carousel"
      }),
      conversation: webConversation,
      requestId: "req-m2"
    });
    assert.equal((first.payload as { action: string }).action, "engaged");
    assert.equal((second.payload as { action: string }).action, "engaged");
    assert.equal(api.skillStateCalls.length, 2);
  }
}
