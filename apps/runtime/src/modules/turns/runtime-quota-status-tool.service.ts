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
    requestId: string;
    currentUserText: string;
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
      if (request.action === "create_checkout") {
        if (!request.confirmed) {
          return {
            payload: this.createSkippedPayload(
              null,
              "confirmation_required",
              "Create the checkout link only when the user wants it opened now."
            ),
            isError: true
          };
        }
        const outcome = await this.persaiInternalApiClientService.createQuotaCheckout({
          assistantId: params.bundle.metadata.assistantId,
          requestId: params.requestId,
          targetPlanCode: request.targetPlanCode,
          paymentMethodClass: request.paymentMethodClass,
          confirmed: request.confirmed
        });
        const quotaStatus = await this.persaiInternalApiClientService.readQuotaStatus({
          assistantId: params.bundle.metadata.assistantId,
          toolCode: null
        });
        return {
          payload: {
            toolCode: QUOTA_STATUS_TOOL_CODE,
            executionMode: "inline",
            requestedToolCode: null,
            planCode: quotaStatus.planCode,
            currentPlan: quotaStatus.currentPlan,
            visiblePlans: quotaStatus.visiblePlans,
            tools: quotaStatus.tools,
            buckets: quotaStatus.buckets,
            monthlyMediaQuotas: quotaStatus.monthlyMediaQuotas,
            checkout: outcome,
            action: "checkout_created",
            reason: null,
            warning: null
          },
          isError: false
        };
      }
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
          currentPlan: outcome.currentPlan,
          visiblePlans: outcome.visiblePlans,
          tools: outcome.tools,
          buckets: outcome.buckets,
          monthlyMediaQuotas: outcome.monthlyMediaQuotas,
          checkout: null,
          action: "reported",
          reason: null,
          warning: null
        },
        isError: false
      };
    } catch (error) {
      const warning = error instanceof Error ? error.message : "Quota status lookup failed.";
      const reason =
        request.action === "create_checkout" && warning.toLowerCase().includes("confirmed=true")
          ? "confirmation_required"
          : "quota_status_failed";
      return {
        payload: this.createSkippedPayload(
          request.action === "report" ? request.toolCode : null,
          reason,
          warning
        ),
        isError: true
      };
    }
  }

  private readArguments(args: Record<string, unknown>):
    | {
        action: "report";
        toolCode: string | null;
      }
    | {
        action: "create_checkout";
        targetPlanCode: string;
        paymentMethodClass: "card" | "sbp_qr";
        confirmed: boolean;
      }
    | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) =>
        key !== "action" &&
        key !== "toolCode" &&
        key !== "targetPlanCode" &&
        key !== "paymentMethodClass" &&
        key !== "confirmed"
    );
    if (unknownKeys.length > 0) {
      return new Error("Quota status arguments are invalid.");
    }

    const action =
      args.action === undefined || args.action === null
        ? "report"
        : typeof args.action === "string"
          ? args.action.trim()
          : null;
    if (action !== "report" && action !== "create_checkout") {
      return new Error("Quota status arguments are invalid.");
    }

    if (action === "create_checkout") {
      if (typeof args.targetPlanCode !== "string" || args.targetPlanCode.trim().length === 0) {
        return new Error("Quota status arguments are invalid.");
      }
      if (args.paymentMethodClass !== "card" && args.paymentMethodClass !== "sbp_qr") {
        return new Error("Quota status arguments are invalid.");
      }
      return {
        action,
        targetPlanCode: args.targetPlanCode.trim().toLowerCase(),
        paymentMethodClass: args.paymentMethodClass,
        confirmed: args.confirmed === true
      };
    }

    if (args.toolCode === undefined || args.toolCode === null) {
      return { action, toolCode: null };
    }

    if (typeof args.toolCode !== "string" || args.toolCode.trim().length === 0) {
      return new Error("Quota status arguments are invalid.");
    }

    return {
      action,
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
      currentPlan: {
        code: null,
        displayName: null
      },
      visiblePlans: [],
      tools: [],
      buckets: [],
      monthlyMediaQuotas: null,
      checkout: null,
      action: "skipped",
      reason,
      warning
    };
  }
}
