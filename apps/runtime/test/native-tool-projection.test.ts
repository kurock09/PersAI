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
        document: {
          refKey: "persai:persai-runtime:tool/document/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/document/api-key"
          },
          configured: true,
          providerId: "pdfmonkey",
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
          toolCode: "document",
          displayName: "Document",
          description: "Create and revise assistant documents.",
          usageGuidance:
            "Use revise_document and export_or_redeliver only for existing PersAI document ids.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: 10
        },
        {
          toolCode: "files",
          displayName: "Files",
          description:
            "List, search, inspect, read, write, write-and-send, edit, or send assistant-managed files.",
          usageGuidance:
            "Use files.write_and_send when the user asks you to create or save a file and immediately deliver it in chat. Use files.write when the file should only be saved. Use files.list when you need an exact root or folder inventory, and use files.search with a non-empty query when you need to discover a file by name. When you already know the target file, prefer a working-file alias first, then relativePath, then query; do not rely on raw fileRef values from free text. If the user asks you to send, resend, attach, or share an existing file, discovering or reading that file is not enough: call files.send in the same turn. A working-file alias, relativePath, filename, or markdown link is not a substitute for delivery. Do not claim a file was sent unless files.send or files.write_and_send succeeded. Keep shell and exec for actual process execution only.",
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
          toolCode: "scheduled_action",
          displayName: "Scheduled Action",
          description:
            "Schedule actions for both user-visible reminders and hidden assistant follow-ups.",
          usageGuidance:
            'For create, choose EXACTLY ONE explicit kind. Use "assistant_check" for hidden background checks.',
          kind: "plan",
          executionMode: "worker",
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
  const imageGenerate = projected.tools.find((tool) => tool.name === "image_generate");
  const imageEdit = projected.tools.find((tool) => tool.name === "image_edit");
  const document = projected.tools.find((tool) => tool.name === "document");
  const scheduledAction = projected.tools.find((tool) => tool.name === "scheduled_action");
  const routeControl = projected.tools.find((tool) => tool.name === "route_control");

  assert.ok(webSearch, "web_search should be projected when enabled and configured");
  assert.equal(routeControl, undefined);
  assert.equal(
    webSearch?.description,
    "Search the public web for current external facts. Use this when the answer depends on recent external information or links. May be called in parallel with other independent searches."
  );
  assert.match(files?.description ?? "", /write-and-send/);
  assert.match(files?.description ?? "", /files\.write_and_send when the user asks/);
  assert.match(files?.description ?? "", /files\.search with a non-empty query/);
  assert.match(files?.description ?? "", /call files\.send in the same turn/);
  assert.match(files?.description ?? "", /not a substitute for delivery/);
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
        query?: { description?: string };
        path?: { description?: string };
        alias?: { description?: string };
        aliases?: { description?: string };
        filename?: { description?: string };
      };
    }
  )?.properties;
  assert.match(
    filesProperties?.query?.description ?? "",
    /call action="send" with the resolved target/
  );
  assert.match(filesProperties?.path?.description ?? "", /canonical save location/);
  assert.match(filesProperties?.alias?.description ?? "", /Human-readable working-file alias/);
  assert.match(
    filesProperties?.aliases?.description ?? "",
    /Human-readable working-file aliases to deliver/
  );
  assert.match(filesProperties?.filename?.description ?? "", /does not replace path/);
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
    /count=N means N separate final images in this one job, not a collage, contact sheet, grid, or multiple panels/
  );
  assert.match(imageGenerate?.description ?? "", /outputMode='series'/);
  assert.match(imageGenerate?.description ?? "", /seriesItems/);
  assert.match(
    imageGenerate?.description ?? "",
    /do NOT claim they are already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId/
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
    /count=N means N separate final edited images in this one job, not a collage, contact sheet, grid, or multiple panels/
  );
  assert.match(imageEdit?.description ?? "", /outputMode='series'/);
  assert.match(imageEdit?.description ?? "", /seriesItems/);
  assert.match(
    imageEdit?.description ?? "",
    /do NOT claim it is already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId/
  );
  assert.deepEqual(imageEditBackground?.enum, ["auto", "transparent", "opaque"]);
  assert.match(imageEditBackground?.description ?? "", /remove background/);
  const videoGenerate = projected.tools.find((tool) => tool.name === "video_generate");
  if (videoGenerate !== undefined) {
    assert.match(
      videoGenerate.description ?? "",
      /do NOT claim it is already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId/
    );
  }

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
      properties?: { outputMode?: { enum?: unknown[] }; seriesItems?: { type?: string } };
    }
  )?.properties;
  assert.deepEqual(imageGenerateOutputMode?.outputMode?.enum, ["variants", "series"]);
  assert.equal(imageGenerateOutputMode?.seriesItems?.type, "array");

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
      properties?: { outputMode?: { enum?: unknown[] }; seriesItems?: { type?: string } };
    }
  )?.properties;
  assert.deepEqual(imageEditOutputMode?.outputMode?.enum, ["variants", "series"]);
  assert.equal(imageEditOutputMode?.seriesItems?.type, "array");

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
  const documentProperties = (
    document?.inputSchema as {
      properties?: {
        descriptorMode?: { enum?: unknown[] };
        docId?: { description?: string };
        fileRef?: { description?: string };
        visualStyle?: { enum?: unknown[]; description?: string };
        imagePolicy?: { enum?: unknown[]; description?: string };
        visualDensity?: { enum?: unknown[]; description?: string };
      };
    }
  )?.properties;
  assert.deepEqual(documentProperties?.descriptorMode?.enum, [
    "create_pdf_document",
    "create_presentation",
    "revise_document",
    "export_or_redeliver"
  ]);
  assert.match(document?.description ?? "", /existing PersAI document ids/);
  assert.match(
    documentProperties?.docId?.description ?? "",
    /revise_document \(current chat\) and export_or_redeliver/
  );
  // ADR-097 Slice 5 — descriptor sharpening assertions
  assert.match(
    documentProperties?.fileRef?.description ?? "",
    /MUST be a UUID/,
    "fileRef description must contain 'MUST be a UUID'"
  );
  assert.match(
    documentProperties?.fileRef?.description ?? "",
    /deadbeef/,
    "fileRef description must contain an example UUID"
  );
  assert.doesNotMatch(
    document?.description ?? "",
    /file_ref/,
    "tool description must not use snake_case file_ref (should be camelCase fileRef)"
  );
  assert.match(
    documentProperties?.docId?.description ?? "",
    /fileRef/,
    "docId description must reference camelCase fileRef (the cross-chat alternative)"
  );
  assert.deepEqual(documentProperties?.visualStyle?.enum, [
    "professional_modern",
    "bold_editorial",
    "minimal_clean",
    "illustrated_storytelling"
  ]);
  assert.deepEqual(documentProperties?.imagePolicy?.enum, [
    "ai_generated",
    "web_free_to_use",
    "pictographic",
    "text_only"
  ]);
  assert.deepEqual(documentProperties?.visualDensity?.enum, [
    "balanced",
    "visual_heavy",
    "text_heavy"
  ]);
  assert.match(documentProperties?.visualStyle?.description ?? "", /presentation-only/);
  assert.match(documentProperties?.imagePolicy?.description ?? "", /visual deck/);
  assert.match(documentProperties?.visualDensity?.description ?? "", /denser slide copy/);
  const scheduledActionKindDescription = (
    scheduledAction?.inputSchema as {
      properties?: {
        kind?: { description?: string };
      };
    }
  )?.properties?.kind?.description;
  assert.match(scheduledActionKindDescription ?? "", /user_reminder/);
  assert.match(scheduledActionKindDescription ?? "", /background_task/);
}

void run();
