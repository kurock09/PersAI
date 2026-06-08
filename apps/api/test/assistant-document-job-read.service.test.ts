import assert from "node:assert/strict";
import { AssistantDocumentJobReadService } from "../src/modules/workspace-management/application/assistant-document-job-read.service";

function buildPrismaStub(
  rows: Array<{
    id: string;
    status:
      | "queued"
      | "running"
      | "provider_processing"
      | "fetching_output"
      | "ready_for_delivery"
      | "delivered";
    createdAt: Date;
    startedAt: Date | null;
    completedAt?: Date | null;
    updatedAt: Date;
    deliveredAt?: Date | null;
    version: {
      descriptorMode:
        | "create_pdf_document"
        | "create_presentation"
        | "revise_document"
        | "export_or_redeliver"
        | null;
      sourceSummaryText: string | null;
    } | null;
    document: {
      documentType: "pdf_document" | "presentation";
    };
  }>
): InstanceType<typeof AssistantDocumentJobReadService>["prisma"] {
  return {
    assistantDocumentRenderJob: {
      findMany: async (args?: {
        where?: {
          status?:
            | string
            | {
                in?: string[];
              };
          deliveredAt?: {
            gte?: Date;
          };
        };
      }) => {
        const statusFilter = args?.where?.status;
        const allowedStatuses =
          typeof statusFilter === "string"
            ? new Set([statusFilter])
            : Array.isArray(statusFilter?.in)
              ? new Set(statusFilter.in)
              : null;
        const deliveredAtGte = args?.where?.deliveredAt?.gte ?? null;
        return rows.filter((row) => {
          if (allowedStatuses !== null && !allowedStatuses.has(row.status)) {
            return false;
          }
          if (deliveredAtGte !== null) {
            if (row.deliveredAt === undefined || row.deliveredAt === null) {
              return false;
            }
            if (row.deliveredAt < deliveredAtGte) {
              return false;
            }
          }
          return true;
        });
      }
    }
  } as never;
}

async function run(): Promise<void> {
  const service = new AssistantDocumentJobReadService({} as never);

  {
    const prisma = buildPrismaStub([
      {
        id: "doc-running",
        status: "provider_processing",
        createdAt: new Date("2026-06-09T10:00:00.000Z"),
        startedAt: new Date("2026-06-09T10:00:10.000Z"),
        updatedAt: new Date("2026-06-09T10:01:00.000Z"),
        version: {
          descriptorMode: "create_pdf_document",
          sourceSummaryText: "бриф для pdf"
        },
        document: {
          documentType: "pdf_document"
        }
      }
    ]);
    (service as never)["prisma"] = prisma;

    const results = await service.listOpenJobsForRuntimeContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "running");
    assert.equal(results[0]?.descriptorMode, "create_pdf_document");
  }

  {
    const prisma = buildPrismaStub([
      {
        id: "doc-finalizing",
        status: "ready_for_delivery",
        createdAt: new Date("2026-06-09T10:00:00.000Z"),
        startedAt: new Date("2026-06-09T10:00:10.000Z"),
        completedAt: new Date("2026-06-09T10:01:30.000Z"),
        updatedAt: new Date("2026-06-09T10:01:30.000Z"),
        deliveredAt: null,
        version: {
          descriptorMode: "create_pdf_document",
          sourceSummaryText: "бриф для pdf"
        },
        document: {
          documentType: "pdf_document"
        }
      }
    ]);
    (service as never)["prisma"] = prisma;

    const openResults = await service.listOpenJobsForRuntimeContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });
    const deliveryUpdates = await service.listJobDeliveryUpdatesForRuntimeContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(openResults.length, 0);
    assert.equal(deliveryUpdates.length, 1);
    assert.equal(deliveryUpdates[0]?.kind, "document");
    assert.equal(deliveryUpdates[0]?.deliveryStatus, "finalizing_delivery");
  }

  {
    const prisma = buildPrismaStub([
      {
        id: "doc-delivered",
        status: "delivered",
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date(),
        deliveredAt: new Date(),
        version: {
          descriptorMode: "create_presentation",
          sourceSummaryText: "deck request"
        },
        document: {
          documentType: "presentation"
        }
      }
    ]);
    (service as never)["prisma"] = prisma;

    const deliveryUpdates = await service.listJobDeliveryUpdatesForRuntimeContext({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(deliveryUpdates.length, 1);
    assert.equal(deliveryUpdates[0]?.deliveryStatus, "delivered_recently");
    assert.equal(deliveryUpdates[0]?.kind, "document");
  }

  {
    const prisma = buildPrismaStub([
      {
        id: "doc-web-finalizing",
        status: "ready_for_delivery",
        createdAt: new Date("2026-06-09T10:00:00.000Z"),
        startedAt: new Date("2026-06-09T10:00:10.000Z"),
        completedAt: new Date("2026-06-09T10:01:30.000Z"),
        updatedAt: new Date("2026-06-09T10:01:30.000Z"),
        deliveredAt: null,
        version: {
          descriptorMode: "create_pdf_document",
          sourceSummaryText: "бриф для pdf"
        },
        document: {
          documentType: "pdf_document"
        }
      }
    ]);
    (service as never)["prisma"] = prisma;

    const webResults = await service.listOpenJobsForWebChat({
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1"
    });

    assert.equal(webResults.length, 1);
    assert.equal(webResults[0]?.status, "ready_for_delivery");
  }

  console.log("[assistant-document-job-read.service.test] All assertions passed.");
}

void run();
