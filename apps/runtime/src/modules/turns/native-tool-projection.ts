import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MAX_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  PERSAI_RUNTIME_MEMORY_WRITE_KINDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  PERSAI_RUNTIME_BROWSER_OPERATION_KINDS,
  PERSAI_RUNTIME_TTS_DELIVERY_KINDS,
  PERSAI_RUNTIME_TTS_TONE_TAGS,
  PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES,
  type ProviderGatewayToolDefinition,
  type PersaiRuntimeBrowserProviderId,
  type PersaiRuntimeImageEditProviderId,
  type RuntimeKnowledgeAccessSourceConfig,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";

export interface RuntimeNativeToolProjection {
  tools: ProviderGatewayToolDefinition[];
  knowledgeSearchSources: RuntimeKnowledgeAccessSourceConfig[];
  knowledgeFetchSources: RuntimeKnowledgeAccessSourceConfig[];
}

const WEB_FETCH_MAX_CHARS_CAP = 50_000;
const WEB_SEARCH_MAX_COUNT = 20;
const KNOWLEDGE_SEARCH_MAX_RESULTS = 8;
const MEMORY_WRITE_MAX_CHARS = 500;
const REMINDER_CONTEXT_MESSAGES_MAX = 10;

export function projectRuntimeNativeTools(
  bundle: AssistantRuntimeBundle,
  options?: { allowModelToolExposure?: boolean }
): RuntimeNativeToolProjection {
  if (options?.allowModelToolExposure === false) {
    return {
      tools: [],
      knowledgeSearchSources: [],
      knowledgeFetchSources: []
    };
  }

  const projectedKnowledgeSearchSources = bundle.runtime.knowledgeAccess.sources.filter(
    (sourceConfig) =>
      sourceConfig.source === "document" ||
      sourceConfig.source === "memory" ||
      sourceConfig.source === "chat" ||
      sourceConfig.source === "preset" ||
      sourceConfig.source === "subscription" ||
      sourceConfig.source === "global"
  );
  const projectedKnowledgeFetchSources = bundle.runtime.knowledgeAccess.sources.filter(
    (sourceConfig) =>
      sourceConfig.source === "document" ||
      sourceConfig.source === "memory" ||
      sourceConfig.source === "chat" ||
      sourceConfig.source === "preset" ||
      sourceConfig.source === "subscription" ||
      sourceConfig.source === "global"
  );

  const projectedTools: ProviderGatewayToolDefinition[] = [
    createSummarizeContextToolDefinition(bundle),
    createCompactContextToolDefinition(bundle),
    createMemoryWriteToolDefinition()
  ];
  if (projectedKnowledgeSearchSources.length > 0) {
    projectedTools.push(createKnowledgeSearchToolDefinition(projectedKnowledgeSearchSources));
  }
  if (projectedKnowledgeFetchSources.length > 0) {
    projectedTools.push(createKnowledgeFetchToolDefinition(projectedKnowledgeFetchSources));
  }
  const webSearchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_search");
  const webSearchCredential = resolveConfiguredCredentialRef(bundle, "web_search");
  if (
    webSearchPolicy !== null &&
    webSearchCredential !== null &&
    supportsCurrentNativeWebSearchProvider(webSearchCredential.providerId ?? null)
  ) {
    projectedTools.push(createWebSearchToolDefinition());
  }
  const webFetchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_fetch");
  const webFetchCredential = resolveConfiguredCredentialRef(bundle, "web_fetch");
  if (webFetchPolicy !== null && webFetchCredential !== null) {
    projectedTools.push(createWebFetchToolDefinition());
  }
  const browserPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "browser", "worker");
  const browserCredential = resolveConfiguredCredentialRef(bundle, "browser");
  if (
    browserPolicy !== null &&
    browserCredential !== null &&
    supportsCurrentNativeBrowserProvider(bundle, browserCredential.providerId ?? null)
  ) {
    projectedTools.push(createBrowserToolDefinition(bundle));
  }
  const imageGeneratePolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    "image_generate",
    "worker"
  );
  const imageGenerateCredential = resolveConfiguredCredentialRef(bundle, "image_generate");
  if (
    imageGeneratePolicy !== null &&
    imageGenerateCredential !== null &&
    supportsCurrentNativeImageGenerateProvider(imageGenerateCredential.providerId ?? null)
  ) {
    projectedTools.push(createImageGenerateToolDefinition());
  }
  const imageEditPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "image_edit", "worker");
  const imageEditCredential = resolveConfiguredCredentialRef(bundle, "image_edit");
  if (
    imageEditPolicy !== null &&
    imageEditCredential !== null &&
    supportsCurrentNativeImageEditProvider(imageEditCredential.providerId ?? null)
  ) {
    projectedTools.push(createImageEditToolDefinition());
  }
  const videoGeneratePolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    "video_generate",
    "worker"
  );
  const videoGenerateCredential = resolveConfiguredCredentialRef(bundle, "video_generate");
  if (
    videoGeneratePolicy !== null &&
    videoGenerateCredential !== null &&
    supportsCurrentNativeVideoGenerateProvider(videoGenerateCredential.providerId ?? null)
  ) {
    projectedTools.push(createVideoGenerateToolDefinition());
  }
  const ttsPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "tts", "worker");
  const ttsCredential = bundle.governance.toolCredentialRefs.tts ?? null;
  if (
    ttsPolicy !== null &&
    ttsCredential !== null &&
    supportsCurrentNativeTtsProvider(ttsCredential)
  ) {
    projectedTools.push(createTtsToolDefinition());
  }
  const scheduledActionPolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    "scheduled_action",
    "worker"
  );
  if (scheduledActionPolicy !== null) {
    projectedTools.push(createScheduledActionToolDefinition());
  }

  return {
    tools: projectedTools,
    knowledgeSearchSources: projectedKnowledgeSearchSources,
    knowledgeFetchSources: projectedKnowledgeFetchSources
  };
}

function createSummarizeContextToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.summarizeToolCode,
    description:
      "Create a concise shared-context summary for the current session without changing later-turn compaction state. Use when the user explicitly asks to summarize earlier context or when you need a temporary summary to continue reasoning.",
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactContextToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.compactToolCode,
    description:
      "Compress earlier session context into the durable shared compaction state for this conversation. Use when the user explicitly asks to compact/compress context or when context pressure blocks progress.",
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactionInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      instructions: {
        type: "string",
        description: "Optional guidance about what the summary should preserve."
      }
    }
  };
}

function createMemoryWriteToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "memory_write",
    description:
      "Write one concise durable memory for the current assistant-user pair. Use only for stable user facts, preferences, or open loops that will matter in later conversations. Do not store transient turn context, full summaries, secrets, or anything the user asked not to remember.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "memory"],
      properties: {
        kind: {
          type: "string",
          enum: [...PERSAI_RUNTIME_MEMORY_WRITE_KINDS],
          description: "Durable memory class: fact, preference, or open_loop."
        },
        memory: {
          type: "string",
          maxLength: MEMORY_WRITE_MAX_CHARS,
          description: "One concise durable memory statement to store."
        }
      }
    }
  };
}

function createWebSearchToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "web_search",
    description:
      "Search the public web through the currently configured search provider. Use this when you need sources or links about a topic and do not already have one exact URL to fetch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Search query string."
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: WEB_SEARCH_MAX_COUNT,
          description: "Maximum number of search results to return."
        }
      }
    }
  };
}

function createKnowledgeSearchToolDefinition(
  sourceConfigs: RuntimeKnowledgeAccessSourceConfig[]
): ProviderGatewayToolDefinition {
  return {
    name: "knowledge_search",
    description:
      "Search assistant-owned or PersAI-owned knowledge and return lightweight references with snippets. Use this before fetching any excerpt when you need facts from uploaded documents, prior chats, preset/config docs, subscription state, or global product knowledge.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["source", "query"],
      properties: {
        source: {
          type: "string",
          enum: sourceConfigs.map((sourceConfig) => sourceConfig.source),
          description: "Knowledge source namespace to search."
        },
        query: {
          type: "string",
          description: "Search query describing the fact or passage you need."
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: KNOWLEDGE_SEARCH_MAX_RESULTS,
          description: "Maximum number of references to return."
        }
      }
    }
  };
}

function createKnowledgeFetchToolDefinition(
  sourceConfigs: RuntimeKnowledgeAccessSourceConfig[]
): ProviderGatewayToolDefinition {
  return {
    name: "knowledge_fetch",
    description:
      "Fetch one bounded excerpt or transcript window from assistant-owned or PersAI-owned knowledge by referenceId returned from knowledge_search. Use this to inspect the exact source passage instead of asking for whole documents, full chat histories, or full config dumps.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["source", "referenceId"],
      properties: {
        source: {
          type: "string",
          enum: sourceConfigs.map((sourceConfig) => sourceConfig.source),
          description: "Knowledge source namespace for the reference."
        },
        referenceId: {
          type: "string",
          description: "Reference id returned by knowledge_search."
        }
      }
    }
  };
}

function createWebFetchToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "web_fetch",
    description:
      "Fetch and extract the main content of a public webpage through the current web-fetch provider. Use this when you already know the exact URL and need page content, not a search results list.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to fetch."
        },
        extractMode: {
          type: "string",
          enum: [...PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES],
          description: 'Return content as "markdown" (default) or "text".'
        },
        maxChars: {
          type: "integer",
          minimum: 100,
          maximum: WEB_FETCH_MAX_CHARS_CAP,
          description: "Maximum number of characters to return after extraction."
        }
      }
    }
  };
}

function createBrowserToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: "browser",
    description:
      "Use a real browser for JavaScript-rendered or interactive pages when web_search or web_fetch are insufficient. Use action=snapshot to inspect a page and action=act only after the user explicitly wants page interaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action", "url"],
      properties: {
        action: {
          type: "string",
          enum: [...bundle.runtime.browser.actions],
          description:
            'Use "snapshot" to inspect a page or "act" to perform bounded browser operations before returning a fresh snapshot.'
        },
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to open in the browser."
        },
        maxChars: {
          type: "integer",
          minimum: 500,
          maximum: MAX_RUNTIME_BROWSER_MAX_CHARS,
          description: "Maximum number of page-text characters to return."
        },
        operations: {
          type: "array",
          maxItems: MAX_RUNTIME_BROWSER_OPERATIONS,
          description:
            'Required for action="act". Each step is one bounded browser operation using a CSS selector or keyboard input.',
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: {
                type: "string",
                enum: [...PERSAI_RUNTIME_BROWSER_OPERATION_KINDS]
              },
              selector: {
                type: "string",
                description: "CSS selector for click/type/select/wait_for_selector operations."
              },
              text: {
                type: "string",
                description: 'Text to type when kind="type".'
              },
              key: {
                type: "string",
                description: 'Keyboard key to press when kind="press", for example "Enter".'
              },
              value: {
                type: "string",
                description: 'Option value to select when kind="select_option".'
              },
              timeoutMs: {
                type: "integer",
                minimum: 0,
                maximum: MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
                description:
                  "Optional timeout for wait_for_selector or required delay for wait_for_timeout."
              }
            }
          }
        }
      }
    }
  };
}

function createImageGenerateToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "image_generate",
    description:
      "Generate brand-new images from a text prompt. Use this for image creation only; do not use it for editing existing images or for video generation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Text prompt describing the image to generate."
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: MAX_RUNTIME_IMAGE_GENERATE_COUNT,
          description: "Optional number of images to generate."
        },
        filename: {
          type: "string",
          description: "Optional filename hint for the generated image attachment."
        },
        size: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_GENERATE_SIZES],
          description:
            'Optional output size hint. Use "auto" to let the provider choose the best size.'
        }
      }
    }
  };
}

function createImageEditToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "image_edit",
    description:
      'Edit images only when the user explicitly asks to modify an image, for example replace, remove, add, recolor, restyle, insert, or draw something. Never use this tool for describing an image, OCR, solving a task from an image, or answering "what do you see". Use the current user message attachments only: with one image, edit that image; with multiple images, edit only the source image and return one edited version of that source image. Use optional referenceImageIndex only as a visual guide for style, appearance, makeup, color, lighting, or background cues from another current-turn image. If the user says things like "make it like the second photo", "как на втором фото", or similar, treat image #1 as the source and image #2 as the reference unless the user clearly says otherwise. Ask a clarifying question instead of guessing when the roles are still unclear.',
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Text instruction describing how the attached image should be edited."
        },
        sourceImageIndex: {
          type: "integer",
          minimum: 1,
          description:
            "Optional 1-based index of the current-turn image attachment to edit. Required when multiple images are attached and the source image is clear."
        },
        referenceImageIndex: {
          type: "integer",
          minimum: 1,
          description:
            "Optional 1-based index of a second current-turn image attachment to use only as a visual style/appearance/background reference. The tool must still return one edited version of the source image, not a separate edit of the reference image."
        },
        filename: {
          type: "string",
          description: "Optional filename hint for the edited image attachment."
        },
        size: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_GENERATE_SIZES],
          description:
            'Optional output size hint. Use "auto" to let the provider choose the best size.'
        }
      }
    }
  };
}

function createVideoGenerateToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "video_generate",
    description:
      "Generate a short brand-new video clip from a text prompt. Use this only when the user explicitly wants a generated video, animation, or clip. You may optionally guide the video with one current-turn image attachment as a first-frame style or appearance reference by setting referenceImageIndex. Do not use this tool for editing an existing video or for answering questions about an image.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Text prompt describing the video clip to generate."
        },
        referenceImageIndex: {
          type: "integer",
          minimum: 1,
          description:
            "Optional 1-based index of the current-turn image attachment to use as a visual reference or first frame. Set this whenever an attached image should guide the video."
        },
        filename: {
          type: "string",
          description: "Optional filename hint for the generated video attachment."
        },
        size: {
          type: "string",
          enum: [...PERSAI_RUNTIME_VIDEO_GENERATE_SIZES],
          description:
            "Optional output size hint. Leave it unset when the attached reference image should drive the framing."
        },
        seconds: {
          type: "integer",
          enum: [...PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS],
          description: "Optional output duration in seconds."
        }
      }
    }
  };
}

function createTtsToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "tts",
    description:
      "Generate spoken audio for the current assistant persona. Use this only when the user explicitly wants a voice note, spoken reply, narration, or audio version of text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["text", "toneTag"],
      properties: {
        text: {
          type: "string",
          description: "The exact text that should be spoken aloud."
        },
        toneTag: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_TONE_TAGS],
          description:
            "Speech tone steering tag. Match the assistant's intended emotional delivery for this audio."
        },
        deliveryKind: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_DELIVERY_KINDS],
          description:
            'Optional output kind. Use "voice_note" for a short messaging-style voice note or "audio" for a normal audio file.'
        }
      }
    }
  };
}

function createScheduledActionToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "scheduled_action",
    description: [
      "Schedule actions for both user-visible reminders and hidden assistant follow-ups.",
      'Use audience="user" for reminders the user should actually see, for example reminders in a few hours, daily or weekly nudges, and deadlines.',
      'Use audience="assistant" for background checks and reasoning, for example coming back to a project or habit later, inspecting memory, and when available using knowledge_search or knowledge_fetch before deciding whether any gentle user-facing nudge is appropriate.',
      "Background assistant actions MUST NOT directly message the user.",
      'For assistant-side conditional checks, first verify the condition, then if a user-facing follow-up is requested and the condition is met create a new scheduled_action with audience="user" and an immediate schedule such as delayMs=1; otherwise stay quiet.',
      'They are for checking progress or changes, noticing the user is already doing well and quietly doing nothing, or, when it is helpful and not pushy, scheduling a new scheduled_action with audience="user" and a short human-like message.',
      'Respect explicit "don\'t remind me" or paused/cancelled signals, avoid spamming multiple unsolicited reminders about the same thing, and phrase user-facing reminders as low-pressure offers rather than commands.',
      "For create, title, audience, and exactly one schedule are required: runAt, delayMs, everyMs, or cronExpr.",
      "Prefer taskId from an earlier list result when pausing, resuming, or cancelling; if taskId is unavailable, use titleMatch to resolve one current task by title."
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "pause", "resume", "cancel"],
          description: "Scheduled-action operation to perform."
        },
        audience: {
          type: "string",
          enum: ["user", "assistant"],
          description:
            'Required for create. Use "user" for a user-visible reminder and "assistant" for a hidden background assistant action.'
        },
        title: {
          type: "string",
          description: "Required for create. Human-readable scheduled-action title."
        },
        reminderText: {
          type: "string",
          description:
            'Optional action text. For audience="user" this is the message later delivered to the user. For audience="assistant" this becomes hidden follow-up guidance/context for the assistant.'
        },
        actionType: {
          type: "string",
          description:
            'Optional for audience="assistant". Short machine-readable action kind such as "follow_up" or "check_status".'
        },
        actionPayload: {
          type: "object",
          additionalProperties: true,
          description:
            'Optional for audience="assistant". Structured JSON payload with background-action parameters.'
        },
        taskId: {
          type: "string",
          description:
            "Preferred scheduled-action identifier for pause, resume, or cancel. Use the id returned by list or create."
        },
        titleMatch: {
          type: "string",
          description:
            "Fallback partial title match for pause, resume, or cancel when taskId is unavailable."
        },
        runAt: {
          type: "string",
          description:
            "Absolute future datetime in ISO format for a one-time scheduled action after the time has already been resolved."
        },
        delayMs: {
          type: "number",
          minimum: 1,
          description:
            "Relative delay in milliseconds for a one-time scheduled action. Prefer this for requests like 'in 5 minutes'."
        },
        everyMs: {
          type: "number",
          minimum: 1,
          description: "Recurring interval in milliseconds for a repeated scheduled action."
        },
        anchorAt: {
          type: "string",
          description: "Optional ISO anchor time for recurring interval schedules."
        },
        cronExpr: {
          type: "string",
          description: "Cron expression for recurring scheduled actions."
        },
        timezone: {
          type: "string",
          description: "Optional IANA timezone for cron-based schedules."
        },
        contextMessages: {
          type: "integer",
          minimum: 0,
          maximum: REMINDER_CONTEXT_MESSAGES_MAX,
          description:
            "Optional number of recent chat messages to snapshot into the scheduled action context."
        }
      }
    }
  };
}

function resolveAllowedModelVisibleToolPolicy(
  bundle: AssistantRuntimeBundle,
  toolCode: string,
  executionMode: RuntimeToolPolicy["executionMode"] = "inline"
): RuntimeToolPolicy | null {
  const policy =
    bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
  if (
    policy === null ||
    policy.visibleToModel !== true ||
    policy.enabled !== true ||
    policy.usageRule !== "allowed" ||
    policy.executionMode !== executionMode
  ) {
    return null;
  }
  return policy;
}

function resolveConfiguredCredentialRef(
  bundle: AssistantRuntimeBundle,
  toolCode: string
): AssistantRuntimeBundleToolCredentialRef | null {
  const credential = bundle.governance.toolCredentialRefs[toolCode] ?? null;
  if (credential === null || credential.configured !== true) {
    return null;
  }
  return credential;
}

function supportsCurrentNativeWebSearchProvider(providerId: string | null): boolean {
  return (
    providerId === null ||
    providerId === "tavily" ||
    providerId === "brave" ||
    providerId === "perplexity" ||
    providerId === "google"
  );
}

function supportsCurrentNativeBrowserProvider(
  bundle: AssistantRuntimeBundle,
  providerId: string | null
): boolean {
  return (
    providerId === null ||
    bundle.runtime.browser.providerIds.includes(providerId as PersaiRuntimeBrowserProviderId) ||
    providerId === bundle.runtime.browser.defaultProviderId
  );
}

function supportsCurrentNativeImageGenerateProvider(providerId: string | null): boolean {
  return providerId === null || providerId === "openai";
}

function supportsCurrentNativeImageEditProvider(providerId: string | null): boolean {
  const resolved = providerId ?? "openai";
  return PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS.includes(
    resolved as PersaiRuntimeImageEditProviderId
  );
}

function supportsCurrentNativeVideoGenerateProvider(providerId: string | null): boolean {
  const resolved = providerId ?? "openai";
  return resolved === "openai";
}

function supportsCurrentNativeTtsProvider(
  credential: AssistantRuntimeBundleToolCredentialRef
): boolean {
  const candidates = [credential, ...(credential.fallbacks ?? [])];
  return candidates.some(
    (entry) =>
      entry.configured === true &&
      (entry.providerId === "elevenlabs" ||
        entry.providerId === "yandex" ||
        entry.providerId === "openai")
  );
}
