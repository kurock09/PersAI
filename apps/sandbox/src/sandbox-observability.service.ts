import { Injectable } from "@nestjs/common";

const LONG_POLL_WAIT_BUCKETS_MS = [100, 250, 500, 1_000, 2_000, 5_000] as const;
const STALE_JOB_STATUSES = ["queued", "running"] as const;

type StaleJobStatus = (typeof STALE_JOB_STATUSES)[number];

type HistogramSnapshot = {
  buckets: Array<{ le: string; value: number }>;
  count: number;
  durationMsTotal: number;
  maxDurationMs: number;
};

type CounterSnapshot = {
  submitted: number;
  backlogRejectedTotal: number;
  workspaceRejectedTotal: number;
  longPollRequests: number;
  staleFailures: Record<StaleJobStatus, number>;
};

@Injectable()
export class SandboxObservabilityService {
  private submitted = 0;
  private backlogRejectedTotal = 0;
  private workspaceRejectedTotal = 0;
  private longPollRequests = 0;
  private longPollWaitCount = 0;
  private longPollWaitDurationMsTotal = 0;
  private longPollWaitMaxDurationMs = 0;
  private readonly longPollWaitBucketCounts = LONG_POLL_WAIT_BUCKETS_MS.map(() => 0);
  private readonly staleFailures = new Map<StaleJobStatus, number>(
    STALE_JOB_STATUSES.map((status) => [status, 0])
  );

  recordSubmittedJob(): void {
    this.submitted += 1;
  }

  recordBacklogRejected(scope: "global" | "workspace"): void {
    if (scope === "workspace") {
      this.workspaceRejectedTotal += 1;
      return;
    }
    this.backlogRejectedTotal += 1;
  }

  recordLongPoll(waitMs: number): void {
    const clampedWaitMs = Math.max(0, waitMs);
    this.longPollRequests += 1;
    this.longPollWaitCount += 1;
    this.longPollWaitDurationMsTotal += clampedWaitMs;
    this.longPollWaitMaxDurationMs = Math.max(this.longPollWaitMaxDurationMs, clampedWaitMs);
    LONG_POLL_WAIT_BUCKETS_MS.forEach((bucket, index) => {
      if (clampedWaitMs <= bucket) {
        this.longPollWaitBucketCounts[index] = (this.longPollWaitBucketCounts[index] ?? 0) + 1;
      }
    });
  }

  recordStaleFailure(status: StaleJobStatus): void {
    this.staleFailures.set(status, (this.staleFailures.get(status) ?? 0) + 1);
  }

  getCounters(): CounterSnapshot {
    return {
      submitted: this.submitted,
      backlogRejectedTotal: this.backlogRejectedTotal,
      workspaceRejectedTotal: this.workspaceRejectedTotal,
      longPollRequests: this.longPollRequests,
      staleFailures: {
        queued: this.staleFailures.get("queued") ?? 0,
        running: this.staleFailures.get("running") ?? 0
      }
    };
  }

  getLongPollHistogram(): HistogramSnapshot {
    return {
      buckets: LONG_POLL_WAIT_BUCKETS_MS.map((bucket, index) => ({
        le: bucket.toString(),
        value: this.longPollWaitBucketCounts[index] ?? 0
      })),
      count: this.longPollWaitCount,
      durationMsTotal: this.longPollWaitDurationMsTotal,
      maxDurationMs: this.longPollWaitMaxDurationMs
    };
  }
}
