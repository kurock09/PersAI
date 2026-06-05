import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";

export async function runNativeToolProjectionTest(): Promise<void> {
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
    /For distinct carousel\/slideshow\/frame requests, set outputMode='series'/i
  );
  assert.match(imageGenerate?.description ?? "", /use image_edit with sourceImageAlias/i);
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
    /For distinct carousel\/slideshow\/frame requests, set outputMode='series'/i
  );
  assert.match(imageEdit?.description ?? "", /same source product\/object identity across slides/i);
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
    assert.deepEqual(videoGenerateSchema.required ?? [], ["prompt"]);
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
    assert.match(
      videoGenerate.description ?? "",
      /do NOT claim it is already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId/
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
      /materialized shortlist/i
    );
    assert.match(videoGenerate.description ?? "", /Available voiceKeys/i);
    assert.match(videoGenerate.description ?? "", /owen/i);
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
  assert.match(
    heygenTalkingTool?.description ?? "",
    /talking-avatar/i,
    "Slice 8: description must mention talking-avatar when talkingVideoEnabled=true"
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
  assert.doesNotMatch(
    runwayTalkingDisabledTool?.description ?? "",
    /talking-avatar/i,
    "Slice 8: description must NOT mention talking-avatar when talkingVideoEnabled=false"
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
    voiceLabel: "Russian (Female)"
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

  // Case 1: talkingVideoEnabled=true + non-empty videoPersonaCatalog (2 personas)
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

  // Section 1: when to use talking_avatar
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /talking-avatar video/,
    "Slice 10: description must contain section 1 trigger conditions"
  );
  // Section 2: persona resolution
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /Persona names are unique within a workspace/,
    "Slice 10: description must contain section 2 unique-name disambiguation statement"
  );
  // Section 3: persona creation guidance
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /You cannot create personas yourself/,
    "Slice 10: description must contain section 3 persona creation guidance"
  );
  // Section 4: single character per call
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /Each video_generate call produces ONE clip with ONE speaker/,
    "Slice 10: description must contain section 4 single speaker per call"
  );
  // Section 7: persona shortlist renders both personas
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /displayName="Маша"/,
    "Slice 10: persona A displayName must appear in description"
  );
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    new RegExp(PERSONA_A.personaId),
    "Slice 10: persona A personaId must appear in description"
  );
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /displayName="Anna"/,
    "Slice 10: persona B displayName must appear in description"
  );
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    new RegExp(PERSONA_B.personaId),
    "Slice 10: persona B personaId must appear in description"
  );
  // Voice shortlist hint still appears
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /Available voiceKeys for voice_control/,
    "Slice 10: voice shortlist hint must still appear when talkingVideoEnabled=true"
  );
  assert.match(
    slice10TwoPersonasTool?.description ?? "",
    /masha_voice/,
    "Slice 10: voice key from shortlist must appear in description"
  );

  // Case 2: talkingVideoEnabled=true + empty videoPersonaCatalog
  const slice10EmptyPersonasBundle = makeHeygenTalkingBundle({
    provider: "heygen",
    schema: "persai.runtimeVideoPersonaCatalog.v1",
    personas: []
  });
  const slice10EmptyTool = projectRuntimeNativeTools(slice10EmptyPersonasBundle).tools.find(
    (t) => t.name === "video_generate"
  );
  assert.match(
    slice10EmptyTool?.description ?? "",
    /none yet/,
    "Slice 10: empty persona catalog must render 'none yet' message"
  );
  assert.match(
    slice10EmptyTool?.description ?? "",
    /Settings → Characters/,
    "Slice 10: empty persona catalog must suggest Settings → Characters"
  );

  // Case 3: talkingVideoEnabled=true + missing videoPersonaCatalog (undefined) → same as empty
  const slice10UndefinedPersonasBundle = makeHeygenTalkingBundle(undefined);
  const slice10UndefinedTool = projectRuntimeNativeTools(slice10UndefinedPersonasBundle).tools.find(
    (t) => t.name === "video_generate"
  );
  assert.match(
    slice10UndefinedTool?.description ?? "",
    /none yet/,
    "Slice 10: missing persona catalog must render 'none yet' message (defensive default)"
  );

  // Case 4: talkingVideoEnabled=false → none of the talking-avatar sections appear
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
  assert.doesNotMatch(
    slice10TalkingDisabledTool?.description ?? "",
    /talking-avatar video/,
    "Slice 10: talking-avatar section 1 must NOT appear when talkingVideoEnabled=false"
  );
  assert.doesNotMatch(
    slice10TalkingDisabledTool?.description ?? "",
    /You cannot create personas yourself/,
    "Slice 10: section 3 must NOT appear when talkingVideoEnabled=false"
  );
  assert.doesNotMatch(
    slice10TalkingDisabledTool?.description ?? "",
    /videoPersonas/,
    "Slice 10: persona shortlist must NOT appear when talkingVideoEnabled=false"
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
    snapshotTool?.description?.includes("Use mode='talking_avatar'"),
    "Slice 10 snapshot: contains mode selection anchor"
  );
  assert.ok(
    snapshotTool?.description?.includes("Persona names are unique within a workspace"),
    "Slice 10 snapshot: contains unique-name anchor"
  );
  assert.ok(
    snapshotTool?.description?.includes("You cannot create personas yourself"),
    "Slice 10 snapshot: contains persona-creation anchor"
  );
  assert.ok(
    snapshotTool?.description?.includes(
      "Each video_generate call produces ONE clip with ONE speaker"
    ),
    "Slice 10 snapshot: contains single-speaker anchor"
  );
  assert.ok(
    snapshotTool?.description?.includes(PERSONA_A.personaId),
    "Slice 10 snapshot: persona A id present"
  );
  assert.ok(
    snapshotTool?.description?.includes(PERSONA_B.personaId),
    "Slice 10 snapshot: persona B id present"
  );

  console.log("Slice 10 description char count:", snapshotTool?.description?.length ?? 0);

  // ── ADR-109 Slice 10c Fix #3f: projection tests for separate talking-avatar credential ──
  // The talking-avatar schema fields (mode/speechText etc.) and description sections are
  // now gated on toolCredentialRefs["video_generate_talking_avatar"] being present,
  // NOT on the cinematic credential's providerId or talkingVideoEnabled alone.

  // Slice 10c Projection Test 1: video_generate_talking_avatar present → description
  // includes talking-avatar block (section 1 anchor and persona shortlist anchor).
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
    /talking-avatar/i,
    "Slice 10c projection: description must include talking-avatar block when video_generate_talking_avatar ref is present"
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
  // OMITS talking-avatar block even if cinematic providerId happens to be heygen-like.
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
  assert.doesNotMatch(
    slice10cWithoutTalkingTool?.description ?? "",
    /talking-avatar video/,
    "Slice 10c projection: description must NOT include talking-avatar section when video_generate_talking_avatar ref is absent"
  );
  assert.equal(
    (slice10cWithoutTalkingTool?.inputSchema as { properties?: Record<string, unknown> })
      ?.properties?.mode,
    undefined,
    "Slice 10c projection: mode field must NOT appear in schema when video_generate_talking_avatar ref is absent"
  );
}
