import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { AdminRolesController } from "../src/modules/workspace-management/interface/http/admin-roles.controller";

const roleId = "00000000-0000-4000-8000-000000000201";
const request = {
  requestId: "request-147",
  resolvedAppUser: { id: "admin-1" }
} as never;

void test("AdminRolesController delegates parse/service calls and preserves response shapes", async () => {
  const calls: unknown[] = [];
  const role = { id: roleId, key: "analyst" };
  const service = {
    parseCreateInput: (body: unknown) => (calls.push(["parseCreate", body]), { parsed: "create" }),
    parseUpdateInput: (body: unknown) => (calls.push(["parseUpdate", body]), { parsed: "update" }),
    parseSkillsReplaceInput: (body: unknown) => (
      calls.push(["parseSkills", body]),
      { parsed: "skills" }
    ),
    parsePreviewInput: (body: unknown) => (
      calls.push(["parsePreview", body]),
      { parsed: "preview" }
    ),
    list: async (userId: string) => (calls.push(["list", userId]), [role]),
    get: async (userId: string, roleId: string) => (calls.push(["get", userId, roleId]), role),
    create: async (userId: string, input: unknown) => (calls.push(["create", userId, input]), role),
    update: async (userId: string, roleId: string, input: unknown) => (
      calls.push(["update", userId, roleId, input]),
      role
    ),
    archive: async (userId: string, roleId: string) => calls.push(["archive", userId, roleId]),
    replaceSkills: async (userId: string, roleId: string, input: unknown) => (
      calls.push(["replaceSkills", userId, roleId, input]),
      role
    ),
    preview: async (userId: string, input: unknown) => (
      calls.push(["preview", userId, input]),
      { locale: "en" }
    )
  };
  const controller = new AdminRolesController(service as never);

  assert.deepEqual(await controller.list(request), { requestId: "request-147", roles: [role] });
  assert.deepEqual(await controller.get(request, roleId), {
    requestId: "request-147",
    role
  });
  assert.deepEqual(await controller.create(request, { create: true }), {
    requestId: "request-147",
    role
  });
  assert.deepEqual(await controller.update(request, roleId, { update: true }), {
    requestId: "request-147",
    role
  });
  assert.deepEqual(await controller.replaceSkills(request, roleId, { skillIds: [] }), {
    requestId: "request-147",
    role
  });
  assert.deepEqual(await controller.preview(request, { locale: "en" }), {
    requestId: "request-147",
    preview: { locale: "en" }
  });
  assert.deepEqual(await controller.archive(request, roleId), {
    requestId: "request-147",
    archived: true
  });
  assert.ok(calls.some((call) => JSON.stringify(call).includes("parsePreview")));
});

void test("AdminRolesController rejects malformed roleId before delegation", async () => {
  const calls: string[] = [];
  const service = {
    get: async () => calls.push("get"),
    parseUpdateInput: () => calls.push("parseUpdate"),
    update: async () => calls.push("update"),
    archive: async () => calls.push("archive"),
    parseSkillsReplaceInput: () => calls.push("parseSkills"),
    replaceSkills: async () => calls.push("replaceSkills")
  };
  const controller = new AdminRolesController(service as never);
  const assertInvalid = (error: unknown) =>
    error instanceof ApiErrorHttpException &&
    error.getStatus() === 400 &&
    error.errorObject.code === "admin_role_invalid_id";

  await assert.rejects(() => controller.get(request, "not-a-uuid"), assertInvalid);
  await assert.rejects(
    () => controller.update(request, "not-a-uuid", { update: true }),
    assertInvalid
  );
  await assert.rejects(() => controller.archive(request, "not-a-uuid"), assertInvalid);
  await assert.rejects(
    () => controller.replaceSkills(request, "not-a-uuid", { skillIds: [] }),
    assertInvalid
  );
  assert.deepEqual(calls, []);
});

void test("AdminRolesController rejects missing authenticated app-user context", async () => {
  const controller = new AdminRolesController({} as never);
  await assert.rejects(
    () => controller.list({ requestId: "request-147" } as never),
    UnauthorizedException
  );
});
