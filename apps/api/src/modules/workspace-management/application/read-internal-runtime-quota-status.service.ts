import { BadRequestException, Injectable } from "@nestjs/common";
import { ManageAdminPlansService } from "./manage-admin-plans.service";
import type {
  AssistantMonthlyMediaQuotaSnapshot,
  AssistantQuotaBucketSnapshot
} from "./track-workspace-quota-usage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";

const MONTHLY_MEDIA_QUOTA_TOOL_CODES = new Set(["image_generate", "image_edit", "video_generate"]);

export type ReadInternalRuntimeQuotaStatusRequest = {
  assistantId: string;
  toolCode?: string;
};

export type ToolDailyQuotaStatusRow = {
  toolCode: string;
  activationStatus: string;
  dailyCallLimit: number | null;
  currentCount: number;
  allowed: boolean;
};

@Injectable()
export class ReadInternalRuntimeQuotaStatusService {
  constructor(
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly manageAdminPlansService: ManageAdminPlansService
  ) {}

  parseInput(payload: unknown): ReadInternalRuntimeQuotaStatusRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Tool quota check payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    if (typeof row.assistantId !== "string" || row.assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId must be a non-empty string.");
    }
    const out: ReadInternalRuntimeQuotaStatusRequest = {
      assistantId: row.assistantId.trim()
    };
    if (typeof row.toolCode === "string" && row.toolCode.trim().length > 0) {
      out.toolCode = row.toolCode.trim();
    }
    return out;
  }

  async execute(input: ReadInternalRuntimeQuotaStatusRequest): Promise<{
    ok: true;
    planCode: string | null;
    currentPlan: {
      code: string | null;
      displayName: string | null;
    };
    visiblePlans: Array<{
      code: string;
      displayName: string;
      description: string | null;
      highlighted: boolean;
      isCurrent: boolean;
      amountMinor: number | null;
      currency: string | null;
      billingPeriod: "month" | "year" | null;
      enabledToolCodes: string[];
      title: {
        ru: string | null;
        en: string | null;
      };
      subtitle: {
        ru: string | null;
        en: string | null;
      };
      notes: {
        ru: string | null;
        en: string | null;
      };
      badge: {
        ru: string | null;
        en: string | null;
      };
      ctaLabel: {
        ru: string | null;
        en: string | null;
      };
      highlightItems: {
        ru: string[];
        en: string[];
      };
      limits: {
        tokenBudgetLimit: number | null;
        activeWebChatsLimit: number | null;
        imageGenerateMonthlyUnitsLimit: number | null;
        imageEditMonthlyUnitsLimit: number | null;
        videoGenerateMonthlyUnitsLimit: number | null;
      };
    }>;
    tools: ToolDailyQuotaStatusRow[];
    buckets: AssistantQuotaBucketSnapshot[];
    monthlyMediaQuotas: AssistantMonthlyMediaQuotaSnapshot;
  }> {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute(
      input.toolCode
        ? {
            assistantId: input.assistantId,
            toolCode: input.toolCode
          }
        : {
            assistantId: input.assistantId
          }
    );

    const tools: ToolDailyQuotaStatusRow[] = [];
    for (const act of resolved.tools) {
      if (MONTHLY_MEDIA_QUOTA_TOOL_CODES.has(act.toolCode)) {
        // ADR-082: media paid-usage truth is monthly and delivery-confirmed, so
        // quota_status should expose those tools only via monthlyMediaQuotas.
        continue;
      }
      const dailyCallLimit = act.dailyCallLimit;
      const check =
        dailyCallLimit === null || dailyCallLimit <= 0
          ? { allowed: true, currentCount: 0, limit: null as number | null }
          : await this.trackWorkspaceQuotaUsageService.checkToolDailyLimit({
              workspaceId: resolved.assistant.workspaceId,
              toolCode: act.toolCode,
              dailyCallLimit
            });

      const activeOnPlan = act.activationStatus === "active";
      const underDailyCap =
        dailyCallLimit === null ||
        dailyCallLimit <= 0 ||
        (check.limit !== null && check.currentCount < check.limit);
      const allowed = activeOnPlan && underDailyCap;

      tools.push({
        toolCode: act.toolCode,
        activationStatus: act.activationStatus,
        dailyCallLimit,
        currentCount: check.currentCount,
        allowed
      });
    }

    const snapshot = await this.trackWorkspaceQuotaUsageService.resolveAssistantQuotaSnapshot(
      resolved.assistant
    );
    const monthlyMediaQuotas =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantMonthlyMediaQuotaSnapshot(
        resolved.assistant
      );
    const visiblePlans = await this.manageAdminPlansService.listPublicPricingPlans();
    const currentVisiblePlan = visiblePlans.find((plan) => plan.code === resolved.planCode) ?? null;

    return {
      ok: true,
      planCode: resolved.planCode,
      currentPlan: {
        code: resolved.planCode,
        displayName: currentVisiblePlan?.displayName ?? null
      },
      visiblePlans: visiblePlans.map((plan) => ({
        code: plan.code,
        displayName: plan.displayName,
        description: plan.description,
        highlighted: plan.presentation.highlighted,
        isCurrent: plan.code === resolved.planCode,
        amountMinor:
          typeof plan.presentation.price.amount === "number"
            ? Math.round(plan.presentation.price.amount * 100)
            : null,
        currency: plan.presentation.price.currency,
        billingPeriod: plan.presentation.price.billingPeriod,
        enabledToolCodes: plan.enabledToolCodes,
        title: plan.presentation.title,
        subtitle: plan.presentation.subtitle,
        notes: plan.presentation.notes,
        badge: plan.presentation.badge,
        ctaLabel: plan.presentation.ctaLabel,
        highlightItems: plan.presentation.highlightItems,
        limits: {
          tokenBudgetLimit: plan.quotaLimits.tokenBudgetLimit,
          activeWebChatsLimit: plan.quotaLimits.activeWebChatsLimit,
          imageGenerateMonthlyUnitsLimit: plan.quotaLimits.imageGenerateMonthlyUnitsLimit,
          imageEditMonthlyUnitsLimit: plan.quotaLimits.imageEditMonthlyUnitsLimit,
          videoGenerateMonthlyUnitsLimit: plan.quotaLimits.videoGenerateMonthlyUnitsLimit
        }
      })),
      tools,
      buckets: snapshot.buckets,
      monthlyMediaQuotas
    };
  }
}
