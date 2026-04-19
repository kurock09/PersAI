import assert from "node:assert/strict";
import { PrismaAssistantPlanCatalogRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository";
import type { AssistantPlanCatalogWriteInput } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";

async function run(): Promise<void> {
  const repo = new PrismaAssistantPlanCatalogRepository({
    planCatalogPlan: {
      async findMany() {
        return [
          {
            id: "plan-1",
            code: "starter",
            displayName: "Starter",
            description: null,
            status: "active",
            billingProviderHints: null,
            entitlement: null,
            toolActivations: [
              {
                activationStatus: "active",
                dailyCallLimit: null,
                tool: {
                  code: "edit_file",
                  displayName: "Edit File",
                  toolClass: "utility"
                }
              },
              {
                activationStatus: "active",
                dailyCallLimit: null,
                tool: {
                  code: "files",
                  displayName: "Files",
                  toolClass: "utility"
                }
              }
            ],
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date("2026-04-19T20:00:00.000Z"),
            updatedAt: new Date("2026-04-19T20:00:00.000Z")
          }
        ];
      }
    }
  } as never);

  const plans = await repo.listAll();
  assert.deepEqual(
    plans[0]?.toolActivations.map((activation) => activation.toolCode),
    ["files"]
  );

  const syncRepo = new PrismaAssistantPlanCatalogRepository({} as never);
  const observedQueries: Array<Record<string, unknown>> = [];
  const upsertedToolIds: string[] = [];
  const writeInput: AssistantPlanCatalogWriteInput = {
    displayName: "Starter",
    description: null,
    status: "active",
    isDefaultFirstRegistrationPlan: false,
    isTrialPlan: false,
    trialDurationDays: null,
    billingProviderHints: null,
    entitlementModel: {
      schemaVersion: 1,
      capabilities: [],
      toolClasses: [
        { key: "utility", allowed: true },
        { key: "cost_driving", allowed: false }
      ],
      channelsAndSurfaces: [],
      mediaClasses: [],
      limitsPermissions: []
    },
    toolActivationOverrides: [
      {
        toolCode: "files",
        active: true,
        dailyCallLimit: 12
      }
    ]
  };

  await (
    syncRepo as unknown as {
      syncToolActivationsForPlan(
        tx: {
          toolCatalogTool: {
            findMany(
              input: Record<string, unknown>
            ): Promise<Array<{ id: string; code: string; toolClass: "utility" | "cost_driving" }>>;
          };
          planCatalogToolActivation: {
            deleteMany(input: Record<string, unknown>): Promise<{ count: number }>;
            upsert(input: Record<string, unknown>): Promise<void>;
          };
        },
        planId: string,
        input: AssistantPlanCatalogWriteInput
      ): Promise<void>;
    }
  ).syncToolActivationsForPlan(
    {
      toolCatalogTool: {
        async findMany(input: Record<string, unknown>) {
          observedQueries.push(input);
          return [
            { id: "tool-files", code: "files", toolClass: "utility" },
            { id: "tool-shell", code: "shell", toolClass: "cost_driving" }
          ];
        }
      },
      planCatalogToolActivation: {
        async deleteMany() {
          return { count: 0 };
        },
        async upsert(input: Record<string, unknown>) {
          upsertedToolIds.push(
            (
              (input.where as { planId_toolId: { toolId: string } }).planId_toolId.toolId ?? ""
            ).trim()
          );
        }
      }
    },
    "plan-1",
    writeInput
  );

  const queryWhere = observedQueries[0]?.where as {
    status?: string;
    code?: { in?: string[] };
  };
  assert.equal(queryWhere.status, "active");
  assert.equal(queryWhere.code?.in?.includes("files"), true);
  assert.equal(queryWhere.code?.in?.includes("shell"), true);
  assert.equal(queryWhere.code?.in?.includes("read_file"), false);
  assert.equal(queryWhere.code?.in?.includes("write_file"), false);
  assert.equal(queryWhere.code?.in?.includes("edit_file"), false);
  assert.equal(queryWhere.code?.in?.includes("send_media_to_user"), false);
  assert.deepEqual(upsertedToolIds, ["tool-files", "tool-shell"]);
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
