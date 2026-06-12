export const LEASE_TTL_MS = 90_000;
export const LEASE_HEARTBEAT_INTERVAL_MS = 20_000;
export const LEASE_ACQUIRE_TIMEOUT_MS = 5_000;

export const SCHEDULER_KEYS = [
  "idle_reengagement",
  "idle_memory_extraction",
  "admin_system_daily_report",
  "background_task",
  "background_compaction",
  "media_job",
  "document_job",
  "upload_micro_description",
  "materialization_rollout",
  "telegram_album_finalizer",
  "assistant_file_cleanup_reaper",
  "assistant_file_media_derivative"
] as const;

export type SchedulerKey = (typeof SCHEDULER_KEYS)[number];
