export const LEASE_TTL_MS = 90_000;
export const LEASE_HEARTBEAT_INTERVAL_MS = 20_000;
export const LEASE_ACQUIRE_TIMEOUT_MS = 5_000;

export const SCHEDULER_KEYS = [
  "idle_reengagement",
  "background_task",
  "background_compaction",
  "media_job",
  "materialization_rollout"
] as const;

export type SchedulerKey = (typeof SCHEDULER_KEYS)[number];
