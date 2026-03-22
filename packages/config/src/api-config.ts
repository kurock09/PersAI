import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const APP_ENVS = ["local", "dev"] as const;

const baseApiConfigSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info")
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

  return parsed.data;
}
