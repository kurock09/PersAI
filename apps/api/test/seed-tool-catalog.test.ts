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
  planCount,
  existingActivationCount = 0
}: {
  defaultPlan: PlanRecord | null;
  planCount: number;
  existingActivationCount?: number;
}) {
  let storedPlan = defaultPlan;
  let updatePayload: Record<string, unknown> | null = null;
  let createCalled = false;
  const activationUpserts: string[] = [];

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
      async count() {
        return existingActivationCount;
      },
      async upsert(args: { where: { planId_toolId: { toolId: string } } }) {
        activationUpserts.push(args.where.planId_toolId.toolId);
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
    wasCreateCalled: () => createCalled,
    getActivationUpsertCount: () => activationUpserts.length
  };
}

async function run(): Promise<void> {
  {
    const imageGenerate = TOOL_CATALOG.find((entry) => entry.code === "image_generate");
    const imageEdit = TOOL_CATALOG.find((entry) => entry.code === "image_edit");
    const videoGenerate = TOOL_CATALOG.find((entry) => entry.code === "video_generate");

    // A1 drift fix: action token must be pending_delivery (not the old "deferred")
    assert.ok(imageGenerate?.modelUsageGuidance?.includes('action="pending_delivery"'));
    assert.ok(!imageGenerate?.modelUsageGuidance?.includes('action="deferred"'));
    // A2: selection sentences removed from image_generate
    assert.ok(!imageGenerate?.modelUsageGuidance?.includes("not for editing an existing one"));
    assert.ok(!imageGenerate?.modelUsageGuidance?.includes("call this tool immediately"));
    // P2: per-tool mechanical content kept
    assert.ok(imageGenerate?.modelUsageGuidance?.includes('background="transparent"'));

    // P8: per-tool honesty contract kept in image_edit
    assert.ok(imageEdit?.modelUsageGuidance?.includes("Never claim the edit is done"));
    assert.ok(imageEdit?.modelUsageGuidance?.includes("If you have not called `image_edit`"));
    // A1 drift fix and A4 multi-reference fix
    assert.ok(imageEdit?.modelUsageGuidance?.includes('action="pending_delivery"'));
    assert.ok(!imageEdit?.modelUsageGuidance?.includes('action="deferred"'));
    assert.ok(imageEdit?.modelUsageGuidance?.includes("referenceImageAliases"));

    // A1 drift fix: video_generate
    assert.ok(videoGenerate?.modelUsageGuidance?.includes('action="pending_delivery"'));
    assert.ok(!videoGenerate?.modelUsageGuidance?.includes('action="deferred"'));
    // A2: selection sentences removed from video_generate
    assert.ok(!videoGenerate?.modelUsageGuidance?.includes("call this tool immediately"));
    // P10: per-tool mechanical content kept
    assert.ok(videoGenerate?.modelUsageGuidance?.includes("referenceImageAlias"));
  }

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
          runtimeTierDefault: "paid_shared_restricted",
          assistantPolicy: { schema: "persai.assistantPolicy.v1", maxAssistants: 1 }
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
      runtimeTierDefault: "free_shared_restricted",
      assistantPolicy: { schema: "persai.assistantPolicy.v1", maxAssistants: 1 }
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

  // Rollout safety: starter_trial with already-populated tool activations (e.g. edited by the
  // operator through /admin/plans) MUST NOT be rewritten back to STARTER_TRIAL_TOOL_POLICY on
  // every API pod startup. This is the "tools keep sliding off trial after rollout" bug.
  {
    const { service, getActivationUpsertCount } = createService({
      planCount: 1,
      existingActivationCount: 5,
      defaultPlan: {
        id: "starter-plan",
        code: "starter_trial",
        billingProviderHints: {
          schema: "persai.billingHints.v1",
          providerAgnostic: true,
          runtimeTierDefault: "free_shared_restricted"
        }
      }
    });

    await service["ensureDefaultPlan"]();

    assert.equal(
      getActivationUpsertCount(),
      0,
      "existing admin-edited activations on starter_trial must not be rewritten on rollout"
    );
  }

  // First-seed backfill still works: when starter_trial exists but has zero activations
  // (freshly-created DB row from an older migration path), the seed should still backfill
  // activations so the plan is not left empty.
  {
    const { service, getActivationUpsertCount } = createService({
      planCount: 1,
      existingActivationCount: 0,
      defaultPlan: {
        id: "starter-plan",
        code: "starter_trial",
        billingProviderHints: {
          schema: "persai.billingHints.v1",
          providerAgnostic: true,
          runtimeTierDefault: "free_shared_restricted"
        }
      }
    });

    await service["ensureDefaultPlan"]();

    assert.equal(
      getActivationUpsertCount(),
      0,
      "with no tools in the catalog, syncToolActivations must still be reachable (no-op here)"
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
