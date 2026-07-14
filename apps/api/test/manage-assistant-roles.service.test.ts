import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ManageAssistantRolesService } from "../src/modules/workspace-management/application/manage-assistant-roles.service";

type AssistantRow = {
  id: string;
  userId: string;
  workspaceId: string;
  roleId: string;
  configDirtyAt: Date | null;
};

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
};

type ChatRow = {
  id: string;
  assistantId: string;
  skillDecisionState: unknown;
  skillRetrievalState: unknown;
};

type AuditRow = {
  workspaceId: string;
  assistantId: string;
  actorUserId: string;
  eventCategory: string;
  eventCode: string;
  summary: string;
  outcome: string;
  details: Record<string, unknown>;
};

class FakePrismaService {
  assistants = new Map<string, AssistantRow>();
  roles = new Map<string, RoleRow>();
  chats: ChatRow[] = [];
  audits: AuditRow[] = [];
  operations: string[] = [];
  failAudit = false;
  databaseClock = new Date("2026-07-14T00:00:01.000Z");
  concurrentRoleChangeOnFirstAssistantLock: string | null = null;
  concurrentRoleChanges: string[] = [];
  assistantLockCount = 0;

  assistant = {
    findFirst: async ({
      where
    }: {
      where: { id: string; userId: string; workspaceId: string };
      select: { id: true; userId: true; workspaceId: true; roleId: true };
    }): Promise<AssistantRow | null> => {
      const row = this.assistants.get(where.id);
      return row?.userId === where.userId && row.workspaceId === where.workspaceId ? row : null;
    }
  };

  assistantRole = {
    findUnique: async ({
      where
    }: {
      where: { id?: string; key?: string };
    }): Promise<RoleRow | null> => {
      if (where.id !== undefined) {
        return this.roles.get(where.id) ?? null;
      }
      if (where.key !== undefined) {
        return Array.from(this.roles.values()).find((role) => role.key === where.key) ?? null;
      }
      return null;
    },
    findMany: async (): Promise<RoleRow[]> =>
      Array.from(this.roles.values())
        .filter((role) => role.status === "active")
        .sort(
          (left, right) =>
            left.displayOrder - right.displayOrder ||
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.key.localeCompare(right.key)
        )
  };

  async $transaction<T>(callback: (tx: FakePrismaTransaction) => Promise<T>): Promise<T> {
    const assistantSnapshot = new Map(
      Array.from(this.assistants, ([id, row]) => [id, { ...row }] as const)
    );
    const chatSnapshot = this.chats.map((chat) => ({ ...chat }));
    const auditLength = this.audits.length;
    this.operations.push("transaction:begin");
    try {
      const result = await callback(new FakePrismaTransaction(this));
      this.operations.push("transaction:commit");
      return result;
    } catch (error) {
      this.assistants = assistantSnapshot;
      this.chats = chatSnapshot;
      this.audits.length = auditLength;
      this.operations.push("transaction:rollback");
      throw error;
    }
  }
}

class FakePrismaTransaction {
  constructor(private readonly prisma: FakePrismaService) {}

  async $queryRaw<T>(query: { strings?: string[]; values?: unknown[] }): Promise<T> {
    const sql = (query.strings ?? []).join("?").replace(/\s+/g, " ").trim();
    if (sql.includes("clock_timestamp()")) {
      assert.equal(
        this.prisma.operations.includes("assistant:lock"),
        true,
        "database dirty timestamp must be read only after the Assistant row lock"
      );
      this.prisma.operations.push("database:clock");
      return [{ configDirtyAt: this.prisma.databaseClock }] as T;
    }
    if (sql.includes('FROM "assistants"')) {
      assert.match(sql, /"id" = \?::uuid/);
      assert.match(sql, /"user_id" = \?::uuid/);
      assert.match(sql, /"workspace_id" = \?::uuid/);
      assert.match(sql, /FOR UPDATE$/);
      this.prisma.operations.push("assistant:lock");
      this.prisma.assistantLockCount += 1;
      const [assistantId, userId, workspaceId] = query.values ?? [];
      const row =
        typeof assistantId === "string" ? this.prisma.assistants.get(assistantId) : undefined;
      const concurrentRoleId =
        this.prisma.concurrentRoleChanges.shift() ??
        (this.prisma.assistantLockCount === 1
          ? this.prisma.concurrentRoleChangeOnFirstAssistantLock
          : null);
      if (row !== undefined && concurrentRoleId !== null) {
        row.roleId = concurrentRoleId;
        this.prisma.operations.push("concurrent:role-change");
      }
      const matches =
        row !== undefined && row.userId === userId && row.workspaceId === workspaceId ? [row] : [];
      return matches.map((item) => ({ ...item })) as T;
    }
    if (sql.includes('FROM "assistant_roles"')) {
      assert.match(sql, /ORDER BY "id" FOR UPDATE$/);
      assert.deepEqual(query.values, [...(query.values ?? [])].sort());
      this.prisma.operations.push("role:lock");
      return (query.values ?? [])
        .filter((value): value is string => typeof value === "string")
        .map((id) => this.prisma.roles.get(id))
        .filter((role): role is RoleRow => role !== undefined)
        .map((role) => ({ id: role.id, key: role.key, status: role.status })) as T;
    }
    assert.match(sql, /FROM "assistant_chats"/);
    assert.match(sql, /ORDER BY "assistant_id", "id" FOR UPDATE$/);
    this.prisma.operations.push("chat:lock");
    return [] as T;
  }

  assistantRole = {
    findUnique: async ({
      where,
      select
    }: {
      where: { id: string };
      select: { id: true; key: true };
    }): Promise<{ id: string; key: string } | null> => {
      void select;
      const row = this.prisma.roles.get(where.id);
      return row === undefined ? null : { id: row.id, key: row.key };
    }
  };

  assistant = {
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: { roleId: string; configDirtyAt: Date };
    }): Promise<void> => {
      this.prisma.operations.push("assistant:update");
      const row = this.prisma.assistants.get(where.id);
      if (row === undefined) {
        throw new Error("missing assistant");
      }
      row.roleId = data.roleId;
      row.configDirtyAt = data.configDirtyAt;
    }
  };

  assistantChat = {
    updateMany: async ({
      where,
      data
    }: {
      where: { assistantId: string };
      data: { skillDecisionState: null; skillRetrievalState: null };
    }): Promise<void> => {
      this.prisma.operations.push("chat:updateMany");
      for (const chat of this.prisma.chats) {
        if (chat.assistantId === where.assistantId) {
          chat.skillDecisionState = data.skillDecisionState;
          chat.skillRetrievalState = data.skillRetrievalState;
        }
      }
    }
  };

  assistantAuditEvent = {
    create: async ({ data }: { data: AuditRow }): Promise<void> => {
      this.prisma.operations.push("audit:create");
      if (this.prisma.failAudit) {
        throw new Error("audit write failed");
      }
      this.prisma.audits.push(data);
    }
  };
}

class FakeResolveActiveAssistantService {
  constructor(private readonly assistants: Map<string, AssistantRow>) {}

  async resolveMembership(userId: string): Promise<{ workspaceId: string }> {
    return { workspaceId: userId === "owner-1" ? "workspace-1" : "workspace-2" };
  }

  async execute(input: { userId: string; assistantId?: string | null }): Promise<{
    assistantId: string;
    assistant: AssistantRow;
    workspaceId: string;
  }> {
    const assistantId = input.assistantId ?? null;
    const assistant = assistantId === null ? undefined : this.assistants.get(assistantId);
    if (assistant === undefined) {
      throw new NotFoundException("Assistant does not exist for this workspace.");
    }
    return {
      assistantId: assistant.id,
      assistant,
      workspaceId: assistant.workspaceId
    };
  }
}

class FakeAssistantRoleRepository {
  constructor(private readonly prisma: FakePrismaService) {}

  async findById(id: string) {
    return this.prisma.roles.get(id) ?? null;
  }

  async findByKey(key: string) {
    return Array.from(this.prisma.roles.values()).find((role) => role.key === key) ?? null;
  }

  async findActiveCatalog() {
    return this.prisma.assistantRole.findMany();
  }
}

function makeRole(params: Partial<RoleRow> & Pick<RoleRow, "id" | "key">): RoleRow {
  return {
    id: params.id,
    key: params.key,
    name: params.name ?? { en: params.key },
    description: params.description ?? { en: `${params.key} description` },
    mission: params.mission ?? { en: `${params.key} mission` },
    category: params.category ?? "general",
    iconEmoji: params.iconEmoji ?? null,
    color: params.color ?? null,
    status: params.status ?? "active",
    displayOrder: params.displayOrder ?? 100,
    createdAt: params.createdAt ?? new Date("2026-07-14T00:00:00.000Z"),
    updatedAt: params.updatedAt ?? new Date("2026-07-14T00:00:00.000Z")
  };
}

function makeService(prisma: FakePrismaService): ManageAssistantRolesService {
  return new ManageAssistantRolesService(
    prisma as never,
    new FakeResolveActiveAssistantService(prisma.assistants) as never,
    new FakeAssistantRoleRepository(prisma) as never
  );
}

function seed(prisma: FakePrismaService): void {
  const defaultRole = makeRole({ id: "role-1", key: "persai_default", displayOrder: 0 });
  const writerRole = makeRole({ id: "role-2", key: "writer", displayOrder: 10 });
  const archivedRole = makeRole({ id: "role-3", key: "archived", status: "archived" });
  const analystRole = makeRole({ id: "role-4", key: "analyst", displayOrder: 20 });
  prisma.roles.set(defaultRole.id, defaultRole);
  prisma.roles.set(writerRole.id, writerRole);
  prisma.roles.set(archivedRole.id, archivedRole);
  prisma.roles.set(analystRole.id, analystRole);
  prisma.assistants.set("assistant-1", {
    id: "assistant-1",
    userId: "owner-1",
    workspaceId: "workspace-1",
    roleId: defaultRole.id,
    configDirtyAt: null
  });
  prisma.assistants.set("assistant-2", {
    id: "assistant-2",
    userId: "other-owner",
    workspaceId: "workspace-1",
    roleId: defaultRole.id,
    configDirtyAt: null
  });
  prisma.chats.push({
    id: "chat-1",
    assistantId: "assistant-1",
    skillDecisionState: { status: "active" },
    skillRetrievalState: { activeSkillId: "skill-1" }
  });
}

export async function runManageAssistantRolesServiceTest(): Promise<void> {
  {
    const service = makeService(new FakePrismaService());
    assert.throws(() => service.parseUpdateInput({ roleKey: "writer", extra: true }));
    assert.throws(() => service.parseUpdateInput({ roleKey: " " }));
    assert.throws(() => service.parseAssistantId("not-a-uuid"));
    assert.equal(
      service.parseAssistantId("00000000-0000-4000-8000-000000000001"),
      "00000000-0000-4000-8000-000000000001"
    );
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    const roles = await makeService(prisma).listCatalog("owner-1");
    assert.deepEqual(
      roles.map((role) => role.key),
      ["persai_default", "writer", "analyst"],
      "catalog must expose ordered active roles only"
    );
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    const result = await makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
      roleKey: "persai_default"
    });
    assert.equal(result.role.key, "persai_default");
    assert.equal(prisma.audits.length, 0, "same-role PUT must be idempotent");
    assert.equal(prisma.operations.includes("assistant:update"), false);
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    const result = await makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
      roleKey: "writer"
    });
    assert.equal(result.role.key, "writer");
    assert.equal(prisma.assistants.get("assistant-1")?.roleId, "role-2");
    assert.deepEqual(prisma.chats[0]?.skillDecisionState, Prisma.DbNull);
    assert.deepEqual(prisma.chats[0]?.skillRetrievalState, Prisma.DbNull);
    assert.equal(prisma.audits.length, 1);
    assert.deepEqual(prisma.audits[0]?.details, {
      previousRoleId: "role-1",
      previousRoleKey: "persai_default",
      selectedRoleId: "role-2",
      selectedRoleKey: "writer",
      actorUserId: "owner-1"
    });
    assert.deepEqual(prisma.operations, [
      "transaction:begin",
      "role:lock",
      "assistant:lock",
      "chat:lock",
      "database:clock",
      "assistant:update",
      "chat:updateMany",
      "audit:create",
      "transaction:commit"
    ]);
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    prisma.concurrentRoleChanges.push("role-4", "role-1", "role-4");
    await assert.rejects(
      () =>
        makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
          roleKey: "writer"
        }),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.errorObject.code === "assistant_role_assignment_retry_exhausted"
    );
    assert.equal(prisma.assistantLockCount, 3);
    assert.equal(prisma.audits.length, 0);
    assert.equal(prisma.operations.includes("assistant:update"), false);
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    prisma.concurrentRoleChangeOnFirstAssistantLock = "role-4";
    const result = await makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
      roleKey: "writer"
    });
    assert.equal(result.role.key, "writer");
    assert.equal(prisma.assistants.get("assistant-1")?.roleId, "role-2");
    assert.deepEqual(prisma.audits[0]?.details, {
      previousRoleId: "role-4",
      previousRoleKey: "analyst",
      selectedRoleId: "role-2",
      selectedRoleKey: "writer",
      actorUserId: "owner-1"
    });
    assert.deepEqual(prisma.chats[0]?.skillDecisionState, Prisma.DbNull);
    assert.deepEqual(prisma.chats[0]?.skillRetrievalState, Prisma.DbNull);
    assert.deepEqual(prisma.operations, [
      "transaction:begin",
      "role:lock",
      "assistant:lock",
      "concurrent:role-change",
      "transaction:commit",
      "transaction:begin",
      "role:lock",
      "assistant:lock",
      "chat:lock",
      "database:clock",
      "assistant:update",
      "chat:updateMany",
      "audit:create",
      "transaction:commit"
    ]);
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    prisma.databaseClock = new Date("2026-07-14T00:00:10.000Z");
    await makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
      roleKey: "writer"
    });
    const firstDirtyAt = prisma.assistants.get("assistant-1")?.configDirtyAt;
    prisma.databaseClock = new Date("2026-07-14T00:00:20.000Z");
    await makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
      roleKey: "persai_default"
    });
    const secondDirtyAt = prisma.assistants.get("assistant-1")?.configDirtyAt;
    assert.ok(firstDirtyAt !== null && firstDirtyAt !== undefined);
    assert.ok(secondDirtyAt !== null && secondDirtyAt !== undefined);
    assert.ok(
      secondDirtyAt.getTime() > firstDirtyAt.getTime(),
      "a delayed second PUT uses its post-lock database timestamp"
    );
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    prisma.failAudit = true;
    await assert.rejects(() =>
      makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
        roleKey: "writer"
      })
    );
    assert.equal(prisma.assistants.get("assistant-1")?.roleId, "role-1");
    assert.deepEqual(prisma.chats[0]?.skillDecisionState, { status: "active" });
    assert.deepEqual(prisma.chats[0]?.skillRetrievalState, { activeSkillId: "skill-1" });
    assert.equal(prisma.audits.length, 0);
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    await assert.rejects(() =>
      makeService(prisma).putCurrentRole("owner-1", "assistant-1", {
        roleKey: "archived"
      })
    );
    assert.equal(prisma.assistants.get("assistant-1")?.roleId, "role-1");
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    await assert.rejects(
      () => makeService(prisma).getCurrentRole("owner-1", "assistant-2"),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.errorObject.code === "assistant_role_forbidden"
    );
  }

  {
    const prisma = new FakePrismaService();
    seed(prisma);
    await assert.rejects(
      () => makeService(prisma).putCurrentRole("owner-1", "assistant-2", { roleKey: "writer" }),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.errorObject.code === "assistant_role_forbidden"
    );
  }
}

void runManageAssistantRolesServiceTest();
