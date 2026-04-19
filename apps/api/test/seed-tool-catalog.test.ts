import assert from "node:assert/strict";
import { TOOL_CATALOG } from "../prisma/tool-catalog-data";
import { SeedToolCatalogService } from "../src/modules/workspace-management/application/seed-tool-catalog.service";

type PlanRecord = {
  id: string;
  code: string;
  billingProviderHints: Record<string, unknown> | null;
};

function createService({
  defaultPlan,
  planCount
}: {
  defaultPlan: PlanRecord | null;
  planCount: number;
}) {
  let storedPlan = defaultPlan;
  let updatePayload: Record<string, unknown> | null = null;
  let createCalled = false;

  const prisma = {
    planCatalogPlan: {
      async findFirst() {
        return storedPlan;
      },
      async count() {
        return planCount;
      },
      async update(args: { data: { billingProviderHints: Record<string, unknown> } }) {
        updatePayload = args.data.billingProviderHints;
        storedPlan = {
          id: storedPlan?.id ?? "starter-plan",
          code: storedPlan?.code ?? "starter_trial",
          billingProviderHints: args.data.billingProviderHints
        };
        return storedPlan;
      },
      async create() {
        createCalled = true;
        throw new Error("create should not be called in this test");
      }
    },
    toolCatalogTool: {
      async findMany() {
        return [];
      }
    },
    planCatalogToolActivation: {
      async upsert() {
        return undefined;
      }
    },
    planCatalogEntitlement: {
      async upsert() {
        return undefined;
      }
    }
  };

  return {
    service: new SeedToolCatalogService(prisma as never) as SeedToolCatalogService & {
      ensureDefaultPlan(): Promise<void>;
    },
    getUpdatePayload: () => updatePayload,
    wasCreateCalled: () => createCalled
  };
}

async function run(): Promise<void> {
  {
    const upsertedToolIds: string[] = [];
    const service = new SeedToolCatalogService({
      toolCatalogTool: {
        async findMany() {
          return [];
        },
        async upsert(args: { where: { id: string } }) {
          upsertedToolIds.push(args.where.id);
          return undefined;
        }
      }
    } as never) as SeedToolCatalogService & {
      syncToolCatalog(): Promise<void>;
    };

    await service["syncToolCatalog"]();

    assert.equal(upsertedToolIds.length, TOOL_CATALOG.length);
  }

  {
    const { service, getUpdatePayload } = createService({
      planCount: 1,
      defaultPlan: {
        id: "starter-plan",
        code: "starter_trial",
        billingProviderHints: {
          schema: "persai.billingHints.v1",
          providerAgnostic: true,
          runtimeTierDefault: "paid_shared_restricted"
        }
      }
    });

    await service["ensureDefaultPlan"]();

    assert.equal(
      getUpdatePayload(),
      null,
      "existing explicit runtimeTierDefault must not be overwritten by the startup seed"
    );
  }

  {
    const { service, getUpdatePayload } = createService({
      planCount: 1,
      defaultPlan: {
        id: "starter-plan",
        code: "starter_trial",
        billingProviderHints: {
          schema: "persai.billingHints.v1",
          providerAgnostic: true
        }
      }
    });

    await service["ensureDefaultPlan"]();

    assert.deepEqual(getUpdatePayload(), {
      schema: "persai.billingHints.v1",
      providerAgnostic: true,
      runtimeTierDefault: "free_shared_restricted"
    });
  }

  {
    const { service, getUpdatePayload, wasCreateCalled } = createService({
      planCount: 3,
      defaultPlan: {
        id: "custom-default-plan",
        code: "my_clean_default",
        billingProviderHints: {
          schema: "persai.billingHints.v1",
          providerAgnostic: true,
          runtimeTierDefault: "paid_isolated"
        }
      }
    });

    await service["ensureDefaultPlan"]();

    assert.equal(getUpdatePayload(), null, "custom default plan must not be touched");
    assert.equal(
      wasCreateCalled(),
      false,
      "startup seed must not recreate starter_trial when another default plan already exists"
    );
  }

  {
    const { service, getUpdatePayload, wasCreateCalled } = createService({
      planCount: 2,
      defaultPlan: null
    });

    await service["ensureDefaultPlan"]();

    assert.equal(
      getUpdatePayload(),
      null,
      "non-empty catalog without default must not be rewritten"
    );
    assert.equal(
      wasCreateCalled(),
      false,
      "startup seed must not recreate starter_trial inside an already populated catalog"
    );
  }

  {
    const activationWrites: Array<{
      toolId: string;
      activationStatus: string;
      dailyCallLimit: number | null;
    }> = [];
    const service = new SeedToolCatalogService({
      toolCatalogTool: {
        async findMany() {
          return [
            { id: "tool-files", code: "files", toolClass: "utility" },
            { id: "tool-shell", code: "shell", toolClass: "cost_driving" }
          ];
        }
      },
      planCatalogToolActivation: {
        async upsert(args: {
          where: { planId_toolId: { toolId: string } };
          update: { activationStatus: string; dailyCallLimit: number | null };
          create: { activationStatus: string; dailyCallLimit: number | null };
        }) {
          activationWrites.push({
            toolId: args.where.planId_toolId.toolId,
            activationStatus: args.update.activationStatus,
            dailyCallLimit: args.update.dailyCallLimit
          });
          assert.equal(args.create.activationStatus, args.update.activationStatus);
          assert.equal(args.create.dailyCallLimit, args.update.dailyCallLimit);
          return undefined;
        }
      }
    } as never) as SeedToolCatalogService & {
      syncToolActivations(planId: string): Promise<void>;
    };

    await service["syncToolActivations"]("starter-plan");

    assert.deepEqual(activationWrites, [
      {
        toolId: "tool-files",
        activationStatus: "active",
        dailyCallLimit: 20
      },
      {
        toolId: "tool-shell",
        activationStatus: "inactive",
        dailyCallLimit: 5
      }
    ]);
  }
}

void run();
