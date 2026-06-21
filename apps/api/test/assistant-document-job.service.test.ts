import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  AssistantDocumentJobService,
  type AssistantDocumentRevisionContext
} from "../src/modules/workspace-management/application/assistant-document-job.service";

type VersionCreateData = {
  docId: string;
  assistantId: string;
  workspaceId: string;
  versionNumber: number;
  parentVersionId: string;
  descriptorMode: "revise_document";
  sourceJson: unknown;
  sourceSummaryText: string;
  sourceOutlineJson: unknown;
  status: "render_requested";
};

class FakePrisma {
  public latestVersionNumber = 3;
  public transactionCalls = 0;
  public createdVersionNumbers: number[] = [];
  public renderJobCreates = 0;
  public revisionLogCreates = 0;
  public failNextVersionCreateWithUniqueConflict = false;

  public assistantDocumentVersion = {
    findFirst: async () => ({ versionNumber: this.latestVersionNumber }),
    create: async ({ data }: { data: VersionCreateData; select: unknown }) => {
      this.createdVersionNumbers.push(data.versionNumber);
      if (this.failNextVersionCreateWithUniqueConflict) {
        this.failNextVersionCreateWithUniqueConflict = false;
        this.latestVersionNumber = data.versionNumber;
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["doc_id", "version_number"] }
        });
      }
      this.latestVersionNumber = data.versionNumber;
      return { id: `version-${data.versionNumber}` };
    }
  };

  public assistantDocument = {
    update: async () => ({ id: "doc-1" })
  };

  public assistantDocumentRenderJob = {
    create: async () => {
      this.renderJobCreates += 1;
      return { id: `render-${this.renderJobCreates}` };
    }
  };

  public assistantDocumentRevisionLog = {
    create: async () => {
      this.revisionLogCreates += 1;
      return { id: `log-${this.revisionLogCreates}` };
    }
  };

  async $transaction<T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(this);
  }
}

function buildRevisionContext(currentVersionNumber = 3): AssistantDocumentRevisionContext {
  return {
    docId: "doc-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    documentType: "pdf_document",
    currentVersionId: "version-current",
    currentVersionNumber,
    currentVersionRenderedHtml: "<html><body><h1>Current</h1></body></html>",
    currentVersionStructureJson: null,
    currentVersionStyleProfileJson: null,
    currentVersionEditStrategy: null,
    currentSourceJson: {
      prompt: "Original report",
      outputFormat: "pdf",
      requestedName: "report"
    }
  };
}

async function runEnqueueRevisionUsesLatestPersistedVersionNumber(): Promise<void> {
  const prisma = new FakePrisma();
  prisma.latestVersionNumber = 6;
  const service = new AssistantDocumentJobService(prisma as never);

  const result = await service.enqueueRevision({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-2",
    surface: "web",
    sourceUserMessageId: "message-1",
    revisionContext: buildRevisionContext(3),
    provider: "sandbox",
    outputFormat: "pdf",
    request: {
      sourceUserMessageText: "Add an appendix",
      sourceUserMessageCreatedAt: "2026-05-24T21:00:00.000Z",
      descriptorMode: "revise_document",
      sourceJson: {
        prompt: "Add an appendix",
        outputFormat: "pdf"
      }
    },
    previousVersionRenderedHtml: "<html><body><h1>Current</h1></body></html>"
  });

  assert.equal(result.docId, "doc-1");
  assert.equal(result.versionId, "version-7");
  assert.deepEqual(
    prisma.createdVersionNumbers,
    [7],
    "enqueueRevision must allocate from the latest persisted version number, not stale currentVersionNumber"
  );
}

async function runEnqueueRevisionRetriesUniqueVersionConflict(): Promise<void> {
  const prisma = new FakePrisma();
  prisma.latestVersionNumber = 3;
  prisma.failNextVersionCreateWithUniqueConflict = true;
  const service = new AssistantDocumentJobService(prisma as never);

  const result = await service.enqueueRevision({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-2",
    surface: "web",
    sourceUserMessageId: "message-2",
    revisionContext: buildRevisionContext(3),
    provider: "sandbox",
    outputFormat: "pdf",
    request: {
      sourceUserMessageText: "Tighten the summary",
      sourceUserMessageCreatedAt: "2026-05-24T21:05:00.000Z",
      descriptorMode: "revise_document",
      sourceJson: {
        prompt: "Tighten the summary",
        outputFormat: "pdf"
      }
    },
    previousVersionRenderedHtml: "<html><body><h1>Current</h1></body></html>"
  });

  assert.equal(result.versionId, "version-5");
  assert.equal(
    prisma.transactionCalls,
    2,
    "unique version conflicts must retry in a fresh transaction"
  );
  assert.deepEqual(
    prisma.createdVersionNumbers,
    [4, 5],
    "retry must re-read DB truth and advance past the conflicting version number"
  );
  assert.equal(
    prisma.renderJobCreates,
    1,
    "only the successful retry should enqueue the render job"
  );
  assert.equal(
    prisma.revisionLogCreates,
    1,
    "only the successful retry should write the revision log"
  );
}

async function run(): Promise<void> {
  await runEnqueueRevisionUsesLatestPersistedVersionNumber();
  await runEnqueueRevisionRetriesUniqueVersionConflict();
}

void run();
