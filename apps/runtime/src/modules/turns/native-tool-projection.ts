import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_EDIT_COUNT,
  MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES,
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_EDIT_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  MAX_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  PERSAI_RUNTIME_FILES_TOOL_ACTIONS,
  PERSAI_RUNTIME_MEMORY_WRITE_KINDS,
  PERSAI_RUNTIME_MEMORY_WRITE_LAYERS,
  PERSAI_RUNTIME_IMAGE_BACKGROUNDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  isTalkingAvatarVideoProvider,
  PERSAI_RUNTIME_BROWSER_OPERATION_KINDS,
  PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS,
  PERSAI_RUNTIME_TTS_DELIVERY_KINDS,
  PERSAI_RUNTIME_TTS_DELIVERY_STYLES,
  PERSAI_RUNTIME_TTS_EMOTIONS,
  PERSAI_RUNTIME_TTS_INTENSITIES,
  PERSAI_RUNTIME_TTS_NONVERBALS,
  PERSAI_RUNTIME_TTS_PACES,
  PERSAI_RUNTIME_TTS_PAUSE_KINDS,
  PERSAI_RUNTIME_TODO_WRITE_ACTIONS,
  PERSAI_RUNTIME_TODO_WRITE_STATUSES,
  PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES,
  type ProviderGatewayToolDefinition,
  type PersaiRuntimeKnowledgeSource,
  type PersaiRuntimeBrowserProviderId,
  type PersaiRuntimeImageEditProviderId,
  type RuntimeKnowledgeAccessSourceConfig,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";

function appendToolDefinitionHint(base: string, hint: string): string {
  return base.includes(hint) ? base : `${base} ${hint}`;
}

function buildPendingDeliveryHint(params: {
  subject: string;
  quotaToolCode: "image_generate" | "image_edit" | "video_generate" | "document";
  extra?: string;
}): string {
  return [
    `If the tool returns action='pending_delivery' with canSendFileNow=false, acknowledge only that ${params.subject} and will arrive separately; do NOT claim anything is already queued, accepted, in progress, ready, visible, attached, or sent unless this same turn actually got that structural pending result with a real jobId.`,
    "If the tool returns action='skipped' because of a quota or plan limit and guidance is present, use that guidance in the reply and do not stop at the limit message.",
    `If concrete package or upgrade options are still missing, call quota_status for ${params.quotaToolCode} before the final answer.`,
    params.extra ?? null
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
}

function buildVideoGenerateLazyLookupHint(): string {
  return 'For talking-avatar rules, saved characters, and available voices, call video_generate with action="describe_avatar_mode", "list_personas", or "list_voices" first; never guess personaId or voiceKey.';
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
  // ADR-125 Slice 1: todo_write is inline and model-visible whenever the
  // bundle marked it enabled+allowed (Starter Trial defaults to active).
  const todoWritePolicy = resolveAllowedModelVisibleToolPolicy(bundle, "todo_write", "inline");
  if (todoWritePolicy !== null) {
    projectedTools.push(createTodoWriteToolDefinition(todoWritePolicy));
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
      createVideoGenerateToolDefinition(videoGeneratePolicy, talkingAvatarCredential)
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
  const presentationPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "presentation", "worker");
  const presentationCredential =
    resolveConfiguredCredentialRef(bundle, "presentation") ?? documentCredential;
  if (
    presentationPolicy !== null &&
    presentationCredential !== null &&
    supportsCurrentNativePresentationProvider(presentationCredential)
  ) {
    projectedTools.push(createPresentationToolDefinition(presentationPolicy));
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
  const grepPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "grep", "inline");
  if (grepPolicy !== null) {
    projectedTools.push(createGrepToolDefinition(grepPolicy));
  }
  const globPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "glob", "inline");
  if (globPolicy !== null) {
    projectedTools.push(createGlobToolDefinition(globPolicy));
  }
  const execPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "exec", "sandbox");
  if (execPolicy !== null) {
    projectedTools.push(createExecToolDefinition(execPolicy));
  }
  const shellPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "shell", "sandbox");
  if (shellPolicy !== null) {
    projectedTools.push(createShellToolDefinition(shellPolicy));
  }
  // ADR-118 Slice 2: skill tool is omitted when no Skills are enabled for this assistant.
  // The schema is byte-stable per turn (no per-turn mutation based on chat state).
  const skillPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "skill");
  const enabledSkills = bundle.skills?.enabled ?? [];
  if (skillPolicy !== null && enabledSkills.length > 0) {
    projectedTools.push(createSkillToolDefinition(skillPolicy));
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
      sourceConfig.source === "global" ||
      // ADR-120 Slice 5 — Skill KB pull source. Availability in the bundle is
      // unconditional; per-turn gating to active-skill turns happens through
      // `allowedSources` (see `deriveTurnKnowledgeSourcePolicy`).
      sourceConfig.source === "skill"
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
    description: resolveToolDefinitionDescription(policy),
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactContextToolDefinition(
  bundle: AssistantRuntimeBundle,
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.compactToolCode,
    description: resolveToolDefinitionDescription(policy),
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
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["write", "close"],
          description:
            'Defaults to "write" (record a new memory). Use "close" to deterministically resolve a known open loop by its `ref`. When "close", `ref` is required and `kind`/`memory`/`closeOpenLoop` MUST be omitted.'
        },
        kind: {
          type: "string",
          enum: [...PERSAI_RUNTIME_MEMORY_WRITE_KINDS],
          description:
            'Required when action is "write" (or omitted). Label the memory as fact, preference, or open_loop.'
        },
        memory: {
          type: "string",
          maxLength: MEMORY_WRITE_MAX_CHARS,
          description:
            'Required when action is "write" (or omitted). One concise genuinely durable memory statement to store. Do not write greetings, acknowledgements, or one-off chatter.'
        },
        layer: {
          type: "string",
          enum: [...PERSAI_RUNTIME_MEMORY_WRITE_LAYERS],
          description:
            'Required when action is "write" (or omitted). Use "long" for stable long-term facts, lasting preferences, or durable decisions. Use "short" for recent working context that should decay naturally after it stops mattering.'
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            'Optional when action is "write". Confidence in this memory being worth storing. Use it honestly; low-confidence or marginal memories should usually be skipped instead of written.'
        },
        closeOpenLoop: {
          type: "boolean",
          description:
            'Set true on a `write` action ONLY when this memory_write also resolves a previously recorded open loop and you do NOT have a precise `ref` from the carry-over block. The runtime will look up the most similar active open loop and mark it resolved. Prefer `action:"close"` with a `ref` from the carry-over block when one is available.'
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

function createTodoWriteToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "todo_write",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TODO_WRITE_ACTIONS],
          description:
            "One operation per call. add (create new items), update (rewrite content, status, or parent of an existing item by id), complete (mark an item done by id; rejected if it has open children), remove (soft-delete an item and its descendants by id), clear (wipe the entire chat plan)."
        },
        items: {
          type: "array",
          description:
            "Required for action=add. Each item: { content, parentId?, status? }. Provide concise content (<=240 chars). parentId attaches the item under an existing item id; the server rejects unknown or completed parents. status defaults to pending and cannot be completed on add.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["content"],
            properties: {
              content: {
                type: "string",
                minLength: 1,
                maxLength: 240,
                description: "The task line shown in the plan. Keep it short and actionable."
              },
              parentId: {
                type: "string",
                description:
                  "Optional parent todo id to attach this item as a child. Omit for a top-level item."
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress"],
                description:
                  "Optional initial status. Defaults to pending. completed cannot be set on add; only one in_progress per parent scope (extras are coerced to pending with a warning)."
              }
            }
          }
        },
        id: {
          type: "string",
          description:
            "Required for action=update | complete | remove. The exact server-minted id of the todo (from a previous todo_write response)."
        },
        content: {
          type: "string",
          minLength: 1,
          maxLength: 240,
          description: "Optional new content for action=update."
        },
        status: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TODO_WRITE_STATUSES],
          description:
            "Optional new status for action=update. completed is rejected if the item still has open children; in_progress is rejected if a sibling is already in_progress."
        },
        parentId: {
          type: "string",
          description:
            "Optional new parent for action=update. Use the empty string or null to detach to top-level. Reparenting under a completed item or creating a cycle is rejected."
        }
      }
    }
  };
}

function createQuotaStatusToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "quota_status",
    description: resolveToolDefinitionDescription(policy),
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
    case "skill":
      return "knowledge base of the Skill engaged for this chat";
    default:
      return source;
  }
}

function createWebFetchToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "web_fetch",
    description: resolveToolDefinitionDescriptionWithHint(
      policy,
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
    description: resolveToolDefinitionDescription(policy),
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
        resolveToolDefinitionDescription(policy),
        "count=N means N separate final images in this one job. For distinct carousel/slideshow/frame requests, set outputMode='series' and put one unique single-image instruction per seriesItems entry; never duplicate the same instruction across items."
      ),
      buildPendingDeliveryHint({
        subject: "the images are being prepared",
        quotaToolCode: "image_generate"
      })
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
            "Required when outputMode='series'. Provide exactly one single-image instruction per requested output, in order. Each item must describe only one final frame/item, be clearly distinct from the others, and never repeat the same instruction."
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
          resolveToolDefinitionDescription(policy),
          "count=N means N separate final edited images in this one job. For distinct carousel/slideshow/frame requests, set outputMode='series' and put one unique single-image instruction per seriesItems entry; never duplicate the same instruction across items. In series mode, keep the same source product/object identity across slides unless the user explicitly asked to change products."
        ),
        buildPendingDeliveryHint({
          subject: "the edit is being prepared",
          quotaToolCode: "image_edit"
        })
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
            "Required when outputMode='series'. Provide exactly one single-image edit instruction per requested output, in order. Each item must describe only one final frame/item, be clearly distinct from the others, and never repeat the same instruction."
        },
        sourceImageAlias: {
          type: "string",
          description:
            'Optional human-readable sticky alias of the available image to edit, for example "image #1". Required when multiple reusable images are available and the source image is clear.'
        },
        referenceImageAliases: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES,
          description: `Optional sticky aliases of additional images (up to ${String(MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES)}) used only as visual style, appearance, background, or composition references, for example ["image #2", "image #3"]. Do not include the sourceImageAlias here. The edited output stays rooted in the source image; references only guide it.`
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
  talkingAvatarCredential: AssistantRuntimeBundleToolCredentialRef | null
): ProviderGatewayToolDefinition {
  const talkingAvatarEnabled = talkingAvatarCredential !== null;
  return {
    name: "video_generate",
    description: appendToolDefinitionHint(
      resolveToolDefinitionDescription(policy),
      [
        [
          "Prefer calling this tool immediately when the user clearly wants a video. For cinematic mode, pass explicit seconds and size/aspect when the user gave them, but do not ask a follow-up only to fill those fields: when they are omitted, runtime will use the selected model catalog defaults and normalize unsupported values.",
          buildPendingDeliveryHint({
            subject: "the video is being prepared",
            quotaToolCode: "video_generate"
          })
        ].join(" "),
        buildVideoGenerateLazyLookupHint()
      ]
        .filter((entry): entry is string => entry !== null)
        .join(" ")
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["generate", "list_personas", "list_voices", "describe_avatar_mode"],
          description:
            'Optional action. Omit or use "generate" for real video generation. Use the other actions for read-only persona, voice, or talking-avatar guidance lookups.'
        },
        prompt: {
          type: "string",
          description:
            'Text prompt describing the video clip to generate. Required when action is omitted or "generate" and mode is cinematic. Optional for talking_avatar generation, where it may be a short scene note; ignored by read-only lookup actions.'
        },
        ...(talkingAvatarEnabled
          ? {
              mode: {
                type: "string",
                enum: ["cinematic", "talking_avatar"],
                description:
                  "Optional video generation mode. Use 'cinematic' (default) for standard AI video generation, silent/no-speech clips, image animation, gestures, smiles, winks, air kisses, product/fashion/cinematic videos, and any request without explicit spoken avatar narration. Use 'talking_avatar' only when the user explicitly wants a speaking avatar/talking head video — requires non-empty speechText and either personaId or portraitImageAlias."
              },
              speechText: {
                type: "string",
                description:
                  "The exact non-empty script the avatar will speak aloud. Required when mode='talking_avatar'. Do not pass an empty string or invent filler text; if the user requested no speech/no dialogue/без речи, use mode='cinematic' instead."
              },
              speechLanguage: {
                type: "string",
                description:
                  "Optional BCP-47 language tag for the speech (e.g. 'en-US', 'ru-RU'). Omit to let the provider detect from speechText."
              },
              personaId: {
                type: "string",
                description:
                  'Optional ID of a saved video persona (character) to use as the avatar. Load available personaIds first with action="list_personas". Mutually exclusive with portraitImageAlias.'
              },
              portraitImageAlias: {
                type: "string",
                description:
                  'Optional human-readable sticky alias of an available portrait image to use as an ad-hoc talking-avatar base, for example "image #1". Use only when the user explicitly identifies a specific portrait alias. Mutually exclusive with personaId.'
              },
              voiceKey: {
                type: "string",
                description:
                  "Optional PersAI voice key to override the persona's default voice. Load available voiceKeys first with action=\"list_voices\". Omit on the persona path to use the persona's stored voice. Required on the portraitImageAlias path."
              },
              talkingAvatarAspectRatio: {
                type: "string",
                enum: ["16:9", "9:16", "1:1"],
                description:
                  "Optional talking-avatar output aspect ratio for ad-hoc portraitImageAlias only. Do not pass with personaId; saved personas keep their stored avatar format. For portraitImageAlias, pass only when the user explicitly requested vertical/portrait/9:16, square/1:1, or widescreen/landscape/16:9. Never infer this from short/social/platform/context wording."
              }
            }
          : {}),
        locale: {
          type: "string",
          description:
            'Optional locale hint used only by action="list_voices" to prefer matching-locale voices first (for example "en-US" or "ru-RU").'
        },
        referenceImageAlias: {
          type: "string",
          description:
            "Cinematic-only optional sticky image alias for a visual reference or first frame, for example \"image #1\". Omit when mode='talking_avatar'; use portraitImageAlias instead. Provide this only when the user explicitly identifies or selects a specific available image alias, or when an upstream structured UI/tool has already provided that alias. Do not guess or infer aliases heuristically from context; otherwise omit this field so runtime uses text-to-video."
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
            "Cinematic-only optional ordered PersAI voice keys for Kling voice-controlled text-to-video or image-to-video requests. Load valid keys first with action=\"list_voices\"; do not invent keys. Omit when mode='talking_avatar'; use the singular voiceKey field instead."
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
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: {
          type: "string",
          description: "The exact text that should be spoken aloud."
        },
        delivery: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_DELIVERY_STYLES],
          description:
            "Optional overall speaking style. Defaults to neutral. Use whisper for quiet/intimate, narrator for steady storytelling, dramatic for heightened delivery."
        },
        emotion: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_EMOTIONS],
          description: "Optional emotional color of the line. Defaults to neutral."
        },
        pace: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_PACES],
          description: "Optional speaking pace. Defaults to normal."
        },
        intensity: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_INTENSITIES],
          description: "Optional expressive intensity. Defaults to medium."
        },
        pause: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_PAUSE_KINDS],
          description:
            "Optional leading pause before speaking. Defaults to none. Use short/long sparingly for effect."
        },
        nonVerbal: {
          type: "string",
          enum: [...PERSAI_RUNTIME_TTS_NONVERBALS],
          description:
            "Optional single non-verbal sound (e.g. a laugh or sigh) for the line. Defaults to none. Use sparingly."
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
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      oneOf: [
        {
          required: ["action", "path"],
          properties: {
            action: { enum: ["inspect"] }
          }
        },
        {
          required: ["action", "requestedName", "format"],
          properties: {
            action: { enum: ["render"] }
          }
        },
        {
          required: ["action", "source", "targetFormat"],
          properties: {
            action: { enum: ["convert"] }
          }
        }
      ],
      properties: {
        action: {
          type: "string",
          enum: ["inspect", "render", "convert"],
          description:
            'Explicit document action. Use `action="inspect"` to inspect an existing source, `action="render"` to author a new document from Markdown, and `action="convert"` to convert an existing document between PDF/DOCX/XLSX.'
        },
        path: {
          type: "string",
          description:
            'Required for `action="inspect"`. Must be an existing exact `/workspace/...` PDF, DOCX, or XLSX path copied from Working Files, files.list, or a prior tool result. For new outputs use `requestedName`; the runtime owns the current-session directory.'
        },
        format: {
          type: "string",
          enum: ["pdf", "xlsx", "docx"],
          description: 'Required for `action="render"`. Output format for the authored document.'
        },
        content: {
          type: "string",
          description:
            'Optional inline Markdown body for `action="render"`. Provide either `content` or `contentPath`, but not both.'
        },
        contentPath: {
          type: "string",
          description:
            'Optional `/workspace/...` Markdown source path for `action="render"`. A sibling Markdown source in the current session root is the normal Case A edit path. Provide either `contentPath` or inline `content`, but not both.'
        },
        style: {
          type: "string",
          enum: ["default", "report", "minimal"],
          description:
            'Optional style preset for `action="render"`. Use it for ordinary authored layout choices; for highly custom layout use `shell` + Python instead.'
        },
        template: {
          type: "string",
          description:
            'Optional `/workspace/...` DOCX template path for `action="render"` when `format="docx"`. For complex layout beyond the built-in render door, use `shell` + Python.'
        },
        requestedName: {
          type: "string",
          description:
            'Required for `action="render"` and optional for `action="convert"`. Filename only, not a path. The runtime places the output under the real current session root automatically and returns the final `/workspace/...` outputPath in the tool result. If omitted for `action="convert"`, the runtime derives a same-basename filename in the current session root.'
        },
        source: {
          type: "string",
          description:
            'Required for `action="convert"`. Existing `/workspace/...` source file to convert.'
        },
        targetFormat: {
          type: "string",
          enum: ["pdf", "xlsx", "docx"],
          description:
            'Required for `action="convert"`. Target document format for the converted output.'
        }
      }
    }
  };
}

function createPresentationToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return {
    name: "presentation",
    description: appendToolDefinitionHint(
      resolveToolDefinitionDescription(policy),
      buildPendingDeliveryHint({
        subject: "the presentation is being prepared",
        quotaToolCode: "document",
        extra:
          "Do not duplicate the delivery this turn; the presentation is already routed to the user once it finishes."
      })
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["descriptorMode", "prompt"],
      properties: {
        descriptorMode: {
          type: "string",
          enum: ["create_presentation", "revise_document", "export_or_redeliver"],
          description:
            "Presentation deferred operation mode. Use create_presentation for new decks, revise_document for existing PersAI presentations, and export_or_redeliver only when the user explicitly asked for PPTX/PowerPoint export."
        },
        prompt: {
          type: "string",
          description: "Main presentation intent or revision/export request."
        },
        instructions: {
          type: "string",
          description: "Optional additional presentation instructions."
        },
        outputFormat: {
          type: "string",
          enum: ["pdf", "pptx"],
          description:
            "Optional requested output format for presentation descriptor modes. Chat delivery for create_presentation and presentation revise_document is always PDF; outputFormat=pptx is only meaningful for export_or_redeliver when the user explicitly asked for PPTX/PowerPoint."
        },
        docId: {
          type: "string",
          description: "Exact presentation document UUID for presentation revise/export flows only."
        },
        storagePath: {
          type: "string",
          description:
            "Presentation-revision locator only for PersAI-managed Gamma presentation attachments."
        },
        requestedName: {
          type: "string",
          description: "Optional filename/title hint for the generated presentation."
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
            "Optional presentation outline or structured content seed. For create_presentation, keep this as a simple flat list of slide titles or concise slide bullets; avoid deeply nested objects, speaker notes, layout directives, or provider-specific schema details."
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
            "Revise-only explicit edit mode. You MUST set style_only when the user asks to restyle, reformat, or beautify the presentation without changing the wording. Use content_patch for targeted section edits; use section_rewrite when one or more sections need a fuller rewrite."
        },
        targetSectionIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional stable section ids from a prior structured presentation version. Use with content_patch or section_rewrite to limit edits to specific sections."
        },
        metadata: {
          type: "object",
          additionalProperties: true,
          description: "Optional structured metadata for presentation generation."
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
    description: resolveToolDefinitionDescription(policy),
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
    description: resolveToolDefinitionDescription(policy),
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
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [...PERSAI_RUNTIME_FILES_TOOL_ACTIONS],
          description:
            'One files action: "list", "read", "preview", "write", "delete", "attach", or "search". For new files use action="write" with requestedName or a relative path; the runtime resolves it under the real current session root. Use exact `/workspace/...` paths only for listed/existing files or intentional wider reads. `search` requires `query` and matches query tokens against path, filename, and cached shortDescription. `attach` delivers an existing workspace file to the current chat as a user-visible attachment.'
        },
        query: {
          type: "string",
          description:
            'Required when action="search". Natural-language search tokens matched against file path, filename, and cached shortDescription.'
        },
        path: {
          type: "string",
          description:
            "Path for existing/listed files, or a relative current-session path for write. Do not construct assistant/session IDs. For new visible files prefer requestedName. Use exact `/workspace/...` paths from Working Files, files.list, or prior tool results for read, preview, delete, attach, or exact overwrite. Use `/tmp/` only for ephemeral scratch that should never reach the user. Optional for list."
        },
        requestedName: {
          type: "string",
          description:
            'Filename or relative path for action="write" when creating a new visible file in the current session. The runtime prepends the real current session root; never include `/workspace/`, assistant IDs, or session IDs here.'
        },
        dir: {
          type: "string",
          description:
            'Synonym for "path" on action="list" — provide either dir or path, not both. Omit both to list the current session root.'
        },
        content: {
          type: "string",
          description: 'Full UTF-8 text content for action="write".'
        },
        mode: {
          type: "string",
          description:
            'Optional strict create mode for action="write". Use `mode: "create_only"` to fail if the exact path already exists.'
        },
        replace: {
          type: "boolean",
          description:
            'Optional exact-overwrite flag for action="write". By default an occupied path resolves to a sibling ` (N)` filename so earlier deliveries stay intact. Pass `replace: true` only when the user explicitly asked to overwrite that same file.'
        },
        maxBytes: {
          type: "integer",
          minimum: 1,
          description:
            'Optional byte cap for action="read" or action="preview". Capped server-side.'
        },
        maxDepth: {
          type: "integer",
          minimum: 1,
          description:
            'Optional recursion depth for action="list". 1 lists direct children only; capped server-side.'
        }
      }
    }
  };
}

function createGrepToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "grep",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression to search for across workspace file contents."
        },
        path: {
          type: "string",
          description:
            "Optional workspace-relative directory to scope the search. Omit to search the current session root; widen by choosing an assistant-root or workspace-root path explicitly."
        },
        glob: {
          type: "string",
          description:
            'Optional glob filter to limit which files are searched, for example "**/*.ts".'
        },
        type: {
          type: "string",
          description:
            'Optional ripgrep file-type filter, for example "ts", "py", or "md". Use instead of glob for common languages.'
        },
        caseInsensitive: {
          type: "boolean",
          description: "Optional case-insensitive match. Defaults to case-sensitive."
        },
        contextLines: {
          type: "integer",
          minimum: 0,
          maximum: 10,
          description: "Optional number of context lines to include around each match."
        }
      }
    }
  };
}

function createGlobToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "glob",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: 'Glob pattern to match file names, for example "*.ts" or "**/README*".'
        },
        path: {
          type: "string",
          description:
            "Optional workspace-relative directory to scope the search. Omit to search the current session root; widen by choosing an assistant-root or workspace-root path explicitly."
        }
      }
    }
  };
}

function createExecToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "exec",
    description: resolveToolDefinitionDescription(policy),
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
    description: resolveToolDefinitionDescription(policy),
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

// ADR-118 Slice 2: skill tool projection. Schema is byte-stable per turn.
// Slice 4 will surface the scenario catalog on the bundle; Slice 7 will extend
// the selection guide to tell the model when to engage.
function createSkillToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "skill",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["list", "describe", "engage", "release"],
          description:
            '"list" and "describe" are read-only and safe to call speculatively. "engage" activates a Skill (and optionally a scenario workflow). "release" deactivates the current Skill.'
        },
        category: {
          type: "string",
          description:
            'Optional when action is "list". Filters the enabled Skill catalog by category (for example "work" or "engineering"). Omit to list all enabled Skills.'
        },
        skillId: {
          type: "string",
          description:
            'Required when action is "describe" or "engage". The id of the enabled Skill to inspect or activate. Must be one of the Skill ids listed in the Enabled Skills block.'
        },
        scenarioKey: {
          type: "string",
          description:
            'Optional when action is "describe" or "engage". The key of a specific scenario workflow within the Skill (for example "instagram_carousel"). With action="describe" it returns read-only scenario detail. With action="engage" it returns the structured active steps.'
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

/**
 * ADR-119 Slice 7: max chars for a tool description sent to providers (Anthropic cap).
 * When the combined description + structured guidance exceeds this, the projection
 * emits a graceful truncation that preserves at minimum the "WHEN TO USE:" first line.
 */
const TOOL_DESCRIPTION_CAP = 1024;

/**
 * ADR-119 Slice 7: truncate a structured description to TOOL_DESCRIPTION_CAP while
 * preserving as much of the "WHEN TO USE:" section as possible.
 */
function truncateToDescriptionCap(description: string, guidance: string): string {
  // Try: description + just the first WHEN TO USE line
  const firstLineMatch = guidance.match(/^WHEN TO USE:[^\n]*/);
  if (firstLineMatch) {
    const candidate = `${description}\n${firstLineMatch[0]}`;
    if (candidate.length <= TOOL_DESCRIPTION_CAP) {
      return candidate;
    }
  }
  // Hard truncate as final fallback
  return `${description}\n${guidance}`.slice(0, TOOL_DESCRIPTION_CAP);
}

function resolveToolDefinitionDescription(policy: RuntimeToolPolicy, fallback?: string): string {
  const description = policy.description?.trim() || fallback?.trim() || policy.displayName;
  const guidance = policy.usageGuidance?.trim();
  if (!guidance) return description;
  const full = `${description}\n${guidance}`;
  if (full.length <= TOOL_DESCRIPTION_CAP) return full;
  return truncateToDescriptionCap(description, guidance);
}

function resolveToolDefinitionDescriptionWithHint(
  policy: RuntimeToolPolicy,
  hint: string,
  fallback?: string
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

function supportsCurrentNativePresentationProvider(
  credential: AssistantRuntimeBundleToolCredentialRef
): boolean {
  const candidates = [credential, ...(credential.fallbacks ?? [])];
  return candidates.some((entry) => entry.configured === true && entry.providerId === "gamma");
}
