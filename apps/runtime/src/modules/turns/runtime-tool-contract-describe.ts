import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeToolContractDescribeResult } from "@persai/runtime-contract";
import {
  buildFullNativeToolDefinition,
  type NativeToolProjectionOptions
} from "./native-tool-projection";

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
