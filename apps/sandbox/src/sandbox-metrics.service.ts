import { Inject, Injectable } from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import { SANDBOX_CONFIG } from "./sandbox-config";
import { SandboxObservabilityService } from "./sandbox-observability.service";
import { SandboxPrismaService } from "./sandbox-prisma.service";

@Injectable()
export class SandboxMetricsService {
  constructor(
    private readonly prisma: SandboxPrismaService,
    private readonly sandboxObservabilityService: SandboxObservabilityService,
    @Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig
  ) {}

  async renderMetrics(): Promise<string> {
    const [queuedJobs, runningJobs, blockedJobs] = await Promise.all([
      this.prisma.sandboxJob.count({ where: { status: "queued" } }),
      this.prisma.sandboxJob.count({ where: { status: "running" } }),
      this.prisma.sandboxJob.count({ where: { status: "blocked" } })
    ]);
    const counters = this.sandboxObservabilityService.getCounters();
    const longPollHistogram = this.sandboxObservabilityService.getLongPollHistogram();
    const workspaceFileLatency = this.sandboxObservabilityService.getWorkspaceFileLatency();
    const workspaceQuotaUsage = this.sandboxObservabilityService.getWorkspaceQuotaUsage();
    const lines = [
      "# HELP sandbox_service_up Sandbox service process up status",
      "# TYPE sandbox_service_up gauge",
      "sandbox_service_up 1",
      "# HELP sandbox_pending_jobs_limit Configured maximum cluster-wide pending sandbox jobs",
      "# TYPE sandbox_pending_jobs_limit gauge",
      `sandbox_pending_jobs_limit ${this.config.SANDBOX_MAX_PENDING_JOBS}`,
      "# HELP sandbox_pending_jobs_per_workspace_limit Configured maximum pending sandbox jobs per workspace",
      "# TYPE sandbox_pending_jobs_per_workspace_limit gauge",
      `sandbox_pending_jobs_per_workspace_limit ${this.config.SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE}`,
      "# HELP sandbox_poll_wait_limit_ms Configured maximum long-poll wait per sandbox job status request in milliseconds",
      "# TYPE sandbox_poll_wait_limit_ms gauge",
      `sandbox_poll_wait_limit_ms ${this.config.SANDBOX_MAX_POLL_WAIT_MS}`,
      "# HELP sandbox_stale_queued_job_after_ms Configured queued sandbox job stale threshold in milliseconds",
      "# TYPE sandbox_stale_queued_job_after_ms gauge",
      `sandbox_stale_queued_job_after_ms ${this.config.SANDBOX_QUEUED_JOB_STALE_AFTER_MS}`,
      "# HELP sandbox_running_job_grace_ms Extra running sandbox job grace window beyond the per-job runtime limit",
      "# TYPE sandbox_running_job_grace_ms gauge",
      `sandbox_running_job_grace_ms ${this.config.SANDBOX_RUNNING_JOB_GRACE_MS}`,
      "# HELP sandbox_jobs_pending Current queued plus running sandbox jobs",
      "# TYPE sandbox_jobs_pending gauge",
      `sandbox_jobs_pending ${queuedJobs + runningJobs}`,
      "# HELP sandbox_jobs_queued Current queued sandbox jobs",
      "# TYPE sandbox_jobs_queued gauge",
      `sandbox_jobs_queued ${queuedJobs}`,
      "# HELP sandbox_jobs_running Current running sandbox jobs",
      "# TYPE sandbox_jobs_running gauge",
      `sandbox_jobs_running ${runningJobs}`,
      "# HELP sandbox_jobs_blocked Current blocked sandbox jobs",
      "# TYPE sandbox_jobs_blocked gauge",
      `sandbox_jobs_blocked ${blockedJobs}`,
      "# HELP sandbox_jobs_submitted_total Total sandbox jobs submitted",
      "# TYPE sandbox_jobs_submitted_total counter",
      `sandbox_jobs_submitted_total ${counters.submitted}`,
      "# HELP sandbox_job_backlog_rejections_total Total sandbox jobs rejected before execution because backlog bounds were reached",
      "# TYPE sandbox_job_backlog_rejections_total counter",
      `sandbox_job_backlog_rejections_total{scope="global"} ${counters.backlogRejectedTotal}`,
      `sandbox_job_backlog_rejections_total{scope="workspace"} ${counters.workspaceRejectedTotal}`,
      "# HELP sandbox_stale_job_failures_total Total sandbox jobs failed from stale queued or running status",
      "# TYPE sandbox_stale_job_failures_total counter",
      `sandbox_stale_job_failures_total{status="queued"} ${counters.staleFailures.queued}`,
      `sandbox_stale_job_failures_total{status="running"} ${counters.staleFailures.running}`,
      "# HELP sandbox_exec_pod_create_total Total sandbox exec pods created with an egress mode",
      "# TYPE sandbox_exec_pod_create_total counter",
      `sandbox_exec_pod_create_total{mode="restricted"} ${counters.egressPodCreates.restricted}`,
      `sandbox_exec_pod_create_total{mode="full_public"} ${counters.egressPodCreates.full_public}`,
      "# HELP sandbox_exec_pod_recycle_total Total sandbox exec pods recycled for egress mode reasons",
      "# TYPE sandbox_exec_pod_recycle_total counter",
      `sandbox_exec_pod_recycle_total{reason="mismatch"} ${counters.egressPodRecycles.mismatch}`,
      `sandbox_exec_pod_recycle_total{reason="malformed"} ${counters.egressPodRecycles.malformed}`,
      `sandbox_exec_pod_recycle_total{reason="owner_evict"} ${counters.egressPodRecycles.owner_evict}`,
      "# HELP sandbox_exec_egress_jobs_total Total sandbox jobs that resolved an egress mode",
      "# TYPE sandbox_exec_egress_jobs_total counter",
      `sandbox_exec_egress_jobs_total{mode="restricted"} ${counters.egressJobs.restricted}`,
      `sandbox_exec_egress_jobs_total{mode="full_public"} ${counters.egressJobs.full_public}`,
      "# HELP sandbox_job_status_long_poll_requests_total Total sandbox job status requests that used long-poll waiting",
      "# TYPE sandbox_job_status_long_poll_requests_total counter",
      `sandbox_job_status_long_poll_requests_total ${counters.longPollRequests}`,
      "# HELP sandbox_job_status_long_poll_wait_ms Sandbox long-poll wait duration in milliseconds",
      "# TYPE sandbox_job_status_long_poll_wait_ms histogram",
      "# HELP sandbox_job_status_long_poll_wait_ms_max Maximum observed sandbox long-poll wait duration in milliseconds",
      "# TYPE sandbox_job_status_long_poll_wait_ms_max gauge",
      `sandbox_job_status_long_poll_wait_ms_max ${longPollHistogram.maxDurationMs.toFixed(2)}`,
      ...longPollHistogram.buckets.map(
        (bucket) => `sandbox_job_status_long_poll_wait_ms_bucket{le="${bucket.le}"} ${bucket.value}`
      ),
      `sandbox_job_status_long_poll_wait_ms_bucket{le="+Inf"} ${longPollHistogram.count}`,
      `sandbox_job_status_long_poll_wait_ms_sum ${longPollHistogram.durationMsTotal.toFixed(2)}`,
      `sandbox_job_status_long_poll_wait_ms_count ${longPollHistogram.count}`
    ];

    // ADR-126 Slice 3 — per-op pod-exec latency histograms.
    for (const op of ["write", "read", "list", "stat", "delete"] as const) {
      const histogram = workspaceFileLatency[op];
      const metricName = `sandbox_workspace_file_${op}_latency_ms`;
      const opPascal = `${op.charAt(0).toUpperCase()}${op.slice(1)}`;
      lines.push(
        `# HELP ${metricName} Latency of WorkspaceFileBridgeService.workspaceFile${opPascal} in milliseconds`,
        `# TYPE ${metricName} histogram`,
        ...histogram.buckets.map(
          (bucket) => `${metricName}_bucket{le="${bucket.le}"} ${bucket.value}`
        ),
        `${metricName}_bucket{le="+Inf"} ${histogram.count}`,
        `${metricName}_sum ${histogram.durationMsTotal.toFixed(2)}`,
        `${metricName}_count ${histogram.count}`
      );
    }

    for (const attachSeries of this.sandboxObservabilityService.getWorkspaceFileAttachLatency()) {
      const metricName = "sandbox_workspace_file_attach_latency_ms";
      const histogram = attachSeries.histogram;
      lines.push(
        `# HELP ${metricName} Latency of workspace file attach (pod cp + shared GCS mirror) in milliseconds`,
        `# TYPE ${metricName} histogram`,
        ...histogram.buckets.map(
          (bucket) =>
            `${metricName}_bucket{result="${attachSeries.result}",layer="${attachSeries.layer}",le="${bucket.le}"} ${bucket.value}`
        ),
        `${metricName}_bucket{result="${attachSeries.result}",layer="${attachSeries.layer}",le="+Inf"} ${histogram.count}`,
        `${metricName}_sum{result="${attachSeries.result}",layer="${attachSeries.layer}"} ${histogram.durationMsTotal.toFixed(2)}`,
        `${metricName}_count{result="${attachSeries.result}",layer="${attachSeries.layer}"} ${histogram.count}`
      );
    }

    lines.push(
      "# HELP sandbox_workspace_quota_bytes_used Approximate bytes resident under /workspace/ per assistant (last observed by the bridge).",
      "# TYPE sandbox_workspace_quota_bytes_used gauge",
      `sandbox_workspace_quota_bytes_used ${workspaceQuotaUsage.workspace}`,
      "# HELP sandbox_shared_quota_bytes_used Approximate bytes resident under persisted workspace IO areas (last observed by the bridge).",
      "# TYPE sandbox_shared_quota_bytes_used gauge",
      `sandbox_shared_quota_bytes_used ${workspaceQuotaUsage.shared}`
    );

    // snapshot_cold_pull_latency_ms labelled {layer} (session = workspace.tar
    // restore on pod recreate; shared = per-blob hydrate from the persisted workspace GCS prefix).
    const snapshotColdPull = this.sandboxObservabilityService.getSnapshotColdPullLatency();
    const metricName = "snapshot_cold_pull_latency_ms";
    lines.push(
      `# HELP ${metricName} Latency of cold tar / blob pull from GCS into a freshly recreated pod in milliseconds, labelled by layer.`,
      `# TYPE ${metricName} histogram`
    );
    for (const layer of ["session", "shared"] as const) {
      const histogram = snapshotColdPull[layer];
      lines.push(
        ...histogram.buckets.map(
          (bucket) => `${metricName}_bucket{layer="${layer}",le="${bucket.le}"} ${bucket.value}`
        ),
        `${metricName}_bucket{layer="${layer}",le="+Inf"} ${histogram.count}`,
        `${metricName}_sum{layer="${layer}"} ${histogram.durationMsTotal.toFixed(2)}`,
        `${metricName}_count{layer="${layer}"} ${histogram.count}`
      );
    }

    return `${lines.join("\n")}\n`;
  }
}
