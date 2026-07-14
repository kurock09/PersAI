import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { InternalRuntimeSkillStateService } from "../src/modules/workspace-management/application/internal-runtime-skill-state.service";

type Query = { strings?: readonly string[]; values?: readonly unknown[] };

function normalizedSql(query: Query): string {
  return (query.strings ?? []).join("?").replace(/\s+/g, " ").trim();
}

function createHarness(params?: {
  canonicalRoleId?: string;
  linkPresent?: boolean;
  candidateDecisionStates?: unknown[];
  lockedDecisionStates?: unknown[];
}) {
  const operations: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const candidateDecisionStates = [...(params?.candidateDecisionStates ?? [])];
  const lockedDecisionStates = [...(params?.lockedDecisionStates ?? [])];
  const tx = {
    $queryRaw: async <T>(query: Query): Promise<T> => {
      const sql = normalizedSql(query);
      if (sql.includes('FROM "assistant_roles"')) {
        operations.push("role:lock");
        assert.match(sql, /ORDER BY "id" FOR UPDATE$/);
        return [
          {
            id: "00000000-0000-4000-8000-000000000101",
            key: "role-a",
            status: "active"
          }
        ] as T;
      }
      if (sql.includes('FROM "assistants"')) {
        operations.push("assistant:lock");
        assert.match(sql, /WHERE "id" = \?::uuid FOR UPDATE$/);
        return [
          {
            id: "00000000-0000-4000-8000-000000000001",
            roleId: params?.canonicalRoleId ?? "00000000-0000-4000-8000-000000000101"
          }
        ] as T;
      }
      if (sql.includes('FROM "assistant_chats"')) {
        operations.push("chat:lock");
        assert.match(sql, /"assistant_id" = \?::uuid/);
        assert.match(sql, /"surface" = \?::"AssistantChatSurface"/);
        assert.match(sql, /"surface_thread_key" = \?/);
        assert.match(sql, /FOR UPDATE$/);
        return [
          {
            id: "chat-1",
            skillDecisionState: lockedDecisionStates.shift() ?? null,
            skillRetrievalState: { activeSkillId: "old-skill" }
          }
        ] as T;
      }
      if (sql.includes('FROM "skills"')) {
        operations.push("skill:lock");
        assert.match(sql, /WHERE "id" IN \(\?::uuid\) ORDER BY "id" FOR UPDATE$/);
        return [] as T;
      }
      assert.match(sql, /FROM "assistant_role_skills"/);
      assert.match(sql, /"role_id" = \?::uuid/);
      assert.match(sql, /"skill_id" = \?::uuid/);
      assert.match(sql, /FOR UPDATE$/);
      operations.push("role-skill:lock");
      return (
        params?.linkPresent === false
          ? []
          : [
              {
                roleId: "00000000-0000-4000-8000-000000000101",
                skillId: "00000000-0000-4000-8000-000000000201"
              }
            ]
      ) as T;
    },
    skill: {
      findUnique: async () => {
        operations.push("skill:read");
        return {
          id: "00000000-0000-4000-8000-000000000201",
          name: { en: "Finance" },
          status: "active",
          archivedAt: null
        };
      }
    },
    assistantChat: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push("chat:update");
        updates.push(data);
      }
    },
    skillScenario: {
      findFirst: async () => null
    }
  };
  const prisma = {
    assistantChat: {
      findFirst: async () => {
        operations.push("candidate:read");
        return { skillDecisionState: candidateDecisionStates.shift() ?? null };
      }
    },
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>): Promise<T> => {
      operations.push("transaction:begin");
      const result = await callback(tx);
      operations.push("transaction:commit");
      return result;
    }
  };
  return {
    service: new InternalRuntimeSkillStateService(prisma as never),
    operations,
    updates
  };
}

const engage = {
  assistantId: "00000000-0000-4000-8000-000000000001",
  channel: "web",
  surfaceThreadKey: "thread-1",
  action: "engage" as const,
  expectedRoleId: "00000000-0000-4000-8000-000000000101",
  skillId: "00000000-0000-4000-8000-000000000201",
  scenarioKey: null
};

async function run(): Promise<void> {
  {
    const harness = createHarness();
    const result = await harness.service.apply(engage);
    assert.equal(result.action, "engaged");
    assert.deepEqual(harness.operations, [
      "transaction:begin",
      "skill:lock",
      "skill:read",
      "role:lock",
      "assistant:lock",
      "chat:lock",
      "role-skill:lock",
      "chat:update",
      "transaction:commit"
    ]);
    assert.equal(harness.updates.length, 1);
  }

  {
    const harness = createHarness({ canonicalRoleId: "00000000-0000-4000-8000-000000000102" });
    const result = await harness.service.apply(engage);
    assert.deepEqual(result, {
      action: "stale",
      applied: false,
      code: "stale_assistant_role_snapshot",
      message:
        "Assistant role changed while this turn was running. Durable skill state was not persisted."
    });
    assert.deepEqual(harness.operations, [
      "transaction:begin",
      "skill:lock",
      "skill:read",
      "role:lock",
      "assistant:lock",
      "transaction:commit"
    ]);
  }

  {
    const harness = createHarness({ canonicalRoleId: "00000000-0000-4000-8000-000000000102" });
    const result = await harness.service.apply({
      ...engage,
      expectedRoleId: "00000000-0000-4000-8000-000000000101",
      skillId: "00000000-0000-4000-8000-000000000201"
    });
    assert.equal(
      result.action,
      "stale",
      "shared Skill membership in Role B must not authorize a Role A snapshot"
    );
  }

  {
    const harness = createHarness({ linkPresent: false });
    const result = await harness.service.apply(engage);
    assert.equal(result.action, "stale");
    assert.equal(harness.operations.includes("chat:update"), false);
  }

  {
    const skillA = "00000000-0000-4000-8000-000000000201";
    const skillB = "00000000-0000-4000-8000-000000000202";
    const activeState = (skillId: string) => ({
      status: "active",
      activeSkillId: skillId,
      activeSkillName: "Finance",
      activeScenarioKey: null,
      activeScenarioDisplayName: null,
      topicSummary: null
    });
    const harness = createHarness({
      candidateDecisionStates: [activeState(skillA), activeState(skillB)],
      lockedDecisionStates: [activeState(skillB), activeState(skillB)]
    });
    const result = await harness.service.apply({
      ...engage,
      action: "release",
      skillId: null
    });
    assert.deepEqual(result, { action: "released", previousSkillId: skillB });
    assert.deepEqual(harness.operations, [
      "candidate:read",
      "transaction:begin",
      "skill:lock",
      "skill:read",
      "role:lock",
      "assistant:lock",
      "chat:lock",
      "transaction:commit",
      "candidate:read",
      "transaction:begin",
      "skill:lock",
      "skill:read",
      "role:lock",
      "assistant:lock",
      "chat:lock",
      "role-skill:lock",
      "chat:update",
      "transaction:commit"
    ]);
  }

  {
    const skillA = "00000000-0000-4000-8000-000000000201";
    const skillB = "00000000-0000-4000-8000-000000000202";
    const activeState = (skillId: string) => ({
      status: "active",
      activeSkillId: skillId,
      activeSkillName: "Finance",
      activeScenarioKey: null,
      activeScenarioDisplayName: null,
      topicSummary: null
    });
    const harness = createHarness({
      candidateDecisionStates: [activeState(skillA), activeState(skillB), activeState(skillA)],
      lockedDecisionStates: [activeState(skillB), activeState(skillA), activeState(skillB)]
    });
    const result = await harness.service.apply({
      ...engage,
      action: "release",
      skillId: null
    });
    assert.equal(result.action, "stale");
    assert.equal(
      harness.operations.filter((operation) => operation === "transaction:begin").length,
      3
    );
    assert.equal(harness.operations.includes("role-skill:lock"), false);
    assert.equal(harness.operations.includes("chat:update"), false);
  }

  {
    const harness = createHarness();
    for (const [input, code] of [
      [{ ...engage, assistantId: "bad" }, "runtime_skill_state_invalid_assistant_id"],
      [{ ...engage, expectedRoleId: "bad" }, "runtime_skill_state_invalid_expected_role_id"],
      [{ ...engage, skillId: "bad" }, "runtime_skill_state_invalid_skill_id"]
    ] as const) {
      await assert.rejects(
        () => harness.service.apply(input),
        (error: unknown) =>
          error instanceof ApiErrorHttpException && error.errorObject.code === code
      );
    }
    assert.deepEqual(harness.operations, []);
  }

  const roleService = await readFile(
    fileURLToPath(
      new URL(
        "../src/modules/workspace-management/application/manage-assistant-roles.service.ts",
        import.meta.url
      )
    ),
    "utf8"
  );
  assert.match(
    roleService,
    /FROM "assistants"[\s\S]*WHERE "id" = \$\{resolved\.assistantId\}::uuid[\s\S]*FOR UPDATE/
  );
  assert.match(
    roleService,
    /assistant\.update[\s\S]*assistantChat\.updateMany/,
    "Role change must wait on the same Assistant lock and then clear every chat"
  );
}

void run();
