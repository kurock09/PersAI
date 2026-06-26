import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { InternalWorkspaceFilesController } from "../src/modules/workspace-management/interface/http/internal-workspace-files.controller";

const TOKEN = "internal-test-token";

function setApiEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = TOKEN;
  process.env.WEB_ACTIVE_CHATS_CAP = "20";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "100";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "3";
}

function createController() {
  const deletes: Array<{ workspaceId: string; path: string }> = [];
  const controller = new InternalWorkspaceFilesController(
    {} as never,
    {} as never,
    {
      async delete(input: { workspaceId: string; path: string }) {
        deletes.push(input);
      }
    } as never
  );
  return { controller, deletes };
}

test("internal workspace metadata delete returns 204 semantics for shared paths", async () => {
  setApiEnv();
  const { controller, deletes } = createController();

  await assert.doesNotReject(() =>
    controller.deleteMetadata(
      { headers: { authorization: `Bearer ${TOKEN}` } },
      "workspace-1",
      "/workspace/report.txt"
    )
  );

  assert.deepEqual(deletes, [{ workspaceId: "workspace-1", path: "/workspace/report.txt" }]);
});

test("internal workspace metadata delete is idempotent when row is absent", async () => {
  setApiEnv();
  const { controller } = createController();

  await assert.doesNotReject(() =>
    controller.deleteMetadata(
      { headers: { authorization: `Bearer ${TOKEN}` } },
      "workspace-1",
      "/workspace/missing.txt"
    )
  );
});

test("internal workspace metadata delete rejects paths outside /workspace/", async () => {
  setApiEnv();
  const { controller } = createController();

  await assert.rejects(
    controller.deleteMetadata(
      { headers: { authorization: `Bearer ${TOKEN}` } },
      "workspace-1",
      "/tmp/scratch.txt"
    ),
    BadRequestException
  );
});

test("internal workspace metadata delete requires the internal token", async () => {
  setApiEnv();
  const { controller } = createController();

  await assert.rejects(
    controller.deleteMetadata({ headers: {} }, "workspace-1", "/workspace/report.txt"),
    UnauthorizedException
  );
  await assert.rejects(
    controller.deleteMetadata(
      { headers: { authorization: "Bearer wrong-token" } },
      "workspace-1",
      "/workspace/report.txt"
    ),
    UnauthorizedException
  );
});
