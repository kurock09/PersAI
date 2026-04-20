import { promises as fs } from "node:fs";
import path from "node:path";
import { SCENARIOS_DIR } from "./workspace";

export type SmokeTurnKind = "web_sync" | "web_stream";

export interface SmokeTurnDefinition {
  message: string;
  kind?: SmokeTurnKind;
  thinkAfterMs?: number;
  expectToolCode?: string;
  note?: string;
}

export interface SmokeSessionDefinition {
  sessionKey: string;
  turns: SmokeTurnDefinition[];
}

export interface SmokeScenarioDefinition {
  id: string;
  title: string;
  description: string;
  defaultKind?: SmokeTurnKind;
  defaultThinkAfterMs?: number;
  threadKeySuffix?: string;
  sessions: SmokeSessionDefinition[];
}

export async function loadScenario(scenarioId: string): Promise<SmokeScenarioDefinition> {
  const filePath = path.join(SCENARIOS_DIR, `${scenarioId}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Scenario "${scenarioId}" not found at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = JSON.parse(raw) as unknown;
  return normalizeScenario(scenarioId, parsed);
}

export async function listScenarioIds(): Promise<string[]> {
  const entries = await fs.readdir(SCENARIOS_DIR);
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeScenario(scenarioId: string, raw: unknown): SmokeScenarioDefinition {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Scenario ${scenarioId}: root must be a JSON object.`);
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" && obj.id.trim().length > 0 ? obj.id.trim() : scenarioId;
  const title = assertString(obj.title, `${scenarioId}.title`);
  const description = assertString(obj.description, `${scenarioId}.description`);
  const defaultKind = parseKind(obj.defaultKind, `${scenarioId}.defaultKind`) ?? "web_sync";
  const defaultThinkAfterMs =
    typeof obj.defaultThinkAfterMs === "number" &&
    Number.isFinite(obj.defaultThinkAfterMs) &&
    obj.defaultThinkAfterMs >= 0
      ? obj.defaultThinkAfterMs
      : undefined;
  const threadKeySuffix =
    typeof obj.threadKeySuffix === "string" && obj.threadKeySuffix.trim().length > 0
      ? obj.threadKeySuffix.trim()
      : undefined;
  const sessionsRaw = Array.isArray(obj.sessions) ? obj.sessions : [];
  if (sessionsRaw.length === 0) {
    throw new Error(`Scenario ${id}: sessions must contain at least one session.`);
  }
  const sessions = sessionsRaw.map((sessionRaw, sessionIndex) =>
    normalizeSession(id, sessionIndex, sessionRaw)
  );
  return {
    id,
    title,
    description,
    defaultKind,
    ...(defaultThinkAfterMs === undefined ? {} : { defaultThinkAfterMs }),
    ...(threadKeySuffix === undefined ? {} : { threadKeySuffix }),
    sessions
  };
}

function normalizeSession(
  scenarioId: string,
  sessionIndex: number,
  raw: unknown
): SmokeSessionDefinition {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Scenario ${scenarioId}.sessions[${sessionIndex}] must be an object.`);
  }
  const obj = raw as Record<string, unknown>;
  const sessionKey =
    typeof obj.sessionKey === "string" && obj.sessionKey.trim().length > 0
      ? obj.sessionKey.trim()
      : `session-${sessionIndex + 1}`;
  const turnsRaw = Array.isArray(obj.turns) ? obj.turns : [];
  if (turnsRaw.length === 0) {
    throw new Error(`Scenario ${scenarioId}.${sessionKey} must contain at least one turn.`);
  }
  const turns = turnsRaw.map((turnRaw, turnIndex) =>
    normalizeTurn(scenarioId, sessionKey, turnIndex, turnRaw)
  );
  return { sessionKey, turns };
}

function normalizeTurn(
  scenarioId: string,
  sessionKey: string,
  turnIndex: number,
  raw: unknown
): SmokeTurnDefinition {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Scenario ${scenarioId}.${sessionKey}.turns[${turnIndex}] must be an object.`);
  }
  const obj = raw as Record<string, unknown>;
  const message = assertString(
    obj.message,
    `${scenarioId}.${sessionKey}.turns[${turnIndex}].message`
  );
  const kind = parseKind(obj.kind, `${scenarioId}.${sessionKey}.turns[${turnIndex}].kind`);
  const thinkAfterMs =
    typeof obj.thinkAfterMs === "number" &&
    Number.isFinite(obj.thinkAfterMs) &&
    obj.thinkAfterMs >= 0
      ? obj.thinkAfterMs
      : undefined;
  const expectToolCode =
    typeof obj.expectToolCode === "string" && obj.expectToolCode.trim().length > 0
      ? obj.expectToolCode.trim()
      : undefined;
  const note =
    typeof obj.note === "string" && obj.note.trim().length > 0 ? obj.note.trim() : undefined;
  return {
    message,
    ...(kind === undefined ? {} : { kind }),
    ...(thinkAfterMs === undefined ? {} : { thinkAfterMs }),
    ...(expectToolCode === undefined ? {} : { expectToolCode }),
    ...(note === undefined ? {} : { note })
  };
}

function parseKind(value: unknown, label: string): SmokeTurnKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "web_sync" || value === "web_stream") return value;
  throw new Error(`${label} must be "web_sync" or "web_stream", got ${JSON.stringify(value)}.`);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}
