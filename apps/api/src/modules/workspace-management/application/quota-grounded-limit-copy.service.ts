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
      | "monthly_tool_quota_exceeded"
      | "monthly_tool_quota_rejected"
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
      case "monthly_tool_quota_exceeded":
      case "monthly_tool_quota_rejected":
        return this.buildMonthlyToolCopy(quotaStatus, input.details, input.code);
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

  private buildMonthlyToolCopy(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    details: Record<string, unknown> | undefined,
    code:
      | "monthly_media_quota_exceeded"
      | "monthly_media_quota_rejected"
      | "monthly_tool_quota_exceeded"
      | "monthly_tool_quota_rejected"
  ): QuotaGroundedLimitCopy | null {
    const toolCode = typeof details?.toolCode === "string" ? details.toolCode : null;
    if (toolCode === null) {
      return null;
    }
    const tool =
      quotaStatus.monthlyToolQuotas.tools.find((row) => row.toolCode === toolCode) ?? null;
    const displayName = tool?.displayName ?? toolCode.replace(/_/g, " ");

    // ADR-108 Slice 7 — vcoin variant: video_generate uses VC balance semantics.
    if (toolCode === "video_generate" && tool !== null && tool.kind === "vcoin") {
      if (code === "monthly_media_quota_rejected" || code === "monthly_tool_quota_rejected") {
        return {
          message: `${displayName} is not active on the current plan.`,
          guidance: this.buildInactiveToolGuidance(quotaStatus, toolCode)
        };
      }
      if (tool.status === "balance_exhausted" || tool.balanceVc <= 0) {
        return {
          message: "Your video credits are exhausted. Top up to continue.",
          guidance: this.buildMonthlyToolUpgradeGuidance(
            quotaStatus,
            toolCode,
            "Top up your Vcoin balance to generate more videos."
          )
        };
      }
      const typicalCostSuffix =
        tool.typicalVideoCostVc !== null
          ? ` A typical video costs about ${String(tool.typicalVideoCostVc)} VC.`
          : "";
      return {
        message: `You have ${String(tool.balanceVc)} VC remaining.${typicalCostSuffix}`,
        guidance: null
      };
    }

    if (code === "monthly_media_quota_rejected" || code === "monthly_tool_quota_rejected") {
      return {
        message: `${displayName} is not active on the current plan.`,
        guidance: this.buildInactiveToolGuidance(quotaStatus, toolCode)
      };
    }

    // Narrow to units row for the units-based path.
    const unitsRow = tool !== null && tool.kind === "units" ? tool : null;
    const used =
      typeof details?.currentUsedUnits === "number"
        ? details.currentUsedUnits
        : unitsRow !== null
          ? unitsRow.usedUnits
          : null;
    const effectiveLimit =
      typeof details?.limitUnits === "number"
        ? details.limitUnits
        : unitsRow !== null
          ? typeof unitsRow.effectiveLimitUnits === "number"
            ? unitsRow.effectiveLimitUnits
            : unitsRow.limitUnits
          : null;
    const resetAt =
      typeof details?.periodEndsAt === "string"
        ? details.periodEndsAt
        : quotaStatus.monthlyToolQuotas.periodEndsAt;
    const baseGuidance =
      toolCode === "document"
        ? "Use a request that does not need document generation."
        : "Use a request that does not need media generation.";
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
      guidance: this.buildMonthlyToolUpgradeGuidance(quotaStatus, toolCode, baseGuidance)
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
        guidance: this.buildInactiveToolGuidance(quotaStatus, toolCode)
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
        toolCode,
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
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    toolCode: string
  ): string {
    const toolOffers =
      quotaStatus.packageOffers.tools.find((tool) => tool.toolCode === toolCode) ?? null;
    const firstUpgradePlan = this.resolveUpgradePlanDisplayName(
      quotaStatus,
      toolOffers?.preferredUpgradePlanCode ?? null
    );
    if (firstUpgradePlan !== null) {
      return `Upgrade to ${firstUpgradePlan} or switch to a request that does not need this capability.`;
    }
    return "Switch to a request that does not need this capability.";
  }

  private buildMonthlyToolUpgradeGuidance(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    toolCode: string,
    baseGuidance: string
  ): string {
    const toolOffers =
      quotaStatus.packageOffers.tools.find((tool) => tool.toolCode === toolCode) ?? null;
    const preferredPackage =
      toolOffers === null
        ? null
        : (toolOffers.offers.find((offer) => toolOffers.preferredPackageIds.includes(offer.id)) ??
          toolOffers.offers[0] ??
          null);
    const packageHint =
      toolOffers?.offerableNow === true && preferredPackage !== null
        ? `buy ${this.formatPackageOffer(preferredPackage)} on ${quotaStatus.packageOffers.packagesPurchase?.path ?? "/app/packages"}`
        : null;
    const upgradeHint = this.resolveUpgradePlanDisplayName(
      quotaStatus,
      toolOffers?.preferredUpgradePlanCode ?? null
    );
    if (packageHint !== null && upgradeHint !== null) {
      return `${baseGuidance} You can also ${packageHint}, or upgrade to ${upgradeHint} for a larger monthly limit.`;
    }
    if (packageHint !== null) {
      return `${baseGuidance} You can also ${packageHint}.`;
    }
    if (upgradeHint !== null) {
      return `${baseGuidance} You can also upgrade to ${upgradeHint}.`;
    }
    return baseGuidance;
  }

  private buildUpgradeAwareGuidance(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    toolCode: string,
    baseGuidance: string
  ): string {
    const toolOffers =
      quotaStatus.packageOffers.tools.find((tool) => tool.toolCode === toolCode) ?? null;
    const highestPlan = this.resolveUpgradePlanDisplayName(
      quotaStatus,
      toolOffers?.preferredUpgradePlanCode ?? null
    );
    return highestPlan !== null
      ? `${baseGuidance} You can also upgrade to ${highestPlan}.`
      : baseGuidance;
  }

  private resolveUpgradePlanDisplayName(
    quotaStatus: Awaited<ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>>,
    planCode: string | null
  ): string | null {
    if (planCode === null) {
      return null;
    }
    return quotaStatus.visiblePlans.find((plan) => plan.code === planCode)?.displayName ?? null;
  }

  private formatPackageOffer(
    offer: Awaited<
      ReturnType<ReadInternalRuntimeQuotaStatusService["execute"]>
    >["packageOffers"]["tools"][number]["offers"][number]
  ): string {
    const title = offer.title.en ?? offer.title.ru ?? `${offer.units} units`;
    const price = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: offer.currency,
      maximumFractionDigits: offer.amountMinor % 100 === 0 ? 0 : 2
    }).format(offer.amountMinor / 100);
    return `"${title}" for ${price}`;
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
