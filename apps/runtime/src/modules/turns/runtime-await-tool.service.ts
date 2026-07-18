import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayToolCall, RuntimeAwaitToolResult } from "@persai/runtime-contract";
import {
  AsyncJobStatusDeadlineExceededError,
  PersaiInternalApiClientService
} from "./persai-internal-api.client.service";

export const MAX_AWAIT_WAIT_TIMEOUT_MS = 60_000;
const AWAIT_OBSERVE_INTERVAL_MS = 500;
export const RUNTIME_AWAIT_CLOCK = Symbol("RUNTIME_AWAIT_CLOCK");
export interface RuntimeAwaitClock {
  now(): number;
  delay(ms: number, signal?: AbortSignal): Promise<void>;
}
export const DEFAULT_RUNTIME_AWAIT_CLOCK: RuntimeAwaitClock = {
  now: () => Date.now(),
  delay: (ms, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
};

@Injectable()
export class RuntimeAwaitToolService {
  constructor(
    private readonly api: PersaiInternalApiClientService,
    @Inject(RUNTIME_AWAIT_CLOCK) private readonly clock: RuntimeAwaitClock
  ) {}

  async executeToolCall(input: {
    toolCall: ProviderGatewayToolCall;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    channel: "web" | "telegram" | "max_ru";
    threadKey: string;
    locale?: string | null;
    blockingWaitedJobRefs: Set<string>;
    abortSignal?: AbortSignal;
  }): Promise<{ payload: RuntimeAwaitToolResult; isError: boolean }> {
    const jobRef =
      typeof input.toolCall.arguments.jobRef === "string"
        ? input.toolCall.arguments.jobRef.trim()
        : "";
    const action = input.toolCall.arguments.action;
    if (action !== "wait" && action !== "notify") {
      return {
        payload: this.skipped(
          jobRef,
          "invalid_arguments",
          'await.action must be "wait" or "notify".'
        ),
        isError: true
      };
    }
    if (jobRef.length === 0) {
      return {
        payload: this.skipped("", "invalid_arguments", "await.jobRef is required."),
        isError: true
      };
    }
    const rawTimeout = input.toolCall.arguments.timeoutMs;
    if (action === "notify") {
      if (rawTimeout !== undefined) {
        return {
          payload: this.skipped(
            jobRef,
            "invalid_arguments",
            "await.timeoutMs is valid only for wait."
          ),
          isError: true
        };
      }
      return this.notify(input, jobRef);
    }
    if (
      rawTimeout !== undefined &&
      (typeof rawTimeout !== "number" ||
        !Number.isFinite(rawTimeout) ||
        !Number.isInteger(rawTimeout) ||
        rawTimeout < 0)
    ) {
      return {
        payload: this.skipped(
          jobRef,
          "invalid_arguments",
          "await.timeoutMs must be a finite non-negative integer."
        ),
        isError: true
      };
    }
    const timeoutMs = Math.min(MAX_AWAIT_WAIT_TIMEOUT_MS, Number(rawTimeout ?? 0));
    const positiveDeadline = timeoutMs > 0 ? this.clock.now() + timeoutMs : null;
    const resolve = () => {
      const remainingMs =
        positiveDeadline === null ? undefined : Math.max(0, positiveDeadline - this.clock.now());
      if (remainingMs === 0) throw new AsyncJobStatusDeadlineExceededError();
      return this.api.resolveAsyncJobStatus({
        jobRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        channel: input.channel,
        threadKey: input.threadKey,
        ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
        ...(remainingMs === undefined ? {} : { timeoutMs: remainingMs })
      });
    };
    let initialStatus;
    try {
      initialStatus = await resolve();
    } catch (error) {
      if (error instanceof AsyncJobStatusDeadlineExceededError) {
        return {
          payload: this.skipped(
            jobRef,
            "wait_deadline_expired_before_status",
            "The wait deadline expired before job ownership and status could be confirmed."
          ),
          isError: false
        };
      }
      throw error;
    }
    if (!initialStatus.found) {
      return {
        payload: this.skipped(jobRef, "job_not_found", "Job was not found."),
        isError: true
      };
    }
    let status = initialStatus;
    if (status.terminal || timeoutMs === 0)
      return { payload: this.receipt(status, "status"), isError: false };
    if (input.blockingWaitedJobRefs.has(jobRef)) {
      return {
        payload: this.skipped(
          jobRef,
          "blocking_wait_already_used",
          "Only one blocking wait per job is allowed in a turn. Continue other work or use notify when available."
        ),
        isError: true
      };
    }
    input.blockingWaitedJobRefs.add(jobRef);
    const deadline = positiveDeadline!;
    while (!status.terminal && this.clock.now() < deadline) {
      const remainingBeforeDelay = Math.max(0, deadline - this.clock.now());
      const finalBoundaryObservation = remainingBeforeDelay <= 1;
      if (!finalBoundaryObservation) {
        await this.clock.delay(
          Math.min(AWAIT_OBSERVE_INTERVAL_MS, remainingBeforeDelay - 1),
          input.abortSignal
        );
      }
      let observed;
      try {
        observed = await resolve();
      } catch (error) {
        if (error instanceof AsyncJobStatusDeadlineExceededError) {
          return { payload: this.receipt(status, "waited"), isError: false };
        }
        throw error;
      }
      if (!observed.found) {
        return {
          payload: this.skipped(jobRef, "job_not_found", "Job was not found."),
          isError: true
        };
      }
      status = observed;
      if (finalBoundaryObservation || this.clock.now() >= deadline - 1) {
        break;
      }
    }
    return { payload: this.receipt(status, "waited"), isError: false };
  }

  private async notify(
    input: {
      assistantId: string;
      workspaceId: string;
      chatId: string;
      channel: "web" | "telegram" | "max_ru";
      threadKey: string;
      locale?: string | null;
      abortSignal?: AbortSignal;
    },
    jobRef: string
  ): Promise<{ payload: RuntimeAwaitToolResult; isError: boolean }> {
    const result = await this.api.subscribeAsyncJob({
      jobRef,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      channel: input.channel,
      threadKey: input.threadKey,
      ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal })
    });
    if (result.outcome === "not_found") {
      return {
        payload: this.skipped(jobRef, "job_not_found", "Job was not found."),
        isError: true
      };
    }
    if (result.outcome === "terminal_inline") {
      return {
        payload: {
          toolCode: "await",
          executionMode: "inline",
          action: "terminal_inline",
          turnControl: "continue",
          staticAssistantText: null,
          reason: null,
          warning: null,
          jobRef,
          kind: result.kind,
          status: result.status,
          terminal: true,
          errorCode: result.errorCode,
          message: result.message
        },
        isError: false
      };
    }
    if (result.outcome === "depth_exhausted") {
      return {
        payload: this.terminalStatic(
          jobRef,
          "depth_exhausted",
          "continuation_depth_exhausted",
          input.locale
        ),
        isError: false
      };
    }
    if (result.outcome === "already_owned") {
      return {
        payload: this.terminalStatic(
          jobRef,
          "already_owned",
          `narration_already_owned:${result.owner}`,
          input.locale
        ),
        isError: false
      };
    }
    return {
      payload: {
        toolCode: "await",
        executionMode: "inline",
        action: "notified",
        turnControl: "terminal_static",
        staticAssistantText: this.localized(
          input.locale,
          "Я сообщу здесь, когда задача завершится.",
          "I’ll let you know here when the job finishes."
        ),
        reason: result.duplicate ? "already_subscribed" : null,
        warning: null,
        jobRef,
        kind: null,
        status: "pending",
        terminal: false,
        errorCode: null,
        message: null
      },
      isError: false
    };
  }

  private receipt(
    status: Extract<
      Awaited<ReturnType<PersaiInternalApiClientService["resolveAsyncJobStatus"]>>,
      { found: true }
    >,
    action: "status" | "waited"
  ): RuntimeAwaitToolResult {
    return {
      toolCode: "await",
      executionMode: "inline",
      action,
      turnControl:
        status.terminal &&
        status.narrationOutcome === "already_owned" &&
        status.narrationOwner !== "current_turn"
          ? "terminal_static"
          : "continue",
      staticAssistantText:
        status.terminal &&
        status.narrationOutcome === "already_owned" &&
        status.narrationOwner !== "current_turn"
          ? "This job completion is already being handled in this conversation."
          : null,
      reason: null,
      warning: null,
      ...status
    };
  }

  private skipped(jobRef: string, reason: string, warning: string): RuntimeAwaitToolResult {
    return {
      toolCode: "await",
      executionMode: "inline",
      action: "skipped",
      turnControl: "continue",
      staticAssistantText: null,
      reason,
      warning,
      jobRef,
      kind: null,
      status: null,
      terminal: false,
      errorCode: null,
      message: null
    };
  }

  private terminalStatic(
    jobRef: string,
    action: "already_owned" | "depth_exhausted",
    reason: string,
    locale?: string | null
  ): RuntimeAwaitToolResult {
    return {
      toolCode: "await",
      executionMode: "inline",
      action,
      turnControl: "terminal_static",
      staticAssistantText:
        action === "depth_exhausted"
          ? this.localized(
              locale,
              "Цепочка автоматических продолжений завершена. Напишите новое сообщение, если нужно продолжить.",
              "The automatic continuation chain has ended. Send a new message if you want to continue."
            )
          : this.localized(
              locale,
              "Завершение этой задачи уже обрабатывается в этом чате.",
              "This job completion is already being handled in this chat."
            ),
      reason,
      warning: null,
      jobRef,
      kind: null,
      status: null,
      terminal: action === "depth_exhausted",
      errorCode: null,
      message: null
    };
  }

  private localized(locale: string | null | undefined, ru: string, en: string): string {
    return locale?.toLowerCase().startsWith("ru") ? ru : en;
  }
}
