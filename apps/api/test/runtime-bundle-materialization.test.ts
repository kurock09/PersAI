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
      contextHydration:
        order === "alpha"
          ? {
              preset: "balanced",
              targetContextBudget: 24000,
              compactionTriggerThreshold: 8000,
              keepRecentMinimum: 4,
              knowledgeHydrationBudget: 2400,
              autoCompactionWeb: false,
              autoCompactionTelegram: true
            }
          : {
              autoCompactionTelegram: true,
              autoCompactionWeb: false,
              knowledgeHydrationBudget: 2400,
              keepRecentMinimum: 4,
              compactionTriggerThreshold: 8000,
              targetContextBudget: 24000,
              preset: "balanced"
            },
      knowledgeAccess:
        order === "alpha"
          ? {
              searchToolCode: "knowledge_search",
              fetchToolCode: "knowledge_fetch",
              executionModes: ["inline", "worker"],
              ragMode: "pattern_only",
              sources: [
                {
                  source: "web",
                  searchAliasToolCode: "web_search",
                  fetchAliasToolCode: "web_fetch",
                  searchCredentialToolCode: "web_search",
                  fetchCredentialToolCode: "web_fetch"
                },
                {
                  source: "memory",
                  searchAliasToolCode: "memory_search",
                  fetchAliasToolCode: "memory_get",
                  searchCredentialToolCode: "memory_search",
                  fetchCredentialToolCode: null
                },
                {
                  source: "chat",
                  searchAliasToolCode: null,
                  fetchAliasToolCode: null,
                  searchCredentialToolCode: null,
                  fetchCredentialToolCode: null
                },
                {
                  source: "preset",
                  searchAliasToolCode: null,
                  fetchAliasToolCode: null,
                  searchCredentialToolCode: null,
                  fetchCredentialToolCode: null
                },
                {
                  source: "subscription",
                  searchAliasToolCode: null,
                  fetchAliasToolCode: null,
                  searchCredentialToolCode: null,
                  fetchCredentialToolCode: null
                },
                {
                  source: "global",
                  searchAliasToolCode: null,
                  fetchAliasToolCode: null,
                  searchCredentialToolCode: null,
                  fetchCredentialToolCode: null
                },
                {
                  source: "document",
                  searchAliasToolCode: null,
                  fetchAliasToolCode: null,
                  searchCredentialToolCode: null,
                  fetchCredentialToolCode: null
                }
              ]
            }
          : {
              sources: [
                {
                  fetchCredentialToolCode: "web_fetch",
                  searchCredentialToolCode: "web_search",
                  fetchAliasToolCode: "web_fetch",
                  searchAliasToolCode: "web_search",
                  source: "web"
                },
                {
                  fetchCredentialToolCode: null,
                  searchCredentialToolCode: "memory_search",
                  fetchAliasToolCode: "memory_get",
                  searchAliasToolCode: "memory_search",
                  source: "memory"
                },
                {
                  fetchCredentialToolCode: null,
                  searchCredentialToolCode: null,
                  fetchAliasToolCode: null,
                  searchAliasToolCode: null,
                  source: "chat"
                },
                {
                  fetchCredentialToolCode: null,
                  searchCredentialToolCode: null,
                  fetchAliasToolCode: null,
                  searchAliasToolCode: null,
                  source: "preset"
                },
                {
                  fetchCredentialToolCode: null,
                  searchCredentialToolCode: null,
                  fetchAliasToolCode: null,
                  searchAliasToolCode: null,
                  source: "subscription"
                },
                {
                  fetchCredentialToolCode: null,
                  searchCredentialToolCode: null,
                  fetchAliasToolCode: null,
                  searchAliasToolCode: null,
                  source: "global"
                },
                {
                  fetchCredentialToolCode: null,
                  searchCredentialToolCode: null,
                  fetchAliasToolCode: null,
                  searchAliasToolCode: null,
                  source: "document"
                }
              ],
              ragMode: "pattern_only",
              executionModes: ["inline", "worker"],
              fetchToolCode: "knowledge_fetch",
              searchToolCode: "knowledge_search"
            },
      sharedCompaction:
        order === "alpha"
          ? {
              summarizeToolCode: "summarize_context",
              compactToolCode: "compact_context",
              webSuggestionLatencyMs: 7000,
              reserveTokens: 24000,
              keepRecentTokens: 16000,
              recentTurnsPreserve: 4,
              telegramAutoSummarizeEnabled: true
            }
          : {
              telegramAutoSummarizeEnabled: true,
              recentTurnsPreserve: 4,
              keepRecentTokens: 16000,
              reserveTokens: 24000,
              webSuggestionLatencyMs: 7000,
              compactToolCode: "compact_context",
              summarizeToolCode: "summarize_context"
            },
      workerTools:
        order === "alpha"
          ? {
              tools: [
                {
                  toolCode: "browser",
                  family: "browser_interaction",
                  outcomeKind: "structured_output",
                  timeoutMs: 120000,
                  confirmationRule: "required_for_mutations",
                  supportsProviderRouting: true,
                  failureBehavior: "surface_error"
                },
                {
                  toolCode: "scheduled_action",
                  family: "scheduled_action",
                  outcomeKind: "state_mutation",
                  timeoutMs: 30000,
                  confirmationRule: "required_for_mutations",
                  supportsProviderRouting: false,
                  failureBehavior: "retry_then_surface_error"
                }
              ]
            }
          : {
              tools: [
                {
                  failureBehavior: "surface_error",
                  supportsProviderRouting: true,
                  confirmationRule: "required_for_mutations",
                  timeoutMs: 120000,
                  outcomeKind: "structured_output",
                  family: "browser_interaction",
                  toolCode: "browser"
                },
                {
                  failureBehavior: "retry_then_surface_error",
                  supportsProviderRouting: false,
                  confirmationRule: "required_for_mutations",
                  timeoutMs: 30000,
                  outcomeKind: "state_mutation",
                  family: "scheduled_action",
                  toolCode: "scheduled_action"
                }
              ]
            },
      browser:
        order === "alpha"
          ? {
              toolCode: "browser",
              executionMode: "worker",
              credentialToolCode: "browser",
              providerIds: ["browserless"],
              defaultProviderId: "browserless",
              actions: ["snapshot", "act"],
              confirmationRequiredActions: ["act"]
            }
          : {
              confirmationRequiredActions: ["act"],
              actions: ["snapshot", "act"],
              defaultProviderId: "browserless",
              providerIds: ["browserless"],
              credentialToolCode: "browser",
              executionMode: "worker",
              toolCode: "browser"
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
        browser: {
          refKey: "persai:persai-runtime:tool/browser/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/browser/api-key"
          },
          configured: false,
          providerId: "browserless"
        },
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
          toolCode: "browser",
          displayName: "Browser",
          description: "Automated browser interactions.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "forbidden",
          enabled: false,
          visibleToModel: false,
          dailyCallLimit: null,
          visibleInPlanEditor: true
        },
        {
          toolCode: "scheduled_action",
          displayName: "Reminder Task",
          description: "Create, list, pause, resume, and cancel reminders or recurring tasks.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          dailyCallLimit: null,
          visibleInPlanEditor: true
        },
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
      preview: "# PREVIEW.md\n",
      welcome: "# WELCOME.md\n"
    }
  };
}

async function run(): Promise<void> {
  const alpha = compileAssistantRuntimeBundle(createInput("alpha"));
  const beta = compileAssistantRuntimeBundle(createInput("beta"));

  assert.equal(alpha.bundle.schema, "persai.runtime.bundle.v1");
  assert.equal(alpha.bundle.contractSchema, "persai.runtime.contract.v1");
  assert.deepEqual(alpha.bundle.runtime.contextHydration, {
    preset: "balanced",
    targetContextBudget: 24000,
    compactionTriggerThreshold: 8000,
    keepRecentMinimum: 4,
    knowledgeHydrationBudget: 2400,
    autoCompactionWeb: false,
    autoCompactionTelegram: true
  });
  assert.deepEqual(alpha.bundle.runtime.sharedCompaction, {
    summarizeToolCode: "summarize_context",
    compactToolCode: "compact_context",
    webSuggestionLatencyMs: 7000,
    reserveTokens: 24000,
    keepRecentTokens: 16000,
    recentTurnsPreserve: 4,
    telegramAutoSummarizeEnabled: true
  });
  assert.deepEqual(alpha.bundle.runtime.knowledgeAccess, {
    searchToolCode: "knowledge_search",
    fetchToolCode: "knowledge_fetch",
    executionModes: ["inline", "worker"],
    ragMode: "pattern_only",
    sources: [
      {
        source: "web",
        searchAliasToolCode: "web_search",
        fetchAliasToolCode: "web_fetch",
        searchCredentialToolCode: "web_search",
        fetchCredentialToolCode: "web_fetch"
      },
      {
        source: "memory",
        searchAliasToolCode: "memory_search",
        fetchAliasToolCode: "memory_get",
        searchCredentialToolCode: "memory_search",
        fetchCredentialToolCode: null
      },
      {
        source: "chat",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "preset",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "subscription",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "global",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "document",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      }
    ]
  });
  assert.deepEqual(alpha.bundle.runtime.workerTools, {
    tools: [
      {
        toolCode: "browser",
        family: "browser_interaction",
        outcomeKind: "structured_output",
        timeoutMs: 120000,
        confirmationRule: "required_for_mutations",
        supportsProviderRouting: true,
        failureBehavior: "surface_error"
      },
      {
        toolCode: "scheduled_action",
        family: "scheduled_action",
        outcomeKind: "state_mutation",
        timeoutMs: 30000,
        confirmationRule: "required_for_mutations",
        supportsProviderRouting: false,
        failureBehavior: "retry_then_surface_error"
      }
    ]
  });
  assert.deepEqual(alpha.bundle.runtime.browser, {
    toolCode: "browser",
    executionMode: "worker",
    credentialToolCode: "browser",
    providerIds: ["browserless"],
    defaultProviderId: "browserless",
    actions: ["snapshot", "act"],
    confirmationRequiredActions: ["act"]
  });
  assert.deepEqual(alpha.bundle.governance.toolCredentialRefs.browser, {
    refKey: "persai:persai-runtime:tool/browser/api-key",
    secretRef: {
      source: "persai",
      provider: "persai-runtime",
      id: "tool/browser/api-key"
    },
    configured: false,
    providerId: "browserless"
  });
  assert.equal(alpha.document, beta.document);
  assert.equal(alpha.hash, beta.hash);
  assert.match(alpha.hash, /^[a-f0-9]{64}$/);
}

void run();
