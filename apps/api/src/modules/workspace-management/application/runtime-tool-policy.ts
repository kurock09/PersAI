import type { AssistantRuntimeBundleToolCredentialRef } from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_BROWSER_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import type { EffectiveToolAvailabilityState } from "./effective-tool-availability.types";
import {
  buildPromptToolMarkdownEntry,
  PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER,
  SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS,
  resolveSyntheticPromptConstructorTool
} from "./prompt-constructor-tool-metadata";

type ToolQuotaPolicyEntry = {
  toolCode: string;
  dailyCallLimit: number | null;
  /**
   * ADR-074 Slice L1 — per-plan override of the runtime per-turn hard cap
   * for this tool. NULL means "use the runtime code default"
   * (TOOL_HARD_CAP_PER_TURN in
   * apps/runtime/src/modules/turns/tool-budget-policy.ts).
   */
  perTurnCap: number | null;
  activationStatus: string;
};

type SyntheticPromptToolOverrideMap = Record<
  string,
  {
    description: string | null;
    usageGuidance: string | null;
  }
>;

const TOOL_EXECUTION_MODE_BY_CODE: Record<string, RuntimeToolPolicy["executionMode"]> = {
  summarize_context: "inline",
  compact_context: "inline",
  memory_write: "inline",
  quota_status: "inline",
  knowledge_search: "inline",
  knowledge_fetch: "inline",
  web_search: "inline",
  web_fetch: "inline",
  browser: "worker",
  image_generate: "worker",
  image_edit: "worker",
  video_generate: "worker",
  tts: "worker",
  memory_search: "inline",
  memory_get: "inline",
  scheduled_action: "worker",
  files: "inline",
  exec: "sandbox",
  shell: "sandbox",
  persai_workspace_attach: "inline",
  persai_tool_quota_status: "inline",
  cron: "worker"
};

const RUNTIME_TOOL_CODE_BY_INVENTORY_CODE: Record<string, string> = {
  persai_tool_quota_status: "quota_status"
};

const MIGRATION_ONLY_MODEL_HIDDEN_TOOLS = new Set(["persai_workspace_attach"]);
const HIDDEN_TOOL_CODES = new Set(["memory_search", "memory_get", "persai_tool_quota_status"]);

function resolveToolKind(
  policyClass: EffectiveToolAvailabilityState["tools"][number]["policyClass"]
): RuntimeToolPolicy["kind"] {
  if (policyClass === "platform_managed") {
    return "system";
  }
  if (policyClass === "hidden_internal") {
    return "internal";
  }
  return "plan";
}

function resolveToolExecutionMode(toolCode: string): RuntimeToolPolicy["executionMode"] {
  const mode = TOOL_EXECUTION_MODE_BY_CODE[toolCode];
  if (!mode) {
    throw new Error(`Missing explicit runtime tool execution mode for "${toolCode}".`);
  }
  return mode;
}

function resolveRuntimeToolCode(toolCode: string): string {
  return RUNTIME_TOOL_CODE_BY_INVENTORY_CODE[toolCode] ?? toolCode;
}

function resolveRuntimeToolDisplayName(
  tool: EffectiveToolAvailabilityState["tools"][number],
  runtimeToolCode: string
): string {
  if (runtimeToolCode === "files") {
    return "Files";
  }
  if (runtimeToolCode === "quota_status") {
    return "Quota Status";
  }
  return tool.displayName;
}

function resolveRuntimeToolDescription(
  tool: EffectiveToolAvailabilityState["tools"][number],
  runtimeToolCode: string
): string | null {
  if (MIGRATION_ONLY_MODEL_HIDDEN_TOOLS.has(tool.code)) {
    return "Migration-only inventory entry. Step 15 does not expose raw path-based workspace attachment to the model.";
  }
  if (runtimeToolCode === "files") {
    return "List, search, inspect, read, write, write-and-send, edit, delete, or send assistant-managed files through one canonical file surface.";
  }
  return tool.modelDescription ?? tool.description;
}

function resolveRuntimeToolUsageGuidance(
  tool: EffectiveToolAvailabilityState["tools"][number],
  runtimeToolCode: string
): string | null {
  if (MIGRATION_ONLY_MODEL_HIDDEN_TOOLS.has(tool.code)) {
    return "Keep this helper off the normal model-visible path.";
  }
  if (runtimeToolCode === "files") {
    return "Use files.write_and_send when the user asks you to create or save a file and immediately deliver it in chat. Use files.write when the file should only be saved. For files.write and files.write_and_send, always prefer a non-empty relative path as the save target; filename is only a delivery-name override, not the canonical save path. Use files.delete for cleanup of obsolete files or directory trees. Use files.list when you need an exact root or folder inventory, and use files.search with a non-empty query when you need to discover a file by name. By default, present file inventories as a short grouped summary (workspace, uploads, artifacts) and hide raw service paths or UUID folders; only enumerate every raw relativePath when the user explicitly asks for the full raw list. When you already know the target file, use a returned fileRef or relativePath directly with files.get, files.read, files.edit, files.delete, or files.send. Do not claim a file was sent unless files.send or files.write_and_send succeeded. Keep exec and shell for actual process execution only.";
  }
  return tool.modelUsageGuidance;
}

function hasConfiguredCredential(
  toolCredentialRefs: Record<string, AssistantRuntimeBundleToolCredentialRef>,
  toolCode: string
): AssistantRuntimeBundleToolCredentialRef | null {
  const credential = toolCredentialRefs[toolCode] ?? null;
  return credential?.configured === true ? credential : null;
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

function supportsCurrentNativeBrowserProvider(providerId: string | null): boolean {
  return (
    providerId === null ||
    PERSAI_RUNTIME_BROWSER_PROVIDER_IDS.includes(
      providerId as (typeof PERSAI_RUNTIME_BROWSER_PROVIDER_IDS)[number]
    )
  );
}

function supportsCurrentNativeImageGenerateProvider(providerId: string | null): boolean {
  return providerId === null || providerId === "openai";
}

function supportsCurrentNativeImageEditProvider(providerId: string | null): boolean {
  const resolved = providerId ?? "openai";
  return PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS.includes(
    resolved as (typeof PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS)[number]
  );
}

function supportsCurrentNativeVideoGenerateProvider(providerId: string | null): boolean {
  return (providerId ?? "openai") === "openai";
}

function supportsCurrentNativeTtsProvider(
  credential: AssistantRuntimeBundleToolCredentialRef | null
): boolean {
  if (!credential) {
    return false;
  }
  const candidates = [credential, ...(credential.fallbacks ?? [])];
  return candidates.some(
    (entry) =>
      entry.configured === true &&
      (entry.providerId === "elevenlabs" ||
        entry.providerId === "yandex" ||
        entry.providerId === "openai")
  );
}

function hasNativeModelExecution(
  runtimeToolCode: string,
  params: {
    toolCredentialRefs: Record<string, AssistantRuntimeBundleToolCredentialRef>;
    knowledgeAccessEnabled: boolean;
    sandboxEnabled: boolean;
  }
): boolean {
  if (
    runtimeToolCode === "summarize_context" ||
    runtimeToolCode === "compact_context" ||
    runtimeToolCode === "memory_write" ||
    runtimeToolCode === "quota_status" ||
    runtimeToolCode === "scheduled_action"
  ) {
    return true;
  }
  if (runtimeToolCode === "knowledge_search" || runtimeToolCode === "knowledge_fetch") {
    return params.knowledgeAccessEnabled;
  }
  if (runtimeToolCode === "web_search") {
    const credential = hasConfiguredCredential(params.toolCredentialRefs, "web_search");
    return (
      credential !== null && supportsCurrentNativeWebSearchProvider(credential.providerId ?? null)
    );
  }
  if (runtimeToolCode === "web_fetch") {
    return hasConfiguredCredential(params.toolCredentialRefs, "web_fetch") !== null;
  }
  if (runtimeToolCode === "browser") {
    const credential = hasConfiguredCredential(params.toolCredentialRefs, "browser");
    return (
      credential !== null && supportsCurrentNativeBrowserProvider(credential.providerId ?? null)
    );
  }
  if (runtimeToolCode === "image_generate") {
    const credential = hasConfiguredCredential(params.toolCredentialRefs, "image_generate");
    return (
      credential !== null &&
      supportsCurrentNativeImageGenerateProvider(credential.providerId ?? null)
    );
  }
  if (runtimeToolCode === "image_edit") {
    const credential = hasConfiguredCredential(params.toolCredentialRefs, "image_edit");
    return (
      credential !== null && supportsCurrentNativeImageEditProvider(credential.providerId ?? null)
    );
  }
  if (runtimeToolCode === "video_generate") {
    const credential = hasConfiguredCredential(params.toolCredentialRefs, "video_generate");
    return (
      credential !== null &&
      supportsCurrentNativeVideoGenerateProvider(credential.providerId ?? null)
    );
  }
  if (runtimeToolCode === "tts") {
    return supportsCurrentNativeTtsProvider(
      hasConfiguredCredential(params.toolCredentialRefs, "tts")
    );
  }
  if (runtimeToolCode === "files" || runtimeToolCode === "exec" || runtimeToolCode === "shell") {
    return params.sandboxEnabled;
  }
  return false;
}

function buildSyntheticSystemToolPolicy(
  toolCode: keyof typeof SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS,
  overrides: SyntheticPromptToolOverrideMap,
  knowledgeAccessEnabled: boolean
): RuntimeToolPolicy {
  const base = resolveSyntheticPromptConstructorTool(toolCode, []);
  const override = overrides[toolCode];
  const enabled =
    toolCode === "knowledge_search" || toolCode === "knowledge_fetch"
      ? knowledgeAccessEnabled
      : true;
  return {
    toolCode,
    displayName: base.displayName,
    description: override?.description ?? base.modelDescription,
    usageGuidance: override?.usageGuidance ?? base.modelUsageGuidance,
    kind: "system",
    executionMode: resolveToolExecutionMode(toolCode),
    usageRule: enabled ? "allowed" : "forbidden",
    enabled,
    visibleToModel: enabled,
    visibleInPlanEditor: false,
    dailyCallLimit: null,
    perTurnCap: null
  };
}

function preferRuntimeToolPolicy(
  current: RuntimeToolPolicy,
  candidate: RuntimeToolPolicy
): RuntimeToolPolicy {
  if (candidate.visibleToModel !== current.visibleToModel) {
    return candidate.visibleToModel ? candidate : current;
  }
  if (candidate.enabled !== current.enabled) {
    return candidate.enabled ? candidate : current;
  }
  if (candidate.usageRule !== current.usageRule) {
    return candidate.usageRule === "allowed" ? candidate : current;
  }
  if ((candidate.description?.trim().length ?? 0) !== (current.description?.trim().length ?? 0)) {
    return (candidate.description?.trim().length ?? 0) > (current.description?.trim().length ?? 0)
      ? candidate
      : current;
  }
  return current;
}

function dedupeRuntimeToolPolicies(toolPolicies: RuntimeToolPolicy[]): RuntimeToolPolicy[] {
  const byToolCode = new Map<string, RuntimeToolPolicy>();
  for (const policy of toolPolicies) {
    const existing = byToolCode.get(policy.toolCode);
    if (!existing) {
      byToolCode.set(policy.toolCode, policy);
      continue;
    }
    byToolCode.set(policy.toolCode, preferRuntimeToolPolicy(existing, policy));
  }
  return [...byToolCode.values()];
}

export function resolveRuntimeToolPolicies(params: {
  tools: EffectiveToolAvailabilityState["tools"];
  planToolQuotaPolicy: ToolQuotaPolicyEntry[];
  toolCredentialRefs: Record<string, AssistantRuntimeBundleToolCredentialRef>;
  knowledgeAccessEnabled: boolean;
  sandboxEnabled: boolean;
  syntheticToolOverrides?: SyntheticPromptToolOverrideMap;
}): RuntimeToolPolicy[] {
  const dailyLimitByCode = new Map(
    params.planToolQuotaPolicy.map((tool) => [tool.toolCode, tool.dailyCallLimit] as const)
  );
  const perTurnCapByCode = new Map(
    params.planToolQuotaPolicy.map((tool) => [tool.toolCode, tool.perTurnCap] as const)
  );
  const catalogPolicies = params.tools.map((tool): RuntimeToolPolicy => {
    const kind = resolveToolKind(tool.policyClass);
    const runtimeToolCode = resolveRuntimeToolCode(tool.code);
    const enabled =
      tool.effectiveActivation === "active" &&
      !MIGRATION_ONLY_MODEL_HIDDEN_TOOLS.has(tool.code) &&
      !HIDDEN_TOOL_CODES.has(tool.code) &&
      hasNativeModelExecution(runtimeToolCode, {
        toolCredentialRefs: params.toolCredentialRefs,
        knowledgeAccessEnabled: params.knowledgeAccessEnabled,
        sandboxEnabled: params.sandboxEnabled
      });
    return {
      toolCode: runtimeToolCode,
      displayName: resolveRuntimeToolDisplayName(tool, runtimeToolCode),
      description: resolveRuntimeToolDescription(tool, runtimeToolCode),
      usageGuidance: resolveRuntimeToolUsageGuidance(tool, runtimeToolCode),
      kind,
      executionMode: resolveToolExecutionMode(runtimeToolCode),
      usageRule: enabled && kind !== "internal" ? "allowed" : "forbidden",
      enabled,
      visibleToModel: kind !== "internal" && enabled,
      visibleInPlanEditor: tool.visibleInPlanEditor,
      dailyCallLimit: dailyLimitByCode.get(tool.code) ?? null,
      perTurnCap: perTurnCapByCode.get(tool.code) ?? null
    };
  });
  const canonicalToolCodes = new Set(
    catalogPolicies
      .filter((tool) => tool.toolCode !== "quota_status" || tool.visibleToModel)
      .map((tool) => tool.toolCode)
  );
  const syntheticPolicies = (
    Object.keys(SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS) as Array<
      keyof typeof SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS
    >
  )
    .filter((toolCode) => !canonicalToolCodes.has(toolCode))
    .map((toolCode) =>
      buildSyntheticSystemToolPolicy(
        toolCode,
        params.syntheticToolOverrides ?? {},
        params.knowledgeAccessEnabled
      )
    );
  return dedupeRuntimeToolPolicies([...catalogPolicies, ...syntheticPolicies]);
}

export function buildRuntimeToolPoliciesMarkdown(toolPolicies: RuntimeToolPolicy[]): string {
  const visibleTools = toolPolicies.filter((tool) => tool.enabled && tool.visibleToModel);
  const orderedTools = [...visibleTools].sort((left, right) => {
    const leftIndex = PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.indexOf(
      left.toolCode as (typeof PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER)[number]
    );
    const rightIndex = PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.indexOf(
      right.toolCode as (typeof PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER)[number]
    );
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
      );
    }
    return left.toolCode.localeCompare(right.toolCode);
  });
  const blocks: string[] = [];
  for (const tool of orderedTools) {
    const block = buildPromptToolMarkdownEntry(tool.toolCode, tool.description, tool.usageGuidance);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks.join("\n\n").trimEnd();
}
