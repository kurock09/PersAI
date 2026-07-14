import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PersaiOperatorApiError } from "../src/client.js";
import type { PersaiAdminMcpConfig } from "../src/config.js";
import { adminSkillMcpInputSchemas, createPersaiAdminMcpServer } from "../src/server.js";

type Request = { method: string; path: string; body?: unknown };
type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};
type RegisteredTool = {
  inputSchema: {
    safeParse(value: unknown): { success: boolean };
  };
  handler(args: Record<string, never>): Promise<ToolResult>;
};

const config: PersaiAdminMcpConfig = {
  apiBaseUrl: "https://api.example.test",
  operatorToken: "test-token",
  operatorActorUserId: null,
  operatorActorEmail: "operator@example.test",
  fetchTimeoutMs: 1_000,
  chatTimeoutMs: 1_000,
  indexingPollIntervalMs: 1,
  indexingTimeoutMs: 1_000,
  attachmentFetchMaxBytes: 1_024,
  artifactDir: "C:/tmp/persai-admin-mcp-test"
};

function registeredTools(server: ReturnType<typeof createPersaiAdminMcpServer>) {
  return (
    server as unknown as {
      _registeredTools: Record<string, RegisteredTool>;
    }
  )._registeredTools;
}

function parseText(result: ToolResult): unknown {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]?.type, "text");
  assert.equal(typeof result.content[0]?.text, "string");
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}

void test("skill_list is registered once with a strict empty input schema", async () => {
  const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const registrations = [...serverSource.matchAll(/registerTool\(\s*"skill_list"/g)];
  assert.equal(registrations.length, 1);

  const server = createPersaiAdminMcpServer(config, {
    async requestJson() {
      return { requestId: "request-unused", skills: [] };
    }
  } as never);
  const tools = registeredTools(server);

  assert.deepEqual(
    Object.keys(tools).filter((name) => name === "skill_list"),
    ["skill_list"]
  );
  assert.equal(adminSkillMcpInputSchemas.skillList.safeParse({}).success, true);
  assert.equal(adminSkillMcpInputSchemas.skillList.safeParse({ extra: true }).success, false);
  assert.equal(tools.skill_list?.inputSchema.safeParse({}).success, true);
  assert.equal(tools.skill_list?.inputSchema.safeParse({ extra: true }).success, false);

  for (const existingTool of [
    "skill_upsert",
    "skill_get",
    "skill_card_upsert",
    "skill_document_upload",
    "skill_scenario_upsert",
    "role_upsert",
    "role_get",
    "role_list",
    "role_skills_replace",
    "assistant_role_assign"
  ]) {
    assert.ok(tools[existingTool], `${existingTool} must remain registered`);
  }
});

void test("skill_list performs one bodyless GET and returns the canonical payload unchanged", async () => {
  const skillId = "00000000-0000-4000-8000-000000000301";
  const payload = {
    requestId: "request-skill-list",
    skills: [
      {
        id: skillId,
        status: "archived",
        name: { ru: "Маркетолог", en: "Marketer" },
        description: { ru: "Маркетинг", en: "Marketing" },
        instructionCard: {
          title: "Campaign",
          body: "Preserve the complete instruction card."
        },
        documents: [{ id: "00000000-0000-4000-8000-000000000302", status: "ready" }]
      }
    ]
  };
  const requests: Request[] = [];
  const client = {
    async requestJson(request: Request) {
      requests.push(request);
      return payload;
    }
  };

  const tool = registeredTools(createPersaiAdminMcpServer(config, client as never)).skill_list;
  assert.ok(tool);
  const result = await tool.handler({});

  assert.deepEqual(requests, [{ method: "GET", path: "/api/v1/admin/skills" }]);
  for (const request of requests) {
    assert.equal(Object.hasOwn(request, "body"), false);
  }
  assert.deepEqual(parseText(result), payload);

  const returned = parseText(result) as typeof payload;
  assert.equal(returned.skills[0]?.id, skillId);
  assert.equal(returned.skills[0]?.status, "archived");
  assert.deepEqual(returned.skills[0]?.name, { ru: "Маркетолог", en: "Marketer" });
  assert.deepEqual(returned.skills[0]?.description, { ru: "Маркетинг", en: "Marketing" });
  assert.deepEqual(returned.skills[0]?.instructionCard, payload.skills[0]?.instructionCard);
  assert.deepEqual(returned.skills[0]?.documents, payload.skills[0]?.documents);
});

void test("skill_list uses the standard MCP API error contour", async () => {
  const requests: Request[] = [];
  const server = createPersaiAdminMcpServer(config, {
    async requestJson(request: Request) {
      requests.push(request);
      throw new PersaiOperatorApiError("Skill list unavailable.", 503, {
        code: "skills_unavailable"
      });
    }
  } as never);
  const tool = registeredTools(server).skill_list;
  assert.ok(tool);

  const result = await tool.handler({});

  assert.equal(result.isError, true);
  assert.deepEqual(requests, [{ method: "GET", path: "/api/v1/admin/skills" }]);
  assert.deepEqual(parseText(result), {
    message: "Skill list unavailable.",
    status: 503,
    body: { code: "skills_unavailable" }
  });
});

void test("README documents skill_list before canonical Skill lookup and Role composition", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /`skill_list`/);
  assert.match(readme, /skill_list.*skill_get/s);
  assert.match(readme, /skill_list.*role_skills_replace/s);
});
