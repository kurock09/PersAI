import assert from "node:assert/strict";
import test from "node:test";
import {
  adminRoleMcpInputSchemas,
  requestAssistantRoleAssign,
  requestRoleGet,
  requestRoleList,
  requestRoleSkillsReplace,
  requestRoleUpsert,
  resolveAdminRoleIdByKey
} from "../src/server.js";

type Request = { method: string; path: string; body?: unknown };

function clientWithRoles(requests: Request[], roles: unknown[]) {
  return {
    async requestJson(request: Request) {
      requests.push(request);
      if (request.method === "GET" && request.path === "/api/v1/admin/roles") {
        return { roles };
      }
      return { ok: true };
    }
  } as never;
}

void test("resolveAdminRoleIdByKey uses admin roles list and matches immutable roleKey", async () => {
  const requests: Array<{ method: string; path: string }> = [];
  const roleId = await resolveAdminRoleIdByKey(
    {
      async requestJson(request) {
        requests.push({ method: request.method, path: request.path });
        return {
          roles: [
            { id: "00000000-0000-4000-8000-000000000147", key: "persai_default" },
            { id: "00000000-0000-4000-8000-000000000201", key: "analyst" }
          ]
        };
      }
    } as never,
    "analyst"
  );

  assert.deepEqual(requests, [{ method: "GET", path: "/api/v1/admin/roles" }]);
  assert.equal(roleId, "00000000-0000-4000-8000-000000000201");
});

void test("all five Role tools map exact HTTP paths and bodies", async () => {
  const roleId = "00000000-0000-4000-8000-000000000201";
  const assistantId = "00000000-0000-4000-8000-000000000401";
  const skillIds = ["00000000-0000-4000-8000-000000000301"];
  const role = { id: roleId, key: "analyst" };
  const body = {
    name: { en: "Analyst", ru: "Аналитик" },
    description: { en: "Analysis", ru: "Анализ" },
    mission: { en: "Analyze.", ru: "Анализируй." },
    category: "work"
  };

  {
    const requests: Request[] = [];
    await requestRoleList(clientWithRoles(requests, [role]));
    assert.deepEqual(requests, [{ method: "GET", path: "/api/v1/admin/roles" }]);
  }
  {
    const requests: Request[] = [];
    await requestRoleGet(clientWithRoles(requests, [role]), "analyst");
    assert.deepEqual(requests, [
      { method: "GET", path: "/api/v1/admin/roles" },
      { method: "GET", path: `/api/v1/admin/roles/${roleId}` }
    ]);
  }
  {
    const requests: Request[] = [];
    await requestRoleUpsert(clientWithRoles(requests, []), "analyst", body);
    assert.deepEqual(requests, [
      { method: "GET", path: "/api/v1/admin/roles" },
      { method: "POST", path: "/api/v1/admin/roles", body: { key: "analyst", ...body } }
    ]);
  }
  {
    const requests: Request[] = [];
    await requestRoleUpsert(clientWithRoles(requests, [role]), "analyst", body);
    assert.deepEqual(requests, [
      { method: "GET", path: "/api/v1/admin/roles" },
      { method: "PATCH", path: `/api/v1/admin/roles/${roleId}`, body }
    ]);
  }
  {
    const requests: Request[] = [];
    await requestRoleSkillsReplace(clientWithRoles(requests, [role]), "analyst", skillIds);
    assert.deepEqual(requests, [
      { method: "GET", path: "/api/v1/admin/roles" },
      {
        method: "PUT",
        path: `/api/v1/admin/roles/${roleId}/skills`,
        body: { skillIds }
      }
    ]);
  }
  {
    const requests: Request[] = [];
    await requestAssistantRoleAssign(clientWithRoles(requests, [role]), assistantId, "analyst");
    assert.deepEqual(requests, [
      {
        method: "PUT",
        path: `/api/v1/assistant/${assistantId}/role`,
        body: { roleKey: "analyst" }
      }
    ]);
  }
});

void test("resolveAdminRoleIdByKey fails closed when roleKey is missing", async () => {
  await assert.rejects(
    () =>
      resolveAdminRoleIdByKey(
        {
          async requestJson() {
            return { roles: [{ id: "role-1", key: "other" }] };
          }
        } as never,
        "missing_role"
      ),
    /Admin Role key "missing_role" was not found/
  );
});

void test("registered Role schemas enforce exact authoring parity", () => {
  const validBody = {
    name: { en: "Analyst", ru: "Аналитик" },
    description: { en: "Analysis", ru: "Анализ" },
    mission: { en: "Analyze.", ru: "Анализируй." },
    category: "work"
  };
  const validKey = "ops_lead";
  const assistantId = "00000000-0000-4000-8000-000000000401";
  const skillId = "00000000-0000-4000-8000-000000000301";

  assert.equal(
    adminRoleMcpInputSchemas.roleUpsert.safeParse({ roleKey: validKey, body: validBody }).success,
    true
  );
  assert.equal(adminRoleMcpInputSchemas.roleGet.safeParse({ roleKey: validKey }).success, true);
  assert.equal(
    adminRoleMcpInputSchemas.roleSkillsReplace.safeParse({
      roleKey: validKey,
      skillIds: [skillId]
    }).success,
    true
  );
  assert.equal(
    adminRoleMcpInputSchemas.assistantRoleAssign.safeParse({ assistantId, roleKey: validKey })
      .success,
    true
  );

  for (const schema of [
    adminRoleMcpInputSchemas.roleGet,
    adminRoleMcpInputSchemas.roleUpsert,
    adminRoleMcpInputSchemas.roleSkillsReplace,
    adminRoleMcpInputSchemas.assistantRoleAssign
  ]) {
    const candidate =
      schema === adminRoleMcpInputSchemas.roleUpsert
        ? { roleKey: "Bad-Key", body: validBody }
        : schema === adminRoleMcpInputSchemas.roleSkillsReplace
          ? { roleKey: "Bad-Key", skillIds: [] }
          : schema === adminRoleMcpInputSchemas.assistantRoleAssign
            ? { assistantId, roleKey: "Bad-Key" }
            : { roleKey: "Bad-Key" };
    assert.equal(schema.safeParse(candidate).success, false);
  }

  assert.equal(
    adminRoleMcpInputSchemas.roleUpsert.safeParse({
      roleKey: validKey,
      body: { ...validBody, name: { ...validBody.name, fr: "Analyste" } }
    }).success,
    false
  );
  assert.equal(
    adminRoleMcpInputSchemas.roleUpsert.safeParse({
      roleKey: validKey,
      body: { ...validBody, description: { en: "x".repeat(501), ru: "Анализ" } }
    }).success,
    false
  );
  assert.equal(
    adminRoleMcpInputSchemas.roleUpsert.safeParse({
      roleKey: validKey,
      body: { ...validBody, mission: { en: "x".repeat(801), ru: "Анализируй." } }
    }).success,
    false
  );
  const duplicate = adminRoleMcpInputSchemas.roleSkillsReplace.safeParse({
    roleKey: validKey,
    skillIds: [skillId, skillId.toUpperCase()]
  });
  assert.equal(duplicate.success, false);
  if (!duplicate.success) {
    assert.match(duplicate.error.message, /must not contain duplicates/);
  }
});
