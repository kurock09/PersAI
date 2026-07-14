import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ManageAdminRolesService } from "../src/modules/workspace-management/application/manage-admin-roles.service";
import {
  DEFAULT_ASSISTANT_ROLE_ID,
  DEFAULT_ASSISTANT_ROLE_KEY
} from "../prisma/assistant-role-seed-data";

type RoleRow = {
  id: string;
  key: string;
  name: Record<string, string>;
  description: Record<string, string>;
  mission: Record<string, string>;
  category: string;
  iconEmoji: string | null;
  color: string | null;
  status: "draft" | "active" | "archived";
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  skillLinks: Array<{
    roleId: string;
    skillId: string;
    displayOrder: number;
    createdAt: Date;
    skill: {
      id: string;
      status: "draft" | "active" | "archived";
      name: Record<string, string>;
      description: Record<string, string>;
      category: string;
      iconEmoji: string | null;
      color: string | null;
      archivedAt: Date | null;
      tags: string[];
      instructionCard: Record<string, unknown>;
    };
  }>;
};

function createHarness(options?: {
  assistantsUsingRole?: string[];
  activeSkills?: string[];
  skillStatuses?: Record<string, "draft" | "active" | "archived">;
  driftOnFirstReplace?: boolean;
  activationDrift?: "once" | "always";
  customRoleStatus?: "draft" | "active" | "archived";
  corruptDefaultSkillId?: string;
  linkedCustomSkillIds?: string[];
}) {
  const now = new Date("2026-07-14T12:00:00.000Z");
  const roles = new Map<string, RoleRow>();
  const assistants = new Map<string, { id: string; roleId: string; configDirtyAt: Date | null }>();
  const chats = new Map<
    string,
    {
      id: string;
      assistantId: string;
      skillDecisionState: unknown;
      skillRetrievalState: unknown;
    }
  >();
  const skills = new Map<
    string,
    {
      id: string;
      status: "draft" | "active" | "archived";
      archivedAt: Date | null;
      name: Record<string, string>;
      description: Record<string, string>;
      category: string;
      tags: string[];
      instructionCard: Record<string, unknown>;
      iconEmoji: string | null;
      color: string | null;
    }
  >();
  let roleSkillFindManyCalls = 0;
  let assistantRoleFindUniqueCalls = 0;
  let nextRole = 1;

  roles.set(DEFAULT_ASSISTANT_ROLE_ID, {
    id: DEFAULT_ASSISTANT_ROLE_ID,
    key: DEFAULT_ASSISTANT_ROLE_KEY,
    name: { en: "Universal assistant", ru: "Универсальный помощник" },
    description: { en: "General", ru: "Общая" },
    mission: { en: "Help everyday.", ru: "Помогай каждый день." },
    category: "general",
    iconEmoji: null,
    color: null,
    status: "active",
    displayOrder: 0,
    createdAt: now,
    updatedAt: now,
    skillLinks: []
  });
  const configuredSkillIds = [
    ...new Set([...(options?.activeSkills ?? []), ...Object.keys(options?.skillStatuses ?? {})])
  ];
  for (const skillId of configuredSkillIds) {
    const status = options?.skillStatuses?.[skillId] ?? "active";
    skills.set(skillId, {
      id: skillId,
      status,
      archivedAt: status === "archived" ? now : null,
      name: { en: "Skill", ru: "Навык" },
      description: { en: "Desc", ru: "Опис" },
      category: "work",
      tags: [],
      instructionCard: { title: "T", body: "Body", guardrails: [], examples: [], whenToUse: "" },
      iconEmoji: null,
      color: null
    });
  }
  if (options?.corruptDefaultSkillId) {
    const skill = skills.get(options.corruptDefaultSkillId);
    if (skill) {
      roles.get(DEFAULT_ASSISTANT_ROLE_ID)!.skillLinks.push({
        roleId: DEFAULT_ASSISTANT_ROLE_ID,
        skillId: skill.id,
        displayOrder: 0,
        createdAt: now,
        skill
      });
    }
  }

  for (const assistantId of options?.assistantsUsingRole ?? []) {
    assistants.set(assistantId, {
      id: assistantId,
      roleId: "role-custom",
      configDirtyAt: null
    });
    chats.set(`chat-${assistantId}`, {
      id: `chat-${assistantId}`,
      assistantId,
      skillDecisionState: { active: true },
      skillRetrievalState: { cached: true }
    });
  }

  roles.set("role-custom", {
    id: "role-custom",
    key: "custom_role",
    name: { en: "Custom", ru: "Своя" },
    description: { en: "Custom role", ru: "Своя роль" },
    mission: { en: "Do custom work.", ru: "Делай свою работу." },
    category: "work",
    iconEmoji: null,
    color: null,
    status: options?.customRoleStatus ?? "active",
    displayOrder: 10,
    createdAt: now,
    updatedAt: now,
    skillLinks: []
  });
  for (const [displayOrder, skillId] of (options?.linkedCustomSkillIds ?? []).entries()) {
    const skill = skills.get(skillId);
    if (skill) {
      roles.get("role-custom")!.skillLinks.push({
        roleId: "role-custom",
        skillId,
        displayOrder,
        createdAt: now,
        skill
      });
    }
  }

  const collectSqlStrings = (value: unknown): string[] => {
    if (typeof value === "string") {
      return roles.has(value) || skills.has(value) || assistants.has(value) ? [value] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => collectSqlStrings(item));
    }
    if (value !== null && typeof value === "object" && "values" in value) {
      return collectSqlStrings((value as { values: unknown }).values);
    }
    return [];
  };

  const tx = {
    $queryRaw: async <T>(query: {
      strings?: readonly string[];
      values?: unknown[];
    }): Promise<T> => {
      const sql = (query.strings ?? []).join("?").replace(/\s+/g, " ");
      if (sql.includes('FROM "assistant_roles"')) {
        const ids = collectSqlStrings(query.values ?? []);
        const selected = ids.length > 0 ? ids : [...roles.keys()];
        return selected
          .map((id) => roles.get(id))
          .filter((role): role is RoleRow => role !== undefined)
          .map((role) => ({ id: role.id, key: role.key, status: role.status })) as T;
      }
      if (sql.includes("clock_timestamp()")) {
        return [{ dirtyAt: new Date("2026-07-14T12:00:01.000Z") }] as T;
      }
      return [] as T;
    },
    assistantRole: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const role = roles.get(where.id);
        if (!role) return null;
        const cloned = structuredClone(role) as RoleRow & { _count?: { assistants: number } };
        const call = ++assistantRoleFindUniqueCalls;
        if (
          where.id === "role-custom" &&
          options?.activationDrift &&
          (options.activationDrift === "always" ? call % 2 === 1 : call === 1)
        ) {
          cloned.skillLinks = [];
        }
        if (include) {
          cloned._count = {
            assistants: [...assistants.values()].filter(
              (assistant) => assistant.roleId === where.id
            ).length
          };
        }
        return cloned;
      },
      findFirst: async ({ where }: { where: { id: string } }) => {
        const role = roles.get(where.id);
        return role ? structuredClone(role) : null;
      },
      findMany: async () =>
        [...roles.values()].map((role) => ({
          ...structuredClone(role),
          _count: {
            assistants: [...assistants.values()].filter((assistant) => assistant.roleId === role.id)
              .length
          }
        })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `role-${nextRole++}`;
        const row: RoleRow = {
          id,
          key: String(data.key),
          name: data.name as Record<string, string>,
          description: data.description as Record<string, string>,
          mission: data.mission as Record<string, string>,
          category: String(data.category),
          iconEmoji: (data.iconEmoji as string | null) ?? null,
          color: (data.color as string | null) ?? null,
          status: (data.status as RoleRow["status"]) ?? "draft",
          displayOrder: Number(data.displayOrder ?? 100),
          createdAt: now,
          updatedAt: now,
          skillLinks: []
        };
        roles.set(id, row);
        return structuredClone(row);
      },
      update: async ({
        where,
        data,
        include
      }: {
        where: { id: string };
        data: Record<string, unknown>;
        include?: unknown;
      }) => {
        void include;
        const existing = roles.get(where.id);
        if (!existing) {
          throw new Error("missing");
        }
        const next = {
          ...existing,
          ...data,
          updatedAt: now
        } as RoleRow;
        roles.set(where.id, next);
        return {
          ...structuredClone(next),
          _count: {
            assistants: [...assistants.values()].filter(
              (assistant) => assistant.roleId === where.id
            ).length
          }
        };
      }
    },
    assistantRoleSkill: {
      findMany: async ({ where }: { where: { roleId: string } }) => {
        roleSkillFindManyCalls += 1;
        const role = roles.get(where.roleId);
        const links = role?.skillLinks ?? [];
        // First post-lock read in the first attempt injects an unlocked skill to force retry.
        if (options?.driftOnFirstReplace && roleSkillFindManyCalls === 2) {
          return [{ skillId: "00000000-0000-4000-8000-00000000dead" }];
        }
        return links.map((link) => ({ skillId: link.skillId }));
      },
      deleteMany: async ({ where }: { where: { roleId: string } }) => {
        const role = roles.get(where.roleId);
        if (role) {
          role.skillLinks = [];
        }
        return { count: 0 };
      },
      createMany: async ({
        data
      }: {
        data: Array<{ roleId: string; skillId: string; displayOrder: number }>;
      }) => {
        for (const item of data) {
          const role = roles.get(item.roleId);
          const skill = skills.get(item.skillId);
          if (!role || !skill) {
            continue;
          }
          role.skillLinks.push({
            roleId: item.roleId,
            skillId: item.skillId,
            displayOrder: item.displayOrder,
            createdAt: now,
            skill
          });
        }
        return { count: data.length };
      }
    },
    assistant: {
      findMany: async ({ where }: { where: { roleId?: string; id?: { in: string[] } } }) => {
        if (where.roleId) {
          return [...assistants.values()]
            .filter((assistant) => assistant.roleId === where.roleId)
            .map((assistant) => ({ id: assistant.id }));
        }
        if (where.id?.in) {
          return where.id.in
            .filter((id) => {
              const assistant = assistants.get(id);
              return assistant !== undefined && assistant.roleId === "role-custom";
            })
            .map((id) => ({ id }));
        }
        return [];
      },
      updateMany: async ({
        where,
        data
      }: {
        where: { id: { in: string[] } };
        data: { configDirtyAt: Date };
      }) => {
        for (const id of where.id.in) {
          const assistant = assistants.get(id);
          if (assistant) {
            assistant.configDirtyAt = data.configDirtyAt;
          }
        }
        return { count: where.id.in.length };
      }
    },
    assistantChat: {
      updateMany: async ({
        where,
        data
      }: {
        where: { assistantId: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        for (const chat of chats.values()) {
          if (where.assistantId.in.includes(chat.assistantId)) {
            Object.assign(chat, data);
          }
        }
        return { count: 0 };
      }
    },
    skill: {
      findMany: async ({ where }: { where: { id: { in: string[] } }; select?: unknown }) => {
        return where.id.in
          .map((id) => skills.get(id))
          .filter((skill): skill is NonNullable<typeof skill> => skill !== undefined);
      }
    },
    skillScenario: {
      findMany: async () => []
    }
  };

  const prisma = {
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
    assistantRole: tx.assistantRole,
    skill: tx.skill,
    skillScenario: tx.skillScenario
  };

  const service = new ManageAdminRolesService(
    {
      assertCanReadAdminSurface: async () => undefined,
      assertCanWriteGlobalKnowledge: async () => ({ userId: "admin-1" })
    } as never,
    prisma as never
  );

  return {
    service,
    roles,
    assistants,
    chats,
    skills,
    getRoleSkillFindManyCalls: () => roleSkillFindManyCalls
  };
}

void test("default role rejects non-empty skill replacement and status archive", async () => {
  const { service } = createHarness();
  await assert.rejects(
    () =>
      service.replaceSkills("admin-1", DEFAULT_ASSISTANT_ROLE_ID, {
        skillIds: ["00000000-0000-4000-8000-000000000301"]
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "admin_role_default_immutable"
  );

  const empty = await service.replaceSkills("admin-1", DEFAULT_ASSISTANT_ROLE_ID, {
    skillIds: []
  });
  assert.equal(empty.key, DEFAULT_ASSISTANT_ROLE_KEY);
  assert.deepEqual(empty.skillIds, []);

  await assert.rejects(
    () => service.archive("admin-1", DEFAULT_ASSISTANT_ROLE_ID),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "admin_role_default_immutable"
  );
});

void test("archive rejects in-use roles after Role then Assistant serialization", async () => {
  const { service } = createHarness({
    assistantsUsingRole: ["assistant-1"]
  });
  await assert.rejects(
    () => service.archive("admin-1", "role-custom"),
    (error: unknown) =>
      error instanceof ApiErrorHttpException && error.errorObject.code === "admin_role_in_use"
  );
});

void test("skill replacement retries on snapshot drift then replaces and clears chat skill state", async () => {
  const skillId = "00000000-0000-4000-8000-000000000301";
  const { service, assistants, chats, getRoleSkillFindManyCalls } = createHarness({
    activeSkills: [skillId],
    assistantsUsingRole: ["assistant-1"],
    driftOnFirstReplace: true
  });

  const replaced = await service.replaceSkills("admin-1", "role-custom", {
    skillIds: [skillId]
  });
  assert.deepEqual(replaced.skillIds, [skillId]);
  assert.ok(getRoleSkillFindManyCalls() >= 4);
  assert.ok(assistants.get("assistant-1")?.configDirtyAt instanceof Date);
  assert.equal(chats.get("chat-assistant-1")?.skillDecisionState, Prisma.DbNull);
  assert.equal(chats.get("chat-assistant-1")?.skillRetrievalState, Prisma.DbNull);
});

void test("create/update parsers enforce key immutability and required ru+en copy", () => {
  const { service } = createHarness();
  const created = service.parseCreateInput({
    key: "ops_lead",
    name: { en: "Ops", ru: "Опс" },
    description: { en: "Ops role", ru: "Роль опс" },
    mission: { en: "Lead ops.", ru: "Веди опс." },
    category: "work",
    status: "active"
  });
  assert.equal(created.key, "ops_lead");

  assert.throws(
    () =>
      service.parseUpdateInput({
        key: "changed",
        name: { en: "Ops", ru: "Опс" },
        description: { en: "Ops role", ru: "Роль опс" },
        mission: { en: "Lead ops.", ru: "Веди опс." },
        category: "work"
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException && error.errorObject.code === "admin_role_invalid_body"
  );

  assert.throws(
    () =>
      service.parseCreateInput({
        key: "ops_lead",
        name: { en: "Ops" },
        description: { en: "Ops role", ru: "Роль опс" },
        mission: { en: "Lead ops.", ru: "Веди опс." },
        category: "work"
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException && error.errorObject.code === "admin_role_invalid_body"
  );
});

void test("Role parsers reject unknown fields and non-RU/EN authoring locales", () => {
  const { service } = createHarness();
  const localized = { en: "English", ru: "Русский" };
  const core = {
    name: localized,
    description: localized,
    mission: localized,
    category: "work"
  };
  const assertInvalid = (callback: () => unknown, code: string) =>
    assert.throws(
      callback,
      (error: unknown) => error instanceof ApiErrorHttpException && error.errorObject.code === code
    );

  assertInvalid(
    () => service.parseCreateInput({ key: "ops_lead", ...core, unknown: true }),
    "admin_role_invalid_body"
  );
  assertInvalid(
    () => service.parseUpdateInput({ ...core, unknown: true }),
    "admin_role_invalid_body"
  );
  assertInvalid(
    () =>
      service.parsePreviewInput({
        locale: "en",
        mission: localized,
        skillIds: [],
        unknown: true
      }),
    "admin_role_invalid_preview"
  );
  assertInvalid(
    () => service.parseSkillsReplaceInput({ skillIds: [], unknown: true }),
    "admin_role_invalid_skills"
  );
  assertInvalid(
    () =>
      service.parseCreateInput({
        key: "ops_lead",
        ...core,
        name: { ...localized, fr: "Français" }
      }),
    "admin_role_invalid_body"
  );
});

const updateInput = {
  key: null,
  name: { en: "Updated", ru: "Обновлена" },
  description: { en: "Updated role", ru: "Обновлённая роль" },
  mission: { en: "Work carefully.", ru: "Работай внимательно." },
  category: "work",
  iconEmoji: null,
  color: null,
  displayOrder: 11,
  status: null
} as const;

void test("role state exposes authoritative assistantCount/inUse", async () => {
  const { service } = createHarness({ assistantsUsingRole: ["assistant-1", "assistant-2"] });
  const role = (await service.list("admin-1")).find((item) => item.id === "role-custom");
  assert.equal(role?.assistantCount, 2);
  assert.equal(role?.inUse, true);
});

void test("core update uses DB-clock dirtying without clearing chat Skill state", async () => {
  const { service, assistants, chats } = createHarness({
    assistantsUsingRole: ["assistant-1"]
  });
  await service.update("admin-1", "role-custom", updateInput);
  assert.equal(
    assistants.get("assistant-1")?.configDirtyAt?.toISOString(),
    "2026-07-14T12:00:01.000Z"
  );
  assert.deepEqual(chats.get("chat-assistant-1")?.skillDecisionState, { active: true });
  assert.deepEqual(chats.get("chat-assistant-1")?.skillRetrievalState, { cached: true });
});

void test("in-use active role cannot be demoted", async () => {
  const { service } = createHarness({ assistantsUsingRole: ["assistant-1"] });
  await assert.rejects(
    () => service.update("admin-1", "role-custom", { ...updateInput, status: "draft" }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException && error.errorObject.code === "admin_role_in_use"
  );
});

void test("activation retries an empty-to-nonempty link drift then validates active Skills", async () => {
  const skillId = "00000000-0000-4000-8000-000000000301";
  const { service } = createHarness({
    activeSkills: [skillId],
    linkedCustomSkillIds: [skillId],
    customRoleStatus: "draft",
    activationDrift: "once"
  });
  const role = await service.update("admin-1", "role-custom", {
    ...updateInput,
    status: "active"
  });
  assert.equal(role.status, "active");
});

void test("activation drift exhausts its bounded fresh-snapshot retry", async () => {
  const skillId = "00000000-0000-4000-8000-000000000301";
  const { service } = createHarness({
    activeSkills: [skillId],
    linkedCustomSkillIds: [skillId],
    customRoleStatus: "draft",
    activationDrift: "always"
  });
  await assert.rejects(
    () => service.update("admin-1", "role-custom", { ...updateInput, status: "active" }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "admin_role_activation_retry_exhausted"
  );
});

void test("activation rejects missing, draft, and archived linked Skills", async () => {
  const ids = {
    missing: "00000000-0000-4000-8000-000000000311",
    draft: "00000000-0000-4000-8000-000000000312",
    archived: "00000000-0000-4000-8000-000000000313"
  };
  for (const [kind, skillId] of Object.entries(ids)) {
    const harness = createHarness({
      customRoleStatus: "draft",
      skillStatuses: kind === "missing" ? {} : { [skillId]: kind as "draft" | "archived" },
      linkedCustomSkillIds: kind === "missing" ? [] : [skillId]
    });
    if (kind === "missing") {
      harness.roles.get("role-custom")!.skillLinks.push({
        roleId: "role-custom",
        skillId,
        displayOrder: 0,
        createdAt: new Date("2026-07-14T12:00:00.000Z"),
        skill: {
          id: skillId,
          status: "archived",
          name: {},
          description: {},
          category: "",
          iconEmoji: null,
          color: null,
          archivedAt: new Date("2026-07-14T12:00:00.000Z"),
          tags: [],
          instructionCard: {}
        }
      });
    }
    await assert.rejects(
      () =>
        harness.service.update("admin-1", "role-custom", {
          ...updateInput,
          status: "active"
        }),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.errorObject.code ===
          (kind === "missing" ? "admin_role_skill_not_found" : "admin_role_skill_not_active")
    );
  }
});

void test("replacement rejects missing, draft, and archived requested Skills", async () => {
  const cases = [
    ["missing", "00000000-0000-4000-8000-000000000321"],
    ["draft", "00000000-0000-4000-8000-000000000322"],
    ["archived", "00000000-0000-4000-8000-000000000323"]
  ] as const;
  for (const [kind, skillId] of cases) {
    const harness = createHarness({
      skillStatuses: kind === "missing" ? {} : { [skillId]: kind }
    });
    await assert.rejects(
      () => harness.service.replaceSkills("admin-1", "role-custom", { skillIds: [skillId] }),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.errorObject.code ===
          (kind === "missing" ? "admin_role_skill_not_found" : "admin_role_skill_not_active")
    );
  }
});

void test("empty replacement repairs corrupted default links under canonical locks", async () => {
  const skillId = "00000000-0000-4000-8000-000000000301";
  const { service, roles } = createHarness({
    activeSkills: [skillId],
    corruptDefaultSkillId: skillId
  });
  const repaired = await service.replaceSkills("admin-1", DEFAULT_ASSISTANT_ROLE_ID, {
    skillIds: []
  });
  assert.deepEqual(repaired.skillIds, []);
  assert.deepEqual(roles.get(DEFAULT_ASSISTANT_ROLE_ID)?.skillLinks, []);
});

void test("archiving an already archived unused role is idempotent", async () => {
  const { service, roles } = createHarness({ customRoleStatus: "archived" });
  await service.archive("admin-1", "role-custom");
  assert.equal(roles.get("role-custom")?.status, "archived");
});
