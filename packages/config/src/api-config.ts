import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const APP_ENVS = ["local", "dev"] as const;
const WEB_CHAT_RUNTIME_MODES = ["native"] as const;
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", ""]);

const optionalUrl = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }
  return value;
}, z.string().url().optional());

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }
  return value;
}, z.string().min(1).optional());

const envBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) {
      return true;
    }
    if (FALSE_VALUES.has(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const baseApiConfigSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().positive().default(3001),
  API_INTERNAL_PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  ADMIN_STEP_UP_HMAC_SECRET: z.string().optional(),
  RUNTIME_PROVIDER_SECRETS_MASTER_KEY: z.string().min(16).optional(),
  PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE: z.enum(WEB_CHAT_RUNTIME_MODES).default("native"),
  PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE: z.enum(WEB_CHAT_RUNTIME_MODES).default("native"),
  PERSAI_RUNTIME_BASE_URL: optionalUrl,
  PERSAI_RUNTIME_DISCOVERY_DNS: optionalNonEmptyString,
  PERSAI_RUNTIME_TARGET_REPLICAS: z.coerce.number().int().positive().optional(),
  PERSAI_RUNTIME_AUTOSCALING_ENABLED: envBoolean.default(false),
  PERSAI_RUNTIME_AUTOSCALING_MIN_REPLICAS: z.coerce.number().int().positive().optional(),
  PERSAI_RUNTIME_AUTOSCALING_MAX_REPLICAS: z.coerce.number().int().positive().optional(),
  PERSAI_RUNTIME_BUNDLE_SYNC_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  PERSAI_RUNTIME_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  PERSAI_RUNTIME_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  /** ADR-149: whole-turn hard wall-clock ceiling for API runtime fetch (stream + sync). */
  PERSAI_RUNTIME_TURN_WALL_CLOCK_MS: z.coerce.number().int().positive().default(1_800_000),
  /** ADR-149: progress-only idle stall window for streaming turns (no progress resets timer). */
  PERSAI_RUNTIME_TURN_IDLE_STALL_MS: z.coerce.number().int().positive().default(300_000),
  // ADR-140 cross-pod browser-bridge relay. When set, the local browser-bridge WebSocket
  // relay coordinates connections/commands across api replicas via Redis pub/sub so a device
  // socket held by one pod is reachable from dispatch/result HTTP handled by any other pod.
  // When empty, the relay degrades to single-process in-memory behavior (local dev).
  BROWSER_BRIDGE_REDIS_URL: optionalUrl,
  // ADR-149 durable web-chat Stop dispatch across api replicas. When empty, falls back to
  // BROWSER_BRIDGE_REDIS_URL (same runtime Redis in prod). Stream-owning pod keeps the local
  // AbortController; Redis records ownership and pub/sub delivers Stop to the owner pod.
  PERSAI_TURN_COORDINATION_REDIS_URL: optionalUrl,
  PERSAI_PROVIDER_GATEWAY_BASE_URL: optionalUrl,
  PERSAI_PROVIDER_GATEWAY_DISCOVERY_DNS: optionalNonEmptyString,
  PERSAI_PROVIDER_GATEWAY_TARGET_REPLICAS: z.coerce.number().int().positive().optional(),
  PERSAI_PROVIDER_GATEWAY_AUTOSCALING_ENABLED: envBoolean.default(false),
  PERSAI_PROVIDER_GATEWAY_AUTOSCALING_MIN_REPLICAS: z.coerce.number().int().positive().optional(),
  PERSAI_PROVIDER_GATEWAY_AUTOSCALING_MAX_REPLICAS: z.coerce.number().int().positive().optional(),
  PERSAI_PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  PERSAI_PROVIDER_GATEWAY_HEYGEN_AVATAR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  PERSAI_WEB_BASE_URL: optionalUrl,
  PERSAI_MEDIA_BUCKET_NAME: z.string().optional(),
  // ADR-127 D9 (2026-06-25): default changed from "assistant-media" to "fs".
  // New writes land under <bucket>/fs/... The legacy "assistant-media" prefix
  // is wiped by the ADR-126-V3-GCS-WIPE-RUNBOOK.md (W5 / D10).
  PERSAI_MEDIA_OBJECT_PREFIX: z.string().min(1).default("fs"),
  PERSAI_KNOWLEDGE_OBJECT_PREFIX: z.string().min(1).default("assistant-knowledge"),
  PERSAI_INTERNAL_API_TOKEN: z.string().optional(),
  PERSAI_OPERATOR_TOKEN: optionalNonEmptyString,
  PERSAI_OPERATOR_ACTOR_USER_ID: optionalNonEmptyString,
  PERSAI_OPERATOR_ACTOR_EMAIL: optionalNonEmptyString,
  PERSAI_SANDBOX_BASE_URL: optionalUrl,
  PERSAI_SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /** ADR-146 S3 — exceeds the sandbox pod delete/wait worst-case budget (240s). */
  PERSAI_SANDBOX_EGRESS_RECYCLE_TIMEOUT_MS: z.coerce.number().int().min(250_000).default(300_000),
  TELEGRAM_WEBHOOK_BASE_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_HMAC_SECRET: z.string().min(16).optional(),
  WEB_ACTIVE_CHATS_CAP: z.coerce.number().int().positive().default(20),
  QUOTA_TOKEN_BUDGET_DEFAULT: z.coerce.number().int().positive().default(200_000),
  QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT: z.coerce.number().int().positive().default(1_000),
  QUOTA_MEDIA_STORAGE_BYTES_DEFAULT: z.coerce.number().int().positive().default(104_857_600),
  QUOTA_KNOWLEDGE_STORAGE_BYTES_DEFAULT: z.coerce.number().int().positive().default(104_857_600),
  QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT: z.coerce.number().int().positive().default(524_288_000),
  QUOTA_SHARED_STORAGE_BYTES_DEFAULT: z.coerce.number().int().positive().default(524_288_000),
  ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(8),
  ABUSE_USER_BLOCK_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(20),
  ABUSE_ASSISTANT_SLOWDOWN_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(40),
  ABUSE_ASSISTANT_BLOCK_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),
  ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(5),
  ABUSE_PEER_BLOCK_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(12),
  ABUSE_SLOWDOWN_SECONDS: z.coerce.number().int().positive().default(15),
  ABUSE_TEMP_BLOCK_SECONDS: z.coerce.number().int().positive().default(300),
  ABUSE_ADMIN_OVERRIDE_MINUTES_DEFAULT: z.coerce.number().int().positive().default(30),
  /** Comma-separated emails (case-insensitive). When non-empty, only these accounts may use admin APIs (after role checks). */
  PERSAI_ADMIN_ALLOWLIST_EMAILS: z.string().optional(),
  /** ADR-115 contour-2 async moderation worker controls. */
  SAFETY_MODERATION_ENABLED: envBoolean.default(true),
  SAFETY_MODERATION_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  SAFETY_MODERATION_BATCH_SIZE: z.coerce.number().int().positive().default(4),
  SAFETY_MODERATION_THREAD_MESSAGE_LIMIT: z.coerce.number().int().min(10).max(20).default(15),
  SAFETY_MODERATION_BLOCK_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  SAFETY_MODERATION_WARN_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  SAFETY_MODERATION_WARN_FIRST_BLOCK_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  SAFETY_MODERATION_STRIKE_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
  SAFETY_MODERATION_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  SAFETY_MODERATION_STUCK_PROCESSING_MS: z.coerce.number().int().positive().default(600_000),
  SAFETY_MODERATION_OPENAI_API_KEY: optionalNonEmptyString
});

const localApiConfigSchema = baseApiConfigSchema.extend({
  APP_ENV: z.literal("local"),
  LOCAL_POSTGRES_HOST: z.string().min(1).default("localhost"),
  LOCAL_POSTGRES_PORT: z.coerce.number().int().positive().default(5432)
});

const devApiConfigSchema = baseApiConfigSchema.extend({
  APP_ENV: z.literal("dev"),
  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z.string().min(1)
});

const apiConfigSchema = z.discriminatedUnion("APP_ENV", [localApiConfigSchema, devApiConfigSchema]);

export type ApiConfig = z.infer<typeof apiConfigSchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function loadApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const parsed = apiConfigSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid API environment configuration: ${formatIssues(parsed.error.issues)}`);
  }

  if (!parsed.data.PERSAI_INTERNAL_API_TOKEN?.trim()) {
    throw new Error(
      "Invalid API environment configuration: PERSAI_INTERNAL_API_TOKEN is required for internal runtime endpoints."
    );
  }

  return parsed.data;
}
