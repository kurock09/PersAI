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

function describeTalkingAvatarVoiceCatalogHint(
  credential: AssistantRuntimeBundleToolCredentialRef
): string | null {
  const shortlist = credential.videoVoiceCatalog?.shortlist ?? [];
  if (shortlist.length === 0) {
    return null;
  }
  const entries = shortlist.slice(0, 20).map((entry) => {
    const details = [entry.displayName, entry.locale, entry.gender]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(", ");
    return details.length > 0 ? `${entry.voiceKey} (${details})` : entry.voiceKey;
  });
  return `Available talking-avatar voiceKeys shortlist (prefer this set when the user did not name a saved persona): up to 10 EN and 10 RU voices, balanced across female/male as much as the catalog allows. ${entries.join("; ")}. For portraitImageAlias talking-avatar requests without an explicit voice, choose from this shortlist instead of inventing voice keys or dumping a long catalog.`;
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
    .map((p) => {
      const linkedClone =
        typeof p.linkedClonedVoiceDisplayName === "string" &&
        p.linkedClonedVoiceDisplayName.trim().length > 0
          ? p.linkedClonedVoiceDisplayName.trim()
          : null;
      const presetFallback =
        typeof p.presetVoiceLabel === "string" && p.presetVoiceLabel.trim().length > 0
          ? p.presetVoiceLabel.trim()
          : null;
      if (linkedClone) {
        const fallbackNote = presetFallback ? `, presetFallbackVoiceLabel="${presetFallback}"` : "";
        return `- personaId="${p.personaId}", displayName="${p.displayName}", voiceLabel="${p.voiceLabel}", linkedClonedVoiceLabel="${linkedClone}"${fallbackNote}`;
      }
      return `- personaId="${p.personaId}", displayName="${p.displayName}", voiceLabel="${p.voiceLabel}"`;
    })
    .join("\n");
  const hasLinkedClone = personas.some(
    (p) =>
      typeof p.linkedClonedVoiceDisplayName === "string" &&
      p.linkedClonedVoiceDisplayName.trim().length > 0
  );
  const cloneGuidance = hasLinkedClone
    ? " Some saved personas use a linked cloned voice. When the user selects that persona, keep its saved voice by default; the linkedClonedVoiceLabel is a safe human label, not a provider id, and the presetFallbackVoiceLabel remains only as fallback metadata."
    : "";
  return `Available saved characters (videoPersonas):\n${lines}${cloneGuidance}`;
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
      "Write only genuinely useful memories for this assistant-user pair: use `long` for stable lasting facts or preferences, `short` for recent working context worth keeping briefly, or close a previously recorded open loop by its ref."
    ),
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
    description: resolveToolDefinitionDescription(
      policy,
      "Manage the orchestrator's structured plan for this chat. Use add/update/complete/remove/clear to keep the plan honest. Open the plan on the first turn you recognise multi-step work; do not wait."
    ),
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
      "Use a real browser for JavaScript-rendered or interactive pages that require live interaction."
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
          resolveToolDefinitionDescription(
            policy,
            appendPerTurnCapHint(
              "Edit a user-referenced image and return a new image file — use this only when the user explicitly wants an image modified, never to describe, analyze, or answer questions about an image (those are answered in text). For any multi-image edit request, use outputMode='series' with seriesItems so each requested output is described as its own final edited image inside one clean job; do not make extra calls. Keep outputMode='variants' only as a rare fallback for internal compatibility, not as the normal multi-image path. When other images should guide style, appearance, background, or composition, list them in referenceImageAliases (the edited output still stays rooted in the source image).",
              "image_edit",
              policy
            )
          ),
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
        "Mode choice is strict. Use mode='talking_avatar' only when the user explicitly asks for a speaking avatar / talking head / character reading a script: the output must include spoken words from speechText, AND either (a) has an attached portrait to use as the speaker, or (b) names a saved character (persona) from the workspace. Use mode='cinematic' (default) for ordinary video, image animation, product/fashion/cinematic clips, silent clips, no-speech requests, gestures, smiles, winks, air kisses, camera motion, music-only mood, or any request that does not explicitly require spoken avatar narration.",
        "Never use mode='talking_avatar' with empty speechText, placeholder speechText, or when the user says no speech / без речи / no dialogue. In those cases use mode='cinematic' with audioMode='silent' when silence/no speech matters.",
        // Section 2: persona resolution
        "The videoPersonas block below lists this workspace's saved characters with their personaId and displayName. When the user names a character (e.g. 'have Masha read this'), find the matching persona by exact displayName (case-insensitive) and pass its personaId. Persona names are unique within a workspace, so a name match is unambiguous. If no persona matches, do not invent IDs — either ask the user to clarify which character, or suggest creating one via Settings → Characters first.",
        // Section 3: persona creation guidance
        "You cannot create personas yourself. Creating a saved character requires the user to visit Settings → Characters and upload a portrait + name + voice. When the user asks to 'save this photo as <name>' or similar, instruct them to use Settings → Characters; do NOT attempt to create the persona via this tool.",
        // Section 4: single character per call
        "Each video_generate call produces ONE clip with ONE speaker (or no speaker for cinematic). If the user requests multiple speakers in a single clip, propose splitting into multiple sequential calls — one per speaker — and combining the results (or playing them in sequence). Do NOT call video_generate with multiple personas; the contract supports exactly one persona OR one portrait alias per call.",
        // Section 5: voice selection precedence
        "Voice selection precedence: if the user explicitly specifies a voice, gender/style of voice, or a concrete voiceKey/voiceId, follow that instruction. If the user names or selects a saved persona, use that persona's stored voice by default and only pass voiceKey to deliberately override it for one call.",
        // Section 6: voice selection — portrait alias path
        "Voice selection (portrait alias path): when passing portraitImageAlias, select voiceKey from the available voice shortlist based on the visual character in the image plus the request context (language, tone, brand fit, likely presentation). If the image strongly suggests a masculine/feminine presentation, prefer a matching voice, but treat this as a practical fit choice rather than a factual identity claim. If the image is ambiguous or confidence is low, you may briefly ask the user which voice they want. When voiceKey is omitted on the portrait path, runtime returns voice_required honestly so the model can retry with an explicit choice.",
        // Section 7: aspect-ratio selection for talking_avatar
        "Talking-avatar aspect ratio: for saved personas (personaId), omit talkingAvatarAspectRatio; the saved persona's avatar format is fixed and runtime will use it. For ad-hoc portraitImageAlias only, pass talkingAvatarAspectRatio only when the user explicitly says vertical/portrait/9:16, square/1:1, or widescreen/landscape/16:9. Do not infer aspect ratio from words like short, social, platform, task, source image shape, or general context.",
        // Section 8: cinematic-only fields ignored in talking_avatar mode
        "When mode='talking_avatar', omit all cinematic-only controls: audioMode, inputMode, voiceKeys, voiceIds, referenceImageAlias, referenceImageAliases, size, seconds, and filename. Talking-avatar audio comes from speechText + voiceKey (or the persona's stored voice); the portrait source is personaId XOR portraitImageAlias. talkingAvatarAspectRatio is only an explicit ad-hoc portraitImageAlias aspect request; never use it as a model guess for saved personas.",
        // Section 9: persona shortlist (from talking-avatar credential ref)
        describeVideoPersonaCatalogHint(talkingAvatarCredential)
      ].join(" ")
    : null;
  // ADR-109 Slice 10c Fix #3f: talking-avatar voice catalog hint from talking-avatar ref.
  const talkingAvatarVoiceCatalogHint = talkingAvatarEnabled
    ? describeTalkingAvatarVoiceCatalogHint(talkingAvatarCredential)
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
        [
          "Prefer calling this tool immediately when the user clearly wants a video. For cinematic mode, pass explicit seconds and size/aspect when the user gave them, but do not ask a follow-up only to fill those fields: when they are omitted, runtime will use the selected model catalog defaults and normalize unsupported values.",
          buildPendingDeliveryHint({
            subject: "the video is being prepared",
            quotaToolCode: "video_generate"
          })
        ].join(" "),
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
                  "Optional ID of a saved video persona (character) to use as the avatar. Use this when the assistant has a named character configured. Mutually exclusive with portraitImageAlias."
              },
              portraitImageAlias: {
                type: "string",
                description:
                  'Optional human-readable sticky alias of an available portrait image to use as an ad-hoc talking-avatar base, for example "image #1". Use only when the user explicitly identifies a specific portrait alias. Mutually exclusive with personaId.'
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
                  "Optional talking-avatar output aspect ratio for ad-hoc portraitImageAlias only. Do not pass with personaId; saved personas keep their stored avatar format. For portraitImageAlias, pass only when the user explicitly requested vertical/portrait/9:16, square/1:1, or widescreen/landscape/16:9. Never infer this from short/social/platform/context wording."
              }
            }
          : {}),
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
      [
        "Generate spoken audio for the current assistant persona with structured expressive delivery.",
        "When the user wants a spoken reply or voice note, call this tool instead of only promising one. Do not claim the audio or voice note already exists unless this same turn returns action='generated'.",
        "Choose structured delivery fields to shape how it sounds; do NOT embed raw bracketed audio tags in text — PersAI compiles your structured choices into safe, conservative provider steering. Keep choices honest to the intended emotional delivery; combining whisper with excited/high intensity is automatically softened."
      ].join(" ")
    ),
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
    description: resolveToolDefinitionDescription(
      policy,
      [
        'Use action="extract" to turn an existing `/workspace/...` source file into a bounded document project under `/workspace/projects/<slug>/` with `project.json`, `extract/` sidecars, a seeded `render/report.html`, and an `output/` directory. The result is compact and points to the project manifest plus sidecar paths to read next with `files.read` or `grep`. When the extracted source is DOCX or XLSX, the result also contains `suggestedNextActions` with the exact `document.render(format=pdf, projectPath, outputPath)` call to use — follow it directly to convert the source to PDF via the seeded LibreOffice entrypoint. Do not read the source content chunk by chunk when the suggested action already covers the request.',
        'Use action="inspect" to validate an existing `/workspace/...` PDF/XLSX/DOCX, write a visible `*.inspect.json` sidecar, and return a compact summary of counts/warnings/suggested reads.',
        'Use action="render" to build a visible `/workspace/...` project into a PDF/XLSX/DOCX output path. PDF render defaults to an HTML entrypoint; it does not auto-run a DOCX/XLSX Python builder as a PDF renderer. XLSX/DOCX render uses a visible Python build script (default `build.py`). If outputPath already exists, render keeps the earlier file and allocates a sibling name like `report (1).pdf` unless you pass `replace: true`. Render auto-registers the output as the current assistant document/version (`registration.versionId`). Standard delivery does not need `document.register_version`; if auto-register is skipped, the render still succeeds and can still be attached.',
        'Use action="register_version" ONLY for advanced cases: revising an existing document by `docId` (`descriptorMode="revise_document"`), or attaching non-default `sourceManifestPath`/`inspectionPath`. Standard render → attach flow does not need this action because render auto-registers.',
        "For DOCX/PDF conversion from an attached source, call document.extract first — it seeds the project and returns `suggestedNextActions` with the exact next document.render call for DOCX→PDF (LibreOffice) or XLSX→PDF (LibreOffice). Call that action verbatim. Do not hand-build HTML from partial files.read chunks and do not render from unrelated workspace projects.",
        "For ordinary PDF/DOCX/XLSX work, stay in the visible workspace loop: extract into a document project when helpful, edit real source files under `/workspace`, render the output, optionally inspect the result, then attach the checked file. Project-owned PDF/DOCX/XLSX outputs may be rejected at files.attach time until the relevant inspect/provenance truth exists.",
        "For a simple new PDF document/manual/report, do not call document before a source entrypoint exists. First write `/workspace/<project>/index.html` with files.write, then call document.render with format=pdf (auto-registers), then files.attach the rendered PDF.",
        "For a simple new DOCX/XLSX request, do not call document before a source build script exists. First write `/workspace/<project>/build.py` with files.write, then call document.render with format=docx or xlsx (auto-registers), then files.attach the rendered file.",
        "For Python-based document.render, write the final file exactly to the provided PERSAI_OUTPUT_PATH environment variable. The runtime executes the Python entrypoint from projectPath; do not chdir into /workspace yourself and do not construct paths like /workspace/workspace/....",
        "Do not use the presentation tool for PDF manuals, instructions, reports, or other ordinary document output. Slides and decks belong in `presentation`, not here.",
        "Never invent placeholder, generic-template, or test/demo content when the user has attached a source file."
      ].join(" ")
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      oneOf: [
        {
          required: ["action", "path"],
          properties: {
            action: { enum: ["extract", "inspect"] }
          }
        },
        {
          required: ["action", "projectPath", "outputPath", "format"],
          properties: {
            action: { enum: ["render"] }
          }
        },
        {
          required: ["action", "outputPath"],
          properties: {
            action: { enum: ["register_version"] }
          }
        }
      ],
      properties: {
        action: {
          type: "string",
          enum: ["extract", "inspect", "render", "register_version"],
          description:
            'Explicit workspace-visible document action. Use `action="extract"` for visible extraction sidecars, `action="inspect"` for visible inspect sidecars, `action="render"` for deterministic render from visible `/workspace/...` project files, and `action="register_version"` to persist document/version metadata for an already rendered visible output before `files.attach` delivers it.'
        },
        path: {
          type: "string",
          description:
            'Source file path for `action="extract"` or `action="inspect"`. Must be an existing `/workspace/...` file in the flat workspace namespace.'
        },
        mode: {
          type: "string",
          enum: ["auto", "text", "ocr", "layout"],
          description:
            'Optional extraction mode for `action="extract"`. Use auto by default, text to prefer local text-layer extraction, ocr to force the default OCR/provider path, and layout to prefer the high-quality layout-preserving path.'
        },
        depth: {
          type: "string",
          enum: ["quick", "standard", "deep"],
          description:
            'Optional inspection depth for `action="inspect"`. Quick keeps the sidecar compact, standard is the default, and deep returns richer sample rows/paragraphs while still keeping the tool result compact.'
        },
        projectPath: {
          type: "string",
          description:
            'Project directory for `action="render"`. Must be a `/workspace/...` folder containing visible source files such as HTML/CSS/assets or a Python build script.'
        },
        format: {
          type: "string",
          enum: ["pdf", "xlsx", "docx"],
          description:
            'Required for `action="render"`. PDF renders from visible HTML or a visible Python build script; XLSX/DOCX render through a visible Python build script.'
        },
        entrypoint: {
          type: "string",
          description:
            'Optional render entrypoint for `action="render"`. Use a project-relative path like `report.html` or `build.py`, or an absolute `/workspace/...` path. If omitted, runtime prefers `index.html` / `report.html` for PDF and defaults to `build.py` for XLSX/DOCX.'
        },
        outputPath: {
          type: "string",
          description:
            'Optional sidecar/output path depending on action. For `action="inspect"`, writes the JSON sidecar there (default: sibling `<basename>.inspect.json`). For `action="render"`, this is the required final `/workspace/...` output file path; if that path already exists, PersAI preserves it by default and writes a sibling ` (N)` filename unless you pass `replace: true`. For `action="register_version"`, this is the already rendered `/workspace/...` output file that should become the registered current document version.'
        },
        replace: {
          type: "boolean",
          description:
            'Optional exact-overwrite flag for `action="render"`. By default an occupied outputPath resolves to a sibling ` (N)` filename so earlier deliveries stay intact. Pass `replace: true` only when the user explicitly asked to overwrite that same file.'
        },
        requestedName: {
          type: "string",
          description: "Optional filename/title hint for the generated document."
        },
        workspaceProjectPath: {
          type: "string",
          description:
            'Optional project directory for `action="register_version"`. Use the same visible `/workspace/...` folder you rendered from so the registered version keeps a stable workspace project pointer.'
        },
        sourceManifestPath: {
          type: "string",
          description:
            'Optional workspace manifest path for `action="register_version"`, for example a visible `/workspace/.../manifest.json` created by your workflow.'
        },
        inspectionPath: {
          type: "string",
          description:
            'Optional visible `*.inspect.json` sidecar path for `action="register_version"`. When provided, PersAI snapshots the compact inspection summary onto the registered version/documentLink metadata.'
        },
        descriptorMode: {
          type: "string",
          enum: ["create_document", "revise_document"],
          description:
            "Optional register_version metadata only. Do not use descriptorMode on document for presentation work; use the presentation tool instead."
        },
        docId: {
          type: "string",
          description:
            "Optional existing document UUID for register_version when revising registered workspace document metadata."
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
    description: resolveToolDefinitionDescription(
      policy,
      [
        "Use this tool only for slide decks and presentations — not for ordinary PDF documents, manuals, reports, DOCX, or XLSX files.",
        "Presentation generation remains supported through descriptorMode=create_presentation. Presentation chat delivery is always PDF. Do not set outputFormat=pptx for create_presentation or for presentation revise_document. Editable PPTX is a separate explicit user-requested preparation action and is not the in-chat artifact. outputFormat=pptx is only meaningful for export_or_redeliver against an existing presentation document when the user explicitly asked for PPTX/PowerPoint.",
        "When the user has attached source material for a presentation (txt, md, csv, json, html, xml, pdf, docx), describe the requested deck transformation in prompt and let the presentation worker inline supported source content; do not paste the file content into the prompt yourself.",
        "For school, educational, explainer, and ordinary client decks, do not choose imagePolicy=text_only or visualDensity=text_heavy unless the user explicitly asks for text-only slides or unusually dense slide copy. Prefer balanced density and ordinary visual policies; do not force pictographic/business icon decks unless the user asked for that exact style.",
        "For Gamma presentations, keep outline simple when you provide it: a short flat list of slide titles or title plus brief bullets. Do not send deeply nested JSON outlines, speaker notes, layout directives, or provider-specific theme guesses.",
        'For create_presentation and for presentation revise_document, you SHOULD set targetSlideCount to a concrete integer between 1 and 30 — even when the user did not specify one. If the user did mention a number ("7 slides", "deck of 10", "до 5 слайдов", "увеличь до 8"), you MUST set targetSlideCount to that exact integer. If the user did not specify a number, pick a reasonable count from the topic (typical school/explainer deck is 7-10, ordinary client deck is 8-12, deep report is 12-16) and pass that integer.',
        buildPendingDeliveryHint({
          subject: "the presentation is being prepared",
          quotaToolCode: "document",
          extra:
            "Do not duplicate the delivery this turn; the presentation is already routed to the user once it finishes."
        })
      ].join(" ")
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
    description: resolveToolDefinitionDescription(
      policy,
      "Schedule simple unconditional user-visible reminders."
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
        "Create and manage quiet assistant-side background tasks. Use this for conditional checks and delayed assistant follow-through; the platform will later evaluate the brief and push the user directly only when warranted. Before creating a new task, avoid duplicates: if the user seems to be referring to an already existing follow-up with the same purpose, first call list and then pause, resume, cancel, or keep the existing task instead of creating a second equivalent one.",
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
      "Files in this workspace live under `/workspace/`. Read any file with `files.read` using the exact path from the Working Files block, `files.list`, or a prior tool result. By default writing to an existing path allocates a new sibling name like `report (1).pdf`, so previous deliveries stay intact. Pass `replace: true` on `files.write` only when the user explicitly asked to overwrite that exact file. Do not reconstruct upload paths from displayName/filename; uploads may be sanitized, renamed, or collision-suffixed. To edit an uploaded file, write to its exact listed path. To create a new file, pick a new `/workspace/...` path. Use `/tmp/` for ephemeral scratch that the user should not see."
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
            'One files action: "list", "read", "preview", "write", "delete", or "attach". Address every file by pod-absolute /workspace/... path. attach delivers any file under /workspace/ to the current chat as a user-visible attachment.'
        },
        path: {
          type: "string",
          description:
            'Pod-absolute path under `/workspace/`. Every workspace file — user uploads, your own writes, anything else — lives directly under `/workspace/<path>`. Use `/tmp/` for ephemeral scratch that should never reach the user. Required for read, preview, write, and delete; required as the directory for list (use "dir" as an alias).'
        },
        dir: {
          type: "string",
          description: 'Synonym for "path" on action="list" — provide either dir or path, not both.'
        },
        content: {
          type: "string",
          description: 'Full UTF-8 text content for action="write".'
        },
        mode: {
          type: "string",
          description:
            'Optional legacy write mode. Use `mode: "create_only"` to fail if the exact path already exists. `mode: "overwrite"` is accepted for compatibility and behaves like `replace: true`, but prefer `replace` for new calls.'
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
    description: resolveToolDefinitionDescription(
      policy,
      "Search workspace files for a text pattern and return structured matches (file path, line number, matched text). Prefer this over shell grep / bash rg for workspace content search."
    ),
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
            "Optional workspace-relative directory to scope the search. Omit to search the whole workspace."
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
    description: resolveToolDefinitionDescription(
      policy,
      "Find workspace files whose names match a glob pattern and return sorted relative paths. Prefer this over shell find / fd for workspace filename discovery."
    ),
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
            "Optional workspace-relative directory to scope the search. Omit to search the whole workspace."
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

// ADR-118 Slice 2: skill tool projection. Schema is byte-stable per turn.
// Slice 4 will surface the scenario catalog on the bundle; Slice 7 will extend
// the selection guide to tell the model when to engage.
function createSkillToolDefinition(policy: RuntimeToolPolicy): ProviderGatewayToolDefinition {
  return {
    name: "skill",
    description: resolveToolDefinitionDescription(
      policy,
      'Engage or release an enabled Skill for the current chat. Call skill({ action: "engage", skillId }) when the conversation enters a Skill domain. Call skill({ action: "release" }) when leaving. Do not re-engage if the Skill is already active with the same skillId.'
    ),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["engage", "release"],
          description:
            '"engage" activates a Skill (and optionally a scenario workflow). "release" deactivates the current Skill.'
        },
        skillId: {
          type: "string",
          description:
            'Required when action is "engage". The id of the enabled Skill to activate. Must be one of the Skill ids listed in the Enabled Skills block.'
        },
        scenarioKey: {
          type: "string",
          description:
            'Optional when action is "engage". The key of a specific scenario workflow to run within the Skill (e.g. "instagram_carousel"). If provided and the scenario exists, the tool result includes the structured steps. Omit for free-form domain discussion.'
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

function resolveToolDefinitionDescription(policy: RuntimeToolPolicy, fallback: string): string {
  const description = policy.description?.trim() || fallback;
  const guidance = policy.usageGuidance?.trim();
  if (!guidance) return description;
  const full = `${description}\n${guidance}`;
  if (full.length <= TOOL_DESCRIPTION_CAP) return full;
  return truncateToDescriptionCap(description, guidance);
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

function supportsCurrentNativePresentationProvider(
  credential: AssistantRuntimeBundleToolCredentialRef
): boolean {
  const candidates = [credential, ...(credential.fallbacks ?? [])];
  return candidates.some((entry) => entry.configured === true && entry.providerId === "gamma");
}
