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

export function isToolContractDescribeCall(args: Record<string, unknown> | undefined): boolean {
  return args?.action === "describe";
}

export function isToolLevelContractDescribeCall(
  toolCode: string,
  args: Record<string, unknown> | undefined
): boolean {
  if (!isToolContractDescribeCall(args)) {
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

/**
 * ADR-135 — once a catalog-tier tool passes the contract guard in a turn, keep
 * full wire projection for every later tool-loop step in that same user turn
 * (provider errors and invalid_arguments must not revert to catalog stub).
 */
export function markCatalogToolWireExpandedForTurn(
  bundle: AssistantRuntimeBundle,
  toolCode: string,
  wireExpandedCatalogToolCodes: Set<string>
): boolean {
  if (!isCatalogTierToolPolicy(bundle, toolCode)) {
    return false;
  }
  const before = wireExpandedCatalogToolCodes.size;
  wireExpandedCatalogToolCodes.add(toolCode);
  return wireExpandedCatalogToolCodes.size > before;
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
  wireExpandedCatalogToolCodes: ReadonlySet<string>;
}): boolean {
  if (!isCatalogTierToolPolicy(params.bundle, params.toolCode)) {
    return false;
  }
  if (params.wireExpandedCatalogToolCodes.has(params.toolCode)) {
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
