import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeConversationAddress,
  RuntimeQuotaStatusToolResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import {
  executeRuntimeToolContractDescribe,
  isToolContractDescribeCall
} from "./runtime-tool-contract-describe";

const QUOTA_STATUS_TOOL_CODE = "quota_status" as const;
const DEFAULT_PRICING_PAGE_PATH = "/app/pricing" as const;

function resolvePricingPageHint(): {
  path: string;
  url: string;
} {
  return {
    path: DEFAULT_PRICING_PAGE_PATH,
    url: "https://persai.dev/app/pricing"
  };
}

function resolvePackagesPurchaseHint(
  packageOffers: Awaited<
    ReturnType<PersaiInternalApiClientService["readQuotaStatus"]>
  >["packageOffers"]
): {
  path: string;
  url: string;
  availableTools: string[];
  paymentMethodClasses: Array<"card" | "sbp_qr">;
} | null {
  if (packageOffers.packagesPurchase === null) {
    return null;
  }
  const availableTools = packageOffers.tools
    .filter((tool) => tool.offerableNow)
    .map((tool) => tool.toolCode);
  if (availableTools.length === 0) {
    return null;
  }
  return {
    path: packageOffers.packagesPurchase.path,
    url: packageOffers.packagesPurchase.url ?? packageOffers.packagesPurchase.path,
    availableTools,
    paymentMethodClasses: [...packageOffers.packagesPurchase.paymentMethodClasses]
  };
}

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
    conversation: RuntimeConversationAddress;
    requestId: string;
    currentUserText: string;
  }): Promise<RuntimeQuotaStatusToolExecutionResult> {
    if (isToolContractDescribeCall(params.toolCall.arguments)) {
      return executeRuntimeToolContractDescribe({
        bundle: params.bundle,
        toolCode: QUOTA_STATUS_TOOL_CODE
      }) as unknown as RuntimeQuotaStatusToolExecutionResult;
    }

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
          toolCode: null,
          channel: params.conversation.channel,
          externalThreadKey: params.conversation.externalThreadKey
        });
        return {
          payload: {
            toolCode: QUOTA_STATUS_TOOL_CODE,
            executionMode: "inline",
            requestedToolCode: null,
            planCode: quotaStatus.planCode,
            currentPlan: quotaStatus.currentPlan,
            visiblePlans: quotaStatus.visiblePlans,
            advisories: quotaStatus.advisories,
            advisoryCandidates: quotaStatus.advisoryCandidates,
            tools: quotaStatus.tools,
            buckets: quotaStatus.buckets,
            monthlyToolQuotas: quotaStatus.monthlyToolQuotas,
            packagesAvailableByTool: quotaStatus.packagesAvailableByTool,
            packageOffers: quotaStatus.packageOffers,
            packagesPurchase: resolvePackagesPurchaseHint(quotaStatus.packageOffers),
            pricingPage: resolvePricingPageHint(),
            checkout: outcome.checkout,
            subscriptionUpdate: outcome.subscriptionUpdate,
            action: outcome.action,
            reason: null,
            warning: null
          },
          isError: false
        };
      }
      const outcome = await this.persaiInternalApiClientService.readQuotaStatus({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: request.toolCode,
        channel: params.conversation.channel,
        externalThreadKey: params.conversation.externalThreadKey
      });
      return {
        payload: {
          toolCode: QUOTA_STATUS_TOOL_CODE,
          executionMode: "inline",
          requestedToolCode: request.toolCode,
          planCode: outcome.planCode,
          currentPlan: outcome.currentPlan,
          visiblePlans: outcome.visiblePlans,
          advisories: outcome.advisories,
          advisoryCandidates: outcome.advisoryCandidates,
          tools: outcome.tools,
          buckets: outcome.buckets,
          monthlyToolQuotas: outcome.monthlyToolQuotas,
          packagesAvailableByTool: outcome.packagesAvailableByTool,
          packageOffers: outcome.packageOffers,
          packagesPurchase: resolvePackagesPurchaseHint(outcome.packageOffers),
          pricingPage: resolvePricingPageHint(),
          checkout: null,
          subscriptionUpdate: null,
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
      advisories: {
        warningThresholdPercent: 90,
        isFreePlan: false,
        higherPaidPlanAvailable: false,
        highestVisiblePaidPlanCode: null,
        tokenBudget: {
          periodStartedAt: null,
          periodEndsAt: null,
          periodSource: null,
          paidLightModeEligible: false,
          paidLightModeActive: false,
          paidLightModeReason: null
        }
      },
      advisoryCandidates: [],
      tools: [],
      buckets: [],
      monthlyToolQuotas: null,
      packagesAvailableByTool: {},
      packageOffers: {
        packagesPurchase: null,
        tools: []
      },
      packagesPurchase: null,
      pricingPage: resolvePricingPageHint(),
      checkout: null,
      subscriptionUpdate: null,
      action: "skipped",
      reason,
      warning
    };
  }
}
