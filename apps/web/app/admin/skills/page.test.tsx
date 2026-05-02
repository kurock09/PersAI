import { describe, expect, it } from "vitest";
import type {
  AdminSkillState,
  SkillDocumentState,
  SkillKnowledgeCardState
} from "@/app/app/assistant-api-client";
import {
  draftToSkillPayload,
  knowledgeCardDraftToPayload,
  knowledgeCardToDraft,
  skillToDraft,
  summarizeKnowledgeCards,
  summarizeSkillReadiness,
  validateKnowledgeCardDraft,
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
});
