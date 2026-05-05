import { Injectable } from "@nestjs/common";
import type { AssistantChatSurface, AssistantMediaJobStatus } from "@prisma/client";
import type {
  RuntimeOpenMediaJobContext,
  RuntimeAttachmentRef,
  RuntimeImageEditRequest,
  RuntimeImageGenerateRequest,
  RuntimeVideoGenerateRequest
} from "@persai/runtime-contract";
import type { AssistantWebChatActiveMediaJobState } from "./web-chat.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type AssistantMediaJobRequestPayload = {
  attachments: RuntimeAttachmentRef[];
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  directToolExecution:
    | {
        toolCode: "image_generate";
        request: RuntimeImageGenerateRequest;
      }
    | {
        toolCode: "image_edit";
        request: RuntimeImageEditRequest;
      }
    | {
        toolCode: "video_generate";
        request: RuntimeVideoGenerateRequest;
      };
};

function toRuntimeOpenMediaJobStatus(
  status: AssistantMediaJobStatus
): RuntimeOpenMediaJobContext["status"] {
  switch (status) {
    case "queued":
    case "running":
    case "completion_pending":
      return status;
    default:
      throw new Error(`Unexpected closed media job status in open-job query: ${status}`);
  }
}

function toWebOpenMediaJobStatus(
  status: AssistantMediaJobStatus
): AssistantWebChatActiveMediaJobState["status"] {
  switch (status) {
    case "queued":
    case "running":
    case "completion_pending":
      return status;
    default:
      throw new Error(`Unexpected closed media job status in web open-job query: ${status}`);
  }
}

function toWebOpenMediaJobOperation(input: {
  kind: AssistantWebChatActiveMediaJobState["kind"];
  requestJson: unknown;
}): AssistantWebChatActiveMediaJobState["operation"] {
  const request = input.requestJson as AssistantMediaJobRequestPayload | null;
  const toolCode = request?.directToolExecution?.toolCode;
  if (toolCode === "image_generate" || toolCode === "image_edit" || toolCode === "video_generate") {
    return toolCode;
  }
  switch (input.kind) {
    case "image":
      return "image_generate";
    case "video":
      return "video_generate";
    case "audio":
      return "audio_generate";
    default:
      throw new Error(`Unexpected media job kind in web open-job query: ${String(input.kind)}`);
  }
}

@Injectable()
export class AssistantMediaJobService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async countOpenJobsForChat(input: { assistantId: string; chatId: string }): Promise<number> {
    return this.prisma.assistantMediaJob.count({
      where: {
        assistantId: input.assistantId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running", "completion_pending"]
        }
      }
    });
  }

  async listOpenJobsForChatContext(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<RuntimeOpenMediaJobContext[]> {
    const rows = await this.prisma.assistantMediaJob.findMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running", "completion_pending"]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        startedAt: true,
        updatedAt: true
      }
    });
    return rows.map((row) => ({
      jobId: row.id,
      kind: row.kind,
      status: toRuntimeOpenMediaJobStatus(row.status),
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async listOpenJobsForWebChat(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<AssistantWebChatActiveMediaJobState[]> {
    const rows = await this.prisma.assistantMediaJob.findMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running", "completion_pending"]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        requestJson: true,
        status: true,
        createdAt: true,
        startedAt: true,
        updatedAt: true
      }
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      operation: toWebOpenMediaJobOperation({
        kind: row.kind,
        requestJson: row.requestJson
      }),
      status: toWebOpenMediaJobStatus(row.status),
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async enqueue(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: AssistantChatSurface;
    kind: "image" | "audio" | "video";
    sourceUserMessageId: string;
    sourceClientTurnId?: string | null;
    assistantAcknowledgementMessageId?: string | null;
    request: AssistantMediaJobRequestPayload;
  }): Promise<{ id: string; status: "queued" }> {
    const created = await this.prisma.assistantMediaJob.create({
      data: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        surface: input.surface,
        kind: input.kind,
        status: "queued",
        sourceUserMessageId: input.sourceUserMessageId,
        ...(input.sourceClientTurnId === undefined
          ? {}
          : { sourceClientTurnId: input.sourceClientTurnId }),
        ...(input.assistantAcknowledgementMessageId === undefined
          ? {}
          : { assistantAcknowledgementMessageId: input.assistantAcknowledgementMessageId }),
        requestJson: input.request as never
      },
      select: {
        id: true,
        status: true
      }
    });

    return {
      id: created.id,
      status: "queued"
    };
  }

  async attachAcknowledgementMessageId(input: {
    assistantId: string;
    sourceUserMessageId: string;
    assistantAcknowledgementMessageId: string;
  }): Promise<number> {
    const updated = await this.prisma.assistantMediaJob.updateMany({
      where: {
        assistantId: input.assistantId,
        sourceUserMessageId: input.sourceUserMessageId,
        assistantAcknowledgementMessageId: null,
        status: {
          in: ["queued", "running", "completion_pending"]
        }
      },
      data: {
        assistantAcknowledgementMessageId: input.assistantAcknowledgementMessageId
      }
    });
    return updated.count;
  }
}
