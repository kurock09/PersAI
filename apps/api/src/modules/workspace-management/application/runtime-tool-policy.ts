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
  tts: "worker",
  memory_search: "inline",
  memory_get: "inline",
  scheduled_action: "worker",
  persai_workspace_attach: "inline",
  persai_tool_quota_status: "inline",
  cron: "worker"
};

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

export function resolveRuntimeToolPolicies(params: {
  tools: EffectiveToolAvailabilityState["tools"];
  planToolQuotaPolicy: ToolQuotaPolicyEntry[];
}): RuntimeToolPolicy[] {
  const dailyLimitByCode = new Map(
    params.planToolQuotaPolicy.map((tool) => [tool.toolCode, tool.dailyCallLimit] as const)
  );

  return params.tools.map((tool) => {
    const kind = resolveToolKind(tool.policyClass);
    const enabled = tool.effectiveActivation === "active";
    return {
      toolCode: tool.code,
      displayName: tool.displayName,
      description: tool.description,
      kind,
      executionMode: resolveToolExecutionMode(tool.code),
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
  return `- **${tool.toolCode}** — ${details}${limit}`;
}

export function buildRuntimeToolPoliciesMarkdown(toolPolicies: RuntimeToolPolicy[]): string {
  const lines: string[] = [];
  const activePlanTools = toolPolicies.filter((tool) => tool.kind === "plan" && tool.enabled);
  const activeSystemTools = toolPolicies.filter((tool) => tool.kind === "system" && tool.enabled);
  const disabledVisibleTools = toolPolicies.filter(
    (tool) => tool.kind !== "internal" && !tool.enabled
  );

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
    "- Do not infer exhaustion from earlier messages; plans and counters change. When the user asks about remaining quota, call the `persai_tool_quota_status` tool first."
  );
  lines.push(
    "- To attach an existing workspace file to the chat (image, document, audio, video) without loading file bytes into context, call `persai_workspace_attach` with a path relative to the workspace root."
  );
  lines.push("");

  return lines.join("\n").trimEnd();
}
