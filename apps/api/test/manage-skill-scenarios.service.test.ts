import assert from "node:assert/strict";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ManageSkillScenariosService } from "../src/modules/workspace-management/application/manage-skill-scenarios.service";

const ADMIN_USER = "user-admin";

const VALID_STEP = {
  number: 1,
  directive: "CALL image_generate with outputMode=series, count=8",
  recommendedToolCall: "image_generate",
  mayBeSkippedIf: null,
  negativeGuards: ["Do NOT collapse into one call"]
};

const VALID_CREATE_INPUT = {
  key: "instagram_carousel",
  displayName: { ru: "Карусель Instagram", en: "Instagram Carousel" },
  description: { ru: "8 слайдов для Instagram", en: "8 slides for Instagram" },
  iconEmoji: "🎠",
  intentExamples: ["сделай карусель", "make a carousel"],
  steps: [VALID_STEP],
  recommendedTools: ["image_generate"],
  exitCondition: "All 8 slides generated and confirmed by user.",
  status: null,
  displayOrder: null
};

function buildMockScenario(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-16T14:00:00.000Z");
  return {
    id: "scenario-1",
    skillId: "skill-1",
    key: "instagram_carousel",
    displayName: { ru: "Карусель Instagram", en: "Instagram Carousel" },
    description: { ru: "8 слайдов для Instagram", en: "8 slides for Instagram" },
    iconEmoji: "🎠",
    intentExamples: ["сделай карусель"],
    steps: [VALID_STEP],
    recommendedTools: ["image_generate"],
    exitCondition: "All slides generated.",
    status: "draft",
    displayOrder: 100,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function buildHarness(skillExists = true) {
  const scenarios = new Map<string, ReturnType<typeof buildMockScenario>>();
  const assistantDirtyUpdates: string[] = [];
  const chatStateResets: Array<Record<string, unknown>> = [];
  const operations: string[] = [];
  let roleReads = 0;
  let nextId = 1;

  const adminAuth = {
    async assertCanReadAdminSurface(_userId: string) {
      return { userId: _userId };
    },
    async assertCanWriteGlobalKnowledge(_userId: string) {
      return { userId: _userId };
    }
  };

  const prisma = {
    assistantRole: {
      async findMany() {
        roleReads += 1;
        operations.push(roleReads % 2 === 1 ? "role:discover" : "role:revalidate");
        return [{ id: "role-2" }, { id: "role-1" }];
      }
    },
    skill: {
      async findFirst({ where }: { where: { id: string } }) {
        return skillExists ? { id: where.id } : null;
      },
      async findUnique({ where }: { where: { id: string } }) {
        operations.push("skill:read");
        return skillExists ? { id: where.id } : null;
      }
    },
    skillScenario: {
      async findMany({
        where,
        orderBy
      }: {
        where: {
          skillId: string;
          status?: unknown;
        };
        orderBy: unknown;
      }) {
        void orderBy;
        return [...scenarios.values()].filter((s) => {
          if (s.skillId !== where.skillId) return false;
          if (
            where.status !== undefined &&
            typeof where.status === "object" &&
            where.status !== null &&
            "not" in (where.status as Record<string, unknown>)
          ) {
            return s.status !== (where.status as { not: string }).not;
          }
          return true;
        });
      },
      async findFirst({ where }: { where: { skillId?: string; key?: string } }) {
        operations.push("scenario:read");
        for (const s of scenarios.values()) {
          if (where.skillId !== undefined && s.skillId !== where.skillId) continue;
          if (where.key !== undefined && s.key !== where.key) continue;
          return s;
        }
        return null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        operations.push("scenario:create");
        const id = `scenario-${nextId++}`;
        const now = new Date();
        const row = buildMockScenario({
          id,
          ...data,
          createdAt: now,
          updatedAt: now
        });
        scenarios.set(id, row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        operations.push("scenario:update");
        const existing = scenarios.get(where.id);
        if (!existing) throw new Error(`Scenario ${where.id} not found`);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        scenarios.set(where.id, updated);
        return updated;
      }
    },
    assistant: {
      async findMany() {
        operations.push("assistant:discover");
        return [{ id: "assistant-2" }, { id: "assistant-1" }];
      },
      async updateMany({ where, data }: { where: unknown; data: { configDirtyAt: Date } }) {
        void where;
        operations.push("assistant:update");
        assistantDirtyUpdates.push(data.configDirtyAt.toISOString());
      }
    },
    assistantChat: {
      async updateMany({
        where,
        data
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) {
        operations.push("chat:update");
        chatStateResets.push({ where, data });
      }
    },
    async $queryRaw<T>(query: {
      strings?: readonly string[];
      values?: readonly unknown[];
    }): Promise<T> {
      const sql = (query.strings ?? []).join("?").replace(/\s+/g, " ").trim();
      if (sql.includes("clock_timestamp()")) {
        operations.push("database:clock");
        return [{ dirtyAt: new Date("2026-07-14T00:00:30.000Z") }] as T;
      }
      if (sql.includes('FROM "assistant_roles"')) {
        operations.push("role:lock");
        assert.match(sql, /ORDER BY "id" FOR UPDATE$/);
        assert.deepEqual(query.values, ["role-1", "role-2"]);
        return [
          { id: "role-1", key: "role-1", status: "active" },
          { id: "role-2", key: "role-2", status: "active" }
        ] as T;
      }
      if (sql.includes('FROM "assistants"')) {
        operations.push("assistant:lock");
        assert.match(sql, /ORDER BY "id" FOR UPDATE$/);
        assert.deepEqual(query.values, ["assistant-1", "assistant-2"]);
        return [] as T;
      }
      if (sql.includes('FROM "assistant_chats"')) {
        operations.push("chat:lock");
        assert.match(sql, /ORDER BY "assistant_id", "id" FOR UPDATE$/);
        assert.deepEqual(query.values, ["assistant-1", "assistant-2"]);
        return [] as T;
      }
      if (sql.includes('FROM "skills"')) {
        operations.push("skill:lock");
        assert.match(sql, /FOR UPDATE$/);
        return [] as T;
      }
      if (sql.includes('FROM "assistant_role_skills"')) {
        operations.push("role-skill:lock");
        assert.match(sql, /ORDER BY "role_id", "skill_id" FOR UPDATE$/);
        return [] as T;
      }
      assert.match(sql, /FROM "skill_scenarios"/);
      operations.push("scenario:lock");
      return [] as T;
    },
    async $transaction<T>(callback: (tx: never) => Promise<T>): Promise<T> {
      operations.push("transaction:begin");
      const result = await callback(prisma as never);
      operations.push("transaction:commit");
      return result;
    }
  };

  const svc = new ManageSkillScenariosService(adminAuth as never, prisma as never);

  return { svc, scenarios, assistantDirtyUpdates, chatStateResets, operations };
}

async function run(): Promise<void> {
  // --- happy path: create draft scenario ---
  {
    const { svc, scenarios, assistantDirtyUpdates, chatStateResets, operations } = buildHarness();
    const result = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    assert.equal(result.key, "instagram_carousel");
    assert.equal(result.status, "draft");
    assert.equal(result.skillId, "skill-1");
    assert.equal(result.steps.length, 1);
    assert.equal(scenarios.size, 1);
    assert.equal(assistantDirtyUpdates.length, 1, "dirty marker called on create");
    assert.equal(chatStateResets.length, 1);
    assert.deepEqual(chatStateResets[0]?.data, {
      skillDecisionState: Prisma.DbNull,
      skillRetrievalState: Prisma.DbNull
    });
    assert.deepEqual(operations, [
      "transaction:begin",
      "skill:lock",
      "skill:read",
      "role:discover",
      "role:lock",
      "role:revalidate",
      "assistant:discover",
      "assistant:lock",
      "chat:lock",
      "role-skill:lock",
      "scenario:read",
      "scenario:create",
      "database:clock",
      "assistant:update",
      "chat:update",
      "transaction:commit"
    ]);
  }

  // --- create with explicit status = active ---
  {
    const { svc } = buildHarness();
    const result = await svc.createScenario(ADMIN_USER, "skill-1", {
      ...VALID_CREATE_INPUT,
      status: "active"
    });
    assert.equal(result.status, "active");
  }

  // --- activate: draft → active ---
  {
    const { svc, scenarios, assistantDirtyUpdates } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    assert.equal(created.status, "draft");
    const activated = await svc.updateScenario(ADMIN_USER, "skill-1", created.key, {
      status: "active"
    });
    assert.equal(activated.status, "active");
    assert.equal(scenarios.size, 1);
    assert.equal(assistantDirtyUpdates.length, 2, "dirty marker called on create + update");
  }

  // --- update step (while active) ---
  {
    const { svc } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "active" });
    const updated = await svc.updateScenario(ADMIN_USER, "skill-1", created.key, {
      steps: [
        { ...VALID_STEP, directive: "Updated directive" },
        {
          number: 2,
          directive: "Second step",
          recommendedToolCall: null,
          mayBeSkippedIf: null,
          negativeGuards: []
        }
      ]
    });
    assert.equal(updated.steps.length, 2);
    assert.equal(updated.steps[0]?.directive, "Updated directive");
  }

  // --- archive: active → archived ---
  {
    const { svc, assistantDirtyUpdates } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "active" });
    const archived = await svc.archiveScenario(ADMIN_USER, "skill-1", created.key);
    assert.equal(archived.status, "archived");
    assert.equal(assistantDirtyUpdates.length, 3, "dirty on create + activate + archive");
  }

  // --- idempotent archive (already archived) ---
  {
    const { svc } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "active" });
    await svc.archiveScenario(ADMIN_USER, "skill-1", created.key);
    const archivedAgain = await svc.archiveScenario(ADMIN_USER, "skill-1", created.key);
    assert.equal(archivedAgain.status, "archived");
  }

  // --- scenario edit/archive serialize with runtime engage locks and clear both states ---
  {
    const harness = buildHarness();
    const created = await harness.svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await harness.svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "active" });

    harness.operations.length = 0;
    harness.chatStateResets.length = 0;
    await harness.svc.updateScenario(ADMIN_USER, "skill-1", created.key, {
      description: { en: "Edited", ru: "Изменено" }
    });
    assert.deepEqual(harness.operations, [
      "transaction:begin",
      "skill:lock",
      "skill:read",
      "role:discover",
      "role:lock",
      "role:revalidate",
      "assistant:discover",
      "assistant:lock",
      "chat:lock",
      "role-skill:lock",
      "scenario:read",
      "scenario:lock",
      "scenario:update",
      "database:clock",
      "assistant:update",
      "chat:update",
      "transaction:commit"
    ]);
    assert.deepEqual(harness.chatStateResets[0]?.data, {
      skillDecisionState: Prisma.DbNull,
      skillRetrievalState: Prisma.DbNull
    });

    harness.operations.length = 0;
    harness.chatStateResets.length = 0;
    await harness.svc.archiveScenario(ADMIN_USER, "skill-1", created.key);
    assert.deepEqual(harness.operations, [
      "transaction:begin",
      "skill:lock",
      "skill:read",
      "role:discover",
      "role:lock",
      "role:revalidate",
      "assistant:discover",
      "assistant:lock",
      "chat:lock",
      "role-skill:lock",
      "scenario:read",
      "scenario:lock",
      "scenario:update",
      "database:clock",
      "assistant:update",
      "chat:update",
      "transaction:commit"
    ]);
    assert.deepEqual(harness.chatStateResets[0]?.data, {
      skillDecisionState: Prisma.DbNull,
      skillRetrievalState: Prisma.DbNull
    });
  }

  // --- re-activate: archived → active ---
  {
    const { svc } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "active" });
    await svc.archiveScenario(ADMIN_USER, "skill-1", created.key);
    const reactivated = await svc.updateScenario(ADMIN_USER, "skill-1", created.key, {
      status: "active"
    });
    assert.equal(reactivated.status, "active");
  }

  // --- list scenarios: archived excluded by default ---
  {
    const { svc } = buildHarness();
    await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await svc.createScenario(ADMIN_USER, "skill-1", {
      ...VALID_CREATE_INPUT,
      key: "second_scenario"
    });
    const listed = await svc.listScenarios(ADMIN_USER, "skill-1");
    assert.equal(listed.length, 2);
    await svc.archiveScenario(ADMIN_USER, "skill-1", "instagram_carousel");
    const listedAfterArchive = await svc.listScenarios(ADMIN_USER, "skill-1");
    assert.equal(listedAfterArchive.length, 1);
    const withArchived = await svc.listScenarios(ADMIN_USER, "skill-1", { includeArchived: true });
    assert.equal(withArchived.length, 2);
  }

  // --- getScenario: found ---
  {
    const { svc } = buildHarness();
    await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    const found = await svc.getScenario(ADMIN_USER, "skill-1", "instagram_carousel");
    assert.equal(found.key, "instagram_carousel");
  }

  // --- validation: bad key regex ---
  {
    const { svc } = buildHarness();
    try {
      svc.parseCreateInput({ ...VALID_CREATE_INPUT, key: "InvalidKey!" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof BadRequestException, "bad key throws BadRequestException");
    }
  }

  // --- validation: missing required locale ---
  {
    const { svc } = buildHarness();
    try {
      svc.parseCreateInput({ ...VALID_CREATE_INPUT, displayName: { ru: "only-ru" } });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof BadRequestException);
      assert.ok((e as BadRequestException).message.includes("en"), "error mentions 'en'");
    }
  }

  // --- validation: empty steps array ---
  {
    const { svc } = buildHarness();
    try {
      svc.parseCreateInput({ ...VALID_CREATE_INPUT, steps: [] });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof BadRequestException);
    }
  }

  // --- service: duplicate key conflict ---
  {
    const { svc } = buildHarness();
    await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await assert.rejects(
      () => svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT),
      (err) => err instanceof ConflictException
    );
  }

  // --- service: unknown skill NotFoundException ---
  {
    const { svc } = buildHarness(false);
    await assert.rejects(
      () => svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT),
      (err) => err instanceof NotFoundException
    );
  }

  // --- service: getScenario not found ---
  {
    const { svc } = buildHarness();
    await assert.rejects(
      () => svc.getScenario(ADMIN_USER, "skill-1", "nonexistent"),
      (err) => err instanceof NotFoundException
    );
  }

  // --- lifecycle: invalid status transition rejected ---
  {
    const { svc } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    // draft → archived is not allowed (must go draft → active first)
    await assert.rejects(
      () => svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "archived" }),
      (err) => err instanceof BadRequestException
    );
  }

  // --- lifecycle: active → draft not allowed ---
  {
    const { svc } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    await svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "active" });
    await assert.rejects(
      () => svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "draft" }),
      (err) => err instanceof BadRequestException
    );
  }

  // --- dirty-marker called on every successful mutation ---
  {
    const { svc, assistantDirtyUpdates } = buildHarness();
    const created = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT); // +1
    await svc.updateScenario(ADMIN_USER, "skill-1", created.key, { status: "active" }); // +1
    await svc.archiveScenario(ADMIN_USER, "skill-1", created.key); // +1
    assert.equal(assistantDirtyUpdates.length, 3, "dirty-marker called on every mutation");
  }

  // --- ADR-119 Slice 10: firstStepPreview persists on step 1 ---
  {
    const { svc } = buildHarness();
    const inputWithPreview = {
      ...VALID_CREATE_INPUT,
      steps: [
        {
          ...VALID_STEP,
          expectedUserResponse: "User provides 8 image ideas.",
          nextStepTrigger: "User confirms all ideas.",
          recoveryGuidance: "Ask for more specific descriptions.",
          firstStepPreview: "Create an 8-slide Instagram carousel."
        }
      ]
    };
    const result = await svc.createScenario(
      ADMIN_USER,
      "skill-1",
      svc.parseCreateInput(inputWithPreview)
    );
    assert.equal(result.steps.length, 1);
    const step1 = result.steps[0];
    assert.ok(step1 !== undefined, "step 1 must exist");
    const step1State = step1 as Record<string, unknown>;
    assert.equal(step1State["expectedUserResponse"], "User provides 8 image ideas.");
    assert.equal(step1State["nextStepTrigger"], "User confirms all ideas.");
    assert.equal(step1State["recoveryGuidance"], "Ask for more specific descriptions.");
    assert.equal(step1State["firstStepPreview"], "Create an 8-slide Instagram carousel.");
  }

  // --- ADR-119 Slice 10: loading scenario without firstStepPreview returns null (backward compat) ---
  {
    const { svc } = buildHarness();
    const result = await svc.createScenario(ADMIN_USER, "skill-1", VALID_CREATE_INPUT);
    assert.equal(result.steps.length, 1);
    const step1State = result.steps[0] as Record<string, unknown>;
    assert.equal(step1State["firstStepPreview"], null, "missing firstStepPreview returns null");
    assert.equal(
      step1State["expectedUserResponse"],
      null,
      "missing expectedUserResponse returns null"
    );
    assert.equal(step1State["nextStepTrigger"], null, "missing nextStepTrigger returns null");
    assert.equal(step1State["recoveryGuidance"], null, "missing recoveryGuidance returns null");
  }

  // --- ADR-119 Slice 10: firstStepPreview validation: >200 chars rejects ---
  {
    const { svc } = buildHarness();
    try {
      svc.parseCreateInput({
        ...VALID_CREATE_INPUT,
        steps: [{ ...VALID_STEP, firstStepPreview: "x".repeat(201) }]
      });
      assert.fail("should have thrown for overlong firstStepPreview");
    } catch (e) {
      assert.ok(
        e instanceof BadRequestException,
        "overlong firstStepPreview throws BadRequestException"
      );
    }
  }

  console.log("manage-skill-scenarios.service.test.ts: all tests passed");
}

void run();
