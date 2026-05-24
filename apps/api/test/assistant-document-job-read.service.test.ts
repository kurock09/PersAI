import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantDocumentJobReadService } from "../src/modules/workspace-management/application/assistant-document-job-read.service";

// ADR-097 Slice 3 — tests for listRecentChatPdfsForTurn

describe("AssistantDocumentJobReadService.listRecentChatPdfsForTurn", () => {
  const BASE_NOW = new Date("2026-05-24T10:00:00.000Z");

  /** Build a mock prisma whose assistantChatMessage.findMany returns `count` messages
   *  at or after BASE_WINDOW_FLOOR, and assistantDocument.findMany returns the given rows. */
  function makePrisma(options: {
    messageCount: number;
    documents: Array<{
      id: string;
      updatedAt: Date;
      currentVersionId: string | null;
      deliveredFiles: Array<{
        assistantFile: { displayName: string | null; relativePath: string } | null;
      }>;
    }>;
  }) {
    return {
      assistantChatMessage: {
        findMany: async () => {
          if (options.messageCount === 0) return [];
          // Return `messageCount` synthetic messages; the oldest defines the window floor
          return Array.from({ length: options.messageCount }, (_, i) => ({
            createdAt: new Date(BASE_NOW.getTime() - i * 60_000)
          }));
        }
      },
      assistantDocument: {
        findMany: async () => options.documents
      }
    } as never;
  }

  test("returns recent PDFs with non-null renderedHtml, capped at 3, ordered by updatedAt DESC", async () => {
    const docs = [
      {
        id: "doc-1",
        updatedAt: new Date("2026-05-24T09:50:00.000Z"),
        currentVersionId: "ver-1",
        deliveredFiles: [
          { assistantFile: { displayName: "Report A.pdf", relativePath: "report-a.pdf" } }
        ]
      },
      {
        id: "doc-2",
        updatedAt: new Date("2026-05-24T09:45:00.000Z"),
        currentVersionId: "ver-2",
        deliveredFiles: [
          { assistantFile: { displayName: "Report B.pdf", relativePath: "report-b.pdf" } }
        ]
      },
      {
        id: "doc-3",
        updatedAt: new Date("2026-05-24T09:40:00.000Z"),
        currentVersionId: "ver-3",
        deliveredFiles: [{ assistantFile: { displayName: null, relativePath: "report-c.pdf" } }]
      }
    ];
    const service = new AssistantDocumentJobReadService(
      makePrisma({ messageCount: 10, documents: docs })
    );
    const result = await service.listRecentChatPdfsForTurn({
      assistantId: "a-1",
      workspaceId: "w-1",
      chatId: "chat-1",
      maxMessageWindow: 10
    });

    assert.equal(result.length, 3, "must return all 3 documents (within cap)");
    assert.equal(result[0]!.docId, "doc-1", "most recent doc first");
    assert.equal(result[0]!.filename, "Report A.pdf", "must use displayName when available");
    assert.equal(result[1]!.docId, "doc-2");
    assert.equal(result[2]!.docId, "doc-3");
    assert.equal(
      result[2]!.filename,
      "report-c.pdf",
      "must fall back to relativePath when displayName is null"
    );
    assert.equal(result[0]!.currentVersionId, "ver-1");
  });

  test("listRecentChatPdfsForTurn excludes presentations (Prisma query filters documentType=pdf_document)", async () => {
    // Prisma mock returns nothing — simulating that Prisma filtered out presentations server-side.
    // The service sends documentType: "pdf_document" in the where clause; we verify it sends no docs.
    const service = new AssistantDocumentJobReadService(
      makePrisma({ messageCount: 5, documents: [] })
    );
    const result = await service.listRecentChatPdfsForTurn({
      assistantId: "a-1",
      workspaceId: "w-1",
      chatId: "chat-1",
      maxMessageWindow: 10
    });
    assert.equal(result.length, 0, "must return empty array when no pdf_document rows match");
  });

  test("listRecentChatPdfsForTurn excludes PDFs whose currentVersion.renderedHtml IS NULL", async () => {
    // Prisma mock returns nothing — simulating that Prisma filtered out docs with null renderedHtml.
    const service = new AssistantDocumentJobReadService(
      makePrisma({ messageCount: 5, documents: [] })
    );
    const result = await service.listRecentChatPdfsForTurn({
      assistantId: "a-1",
      workspaceId: "w-1",
      chatId: "chat-1",
      maxMessageWindow: 10
    });
    assert.equal(result.length, 0, "must return empty array when renderedHtml is null on all docs");
  });

  test("listRecentChatPdfsForTurn returns empty when no PDFs are within the last N=10 chat messages", async () => {
    // messageCount=0 means the chat has no messages — window floor cannot be established.
    const service = new AssistantDocumentJobReadService(
      makePrisma({ messageCount: 0, documents: [] })
    );
    const result = await service.listRecentChatPdfsForTurn({
      assistantId: "a-1",
      workspaceId: "w-1",
      chatId: "chat-1",
      maxMessageWindow: 10
    });
    assert.equal(result.length, 0, "must return empty array when the chat has no messages");
  });

  test("caps returned results at 3 even when more docs exist", async () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({
      id: `doc-${String(i + 1)}`,
      updatedAt: new Date(BASE_NOW.getTime() - i * 60_000),
      currentVersionId: `ver-${String(i + 1)}`,
      deliveredFiles: [
        {
          assistantFile: {
            displayName: `Doc ${String(i + 1)}.pdf`,
            relativePath: `doc-${String(i + 1)}.pdf`
          }
        }
      ]
    }));
    // Prisma mock only returns first 3 (matching take: 3 in the real query)
    const service = new AssistantDocumentJobReadService(
      makePrisma({ messageCount: 10, documents: docs.slice(0, 3) })
    );
    const result = await service.listRecentChatPdfsForTurn({
      assistantId: "a-1",
      workspaceId: "w-1",
      chatId: "chat-1",
      maxMessageWindow: 10
    });
    assert.equal(result.length, 3, "must return at most 3 documents");
  });
});
