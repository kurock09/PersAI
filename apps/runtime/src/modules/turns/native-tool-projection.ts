import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_EDIT_COUNT,
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_EDIT_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  MAX_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  PERSAI_RUNTIME_FILES_TOOL_ACTIONS,
  PERSAI_RUNTIME_MEMORY_WRITE_KINDS,
  PERSAI_RUNTIME_IMAGE_BACKGROUNDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  isTalkingAvatarVideoProvider,
  PERSAI_RUNTIME_BROWSER_OPERATION_KINDS,
  PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS,
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
const MEDIA_RESULT_UNIT_TOOL_CODES = new Set(["image_generate", "image_edit", "video_generate"]);

function describePerTurnCap(toolCode: string, policy: RuntimeToolPolicy): string | null {
  const overrides = new Map<string, number | null>();
  if (policy.perTurnCap !== undefined && policy.perTurnCap !== null) {
    overrides.set(toolCode, policy.perTurnCap);
  }
  const cap = resolveAdvertisedPerTurnCap(toolCode, overrides);
  if (cap === null) {
    return null;
  }
  // ADR-105: media caps count result units (each image, each video), not tool calls.
  if (MEDIA_RESULT_UNIT_TOOL_CODES.has(toolCode)) {
    const units = cap === 1 ? "1 result unit" : `${String(cap)} result units`;
    return `Per-turn cap: ${units} (each generated image and each video counts as one unit). When the cap is reached, further results return tool_budget_exhausted and you must reply with what you have.`;
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

function describeVideoVoiceCatalogHint(
  credential: AssistantRuntimeBundleToolCredentialRef,
  talkingAvatarEnabled: boolean
): string | null {
  const catalog = credential.videoVoiceCatalog;
  const shortlist = catalog?.shortlist ?? [];
  if (shortlist.length === 0) {
    return null;
  }
  const entries = shortlist.slice(0, 12).map((entry) => {
    const details = [entry.displayName, entry.locale, entry.gender]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(", ");
    return details.length > 0 ? `${entry.voiceKey} (${details})` : entry.voiceKey;
  });
  const base = `Available voiceKeys for voice_control (cinematic video only): ${entries.join("; ")}. Use these only for cinematic narration via audioMode="voice_control".`;
  // Only cross-reference the talking-avatar voice path when that feature is
  // actually enabled — Slice 8 invariant: do not surface talking-avatar to the
  // model when talkingVideoEnabled is off.
  if (!talkingAvatarEnabled) {
    return base;
  }
  return `${base} Do not reuse this list for mode="talking_avatar": that path uses its own voiceKey field or a saved persona's voice.`;
}

function describeVideoPersonaCatalogHint(
  credential: AssistantRuntimeBundleToolCredentialRef
): string {
  const catalog = credential.videoPersonaCatalog;
  const personas = catalog?.personas ?? [];
  if (personas.length === 0) {
    return `Available saved characters (videoPersonas): none yet. Suggest the user create one via Settings → Characters when they want a named character.`;
  }
  const lines = personas
    .slice(0, 10)
    .map(
      (p) =>
        `- personaId="${p.personaId}", displayName="${p.displayName}", voiceLabel="${p.voiceLabel}"`
    )
    .join("\n");
  return `Available saved characters (videoPersonas):\n${lines}`;
}

/**
 * ADR-074 Slice L1.1 / ADR-105 FIX A — resolve the effective
 * `image_generate.count.maximum` the model should see in its tool schema.
 *
 * Returns the smaller of the runtime hard cap (`MAX_RUNTIME_IMAGE_GENERATE_COUNT`)
 * and the per-turn cap configured for this assistant (`policy.perTurnCap`).
 * Falls back to the runtime hard cap when no per-turn cap is set.
 * Always returns at least 1 so the schema never advertises an unreachable maximum.
 *
 * NOTE: `TOOL_HARD_CAP_PER_TURN["image_generate"] = 1` is the CALL-loop cap
 * (how many times the tool may be invoked per turn) and is deliberately NOT
 * used here — this function governs the per-call IMAGE BATCH SIZE, an
 * independent dimension.
 */
function resolveImageCountCap(
  _toolCode: "image_generate" | "image_edit",
  policy: RuntimeToolPolicy,
  hardCap: number
): number {
  const perTurnCap = policy.perTurnCap;
  if (perTurnCap !== undefined && perTurnCap !== null && perTurnCap > 0) {
    return Math.max(1, Math.min(hardCap, Math.floor(perTurnCap)));
  }
  return hardCap;
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
  // ADR-109 Slice 10c Fix #3f: talking-avatar credential ref is now separate.
  // Voice catalog + persona catalog come from this ref, not the cinematic one.
  const talkingAvatarCredential = (bundle.governance.toolCredentialRefs[
    "video_generate_talking_avatar"
  ] ?? null) as AssistantRuntimeBundleToolCredentialRef | null;
  // ADR-109 Slice 8: `talkingVideoEnabled` is materialised onto the policy by the bundle
  // compile pipeline. When true, HeyGen (talking_avatar) is projected with the full
  // talking-avatar schema. When false / absent, HeyGen is excluded (cinematic surface only).
  const talkingVideoEnabled = videoGeneratePolicy?.talkingVideoEnabled === true;
  if (
    videoGeneratePolicy !== null &&
    videoGenerateCredential !== null &&
    supportsCurrentNativeVideoGenerateProvider(videoGenerateCredential.providerId ?? null) &&
    // ADR-109 Slice 2b: talking_avatar rows are hidden unless the plan toggle is on.
    (!isTalkingAvatarVideoProvider(videoGenerateCredential.providerId) || talkingVideoEnabled)
  ) {
    projectedTools.push(
      createVideoGenerateToolDefinition(
        videoGeneratePolicy,
        videoGenerateCredential,
        talkingAvatarCredential
      )
    );
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
  const documentPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "document", "worker");
  const documentCredential = resolveConfiguredCredentialRef(bundle, "document");
  if (
    documentPolicy !== null &&
    documentCredential !== null &&
    supportsCurrentNativeDocumentProvider(documentCredential)
  ) {
    projectedTools.push(createDocumentToolDefinition(documentPolicy));
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
      [
        "Read live PersAI quota status for the current assistant, compare public plans from the same source of truth, report monthly tool/package availability, and create a checkout link when the user wants to open it now.",
        "When the user asks about image, video, or document generation limits, monthly usage, or extra packages, call this tool first instead of guessing from history.",
        "When the user asks about tariffs, plans, subscription differences, upgrade options, or asks to send/open the pricing page, call this tool first instead of improvising links from memory.",
        "Use packageOffers.tools to ground package guidance: it contains exact offers (ids, units, prices, CTA labels), whether each tool is offerable now, and whether the better answer is package only, plan upgrade only, or both.",
        "If the result has packagesPurchase != null, then extra packages CAN be bought right now for the listed availableTools. In that case, when the user asks 'can I buy a package' / 'how do I add more' / 'show me packages' (in any phrasing), say plainly that yes — packages are available for those tools, and tell the user to open the in-product packages page (path from packagesPurchase.path/url, default '/app/packages'). Do not say packages are unavailable just because no per-package checkout link was returned here: package purchase happens on that page, not via this tool.",
        "If the result has pricingPage != null, then the user CAN open the in-product pricing page right now. When they ask to compare plans, choose a tariff, upgrade, or send the tariffs page, include that pricingPage path/url plainly in the answer instead of saying no link is available."
      ].join(" ")
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
            "Optional tool code to inspect one quota-governed tool when action='report'. Leave unset to return non-media daily tool counters, the current quota bucket snapshot, monthly tool quota rows, package availability by tool, and visible plan options."
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
  // ADR-074 L1.1: clamp count.maximum to per-turn cap to close the count-bypass.
  const effectiveCap = resolveImageCountCap(
    "image_generate",
    policy,
    MAX_RUNTIME_IMAGE_GENERATE_COUNT
  );
  return {
    name: "image_generate",
    description: appendToolDefinitionHint(
      appendToolDefinitionHint(
        resolveToolDefinitionDescription(
          policy,
          appendPerTurnCapHint(
            "Generate new images from a text prompt. For any multi-image request, use outputMode='series' with seriesItems so each requested output is described as its own final image inside one clean job; do not make extra calls. Keep outputMode='variants' only as a rare fallback for internal compatibility, not as the normal multi-image path.",
            "image_generate",
            policy
          )
        ),
        "count=N means N separate final images in this one job, not a collage, contact sheet, grid, or multiple panels inside each image unless the user explicitly asked for a collage/grid. For distinct carousel/slideshow/frame requests, set outputMode='series' and put one single-image instruction per item in seriesItems. If the current turn already includes a reusable product/source image and the outputs should stay tied to that same image across slides, do not use image_generate; use image_edit with sourceImageAlias instead."
      ),
      "If the tool returns action='pending_delivery' with canSendFileNow=false, acknowledge only that the images are being prepared and will arrive separately; do NOT claim they are already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId. If the tool returns action='skipped' because of a quota or plan limit and guidance is present, use that guidance in the reply and do not stop at the limit message. If concrete package or upgrade options are still missing, call quota_status for image_generate before the final answer."
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
          minimum: MIN_RUNTIME_IMAGE_GENERATE_COUNT,
          maximum: effectiveCap,
          description: `Number of images to produce in this single job (${String(MIN_RUNTIME_IMAGE_GENERATE_COUNT)}..${String(effectiveCap)}). Each image uses one per-turn result unit and one daily-quota unit.`
        },
        outputMode: {
          type: "string",
          enum: ["variants", "series"],
          description:
            "Optional output shape. Default to series for any multi-image request so each output has its own single-image instruction. Reserve variants only for rare compatibility cases."
        },
        seriesItems: {
          type: "array",
          items: { type: "string" },
          description:
            "Required when outputMode='series'. Provide exactly one single-image instruction per requested output, in order. Each item must describe only one final frame/item, not the whole series."
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
  const effectiveCap = resolveImageCountCap("image_edit", policy, MAX_RUNTIME_IMAGE_EDIT_COUNT);
  return {
    name: "image_edit",
    description: appendToolDefinitionHint(
      appendToolDefinitionHint(
        appendToolDefinitionHint(
          resolveToolDefinitionDescription(
            policy,
            appendPerTurnCapHint(
              "Edit a user-referenced image and return a new image file — use this only when the user explicitly wants an image modified, never to describe, analyze, or answer questions about an image (those are answered in text). For any multi-image edit request, use outputMode='series' with seriesItems so each requested output is described as its own final edited image inside one clean job; do not make extra calls. Keep outputMode='variants' only as a rare fallback for internal compatibility, not as the normal multi-image path. When another image should guide style or appearance, set referenceImageAlias to that image.",
              "image_edit",
              policy
            )
          ),
          "count=N means N separate final edited images in this one job, not a collage, contact sheet, grid, or multiple panels inside each image unless the user explicitly asked for a collage/grid. For distinct carousel/slideshow/frame requests, set outputMode='series' and put one single-image instruction per item in seriesItems. In series mode, keep the same source product/object identity across slides unless the user explicitly asked to change products."
        ),
        "If the tool returns action='pending_delivery' with canSendFileNow=false, acknowledge only that the edit is being prepared and will arrive separately; do NOT claim it is already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId. If the tool returns action='skipped' because of a quota or plan limit and guidance is present, use that guidance in the reply and do not stop at the limit message. If concrete package or upgrade options are still missing, call quota_status for image_edit before the final answer."
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
        count: {
          type: "integer",
          minimum: MIN_RUNTIME_IMAGE_EDIT_COUNT,
          maximum: effectiveCap,
          description: `Number of edited variants to produce in this single job (${String(MIN_RUNTIME_IMAGE_EDIT_COUNT)}..${String(effectiveCap)}). Each output uses one per-turn result unit and one daily-quota unit.`
        },
        outputMode: {
          type: "string",
          enum: ["variants", "series"],
          description:
            "Optional output shape. Default to series for any multi-image edit request so each output has its own single-image instruction. Reserve variants only for rare compatibility cases."
        },
        seriesItems: {
          type: "array",
          items: { type: "string" },
          description:
            "Required when outputMode='series'. Provide exactly one single-image edit instruction per requested output, in order. Each item must describe only one final frame/item, not the whole series."
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
  policy: RuntimeToolPolicy,
  credential: AssistantRuntimeBundleToolCredentialRef,
  talkingAvatarCredential: AssistantRuntimeBundleToolCredentialRef | null
): ProviderGatewayToolDefinition {
  // ADR-109 Slice 10c Fix #3f: voice catalog for cinematic (Kling) comes from cinematic ref.
  // Voice catalog + persona catalog for talking_avatar come from the talking-avatar ref.
  const talkingAvatarEnabled = talkingAvatarCredential !== null;
  const voiceCatalogHint = describeVideoVoiceCatalogHint(credential, talkingAvatarEnabled);
  const talkingAvatarHint = talkingAvatarEnabled
    ? [
        // Section 1: when to use talking_avatar
        "Use mode='talking_avatar' when the user explicitly asks for a talking-avatar video — a video that includes a person speaking, AND either (a) has an attached photo to use as the speaker's portrait, or (b) names a saved character (persona) from the workspace. Use mode='cinematic' (default) for any other video request.",
        // Section 2: persona resolution
        "The videoPersonas block below lists this workspace's saved characters with their personaId and displayName. When the user names a character (e.g. 'have Masha read this'), find the matching persona by exact displayName (case-insensitive) and pass its personaId. Persona names are unique within a workspace, so a name match is unambiguous. If no persona matches, do not invent IDs — either ask the user to clarify which character, or suggest creating one via Settings → Characters first.",
        // Section 3: persona creation guidance
        "You cannot create personas yourself. Creating a saved character requires the user to visit Assistant Settings → Characters and upload a portrait + name + voice. When the user asks to 'save this photo as <name>' or similar, instruct them to use Settings → Characters; do NOT attempt to create the persona via this tool.",
        // Section 4: single character per call
        "Each video_generate call produces ONE clip with ONE speaker (or no speaker for cinematic). If the user requests multiple speakers in a single clip, propose splitting into multiple sequential calls — one per speaker — and combining the results (or playing them in sequence). Do NOT call video_generate with multiple personas; the contract supports exactly one persona OR one portrait alias per call.",
        // Section 5: voice selection precedence
        "Voice selection precedence: if the user explicitly specifies a voice, gender/style of voice, or a concrete voiceKey/voiceId, follow that instruction. If the user names or selects a saved persona, use that persona's stored voice by default and only pass voiceKey to deliberately override it for one call.",
        // Section 6: voice selection — portrait alias path
        "Voice selection (portrait alias path): when passing portraitImageAlias, select voiceKey from the available voice shortlist based on the visual character in the image plus the request context (language, tone, brand fit, likely presentation). If the image strongly suggests a masculine/feminine presentation, prefer a matching voice, but treat this as a practical fit choice rather than a factual identity claim. If the image is ambiguous or confidence is low, you may briefly ask the user which voice they want. When voiceKey is omitted on the portrait path, runtime returns voice_required honestly so the model can retry with an explicit choice.",
        // Section 7: aspect-ratio selection for talking_avatar
        "Talking-avatar aspect ratio: if the user explicitly requests vertical, portrait, square, Reels, Stories, feed, widescreen, or landscape output, pass talkingAvatarAspectRatio accordingly. If the user does not specify it, you may choose talkingAvatarAspectRatio from the task, platform, source image shape, and overall context. Use 9:16 for vertical short-form video, 1:1 for square output, and 16:9 for widescreen output. Only leave talkingAvatarAspectRatio omitted when automatic/provider-default behavior is truly intended.",
        // Section 8: cinematic-only fields ignored in talking_avatar mode
        "When mode='talking_avatar', omit all cinematic-only controls: audioMode, inputMode, voiceKeys, voiceIds, referenceImageAlias, referenceImageAliases, size, seconds, and filename. Talking-avatar audio comes from speechText + voiceKey (or the persona's stored voice); the portrait source is personaId XOR portraitImageAlias. talkingAvatarAspectRatio is the user/model-level aspect hint for talking-avatar output. Admin quality/aspect/engine defaults still apply when talkingAvatarAspectRatio is omitted, and a fixed admin aspect overrides auto-selection.",
        // Section 9: persona shortlist (from talking-avatar credential ref)
        describeVideoPersonaCatalogHint(talkingAvatarCredential)
      ].join(" ")
    : null;
  // ADR-109 Slice 10c Fix #3f: talking-avatar voice catalog hint from talking-avatar ref.
  const talkingAvatarVoiceCatalogHint = talkingAvatarEnabled
    ? describeVideoVoiceCatalogHint(talkingAvatarCredential, true)
    : null;
  return {
    name: "video_generate",
    description: appendToolDefinitionHint(
      resolveToolDefinitionDescription(
        policy,
        appendPerTurnCapHint(
          "Generate a short brand-new video clip from a text prompt.",
          "video_generate",
          policy
        )
      ),
      [
        "Prefer calling this tool immediately when the user clearly wants a video. For cinematic mode, pass explicit seconds and size/aspect when the user gave them, but do not ask a follow-up only to fill those fields: when they are omitted, runtime will use the selected model catalog defaults and normalize unsupported values. For talking_avatar mode, do not pass cinematic seconds/size/audio/input/filename controls; provide speechText plus exactly one avatar source (personaId or portraitImageAlias), and use talkingAvatarAspectRatio when the user or context implies a specific vertical, square, or widescreen format. If the tool returns action='pending_delivery' with canSendFileNow=false, acknowledge only that the video is being prepared and will arrive separately; do NOT claim it is already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId. If the tool returns action='skipped' because of a quota or plan limit and guidance is present, use that guidance in the reply and do not stop at the limit message. If concrete package or upgrade options are still missing, call quota_status for video_generate before the final answer.",
        talkingAvatarHint,
        voiceCatalogHint,
        talkingAvatarVoiceCatalogHint
      ]
        .filter((entry): entry is string => entry !== null)
        .join(" ")
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description:
            "Text prompt describing the video clip to generate. Required for cinematic mode. Optional for talking_avatar — provide a one-line scene context for observability, or omit."
        },
        ...(talkingAvatarEnabled
          ? {
              mode: {
                type: "string",
                enum: ["cinematic", "talking_avatar"],
                description:
                  "Optional video generation mode. Use 'cinematic' (default) for standard AI video generation. Use 'talking_avatar' when the user wants a talking-avatar video with speech — requires speechText and either personaId or portraitImageAlias."
              },
              speechText: {
                type: "string",
                description:
                  "The script the avatar will speak aloud. Required when mode='talking_avatar'. Keep it concise and natural for the video duration."
              },
              speechLanguage: {
                type: "string",
                description:
                  "Optional BCP-47 language tag for the speech (e.g. 'en-US', 'ru-RU'). Omit to let the provider detect from speechText."
              },
              personaId: {
                type: "string",
                description:
                  "Optional ID of a saved video persona (character) to use as the avatar. Use this when the assistant has a named character configured. Mutually exclusive with portraitImageAlias."
              },
              portraitImageAlias: {
                type: "string",
                description:
                  "Optional human-readable alias of an available portrait image to use as an ad-hoc talking-avatar base, for example 'current image #1'. Use only when the user explicitly identifies a specific portrait alias. Mutually exclusive with personaId."
              },
              voiceKey: {
                type: "string",
                description:
                  "Optional PersAI voice key from the materialized shortlist to override the persona's default voice. Omit on the persona path to use the persona's stored voice. Required on the portraitImageAlias path."
              },
              talkingAvatarAspectRatio: {
                type: "string",
                enum: ["16:9", "9:16", "1:1"],
                description:
                  "Optional talking-avatar output aspect ratio. Use this only when mode='talking_avatar'. Prefer 9:16 for vertical short-form video, 1:1 for square output, and 16:9 for widescreen output. Omit only when automatic/provider-default aspect selection is truly intended."
              }
            }
          : {}),
        referenceImageAlias: {
          type: "string",
          description:
            'Cinematic-only optional image alias for a visual reference or first frame, for example "current image #1" or "last generated image". Omit when mode=\'talking_avatar\'; use portraitImageAlias instead. Provide this only when the user explicitly identifies or selects a specific available image alias, or when an upstream structured UI/tool has already provided that alias. Do not guess or infer aliases heuristically from context; otherwise omit this field so runtime uses text-to-video.'
        },
        referenceImageAliases: {
          type: "array",
          items: { type: "string" },
          description:
            "Cinematic-only optional ordered image aliases for a true multi-image video request. Omit when mode='talking_avatar'. Use this only when the user explicitly asked for a multi-image video composition and the exact aliases are known."
        },
        voiceIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Cinematic-only optional ordered provider voice ids for explicit voice-controlled Kling text-to-video or image-to-video requests only. Omit when mode='talking_avatar'; use voiceKey for talking-avatar voice override."
        },
        voiceKeys: {
          type: "array",
          items: { type: "string" },
          description:
            "Cinematic-only optional ordered PersAI voice keys for Kling voice-controlled text-to-video or image-to-video requests. Use only keys from the materialized shortlist shown in this assistant's video catalog/tool guidance; do not invent keys. Omit when mode='talking_avatar'; use the singular voiceKey field instead."
        },
        audioMode: {
          type: "string",
          enum: ["silent", "provider_native_audio", "voice_control"],
          description:
            "Cinematic-only optional requested audio intent. Omit when mode='talking_avatar'; talking-avatar speech comes from speechText plus voiceKey or the persona's stored voice."
        },
        inputMode: {
          type: "string",
          enum: ["text", "single_reference_image", "multi_image", "omni"],
          description:
            "Cinematic-only optional requested input class. Omit when mode='talking_avatar'; use personaId or portraitImageAlias instead."
        },
        filename: {
          type: "string",
          description:
            "Cinematic-only optional filename hint for the generated video attachment. Omit when mode='talking_avatar'."
        },
        size: {
          type: "string",
          enum: [...PERSAI_RUNTIME_VIDEO_GENERATE_SIZES],
          description:
            "Cinematic-only optional output size/aspect hint. Omit when mode='talking_avatar'; use talkingAvatarAspectRatio for user/model-driven talking-avatar aspect selection."
        },
        seconds: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description:
            "Cinematic-only optional output duration in whole seconds. Omit when mode='talking_avatar'; HeyGen talking-avatar duration follows speechText length."
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

function createDocumentToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "document",
    description: resolveToolDefinitionDescription(
      policy,
      [
        "Create, revise, export, or redeliver assistant-generated documents through one typed document tool.",
        "Use create_pdf_document for PDF-first documents, create_presentation for presentation generation, revise_document to modify an existing PDF (small typo fixes, large rewrites, or full restructures — all go through revise), and export_or_redeliver to resend or re-render an existing document when supported. Follow the Working Files document-role guidance: prefer CURRENT_SOURCE for a newly attached source file the user wants turned into a PDF, and use LAST_DELIVERED_RESULT only when the user explicitly wants to modify an already generated PDF. revise_document with no docId or fileRef auto-resolves to the latest matching PDF in the current chat. Use fileRef when the PDF you want to revise was produced by the assistant in this or any earlier chat (its AssistantFile id is visible via files.search, the Working Files developer block, or files.read results). Use doc_id for the current chat's most recent PDF when you have the exact id. Do not pass both fileRef and doc_id.",
        "Presentation chat delivery is always PDF. Do not set outputFormat=pptx for create_presentation or for presentation revise_document. Editable PPTX is a separate explicit user-requested preparation action and is not the in-chat artifact. outputFormat=pptx is only meaningful for export_or_redeliver against an existing presentation document when the user explicitly asked for PPTX/PowerPoint.",
        "When the user has attached a source file (txt, md, csv, json, html, xml, pdf, docx) and asks to rebuild, convert, restyle, translate, or summarize it, the backend worker will AUTOMATICALLY inline that file's text content into document generation; you do not need to pre-read it. Call create_pdf_document with transferMode=verbatim when the user wants the source text copied without rewriting. Call transferMode=transform when the user wants restyling or layout/color changes — the worker keeps the full extracted source text and applies presentation styling; it does NOT summarize or drop sections.",
        "You SHOULD also set contentIntent explicitly. Use contentIntent=preserve_content when the user wants the original document content preserved and only the formatting, visual style, layout, or output format should change. Use contentIntent=rewrite_content only when the user explicitly wants the document text/content rewritten. If contentIntent is omitted, the runtime defaults to preserving content.",
        "When the user attaches PDF or DOCX source material without referencing an existing PersAI document, treat it as source input for create_pdf_document, not revise_document.",
        "Never invent placeholder, generic-template, or test/demo content when the user has attached a source file. The worker auto-inlines supported text/PDF/DOCX content; unsupported binaries surface a structured note instead.",
        "For school, educational, explainer, and ordinary client decks, do not choose imagePolicy=text_only or visualDensity=text_heavy unless the user explicitly asks for text-only slides or unusually dense slide copy. Prefer balanced density and ordinary visual policies; do not force pictographic/business icon decks unless the user asked for that exact style.",
        "For Gamma presentations, keep outline simple when you provide it: a short flat list of slide titles or title plus brief bullets. Do not send deeply nested JSON outlines, speaker notes, layout directives, or provider-specific theme guesses.",
        'For create_presentation and for presentation revise_document, you SHOULD set targetSlideCount to a concrete integer between 1 and 30 — even when the user did not specify one. If the user did mention a number ("7 slides", "deck of 10", "до 5 слайдов", "увеличь до 8"), you MUST set targetSlideCount to that exact integer. If the user did not specify a number, pick a reasonable count from the topic (typical school/explainer deck is 7-10, ordinary client deck is 8-12, deep report is 12-16) and pass that integer.',
        "If the tool returns action='pending_delivery' with canSendFileNow=false, acknowledge only that the document is being prepared and will arrive separately; do NOT claim it is ready/sent and do NOT call files.send for it this turn.",
        "If the tool returns action='skipped' because of a quota or plan limit and guidance is present, use that guidance in the reply and call quota_status if the user needs concrete package or upgrade options."
      ].join(" ")
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["descriptorMode", "prompt"],
      properties: {
        descriptorMode: {
          type: "string",
          enum: [
            "create_pdf_document",
            "create_presentation",
            "revise_document",
            "export_or_redeliver"
          ],
          description: "Document operation mode."
        },
        prompt: {
          type: "string",
          description:
            "Main document intent or revision/export request. For revise_document and export_or_redeliver, keep this focused on the requested change or resend. When the user attached a supported source file (txt/md/csv/json/html/xml/pdf/docx), describe the requested transformation here and let the worker auto-inline the file content; do not paste the file content into this field yourself. Never invent placeholder/template/test content when a source file is attached."
        },
        instructions: {
          type: "string",
          description: "Optional additional document instructions."
        },
        outputFormat: {
          type: "string",
          enum: ["pdf", "pptx"],
          description:
            "Optional requested output format. Chat delivery for create_presentation and presentation revise_document is always PDF — do not set this to pptx for those modes. outputFormat=pptx is only meaningful for export_or_redeliver against an existing presentation document when the user explicitly asked for PPTX/PowerPoint."
        },
        docId: {
          type: "string",
          description:
            "Existing document id for revise_document (current chat) and export_or_redeliver. Use fileRef instead of docId when the PDF was produced in a different chat."
        },
        fileRef: {
          type: "string",
          description:
            'fileRef MUST be a UUID — the exact `fileRef` value returned by `files.search`/`files.read` response items, or a UUID surfaced in the Working Files developer block. Example valid value: `"abc12345-0000-4000-8000-deadbeef1234"`. Aliases such as `"last generated file"`, `"recent file #1"`, `"previous attachment #1"`, or `"current attachment #1"` are NOT valid fileRef values — they belong to different resolution paths and will fail with `file_alias_not_found`. Mutually exclusive with `docId`; do not pass both.'
        },
        requestedName: {
          type: "string",
          description: "Optional filename/title hint for the generated document."
        },
        visualStyle: {
          type: "string",
          enum: [
            "professional_modern",
            "bold_editorial",
            "minimal_clean",
            "illustrated_storytelling"
          ],
          description:
            "Optional presentation-only visual style for create_presentation. Use this to steer the deck's overall look and image style."
        },
        imagePolicy: {
          type: "string",
          enum: ["ai_generated", "web_free_to_use", "pictographic", "text_only"],
          description:
            "Optional presentation-only image policy for create_presentation. Prefer ai_generated or web_free_to_use when the user wants a normal visual deck. Use pictographic only for explicitly icon/diagram-heavy decks, and text_only only when they explicitly want no images."
        },
        visualDensity: {
          type: "string",
          enum: ["balanced", "visual_heavy", "text_heavy"],
          description:
            "Optional presentation-only content balance for create_presentation. Prefer balanced for most decks, visual_heavy when the user wants stronger visuals, and text_heavy only when they explicitly ask for denser slide copy."
        },
        targetSlideCount: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description:
            'Optional presentation-only authoritative slide count for create_presentation and revise_document of presentations. Set this to the integer the user explicitly asked for (e.g. "7 slides" => 7). Leave unset when the user did not specify a count.'
        },
        outline: {
          description:
            "Optional document outline or structured content seed. For create_presentation, keep this as a simple flat list of slide titles or concise slide bullets; avoid deeply nested objects, speaker notes, layout directives, or provider-specific schema details."
        },
        transferMode: {
          type: "string",
          enum: ["verbatim", "transform"],
          description:
            "Create-only transfer mode. Use verbatim for word-for-word source transfer; use transform for restyling or presentation changes while keeping the full source content."
        },
        contentIntent: {
          type: "string",
          enum: ["preserve_content", "rewrite_content"],
          description:
            "Explicit content intent. Use preserve_content when the original document wording/content must stay intact and only styling/format/output should change. Use rewrite_content only when the document text may be rewritten. If omitted, runtime defaults to preserve_content."
        },
        editOperation: {
          type: "string",
          enum: ["style_only", "content_patch", "section_rewrite"],
          description:
            "Revise-only explicit edit mode. You MUST set style_only when the user asks to restyle, reformat, or beautify the document without changing the wording (including requests in any language). Use content_patch for targeted section edits; use section_rewrite when one or more sections need a fuller rewrite. Omitting this on a large structured PDF defaults to style_only unless contentIntent explicitly allows rewrite."
        },
        targetSectionIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional stable section ids from a prior structured document version. Use with content_patch or section_rewrite to limit edits to specific sections."
        },
        metadata: {
          type: "object",
          additionalProperties: true,
          description: "Optional structured metadata for document generation."
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
        "Create and manage quiet assistant-side background tasks. Use this for conditional checks and delayed assistant follow-through; the platform will later evaluate the brief and push the user directly only when warranted. Before creating a new task, avoid duplicates: if the user seems to be referring to an already-existing follow-up with the same purpose, first call list and reuse, update, or cancel/resume the existing task instead of creating a second equivalent one.",
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
  return PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS.includes(
    resolved as (typeof PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS)[number]
  );
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

function supportsCurrentNativeDocumentProvider(
  credential: AssistantRuntimeBundleToolCredentialRef
): boolean {
  const candidates = [credential, ...(credential.fallbacks ?? [])];
  return candidates.some(
    (entry) =>
      entry.configured === true &&
      entry.providerId !== undefined &&
      entry.providerId !== null &&
      (PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS as readonly string[]).includes(entry.providerId)
  );
}
