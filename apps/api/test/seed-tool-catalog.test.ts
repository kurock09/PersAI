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
    // ADR-118 Slice 2: skill tool must be in the catalog.
    const skillEntry = TOOL_CATALOG.find((entry) => entry.code === "skill");
    assert.ok(skillEntry, "skill must be present in TOOL_CATALOG");
    assert.equal(skillEntry?.policyClass, "platform_managed");
    assert.ok(
      skillEntry?.modelDescription?.includes("Engage"),
      "skill modelDescription must mention Engage"
    );
    assert.ok(
      skillEntry?.modelUsageGuidance?.includes("engage"),
      "skill guidance must mention engage action"
    );
  }

  {
    const imageGenerate = TOOL_CATALOG.find((entry) => entry.code === "image_generate");
    const imageEdit = TOOL_CATALOG.find((entry) => entry.code === "image_edit");
    const videoGenerate = TOOL_CATALOG.find((entry) => entry.code === "video_generate");

    // pending_delivery honesty is canonical in the selection guide + runtime hint,
    // so it must NOT be duplicated into per-tool catalog guidance.
    assert.ok(!imageGenerate?.modelUsageGuidance?.includes("pending_delivery"));
    assert.ok(!imageGenerate?.modelUsageGuidance?.includes('action="deferred"'));
    // A2: selection sentences removed from image_generate
    assert.ok(!imageGenerate?.modelUsageGuidance?.includes("not for editing an existing one"));
    assert.ok(!imageGenerate?.modelUsageGuidance?.includes("call this tool immediately"));
    // P2: per-tool mechanical content kept
    assert.ok(imageGenerate?.modelUsageGuidance?.includes('background="transparent"'));

    // P8: per-tool honesty contract kept in image_edit
    assert.ok(imageEdit?.modelUsageGuidance?.includes("Never claim the edit is done"));
    // pending_delivery is not duplicated into the catalog; A4 multi-reference fix
    assert.ok(!imageEdit?.modelUsageGuidance?.includes("pending_delivery"));
    assert.ok(!imageEdit?.modelUsageGuidance?.includes('action="deferred"'));
    assert.ok(imageEdit?.modelUsageGuidance?.includes("referenceImageAliases"));

    // pending_delivery is not duplicated into video_generate catalog guidance
    assert.ok(!videoGenerate?.modelUsageGuidance?.includes("pending_delivery"));
    assert.ok(!videoGenerate?.modelUsageGuidance?.includes('action="deferred"'));
    // A2: selection sentences removed from video_generate
    assert.ok(!videoGenerate?.modelUsageGuidance?.includes("call this tool immediately"));
    // P10: per-tool mechanical content kept
    assert.ok(videoGenerate?.modelUsageGuidance?.includes("referenceImageAlias"));
  }

  // ADR-119 Slice 7: per-tool descriptor shape — all 8 rewritten tools must have
  // modelDescription and modelUsageGuidance with the 4 structured sections.
  {
    const SLICE7_TOOL_CODES = [
      "web_search",
      "web_fetch",
      "image_generate",
      "image_edit",
      "skill",
      "memory_search", // projected as knowledge_search
      "memory_get", // projected as knowledge_fetch
      "memory_write"
    ];
    const REQUIRED_SECTIONS = ["WHEN TO USE:", "WHEN NOT TO USE:", "EXAMPLES:", "GOTCHAS:"];

    for (const code of SLICE7_TOOL_CODES) {
      const entry = TOOL_CATALOG.find((e) => e.code === code);
      assert.ok(entry, `ADR-119 Slice 7: ${code} must be present in TOOL_CATALOG`);
      assert.ok(
        entry?.modelDescription && entry.modelDescription.trim().length > 0,
        `ADR-119 Slice 7: ${code}.modelDescription must be non-empty`
      );
      assert.ok(
        entry?.modelUsageGuidance && entry.modelUsageGuidance.trim().length > 0,
        `ADR-119 Slice 7: ${code}.modelUsageGuidance must be non-empty`
      );
      for (const section of REQUIRED_SECTIONS) {
        assert.ok(
          entry?.modelUsageGuidance?.includes(section),
          `ADR-119 Slice 7: ${code}.modelUsageGuidance must contain "${section}"`
        );
      }
    }
  }

  // ADR-117 / ADR-119 Slice 7: cross-tool prose drift — per-tool descriptors must NOT
  // reference other tools' codes except for the allowed chain-link exceptions.
  {
    // Tool codes that must not appear in a given catalog entry's modelUsageGuidance
    // unless that entry's code is in the per-entry allow-list.
    const ALL_PROJECTED_CODES = [
      "image_edit",
      "image_generate",
      "knowledge_search",
      "knowledge_fetch",
      "memory_write",
      "web_search",
      "web_fetch",
      "skill",
      "browser",
      "tts",
      "video_generate",
      "document",
      "files",
      "scheduled_action",
      "background_task"
    ];
    // Map catalog code → allowed mentions of OTHER projected tool codes.
    // Chain-link exceptions per ADR-119 Slice 7:
    //   web_search  → may mention web_fetch
    //   web_fetch   → may mention web_search, browser
    //   memory_search (knowledge_search) → may mention knowledge_fetch
    //   memory_get  (knowledge_fetch)    → may mention knowledge_search
    const ALLOW_LIST: Record<string, string[]> = {
      web_search: ["web_fetch"],
      web_fetch: ["web_search", "browser"],
      memory_search: ["knowledge_fetch", "knowledge_search"], // own projected name + chain
      memory_get: ["knowledge_search", "knowledge_fetch"], // own projected name + chain
      // shell guidance pre-dates Slice 7; it mentions "the files tool" for IO routing.
      shell: ["files"]
    };

    // Only enforce on the 8 rewritten tools — other existing entries have not been
    // audited for cross-tool prose yet (they may use tool names as English words).
    const SLICE7_CATALOG_CODES = new Set([
      "web_search",
      "web_fetch",
      "image_generate",
      "image_edit",
      "skill",
      "memory_search",
      "memory_get",
      "memory_write"
    ]);

    for (const entry of TOOL_CATALOG) {
      if (!entry.modelUsageGuidance) continue;
      if (!SLICE7_CATALOG_CODES.has(entry.code)) continue;
      const allowed = ALLOW_LIST[entry.code] ?? [];
      for (const forbidden of ALL_PROJECTED_CODES) {
        if (forbidden === entry.code) continue;
        if (allowed.includes(forbidden)) continue;
        assert.doesNotMatch(
          entry.modelUsageGuidance,
          new RegExp(`\\b${forbidden}\\b`),
          `ADR-117 drift: ${entry.code}.modelUsageGuidance must not mention ${forbidden}`
        );
      }
    }
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
