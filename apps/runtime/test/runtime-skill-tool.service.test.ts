import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayToolCall } from "@persai/runtime-contract";
import type { PersaiInternalApiClientService } from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeSkillToolService } from "../src/modules/turns/runtime-skill-tool.service";

function createBundle(opts?: { enabledSkills?: Array<{ id: string; name: string }> }) {
  const enabledSkills = (opts?.enabledSkills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: null,
    category: "general",
    tags: []
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
    this.skillStateCalls.push(input);
    if (this.skillStateError !== null) {
      throw this.skillStateError;
    }
    return this.skillStateResult;
  }
}

export async function runRuntimeSkillToolServiceTest(): Promise<void> {
  const bundleWithSkill = createBundle({
    enabledSkills: [{ id: "skill-finance", name: "Finance" }]
  });
  const bundleEmpty = createBundle({ enabledSkills: [] });

  // (a) Happy path: engage without scenarioKey
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
    };
    assert.equal(engagePayload.action, "engaged");
    assert.equal(engagePayload.skillId, "skill-finance");
    assert.equal(engagePayload.skillDisplayName, "Finance");
    assert.equal(result.isError, false);
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

  // (d) Slice 2 honesty: scenarioKey always returns scenario_not_found
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
      []
    );
    assert.equal(result.isError, false);
    assert.equal(api.skillStateCalls.length, 0, "must not call API when scenario is not wired");
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
}
