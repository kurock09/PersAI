/**
 * ADR-119 Golden Test 1 — Full materialized system-prefix byte-snapshot.
 *
 * Composes the AOT-cached system prefix for a representative fixture:
 *   - Lyra assistant (warm_quiet archetype + flirty character notes)
 *   - One enabled Marketer Skill with a 5-step Instagram-carousel scenario
 *
 * On first run the expected fixture is generated and the test passes (the
 * committed file then serves as the regression anchor). On subsequent runs
 * the rendered prompt must be BYTE-IDENTICAL to the committed fixture.
 *
 * Fixture path: apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt
 *
 * NOTE: This test lives in apps/api/test/ because CompilePromptConstructorService
 * is an api-package class. The runtime package cannot import it without cross-
 * package wiring. Deviation from the originally specified
 * apps/runtime/test/adr119-golden-prompt-snapshot.test.ts documented in Slice 11
 * session handoff.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_TEMPLATE_DEFAULTS } from "../prisma/bootstrap-preset-data";
import { CompilePromptConstructorService } from "../src/modules/workspace-management/application/compile-prompt-constructor.service";
import type { EnabledSkillPromptCard } from "../src/modules/workspace-management/application/enabled-skills-prompt-materialization";
import type { VoiceDnaResolved } from "../src/modules/workspace-management/application/voice-dna-modulator";
import type { RuntimeBundleSkillScenario } from "@persai/runtime-contract";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_VOICE_DNA: VoiceDnaResolved = {
  archetypeKey: "warm_quiet",
  archetypeLabel: "Тёплый и тихий",
  archetypeDescription: "тёплый и немногословный",
  voice: { sentenceLength: "short", pace: "slow", irony: 5 },
  openingsAllowed: ["Слышу.", "Понимаю.", "Тут я."],
  openingsForbidden: ["Боже мой!", "Ого!", "Конечно!"],
  behaviors: {
    whenUserUpset: "Не утешаешь словами. Признаёшь то, что слышишь. Молчишь рядом, если можно.",
    whenUserExcited: "Радуешься тихо. Одна короткая искренняя фраза, не восклицания.",
    whenUserTired: "Снижаешь требования к себе и к нему. Короче, мягче.",
    whenUserAngry: "Не споришь, не оправдываешься. Слышишь, признаёшь."
  },
  silenceRule: "Если нечего добавить — не добавляешь. Тишина — нормально.",
  examples: [
    { context: "Сегодня тяжёлый день был.", reply: "Слышу. Тут я, если что." },
    { context: "Получил повышение!", reply: "Это хорошо. Заслужил." }
  ],
  traits: { formality: 30, verbosity: 40, playfulness: 20, initiative: 40, warmth: 75 }
};

const FIXTURE_INSTAGRAM_CAROUSEL_SCENARIO: RuntimeBundleSkillScenario = {
  key: "instagram_carousel",
  displayName: "Instagram Carousel",
  description: "Create a multi-slide Instagram carousel with cohesive visual storytelling.",
  iconEmoji: "🎠",
  intentExamples: [
    "Сделай карусель в инсту",
    "Make an Instagram carousel",
    "Create carousel slides for my product"
  ],
  steps: [
    {
      number: 1,
      directive:
        "Understand the carousel topic and target audience. Confirm the hook concept and number of slides (default 8).",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: ["Do not generate images before step 3."],
      expectedUserResponse:
        "User provides topic, product info, or reference image for the carousel.",
      nextStepTrigger: "Topic and structure confirmed by user.",
      recoveryGuidance: "Ask clarifying questions about the product or audience if unclear."
    },
    {
      number: 2,
      directive:
        "Draft the slide structure: hook slide, 5-6 content slides, CTA slide. Present outline as text for approval.",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: ["Do not skip presenting the structure before generating visuals."],
      expectedUserResponse: "User approves or requests changes to the slide structure.",
      nextStepTrigger: "User explicitly approves the structure.",
      recoveryGuidance:
        "Revise the outline based on user feedback; do not proceed to generation until approved."
    },
    {
      number: 3,
      directive:
        "Generate the carousel using image_edit with outputMode='series' if a reference image is provided, otherwise image_generate with series mode.",
      recommendedToolCall: "image_edit",
      mayBeSkippedIf: null,
      negativeGuards: [
        "Do not collapse steps 3-5 into one call.",
        "Do not generate without user approval from step 2."
      ],
      expectedUserResponse: "User reviews the generated carousel images.",
      nextStepTrigger: "Images generated and delivered successfully.",
      recoveryGuidance:
        "If image tool fails, report error and ask user to retry or adjust the brief."
    },
    {
      number: 4,
      directive:
        "Present the carousel result and offer caption copy for each slide (hook, value props, CTA).",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: ["Do not write captions before images are confirmed."],
      expectedUserResponse: "User reviews captions and requests edits or approves.",
      nextStepTrigger: "User satisfied with captions.",
      recoveryGuidance: "Revise captions as requested; keep them concise and on-brand."
    },
    {
      number: 5,
      directive:
        "Confirm delivery. Offer to adjust style, colours, or copy for any slide, or to produce a PDF export.",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: ["Do not re-generate the full series unless explicitly asked."],
      expectedUserResponse: "User confirms satisfaction or requests targeted adjustments.",
      nextStepTrigger: "User confirms the carousel is ready.",
      recoveryGuidance: "Address only the specific slides or copy the user wants to change."
    }
  ],
  recommendedTools: ["image_edit", "image_generate"],
  exitCondition:
    "User has confirmed the carousel (images + captions) or explicitly asked to end the scenario.",
  firstStepPreview: "Understand the topic and confirm structure before generating visuals."
};

const FIXTURE_MARKETER_SKILL: EnabledSkillPromptCard = {
  id: "skill-marketer-01",
  name: "Marketer",
  description:
    "Marketing strategy, content creation, and campaign planning for social media and digital channels.",
  category: "marketing",
  tags: ["marketing", "content", "social", "instagram", "campaigns"],
  iconEmoji: "📣",
  title: "Marketer mode",
  body: "Apply proven marketing frameworks. Craft compelling hooks, value propositions, and CTAs. Match brand voice and audience expectations.",
  guardrails: [
    "Do not make unsubstantiated performance claims.",
    "Do not generate misleading before/after imagery."
  ],
  examples: [
    "Create an 8-slide Instagram carousel for a product launch",
    "Write a LinkedIn post series for a B2B SaaS company"
  ],
  whenToUse:
    "Use when the user needs marketing content, social media posts, ad copy, or campaign planning.",
  scenarios: [FIXTURE_INSTAGRAM_CAROUSEL_SCENARIO]
};

const FIXTURE_PUBLISHED_VERSION = {
  id: "v-lyra-01",
  assistantId: "a-lyra-01",
  version: 1,
  snapshotDisplayName: "Лира",
  snapshotInstructions:
    "Ты женщина игривая и сексуальная, всегда флиртуешь и не боишься откровенных тем.\nРазговариваешь с искрой всегда, задеваешь и подначиваешь при любой возможности.\nПроявляешь страсть и нежность как заводная женщина.",
  snapshotTraits: { warmth: 75, playfulness: 20, formality: 30 },
  snapshotAvatarEmoji: "🌙",
  snapshotAvatarUrl: null,
  snapshotAssistantGender: "female" as const,
  snapshotVoiceProfile: null,
  publishedByUserId: "u-founder-01",
  createdAt: new Date("2026-01-01T00:00:00.000Z")
};

const FIXTURE_USER_CONTEXT = {
  displayName: "Алексей",
  birthday: "1995-06-15",
  gender: "male",
  locale: "ru-RU",
  timezone: "Europe/Moscow"
};

// ---------------------------------------------------------------------------
// Snapshot test
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const FIXTURE_PATH = path.join(FIXTURE_DIR, "adr119-golden-prompt-snapshot.expected.txt");

async function runAdr119GoldenPromptSnapshotTest(): Promise<void> {
  const service = new CompilePromptConstructorService();

  const compiled = service.compile({
    publishedVersion: FIXTURE_PUBLISHED_VERSION,
    userContext: FIXTURE_USER_CONTEXT,
    toolPolicies: [],
    enabledSkillCards: [FIXTURE_MARKETER_SKILL],
    promptTemplates: { ...PROMPT_TEMPLATE_DEFAULTS },
    voiceDna: FIXTURE_VOICE_DNA
  });

  const rendered = compiled.promptConstructor.ordinary.systemPrompt ?? "";

  // Sanity: rendered prompt must contain key structural markers.
  assert.ok(rendered.length > 0, "rendered prompt must be non-empty");
  assert.ok(rendered.includes("<voice>"), "rendered prompt must contain <voice>");
  assert.ok(
    rendered.includes("<character_notes>"),
    "rendered prompt must contain <character_notes>"
  );
  assert.ok(rendered.includes("<enabled_skills>"), "rendered prompt must contain <enabled_skills>");
  assert.ok(
    rendered.includes("instagram_carousel"),
    "rendered prompt must contain instagram_carousel scenario key"
  );
  assert.ok(
    rendered.includes("<memory_protocol>"),
    "rendered prompt must contain <memory_protocol>"
  );
  assert.ok(
    rendered.includes("<reminders_protocol>"),
    "rendered prompt must contain <reminders_protocol>"
  );
  assert.ok(
    rendered.includes("<response_contract>"),
    "rendered prompt must contain <response_contract>"
  );
  assert.ok(
    rendered.includes("<tool_usage_policy>"),
    "rendered prompt must contain <tool_usage_policy>"
  );
  assert.ok(rendered.includes("<priority_order>"), "rendered prompt must contain <priority_order>");

  if (!existsSync(FIXTURE_PATH)) {
    // First run: generate the expected fixture and indicate rerun needed.
    if (!existsSync(FIXTURE_DIR)) {
      mkdirSync(FIXTURE_DIR, { recursive: true });
    }
    writeFileSync(FIXTURE_PATH, rendered, "utf8");
    // Log but do NOT fail — fixture generated on this run; subsequent runs assert byte equality.
    console.log(
      `[ADR-119 Golden Test 1] Expected snapshot generated at ${FIXTURE_PATH}.\n` +
        `  Bytes: ${Buffer.byteLength(rendered, "utf8")}.\n` +
        `  Commit this file; subsequent runs will assert byte equality.`
    );
    return;
  }

  // Subsequent runs: assert byte equality.
  const expected = readFileSync(FIXTURE_PATH, "utf8");
  assert.equal(
    rendered,
    expected,
    "ADR-119 Golden Test 1: full materialized system prefix must be byte-identical to the committed fixture.\n" +
      "If the prompt intentionally changed, delete the fixture file and rerun once to regenerate it."
  );
}

void runAdr119GoldenPromptSnapshotTest();
