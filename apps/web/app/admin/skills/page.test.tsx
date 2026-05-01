import { describe, expect, it } from "vitest";
import type { AdminSkillState, SkillDocumentState } from "@/app/app/assistant-api-client";
import {
  draftToSkillPayload,
  skillToDraft,
  summarizeSkillReadiness,
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
    documents: [createDocument("doc-1", "ready")]
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
});
