import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayBrowserActionRequest,
  ProviderGatewayBrowserActionResult,
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeBrowserProfileListItem,
  RuntimeKnowledgeAccessConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import { RuntimeBrowserToolService } from "../src/modules/turns/runtime-browser-tool.service";
import { createFakeMediaObjectStorageForOutboundWrite } from "./helpers/runtime-outbound-test-doubles";
import type {
  ConsumeToolDailyLimitOutcome,
  PersaiInternalApiClientService,
  ResolveBrowserProfileOutcome,
  StartBrowserLoginOutcome
} from "../src/modules/turns/persai-internal-api.client.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";

const KNOWLEDGE_ACCESS_CONFIG = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: []
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = {
  tools: [
    {
      toolCode: "browser",
      family: "browser_interaction",
      outcomeKind: "structured_output",
      timeoutMs: 120000,
      confirmationRule: "none",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    }
  ]
} satisfies RuntimeWorkerToolsConfig;

const BROWSER_CONFIG = {
  toolCode: "browser",
  executionMode: "worker",
  credentialToolCode: "browser",
  providerIds: ["browserless"],
  defaultProviderId: "browserless",
  actions: ["snapshot", "act", "login", "list_profiles"],
  confirmationRequiredActions: ["act", "login"]
} satisfies RuntimeBrowserConfig;

function createBundle() {
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
      instructions: "Answer as a concise assistant.",
      traits: { warmth: 80, formality: 45, playfulness: 30 },
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: "female",
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "ru-RU",
        deliveryKind: "voice_note",
        elevenlabs: { voiceId: "voice-eleven" },
        yandex: { voice: "jane", role: null },
        openai: { voice: "marin" }
      }
    },
    userContext: {
      displayName: "Alex",
      birthday: null,
      gender: null,
      locale: "ru-RU",
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
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
      workerTools: WORKER_TOOLS_CONFIG,
      browser: BROWSER_CONFIG,
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
      toolCredentialRefs: {
        browser: {
          refKey: "persai:persai-runtime:tool/browser/browserless/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/browser/browserless/api-key"
          },
          configured: true,
          providerId: "browserless"
        }
      },
      toolPolicies: [
        {
          toolCode: "browser",
          displayName: "Browser",
          description: "Browse pages.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 5
        }
      ],
      quota: {
        planCode: "paid",
        workspaceQuotaBytes: 1024 * 1024,
        sharedQuotaBytes: 1024 * 1024,
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
    }
  }).bundle;
}

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-browser-1",
    name: "browser",
    arguments: argumentsObject
  };
}

class FakeProviderGatewayClientService {
  browserCalls: ProviderGatewayBrowserActionRequest[] = [];
  browserActionError: Error | null = null;

  async browserAction(
    input: ProviderGatewayBrowserActionRequest
  ): Promise<ProviderGatewayBrowserActionResult> {
    this.browserCalls.push(input);
    if (this.browserActionError !== null) {
      throw this.browserActionError;
    }
    return {
      provider: "browserless",
      action: input.action,
      initialUrl: input.url,
      finalUrl: input.url,
      title: "Example",
      content: input.format === "pdf" ? "" : "<html>hello</html>",
      truncated: false,
      elements: [],
      observedAt: "2026-07-05T12:00:00.000Z",
      tookMs: 1200,
      warning: null,
      ...(input.format === "pdf"
        ? {
            pdfBase64: Buffer.from("%PDF-1.4 test").toString("base64"),
            artifactMimeType: "application/pdf"
          }
        : {}),
      externalContent: {
        untrusted: true,
        source: "browser",
        provider: "browserless"
      },
      billingFacts: null
    };
  }
}

class FakePersaiInternalApiClientService {
  quotaCalls: Array<{ assistantId: string; toolCode: string; dailyCallLimit: number | null }> = [];
  listProfilesCalls = 0;
  resolveCalls: Array<{ assistantId: string; profileKey: string }> = [];
  startLoginCalls: Array<{
    assistantId: string;
    workspaceId: string;
    displayName: string;
    loginUrl: string;
    browserCredentialSecretId?: string;
    originatingChatId?: string | null;
  }> = [];
  touchCalls: Array<{ assistantId: string; workspaceId: string; profileKey: string }> = [];
  resolveOutcome: ResolveBrowserProfileOutcome = {
    ok: true,
    providerSessionId: "/reconnect/session-1",
    profileId: "profile-1"
  };
  profiles: RuntimeBrowserProfileListItem[] = [
    {
      profileKey: "bitrix",
      displayName: "Bitrix24",
      status: "active",
      originHost: "example.bitrix24.ru",
      lastUsedAt: "2026-07-04T12:00:00.000Z"
    }
  ];

  async consumeToolDailyLimit(input: {
    assistantId: string;
    toolCode: string;
    dailyCallLimit: number | null;
  }): Promise<ConsumeToolDailyLimitOutcome> {
    this.quotaCalls.push(input);
    return { allowed: true, currentCount: 1, limit: input.dailyCallLimit };
  }

  async listBrowserProfiles(): Promise<RuntimeBrowserProfileListItem[]> {
    this.listProfilesCalls += 1;
    return this.profiles;
  }

  async resolveBrowserProfile(input: {
    assistantId: string;
    profileKey: string;
  }): Promise<ResolveBrowserProfileOutcome> {
    this.resolveCalls.push(input);
    return this.resolveOutcome;
  }

  async startBrowserLogin(input: {
    assistantId: string;
    workspaceId: string;
    displayName: string;
    loginUrl: string;
    browserCredentialSecretId?: string;
    originatingChatId?: string | null;
  }): Promise<StartBrowserLoginOutcome> {
    this.startLoginCalls.push(input);
    return {
      profileId: "profile-new",
      profileKey: "bitrix-2",
      displayName: input.displayName,
      liveUrl: "https://live.browserless.io/session-abc",
      loginUrl: input.loginUrl,
      status: "pending_login"
    };
  }

  async touchBrowserProfile(input: {
    assistantId: string;
    workspaceId: string;
    profileKey: string;
  }): Promise<void> {
    this.touchCalls.push(input);
  }

  async sumWorkspaceFileStorageBytes(): Promise<number> {
    return 0;
  }

  async upsertWorkspaceFileMetadata(): Promise<{ documentRegistration: null }> {
    return { documentRegistration: null };
  }
}

export async function runRuntimeBrowserToolServiceTest(): Promise<void> {
  const providerGatewayClientService = new FakeProviderGatewayClientService();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const mediaObjectStorage = createFakeMediaObjectStorageForOutboundWrite(
    "/workspace/assistants/a-test/sessions/session-1/browser-export.pdf"
  );
  const service = new RuntimeBrowserToolService(
    providerGatewayClientService as unknown as ProviderGatewayClientService,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService,
    mediaObjectStorage as never
  );

  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  const browserTool = projection.tools.find((tool) => tool.name === "browser");
  assert.ok(browserTool);
  const schema = browserTool.inputSchema as {
    properties?: Record<string, { enum?: string[] }>;
    required?: string[];
  };
  assert.deepEqual(schema.required, ["action"]);
  assert.equal(schema.properties?.profile !== undefined, true);
  assert.equal(schema.properties?.displayName !== undefined, true);
  assert.equal(schema.properties?.format?.enum?.includes("pdf"), true);

  const listResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({ action: "list_profiles" }),
    sessionId: "session-1"
  });
  assert.equal(listResult.isError, false);
  assert.equal(listResult.payload.action, "listed_profiles");
  assert.equal(listResult.payload.profiles?.length, 1);
  assert.equal(persaiInternalApiClientService.listProfilesCalls, 1);
  assert.equal(persaiInternalApiClientService.quotaCalls.length, 0);

  const loginResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "login",
      displayName: "Bitrix24",
      url: "https://example.bitrix24.ru/login"
    }),
    sessionId: "session-1",
    chatId: "chat-web-1"
  });
  assert.equal(loginResult.isError, false);
  assert.equal(loginResult.payload.action, "login");
  assert.equal(loginResult.payload.pendingBrowserLogin?.profileKey, "bitrix-2");
  assert.equal(loginResult.payload.pendingBrowserLogin?.liveUrl.includes("browserless"), true);
  assert.equal(persaiInternalApiClientService.startLoginCalls.length, 1);
  assert.equal(persaiInternalApiClientService.startLoginCalls[0]?.originatingChatId, "chat-web-1");
  assert.equal(persaiInternalApiClientService.quotaCalls.length, 1);

  const snapshotResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/",
      profile: "bitrix",
      optimizeForSpeed: true
    }),
    sessionId: "session-1"
  });
  assert.equal(snapshotResult.isError, false);
  assert.equal(snapshotResult.payload.action, "snapshot");
  assert.equal(providerGatewayClientService.browserCalls.length, 1);
  assert.equal(
    providerGatewayClientService.browserCalls[0]?.profileSessionId,
    "/reconnect/session-1"
  );
  assert.equal("profile" in (providerGatewayClientService.browserCalls[0] ?? {}), false);
  assert.equal(providerGatewayClientService.browserCalls[0]?.optimizeForSpeed, true);
  assert.equal(persaiInternalApiClientService.touchCalls.length, 1);

  providerGatewayClientService.browserActionError = new Error("browserless exploded");
  persaiInternalApiClientService.resolveOutcome = {
    ok: true,
    providerSessionId: "/reconnect/session-1",
    profileId: "profile-1"
  };
  const pgFailureResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/",
      profile: "bitrix"
    }),
    sessionId: "session-1"
  });
  assert.equal(pgFailureResult.isError, true);
  assert.equal(pgFailureResult.payload.reason, "browser_failed");
  assert.match(pgFailureResult.payload.warning ?? "", /browserless exploded/);
  assert.equal(persaiInternalApiClientService.touchCalls.length, 1);

  providerGatewayClientService.browserActionError = null;

  persaiInternalApiClientService.resolveOutcome = {
    ok: false,
    reason: "browser_profile_expired"
  };
  const expiredResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/",
      profile: "bitrix"
    }),
    sessionId: "session-1"
  });
  assert.equal(expiredResult.isError, true);
  assert.equal(expiredResult.payload.reason, "browser_profile_expired");
  assert.equal(providerGatewayClientService.browserCalls.length, 2);

  persaiInternalApiClientService.resolveOutcome = {
    ok: true,
    providerSessionId: "/reconnect/session-1",
    profileId: "profile-1"
  };
  const pdfResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/report",
      format: "pdf"
    }),
    sessionId: "session-1"
  });
  assert.equal(pdfResult.isError, false);
  assert.equal(pdfResult.artifacts.length, 1);
  assert.equal(pdfResult.artifacts[0]?.mimeType, "application/pdf");
  assert.match(pdfResult.payload.page?.content ?? "", /files\.attach/);
  assert.equal(providerGatewayClientService.browserCalls[2]?.format, "pdf");
}
