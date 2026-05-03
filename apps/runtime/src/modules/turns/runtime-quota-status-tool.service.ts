import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeQuotaStatusToolResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

const QUOTA_STATUS_TOOL_CODE = "quota_status" as const;

export interface RuntimeQuotaStatusToolExecutionResult {
  payload: RuntimeQuotaStatusToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeQuotaStatusToolService {
  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
  }): Promise<RuntimeQuotaStatusToolExecutionResult> {
    const request = this.readArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: this.createSkippedPayload(
          null,
          "invalid_arguments",
          "Quota status arguments are invalid."
        ),
        isError: true
      };
    }

    try {
      const outcome = await this.persaiInternalApiClientService.readQuotaStatus({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: request.toolCode
      });
      return {
        payload: {
          toolCode: QUOTA_STATUS_TOOL_CODE,
          executionMode: "inline",
          requestedToolCode: request.toolCode,
          planCode: outcome.planCode,
          tools: outcome.tools,
          buckets: outcome.buckets,
          monthlyMediaQuotas: outcome.monthlyMediaQuotas,
          action: "reported",
          reason: null,
          warning: null
        },
        isError: false
      };
    } catch (error) {
      return {
        payload: this.createSkippedPayload(
          request.toolCode,
          "quota_status_failed",
          error instanceof Error ? error.message : "Quota status lookup failed."
        ),
        isError: true
      };
    }
  }

  private readArguments(args: Record<string, unknown>): { toolCode: string | null } | Error {
    const unknownKeys = Object.keys(args).filter((key) => key !== "toolCode");
    if (unknownKeys.length > 0) {
      return new Error("Quota status arguments are invalid.");
    }

    if (args.toolCode === undefined || args.toolCode === null) {
      return { toolCode: null };
    }

    if (typeof args.toolCode !== "string" || args.toolCode.trim().length === 0) {
      return new Error("Quota status arguments are invalid.");
    }

    return {
      toolCode: args.toolCode.trim()
    };
  }

  private createSkippedPayload(
    requestedToolCode: string | null,
    reason: string,
    warning: string | null
  ): RuntimeQuotaStatusToolResult {
    return {
      toolCode: QUOTA_STATUS_TOOL_CODE,
      executionMode: "inline",
      requestedToolCode,
      planCode: null,
      tools: [],
      buckets: [],
      monthlyMediaQuotas: null,
      action: "skipped",
      reason,
      warning
    };
  }
}
