import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PersaiAdminMcpConfig {
  apiBaseUrl: string;
  operatorToken: string;
  operatorActorUserId: string | null;
  operatorActorEmail: string | null;
  fetchTimeoutMs: number;
  chatTimeoutMs: number;
  indexingPollIntervalMs: number;
  indexingTimeoutMs: number;
  attachmentFetchMaxBytes: number;
  artifactDir: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Required env ${name} is not set.`);
  }
  return value.trim();
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function optionalPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Env ${name} must be a positive number.`);
  }
  return parsed;
}

export function loadPersaiAdminMcpConfig(
  env: NodeJS.ProcessEnv = process.env
): PersaiAdminMcpConfig {
  const operatorActorUserId = optionalEnv(env, "PERSAI_OPERATOR_ACTOR_USER_ID");
  const operatorActorEmail = optionalEnv(env, "PERSAI_OPERATOR_ACTOR_EMAIL")?.toLowerCase() ?? null;
  if (operatorActorUserId === null && operatorActorEmail === null) {
    throw new Error(
      "Either PERSAI_OPERATOR_ACTOR_USER_ID or PERSAI_OPERATOR_ACTOR_EMAIL must be set for MCP."
    );
  }

  return {
    apiBaseUrl: requireEnv(env, "PERSAI_API_BASE_URL").replace(/\/$/, ""),
    operatorToken: requireEnv(env, "PERSAI_OPERATOR_TOKEN"),
    operatorActorUserId,
    operatorActorEmail,
    fetchTimeoutMs: optionalPositiveInt(env, "PERSAI_MCP_FETCH_TIMEOUT_MS", 60_000),
    chatTimeoutMs: optionalPositiveInt(env, "PERSAI_MCP_CHAT_TIMEOUT_MS", 310_000),
    indexingPollIntervalMs: optionalPositiveInt(env, "PERSAI_MCP_INDEXING_POLL_MS", 2_000),
    indexingTimeoutMs: optionalPositiveInt(env, "PERSAI_MCP_INDEXING_TIMEOUT_MS", 600_000),
    attachmentFetchMaxBytes: optionalPositiveInt(env, "PERSAI_MCP_ATTACHMENT_MAX_BYTES", 4_194_304),
    artifactDir:
      optionalEnv(env, "PERSAI_MCP_ARTIFACT_DIR") ?? join(tmpdir(), "persai-mcp-artifacts")
  };
}
