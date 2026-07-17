import type { Prisma } from "@prisma/client";
import {
  resolveEnabledSkillPromptCards,
  resolveEnabledSkillScenariosForBundle,
  renderEnabledSkillsPromptBlock,
  type EnabledSkillPromptCard,
  type EnabledSkillPromptCandidate,
  type EnabledSkillPromptInstructionCard,
  type EnabledSkillScenarioCandidate
} from "./enabled-skills-prompt-materialization";
import { normalizeSkillScenarioSteps } from "./skill-scenario-runtime-normalization";
import { materializeScenarioStepScriptRefs } from "./script-ref-materialization";

type PromptPrismaClient = Pick<
  Prisma.TransactionClient,
  "assistantRoleSkill" | "skill" | "skillScenario" | "skillScript"
>;

export type AssistantRoleEffectiveSkillsPrompt = {
  cards: EnabledSkillPromptCard[];
  scenariosBySkillId: Map<
    string,
    import("@persai/runtime-bundle").AssistantRuntimeEnabledSkillSummary["scenarios"]
  >;
  enabledSkillsBlock: string;
  skillIds: string[];
};

export async function resolveAssistantRoleEffectiveSkillsPrompt(params: {
  prisma: PromptPrismaClient;
  locale: string;
  roleId?: string;
  orderedSkillIds?: string[];
}): Promise<AssistantRoleEffectiveSkillsPrompt> {
  if ((params.roleId === undefined) === (params.orderedSkillIds === undefined)) {
    throw new Error("Exactly one Role Skill source must be provided.");
  }

  const ordered = params.roleId
    ? await params.prisma.assistantRoleSkill.findMany({
        where: {
          roleId: params.roleId,
          skill: { status: "active", archivedAt: null }
        },
        include: { skill: true },
        orderBy: [{ displayOrder: "asc" }, { skillId: "asc" }]
      })
    : await loadDraftLinks(params.prisma, params.orderedSkillIds ?? []);

  const skillIds = ordered.map((link) => link.skill.id);
  const scenarioRows =
    skillIds.length === 0
      ? []
      : await params.prisma.skillScenario.findMany({
          where: { skillId: { in: skillIds }, status: "active" },
          orderBy: [
            { skillId: "asc" },
            { displayOrder: "asc" },
            { createdAt: "asc" },
            { id: "asc" }
          ]
        });
  const scenarioCandidates: EnabledSkillScenarioCandidate[] = await Promise.all(
    scenarioRows.map(async (row) => ({
      skillId: row.skillId,
      key: row.key,
      displayName: normalizeStringRecord(row.displayName),
      description: normalizeStringRecord(row.description),
      iconEmoji: row.iconEmoji,
      intentExamples: normalizeStringArray(row.intentExamples),
      // ADR-151 — pins each step's raw {scriptKey, inputMapping} to the exact
      // owning-Skill SkillScript link + Script.currentPublishedVersion, or
      // null when that chain no longer resolves live.
      steps: await materializeScenarioStepScriptRefs({
        prisma: params.prisma,
        skillId: row.skillId,
        steps: normalizeSkillScenarioSteps(row.steps)
      }),
      recommendedTools: normalizeStringArray(row.recommendedTools),
      exitCondition: row.exitCondition,
      firstStepPreview: typeof row.firstStepPreview === "string" ? row.firstStepPreview : null
    }))
  );
  const scenariosBySkillId = resolveEnabledSkillScenariosForBundle({
    candidates: scenarioCandidates,
    locale: params.locale
  });
  const candidates: EnabledSkillPromptCandidate[] = ordered.map((link) => ({
    id: link.skill.id,
    name: normalizeStringRecord(link.skill.name),
    description: normalizeStringRecord(link.skill.description),
    category: link.skill.category,
    tags: normalizeStringArray(link.skill.tags),
    displayOrder: link.displayOrder,
    status: link.skill.status,
    instructionCard: normalizeInstructionCard(link.skill.instructionCard),
    iconEmoji: link.skill.iconEmoji,
    assignmentStatus: "active",
    assignmentEnabledAt: null,
    scenarios: scenariosBySkillId.get(link.skill.id) ?? []
  }));
  const cards = resolveEnabledSkillPromptCards({
    candidates,
    locale: params.locale,
    limit: null
  }).map((card) => ({
    ...card,
    scenarios: scenariosBySkillId.get(card.id) ?? []
  }));
  return {
    cards,
    scenariosBySkillId,
    enabledSkillsBlock: renderEnabledSkillsPromptBlock(cards),
    skillIds
  };
}

export function localizeAssistantRoleText(value: unknown, locale: string): string | null {
  const normalized = normalizeStringRecord(value);
  const entries = new Map(
    Object.entries(normalized).map(([key, text]) => [key.trim().toLowerCase(), text] as const)
  );
  const normalizedLocale = locale.trim().toLowerCase();
  const direct = entries.get(normalizedLocale);
  if (direct?.trim()) {
    return direct;
  }
  const language = normalizedLocale.split("-")[0] ?? normalizedLocale;
  const languageValue = entries.get(language);
  if (languageValue?.trim()) {
    return languageValue;
  }
  for (const fallback of ["en", "ru"]) {
    const text = entries.get(fallback);
    if (text?.trim()) {
      return text;
    }
  }
  return [...entries.values()].find((text) => text.trim().length > 0) ?? null;
}

async function loadDraftLinks(prisma: PromptPrismaClient, skillIds: string[]) {
  if (skillIds.length === 0) {
    return [];
  }
  const skills = await prisma.skill.findMany({
    where: { id: { in: skillIds }, status: "active", archivedAt: null }
  });
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return skillIds.map((skillId, displayOrder) => {
    const skill = byId.get(skillId);
    if (!skill) {
      throw new Error(`Active Skill ${skillId} was not found.`);
    }
    return { displayOrder, skill };
  });
}

function normalizeInstructionCard(value: unknown): EnabledSkillPromptInstructionCard {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { title: "", body: "", guardrails: [], examples: [], whenToUse: "" };
  }
  const row = value as Record<string, unknown>;
  return {
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    guardrails: normalizeStringArray(row.guardrails),
    examples: normalizeStringArray(row.examples),
    whenToUse: typeof row.whenToUse === "string" ? row.whenToUse : ""
  };
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, text]) => [key.trim().toLowerCase(), text])
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
