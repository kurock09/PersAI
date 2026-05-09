import { Injectable } from "@nestjs/common";
import { ReadInternalRuntimeQuotaStatusService } from "./read-internal-runtime-quota-status.service";

export type QuotaGroundedLimitCopy = {
  message: string;
  guidance: string | null;
};

@Injectable()
export class QuotaGroundedLimitCopyService {
  constructor(
    private readonly readInternalRuntimeQuotaStatusService: ReadInternalRuntimeQuotaStatusService
  ) {}

  async build(input: {
    assistantId: string;
    code:
      | "monthly_media_quota_exceeded"
      | "monthly_media_quota_rejected"
      | "tool_daily_limit_reached"
      | "media_storage_quota_exceeded"
      | "knowledge_storage_quota_exceeded"
      | "workspace_storage_full";
    details?: Record<string, unknown>;
  }): Promise<QuotaGroundedLimitCopy | null> {
    const quotaStatus = await this.readInternalRuntimeQuotaStatusService.execute({
      assistantId: input.assistantId
    });
    switch (input.code) {
      case "monthly_media_quota_exceeded":
      case "monthly_media_quota_rejected":
        return this.buildMonthlyMediaCopy(quotaStatus, input.details, input.code);
      case "tool_daily_limit_reached":
        return this.buildToolDailyCopy(quotaStatus, input.details);
      case "media_storage_quota_exceeded":
        return this.buildStorageCopy(quotaStatus, "media_storage_bytes", "Media storage");
      case "knowledge_storage_quota_exceeded":
        return this.buildStorageCopy(quotaStatus, "knowledge_storage_bytes", "Knowledge storage");
      case "workspace_storage_full":
        return this.buildStorageCopy(quotaStatus, "workspace_storage_bytes", "Workspace storage");
      default:
        return null;
    }
  }

  private buildMonthlyMediaCopy(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    details: Record<string, unknown> | undefined,
    code: "monthly_media_quota_exceeded" | "monthly_media_quota_rejected"
  ): QuotaGroundedLimitCopy | null {
    const toolCode = typeof details?.toolCode === "string" ? details.toolCode : null;
    if (toolCode === null) {
      return null;
    }
    const tool =
      quotaStatus.monthlyMediaQuotas.tools.find((row) => row.toolCode === toolCode) ?? null;
    const displayName = tool?.displayName ?? toolCode.replace(/_/g, " ");
    if (code === "monthly_media_quota_rejected") {
      return {
        message: `${displayName} is not active on the current plan.`,
        guidance: this.buildInactiveToolGuidance(quotaStatus)
      };
    }
    const used =
      typeof details?.currentUsedUnits === "number"
        ? details.currentUsedUnits
        : typeof tool?.usedUnits === "number"
          ? tool.usedUnits
          : null;
    const effectiveLimit =
      typeof details?.limitUnits === "number"
        ? details.limitUnits
        : typeof tool?.effectiveLimitUnits === "number"
          ? tool.effectiveLimitUnits
          : typeof tool?.limitUnits === "number"
            ? tool.limitUnits
            : null;
    const resetAt =
      typeof details?.periodEndsAt === "string"
        ? details.periodEndsAt
        : quotaStatus.monthlyMediaQuotas.periodEndsAt;
    return {
      message: [
        `${displayName} is exhausted for the current monthly period`,
        used !== null && effectiveLimit !== null
          ? `(${String(used)}/${String(effectiveLimit)} used)`
          : null,
        resetAt ? `It resets ${this.formatResetAt(resetAt)}.` : null
      ]
        .filter((part): part is string => part !== null)
        .join(". ")
        .replace(/\.\sIt resets/, ". It resets"),
      guidance: this.buildMediaUpgradeGuidance(
        quotaStatus,
        toolCode,
        "Use a request that does not need media generation."
      )
    };
  }

  private buildToolDailyCopy(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    details: Record<string, unknown> | undefined
  ): QuotaGroundedLimitCopy | null {
    const toolCode = typeof details?.toolCode === "string" ? details.toolCode : null;
    if (toolCode === null) {
      return null;
    }
    const tool = quotaStatus.tools.find((row) => row.toolCode === toolCode) ?? null;
    const displayName = tool?.displayName ?? toolCode.replace(/_/g, " ");
    const isInactiveOnPlan = tool?.activationStatus !== "active";
    if (isInactiveOnPlan) {
      return {
        message: `${displayName} is not active on the current plan.`,
        guidance: this.buildInactiveToolGuidance(quotaStatus)
      };
    }
    const used =
      typeof details?.currentCount === "number"
        ? details.currentCount
        : typeof tool?.currentCount === "number"
          ? tool.currentCount
          : null;
    const limit =
      typeof details?.limit === "number"
        ? details.limit
        : typeof tool?.dailyCallLimit === "number"
          ? tool.dailyCallLimit
          : null;
    const resetAt =
      typeof tool?.periodEndsAt === "string" && tool.periodEndsAt.length > 0
        ? tool.periodEndsAt
        : null;
    return {
      message: [
        `${displayName} is exhausted for the current daily limit`,
        used !== null && limit !== null ? `(${String(used)}/${String(limit)} used)` : null,
        resetAt ? `It resets ${this.formatResetAt(resetAt)}.` : null
      ]
        .filter((part): part is string => part !== null)
        .join(". ")
        .replace(/\.\sIt resets/, ". It resets"),
      guidance: this.buildUpgradeAwareGuidance(
        quotaStatus,
        "Try a request that does not need this tool until the daily limit resets."
      )
    };
  }

  private buildStorageCopy(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    bucketCode: "media_storage_bytes" | "knowledge_storage_bytes" | "workspace_storage_bytes",
    fallbackDisplayName: string
  ): QuotaGroundedLimitCopy | null {
    const bucket = quotaStatus.buckets.find((row) => row.bucketCode === bucketCode) ?? null;
    const displayName = bucket?.displayName ?? fallbackDisplayName;
    const used = typeof bucket?.used === "number" ? this.formatMegabytes(bucket.used) : null;
    const limit = typeof bucket?.limit === "number" ? this.formatMegabytes(bucket.limit) : null;
    return {
      message:
        used !== null && limit !== null
          ? `${displayName} is full (${used} MB used out of ${limit} MB).`
          : `${displayName} is full.`,
      guidance: "Delete old files or chats to free space, then try again."
    };
  }

  private buildInactiveToolGuidance(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>
  ): string {
    return quotaStatus.advisories.higherPaidPlanAvailable
      ? "Upgrade to a higher plan or switch to a request that does not need this capability."
      : "Switch to a request that does not need this capability.";
  }

  private buildMediaUpgradeGuidance(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    toolCode: string,
    baseGuidance: string
  ): string {
    const packageAvailable = quotaStatus.packagesAvailableByTool[toolCode] === true;
    const planUpgradeAvailable = quotaStatus.advisories.higherPaidPlanAvailable;
    if (packageAvailable && planUpgradeAvailable) {
      return `${baseGuidance} You can also purchase a media add-on package for more ${toolCode.replace(/_/g, " ")} capacity this period, or upgrade to a higher plan for a larger monthly limit.`;
    }
    if (packageAvailable) {
      return `${baseGuidance} You can purchase a media add-on package to get more ${toolCode.replace(/_/g, " ")} capacity for the current period.`;
    }
    if (planUpgradeAvailable) {
      return `${baseGuidance} You can also upgrade to a higher plan.`;
    }
    return baseGuidance;
  }

  private buildUpgradeAwareGuidance(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    baseGuidance: string
  ): string {
    return quotaStatus.advisories.higherPaidPlanAvailable
      ? `${baseGuidance} You can also upgrade to a higher plan.`
      : baseGuidance;
  }

  private formatResetAt(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "at the next quota reset";
    }
    return `at ${parsed.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })} UTC`;
  }

  private formatMegabytes(bytes: number): string {
    return (Math.round((bytes / 1_048_576) * 10) / 10).toFixed(
      Number.isInteger(Math.round((bytes / 1_048_576) * 10) / 10) ? 0 : 1
    );
  }
}
