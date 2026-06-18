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

  // ADR-119 Slice 3 — new XML format
  const block = renderEnabledSkillsPromptBlock(cards);

  // Contains skill XML tags with id attribute
  assert.match(block, /<skill id="accounting"/);
  assert.match(block, /<skill id="legal"/);
  assert.doesNotMatch(block, /<skill id="disabled"/);
  assert.doesNotMatch(block, /<skill id="archived"/);
  assert.doesNotMatch(block, /<skill id="over-limit"/);

  // key attribute present (falls back to id since no slug field)
  assert.match(block, /key="accounting"/);
  assert.match(block, /key="legal"/);

  // display_name and summary tags
  assert.match(block, /<display_name>/);

  // XML comment intro contains engage guidance
  assert.match(block, /<!--.*skillId.*skill\(\{action:"engage"\}\)/);

  // R8 critical: body/guardrails/examples must NOT appear in the prefix block
  assert.doesNotMatch(block, /Body:/);
  assert.doesNotMatch(block, /Guardrails:/);
  assert.doesNotMatch(block, /Examples:/);

  // R8 critical: verbatim instructionCard.body content must NOT appear in the prefix block
  assert.doesNotMatch(block, /Use accounting knowledge carefully\./);
  assert.doesNotMatch(block, /Use legal knowledge carefully\./);

  // Closing skill tags
  assert.match(block, /<\/skill>/);

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

  // ADR-118 Slice 4 — scenario catalog rendering in the cached prefix (new XML format)

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
              recommendedTools: ["image_generate", "text_format"],
              steps: [
                {
                  number: 1,
                  directive: "Collect the brief from user",
                  recommendedToolCall: null,
                  mayBeSkippedIf: null,
                  negativeGuards: []
                }
              ]
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

    // Scenario XML structure
    assert.match(catalogBlock, /<scenario key="instagram_carousel">/);
    assert.match(catalogBlock, /<name>Instagram Carousel<\/name>/);
    assert.match(catalogBlock, /<one_line>Create an 8-slide post\.<\/one_line>/);

    // first_step_preview present when steps[0] exists
    assert.match(
      catalogBlock,
      /<first_step_preview>Collect the brief from user<\/first_step_preview>/
    );

    // recommended_tools present
    assert.match(
      catalogBlock,
      /<recommended_tools>image_generate, text_format<\/recommended_tools>/
    );

    // No recommended_tools tag when empty
    assert.match(catalogBlock, /<scenario key="linkedin_post">/);
    assert.doesNotMatch(
      catalogBlock.slice(
        catalogBlock.indexOf('<scenario key="linkedin_post">'),
        catalogBlock.indexOf("</scenario>", catalogBlock.indexOf('<scenario key="linkedin_post">'))
      ),
      /<recommended_tools>/
    );

    // email_campaign with tools
    assert.match(catalogBlock, /<recommended_tools>email_draft<\/recommended_tools>/);

    // first_step_preview absent when steps is empty
    assert.doesNotMatch(
      catalogBlock.slice(
        catalogBlock.indexOf('<scenario key="linkedin_post">'),
        catalogBlock.indexOf("</scenario>", catalogBlock.indexOf('<scenario key="linkedin_post">'))
      ),
      /<first_step_preview>/
    );
  }

  // Scenario catalog: zero scenarios — <available_scenarios /> self-closing
  {
    const cardsNoScenarios = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        { ...baseCandidate("accounting", { assignmentEnabledAt: "2026-05-01T12:01:00.000Z" }) }
      ]
    });
    const blockNoScenarios = renderEnabledSkillsPromptBlock(cardsNoScenarios);
    assert.match(blockNoScenarios, /<available_scenarios \/>/);
    assert.doesNotMatch(blockNoScenarios, /<available_scenarios>/);
  }

  // Scenario catalog: 10 scenarios → renders SCENARIO_CATALOG_RENDER_LIMIT items, no +N more in XML format
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
    // Exactly 8 scenario elements rendered (LIMIT)
    const scenarioMatches = blockOverLimit.match(/<scenario key="scenario_/g) ?? [];
    assert.equal(
      scenarioMatches.length,
      SCENARIO_CATALOG_RENDER_LIMIT,
      "must render exactly SCENARIO_CATALOG_RENDER_LIMIT scenario elements"
    );
    // scenario_9 and scenario_10 should be absent
    assert.doesNotMatch(blockOverLimit, /<scenario key="scenario_9"/);
    assert.doesNotMatch(blockOverLimit, /<scenario key="scenario_10"/);
  }

  // first_step_preview: truncate at 200 chars + ellipsis
  {
    const longDirective = "A".repeat(250);
    const cardsWithLongStep = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        {
          ...baseCandidate("skill-preview", { assignmentEnabledAt: "2026-05-01T12:01:00.000Z" }),
          scenarios: [
            makeResolvedScenario("sc_long", {
              steps: [
                {
                  number: 1,
                  directive: longDirective,
                  recommendedToolCall: null,
                  mayBeSkippedIf: null,
                  negativeGuards: []
                }
              ]
            })
          ]
        }
      ]
    });
    const previewBlock = renderEnabledSkillsPromptBlock(cardsWithLongStep);
    // first_step_preview content should be ≤200 chars (after escaping) and end with ellipsis
    const previewMatch = previewBlock.match(/<first_step_preview>([\s\S]*?)<\/first_step_preview>/);
    assert.ok(previewMatch, "first_step_preview tag must be present");
    const previewContent = previewMatch![1]!;
    assert.ok(previewContent.length <= 200, "first_step_preview content must be ≤200 chars");
    assert.ok(
      previewContent.endsWith("\u2026") || previewContent.endsWith("..."),
      "truncated preview must end with ellipsis"
    );
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

  // Cache-prefix byte-stability: two renders with the same card list must be byte-identical.
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
    // Both scenario keys appear in the catalog
    assert.match(render1, /sc_a/);
    assert.match(render1, /sc_b/);
  }

  // R8 critical: body/guardrails/examples must NOT appear in prefix for skill with rich instructionCard
  {
    const richCandidate = baseCandidate("rich-skill", {
      assignmentEnabledAt: "2026-05-01T12:01:00.000Z",
      instructionCard: {
        title: "Rich Skill",
        body: "RICH_BODY_CONTENT_SENTINEL",
        guardrails: ["RICH_GUARDRAIL_SENTINEL"],
        examples: ["RICH_EXAMPLE_SENTINEL"]
      }
    });
    const richCards = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [richCandidate]
    });
    const richBlock = renderEnabledSkillsPromptBlock(richCards);
    assert.doesNotMatch(richBlock, /RICH_BODY_CONTENT_SENTINEL/, "body must not appear in prefix");
    assert.doesNotMatch(
      richBlock,
      /RICH_GUARDRAIL_SENTINEL/,
      "guardrails must not appear in prefix"
    );
    assert.doesNotMatch(richBlock, /RICH_EXAMPLE_SENTINEL/, "examples must not appear in prefix");

    // R8 invariant: card object DOES carry body/guardrails/examples for bundle population
    assert.equal(
      richCards[0]?.body,
      "RICH_BODY_CONTENT_SENTINEL",
      "card.body must be preserved for bundle"
    );
    assert.deepEqual(
      richCards[0]?.guardrails,
      ["RICH_GUARDRAIL_SENTINEL"],
      "card.guardrails must be preserved for bundle"
    );
    assert.deepEqual(
      richCards[0]?.examples,
      ["RICH_EXAMPLE_SENTINEL"],
      "card.examples must be preserved for bundle"
    );
  }

  // Bundle byte-stability: resolveEnabledSkillPromptCards + renderEnabledSkillsPromptBlock is deterministic
  {
    const stableCandidate = baseCandidate("stable-skill", {
      assignmentEnabledAt: "2026-05-01T12:01:00.000Z",
      instructionCard: {
        title: "Stable",
        body: "Stable body.",
        guardrails: ["Guard 1", "Guard 2"],
        examples: ["Example 1"]
      }
    });
    const cards1 = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [stableCandidate]
    });
    const cards2 = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [stableCandidate]
    });
    const block1 = renderEnabledSkillsPromptBlock(cards1);
    const block2 = renderEnabledSkillsPromptBlock(cards2);
    assert.equal(block1, block2, "repeated materialization must produce byte-identical output");
  }

  // ADR-119 Slice 10 — firstStepPreview override in catalog rendering

  // When scenario carries firstStepPreview, the materializer uses it verbatim (not auto-derived).
  {
    const cardsWithOverride = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        {
          ...baseCandidate("skill-with-preview", {
            assignmentEnabledAt: "2026-05-01T12:01:00.000Z"
          }),
          scenarios: [
            makeResolvedScenario("sc_override", {
              displayName: "Scenario Override",
              description: "Test scenario.",
              firstStepPreview: "Custom catalog preview text.",
              steps: [
                {
                  number: 1,
                  directive: "This is the full directive text that would auto-derive.",
                  recommendedToolCall: null,
                  mayBeSkippedIf: null,
                  negativeGuards: []
                }
              ]
            })
          ]
        }
      ]
    });
    const overrideBlock = renderEnabledSkillsPromptBlock(cardsWithOverride);
    assert.match(
      overrideBlock,
      /<first_step_preview>Custom catalog preview text\.<\/first_step_preview>/,
      "firstStepPreview override must be used verbatim in catalog"
    );
    assert.doesNotMatch(
      overrideBlock,
      /This is the full directive text that would auto-derive\./,
      "auto-derived directive text must NOT appear when override is set"
    );
  }

  // When scenario has no firstStepPreview, the materializer falls back to truncated directive.
  {
    const cardsWithFallback = resolveEnabledSkillPromptCards({
      locale: "en-US",
      limit: null,
      candidates: [
        {
          ...baseCandidate("skill-with-fallback", {
            assignmentEnabledAt: "2026-05-01T12:01:00.000Z"
          }),
          scenarios: [
            makeResolvedScenario("sc_fallback", {
              displayName: "Scenario Fallback",
              description: "Fallback test.",
              // firstStepPreview intentionally absent (undefined) — backward compat
              steps: [
                {
                  number: 1,
                  directive: "Collect the brief from the user via structured questions.",
                  recommendedToolCall: null,
                  mayBeSkippedIf: null,
                  negativeGuards: []
                }
              ]
            })
          ]
        }
      ]
    });
    const fallbackBlock = renderEnabledSkillsPromptBlock(cardsWithFallback);
    assert.match(
      fallbackBlock,
      /<first_step_preview>Collect the brief from the user via structured questions\.<\/first_step_preview>/,
      "fallback to directive text must work when firstStepPreview is absent"
    );
  }
}

void run();
