import { Injectable } from "@nestjs/common";
import { AssistantAsyncJobHandleStateService } from "./assistant-async-job-handle-state.service";

const JOB_REF_RE = /^jr1\.(media|document|sandbox)\.[A-Za-z0-9_-]{32}$/;

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
  constructor(private readonly handleState: AssistantAsyncJobHandleStateService) {}

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
