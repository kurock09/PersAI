import assert from "node:assert/strict";
import { VISIBLE_PROMPT_TEMPLATE_DEFAULTS } from "../prisma/bootstrap-preset-data";

// ADR-119 Slice 1 — XML balance validator.
//
// Every visible prompt template (except the hidden classifier templates) is now
// canonically XML-tagged. XML tag names are section markers, not strict XML, but
// per ADR-119 D2 they MUST be balanced: every `<x>` has a matching `</x>` at the
// same nesting level, and no self-closing tags are used.
//
// Tags that appear inside fenced code blocks or inline backticks are examples,
// not real section markers, so they are stripped before counting. `{{placeholder}}`
// tokens are substituted with inert safe content so the validator only inspects
// structural tag balance, never the interpolated values.

// Hidden classifier templates are JSON-instruction prompts with no XML structure.
const SKIPPED_TEMPLATE_KEYS = new Set(["router_classifier", "skill_state_classifier"]);

const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;

function stripCodeAndPlaceholders(template: string): string {
  return (
    template
      // Fenced code blocks (``` ... ```) are examples, not real tags.
      .replace(/```[\s\S]*?```/g, "")
      // Inline backtick spans (`...`) are examples, not real tags.
      .replace(/`[^`]*`/g, "")
      // `{{placeholder}}` tokens are replaced with inert content (the compiler
      // controls their values and never produces malformed XML).
      .replace(/\{\{[^}]+\}\}/g, "PLACEHOLDER")
  );
}

function assertBalanced(key: string, template: string): void {
  const cleaned = stripCodeAndPlaceholders(template);
  const stack: Array<{ name: string; index: number }> = [];
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(cleaned)) !== null) {
    const isClosing = match[1] === "/";
    const name = match[2] ?? "";
    const isSelfClosing = match[4] === "/";

    assert.ok(
      !(isSelfClosing && !isClosing),
      `Template "${key}": self-closing tag <${name}/> is not allowed (use balanced <${name}>…</${name}>)`
    );

    if (isClosing) {
      const top = stack.pop();
      assert.ok(top !== undefined, `Template "${key}": found </${name}> with no matching open tag`);
      assert.equal(
        top?.name,
        name,
        `Template "${key}": </${name}> closes <${top?.name}> at the wrong nesting level`
      );
    } else {
      stack.push({ name, index: match.index });
    }
  }

  assert.equal(
    stack.length,
    0,
    `Template "${key}": unclosed tag(s): ${stack.map((entry) => `<${entry.name}>`).join(", ")}`
  );
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

// Each wrapped template must carry its canonical ADR-119 outer tag exactly once.
const EXPECTED_OUTER_TAGS: Record<string, string> = {
  soul: "voice",
  user: "user",
  identity: "identity",
  enabled_skills: "enabled_skills",
  reminders_protocol: "reminders_protocol",
  tools: "tool_usage_policy",
  agents: "memory_protocol",
  heartbeat: "background_task_evaluation",
  presence: "persai_environment"
};

async function runXmlBalance(): Promise<void> {
  for (const [key, template] of Object.entries(VISIBLE_PROMPT_TEMPLATE_DEFAULTS)) {
    if (SKIPPED_TEMPLATE_KEYS.has(key)) {
      continue;
    }
    assertBalanced(key, template);
  }
}

async function runOuterTagPresence(): Promise<void> {
  for (const [key, tag] of Object.entries(EXPECTED_OUTER_TAGS)) {
    const template = VISIBLE_PROMPT_TEMPLATE_DEFAULTS[key];
    assert.ok(template !== undefined, `Template "${key}" must exist`);
    assert.equal(
      countOccurrences(template ?? "", `<${tag}>`),
      1,
      `Template "${key}" must open <${tag}> exactly once`
    );
    assert.equal(
      countOccurrences(template ?? "", `</${tag}>`),
      1,
      `Template "${key}" must close </${tag}> exactly once`
    );
  }
}

async function runSoulCharacterNotes(): Promise<void> {
  // ADR-119 Slice 1 D3 — soul carries the persona dedup structure: a `<voice>`
  // block followed by an adjacent `<character_notes>` block holding the
  // `{{instructions_block}}` placeholder (snapshotInstructions, rendered once).
  const soul = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.soul ?? "";
  assert.equal(countOccurrences(soul, "<character_notes>"), 1);
  assert.equal(countOccurrences(soul, "</character_notes>"), 1);
  // The instructions placeholder lives inside <character_notes>, NOT inside <voice>.
  const voiceClose = soul.indexOf("</voice>");
  const characterNotesOpen = soul.indexOf("<character_notes>");
  const instructionsIndex = soul.indexOf("{{instructions_block}}");
  assert.ok(voiceClose !== -1 && characterNotesOpen !== -1 && instructionsIndex !== -1);
  assert.ok(
    instructionsIndex > characterNotesOpen,
    "{{instructions_block}} must live inside <character_notes>, not <voice>"
  );
  assert.ok(
    characterNotesOpen > voiceClose,
    "<character_notes> must be adjacent to (after) the closed <voice> block"
  );
  // The redundant system-level persona placeholder is gone (the [F1] dedup).
  assert.ok(
    !(VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system ?? "").includes("{{persona_instructions_block}}"),
    "system template must not reintroduce {{persona_instructions_block}} (persona dedup)"
  );
  // Response UI Contract is now wrapped in <response_contract>.
  const system = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system ?? "";
  assert.equal(countOccurrences(system, "<response_contract>"), 1);
  assert.equal(countOccurrences(system, "</response_contract>"), 1);
}

async function runRemindersProtocolSlice5(): Promise<void> {
  // ADR-119 Slice 5 — reminders_protocol template must be present, non-empty,
  // and carry balanced <reminders_protocol> tags.
  const rp = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.reminders_protocol;
  assert.ok(
    rp !== undefined,
    "reminders_protocol template must exist in VISIBLE_PROMPT_TEMPLATE_DEFAULTS"
  );
  assert.ok((rp ?? "").length > 0, "reminders_protocol template must be non-empty");
  assert.equal(
    countOccurrences(rp ?? "", "<reminders_protocol>"),
    1,
    "reminders_protocol template must open <reminders_protocol> exactly once"
  );
  assert.equal(
    countOccurrences(rp ?? "", "</reminders_protocol>"),
    1,
    "reminders_protocol template must close </reminders_protocol> exactly once"
  );

  // The system template must contain the {{reminders_protocol_block}} placeholder.
  const system = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system ?? "";
  assert.ok(
    system.includes("{{reminders_protocol_block}}"),
    "system template must contain {{reminders_protocol_block}} placeholder (ADR-119 Slice 5)"
  );

  // {{reminders_protocol_block}} must appear between {{enabled_skills_block}} and <response_contract>.
  const skillsIdx = system.indexOf("{{enabled_skills_block}}");
  const remindersIdx = system.indexOf("{{reminders_protocol_block}}");
  const contractIdx = system.indexOf("<response_contract>");
  assert.ok(skillsIdx !== -1 && remindersIdx !== -1 && contractIdx !== -1);
  assert.ok(
    remindersIdx > skillsIdx,
    "{{reminders_protocol_block}} must appear after {{enabled_skills_block}}"
  );
  assert.ok(
    remindersIdx < contractIdx,
    "{{reminders_protocol_block}} must appear before <response_contract>"
  );
}

async function run(): Promise<void> {
  await runXmlBalance();
  await runOuterTagPresence();
  await runSoulCharacterNotes();
  await runRemindersProtocolSlice5();
}

void run();
