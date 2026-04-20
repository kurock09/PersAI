import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SMOKE_ROOT = path.resolve(HERE, "..");
export const SCENARIOS_DIR = path.join(SMOKE_ROOT, "scenarios");
export const BASELINES_DIR = path.join(SMOKE_ROOT, "baselines");
export const ARTIFACTS_DIR_DEFAULT = path.join(SMOKE_ROOT, "artifacts");

export interface SmokeEnv {
  apiBaseUrl: string;
  apiInternalBaseUrl: string;
  userBearer: string;
  internalToken: string;
  assistantId: string;
  artifactsDir: string;
  fetchTimeoutMs: number;
  receiptPollTimeoutMs: number;
  receiptPollIntervalMs: number;
  surfaceThreadPrefix: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Required env ${name} is not set.`);
  }
  return value.trim();
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Env ${name} must be a positive number, got "${raw}".`);
  }
  return parsed;
}

export function loadSmokeEnv(): SmokeEnv {
  const apiBaseUrl = (process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
  const apiInternalBaseUrl = (
    process.env.SMOKE_API_INTERNAL_BASE_URL ?? "http://127.0.0.1:3002"
  ).replace(/\/$/, "");
  const artifactsDir = path.resolve(process.env.SMOKE_ARTIFACTS_DIR ?? ARTIFACTS_DIR_DEFAULT);
  return {
    apiBaseUrl,
    apiInternalBaseUrl,
    userBearer: requireEnv("SMOKE_USER_BEARER"),
    internalToken: requireEnv("PERSAI_INTERNAL_API_TOKEN"),
    assistantId: requireEnv("SMOKE_ASSISTANT_ID"),
    artifactsDir,
    fetchTimeoutMs: optionalNumber("SMOKE_FETCH_TIMEOUT_MS", 120_000),
    receiptPollTimeoutMs: optionalNumber("SMOKE_RECEIPT_POLL_TIMEOUT_MS", 30_000),
    receiptPollIntervalMs: optionalNumber("SMOKE_RECEIPT_POLL_INTERVAL_MS", 500),
    surfaceThreadPrefix: process.env.SMOKE_SURFACE_THREAD_PREFIX ?? "smoke"
  };
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function buildRunId(scenarioId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${scenarioId}-${stamp}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
