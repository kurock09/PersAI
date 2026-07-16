import assert from "node:assert/strict";
import { RequestMethod, type MiddlewareConsumer } from "@nestjs/common";
import test from "node:test";
import { IdentityAccessModule } from "../src/modules/identity-access/identity-access.module";
import {
  AdminScriptsController,
  AdminSkillScriptsController
} from "../src/modules/workspace-management/interface/http/admin-scripts.controller";

const scriptId = "00000000-0000-4000-8000-000000000151";
const versionId = "00000000-0000-4000-8000-000000000152";
const skillId = "00000000-0000-4000-8000-000000000153";
const request = { requestId: "request-151", resolvedAppUser: { id: "admin-user" } } as never;

void test("Admin Script controllers expose authoring only and delegate canonical parsing", async () => {
  const calls: unknown[] = [];
  const service = {
    parseCreateInput: (body: unknown) => (calls.push(["parseCreate", body]), body),
    parseUpdateInput: (body: unknown) => (calls.push(["parseUpdate", body]), body),
    parseVersionCreateInput: (body: unknown) => (calls.push(["parseVersionCreate", body]), body),
    parseVersionUpdateInput: (body: unknown) => (calls.push(["parseVersionUpdate", body]), body),
    parsePublishInput: (body: unknown) => (calls.push(["parsePublish", body]), 3),
    parseScriptsReplaceInput: (body: unknown) => (calls.push(["parseReplace", body]), [scriptId]),
    list: async () => [],
    get: async () => ({ id: scriptId }),
    create: async () => ({ id: scriptId }),
    update: async () => ({ id: scriptId }),
    archive: async () => ({ id: scriptId, status: "archived" }),
    listVersions: async () => [],
    createVersion: async () => ({ id: versionId }),
    updateVersion: async () => ({ id: versionId }),
    validateVersion: async () => ({ id: versionId }),
    publishVersion: async () => ({ script: { id: scriptId }, version: { id: versionId } }),
    listSkillScripts: async () => [],
    replaceSkillScripts: async () => []
  };
  const scripts = new AdminScriptsController(service as never);
  const skillScripts = new AdminSkillScriptsController(service as never);

  assert.deepEqual(await scripts.list(request), { requestId: "request-151", scripts: [] });
  assert.equal((await scripts.create(request, {})).script.id, scriptId);
  assert.equal((await scripts.update(request, scriptId, {})).script.id, scriptId);
  assert.equal((await scripts.archive(request, scriptId)).script.status, "archived");
  assert.equal((await scripts.createVersion(request, scriptId, {})).version.id, versionId);
  assert.equal(
    (await scripts.updateVersion(request, scriptId, versionId, {})).version.id,
    versionId
  );
  assert.equal((await scripts.validateVersion(request, scriptId, versionId)).valid, true);
  assert.equal(
    (await scripts.publishVersion(request, scriptId, versionId, {})).version.id,
    versionId
  );
  assert.deepEqual(await skillScripts.list(request, skillId), {
    requestId: "request-151",
    scripts: []
  });
  assert.deepEqual(await skillScripts.replace(request, skillId, { scriptIds: [scriptId] }), {
    requestId: "request-151",
    scripts: []
  });
  assert.equal(calls.length, 6);
  assert.equal("execute" in scripts, false, "Admin API must not expose Script execution");
});

void test("Identity middleware registers every ADR-151 operator route", () => {
  type Route = string | { path: string; method: RequestMethod };
  const routes: Route[] = [];
  const consumer = {
    apply: () => ({
      forRoutes: (...items: Route[]) => {
        routes.push(...items);
        return consumer as unknown as MiddlewareConsumer;
      }
    })
  };
  new IdentityAccessModule().configure(consumer as unknown as MiddlewareConsumer);
  const expected = [
    ["api/v1/admin/scripts", RequestMethod.GET],
    ["api/v1/admin/scripts", RequestMethod.POST],
    ["api/v1/admin/scripts/:scriptId", RequestMethod.GET],
    ["api/v1/admin/scripts/:scriptId", RequestMethod.PATCH],
    ["api/v1/admin/scripts/:scriptId", RequestMethod.DELETE],
    ["api/v1/admin/scripts/:scriptId/versions", RequestMethod.GET],
    ["api/v1/admin/scripts/:scriptId/versions", RequestMethod.POST],
    ["api/v1/admin/scripts/:scriptId/versions/:versionId", RequestMethod.PATCH],
    ["api/v1/admin/scripts/:scriptId/versions/:versionId/validate", RequestMethod.POST],
    ["api/v1/admin/scripts/:scriptId/versions/:versionId/publish", RequestMethod.POST],
    ["api/v1/admin/skills/:skillId/scripts", RequestMethod.GET],
    ["api/v1/admin/skills/:skillId/scripts", RequestMethod.PUT]
  ] as const;
  for (const [path, method] of expected) {
    assert.equal(
      routes.some(
        (route) => typeof route !== "string" && route.path === path && route.method === method
      ),
      true,
      `${RequestMethod[method]} /${path} must be guarded`
    );
  }
});
