import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MAX_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  PERSAI_RUNTIME_FILES_TOOL_ACTIONS,
  PERSAI_RUNTIME_MEMORY_WRITE_KINDS,
  PERSAI_RUNTIME_IMAGE_BACKGROUNDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  PERSAI_RUNTIME_BROWSER_OPERATION_KINDS,
  PERSAI_RUNTIME_TTS_DELIVERY_KINDS,
  PERSAI_RUNTIME_TTS_TONE_TAGS,
  PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES,
  type ProviderGatewayToolDefinition,
  type PersaiRuntimeKnowledgeSource,
  type PersaiRuntimeBrowserProviderId,
  type PersaiRuntimeImageEditProviderId,
  type RuntimeKnowledgeAccessSourceConfig,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
// ADR-074 Slice L1: per-turn hard caps live in `tool-budget-policy.ts` so
// runtime enforcement and model-facing tool descriptions stay in sync. Do
// not duplicate the numbers here; if the cap changes, edit one place.
import { resolveAdvertisedPerTurnCap } from "./tool-budget-policy";

/**
 * ADR-074 Slice L1: render the per-turn cap hint that goes into a tool's
 * model-facing description. The cap is now per-assistant (sourced from
 * `RuntimeToolPolicy.perTurnCap` if set, otherwise the
 * `TOOL_HARD_CAP_PER_TURN` code default), so the hint reflects what will
 * actually fire at runtime — not a hard-coded global. Returns `null` when
 * the tool has no effective cap (e.g. memory_write), in which case no hint
 * is appended.
 */
function describePerTurnCap(toolCode: string, policy: RuntimeToolPolicy): string | null {
  const overrides = new Map<string, number | null>();
  if (policy.perTurnCap !== undefined && policy.perTurnCap !== null) {
    overrides.set(toolCode, policy.perTurnCap);
  }
  const cap = resolveAdvertisedPerTurnCap(toolCode, overrides);
  if (cap === null) {
    return null;
  }
  const calls = cap === 1 ? "1 call" : `${String(cap)} calls`;
  return `Per-turn cap: ${calls}; further calls return tool_budget_exhausted and you must reply with what you have.`;
}

function appendPerTurnCapHint(base: string, toolCode: string, policy: RuntimeToolPolicy): string {
  const hint = describePerTurnCap(toolCode, policy);
  return hint === null ? base : `${base} ${hint}`;
}

function appendToolDefinitionHint(base: string, hint: string): string {
  return base.includes(hint) ? base : `${base} ${hint}`;
}

/**
 * ADR-074 Slice L1.1 — resolve the effective `image_generate.count.maximum`
 * the model should see in its tool schema. Returns the smaller of the
 * runtime hard cap (`MAX_RUNTIME_IMAGE_GENERATE_COUNT`) and the per-turn
 * cap configured for this assistant. Falls back to the runtime hard cap
 * when no per-turn cap is set. Always returns at least 1 so the schema
 * never advertises an unreachable `maximum`.
 */
function resolveImageGenerateCountCap(policy: RuntimeToolPolicy): number {
  const overrides = new Map<string, number | null>();
  if (policy.perTurnCap !== undefined && policy.perTurnCap !== null) {
    overrides.set("image_generate", policy.perTurnCap);
  }
  const cap = resolveAdvertisedPerTurnCap("image_generate", overrides);
  if (cap === null) {
    return MAX_RUNTIME_IMAGE_GENERATE_COUNT;
  }
  return Math.max(1, Math.min(MAX_RUNTIME_IMAGE_GENERATE_COUNT, cap));
}

export interface RuntimeNativeToolProjection {
  tools: ProviderGatewayToolDefinition[];
  knowledgeSearchSources: RuntimeKnowledgeAccessSourceConfig[];
  knowledgeFetchSources: RuntimeKnowledgeAccessSourceConfig[];
}

const WEB_FETCH_MAX_CHARS_CAP = 50_000;
const WEB_SEARCH_MAX_COUNT = 20;
const FILES_LIST_MAX_LIMIT = 200;
const KNOWLEDGE_SEARCH_MAX_RESULTS = 8;
const MEMORY_WRITE_MAX_CHARS = 500;
const REMINDER_CONTEXT_MESSAGES_MAX = 10;

export function projectRuntimeNativeTools(
  bundle: AssistantRuntimeBundle,
  options?: {
    allowModelToolExposure?: boolean;
    allowedKnowledgeSearchSources?: readonly PersaiRuntimeKnowledgeSource[];
    allowedKnowledgeFetchSources?: readonly PersaiRuntimeKnowledgeSource[];
  }
): RuntimeNativeToolProjection {
  if (options?.allowModelToolExposure === false) {
    return {
      tools: [],
      knowledgeSearchSources: [],
      knowledgeFetchSources: []
    };
  }

  const projectedKnowledgeSearchSources = filterProjectedKnowledgeSources(
    bundle.runtime.knowledgeAccess.sources,
    options?.allowedKnowledgeSearchSources
  );
  const projectedKnowledgeFetchSources = filterProjectedKnowledgeSources(
    bundle.runtime.knowledgeAccess.sources,
    options?.allowedKnowledgeFetchSources
  );

  const projectedTools: ProviderGatewayToolDefinition[] = [];
  const summarizeContextPolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    bundle.runtime.sharedCompaction.summarizeToolCode
  );
  if (summarizeContextPolicy !== null) {
    projectedTools.push(createSummarizeContextToolDefinition(bundle, summarizeContextPolicy));
  }
  const compactContextPolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    bundle.runtime.sharedCompaction.compactToolCode
  );
  if (compactContextPolicy !== null) {
    projectedTools.push(createCompactContextToolDefinition(bundle, compactContextPolicy));
  }
  const memoryWritePolicy = resolveAllowedModelVisibleToolPolicy(bundle, "memory_write");
  if (memoryWritePolicy !== null) {
    projectedTools.push(createMemoryWriteToolDefinition(memoryWritePolicy));
  }
  const quotaStatusPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "quota_status");
  if (quotaStatusPolicy !== null) {
    projectedTools.push(createQuotaStatusToolDefinition(quotaStatusPolicy));
  }
  const knowledgeSearchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "knowledge_search");
  if (projectedKnowledgeSearchSources.length > 0 && knowledgeSearchPolicy !== null) {
    projectedTools.push(
      createKnowledgeSearchToolDefinition(knowledgeSearchPolicy, projectedKnowledgeSearchSources)
    );
  }
  const knowledgeFetchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "knowledge_fetch");
  if (projectedKnowledgeFetchSources.length > 0 && knowledgeFetchPolicy !== null) {
    projectedTools.push(
      createKnowledgeFetchToolDefinition(knowledgeFetchPolicy, projectedKnowledgeFetchSources)
    );
  }
  const webSearchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_search");
  const webSearchCredential = resolveConfiguredCredentialRef(bundle, "web_search");
  if (
    webSearchPolicy !== null &&
    webSearchCredential !== null &&
    supportsCurrentNativeWebSearchProvider(webSearchCredential.providerId ?? null)
  ) {
    projectedTools.push(createWebSearchToolDefinition(webSearchPolicy));
  }
  const webFetchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_fetch");
  const webFetchCredential = resolveConfiguredCredentialRef(bundle, "web_fetch");
  if (webFetchPolicy !== null && webFetchCredential !== null) {
    projectedTools.push(createWebFetchToolDefinition(webFetchPolicy));
  }
  const browserPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "browser", "worker");
  const browserCredential = resolveConfiguredCredentialRef(bundle, "browser");
  if (
    browserPolicy !== null &&
    browserCredential !== null &&
    supportsCurrentNativeBrowserProvider(bundle, browserCredential.providerId ?? null)
  ) {
    projectedTools.push(createBrowserToolDefinition(bundle, browserPolicy));
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
    projectedTools.push(createImageGenerateToolDefinition(imageGeneratePolicy));
  }
  const imageEditPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "image_edit", "worker");
  const imageEditCredential = resolveConfiguredCredentialRef(bundle, "image_edit");
  if (
    imageEditPolicy !== null &&
    imageEditCredential !== null &&
    supportsCurrentNativeImageEditProvider(imageEditCredential.providerId ?? null)
  ) {
    projectedTools.push(createImageEditToolDefinition(imageEditPolicy));
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
    projectedTools.push(createVideoGenerateToolDefinition(videoGeneratePolicy));
  }
  const ttsPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "tts", "worker");
  const ttsCredential = bundle.governance.toolCredentialRefs.tts ?? null;
  if (
    ttsPolicy !== null &&
    ttsCredential !== null &&
    supportsCurrentNativeTtsProvider(ttsCredential)
  ) {
    projectedTools.push(createTtsToolDefinition(ttsPolicy));
  }
  const scheduledActionPolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    "scheduled_action",
    "worker"
  );
  if (scheduledActionPolicy !== null) {
    projectedTools.push(createScheduledActionToolDefinition(scheduledActionPolicy));
  }
  const backgroundTaskPolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    "background_task",
    "worker"
  );
  if (backgroundTaskPolicy !== null) {
    projectedTools.push(createBackgroundTaskToolDefinition(backgroundTaskPolicy));
  }
  const filesPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "files", "inline");
  if (filesPolicy !== null) {
    projectedTools.push(createFilesToolDefinition(filesPolicy));
  }
  const execPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "exec", "sandbox");
  if (execPolicy !== null) {
    projectedTools.push(createExecToolDefinition(execPolicy));
  }
  const shellPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "shell", "sandbox");
  if (shellPolicy !== null) {
    projectedTools.push(createShellToolDefinition(shellPolicy));
  }

  return {
    tools: projectedTools,
    knowledgeSearchSources: projectedKnowledgeSearchSources,
    knowledgeFetchSources: projectedKnowledgeFetchSources
  };
}

function filterProjectedKnowledgeSources(
  sources: RuntimeKnowledgeAccessSourceConfig[],
  allowedSources?: readonly PersaiRuntimeKnowledgeSource[]
): RuntimeKnowledgeAccessSourceConfig[] {
  const projectedSources = sources.filter(
    (sourceConfig) =>
      sourceConfig.source === "document" ||
      sourceConfig.source === "memory" ||
      sourceConfig.source === "chat" ||
      sourceConfig.source === "subscription" ||
      sourceConfig.source === "global"
  );
  if (allowedSources === undefined) {
    return projectedSources;
  }
  const allowed = new Set(allowedSources);
  return projectedSources.filter((sourceConfig) => allowed.has(sourceConfig.source));
}

function createSummarizeContextToolDefinition(
  bundle: AssistantRuntimeBundle,
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.summarizeToolCode,
    description: resolveToolDefinitionDescription(
      policy,
      "Create a concise shared-context summary for the current session without changing later-turn compaction state."
    ),
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactContextToolDefinition(
  bundle: AssistantRuntimeBundle,
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.compactToolCode,
    description: resolveToolDefinitionDescription(
      policy,
      "Compress earlier session context into the durable shared compaction state for this conversation."
    ),
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

function createMemoryWriteToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "memory_write",
    description: resolveToolDefinitionDescription(
      policy,
      "Write one concise durable memory for the current assistant-user pair, or close a previously-recorded open loop by its ref."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["write", "close"],
          description:
            'ADR-074 Slice M3.1: defaults to "write" (record a new durable memory). Use "close" to deterministically resolve a known open loop by its `ref`. When "close", `ref` is required and `kind`/`memory`/`closeOpenLoop` MUST be omitted.'
        },
        kind: {
          type: "string",
          enum: [...PERSAI_RUNTIME_MEMORY_WRITE_KINDS],
          description:
            'Required when action is "write" (or omitted). Durable memory class: fact, preference, or open_loop.'
        },
        memory: {
          type: "string",
          maxLength: MEMORY_WRITE_MAX_CHARS,
          description:
            'Required when action is "write" (or omitted). One concise durable memory statement to store.'
        },
        closeOpenLoop: {
          type: "boolean",
          description:
            'ADR-074 Slice M3 (legacy lexical close): set true on a `write` action ONLY when this memory_write also resolves a previously-recorded open loop and you do NOT have a precise `ref` from the carry-over block. The runtime will look up the most-similar active open-loop and mark it resolved. Prefer `action:"close"` with a `ref` from the carry-over block when one is available.'
        },
        ref: {
          type: "string",
          description:
            'Required when action is "close". Opaque open-loop reference shown next to each loop in the cross-session carry-over block as `[ref: ...]`. Pass it back verbatim to close that exact loop.'
        }
      }
    }
  };
}

function createQuotaStatusToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "quota_status",
    description: resolveToolDefinitionDescription(
      policy,
      "Read live PersAI quota status for the current assistant, compare public plans from the same source of truth, and create a checkout link when the user wants to open it now."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["report", "create_checkout"],
          description:
            "Optional action. Use 'report' (default) to inspect quota, limits, and plan options. Use 'create_checkout' when the user wants PersAI to open the checkout link now."
        },
        toolCode: {
          type: "string",
          description:
            "Optional tool code to inspect one quota-governed tool when action='report'. Leave unset to return non-media daily tool counters, the current quota bucket snapshot, monthly media quota rows, and visible plan options."
        },
        targetPlanCode: {
          type: "string",
          description:
            "Required when action='create_checkout'. Target paid plan code to open in checkout."
        },
        paymentMethodClass: {
          type: "string",
          enum: ["card", "sbp_qr"],
          description:
            "Required when action='create_checkout'. Payment method class for the payment intent."
        },
        confirmed: {
          type: "boolean",
          description:
            "Set true when the user wants PersAI to create the checkout link in this turn."
        }
      }
    }
  };
}

function createWebSearchToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "web_search",
    description: resolveToolDefinitionDescriptionWithHint(
      policy,
      appendPerTurnCapHint(
        "Search the public web through the currently configured search provider.",
        "web_search",
        policy
      ),
      "May be called in parallel with other independent searches."
    ),
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
  policy: RuntimeToolPolicy,
  sourceConfigs: RuntimeKnowledgeAccessSourceConfig[]
): ProviderGatewayToolDefinition {
  const sourceDescriptions = sourceConfigs
    .map(
      (sourceConfig) => `${sourceConfig.source}: ${describeKnowledgeSource(sourceConfig.source)}`
    )
    .join("; ");
  return {
    name: "knowledge_search",
    description: resolveToolDefinitionDescriptionWithHint(
      policy,
      "Search assistant-owned or PersAI-owned knowledge and return lightweight references with snippets. Use source global for Product KB text entries/files and plan catalog facts; think of it as Product KB, not a separate generic global base.",
      "May be called in parallel with other independent searches."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["source", "query"],
      properties: {
        source: {
          type: "string",
          enum: sourceConfigs.map((sourceConfig) => sourceConfig.source),
          description: `Knowledge source namespace to search. Available meanings: ${sourceDescriptions}.`
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
  policy: RuntimeToolPolicy,
  sourceConfigs: RuntimeKnowledgeAccessSourceConfig[]
): ProviderGatewayToolDefinition {
  const sourceDescriptions = sourceConfigs
    .map(
      (sourceConfig) => `${sourceConfig.source}: ${describeKnowledgeSource(sourceConfig.source)}`
    )
    .join("; ");
  return {
    name: "knowledge_fetch",
    description: resolveToolDefinitionDescriptionWithHint(
      policy,
      "Fetch one bounded excerpt or transcript window from assistant-owned or PersAI-owned knowledge by referenceId returned from knowledge_search. Use source global for Product KB references.",
      "May be called in parallel with other independent fetches when you already have the needed referenceIds."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["source", "referenceId"],
      properties: {
        source: {
          type: "string",
          enum: sourceConfigs.map((sourceConfig) => sourceConfig.source),
          description: `Knowledge source namespace for the reference. Available meanings: ${sourceDescriptions}.`
        },
        referenceId: {
          type: "string",
          description: "Reference id returned by knowledge_search."
        }
      }
    }
  };
}

function describeKnowledgeSource(source: RuntimeKnowledgeAccessSourceConfig["source"]): string {
  switch (source) {
    case "document":
      return "assistant/user uploaded knowledge";
    case "memory":
      return "assistant memory";
    case "chat":
      return "prior chat history";
    case "subscription":
      return "current workspace subscription and plan";
    case "global":
      return "Product KB, including admin-managed Product KB text entries/files and plan catalog facts";
    default:
      return source;
  }
}

function createWebFetchToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "web_fetch",
    description: resolveToolDefinitionDescriptionWithHint(
      policy,
      appendPerTurnCapHint(
        "Fetch and extract the main content of a public webpage through the current web-fetch provider.",
        "web_fetch",
        policy
      ),
      "May be called in parallel with other independent fetches."
    ),
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
  bundle: AssistantRuntimeBundle,
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: "browser",
    description: resolveToolDefinitionDescription(
      policy,
      "Use a real browser for JavaScript-rendered or interactive pages when web_search or web_fetch are insufficient."
    ),
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

function createImageGenerateToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  // ADR-074 Slice L1.1: clamp the model-facing `count.maximum` to the
  // effective per-turn cap (founder anchor: per-turn cap counts artifacts,
  // not just invocations, because OpenAI bills per generated image). This
  // closes the «I asked for 1 picture, model returned 3 by passing
  // count: 3» bypass observed live on 2026-04-23. With cap=1 the schema
  // now mechanically refuses count > 1; with cap=4 the model can still
  // batch four images in one call (cheaper for the provider per request).
  const effectiveCap = resolveImageGenerateCountCap(policy);
  return {
    name: "image_generate",
    description: resolveToolDefinitionDescription(
      policy,
      appendPerTurnCapHint(
        "Generate brand-new images from a text prompt. Each requested image counts against the per-turn cap and the daily quota.",
        "image_generate",
        policy
      )
    ),
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
          maximum: effectiveCap,
          description: `Optional number of images to generate (1..${String(effectiveCap)} on this assistant). Each image consumes one per-turn cap unit and one daily-quota unit.`
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
        },
        background: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_BACKGROUNDS],
          description:
            'Optional background behavior. Use "transparent" when the user asks for transparent background, cutout, sticker, icon, logo asset, or PNG with alpha. Use "opaque" only when the user explicitly wants a solid background. Defaults to "auto".'
        }
      }
    }
  };
}

function createImageEditToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "image_edit",
    description: resolveToolDefinitionDescriptionWithHint(
      policy,
      appendPerTurnCapHint(
        "Edit an existing user-referenced image according to the requested changes.",
        "image_edit",
        policy
      ),
      "Do not claim the edit is done, ready, visible, attached, or sent unless this same turn actually called image_edit and got a successful result or explicit delivered artifact/result."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Text instruction describing how the referenced chat image should be edited."
        },
        sourceImageAlias: {
          type: "string",
          description:
            'Optional human-readable alias of the available image to edit, for example "current image #1" or "last generated image". Required when multiple reusable images are available and the source image is clear.'
        },
        referenceImageAlias: {
          type: "string",
          description:
            'Optional human-readable alias of a second available image to use only as a visual style, appearance, or background reference, for example "current image #2". The tool must still return one edited version of the source image, not a separate edit of the reference image.'
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
        },
        background: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_BACKGROUNDS],
          description:
            'Optional background behavior for the edited output. Use "transparent" when the user asks to remove background, make a cutout/sticker/icon/logo asset, or return a PNG with alpha. Use "opaque" only when the user explicitly wants a solid background. Defaults to "auto".'
        }
      }
    }
  };
}

function createVideoGenerateToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: "video_generate",
    description: resolveToolDefinitionDescription(
      policy,
      appendPerTurnCapHint(
        "Generate a short brand-new video clip from a text prompt.",
        "video_generate",
        policy
      )
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Text prompt describing the video clip to generate."
        },
        referenceImageAlias: {
          type: "string",
          description:
            'Optional human-readable alias of an available image to use as a visual reference or first frame, for example "current image #1" or "last generated image". Set this whenever a current or recent reusable image should guide the video.'
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

function createTtsToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "tts",
    description: resolveToolDefinitionDescription(
      policy,
      "Generate spoken audio for the current assistant persona."
    ),
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

function createScheduledActionToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: "scheduled_action",
    description: resolveToolDefinitionDescription(
      policy,
      "Schedule simple unconditional user-visible reminders. Use background_task for assistant-side checks."
    ),
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
        kind: {
          type: "string",
          enum: ["user_reminder"],
          description:
            'Required for create. Only "user_reminder" is supported; use background_task for assistant-side conditional background checks.'
        },
        title: {
          type: "string",
          description: "Required for create. Human-readable scheduled-action title."
        },
        reminderText: {
          type: "string",
          description:
            'Required for kind="user_reminder". This is the exact short message the user will later receive.'
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

function createBackgroundTaskToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: "background_task",
    description: resolveToolDefinitionDescription(
      policy,
      appendPerTurnCapHint(
        "Create and manage quiet assistant-side background tasks. Use this for conditional checks and delayed assistant follow-through; the platform will later evaluate the brief and push the user directly only when warranted.",
        "background_task",
        policy
      )
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "pause", "resume", "cancel"],
          description: "Background-task operation to perform."
        },
        title: {
          type: "string",
          description: "Required for create. Short title shown in Assistant actions."
        },
        brief: {
          type: "string",
          description:
            "Required for create. Precise evaluator brief: what to check, when to notify, and what should count as no_push."
        },
        taskId: {
          type: "string",
          description:
            "Preferred background-task identifier for pause, resume, or cancel. Use the id returned by list or create."
        },
        titleMatch: {
          type: "string",
          description:
            "Fallback partial title match for pause, resume, or cancel when taskId is unavailable."
        },
        runAt: {
          type: "string",
          description: "Absolute future ISO datetime for a one-time background task."
        },
        delayMs: {
          type: "number",
          minimum: 1,
          description: "Relative delay in milliseconds for a one-time background task."
        },
        everyMs: {
          type: "number",
          minimum: 60000,
          description:
            "Recurring interval in milliseconds. Values below 60000 are raised by the API."
        },
        anchorAt: {
          type: "string",
          description: "Optional ISO anchor time for recurring interval schedules."
        },
        cronExpr: {
          type: "string",
          description: "Cron expression for recurring background tasks."
        },
        timezone: {
          type: "string",
          description: "Optional IANA timezone for cron-based schedules."
        },
        pushPolicy: {
          type: "object",
          additionalProperties: true,
          description:
            "Optional structured push policy. Do not put channel selection here; delivery uses the assistant's preferred notification channel."
        }
      }
    }
  };
}

function createFilesToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "files",
    description: resolveToolDefinitionDescription(
      policy,
      "List, search, inspect, read, write, write-and-send, edit, delete, or send assistant-managed files through one alias-first surface. This includes user uploads, generated outputs, and sandbox-created files. Keep shell and exec separate for real process execution."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [...PERSAI_RUNTIME_FILES_TOOL_ACTIONS],
          description:
            'One files action: "list", "search", "get", "read", "write", "write_and_send", "edit", "delete", or "send".'
        },
        query: {
          type: "string",
          description:
            'Non-empty search text for action="search", or a selector for action="get", "read", "edit", "delete", or "send" when no working-file alias or exact path is available. Search spans the assistant Files registry, including uploaded chat files, generated outputs, and sandbox files. If the user asks to send or resend a found file, discovering it is not enough: call action="send" with the resolved target in the same turn.'
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: FILES_LIST_MAX_LIMIT,
          description:
            'Optional result cap for action="search" or action="list". Search is capped tighter than list at execution time.'
        },
        path: {
          type: "string",
          description:
            'Assistant file path for action="list", "get", "read", "write", "write_and_send", "edit", or "delete". For action="write" and "write_and_send", this is the canonical save location. For action="list", leave unset or use "." for the root.'
        },
        alias: {
          type: "string",
          description:
            'Human-readable working-file alias for action="get", "read", "edit", "delete", or "send", for example "current attachment #1", "previous attachment #1", or "last generated image". Prefer this for current or prior reusable chat files when available.'
        },
        content: {
          type: "string",
          description: 'Full UTF-8 text content for action="write" or action="write_and_send".'
        },
        oldText: {
          type: "string",
          description: 'Exact existing text to replace for action="edit".'
        },
        newText: {
          type: "string",
          description: 'Replacement text for action="edit".'
        },
        recursive: {
          type: "boolean",
          description:
            'Optional recursion flag for action="list". For action="delete", set true when deleting a directory tree.'
        },
        aliases: {
          type: "array",
          items: { type: "string" },
          description:
            'Human-readable working-file aliases to deliver for action="send". You may also combine these with one resolved selector.'
        },
        caption: {
          type: "string",
          description: 'Optional caption for action="send" or action="write_and_send".'
        },
        filename: {
          type: "string",
          description:
            'Optional filename override for action="send" or action="write_and_send" when exactly one file is selected. This does not replace path as the canonical save location.'
        }
      }
    }
  };
}

function createExecToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "exec",
    description: resolveToolDefinitionDescription(
      policy,
      "Run one executable with explicit arguments inside the assistant sandbox workspace. Refer to files by their relative paths inside that workspace."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description: "Executable name or relative binary path."
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional argument list."
        },
        cwd: {
          type: "string",
          description: "Optional sandbox-relative working directory."
        }
      }
    }
  };
}

function createShellToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "shell",
    description: resolveToolDefinitionDescription(
      policy,
      "Run a bounded shell command inside the assistant sandbox workspace. Refer to files by their relative paths inside that workspace."
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute."
        },
        cwd: {
          type: "string",
          description: "Optional sandbox-relative working directory."
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

function resolveToolDefinitionDescription(policy: RuntimeToolPolicy, fallback: string): string {
  const description = policy.description?.trim() || fallback;
  const guidance = policy.usageGuidance?.trim();
  return guidance ? `${description} ${guidance}` : description;
}

function resolveToolDefinitionDescriptionWithHint(
  policy: RuntimeToolPolicy,
  fallback: string,
  hint: string
): string {
  return appendToolDefinitionHint(resolveToolDefinitionDescription(policy, fallback), hint);
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
