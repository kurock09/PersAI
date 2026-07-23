import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeToolContractDescribeResult } from "@persai/runtime-contract";
import {
  buildFullNativeToolDefinition,
  CATALOG_READ_ONLY_TOOL_ACTIONS,
  resolveModelExposure,
  type NativeToolProjectionOptions
} from "./native-tool-projection";

export type RuntimeToolContractNotLoadedPayload = {
  action: "skipped";
  reason: "tool_contract_not_loaded";
  toolCode: string;
  guidance: string;
};

export type RuntimeToolContractDescribeExecutionResult = {
  payload: RuntimeToolContractDescribeResult;
  artifacts: [];
  isError: false;
};

export type RuntimeToolContractDescribeSkippedResult = {
  payload: {
    action: "skipped";
    reason: "tool_not_projected";
    toolCode: string;
  };
  artifacts: [];
  isError: false;
};

/** Companion keys that remain valid on a pure/skill-scoped describe call. */
function describeCompanionKeys(toolCode: string | null): ReadonlySet<string> {
  if (toolCode === "skill") {
    return new Set(["action", "skillId", "scenarioKey"]);
  }
  return new Set(["action"]);
}

function isMeaningfulDescribeCompanionValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return false;
  }
  return true;
}

/**
 * True when `action:"describe"` is mixed with real execution fields
 * (prompt / seriesItems / url / …). Models frequently re-attach describe after
 * loading the contract; treat that as a mistaken parameter, not a contract load.
 */
export function hasContaminatedDescribeAction(
  args: Record<string, unknown> | undefined,
  toolCode: string | null = null
): boolean {
  if (args?.action !== "describe") {
    return false;
  }
  const allowed = describeCompanionKeys(toolCode);
  for (const [key, value] of Object.entries(args)) {
    if (allowed.has(key)) {
      continue;
    }
    if (!isMeaningfulDescribeCompanionValue(value)) {
      continue;
    }
    return true;
  }
  return false;
}

/** Drop mistaken `action:"describe"` when real execution args are also present. */
export function stripMistakenDescribeAction(
  args: Record<string, unknown> | undefined,
  toolCode: string | null = null
): Record<string, unknown> | undefined {
  if (args === undefined || !hasContaminatedDescribeAction(args, toolCode)) {
    return args;
  }
  const next: Record<string, unknown> = { ...args };
  delete next.action;
  return next;
}

export function isToolContractDescribeCall(
  args: Record<string, unknown> | undefined,
  toolCode: string | null = null
): boolean {
  if (args?.action !== "describe") {
    return false;
  }
  // Contaminated describe+payload must not return the contract again.
  return !hasContaminatedDescribeAction(args, toolCode);
}

export function isToolLevelContractDescribeCall(
  toolCode: string,
  args: Record<string, unknown> | undefined
): boolean {
  if (!isToolContractDescribeCall(args, toolCode)) {
    return false;
  }
  if (toolCode === "skill" && args?.skillId !== undefined) {
    return false;
  }
  return true;
}

export function isCatalogTierToolPolicy(bundle: AssistantRuntimeBundle, toolCode: string): boolean {
  const policy =
    bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
  return policy !== null && resolveModelExposure(policy) === "catalog";
}

/** Records a successfully described catalog contract for this turn only. */
export function markCatalogToolContractLoadedForTurn(
  bundle: AssistantRuntimeBundle,
  toolCode: string,
  loadedCatalogToolCodes: Set<string>
): boolean {
  if (!isCatalogTierToolPolicy(bundle, toolCode)) {
    return false;
  }
  const before = loadedCatalogToolCodes.size;
  loadedCatalogToolCodes.add(toolCode);
  return loadedCatalogToolCodes.size > before;
}

export function isCatalogReadOnlyToolCall(
  toolCode: string,
  args: Record<string, unknown> | undefined
): boolean {
  if (isToolLevelContractDescribeCall(toolCode, args)) {
    return true;
  }
  const action = args?.action;
  if (typeof action !== "string") {
    return false;
  }
  const readOnlyActions = CATALOG_READ_ONLY_TOOL_ACTIONS[toolCode] ?? [];
  return readOnlyActions.includes(action);
}

export function createToolContractNotLoadedPayload(
  toolCode: string
): RuntimeToolContractNotLoadedPayload {
  return {
    action: "skipped",
    reason: "tool_contract_not_loaded",
    toolCode,
    guidance: `Call ${toolCode}({action:"describe"}) before the first real execution call.`
  };
}

export function shouldGuardCatalogToolExecution(params: {
  bundle: AssistantRuntimeBundle;
  toolCode: string;
  arguments: Record<string, unknown> | undefined;
  loadedCatalogToolCodes: ReadonlySet<string>;
}): boolean {
  if (!isCatalogTierToolPolicy(params.bundle, params.toolCode)) {
    return false;
  }
  if (params.loadedCatalogToolCodes.has(params.toolCode)) {
    return false;
  }
  return !isCatalogReadOnlyToolCall(params.toolCode, params.arguments);
}

export function executeRuntimeToolContractDescribe(params: {
  bundle: AssistantRuntimeBundle;
  toolCode: string;
  options?: NativeToolProjectionOptions;
}): RuntimeToolContractDescribeExecutionResult | RuntimeToolContractDescribeSkippedResult {
  const definition = buildFullNativeToolDefinition(params.bundle, params.toolCode, params.options);
  if (definition === null) {
    return {
      payload: {
        action: "skipped",
        reason: "tool_not_projected",
        toolCode: params.toolCode
      },
      artifacts: [],
      isError: false
    };
  }
  return {
    payload: {
      action: "described_contract",
      toolCode: params.toolCode,
      description: definition.description,
      inputSchema: definition.inputSchema
    },
    artifacts: [],
    isError: false
  };
}
