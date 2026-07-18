import assert from "node:assert/strict";
import test from "node:test";
import {
  describeMappingIncompatibility,
  materializeScenarioStepScriptRefs,
  type ScriptRefStepDegradation
} from "../src/modules/workspace-management/application/script-ref-materialization";
import { normalizeSkillScenarioSteps } from "../src/modules/workspace-management/application/skill-scenario-runtime-normalization";

const skillId = "00000000-0000-4000-8000-000000000301";
const scriptId = "00000000-0000-4000-8000-000000000302";
const versionId = "00000000-0000-4000-8000-000000000303";
const oldVersionId = "00000000-0000-4000-8000-000000000304";

function rawStep(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    directive: "Run the report Script.",
    scriptRef: {
      scriptKey: "sample_script",
      inputMapping: {
        query: { source: "current_user_message" },
        limit: { source: "literal", value: 10 },
        format: { source: "tool_input", name: "format" }
      }
    },
    ...overrides
  };
}

function buildPrisma(
  resolver: (scriptKey: string) => {
    script: {
      id: string;
      currentPublishedVersion: {
        id: string;
        version: number;
        contentHash: string | null;
        inputSchema: unknown;
      } | null;
    };
  } | null
) {
  const calls: string[] = [];
  return {
    prisma: {
      skillScript: {
        findFirst: async (args: { where: { script: { key: string } } }) => {
          calls.push(args.where.script.key);
          return resolver(args.where.script.key);
        }
      }
    },
    calls
  };
}

void test("materializeScenarioStepScriptRefs pins the exact scriptId/scriptVersionId/versionNumber/contentHash and carries inputMapping through unchanged", async () => {
  const { prisma } = buildPrisma(() => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: versionId,
        version: 4,
        contentHash: "c".repeat(64),
        inputSchema: { type: "object", properties: { query: { type: "string" } } }
      }
    }
  }));
  const steps = normalizeSkillScenarioSteps([rawStep()]);
  const [materialized] = await materializeScenarioStepScriptRefs({ prisma, skillId, steps });

  assert.deepEqual(materialized!.scriptRef, {
    scriptKey: "sample_script",
    scriptId,
    scriptVersionId: versionId,
    versionNumber: 4,
    contentHash: "c".repeat(64),
    inputMapping: {
      query: { source: "current_user_message" },
      limit: { source: "literal", value: 10 },
      format: { source: "tool_input", name: "format" }
    },
    inputSchema: { type: "object", properties: { query: { type: "string" } } }
  });
});

void test("materializeScenarioStepScriptRefs runs exactly one lookup per distinct scriptKey, not per step", async () => {
  const { prisma, calls } = buildPrisma(() => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: versionId,
        version: 1,
        contentHash: "d".repeat(64),
        inputSchema: { type: "object" }
      }
    }
  }));
  const steps = normalizeSkillScenarioSteps([
    rawStep({ number: 1 }),
    rawStep({ number: 2 }),
    { number: 3, directive: "No script here.", scriptRef: null }
  ]);
  await materializeScenarioStepScriptRefs({ prisma, skillId, steps });
  assert.deepEqual(calls, ["sample_script"]);
});

void test("materializeScenarioStepScriptRefs leaves a step with no authored scriptRef untouched", async () => {
  const { prisma } = buildPrisma(() => null);
  const steps = normalizeSkillScenarioSteps([
    { number: 1, directive: "Plain step.", scriptRef: null }
  ]);
  const [materialized] = await materializeScenarioStepScriptRefs({ prisma, skillId, steps });
  assert.equal(materialized!.scriptRef, null);
  assert.equal(materialized!.directive, "Plain step.");
});

void test("materializeScenarioStepScriptRefs degrades only the broken step when an authored ref has no live SkillScript link", async () => {
  const { prisma } = buildPrisma(() => null);
  const degradations: ScriptRefStepDegradation[] = [];
  const steps = normalizeSkillScenarioSteps([
    rawStep({ number: 1 }),
    { number: 2, directive: "Plain step.", scriptRef: null }
  ]);
  const materialized = await materializeScenarioStepScriptRefs({
    prisma,
    skillId,
    steps,
    onDegraded: (entry) => degradations.push(entry)
  });
  assert.equal(materialized[0]!.scriptRef, null);
  assert.equal(materialized[0]!.directive, "Run the report Script.");
  assert.equal(materialized[1]!.scriptRef, null);
  assert.equal(materialized[1]!.directive, "Plain step.");
  assert.equal(degradations.length, 1);
  assert.equal(degradations[0]!.scriptKey, "sample_script");
  assert.match(degradations[0]!.reason, /no live published SkillScript pin/);
});

void test("materializeScenarioStepScriptRefs degrades when the Script has no currentPublishedVersion", async () => {
  const { prisma } = buildPrisma(() => ({
    script: { id: scriptId, currentPublishedVersion: null }
  }));
  const [materialized] = await materializeScenarioStepScriptRefs({
    prisma,
    skillId,
    steps: normalizeSkillScenarioSteps([rawStep()])
  });
  assert.equal(materialized!.scriptRef, null);
});

void test("materializeScenarioStepScriptRefs degrades when the pinned version has no frozen hash", async () => {
  const { prisma } = buildPrisma(() => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: versionId,
        version: 1,
        contentHash: null,
        inputSchema: {}
      }
    }
  }));
  const [materialized] = await materializeScenarioStepScriptRefs({
    prisma,
    skillId,
    steps: normalizeSkillScenarioSteps([rawStep()])
  });
  assert.equal(materialized!.scriptRef, null);
});

void test("materializeScenarioStepScriptRefs degrades when authored mapping cannot satisfy the published object schema", async () => {
  const { prisma } = buildPrisma(() => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: versionId,
        version: 1,
        contentHash: "a".repeat(64),
        inputSchema: {
          type: "object",
          properties: {
            requiredValue: { type: "string" },
            query: { type: "string" },
            limit: { type: "number" },
            format: { type: "string" }
          },
          required: ["requiredValue"]
        }
      }
    }
  }));
  const degradations: ScriptRefStepDegradation[] = [];
  const [materialized] = await materializeScenarioStepScriptRefs({
    prisma,
    skillId,
    steps: normalizeSkillScenarioSteps([rawStep()]),
    onDegraded: (entry) => degradations.push(entry)
  });
  assert.equal(materialized!.scriptRef, null);
  assert.match(degradations[0]!.reason, /missing required keys: requiredValue/);
});

void test("describeMappingIncompatibility reports missing required keys", () => {
  assert.equal(
    describeMappingIncompatibility(
      { query: { source: "tool_input", name: "query" } },
      {
        type: "object",
        properties: { profile: {}, query: {} },
        required: ["profile", "query"]
      }
    ),
    "inputMapping missing required keys: profile"
  );
});

void test("materializeScenarioStepScriptRefs pin reflects the query's answer at admission time: a later republish only changes what a FUTURE materialization sees", async () => {
  const oldPin = () => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: oldVersionId,
        version: 1,
        contentHash: "e".repeat(64),
        inputSchema: { type: "object" }
      }
    }
  });
  const newPin = () => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: versionId,
        version: 2,
        contentHash: "f".repeat(64),
        inputSchema: { type: "object" }
      }
    }
  });
  const steps = normalizeSkillScenarioSteps([rawStep()]);

  const { prisma: prismaBeforePublish } = buildPrisma(oldPin);
  const [bundleA] = await materializeScenarioStepScriptRefs({
    prisma: prismaBeforePublish,
    skillId,
    steps
  });
  assert.equal(bundleA!.scriptRef?.scriptVersionId, oldVersionId);
  assert.equal(bundleA!.scriptRef?.versionNumber, 1);

  const { prisma: prismaAfterPublish } = buildPrisma(newPin);
  const [bundleB] = await materializeScenarioStepScriptRefs({
    prisma: prismaAfterPublish,
    skillId,
    steps
  });
  assert.equal(bundleB!.scriptRef?.scriptVersionId, versionId);
  assert.equal(bundleB!.scriptRef?.versionNumber, 2);

  assert.equal(bundleA!.scriptRef?.scriptVersionId, oldVersionId);
});

void test("materializeScenarioStepScriptRefs leaves an explicit null or absent scriptRef as null, through the exact normalize+materialize bundle path", async () => {
  const { prisma, calls } = buildPrisma(() => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: versionId,
        version: 1,
        contentHash: "a".repeat(64),
        inputSchema: { type: "object" }
      }
    }
  }));
  const steps = normalizeSkillScenarioSteps([
    { number: 1, directive: "Explicit null.", scriptRef: null },
    { number: 2, directive: "Absent field entirely." }
  ]);
  const materialized = await materializeScenarioStepScriptRefs({ prisma, skillId, steps });
  assert.equal(materialized[0]!.scriptRef, null);
  assert.equal(materialized[1]!.scriptRef, null);
  assert.deepEqual(calls, [], "no Script lookup happens when nothing was authored");
});

void test("materializeScenarioStepScriptRefs degrades a malformed non-null top-level scriptRef to null without killing sibling steps", async () => {
  const { prisma, calls } = buildPrisma(() => ({
    script: {
      id: scriptId,
      currentPublishedVersion: {
        id: versionId,
        version: 1,
        contentHash: "a".repeat(64),
        inputSchema: { type: "object" }
      }
    }
  }));
  const degradations: ScriptRefStepDegradation[] = [];
  const steps = normalizeSkillScenarioSteps([
    { number: 1, directive: "Corrupt ref.", scriptRef: { scriptKey: 12345, inputMapping: {} } },
    rawStep({ number: 2 })
  ]);
  const materialized = await materializeScenarioStepScriptRefs({
    prisma,
    skillId,
    steps,
    onDegraded: (entry) => degradations.push(entry)
  });
  assert.equal(materialized[0]!.scriptRef, null);
  assert.equal(materialized[1]!.scriptRef?.scriptVersionId, versionId);
  assert.equal(degradations.length, 1);
  assert.deepEqual(calls, ["sample_script"]);
});

void test("materializeScenarioStepScriptRefs degrades non-object scriptRef values to null", async () => {
  const { prisma, calls } = buildPrisma(() => {
    throw new Error("must not query Prisma for a malformed scriptRef");
  });
  for (const malformed of ["sample_script", 42, ["sample_script"]]) {
    const steps = normalizeSkillScenarioSteps([
      { number: 1, directive: "Corrupt ref.", scriptRef: malformed }
    ]);
    const [materialized] = await materializeScenarioStepScriptRefs({ prisma, skillId, steps });
    assert.equal(materialized!.scriptRef, null);
  }
  assert.deepEqual(calls, []);
});

void test("materializeScenarioStepScriptRefs degrades malformed nested inputMapping without querying Prisma", async () => {
  const { prisma, calls } = buildPrisma(() => {
    throw new Error("must not query Prisma for a malformed scriptRef");
  });
  const degradations: ScriptRefStepDegradation[] = [];
  const steps = normalizeSkillScenarioSteps([
    {
      number: 1,
      directive: "Corrupt mapping entry.",
      scriptRef: {
        scriptKey: "sample_script",
        inputMapping: {
          bad: { source: "json_path", path: "$.user" },
          good: { source: "current_user_message" }
        }
      }
    }
  ]);
  const [materialized] = await materializeScenarioStepScriptRefs({
    prisma,
    skillId,
    steps,
    onDegraded: (entry) => degradations.push(entry)
  });
  assert.equal(materialized!.scriptRef, null);
  assert.equal(degradations[0]!.scriptKey, "sample_script");
  assert.match(degradations[0]!.reason, /must be literal, current_user_message, or tool_input/);
  assert.deepEqual(calls, []);
});

void test("materializeScenarioStepScriptRefs degrades malformed inputMapping shape to null", async () => {
  const { prisma, calls } = buildPrisma(() => {
    throw new Error("must not query Prisma for a malformed scriptRef");
  });
  const steps = normalizeSkillScenarioSteps([
    {
      number: 1,
      directive: "Corrupt mapping shape.",
      scriptRef: { scriptKey: "sample_script", inputMapping: "not-an-object" }
    }
  ]);
  const [materialized] = await materializeScenarioStepScriptRefs({ prisma, skillId, steps });
  assert.equal(materialized!.scriptRef, null);
  assert.deepEqual(calls, []);
});
