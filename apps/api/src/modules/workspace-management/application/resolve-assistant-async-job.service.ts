import { Injectable } from "@nestjs/common";
import { AssistantAsyncJobHandleStateService } from "./assistant-async-job-handle-state.service";

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
      narrationOutcome: "claimed_current_turn" | "already_owned" | null;
      narrationOwner: "current_turn" | "continuation" | "legacy" | null;
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
        narrationOwner: null
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
      narrationOwner: observed.owner
    };
  }
}
