import assert from "node:assert/strict";
import {
  renderEnabledSkillsPromptBlock,
  resolveEnabledSkillPromptCards,
  type EnabledSkillPromptCandidate
} from "../src/modules/workspace-management/application/enabled-skills-prompt-materialization";

const baseCandidate = (
  id: string,
  overrides: Partial<EnabledSkillPromptCandidate> = {}
): EnabledSkillPromptCandidate => ({
  id,
  name: { en: id, ru: `${id} ru` },
  description: { en: `${id} description` },
  category: "finance",
  tags: ["tax", "books", "audit"],
  displayOrder: 100,
  status: "active",
  instructionCard: {
    title: `${id} mode`,
    body: `Use ${id} knowledge carefully.`,
    guardrails: ["Do not guarantee legal outcomes."],
    examples: ["Explain the relevant rule."]
  },
  iconEmoji: "📌",
  assignmentStatus: "active",
  assignmentEnabledAt: "2026-05-01T12:00:00.000Z",
  ...overrides
});

async function run(): Promise<void> {
  const cards = resolveEnabledSkillPromptCards({
    locale: "en-US",
    limit: 2,
    candidates: [
      baseCandidate("disabled", { assignmentStatus: "disabled" }),
      baseCandidate("archived", { status: "archived" }),
      baseCandidate("over-limit", { assignmentEnabledAt: "2026-05-01T12:03:00.000Z" }),
      baseCandidate("accounting", { assignmentEnabledAt: "2026-05-01T12:01:00.000Z" }),
      baseCandidate("legal", { assignmentEnabledAt: "2026-05-01T12:02:00.000Z" })
    ]
  });

  assert.deepEqual(
    cards.map((card) => card.id),
    ["accounting", "legal"],
    "only active enabled Skills within the plan limit should materialize"
  );

  const block = renderEnabledSkillsPromptBlock(cards);
  assert.match(block, /# Enabled Skills/);
  assert.match(block, /accounting mode/);
  assert.match(block, /legal mode/);
  assert.doesNotMatch(block, /disabled mode/);
  assert.doesNotMatch(block, /archived mode/);
  assert.doesNotMatch(block, /over-limit mode/);

  assert.equal(
    renderEnabledSkillsPromptBlock(
      resolveEnabledSkillPromptCards({
        locale: "en-US",
        limit: null,
        candidates: [baseCandidate("plan-disabled", { assignmentStatus: "plan_disabled" })]
      })
    ),
    "",
    "plan-disabled assignments should disappear from prompt materialization"
  );
}

void run();
