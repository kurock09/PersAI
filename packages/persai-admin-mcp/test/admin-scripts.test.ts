import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminScriptMcpInputSchemas,
  createPersaiAdminMcpServer,
  requestScriptArchive,
  requestScriptGet,
  requestScriptList,
  requestScriptPublish,
  requestScriptUpsert,
  requestScriptVersionUpsert,
  requestScriptVersionValidate,
  requestSkillScriptsList,
  requestSkillScriptsReplace,
  resolveAdminScriptByKey
} from "../src/server.js";
import { PersaiOperatorApiError } from "../src/client.js";
import type { PersaiAdminMcpConfig } from "../src/config.js";

type Request = { method: string; path: string; body?: unknown };

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

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};
type RegisteredTool = {
  inputSchema: { safeParse(value: unknown): { success: boolean } };
  handler(args: Record<string, unknown>): Promise<ToolResult>;
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

const scriptId = "00000000-0000-4000-8000-000000000501";
const otherScriptId = "00000000-0000-4000-8000-000000000502";
const skillId = "00000000-0000-4000-8000-000000000701";
const draftVersionId = "00000000-0000-4000-8000-000000000601";
const script = { id: scriptId, key: "send_report", status: "draft" };
const versionBody = {
  code: "print('hi')",
  manifest: { schemaVersion: 1 as const, workingDirectory: null, environment: {} },
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  runtime: "python3",
  entryCommand: 'python3 "$PERSAI_SCRIPT_ENTRY_PATH"',
  limits: { timeoutMs: 5_000, maxMemoryMb: 256, maxCpuMillicores: 500, maxOutputBytes: 65_536 }
};

function scriptVersionParse(body: Record<string, unknown>) {
  return adminScriptMcpInputSchemas.scriptVersionUpsert.safeParse({
    scriptKey: "send_report",
    body
  });
}

function clientWithScripts(
  requests: Request[],
  scripts: unknown[],
  extra?: Record<string, unknown>
) {
  const routes = extra ?? {};
  return {
    async requestJson(request: Request) {
      requests.push(request);
      if (request.method === "GET" && request.path === "/api/v1/admin/scripts") {
        return { scripts };
      }
      const key = `${request.method} ${request.path}`;
      if (key in routes) {
        return routes[key];
      }
      return { ok: true };
    }
  } as never;
}

void test("resolveAdminScriptByKey uses admin scripts list and matches immutable scriptKey", async () => {
  const requests: Request[] = [];
  const resolved = await resolveAdminScriptByKey(
    clientWithScripts(requests, [script, { id: otherScriptId, key: "other" }]),
    "send_report"
  );
  assert.deepEqual(requests, [{ method: "GET", path: "/api/v1/admin/scripts" }]);
  assert.equal(resolved.id, scriptId);
});

void test("resolveAdminScriptByKey fails closed when scriptKey is missing", async () => {
  await assert.rejects(
    () =>
      resolveAdminScriptByKey(
        clientWithScripts([], [{ id: otherScriptId, key: "other" }]),
        "missing_key"
      ),
    /Script key "missing_key" was not found/
  );
});

void test("requestScriptList performs one bodyless GET", async () => {
  const requests: Request[] = [];
  await requestScriptList(clientWithScripts(requests, [script]));
  assert.deepEqual(requests, [{ method: "GET", path: "/api/v1/admin/scripts" }]);
});

void test("requestScriptGet resolves scriptId then fetches script + versions in parallel", async () => {
  const requests: Request[] = [];
  const client = clientWithScripts(requests, [script], {
    [`GET /api/v1/admin/scripts/${scriptId}`]: { script },
    [`GET /api/v1/admin/scripts/${scriptId}/versions`]: {
      versions: [{ id: draftVersionId, status: "draft" }]
    }
  });
  const result = await requestScriptGet(client, "send_report");
  assert.deepEqual(
    requests.map((request) => ({ method: request.method, path: request.path })),
    [
      { method: "GET", path: "/api/v1/admin/scripts" },
      { method: "GET", path: `/api/v1/admin/scripts/${scriptId}` },
      { method: "GET", path: `/api/v1/admin/scripts/${scriptId}/versions` }
    ]
  );
  assert.deepEqual(result, {
    script,
    versions: [{ id: draftVersionId, status: "draft" }]
  });
});

void test("requestScriptUpsert creates via POST with key in body when scriptKey is not found", async () => {
  const requests: Request[] = [];
  const body = {
    name: { en: "Send report", ru: "Отправить отчёт" },
    description: { en: "Sends a report.", ru: "Отправляет отчёт." },
    category: "automation",
    icon: null,
    color: null,
    displayOrder: 10
  };
  await requestScriptUpsert(clientWithScripts(requests, []), "send_report", body);
  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/admin/scripts" },
    { method: "POST", path: "/api/v1/admin/scripts", body: { key: "send_report", ...body } }
  ]);
});

void test("requestScriptUpsert updates via PATCH with resolved scriptId when scriptKey exists", async () => {
  const requests: Request[] = [];
  const body = {
    name: { en: "Send report", ru: "Отправить отчёт" },
    description: { en: "Sends a report.", ru: "Отправляет отчёт." },
    category: "automation",
    icon: null,
    color: null,
    displayOrder: 10
  };
  await requestScriptUpsert(clientWithScripts(requests, [script]), "send_report", body);
  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/admin/scripts" },
    { method: "PATCH", path: `/api/v1/admin/scripts/${scriptId}`, body }
  ]);
});

void test("requestScriptVersionUpsert creates the first draft via POST when no draft exists", async () => {
  const requests: Request[] = [];
  const client = clientWithScripts(requests, [script], {
    [`GET /api/v1/admin/scripts/${scriptId}/versions`]: { versions: [] }
  });
  await requestScriptVersionUpsert(client, "send_report", versionBody);
  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/admin/scripts" },
    { method: "GET", path: `/api/v1/admin/scripts/${scriptId}/versions` },
    { method: "POST", path: `/api/v1/admin/scripts/${scriptId}/versions`, body: versionBody }
  ]);
});

void test("requestScriptVersionUpsert updates the existing draft with auto-resolved expectedRevision", async () => {
  const requests: Request[] = [];
  const client = clientWithScripts(requests, [script], {
    [`GET /api/v1/admin/scripts/${scriptId}/versions`]: {
      versions: [{ id: draftVersionId, status: "draft", revision: 3 }]
    }
  });
  await requestScriptVersionUpsert(client, "send_report", versionBody);
  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/admin/scripts" },
    { method: "GET", path: `/api/v1/admin/scripts/${scriptId}/versions` },
    {
      method: "PATCH",
      path: `/api/v1/admin/scripts/${scriptId}/versions/${draftVersionId}`,
      body: { ...versionBody, expectedRevision: 3 }
    }
  ]);
});

void test("requestScriptVersionValidate resolves the current draft and calls its validate route", async () => {
  const requests: Request[] = [];
  const client = clientWithScripts(requests, [script], {
    [`GET /api/v1/admin/scripts/${scriptId}/versions`]: {
      versions: [{ id: draftVersionId, status: "draft", revision: 1 }]
    }
  });
  await requestScriptVersionValidate(client, "send_report");
  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/admin/scripts" },
    { method: "GET", path: `/api/v1/admin/scripts/${scriptId}/versions` },
    {
      method: "POST",
      path: `/api/v1/admin/scripts/${scriptId}/versions/${draftVersionId}/validate`
    }
  ]);
});

void test("requestScriptVersionValidate fails closed when no draft version exists", async () => {
  const requests: Request[] = [];
  const client = clientWithScripts(requests, [script], {
    [`GET /api/v1/admin/scripts/${scriptId}/versions`]: { versions: [] }
  });
  await assert.rejects(
    () => requestScriptVersionValidate(client, "send_report"),
    /Script "send_report" has no draft version to validate/
  );
});

void test("requestScriptPublish resolves versionId/expectedRevision and calls the publish route", async () => {
  const requests: Request[] = [];
  const client = clientWithScripts(requests, [script], {
    [`GET /api/v1/admin/scripts/${scriptId}/versions`]: {
      versions: [{ id: draftVersionId, status: "draft", revision: 2 }]
    }
  });
  await requestScriptPublish(client, "send_report");
  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/admin/scripts" },
    { method: "GET", path: `/api/v1/admin/scripts/${scriptId}/versions` },
    {
      method: "POST",
      path: `/api/v1/admin/scripts/${scriptId}/versions/${draftVersionId}/publish`,
      body: { expectedRevision: 2 }
    }
  ]);
});

void test("requestScriptPublish fails closed when there is no draft version to publish", async () => {
  const requests: Request[] = [];
  const client = clientWithScripts(requests, [script], {
    [`GET /api/v1/admin/scripts/${scriptId}/versions`]: { versions: [] }
  });
  await assert.rejects(
    () => requestScriptPublish(client, "send_report"),
    /Script "send_report" has no draft version to publish/
  );
});

void test("requestScriptArchive resolves scriptId then calls DELETE", async () => {
  const requests: Request[] = [];
  await requestScriptArchive(clientWithScripts(requests, [script]), "send_report");
  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/admin/scripts" },
    { method: "DELETE", path: `/api/v1/admin/scripts/${scriptId}` }
  ]);
});

void test("requestSkillScriptsList and requestSkillScriptsReplace map exact HTTP paths and bodies", async () => {
  {
    const requests: Request[] = [];
    await requestSkillScriptsList(
      {
        async requestJson(request: Request) {
          requests.push(request);
          return { scripts: [] };
        }
      } as never,
      skillId
    );
    assert.deepEqual(requests, [
      { method: "GET", path: `/api/v1/admin/skills/${skillId}/scripts` }
    ]);
  }
  {
    const requests: Request[] = [];
    const scriptIds = [scriptId, otherScriptId];
    await requestSkillScriptsReplace(
      {
        async requestJson(request: Request) {
          requests.push(request);
          return { scripts: [] };
        }
      } as never,
      skillId,
      scriptIds
    );
    assert.deepEqual(requests, [
      { method: "PUT", path: `/api/v1/admin/skills/${skillId}/scripts`, body: { scriptIds } }
    ]);
  }
});

void test("all nine Script/Skill-Script tools are registered and reachable via the server", async () => {
  const server = createPersaiAdminMcpServer(config, {
    async requestJson() {
      return { scripts: [], versions: [] };
    }
  } as never);
  const tools = registeredTools(server);
  for (const toolName of [
    "script_list",
    "script_get",
    "script_upsert",
    "script_version_upsert",
    "script_version_validate",
    "script_publish",
    "script_archive",
    "skill_scripts_list",
    "skill_scripts_replace"
  ]) {
    assert.ok(tools[toolName], `${toolName} must be registered`);
  }
});

void test("script_list tool returns the canonical payload unchanged", async () => {
  const payload = { requestId: "req-1", scripts: [script] };
  const requests: Request[] = [];
  const server = createPersaiAdminMcpServer(config, {
    async requestJson(request: Request) {
      requests.push(request);
      return payload;
    }
  } as never);
  const tool = registeredTools(server).script_list;
  assert.ok(tool);
  const result = await tool.handler({});
  assert.deepEqual(requests, [{ method: "GET", path: "/api/v1/admin/scripts" }]);
  assert.deepEqual(parseText(result), payload);
});

void test("script tools surface the standard MCP API error contour with the API's typed code", async () => {
  const server = createPersaiAdminMcpServer(config, {
    async requestJson(request: Request) {
      if (request.path === "/api/v1/admin/scripts" && request.method === "GET") {
        return { scripts: [script] };
      }
      throw new PersaiOperatorApiError("Script archive failed.", 409, {
        error: { code: "admin_script_in_use", category: "conflict", message: "Script is in use." }
      });
    }
  } as never);
  const tool = registeredTools(server).script_archive;
  assert.ok(tool);
  const result = await tool.handler({ scriptKey: "send_report" });
  assert.equal(result.isError, true);
  const parsed = parseText(result) as { status: number; body: unknown };
  assert.equal(parsed.status, 409);
  assert.deepEqual(parsed.body, {
    error: { code: "admin_script_in_use", category: "conflict", message: "Script is in use." }
  });
});

void test("registered Script schemas enforce exact authoring parity", () => {
  const validCoreBody = {
    name: { en: "Send report", ru: "Отправить отчёт" },
    description: { en: "Sends a report.", ru: "Отправляет отчёт." },
    category: "automation",
    icon: null,
    color: null,
    displayOrder: 10
  };
  const validKey = "send_report";

  assert.equal(
    adminScriptMcpInputSchemas.scriptUpsert.safeParse({ scriptKey: validKey, body: validCoreBody })
      .success,
    true
  );
  assert.equal(
    adminScriptMcpInputSchemas.scriptGet.safeParse({ scriptKey: validKey }).success,
    true
  );
  assert.equal(
    adminScriptMcpInputSchemas.scriptPublish.safeParse({ scriptKey: validKey }).success,
    true
  );
  assert.equal(
    adminScriptMcpInputSchemas.scriptArchive.safeParse({ scriptKey: validKey }).success,
    true
  );
  assert.equal(
    adminScriptMcpInputSchemas.scriptVersionUpsert.safeParse({
      scriptKey: validKey,
      body: versionBody
    }).success,
    true
  );
  assert.equal(
    adminScriptMcpInputSchemas.skillScriptsReplace.safeParse({ skillId, scriptIds: [scriptId] })
      .success,
    true
  );

  assert.equal(
    adminScriptMcpInputSchemas.scriptUpsert.safeParse({ scriptKey: "Bad-Key", body: validCoreBody })
      .success,
    false
  );
  assert.equal(
    adminScriptMcpInputSchemas.scriptUpsert.safeParse({
      scriptKey: validKey,
      body: { ...validCoreBody, name: { ...validCoreBody.name, fr: "Envoyer" } }
    }).success,
    false,
    "name must reject non-ru/en locale keys (exact ru+en parity)"
  );
  assert.equal(
    adminScriptMcpInputSchemas.scriptUpsert.safeParse({
      scriptKey: validKey,
      body: {
        name: validCoreBody.name,
        description: validCoreBody.description,
        category: "automation"
      }
    }).success,
    false,
    "icon/color/displayOrder are required keys (API uses exact() on the core body)"
  );

  const duplicateScriptIds = adminScriptMcpInputSchemas.skillScriptsReplace.safeParse({
    skillId,
    scriptIds: [scriptId, scriptId.toUpperCase()]
  });
  assert.equal(duplicateScriptIds.success, false);
  if (!duplicateScriptIds.success) {
    assert.match(duplicateScriptIds.error.message, /must not contain duplicates/);
  }

  assert.equal(
    adminScriptMcpInputSchemas.scriptVersionUpsert.safeParse({
      scriptKey: validKey,
      body: { ...versionBody, code: "" }
    }).success,
    false
  );
  assert.equal(
    adminScriptMcpInputSchemas.scriptVersionUpsert.safeParse({
      scriptKey: validKey,
      body: { ...versionBody, runtime: "Python3" }
    }).success,
    false,
    "runtime must be lowercase per RUNTIME_PATTERN"
  );
});

void test("Script MCP schemas normalize and forward strings exactly like canonical parsers", async () => {
  const coreBody = {
    name: { en: "  Send report  ", ru: "  Отправить отчёт  " },
    description: { en: "  Sends a report.  ", ru: "  Отправляет отчёт.  " },
    category: "  automation  ",
    icon: "  terminal  ",
    color: "  blue  ",
    displayOrder: 10
  };
  const parsedCore = adminScriptMcpInputSchemas.scriptUpsert.safeParse({
    scriptKey: "  send_report  ",
    body: coreBody
  });
  assert.equal(parsedCore.success, true);
  assert.deepEqual(parsedCore.success ? parsedCore.data : null, {
    scriptKey: "send_report",
    body: {
      name: { en: "Send report", ru: "Отправить отчёт" },
      description: { en: "Sends a report.", ru: "Отправляет отчёт." },
      category: "automation",
      icon: "terminal",
      color: "blue",
      displayOrder: 10
    }
  });

  const coreRequests: Request[] = [];
  const coreServer = createPersaiAdminMcpServer(
    config,
    clientWithScripts(coreRequests, []) as never
  );
  const coreTool = registeredTools(coreServer).script_upsert;
  assert.ok(coreTool);
  assert.ok(parsedCore.success);
  await coreTool.handler(parsedCore.data);
  assert.deepEqual(coreRequests.at(-1), {
    method: "POST",
    path: "/api/v1/admin/scripts",
    body: {
      key: "send_report",
      name: { en: "Send report", ru: "Отправить отчёт" },
      description: { en: "Sends a report.", ru: "Отправляет отчёт." },
      category: "automation",
      icon: "terminal",
      color: "blue",
      displayOrder: 10
    }
  });

  const paddedVersion = {
    ...versionBody,
    code: "  print('preserved')  ",
    manifest: {
      schemaVersion: 1,
      workingDirectory: `  ${"w".repeat(512)}  `,
      environment: {}
    },
    runtime: "  python3  ",
    entryCommand: '  python3 "$PERSAI_SCRIPT_ENTRY_PATH"  '
  };
  const parsedVersion = adminScriptMcpInputSchemas.scriptVersionUpsert.safeParse({
    scriptKey: "  send_report  ",
    body: paddedVersion
  });
  assert.equal(parsedVersion.success, true);
  assert.equal(
    parsedVersion.success ? parsedVersion.data.body.manifest.workingDirectory : null,
    "w".repeat(512)
  );
  assert.equal(parsedVersion.success ? parsedVersion.data.body.runtime : null, "python3");
  assert.equal(
    parsedVersion.success ? parsedVersion.data.body.entryCommand : null,
    paddedVersion.entryCommand
  );
  assert.equal(parsedVersion.success ? parsedVersion.data.body.code : null, paddedVersion.code);

  const versionRequests: Request[] = [];
  const versionServer = createPersaiAdminMcpServer(
    config,
    clientWithScripts(versionRequests, [script], {
      [`GET /api/v1/admin/scripts/${scriptId}/versions`]: { versions: [] },
      [`POST /api/v1/admin/scripts/${scriptId}/versions`]: { version: { id: draftVersionId } }
    }) as never
  );
  const versionTool = registeredTools(versionServer).script_version_upsert;
  assert.ok(versionTool);
  assert.ok(parsedVersion.success);
  await versionTool.handler(parsedVersion.data);
  assert.deepEqual(versionRequests.at(-1), {
    method: "POST",
    path: `/api/v1/admin/scripts/${scriptId}/versions`,
    body: parsedVersion.data.body
  });

  const validCoreEdge = {
    ...coreBody,
    name: { en: `  ${"n".repeat(500)}  `, ru: "Имя" },
    description: { en: `  ${"d".repeat(2_000)}  `, ru: "Описание" },
    category: `  ${"c".repeat(64)}  `,
    icon: `  ${"i".repeat(64)}  `,
    color: `  ${"f".repeat(32)}  `
  };
  assert.equal(
    adminScriptMcpInputSchemas.scriptUpsert.safeParse({
      scriptKey: "  send_report  ",
      body: validCoreEdge
    }).success,
    true
  );
  for (const body of [
    { ...coreBody, name: { ...coreBody.name, en: "   " } },
    { ...coreBody, description: { ...coreBody.description, en: ` ${"d".repeat(2_001)} ` } },
    { ...coreBody, category: "   " },
    { ...coreBody, icon: "   " },
    { ...coreBody, color: ` ${"f".repeat(33)} ` }
  ]) {
    assert.equal(
      adminScriptMcpInputSchemas.scriptUpsert.safeParse({
        scriptKey: "send_report",
        body
      }).success,
      false
    );
  }
  assert.equal(
    scriptVersionParse({
      ...versionBody,
      manifest: { ...versionBody.manifest, workingDirectory: "   " }
    }).success,
    false
  );
  assert.equal(scriptVersionParse({ ...versionBody, runtime: "  Python3  " }).success, false);
  assert.equal(
    scriptVersionParse({ ...versionBody, entryCommand: ` ${"x".repeat(4_096)} ` }).success,
    false,
    "entryCommand is intentionally not trimmed by the API"
  );
});

void test("Script MCP schema mirrors canonical manifest and JSON Schema limits", () => {
  const environmentAtLimit = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`KEY_${String(index)}`, "x".repeat(4_096)])
  );
  assert.equal(
    scriptVersionParse({
      ...versionBody,
      manifest: {
        schemaVersion: 1,
        workingDirectory: "w".repeat(512),
        environment: environmentAtLimit
      }
    }).success,
    true
  );

  for (const manifest of [
    { schemaVersion: 1, workingDirectory: "w".repeat(513), environment: {} },
    {
      schemaVersion: 1,
      workingDirectory: null,
      environment: Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`KEY_${String(index)}`, "x"])
      )
    },
    { schemaVersion: 1, workingDirectory: null, environment: { lowercase: "x" } },
    { schemaVersion: 1, workingDirectory: null, environment: { ["__proto__"]: "x" } },
    {
      schemaVersion: 1,
      workingDirectory: null,
      environment: { PERSAI_SCRIPT_ENTRY_PATH: "x" }
    },
    { schemaVersion: 1, workingDirectory: null, environment: { KEY: "x".repeat(4_097) } }
  ]) {
    assert.equal(scriptVersionParse({ ...versionBody, manifest }).success, false);
  }

  const schemaBase = { type: "object", description: "" };
  const schemaOverhead = Buffer.byteLength(JSON.stringify(schemaBase), "utf8");
  const schemaAtByteLimit = {
    ...schemaBase,
    description: "x".repeat(65_536 - schemaOverhead)
  };
  assert.equal(Buffer.byteLength(JSON.stringify(schemaAtByteLimit), "utf8"), 65_536);
  assert.equal(
    scriptVersionParse({ ...versionBody, inputSchema: schemaAtByteLimit }).success,
    true
  );
  assert.equal(
    scriptVersionParse({
      ...versionBody,
      inputSchema: { ...schemaAtByteLimit, description: `${schemaAtByteLimit.description}x` }
    }).success,
    false
  );

  let schemaAtDepthLimit: Record<string, unknown> = { type: "string" };
  for (let index = 1; index < 16; index += 1) {
    schemaAtDepthLimit = { not: schemaAtDepthLimit };
  }
  assert.equal(
    scriptVersionParse({ ...versionBody, outputSchema: schemaAtDepthLimit }).success,
    true
  );
  assert.equal(
    scriptVersionParse({ ...versionBody, outputSchema: { not: schemaAtDepthLimit } }).success,
    false
  );
  assert.equal(
    scriptVersionParse({ ...versionBody, inputSchema: { type: "string" } }).success,
    false
  );
  assert.equal(
    scriptVersionParse({
      ...versionBody,
      outputSchema: { type: "not-a-json-schema-type" }
    }).success,
    false
  );
  assert.equal(
    scriptVersionParse({
      ...versionBody,
      outputSchema: { $ref: "https://example.test/schema.json" }
    }).success,
    false
  );
  for (const body of [
    { ...versionBody, code: "x".repeat(1_000_001) },
    { ...versionBody, entryCommand: "x".repeat(4_097) },
    { ...versionBody, limits: { ...versionBody.limits, timeoutMs: 99 } },
    { ...versionBody, limits: { ...versionBody.limits, timeoutMs: 1_800_001 } },
    { ...versionBody, limits: { ...versionBody.limits, maxMemoryMb: 15 } },
    { ...versionBody, limits: { ...versionBody.limits, maxMemoryMb: 32_769 } },
    { ...versionBody, limits: { ...versionBody.limits, maxCpuMillicores: 9 } },
    { ...versionBody, limits: { ...versionBody.limits, maxCpuMillicores: 16_001 } },
    { ...versionBody, limits: { ...versionBody.limits, maxOutputBytes: 0 } },
    { ...versionBody, limits: { ...versionBody.limits, maxOutputBytes: 100_000_001 } }
  ]) {
    assert.equal(scriptVersionParse(body).success, false);
  }
});

void test("Scenario scriptRef MCP schema mirrors mapping byte and literal-depth limits", () => {
  const server = createPersaiAdminMcpServer(config, {
    async requestJson() {
      return { ok: true };
    }
  } as never);
  const schema = registeredTools(server).skill_scenario_upsert?.inputSchema;
  assert.ok(schema);
  const scenarioInput = (inputMapping: Record<string, unknown>) => ({
    skillId,
    body: {
      key: "send_daily_report",
      displayName: { en: "Send daily report", ru: "Отправить ежедневный отчёт" },
      description: { en: "Sends the report.", ru: "Отправляет отчёт." },
      steps: [
        {
          number: 1,
          directive: "Run the Script.",
          scriptRef: { scriptKey: "send_report", inputMapping }
        }
      ],
      exitCondition: "The report was sent."
    }
  });

  const mappingBase = { value: { source: "literal", value: "" } };
  const mappingOverhead = Buffer.byteLength(JSON.stringify(mappingBase), "utf8");
  const mappingAtByteLimit = {
    value: { source: "literal", value: "x".repeat(16_384 - mappingOverhead) }
  };
  assert.equal(Buffer.byteLength(JSON.stringify(mappingAtByteLimit), "utf8"), 16_384);
  assert.equal(schema.safeParse(scenarioInput(mappingAtByteLimit)).success, true);
  assert.equal(
    schema.safeParse(
      scenarioInput({
        value: { source: "literal", value: `${mappingAtByteLimit.value.value}x` }
      })
    ).success,
    false
  );

  let literalAtDepthLimit: unknown = "value";
  for (let index = 0; index < 8; index += 1) {
    literalAtDepthLimit = [literalAtDepthLimit];
  }
  assert.equal(
    schema.safeParse(scenarioInput({ value: { source: "literal", value: literalAtDepthLimit } }))
      .success,
    true
  );
  assert.equal(
    schema.safeParse(scenarioInput({ value: { source: "literal", value: [literalAtDepthLimit] } }))
      .success,
    false
  );
  assert.equal(
    schema.safeParse(
      scenarioInput(
        Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [
            `value_${String(index)}`,
            { source: "current_user_message" }
          ])
        )
      )
    ).success,
    false
  );
});

void test("skill_scenario_upsert accepts a bound scriptRef step and rejects malformed input names", async () => {
  const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(serverSource, /scriptRef: scenarioScriptRefSchema/);

  const requests: Request[] = [];
  const server = createPersaiAdminMcpServer(config, {
    async requestJson(request: Request) {
      requests.push(request);
      return { ok: true };
    }
  } as never);
  const tool = registeredTools(server).skill_scenario_upsert;
  assert.ok(tool);

  const validBody = {
    key: "send_daily_report",
    displayName: { en: "Send daily report", ru: "Отправить ежедневный отчёт" },
    description: { en: "Sends the daily report.", ru: "Отправляет ежедневный отчёт." },
    intentExamples: ["send today's report"],
    steps: [
      {
        number: 1,
        directive: "Collect the report parameters from the user, then run the Script.",
        scriptRef: {
          scriptKey: "send_report",
          inputMapping: {
            recipient: { source: "current_user_message" },
            format: { source: "literal", value: "pdf" }
          }
        }
      }
    ],
    exitCondition: "The report was sent."
  };

  const result = await tool.handler({ skillId, body: validBody });
  assert.equal(result.isError, undefined);
  assert.deepEqual(requests, [
    {
      method: "POST",
      path: `/api/v1/admin/skills/${skillId}/scenarios`,
      body: validBody
    }
  ]);

  const invalidNameParse = tool.inputSchema.safeParse({
    skillId,
    body: {
      ...validBody,
      steps: [
        {
          ...validBody.steps[0],
          scriptRef: {
            scriptKey: "send_report",
            inputMapping: { ["__proto__"]: { source: "current_user_message" } }
          }
        }
      ]
    }
  });
  assert.equal(invalidNameParse.success, false);

  const invalidScriptKeyParse = tool.inputSchema.safeParse({
    skillId,
    body: {
      ...validBody,
      steps: [{ ...validBody.steps[0], scriptRef: { scriptKey: "Bad-Key", inputMapping: {} } }]
    }
  });
  assert.equal(invalidScriptKeyParse.success, false);
});
