/**
 * ADR-143 — tool-aware compact / mask reducers for model-facing observation
 * projection. Canonical stored exchanges stay full; only projected content
 * uses these helpers.
 */

import { isLikelyBinaryContent } from "./sanitize-tool-result-for-model";
import type { ToolObservationTier } from "./tool-observation-policy";

export const TOOL_OBSERVATION_STDOUT_TAIL_CHARS = 500;
export const TOOL_OBSERVATION_STDERR_TAIL_CHARS = 500;
export const TOOL_OBSERVATION_GENERIC_GIST_CHARS = 400;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function tailChars(value: string | null | undefined, maxChars: number): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  if (isLikelyBinaryContent(value)) {
    return "[binary content omitted]";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(-maxChars);
}

function resolveToolCode(toolName: string, parsed: JsonObject | null): string {
  const fromPayload = parsed === null ? null : asString(parsed.toolCode);
  if (typeof fromPayload === "string" && fromPayload.length > 0) {
    return fromPayload;
  }
  return toolName;
}

function parseContent(content: string): { parsed: JsonObject | null; raw: string } {
  if (isLikelyBinaryContent(content)) {
    return { parsed: null, raw: content };
  }
  try {
    const value = JSON.parse(content) as unknown;
    return { parsed: asObject(value), raw: content };
  } catch {
    return { parsed: null, raw: content };
  }
}

function browserOpsSummary(parsed: JsonObject): string | null {
  const action = asString(parsed.action);
  const requestedAction = asString(parsed.requestedAction);
  if (action !== null && requestedAction !== null && action !== requestedAction) {
    return `${requestedAction}→${action}`;
  }
  return action ?? requestedAction;
}

function compactBrowser(parsed: JsonObject, isError: boolean): JsonObject {
  const page = asObject(parsed.page);
  const elements = page === null ? null : page.elements;
  const extracted = page === null ? null : page.extracted;
  const elementCount = Array.isArray(elements) ? elements.length : 0;
  const extractedCount = Array.isArray(extracted) ? extracted.length : 0;
  const finalUrl = page === null ? null : asString(page.finalUrl);
  const title = page === null ? null : asString(page.title);
  const warning = asString(parsed.warning) ?? (page === null ? null : asString(page.warning));
  const reason = asString(parsed.reason);
  const truncated = page === null ? null : asBoolean(page.truncated);
  const opsSummary = browserOpsSummary(parsed);

  return {
    toolCode: "browser",
    ...(asString(parsed.executionMode) !== null
      ? { executionMode: asString(parsed.executionMode) }
      : {}),
    ...(asString(parsed.action) !== null ? { action: asString(parsed.action) } : {}),
    ...(asString(parsed.requestedAction) !== null
      ? { requestedAction: asString(parsed.requestedAction) }
      : {}),
    ...(opsSummary !== null ? { opsSummary } : {}),
    ...(finalUrl !== null ? { finalUrl } : {}),
    ...(title !== null ? { title } : {}),
    elementCount,
    extractedCount,
    ...(truncated !== null ? { truncated } : {}),
    ...(warning !== null ? { warning } : {}),
    ...(reason !== null ? { reason } : {}),
    ...(isError ? { isError: true } : {})
  };
}

function compactShellOrExec(parsed: JsonObject, toolCode: string, isError: boolean): JsonObject {
  const job = asObject(parsed.job);
  const exitCode = job === null ? null : asNumber(job.exitCode);
  const stdout = job === null ? null : asString(job.stdout);
  const stderr = job === null ? null : asString(job.stderr);
  const paths = asStringArray(parsed.paths) ?? [];
  const reason = asString(parsed.reason) ?? (job === null ? null : asString(job.reason));
  const warning = asString(parsed.warning) ?? (job === null ? null : asString(job.warning));
  const stdoutTail = tailChars(stdout, TOOL_OBSERVATION_STDOUT_TAIL_CHARS);
  const stderrTail =
    isError === true ? tailChars(stderr, TOOL_OBSERVATION_STDERR_TAIL_CHARS) : null;

  return {
    toolCode,
    ...(asString(parsed.executionMode) !== null
      ? { executionMode: asString(parsed.executionMode) }
      : {}),
    ...(asString(parsed.action) !== null ? { action: asString(parsed.action) } : {}),
    ...(reason !== null ? { reason } : {}),
    ...(warning !== null ? { warning } : {}),
    ...(exitCode !== null ? { exitCode } : {}),
    ...(stdoutTail !== null ? { stdoutTail } : {}),
    ...(stderrTail !== null ? { stderrTail } : {}),
    paths,
    ...(isError ? { isError: true } : {})
  };
}

function compactFiles(parsed: JsonObject, isError: boolean): JsonObject {
  const path =
    asString(parsed.path) ??
    (() => {
      const item = asObject(parsed.item);
      return item === null ? null : asString(item.path);
    })();
  const content = asString(parsed.content);
  const charCount = asNumber(parsed.charCount) ?? (content === null ? null : content.length);
  const truncated = asBoolean(parsed.truncated);

  return {
    toolCode: "files",
    ...(asString(parsed.executionMode) !== null
      ? { executionMode: asString(parsed.executionMode) }
      : {}),
    ...(asString(parsed.action) !== null ? { action: asString(parsed.action) } : {}),
    ...(asString(parsed.requestedAction) !== null
      ? { requestedAction: asString(parsed.requestedAction) }
      : {}),
    ...(path !== null ? { path } : {}),
    ...(charCount !== null ? { charCount } : {}),
    ...(truncated !== null ? { truncated } : {}),
    ...(asString(parsed.reason) !== null ? { reason: asString(parsed.reason) } : {}),
    ...(asString(parsed.warning) !== null ? { warning: asString(parsed.warning) } : {}),
    ...(isError ? { isError: true } : {})
  };
}

function compactGeneric(parsed: JsonObject | null, toolCode: string, isError: boolean): JsonObject {
  if (parsed === null) {
    return {
      toolCode,
      gist: "[non-json tool result omitted]",
      ...(isError ? { isError: true } : {})
    };
  }

  const gist: JsonObject = { toolCode };
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "toolCode") {
      continue;
    }
    if (typeof value === "string") {
      if (isLikelyBinaryContent(value)) {
        gist[key] = "[binary content omitted]";
        continue;
      }
      if (value.length > TOOL_OBSERVATION_GENERIC_GIST_CHARS) {
        gist[`${key}CharCount`] = value.length;
        gist[`${key}Tail`] = value.slice(-TOOL_OBSERVATION_GENERIC_GIST_CHARS);
        continue;
      }
      gist[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      gist[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      gist[`${key}Count`] = value.length;
      continue;
    }
    if (typeof value === "object") {
      gist[`${key}Present`] = true;
    }
  }
  if (isError) {
    gist.isError = true;
  }
  return gist;
}

function maskGist(params: {
  toolCode: string;
  parsed: JsonObject | null;
  isError: boolean;
}): string {
  const { toolCode, parsed, isError } = params;
  if (parsed === null) {
    return isError ? `[masked ${toolCode} observation: error]` : `[masked ${toolCode} observation]`;
  }

  const action = asString(parsed.action) ?? asString(parsed.requestedAction);
  const reason = asString(parsed.reason);
  const warning = asString(parsed.warning);
  const page = asObject(parsed.page);
  const finalUrl = page === null ? null : asString(page.finalUrl);
  const exitCode = (() => {
    const job = asObject(parsed.job);
    return job === null ? null : asNumber(job.exitCode);
  })();

  const parts: string[] = [`masked ${toolCode} observation`];
  if (action !== null) {
    parts.push(action);
  }
  if (isError) {
    parts.push("error");
  }
  if (reason !== null) {
    parts.push(`reason=${reason}`);
  } else if (warning !== null) {
    parts.push(`warning=${warning}`);
  }
  if (finalUrl !== null) {
    parts.push(`url=${finalUrl}`);
  }
  if (exitCode !== null) {
    parts.push(`exit=${String(exitCode)}`);
  }
  return `[${parts.join(": ")}]`;
}

/**
 * Produce compact or masked model-facing content for one tool result.
 * Caller is responsible for attaching `_observationTier`.
 */
export function compactOrMaskToolResultContent(params: {
  toolName: string;
  content: string;
  isError: boolean;
  tier: Exclude<ToolObservationTier, "full">;
}): JsonObject {
  const { parsed } = parseContent(params.content);
  const toolCode = resolveToolCode(params.toolName, parsed);

  if (params.tier === "masked") {
    return {
      toolCode,
      gist: maskGist({ toolCode, parsed, isError: params.isError }),
      ...(params.isError ? { isError: true } : {})
    };
  }

  if (toolCode === "browser") {
    if (parsed === null) {
      return compactGeneric(null, toolCode, params.isError);
    }
    return compactBrowser(parsed, params.isError);
  }
  if (toolCode === "shell" || toolCode === "exec") {
    if (parsed === null) {
      return compactGeneric(null, toolCode, params.isError);
    }
    return compactShellOrExec(parsed, toolCode, params.isError);
  }
  if (toolCode === "files") {
    if (parsed === null) {
      return compactGeneric(null, toolCode, params.isError);
    }
    return compactFiles(parsed, params.isError);
  }
  return compactGeneric(parsed, toolCode, params.isError);
}

/**
 * Attach the observation-tier marker onto an already-built projected payload.
 */
export function withObservationTierMarker(
  payload: JsonObject,
  tier: ToolObservationTier
): JsonObject {
  return {
    ...payload,
    _observationTier: tier
  };
}

/**
 * Pass through a full tool-result JSON object, preserving structure, and stamp
 * `_observationTier: "full"`. Non-JSON / binary content becomes a safe wrapper.
 */
export function projectFullToolResultPayload(content: string): JsonObject {
  if (isLikelyBinaryContent(content)) {
    return {
      content: "[binary content omitted]",
      _observationTier: "full"
    };
  }
  try {
    const value = JSON.parse(content) as unknown;
    const object = asObject(value);
    if (object !== null) {
      return withObservationTierMarker(object, "full");
    }
    return {
      value,
      _observationTier: "full"
    };
  } catch {
    return {
      content,
      _observationTier: "full"
    };
  }
}
