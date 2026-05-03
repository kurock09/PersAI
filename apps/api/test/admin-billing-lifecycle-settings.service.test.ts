import assert from "node:assert/strict";
import { ManageAdminBillingLifecycleSettingsService } from "../src/modules/workspace-management/application/manage-admin-billing-lifecycle-settings.service";
import { DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY } from "../src/modules/workspace-management/application/billing-lifecycle-settings";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";

async function run(): Promise<void> {
  const audits: Array<Record<string, unknown>> = [];
  const service = new ManageAdminBillingLifecycleSettingsService(
    {
      billingLifecycleSettings: {
        async upsert(args: {
          create: { gracePeriodDays: number; globalFallbackPlanCode?: string | null };
          update: { gracePeriodDays?: number; globalFallbackPlanCode?: string | null };
        }) {
          return {
            id: "global",
            gracePeriodDays: args.update.gracePeriodDays ?? args.create.gracePeriodDays,
            globalFallbackPlanCode:
              args.update.globalFallbackPlanCode ?? args.create.globalFallbackPlanCode ?? null,
            metadata: { notificationPolicy: DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY },
            updatedByUserId: "admin-1",
            createdAt: new Date(),
            updatedAt: new Date("2026-05-03T00:00:00.000Z")
          };
        }
      },
      planCatalogPlan: {
        async findUnique(args: { where: { code: string } }) {
          return args.where.code === "starter" ? { status: "active" } : null;
        }
      }
    } as never,
    {
      async assertCanReadAdminSurface() {
        return {} as never;
      },
      async assertCanPerformDangerousAdminAction() {
        return {} as never;
      }
    } as Pick<
      AdminAuthorizationService,
      "assertCanReadAdminSurface" | "assertCanPerformDangerousAdminAction"
    > as AdminAuthorizationService,
    {
      async execute(input: Record<string, unknown>) {
        audits.push(input);
      }
    } as Pick<AppendAssistantAuditEventService, "execute"> as AppendAssistantAuditEventService
  );

  assert.deepEqual(service.parseUpdateInput({ gracePeriodDays: 5, globalFallbackPlanCode: "" }), {
    gracePeriodDays: 5,
    globalFallbackPlanCode: null,
    notificationPolicy: DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY
  });
  assert.throws(() =>
    service.parseUpdateInput({ gracePeriodDays: 0, globalFallbackPlanCode: null })
  );

  const updated = await service.updateSettings(
    "admin-1",
    {
      gracePeriodDays: 5,
      globalFallbackPlanCode: "starter",
      notificationPolicy: DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY
    },
    "step-up"
  );
  assert.equal(updated.gracePeriodDays, 5);
  assert.equal(updated.globalFallbackPlanCode, "starter");
  assert.equal(audits[0]?.eventCode, "admin.billing_lifecycle_settings_updated");

  await assert.rejects(
    () =>
      service.updateSettings(
        "admin-1",
        {
          gracePeriodDays: 5,
          globalFallbackPlanCode: "missing",
          notificationPolicy: DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY
        },
        "step-up"
      ),
    /globalFallbackPlanCode must reference an active plan/
  );
}

void run();
