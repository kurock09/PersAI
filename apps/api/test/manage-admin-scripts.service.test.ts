import assert from "node:assert/strict";
import test from "node:test";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ManageAdminScriptsService } from "../src/modules/workspace-management/application/manage-admin-scripts.service";

const scriptId = "00000000-0000-4000-8000-000000000151";
const versionId = "00000000-0000-4000-8000-000000000152";
const skillId = "00000000-0000-4000-8000-000000000153";
const roleId = "00000000-0000-4000-8000-000000000154";
const assistantId = "00000000-0000-4000-8000-000000000155";
const userId = "00000000-0000-4000-8000-000000000156";
const now = new Date("2026-07-16T18:00:00.000Z");
const executable = {
  code: "echo ok",
  manifest: { schemaVersion: 1 as const, workingDirectory: null, environment: {} },
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  runtime: "bash",
  entryCommand: "bash -lc 'echo ok'",
  limits: {
    timeoutMs: 1000,
    maxMemoryMb: 128,
    maxCpuMillicores: 500,
    maxOutputBytes: 1024
  }
};

function scriptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: scriptId,
    key: "sample_script",
    name: { ru: "Скрипт", en: "Script" },
    description: { ru: "Описание", en: "Description" },
    status: "draft",
    category: "test",
    icon: null,
    color: null,
    displayOrder: 1,
    currentPublishedVersionId: null,
    createdByUserId: userId,
    updatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: versionId,
    scriptId,
    version: 1,
    status: "draft",
    ...executable,
    contentHash: null,
    revision: 2,
    createdByUserId: userId,
    publishedByUserId: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    ...overrides
  };
}

function auth() {
  return {
    assertCanReadAdminSurface: async () => undefined,
    assertCanWriteGlobalKnowledge: async () => undefined
  };
}

function sqlText(value: unknown): string {
  const candidate = value as { strings?: readonly string[] };
  return candidate.strings?.join("?") ?? "";
}

void test("publish freezes the exact draft hash, advances Script, and dirties linked assistants", async () => {
  let versionUpdate: Record<string, unknown> | null = null;
  let scriptUpdate: Record<string, unknown> | null = null;
  let dirtyUpdate: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: async (query: unknown) =>
      sqlText(query).includes("clock_timestamp") ? [{ now }] : [],
    skillScript: {
      findMany: async () => [{ skillId }]
    },
    script: {
      findUnique: async () => scriptRow(),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        scriptUpdate = data;
        return scriptRow({
          ...data,
          status: "published",
          currentPublishedVersionId: versionId
        });
      }
    },
    scriptVersion: {
      findFirst: async () => versionRow(),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        versionUpdate = data;
        return versionRow({
          status: "published",
          contentHash: data.contentHash,
          revision: 3,
          publishedByUserId: userId,
          publishedAt: now
        });
      }
    },
    assistantRole: { findMany: async () => [{ id: roleId }] },
    assistant: {
      findMany: async () => [{ id: assistantId }],
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        dirtyUpdate = data;
        return { count: 1 };
      }
    }
  };
  const prisma = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
  const service = new ManageAdminScriptsService(auth() as never, prisma as never);
  const result = await service.publishVersion(userId, scriptId, versionId, 2);

  assert.equal(result.script.currentPublishedVersionId, versionId);
  assert.match(result.version.contentHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal((versionUpdate as Record<string, unknown>).status, "published");
  assert.equal((scriptUpdate as Record<string, unknown>).status, "published");
  assert.deepEqual(dirtyUpdate, { configDirtyAt: now });
});

void test("archive fails closed while a live Skill link remains", async () => {
  const tx = {
    $queryRaw: async () => [],
    skillScript: { findMany: async () => [{ skillId }] },
    script: { findUnique: async () => scriptRow() }
  };
  const prisma = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
  const service = new ManageAdminScriptsService(auth() as never, prisma as never);
  await assert.rejects(
    () => service.archive(userId, scriptId),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.getStatus() === 409 &&
      error.errorObject.code === "admin_script_in_use"
  );
});

void test("archive checks live Scenario references with a bounded DB-side JSONB query", async () => {
  let scenarioQuery = "";
  const tx = {
    $queryRaw: async (query: unknown) => {
      const sql = sqlText(query);
      if (sql.includes("jsonb_array_elements")) {
        scenarioQuery = sql;
        return [{ exists: true }];
      }
      return [];
    },
    skillScript: { findMany: async () => [] },
    script: { findUnique: async () => scriptRow() }
  };
  const prisma = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
  const service = new ManageAdminScriptsService(auth() as never, prisma as never);

  await assert.rejects(
    () => service.archive(userId, scriptId),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.getStatus() === 409 &&
      error.errorObject.code === "admin_script_in_use"
  );
  assert.match(scenarioQuery, /SELECT EXISTS/);
  assert.match(scenarioQuery, /jsonb_array_elements/);
  assert.match(scenarioQuery, /scriptRef/);
  assert.match(scenarioQuery, /scriptKey/);
});

void test("ordered Skill Script bindings can be read before replacement", async () => {
  let readAuthorized = false;
  const linkedScript = scriptRow({
    status: "published",
    currentPublishedVersionId: versionId
  });
  const prisma = {
    skill: { findUnique: async () => ({ id: skillId }) },
    skillScript: {
      findMany: async () => [
        {
          skillId,
          scriptId,
          displayOrder: 0,
          createdAt: now,
          script: linkedScript
        }
      ]
    }
  };
  const service = new ManageAdminScriptsService(
    {
      assertCanReadAdminSurface: async () => {
        readAuthorized = true;
      }
    } as never,
    prisma as never
  );

  const result = await service.listSkillScripts(userId, skillId);
  assert.equal(readAuthorized, true);
  assert.deepEqual(
    result.map((link) => link.scriptId),
    [scriptId]
  );
  assert.equal(result[0]?.displayOrder, 0);
});

void test("Skill Script replacement persists caller order and only published current Scripts", async () => {
  const secondScriptId = "00000000-0000-4000-8000-000000000157";
  let created: Array<{ skillId: string; scriptId: string; displayOrder: number }> = [];
  const scripts = [scriptRow({ status: "published", currentPublishedVersionId: versionId })];
  scripts.push(
    scriptRow({
      id: secondScriptId,
      key: "second_script",
      status: "published",
      currentPublishedVersionId: "00000000-0000-4000-8000-000000000158"
    })
  );
  const tx = {
    $queryRaw: async (query: unknown) =>
      sqlText(query).includes("clock_timestamp") ? [{ now }] : [],
    skill: { findUnique: async () => ({ id: skillId }) },
    skillScript: {
      findMany: async (args: { include?: unknown }) =>
        args.include
          ? created.map((link) => ({
              ...link,
              createdAt: now,
              script: scripts.find((script) => script.id === link.scriptId)
            }))
          : [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: typeof created }) => {
        created = data;
        return { count: data.length };
      }
    },
    script: {
      findMany: async () =>
        scripts.map((script) => ({
          id: script.id,
          status: script.status,
          currentPublishedVersionId: script.currentPublishedVersionId
        }))
    },
    assistantRole: { findMany: async () => [] },
    assistant: { findMany: async () => [], updateMany: async () => ({ count: 0 }) }
  };
  const prisma = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
  const service = new ManageAdminScriptsService(auth() as never, prisma as never);
  const result = await service.replaceSkillScripts(userId, skillId, [secondScriptId, scriptId]);

  assert.deepEqual(
    created.map(({ scriptId, displayOrder }) => ({ scriptId, displayOrder })),
    [
      { scriptId: secondScriptId, displayOrder: 0 },
      { scriptId, displayOrder: 1 }
    ]
  );
  assert.deepEqual(
    result.map((link) => link.scriptId),
    [secondScriptId, scriptId]
  );
});

void test("Skill Script replacement blocks removal referenced by a live Scenario", async () => {
  const tx = {
    $queryRaw: async (query: unknown) =>
      sqlText(query).includes("jsonb_array_elements") ? [{ exists: true }] : [],
    skill: { findUnique: async () => ({ id: skillId, status: "active", archivedAt: null }) },
    skillScript: {
      findMany: async () => [{ scriptId, script: { key: "sample_script" } }]
    }
  };
  const prisma = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
  const service = new ManageAdminScriptsService(auth() as never, prisma as never);

  await assert.rejects(
    () => service.replaceSkillScripts(userId, skillId, []),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.getStatus() === 409 &&
      error.errorObject.code === "admin_skill_script_scenario_reference"
  );
});

for (const reason of ["Scenario archived", "scriptRef removed"] as const) {
  void test(`Skill Script replacement allows removal after ${reason}`, async () => {
    let deleted = false;
    const tx = {
      $queryRaw: async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes("jsonb_array_elements")) return [{ exists: false }];
        if (sql.includes("clock_timestamp")) return [{ now }];
        return [];
      },
      skill: { findUnique: async () => ({ id: skillId, status: "active", archivedAt: null }) },
      skillScript: {
        findMany: async (args: { include?: unknown }) =>
          args.include ? [] : [{ scriptId, script: { key: "sample_script" } }],
        deleteMany: async () => {
          deleted = true;
          return { count: 1 };
        }
      },
      script: { findMany: async () => [] },
      assistantRole: { findMany: async () => [] },
      assistant: { findMany: async () => [], updateMany: async () => ({ count: 0 }) }
    };
    const prisma = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
    const service = new ManageAdminScriptsService(auth() as never, prisma as never);

    assert.deepEqual(await service.replaceSkillScripts(userId, skillId, []), []);
    assert.equal(deleted, true);
  });
}
