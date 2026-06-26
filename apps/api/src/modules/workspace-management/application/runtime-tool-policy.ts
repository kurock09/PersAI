import type { AssistantRuntimeBundleToolCredentialRef } from "@persai/runtime-bundle";
import {
  resolveEffectiveMaxFilePreviewBytes,
  resolveEffectiveMaxFilePreviewEdgePx
} from "@persai/config";
import {
  PERSAI_RUNTIME_BROWSER_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import type { EffectiveToolAvailabilityState } from "./effective-tool-availability.types";
import {
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
  maxFilePreviewBytes: number | null;
  maxFilePreviewEdgePx: number | null;
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
  document: "worker",
  tts: "worker",
  memory_search: "inline",
  memory_get: "inline",
  scheduled_action: "worker",
  background_task: "worker",
  files: "inline",
  grep: "inline",
  glob: "inline",
  exec: "sandbox",
  shell: "sandbox",
  persai_workspace_attach: "inline",
  persai_tool_quota_status: "inline",
  cron: "worker",
  skill: "inline",
  todo_write: "inline"
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
    return "Path-driven file operations on the single flat `/workspace/` namespace. Read and write any file directly under `/workspace/<path>`; user uploads land at `/workspace/<filename>` and stay there. Use `/tmp/` for ephemeral scratch that the user should never see.";
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
    return `Files in this workspace live under \`/workspace/\`. Read any file with \`files.read /workspace/<path>\`. Write to any path under \`/workspace/\` (creates or overwrites). When the user uploads a file, it appears at \`/workspace/<filename>\`. To edit it, write to the same path. To create a new file, pick a new name. Use \`/tmp/\` for ephemeral scratch that the user should not see.
WHEN TO USE: Any file-system work in the assistant's pod workspace — list a directory, read or preview a file's content, write a new or updated file, delete a path, or attach an existing file to the current chat for the user.
WHEN NOT TO USE: Real process execution (use exec or shell). Content search in workspace (use grep). Filename discovery (use glob). Producing a structured document (use document).
SIX ACTIONS: list (directory listing), read (full content), preview (bounded content, text-extraction for binary), write (create/overwrite), delete (remove path), attach (publish a /workspace/ file to the current chat so the user sees it as a chat attachment).
EXAMPLES:
- files({action:"list", path:"/workspace/"}) — see every file in the workspace.
- files({action:"read", path:"/workspace/notes.md"}) — read a workspace file.
- files({action:"write", path:"/workspace/plan.md", content:"..."}) — create or overwrite.
- files({action:"attach", path:"/workspace/report.csv"}) — deliver a /workspace/ file to the user.
GOTCHAS:
- Supply a pod-absolute path for every action. For list use the directory path; for read/preview/write/delete/attach use the file path.
- attach only accepts /workspace/... paths. Anything outside /workspace/ (including /tmp/) is rejected.
- Keep exec and shell for actual process execution only. Use grep for content search and glob for filename discovery.`;
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
  const resolved = providerId ?? "openai";
  return PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS.includes(
    resolved as (typeof PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS)[number]
  );
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

function supportsCurrentNativeDocumentProvider(
  credential: AssistantRuntimeBundleToolCredentialRef | null
): boolean {
  if (!credential) {
    return false;
  }
  const candidates = [credential, ...(credential.fallbacks ?? [])];
  return candidates.some(
    (entry) =>
      entry.configured === true && (entry.providerId === "sandbox" || entry.providerId === "gamma")
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
    runtimeToolCode === "scheduled_action" ||
    runtimeToolCode === "background_task" ||
    runtimeToolCode === "skill" ||
    runtimeToolCode === "todo_write"
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
  if (runtimeToolCode === "document") {
    return supportsCurrentNativeDocumentProvider(
      hasConfiguredCredential(params.toolCredentialRefs, "document")
    );
  }
  if (
    runtimeToolCode === "files" ||
    runtimeToolCode === "exec" ||
    runtimeToolCode === "shell" ||
    runtimeToolCode === "grep" ||
    runtimeToolCode === "glob"
  ) {
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
  const maxFilePreviewBytesByCode = new Map(
    params.planToolQuotaPolicy.map((tool) => [tool.toolCode, tool.maxFilePreviewBytes] as const)
  );
  const maxFilePreviewEdgePxByCode = new Map(
    params.planToolQuotaPolicy.map((tool) => [tool.toolCode, tool.maxFilePreviewEdgePx] as const)
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
      perTurnCap: perTurnCapByCode.get(tool.code) ?? null,
      ...(runtimeToolCode === "files"
        ? {
            maxFilePreviewBytes: resolveEffectiveMaxFilePreviewBytes(
              maxFilePreviewBytesByCode.get(tool.code) ?? null
            ),
            maxFilePreviewEdgePx: resolveEffectiveMaxFilePreviewEdgePx(
              maxFilePreviewEdgePxByCode.get(tool.code) ?? null
            )
          }
        : {})
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
