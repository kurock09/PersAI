import { Injectable } from "@nestjs/common";
import type {
  AssistantDocumentDescriptorMode,
  AssistantDocumentRenderJobStatus,
  AssistantDocumentType
} from "@prisma/client";
import type { AssistantWebChatActiveDocumentJobState } from "./web-chat.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

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

function normalizeDescriptorMode(
  value: unknown,
  documentType: AssistantDocumentType
): AssistantWebChatActiveDocumentJobState["descriptorMode"] {
  const mode = value as AssistantDocumentDescriptorMode | undefined;
  if (
    mode === "create_pdf_document" ||
    mode === "create_presentation" ||
    mode === "revise_document" ||
    mode === "export_or_redeliver"
  ) {
    return mode;
  }
  return documentType === "presentation" ? "create_presentation" : "create_pdf_document";
}

@Injectable()
export class AssistantDocumentJobReadService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  /**
   * ADR-097 Slice 3 — server-resolved recent-PDF context for the developer-block hint.
   *
   * Returns up to 3 PDF documents in the chat whose current version has a non-null
   * renderedHtml (patch-reviseable) AND whose updatedAt is at or after the createdAt of
   * the N-th most recent chat message. Ordered by updatedAt DESC.
   *
   * Only `pdf_document` documentType — presentations are excluded.
   * Documents without renderedHtml are excluded because a hint about a non-reviseable
   * document would mislead the model.
   *
   * Uses `updatedAt >= windowFloor` as a proxy for "delivered within the last N messages"
   * because a document's `updatedAt` is bumped on currentVersionId promotion after delivery.
   */
  async listRecentChatPdfsForTurn(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
    maxMessageWindow: number;
  }): Promise<
    Array<{ docId: string; filename: string | null; currentVersionId: string; updatedAt: Date }>
  > {
    const MAX_RESULTS = 3;

    const windowMessages = await this.prisma.assistantChatMessage.findMany({
      where: { chatId: input.chatId },
      orderBy: { createdAt: "desc" },
      take: input.maxMessageWindow,
      select: { createdAt: true }
    });

    if (windowMessages.length === 0) {
      return [];
    }

    const windowFloor = windowMessages[windowMessages.length - 1]!.createdAt;

    const documents = await this.prisma.assistantDocument.findMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        documentType: "pdf_document",
        currentVersionId: { not: null },
        updatedAt: { gte: windowFloor },
        currentVersion: { renderedHtml: { not: null } }
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_RESULTS,
      select: {
        id: true,
        updatedAt: true,
        currentVersionId: true,
        deliveredFiles: {
          where: { isCurrentOutput: true },
          orderBy: { deliveredAt: "desc" },
          take: 1,
          select: {
            assistantFile: {
              select: { displayName: true, relativePath: true }
            }
          }
        }
      }
    });

    return documents.map((doc) => {
      const df = doc.deliveredFiles[0];
      const filename = df?.assistantFile?.displayName ?? df?.assistantFile?.relativePath ?? null;
      return {
        docId: doc.id,
        filename,
        currentVersionId: doc.currentVersionId!,
        updatedAt: doc.updatedAt
      };
    });
  }

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
            descriptorMode: true
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
}
