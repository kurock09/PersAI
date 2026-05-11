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
    return `${lines.join("\n")}\n`;
  }
}
