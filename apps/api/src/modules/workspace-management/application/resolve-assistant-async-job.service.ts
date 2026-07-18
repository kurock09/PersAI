import { Injectable } from "@nestjs/common";
import { AssistantAsyncJobHandleStateService } from "./assistant-async-job-handle-state.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const JOB_REF_RE = /^jr1\.(media|document|sandbox)\.[A-Za-z0-9_-]{32}$/;

export type AssistantAsyncJobPerceptionArtifact = {
  storagePath: string;
  mimeType: string;
  filename: string | null;
  role: "output" | "source_reference";
};

export type AssistantAsyncJobStatusResult =
  | { found: false; code: "job_not_found" }
  | {
      found: true;
      jobRef: string;
      kind: "media" | "document" | "sandbox";
      status: "pending" | "completed" | "failed" | "cancelled";
      terminal: boolean;
      errorCode: string | null;
      message: string | null;
      narrationOutcome: "claimed_current_turn" | "already_owned" | null;
      narrationOwner: "current_turn" | "continuation" | "legacy" | null;
      sandboxResult: {
        toolCode: "shell" | "exec";
        exitCode: number | null;
        stdout: string | null;
        stderr: string | null;
        paths: string[];
      } | null;
    };

@Injectable()
export class ResolveAssistantAsyncJobService {
  constructor(
    private readonly handleState: AssistantAsyncJobHandleStateService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  /**
   * ADR-157 D2 — bounded image artifact refs for chat-model perception only.
   * Not part of the model-facing await receipt (no storagePath leakage there).
   */
  async executePerceptionArtifacts(input: {
    jobRef: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram" | "max_ru";
    threadKey: string;
  }): Promise<{ artifacts: AssistantAsyncJobPerceptionArtifact[] }> {
    if (!JOB_REF_RE.test(input.jobRef) || input.channel === "max_ru") {
      return { artifacts: [] };
    }
    const handle = await this.prisma.assistantAsyncJobHandle.findFirst({
      where: {
        jobRef: input.jobRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        channel: input.channel,
        threadKey: input.threadKey,
        kind: "media",
        chat: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          surface: input.channel,
          surfaceThreadKey: input.threadKey
        }
      },
      select: { canonicalJobId: true }
    });
    if (handle === null) {
      return { artifacts: [] };
    }
    const job = await this.prisma.assistantMediaJob.findUnique({
      where: { id: handle.canonicalJobId },
      select: { kind: true, artifactsJson: true }
    });
    if (job === null || job.kind !== "image" || !Array.isArray(job.artifactsJson)) {
      return { artifacts: [] };
    }
    const artifacts: AssistantAsyncJobPerceptionArtifact[] = [];
    for (const entry of job.artifactsJson) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      const storagePath = typeof row.storagePath === "string" ? row.storagePath.trim() : "";
      const mimeType = typeof row.mimeType === "string" ? row.mimeType.trim() : "";
      if (storagePath.length === 0 || !mimeType.startsWith("image/")) continue;
      const filename =
        typeof row.filename === "string" && row.filename.trim().length > 0
          ? row.filename.trim()
          : null;
      artifacts.push({
        storagePath,
        mimeType,
        filename,
        role: "output"
      });
      if (artifacts.length >= 10) break;
    }
    return { artifacts };
  }

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
    const observed = await this.handleState.observeForCurrentTurn({
      jobRef: input.jobRef,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      channel: input.channel,
      threadKey: input.threadKey
    });
    if (observed.outcome === "not_found") return { found: false, code: "job_not_found" };
    if (observed.outcome === "pending") {
      return {
        found: true,
        jobRef: observed.jobRef,
        kind: observed.kind,
        status: "pending",
        terminal: false,
        errorCode: null,
        message: null,
        narrationOutcome: null,
        narrationOwner: null,
        sandboxResult: null
      };
    }
    return {
      found: true,
      jobRef: observed.jobRef,
      kind: observed.kind,
      status: observed.status,
      terminal: true,
      errorCode: observed.errorCode,
      message: observed.message,
      narrationOutcome: observed.outcome,
      narrationOwner: observed.owner,
      sandboxResult: observed.sandboxResult
    };
  }

  async executeSnapshot(input: {
    sourceClientTurnId: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram" | "max_ru";
    threadKey: string;
  }): Promise<
    | { outcome: "job_not_found" | "snapshot_overflow"; jobs: [] }
    | { outcome: "snapshot"; jobs: AssistantAsyncJobStatusResult[] }
  > {
    if (input.channel === "max_ru" || input.sourceClientTurnId.length === 0) {
      return { outcome: "job_not_found", jobs: [] };
    }
    const listed = await this.handleState.listOwnedSnapshotJobRefs({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      channel: input.channel,
      threadKey: input.threadKey,
      sourceClientTurnId: input.sourceClientTurnId
    });
    if (listed.overflow) return { outcome: "snapshot_overflow", jobs: [] };
    const jobs = await Promise.all(
      listed.jobRefs.map((jobRef) =>
        this.execute({
          jobRef,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          channel: input.channel,
          threadKey: input.threadKey
        })
      )
    );
    return { outcome: "snapshot", jobs };
  }
}
