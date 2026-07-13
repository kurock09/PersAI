import { Injectable } from "@nestjs/common";

const LONG_POLL_WAIT_BUCKETS_MS = [100, 250, 500, 1_000, 2_000, 5_000] as const;
const STALE_JOB_STATUSES = ["queued", "running"] as const;
// ADR-126 Slice 3 — pod-exec primitives on /shared and /workspace tend to land
// in the single-digit to low-hundreds millisecond range when the pod is warm,
// and stretch into seconds during cold provisioning. The bucket set is the
// same across every workspace_file_* op so a single rollup can compare them.
const WORKSPACE_FILE_LATENCY_BUCKETS_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000
] as const;
const WORKSPACE_FILE_OPS = ["write", "read", "list", "stat", "delete"] as const;
// ADR-126 v3 D12 — cold tar pull from GCS into a freshly recreated pod. Tail
// stretches into seconds for a fresh assistant; the bucket set mirrors
// WORKSPACE_FILE_LATENCY_BUCKETS_MS but extends to 60 s to capture worst-case
// session restores.
const SNAPSHOT_COLD_PULL_BUCKETS_MS = [
  50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000
] as const;
const SNAPSHOT_COLD_PULL_LAYERS = ["session", "shared"] as const;
// ADR-146 D9 — terminal sandbox job wall-clock by egress mode.
const EGRESS_JOB_DURATION_BUCKETS_MS = [
  1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000
] as const;
const EGRESS_MODES = ["restricted", "full_public"] as const;
const EGRESS_POD_RETIREMENT_OUTCOMES = ["retired", "skipped", "failed"] as const;

type StaleJobStatus = (typeof STALE_JOB_STATUSES)[number];
type WorkspaceFileOp = (typeof WORKSPACE_FILE_OPS)[number];
type SnapshotColdPullLayer = (typeof SNAPSHOT_COLD_PULL_LAYERS)[number];

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
  egressPodCreates: Record<"restricted" | "full_public", number>;
  egressPodRecycles: Record<"mismatch" | "malformed" | "owner_evict", number>;
  egressJobs: Record<"restricted" | "full_public", number>;
  egressModeMismatchFailures: number;
  egressPodRetirements: Record<(typeof EGRESS_POD_RETIREMENT_OUTCOMES)[number], number>;
  egressReaperEvictions: number;
};

export type WorkspaceFileLatencySnapshot = Record<WorkspaceFileOp, HistogramSnapshot>;

type WorkspaceQuotaScope = "workspace" | "shared";

export type WorkspaceQuotaSnapshot = Record<WorkspaceQuotaScope, number>;

export type SnapshotColdPullLatencySnapshot = Record<SnapshotColdPullLayer, HistogramSnapshot>;

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
  private readonly egressPodCreates = new Map<"restricted" | "full_public", number>([
    ["restricted", 0],
    ["full_public", 0]
  ]);
  private readonly egressPodRecycles = new Map<"mismatch" | "malformed" | "owner_evict", number>([
    ["mismatch", 0],
    ["malformed", 0],
    ["owner_evict", 0]
  ]);
  private readonly egressJobs = new Map<"restricted" | "full_public", number>([
    ["restricted", 0],
    ["full_public", 0]
  ]);
  private egressModeMismatchFailures = 0;
  private readonly egressPodRetirements = new Map<
    (typeof EGRESS_POD_RETIREMENT_OUTCOMES)[number],
    number
  >(EGRESS_POD_RETIREMENT_OUTCOMES.map((outcome) => [outcome, 0]));
  private egressReaperEvictions = 0;
  private readonly egressJobDuration = new Map<
    (typeof EGRESS_MODES)[number],
    {
      count: number;
      durationMsTotal: number;
      maxDurationMs: number;
      bucketCounts: number[];
    }
  >(
    EGRESS_MODES.map((mode) => [
      mode,
      {
        count: 0,
        durationMsTotal: 0,
        maxDurationMs: 0,
        bucketCounts: EGRESS_JOB_DURATION_BUCKETS_MS.map(() => 0)
      }
    ])
  );

  // ADR-126 Slice 3 — per-op pod-exec latency histograms.
  private readonly workspaceFileLatency = new Map<
    WorkspaceFileOp,
    {
      count: number;
      durationMsTotal: number;
      maxDurationMs: number;
      bucketCounts: number[];
    }
  >(
    WORKSPACE_FILE_OPS.map((op) => [
      op,
      {
        count: 0,
        durationMsTotal: 0,
        maxDurationMs: 0,
        bucketCounts: WORKSPACE_FILE_LATENCY_BUCKETS_MS.map(() => 0)
      }
    ])
  );

  // ADR-126 Slice 3 — last observed quota usage per scope (set from disk on
  // every write; published as a gauge from the metrics service).
  private readonly workspaceQuotaUsage = new Map<WorkspaceQuotaScope, number>([
    ["workspace", 0],
    ["shared", 0]
  ]);

  // Cold tar pull latency per layer (session = workspace.tar restore, shared =
  // per-blob hydrate from the persisted workspace object prefix).
  private readonly snapshotColdPullLatency = new Map<
    SnapshotColdPullLayer,
    {
      count: number;
      durationMsTotal: number;
      maxDurationMs: number;
      bucketCounts: number[];
    }
  >(
    SNAPSHOT_COLD_PULL_LAYERS.map((layer) => [
      layer,
      {
        count: 0,
        durationMsTotal: 0,
        maxDurationMs: 0,
        bucketCounts: SNAPSHOT_COLD_PULL_BUCKETS_MS.map(() => 0)
      }
    ])
  );

  private readonly workspaceFileAttachLatency = new Map<
    string,
    {
      count: number;
      durationMsTotal: number;
      maxDurationMs: number;
      bucketCounts: number[];
    }
  >();

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

  recordSandboxEgressPodCreate(input: { mode: "restricted" | "full_public" }): void {
    this.egressPodCreates.set(input.mode, (this.egressPodCreates.get(input.mode) ?? 0) + 1);
  }

  recordSandboxEgressPodRecycle(input: { reason: "mismatch" | "malformed" | "owner_evict" }): void {
    this.egressPodRecycles.set(input.reason, (this.egressPodRecycles.get(input.reason) ?? 0) + 1);
  }

  recordSandboxEgressJob(input: { mode: "restricted" | "full_public" }): void {
    this.egressJobs.set(input.mode, (this.egressJobs.get(input.mode) ?? 0) + 1);
  }

  recordSandboxEgressModeMismatchFailure(): void {
    this.egressModeMismatchFailures += 1;
  }

  recordSandboxEgressPodRetirement(input: {
    outcome: (typeof EGRESS_POD_RETIREMENT_OUTCOMES)[number];
  }): void {
    this.egressPodRetirements.set(
      input.outcome,
      (this.egressPodRetirements.get(input.outcome) ?? 0) + 1
    );
  }

  recordSandboxEgressReaperEvict(): void {
    this.egressReaperEvictions += 1;
  }

  recordSandboxEgressJobDuration(input: {
    mode: "restricted" | "full_public";
    durationMs: number;
  }): void {
    const entry = this.egressJobDuration.get(input.mode);
    if (entry === undefined) {
      return;
    }
    const clampedDurationMs = Math.max(0, input.durationMs);
    entry.count += 1;
    entry.durationMsTotal += clampedDurationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, clampedDurationMs);
    EGRESS_JOB_DURATION_BUCKETS_MS.forEach((bucket, index) => {
      if (clampedDurationMs <= bucket) {
        entry.bucketCounts[index] = (entry.bucketCounts[index] ?? 0) + 1;
      }
    });
  }

  getEgressJobDuration(): Record<
    (typeof EGRESS_MODES)[number],
    {
      buckets: Array<{ le: string; value: number }>;
      count: number;
      durationMsTotal: number;
      maxDurationMs: number;
    }
  > {
    const snapshot = {} as Record<
      (typeof EGRESS_MODES)[number],
      {
        buckets: Array<{ le: string; value: number }>;
        count: number;
        durationMsTotal: number;
        maxDurationMs: number;
      }
    >;
    for (const mode of EGRESS_MODES) {
      const entry = this.egressJobDuration.get(mode);
      const bucketCounts = entry?.bucketCounts ?? EGRESS_JOB_DURATION_BUCKETS_MS.map(() => 0);
      snapshot[mode] = {
        buckets: EGRESS_JOB_DURATION_BUCKETS_MS.map((bucket, index) => ({
          le: bucket.toString(),
          value: bucketCounts[index] ?? 0
        })),
        count: entry?.count ?? 0,
        durationMsTotal: entry?.durationMsTotal ?? 0,
        maxDurationMs: entry?.maxDurationMs ?? 0
      };
    }
    return snapshot;
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
      },
      egressPodCreates: {
        restricted: this.egressPodCreates.get("restricted") ?? 0,
        full_public: this.egressPodCreates.get("full_public") ?? 0
      },
      egressPodRecycles: {
        mismatch: this.egressPodRecycles.get("mismatch") ?? 0,
        malformed: this.egressPodRecycles.get("malformed") ?? 0,
        owner_evict: this.egressPodRecycles.get("owner_evict") ?? 0
      },
      egressJobs: {
        restricted: this.egressJobs.get("restricted") ?? 0,
        full_public: this.egressJobs.get("full_public") ?? 0
      },
      egressModeMismatchFailures: this.egressModeMismatchFailures,
      egressPodRetirements: {
        retired: this.egressPodRetirements.get("retired") ?? 0,
        skipped: this.egressPodRetirements.get("skipped") ?? 0,
        failed: this.egressPodRetirements.get("failed") ?? 0
      },
      egressReaperEvictions: this.egressReaperEvictions
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

  recordWorkspaceFileLatency(op: WorkspaceFileOp, durationMs: number): void {
    const entry = this.workspaceFileLatency.get(op);
    if (entry === undefined) {
      return;
    }
    const clampedDurationMs = Math.max(0, durationMs);
    entry.count += 1;
    entry.durationMsTotal += clampedDurationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, clampedDurationMs);
    WORKSPACE_FILE_LATENCY_BUCKETS_MS.forEach((bucket, index) => {
      if (clampedDurationMs <= bucket) {
        entry.bucketCounts[index] = (entry.bucketCounts[index] ?? 0) + 1;
      }
    });
  }

  recordWorkspaceFileAttachLatency(result: "ok" | "error", durationMs: number): void {
    const key = `${result}:shared`;
    let entry = this.workspaceFileAttachLatency.get(key);
    if (entry === undefined) {
      entry = {
        count: 0,
        durationMsTotal: 0,
        maxDurationMs: 0,
        bucketCounts: WORKSPACE_FILE_LATENCY_BUCKETS_MS.map(() => 0)
      };
      this.workspaceFileAttachLatency.set(key, entry);
    }
    const clampedDurationMs = Math.max(0, durationMs);
    entry.count += 1;
    entry.durationMsTotal += clampedDurationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, clampedDurationMs);
    WORKSPACE_FILE_LATENCY_BUCKETS_MS.forEach((bucket, index) => {
      if (clampedDurationMs <= bucket) {
        entry.bucketCounts[index] = (entry.bucketCounts[index] ?? 0) + 1;
      }
    });
  }

  getWorkspaceFileAttachLatency(): Array<{
    result: "ok" | "error";
    layer: "shared";
    histogram: HistogramSnapshot;
  }> {
    const rows: Array<{
      result: "ok" | "error";
      layer: "shared";
      histogram: HistogramSnapshot;
    }> = [];
    for (const result of ["ok", "error"] as const) {
      const key = `${result}:shared`;
      const entry = this.workspaceFileAttachLatency.get(key);
      const bucketCounts = entry?.bucketCounts ?? WORKSPACE_FILE_LATENCY_BUCKETS_MS.map(() => 0);
      rows.push({
        result,
        layer: "shared",
        histogram: {
          buckets: WORKSPACE_FILE_LATENCY_BUCKETS_MS.map((bucket, index) => ({
            le: bucket.toString(),
            value: bucketCounts[index] ?? 0
          })),
          count: entry?.count ?? 0,
          durationMsTotal: entry?.durationMsTotal ?? 0,
          maxDurationMs: entry?.maxDurationMs ?? 0
        }
      });
    }
    return rows;
  }

  recordWorkspaceQuotaUsage(scope: WorkspaceQuotaScope, bytes: number): void {
    this.workspaceQuotaUsage.set(scope, Math.max(0, bytes));
  }

  recordSnapshotColdPull(layer: SnapshotColdPullLayer, durationMs: number): void {
    const entry = this.snapshotColdPullLatency.get(layer);
    if (entry === undefined) {
      return;
    }
    const clampedDurationMs = Math.max(0, durationMs);
    entry.count += 1;
    entry.durationMsTotal += clampedDurationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, clampedDurationMs);
    SNAPSHOT_COLD_PULL_BUCKETS_MS.forEach((bucket, index) => {
      if (clampedDurationMs <= bucket) {
        entry.bucketCounts[index] = (entry.bucketCounts[index] ?? 0) + 1;
      }
    });
  }

  getSnapshotColdPullLatency(): SnapshotColdPullLatencySnapshot {
    const snapshot = {} as SnapshotColdPullLatencySnapshot;
    for (const layer of SNAPSHOT_COLD_PULL_LAYERS) {
      const entry = this.snapshotColdPullLatency.get(layer);
      const bucketCounts = entry?.bucketCounts ?? SNAPSHOT_COLD_PULL_BUCKETS_MS.map(() => 0);
      snapshot[layer] = {
        buckets: SNAPSHOT_COLD_PULL_BUCKETS_MS.map((bucket, index) => ({
          le: bucket.toString(),
          value: bucketCounts[index] ?? 0
        })),
        count: entry?.count ?? 0,
        durationMsTotal: entry?.durationMsTotal ?? 0,
        maxDurationMs: entry?.maxDurationMs ?? 0
      };
    }
    return snapshot;
  }

  getWorkspaceFileLatency(): WorkspaceFileLatencySnapshot {
    const snapshot = {} as WorkspaceFileLatencySnapshot;
    for (const op of WORKSPACE_FILE_OPS) {
      const entry = this.workspaceFileLatency.get(op);
      const bucketCounts = entry?.bucketCounts ?? WORKSPACE_FILE_LATENCY_BUCKETS_MS.map(() => 0);
      snapshot[op] = {
        buckets: WORKSPACE_FILE_LATENCY_BUCKETS_MS.map((bucket, index) => ({
          le: bucket.toString(),
          value: bucketCounts[index] ?? 0
        })),
        count: entry?.count ?? 0,
        durationMsTotal: entry?.durationMsTotal ?? 0,
        maxDurationMs: entry?.maxDurationMs ?? 0
      };
    }
    return snapshot;
  }

  getWorkspaceQuotaUsage(): WorkspaceQuotaSnapshot {
    return {
      workspace: this.workspaceQuotaUsage.get("workspace") ?? 0,
      shared: this.workspaceQuotaUsage.get("shared") ?? 0
    };
  }
}
