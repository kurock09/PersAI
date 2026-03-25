import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const APP_ENVS = ["local", "dev"] as const;
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", ""]);

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
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  ADMIN_STEP_UP_HMAC_SECRET: z.string().optional(),
  RUNTIME_PROVIDER_SECRETS_MASTER_KEY: z.string().min(16).optional(),
  OPENCLAW_ADAPTER_ENABLED: envBoolean.default(false),
  OPENCLAW_BASE_URL: z.string().url().default("http://openclaw.persai-dev.svc.cluster.local:18789"),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  OPENCLAW_ADAPTER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  OPENCLAW_ADAPTER_MAX_RETRIES: z.coerce.number().int().nonnegative().default(1),
  WEB_ACTIVE_CHATS_CAP: z.coerce.number().int().positive().default(20),
  QUOTA_TOKEN_BUDGET_DEFAULT: z.coerce.number().int().positive().default(200_000),
  QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT: z.coerce.number().int().positive().default(1_000),
  ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(8),
  ABUSE_USER_BLOCK_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(20),
  ABUSE_ASSISTANT_SLOWDOWN_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(40),
  ABUSE_ASSISTANT_BLOCK_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),
  ABUSE_SLOWDOWN_SECONDS: z.coerce.number().int().positive().default(15),
  ABUSE_TEMP_BLOCK_SECONDS: z.coerce.number().int().positive().default(300),
  ABUSE_QUOTA_SLOWDOWN_PERCENT: z.coerce.number().int().min(1).max(100).default(90),
  ABUSE_QUOTA_BLOCK_PERCENT: z.coerce.number().int().min(1).max(100).default(100),
  ABUSE_ADMIN_OVERRIDE_MINUTES_DEFAULT: z.coerce.number().int().positive().default(30)
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

  if (parsed.data.OPENCLAW_ADAPTER_ENABLED && !parsed.data.OPENCLAW_GATEWAY_TOKEN) {
    throw new Error(
      "Invalid API environment configuration: OPENCLAW_GATEWAY_TOKEN is required when OPENCLAW_ADAPTER_ENABLED=true."
    );
  }

  return parsed.data;
}
