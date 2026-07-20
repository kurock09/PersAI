import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const APP_ENVS = ["local", "dev"] as const;

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

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", ""]);
const envBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return value;
}, z.boolean());

const baseRuntimeConfigSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3012),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  RUNTIME_STATE_REDIS_URL: z.string().min(1),
  RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(128),
  RUNTIME_STATE_REDIS_KEY_PREFIX: z.string().min(1).default("persai:runtime"),
  RUNTIME_SESSION_LEASE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  RUNTIME_TURN_RECEIPT_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  RUNTIME_BUNDLE_MARKER_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  PERSAI_API_BASE_URL: optionalUrl,
  PERSAI_WEB_BASE_URL: optionalUrl,
  PERSAI_INTERNAL_API_TOKEN: optionalNonEmptyString,
  RUNTIME_PROVIDER_GATEWAY_BASE_URL: optionalUrl,
  /**
   * ADR-161 Release A/B rollout seam. DELETE IN RELEASE C.
   * Runtime always understands explicit v2 from provider-gateway; this gates
   * only its external runtime-to-API producer boundary.
   */
  RUNTIME_TEXT_USAGE_V2_PRODUCER_ENABLED: envBoolean.optional(),
  PERSAI_MEDIA_BUCKET_NAME: optionalNonEmptyString,
  // Operational GCS bucket prefix for workspace media objects (ADR-126 v3
  // Amendment 2026-06-24). Must be in sync with the api-side default so the
  // runtime + api address the same key namespace even when the helm env block
  // forgets to enumerate the variable. Live regression 2026-06-25: runtime
  // helm env had no PERSAI_MEDIA_OBJECT_PREFIX entry, this schema had no
  // default, getObjectPrefix() threw, and every chat turn carrying an image
  // attachment failed with "Chat runtime is temporarily unreachable" because
  // TurnContextHydrationService.downloadDirectInputAttachmentBytes blew up.
  // ADR-127 D9 (2026-06-25): default changed from "assistant-media" to "fs".
  // New writes land under <bucket>/fs/... The legacy prefix is wiped by W5.
  PERSAI_MEDIA_OBJECT_PREFIX: z.string().min(1).default("fs"),
  RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  RUNTIME_SANDBOX_BASE_URL: optionalUrl,
  RUNTIME_SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // End-to-end budget the runtime allows for a sandbox job to complete must include
  // *cold-start pod provisioning* (sandbox node autoscale + multi-GB image pull, ~100s),
  // not just lease wait + command runtime. Without this the runtime abandoned the job
  // (~40s) long before a cold pod was ready. Keep in sync with the control-plane
  // SANDBOX_EXEC_POD_PROVISION_BUDGET_MS. Default 4 min.
  RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS: z.coerce.number().int().positive().default(240_000),
  /** ADR-149 S4: grace before reconciling stale accepted turn receipts (default 20 min). */
  ORPHAN_RECEIPT_GRACE_MS: z.coerce.number().int().positive().default(1_200_000)
});

const localRuntimeConfigSchema = baseRuntimeConfigSchema.extend({
  APP_ENV: z.literal("local")
});

const devRuntimeConfigSchema = baseRuntimeConfigSchema.extend({
  APP_ENV: z.literal("dev"),
  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z.string().min(1)
});

const runtimeConfigSchema = z.discriminatedUnion("APP_ENV", [
  localRuntimeConfigSchema,
  devRuntimeConfigSchema
]);

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const parsed = runtimeConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid runtime environment configuration: ${formatIssues(parsed.error.issues)}`
    );
  }
  return parsed.data;
}
