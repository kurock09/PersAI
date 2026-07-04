import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  PLAN_VISIBLE_MODEL_TOOL_CODES,
  PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE,
  TOOL_CATALOG
} from "../../api/prisma/tool-catalog-data";
import type { RuntimeToolPolicy } from "@persai/runtime-contract";

function configuredCredentialRef(providerId: string) {
  return {
    refKey: `persai:persai-runtime:tool/${providerId}/api-key`,
    secretRef: {
      source: "persai" as const,
      provider: "persai-runtime",
      id: `tool/${providerId}/api-key`
    },
    configured: true,
    providerId
  };
}

function buildBasePolicy(toolCode: string): RuntimeToolPolicy {
  const catalogRow =
    TOOL_CATALOG.find((entry) => entry.code === toolCode) ??
    TOOL_CATALOG.find(
      (entry) => entry.code === "persai_tool_quota_status" && toolCode === "quota_status"
    );
  const executionMode =
    toolCode === "shell" || toolCode === "exec"
      ? ("sandbox" as const)
      : toolCode === "files" ||
          toolCode === "grep" ||
          toolCode === "glob" ||
          toolCode === "web_search" ||
          toolCode === "web_fetch" ||
          toolCode === "knowledge_search" ||
          toolCode === "knowledge_fetch" ||
          toolCode === "memory_write" ||
          toolCode === "skill" ||
          toolCode === "todo_write" ||
          toolCode === "summarize_context" ||
          toolCode === "compact_context" ||
          toolCode === "quota_status"
        ? ("inline" as const)
        : ("worker" as const);
  return {
    toolCode,
    displayName: catalogRow?.displayName ?? toolCode,
    description: catalogRow?.modelDescription ?? catalogRow?.description ?? `${toolCode} tool`,
    usageGuidance: catalogRow?.modelUsageGuidance ?? null,
    kind: toolCode === "quota_status" ? "system" : "plan",
    executionMode,
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: toolCode !== "quota_status",
    dailyCallLimit: null
  };
}

const ADR135_POWER_CONFIG_TOOL_CODES = [...PLAN_VISIBLE_MODEL_TOOL_CODES];

function buildPowerConfigToolPolicies(
  exposureMode: "platform_default" | "all_full"
): RuntimeToolPolicy[] {
  return ADR135_POWER_CONFIG_TOOL_CODES.map((toolCode) => {
    const policy = buildBasePolicy(toolCode);
    const defaultExposure = PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE[toolCode] ?? "full";
    const modelExposure: "full" | "catalog" =
      exposureMode === "all_full" ? "full" : defaultExposure;
    return {
      ...policy,
      modelExposure
    };
  });
}

export function buildAdr135PowerConfigBundle(
  exposureMode: "platform_default" | "all_full"
): AssistantRuntimeBundle {
  const artifact = compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-adr135-power",
      assistantHandle: "adr135-power",
      siblingAssistantHandles: [],
      workspaceId: "workspace-adr135",
      publishedVersionId: "version-adr135",
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
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
        executionModes: ["inline", "worker"],
        ragMode: "pattern_only",
        sources: [
          {
            source: "document",
            searchAliasToolCode: null,
            fetchAliasToolCode: null,
            searchCredentialToolCode: null,
            fetchCredentialToolCode: null
          }
        ]
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
      toolCredentialRefs: {
        web_search: configuredCredentialRef("tavily"),
        web_fetch: configuredCredentialRef("firecrawl"),
        image_generate: {
          ...configuredCredentialRef("openai"),
          modelKey: "gpt-image-1.5"
        },
        image_edit: {
          ...configuredCredentialRef("openai"),
          modelKey: "gpt-image-1.5"
        },
        video_generate: {
          refKey: "persai:persai-runtime:tool/video_generate/runway/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/video_generate/runway/api-key"
          },
          configured: true,
          providerId: "runway",
          modelKey: "gen4_turbo",
          videoVoiceCatalog: {
            provider: "kling",
            fetchedAt: "2026-06-02T12:00:00.000Z",
            shortlist: [
              {
                voiceKey: "owen",
                providerVoiceId: "voice-owen",
                displayName: "Owen",
                locale: "en-US",
                gender: "male",
                description: null,
                styleTags: []
              }
            ]
          }
        },
        document: configuredCredentialRef("sandbox"),
        presentation: configuredCredentialRef("gamma"),
        browser: configuredCredentialRef("browserless"),
        tts: configuredCredentialRef("openai")
      },
      toolPolicies: buildPowerConfigToolPolicies(exposureMode),
      quota: {
        planCode: "starter_trial",
        workspaceQuotaBytes: 1024,
        sharedQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
    },
    skills: {
      enabled: [
        {
          id: "skill-adr135",
          name: "Finance",
          description: "Finance skill",
          category: "general",
          tags: [],
          body: "Use finance guidance.",
          guardrails: [],
          examples: []
        }
      ]
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
      soul: "# Core Persona",
      user: "# User Context",
      identity: "# Identity",
      tools: "# Tool Runtime",
      agents: "",
      heartbeat: "",
      preview: "# Character Preview",
      welcome: "# First Conversation"
    }
  });

  return artifact.bundle;
}

export const ADR135_WIRE_BUDGET_MIN_TOKEN_SAVINGS = 3_500;

export function assertAdr135PowerConfigFixtureCoverage(
  projectedToolNames: readonly string[]
): void {
  for (const toolCode of ADR135_POWER_CONFIG_TOOL_CODES) {
    if (!projectedToolNames.includes(toolCode)) {
      throw new Error(`ADR-135 power-config fixture missing projected tool ${toolCode}`);
    }
  }
}
