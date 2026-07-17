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
    blockingWaitedJobRefs: Set<string>;
    abortSignal?: AbortSignal;
  }): Promise<{ payload: RuntimeAwaitToolResult; isError: boolean }> {
    const jobRef =
      typeof input.toolCall.arguments.jobRef === "string"
        ? input.toolCall.arguments.jobRef.trim()
        : "";
    const action = input.toolCall.arguments.action;
    if (action !== "wait") {
      return {
        payload: this.skipped(jobRef, "invalid_arguments", 'await.action must be "wait".'),
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
}
