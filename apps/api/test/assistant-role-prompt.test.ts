import assert from "node:assert/strict";
import test from "node:test";
import { renderAssistantRoleMissionBlock } from "../src/modules/workspace-management/application/assistant-role-prompt";
import {
  renderEnabledSkillsPromptBlock,
  resolveEnabledSkillPromptCards,
  type EnabledSkillPromptCandidate
} from "../src/modules/workspace-management/application/enabled-skills-prompt-materialization";
import {
  localizeAssistantRoleText,
  resolveAssistantRoleEffectiveSkillsPrompt
} from "../src/modules/workspace-management/application/assistant-role-effective-skills-prompt";
import { ManageAdminRolesService } from "../src/modules/workspace-management/application/manage-admin-roles.service";

void test("shared mission renderer escapes XML and matches production block shape", () => {
  const mission = `Help with "quotes" & <tags> and 'apostrophes'.`;
  const block = renderAssistantRoleMissionBlock(mission);
  assert.equal(
    block,
    `<assistant_role>\n<mission>Help with &quot;quotes&quot; &amp; &lt;tags&gt; and &apos;apostrophes&apos;.</mission>\n</assistant_role>`
  );
  assert.equal(renderAssistantRoleMissionBlock("   "), "");
  assert.equal(renderAssistantRoleMissionBlock(null), "");
});

void test("enabled-skills preview pipeline is deterministic and byte-stable", () => {
  const candidates: EnabledSkillPromptCandidate[] = [
    {
      id: "00000000-0000-4000-8000-000000000301",
      name: { en: "Analyst", ru: "Аналитик" },
      description: { en: "Analysis skill", ru: "Навык анализа" },
      category: "work",
      tags: ["analysis"],
      displayOrder: 0,
      status: "active",
      instructionCard: {
        title: "Analyst",
        body: "Analyze carefully.",
        guardrails: ["Do not invent facts"],
        examples: ["Summarize findings"],
        whenToUse: "When analysis is requested"
      },
      iconEmoji: null,
      assignmentStatus: "active",
      assignmentEnabledAt: new Date("1970-01-01T00:00:00.000Z"),
      scenarios: [
        {
          key: "deep_dive",
          displayName: "Deep dive",
          description: "",
          iconEmoji: null,
          intentExamples: [],
          steps: [],
          recommendedTools: [],
          exitCondition: "done",
          firstStepPreview: null
        }
      ]
    }
  ];
  const cards = resolveEnabledSkillPromptCards({
    candidates,
    locale: "en",
    limit: null
  }).map((card, index) => ({
    ...card,
    scenarios: candidates[index]?.scenarios ?? []
  }));
  const first = renderEnabledSkillsPromptBlock(cards);
  const second = renderEnabledSkillsPromptBlock(cards);
  assert.equal(first, second);
  assert.match(first, /skill id="00000000-0000-4000-8000-000000000301"/);
  assert.match(first, /<when_to_use>When analysis is requested<\/when_to_use>/);
  assert.match(first, /scenario key="deep_dive"/);
});

void test("Admin preview is byte-identical to the production Role pipeline", async () => {
  const skills = [
    {
      id: "00000000-0000-4000-8000-000000000302",
      name: { EN: "Research & Verify", RU: "Исследовать" },
      description: { en: "Use <sources>", ru: "Источники" },
      category: "work",
      tags: ["research"],
      displayOrder: 0,
      status: "active",
      archivedAt: null,
      instructionCard: {
        title: "Research",
        body: "Check <facts> & cite.",
        guardrails: ["No guesses"],
        examples: ["Find sources"],
        whenToUse: "Research requests"
      },
      iconEmoji: null
    },
    {
      id: "00000000-0000-4000-8000-000000000301",
      name: { en: "Analyze", ru: "Анализ" },
      description: { EN: "Compare options", RU: "Сравнивать" },
      category: "work",
      tags: ["analysis"],
      displayOrder: 1,
      status: "active",
      archivedAt: null,
      instructionCard: {
        title: "Analyze",
        body: "Compare.",
        guardrails: [],
        examples: [],
        whenToUse: "Comparisons"
      },
      iconEmoji: null
    }
  ];
  const orderedIds = skills.map((skill) => skill.id);
  const scenario = {
    id: "scenario-1",
    skillId: skills[0]!.id,
    key: "source_check",
    displayName: { EN: "Source check", RU: "Проверка" },
    description: { en: "Verify.", ru: "Проверь." },
    iconEmoji: null,
    intentExamples: ["Verify this"],
    steps: [{ number: 1, directive: "Check source." }],
    recommendedTools: ["browser.fetch"],
    exitCondition: "Sources verified",
    firstStepPreview: "Checking",
    status: "active",
    displayOrder: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };
  let productionRoleLinkQuery: unknown = null;
  const prisma = {
    assistantRoleSkill: {
      findMany: async (query: unknown) => {
        productionRoleLinkQuery = query;
        return skills.map((skill, displayOrder) => ({
          displayOrder,
          createdAt: new Date(displayOrder === 0 ? "2026-06-01" : "2025-01-01"),
          skill
        }));
      }
    },
    skill: {
      findMany: async () => [...skills].reverse()
    },
    skillScenario: {
      findMany: async () => [scenario]
    }
  };
  const service = new ManageAdminRolesService(
    { assertCanReadAdminSurface: async () => undefined } as never,
    prisma as never
  );
  const mission = { EN: `Lead "carefully" & <honestly>.`, RU: "Помогай." } as never;
  const preview = await service.preview("admin-1", {
    locale: "en",
    mission,
    skillIds: orderedIds
  });
  const production = await resolveAssistantRoleEffectiveSkillsPrompt({
    prisma: prisma as never,
    roleId: "role-1",
    locale: "en"
  });

  assert.equal(
    preview.missionBlock,
    renderAssistantRoleMissionBlock(localizeAssistantRoleText(mission, "en"))
  );
  assert.equal(preview.enabledSkillsBlock, production.enabledSkillsBlock);
  assert.deepEqual(preview.skillIds, orderedIds);
  assert.ok(
    preview.enabledSkillsBlock.indexOf(skills[0]!.id) <
      preview.enabledSkillsBlock.indexOf(skills[1]!.id),
    "Skill 302 must render before Skill 301 by displayOrder despite newer createdAt"
  );
  assert.deepEqual((productionRoleLinkQuery as { orderBy: unknown }).orderBy, [
    { displayOrder: "asc" },
    { skillId: "asc" }
  ]);
  assert.match(preview.enabledSkillsBlock, /Research &amp; Verify/);
  assert.match(preview.enabledSkillsBlock, /scenario key="source_check"/);
});
