import assert from "node:assert/strict";
import test from "node:test";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { InternalRuntimeScriptArtifactService } from "../src/modules/workspace-management/application/internal-runtime-script-artifact.service";

const assistantId = "00000000-0000-4000-8000-000000000201";
const skillId = "00000000-0000-4000-8000-000000000202";
const roleId = "00000000-0000-4000-8000-000000000203";
const scriptId = "00000000-0000-4000-8000-000000000204";
const versionId = "00000000-0000-4000-8000-000000000205";
const contentHash = "a".repeat(64);
const executable = {
  runtime: "bash",
  entryCommand: "bash -lc 'echo ok'",
  manifest: { schemaVersion: 1 as const, workingDirectory: null, environment: {} },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: { type: "object", properties: {}, additionalProperties: false },
  limits: { timeoutMs: 1000, maxMemoryMb: 128, maxCpuMillicores: 500, maxOutputBytes: 1024 }
};

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: versionId,
    version: 3,
    status: "published",
    contentHash,
    ...executable,
    script: { id: scriptId, key: "sample_script", status: "published" },
    ...overrides
  };
}

function buildPrisma(
  overrides: {
    assistant?: unknown;
    roleSkillLink?: unknown;
    version?: unknown;
    skillScriptLink?: unknown;
  } = {}
) {
  return {
    assistant: {
      findUnique: async () => (overrides.assistant === undefined ? { roleId } : overrides.assistant)
    },
    assistantRoleSkill: {
      findUnique: async () =>
        overrides.roleSkillLink === undefined
          ? { skill: { status: "active", archivedAt: null } }
          : overrides.roleSkillLink
    },
    scriptVersion: {
      findUnique: async () => (overrides.version === undefined ? versionRow() : overrides.version)
    },
    skillScript: {
      findUnique: async () =>
        overrides.skillScriptLink === undefined ? { skillId, scriptId } : overrides.skillScriptLink
    }
  };
}

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    assistantId,
    skillId,
    scriptKey: "sample_script",
    scriptVersionId: versionId,
    contentHash,
    ...overrides
  };
}

async function assertConflict(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    () => promise,
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.getStatus() === 409 &&
      error.errorObject.code === code
  );
}

void test("fetchArtifact returns the exact pinned artifact for a live effective Skill", async () => {
  const service = new InternalRuntimeScriptArtifactService(buildPrisma() as never);
  const result = await service.fetchArtifact(buildInput());
  assert.equal(result.scriptId, scriptId);
  assert.equal(result.scriptKey, "sample_script");
  assert.equal(result.scriptVersionId, versionId);
  assert.equal(result.versionNumber, 3);
  assert.equal(result.contentHash, contentHash);
  assert.equal(result.runtime, "bash");
  assert.equal(result.entryCommand, "bash -lc 'echo ok'");
  assert.deepEqual(result.inputSchema, executable.inputSchema);
  assert.deepEqual(result.outputSchema, executable.outputSchema);
});

void test("fetchArtifact allows an older published version after a newer publication", async () => {
  // ADR-151: the pin is immutable — an admitted bundle keeps referencing an
  // exact version even after the Script publishes a newer one. As long as
  // that exact version row is still status="published" (never revoked) and
  // the Script/link stay live, the older pin must still resolve.
  const service = new InternalRuntimeScriptArtifactService(
    buildPrisma({ version: versionRow({ version: 1 }) }) as never
  );
  const result = await service.fetchArtifact(buildInput());
  assert.equal(result.versionNumber, 1);
});

void test("fetchArtifact rejects when the assistant does not exist", async () => {
  const service = new InternalRuntimeScriptArtifactService(
    buildPrisma({ assistant: null }) as never
  );
  await assert.rejects(() => service.fetchArtifact(buildInput()), /Assistant not found/);
});

void test("fetchArtifact fails closed when the Skill is no longer effective (unassigned role)", async () => {
  const service = new InternalRuntimeScriptArtifactService(
    buildPrisma({ roleSkillLink: null }) as never
  );
  await assertConflict(service.fetchArtifact(buildInput()), "runtime_script_skill_not_effective");
});

void test("fetchArtifact fails closed when the Skill is archived", async () => {
  const service = new InternalRuntimeScriptArtifactService(
    buildPrisma({
      roleSkillLink: { skill: { status: "active", archivedAt: new Date("2026-01-01") } }
    }) as never
  );
  await assertConflict(service.fetchArtifact(buildInput()), "runtime_script_skill_not_effective");
});

void test("fetchArtifact fails closed when the ScriptVersion row no longer exists", async () => {
  const service = new InternalRuntimeScriptArtifactService(buildPrisma({ version: null }) as never);
  await assertConflict(service.fetchArtifact(buildInput()), "runtime_script_version_not_found");
});

void test("fetchArtifact fails closed when the pinned version is not published", async () => {
  const service = new InternalRuntimeScriptArtifactService(
    buildPrisma({ version: versionRow({ status: "draft" }) }) as never
  );
  await assertConflict(service.fetchArtifact(buildInput()), "runtime_script_version_not_published");
});

void test("fetchArtifact fails closed on a content hash mismatch", async () => {
  const service = new InternalRuntimeScriptArtifactService(buildPrisma() as never);
  await assertConflict(
    service.fetchArtifact(buildInput({ contentHash: "b".repeat(64) })),
    "runtime_script_content_hash_mismatch"
  );
});

void test("fetchArtifact fails closed on a scriptKey mismatch", async () => {
  const service = new InternalRuntimeScriptArtifactService(buildPrisma() as never);
  await assertConflict(
    service.fetchArtifact(buildInput({ scriptKey: "other_script" })),
    "runtime_script_key_mismatch"
  );
});

void test("fetchArtifact fails closed when the Script has been archived", async () => {
  const service = new InternalRuntimeScriptArtifactService(
    buildPrisma({
      version: versionRow({ script: { id: scriptId, key: "sample_script", status: "archived" } })
    }) as never
  );
  await assertConflict(service.fetchArtifact(buildInput()), "runtime_script_archived");
});

void test("fetchArtifact fails closed when the Script is no longer linked to the Skill", async () => {
  const service = new InternalRuntimeScriptArtifactService(
    buildPrisma({ skillScriptLink: null }) as never
  );
  await assertConflict(service.fetchArtifact(buildInput()), "runtime_script_unlinked");
});

void test("parseInput requires well-formed UUIDs and a non-empty scriptKey/contentHash", async () => {
  const service = new InternalRuntimeScriptArtifactService(buildPrisma() as never);
  assert.throws(() => service.parseInput({ ...buildInput(), assistantId: "not-a-uuid" }));
  assert.throws(() => service.parseInput({ ...buildInput(), scriptKey: "" }));
  assert.throws(() => service.parseInput({ ...buildInput(), contentHash: "short" }));
  assert.throws(() => service.parseInput({ ...buildInput(), extra: true }));
  assert.throws(() => service.parseInput(null));
  const parsed = service.parseInput(buildInput());
  assert.deepEqual(parsed, buildInput());
});
