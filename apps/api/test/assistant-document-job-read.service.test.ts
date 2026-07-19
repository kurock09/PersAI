import assert from "node:assert/strict";
import { AssistantDocumentJobReadService } from "../src/modules/workspace-management/application/assistant-document-job-read.service";

type StubRow = {
  id: string;
  status:
    | "queued"
    | "running"
    | "provider_processing"
    | "fetching_output"
    | "ready_for_delivery"
    | "failed"
    | "canceled"
    | "delivered";
  createdAt: Date;
  startedAt: Date | null;
  completedAt?: Date | null;
  updatedAt: Date;
  deliveredAt?: Date | null;
  version: {
    descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver" | null;
    sourceSummaryText: string | null;
  } | null;
  document: {
    documentType: "pdf_document" | "presentation" | "data_document";
  };
};

function buildPrismaStub(
  rows: StubRow[]
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
            return (
              row.deliveredAt !== undefined &&
              row.deliveredAt !== null &&
              row.deliveredAt >= deliveredAtGte
            );
          }
          return true;
        });
      }
    },
    assistantAsyncJobHandle: {
      findMany: async () => []
    }
  } as never;
}

async function run(): Promise<void> {
  const service = new AssistantDocumentJobReadService({} as never);

  const now = new Date("2026-06-29T10:00:00.000Z");
  (service as never)["prisma"] = buildPrismaStub([
    {
      id: "presentation-running",
      status: "provider_processing",
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      version: {
        descriptorMode: "create_presentation",
        sourceSummaryText: "deck request"
      },
      document: {
        documentType: "presentation"
      }
    },
    {
      id: "historical-pdf-running",
      status: "provider_processing",
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      version: {
        descriptorMode: null,
        sourceSummaryText: "old pdf request"
      },
      document: {
        documentType: "pdf_document"
      }
    },
    {
      id: "presentation-finalizing",
      status: "ready_for_delivery",
      createdAt: now,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      deliveredAt: null,
      version: {
        descriptorMode: "export_or_redeliver",
        sourceSummaryText: "export deck"
      },
      document: {
        documentType: "presentation"
      }
    },
    {
      id: "presentation-delivered",
      status: "delivered",
      createdAt: now,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      deliveredAt: new Date(),
      version: {
        descriptorMode: "revise_document",
        sourceSummaryText: "revised deck"
      },
      document: {
        documentType: "presentation"
      }
    },
    {
      id: "presentation-failed",
      status: "failed",
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      version: { descriptorMode: "create_presentation", sourceSummaryText: "failed deck" },
      document: { documentType: "presentation" }
    },
    {
      id: "presentation-cancelled",
      status: "canceled",
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      version: { descriptorMode: "create_presentation", sourceSummaryText: "cancelled deck" },
      document: { documentType: "presentation" }
    }
  ]);

  const openRuntimeJobs = await service.listOpenJobsForRuntimeContext({
    assistantId: "assistant-1",
    userId: "user-1",
    chatId: "chat-1"
  });
  assert.equal(openRuntimeJobs.length, 1);
  assert.equal(openRuntimeJobs[0]?.descriptorMode, "create_presentation");
  assert.equal(openRuntimeJobs[0]?.documentType, "presentation");

  const webJobs = await service.listOpenJobsForWebChat({
    assistantId: "assistant-1",
    userId: "user-1",
    chatId: "chat-1"
  });
  assert.equal(webJobs.length, 2);
  assert.equal(
    webJobs.every((job) => job.documentType === "presentation"),
    true
  );
  assert.deepEqual(
    webJobs.map((job) => job.id),
    ["presentation-running", "presentation-finalizing"],
    "web Working projection excludes completed, failed, and cancelled canonical jobs"
  );

  const deliveryUpdates = await service.listJobDeliveryUpdatesForRuntimeContext({
    assistantId: "assistant-1",
    userId: "user-1",
    chatId: "chat-1"
  });
  assert.equal(deliveryUpdates.length, 2);
  assert.equal(
    deliveryUpdates.every((update) => update.kind === "document"),
    true
  );
}

void run();
