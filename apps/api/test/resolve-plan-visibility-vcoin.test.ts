/**
 * ADR-108 Slice 6a — focused tests for the `workspaceVcoinBalance` field
 * added to `ResolvePlanVisibilityService.getUserVisibility()`.
 *
 * Tests isolated from the full service to avoid wiring the complete
 * dependency graph; only the Vcoin-relevant dependencies are mocked
 * precisely.
 */
import assert from "node:assert/strict";
import { ResolvePlanVisibilityService } from "../src/modules/workspace-management/application/resolve-plan-visibility.service";

// Minimal stub that satisfies the constructor signature.
function createService(overrides: {
  resolveActiveAssistantService?: object;
  assistantGovernanceRepository?: object;
  assistantPlanCatalogRepository?: object;
  workspaceVcoinBalanceRepository?: object;
  resolveEffectiveSubscriptionStateService?: object;
  resolveEffectiveCapabilityStateService?: object;
  trackWorkspaceQuotaUsageService?: object;
  adminAuthorizationService?: object;
  manageAdminPlansService?: object;
  manageMediaPackageCatalogService?: object;
  resolvePlatformRuntimeProviderSettingsService?: object;
}): ResolvePlanVisibilityService {
  return new ResolvePlanVisibilityService(
    (overrides.resolveActiveAssistantService ?? {}) as never,
    (overrides.assistantGovernanceRepository ?? {}) as never,
    (overrides.assistantPlanCatalogRepository ?? {}) as never,
    (overrides.workspaceVcoinBalanceRepository ?? {}) as never,
    (overrides.resolveEffectiveSubscriptionStateService ?? {}) as never,
    (overrides.resolveEffectiveCapabilityStateService ?? {}) as never,
    (overrides.trackWorkspaceQuotaUsageService ?? {}) as never,
    (overrides.adminAuthorizationService ?? {}) as never,
    (overrides.manageAdminPlansService ?? {}) as never,
    (overrides.manageMediaPackageCatalogService ?? {}) as never,
    (overrides.resolvePlatformRuntimeProviderSettingsService ?? {}) as never
  );
}

/** Minimal quota snapshot used across tests. */
const minimalQuotaSnapshot = {
  buckets: []
};

/** Minimal token-budget snapshot. */
const minimalTokenBudget = {
  periodStartedAt: null,
  periodEndsAt: null,
  periodSource: null,
  limitCredits: null
};

/** Minimal effective capabilities. */
const minimalCapabilities = {
  toolClasses: { costDriving: { allowed: true }, utility: { allowed: true } },
  channelsAndSurfaces: { webChat: true, telegram: false, whatsapp: false, max: false }
};

/** Minimal subscription state for a paid plan. */
function makeSubscription(planCode: string | null) {
  return {
    planCode,
    source: "workspace_subscription" as const,
    status: "active" as const,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    currentPeriodEndsAt: null
  };
}

async function run(): Promise<void> {
  // ── Case 1: Active workspace with balance=250, grant=1000, exchangeRate=20 ──
  {
    const service = createService({
      resolveActiveAssistantService: {
        async execute() {
          return {
            assistant: {
              id: "ast-1",
              userId: "user-1",
              workspaceId: "ws-1"
            }
          };
        }
      },
      assistantGovernanceRepository: {
        async findByAssistantId() {
          return { assistantPlanOverrideCode: null, quotaPlanCode: null };
        }
      },
      resolveEffectiveSubscriptionStateService: {
        async execute() {
          return makeSubscription("pro");
        }
      },
      assistantPlanCatalogRepository: {
        async findByCode(code: string) {
          if (code !== "pro") return null;
          return {
            id: "plan-pro",
            code: "pro",
            displayName: "Pro",
            description: "Pro plan",
            status: "active",
            billingProviderHints: { videoVcoinMonthlyGrant: 1000 },
            toolActivations: [],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      },
      workspaceVcoinBalanceRepository: {
        async getOrCreate(workspaceId: string) {
          assert.equal(workspaceId, "ws-1", "balance repo called with correct workspaceId");
          return { workspaceId, balanceVc: 250, updatedAt: new Date() };
        }
      },
      resolveEffectiveCapabilityStateService: {
        async execute() {
          return minimalCapabilities;
        }
      },
      trackWorkspaceQuotaUsageService: {
        async resolveAssistantQuotaSnapshot() {
          return minimalQuotaSnapshot;
        },
        async resolveAssistantTokenBudgetQuotaSnapshot() {
          return minimalTokenBudget;
        },
        async resolveAssistantMonthlyToolQuotaSnapshot() {
          return [];
        },
        async checkToolDailyLimit() {
          return { currentCount: 0, periodStartedAt: null, periodEndsAt: null, periodSource: null };
        }
      },
      manageAdminPlansService: {
        async listPublicPricingPlans() {
          return [];
        }
      },
      manageMediaPackageCatalogService: {
        async listPublic() {
          return [];
        }
      },
      resolvePlatformRuntimeProviderSettingsService: {
        async execute() {
          return { vcoinExchangeRate: 20 };
        }
      }
    });

    const result = await service.getUserVisibility("user-1");
    assert.ok(result.workspaceVcoinBalance, "workspaceVcoinBalance field present");
    assert.equal(result.workspaceVcoinBalance.balanceVc, 250, "balanceVc = 250");
    assert.equal(result.workspaceVcoinBalance.videoVcoinMonthlyGrant, 1000, "grant = 1000");
    assert.equal(result.workspaceVcoinBalance.vcoinExchangeRate, 20, "exchangeRate = 20");
  }

  // ── Case 2: Plan is null (subscription has no plan code) → default VC values ──
  {
    const service = createService({
      resolveActiveAssistantService: {
        async execute() {
          return {
            assistant: {
              id: "ast-2",
              userId: "user-2",
              workspaceId: "ws-2"
            }
          };
        }
      },
      assistantGovernanceRepository: {
        async findByAssistantId() {
          return { assistantPlanOverrideCode: null, quotaPlanCode: null };
        }
      },
      resolveEffectiveSubscriptionStateService: {
        async execute() {
          return makeSubscription(null);
        }
      },
      assistantPlanCatalogRepository: {
        async findByCode() {
          return null;
        }
      },
      workspaceVcoinBalanceRepository: {
        async getOrCreate(workspaceId: string) {
          assert.equal(workspaceId, "ws-2");
          return { workspaceId, balanceVc: 0, updatedAt: new Date() };
        }
      },
      resolveEffectiveCapabilityStateService: {
        async execute() {
          return minimalCapabilities;
        }
      },
      trackWorkspaceQuotaUsageService: {
        async resolveAssistantQuotaSnapshot() {
          return minimalQuotaSnapshot;
        },
        async resolveAssistantTokenBudgetQuotaSnapshot() {
          return minimalTokenBudget;
        },
        async resolveAssistantMonthlyToolQuotaSnapshot() {
          return [];
        },
        async checkToolDailyLimit() {
          return { currentCount: 0, periodStartedAt: null, periodEndsAt: null, periodSource: null };
        }
      },
      manageAdminPlansService: {
        async listPublicPricingPlans() {
          return [];
        }
      },
      manageMediaPackageCatalogService: {
        async listPublic() {
          return [];
        }
      },
      resolvePlatformRuntimeProviderSettingsService: {
        async execute() {
          return { vcoinExchangeRate: 20 };
        }
      }
    });

    const result = await service.getUserVisibility("user-2");
    assert.equal(
      result.workspaceVcoinBalance.balanceVc,
      0,
      "no plan → balanceVc defaults to 0 (empty wallet)"
    );
    assert.equal(
      result.workspaceVcoinBalance.videoVcoinMonthlyGrant,
      0,
      "no plan → grant defaults to 0"
    );
    assert.equal(
      result.workspaceVcoinBalance.vcoinExchangeRate,
      20,
      "platform default exchange rate 20 used"
    );
  }

  // ── Case 3: Non-default exchange rate of 25 round-trips correctly ──
  {
    const service = createService({
      resolveActiveAssistantService: {
        async execute() {
          return {
            assistant: {
              id: "ast-3",
              userId: "user-3",
              workspaceId: "ws-3"
            }
          };
        }
      },
      assistantGovernanceRepository: {
        async findByAssistantId() {
          return { assistantPlanOverrideCode: null, quotaPlanCode: null };
        }
      },
      resolveEffectiveSubscriptionStateService: {
        async execute() {
          return makeSubscription("standard");
        }
      },
      assistantPlanCatalogRepository: {
        async findByCode() {
          return {
            id: "plan-std",
            code: "standard",
            displayName: "Standard",
            description: null,
            status: "active",
            billingProviderHints: { videoVcoinMonthlyGrant: 500 },
            toolActivations: [],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      },
      workspaceVcoinBalanceRepository: {
        async getOrCreate(workspaceId: string) {
          return { workspaceId, balanceVc: 75, updatedAt: new Date() };
        }
      },
      resolveEffectiveCapabilityStateService: {
        async execute() {
          return minimalCapabilities;
        }
      },
      trackWorkspaceQuotaUsageService: {
        async resolveAssistantQuotaSnapshot() {
          return minimalQuotaSnapshot;
        },
        async resolveAssistantTokenBudgetQuotaSnapshot() {
          return minimalTokenBudget;
        },
        async resolveAssistantMonthlyToolQuotaSnapshot() {
          return [];
        },
        async checkToolDailyLimit() {
          return { currentCount: 0, periodStartedAt: null, periodEndsAt: null, periodSource: null };
        }
      },
      manageAdminPlansService: {
        async listPublicPricingPlans() {
          return [];
        }
      },
      manageMediaPackageCatalogService: {
        async listPublic() {
          return [];
        }
      },
      resolvePlatformRuntimeProviderSettingsService: {
        async execute() {
          return { vcoinExchangeRate: 25 };
        }
      }
    });

    const result = await service.getUserVisibility("user-3");
    assert.equal(result.workspaceVcoinBalance.balanceVc, 75, "balanceVc = 75");
    assert.equal(result.workspaceVcoinBalance.videoVcoinMonthlyGrant, 500, "grant = 500");
    assert.equal(
      result.workspaceVcoinBalance.vcoinExchangeRate,
      25,
      "non-default exchange rate 25 round-trips"
    );
  }
}

void run();
