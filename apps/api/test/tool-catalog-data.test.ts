import assert from "node:assert/strict";
import { TOOL_CATALOG, STARTER_TRIAL_TOOL_POLICY } from "../prisma/tool-catalog-data";
import {
  PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER,
  isPromptConstructorModelToolCode
} from "../src/modules/workspace-management/application/prompt-constructor-tool-metadata";

function toolText(code: string): string {
  const row = TOOL_CATALOG.find((tool) => tool.code === code);
  assert.ok(row, `${code} catalog row must exist`);
  return `${row.description}\n${row.modelDescription}\n${row.modelUsageGuidance ?? ""}`;
}

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

function testDocumentCatalogRowTeachesThreeVerbSurface(): void {
  const rows = TOOL_CATALOG.filter((t) => t.code === "document");
  assert.strictEqual(rows.length, 1, "TOOL_CATALOG must contain exactly one document row");
  const row = rows[0];
  assert.ok(
    row.description.includes("Inspect, render, or convert"),
    "document description must describe the three document verbs"
  );
  assert.ok(
    row.modelUsageGuidance.includes('document({action:"inspect"') &&
      row.modelUsageGuidance.includes('document({action:"render"') &&
      row.modelUsageGuidance.includes('document({action:"convert"'),
    "document guidance must include inspect, render, and convert examples"
  );
  assert.ok(
    row.modelUsageGuidance.includes("sibling `.md` file next to the output"),
    "document guidance must teach source-markdown collocation"
  );
  assert.ok(
    row.modelUsageGuidance.includes("registers the output") &&
      row.modelUsageGuidance.includes("delivers it in one call"),
    "document guidance must teach the single render door"
  );
  assert.ok(
    row.modelUsageGuidance.includes('document({action:"convert"') &&
      row.modelUsageGuidance.includes('targetFormat:"pdf"'),
    "document guidance must include a concrete convert example"
  );
  assert.ok(
    !/document\.extract|document\.edit|document\.register_version|render\/content\.md|build\.py|export_pdf\.py|entrypoint|visible workspace workflow|visible workspace loop|legacy entrypoint/i.test(
      `${row.description}\n${row.modelDescription}\n${row.modelUsageGuidance}`
    ),
    "document catalog wording must not contain retired document workflow language"
  );
  assert.ok(
    !/async document providers|PDFMonkey|fileRef|AssistantFile|\/workspace\/input|\/workspace\/outbound/i.test(
      `${row.description}\n${row.modelDescription}\n${row.modelUsageGuidance}`
    ),
    "document catalog wording must not contain retired provider, file-identity, or namespace language"
  );
}

function testVideoGenerateCatalogRowUsesLazyLookupGuidance(): void {
  const row = TOOL_CATALOG.find((t) => t.code === "video_generate");
  assert.ok(row, "video_generate catalog row must exist");
  const text = `${row.description}\n${row.modelDescription}\n${row.modelUsageGuidance}`;
  assert.ok(
    text.includes('action:"describe_avatar_mode"') &&
      text.includes('action:"list_personas"') &&
      text.includes('action:"list_voices"'),
    "video_generate guidance must point to the three lazy read-only lookup actions"
  );
  assert.ok(
    text.includes("read-only"),
    "video_generate guidance must say the lazy lookup actions are read-only"
  );
  assert.ok(
    /Never guess personaId or voiceKey/i.test(text),
    "video_generate guidance must forbid guessing personaId or voiceKey"
  );
  assert.ok(
    !/Available voiceKeys|videoPersonas|linkedClonedVoiceLabel=|Mode choice is strict|Each video_generate call produces ONE clip with ONE speaker/i.test(
      text
    ),
    "video_generate catalog wording must not inline the heavy persona, voice, or talking-avatar tutorial content"
  );
}

function testFilesCatalogRowUsesExactListedPaths(): void {
  const rows = TOOL_CATALOG.filter((t) => t.code === "files");
  assert.strictEqual(rows.length, 1, "TOOL_CATALOG must contain exactly one files row");
  const row = rows[0];
  const text = `${row.modelDescription}\n${row.modelUsageGuidance}`;
  assert.ok(
    text.includes(
      "current session root `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/...`"
    ),
    "files guidance must teach the current session root"
  );
  assert.ok(
    text.includes("`/workspace/assistants/<assistantStableKey>/`") &&
      text.includes("`/workspace/`"),
    "files guidance must teach explicit assistant/workspace widens by path"
  );
  assert.ok(
    text.includes('files({action:"list"})'),
    "files guidance must teach the default current-session listing call"
  );
  assert.ok(
    /Six actions only: list, read, preview, write, delete, attach/i.test(text),
    "files guidance must enumerate the six actions in the catalog owner"
  );
  assert.ok(
    text.includes("`maxBytes`") && text.includes("`maxDepth`"),
    "files guidance must teach maxBytes/maxDepth mechanics in the catalog owner"
  );
  assert.ok(
    text.includes("Do not reconstruct upload paths from displayName/filename"),
    "files guidance must forbid reconstructing upload paths from display names"
  );
  assert.ok(
    !text.includes("/workspace/<filename>"),
    "files guidance must not teach the model to guess upload paths from filenames"
  );
  assert.ok(
    !/workspace_shared|crossScope:true|scope:"assistant"|scope:"workspace_shared"/.test(text),
    "files guidance must not preserve stale scope/cross-scope vocabulary"
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
}

function testCatalogRowsKeepSelectionGuideAsSingleOwner(): void {
  assert.doesNotMatch(toolText("web_search"), /Local or uploaded sources are available/i);
  assert.doesNotMatch(toolText("web_fetch"), /web_search first|browser tool instead/i);
  assert.doesNotMatch(toolText("image_generate"), /source image is present/i);
  assert.doesNotMatch(
    toolText("image_edit"),
    /brand-new image from text only|OCR|text extraction|PDF|DOCX|XLSX|file deliverable/i
  );
  assert.doesNotMatch(toolText("video_generate"), /still image|only audio/i);
  assert.doesNotMatch(
    toolText("document"),
    /presentation|reply directly|files\.attach|openpyxl|python-docx|weasyprint/i
  );
  assert.doesNotMatch(
    toolText("presentation"),
    /ordinary PDF|manual|report|instruction|DOCX|XLSX|inline text/i
  );
  assert.doesNotMatch(toolText("tts"), /text reply|Quiet background context/i);
  assert.doesNotMatch(toolText("browser"), /Static page content|No URL in hand/i);
  assert.doesNotMatch(toolText("memory_search"), /Use BEFORE web tools|specific public URL/i);
  assert.doesNotMatch(toolText("memory_get"), /No referenceId is available/i);
  assert.doesNotMatch(
    toolText("scheduled_action"),
    /background_task|one-off chat message right now/i
  );
  assert.doesNotMatch(
    toolText("background_task"),
    /Simple unconditional reminder|One-off chat-message work that should happen this turn/i
  );
  assert.doesNotMatch(
    toolText("persai_tool_quota_status"),
    /knowledge retrieval|generic product-info/i
  );
  assert.doesNotMatch(toolText("files"), /use exec or shell|use grep|use glob|use document/i);
  assert.doesNotMatch(
    toolText("exec"),
    /Plain file IO|shell pipelines|document, image, or web tools/i
  );
  assert.doesNotMatch(
    toolText("shell"),
    /shell grep|shell find|Plain file IO|document, image, or web result|For content search use grep/i
  );
  assert.doesNotMatch(
    toolText("grep"),
    /Prefer grep over shell grep|Filename discovery|File reads|Process execution/i
  );
  assert.doesNotMatch(
    toolText("glob"),
    /Prefer glob over shell find|Content search|File reads|Process execution/i
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
  testDocumentCatalogRowTeachesThreeVerbSurface();
  testVideoGenerateCatalogRowUsesLazyLookupGuidance();
  testPresentationCatalogRowIsDeckSpecific();
  testCatalogRowsKeepSelectionGuideAsSingleOwner();
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
