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
  MAX_RUNTIME_BROWSER_EXTRACT_ITEMS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  DEFAULT_RUNTIME_BROWSER_VIEWPORT_WIDTH,
  DEFAULT_RUNTIME_BROWSER_VIEWPORT_HEIGHT,
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
  PERSAI_RUNTIME_BROWSER_SNAPSHOT_FORMATS,
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
  type RuntimeBundleSkillScenarioScriptRef,
  type RuntimeKnowledgeAccessSourceConfig,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";

export type NativeToolProjectionOptions = {
  allowModelToolExposure?: boolean;
  allowedKnowledgeSearchSources?: readonly PersaiRuntimeKnowledgeSource[];
  allowedKnowledgeFetchSources?: readonly PersaiRuntimeKnowledgeSource[];
  /** ADR-135 S3 — catalog tools described this turn project as full on wire. */
  wireExpandedCatalogToolCodes?: ReadonlySet<string>;
  /**
   * ADR-151 — the pinned Script reference for the exact current active
   * Scenario step, or `null`/absent when the current step has no Script.
   * The `script` tool is projected only when this is present; projection
   * is not authorization — execution re-resolves and re-authorizes from
   * live decision state immediately before `script.execute`.
   */
  activeScriptRef?: RuntimeBundleSkillScenarioScriptRef | null;
};

/** ADR-135 — catalog-tier tools may expose read-only family actions on the stub wire. */
export const CATALOG_READ_ONLY_TOOL_ACTIONS: Partial<Record<string, readonly string[]>> = {
  browser: ["list_profiles"],
  video_generate: ["list_personas", "list_voices", "describe_avatar_mode"],
  scheduled_action: ["list"],
  background_task: ["list"],
  quota_status: ["report"],
  skill: ["list"]
};

export function resolveModelExposure(policy: RuntimeToolPolicy): "full" | "catalog" {
  return policy.modelExposure === "catalog" ? "catalog" : "full";
}

function buildCatalogStubDescription(toolCode: string, policy: RuntimeToolPolicy): string {
  const modelDescription = policy.description?.trim() || policy.displayName;
  return `${modelDescription}\nCall ${toolCode}({action:"describe"}) before the first real execution call.`;
}

function buildCatalogStubInputSchema(readOnlyActions: readonly string[]): Record<string, unknown> {
  const actions = ["describe", ...readOnlyActions.filter((action) => action !== "describe")];
  return {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: [...new Set(actions)],
        description:
          'Use "describe" to load the full tool contract before the first real execution call.'
      }
    }
  };
}

function applyModelExposureProjection(
  toolCode: string,
  policy: RuntimeToolPolicy,
  fullDefinition: ProviderGatewayToolDefinition,
  catalogReadOnlyActions: readonly string[] = CATALOG_READ_ONLY_TOOL_ACTIONS[toolCode] ?? []
): ProviderGatewayToolDefinition {
  if (resolveModelExposure(policy) === "full") {
    return fullDefinition;
  }
  return {
    name: fullDefinition.name,
    description: buildCatalogStubDescription(toolCode, policy),
    inputSchema: buildCatalogStubInputSchema(catalogReadOnlyActions)
  };
}

function normalizeBundleForFullToolExposure(
  bundle: AssistantRuntimeBundle,
  toolCode: string
): AssistantRuntimeBundle {
  return {
    ...bundle,
    governance: {
      ...bundle.governance,
      toolPolicies: bundle.governance.toolPolicies.map((policy) =>
        policy.toolCode === toolCode ? { ...policy, modelExposure: "full" as const } : policy
      )
    }
  };
}

/**
 * ADR-135 — build the full wire projection for one tool (ignores catalog stub tier).
 * Used by `{tool}({action:"describe"})` execution so describe reuses the same builders.
 */
export function buildFullNativeToolDefinition(
  bundle: AssistantRuntimeBundle,
  toolCode: string,
  options?: NativeToolProjectionOptions
): ProviderGatewayToolDefinition | null {
  const projection = projectRuntimeNativeTools(
    normalizeBundleForFullToolExposure(bundle, toolCode),
    options
  );
  return projection.tools.find((tool) => tool.name === toolCode) ?? null;
}

function appendToolDefinitionHint(base: string, hint: string): string {
  return base.includes(hint) ? base : `${base} ${hint}`;
}

// ADR-130 Slice 4: the pending_delivery honesty rule (do not claim anything is
// queued/accepted/in-progress/attached/sent without a real structural jobId
// result) is owned exclusively by the always-on `DELIVERY_HONESTY_CONTRACT` in
// `turn-execution.service.ts`, shipped every turn via `developerInstructions`
// (section key `delivery_contract`). This per-tool hint only adds the bits
// that dev-tail contract does not cover: the action='skipped' quota/plan-limit
// reply guidance and the tool-specific quota_status lookup pointer.
function buildPendingDeliveryHint(params: {
  quotaToolCode: "image_generate" | "image_edit" | "video_generate" | "document";
  extra?: string;
}): string {
  return [
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
  options?: NativeToolProjectionOptions
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
  const skillToolPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "skill");
  const enabledSkills = bundle.skills?.enabled ?? [];
  if (skillToolPolicy !== null && enabledSkills.length > 0) {
    projectedTools.push(createSkillToolDefinition(skillToolPolicy));
  }
  // ADR-151 — script tool is projected only when the exact current active
  // Scenario step carries a materialized scriptRef and this bundle has the
  // sandbox enabled. No policy/catalog row: Scripts are a Skill/Scenario
  // capability, not an operator plan toggle.
  if (bundle.runtime.sandbox?.enabled === true && options?.activeScriptRef) {
    projectedTools.push(createScriptToolDefinition(options.activeScriptRef));
  }

  const projection: RuntimeNativeToolProjection = {
    tools: projectedTools,
    knowledgeSearchSources: projectedKnowledgeSearchSources,
    knowledgeFetchSources: projectedKnowledgeFetchSources
  };
  return applyWireExpandedCatalogToolProjection(bundle, projection, options);
}

function applyWireExpandedCatalogToolProjection(
  bundle: AssistantRuntimeBundle,
  projection: RuntimeNativeToolProjection,
  options?: NativeToolProjectionOptions
): RuntimeNativeToolProjection {
  const expandedCodes = options?.wireExpandedCatalogToolCodes;
  if (expandedCodes === undefined || expandedCodes.size === 0) {
    return projection;
  }
  return {
    ...projection,
    tools: projection.tools.map((tool) => {
      if (!expandedCodes.has(tool.name)) {
        return tool;
      }
      const policy =
        bundle.governance.toolPolicies.find((entry) => entry.toolCode === tool.name) ?? null;
      if (policy === null || resolveModelExposure(policy) !== "catalog") {
        return tool;
      }
      const fullDefinition = buildFullNativeToolDefinition(bundle, tool.name, options);
      return fullDefinition ?? tool;
    })
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
  const toolCode = bundle.runtime.sharedCompaction.summarizeToolCode;
  return applyModelExposureProjection(toolCode, policy, {
    name: toolCode,
    description: resolveToolDefinitionDescription(policy),
    inputSchema: createCompactionInputSchema()
  });
}

function createCompactContextToolDefinition(
  bundle: AssistantRuntimeBundle,
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  const toolCode = bundle.runtime.sharedCompaction.compactToolCode;
  return applyModelExposureProjection(toolCode, policy, {
    name: toolCode,
    description: resolveToolDefinitionDescription(policy),
    inputSchema: createCompactionInputSchema()
  });
}

function createCompactionInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["describe"],
        description:
          'Use "describe" to load the full tool contract before the first real execution call.'
      },
      instructions: {
        type: "string",
        description: "Optional guidance about what the summary should preserve."
      }
    }
  };
}

function createMemoryWriteToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("memory_write", policy, {
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
            'Defaults to "write" (record a new memory). Use "close" to resolve a known open loop by its `ref`; when "close", `ref` is required and `kind`/`memory`/`closeOpenLoop` must be omitted.'
        },
        kind: {
          type: "string",
          enum: [...PERSAI_RUNTIME_MEMORY_WRITE_KINDS],
          description: 'For "write": fact, preference, or open_loop.'
        },
        memory: {
          type: "string",
          maxLength: MEMORY_WRITE_MAX_CHARS,
          description:
            'For "write": one concise genuinely durable memory statement. Not greetings, acknowledgements, or one-off chatter.'
        },
        layer: {
          type: "string",
          enum: [...PERSAI_RUNTIME_MEMORY_WRITE_LAYERS],
          description:
            'For "write": "long" for stable long-term facts, lasting preferences, or durable decisions; "short" for recent working context that should decay naturally.'
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            'Optional for "write". Honest confidence this memory is worth storing; skip low-confidence or marginal memories instead of writing them.'
        },
        closeOpenLoop: {
          type: "boolean",
          description:
            'Set true on a `write` action only when it also resolves a previously recorded open loop and you lack a precise `ref` from the carry-over block; the runtime finds the most similar active open loop and marks it resolved. Prefer `action:"close"` with a `ref` when one is available.'
        },
        ref: {
          type: "string",
          description:
            'Required when action is "close". Opaque open-loop reference shown as `[ref: ...]` in the carry-over block; pass it back verbatim.'
        }
      }
    }
  });
}

function createTodoWriteToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("todo_write", policy, {
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
            "One operation per call: add (create items), update (rewrite content/status/parent by id), complete (mark done by id; rejected if open children exist), remove (soft-delete item + descendants by id), clear (wipe the chat plan)."
        },
        items: {
          type: "array",
          description:
            "Required for action=add. Each item: { content, parentId?, status? }, content <=240 chars. parentId attaches under an existing item id (unknown/completed parents rejected). status defaults to pending; cannot be completed on add.",
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
                description: "Parent todo id to attach this item as a child. Omit for top-level."
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress"],
                description:
                  "Initial status, defaults to pending. completed cannot be set on add; only one in_progress per parent scope (extras coerced to pending with a warning)."
              }
            }
          }
        },
        id: {
          type: "string",
          description:
            "Required for action=update|complete|remove. Exact server-minted todo id from a prior todo_write response."
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
            "New status for action=update. completed rejected if open children remain; in_progress rejected if a sibling is already in_progress."
        },
        parentId: {
          type: "string",
          description:
            "New parent for action=update. Empty string or null detaches to top-level; reparenting under a completed item or creating a cycle is rejected."
        }
      }
    }
  });
}

function createQuotaStatusToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("quota_status", policy, {
    name: "quota_status",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["describe", "report", "create_checkout"],
          description:
            '"describe" loads the full tool contract. "report" (default): inspect quota, limits, and plan options. "create_checkout": open a checkout link now.'
        },
        toolCode: {
          type: "string",
          description:
            "Tool code to inspect one quota-governed tool for action='report'. Unset returns daily tool counters, the quota bucket snapshot, monthly quota rows, package availability, and visible plan options."
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
  });
}

function createWebSearchToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("web_search", policy, {
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
  });
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
  return applyModelExposureProjection("knowledge_search", policy, {
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
          description: `Knowledge source namespace to search. Meanings: ${sourceDescriptions}.`
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
  });
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
  return applyModelExposureProjection("knowledge_fetch", policy, {
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
          description: `Knowledge source namespace for the reference. Meanings: ${sourceDescriptions}.`
        },
        referenceId: {
          type: "string",
          description: "Reference id returned by knowledge_search."
        }
      }
    }
  });
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
  return applyModelExposureProjection("web_fetch", policy, {
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
  });
}

function createBrowserToolDefinition(
  bundle: AssistantRuntimeBundle,
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  const browserViewportLabel = `${String(DEFAULT_RUNTIME_BROWSER_VIEWPORT_WIDTH)}x${String(DEFAULT_RUNTIME_BROWSER_VIEWPORT_HEIGHT)}`;
  return applyModelExposureProjection("browser", policy, {
    name: "browser",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["describe", ...bundle.runtime.browser.actions],
          description:
            'Use "describe" to load the full tool contract. Prefer "list_profiles" before "login". Reuse an existing profile with "snapshot"/"act"; call "login" only when list_profiles shows none for that site or the runtime result requires re-auth. Use "request_user_action" only for an explicit manual step (CAPTCHA, OTP/verification, payment, irreversible confirmation) with profile + userActionPrompt — stop browser calls until Done. Use "open_live" only when the user asks to view a saved session. Runtime chooses the backend; do not narrate it. "snapshot" reads page text; "act" runs operations and returns fresh page.elements (and page.extracted after extract).'
        },
        url: {
          type: "string",
          description:
            'HTTP or HTTPS URL. Required for "login", "snapshot", and "act". For "login" this is the site login page opened before the live window.'
        },
        displayName: {
          type: "string",
          description:
            'Human-readable profile label. Required for action="login". Do not promise raw URLs or implementation details in chat.'
        },
        profile: {
          type: "string",
          description:
            'Stable profileKey from "login" or "list_profiles". Required for "request_user_action" and "open_live". Optional on "snapshot"/"act" to reuse cookies. Prefer selectors from page.elements when present.'
        },
        userActionPrompt: {
          type: "string",
          maxLength: 500,
          description:
            'Required for action="request_user_action". Concise instruction for the live browser (for example "Enter the SMS code and submit."). No secrets; do not claim the step is already done.'
        },
        format: {
          type: "string",
          enum: [...PERSAI_RUNTIME_BROWSER_SNAPSHOT_FORMATS],
          description:
            'Snapshot output format. Default "text". Image/pdf artifacts are attachable via files.attach. Image snapshots use a fixed ' +
            browserViewportLabel +
            " viewport — keep fullPage:false when you need click_at coordinates; read x,y via files.preview."
        },
        snapshotSelector: {
          type: "string",
          description:
            'Optional CSS selector for action="snapshot" with format png/jpeg/webp. Captures that element only; cannot be combined with fullPage:true.'
        },
        fullPage: {
          type: "boolean",
          description:
            "When true on image snapshot (png/jpeg/webp), capture the full scrollable page. Ignored when snapshotSelector is set."
        },
        optimizeForSpeed: {
          type: "boolean",
          description:
            "When true, prefer faster page load (block heavy assets, domcontentloaded). Defaults to true for profile-backed snapshot/act when omitted."
        },
        stayOnPage: {
          type: "boolean",
          description:
            'When true on action="act", skip opening navigation to url and run operations on the current page. Chain kind="goto" inside operations for mid-flow navigation.'
        },
        maxChars: {
          type: "integer",
          minimum: 500,
          maximum: MAX_RUNTIME_BROWSER_MAX_CHARS,
          description: "Maximum number of page-text characters to return for text snapshots."
        },
        operations: {
          type: "array",
          maxItems: MAX_RUNTIME_BROWSER_OPERATIONS,
          description: `Required for action="act". Up to ${String(MAX_RUNTIME_BROWSER_OPERATIONS)} ordered steps in one call. Returns page.elements (and page.extracted after extract). Prefer selectors from the latest page.elements; pass matchIndex when present. Use wait_for_selector in the same act when a later step depends on content opened earlier. click_at: png snapshot at ${browserViewportLabel} → files.preview → viewport x,y (do not guess). For a manual CAPTCHA/OTP/payment/irreversible step, stop and call request_user_action.`,
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
                description:
                  "CSS selector for click/type/hover/extract/select/wait_for_selector. Prefer page.elements. Optional for scroll: scrolls that element into view, or the viewport by one page when omitted."
              },
              url: {
                type: "string",
                description: 'Target URL when kind="goto".'
              },
              matchIndex: {
                type: "integer",
                minimum: 0,
                description:
                  "0-based index when the selector matches multiple elements. Copy from page.elements when present."
              },
              maxItems: {
                type: "integer",
                minimum: 1,
                maximum: MAX_RUNTIME_BROWSER_EXTRACT_ITEMS,
                description: `Optional cap for kind="extract" (default ${String(MAX_RUNTIME_BROWSER_EXTRACT_ITEMS)}).`
              },
              x: {
                type: "integer",
                minimum: 0,
                maximum: 10_000,
                description: `Viewport X for kind="click_at" from files.preview on a ${browserViewportLabel} png (0..${String(DEFAULT_RUNTIME_BROWSER_VIEWPORT_WIDTH - 1)} for a full viewport shot).`
              },
              y: {
                type: "integer",
                minimum: 0,
                maximum: 10_000,
                description: `Viewport Y for kind="click_at" from files.preview on a ${browserViewportLabel} png (0..${String(DEFAULT_RUNTIME_BROWSER_VIEWPORT_HEIGHT - 1)} for a full viewport shot).`
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
  });
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
  return applyModelExposureProjection("image_generate", policy, {
    name: "image_generate",
    description: appendToolDefinitionHint(
      appendToolDefinitionHint(
        resolveToolDefinitionDescription(policy),
        "count=N means N separate final images in this one job. For distinct carousel/slideshow/frame requests, set outputMode='series' and put one unique single-image instruction per seriesItems entry; never duplicate the same instruction across items."
      ),
      buildPendingDeliveryHint({
        quotaToolCode: "image_generate"
      })
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        action: {
          type: "string",
          enum: ["describe", "generate"],
          description:
            'Use "describe" to load the full tool contract. Omit or use "generate" for real image generation.'
        },
        prompt: {
          type: "string",
          description: "Text prompt describing the image to generate."
        },
        count: {
          type: "integer",
          minimum: MIN_RUNTIME_IMAGE_GENERATE_COUNT,
          maximum: effectiveCap,
          description: `Images to produce in this job (${String(MIN_RUNTIME_IMAGE_GENERATE_COUNT)}..${String(effectiveCap)}); each counts as one per-turn result and one daily-quota unit.`
        },
        outputMode: {
          type: "string",
          enum: ["variants", "series"],
          description:
            "Default to series for any multi-image request so each output has its own seriesItems instruction; reserve variants for rare compatibility cases."
        },
        seriesItems: {
          type: "array",
          items: { type: "string" },
          description:
            "Required when outputMode='series'. One single-image instruction per requested output, in order — each distinct, never repeated."
        },
        filename: {
          type: "string",
          description: "Optional filename hint for the generated image attachment."
        },
        size: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_GENERATE_SIZES],
          description: 'Optional output size hint; "auto" lets the provider choose.'
        },
        background: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_BACKGROUNDS],
          description:
            'Use "transparent" for a cutout, sticker, icon, logo, or PNG with alpha; "opaque" only when the user explicitly wants a solid background. Defaults to "auto".'
        }
      }
    }
  });
}

function createImageEditToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  const effectiveCap = resolveImageCountCap("image_edit", policy, MAX_RUNTIME_IMAGE_EDIT_COUNT);
  return applyModelExposureProjection("image_edit", policy, {
    name: "image_edit",
    description: appendToolDefinitionHint(
      appendToolDefinitionHint(
        appendToolDefinitionHint(
          resolveToolDefinitionDescription(policy),
          "count=N means N separate final edited images in this one job. For distinct carousel/slideshow/frame requests, set outputMode='series' and put one unique single-image instruction per seriesItems entry; never duplicate the same instruction across items. In series mode, keep the same source product/object identity across slides unless the user explicitly asked to change products."
        ),
        buildPendingDeliveryHint({
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
          description: "Instruction for how to edit the referenced chat image."
        },
        count: {
          type: "integer",
          minimum: MIN_RUNTIME_IMAGE_EDIT_COUNT,
          maximum: effectiveCap,
          description: `Edited variants to produce in this job (${String(MIN_RUNTIME_IMAGE_EDIT_COUNT)}..${String(effectiveCap)}); each counts as one per-turn result and one daily-quota unit.`
        },
        outputMode: {
          type: "string",
          enum: ["variants", "series"],
          description:
            "Default to series for any multi-image edit request so each output has its own seriesItems instruction; reserve variants for rare compatibility cases."
        },
        seriesItems: {
          type: "array",
          items: { type: "string" },
          description:
            "Required when outputMode='series'. One single-image edit instruction per requested output, in order — each distinct, never repeated."
        },
        sourceImageAlias: {
          type: "string",
          description:
            'Optional sticky alias of the image to edit, e.g. "image #1". Required when multiple reusable images are available and the source image is clear.'
        },
        referenceImageAliases: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES,
          description: `Optional sticky aliases of up to ${String(MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES)} additional images used only as style/appearance/background/composition references, e.g. ["image #2", "image #3"]. Exclude sourceImageAlias — the edit stays rooted in the source image; references only guide it.`
        },
        filename: {
          type: "string",
          description: "Optional filename hint for the edited image attachment."
        },
        size: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_GENERATE_SIZES],
          description: 'Optional output size hint; "auto" lets the provider choose.'
        },
        background: {
          type: "string",
          enum: [...PERSAI_RUNTIME_IMAGE_BACKGROUNDS],
          description:
            'Use "transparent" to remove background, cutout/sticker/icon/logo, or PNG with alpha; "opaque" only when the user explicitly wants a solid background. Defaults to "auto".'
        }
      }
    }
  });
}

function createVideoGenerateToolDefinition(
  policy: RuntimeToolPolicy,
  talkingAvatarCredential: AssistantRuntimeBundleToolCredentialRef | null
): ProviderGatewayToolDefinition {
  const talkingAvatarEnabled = talkingAvatarCredential !== null;
  return applyModelExposureProjection("video_generate", policy, {
    name: "video_generate",
    description: appendToolDefinitionHint(
      resolveToolDefinitionDescription(policy),
      [
        [
          "Prefer calling this tool immediately when the user clearly wants a video. For cinematic mode, pass explicit seconds and size/aspect when the user gave them, but do not ask a follow-up only to fill those fields: when they are omitted, runtime will use the selected model catalog defaults and normalize unsupported values.",
          buildPendingDeliveryHint({
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
          enum: ["describe", "generate", "list_personas", "list_voices", "describe_avatar_mode"],
          description:
            'Use "describe" to load the full tool contract. Omit or use "generate" for real video generation; use the other actions for read-only persona, voice, or talking-avatar lookups.'
        },
        prompt: {
          type: "string",
          description:
            'Video clip prompt. Required when action is omitted/"generate" and mode is cinematic; optional short scene note for talking_avatar; ignored by read-only lookup actions.'
        },
        ...(talkingAvatarEnabled
          ? {
              mode: {
                type: "string",
                enum: ["cinematic", "talking_avatar"],
                description:
                  "'cinematic' (default): standard AI video, silent/no-speech clips, image animation, gestures, product/fashion videos — any request without spoken avatar narration. 'talking_avatar': only for an explicit speaking avatar/talking head request; requires non-empty speechText and either personaId or portraitImageAlias."
              },
              speechText: {
                type: "string",
                description:
                  "Exact non-empty script the avatar speaks. Required when mode='talking_avatar'. Do not invent filler text; if the user wants no speech/dialogue (incl. без речи), use mode='cinematic' instead."
              },
              speechLanguage: {
                type: "string",
                description:
                  "BCP-47 language tag for the speech, e.g. 'en-US', 'ru-RU'. Omit to auto-detect from speechText."
              },
              personaId: {
                type: "string",
                description:
                  'Saved video persona (character) id to use as the avatar. Load ids first with action="list_personas". Mutually exclusive with portraitImageAlias.'
              },
              portraitImageAlias: {
                type: "string",
                description:
                  'Sticky alias of an available portrait image for an ad-hoc talking-avatar base, e.g. "image #1". Use only when the user explicitly names a portrait alias. Mutually exclusive with personaId.'
              },
              voiceKey: {
                type: "string",
                description:
                  'PersAI voice key overriding the persona\'s default voice. Load keys first with action="list_voices". Omit on the persona path to use its stored voice; required on the portraitImageAlias path.'
              },
              talkingAvatarAspectRatio: {
                type: "string",
                enum: ["16:9", "9:16", "1:1"],
                description:
                  "Talking-avatar output aspect ratio, ad-hoc portraitImageAlias only — do not pass with personaId (saved personas keep their stored format). Pass only when the user explicitly requested vertical/9:16, square/1:1, or widescreen/16:9; never infer from short/social/platform wording."
              }
            }
          : {}),
        locale: {
          type: "string",
          description:
            'Locale hint for action="list_voices" to prefer matching-locale voices first, e.g. "en-US" or "ru-RU".'
        },
        referenceImageAlias: {
          type: "string",
          description:
            'Cinematic only; omit for talking_avatar (use portraitImageAlias instead). Sticky image alias for a visual reference or first frame, e.g. "image #1". Provide only when the user explicitly identifies or selects a specific available image alias, or when an upstream structured UI/tool has already provided that alias. Do not guess or infer aliases heuristically from context; otherwise omit this field so runtime uses text-to-video.'
        },
        referenceImageAliases: {
          type: "array",
          items: { type: "string" },
          description:
            "Cinematic only; omit for talking_avatar. Ordered image aliases for a true multi-image video request; use only when the user explicitly asked for a multi-image composition with known aliases."
        },
        voiceIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Cinematic only; omit for talking_avatar (use voiceKey instead). Ordered provider voice ids for explicit voice-controlled Kling text/image-to-video requests only."
        },
        voiceKeys: {
          type: "array",
          items: { type: "string" },
          description:
            'Cinematic only; omit for talking_avatar (use the singular voiceKey field instead). Ordered PersAI voice keys for Kling voice-controlled text/image-to-video requests. Load valid keys first with action="list_voices"; do not invent keys.'
        },
        audioMode: {
          type: "string",
          enum: ["silent", "provider_native_audio", "voice_control"],
          description:
            "Cinematic only; omit for talking_avatar (speech there comes from speechText plus voiceKey or the persona's stored voice). Requested audio intent."
        },
        inputMode: {
          type: "string",
          enum: ["text", "single_reference_image", "multi_image", "omni"],
          description:
            "Cinematic only; omit for talking_avatar (use personaId or portraitImageAlias instead). Requested input class."
        },
        filename: {
          type: "string",
          description:
            "Cinematic only; omit for talking_avatar. Filename hint for the generated video attachment."
        },
        size: {
          type: "string",
          enum: [...PERSAI_RUNTIME_VIDEO_GENERATE_SIZES],
          description:
            "Cinematic-only optional output size/aspect hint. Omit when mode='talking_avatar'; use talkingAvatarAspectRatio instead."
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
  });
}

function createTtsToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("tts", policy, {
    name: "tts",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        action: {
          type: "string",
          enum: ["describe", "synthesize"],
          description:
            'Use "describe" to load the full tool contract. Omit or use "synthesize" for real speech generation.'
        },
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
  });
}

function createDocumentToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("document", policy, {
    name: "document",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      oneOf: [
        {
          required: ["action"],
          properties: {
            action: { enum: ["describe"] }
          }
        },
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
          enum: ["describe", "inspect", "render", "convert"],
          description:
            'Use `action="describe"` to load the full tool contract. Use `action="inspect"` to inspect an existing source, `action="render"` to author a new document from Markdown, or `action="convert"` to convert between PDF/DOCX/XLSX.'
        },
        path: {
          type: "string",
          description:
            'Required for `action="inspect"`. Exact existing `/workspace/...` PDF, DOCX, or XLSX path from Working Files, files.list, or a prior tool result. For new outputs use `requestedName` instead.'
        },
        format: {
          type: "string",
          enum: ["pdf", "xlsx", "docx"],
          description: 'Required for `action="render"`. Output format for the authored document.'
        },
        content: {
          type: "string",
          description:
            'Inline Markdown body for `action="render"`. Provide either `content` or `contentPath`, not both.'
        },
        contentPath: {
          type: "string",
          description:
            '`/workspace/...` Markdown source path for `action="render"` — a sibling Markdown file in the current session root is the normal edit path. Provide either `contentPath` or inline `content`, not both.'
        },
        style: {
          type: "string",
          enum: ["default", "report", "minimal"],
          description:
            'Style preset for `action="render"`, for ordinary authored layouts; for highly custom layout use `shell` + Python instead.'
        },
        template: {
          type: "string",
          description:
            '`/workspace/...` DOCX template path for `action="render"` when `format="docx"`. For complex layout beyond the built-in renderer, use `shell` + Python.'
        },
        requestedName: {
          type: "string",
          description:
            'Required for `action="render"`, optional for `action="convert"`. Filename only, not a path — the runtime places it under the current session root and returns the final `/workspace/...` outputPath. If omitted for `action="convert"`, the runtime derives a same-basename filename.'
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
  });
}

function createPresentationToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("presentation", policy, {
    name: "presentation",
    description: appendToolDefinitionHint(
      resolveToolDefinitionDescription(policy),
      buildPendingDeliveryHint({
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
        action: {
          type: "string",
          enum: ["describe"],
          description:
            'Use `action="describe"` to load the full tool contract before the first real execution call.'
        },
        descriptorMode: {
          type: "string",
          enum: ["create_presentation", "revise_document", "export_or_redeliver"],
          description:
            "Deferred operation mode: create_presentation for new decks, revise_document for existing PersAI presentations, export_or_redeliver only when the user explicitly asked for PPTX/PowerPoint export."
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
            "Requested output format. Chat delivery for create_presentation and revise_document is always PDF; pptx is meaningful only for export_or_redeliver when the user explicitly asked for PPTX/PowerPoint."
        },
        docId: {
          type: "string",
          description: "Exact presentation document UUID for revise/export flows only."
        },
        storagePath: {
          type: "string",
          description: "Presentation-revision locator for PersAI-managed Gamma attachments only."
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
            "Presentation-only visual style for create_presentation, steering the deck's overall look and image style."
        },
        imagePolicy: {
          type: "string",
          enum: ["ai_generated", "web_free_to_use", "pictographic", "text_only"],
          description:
            "Presentation-only image policy for create_presentation. Prefer ai_generated or web_free_to_use for a normal visual deck; pictographic only for icon/diagram-heavy decks; text_only only when the user explicitly wants no images."
        },
        visualDensity: {
          type: "string",
          enum: ["balanced", "visual_heavy", "text_heavy"],
          description:
            "Presentation-only content balance for create_presentation. Prefer balanced for most decks, visual_heavy for stronger visuals, text_heavy only when the user explicitly asks for denser slide copy."
        },
        targetSlideCount: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description:
            'Presentation-only authoritative slide count for create_presentation and revise_document. Set to the integer the user explicitly asked for (e.g. "7 slides" => 7); leave unset otherwise.'
        },
        outline: {
          description:
            "Presentation outline or content seed. For create_presentation, keep it a flat list of slide titles or concise bullets — avoid nested objects, speaker notes, layout directives, or provider-specific schema."
        },
        transferMode: {
          type: "string",
          enum: ["verbatim", "transform"],
          description:
            "Create-only transfer mode: verbatim for word-for-word source transfer; transform for restyling while keeping the full source content."
        },
        contentIntent: {
          type: "string",
          enum: ["preserve_content", "rewrite_content"],
          description:
            "Content intent: preserve_content keeps the original wording intact (only styling/format/output changes); rewrite_content allows text rewrites. Defaults to preserve_content."
        },
        editOperation: {
          type: "string",
          enum: ["style_only", "content_patch", "section_rewrite"],
          description:
            "Revise-only edit mode. Set style_only when the user asks to restyle/reformat/beautify without changing wording; content_patch for targeted section edits; section_rewrite for a fuller rewrite of one or more sections."
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
  });
}

function createScheduledActionToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("scheduled_action", policy, {
    name: "scheduled_action",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["describe", "create", "list", "pause", "resume", "cancel"],
          description:
            '"describe" loads the full tool contract. Otherwise choose the scheduled-action operation to perform.'
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
          description: "Absolute future ISO datetime for a one-time scheduled action."
        },
        delayMs: {
          type: "number",
          minimum: 1,
          description:
            "Relative delay in milliseconds for a one-time scheduled action; prefer this for requests like 'in 5 minutes'."
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
            "Number of recent chat messages to snapshot into the scheduled-action context."
        }
      }
    }
  });
}

function createBackgroundTaskToolDefinition(
  policy: RuntimeToolPolicy
): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("background_task", policy, {
    name: "background_task",
    description: resolveToolDefinitionDescription(policy),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["describe", "create", "list", "pause", "resume", "cancel"],
          description:
            '"describe" loads the full tool contract. Otherwise choose the background-task operation to perform.'
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
  });
}

function createFilesToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("files", policy, {
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
            'One files action: "list", "read", "preview", "write", "delete", "attach", or "search". Visual re-view of image/* or PDF from Working Files or earlier chat → action="preview" with exact path (no maxBytes). Text files → action="read". Current-message attachments are already visible — no tool. `write` persists only — not chat delivery. `search` requires `query`. `attach` delivers an existing file; call before claiming the user received it.'
        },
        query: {
          type: "string",
          description:
            'Required when action="search". Search tokens matched against file path, filename, and cached shortDescription.'
        },
        path: {
          type: "string",
          description:
            "Path for existing/listed files, or a relative current-session path for write. Do not construct assistant/session IDs; prefer requestedName for new visible files. Use exact `/workspace/...` paths from Working Files, files.list, or prior results for read, preview, delete, attach, or exact overwrite. Use `/tmp/` only for scratch that should never reach the user. Optional for list."
        },
        requestedName: {
          type: "string",
          description:
            'Filename or relative path for action="write" creating a new visible file. Runtime prepends the current session root; never include `/workspace/`, assistant IDs, or session IDs.'
        },
        dir: {
          type: "string",
          description:
            'Synonym for "path" on action="list"; provide dir or path, not both. Omit both to list the current session root.'
        },
        content: {
          type: "string",
          description: 'Full UTF-8 text content for action="write".'
        },
        mode: {
          type: "string",
          description:
            'Strict create mode for action="write"; `mode: "create_only"` fails if the exact path already exists.'
        },
        replace: {
          type: "boolean",
          description:
            'Exact-overwrite flag for action="write". By default an occupied path becomes a sibling ` (N)` filename so earlier deliveries stay intact; pass `replace: true` only when the user explicitly asked to overwrite that file.'
        },
        maxBytes: {
          type: "integer",
          minimum: 1,
          description:
            'Optional byte cap for action="read" or text-only action="preview" on non-image files. Ignored for image/PDF visual preview (plan limit applies). Capped server-side.'
        },
        maxDepth: {
          type: "integer",
          minimum: 1,
          description:
            'Optional recursion depth for action="list". 1 lists direct children only; capped server-side.'
        }
      }
    }
  });
}

function createGrepToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("grep", policy, {
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
  });
}

function createGlobToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("glob", policy, {
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
  });
}

function createExecToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("exec", policy, {
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
          description:
            "Optional subdirectory under the current session root. Omit unless you need a subfolder — default cwd is already the session root from Working Files. Never pass a full `/workspace/...` path (duplicates the root and fails)."
        }
      }
    }
  });
}

function createShellToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("shell", policy, {
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
          description:
            "Optional subdirectory under the current session root. Omit unless you need a subfolder — default cwd is already the session root from Working Files. Never pass a full `/workspace/...` path (duplicates the root and fails)."
        }
      }
    }
  });
}

// ADR-118 Slice 2: skill tool projection. Schema is byte-stable per turn.
// Slice 4 will surface the scenario catalog on the bundle; Slice 7 will extend
// the selection guide to tell the model when to engage.
function createSkillToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return applyModelExposureProjection("skill", policy, {
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
            'Required when action is "engage". Optional when action is "describe" for a skill-card lookup; omit skillId with action="describe" to load the tool-level full contract. Must be one of the Skill ids listed in the Enabled Skills block.'
        },
        scenarioKey: {
          type: "string",
          description:
            'Optional when action is "describe" or "engage". The key of a specific scenario workflow within the Skill (for example "instagram_carousel"). With action="describe" it returns read-only scenario detail. With action="engage" it returns the structured active steps.'
        }
      }
    }
  });
}

/**
 * ADR-151 — bounded read of the published input JSON Schema's `properties`
 * map. Falls back to `{}` for any non-object shape rather than throwing;
 * publication already validated the schema is Draft 2020-12 object-typed
 * and compatible with the authored `inputMapping`.
 */
function readScriptInputSchemaProperties(
  inputSchema: Record<string, unknown>
): Record<string, unknown> {
  const properties = inputSchema.properties;
  return properties !== null && typeof properties === "object" && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {};
}

function readScriptInputSchemaRequired(inputSchema: Record<string, unknown>): ReadonlySet<string> {
  const required = inputSchema.required;
  return Array.isArray(required)
    ? new Set(required.filter((entry): entry is string => typeof entry === "string"))
    : new Set();
}

/**
 * ADR-151 — the model-facing `input` object exposes exactly the fields the
 * authored `inputMapping` sources from `tool_input`, keyed by the tool-input
 * name the model must supply (not the mapped Script field name, which may
 * differ). Literal and current_user_message sources are never exposed —
 * the model cannot choose or override them.
 */
export function buildScriptToolInputSchema(
  scriptRef: RuntimeBundleSkillScenarioScriptRef
): Record<string, unknown> {
  const schemaProperties = readScriptInputSchemaProperties(scriptRef.inputSchema);
  const schemaRequired = readScriptInputSchemaRequired(scriptRef.inputSchema);
  const toolInputFields = new Map<string, { required: boolean; propertySchemas: unknown[] }>();
  for (const [mappedKey, source] of Object.entries(scriptRef.inputMapping)) {
    if (source.source !== "tool_input") {
      continue;
    }
    const required = schemaRequired.has(mappedKey);
    const propertySchema = schemaProperties[mappedKey] ?? null;
    const existing = toolInputFields.get(source.name);
    if (existing === undefined) {
      toolInputFields.set(source.name, {
        required,
        propertySchemas: propertySchema === null ? [] : [propertySchema]
      });
    } else {
      existing.required ||= required;
      if (propertySchema !== null) {
        existing.propertySchemas.push(propertySchema);
      }
    }
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, field] of toolInputFields) {
    properties[name] =
      field.propertySchemas.length === 0
        ? { description: `Value for "${name}".` }
        : field.propertySchemas.length === 1
          ? field.propertySchemas[0]
          : { allOf: field.propertySchemas };
    if (field.required) {
      required.push(name);
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
    properties,
    ...(isJsonObject(scriptRef.inputSchema.$defs) ? { $defs: scriptRef.inputSchema.$defs } : {})
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * ADR-151 — provider-facing tool name is `script` for cross-provider name
 * compatibility; the exact Script identity/version stays server-side and is
 * never exposed here. No modelExposure/catalog projection: dynamic
 * per-active-step projection already keeps this tool absent whenever it is
 * not relevant, which the catalog tier exists to approximate for other tools.
 */
function createScriptToolDefinition(
  scriptRef: RuntimeBundleSkillScenarioScriptRef
): ProviderGatewayToolDefinition {
  return {
    name: "script",
    description: `Run the "${scriptRef.scriptKey}" Script for the current Skill workflow step. Call with action="execute" and an input object containing only the fields listed in its schema — other Script inputs are already supplied by the workflow itself.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action", "input"],
      properties: {
        action: {
          type: "string",
          enum: ["execute"],
          description: 'Must be "execute".'
        },
        input: buildScriptToolInputSchema(scriptRef)
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
export const TOOL_DESCRIPTION_CAP = 4096;

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
