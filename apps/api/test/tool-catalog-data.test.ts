import assert from "node:assert/strict";
import { TOOL_CATALOG, STARTER_TRIAL_TOOL_POLICY } from "../prisma/tool-catalog-data";
import {
  PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER,
  isPromptConstructorModelToolCode
} from "../src/modules/workspace-management/application/prompt-constructor-tool-metadata";

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
    typeof row.description === "string" && row.description.includes("Read-only detail"),
    "skill description must advertise the read-only lazy-detail surface"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes('action:"list"'),
    "skill modelUsageGuidance must mention skill.list"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" &&
      row.modelUsageGuidance.includes('action:"describe"'),
    "skill modelUsageGuidance must mention skill.describe"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes("read-only"),
    "skill modelUsageGuidance must say the lazy detail actions are read-only"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes("PLAN INTAKE"),
    "skill modelUsageGuidance must tell the model to call todo_write after engage-with-scenario"
  );
  assert.ok(
    typeof row.modelUsageGuidance === "string" && row.modelUsageGuidance.includes("todo_write"),
    "skill modelUsageGuidance must reference the todo_write tool explicitly"
  );
}

function testDocumentCatalogRowTeachesVisibleWorkflow(): void {
  const rows = TOOL_CATALOG.filter((t) => t.code === "document");
  assert.strictEqual(rows.length, 1, "TOOL_CATALOG must contain exactly one document row");
  const row = rows[0];
  assert.ok(
    row.description.includes("visible workspace workflow"),
    "document description must teach the visible workspace workflow"
  );
  assert.ok(
    row.modelUsageGuidance.includes('document({action:"extract"'),
    "document guidance must include document.extract"
  );
  assert.ok(
    row.modelUsageGuidance.includes("/workspace/projects/"),
    "document guidance must teach bounded document projects under /workspace/projects/"
  );
  assert.ok(
    row.modelUsageGuidance.includes("no longer accepts outputDir"),
    "document guidance must reject legacy outputDir extract paths"
  );
  assert.ok(
    row.modelUsageGuidance.includes("single deliverable step") &&
      row.modelUsageGuidance.includes("Do NOT call files.attach for a render output"),
    "document guidance must teach that render itself registers and delivers (no separate files.attach)"
  );
  assert.ok(
    row.modelUsageGuidance.includes(
      "projectPath`, `outputPath`, `format`, `content`, and optional `template`"
    ) &&
      row.modelUsageGuidance.includes("render/content.md") &&
      row.modelUsageGuidance.includes("project manifest") &&
      row.modelUsageGuidance.includes("builder in memory"),
    "document guidance must teach the one-call authored content/template render workflow"
  );
  assert.ok(
    row.modelUsageGuidance.includes("allocates a sibling name like `report (1).pdf`") &&
      row.modelUsageGuidance.includes("replace: true"),
    "document guidance must teach collision-safe render output and explicit overwrite"
  );
  assert.ok(
    row.modelUsageGuidance.includes(
      "do NOT call document.register_version after a normal render"
    ) && row.modelUsageGuidance.includes("advanced-only manual version registration"),
    "document guidance must keep register_version advanced-only"
  );
  assert.ok(
    row.modelUsageGuidance.includes('document({action:"edit"') &&
      row.modelUsageGuidance.includes("all-or-nothing over the FULL content"),
    "document guidance must teach the surgical all-or-nothing document.edit workflow"
  );
  assert.ok(
    row.modelUsageGuidance.includes("PERSAI_OUTPUT_PATH") &&
      row.modelUsageGuidance.includes("/workspace/workspace"),
    "document guidance must prevent double-workspace build.py output paths"
  );
  assert.ok(
    row.modelUsageGuidance.includes("PDF render uses an HTML entrypoint by default") &&
      row.modelUsageGuidance.includes(
        "runtime-managed Office export path inside `document.render`"
      ) &&
      row.modelUsageGuidance.includes("ignores `content`/`template`"),
    "document guidance must default PDF to HTML and keep imported Office->PDF on the fixed LibreOffice path"
  );
  assert.ok(
    !/async document providers|PDFMonkey|fileRef|AssistantFile|\/workspace\/input|\/workspace\/outbound/i.test(
      `${row.description}\n${row.modelDescription}\n${row.modelUsageGuidance}`
    ),
    "document catalog wording must not contain retired provider, file-identity, or namespace language"
  );
}

function testFilesCatalogRowUsesExactListedPaths(): void {
  const rows = TOOL_CATALOG.filter((t) => t.code === "files");
  assert.strictEqual(rows.length, 1, "TOOL_CATALOG must contain exactly one files row");
  const row = rows[0];
  const text = `${row.modelDescription}\n${row.modelUsageGuidance}`;
  assert.ok(
    text.includes("By default `files.list` shows only the current chat scope"),
    "files guidance must teach current-chat default scope"
  );
  assert.ok(
    text.includes('scope:"assistant"') && text.includes('scope:"workspace_shared"'),
    "files guidance must teach explicit assistant/workspace widens"
  );
  assert.ok(
    text.includes("crossScope:true"),
    "files guidance must teach explicit cross-scope operations"
  );
  assert.ok(
    text.includes("Do not reconstruct upload paths from displayName/filename"),
    "files guidance must forbid reconstructing upload paths from display names"
  );
  assert.ok(
    !text.includes("/workspace/<filename>"),
    "files guidance must not teach the model to guess upload paths from filenames"
  );
}

function testPresentationCatalogRowIsDeckSpecific(): void {
  const rows = TOOL_CATALOG.filter((t) => t.code === "presentation");
  assert.strictEqual(rows.length, 1, "TOOL_CATALOG must contain exactly one presentation row");
  const row = rows[0];
  assert.ok(
    row.description.includes("slide deck") || row.description.includes("presentation"),
    "presentation description must be deck-specific"
  );
  assert.ok(
    row.modelUsageGuidance.includes("create_presentation") &&
      !row.modelUsageGuidance.includes('document({action:"render"'),
    "presentation guidance must stay on deferred deck modes, not workspace render"
  );
  assert.ok(
    `${row.modelDescription}\n${row.modelUsageGuidance}`.includes("PDF manual") ||
      `${row.modelDescription}\n${row.modelUsageGuidance}`.includes("ordinary PDF"),
    "presentation catalog must exclude ordinary PDF documents"
  );
}

function testDocumentCatalogRowSteersAwayFromPresentation(): void {
  const row = TOOL_CATALOG.find((t) => t.code === "document");
  assert.ok(row, "document catalog row must exist");
  const text = `${row.description}\n${row.modelDescription}\n${row.modelUsageGuidance}`;
  assert.ok(
    /Do not call presentation|use `presentation`|not use presentation/i.test(text),
    "document catalog must steer ordinary PDF/DOCX/XLSX work away from presentation"
  );
  assert.ok(
    !/descriptorMode=create_presentation|create_presentation/i.test(text),
    "document catalog must not advertise create_presentation"
  );
}

function testStarterTrialPolicyPresentationMirrorsDocument(): void {
  const documentPolicy = STARTER_TRIAL_TOOL_POLICY["document"];
  const presentationPolicy = STARTER_TRIAL_TOOL_POLICY["presentation"];
  assert.ok(documentPolicy, "STARTER_TRIAL_TOOL_POLICY must have a document entry");
  assert.ok(presentationPolicy, "STARTER_TRIAL_TOOL_POLICY must have a presentation entry");
  assert.strictEqual(
    presentationPolicy.active,
    documentPolicy.active,
    "presentation starter policy must mirror document activation"
  );
  assert.strictEqual(
    presentationPolicy.dailyCallLimit,
    documentPolicy.dailyCallLimit,
    "presentation starter policy must mirror document dailyCallLimit"
  );
}

function testPresentationIsPromptConstructorEditable(): void {
  assert.ok(
    isPromptConstructorModelToolCode("presentation"),
    "presentation must be editable in Admin > Presets Per-Tool Model Instructions"
  );
  const documentIndex = PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.indexOf("document");
  const presentationIndex = PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.indexOf("presentation");
  assert.ok(documentIndex >= 0 && presentationIndex === documentIndex + 1, {
    message: "presentation must follow document in prompt-constructor tool order"
  });
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
  testDocumentCatalogRowTeachesVisibleWorkflow();
  testPresentationCatalogRowIsDeckSpecific();
  testDocumentCatalogRowSteersAwayFromPresentation();
  testFilesCatalogRowUsesExactListedPaths();
  testStarterTrialPolicyPresentationMirrorsDocument();
  testPresentationIsPromptConstructorEditable();
  testStarterTrialPolicyTodoWrite();
  console.log("[tool-catalog-data] all tests passed");
}

if (process.argv[1] && process.argv[1].endsWith("tool-catalog-data.test.ts")) {
  runToolCatalogDataTest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
