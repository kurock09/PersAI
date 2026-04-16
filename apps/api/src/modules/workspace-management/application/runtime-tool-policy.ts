import type { RuntimeToolPolicy } from "@persai/runtime-contract";
import type { EffectiveToolAvailabilityState } from "./effective-tool-availability.types";

type ToolQuotaPolicyEntry = {
  toolCode: string;
  dailyCallLimit: number | null;
  activationStatus: string;
};

const TOOL_EXECUTION_MODE_BY_CODE: Record<string, RuntimeToolPolicy["executionMode"]> = {
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
  persai_workspace_attach: "inline",
  persai_tool_quota_status: "inline",
  quota_status: "inline",
  cron: "worker"
};

const RUNTIME_TOOL_CODE_BY_INVENTORY_CODE: Record<string, string> = {
  persai_tool_quota_status: "quota_status"
};

const MIGRATION_ONLY_MODEL_HIDDEN_TOOLS = new Set(["persai_workspace_attach"]);

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
  if (runtimeToolCode === "quota_status") {
    return "Quota Status";
  }
  return tool.displayName;
}

function resolveRuntimeToolDescription(
  tool: EffectiveToolAvailabilityState["tools"][number],
  runtimeToolCode: string
): string | null {
  if (runtimeToolCode === "quota_status") {
    return (
      tool.modelDescription ??
      "Read live PersAI quota status for the current assistant, including daily tool counters and the main token, chat, media, and knowledge buckets."
    );
  }
  if (MIGRATION_ONLY_MODEL_HIDDEN_TOOLS.has(tool.code)) {
    return "Migration-only inventory entry. Step 15 does not expose raw path-based workspace attachment to the model.";
  }
  return tool.modelDescription ?? tool.description;
}

function resolveRuntimeToolUsageGuidance(
  tool: EffectiveToolAvailabilityState["tools"][number],
  runtimeToolCode: string
): string | null {
  if (runtimeToolCode === "quota_status") {
    return (
      tool.modelUsageGuidance ??
      "Use this when the user asks about remaining usage, current quota pressure, or whether a quota-governed capability is available right now."
    );
  }
  if (MIGRATION_ONLY_MODEL_HIDDEN_TOOLS.has(tool.code)) {
    return "Keep this helper off the normal model-visible path.";
  }
  return tool.modelUsageGuidance;
}

export function resolveRuntimeToolPolicies(params: {
  tools: EffectiveToolAvailabilityState["tools"];
  planToolQuotaPolicy: ToolQuotaPolicyEntry[];
}): RuntimeToolPolicy[] {
  const dailyLimitByCode = new Map(
    params.planToolQuotaPolicy.map((tool) => [tool.toolCode, tool.dailyCallLimit] as const)
  );

  return params.tools.map((tool) => {
    const kind = resolveToolKind(tool.policyClass);
    const runtimeToolCode = resolveRuntimeToolCode(tool.code);
    const enabled =
      tool.effectiveActivation === "active" && !MIGRATION_ONLY_MODEL_HIDDEN_TOOLS.has(tool.code);
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
      dailyCallLimit: dailyLimitByCode.get(tool.code) ?? null
    };
  });
}

function buildToolLine(tool: RuntimeToolPolicy, details: string): string {
  const limit =
    tool.dailyCallLimit !== null ? ` (daily limit: ${String(tool.dailyCallLimit)})` : "";
  const description = tool.description ? ` — ${tool.description}` : "";
  const guidance = tool.usageGuidance ? ` Guidance: ${tool.usageGuidance}` : "";
  return `- **${tool.toolCode}** — ${details}${limit}${description}${guidance}`;
}

export function buildRuntimeToolPoliciesMarkdown(toolPolicies: RuntimeToolPolicy[]): string {
  const lines: string[] = [];
  const activePlanTools = toolPolicies.filter((tool) => tool.kind === "plan" && tool.enabled);
  const activeSystemTools = toolPolicies.filter(
    (tool) => tool.kind === "system" && tool.enabled && tool.visibleToModel
  );
  const disabledVisibleTools = toolPolicies.filter((tool) => tool.kind === "plan" && !tool.enabled);

  if (activePlanTools.length > 0) {
    lines.push("## Active Plan Tools");
    lines.push("");
    for (const tool of activePlanTools) {
      lines.push(buildToolLine(tool, `${tool.executionMode}, ${tool.usageRule}`));
    }
    lines.push("");
  }

  if (activeSystemTools.length > 0) {
    lines.push("## Active System Tools");
    lines.push("");
    for (const tool of activeSystemTools) {
      lines.push(buildToolLine(tool, `${tool.executionMode}, ${tool.usageRule}`));
    }
    lines.push("");
  }

  if (disabledVisibleTools.length > 0) {
    lines.push("## Disabled Tools");
    lines.push("");
    for (const tool of disabledVisibleTools) {
      lines.push(`- ~~${tool.toolCode}~~ — ${tool.executionMode}, forbidden on current plan`);
    }
    lines.push("");
  }

  if (
    activePlanTools.length === 0 &&
    activeSystemTools.length === 0 &&
    disabledVisibleTools.length === 0
  ) {
    lines.push("No tools configured yet.");
    lines.push("");
  }

  lines.push("## Usage Rules");
  lines.push("");
  lines.push(
    "- `allowed` means the runtime may expose the tool to the model in the current bundle."
  );
  lines.push(
    "- `forbidden` means the tool must stay out of the model-visible tool list for the current bundle."
  );
  lines.push(
    "- Hidden internal tools stay outside the model-visible tool list even when platform internals still use them."
  );
  lines.push("- Daily caps above are plan limits only, not remaining usage for today.");
  lines.push(
    "- Do not infer exhaustion from earlier messages; plans and counters change. When the user asks about remaining quota, storage pressure, or whether a quota-governed tool is currently available, call the `quota_status` tool first."
  );
  lines.push("");

  return lines.join("\n").trimEnd();
}
