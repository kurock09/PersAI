import assert from "node:assert/strict";
import type { RuntimeBundleSkillScenario } from "@persai/runtime-contract";
import {
  renderEnabledSkillsPromptBlock,
  resolveEnabledSkillPromptCards,
  resolveEnabledSkillScenariosForBundle,
  SCENARIO_CATALOG_RENDER_LIMIT,
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

/** Builds a resolved RuntimeBundleSkillScenario (already locale-resolved, for use in EnabledSkillPromptCandidate). */
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
    ...overrides
  };
}

/** Builds an EnabledSkillScenarioCandidate (locale-map form, for testing resolveEnabledSkillScenariosForBundle). */
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

  // ADR-118 Slice 4 — scenario catalog rendering in the cached prefix

  // Scenario catalog: 3 scenarios, with and without recommendedTools
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
              recommendedTools: ["image_generate", "text_format"]
            }),
            makeResolvedScenario("linkedin_post", {
              displayName: "LinkedIn Post",
              description: "Write a professional post.",
              recommendedTools: []
            }),
            makeResolvedScenario("email_campaign", {
              displayName: "Email Campaign",
              description: "Draft a marketing email.",
              recommendedTools: ["email_draft"]
            })
          ]
        }
      ]
    });
    assert.equal(cardsWithScenarios.length, 1);
    assert.equal(cardsWithScenarios[0]?.scenarios.length, 3);
    const catalogBlock = renderEnabledSkillsPromptBlock(cardsWithScenarios);
    assert.match(catalogBlock, /Available scenarios:/);
    // With tools — parenthetical included
    assert.match(
      catalogBlock,
      /- instagram_carousel: Instagram Carousel — Create an 8-slide post\. \(recommended: image_generate, text_format\)/
    );
    // No tools — parenthetical omitted
    assert.match(catalogBlock, /- linkedin_post: LinkedIn Post — Write a professional post\./);
    assert.doesNotMatch(catalogBlock, /linkedin_post.*recommended:/);
    // With tools again
    assert.match(
      catalogBlock,
      /- email_campaign: Email Campaign — Draft a marketing email\. \(recommended: email_draft\)/
    );
  }

  // Scenario catalog: zero scenarios — "Available scenarios:" section omitted entirely
  {
    const cardsNoScenarios = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        { ...baseCandidate("accounting", { assignmentEnabledAt: "2026-05-01T12:01:00.000Z" }) }
      ]
    });
    const blockNoScenarios = renderEnabledSkillsPromptBlock(cardsNoScenarios);
    assert.doesNotMatch(blockNoScenarios, /Available scenarios:/);
  }

  // Scenario catalog: 10 scenarios → renders SCENARIO_CATALOG_RENDER_LIMIT items + "... +N more" footer
  {
    assert.equal(SCENARIO_CATALOG_RENDER_LIMIT, 8, "SCENARIO_CATALOG_RENDER_LIMIT must be 8");
    const tenScenarios = Array.from({ length: 10 }, (_, i) =>
      makeResolvedScenario(`scenario_${String(i + 1)}`, {
        displayName: `Scenario ${String(i + 1)}`
      })
    );
    const cardsOverLimit = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        {
          ...baseCandidate("skill-x", { assignmentEnabledAt: "2026-05-01T12:01:00.000Z" }),
          scenarios: tenScenarios
        }
      ]
    });
    const blockOverLimit = renderEnabledSkillsPromptBlock(cardsOverLimit);
    assert.match(blockOverLimit, /\.\.\. \+2 more/, "must show +2 more footer for 10 scenarios");
    // Exactly 8 scenario lines rendered (LIMIT)
    const scenarioLines = (blockOverLimit.match(/^- scenario_/gm) ?? []).length;
    assert.equal(scenarioLines, SCENARIO_CATALOG_RENDER_LIMIT);
  }

  // resolveEnabledSkillScenariosForBundle: locale resolution + grouping per skillId
  {
    const candidates: EnabledSkillScenarioCandidate[] = [
      makeScenarioCandidate("skill-a", "carousel", {
        displayName: { en: "English Name", ru: "Русское Название" },
        description: { en: "A description" }
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

    // Locale fallback to ru
    const ruMap = resolveEnabledSkillScenariosForBundle({ candidates, locale: "ru" });
    assert.equal(ruMap.get("skill-a")?.[0]?.displayName, "Русское Название");
  }

  // Cache-prefix byte-stability: the scenario catalog section must be identical regardless of
  // which scenario is "active" — that state lives in the volatile block, not the prefix.
  // Two renders with the same candidate list must produce byte-identical output.
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
    assert.equal(
      render1,
      render2,
      "scenario catalog rendering must be deterministic (cache-prefix byte-stability)"
    );
    // Verify neither active scenario key appears as a "state marker" — the prefix shows the
    // catalog (both keys listed) not any per-turn selection.
    assert.match(render1, /sc_a/);
    assert.match(render1, /sc_b/);
  }
}

void run();
