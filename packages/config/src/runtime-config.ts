import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const APP_ENVS = ["local", "dev"] as const;

const optionalUrl = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }
  return value;
}, z.string().url().optional());

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
  RUNTIME_PROVIDER_GATEWAY_BASE_URL: optionalUrl,
  RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000)
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
