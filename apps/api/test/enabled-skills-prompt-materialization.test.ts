import assert from "node:assert/strict";
import {
  ENABLED_SKILLS_BUDGET_CHARS,
  ENABLED_SKILLS_SCENARIO_ROW_CAP,
  SKILL_SUMMARY_CAP,
  SKILL_WHEN_TO_USE_CAP,
  type RuntimeBundleSkillScenario
} from "@persai/runtime-contract";
import {
  renderEnabledSkillsPromptBlock,
  resolveEnabledSkillPromptCards,
  resolveEnabledSkillScenariosForBundle,
  type EnabledSkillPromptCandidate,
  type EnabledSkillScenarioCandidate
} from "../src/modules/workspace-management/application/enabled-skills-prompt-materialization";

const baseCandidate = (
  id: string,
  overrides: Partial<EnabledSkillPromptCandidate> = {}
): EnabledSkillPromptCandidate => ({
  id,
  name: { en: id, ru: `${id} ru` },
  description: { en: `${id} description` },
  category: "finance",
  tags: ["tax", "books", "audit", "reporting", "forecasting"],
  displayOrder: 100,
  status: "active",
  instructionCard: {
    title: `${id} mode`,
    body: `Use ${id} knowledge carefully.\nKeep the workflow practical.`,
    guardrails: ["Do not guarantee legal outcomes."],
    examples: ["Explain the relevant rule."],
    whenToUse: `${id} when to use`
  },
  iconEmoji: "📌",
  assignmentStatus: "active",
  assignmentEnabledAt: "2026-05-01T12:00:00.000Z",
  ...overrides
});

function makeResolvedScenario(
  key: string,
  overrides: Partial<RuntimeBundleSkillScenario> = {}
): RuntimeBundleSkillScenario {
  return {
    key,
    displayName: `${key} display`,
    description: `${key} description`,
    iconEmoji: null,
    intentExamples: [],
    steps: [],
    recommendedTools: [],
    exitCondition: "Done.",
    guardrails: [],
    examples: [],
    ...overrides
  };
}

function makeScenarioCandidate(
  skillId: string,
  key: string,
  overrides: Partial<EnabledSkillScenarioCandidate> = {}
): EnabledSkillScenarioCandidate {
  return {
    skillId,
    key,
    displayName: { en: `${key} display`, ru: `${key} ru` },
    description: { en: `${key} description` },
    iconEmoji: null,
    intentExamples: [],
    steps: [],
    recommendedTools: [],
    exitCondition: "Done.",
    guardrails: [],
    examples: [],
    ...overrides
  };
}

async function run(): Promise<void> {
  const cards = resolveEnabledSkillPromptCards({
    locale: "en-US",
    limit: 2,
    candidates: [
      baseCandidate("disabled", { assignmentStatus: "disabled" }),
      baseCandidate("archived", { status: "archived" }),
      baseCandidate("over-limit", { assignmentEnabledAt: "2026-05-01T12:03:00.000Z" }),
      baseCandidate("accounting", {
        assignmentEnabledAt: "2026-05-01T12:01:00.000Z",
        description: { en: "A".repeat(SKILL_SUMMARY_CAP + 20) },
        instructionCard: {
          title: "Accounting mode",
          body: "ACCOUNTING_BODY_SENTINEL",
          guardrails: ["ACCOUNTING_GUARDRAIL_SENTINEL"],
          examples: ["ACCOUNTING_EXAMPLE_SENTINEL"],
          whenToUse: "B".repeat(SKILL_WHEN_TO_USE_CAP + 20)
        }
      }),
      baseCandidate("legal", { assignmentEnabledAt: "2026-05-01T12:02:00.000Z" })
    ]
  });

  assert.deepEqual(
    cards.map((card) => card.id),
    ["accounting", "legal"]
  );
  assert.equal(cards[0]?.description?.length, SKILL_SUMMARY_CAP);
  assert.equal(cards[0]?.whenToUse.length, SKILL_WHEN_TO_USE_CAP);
  assert.equal(cards[0]?.body, "ACCOUNTING_BODY_SENTINEL");
  assert.deepEqual(cards[0]?.guardrails, ["ACCOUNTING_GUARDRAIL_SENTINEL"]);
  assert.deepEqual(cards[0]?.examples, ["ACCOUNTING_EXAMPLE_SENTINEL"]);

  const block = renderEnabledSkillsPromptBlock(cards);
  assert.match(block, /<skill id="accounting"/);
  assert.match(block, /<skill id="legal"/);
  assert.doesNotMatch(block, /ACCOUNTING_BODY_SENTINEL/);
  assert.doesNotMatch(block, /ACCOUNTING_GUARDRAIL_SENTINEL/);
  assert.doesNotMatch(block, /ACCOUNTING_EXAMPLE_SENTINEL/);
  assert.match(block, /skill\(\{action:"list"\}\)/);
  assert.match(block, /skill\(\{action:"describe"\}\)/);

  {
    const cardsWithScenarios = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        {
          ...baseCandidate("marketer", { assignmentEnabledAt: "2026-05-01T12:01:00.000Z" }),
          scenarios: [
            makeResolvedScenario("instagram_carousel", {
              displayName: "Instagram Carousel",
              description: "Create an 8-slide post.",
              recommendedTools: ["image_generate", "text_format"],
              steps: [
                {
                  number: 1,
                  directive: "Collect the brief from user",
                  recommendedToolCall: null,
                  mayBeSkippedIf: null,
                  negativeGuards: []
                }
              ],
              guardrails: ["Keep claims honest."],
              examples: ["Carousel example"]
            }),
            makeResolvedScenario("linkedin_post", {
              displayName: "LinkedIn Post",
              description: "Write a professional post."
            })
          ]
        }
      ]
    });
    const catalogBlock = renderEnabledSkillsPromptBlock(cardsWithScenarios);
    assert.match(catalogBlock, /<scenario key="instagram_carousel">/);
    assert.match(catalogBlock, /<name>Instagram Carousel<\/name>/);
    assert.doesNotMatch(catalogBlock, /<one_line>/);
    assert.doesNotMatch(catalogBlock, /<first_step_preview>/);
    assert.doesNotMatch(catalogBlock, /<recommended_tools>/);
  }

  {
    const cardsNoScenarios = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [baseCandidate("accounting")]
    });
    const blockNoScenarios = renderEnabledSkillsPromptBlock(cardsNoScenarios);
    assert.match(blockNoScenarios, /<available_scenarios \/>/);
  }

  {
    const manyScenarioCandidates = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: Array.from({ length: 4 }, (_, skillIndex) => ({
        ...baseCandidate(`skill_${String(skillIndex + 1)}`, {
          assignmentEnabledAt: `2026-05-01T12:0${String(skillIndex)}:00.000Z`
        }),
        scenarios: Array.from({ length: 12 }, (_, scenarioIndex) =>
          makeResolvedScenario(`scenario_${String(skillIndex + 1)}_${String(scenarioIndex + 1)}`, {
            displayName: `Scenario ${String(skillIndex + 1)}-${String(scenarioIndex + 1)}`
          })
        )
      }))
    });
    const cappedBlock = renderEnabledSkillsPromptBlock(manyScenarioCandidates);
    const scenarioMatches = cappedBlock.match(/<scenario key="/g) ?? [];
    assert.equal(scenarioMatches.length, ENABLED_SKILLS_SCENARIO_ROW_CAP);
    assert.match(
      cappedBlock,
      /<catalog_note>More skills or scenarios available via skill\.list \/ skill\.describe\.<\/catalog_note>/
    );
  }

  {
    const oversizedCards = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: Array.from({ length: 20 }, (_, index) =>
        baseCandidate(`skill_${String(index + 1)}`, {
          assignmentEnabledAt: `2026-05-01T12:${String(index).padStart(2, "0")}:00.000Z`,
          description: { en: `${"S".repeat(400)} ${String(index + 1)}` },
          instructionCard: {
            title: `Skill ${String(index + 1)}`,
            body: "Body",
            guardrails: ["Guardrail"],
            examples: ["Example"],
            whenToUse: `${"W".repeat(400)} ${String(index + 1)}`
          }
        })
      )
    });
    const oversizedBlock = renderEnabledSkillsPromptBlock(oversizedCards);
    assert.ok(
      oversizedBlock.length <= ENABLED_SKILLS_BUDGET_CHARS,
      "enabled_skills block must stay within the shared budget"
    );
    assert.match(
      oversizedBlock,
      /<catalog_note>More skills or scenarios available via skill\.list \/ skill\.describe\.<\/catalog_note>/
    );
  }

  {
    const candidates: EnabledSkillScenarioCandidate[] = [
      makeScenarioCandidate("skill-a", "carousel", {
        displayName: { en: "English Name", ru: "Русское Название" },
        description: { en: "A description" },
        guardrails: ["Guardrail 1"],
        examples: ["Example 1"],
        firstStepPreview: "Preview"
      }),
      makeScenarioCandidate("skill-a", "carousel2", {
        displayName: { en: "Carousel 2" },
        description: { en: "Another" }
      }),
      makeScenarioCandidate("skill-b", "post", {
        displayName: { en: "Post" },
        description: { en: "Make a post." }
      })
    ];
    const bundleMap = resolveEnabledSkillScenariosForBundle({ candidates, locale: "en-US" });
    assert.equal(bundleMap.get("skill-a")?.length, 2);
    assert.equal(bundleMap.get("skill-b")?.length, 1);
    assert.equal(bundleMap.get("skill-a")?.[0]?.displayName, "English Name");
    assert.deepEqual(bundleMap.get("skill-a")?.[0]?.guardrails, ["Guardrail 1"]);
    assert.deepEqual(bundleMap.get("skill-a")?.[0]?.examples, ["Example 1"]);
    assert.equal(bundleMap.get("skill-a")?.[0]?.firstStepPreview, "Preview");

    const ruMap = resolveEnabledSkillScenariosForBundle({ candidates, locale: "ru" });
    assert.equal(ruMap.get("skill-a")?.[0]?.displayName, "Русское Название");
  }

  {
    const stable = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        {
          ...baseCandidate("marketer2", { assignmentEnabledAt: "2026-05-01T12:01:00.000Z" }),
          scenarios: [
            makeResolvedScenario("sc_a", { displayName: "Scenario A" }),
            makeResolvedScenario("sc_b", { displayName: "Scenario B" })
          ]
        }
      ]
    });
    const render1 = renderEnabledSkillsPromptBlock(stable);
    const render2 = renderEnabledSkillsPromptBlock(stable);
    assert.equal(render1, render2);
  }
}

void run();
