import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";

async function run(): Promise<void> {
  const artifact = compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
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
        web_search: {
          refKey: "persai:persai-runtime:tool/web_search/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
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
          description: "Search the public web for current external facts.",
          usageGuidance:
            "Use this when the answer depends on recent external information or links.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 30
        },
        {
          toolCode: "files",
          displayName: "Files",
          description:
            "List, search, inspect, read, write, write-and-send, edit, or send assistant-managed files.",
          usageGuidance:
            "Use files.write_and_send when the user asks you to create or save a file and immediately deliver it in chat. Use files.write when the file should only be saved. Use files.list when you need an exact root or folder inventory, and use files.search with a non-empty query when you need to discover a file by name. When you already know the target file, use a returned fileRef or relativePath directly with files.get, files.read, files.edit, or files.send. Do not claim a file was sent unless files.send or files.write_and_send succeeded. Keep shell and exec for actual process execution only.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "exec",
          displayName: "Exec",
          description:
            "Run one bounded executable with explicit arguments inside the assistant sandbox workspace.",
          usageGuidance:
            "Use this only when a real process execution is necessary. Refer to files in the assistant workspace by relative path.",
          kind: "plan",
          executionMode: "sandbox",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "shell",
          displayName: "Shell",
          description: "Run a bounded shell command inside the assistant sandbox workspace.",
          usageGuidance:
            "Use this only when a shell command is actually needed. Refer to files in the assistant workspace by relative path.",
          kind: "plan",
          executionMode: "sandbox",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        }
      ],
      quota: {
        planCode: "starter_trial",
        workspaceQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
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

  const projected = projectRuntimeNativeTools(artifact.bundle);
  const webSearch = projected.tools.find((tool) => tool.name === "web_search");
  const files = projected.tools.find((tool) => tool.name === "files");
  const exec = projected.tools.find((tool) => tool.name === "exec");
  const shell = projected.tools.find((tool) => tool.name === "shell");
  const routeControl = projected.tools.find((tool) => tool.name === "route_control");

  assert.ok(webSearch, "web_search should be projected when enabled and configured");
  assert.equal(routeControl, undefined);
  assert.equal(
    webSearch?.description,
    "Search the public web for current external facts. Use this when the answer depends on recent external information or links."
  );
  assert.match(files?.description ?? "", /write-and-send/);
  assert.match(files?.description ?? "", /files\.write_and_send when the user asks/);
  assert.match(files?.description ?? "", /files\.search with a non-empty query/);
  assert.match(files?.description ?? "", /Do not claim a file was sent unless/);
  assert.ok(
    Array.isArray(
      (files?.inputSchema as { properties?: { action?: { enum?: unknown[] } } })?.properties?.action
        ?.enum
    )
  );
  assert.ok(
    (
      (files?.inputSchema as { properties?: { action?: { enum?: unknown[] } } })?.properties?.action
        ?.enum ?? []
    ).includes("write_and_send")
  );
  const filesProperties = (
    files?.inputSchema as {
      properties?: {
        path?: { description?: string };
        filename?: { description?: string };
      };
    }
  )?.properties;
  assert.match(filesProperties?.path?.description ?? "", /canonical save location/);
  assert.match(filesProperties?.filename?.description ?? "", /does not replace path/);
  assert.match(exec?.description ?? "", /assistant sandbox workspace/);
  assert.doesNotMatch(exec?.description ?? "", /same turn stay mounted/i);
  assert.match(shell?.description ?? "", /assistant sandbox workspace/);
  assert.doesNotMatch(shell?.description ?? "", /same turn stay mounted/i);
}

void run();
