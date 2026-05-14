import assert from "node:assert/strict";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { ResolveAdminOpsCockpitService } from "../src/modules/workspace-management/application/resolve-admin-ops-cockpit.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AssistantRuntimePreflightService } from "../src/modules/workspace-management/application/assistant-runtime-preflight.service";
import type { ResolveAssistantRuntimeTierService } from "../src/modules/workspace-management/application/resolve-assistant-runtime-tier.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { TrackWorkspaceQuotaUsageService } from "../src/modules/workspace-management/application/track-workspace-quota-usage.service";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantPublishedVersionRepository } from "../src/modules/workspace-management/domain/assistant-published-version.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { WorkspaceQuotaAccountingRepository } from "../src/modules/workspace-management/domain/workspace-quota-accounting.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

function createService(prisma: WorkspaceManagementPrismaService): ResolveAdminOpsCockpitService {
  return new ResolveAdminOpsCockpitService(
    {
      async findByUserId(userId: string) {
        assert.equal(userId, "user-1");
        return {
          id: "assistant-1",
          userId,
          workspaceId: "ws-1",
          applyStatus: "succeeded",
          applyTargetVersionId: "pub-target-1",
          applyAppliedVersionId: "pub-applied-1",
          applyRequestedAt: new Date("2026-04-19T09:10:00.000Z"),
          applyStartedAt: new Date("2026-04-19T09:10:05.000Z"),
          applyFinishedAt: new Date("2026-04-19T09:10:15.000Z"),
          applyErrorCode: null,
          applyErrorMessage: null
        };
      }
    } as Pick<AssistantRepository, "findByUserId"> as AssistantRepository,
    {
      async findLatestByAssistantId(assistantId: string) {
        assert.equal(assistantId, "assistant-1");
        return {
          id: "pub-1",
          version: 7,
          createdAt: new Date("2026-04-19T08:00:00.000Z")
        };
      }
    } as Pick<
      AssistantPublishedVersionRepository,
      "findLatestByAssistantId"
    > as AssistantPublishedVersionRepository,
    {
      async findByAssistantId(assistantId: string) {
        assert.equal(assistantId, "assistant-1");
        return {
          assistantId,
          assistantPlanOverrideCode: null,
          quotaPlanCode: "starter"
        };
      }
    } as Pick<AssistantGovernanceRepository, "findByAssistantId"> as AssistantGovernanceRepository,
    {
      async findByWorkspaceId(workspaceId: string) {
        assert.equal(workspaceId, "ws-1");
        return {
          workspaceId,
          tokenBudgetUsed: BigInt(1200),
          mediaStorageBytesUsed: BigInt(5 * 1024 * 1024),
          mediaStorageBytesLimit: BigInt(100 * 1024 * 1024)
        };
      }
    } as Pick<
      WorkspaceQuotaAccountingRepository,
      "findByWorkspaceId"
    > as WorkspaceQuotaAccountingRepository,
    {
      async assertCanReadAdminSurface(userId: string) {
        assert.equal(userId, "admin-1");
        return {
          userId,
          workspaceId: "ws-admin",
          roles: ["ops_admin"],
          hasLegacyOwnerFallback: false,
          hasGlobalPlatformAdminScope: true
        };
      }
    } as Pick<AdminAuthorizationService, "assertCanReadAdminSurface"> as AdminAuthorizationService,
    {
      async execute() {
        return {
          live: true,
          ready: true,
          checkedAt: "2026-04-19T10:00:00.000Z"
        };
      }
    } as Pick<AssistantRuntimePreflightService, "execute"> as AssistantRuntimePreflightService,
    {
      async resolveByAssistantId(assistantId: string) {
        assert.equal(assistantId, "assistant-1");
        return "pro";
      }
    } as Pick<
      ResolveAssistantRuntimeTierService,
      "resolveByAssistantId"
    > as ResolveAssistantRuntimeTierService,
    {
      async execute(input: { assistantId: string; workspaceId: string }) {
        assert.equal(input.assistantId, "assistant-1");
        assert.equal(input.workspaceId, "ws-1");
        return {
          planCode: "pro",
          source: "workspace_subscription"
        };
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "execute"
    > as ResolveEffectiveSubscriptionStateService,
    {
      async resolveEffectiveLimitsForAssistant() {
        return {
          tokenBudgetLimit: 5000,
          activeWebChatsLimit: 3
        };
      },
      async resolveAssistantTokenBudgetQuotaSnapshot() {
        return {
          usedCredits: BigInt(3200),
          limitCredits: BigInt(5000),
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period"
        };
      },
      async resolveAssistantMonthlyMediaQuotaSnapshot() {
        return {
          planCode: "pro",
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period" as const,
          tools: [
            {
              toolCode: "image_generate" as const,
              displayName: "Image generation",
              usedUnits: 4,
              reservedUnits: 0,
              settledUnits: 4,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: 20,
              bonusLimitUnits: 0,
              effectiveLimitUnits: 20,
              bonusExpiresAt: null,
              remainingUnits: 16,
              usageAvailable: true,
              status: "ok" as const
            },
            {
              toolCode: "image_edit" as const,
              displayName: "Image editing",
              usedUnits: 2,
              reservedUnits: 0,
              settledUnits: 2,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: 10,
              bonusLimitUnits: 0,
              effectiveLimitUnits: 10,
              bonusExpiresAt: null,
              remainingUnits: 8,
              usageAvailable: true,
              status: "ok" as const
            },
            {
              toolCode: "video_generate" as const,
              displayName: "Video generation",
              usedUnits: 1,
              reservedUnits: 0,
              settledUnits: 1,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: 5,
              bonusLimitUnits: 0,
              effectiveLimitUnits: 5,
              bonusExpiresAt: null,
              remainingUnits: 4,
              usageAvailable: true,
              status: "ok" as const
            }
          ]
        };
      }
    } as Pick<
      TrackWorkspaceQuotaUsageService,
      | "resolveEffectiveLimitsForAssistant"
      | "resolveAssistantTokenBudgetQuotaSnapshot"
      | "resolveAssistantMonthlyMediaQuotaSnapshot"
    > as TrackWorkspaceQuotaUsageService,
    prisma
  );
}

async function run(): Promise<void> {
  const prevEnv = {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    PERSAI_INTERNAL_API_TOKEN: process.env.PERSAI_INTERNAL_API_TOKEN,
    PERSAI_RUNTIME_BASE_URL: process.env.PERSAI_RUNTIME_BASE_URL
  };

  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/persai";
  process.env.CLERK_SECRET_KEY = "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal_token_123456";
  process.env.PERSAI_RUNTIME_BASE_URL = "http://runtime:3002";

  try {
    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);

    const prisma = {
      assistantChat: {
        async count(args?: {
          where?: {
            assistantId?: string;
            workspaceId?: string;
            surface?: string;
            archivedAt?: null | { not: null };
          };
        }) {
          if (args?.where?.assistantId === "assistant-1") {
            return 9;
          }
          if (
            args?.where?.workspaceId === "ws-1" &&
            args.where.surface === "web" &&
            args.where.archivedAt === null
          ) {
            return 2;
          }
          if (
            args?.where?.workspaceId === "ws-1" &&
            args.where.surface === "web" &&
            typeof args.where.archivedAt === "object"
          ) {
            return 1;
          }
          return 0;
        }
      },
      assistantChannelSurfaceBinding: {
        async findMany() {
          return [{ providerKey: "telegram", surfaceType: "dm", bindingState: "active" }];
        }
      },
      workspaceSubscription: {
        async findUnique() {
          return {
            id: "sub-1",
            planCode: "pro",
            status: "grace_period",
            trialStartedAt: null,
            trialEndsAt: null,
            graceStartedAt: new Date("2026-05-03T00:00:00.000Z"),
            graceEndsAt: new Date("2026-05-08T00:00:00.000Z"),
            currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
            currentPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
            cancelAtPeriodEnd: false,
            providerCustomerRef: "cust-1",
            providerSubscriptionRef: "sub-provider-1"
          };
        }
      },
      workspaceSubscriptionLifecycleEvent: {
        async findFirst() {
          return {
            eventCode: "payment_activated",
            source: "admin",
            nextPlanCode: "pro",
            nextPeriodStartedAt: new Date("2026-05-04T12:00:00.000Z"),
            nextPeriodEndsAt: new Date("2026-06-04T12:00:00.000Z"),
            metadata: {
              adminAction: "activate_paid_manually"
            },
            createdAt: new Date("2026-05-04T12:00:00.000Z")
          };
        },
        async findMany() {
          return [
            {
              id: "event-1",
              eventCode: "grace_started",
              source: "provider",
              previousStatus: "active",
              nextStatus: "grace_period",
              previousPlanCode: "pro",
              nextPlanCode: "pro",
              nextPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
              nextPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
              createdAt: new Date("2026-05-03T00:00:00.000Z")
            }
          ];
        }
      },
      planCatalogPlan: {
        async findUnique(args: { where: { code: string } }) {
          assert.equal(args.where.code, "pro");
          return {
            billingProviderHints: {
              sandboxPolicy: {
                enabled: true,
                maxCpuMsPerJob: 7777,
                maxMemoryBytesPerJob: 64 * 1024 * 1024,
                maxConcurrentProcesses: 2,
                sandboxJobsPerDay: 5,
                webMaxOutboundBytes: 3 * 1024 * 1024,
                telegramMaxOutboundBytes: 7 * 1024 * 1024,
                maxArtifactSendCountPerTurn: 2
              }
            }
          };
        }
      },
      sandboxJob: {
        async count(args: {
          where: {
            assistantId: string;
            workspaceId: string;
            createdAt?: { gte: Date };
            status?: string | { in: string[] };
          };
        }) {
          assert.equal(args.where.assistantId, "assistant-1");
          assert.equal(args.where.workspaceId, "ws-1");
          if ("status" in args.where && typeof args.where.status === "object") {
            assert.deepEqual(args.where.status.in, ["queued", "running"]);
            return 1;
          }
          if (args.where.createdAt?.gte instanceof Date) {
            assert.equal(args.where.createdAt.gte.toISOString(), startOfTodayUtc.toISOString());
          }
          switch (args.where.status) {
            case "completed":
              return 1;
            case "blocked":
              return 1;
            case "failed":
              return 0;
            default:
              return 3;
          }
        },
        async findMany() {
          return [
            {
              id: "job-blocked-1",
              toolCode: "shell",
              status: "blocked",
              relativeWorkspace: "jobs/abc",
              createdAt: new Date("2026-04-19T09:30:00.000Z"),
              startedAt: new Date("2026-04-19T09:30:02.000Z"),
              completedAt: new Date("2026-04-19T09:30:08.000Z"),
              violationCode: "process_cpu_limit_exceeded",
              violationMessage: "CPU usage exceeded the configured limit.",
              resultPayload: {
                reason: "process_cpu_limit_exceeded",
                warning: "CPU usage exceeded the configured limit."
              },
              resourceUsage: {
                peakCpuMs: 8123,
                peakMemoryBytes: 9 * 1024 * 1024,
                peakProcessCount: 2,
                processDurationMs: 6123,
                workspaceBytes: 1024,
                fileCount: 1,
                directoryCount: 1
              },
              _count: {
                assistantFiles: 1
              }
            },
            {
              id: "job-completed-1",
              toolCode: "exec",
              status: "completed",
              relativeWorkspace: null,
              createdAt: new Date("2026-04-19T08:00:00.000Z"),
              startedAt: new Date("2026-04-19T08:00:01.000Z"),
              completedAt: new Date("2026-04-19T08:00:05.000Z"),
              violationCode: null,
              violationMessage: null,
              resultPayload: {
                reason: "completed",
                warning: null
              },
              resourceUsage: {
                peakCpuMs: 450,
                peakMemoryBytes: 2 * 1024 * 1024,
                peakProcessCount: 1,
                processDurationMs: 3800,
                workspaceBytes: 2048,
                fileCount: 2,
                directoryCount: 1
              },
              _count: {
                assistantFiles: 2
              }
            }
          ];
        }
      },
      async $transaction<T>(ops: Promise<T>[]) {
        return await Promise.all(ops);
      }
    } as unknown as WorkspaceManagementPrismaService;

    const service = createService(prisma);
    const result = await service.execute("admin-1", "user-1");

    assert.equal(result.assistant.exists, true);
    assert.equal(result.quotaUsage?.tokenBudgetUsed, 3200);
    assert.equal(result.quotaUsage?.tokenBudgetPeriodSource, "subscription_period");
    assert.deepEqual(result.quotaUsage?.monthlyMediaTools, [
      {
        toolCode: "image_generate",
        displayName: "Image generation",
        usedUnits: 4,
        limitUnits: 20,
        bonusLimitUnits: 0,
        effectiveLimitUnits: 20,
        bonusExpiresAt: null
      },
      {
        toolCode: "image_edit",
        displayName: "Image editing",
        usedUnits: 2,
        limitUnits: 10,
        bonusLimitUnits: 0,
        effectiveLimitUnits: 10,
        bonusExpiresAt: null
      },
      {
        toolCode: "video_generate",
        displayName: "Video generation",
        usedUnits: 1,
        limitUnits: 5,
        bonusLimitUnits: 0,
        effectiveLimitUnits: 5,
        bonusExpiresAt: null
      }
    ]);
    assert.equal(result.billingSupport?.subscription.status, "grace_period");
    assert.equal(result.billingSupport?.quotaPeriod.startedAt, "2026-05-01T00:00:00.000Z");
    assert.equal(result.billingSupport?.latestPaidActivation?.source, "admin");
    assert.equal(
      result.billingSupport?.latestPaidActivation?.adminAction,
      "activate_paid_manually"
    );
    assert.equal(result.billingSupport?.latestLifecycleEvents[0]?.eventCode, "grace_started");
    assert.equal(result.sandbox?.effectivePolicy.enabled, true);
    assert.equal(result.sandbox?.effectivePolicy.maxCpuMsPerJob, 7777);
    assert.equal(result.sandbox?.effectivePolicy.maxMemoryBytesPerJob, 64 * 1024 * 1024);
    assert.equal(result.sandbox?.effectivePolicy.maxConcurrentProcesses, 2);
    assert.equal(result.sandbox?.effectivePolicy.sandboxJobsPerDay, 5);
    assert.equal(
      result.sandbox?.effectivePolicy.maxProcessRuntimeMs,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxProcessRuntimeMs
    );
    assert.deepEqual(result.sandbox?.usage, {
      activeJobs: 1,
      jobsStartedToday: 3,
      completedToday: 1,
      blockedToday: 1,
      failedToday: 0,
      dailyLimit: 5,
      remainingJobsToday: 2
    });
    assert.equal(result.sandbox?.recentJobs.length, 2);
    assert.deepEqual(result.sandbox?.recentJobs[0], {
      id: "job-blocked-1",
      toolCode: "shell",
      status: "blocked",
      relativeWorkspace: "jobs/abc",
      createdAt: "2026-04-19T09:30:00.000Z",
      startedAt: "2026-04-19T09:30:02.000Z",
      completedAt: "2026-04-19T09:30:08.000Z",
      violationCode: "process_cpu_limit_exceeded",
      violationMessage: "CPU usage exceeded the configured limit.",
      resultReason: "process_cpu_limit_exceeded",
      resultWarning: "CPU usage exceeded the configured limit.",
      persistedFileCount: 1,
      resourceUsage: {
        workspaceBytes: 1024,
        fileCount: 1,
        directoryCount: 1,
        stdoutBytes: null,
        stderrBytes: null,
        peakProcessCount: 2,
        peakCpuMs: 8123,
        peakMemoryBytes: 9 * 1024 * 1024,
        processDurationMs: 6123
      }
    });
  } finally {
    process.env.APP_ENV = prevEnv.APP_ENV;
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.CLERK_SECRET_KEY = prevEnv.CLERK_SECRET_KEY;
    process.env.PERSAI_INTERNAL_API_TOKEN = prevEnv.PERSAI_INTERNAL_API_TOKEN;
    process.env.PERSAI_RUNTIME_BASE_URL = prevEnv.PERSAI_RUNTIME_BASE_URL;
  }
}

void run();
