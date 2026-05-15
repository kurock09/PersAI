import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AssistantRuntimePreflightService } from "./assistant-runtime-preflight.service";
import type {
  AdminOpsCockpitState,
  AdminOpsCockpitQuotaUsage,
  AdminOpsCockpitBillingSupport,
  AdminOpsCockpitChannelBinding,
  AdminOpsCockpitChatStats,
  AdminOpsCockpitSandbox,
  AdminOpsCockpitSandboxJobResourceUsage
} from "./ops-cockpit.types";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import {
  WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
  type WorkspaceQuotaAccountingRepository
} from "../domain/workspace-quota-accounting.repository";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { resolveStoredPlanSandboxPolicy } from "./sandbox-policy";

function asIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

@Injectable()
export class ResolveAdminOpsCockpitService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly assistantRuntimePreflightService: AssistantRuntimePreflightService,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(callerUserId: string, targetUserId?: string): Promise<AdminOpsCockpitState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const lookupUserId = targetUserId ?? callerUserId;
    const config = loadApiConfig(process.env);
    const assistant = await this.assistantRepository.findByUserId(lookupUserId);
    const governance =
      assistant === null
        ? null
        : await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const runtimeTier = assistant
      ? await this.resolveAssistantRuntimeTierService.resolveByAssistantId(assistant.id)
      : null;
    const effectiveSubscription =
      assistant === null
        ? null
        : await this.resolveEffectiveSubscriptionStateService.execute({
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            assistantId: assistant.id,
            assistantPlanOverrideCode: governance?.assistantPlanOverrideCode ?? null,
            assistantQuotaPlanCode: governance?.quotaPlanCode ?? null
          });
    const runtimeBaseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim() || null;
    const runtimeConfigured = runtimeBaseUrl !== null && runtimeBaseUrl.length > 0;
    const runtimeEndpointHost = runtimeConfigured ? new URL(runtimeBaseUrl).host : null;
    const preflight = await this.assistantRuntimePreflightService.execute(runtimeTier ?? undefined);

    if (assistant === null) {
      const incidentSignals: AdminOpsCockpitState["incidentSignals"] = [
        {
          code: "assistant_absent",
          severity: "elevated",
          message: "No assistant exists for this operator account."
        }
      ];
      if (!preflight.live || !preflight.ready) {
        incidentSignals.push({
          code: "runtime_preflight_unhealthy",
          severity: "high",
          message: "Runtime preflight is not healthy (live/ready check failed)."
        });
      }
      return {
        quotaUsage: null,
        billingSupport: null,
        chatStats: null,
        channels: [],
        sandbox: null,
        assistant: {
          exists: false,
          assistantId: null,
          workspaceId: null,
          effectivePlan: {
            code: null,
            source: "none",
            assistantPlanOverrideCode: null,
            quotaPlanCode: null
          },
          latestPublishedVersion: {
            id: null,
            version: null,
            publishedAt: null
          },
          runtimeApply: null
        },
        runtime: {
          adapterEnabled: runtimeConfigured,
          runtimeTier,
          runtimeEndpointHost,
          preflight
        },
        controls: {
          reapplySupported: false,
          restartSupported: false,
          assistantPlanOverrideSupported: false,
          assistantPlanResetSupported: false
        },
        incidentSignals,
        updatedAt: new Date().toISOString()
      };
    }

    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
    const incidentSignals: AdminOpsCockpitState["incidentSignals"] = [];

    if (!preflight.live || !preflight.ready) {
      incidentSignals.push({
        code: "runtime_preflight_unhealthy",
        severity: "high",
        message: "Runtime preflight is not healthy (live/ready check failed)."
      });
    }

    if (latestPublishedVersion === null) {
      incidentSignals.push({
        code: "assistant_not_published",
        severity: "elevated",
        message: "Assistant has no published version."
      });
    }

    if (assistant.applyStatus === "failed") {
      incidentSignals.push({
        code: "runtime_apply_failed",
        severity: "high",
        message: "Latest runtime apply failed."
      });
    } else if (assistant.applyStatus === "degraded") {
      incidentSignals.push({
        code: "runtime_apply_degraded",
        severity: "elevated",
        message: "Latest runtime apply completed in degraded mode."
      });
    } else if (assistant.applyStatus === "in_progress") {
      incidentSignals.push({
        code: "runtime_apply_in_progress",
        severity: "info",
        message: "Runtime apply is currently in progress."
      });
    }

    const quotaUsage = await this.resolveQuotaUsage(assistant.workspaceId, assistant);
    const billingSupport = await this.resolveBillingSupport(assistant.workspaceId, quotaUsage);
    const chatStats = await this.resolveChatStats(assistant.workspaceId, assistant.id);
    const channels = await this.resolveChannelBindings(assistant.id);
    const sandbox = await this.resolveSandboxState(
      assistant.id,
      assistant.workspaceId,
      effectiveSubscription?.planCode ?? null
    );

    return {
      quotaUsage,
      billingSupport,
      chatStats,
      channels,
      sandbox,
      assistant: {
        exists: true,
        assistantId: assistant.id,
        workspaceId: assistant.workspaceId,
        effectivePlan: {
          code: effectiveSubscription?.planCode ?? null,
          source: effectiveSubscription?.source ?? "none",
          assistantPlanOverrideCode: governance?.assistantPlanOverrideCode ?? null,
          quotaPlanCode: governance?.quotaPlanCode ?? null
        },
        latestPublishedVersion: {
          id: latestPublishedVersion?.id ?? null,
          version: latestPublishedVersion?.version ?? null,
          publishedAt: asIso(latestPublishedVersion?.createdAt ?? null)
        },
        runtimeApply: {
          status: assistant.applyStatus,
          targetPublishedVersionId: assistant.applyTargetVersionId,
          appliedPublishedVersionId: assistant.applyAppliedVersionId,
          requestedAt: asIso(assistant.applyRequestedAt),
          startedAt: asIso(assistant.applyStartedAt),
          finishedAt: asIso(assistant.applyFinishedAt),
          error:
            assistant.applyErrorCode === null && assistant.applyErrorMessage === null
              ? null
              : {
                  code: assistant.applyErrorCode,
                  message: assistant.applyErrorMessage
                }
        }
      },
      runtime: {
        adapterEnabled: runtimeConfigured,
        runtimeTier,
        runtimeEndpointHost,
        preflight
      },
      controls: {
        reapplySupported: latestPublishedVersion !== null,
        restartSupported: false,
        assistantPlanOverrideSupported: true,
        assistantPlanResetSupported: governance?.assistantPlanOverrideCode !== null
      },
      incidentSignals,
      updatedAt: new Date().toISOString()
    };
  }

  private async resolveQuotaUsage(
    workspaceId: string,
    assistant: Parameters<
      typeof this.trackWorkspaceQuotaUsageService.resolveEffectiveLimitsForAssistant
    >[0]
  ): Promise<AdminOpsCockpitQuotaUsage | null> {
    const quotaState = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(workspaceId);
    if (quotaState === null) return null;

    const limits =
      await this.trackWorkspaceQuotaUsageService.resolveEffectiveLimitsForAssistant(assistant);
    const tokenBudget =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantTokenBudgetQuotaSnapshot(
        assistant
      );
    const monthlyToolQuotas =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantMonthlyToolQuotaSnapshot(
        assistant
      );

    const activeWebChats = await this.prisma.assistantChat.count({
      where: { workspaceId, surface: "web", archivedAt: null }
    });

    return {
      tokenBudgetUsed: Number(tokenBudget.usedCredits),
      tokenBudgetLimit: tokenBudget.limitCredits !== null ? Number(tokenBudget.limitCredits) : null,
      tokenBudgetPeriodStartedAt: tokenBudget.periodStartedAt,
      tokenBudgetPeriodEndsAt: tokenBudget.periodEndsAt,
      tokenBudgetPeriodSource: tokenBudget.periodSource,
      mediaStorageBytesUsed: Number(quotaState.mediaStorageBytesUsed),
      mediaStorageBytesLimit:
        quotaState.mediaStorageBytesLimit !== null
          ? Number(quotaState.mediaStorageBytesLimit)
          : null,
      activeWebChats,
      activeWebChatsLimit:
        limits.activeWebChatsLimit !== null && limits.activeWebChatsLimit !== undefined
          ? limits.activeWebChatsLimit
          : null,
      monthlyMediaTools: monthlyToolQuotas.tools
        .filter(
          (
            tool
          ): tool is (typeof monthlyToolQuotas.tools)[number] & {
            toolCode: "image_generate" | "image_edit" | "video_generate";
          } => tool.toolCode !== "document"
        )
        .map((tool) => ({
          toolCode: tool.toolCode,
          displayName: tool.displayName,
          usedUnits: tool.usedUnits,
          limitUnits: tool.limitUnits,
          bonusLimitUnits: tool.bonusLimitUnits,
          effectiveLimitUnits: tool.effectiveLimitUnits,
          bonusExpiresAt: tool.bonusExpiresAt
        }))
    };
  }

  private async resolveBillingSupport(
    workspaceId: string,
    quotaUsage: AdminOpsCockpitQuotaUsage | null
  ): Promise<AdminOpsCockpitBillingSupport> {
    const [subscription, latestPaidActivation, latestLifecycleEvents] = await Promise.all([
      this.prisma.workspaceSubscription.findUnique({
        where: { workspaceId },
        select: {
          id: true,
          planCode: true,
          status: true,
          trialStartedAt: true,
          trialEndsAt: true,
          graceStartedAt: true,
          graceEndsAt: true,
          currentPeriodStartedAt: true,
          currentPeriodEndsAt: true,
          cancelAtPeriodEnd: true,
          providerCustomerRef: true,
          providerSubscriptionRef: true
        }
      }),
      this.prisma.workspaceSubscriptionLifecycleEvent.findFirst({
        where: {
          workspaceId,
          nextStatus: "active",
          nextPlanCode: { not: null }
        },
        orderBy: { createdAt: "desc" },
        select: {
          eventCode: true,
          source: true,
          nextPlanCode: true,
          nextPeriodStartedAt: true,
          nextPeriodEndsAt: true,
          metadata: true,
          createdAt: true
        }
      }),
      this.prisma.workspaceSubscriptionLifecycleEvent.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          eventCode: true,
          source: true,
          previousStatus: true,
          nextStatus: true,
          previousPlanCode: true,
          nextPlanCode: true,
          nextPeriodStartedAt: true,
          nextPeriodEndsAt: true,
          createdAt: true
        }
      })
    ]);

    return {
      ...(() => {
        const latestPaidActivationMetadata = asObject(latestPaidActivation?.metadata);
        return {
          latestPaidActivation:
            latestPaidActivation === null
              ? null
              : {
                  eventCode: latestPaidActivation.eventCode,
                  source: latestPaidActivation.source,
                  adminAction:
                    typeof latestPaidActivationMetadata?.adminAction === "string"
                      ? latestPaidActivationMetadata.adminAction
                      : null,
                  planCode: latestPaidActivation.nextPlanCode,
                  periodStartedAt: asIso(latestPaidActivation.nextPeriodStartedAt),
                  periodEndsAt: asIso(latestPaidActivation.nextPeriodEndsAt),
                  createdAt: latestPaidActivation.createdAt.toISOString()
                }
        };
      })(),
      subscription: {
        id: subscription?.id ?? null,
        planCode: subscription?.planCode ?? null,
        status: subscription?.status ?? null,
        trialStartedAt: asIso(subscription?.trialStartedAt ?? null),
        trialEndsAt: asIso(subscription?.trialEndsAt ?? null),
        graceStartedAt: asIso(subscription?.graceStartedAt ?? null),
        graceEndsAt: asIso(subscription?.graceEndsAt ?? null),
        currentPeriodStartedAt: asIso(subscription?.currentPeriodStartedAt ?? null),
        currentPeriodEndsAt: asIso(subscription?.currentPeriodEndsAt ?? null),
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? null,
        providerCustomerRef: subscription?.providerCustomerRef ?? null,
        providerSubscriptionRef: subscription?.providerSubscriptionRef ?? null
      },
      quotaPeriod: {
        startedAt: quotaUsage?.tokenBudgetPeriodStartedAt ?? null,
        endsAt: quotaUsage?.tokenBudgetPeriodEndsAt ?? null,
        source: quotaUsage?.tokenBudgetPeriodSource ?? null
      },
      latestLifecycleEvents: latestLifecycleEvents.map((event) => ({
        id: event.id,
        eventCode: event.eventCode,
        source: event.source,
        previousStatus: event.previousStatus,
        nextStatus: event.nextStatus,
        previousPlanCode: event.previousPlanCode,
        nextPlanCode: event.nextPlanCode,
        nextPeriodStartedAt: asIso(event.nextPeriodStartedAt),
        nextPeriodEndsAt: asIso(event.nextPeriodEndsAt),
        createdAt: event.createdAt.toISOString()
      }))
    };
  }

  private async resolveChatStats(
    workspaceId: string,
    assistantId: string
  ): Promise<AdminOpsCockpitChatStats> {
    const [totalChats, activeWebChats, archivedWebChats] = await Promise.all([
      this.prisma.assistantChat.count({
        where: { assistantId }
      }),
      this.prisma.assistantChat.count({
        where: { workspaceId, surface: "web", archivedAt: null }
      }),
      this.prisma.assistantChat.count({
        where: { workspaceId, surface: "web", archivedAt: { not: null } }
      })
    ]);
    return { totalChats, activeWebChats, archivedWebChats };
  }

  private async resolveChannelBindings(
    assistantId: string
  ): Promise<AdminOpsCockpitChannelBinding[]> {
    const bindings = await this.prisma.assistantChannelSurfaceBinding.findMany({
      where: { assistantId },
      select: { providerKey: true, surfaceType: true, bindingState: true }
    });
    return bindings.map((b) => ({
      provider: b.providerKey,
      surface: b.surfaceType,
      state: b.bindingState
    }));
  }

  private async resolveSandboxState(
    assistantId: string,
    workspaceId: string,
    planCode: string | null
  ): Promise<AdminOpsCockpitSandbox> {
    const effectivePolicy = await this.resolvePlanSandboxPolicy(planCode);
    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);

    const [activeJobs, jobsStartedToday, completedToday, blockedToday, failedToday, recentJobs] =
      await this.prisma.$transaction([
        this.prisma.sandboxJob.count({
          where: {
            assistantId,
            workspaceId,
            status: { in: ["queued", "running"] }
          }
        }),
        this.prisma.sandboxJob.count({
          where: {
            assistantId,
            workspaceId,
            createdAt: { gte: startOfTodayUtc }
          }
        }),
        this.prisma.sandboxJob.count({
          where: {
            assistantId,
            workspaceId,
            createdAt: { gte: startOfTodayUtc },
            status: "completed"
          }
        }),
        this.prisma.sandboxJob.count({
          where: {
            assistantId,
            workspaceId,
            createdAt: { gte: startOfTodayUtc },
            status: "blocked"
          }
        }),
        this.prisma.sandboxJob.count({
          where: {
            assistantId,
            workspaceId,
            createdAt: { gte: startOfTodayUtc },
            status: "failed"
          }
        }),
        this.prisma.sandboxJob.findMany({
          where: { assistantId, workspaceId },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            toolCode: true,
            status: true,
            relativeWorkspace: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            violationCode: true,
            violationMessage: true,
            resultPayload: true,
            resourceUsage: true,
            _count: {
              select: {
                assistantFiles: true
              }
            }
          }
        })
      ]);

    return {
      effectivePolicy,
      usage: {
        activeJobs,
        jobsStartedToday,
        completedToday,
        blockedToday,
        failedToday,
        dailyLimit: effectivePolicy.sandboxJobsPerDay,
        remainingJobsToday:
          effectivePolicy.sandboxJobsPerDay === null
            ? null
            : Math.max(effectivePolicy.sandboxJobsPerDay - jobsStartedToday, 0)
      },
      recentJobs: recentJobs.map((job) => {
        const payload = asObject(job.resultPayload);
        return {
          id: job.id,
          toolCode: job.toolCode,
          status: job.status,
          relativeWorkspace: job.relativeWorkspace,
          createdAt: job.createdAt.toISOString(),
          startedAt: asIso(job.startedAt),
          completedAt: asIso(job.completedAt),
          violationCode: job.violationCode,
          violationMessage: job.violationMessage,
          resultReason: this.readNullableString(payload?.reason),
          resultWarning: this.readNullableString(payload?.warning),
          persistedFileCount: job._count.assistantFiles,
          resourceUsage: this.readSandboxJobResourceUsage(job.resourceUsage)
        };
      })
    };
  }

  private async resolvePlanSandboxPolicy(planCode: string | null) {
    if (planCode === null) {
      return resolveStoredPlanSandboxPolicy(null);
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return resolveStoredPlanSandboxPolicy(null);
    }
    const hints = asObject(plan.billingProviderHints);
    return resolveStoredPlanSandboxPolicy(hints?.sandboxPolicy);
  }

  private readSandboxJobResourceUsage(
    value: unknown
  ): AdminOpsCockpitSandboxJobResourceUsage | null {
    const row = asObject(value);
    if (row === null) {
      return null;
    }
    return {
      workspaceBytes: this.readNullableNumber(row.workspaceBytes),
      fileCount: this.readNullableNumber(row.fileCount),
      directoryCount: this.readNullableNumber(row.directoryCount),
      stdoutBytes: this.readNullableNumber(row.stdoutBytes),
      stderrBytes: this.readNullableNumber(row.stderrBytes),
      peakProcessCount: this.readNullableNumber(row.peakProcessCount),
      peakCpuMs: this.readNullableNumber(row.peakCpuMs),
      peakMemoryBytes: this.readNullableNumber(row.peakMemoryBytes),
      processDurationMs: this.readNullableNumber(row.processDurationMs)
    };
  }

  private readNullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private readNullableNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}
