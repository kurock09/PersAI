import assert from "node:assert/strict";
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
  exitCondition: "All 8 slides are confirmed and the user is satisfied."
};

function createBundle(opts?: {
  enabledSkills?: Array<{
    id: string;
    name: string;
    body?: string;
    guardrails?: string[];
    examples?: string[];
    scenarios?: RuntimeBundleSkillScenario[];
  }>;
}) {
  const enabledSkills = (opts?.enabledSkills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: null,
    category: "general",
    tags: [],
    body: s.body ?? "",
    guardrails: s.guardrails ?? [],
    examples: s.examples ?? [],
    ...(s.scenarios !== undefined ? { scenarios: s.scenarios } : {})
  }));
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
    skillId: string;
    skillDisplayName: string;
    previousSkillId: string | null;
  } = {
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
    return this.skillStateResult;
  }
}

export async function runRuntimeSkillToolServiceTest(): Promise<void> {
  const bundleWithSkill = createBundle({
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
    enabledSkills: [
      {
        id: "skill-marketer",
        name: "Marketer",
        body: "Marketer body content.",
        guardrails: ["No unsupported claims."],
        examples: ["Describe the campaign."],
        scenarios: [INSTAGRAM_CAROUSEL_SCENARIO]
      }
    ]
  });
  const bundleEmpty = createBundle({ enabledSkills: [] });

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
      skillId: "skill-finance",
      scenarioKey: null
    });
  }

  // (b) Happy path: release
  {
    const api = new FakeInternalApi();
    api.skillStateResult = { skillId: "", skillDisplayName: "", previousSkillId: "skill-finance" };
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
