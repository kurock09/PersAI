import { describe, expect, it } from "vitest";
import type {
  AdminSkillState,
  SkillAuthoringDraftKnowledgeCardProposal,
  SkillDocumentState,
  SkillKnowledgeCardState
} from "@/app/app/assistant-api-client";
import type { AdminSkillScenario } from "@persai/contracts";
import {
  draftToSkillPayload,
  filterUnsavedProposedKnowledgeCards,
  KNOWLEDGE_LOCALE_OPTIONS,
  knowledgeCardDraftToPayload,
  knowledgeCardToDraft,
  NATIVE_SCENARIO_TOOL_KEYS,
  renderActiveScenarioBlockPreview,
  renderScenarioCatalogLine,
  scenarioDraftToCreatePayload,
  scenarioDraftToUpdatePayload,
  scenarioToDraft,
  skillToDraft,
  summarizeKnowledgeCards,
  summarizeSkillReadiness,
  validateKnowledgeCardDraft,
  validateScenarioDraft,
  validateSkillDraft
} from "./page";

function createDocument(id: string, status: SkillDocumentState["status"]): SkillDocumentState {
  return {
    id,
    skillId: "skill-1",
    displayName: "Tax Guide",
    description: null,
    originalFilename: "tax-guide.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status,
    currentVersion: 1,
    chunkCount: status === "ready" ? 3 : 0,
    processorProviderKey: status === "ready" ? "local" : null,
    processorMode: "auto",
    processingQuality: null,
    lastIndexedAt: status === "ready" ? "2026-05-01T12:00:00.000Z" : null,
    lastReindexRequestedAt: null,
    lastErrorCode: status === "failed" ? "indexing_failed" : null,
    lastErrorMessage: status === "failed" ? "Failed" : null,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z"
  };
}

function createKnowledgeCard(
  id: string,
  lifecycleStatus: SkillKnowledgeCardState["lifecycleStatus"]
): SkillKnowledgeCardState {
  return {
    id,
    skillId: "skill-1",
    title: "Tax checklist",
    body: "Ask for jurisdiction, tax year, and business structure before giving guidance.",
    locale: "en",
    tags: ["tax"],
    lifecycleStatus,
    provenanceKind: "manual",
    provenanceMetadata: null,
    archivedAt: null,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    status: lifecycleStatus === "active" ? "ready" : "processing",
    currentVersion: 1,
    chunkCount: lifecycleStatus === "active" ? 1 : 0,
    processorProviderKey: null,
    processorMode: null,
    processingQuality: null,
    lastIndexedAt: lifecycleStatus === "active" ? "2026-05-01T12:00:00.000Z" : null,
    lastReindexRequestedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null
  };
}

function createSkill(): AdminSkillState {
  return {
    id: "skill-1",
    status: "active",
    name: { en: "Accountant", ru: "Бухгалтер" },
    description: { en: "Accounting support" },
    category: "work",
    tags: ["tax", "books"],
    instructionCard: {
      title: "Accounting mode",
      body: "Use accounting knowledge carefully and cite uploaded documents when relevant.",
      guardrails: ["No legal guarantees"],
      examples: ["Explain tax categories"]
    },
    iconEmoji: "A",
    color: "blue",
    displayOrder: 10,
    archivedAt: null,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    documents: [createDocument("doc-1", "ready")],
    knowledgeCards: [createKnowledgeCard("card-1", "active")]
  };
}

describe("admin skills page helpers", () => {
  it("uses a fixed locale option list for Skill knowledge cards", () => {
    expect(KNOWLEDGE_LOCALE_OPTIONS.map((option) => option.value)).toEqual([
      "",
      "en",
      "en-US",
      "ru",
      "ru-RU"
    ]);
  });

  it("round-trips a persisted Skill into an upsert payload", () => {
    const draft = skillToDraft(createSkill());
    expect(draft.nameEn).toBe("Accountant");
    expect(draft.nameRu).toBe("Бухгалтер");
    expect(draft.displayOrder).toBe("10");

    expect(draftToSkillPayload(draft)).toMatchObject({
      name: { en: "Accountant", ru: "Бухгалтер" },
      description: { en: "Accounting support" },
      category: "work",
      tags: ["tax", "books"],
      instructionCard: {
        title: "Accounting mode",
        guardrails: ["No legal guarantees"],
        examples: ["Explain tax categories"]
      },
      displayOrder: 10,
      status: "active"
    });
  });

  it("rejects incomplete or overlong instruction cards before save", () => {
    const draft = skillToDraft(null);
    expect(validateSkillDraft(draft)).toMatchObject({
      name: expect.stringContaining("name"),
      description: expect.stringContaining("description")
    });
    expect(draft.category).toBe("work");

    const tooLong = {
      ...draft,
      nameEn: "Lawyer",
      descriptionEn: "Legal support",
      category: "legal",
      instructionBody: "x".repeat(1201)
    };
    expect(validateSkillDraft(tooLong).instructionBody).toContain("1200");
    expect(() => draftToSkillPayload(tooLong)).toThrow(/1200/);
  });

  it("summarizes document readiness with needs-review and instruction-only states", () => {
    expect(summarizeSkillReadiness([])).toMatchObject({
      label: "instruction-only",
      tone: "muted"
    });
    expect(
      summarizeSkillReadiness([
        createDocument("doc-ready", "ready"),
        createDocument("doc-review", "needs_review")
      ])
    ).toMatchObject({
      label: "1 needs review",
      tone: "warning"
    });
    expect(
      summarizeSkillReadiness([
        createDocument("doc-ready", "ready"),
        createDocument("doc-failed", "failed")
      ])
    ).toMatchObject({
      label: "1 failed",
      tone: "failed"
    });
  });

  it("keeps Skill knowledge cards draft-first until explicitly activated", () => {
    const draft = knowledgeCardToDraft(null);
    expect(draft.lifecycleStatus).toBe("draft");
    expect(validateKnowledgeCardDraft(draft)).toMatchObject({
      title: expect.stringContaining("Title"),
      body: expect.stringContaining("20")
    });

    const payload = knowledgeCardDraftToPayload({
      ...draft,
      title: "Bring-up checklist",
      body: "Inspect rails, current limits, thermal behavior, and logs before deeper debugging.",
      locale: "en",
      tagsText: "pcb, checklist",
      lifecycleStatus: "active"
    });

    expect(payload).toMatchObject({
      title: "Bring-up checklist",
      tags: ["pcb", "checklist"],
      locale: "en",
      lifecycleStatus: "active",
      provenanceKind: "manual",
      provenanceMetadata: null
    });
  });

  it("summarizes Skill knowledge card lifecycle counts", () => {
    expect(
      summarizeKnowledgeCards([
        createKnowledgeCard("active", "active"),
        createKnowledgeCard("draft", "draft"),
        createKnowledgeCard("stale", "stale")
      ])
    ).toEqual({ total: 3, active: 1, draft: 1, stale: 1 });
  });

  it("keeps only unsaved assistant-proposed knowledge cards", () => {
    const existing = createKnowledgeCard("existing", "draft");
    const duplicateProposal: SkillAuthoringDraftKnowledgeCardProposal = {
      title: existing.title,
      body: existing.body,
      locale: existing.locale,
      tags: existing.tags,
      lifecycleStatus: "draft",
      provenanceKind: "assistant_generated"
    };
    const newProposal: SkillAuthoringDraftKnowledgeCardProposal = {
      title: "Weekly plan draft",
      body: "Use this draft for weekly meal planning after confirming goals and constraints.",
      locale: "en",
      tags: ["planning"],
      lifecycleStatus: "draft",
      provenanceKind: "assistant_generated"
    };

    expect(
      filterUnsavedProposedKnowledgeCards([duplicateProposal, newProposal, newProposal], [existing])
    ).toEqual([newProposal]);
  });
});

// ---------------------------------------------------------------------------
// Scenario helper tests (ADR-118 Slice 5)
// ---------------------------------------------------------------------------

function createScenario(
  key = "instagram_carousel",
  status: AdminSkillScenario["status"] = "active"
): AdminSkillScenario {
  return {
    id: `scenario-${key}`,
    skillId: "skill-1",
    key,
    displayName: { ru: "Карусель Instagram", en: "Instagram Carousel" },
    description: {
      ru: "8 слайдов через image_generate",
      en: "8-slide carousel via image_generate"
    },
    iconEmoji: "🎨",
    intentExamples: ["сделай карусель", "carousel for instagram"],
    steps: [
      {
        number: 1,
        directive: "CALL image_generate with outputMode=series, count=8",
        recommendedToolCall: "image_generate",
        mayBeSkippedIf: null,
        negativeGuards: ["combine slides into one image"]
      },
      {
        number: 2,
        directive: "Confirm all slides with user and call skill({ release })",
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: []
      }
    ],
    recommendedTools: ["image_generate"],
    exitCondition: "After user confirms all slides call skill({ release }).",
    status,
    displayOrder: 10,
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z"
  };
}

describe("admin skills — scenario helper functions", () => {
  // Test 1: Scenarios list renders correctly for a Skill with active scenarios
  it("round-trips an active scenario into a draft with all fields preserved", () => {
    const scenario = createScenario("instagram_carousel", "active");
    const draft = scenarioToDraft(scenario);

    expect(draft.key).toBe("instagram_carousel");
    expect(draft.displayNameRu).toBe("Карусель Instagram");
    expect(draft.displayNameEn).toBe("Instagram Carousel");
    expect(draft.descriptionRu).toBe("8 слайдов через image_generate");
    expect(draft.status).toBe("active");
    expect(draft.steps).toHaveLength(2);
    const step0 = draft.steps[0];
    const step1 = draft.steps[1];
    expect(step0).toBeDefined();
    expect(step1).toBeDefined();
    expect(step0?.directive).toBe("CALL image_generate with outputMode=series, count=8");
    expect(step0?.recommendedToolCall).toBe("image_generate");
    expect(step0?.negativeGuards).toEqual(["combine slides into one image"]);
    expect(draft.intentExamples).toHaveLength(2);
    expect(draft.recommendedTools).toEqual(["image_generate"]);
  });

  // Test 2: Create scenario form: fill + submit → creates correct payload
  it("creates a complete AdminCreateSkillScenarioRequest from a valid draft", () => {
    const draft = scenarioToDraft(createScenario("instagram_carousel", "draft"));
    const payload = scenarioDraftToCreatePayload(draft);

    expect(payload.key).toBe("instagram_carousel");
    expect(payload.displayName).toMatchObject({
      ru: "Карусель Instagram",
      en: "Instagram Carousel"
    });
    expect(payload.description).toMatchObject({
      ru: "8 слайдов через image_generate",
      en: "8-slide carousel via image_generate"
    });
    expect(payload.steps).toHaveLength(2);
    expect(payload.steps[0]?.number).toBe(1);
    expect(payload.steps[1]?.number).toBe(2);
    expect(payload.steps[0]?.recommendedToolCall).toBe("image_generate");
    expect(payload.steps[0]?.negativeGuards).toEqual(["combine slides into one image"]);
    expect(payload.recommendedTools).toEqual(["image_generate"]);
    expect(payload.exitCondition).toBe("After user confirms all slides call skill({ release }).");
  });

  // Test 3: Validation — bad key regex blocks submit
  it("blocks submit and shows error when key fails regex", () => {
    const draft = { ...scenarioToDraft(null), key: "BadKey With Spaces!" };
    const { errors } = validateScenarioDraft(draft);
    expect(errors.key).toContain("строчные");
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(() => scenarioDraftToCreatePayload(draft)).toThrow();
  });

  // Test 4: Validation — empty steps blocks submit
  it("blocks submit when there are no steps", () => {
    const draft = {
      ...scenarioToDraft(createScenario()),
      steps: []
    };
    const { errors } = validateScenarioDraft(draft);
    expect(errors.steps).toBeTruthy();
    expect(() => scenarioDraftToCreatePayload(draft)).toThrow();
  });

  // Test 5: Edit existing scenario — key field must NOT appear in update payload
  it("scenarioDraftToUpdatePayload omits the key field (immutable after create)", () => {
    const draft = scenarioToDraft(createScenario("instagram_carousel", "active"));
    const payload = scenarioDraftToUpdatePayload(draft);

    expect("key" in payload).toBe(false);
    expect(payload.displayName).toMatchObject({ ru: "Карусель Instagram" });
    expect(payload.steps).toBeDefined();
    expect(payload.steps?.length).toBe(2);
  });

  // Test 6: Archive action — status: "archived" goes into update payload
  it("produces status=archived in the update payload for the archive action", () => {
    const draft = {
      ...scenarioToDraft(createScenario("instagram_carousel", "active")),
      status: "archived" as const
    };
    const payload = scenarioDraftToUpdatePayload(draft);
    expect(payload.status).toBe("archived");
  });

  // Live-preview test: typing in directive updates Pane B output
  it("renderActiveScenarioBlockPreview reflects directive text changes", () => {
    const base = scenarioToDraft(createScenario());
    const preview1 = renderActiveScenarioBlockPreview(base, "Маркетолог");
    expect(preview1).toContain("CALL image_generate with outputMode=series, count=8");
    expect(preview1).toContain("## Active Scenario: Instagram Carousel (Skill: Маркетолог)");
    expect(preview1).toContain("Recommended tool: image_generate");
    expect(preview1).toContain("Guards: Do NOT combine slides into one image.");
    expect(preview1).toContain(
      "Exit condition: After user confirms all slides call skill({ release })."
    );

    const firstStep = base.steps[0];
    expect(firstStep).toBeDefined();
    const modified = {
      ...base,
      steps: [{ ...firstStep!, directive: "НОВАЯ директива" }, ...base.steps.slice(1)]
    };
    const preview2 = renderActiveScenarioBlockPreview(modified, "Маркетолог");
    expect(preview2).toContain("НОВАЯ директива");
    expect(preview2).not.toContain("CALL image_generate with outputMode=series, count=8");
  });

  // Catalog preview test: renderScenarioCatalogLine format matches materialization
  it("renderScenarioCatalogLine matches materialization format exactly", () => {
    const draft = scenarioToDraft(createScenario());
    const line = renderScenarioCatalogLine(draft, "ru");
    expect(line).toBe(
      "- instagram_carousel: Карусель Instagram — 8 слайдов через image_generate (recommended: image_generate)"
    );
    const lineEn = renderScenarioCatalogLine(draft, "en");
    expect(lineEn).toBe(
      "- instagram_carousel: Instagram Carousel — 8-slide carousel via image_generate (recommended: image_generate)"
    );
  });

  // Soft warning test: last step without skill({ shows yellow warning
  it("shows soft warning when last step directive does not contain skill({ or release", () => {
    const draft = {
      ...scenarioToDraft(createScenario()),
      steps: [
        {
          directive: "Do something without releasing",
          recommendedToolCall: "" as string,
          mayBeSkippedIf: "" as string,
          negativeGuards: [] as string[]
        }
      ]
    };
    const { warnings, errors } = validateScenarioDraft(draft);
    expect(errors.steps).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("skill({ release })");
  });

  it("NATIVE_SCENARIO_TOOL_KEYS contains expected tool codes", () => {
    expect(NATIVE_SCENARIO_TOOL_KEYS).toContain("image_generate");
    expect(NATIVE_SCENARIO_TOOL_KEYS).toContain("skill");
    expect(NATIVE_SCENARIO_TOOL_KEYS).toContain("files");
  });
});
