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
import type { WorkspaceQuotaAccountingRepository } from "../src/modules/workspace-management/domain/workspace-quota-accounting.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { UserRestrictionRepository } from "../src/modules/workspace-management/domain/user-restriction.repository";

function createService(
  prisma: WorkspaceManagementPrismaService,
  options?: {
    tokenBudgetPeriodSource?: "subscription_period" | "calendar_month_fallback" | null;
  }
): ResolveAdminOpsCockpitService {
  return new ResolveAdminOpsCockpitService(
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
      async findActiveSafetyRestriction() {
        return null;
      }
    } as Pick<
      UserRestrictionRepository,
      "findActiveSafetyRestriction"
    > as UserRestrictionRepository,
    {
      async assertCanReadAdminSurface(userId: string) {
        assert.equal(userId, "admin-1");
        return {
          userId,
          workspaceId: "ws-admin",
          roles: ["ops_admin"],
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
          periodSource:
            options?.tokenBudgetPeriodSource === undefined
              ? "subscription_period"
              : options.tokenBudgetPeriodSource
        };
      },
      async resolveAssistantMonthlyToolQuotaSnapshot() {
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
            },
            {
              toolCode: "document" as const,
              displayName: "Document generation",
              usedUnits: 3,
              reservedUnits: 0,
              settledUnits: 3,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: 8,
              bonusLimitUnits: 2,
              effectiveLimitUnits: 10,
              bonusExpiresAt: "2026-06-01T00:00:00.000Z",
              remainingUnits: 7,
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
      | "resolveAssistantMonthlyToolQuotaSnapshot"
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
      workspaceMember: {
        async findFirst(args?: { where?: { userId?: string } }) {
          assert.equal(args?.where?.userId, "user-1");
          return {
            workspaceId: "ws-1",
            activeAssistantId: "assistant-1"
          };
        }
      },
      assistant: {
        async findMany(args?: {
          where?: { workspaceId?: string; userId?: string };
          orderBy?: { createdAt: "asc" };
        }) {
          assert.equal(args?.where?.workspaceId, "ws-1");
          assert.equal(args?.where?.userId, "user-1");
          assert.deepEqual(args?.orderBy, { createdAt: "asc" });
          return [
            {
              id: "assistant-1",
              userId: "user-1",
              workspaceId: "ws-1",
              draftDisplayName: "Ops Helper",
              draftInstructions: null,
              draftTraits: null,
              draftAvatarEmoji: null,
              draftAvatarUrl: null,
              draftAssistantGender: null,
              draftVoiceProfile: null,
              draftArchetypeKey: null,
              draftUpdatedAt: null,
              applyStatus: "succeeded",
              applyTargetVersionId: "pub-target-1",
              applyAppliedVersionId: "pub-applied-1",
              applyRequestedAt: new Date("2026-04-19T09:10:00.000Z"),
              applyStartedAt: new Date("2026-04-19T09:10:05.000Z"),
              applyFinishedAt: new Date("2026-04-19T09:10:15.000Z"),
              applyErrorCode: null,
              applyErrorMessage: null,
              configDirtyAt: null,
              sandboxEgressMode: "restricted",
              createdAt: new Date("2026-04-19T07:00:00.000Z"),
              updatedAt: new Date("2026-04-19T07:00:00.000Z"),
              publishedVersions: [
                {
                  version: 7,
                  createdAt: new Date("2026-04-19T08:00:00.000Z")
                }
              ]
            }
          ];
        }
      },
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
            if (args.where.surface === "web" && args.where.archivedAt === null) {
              return 7;
            }
            if (
              args.where.surface === "web" &&
              typeof args.where.archivedAt === "object" &&
              args.where.archivedAt !== null
            ) {
              return 3;
            }
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
              }
            }
          ];
        }
      },
      workspacePaymentIntent: {
        async groupBy() {
          return [{ currency: "RUB", _sum: { amountMinor: 199000 } }];
        }
      },
      workspaceSubscriptionBillingEvent: {
        async findMany() {
          return [
            {
              planCode: "pro",
              metadata: {
                amountMinor: 9800,
                currency: "RUB"
              }
            }
          ];
        }
      },
      modelCostLedgerEvent: {
        async aggregate(args: { where?: { workspaceId?: string; currency?: string } }) {
          assert.equal(args.where?.workspaceId, "ws-1");
          assert.equal(args.where?.currency, "USD");
          return { _sum: { actualCostMicros: BigInt(5000000) } };
        },
        async groupBy(args: {
          by: string[];
          where?: { workspaceId?: string; occurredAt?: { gte?: Date; lt?: Date } };
        }) {
          assert.equal(args.where?.workspaceId, "ws-1");
          assert.ok(args.where?.occurredAt?.gte instanceof Date);
          assert.ok(args.where?.occurredAt?.lt instanceof Date);
          const key = args.by.join(",");
          if (key === "currency") {
            return [
              {
                currency: "USD",
                _count: { _all: 5 },
                _sum: { actualCostMicros: BigInt(8450000) }
              }
            ];
          }
          if (key === "purpose") {
            return [
              {
                purpose: "chat_main_reply",
                _count: { _all: 3 },
                _sum: { actualCostMicros: BigInt(7400000) }
              },
              {
                purpose: "background_task",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(250000) }
              },
              {
                purpose: "router",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(800000) }
              }
            ];
          }
          if (key === "surface") {
            return [
              {
                surface: "web",
                _count: { _all: 3 },
                _sum: { actualCostMicros: BigInt(7000000) }
              },
              {
                surface: "telegram",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(1200000) }
              },
              {
                surface: "background",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(250000) }
              }
            ];
          }
          if (key === "provider,model,purpose,surface,currency") {
            return [
              {
                provider: "openai",
                model: "gpt-4.1",
                purpose: "chat_main_reply",
                surface: "web",
                currency: "USD",
                _count: { _all: 2 },
                _sum: { actualCostMicros: BigInt(5200000) }
              },
              {
                provider: "openai",
                model: "gpt-4.1-mini",
                purpose: "chat_main_reply",
                surface: "telegram",
                currency: "USD",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(2200000) }
              },
              {
                provider: "openai",
                model: "gpt-4.1-mini",
                purpose: "router",
                surface: "web",
                currency: "USD",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(800000) }
              },
              {
                provider: "openai",
                model: "gpt-4.1-mini",
                purpose: "background_task",
                surface: "background",
                currency: "USD",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(250000) }
              }
            ];
          }
          throw new Error(`Unexpected groupBy: ${key}`);
        },
        async findMany(args: {
          where?: { workspaceId?: string; userId?: { not: null } };
          select: Record<string, true>;
        }) {
          assert.equal(args.where?.workspaceId, "ws-1");
          if ("workspaceId" in args.select) {
            return [{ workspaceId: "ws-1" }];
          }
          if ("userId" in args.select) {
            return [{ userId: "user-1" }];
          }
          if ("rawUsage" in args.select) {
            return [];
          }
          throw new Error("Unexpected findMany select");
        }
      },
      async $transaction<T>(ops: Promise<T>[]) {
        return await Promise.all(ops);
      }
    } as unknown as WorkspaceManagementPrismaService;

    const service = createService(prisma);
    const result = await service.execute("admin-1", "user-1");

    assert.equal(result.assistant.exists, true);
    assert.deepEqual(result.assistant.assistants, [
      {
        id: "assistant-1",
        draftDisplayName: "Ops Helper",
        applyStatus: "succeeded",
        latestPublishedVersion: 7,
        lastPublishedAt: "2026-04-19T08:00:00.000Z",
        isActive: true
      }
    ]);
    assert.equal(result.quotaUsage?.tokenBudgetUsed, 3200);
    assert.equal(result.quotaUsage?.tokenBudgetPeriodSource, "subscription_period");
    assert.equal(
      result.quotaUsage?.activeWebChats,
      7,
      "activeWebChats must be scoped to the assistant (assistant-1 has 7), not workspace-wide (ws-1 has 2)"
    );
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
      },
      {
        toolCode: "document",
        displayName: "Document generation",
        usedUnits: 3,
        limitUnits: 8,
        bonusLimitUnits: 2,
        effectiveLimitUnits: 10,
        bonusExpiresAt: "2026-06-01T00:00:00.000Z"
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
    assert.equal(result.modelCostLedger?.windowLabel, "current_quota_period");
    assert.equal(result.modelCostLedger?.periodSource, "subscription_period");
    assert.equal(result.modelCostLedger?.coverageScope, "adr099_block1_model_priced_paths");
    assert.match(result.modelCostLedger?.coverageNote ?? "", /background-task evaluator/i);
    assert.equal(result.modelCostLedger?.totalEvents, 5);
    assert.equal(result.modelCostLedger?.currencyTotals[0]?.totalCostMicros, 8450000);
    assert.equal(result.periodEconomics?.paidTotalMinor, 208800);
    assert.equal(result.periodEconomics?.paidCurrency, "RUB");
    assert.equal(result.periodEconomics?.modelCostUsdMicros, 5000000);
    assert.equal(result.periodEconomics?.periodStartedAt, "2026-05-01T00:00:00.000Z");
    assert.deepEqual(
      result.modelCostLedger?.byPurpose.map((entry) => [
        entry.key,
        entry.eventCount,
        entry.totalCostMicros
      ]),
      [
        ["chat_main_reply", 3, 7400000],
        ["router", 1, 800000],
        ["background_task", 1, 250000]
      ]
    );
    assert.deepEqual(
      result.modelCostLedger?.bySurface.map((entry) => [
        entry.key,
        entry.eventCount,
        entry.totalCostMicros
      ]),
      [
        ["web", 3, 7000000],
        ["telegram", 1, 1200000],
        ["background", 1, 250000]
      ]
    );
    assert.deepEqual(
      result.modelCostLedger?.topBreakdown.map((entry) => [
        entry.provider,
        entry.model,
        entry.purpose,
        entry.surface,
        entry.totalCostMicros
      ]),
      [
        ["openai", "gpt-4.1", "chat_main_reply", "web", 5200000],
        ["openai", "gpt-4.1-mini", "chat_main_reply", "telegram", 2200000],
        ["openai", "gpt-4.1-mini", "router", "web", 800000],
        ["openai", "gpt-4.1-mini", "background_task", "background", 250000]
      ]
    );
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
      persistedFileCount: 0,
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

    const fallbackService = createService(prisma, {
      tokenBudgetPeriodSource: null
    });
    const fallbackResult = await fallbackService.execute("admin-1", "user-1");

    assert.equal(fallbackResult.quotaUsage?.tokenBudgetPeriodSource, null);
    assert.equal(fallbackResult.modelCostLedger?.windowLabel, "current_quota_period");
    assert.equal(fallbackResult.modelCostLedger?.periodSource, "subscription_period");
    assert.equal(fallbackResult.modelCostLedger?.startedAt, "2026-05-01T00:00:00.000Z");
    assert.equal(fallbackResult.modelCostLedger?.endedAt, "2026-06-01T00:00:00.000Z");

    const ambiguousPrisma = {
      workspaceMember: {
        async findFirst(args?: { where?: { userId?: string } }) {
          assert.equal(args?.where?.userId, "user-1");
          return {
            workspaceId: "ws-1",
            activeAssistantId: null
          };
        }
      },
      assistant: {
        async findMany(args?: {
          where?: { workspaceId?: string; userId?: string };
          orderBy?: { createdAt: "asc" };
        }) {
          assert.equal(args?.where?.workspaceId, "ws-1");
          assert.equal(args?.where?.userId, "user-1");
          assert.deepEqual(args?.orderBy, { createdAt: "asc" });
          return [
            {
              id: "assistant-1",
              userId: "user-1",
              workspaceId: "ws-1",
              draftDisplayName: "Ops Helper",
              draftInstructions: null,
              draftTraits: null,
              draftAvatarEmoji: null,
              draftAvatarUrl: null,
              draftAssistantGender: null,
              draftVoiceProfile: null,
              draftArchetypeKey: null,
              draftUpdatedAt: null,
              applyStatus: "succeeded",
              applyTargetVersionId: null,
              applyAppliedVersionId: null,
              applyRequestedAt: null,
              applyStartedAt: null,
              applyFinishedAt: null,
              applyErrorCode: null,
              applyErrorMessage: null,
              configDirtyAt: null,
              sandboxEgressMode: "restricted",
              createdAt: new Date("2026-04-19T07:00:00.000Z"),
              updatedAt: new Date("2026-04-19T07:00:00.000Z"),
              publishedVersions: []
            },
            {
              id: "assistant-2",
              userId: "user-1",
              workspaceId: "ws-1",
              draftDisplayName: "Second Ops Helper",
              draftInstructions: null,
              draftTraits: null,
              draftAvatarEmoji: null,
              draftAvatarUrl: null,
              draftAssistantGender: null,
              draftVoiceProfile: null,
              draftArchetypeKey: null,
              draftUpdatedAt: null,
              applyStatus: "not_requested",
              applyTargetVersionId: null,
              applyAppliedVersionId: null,
              applyRequestedAt: null,
              applyStartedAt: null,
              applyFinishedAt: null,
              applyErrorCode: null,
              applyErrorMessage: null,
              configDirtyAt: null,
              sandboxEgressMode: "restricted",
              createdAt: new Date("2026-04-20T07:00:00.000Z"),
              updatedAt: new Date("2026-04-20T07:00:00.000Z"),
              publishedVersions: []
            }
          ];
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const ambiguousService = createService(ambiguousPrisma);
    const ambiguousResult = await ambiguousService.execute("admin-1", "user-1");

    assert.equal(ambiguousResult.assistant.exists, false);
    assert.equal(ambiguousResult.assistant.assistantId, null);
    assert.equal(ambiguousResult.assistant.assistants.length, 2);
    assert.equal(ambiguousResult.assistant.assistants[0]?.id, "assistant-1");
    assert.equal(ambiguousResult.assistant.assistants[1]?.id, "assistant-2");
    assert.equal(ambiguousResult.billingSupport, null);
    assert.equal(ambiguousResult.chatStats, null);
    assert.equal(ambiguousResult.sandbox, null);
    assert.equal(ambiguousResult.incidentSignals[0]?.code, "assistant_selection_required");
    assert.match(
      ambiguousResult.incidentSignals[0]?.message ?? "",
      /select an explicit assistant|active assistant/i
    );
  } finally {
    process.env.APP_ENV = prevEnv.APP_ENV;
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.CLERK_SECRET_KEY = prevEnv.CLERK_SECRET_KEY;
    process.env.PERSAI_INTERNAL_API_TOKEN = prevEnv.PERSAI_INTERNAL_API_TOKEN;
    process.env.PERSAI_RUNTIME_BASE_URL = prevEnv.PERSAI_RUNTIME_BASE_URL;
  }
}

void run();
