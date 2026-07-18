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
import { toWebNotifyState, type AssistantWebChatActiveDocumentJobState } from "./web-chat.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const RECENT_RUNTIME_JOB_DELIVERY_WINDOW_MS = 10 * 60 * 1000;

function toWebOpenDocumentJobStatus(
  status: AssistantDocumentRenderJobStatus
): AssistantWebChatActiveDocumentJobState["status"] | null {
  switch (status) {
    case "queued":
    case "running":
    case "provider_processing":
    case "fetching_output":
    case "ready_for_delivery":
      return status;
    default:
      return null;
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
  value: unknown
): AssistantWebChatActiveDocumentJobState["descriptorMode"] {
  const mode = value as AssistantDocumentDescriptorMode | undefined;
  if (
    mode === "create_presentation" ||
    mode === "revise_document" ||
    mode === "export_or_redeliver"
  ) {
    return mode;
  }
  return "create_presentation";
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
    const continuationCutoff = new Date(Date.now() - 5 * 60_000);
    const openSelect = {
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
    } as const;
    const [openRows, continuationHandles] = await Promise.all([
      this.prisma.assistantDocumentRenderJob.findMany({
        where: {
          assistantId: input.assistantId,
          userId: input.userId,
          chatId: input.chatId,
          status: {
            in: [
              "queued",
              "running",
              "provider_processing",
              "fetching_output",
              "ready_for_delivery"
            ]
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: openSelect
      }),
      this.prisma.assistantAsyncJobHandle.findMany({
        where: {
          assistantId: input.assistantId,
          chatId: input.chatId,
          kind: "document",
          OR: [
            { state: { in: ["subscribed", "ready", "claimed", "dispatched"] } },
            {
              state: { in: ["failed", "cancelled"] },
              updatedAt: { gte: continuationCutoff }
            }
          ]
        },
        select: { canonicalJobId: true, state: true }
      })
    ]);
    const openIds = new Set(openRows.map((row) => row.id));
    const missingIds = continuationHandles
      .map((handle) => handle.canonicalJobId)
      .filter((id) => !openIds.has(id));
    const continuationRows =
      missingIds.length === 0
        ? []
        : await this.prisma.assistantDocumentRenderJob.findMany({
            where: {
              id: { in: missingIds },
              assistantId: input.assistantId,
              userId: input.userId,
              chatId: input.chatId
            },
            select: openSelect
          });
    const rows = [...openRows, ...continuationRows].sort((a, b) => {
      const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
      return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
    });
    const handles = await this.prisma.assistantAsyncJobHandle.findMany({
      where: {
        kind: "document",
        canonicalJobId: { in: rows.map((row) => row.id) }
      },
      select: { canonicalJobId: true, state: true }
    });
    const notifyStateByJobId = new Map(
      handles.map((handle) => [handle.canonicalJobId, handle.state] as const)
    );

    return rows
      .filter((row) => row.document.documentType === "presentation")
      .map((row) => {
        const handleState = notifyStateByJobId.get(row.id);
        return {
          id: row.id,
          documentType: "presentation" as const,
          descriptorMode: normalizeDescriptorMode(row.version?.descriptorMode),
          status: toWebOpenDocumentJobStatus(row.status) ?? "ready_for_delivery",
          createdAt: row.createdAt.toISOString(),
          startedAt: row.startedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
          notifyState: toWebNotifyState(handleState)
        };
      });
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

    return rows
      .filter((row) => row.document.documentType === "presentation")
      .map((row) => ({
        jobId: row.id,
        descriptorMode: normalizeDescriptorMode(row.version?.descriptorMode),
        documentType: "presentation",
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
      ...finalizingRows
        .filter((row) => row.document.documentType === "presentation")
        .map((row) => this.toRuntimeJobDeliveryUpdate(row, "finalizing_delivery")),
      ...recentDeliveredRows
        .filter((row) => row.document.documentType === "presentation")
        .map((row) => this.toRuntimeJobDeliveryUpdate(row, "delivered_recently"))
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
      descriptorMode: normalizeDescriptorMode(row.version?.descriptorMode),
      documentType: "presentation",
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
