import { Injectable } from "@nestjs/common";
import type {
  OverviewLatencyTraceEntry,
  OverviewLatencyTraceStage,
  OverviewLatencyTraceState,
  OverviewLatencyTraceSurface
} from "./overview-dashboard.types";

const DEFAULT_SAMPLE_LIMIT = 20;
const OUTPUT_PREVIEW_LIMIT = 160;

function clipPreview(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized.length > OUTPUT_PREVIEW_LIMIT
    ? `${normalized.slice(0, OUTPUT_PREVIEW_LIMIT - 1)}…`
    : normalized;
}

type ActiveTrace = {
  traceId: string;
  surface: OverviewLatencyTraceSurface;
  assistantId: string | null;
  threadKey: string | null;
  startedAtMs: number;
  startedAtIso: string;
  stages: Array<{ key: string; atMs: number }>;
};

export type ExternalLatencyTracePayload = {
  scope: string;
  status: string;
  totalMs: number;
  stages: Array<{ key: string; durationMs: number }>;
};

export interface OverviewLatencyTraceHandle {
  stage(key: string): void;
  isEnabled(): boolean;
  getTraceId(): string;
  attachExternalTrace(trace: ExternalLatencyTracePayload): void;
  finish(input?: {
    status?: OverviewLatencyTraceEntry["status"];
    outputPreview?: string | null;
  }): void;
}

@Injectable()
export class OverviewLatencyTraceService {
  private enabled = false;
  private updatedAt: string | null = null;
  private readonly sampleLimit = DEFAULT_SAMPLE_LIMIT;
  private readonly recent: OverviewLatencyTraceEntry[] = [];

  getState(): OverviewLatencyTraceState {
    return {
      enabled: this.enabled,
      sampleLimit: this.sampleLimit,
      updatedAt: this.updatedAt,
      recent: [...this.recent]
    };
  }

  setEnabled(enabled: boolean): OverviewLatencyTraceState {
    this.enabled = enabled;
    if (!enabled) {
      this.recent.length = 0;
    }
    this.updatedAt = new Date().toISOString();
    return this.getState();
  }

  start(input: {
    traceId: string;
    surface: OverviewLatencyTraceSurface;
    assistantId?: string | null;
    threadKey?: string | null;
  }): OverviewLatencyTraceHandle {
    if (!this.enabled) {
      return {
        stage: () => undefined,
        isEnabled: () => false,
        getTraceId: () => input.traceId,
        attachExternalTrace: () => undefined,
        finish: () => undefined
      };
    }

    const active: ActiveTrace = {
      traceId: input.traceId,
      surface: input.surface,
      assistantId: input.assistantId ?? null,
      threadKey: input.threadKey ?? null,
      startedAtMs: Date.now(),
      startedAtIso: new Date().toISOString(),
      stages: [{ key: "start", atMs: Date.now() }]
    };
    const externalStages: OverviewLatencyTraceStage[] = [];

    return {
      isEnabled: () => this.enabled,
      getTraceId: () => active.traceId,
      stage: (key: string) => {
        if (!this.enabled) {
          return;
        }
        active.stages.push({ key, atMs: Date.now() });
      },
      attachExternalTrace: (trace: ExternalLatencyTracePayload) => {
        if (!this.enabled) {
          return;
        }
        externalStages.push(
          ...trace.stages.map((stage) => ({
            key: `${trace.scope}: ${stage.key}`,
            durationMs: stage.durationMs
          }))
        );
      },
      finish: (finishInput) => {
        if (!this.enabled) {
          return;
        }
        const finishedAtMs = Date.now();
        const points = [...active.stages, { key: "finish", atMs: finishedAtMs }];
        const stages: OverviewLatencyTraceStage[] = [];
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1];
          const current = points[index];
          if (!previous || !current) {
            continue;
          }
          stages.push({
            key: `${previous.key} -> ${current.key}`,
            durationMs: Math.max(0, current.atMs - previous.atMs)
          });
        }
        this.push({
          traceId: active.traceId,
          surface: active.surface,
          status: finishInput?.status ?? "completed",
          assistantId: active.assistantId,
          threadKey: active.threadKey,
          startedAt: active.startedAtIso,
          finishedAt: new Date(finishedAtMs).toISOString(),
          totalMs: Math.max(0, finishedAtMs - active.startedAtMs),
          outputPreview: clipPreview(finishInput?.outputPreview),
          stages: [...stages, ...externalStages]
        });
      }
    };
  }

  private push(entry: OverviewLatencyTraceEntry): void {
    this.recent.unshift(entry);
    if (this.recent.length > this.sampleLimit) {
      this.recent.length = this.sampleLimit;
    }
    this.updatedAt = new Date().toISOString();
  }
}
