import assert from "node:assert/strict";
import { TOOL_CATALOG, STARTER_TRIAL_TOOL_POLICY } from "../prisma/tool-catalog-data";

function testTodoWriteCatalogRow(): void {
  const rows = TOOL_CATALOG.filter((t) => t.code === "todo_write");
  assert.strictEqual(rows.length, 1, "TOOL_CATALOG must contain exactly one todo_write row");
  const row = rows[0];
  assert.strictEqual(row.displayName, "Todo Write");
  assert.strictEqual(row.policyClass, "plan_managed");
  assert.strictEqual(row.toolClass, "utility");
  assert.strictEqual(row.capabilityGroup, "workspace_ops");
  assert.ok(
    typeof row.description === "string" && row.description.length > 0,
    "todo_write description must be non-empty"
  );
  assert.ok(
    typeof row.modelDescription === "string" && row.modelDescription.length > 0,
    "todo_write modelDescription must be non-empty"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.length > 0,
    "todo_write modelUsageGuidance must be non-empty"
  );
  // ADR-125 follow-up — the model owns the entire plan lifecycle, including
  // scenario intake. When `skill.engage` returns a scenario, the model must
  // immediately call `todo_write` with the scenario's steps. Pin both the
  // intake instruction and the lifecycle section so the catalog can never
  // ship without them.
  assert.ok(
    typeof row.modelUsageGuidance === "string" &&
      row.modelUsageGuidance.includes("SCENARIO INTAKE"),
    "todo_write modelUsageGuidance must explain how to intake scenarios from skill.engage"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes("LIFECYCLE"),
    "todo_write modelUsageGuidance must explain in_progress/complete row lifecycle"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes("by id <id>"),
    "todo_write modelUsageGuidance must tell the model where to read row ids from <persai_chat_plan>"
  );
}

function testSkillCatalogRowMentionsPlanIntake(): void {
  const rows = TOOL_CATALOG.filter((t) => t.code === "skill");
  assert.strictEqual(rows.length, 1, "TOOL_CATALOG must contain exactly one skill row");
  const row = rows[0];
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes("PLAN INTAKE"),
    "skill modelUsageGuidance must tell the model to call todo_write after engage-with-scenario"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes("todo_write"),
    "skill modelUsageGuidance must reference the todo_write tool explicitly"
  );
}

function testStarterTrialPolicyTodoWrite(): void {
  const policy = STARTER_TRIAL_TOOL_POLICY["todo_write"];
  assert.ok(policy !== undefined, "STARTER_TRIAL_TOOL_POLICY must have a todo_write entry");
  assert.strictEqual(policy.active, true, "todo_write starter policy must be active");
  assert.strictEqual(policy.dailyCallLimit, null, "todo_write dailyCallLimit must be null");
  assert.strictEqual(policy.perTurnCap, null, "todo_write perTurnCap must be null");
}

export async function runToolCatalogDataTest(): Promise<void> {
  testTodoWriteCatalogRow();
  testSkillCatalogRowMentionsPlanIntake();
  testStarterTrialPolicyTodoWrite();
  console.log("[tool-catalog-data] all tests passed");
}

if (process.argv[1] && process.argv[1].endsWith("tool-catalog-data.test.ts")) {
  runToolCatalogDataTest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
