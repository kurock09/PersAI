import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  projectRuntimeNativeTools,
  TOOL_DESCRIPTION_CAP,
  buildFullNativeToolDefinition
} from "../src/modules/turns/native-tool-projection";
import { executeRuntimeToolContractDescribe } from "../src/modules/turns/runtime-tool-contract-describe";
import { TOOL_CATALOG } from "../../api/prisma/tool-catalog-data";
import {
  ANTI_COLLAGE_RULE,
  STANDALONE_IMAGE_RULE,
  referenceGuidanceRule,
  seriesItemHeaderLine
} from "@persai/runtime-contract";

const FILES_CATALOG_ROW = TOOL_CATALOG.find((tool) => tool.code === "files");
assert.ok(FILES_CATALOG_ROW, "files catalog row must exist for projection tests");

function findRepoRoot(): string {
  const starts = Array.from(new Set([path.resolve(__dirname), path.resolve(process.cwd())]));
  for (const start of starts) {
    let current = start;
    let reachedRoot = false;
    while (!reachedRoot) {
      const runtimeContractPath = path.join(
        current,
        "packages",
        "runtime-contract",
        "src",
        "index.ts"
      );
      const projectionPath = path.join(
        current,
        "apps",
        "runtime",
        "src",
        "modules",
        "turns",
        "native-tool-projection.ts"
      );
      if (existsSync(runtimeContractPath) && existsSync(projectionPath)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        reachedRoot = true;
      } else {
        current = parent;
      }
    }
  }
  throw new Error("Could not locate the PersAI repo root for the ADR-117 golden test.");
}

function readRepoFile(repoRoot: string, relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function countStringLiteralsMatching(text: string, pattern: RegExp): number {
  const stringLiteralPattern = /"[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`/g;
  let count = 0;
  for (const match of text.matchAll(stringLiteralPattern)) {
    const literal = match[0];
    const tester = new RegExp(pattern.source, pattern.flags);
    if (tester.test(literal)) {
      count += 1;
    }
  }
  return count;
}

function assertImportsRuntimeContractSymbols(params: {
  ruleName: string;
  relativePath: string;
  source: string;
  requiredSymbols: string[];
}): void {
  const normalized = params.source.replace(/\r\n/g, "\n");
  const importMatches = Array.from(
    normalized.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"@persai\/runtime-contract";/g)
  );
  assert.ok(
    importMatches.length > 0,
    `${params.ruleName}: ${params.relativePath} must import shared media fragments from @persai/runtime-contract`
  );
  const importBody = importMatches.map((match) => match[1] ?? "").join("\n");
  for (const symbol of params.requiredSymbols) {
    assert.ok(
      importBody.includes(symbol),
      `${params.ruleName}: ${params.relativePath} must reference shared symbol ${symbol} from @persai/runtime-contract`
    );
  }
}

export async function runNativeToolProjectionTest(): Promise<void> {
  const artifact = compileAssistantRuntimeBundle({
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
        actions: ["snapshot", "act", "login", "request_user_action", "list_profiles"],
        confirmationRequiredActions: ["act", "login"]
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
        },
        browser: {
          refKey: "persai:persai-runtime:tool/browser/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/browser/api-key"
          },
          configured: true,
          providerId: "browserless"
        },
        image_generate: {
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: true,
          providerId: "openai",
          modelKey: "gpt-image-1.5"
        },
        image_edit: {
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: true,
          providerId: "openai",
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
        document: {
          refKey: "persai:persai-runtime:tool/document/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/document/api-key"
          },
          configured: true,
          providerId: "sandbox",
          fallbacks: [
            {
              refKey: "persai:persai-runtime:tool/document/gamma-api-key",
              secretRef: {
                source: "persai",
                provider: "persai-runtime",
                id: "tool/document/gamma-api-key"
              },
              configured: true,
              providerId: "gamma"
            }
          ]
        },
        presentation: {
          refKey: "persai:persai-runtime:tool/document/gamma-api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/document/gamma-api-key"
          },
          configured: true,
          providerId: "gamma"
        },
        tts: {
          refKey: "persai:persai-runtime:tool/tts/openai-api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/tts/openai-api-key"
          },
          configured: true,
          providerId: "openai"
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
          toolCode: "browser",
          displayName: "Browser",
          description:
            "Automated web browser for interactive page navigation and content extraction.",
          usageGuidance:
            "Use this for JavaScript-rendered or logged-in pages that need browser state.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 20
        },
        {
          toolCode: "image_generate",
          displayName: "Image Generate",
          description: "Generate brand-new images from a text prompt.",
          usageGuidance: 'Set background="transparent" when the user wants transparent PNG output.',
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10,
          perTurnCap: 2
        },
        {
          toolCode: "image_edit",
          displayName: "Image Edit",
          description: "Edit a current-turn image.",
          usageGuidance:
            'Set background="transparent" when the user asks to remove the background.',
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10
        },
        {
          toolCode: "video_generate",
          displayName: "Video Generate",
          description: "Generate a short video clip from text.",
          usageGuidance:
            "Use a reference image when a current or recent reusable image should guide the video.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 5
        },
        {
          toolCode: "document",
          displayName: "Document",
          description: "Inspect, render, or convert ordinary PDF/DOCX/XLSX files.",
          usageGuidance:
            "Use exactly three document verbs: inspect(path), render({ content | contentPath, format, style?, template?, requestedName }), and convert({ source, targetFormat, requestedName? }). document.render persists a visible sibling Markdown source, registers the output, and delivers it. For anything these verbs cannot express - complex XLSX with formulas/charts, targeted edits of uploaded files, custom layouts, or data-driven docs - write Python in shell with openpyxl/python-docx/weasyprint and then call files.attach(path). Slide decks belong in presentation.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10
        },
        {
          toolCode: "presentation",
          displayName: "Presentation",
          description: "Create and revise slide decks through the deferred Gamma worker.",
          usageGuidance:
            "Use presentation for slide decks only. Chat delivery for create_presentation is always PDF.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: 10
        },
        {
          toolCode: "tts",
          displayName: "TTS",
          description: "Generate spoken audio for the current assistant persona.",
          usageGuidance:
            "Use this when the user wants a spoken reply or voice note. Do not claim the audio or voice note already exists unless this same turn returns action='generated'.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 20
        },
        {
          toolCode: "files",
          displayName: "Files",
          description: FILES_CATALOG_ROW?.modelDescription ?? null,
          usageGuidance: FILES_CATALOG_ROW?.modelUsageGuidance ?? null,
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
        },
        {
          toolCode: "grep",
          displayName: "Grep",
          description: "Search workspace files for a text pattern.",
          usageGuidance: "Content search across workspace files.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "glob",
          displayName: "Glob",
          description: "Find workspace files by name pattern.",
          usageGuidance: "Filename discovery across workspace files.",
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "scheduled_action",
          displayName: "Scheduled Action",
          description: "Schedule simple unconditional user-visible reminders.",
          usageGuidance: "For create, choose exactly one explicit kind.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "background_task",
          displayName: "Background Task",
          description: "Create and manage quiet assistant-side background tasks.",
          usageGuidance:
            "Before creating a duplicate, list and then pause, resume, cancel, or keep the existing task instead of creating a second equivalent one.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        },
        {
          toolCode: "todo_write",
          displayName: "Todo Write",
          description: "Manage the orchestrator's structured plan for this chat.",
          usageGuidance:
            "Open the plan on the first turn you recognise multi-step work; do not wait.",
          kind: "plan",
          executionMode: "inline",
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
        sharedQuotaBytes: 1024,
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
  const awaitTool = projected.tools.find((tool) => tool.name === "await");
  assert.ok(awaitTool, "await must be universally model-visible");
  assert.deepEqual(
    (awaitTool.inputSchema as { properties: { action: { enum: string[] } } }).properties.action
      .enum,
    ["wait", "notify"]
  );
  assert.equal(
    projected.tools.some((tool) => tool.name === "wait_job"),
    false
  );
  assert.equal(JSON.stringify(awaitTool.inputSchema).includes("notify"), true);
  const activeScenarioScriptRefs = [
    {
      scriptKey: "projection_script",
      scriptId: "script-projection",
      scriptVersionId: "script-version-projection",
      versionNumber: 1,
      contentHash: "a".repeat(64),
      inputMapping: {},
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    {
      scriptKey: "second_projection_script",
      scriptId: "script-projection-2",
      scriptVersionId: "script-version-projection-2",
      versionNumber: 2,
      contentHash: "b".repeat(64),
      inputMapping: {
        query: { source: "tool_input" as const, name: "query" }
      },
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false
      }
    }
  ];
  const sandboxEnabledBundle = {
    ...artifact.bundle,
    runtime: {
      ...artifact.bundle.runtime,
      sandbox: {
        ...artifact.bundle.runtime.sandbox,
        enabled: true
      }
    }
  } as typeof artifact.bundle;
  const sandboxDisabledBundle = {
    ...sandboxEnabledBundle,
    runtime: {
      ...sandboxEnabledBundle.runtime,
      sandbox: {
        ...sandboxEnabledBundle.runtime.sandbox,
        enabled: false
      }
    }
  } as typeof artifact.bundle;
  const projectedScript = projectRuntimeNativeTools(sandboxEnabledBundle, {
    activeScenarioScriptRefs
  }).tools.find((tool) => tool.name === "script");
  assert.ok(
    projectedScript,
    "script must be projected for Scenario-scoped refs when sandbox is enabled"
  );
  const multiSchema = projectedScript.inputSchema as {
    type?: string;
    additionalProperties?: boolean;
    oneOf?: unknown[];
  };
  assert.equal(multiSchema.type, "object");
  assert.equal(multiSchema.additionalProperties, false);
  assert.equal(Array.isArray(multiSchema.oneOf), true);
  assert.equal(multiSchema.oneOf?.length, 2);
  assert.equal(JSON.stringify(projectedScript.inputSchema).includes("scriptKey"), true);
  assert.equal(JSON.stringify(projectedScript.inputSchema).includes("projection_script"), true);
  assert.equal(
    JSON.stringify(projectedScript.inputSchema).includes("second_projection_script"),
    true
  );
  assert.match(projectedScript.description ?? "", /Available scriptKeys/);
  assert.equal(
    projectRuntimeNativeTools(sandboxDisabledBundle, { activeScenarioScriptRefs }).tools.some(
      (tool) => tool.name === "script"
    ),
    false,
    "script must be omitted when sandbox is disabled even with Scenario-scoped refs"
  );
  const webSearch = projected.tools.find((tool) => tool.name === "web_search");
  const files = projected.tools.find((tool) => tool.name === "files");
  const exec = projected.tools.find((tool) => tool.name === "exec");
  const shell = projected.tools.find((tool) => tool.name === "shell");
  const imageGenerate = projected.tools.find((tool) => tool.name === "image_generate");
  const imageEdit = projected.tools.find((tool) => tool.name === "image_edit");
  const document = projected.tools.find((tool) => tool.name === "document");
  const presentation = projected.tools.find((tool) => tool.name === "presentation");
  const scheduledAction = projected.tools.find((tool) => tool.name === "scheduled_action");
  const backgroundTask = projected.tools.find((tool) => tool.name === "background_task");
  const tts = projected.tools.find((tool) => tool.name === "tts");
  const browser = projected.tools.find((tool) => tool.name === "browser");
  const routeControl = projected.tools.find((tool) => tool.name === "route_control");
  const grep = projected.tools.find((tool) => tool.name === "grep");
  const glob = projected.tools.find((tool) => tool.name === "glob");
  const todoWrite = projected.tools.find((tool) => tool.name === "todo_write");

  assert.ok(webSearch, "web_search should be projected when enabled and configured");
  assert.ok(browser, "browser should be projected when enabled and configured");
  // ADR-125 Slice 1 — todo_write is projected when the bundle policy is
  // enabled + visibleToModel + usageRule=allowed + executionMode=inline.
  assert.ok(todoWrite, "todo_write should be projected when policy enabled + inline");
  const todoWriteSchema = todoWrite?.inputSchema as {
    required?: string[];
    additionalProperties?: boolean;
    properties?: {
      action?: { enum?: string[] };
      items?: { type?: string };
      id?: { type?: string };
    };
  };
  assert.deepEqual(todoWriteSchema.properties?.action?.enum?.slice().sort(), [
    "add",
    "clear",
    "complete",
    "remove",
    "update"
  ]);
  assert.equal(todoWriteSchema.required?.[0], "action");
  assert.equal(todoWriteSchema.additionalProperties, false);
  assert.match(todoWrite?.description ?? "", /Open the plan on the first turn|multi-step work/);
  const browserSchema = browser?.inputSchema as {
    properties?: {
      action?: { description?: string };
      displayName?: { description?: string };
      profile?: { description?: string };
      format?: { description?: string };
      operations?: {
        description?: string;
        items?: {
          properties?: {
            selector?: { description?: string };
            x?: { description?: string };
          };
        };
      };
    };
  };
  const browserActionDescription = browserSchema.properties?.action?.description ?? "";
  const browserDisplayNameDescription = browserSchema.properties?.displayName?.description ?? "";
  const browserProfileDescription = browserSchema.properties?.profile?.description ?? "";
  const browserOperationsDescription = browserSchema.properties?.operations?.description ?? "";
  const browserSelectorDescription =
    browserSchema.properties?.operations?.items?.properties?.selector?.description ?? "";
  const browserFormatDescription = browserSchema.properties?.format?.description ?? "";
  const browserClickAtXDescription =
    browserSchema.properties?.operations?.items?.properties?.x?.description ?? "";
  const browserSchemaText = [
    browserActionDescription,
    browserDisplayNameDescription,
    browserProfileDescription,
    browserOperationsDescription,
    browserSelectorDescription,
    browserFormatDescription,
    browserClickAtXDescription
  ].join("\n");
  assert.match(
    browserActionDescription,
    /Runtime chooses the backend/i,
    "browser action schema must say runtime chooses the backend"
  );
  assert.match(
    browserActionDescription,
    /page\.elements/i,
    "browser action schema must teach that profile-backed text results may return page.elements"
  );
  assert.doesNotMatch(
    browserActionDescription,
    /Assistant is working!|page is locked for user input/i,
    "browser action schema must not narrate overlay/observer UX"
  );
  assert.match(
    browserActionDescription,
    /Use "request_user_action" only for an explicit manual step/i,
    "browser action schema must reserve handoff for an explicit model decision"
  );
  assert.match(
    browserDisplayNameDescription,
    /do not promise raw URLs/i,
    "browser login schema must forbid promising raw login URLs in chat"
  );
  assert.match(
    browserProfileDescription,
    /Prefer selectors from page\.elements/i,
    "browser profile schema must tell the model to reuse page.elements selectors"
  );
  assert.match(
    browserOperationsDescription,
    /Prefer selectors from the latest page\.elements/i,
    "browser operations schema must prefer selectors copied from page.elements"
  );
  assert.match(
    browserOperationsDescription,
    /request_user_action/i,
    "browser operations schema must mention the explicit user-action handoff"
  );
  assert.doesNotMatch(
    browserOperationsDescription,
    /populate cards once scrolled|empty right after navigation/i,
    "browser operations schema must not embed empty-listing SPA heuristics"
  );
  assert.match(
    browserOperationsDescription,
    /ordered steps in one call/i,
    "browser operations schema must teach that multiple steps run in one act call"
  );
  assert.match(
    browserOperationsDescription,
    /wait_for_selector in the same act/i,
    "browser operations schema must teach wait_for_selector as an in-act dependency mechanic"
  );
  assert.match(
    browserOperationsDescription,
    /files\.preview/i,
    "browser operations schema must teach files.preview before click_at"
  );
  assert.match(
    browserOperationsDescription,
    /1280x720/i,
    "browser operations schema must pin the viewport size for coordinate clicks"
  );
  assert.match(
    browserFormatDescription,
    /1280x720/i,
    "browser format schema must document viewport size for png coordinate mapping"
  );
  assert.match(
    browserClickAtXDescription,
    /files\.preview/i,
    "browser click_at x schema must reference files.preview"
  );
  assert.match(
    browserSelectorDescription,
    /Prefer page\.elements/i,
    "browser selector schema must reinforce page.elements selector reuse"
  );
  assert.match(
    browserSelectorDescription,
    /Optional for scroll: scrolls that element into view/i,
    "browser selector schema must document optional scroll-into-view semantics"
  );
  assert.doesNotMatch(
    browserSchemaText,
    /\bliveUrl\b/,
    "browser projection schema must not expose the internal liveUrl field name"
  );
  assert.doesNotMatch(
    browserSchemaText,
    /Browserless|proxy|stealth|BQL/i,
    "browser projection schema must not preserve persistent Browserless guidance"
  );
  assert.equal(routeControl, undefined);
  // ADR-123 Slice 7 — grep/glob inline workspace tools are projected when the
  // policy is enabled + inline.
  assert.ok(grep, "grep should be projected when policy enabled + inline");
  assert.ok(glob, "glob should be projected when policy enabled + inline");
  assert.equal(
    (grep?.inputSchema as { required?: string[] })?.required?.[0],
    "pattern",
    "grep schema requires pattern"
  );
  assert.equal(
    (glob?.inputSchema as { required?: string[] })?.required?.[0],
    "pattern",
    "glob schema requires pattern"
  );
  assert.match(grep?.description ?? "", /content search/i);
  assert.match(glob?.description ?? "", /filename/i);
  // ADR-123 Slice 7 — shell description must no longer steer away ("reserve
  // shell" / "prefer files") and must not point search at shell.
  assert.doesNotMatch(shell?.description ?? "", /reserve shell|prefer the .?files/i);
  assert.equal(
    webSearch?.description,
    "Search the public web for current external facts.\nUse this when the answer depends on recent external information or links. May be called in parallel with other independent searches."
  );
  assert.match(files?.description ?? "", /runtime prepends the real current session root/i);
  assert.match(files?.description ?? "", /must not construct assistant\/session IDs/i);
  assert.match(files?.description ?? "", /files\(\{action:'preview', path\}\)|action="preview"/i);
  assert.match(files?.description ?? "", /current.user message|current-message/i);
  // ADR-130 Slice 2: the anti-reconstruct rule is owned by the (within-cap)
  // model description; the longer guidance restatement ("Do not reconstruct
  // upload paths…") falls past TOOL_DESCRIPTION_CAP after the ownership move and
  // is intentionally not asserted here (descriptor slimming is Slice 3).
  assert.match(files?.description ?? "", /never reconstruct paths from displayName\/filename/);
  // The exact `report (1).pdf` example can fall past TOOL_DESCRIPTION_CAP after
  // catalog-owner edits, but the within-cap collision guarantee must remain.
  assert.match(files?.description ?? "", /collision-safe by default/i);
  // Within-cap replace-semantics owner (the guidance restatement "Pass replace:
  // true on files.write" falls past TOOL_DESCRIPTION_CAP after the ownership move).
  assert.match(files?.description ?? "", /`replace: true` as the exact-overwrite opt-in/i);
  assert.doesNotMatch(files?.description ?? "", /\/workspace\/<filename>/);
  assert.doesNotMatch(files?.description ?? "", /\/workspace\/input/);
  assert.doesNotMatch(files?.description ?? "", /\/workspace\/outbound/);
  assert.doesNotMatch(
    files?.description ?? "",
    /scope:"assistant"|workspace_shared|crossScope:true/
  );
  // ADR-126 v3 D6 + ADR-134 — files surface includes search for path-keyed lookup.
  assert.doesNotMatch(files?.description ?? "", /write.and.send|files\.send/);
  assert.doesNotMatch(files?.description ?? "", /fileRef|alias|relativePath/);
  assert.ok(
    Array.isArray(
      (files?.inputSchema as { properties?: { action?: { enum?: unknown[] } } })?.properties?.action
        ?.enum
    )
  );
  const filesActionEnum =
    (files?.inputSchema as { properties?: { action?: { enum?: unknown[] } } })?.properties?.action
      ?.enum ?? [];
  assert.ok(filesActionEnum.includes("list"), "files enum must include list");
  assert.ok(filesActionEnum.includes("read"), "files enum must include read");
  assert.ok(filesActionEnum.includes("preview"), "files enum must include preview");
  assert.ok(filesActionEnum.includes("write"), "files enum must include write");
  assert.ok(filesActionEnum.includes("delete"), "files enum must include delete");
  // ADR-126 v3 Slice 4 — attach is part of the files surface, not a separate tool.
  assert.ok(filesActionEnum.includes("attach"), "files enum must include attach");
  assert.ok(
    !filesActionEnum.includes("write_and_send"),
    "files enum must not include write_and_send"
  );
  assert.ok(!filesActionEnum.includes("send"), "files enum must not include send");
  assert.ok(filesActionEnum.includes("search"), "files enum must include search");
  const filesActionDescription =
    (files?.inputSchema as { properties?: { action?: { description?: string } } })?.properties
      ?.action?.description ?? "";
  assert.match(filesActionDescription, /`write` persists only|action="search"/i);
  assert.match(filesActionDescription, /`attach` delivers/i);
  const filesProperties = (
    files?.inputSchema as {
      properties?: {
        path?: { description?: string };
        dir?: { description?: string };
        content?: { description?: string };
        mode?: { description?: string };
        replace?: { type?: string; description?: string };
        maxBytes?: { description?: string };
        maxDepth?: { description?: string };
        query?: { type?: string; description?: string };
      };
    }
  )?.properties;
  assert.match(filesProperties?.path?.description ?? "", /exact `\/workspace\/\.\.\.` paths/i);
  assert.match(filesProperties?.content?.description ?? "", /write/i);
  assert.equal(filesProperties?.replace?.type, "boolean");
  assert.match(filesProperties?.mode?.description ?? "", /create_only/i);
  assert.doesNotMatch(filesProperties?.mode?.description ?? "", /legacy/i);
  assert.doesNotMatch(filesProperties?.mode?.description ?? "", /overwrite/i);
  assert.match(filesProperties?.replace?.description ?? "", /exact-overwrite flag/i);
  assert.equal(
    filesProperties?.["alias" as keyof typeof filesProperties],
    undefined,
    "files schema must not have alias property"
  );
  assert.equal(
    filesProperties?.query?.type,
    "string",
    "files schema must have query string property"
  );
  assert.match(
    filesProperties?.query?.description ?? "",
    /action="search"|path|filename|shortDescription/i
  );
  assert.match(filesActionDescription, /`search` requires `query`/i);
  assert.match(exec?.description ?? "", /assistant sandbox workspace/);
  assert.doesNotMatch(exec?.description ?? "", /same turn stay mounted/i);
  assert.match(shell?.description ?? "", /assistant sandbox workspace/);
  assert.doesNotMatch(shell?.description ?? "", /same turn stay mounted/i);
  const imageGenerateBackground = (
    imageGenerate?.inputSchema as {
      properties?: { background?: { enum?: unknown[]; description?: string } };
    }
  )?.properties?.background;
  assert.deepEqual(imageGenerateBackground?.enum, ["auto", "transparent", "opaque"]);
  assert.match(imageGenerateBackground?.description ?? "", /PNG with alpha/);
  assert.match(
    imageGenerate?.description ?? "",
    /count=N means N separate final images in this one job/
  );
  assert.doesNotMatch(
    imageGenerate?.description ?? "",
    /not a collage|contact sheet|diptych|triptych/,
    "image_generate model-facing description must not contain provider-hygiene collage clause"
  );
  assert.match(imageGenerate?.description ?? "", /outputMode='series'/);
  assert.match(imageGenerate?.description ?? "", /seriesItems/);
  assert.match(
    imageGenerate?.description ?? "",
    /For distinct carousel\/slideshow\/frame requests, set outputMode='series'/i
  );
  // ADR-119 Slice 7 / ADR-117: cross-tool prose removed from per-tool projection hint.
  // ADR-130 Slice 4: the pending_delivery honesty rule itself now lives solely in the
  // always-on DELIVERY_HONESTY_CONTRACT dev-tail (see turn-execution.service.test.ts /
  // deferred-media-acknowledgement.test.ts); the per-tool hint keeps only the
  // tool-specific quota/plan-limit and quota_status pointer.
  assert.match(
    imageGenerate?.description ?? "",
    /action='skipped'.*quota or plan limit.*use that guidance in the reply/i
  );
  assert.match(imageGenerate?.description ?? "", /call quota_status for image_generate/);
  assert.doesNotMatch(
    imageGenerate?.description ?? "",
    /acknowledge only that/i,
    "ADR-130 Slice 4: verbatim pending-delivery honesty paragraph must not be duplicated per-tool"
  );
  const imageEditBackground = (
    imageEdit?.inputSchema as {
      properties?: { background?: { enum?: unknown[]; description?: string } };
    }
  )?.properties?.background;
  assert.match(
    imageEdit?.description ?? "",
    /Do not claim the edit is done, ready, visible, attached, or sent/
  );
  assert.match(imageEdit?.description ?? "", /actually called image_edit/);
  assert.match(
    imageEdit?.description ?? "",
    /count=N means N separate final edited images in this one job/
  );
  assert.doesNotMatch(
    imageEdit?.description ?? "",
    /not a collage|contact sheet|diptych|triptych/,
    "image_edit model-facing description must not contain provider-hygiene collage clause"
  );
  assert.match(imageEdit?.description ?? "", /outputMode='series'/);
  assert.match(imageEdit?.description ?? "", /seriesItems/);
  assert.match(
    imageEdit?.description ?? "",
    /For distinct carousel\/slideshow\/frame requests, set outputMode='series'/i
  );
  assert.match(imageEdit?.description ?? "", /same source product\/object identity across slides/i);
  // ADR-130 Slice 4: honesty rule owned solely by the dev-tail DELIVERY_HONESTY_CONTRACT;
  // the per-tool hint keeps only the quota/plan-limit and quota_status pointer.
  assert.match(
    imageEdit?.description ?? "",
    /action='skipped'.*quota or plan limit.*use that guidance in the reply/i
  );
  assert.match(imageEdit?.description ?? "", /call quota_status for image_edit/);
  assert.doesNotMatch(
    imageEdit?.description ?? "",
    /acknowledge only that/i,
    "ADR-130 Slice 4: verbatim pending-delivery honesty paragraph must not be duplicated per-tool"
  );
  assert.deepEqual(imageEditBackground?.enum, ["auto", "transparent", "opaque"]);
  assert.match(imageEditBackground?.description ?? "", /remove background/);
  const videoGenerate = projected.tools.find((tool) => tool.name === "video_generate");
  if (videoGenerate !== undefined) {
    assert.match(
      videoGenerate.description ?? "",
      /do not ask a follow-up only to fill those fields/i
    );
    const videoGenerateSchema = videoGenerate.inputSchema as {
      required?: string[];
      properties?: {
        size?: { description?: string };
        seconds?: { description?: string };
        referenceImageAlias?: { description?: string };
        voiceKeys?: { description?: string };
      };
    };
    assert.equal(
      videoGenerateSchema.required,
      undefined,
      "Slice 3: prompt must no longer be globally required because read-only actions omit it"
    );
    assert.match(
      videoGenerateSchema.properties?.size?.description ?? "",
      /Cinematic-only optional output size\/aspect hint/i
    );
    assert.match(
      videoGenerateSchema.properties?.size?.description ?? "",
      /Omit when mode='talking_avatar'/i
    );
    assert.match(
      videoGenerateSchema.properties?.seconds?.description ?? "",
      /Cinematic-only optional output duration/i
    );
    assert.match(
      videoGenerateSchema.properties?.seconds?.description ?? "",
      /HeyGen talking-avatar duration follows speechText length/i
    );
    // ADR-130 Slice 4: honesty rule owned solely by the dev-tail DELIVERY_HONESTY_CONTRACT;
    // the per-tool hint keeps only the quota/plan-limit and quota_status pointer.
    assert.match(
      videoGenerate.description ?? "",
      /action='skipped'.*quota or plan limit.*use that guidance in the reply/i
    );
    assert.match(videoGenerate.description ?? "", /call quota_status for video_generate/);
    assert.doesNotMatch(
      videoGenerate.description ?? "",
      /acknowledge only that/i,
      "ADR-130 Slice 4: verbatim pending-delivery honesty paragraph must not be duplicated per-tool"
    );
    const videoGenerateReferenceImageAlias = videoGenerateSchema.properties?.referenceImageAlias;
    assert.match(
      videoGenerateReferenceImageAlias?.description ?? "",
      /only when the user explicitly identifies or selects a specific available image alias/i
    );
    assert.match(
      videoGenerateReferenceImageAlias?.description ?? "",
      /upstream structured UI\/tool has already provided that alias/i
    );
    assert.match(
      videoGenerateReferenceImageAlias?.description ?? "",
      /Do not guess or infer aliases heuristically from context/i
    );
    assert.match(
      videoGenerateReferenceImageAlias?.description ?? "",
      /otherwise omit this field so runtime uses text-to-video/i
    );
    assert.match(
      videoGenerateSchema.properties?.voiceKeys?.description ?? "",
      /PersAI voice keys/i
    );
    assert.match(
      videoGenerateSchema.properties?.voiceKeys?.description ?? "",
      /action="list_voices"/i
    );
    assert.match(
      videoGenerate.description ?? "",
      /action="describe_avatar_mode", "list_personas", or "list_voices"/i
    );
    assert.doesNotMatch(videoGenerate.description ?? "", /Available voiceKeys/i);
    assert.doesNotMatch(videoGenerate.description ?? "", /\bowen\b/i);
  }
  assert.ok(videoGenerate, "video_generate should be projected for configured Runway refs");

  // ADR-105 FIX A: count.maximum cascade — with perTurnCap=2, image_generate
  // must advertise count.maximum=2 (not old hardcap 4). With no perTurnCap,
  // image_edit must fall back to MAX_RUNTIME_IMAGE_GENERATE_COUNT=10.
  const imageGenerateCount = (
    imageGenerate?.inputSchema as {
      properties?: { count?: { maximum?: number; minimum?: number; description?: string } };
    }
  )?.properties?.count;
  assert.equal(
    imageGenerateCount?.maximum,
    2,
    "FIX A: image_generate count.maximum must equal perTurnCap=2, NOT old hardcap 4"
  );
  assert.equal(imageGenerateCount?.minimum, 1);
  assert.match(imageGenerateCount?.description ?? "", /1\.\.2/);
  const imageGenerateOutputMode = (
    imageGenerate?.inputSchema as {
      properties?: {
        outputMode?: { enum?: unknown[]; description?: string };
        seriesItems?: { type?: string };
      };
    }
  )?.properties;
  assert.deepEqual(imageGenerateOutputMode?.outputMode?.enum, ["variants", "series"]);
  assert.equal(imageGenerateOutputMode?.seriesItems?.type, "array");
  assert.match(
    imageGenerateOutputMode?.outputMode?.description ?? "",
    /Default to series for any multi-image request/i
  );

  const imageEditCount = (
    imageEdit?.inputSchema as {
      properties?: { count?: { maximum?: number; minimum?: number; description?: string } };
    }
  )?.properties?.count;
  assert.equal(
    imageEditCount?.maximum,
    10,
    "FIX A: image_edit count.maximum must equal MAX_RUNTIME_IMAGE_GENERATE_COUNT=10 when perTurnCap is unset"
  );
  assert.equal(imageEditCount?.minimum, 1);
  const imageEditOutputMode = (
    imageEdit?.inputSchema as {
      properties?: {
        outputMode?: { enum?: unknown[]; description?: string };
        seriesItems?: { type?: string };
      };
    }
  )?.properties;
  assert.deepEqual(imageEditOutputMode?.outputMode?.enum, ["variants", "series"]);
  assert.equal(imageEditOutputMode?.seriesItems?.type, "array");
  assert.match(
    imageEditOutputMode?.outputMode?.description ?? "",
    /Default to series for any multi-image edit request/i
  );

  // ADR-105 FIX A: with perTurnCap=10 the model sees count.maximum=10 — one job, no split.
  {
    const bundleCap10 = {
      ...artifact.bundle,
      governance: {
        ...artifact.bundle.governance,
        toolPolicies: artifact.bundle.governance.toolPolicies.map((p) =>
          p.toolCode === "image_generate" ? { ...p, perTurnCap: 10 } : p
        )
      }
    };
    const projectedCap10 = projectRuntimeNativeTools(bundleCap10);
    const gen10 = projectedCap10.tools.find((t) => t.name === "image_generate");
    const gen10Count = (
      gen10?.inputSchema as {
        properties?: { count?: { maximum?: number } };
      }
    )?.properties?.count;
    assert.equal(
      gen10Count?.maximum,
      10,
      "FIX A: perTurnCap=10 must yield count.maximum=10 — one job, no split"
    );
  }
  assert.ok(document, "document should be projected when enabled and configured");
  assert.ok(presentation, "presentation should be projected when enabled and configured");
  assert.ok(backgroundTask, "background_task should be projected when enabled");
  assert.ok(tts, "tts should be projected when configured");
  const documentProperties = (
    document?.inputSchema as {
      properties?: {
        action?: { enum?: unknown[]; description?: string };
        path?: { description?: string };
        mode?: { enum?: unknown[]; description?: string };
        outputDir?: { description?: string };
        depth?: { enum?: unknown[]; description?: string };
        projectPath?: { description?: string };
        format?: { enum?: unknown[]; description?: string };
        entrypoint?: { description?: string };
        content?: { description?: string };
        contentPath?: { description?: string };
        style?: { enum?: unknown[] };
        template?: { description?: string; properties?: Record<string, unknown> };
        targetFormat?: { enum?: unknown[] };
        edits?: {
          description?: string;
          items?: { properties?: { op?: { enum?: unknown[] } } };
        };
        rerender?: { type?: string; description?: string };
        requestedName?: { description?: string };
        replace?: { type?: string; description?: string };
        descriptorMode?: { enum?: unknown[]; description?: string };
        docId?: { description?: string };
      };
    }
  )?.properties;
  assert.deepEqual(documentProperties?.action?.enum, ["describe", "inspect", "render", "convert"]);
  assert.match(documentProperties?.action?.description ?? "", /describe|inspect|render|convert/i);
  assert.match(documentProperties?.path?.description ?? "", /inspect/i);
  assert.equal(documentProperties?.mode, undefined);
  assert.equal(documentProperties?.outputDir, undefined);
  assert.doesNotMatch(document?.description ?? "", /\/workspace\/projects\//);
  assert.equal(documentProperties?.depth, undefined);
  assert.equal(documentProperties?.projectPath, undefined);
  assert.deepEqual(documentProperties?.format?.enum, ["pdf", "xlsx", "docx"]);
  assert.equal(documentProperties?.entrypoint, undefined);
  assert.match(documentProperties?.content?.description ?? "", /Markdown|contentPath/i);
  assert.match(documentProperties?.contentPath?.description ?? "", /Markdown source path/i);
  assert.match(documentProperties?.template?.description ?? "", /DOCX template/i);
  assert.equal(documentProperties?.template?.properties, undefined);
  assert.deepEqual(documentProperties?.style?.enum, ["default", "report", "minimal"]);
  assert.deepEqual(documentProperties?.targetFormat?.enum, ["pdf", "xlsx", "docx"]);
  assert.match(documentProperties?.requestedName?.description ?? "", /filename|render|convert/i);
  assert.equal(documentProperties?.replace, undefined);
  assert.equal(documentProperties?.descriptorMode, undefined);
  assert.match(
    document?.description ?? "",
    /action="inspect"|action="render"|action="convert"|files\.attach/i
  );
  assert.match(
    document?.description ?? "",
    /sibling `\.md` file next to the output|requestedName/s,
    "document guidance must teach authored render plus source-markdown collocation"
  );
  assert.match(
    document?.description ?? "",
    /complex XLSX|python-docx|openpyxl|weasyprint/i,
    "document guidance must teach the shell+python escape hatch"
  );
  assert.match(
    document?.description ?? "",
    /targetFormat|derive it from the source basename/i,
    "document guidance must teach convert defaults"
  );
  assert.match(
    `${document?.description ?? ""}\n${presentation?.description ?? ""}`,
    /slide decks|presentation/i,
    "document guidance must steer ordinary PDF work away from presentation"
  );
  assert.doesNotMatch(
    document?.description ?? "",
    /create_pdf_document|create_data_document|create_presentation|descriptorMode=create_presentation/i,
    "document description must not advertise presentation modes"
  );
  assert.doesNotMatch(
    document?.description ?? "",
    /document\.extract|document\.edit|document\.register_version|\bentrypoint\b|render\/content\.md|build\.py|export_pdf\.py|visible workspace loop/i,
    "document description must not advertise retired document workflow terms"
  );
  assert.doesNotMatch(
    document?.description ?? "",
    /async document providers|PDFMonkey|\/workspace\/input|\/workspace\/outbound/i,
    "tool description must not teach retired provider or namespace wording"
  );
  const presentationProperties = (
    presentation?.inputSchema as {
      required?: string[];
      properties?: {
        descriptorMode?: { enum?: unknown[]; description?: string };
        outputFormat?: { enum?: unknown[]; description?: string };
        docId?: { description?: string };
        storagePath?: { description?: string };
        visualStyle?: { enum?: unknown[]; description?: string };
        imagePolicy?: { enum?: unknown[]; description?: string };
        visualDensity?: { enum?: unknown[]; description?: string };
      };
    }
  )?.properties;
  assert.deepEqual(presentation?.inputSchema?.required ?? [], ["descriptorMode", "prompt"]);
  assert.deepEqual(presentationProperties?.descriptorMode?.enum, [
    "create_presentation",
    "revise_document",
    "export_or_redeliver"
  ]);
  assert.match(
    presentation?.description ?? "",
    /slide deck/i,
    "presentation description must be deck-specific"
  );
  assert.match(
    presentation?.description ?? "",
    /create_presentation|slide decks only/i,
    "presentation description must stay on deferred deck modes"
  );
  // ADR-130 Slice 4: honesty rule owned solely by the dev-tail DELIVERY_HONESTY_CONTRACT;
  // the per-tool hint keeps only the quota/plan-limit, quota_status pointer, and the
  // presentation-specific no-duplicate-delivery note.
  assert.match(
    presentation?.description ?? "",
    /action='skipped'.*quota or plan limit.*use that guidance in the reply/i
  );
  assert.match(presentation?.description ?? "", /call quota_status for document/);
  assert.match(presentation?.description ?? "", /already routed to the user once it finishes/i);
  assert.doesNotMatch(
    presentation?.description ?? "",
    /acknowledge only that/i,
    "ADR-130 Slice 4: verbatim pending-delivery honesty paragraph must not be duplicated per-tool"
  );
  assert.deepEqual(presentationProperties?.outputFormat?.enum, ["pdf", "pptx"]);
  assert.match(presentationProperties?.docId?.description ?? "", /presentation document UUID/);
  assert.match(
    presentationProperties?.storagePath?.description ?? "",
    /Presentation-revision locator/i
  );
  assert.deepEqual(presentationProperties?.visualStyle?.enum, [
    "professional_modern",
    "bold_editorial",
    "minimal_clean",
    "illustrated_storytelling"
  ]);
  assert.deepEqual(presentationProperties?.imagePolicy?.enum, [
    "ai_generated",
    "web_free_to_use",
    "pictographic",
    "text_only"
  ]);
  assert.deepEqual(presentationProperties?.visualDensity?.enum, [
    "balanced",
    "visual_heavy",
    "text_heavy"
  ]);
  assert.match(presentationProperties?.visualStyle?.description ?? "", /presentation-only/i);
  assert.match(presentationProperties?.imagePolicy?.description ?? "", /visual deck/);
  assert.match(presentationProperties?.visualDensity?.description ?? "", /denser slide copy/);
  assert.doesNotMatch(
    presentation?.description ?? "",
    /file_ref/,
    "presentation description must not use snake_case file_ref"
  );
  const scheduledActionKindDescription = (
    scheduledAction?.inputSchema as {
      properties?: {
        kind?: { description?: string };
      };
    }
  )?.properties?.kind?.description;
  assert.match(scheduledAction?.description ?? "", /user-visible reminders/i);
  assert.doesNotMatch(scheduledAction?.description ?? "", /hidden assistant follow-ups?/i);
  assert.match(scheduledActionKindDescription ?? "", /user_reminder/);
  assert.match(scheduledActionKindDescription ?? "", /background_task/);
  const backgroundTaskActionEnum = (
    backgroundTask?.inputSchema as {
      properties?: { action?: { enum?: unknown[] } };
    }
  )?.properties?.action?.enum;
  assert.deepEqual(backgroundTaskActionEnum, [
    "describe",
    "create",
    "list",
    "pause",
    "resume",
    "cancel"
  ]);
  assert.match(backgroundTask?.description ?? "", /quiet assistant-side background tasks/i);
  assert.doesNotMatch(backgroundTask?.description ?? "", /\bupdate\b/i);
  assert.match(tts?.description ?? "", /spoken reply or voice note/i);
  assert.match(tts?.description ?? "", /returns action='generated'/i);

  const nonOpenAiImageBundle = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolCredentialRefs: {
        ...artifact.bundle.governance.toolCredentialRefs,
        image_generate: {
          ...artifact.bundle.governance.toolCredentialRefs.image_generate!,
          providerId: "runway"
        },
        image_edit: {
          ...artifact.bundle.governance.toolCredentialRefs.image_edit!,
          providerId: "kling"
        }
      }
    }
  };
  const nonOpenAiImageProjection = projectRuntimeNativeTools(nonOpenAiImageBundle);
  assert.equal(
    nonOpenAiImageProjection.tools.find((tool) => tool.name === "image_generate"),
    undefined,
    "image_generate must remain hidden for non-OpenAI providers"
  );
  assert.equal(
    nonOpenAiImageProjection.tools.find((tool) => tool.name === "image_edit"),
    undefined,
    "image_edit must remain hidden for non-OpenAI providers"
  );

  // ADR-109 Slice 2b: talking_avatar provider rows must be filtered from cinematic video_generate surface
  const heygenVideoBundle = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolCredentialRefs: {
        ...artifact.bundle.governance.toolCredentialRefs,
        video_generate: {
          ...artifact.bundle.governance.toolCredentialRefs.video_generate!,
          providerId: "heygen"
        }
      }
    }
  };
  const heygenVideoProjection = projectRuntimeNativeTools(heygenVideoBundle);
  assert.equal(
    heygenVideoProjection.tools.find((tool) => tool.name === "video_generate"),
    undefined,
    "video_generate must be hidden for talking_avatar (heygen) providers on the cinematic surface"
  );

  // Runway (cinematic) must still appear after the filter
  const runwayVideoProjection = projectRuntimeNativeTools(artifact.bundle);
  assert.ok(
    runwayVideoProjection.tools.find((tool) => tool.name === "video_generate"),
    "video_generate must remain visible for cinematic (runway) providers"
  );

  // ── ADR-109 Slice 8 — talkingVideoEnabled gates the talking-avatar schema fields ──

  // HeyGen + talkingVideoEnabled=true → tool IS projected with talking-avatar fields.
  // ADR-109 Slice 10c Fix #3f: video_generate_talking_avatar credential must be present
  // for talking-avatar schema fields (mode/speechText etc.) to appear in the projection.
  const heygenTalkingEnabledBundle = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolCredentialRefs: {
        ...artifact.bundle.governance.toolCredentialRefs,
        video_generate: {
          ...artifact.bundle.governance.toolCredentialRefs.video_generate!,
          providerId: "heygen"
        },
        video_generate_talking_avatar: {
          ...artifact.bundle.governance.toolCredentialRefs.video_generate!,
          providerId: "heygen"
        }
      },
      toolPolicies: artifact.bundle.governance.toolPolicies.map((p) =>
        p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: true } : p
      )
    }
  };
  const heygenTalkingProjection = projectRuntimeNativeTools(heygenTalkingEnabledBundle);
  const heygenTalkingTool = heygenTalkingProjection.tools.find(
    (tool) => tool.name === "video_generate"
  );
  assert.ok(
    heygenTalkingTool,
    "Slice 8: video_generate must be projected for heygen when talkingVideoEnabled=true"
  );
  const heygenTalkingProps = (
    heygenTalkingTool?.inputSchema as { properties?: Record<string, unknown> }
  )?.properties;
  assert.ok(
    heygenTalkingProps?.mode,
    "Slice 8: mode field must appear in schema when talkingVideoEnabled=true"
  );
  assert.ok(
    heygenTalkingProps?.speechText,
    "Slice 8: speechText field must appear in schema when talkingVideoEnabled=true"
  );
  assert.ok(
    heygenTalkingProps?.speechLanguage,
    "Slice 8: speechLanguage field must appear in schema when talkingVideoEnabled=true"
  );
  assert.ok(
    heygenTalkingProps?.personaId,
    "Slice 8: personaId field must appear in schema when talkingVideoEnabled=true"
  );
  assert.ok(
    heygenTalkingProps?.portraitImageAlias,
    "Slice 8: portraitImageAlias field must appear in schema when talkingVideoEnabled=true"
  );
  assert.ok(
    heygenTalkingProps?.voiceKey,
    "Slice 8: voiceKey field must appear in schema when talkingVideoEnabled=true"
  );
  assert.ok(
    heygenTalkingProps?.talkingAvatarAspectRatio,
    "Slice 8: talkingAvatarAspectRatio field must appear in schema when talkingVideoEnabled=true"
  );
  assert.match(
    heygenTalkingTool?.description ?? "",
    /talking-avatar/i,
    "Slice 8: description must mention talking-avatar when talkingVideoEnabled=true"
  );
  assert.match(
    String(
      (heygenTalkingProps?.talkingAvatarAspectRatio as { description?: string } | undefined)
        ?.description ?? ""
    ),
    /aspect ratio|portraitImageAlias/i,
    "Slice 8: schema must explain talkingAvatarAspectRatio when talkingVideoEnabled=true"
  );

  // Runway + talkingVideoEnabled=false → tool IS projected but WITHOUT talking-avatar fields
  const runwayTalkingDisabledBundle = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolPolicies: artifact.bundle.governance.toolPolicies.map((p) =>
        p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: false } : p
      )
    }
  };
  const runwayTalkingDisabledProjection = projectRuntimeNativeTools(runwayTalkingDisabledBundle);
  const runwayTalkingDisabledTool = runwayTalkingDisabledProjection.tools.find(
    (tool) => tool.name === "video_generate"
  );
  assert.ok(
    runwayTalkingDisabledTool,
    "Slice 8: video_generate must still be projected for runway when talkingVideoEnabled=false"
  );
  const runwayTalkingDisabledProps = (
    runwayTalkingDisabledTool?.inputSchema as { properties?: Record<string, unknown> }
  )?.properties;
  assert.equal(
    runwayTalkingDisabledProps?.mode,
    undefined,
    "Slice 8: mode field must NOT appear in schema when talkingVideoEnabled=false"
  );
  assert.equal(
    runwayTalkingDisabledProps?.speechText,
    undefined,
    "Slice 8: speechText field must NOT appear in schema when talkingVideoEnabled=false"
  );
  assert.equal(
    runwayTalkingDisabledProps?.personaId,
    undefined,
    "Slice 8: personaId field must NOT appear in schema when talkingVideoEnabled=false"
  );
  assert.equal(
    runwayTalkingDisabledProps?.portraitImageAlias,
    undefined,
    "Slice 8: portraitImageAlias field must NOT appear in schema when talkingVideoEnabled=false"
  );
  assert.equal(
    runwayTalkingDisabledProps?.voiceKey,
    undefined,
    "Slice 8: voiceKey field must NOT appear in schema when talkingVideoEnabled=false"
  );
  assert.equal(
    runwayTalkingDisabledProps?.talkingAvatarAspectRatio,
    undefined,
    "Slice 8: talkingAvatarAspectRatio field must NOT appear in schema when talkingVideoEnabled=false"
  );
  assert.match(
    runwayTalkingDisabledTool?.description ?? "",
    /talking-avatar/i,
    "Slice 3: compact lazy-action pointer may still mention talking-avatar lookups when talking generation is disabled"
  );

  // talkingVideoEnabled absent (undefined) → same as false — cinematic-only schema
  const runwayNoToggleBundle = artifact.bundle;
  const runwayNoToggleProjection = projectRuntimeNativeTools(runwayNoToggleBundle);
  const runwayNoToggleTool = runwayNoToggleProjection.tools.find(
    (tool) => tool.name === "video_generate"
  );
  assert.ok(
    runwayNoToggleTool,
    "Slice 8: video_generate must be projected for runway when talkingVideoEnabled is absent"
  );
  const runwayNoToggleProps = (
    runwayNoToggleTool?.inputSchema as { properties?: Record<string, unknown> }
  )?.properties;
  assert.equal(
    runwayNoToggleProps?.mode,
    undefined,
    "Slice 8: mode must NOT appear when talkingVideoEnabled is absent (defaults to cinematic-only)"
  );
  assert.equal(
    runwayNoToggleProps?.speechText,
    undefined,
    "Slice 8: speechText must NOT appear when talkingVideoEnabled is absent"
  );

  // ── ADR-109 Slice 10 — persona catalog in tool description ──

  // Helper: build a HeyGen + talkingVideoEnabled bundle with a given personaCatalog.
  // ADR-109 Slice 10c Fix #3f: also adds video_generate_talking_avatar credential so
  // the projection includes talking-avatar fields (talkingAvatarEnabled=true).
  function makeHeygenTalkingBundle(
    videoPersonaCatalog:
      | {
          provider: "heygen";
          schema: "persai.runtimeVideoPersonaCatalog.v1";
          personas: Array<{
            personaId: string;
            displayName: string;
            voiceLabel: string;
          }>;
        }
      | null
      | undefined,
    voiceShortlist?: Array<{
      voiceKey: string;
      providerVoiceId: string;
      displayName: string;
      locale: string | null;
      gender: "male" | "female" | "neutral" | "unknown";
      description: string | null;
      styleTags: string[];
    }>
  ) {
    const baseRef = artifact.bundle.governance.toolCredentialRefs.video_generate!;
    const credentialRef = {
      ...baseRef,
      providerId: "heygen",
      ...(videoPersonaCatalog !== undefined ? { videoPersonaCatalog } : {}),
      ...(voiceShortlist !== undefined
        ? {
            videoVoiceCatalog: {
              provider: "heygen" as const,
              fetchedAt: "2026-06-05T12:00:00.000Z",
              shortlist: voiceShortlist
            }
          }
        : {})
    };
    // The talking-avatar credential ref mirrors the cinematic ref but is keyed separately.
    // Voice catalog + persona catalog live on this ref (Fix #3f).
    const talkingAvatarRef = {
      ...credentialRef
    };
    return {
      ...artifact.bundle,
      governance: {
        ...artifact.bundle.governance,
        toolCredentialRefs: {
          ...artifact.bundle.governance.toolCredentialRefs,
          video_generate: credentialRef,
          video_generate_talking_avatar: talkingAvatarRef
        },
        toolPolicies: artifact.bundle.governance.toolPolicies.map((p) =>
          p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: true } : p
        )
      }
    };
  }

  const PERSONA_A = {
    personaId: "01937c8a-0000-4000-8000-000000000001",
    displayName: "Маша",
    voiceLabel: "Brand Voice",
    presetVoiceLabel: "Russian (Female)",
    linkedClonedVoiceDisplayName: "Brand Voice"
  };
  const PERSONA_B = {
    personaId: "01937d12-0000-4000-8000-000000000002",
    displayName: "Anna",
    voiceLabel: "English (Female)"
  };
  const TWO_VOICE_SHORTLIST: Array<{
    voiceKey: string;
    providerVoiceId: string;
    displayName: string;
    locale: string | null;
    gender: "male" | "female" | "neutral" | "unknown";
    description: string | null;
    styleTags: string[];
  }> = [
    {
      voiceKey: "masha_voice",
      providerVoiceId: "voice-masha",
      displayName: "Masha",
      locale: "ru-RU",
      gender: "female",
      description: null,
      styleTags: []
    }
  ];

  // Case 1: talkingVideoEnabled=true keeps the mechanical schema but removes
  // inline persona/voice/tutorial payloads in favor of the lazy actions.
  const slice10TwoPersonasBundle = makeHeygenTalkingBundle(
    {
      provider: "heygen",
      schema: "persai.runtimeVideoPersonaCatalog.v1",
      personas: [PERSONA_A, PERSONA_B]
    },
    TWO_VOICE_SHORTLIST
  );
  const slice10TwoPersonasProjection = projectRuntimeNativeTools(slice10TwoPersonasBundle);
  const slice10TwoPersonasTool = slice10TwoPersonasProjection.tools.find(
    (t) => t.name === "video_generate"
  );
  assert.ok(slice10TwoPersonasTool, "Slice 10: tool must be projected for heygen+talkingEnabled");
  const slice10TwoPersonasSchema = slice10TwoPersonasTool?.inputSchema as {
    required?: string[];
    properties?: Record<string, { enum?: unknown[]; description?: string }>;
  };
  assert.equal(
    slice10TwoPersonasSchema.required,
    undefined,
    "Slice 3: prompt must no longer be globally required because read-only actions omit it"
  );
  assert.deepEqual(slice10TwoPersonasSchema.properties?.action?.enum, [
    "describe",
    "generate",
    "list_personas",
    "list_voices",
    "describe_avatar_mode"
  ]);
  assert.ok(
    typeof slice10TwoPersonasSchema.properties?.locale?.description === "string",
    "Slice 3: locale helper field must be exposed for list_voices"
  );
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /action="describe_avatar_mode", "list_personas", or "list_voices"/i,
    "Slice 3: compact lazy-action pointer must be present in the projected description"
  );
  assert.doesNotMatch(
    slice10TwoPersonasTool?.description ?? "",
    /Mode choice is strict|You cannot create personas yourself|Each video_generate call produces ONE clip with ONE speaker|Persona names are unique within a workspace|Available voiceKeys for voice_control|Available talking-avatar voiceKeys shortlist|linkedClonedVoiceLabel=|presetFallbackVoiceLabel=|displayName="Маша"|displayName="Anna"|Some saved personas use a linked cloned voice\./i,
    "Slice 3: heavy persona, voice, and talking-avatar tutorial content must not remain inline"
  );
  assert.doesNotMatch(
    slice10TwoPersonasTool?.description ?? "",
    new RegExp(`${PERSONA_A.personaId}|${PERSONA_B.personaId}`),
    "Slice 3: persona ids must no longer be inlined into the projected description"
  );

  // Case 2: talkingVideoEnabled=false still keeps the lazy pointer and action
  // enum, but omits the talking-avatar generation fields.
  const slice10TalkingDisabledBundle = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolCredentialRefs: {
        ...artifact.bundle.governance.toolCredentialRefs,
        video_generate: {
          ...artifact.bundle.governance.toolCredentialRefs.video_generate!,
          providerId: "runway"
        }
      },
      toolPolicies: artifact.bundle.governance.toolPolicies.map((p) =>
        p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: false } : p
      )
    }
  };
  const slice10TalkingDisabledTool = projectRuntimeNativeTools(
    slice10TalkingDisabledBundle
  ).tools.find((t) => t.name === "video_generate");
  assert.match(
    slice10TalkingDisabledTool?.description ?? "",
    /action="describe_avatar_mode", "list_personas", or "list_voices"/i,
    "Slice 3: compact lazy-action pointer must remain present even on cinematic-only projection"
  );
  assert.doesNotMatch(
    slice10TalkingDisabledTool?.description ?? "",
    /Mode choice is strict|You cannot create personas yourself|Available voiceKeys for voice_control|videoPersonas|linkedClonedVoiceLabel=|Some saved personas use a linked cloned voice\./i,
    "Slice 3: cinematic-only projection must not inline the removed talking-avatar or catalog content"
  );

  // Snapshot test: canonical fixture (talkingVideoEnabled=true, 1 voice, 2 personas)
  const snapshotBundle = makeHeygenTalkingBundle(
    {
      provider: "heygen",
      schema: "persai.runtimeVideoPersonaCatalog.v1",
      personas: [PERSONA_A, PERSONA_B]
    },
    TWO_VOICE_SHORTLIST
  );
  const snapshotTool = projectRuntimeNativeTools(snapshotBundle).tools.find(
    (t) => t.name === "video_generate"
  );
  assert.ok(
    (snapshotTool?.description?.length ?? 0) > 0,
    "Slice 10: snapshot description is non-empty"
  );
  // Stable sub-string assertions (stable across formatting changes):
  assert.ok(
    snapshotTool?.description?.includes(
      'action="describe_avatar_mode", "list_personas", or "list_voices"'
    ),
    "Slice 3 snapshot: contains the lazy-action pointer"
  );

  console.log("Slice 10 description char count:", snapshotTool?.description?.length ?? 0);

  // ── ADR-109 Slice 10c Fix #3f: projection tests for separate talking-avatar credential ──
  // The talking-avatar schema fields (mode/speechText etc.) are
  // now gated on toolCredentialRefs["video_generate_talking_avatar"] being present,
  // NOT on the cinematic credential's providerId or talkingVideoEnabled alone.

  // Slice 10c Projection Test 1: video_generate_talking_avatar present → talking-avatar
  // generation fields appear, but the description stays compact.
  const slice10cWithTalkingAvatarRef = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolCredentialRefs: {
        ...artifact.bundle.governance.toolCredentialRefs,
        video_generate: {
          ...artifact.bundle.governance.toolCredentialRefs.video_generate!,
          providerId: "runway"
        },
        video_generate_talking_avatar: {
          ...artifact.bundle.governance.toolCredentialRefs.video_generate!,
          providerId: "heygen",
          videoPersonaCatalog: {
            provider: "heygen" as const,
            schema: "persai.runtimeVideoPersonaCatalog.v1" as const,
            personas: [PERSONA_A]
          }
        }
      }
    }
  };
  const slice10cWithTalkingTool = projectRuntimeNativeTools(
    slice10cWithTalkingAvatarRef
  ).tools.find((t) => t.name === "video_generate");
  assert.ok(
    slice10cWithTalkingTool,
    "Slice 10c projection: video_generate must be projected when talking-avatar ref is present"
  );
  assert.match(
    slice10cWithTalkingTool?.description ?? "",
    /action="describe_avatar_mode", "list_personas", or "list_voices"/i,
    "Slice 3 projection: compact lazy-action pointer must appear when video_generate_talking_avatar ref is present"
  );
  assert.ok(
    (slice10cWithTalkingTool?.inputSchema as { properties?: Record<string, unknown> })?.properties
      ?.mode,
    "Slice 10c projection: mode field must appear in schema when video_generate_talking_avatar ref is present"
  );
  assert.ok(
    (slice10cWithTalkingTool?.inputSchema as { properties?: Record<string, unknown> })?.properties
      ?.speechText,
    "Slice 10c projection: speechText field must appear when video_generate_talking_avatar ref is present"
  );

  // Slice 10c Projection Test 2: video_generate_talking_avatar absent → description
  // stays compact and mode field is omitted.
  const slice10cWithoutTalkingAvatarRef = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolCredentialRefs: {
        ...artifact.bundle.governance.toolCredentialRefs,
        video_generate: {
          ...artifact.bundle.governance.toolCredentialRefs.video_generate!,
          providerId: "runway"
        }
        // video_generate_talking_avatar intentionally absent
      }
    }
  };
  const slice10cWithoutTalkingTool = projectRuntimeNativeTools(
    slice10cWithoutTalkingAvatarRef
  ).tools.find((t) => t.name === "video_generate");
  assert.ok(
    slice10cWithoutTalkingTool,
    "Slice 10c projection: video_generate must still be projected (cinematic still works)"
  );
  assert.match(
    slice10cWithoutTalkingTool?.description ?? "",
    /action="describe_avatar_mode", "list_personas", or "list_voices"/i,
    "Slice 3 projection: compact lazy-action pointer must remain present when video_generate_talking_avatar ref is absent"
  );
  assert.equal(
    (slice10cWithoutTalkingTool?.inputSchema as { properties?: Record<string, unknown> })
      ?.properties?.mode,
    undefined,
    "Slice 10c projection: mode field must NOT appear in schema when video_generate_talking_avatar ref is absent"
  );

  // ADR-118 Slice 2: skill tool projection tests.
  // When bundle has no skills.enabled, the skill tool must NOT appear.
  // (The fixture above has no skills in the bundle, so skill should be absent.)
  {
    const skillTool = projected.tools.find((t) => t.name === "skill");
    assert.equal(
      skillTool,
      undefined,
      "ADR-118 Slice 2: skill tool must NOT be projected when bundle has no enabled Skills"
    );
  }

  // When bundle has skills.enabled + a matching policy, the skill tool IS projected.
  {
    const bundleWithSkills = compileAssistantRuntimeBundle({
      effectiveRoleId: "role-test",
      metadata: artifact.bundle.metadata,
      persona: artifact.bundle.persona,
      userContext: artifact.bundle.userContext,
      runtime: artifact.bundle.runtime,
      governance: {
        ...artifact.bundle.governance,
        toolPolicies: [
          ...(artifact.bundle.governance.toolPolicies ?? []),
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
        ]
      },
      channels: artifact.bundle.channels,
      skills: {
        enabled: [
          {
            id: "skill-finance",
            name: "Finance",
            description: null,
            category: "general",
            tags: [],
            body: "",
            guardrails: [],
            examples: []
          }
        ]
      },
      promptDocuments: artifact.bundle.promptDocuments
    });

    const projectedWithSkill = projectRuntimeNativeTools(bundleWithSkills.bundle);
    const skillTool = projectedWithSkill.tools.find((t) => t.name === "skill");
    assert.ok(
      skillTool,
      "ADR-118 Slice 2: skill tool MUST be projected when bundle has at least one enabled Skill and a matching policy"
    );
    // Schema has the action property with engage/release enum
    const schema = skillTool?.inputSchema as {
      properties?: {
        action?: { enum?: unknown[]; description?: string };
        category?: { type?: string; description?: string };
        skillId?: { type?: string };
        scenarioKey?: { type?: string };
      };
    };
    assert.ok(
      Array.isArray(schema?.properties?.action?.enum) &&
        schema.properties.action.enum.includes("list") &&
        schema.properties.action.enum.includes("describe") &&
        schema.properties.action.enum.includes("engage") &&
        schema.properties.action.enum.includes("release"),
      "skill tool schema must have action enum with list/describe/engage/release"
    );
    assert.equal(
      schema?.properties?.category?.type,
      "string",
      "skill tool schema must have category of type string for action=list"
    );
    assert.equal(
      schema?.properties?.skillId?.type,
      "string",
      "skill tool schema must have skillId of type string"
    );
    assert.equal(
      schema?.properties?.scenarioKey?.type,
      "string",
      "skill tool schema must have scenarioKey of type string"
    );
    // The description should be stable and not empty
    assert.ok(
      skillTool?.description && skillTool.description.length > 0,
      "skill tool must have a non-empty description"
    );
    // The read-only list/describe signal is projection-owned and lives on the
    // schema's action enum + its description (the top-level description is
    // policy/catalog-owned and stubbed in this projection test), so assert it
    // where projection actually writes it and it is byte-stable regardless of policy.
    assert.match(
      schema?.properties?.action?.description ?? "",
      /read-only/i,
      "skill tool action schema must document that list/describe are read-only"
    );
    assert.match(
      schema?.properties?.action?.description ?? "",
      /list/i,
      "skill tool action schema description must name the read-only list action"
    );
    assert.match(
      schema?.properties?.action?.description ?? "",
      /describe/i,
      "skill tool action schema description must name the read-only describe action"
    );
    // Schema must be byte-stable: no per-turn mutation (additionalProperties: false)
    assert.equal(
      (skillTool?.inputSchema as { additionalProperties?: unknown })?.additionalProperties,
      false,
      "skill tool schema must have additionalProperties: false"
    );
  }

  // ADR-135 S2 — catalog stub projection + describe full-contract builders.
  const catalogExposureBundle = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolPolicies: artifact.bundle.governance.toolPolicies.map((policy) => {
        if (policy.toolCode === "image_generate") {
          return { ...policy, modelExposure: "catalog" as const };
        }
        if (policy.toolCode === "web_search") {
          return { ...policy, modelExposure: "full" as const };
        }
        return policy;
      })
    }
  };
  const catalogProjection = projectRuntimeNativeTools(catalogExposureBundle);
  const catalogImageGenerate = catalogProjection.tools.find(
    (tool) => tool.name === "image_generate"
  );
  const fullWebSearch = catalogProjection.tools.find((tool) => tool.name === "web_search");
  assert.ok(catalogImageGenerate, "catalog-tier image_generate must still project");
  assert.match(
    catalogImageGenerate?.description ?? "",
    /Call image_generate\(\{action:"describe"\}\) before the first real execution call\./
  );
  assert.doesNotMatch(catalogImageGenerate?.description ?? "", /WHEN TO USE:/i);
  const catalogSchema = catalogImageGenerate?.inputSchema as {
    additionalProperties?: boolean;
    required?: string[];
    properties?: { action?: { enum?: string[]; description?: string } };
  };
  assert.deepEqual(catalogSchema.required, ["action"]);
  assert.equal(catalogSchema.additionalProperties, true);
  assert.equal(catalogSchema.properties?.action?.enum, undefined);
  assert.match(catalogSchema.properties?.action?.description ?? "", /After describe/);
  assert.match(
    fullWebSearch?.description ?? "",
    /Use this when the answer depends on recent external information or links\./
  );
  assert.ok(
    (fullWebSearch?.inputSchema as { required?: string[] }).required?.includes("query"),
    "full-tier web_search must keep full schema"
  );

  const catalogVideoBundle = {
    ...artifact.bundle,
    governance: {
      ...artifact.bundle.governance,
      toolPolicies: artifact.bundle.governance.toolPolicies.map((policy) =>
        policy.toolCode === "video_generate"
          ? { ...policy, modelExposure: "catalog" as const }
          : policy
      )
    }
  };
  const catalogVideo = projectRuntimeNativeTools(catalogVideoBundle).tools.find(
    (tool) => tool.name === "video_generate"
  );
  const videoCatalogSchema = catalogVideo?.inputSchema as {
    additionalProperties?: boolean;
    properties?: { action?: { enum?: string[]; description?: string } };
  };
  assert.equal(videoCatalogSchema.additionalProperties, true);
  assert.equal(videoCatalogSchema.properties?.action?.enum, undefined);
  assert.match(
    videoCatalogSchema.properties?.action?.description ?? "",
    /list_personas, list_voices, describe_avatar_mode/
  );

  const fullImageGenerate = buildFullNativeToolDefinition(catalogExposureBundle, "image_generate");
  assert.ok(fullImageGenerate, "describe builder must resolve full image_generate contract");
  assert.match(fullImageGenerate.description, /transparent PNG/i);
  const fullSchema = fullImageGenerate.inputSchema as {
    properties?: { prompt?: unknown; action?: { enum?: string[] } };
  };
  assert.ok(fullSchema.properties?.prompt, "full image_generate schema must include prompt");
  assert.ok(
    fullSchema.properties?.action?.enum?.includes("describe"),
    "full image_generate schema must include describe action"
  );

  const describeExecution = executeRuntimeToolContractDescribe({
    bundle: catalogExposureBundle,
    toolCode: "image_generate"
  });
  assert.equal(describeExecution.payload.action, "described_contract");
  assert.match(describeExecution.payload.description, /transparent PNG/i);
  assert.deepEqual(describeExecution.artifacts, []);

  const laterCatalogProjection = projectRuntimeNativeTools(catalogExposureBundle);
  assert.equal(
    JSON.stringify(laterCatalogProjection.tools),
    JSON.stringify(projectRuntimeNativeTools(catalogExposureBundle).tools),
    "catalog tool wire must remain immutable after describe"
  );
  const stillCatalogWebSearch = laterCatalogProjection.tools.find(
    (tool) => tool.name === "web_search"
  );
  assert.match(
    stillCatalogWebSearch?.description ?? "",
    /Use this when the answer depends on recent external information or links\./
  );
}

/**
 * ADR-117 Slice 3 — single-source sanity test (down-payment on Slice 5 golden test).
 *
 * Asserts:
 * 1. The canonical Rule A/B/C constants are exported from @persai/runtime-contract.
 * 2. The collage phrase no longer appears in the model-facing image tool descriptions
 *    produced by native-tool-projection (it belongs in provider prompts only).
 */
export async function runMediaPromptFragmentsSanityTest(): Promise<void> {
  assert.equal(typeof ANTI_COLLAGE_RULE, "string", "ANTI_COLLAGE_RULE must be exported");
  assert.ok(ANTI_COLLAGE_RULE.length > 0, "ANTI_COLLAGE_RULE must be non-empty");
  assert.ok(
    ANTI_COLLAGE_RULE.includes("diptych") && ANTI_COLLAGE_RULE.includes("triptych"),
    "ANTI_COLLAGE_RULE must name diptych and triptych (gateway-facing complete variant)"
  );

  assert.equal(typeof STANDALONE_IMAGE_RULE, "string", "STANDALONE_IMAGE_RULE must be exported");
  assert.ok(STANDALONE_IMAGE_RULE.length > 0, "STANDALONE_IMAGE_RULE must be non-empty");
  assert.ok(
    STANDALONE_IMAGE_RULE.includes("standalone final image"),
    "STANDALONE_IMAGE_RULE must include 'standalone final image'"
  );

  const singleRef = referenceGuidanceRule({ multiple: false });
  const multiRef = referenceGuidanceRule({ multiple: true });
  assert.ok(
    singleRef.includes("second/reference image"),
    "referenceGuidanceRule({multiple:false}) must reference second/reference image"
  );
  assert.ok(
    multiRef.includes("additional reference images"),
    "referenceGuidanceRule({multiple:true}) must reference additional reference images"
  );

  const repoRoot = findRepoRoot();
  // The provider-conditioning fragments live directly in the runtime-contract index
  // module: the package is consumed as un-built TS source at runtime, so it must stay
  // a single self-contained module (extensionless relative imports are unresolvable
  // under Node's type-stripping ESM loader). See ADR-117 / index.ts header note.
  const mediaFragmentsPath = "packages/runtime-contract/src/index.ts";
  const projectionPath = "apps/runtime/src/modules/turns/native-tool-projection.ts";
  const imageGenerateServicePath =
    "apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts";
  const imageEditServicePath = "apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts";
  const openAiClientPath =
    "apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts";
  const toolCatalogPath = "apps/api/prisma/tool-catalog-data.ts";
  const bootstrapPath = "apps/api/prisma/bootstrap-preset-data.ts";

  const mediaFragmentsSource = readRepoFile(repoRoot, mediaFragmentsPath);
  const projectionSource = readRepoFile(repoRoot, projectionPath);
  const imageGenerateServiceSource = readRepoFile(repoRoot, imageGenerateServicePath);
  const imageEditServiceSource = readRepoFile(repoRoot, imageEditServicePath);
  const openAiClientSource = readRepoFile(repoRoot, openAiClientPath);
  const toolCatalogSource = readRepoFile(repoRoot, toolCatalogPath);
  const bootstrapSource = readRepoFile(repoRoot, bootstrapPath);

  const collageLiteralPattern =
    /Do not make a collage|contact sheet|diptych|triptych|multi-panel composition/i;
  assert.equal(
    countStringLiteralsMatching(mediaFragmentsSource, collageLiteralPattern),
    1,
    `Rule A: ${mediaFragmentsPath} must be the only production source file that defines the collage/contact-sheet/diptych rule as a string literal`
  );
  for (const [relativePath, source] of [
    [projectionPath, projectionSource],
    [imageGenerateServicePath, imageGenerateServiceSource],
    [imageEditServicePath, imageEditServiceSource],
    [openAiClientPath, openAiClientSource]
  ] as const) {
    assert.doesNotMatch(
      source,
      collageLiteralPattern,
      `Rule A: ${relativePath} must not inline the collage/contact-sheet/diptych rule; import the shared fragment instead`
    );
  }

  assertImportsRuntimeContractSymbols({
    ruleName: "Rule B / D",
    relativePath: imageGenerateServicePath,
    source: imageGenerateServiceSource,
    requiredSymbols: [
      "ANTI_COLLAGE_RULE",
      "STANDALONE_GENERATED_IMAGE_RULE",
      "seriesItemHeaderLine"
    ]
  });
  assertImportsRuntimeContractSymbols({
    ruleName: "Rule B / C / D",
    relativePath: imageEditServicePath,
    source: imageEditServiceSource,
    requiredSymbols: ["ANTI_COLLAGE_RULE", "STANDALONE_EDITED_IMAGE_RULE", "seriesItemHeaderLine"]
  });
  assertImportsRuntimeContractSymbols({
    ruleName: "Rule A / B / C",
    relativePath: openAiClientPath,
    source: openAiClientSource,
    requiredSymbols: ["ANTI_COLLAGE_RULE", "STANDALONE_IMAGE_RULE", "referenceGuidanceRule"]
  });

  const sharedSeriesHeader = seriesItemHeaderLine(0, 2);
  assert.equal(
    sharedSeriesHeader,
    "Series item 1 of 2.",
    "Rule D: seriesItemHeaderLine must be exported"
  );
  assert.ok(
    imageGenerateServiceSource.includes("seriesItemHeaderLine("),
    `Rule D: ${imageGenerateServicePath} must call seriesItemHeaderLine() instead of re-declaring the header wording`
  );
  assert.ok(
    imageEditServiceSource.includes("seriesItemHeaderLine("),
    `Rule D: ${imageEditServicePath} must call seriesItemHeaderLine() instead of re-declaring the header wording`
  );
  assert.ok(
    openAiClientSource.includes("referenceGuidanceRule({ multiple:"),
    `Rule C: ${openAiClientPath} must build reference guidance through referenceGuidanceRule() instead of re-declaring the wording`
  );

  assert.doesNotMatch(
    toolCatalogSource,
    /action="deferred"/i,
    `Drift guard: ${toolCatalogPath} must not mention action="deferred" after ADR-117 Slice 2`
  );
  for (const [pattern, label] of [
    [/not for editing/i, 'cross-tool comparison "not for editing"'],
    [/do not use this for/i, 'cross-tool comparison "do not use this for"'],
    [/use `background_task` for that/i, 'cross-tool comparison "use `background_task` for that"'],
    [
      /need sources or links without an exact URL/i,
      "selection-guide URL sentence duplicated into catalog"
    ],
    [/know the exact URL/i, "selection-guide exact-URL sentence duplicated into catalog"]
  ] as const) {
    assert.doesNotMatch(
      toolCatalogSource,
      pattern,
      `Drift guard: ${toolCatalogPath} must not reintroduce ${label}`
    );
  }

  // ADR-119 Slice 6: tools template rewritten to canonical XML priority order.
  // The outer <tool_usage_policy> wrapper is preserved (ADR-119 Slice 1 invariant).
  // The inner Markdown headings are replaced by XML structure with Skills-first gate.
  assert.match(
    bootstrapSource,
    /tools:\s*`<tool_usage_policy>\r?\nUse only the machine-readable tools/,
    `Selection guide presence: ${bootstrapPath} must seed the tool usage policy in the tools block (XML priority-ordered)`
  );
  // ADR-119 Slice 9: <memory_protocol> block moved to the dedicated `memory_protocol`
  // template; the `agents` selection-guide seat is now empty.
  assert.doesNotMatch(
    bootstrapSource,
    /agents:\s*`<memory_protocol>/,
    `Selection guide presence: ${bootstrapPath} agents block must NOT contain inline <memory_protocol> (moved to dedicated template)`
  );
  assert.match(
    bootstrapSource,
    /memory_protocol:\s*`<memory_protocol>/,
    `Selection guide presence: ${bootstrapPath} must have a dedicated memory_protocol template with <memory_protocol> block`
  );
  // (a) Tasks Policy must NOT be reintroduced.
  assert.doesNotMatch(
    bootstrapSource,
    /# Tasks Policy/,
    `Selection guide presence: ${bootstrapPath} must not reintroduce a Tasks Policy section into the agents block`
  );
  // (b) Selection-guide-shaped seat preserved — single template hosting cross-tool rules.
  assert.match(
    bootstrapSource,
    /<tool_usage_policy>/,
    `ADR-117 (b): ${bootstrapPath} must preserve the <tool_usage_policy> seat`
  );
  // (c) tool-catalog-data.ts must not duplicate cross-tool selection prose (checked below).
  // ADR-118: Skills activation guidance now lives in <category name="skills"> and
  // <priority_order> block (XML form replacing the old ## Skills Markdown section).
  assert.match(
    bootstrapSource,
    /<category name="skills">/,
    `ADR-118: ${bootstrapPath} must include the skills category in the selection guide`
  );
  assert.match(
    bootstrapSource,
    /\\`<enabled_skills>\\` lists the Skills the user enabled/,
    `ADR-118: skills category must point the model at the <enabled_skills> block as the source of truth`
  );
  assert.match(
    bootstrapSource,
    /\\`id\\` attribute is the exact opaque \\`skillId\\`/,
    `ADR-118: skills category must call out the id attribute as the exact identifier to pass as skillId`
  );
  // ADR-130 Slice 1 (tools guide compression): "NEVER" emphasis dialed back to
  // "never" per Anthropic guidance; the hard exclusivity rule itself is unchanged.
  assert.match(
    bootstrapSource,
    /never substitute the display name or category/i,
    `ADR-118: skills category must forbid substituting display name for skillId`
  );
  assert.match(
    bootstrapSource,
    /skill\(\{action:"engage", skillId\}\)/,
    `ADR-118: skills category must reference the engage call signature`
  );
  assert.match(
    bootstrapSource,
    /scenarioKey:"instagram_carousel"/,
    `ADR-118: skills category must include a concrete scenarioKey example`
  );
  assert.match(
    bootstrapSource,
    /skill\(\{action:"release"\}\)/,
    `ADR-118: skills category must reference the release call`
  );
  const skillsCategoryOccurrences = (bootstrapSource.match(/<category name="skills">/g) ?? [])
    .length;
  assert.equal(
    skillsCategoryOccurrences,
    1,
    `ADR-118: <category name="skills"> must appear exactly once in ${bootstrapPath}`
  );
  // (d) ADR-119 Slice 6: <priority_order> block must enumerate Skills as #1.
  assert.match(
    bootstrapSource,
    /<priority_order>/,
    `ADR-119 Slice 6 (d): tools template must contain <priority_order> block`
  );
  // ADR-130 Slice 1 (tools guide compression): "Skills are the gate" tightened to
  // "Skills gate first"; the #1-gate routing intent is unchanged.
  assert.match(
    bootstrapSource,
    /Skills gate first/,
    `ADR-119 Slice 6 (d): <priority_order> must enumerate Skills as #1 gate`
  );
  // (e) ADR-119 Slice 6: <parallelism> block must state skill({engage}) is solo.
  assert.match(
    bootstrapSource,
    /<parallelism>/,
    `ADR-119 Slice 6 (e): tools template must contain <parallelism> block`
  );
  // ADR-130 Slice 1: "ALWAYS solo" tightened to "always solo"; the hard
  // single-tool-call constraint itself is unchanged.
  assert.match(
    bootstrapSource,
    /is always solo/i,
    `ADR-119 Slice 6 (e): <parallelism> must state skill({engage}) is always solo`
  );
  // ADR-119 Slice 6: <failure_handling> block must mention pending_delivery.
  assert.match(
    bootstrapSource,
    /<failure_handling>/,
    `ADR-119 Slice 6: tools template must contain <failure_handling> block`
  );
  assert.match(
    bootstrapSource,
    /pending_delivery/,
    `ADR-119 Slice 6: <failure_handling> must mention pending_delivery`
  );

  // Rule A must NOT appear inline in the model-facing image tool descriptions.
  // (The projection test fixture produces tools via the real projection pipeline.)
  const artifact = compileAssistantRuntimeBundle({
    effectiveRoleId: "role-test",
    metadata: {
      assistantId: "sanity-1",
      assistantHandle: "a-test",
      siblingAssistantHandles: [],
      workspaceId: "ws-1",
      publishedVersionId: "ver-1",
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
    },
    persona: {
      displayName: "Test",
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
      displayName: "User",
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
        actions: ["snapshot", "act", "login", "list_profiles"],
        confirmationRequiredActions: ["act", "login"]
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
        image_generate: {
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: true,
          providerId: "openai",
          modelKey: "gpt-image-1.5"
        },
        image_edit: {
          refKey: "persai:persai-runtime:tool/image_generate/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_generate/api-key"
          },
          configured: true,
          providerId: "openai",
          modelKey: "gpt-image-1.5"
        }
      },
      toolPolicies: [
        {
          toolCode: "image_generate",
          displayName: "Image Generate",
          description: "Generate new images from a text prompt.",
          usageGuidance: 'Set background="transparent" when the user wants transparent PNG output.',
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10
        },
        {
          toolCode: "image_edit",
          displayName: "Image Edit",
          description: "Edit a current-turn image.",
          usageGuidance:
            'Set background="transparent" when the user asks to remove the background.',
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10
        }
      ],
      quota: {
        planCode: "starter_trial",
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
      soul: "",
      user: "",
      identity: "",
      tools: "",
      agents: "",
      heartbeat: "",
      preview: "",
      welcome: ""
    }
  });
  const { tools } = projectRuntimeNativeTools(artifact.bundle);
  const imageGenerateTool = tools.find((t) => t.name === "image_generate");
  const imageEditTool = tools.find((t) => t.name === "image_edit");

  assert.ok(imageGenerateTool, "image_generate must be projected in sanity test");
  assert.ok(imageEditTool, "image_edit must be projected in sanity test");

  const collagePattern = /collage|contact sheet|diptych|triptych/i;
  assert.doesNotMatch(
    imageGenerateTool?.description ?? "",
    collagePattern,
    "ADR-117 Slice 3: collage/diptych/triptych phrase must not appear in model-facing image_generate description"
  );
  assert.doesNotMatch(
    imageEditTool?.description ?? "",
    collagePattern,
    "ADR-117 Slice 3: collage/diptych/triptych phrase must not appear in model-facing image_edit description"
  );

  // count=N / series intent must still be present (model still needs this for tool selection).
  assert.match(
    imageGenerateTool?.description ?? "",
    /count=N means N separate final images in this one job/,
    "ADR-117 Slice 3: count/series intent must still be present in image_generate description"
  );
  assert.match(
    imageEditTool?.description ?? "",
    /count=N means N separate final edited images in this one job/,
    "ADR-117 Slice 3: count/series intent must still be present in image_edit description"
  );
}

// ── ADR-119 Slice 7 tests ──────────────────────────────────────────────────

/**
 * ADR-119 Slice 7:
 * (1) Per-tool rendered description shape — each of the 8 rewritten tools must
 *     emit a projected description containing all 4 structured section headers.
 * (2) Cross-tool prose drift — catalog source must not inject forbidden tool-code
 *     references into per-tool modelUsageGuidance (with chain-link exceptions).
 * (3) Safe-fallback truncation — when modelUsageGuidance exceeds the projection cap,
 *     the rendered description still contains "WHEN TO USE:" and the first sentence.
 */
export async function runAdr119Slice7DescriptorTests(): Promise<void> {
  const repoRoot = findRepoRoot();
  const REQUIRED_SECTIONS = ["WHEN TO USE:", "WHEN NOT TO USE:", "EXAMPLES:", "GOTCHAS:"];

  // ── (1) Per-tool rendered description shape ──────────────────────────────
  // Build a minimal bundle that projects all 8 rewritten tools so we can check
  // the projected description preserves the structured sections end-to-end.
  {
    const structured = (toolName: string): string =>
      `WHEN TO USE: Use ${toolName} here.\nWHEN NOT TO USE: Skip ${toolName} here.\nEXAMPLES:\n- ${toolName}({}) — example.\nGOTCHAS:\n- Watch out when using ${toolName}.`;

    const knowledgeBundle = compileAssistantRuntimeBundle({
      effectiveRoleId: "role-test",
      metadata: {
        assistantId: "slice7-1",
        assistantHandle: "a-test",
        siblingAssistantHandles: [],
        workspaceId: "ws-slice7",
        publishedVersionId: "ver-slice7",
        publishedVersion: 1,
        algorithmVersion: 72,
        configGeneration: 1
      },
      persona: {
        displayName: "Test",
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
        displayName: "User",
        birthday: null,
        gender: null,
        locale: "en",
        timezone: "UTC"
      },
      runtime: {
        runtimeAssignment: { effectiveTier: "paid_shared_restricted" },
        runtimeProviderProfile: {
          mode: "admin_managed",
          primary: { provider: "anthropic", model: "claude-opus-4-8" }
        },
        runtimeProviderRouting: {
          primaryPath: {
            providerKey: "anthropic",
            modelKey: "claude-opus-4-8",
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
          autoCompactionTelegram: false,
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
          telegramAutoSummarizeEnabled: false
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
          actions: ["snapshot", "act", "login", "list_profiles"],
          confirmationRequiredActions: ["act", "login"]
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
            refKey: "k",
            secretRef: { source: "persai", provider: "persai-runtime", id: "k" },
            configured: true,
            providerId: "tavily"
          },
          web_fetch: {
            refKey: "k",
            secretRef: { source: "persai", provider: "persai-runtime", id: "k" },
            configured: true,
            providerId: "firecrawl"
          },
          image_generate: {
            refKey: "k",
            secretRef: { source: "persai", provider: "persai-runtime", id: "k" },
            configured: true,
            providerId: "openai"
          },
          image_edit: {
            refKey: "k",
            secretRef: { source: "persai", provider: "persai-runtime", id: "k" },
            configured: true,
            providerId: "openai"
          }
        },
        toolPolicies: [
          {
            toolCode: "web_search",
            displayName: "Web Search",
            description: "Search the public web for sources or links related to a query.",
            usageGuidance: structured("web_search"),
            kind: "plan",
            executionMode: "inline",
            usageRule: "allowed",
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: null
          },
          {
            toolCode: "web_fetch",
            displayName: "Web Fetch",
            description: "Fetch and extract the main content of a public webpage by exact URL.",
            usageGuidance: structured("web_fetch"),
            kind: "plan",
            executionMode: "inline",
            usageRule: "allowed",
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: null
          },
          {
            toolCode: "image_generate",
            displayName: "Image Generate",
            description: "Generate a brand-new image from a text prompt (no source image).",
            usageGuidance: structured("image_generate"),
            kind: "plan",
            executionMode: "worker",
            usageRule: "allowed",
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: null
          },
          {
            toolCode: "image_edit",
            displayName: "Image Edit",
            description:
              "Edit an existing image with prompt-guided changes (replace, remove, add, recolor, restyle, insert, draw on top).",
            usageGuidance: structured("image_edit"),
            kind: "plan",
            executionMode: "worker",
            usageRule: "allowed",
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: null
          },
          {
            toolCode: "knowledge_search",
            displayName: "Knowledge Search",
            description: "Search uploaded documents, prior chats, and stored facts.",
            usageGuidance: structured("knowledge_search"),
            kind: "plan",
            executionMode: "inline",
            usageRule: "allowed",
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: null
          },
          {
            toolCode: "knowledge_fetch",
            displayName: "Knowledge Fetch",
            description: "Fetch the full content of a specific knowledge reference by referenceId.",
            usageGuidance: structured("knowledge_fetch"),
            kind: "plan",
            executionMode: "inline",
            usageRule: "allowed",
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: null
          },
          {
            toolCode: "memory_write",
            displayName: "Memory Write",
            description:
              "Persist a stable fact, lasting preference, or real open loop learned this turn.",
            usageGuidance: structured("memory_write"),
            kind: "plan",
            executionMode: "inline",
            usageRule: "allowed",
            enabled: true,
            visibleToModel: true,
            visibleInPlanEditor: true,
            dailyCallLimit: null
          },
          {
            toolCode: "skill",
            displayName: "Skill",
            description:
              "Engage a Skill (and optionally a scenario) to activate domain-specific guidance, OR release the active Skill.",
            usageGuidance: structured("skill"),
            kind: "plan",
            executionMode: "inline",
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
          sharedQuotaBytes: 1024,
          quotaHook: null
        },
        auditHook: null
      },
      skills: {
        enabled: [
          {
            id: "skl_test_001",
            name: "Test Skill",
            description: "A test skill.",
            category: "test",
            tags: [],
            body: "Do the test.",
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
        soul: "",
        user: "",
        identity: "",
        tools: "",
        agents: "",
        heartbeat: "",
        preview: "",
        welcome: ""
      }
    });

    const proj = projectRuntimeNativeTools(knowledgeBundle.bundle);

    const toolsToCheck = [
      "web_search",
      "web_fetch",
      "image_generate",
      "image_edit",
      "knowledge_search",
      "knowledge_fetch",
      "memory_write",
      "skill"
    ] as const;

    for (const toolName of toolsToCheck) {
      const tool = proj.tools.find((t) => t.name === toolName);
      assert.ok(tool, `ADR-119 Slice 7: ${toolName} must be projected in the shape-test bundle`);
      for (const section of REQUIRED_SECTIONS) {
        assert.ok(
          tool?.description?.includes(section),
          `ADR-119 Slice 7: ${toolName} rendered description must contain "${section}"`
        );
      }
    }
  }

  // ── (2) Cross-tool prose drift — catalog source check ───────────────────
  // Read the catalog source as text and verify per-entry modelUsageGuidance
  // blocks do not contain forbidden tool-code references (ADR-117 invariant).
  {
    const catalogSource = readRepoFile(repoRoot, "apps/api/prisma/tool-catalog-data.ts");

    // Tool code strings that must not appear in a given entry's guidance unless
    // the entry is in the allow-list for that code.
    const ALL_PROJECTED_CODES = [
      "image_edit",
      "image_generate",
      "knowledge_search",
      "knowledge_fetch",
      "memory_write",
      "web_search",
      "web_fetch",
      "skill",
      "browser",
      "tts",
      "video_generate",
      "document",
      "files",
      "scheduled_action",
      "background_task"
    ];

    // Chain-link exceptions (catalog code → allowed projected code mentions).
    // ADR-117: only the listed combinations are permitted; all others must be absent.
    const ALLOW_LIST: Record<string, string[]> = {
      web_search: ["web_fetch"],
      web_fetch: ["web_search", "browser"],
      // shell guidance pre-dates Slice 7; it mentions "the files tool" for IO routing.
      shell: ["files"]
    };

    // Only enforce on the still-model-facing Slice 7 audited tools — hidden alias
    // remap rows now intentionally omit duplicated shadow guidance.
    // Other existing entries have not been
    // audited for cross-tool prose yet and may use tool names as ordinary English words.
    const SLICE7_CATALOG_CODES = new Set([
      "web_search",
      "web_fetch",
      "image_generate",
      "image_edit",
      "skill",
      "memory_write"
    ]);

    // Extract all catalog entries by matching `code: "..."` + the following
    // `modelUsageGuidance:` value in the source text.
    const entryPattern = /code:\s*["']([^"']+)["'][^{}]*?modelUsageGuidance:\s*(`[^`]*`|"[^"]*")/gs;
    let entryMatch: RegExpExecArray | null;
    const extractedEntries: Array<{ code: string; guidance: string }> = [];
    while ((entryMatch = entryPattern.exec(catalogSource)) !== null) {
      const code = entryMatch[1] ?? "";
      const rawGuidance = entryMatch[2] ?? "";
      // Strip surrounding backtick/quotes
      const guidance = rawGuidance.slice(1, -1);
      extractedEntries.push({ code, guidance });
    }

    const slice7Entries = extractedEntries.filter((e) => SLICE7_CATALOG_CODES.has(e.code));
    assert.ok(
      slice7Entries.length >= 6,
      `ADR-119 Slice 7 cross-tool drift: expected at least 6 Slice 7 entries with modelUsageGuidance, found ${String(slice7Entries.length)}`
    );

    for (const { code, guidance } of slice7Entries) {
      const allowed = ALLOW_LIST[code] ?? [];
      for (const forbidden of ALL_PROJECTED_CODES) {
        if (forbidden === code) continue;
        if (allowed.includes(forbidden)) continue;
        assert.doesNotMatch(
          guidance,
          new RegExp(`\\b${forbidden}\\b`),
          `ADR-117 drift: catalog entry "${code}" modelUsageGuidance must not mention tool code "${forbidden}"`
        );
      }
    }
  }

  // ── (3) Safe-fallback truncation ─────────────────────────────────────────
  // When modelUsageGuidance is very long, the projected description must still
  // contain "WHEN TO USE:" and the first sentence of that section.
  {
    const longGuidancePrefix = "WHEN TO USE: This is the important condition.\n";
    // Must exceed TOOL_DESCRIPTION_CAP so the truncation mechanism is still genuinely
    // exercised after the cap was raised from 1024 to 4096.
    const longGuidancePadding = "x".repeat(TOOL_DESCRIPTION_CAP + 500);
    const longGuidance = `${longGuidancePrefix}${longGuidancePadding}\nWHEN NOT TO USE: Never.\nEXAMPLES:\n- ex.\nGOTCHAS:\n- g.`;

    const truncationBundle = compileAssistantRuntimeBundle({
      effectiveRoleId: "role-test",
      metadata: {
        assistantId: "slice7-trunc",
        assistantHandle: "a-test",
        siblingAssistantHandles: [],
        workspaceId: "ws-trunc",
        publishedVersionId: "ver-trunc",
        publishedVersion: 1,
        algorithmVersion: 72,
        configGeneration: 1
      },
      persona: {
        displayName: "T",
        instructions: "x",
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
        displayName: "U",
        birthday: null,
        gender: null,
        locale: "en",
        timezone: "UTC"
      },
      runtime: {
        runtimeAssignment: { effectiveTier: "paid_shared_restricted" },
        runtimeProviderProfile: {
          mode: "admin_managed",
          primary: { provider: "anthropic", model: "claude-opus-4-8" }
        },
        runtimeProviderRouting: {
          primaryPath: {
            providerKey: "anthropic",
            modelKey: "claude-opus-4-8",
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
          autoCompactionTelegram: false,
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
          telegramAutoSummarizeEnabled: false
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
          actions: ["snapshot", "act", "login", "list_profiles"],
          confirmationRequiredActions: ["act", "login"]
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
            toolCode: "memory_write",
            displayName: "Memory Write",
            description: "Persist a stable fact.",
            usageGuidance: longGuidance,
            kind: "plan",
            executionMode: "inline",
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
          sharedQuotaBytes: 1024,
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
        soul: "",
        user: "",
        identity: "",
        tools: "",
        agents: "",
        heartbeat: "",
        preview: "",
        welcome: ""
      }
    });

    const truncProj = projectRuntimeNativeTools(truncationBundle.bundle);
    const memoryWriteTool = truncProj.tools.find((t) => t.name === "memory_write");
    assert.ok(memoryWriteTool, "ADR-119 Slice 7 safe-fallback: memory_write must be projected");

    const desc = memoryWriteTool?.description ?? "";
    assert.ok(
      desc.length <= TOOL_DESCRIPTION_CAP,
      `ADR-119 Slice 7 safe-fallback: description must be truncated to ≤${String(TOOL_DESCRIPTION_CAP)} chars (got ${String(desc.length)})`
    );
    assert.ok(
      desc.includes("WHEN TO USE:"),
      "ADR-119 Slice 7 safe-fallback: truncated description must still contain 'WHEN TO USE:'"
    );
    assert.ok(
      desc.includes("This is the important condition."),
      "ADR-119 Slice 7 safe-fallback: truncated description must still contain the first WHEN TO USE sentence"
    );
  }
}

// ---------------------------------------------------------------------------
// ADR-119 Golden Test 3 — <priority_order> enumerates Skills #1.
//
// This test explicitly groups the ADR-119 invariants for findability and
// documents the acceptance criteria. The underlying assertions reference the
// same bootstrap-preset-data.ts read as the main native-tool-projection suite.
// ---------------------------------------------------------------------------

export async function runAdr119Invariantstest(): Promise<void> {
  const repoRoot = findRepoRoot();
  const bootstrapSource = readRepoFile(repoRoot, "apps/api/prisma/bootstrap-preset-data.ts");

  // --- ADR-119 Golden Test 3: <priority_order> enumerates Skills as #1 ---

  assert.match(
    bootstrapSource,
    /<priority_order>/,
    "ADR-119 GT3: tools template must contain <priority_order> block"
  );
  // ADR-130 Slice 1 (tools guide compression): "Skills are the gate" tightened to
  // "Skills gate first"; the #1-gate routing intent is unchanged.
  assert.match(
    bootstrapSource,
    /Skills gate first/,
    "ADR-119 GT3: <priority_order> must enumerate Skills as #1 gate"
  );
  // Skills rule must appear BEFORE any other priority rule in the <priority_order> block.
  const priorityOrderMatch = bootstrapSource.match(/<priority_order>([\s\S]*?)<\/priority_order>/);
  assert.ok(
    priorityOrderMatch !== null,
    "ADR-119 GT3: <priority_order> block must be present and balanced"
  );
  const priorityOrderBody = priorityOrderMatch![1] ?? "";
  const skillsIdx = priorityOrderBody.indexOf("Skills gate first");
  const knowledgeIdx = priorityOrderBody.indexOf("Knowledge before web");
  const mediaIdx = priorityOrderBody.indexOf("Media routing");
  assert.ok(skillsIdx !== -1, "ADR-119 GT3: 'Skills gate first' must appear in <priority_order>");
  assert.ok(
    skillsIdx < knowledgeIdx || knowledgeIdx === -1,
    "ADR-119 GT3: Skills rule must appear before 'Knowledge before web' in <priority_order>"
  );
  assert.ok(
    skillsIdx < mediaIdx || mediaIdx === -1,
    "ADR-119 GT3: Skills rule must appear before 'Media routing' in <priority_order>"
  );

  // <parallelism> block must state skill({engage}) is solo.
  assert.match(
    bootstrapSource,
    /<parallelism>/,
    "ADR-119 GT3: tools template must contain <parallelism> block"
  );
  // ADR-130 Slice 1: "ALWAYS solo" tightened to "always solo"; the hard
  // single-tool-call constraint itself is unchanged.
  assert.match(
    bootstrapSource,
    /is always solo/i,
    "ADR-119 GT3: <parallelism> must state skill({engage}) is always solo"
  );

  // <failure_handling> block must mention pending_delivery.
  assert.match(
    bootstrapSource,
    /<failure_handling>/,
    "ADR-119 GT3: tools template must contain <failure_handling> block"
  );
  assert.match(
    bootstrapSource,
    /pending_delivery/,
    "ADR-119 GT3: <failure_handling> must mention pending_delivery"
  );

  // <category name="skills"> must exist exactly once.
  const skillsCategoryMatches = bootstrapSource.match(/<category name="skills">/g) ?? [];
  assert.equal(
    skillsCategoryMatches.length,
    1,
    "ADR-119 GT3: <category name='skills'> must appear exactly once in the tools template"
  );
}
