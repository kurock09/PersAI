import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeScriptContentHash,
  parseOrderedScriptIds,
  parseScriptCreateInput,
  parseScriptVersionCreateInput
} from "../src/modules/workspace-management/application/script-management.types";
import {
  parseCreateSkillScenarioInput,
  toAdminSkillScenarioState
} from "../src/modules/workspace-management/application/skill-scenario.types";

const executable = {
  code: "console.log(JSON.stringify({ok:true}))\n",
  manifest: { schemaVersion: 1, workingDirectory: null, environment: {} },
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: { value: { type: "string" } }
  },
  outputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["ok"],
    properties: { ok: { type: "boolean" } }
  },
  runtime: "node",
  entryCommand: "node /workspace/script.js",
  limits: {
    timeoutMs: 30_000,
    maxMemoryMb: 512,
    maxCpuMillicores: 1000,
    maxOutputBytes: 1_000_000
  }
};

void test("Script parsers require exact localized catalog and executable shapes", () => {
  assert.deepEqual(
    parseScriptCreateInput({
      key: "customer_export",
      name: { ru: "Экспорт", en: "Export" },
      description: { ru: "Выгружает данные", en: "Exports data" },
      category: "operations",
      icon: "download",
      color: "#112233",
      displayOrder: 10
    }).name,
    { ru: "Экспорт", en: "Export" }
  );
  assert.equal(parseScriptVersionCreateInput(executable).runtime, "node");
  assert.throws(
    () => parseScriptVersionCreateInput({ ...executable, language: "javascript" }),
    /unknown fields/
  );
  assert.throws(
    () =>
      parseScriptVersionCreateInput({
        ...executable,
        inputSchema: { $ref: "https://example.test/schema.json" }
      }),
    /remote references/
  );
});

void test("Script publish hash is stable over canonical executable fields", () => {
  const first = computeScriptContentHash(parseScriptVersionCreateInput(executable));
  const reordered = {
    limits: executable.limits,
    entryCommand: executable.entryCommand,
    runtime: executable.runtime,
    outputSchema: executable.outputSchema,
    inputSchema: executable.inputSchema,
    manifest: executable.manifest,
    code: executable.code
  };
  const second = computeScriptContentHash(parseScriptVersionCreateInput(reordered));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(second, first);
});

void test("Skill Script replacement preserves order and rejects duplicates", () => {
  const first = "00000000-0000-4000-8000-000000000151";
  const second = "00000000-0000-4000-8000-000000000152";
  assert.deepEqual(parseOrderedScriptIds({ scriptIds: [second, first] }), [second, first]);
  assert.throws(() => parseOrderedScriptIds({ scriptIds: [first, first] }), /duplicates/);
});

void test("Scenario scriptRef canonicalizes absence and accepts only bounded discriminated inputs", () => {
  const base = {
    key: "run_export",
    displayName: { ru: "Экспорт", en: "Export" },
    description: { ru: "Запускает экспорт", en: "Runs export" },
    iconEmoji: null,
    intentExamples: [],
    recommendedTools: [],
    exitCondition: "Export returned.",
    firstStepPreview: null,
    status: null,
    displayOrder: null
  };
  const without = parseCreateSkillScenarioInput({
    ...base,
    steps: [
      {
        number: 1,
        directive: "Prepare export.",
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: []
      }
    ]
  });
  assert.equal(without.steps[0]?.scriptRef, null);

  const withRef = parseCreateSkillScenarioInput({
    ...base,
    steps: [
      {
        number: 1,
        directive: "Run export.",
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: [],
        scriptRef: {
          scriptKey: "customer_export",
          inputMapping: {
            format: { source: "literal", value: "csv" },
            prompt: { source: "current_user_message" },
            customerId: { source: "tool_input", name: "customer_id" }
          }
        }
      }
    ]
  });
  assert.equal(withRef.steps[0]?.scriptRef?.scriptKey, "customer_export");
  assert.throws(
    () =>
      parseCreateSkillScenarioInput({
        ...base,
        steps: [
          {
            number: 1,
            directive: "Run.",
            negativeGuards: [],
            scriptRef: {
              scriptKey: "customer_export",
              inputMapping: { bad: { source: "json_path", path: "$.user" } }
            }
          }
        ]
      }),
    /must be literal/
  );
});

void test("persisted malformed non-null scriptRef fails closed instead of canonicalizing to null", () => {
  assert.throws(
    () =>
      toAdminSkillScenarioState({
        id: "00000000-0000-4000-8000-000000000159",
        skillId: "00000000-0000-4000-8000-000000000153",
        key: "corrupt_ref",
        displayName: { ru: "Сбой", en: "Corrupt" },
        description: { ru: "Сбой", en: "Corrupt" },
        iconEmoji: null,
        intentExamples: [],
        steps: [
          {
            number: 1,
            directive: "Run.",
            scriptRef: {
              scriptKey: "sample_script",
              inputMapping: { bad: { source: "json_path" } }
            }
          }
        ],
        recommendedTools: [],
        exitCondition: "Done.",
        firstStepPreview: null,
        status: "draft",
        displayOrder: 1,
        createdAt: new Date("2026-07-16T18:00:00.000Z"),
        updatedAt: new Date("2026-07-16T18:00:00.000Z")
      } as never),
    /must be literal, current_user_message, or tool_input/
  );
});

void test("ADR-151 migration enforces immutable published versions and one draft", () => {
  const migration = readFileSync(
    new URL(
      "../prisma/migrations/20260716220000_adr151_scripts_domain/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /script_versions_one_draft_per_script[\s\S]+WHERE "status" = 'draft'/);
  assert.match(migration, /published_script_version_immutable/);
  assert.match(migration, /scripts_key_immutable/);
  assert.match(migration, /scripts_current_published_version_valid/);
  assert.match(migration, /UNIQUE INDEX "sandbox_jobs_assistant_id_script_invocation_key_key"/);
  assert.match(
    migration,
    /script_versions_published_by_user_id_fkey"[^;]+ON DELETE RESTRICT ON UPDATE CASCADE/
  );
  assert.doesNotMatch(
    migration,
    /script_versions_published_by_user_id_fkey"[^;]+ON DELETE SET NULL/
  );
});
