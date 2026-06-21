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

// After the ADR-119 cleanup slice EVERY default template carries a canonical
// XML wrapper, including the hidden classifier and bootstrap templates. The
// skip set is empty — every template must pass XML balance.
const SKIPPED_TEMPLATE_KEYS = new Set<string>();

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
  memory_protocol: "memory_protocol",
  tools: "tool_usage_policy",
  heartbeat: "background_task_evaluation",
  presence: "persai_environment",
  router_classifier: "router_classifier",
  skill_state_classifier: "skill_state_classifier",
  preview_bootstrap: "character_preview",
  welcome_bootstrap: "first_conversation_greeting"
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

async function runMemoryProtocolSlice9(): Promise<void> {
  // ADR-119 Slice 9 — memory_protocol template must be present, non-empty,
  // and carry balanced <memory_protocol>, <read>, <write> tags.
  const mp = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.memory_protocol;
  assert.ok(
    mp !== undefined,
    "memory_protocol template must exist in VISIBLE_PROMPT_TEMPLATE_DEFAULTS"
  );
  assert.ok((mp ?? "").length > 0, "memory_protocol template must be non-empty");
  assert.equal(
    countOccurrences(mp ?? "", "<memory_protocol>"),
    1,
    "memory_protocol template must open <memory_protocol> exactly once"
  );
  assert.equal(
    countOccurrences(mp ?? "", "</memory_protocol>"),
    1,
    "memory_protocol template must close </memory_protocol> exactly once"
  );
  assert.equal(
    countOccurrences(mp ?? "", "<read>"),
    1,
    "memory_protocol template must contain exactly one <read> block"
  );
  assert.equal(
    countOccurrences(mp ?? "", "</read>"),
    1,
    "memory_protocol template must close </read> exactly once"
  );
  assert.equal(
    countOccurrences(mp ?? "", "<write>"),
    1,
    "memory_protocol template must contain exactly one <write> block"
  );
  assert.equal(
    countOccurrences(mp ?? "", "</write>"),
    1,
    "memory_protocol template must close </write> exactly once"
  );

  // The system template must contain the {{memory_protocol_block}} placeholder.
  const system = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system ?? "";
  assert.ok(
    system.includes("{{memory_protocol_block}}"),
    "system template must contain {{memory_protocol_block}} placeholder (ADR-119 Slice 9)"
  );

  // {{memory_protocol_block}} must appear between {{reminders_protocol_block}} and <response_contract>.
  const remindersIdx = system.indexOf("{{reminders_protocol_block}}");
  const memoryIdx = system.indexOf("{{memory_protocol_block}}");
  const contractIdx = system.indexOf("<response_contract>");
  assert.ok(remindersIdx !== -1 && memoryIdx !== -1 && contractIdx !== -1);
  assert.ok(
    memoryIdx > remindersIdx,
    "{{memory_protocol_block}} must appear after {{reminders_protocol_block}}"
  );
  assert.ok(
    memoryIdx < contractIdx,
    "{{memory_protocol_block}} must appear before <response_contract>"
  );

  // agents template must no longer contain a <memory_protocol> inner block.
  const agents = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.agents ?? "";
  assert.ok(
    !agents.includes("<memory_protocol>"),
    "agents template must not duplicate <memory_protocol> (now a standalone template, ADR-119 Slice 9)"
  );
}

async function runResponseContractSlice8(): Promise<void> {
  const system = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system ?? "";

  // New test: system template contains <must> and <prefer> nested inside <response_contract>.
  assert.equal(
    countOccurrences(system, "<must>"),
    1,
    "system template must open <must> exactly once inside <response_contract>"
  );
  assert.equal(
    countOccurrences(system, "</must>"),
    1,
    "system template must close </must> exactly once"
  );
  assert.equal(
    countOccurrences(system, "<prefer>"),
    1,
    "system template must open <prefer> exactly once inside <response_contract>"
  );
  assert.equal(
    countOccurrences(system, "</prefer>"),
    1,
    "system template must close </prefer> exactly once"
  );

  // Verify nesting: <must> and <prefer> appear between <response_contract> and </response_contract>.
  const rcOpen = system.indexOf("<response_contract>");
  const rcClose = system.indexOf("</response_contract>");
  const mustOpen = system.indexOf("<must>");
  const preferOpen = system.indexOf("<prefer>");
  assert.ok(rcOpen !== -1 && rcClose !== -1 && mustOpen !== -1 && preferOpen !== -1);
  assert.ok(
    mustOpen > rcOpen && mustOpen < rcClose,
    "<must> must be nested inside <response_contract>"
  );
  assert.ok(
    preferOpen > rcOpen && preferOpen < rcClose,
    "<prefer> must be nested inside <response_contract>"
  );

  // New test: MUST tier contains the 4 hard invariants.
  const mustClose = system.indexOf("</must>");
  const mustContent = system.slice(mustOpen, mustClose);
  assert.ok(
    mustContent.includes("polished product blocks"),
    "<must> must contain 'polished product blocks' invariant"
  );
  assert.ok(
    mustContent.includes("assistant_gender"),
    "<must> must contain 'assistant_gender' invariant"
  );
  assert.ok(
    mustContent.includes("fenced code blocks"),
    "<must> must contain 'fenced code blocks' invariant"
  );
  assert.ok(
    mustContent.includes("delivered unless a delivery tool call"),
    "<must> must contain delivery honesty invariant"
  );

  // New test: PREFER tier contains the 4 soft preferences.
  const preferClose = system.indexOf("</prefer>");
  const preferContent = system.slice(preferOpen, preferClose);
  assert.ok(preferContent.includes("opener"), "<prefer> must contain opener preference");
  assert.ok(
    preferContent.includes("Calm formatting"),
    "<prefer> must contain 'Calm formatting' preference"
  );
  assert.ok(
    preferContent.includes("Markdown h2/h3"),
    "<prefer> must contain 'Markdown h2/h3' preference"
  );
  assert.ok(
    preferContent.includes("Follow-up actions"),
    "<prefer> must contain 'Follow-up actions' preference"
  );

  // New test: <response_contract> immediate children are <must> and <prefer>, not a bare list.
  // Check that the text immediately after <response_contract>\n is <must>, not a bare bullet.
  const afterRcOpen = system.slice(rcOpen + "<response_contract>".length).trimStart();
  assert.ok(
    afterRcOpen.startsWith("<must>"),
    "<response_contract> first non-whitespace child must be <must>, not a bare list item"
  );
}

async function runNoMarkdownHeadings(): Promise<void> {
  // ADR-119 cleanup slice — no markdown headings (`# `, `## `, `### ` …) inside
  // any XML-wrapped template. The XML tag IS the heading. Backticked spans and
  // fenced code blocks are stripped before the check (they may carry literal
  // markdown examples meant as instructions to the model, e.g. \`## What I can do\`).
  const HEADING_RE = /^#{1,6}\s/m;
  for (const [key, template] of Object.entries(VISIBLE_PROMPT_TEMPLATE_DEFAULTS)) {
    const cleaned = stripCodeAndPlaceholders(template);
    assert.doesNotMatch(
      cleaned,
      HEADING_RE,
      `Template "${key}" must not contain markdown headings (#, ##, ### …) inside XML tags. ` +
        `The XML tag is the heading; lift section structure to nested XML or backtick the example.`
    );
  }
}

async function runPresenceSlice12(): Promise<void> {
  // ADR-119 Slice 12 — <persai_environment> presence template MUST carry the
  // {{current_local_date}} placeholder so the runtime renderer can substitute
  // the absolute date. Without it the model invents the year (live-test row
  // A2 confabulated "19 июня 2025" when the real date was "18 июня 2026").
  const presence = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.presence ?? "";
  assert.ok(presence.length > 0, "presence template must be non-empty");
  assert.ok(
    presence.includes("{{current_local_date}}"),
    "presence template must include {{current_local_date}} placeholder"
  );
  assert.ok(
    presence.includes("{{current_local_weekday}}"),
    "presence template must keep {{current_local_weekday}} placeholder"
  );
  assert.ok(
    presence.includes("{{current_local_time}}"),
    "presence template must keep {{current_local_time}} placeholder"
  );
  // Guard against re-confabulation: the template should explicitly remind the
  // model to never invent a year. Be lenient on phrasing but require both
  // "Never invent" and "year" tokens on the same line.
  assert.match(
    presence,
    /Never invent a year/,
    "presence template must instruct the model to never invent a year"
  );
}

async function runToolsWorkspaceCategoryAdr123Slice7(): Promise<void> {
  // ADR-123 Slice 7 — the tools template gains a <category name="workspace">
  // routing content search → grep, filename find → glob, read/edit → files,
  // execution → shell, document → document. The existing <priority_order> and
  // <tool_usage_policy> wrapper (ADR-119 golden invariant) must be preserved.
  const tools = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.tools ?? "";
  assert.equal(
    countOccurrences(tools, '<category name="workspace">'),
    1,
    'tools template must include exactly one <category name="workspace"> (ADR-123 Slice 7)'
  );
  assert.equal(
    countOccurrences(tools, "<tool_usage_policy>"),
    1,
    "ADR-119 invariant: <tool_usage_policy> wrapper must be preserved"
  );
  assert.equal(
    countOccurrences(tools, "<priority_order>"),
    1,
    "ADR-119 invariant: <priority_order> block must be preserved"
  );
  assert.match(tools, /Discover files first with `glob`, then search contents with `grep`/i);
  assert.match(tools, /Execute commands, scripts, tests, builds, conversions, diagnostics/i);
  assert.doesNotMatch(tools, /Carousel, series, or multiple variations/i);
  assert.match(tools, /source material for a PDF, Word, Excel, deck, report, OCR, table/i);
}

async function run(): Promise<void> {
  await runXmlBalance();
  await runOuterTagPresence();
  await runNoMarkdownHeadings();
  await runSoulCharacterNotes();
  await runRemindersProtocolSlice5();
  await runMemoryProtocolSlice9();
  await runResponseContractSlice8();
  await runPresenceSlice12();
  await runToolsWorkspaceCategoryAdr123Slice7();
}

void run();
