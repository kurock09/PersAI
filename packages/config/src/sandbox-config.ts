import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const APP_ENVS = ["local", "dev"] as const;

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }
  return value;
}, z.string().min(1).optional());

const baseSandboxConfigSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3013),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  PERSAI_MEDIA_BUCKET_NAME: optionalNonEmptyString,
  PERSAI_MEDIA_OBJECT_PREFIX: optionalNonEmptyString,
  PERSAI_INTERNAL_API_TOKEN: optionalNonEmptyString,
  SANDBOX_MAX_PENDING_JOBS: z.coerce.number().int().positive().default(16),
  SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE: z.coerce.number().int().positive().default(4),
  SANDBOX_MAX_POLL_WAIT_MS: z.coerce.number().int().positive().default(1_500),
  SANDBOX_QUEUED_JOB_STALE_AFTER_MS: z.coerce.number().int().positive().default(45_000),
  SANDBOX_RUNNING_JOB_GRACE_MS: z.coerce.number().int().positive().default(15_000)
});

const localSandboxConfigSchema = baseSandboxConfigSchema.extend({
  APP_ENV: z.literal("local")
});

const devSandboxConfigSchema = baseSandboxConfigSchema.extend({
  APP_ENV: z.literal("dev"),
  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z.string().min(1)
});

const sandboxConfigSchema = z.discriminatedUnion("APP_ENV", [
  localSandboxConfigSchema,
  devSandboxConfigSchema
]);

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function loadSandboxConfig(env: NodeJS.ProcessEnv): SandboxConfig {
  const parsed = sandboxConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid sandbox environment configuration: ${formatIssues(parsed.error.issues)}`
    );
  }
  return parsed.data;
}
