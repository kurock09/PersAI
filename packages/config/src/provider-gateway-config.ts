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

const optionalString = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  }
  return value;
}, z.string().optional());

const optionalUrl = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  }
  return value;
}, z.string().url().optional());

const modelList = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return value;
  },
  z.array(z.string().min(1))
);

const baseProviderGatewayConfigSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().positive().default(3011),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  PROVIDER_GATEWAY_WARM_ON_BOOT: envBoolean.default(true),
  PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PROVIDER_GATEWAY_BOOT_WARMUP_RETRY_DELAY_MS: z.coerce.number().int().positive().default(2_000),
  PROVIDER_GATEWAY_BOOT_WARMUP_RECOVERY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10_000),
  PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  PERSAI_API_BASE_URL: optionalString,
  PERSAI_INTERNAL_API_TOKEN: optionalString,
  PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: optionalUrl.default(
    "https://production-sfo.browserless.io"
  ),
  PROVIDER_GATEWAY_OPENAI_API_KEY: optionalString,
  PROVIDER_GATEWAY_ANTHROPIC_API_KEY: optionalString,
  PROVIDER_GATEWAY_OPENAI_MODELS: modelList.default(["gpt-5.4"]),
  PROVIDER_GATEWAY_ANTHROPIC_MODELS: modelList.default(["claude-sonnet-4-5"])
});

const localProviderGatewayConfigSchema = baseProviderGatewayConfigSchema.extend({
  APP_ENV: z.literal("local")
});

const devProviderGatewayConfigSchema = baseProviderGatewayConfigSchema.extend({
  APP_ENV: z.literal("dev"),
  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z.string().min(1)
});

const providerGatewayConfigSchema = z.discriminatedUnion("APP_ENV", [
  localProviderGatewayConfigSchema,
  devProviderGatewayConfigSchema
]);

export type ProviderGatewayConfig = z.infer<typeof providerGatewayConfigSchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".") || "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function loadProviderGatewayConfig(env: NodeJS.ProcessEnv): ProviderGatewayConfig {
  const parsed = providerGatewayConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid provider gateway environment configuration: ${formatIssues(parsed.error.issues)}`
    );
  }
  return parsed.data;
}
