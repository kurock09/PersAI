import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  LocalBrowserBridgeGetCommandResultResult,
  ProviderGatewayBrowserActionRequest,
  ProviderGatewayBrowserActionResult,
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeBrowserProfileListItem,
  RuntimeKnowledgeAccessConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import { LocalBrowserBridgeClient } from "../src/modules/turns/local-browser-bridge.client.service";
import type {
  ConsumeToolDailyLimitOutcome,
  DispatchLocalBrowserCommandOutcome,
  PersaiInternalApiClientService,
  ResolveBrowserProfileOutcome,
  StartBrowserLoginOutcome
} from "../src/modules/turns/persai-internal-api.client.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";
import { RuntimeBrowserToolService } from "../src/modules/turns/runtime-browser-tool.service";
import { createFakeMediaObjectStorageForOutboundWrite } from "./helpers/runtime-outbound-test-doubles";

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
  providerIds: ["browserless", "local_bridge"],
  defaultProviderId: "browserless",
  actions: ["snapshot", "act", "login", "open_live", "list_profiles"],
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
      content: input.format === "pdf" || input.format === "png" ? "" : "<html>hello</html>",
      truncated: false,
      elements: [],
      extracted: null,
      observedAt: "2026-07-05T12:00:00.000Z",
      tookMs: 1200,
      warning: null,
      ...(input.format === "pdf"
        ? {
            pdfBase64: Buffer.from("%PDF-1.4 test").toString("base64"),
            artifactMimeType: "application/pdf"
          }
        : input.format === "png"
          ? {
              artifactBase64: Buffer.from("png-bytes").toString("base64"),
              artifactMimeType: "image/png"
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
  listProfilesError: Error | null = null;
  resolveCalls: Array<{ assistantId: string; profileKey: string }> = [];
  startLoginCalls: Array<{
    assistantId: string;
    workspaceId: string;
    displayName: string;
    loginUrl: string;
    originatingChatId?: string | null;
  }> = [];
  touchCalls: Array<{ assistantId: string; workspaceId: string; profileKey: string }> = [];
  dispatchCalls: Array<{
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId?: string | null;
    command: { action: string };
  }> = [];
  pollCalls: string[] = [];

  resolveOutcome: ResolveBrowserProfileOutcome = {
    ok: true,
    profileId: "profile-1",
    bridgeSessionRef: "device-pinned-1"
  };
  dispatchOutcome: DispatchLocalBrowserCommandOutcome = {
    accepted: true,
    commandId: "command-1",
    bridgeDeviceId: "device-1"
  };
  pollResponses: LocalBrowserBridgeGetCommandResultResult[] = [];
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
    if (this.listProfilesError !== null) {
      throw this.listProfilesError;
    }
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
    originatingChatId?: string | null;
  }): Promise<StartBrowserLoginOutcome> {
    this.startLoginCalls.push(input);
    return {
      profileId: "profile-new",
      profileKey: "bitrix-2",
      displayName: input.displayName,
      loginUrl: input.loginUrl,
      workspaceId: input.workspaceId,
      bridgeClientKind: "extension",
      status: "pending_login"
    };
  }

  async dispatchLocalBrowserCommand(input: {
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId?: string | null;
    command: { action: string };
  }): Promise<DispatchLocalBrowserCommandOutcome> {
    this.dispatchCalls.push(input);
    return this.dispatchOutcome;
  }

  async getLocalBrowserCommandResult(
    commandId: string
  ): Promise<LocalBrowserBridgeGetCommandResultResult> {
    this.pollCalls.push(commandId);
    const next = this.pollResponses.shift();
    if (next !== undefined) {
      return next;
    }
    return {
      status: "completed",
      result: {
        commandId,
        ok: true,
        finalUrl: "https://example.com/",
        title: "Profile page",
        content: "hello from local bridge",
        truncated: false,
        elements: [],
        extracted: null,
        warning: null
      }
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

function createService(deps?: {
  providerGateway?: FakeProviderGatewayClientService;
  internalApi?: FakePersaiInternalApiClientService;
}) {
  const providerGateway = deps?.providerGateway ?? new FakeProviderGatewayClientService();
  const internalApi = deps?.internalApi ?? new FakePersaiInternalApiClientService();
  const localBridge = new LocalBrowserBridgeClient(
    internalApi as unknown as PersaiInternalApiClientService
  );
  const mediaObjectStorage = createFakeMediaObjectStorageForOutboundWrite(
    "/workspace/assistants/a-test/sessions/session-1/browser-export.pdf"
  );
  return {
    providerGateway,
    internalApi,
    service: new RuntimeBrowserToolService(
      providerGateway as unknown as ProviderGatewayClientService,
      internalApi as unknown as PersaiInternalApiClientService,
      localBridge,
      mediaObjectStorage as never
    )
  };
}

export async function runRuntimeBrowserToolServiceTest(): Promise<void> {
  const bundle = createBundle();
  const { service, providerGateway, internalApi } = createService();

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
  assert.equal(schema.properties?.format?.enum?.includes("png"), true);

  const listResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({ action: "list_profiles" }),
    sessionId: "session-1"
  });
  assert.equal(listResult.isError, false);
  assert.equal(listResult.payload.action, "listed_profiles");
  assert.equal(listResult.payload.profiles?.length, 1);
  assert.equal(internalApi.listProfilesCalls, 1);
  assert.equal(internalApi.quotaCalls.length, 0);

  internalApi.listProfilesError = new Error("profiles blew up");
  const listFailureResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({ action: "list_profiles" }),
    sessionId: "session-1"
  });
  assert.equal(listFailureResult.isError, true);
  assert.equal(listFailureResult.payload.reason, "browser_failed");
  assert.match(listFailureResult.payload.warning ?? "", /profiles blew up/);
  internalApi.listProfilesError = null;

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
  assert.equal(loginResult.payload.provider, "local_bridge");
  assert.equal(loginResult.payload.pendingBrowserLogin?.bridgeClientKind, "extension");
  assert.equal(
    loginResult.payload.pendingBrowserLogin?.loginUrl,
    "https://example.bitrix24.ru/login"
  );
  assert.equal(internalApi.startLoginCalls[0]?.originatingChatId, "chat-web-1");

  internalApi.pollResponses = [
    {
      status: "completed",
      result: {
        commandId: "command-1",
        ok: true,
        finalUrl: "https://example.com/",
        title: "Profile page",
        content: "hello from local bridge",
        truncated: false,
        elements: [],
        extracted: null,
        warning: null
      }
    }
  ];
  const profileSnapshot = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/",
      profile: "bitrix"
    }),
    sessionId: "session-1"
  });
  assert.equal(profileSnapshot.isError, false);
  assert.equal(profileSnapshot.payload.provider, "local_bridge");
  assert.equal(providerGateway.browserCalls.length, 0);
  assert.equal(internalApi.dispatchCalls.length, 1);
  assert.equal(internalApi.dispatchCalls[0]?.command.action, "snapshot");
  assert.equal(internalApi.dispatchCalls[0]?.bridgeDeviceId, "device-pinned-1");
  assert.equal(internalApi.touchCalls.length, 1);

  internalApi.dispatchOutcome = {
    accepted: false,
    commandId: "command-2",
    code: "bridge_unavailable",
    message: "No active browser bridge device is connected for this assistant."
  };
  const unavailableResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/",
      profile: "bitrix"
    }),
    sessionId: "session-1"
  });
  assert.equal(unavailableResult.isError, false);
  assert.equal(unavailableResult.payload.reason, "bridge_unavailable");
  assert.match(unavailableResult.payload.warning ?? "", /local browser bridge/i);
  internalApi.dispatchOutcome = {
    accepted: true,
    commandId: "command-1",
    bridgeDeviceId: "device-1"
  };

  internalApi.resolveOutcome = {
    ok: false,
    reason: "browser_profile_needs_user_reauth",
    pendingBrowserLogin: {
      profileId: "profile-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      loginUrl: "https://example.bitrix24.ru/login",
      workspaceId: "workspace-1",
      bridgeClientKind: "extension"
    }
  };
  const reauthResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/",
      profile: "bitrix"
    }),
    sessionId: "session-1"
  });
  assert.equal(reauthResult.isError, false);
  assert.equal(reauthResult.payload.reason, "browser_profile_needs_user_reauth");
  assert.equal(reauthResult.payload.pendingBrowserLogin?.bridgeClientKind, "extension");

  internalApi.resolveOutcome = {
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

  internalApi.resolveOutcome = {
    ok: true,
    profileId: "profile-1",
    bridgeSessionRef: "device-pinned-telegram"
  };
  const telegramProfileResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/",
      profile: "bitrix"
    }),
    sessionId: "session-1",
    transportSurface: "telegram"
  });
  assert.equal(telegramProfileResult.isError, false);
  assert.equal(telegramProfileResult.payload.reason, "open_in_app");
  assert.equal(telegramProfileResult.payload.warning?.includes("PersAI web/app"), true);

  const telegramLoginResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "login",
      url: "https://example.com/login",
      displayName: "Example"
    }),
    sessionId: "session-1",
    transportSurface: "telegram"
  });
  assert.equal(telegramLoginResult.isError, false);
  assert.equal(telegramLoginResult.payload.reason, "open_in_app");
  assert.equal("pendingBrowserLogin" in telegramLoginResult.payload, false);

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
  assert.equal(providerGateway.browserCalls[0]?.format, "pdf");

  const pngResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "snapshot",
      url: "https://example.com/dashboard",
      format: "png",
      fullPage: true
    }),
    sessionId: "session-1"
  });
  assert.equal(pngResult.isError, false);
  assert.equal(pngResult.artifacts.length, 1);
  assert.equal(pngResult.artifacts[0]?.mimeType, "image/png");
  assert.equal(providerGateway.browserCalls[1]?.format, "png");
  assert.equal(providerGateway.browserCalls[1]?.fullPage, true);

  const headlessAct = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "act",
      url: "https://example.com/catalog",
      operations: [
        { kind: "scroll", selector: null },
        { kind: "scroll", selector: "#card-3" }
      ]
    }),
    sessionId: "session-1"
  });
  assert.equal(headlessAct.isError, false);
  assert.deepEqual(providerGateway.browserCalls[2]?.operations, [
    { kind: "scroll", selector: null },
    { kind: "scroll", selector: "#card-3" }
  ]);

  const invalidScrollResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "act",
      url: "https://example.com/catalog",
      operations: [{ kind: "scroll", selector: "" }]
    }),
    sessionId: "session-1"
  });
  assert.equal(invalidScrollResult.isError, true);
  assert.equal(invalidScrollResult.payload.reason, "invalid_arguments");

  const stayOnPageWithoutProfile = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({
      action: "act",
      url: "https://example.com/catalog",
      stayOnPage: true,
      operations: [{ kind: "click", selector: "#x" }]
    }),
    sessionId: "session-1"
  });
  assert.equal(stayOnPageWithoutProfile.isError, true);
  assert.equal(stayOnPageWithoutProfile.payload.reason, "invalid_arguments");

  internalApi.resolveOutcome = {
    ok: true,
    profileId: "profile-1",
    bridgeSessionRef: "device-pinned-open-view"
  };
  internalApi.pollResponses = [
    {
      status: "completed",
      result: {
        commandId: "command-open-view",
        ok: true,
        warning: "opened"
      }
    }
  ];
  const openLiveResult = await service.executeToolCall({
    bundle,
    toolCall: createToolCall({ action: "open_live", profile: "lavka" }),
    sessionId: "session-1"
  });
  assert.equal(openLiveResult.isError, false);
  assert.equal(openLiveResult.payload.action, "opened_live");
  assert.equal(internalApi.dispatchCalls.at(-1)?.command.action, "open_view");
  assert.equal(internalApi.dispatchCalls.at(-1)?.bridgeDeviceId, "device-pinned-open-view");
}
