import { describe, expect, it } from "vitest";
import type { AssistantSkillCatalogItemState } from "../assistant-api-client";
import {
  getEnabledSkillCount,
  getSkillDisabledReason,
  getSkillGroupRank,
  isSkillSelectionOverLimit,
  orderSkillCatalogItems,
  resolveVisibleSkillCatalogItems,
  resolveSkillDescription,
  resolveSkillDisplayName,
  resolveSkillGroupLabel,
  summarizeSkillReadiness,
  toggleSkillSelection
} from "./assistant-skills-manager";

function createItem(
  overrides: Partial<AssistantSkillCatalogItemState> = {}
): AssistantSkillCatalogItemState {
  const now = "2026-05-01T12:00:00.000Z";
  return {
    skill: {
      id: "skill-1",
      status: "active",
      name: { en: "Legal", ru: "Юридический" },
      description: { en: "Legal support", ru: "Юридическая помощь" },
      category: "legal",
      tags: [],
      instructionCard: {
        title: "Legal",
        body: "Use legal sources.",
        guardrails: [],
        examples: []
      },
      iconEmoji: null,
      color: null,
      displayOrder: 10,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      documents: []
    },
    assignment: null,
    selectable: true,
    disabledReason: null,
    ...overrides
  };
}

describe("assistant Skills manager helpers", () => {
  it("resolves localized text with fallback", () => {
    const item = createItem();

    expect(resolveSkillDisplayName(item, "ru-RU")).toBe("Юридический");
    expect(resolveSkillDescription(item, "en-US")).toBe("Legal support");
    expect(resolveSkillGroupLabel("engineering", "ru-RU")).toBe("Профессии / Engineering");
    expect(resolveSkillGroupLabel("legal", "en-US")).toBe("legal");
    expect(getSkillGroupRank("personal")).toBeLessThan(getSkillGroupRank("work"));
  });

  it("orders Skills by product group before name", () => {
    const work = createItem({
      skill: { ...createItem().skill, id: "work", name: { en: "Career" }, category: "work" }
    });
    const personal = createItem({
      skill: {
        ...createItem().skill,
        id: "personal",
        name: { en: "Dietitian" },
        category: "personal"
      }
    });
    const engineering = createItem({
      skill: {
        ...createItem().skill,
        id: "engineering",
        name: { en: "Engineer" },
        category: "engineering"
      }
    });

    expect(
      orderSkillCatalogItems([engineering, work, personal], new Set(), "en").map(
        (item) => item.skill.id
      )
    ).toEqual(["personal", "work", "engineering"]);
  });

  it("counts and toggles selections without duplicates", () => {
    expect(getEnabledSkillCount(["skill-1", "skill-1", "skill-2"])).toBe(2);
    expect(toggleSkillSelection(["skill-1"], "skill-2", true)).toEqual(["skill-1", "skill-2"]);
    expect(toggleSkillSelection(["skill-1", "skill-2"], "skill-1", false)).toEqual(["skill-2"]);
  });

  it("keeps the compact first-page slice even when all Skills are plan-disabled", () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      createItem({
        skill: {
          ...createItem().skill,
          id: `skill-${index + 1}`,
          name: { en: `Skill ${index + 1}` }
        }
      })
    );

    expect(
      resolveVisibleSkillCatalogItems(items, {
        collapsible: true,
        expanded: false,
        initialVisibleCount: 4
      }).length
    ).toBe(4);
  });

  it("detects plan limits and disabled reasons", () => {
    const item = createItem({ skill: { ...createItem().skill, id: "skill-2" } });

    expect(isSkillSelectionOverLimit(["skill-1", "skill-2"], 1)).toBe(true);
    expect(getSkillDisabledReason(item, [], 0)).toBe("skill_limit_reached");
    expect(getSkillDisabledReason(item, ["skill-1"], 1)).toBe("skill_limit_reached");
    expect(getSkillDisabledReason(createItem(), ["skill-1"], 1)).toBeNull();
  });

  it("summarizes document readiness states", () => {
    const readyDocument = {
      id: "doc-1",
      skillId: "skill-1",
      displayName: null,
      description: null,
      originalFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      status: "ready" as const,
      currentVersion: 1,
      chunkCount: 1,
      processorProviderKey: null,
      processorMode: null,
      processingQuality: null,
      lastIndexedAt: null,
      lastReindexRequestedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-01T12:00:00.000Z"
    };

    expect(summarizeSkillReadiness(createItem())).toBe("empty");
    expect(
      summarizeSkillReadiness(
        createItem({ skill: { ...createItem().skill, documents: [readyDocument] } })
      )
    ).toBe("ready");
    expect(
      summarizeSkillReadiness(
        createItem({
          skill: {
            ...createItem().skill,
            documents: [{ ...readyDocument, status: "needs_review" }]
          }
        })
      )
    ).toBe("needs_review");
  });
});
