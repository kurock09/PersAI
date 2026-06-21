import { Injectable } from "@nestjs/common";
import type {
  AssistantDocumentDescriptorMode,
  AssistantDocumentRenderJobStatus,
  AssistantDocumentType
} from "@prisma/client";
import type {
  RuntimeJobDeliveryUpdate,
  RuntimeOpenDocumentJobContext
} from "@persai/runtime-contract";
import type { AssistantWebChatActiveDocumentJobState } from "./web-chat.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const RECENT_RUNTIME_JOB_DELIVERY_WINDOW_MS = 10 * 60 * 1000;

function toWebOpenDocumentJobStatus(
  status: AssistantDocumentRenderJobStatus
): AssistantWebChatActiveDocumentJobState["status"] {
  switch (status) {
    case "queued":
    case "running":
    case "provider_processing":
    case "fetching_output":
    case "ready_for_delivery":
      return status;
    default:
      throw new Error(`Unexpected closed document job status in open-job query: ${status}`);
  }
}

function toRuntimeOpenDocumentJobStatus(
  status: AssistantDocumentRenderJobStatus
): RuntimeOpenDocumentJobContext["status"] {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
    case "provider_processing":
      return "running";
    default:
      throw new Error(`Unexpected closed document job status in runtime context query: ${status}`);
  }
}

function normalizeDescriptorMode(
  value: unknown,
  documentType: AssistantDocumentType
): AssistantWebChatActiveDocumentJobState["descriptorMode"] {
  const mode = value as AssistantDocumentDescriptorMode | undefined;
  if (
    mode === "create_pdf_document" ||
    mode === "create_presentation" ||
    mode === "revise_document" ||
    mode === "export_or_redeliver" ||
    mode === "create_data_document"
  ) {
    return mode;
  }
  if (documentType === "presentation") {
    return "create_presentation";
  }
  if (documentType === "data_document") {
    return "create_data_document";
  }
  return "create_pdf_document";
}

function normalizeSourceSummary(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

@Injectable()
export class AssistantDocumentJobReadService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async listOpenJobsForWebChat(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<AssistantWebChatActiveDocumentJobState[]> {
    const rows = await this.prisma.assistantDocumentRenderJob.findMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running", "provider_processing", "fetching_output", "ready_for_delivery"]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        createdAt: true,
        startedAt: true,
        updatedAt: true,
        version: {
          select: {
            descriptorMode: true,
            sourceSummaryText: true
          }
        },
        document: {
          select: {
            documentType: true
          }
        }
      }
    });

    return rows.map((row) => ({
      id: row.id,
      documentType: row.document.documentType,
      descriptorMode: normalizeDescriptorMode(
        row.version?.descriptorMode,
        row.document.documentType
      ),
      status: toWebOpenDocumentJobStatus(row.status),
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async listOpenJobsForRuntimeContext(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<RuntimeOpenDocumentJobContext[]> {
    const rows = await this.prisma.assistantDocumentRenderJob.findMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running", "provider_processing"]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        createdAt: true,
        startedAt: true,
        updatedAt: true,
        version: {
          select: {
            descriptorMode: true,
            sourceSummaryText: true
          }
        },
        document: {
          select: {
            documentType: true
          }
        }
      }
    });

    return rows.map((row) => ({
      jobId: row.id,
      descriptorMode: normalizeDescriptorMode(
        row.version?.descriptorMode,
        row.document.documentType
      ),
      documentType: row.document.documentType,
      status: toRuntimeOpenDocumentJobStatus(row.status),
      sourceSummary: normalizeSourceSummary(row.version?.sourceSummaryText),
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async listJobDeliveryUpdatesForRuntimeContext(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<RuntimeJobDeliveryUpdate[]> {
    const recentDeliveredCutoff = new Date(Date.now() - RECENT_RUNTIME_JOB_DELIVERY_WINDOW_MS);
    const [finalizingRows, recentDeliveredRows] = await Promise.all([
      this.prisma.assistantDocumentRenderJob.findMany({
        where: {
          assistantId: input.assistantId,
          userId: input.userId,
          chatId: input.chatId,
          status: {
            in: ["fetching_output", "ready_for_delivery"]
          }
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
          deliveredAt: true,
          version: {
            select: {
              descriptorMode: true,
              sourceSummaryText: true
            }
          },
          document: {
            select: {
              documentType: true
            }
          }
        }
      }),
      this.prisma.assistantDocumentRenderJob.findMany({
        where: {
          assistantId: input.assistantId,
          userId: input.userId,
          chatId: input.chatId,
          status: "delivered",
          deliveredAt: {
            gte: recentDeliveredCutoff
          }
        },
        orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
          deliveredAt: true,
          version: {
            select: {
              descriptorMode: true,
              sourceSummaryText: true
            }
          },
          document: {
            select: {
              documentType: true
            }
          }
        }
      })
    ]);
    return [
      ...finalizingRows.map((row) => this.toRuntimeJobDeliveryUpdate(row, "finalizing_delivery")),
      ...recentDeliveredRows.map((row) =>
        this.toRuntimeJobDeliveryUpdate(row, "delivered_recently")
      )
    ];
  }

  private toRuntimeJobDeliveryUpdate(
    row: {
      id: string;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
      updatedAt: Date;
      deliveredAt: Date | null;
      version: {
        descriptorMode: AssistantDocumentDescriptorMode | null;
        sourceSummaryText: string | null;
      } | null;
      document: {
        documentType: AssistantDocumentType;
      };
    },
    deliveryStatus: RuntimeJobDeliveryUpdate["deliveryStatus"]
  ): RuntimeJobDeliveryUpdate {
    return {
      kind: "document",
      jobId: row.id,
      descriptorMode: normalizeDescriptorMode(
        row.version?.descriptorMode,
        row.document.documentType
      ),
      documentType: row.document.documentType,
      deliveryStatus,
      sourceSummary: normalizeSourceSummary(row.version?.sourceSummaryText),
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null
    };
  }
}
