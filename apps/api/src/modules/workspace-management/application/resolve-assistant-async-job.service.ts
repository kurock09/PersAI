import { Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const JOB_REF_RE = /^jr1\.(media|document)\.[A-Za-z0-9_-]{32}$/;

export type AssistantAsyncJobStatusResult =
  | { found: false; code: "job_not_found" }
  | {
      found: true;
      jobRef: string;
      kind: "media" | "document";
      status: "pending" | "completed" | "failed" | "cancelled";
      terminal: boolean;
      errorCode: string | null;
      message: string | null;
    };

@Injectable()
export class ResolveAssistantAsyncJobService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(input: {
    jobRef: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram" | "max_ru";
    threadKey: string;
  }): Promise<AssistantAsyncJobStatusResult> {
    if (!JOB_REF_RE.test(input.jobRef)) return { found: false, code: "job_not_found" };
    if (input.channel === "max_ru") return { found: false, code: "job_not_found" };
    const channel = input.channel;
    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        id: input.chatId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        surface: channel,
        surfaceThreadKey: input.threadKey
      },
      select: { userId: true }
    });
    if (chat === null) return { found: false, code: "job_not_found" };
    const handle = await this.prisma.assistantAsyncJobHandle.findFirst({
      where: {
        jobRef: input.jobRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        userId: chat.userId,
        chatId: input.chatId,
        channel,
        threadKey: input.threadKey
      },
      select: { kind: true, canonicalJobId: true }
    });
    if (handle === null) return { found: false, code: "job_not_found" };
    if (handle.kind === "media") {
      const job = await this.prisma.assistantMediaJob.findFirst({
        where: {
          id: handle.canonicalJobId,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          userId: chat.userId,
          chatId: input.chatId,
          surface: channel
        },
        select: { status: true, lastErrorCode: true }
      });
      if (job === null) return { found: false, code: "job_not_found" };
      return this.fromCanonical(input.jobRef, "media", job.status, job.lastErrorCode);
    }
    const job = await this.prisma.assistantDocumentRenderJob.findFirst({
      where: {
        id: handle.canonicalJobId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        userId: chat.userId,
        chatId: input.chatId,
        surface: channel
      },
      select: { status: true, lastErrorCode: true }
    });
    if (job === null) return { found: false, code: "job_not_found" };
    return this.fromCanonical(input.jobRef, "document", job.status, job.lastErrorCode);
  }

  private fromCanonical(
    jobRef: string,
    kind: "media" | "document",
    status: string,
    errorCode: string | null
  ): AssistantAsyncJobStatusResult {
    if (status === "delivered") {
      return {
        found: true,
        jobRef,
        kind,
        status: "completed",
        terminal: true,
        errorCode: null,
        message: "Job completed and was delivered."
      };
    }
    if (status === "failed" || status === "expired") {
      return {
        found: true,
        jobRef,
        kind,
        status: "failed",
        terminal: true,
        errorCode,
        message: "Job failed."
      };
    }
    if (status === "canceled") {
      return {
        found: true,
        jobRef,
        kind,
        status: "cancelled",
        terminal: true,
        errorCode: null,
        message: "Job was cancelled."
      };
    }
    return {
      found: true,
      jobRef,
      kind,
      status: "pending",
      terminal: false,
      errorCode: null,
      message: null
    };
  }
}
