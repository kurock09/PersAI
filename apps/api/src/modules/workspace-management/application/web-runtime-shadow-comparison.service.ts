import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeWebChatTurnResult,
  AssistantRuntimeWebChatTurnStreamChunk
} from "./assistant-runtime.facade";
import { toAssistantInboundFailurePayload } from "./assistant-inbound-error";
import type {
  WebRuntimeShadowComparisonEntry,
  WebRuntimeShadowComparisonState,
  WebRuntimeShadowExecutionSummary
} from "./overview-dashboard.types";

type SyncPrimaryOutcome =
  | {
      status: "completed";
      runtimeMs: number;
      assistantMessage: string;
    }
  | {
      status: "failed";
      runtimeMs: number;
      errorCode: string;
      errorMessage: string;
    };

type StreamPrimaryOutcome = {
  status: "completed" | "failed";
  runtimeMs: number;
  firstDeltaMs: number | null;
  deltaCount: number;
  assistantText: string;
  errorCode: string | null;
  errorMessage: string | null;
};

type StreamShadowOutcome = {
  status: "completed" | "failed";
  runtimeMs: number;
  firstDeltaMs: number | null;
  deltaCount: number;
  assistantText: string;
  errorCode: string | null;
  errorMessage: string | null;
};

const SHADOW_COMPARISON_SAMPLE_LIMIT = 20;
const SHADOW_PREVIEW_MAX_CHARS = 160;

function normalizeText(value: string): string {
  return value.trim();
}

function clipPreview(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length <= SHADOW_PREVIEW_MAX_CHARS
    ? normalized
    : `${normalized.slice(0, SHADOW_PREVIEW_MAX_CHARS - 1)}...`;
}

@Injectable()
export class WebRuntimeShadowComparisonService {
  private readonly logger = new Logger(WebRuntimeShadowComparisonService.name);
  private readonly recent: WebRuntimeShadowComparisonEntry[] = [];
  private updatedAt: string | null = null;

  getState(): WebRuntimeShadowComparisonState {
    return {
      sampleLimit: SHADOW_COMPARISON_SAMPLE_LIMIT,
      updatedAt: this.updatedAt,
      recent: [...this.recent]
    };
  }

  queueSyncNativeComparison(input: {
    assistantId: string;
    surfaceThreadKey: string;
    clientTurnId?: string;
    primary: SyncPrimaryOutcome;
    executeShadow: () => Promise<AssistantRuntimeWebChatTurnResult>;
  }): void {
    void this.compareSyncNative(input);
  }

  queueStreamNativeComparison(input: {
    assistantId: string;
    surfaceThreadKey: string;
    clientTurnId?: string;
    primary: StreamPrimaryOutcome;
    executeShadow: () => AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk>;
  }): void {
    void this.compareStreamNative(input);
  }

  private async compareSyncNative(input: {
    assistantId: string;
    surfaceThreadKey: string;
    clientTurnId?: string;
    primary: SyncPrimaryOutcome;
    executeShadow: () => Promise<AssistantRuntimeWebChatTurnResult>;
  }): Promise<void> {
    const shadowStartedAt = Date.now();
    try {
      const shadow = await input.executeShadow();
      const shadowRuntimeMs = Date.now() - shadowStartedAt;
      const contentMatch =
        input.primary.status === "completed" &&
        normalizeText(input.primary.assistantMessage) === normalizeText(shadow.assistantMessage);
      const errorClassMatch = input.primary.status === "completed";
      const terminalMatch = input.primary.status === "completed";
      const message =
        `web_runtime_shadow_compare route=sync assistantId=${input.assistantId} ` +
        `threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId ?? "n/a"} ` +
        `primaryStatus=${input.primary.status} shadowStatus=completed ` +
        `primaryRuntimeMs=${input.primary.runtimeMs} shadowRuntimeMs=${shadowRuntimeMs} ` +
        `contentMatch=${contentMatch} errorClassMatch=${errorClassMatch} ` +
        `primaryChars=${
          input.primary.status === "completed" ? input.primary.assistantMessage.length : 0
        } shadowChars=${shadow.assistantMessage.length}`;

      this.pushComparison({
        comparisonId: randomUUID(),
        route: "sync",
        verdict: contentMatch ? "match" : "mismatch",
        assistantId: input.assistantId,
        threadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId ?? null,
        comparedAt: new Date().toISOString(),
        contentMatch,
        errorClassMatch,
        terminalMatch,
        primary: this.toSyncExecutionSummary(input.primary),
        shadow: {
          status: "completed",
          runtimeMs: shadowRuntimeMs,
          firstDeltaMs: null,
          deltaCount: null,
          code: null,
          preview: clipPreview(shadow.assistantMessage)
        }
      });

      if (contentMatch) {
        this.logger.log(message);
        return;
      }

      this.logger.warn(message);
    } catch (error) {
      const shadowFailure = toAssistantInboundFailurePayload(error);
      const errorClassMatch =
        input.primary.status === "failed" && input.primary.errorCode === shadowFailure.code;
      const terminalMatch = input.primary.status === "failed";
      const message =
        `web_runtime_shadow_compare route=sync assistantId=${input.assistantId} ` +
        `threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId ?? "n/a"} ` +
        `primaryStatus=${input.primary.status} shadowStatus=failed ` +
        `primaryRuntimeMs=${input.primary.runtimeMs} shadowRuntimeMs=${Date.now() - shadowStartedAt} ` +
        `contentMatch=false errorClassMatch=${errorClassMatch} ` +
        `primaryCode=${input.primary.status === "failed" ? input.primary.errorCode : "completed"} ` +
        `shadowCode=${shadowFailure.code}`;

      this.pushComparison({
        comparisonId: randomUUID(),
        route: "sync",
        verdict: errorClassMatch ? "match" : "mismatch",
        assistantId: input.assistantId,
        threadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId ?? null,
        comparedAt: new Date().toISOString(),
        contentMatch: false,
        errorClassMatch,
        terminalMatch,
        primary: this.toSyncExecutionSummary(input.primary),
        shadow: {
          status: "failed",
          runtimeMs: Date.now() - shadowStartedAt,
          firstDeltaMs: null,
          deltaCount: null,
          code: shadowFailure.code,
          preview: clipPreview(shadowFailure.message)
        }
      });

      this.logger.warn(message);
    }
  }

  private async compareStreamNative(input: {
    assistantId: string;
    surfaceThreadKey: string;
    clientTurnId?: string;
    primary: StreamPrimaryOutcome;
    executeShadow: () => AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk>;
  }): Promise<void> {
    const shadow = await this.collectShadowStream(input.executeShadow);
    const contentMatch =
      input.primary.status === "completed" &&
      shadow.status === "completed" &&
      normalizeText(input.primary.assistantText) === normalizeText(shadow.assistantText);
    const terminalMatch = input.primary.status === shadow.status;
    const errorClassMatch =
      input.primary.status === "failed" &&
      shadow.status === "failed" &&
      input.primary.errorCode === shadow.errorCode;
    const verdict = terminalMatch && (contentMatch || errorClassMatch) ? "match" : "mismatch";
    const message =
      `web_runtime_shadow_compare route=stream assistantId=${input.assistantId} ` +
      `threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId ?? "n/a"} ` +
      `primaryStatus=${input.primary.status} shadowStatus=${shadow.status} ` +
      `primaryRuntimeMs=${input.primary.runtimeMs} shadowRuntimeMs=${shadow.runtimeMs} ` +
      `primaryFirstDeltaMs=${input.primary.firstDeltaMs ?? "n/a"} ` +
      `shadowFirstDeltaMs=${shadow.firstDeltaMs ?? "n/a"} ` +
      `primaryDeltaCount=${input.primary.deltaCount} shadowDeltaCount=${shadow.deltaCount} ` +
      `terminalMatch=${terminalMatch} contentMatch=${contentMatch} errorClassMatch=${errorClassMatch} ` +
      `primaryCode=${input.primary.errorCode ?? "completed"} shadowCode=${shadow.errorCode ?? "completed"}`;

    this.pushComparison({
      comparisonId: randomUUID(),
      route: "stream",
      verdict,
      assistantId: input.assistantId,
      threadKey: input.surfaceThreadKey,
      clientTurnId: input.clientTurnId ?? null,
      comparedAt: new Date().toISOString(),
      contentMatch,
      errorClassMatch,
      terminalMatch,
      primary: this.toStreamExecutionSummary(input.primary),
      shadow: this.toStreamExecutionSummary(shadow)
    });

    if (verdict === "match") {
      this.logger.log(message);
      return;
    }

    this.logger.warn(message);
  }

  private toSyncExecutionSummary(outcome: SyncPrimaryOutcome): WebRuntimeShadowExecutionSummary {
    return {
      status: outcome.status,
      runtimeMs: outcome.runtimeMs,
      firstDeltaMs: null,
      deltaCount: null,
      code: outcome.status === "failed" ? outcome.errorCode : null,
      preview: clipPreview(
        outcome.status === "completed" ? outcome.assistantMessage : outcome.errorMessage
      )
    };
  }

  private toStreamExecutionSummary(
    outcome: StreamPrimaryOutcome | StreamShadowOutcome
  ): WebRuntimeShadowExecutionSummary {
    return {
      status: outcome.status,
      runtimeMs: outcome.runtimeMs,
      firstDeltaMs: outcome.firstDeltaMs,
      deltaCount: outcome.deltaCount,
      code: outcome.errorCode,
      preview: clipPreview(outcome.assistantText || outcome.errorMessage)
    };
  }

  private pushComparison(entry: WebRuntimeShadowComparisonEntry): void {
    this.recent.unshift(entry);
    if (this.recent.length > SHADOW_COMPARISON_SAMPLE_LIMIT) {
      this.recent.length = SHADOW_COMPARISON_SAMPLE_LIMIT;
    }
    this.updatedAt = entry.comparedAt;
  }

  private async collectShadowStream(
    executeShadow: () => AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk>
  ): Promise<StreamShadowOutcome> {
    const startedAt = Date.now();
    let firstDeltaMs: number | null = null;
    let deltaCount = 0;
    let assistantText = "";

    try {
      for await (const chunk of executeShadow()) {
        if (chunk.type === "delta" && typeof chunk.delta === "string") {
          if (firstDeltaMs === null) {
            firstDeltaMs = Date.now() - startedAt;
          }
          deltaCount += 1;
          assistantText =
            typeof chunk.accumulated === "string" ? chunk.accumulated : assistantText + chunk.delta;
          continue;
        }

        if (chunk.type === "done") {
          return {
            status: "completed",
            runtimeMs: Date.now() - startedAt,
            firstDeltaMs,
            deltaCount,
            assistantText: normalizeText(assistantText),
            errorCode: null,
            errorMessage: null
          };
        }
      }

      return {
        status: "failed",
        runtimeMs: Date.now() - startedAt,
        firstDeltaMs,
        deltaCount,
        assistantText: normalizeText(assistantText),
        errorCode: "runtime_invalid_response",
        errorMessage: "Shadow runtime stream ended without a terminal done event."
      };
    } catch (error) {
      const normalized = toAssistantInboundFailurePayload(error);
      return {
        status: "failed",
        runtimeMs: Date.now() - startedAt,
        firstDeltaMs,
        deltaCount,
        assistantText: normalizeText(assistantText),
        errorCode: normalized.code,
        errorMessage: normalized.message
      };
    }
  }
}
