import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";

function createInput(order: "alpha" | "beta") {
  const effectiveCapabilities =
    order === "alpha"
      ? {
          channels: { telegram: true, web: true },
          mediaClasses: ["audio", "image"]
        }
      : {
          mediaClasses: ["audio", "image"],
          channels: { web: true, telegram: true }
        };

  const toolAvailability =
    order === "alpha"
      ? {
          classes: { costDriving: true, utility: true },
          tools: [{ code: "web_search", active: true }]
        }
      : {
          tools: [{ active: true, code: "web_search" }],
          classes: { utility: true, costDriving: true }
        };

  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "pub-1",
      publishedVersion: 3,
      algorithmVersion: 1,
      configGeneration: 9
    },
    persona: {
      displayName: "Mira",
      instructions: "Be warm.",
      traits: { warmth: 90, initiative: 55 },
      avatarEmoji: "🙂",
      avatarUrl: null,
      assistantGender: "female"
    },
    userContext: {
      displayName: "Alex",
      birthday: "1995-01-02",
      gender: "male",
      locale: "en",
      timezone: "Europe/Moscow"
    },
    runtime: {
      runtimeAssignment:
        order === "alpha"
          ? {
              schema: "persai.runtimeAssignment.v1",
              planDefaultTier: "paid_shared_restricted",
              runtimeTierOverride: null,
              effectiveTier: "paid_shared_restricted",
              source: "plan_default"
            }
          : {
              source: "plan_default",
              effectiveTier: "paid_shared_restricted",
              runtimeTierOverride: null,
              planDefaultTier: "paid_shared_restricted",
              schema: "persai.runtimeAssignment.v1"
            },
      runtimeProviderProfile:
        order === "alpha"
          ? {
              mode: "admin_managed",
              primary: { provider: "openai", model: "gpt-5.4" }
            }
          : {
              primary: { model: "gpt-5.4", provider: "openai" },
              mode: "admin_managed"
            },
      runtimeProviderRouting:
        order === "alpha"
          ? {
              primary: { provider: "openai", model: "gpt-5.4" },
              fallback: null
            }
          : {
              fallback: null,
              primary: { model: "gpt-5.4", provider: "openai" }
            },
      optimizationPolicy:
        order === "alpha"
          ? { heartbeat: { every: "0m", target: "none" } }
          : { heartbeat: { target: "none", every: "0m" } },
      sharedCompaction:
        order === "alpha"
          ? {
              summarizeToolCode: "summarize_context",
              compactToolCode: "compact_context",
              webSuggestionLatencyMs: 7000,
              reserveTokens: 24000,
              keepRecentTokens: 16000,
              recentTurnsPreserve: 4,
              suggestByMessageCount: false,
              telegramAutoSummarizeEnabled: true
            }
          : {
              telegramAutoSummarizeEnabled: true,
              suggestByMessageCount: false,
              recentTurnsPreserve: 4,
              keepRecentTokens: 16000,
              reserveTokens: 24000,
              webSuggestionLatencyMs: 7000,
              compactToolCode: "compact_context",
              summarizeToolCode: "summarize_context"
            }
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: { refs: { telegram_bot_token: { status: "active" } } },
      policyEnvelope:
        order === "alpha"
          ? { runtimeAssignment: { runtimeTierOverride: null } }
          : { runtimeAssignment: { runtimeTierOverride: null } },
      effectiveCapabilities,
      toolAvailability,
      memoryControl:
        order === "alpha"
          ? { policy: { globalMemoryReadAllSurfaces: true } }
          : { policy: { globalMemoryReadAllSurfaces: true } },
      tasksControl:
        order === "alpha"
          ? { policy: { userMayCancel: true } }
          : { policy: { userMayCancel: true } },
      toolCredentialRefs: {
        web_search: {
          refKey: "tool_web_search",
          secretRef: {
            source: "persai",
            provider: "tool",
            id: "tool/web_search/api-key"
          },
          configured: true,
          providerId: "tavily"
        }
      },
      toolPolicies: [
        {
          toolCode: "web_search",
          displayName: "Web Search",
          description: "Search the public web.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          dailyCallLimit: 20,
          visibleInPlanEditor: true
        }
      ],
      quota: {
        planCode: "starter_trial",
        workspaceQuotaBytes: 524288000,
        quotaHook: null
      },
      auditHook: null
    },
    channels: {
      bindings:
        order === "alpha"
          ? { providers: { telegram: { enabled: true }, web_internal: { enabled: true } } }
          : { providers: { web_internal: { enabled: true }, telegram: { enabled: true } } },
      telegram: {
        enabled: true,
        autoCompactionEnabled: true,
        dmPolicy: "owner_only",
        groupReplyMode: "mention_reply",
        parseMode: "plain_text",
        inbound: true,
        outbound: true,
        accessMode: "owner_only",
        ownerClaimStatus: "connected",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: 123,
        ownerTelegramUsername: "alex",
        ownerTelegramChatId: "123"
      }
    },
    promptDocuments: {
      soul: "# SOUL.md\n",
      user: "# USER.md\n",
      identity: "# IDENTITY.md\n",
      tools: "# TOOLS.md\n",
      agents: "# AGENTS.md\n",
      heartbeat: "# HEARTBEAT.md\n",
      bootstrap: "# BOOTSTRAP.md\n"
    }
  };
}

async function run(): Promise<void> {
  const alpha = compileAssistantRuntimeBundle(createInput("alpha"));
  const beta = compileAssistantRuntimeBundle(createInput("beta"));

  assert.equal(alpha.bundle.schema, "persai.runtime.bundle.v1");
  assert.equal(alpha.bundle.contractSchema, "persai.runtime.contract.v1");
  assert.deepEqual(alpha.bundle.runtime.sharedCompaction, {
    summarizeToolCode: "summarize_context",
    compactToolCode: "compact_context",
    webSuggestionLatencyMs: 7000,
    reserveTokens: 24000,
    keepRecentTokens: 16000,
    recentTurnsPreserve: 4,
    suggestByMessageCount: false,
    telegramAutoSummarizeEnabled: true
  });
  assert.equal(alpha.document, beta.document);
  assert.equal(alpha.hash, beta.hash);
  assert.match(alpha.hash, /^[a-f0-9]{64}$/);
}

void run();
