/**
 * ADR-164 — mid-loop wire hygiene: spill oversized tool args/results to
 * session `.tool-spill/`, keep first-seen result full, then demote older
 * oversized results to short receipts (path + summary) once a newer exchange
 * is appended. Args stub immediately after success.
 *
 * “Append full” (ADR-161) means every tool-call ↔ tool-result pair stays on the
 * wire with honest status; it does not mean replaying multi‑MB JSON each round.
 *
 * P2: one receipt projector; demote summaries use tool-aware hints from parseable
 * result JSON (shell/browser/files/fetch/grep/glob/script) without dual serializers.
 * P3: field-aware arg stubs cover content/text/prompt/outline/instructions/input;
 * huge seriesItems → whole-args spill.
 * P4: persisted receipts stay receipts on prior replay (no spill re-expand).
 */

import { createHash } from "node:crypto";
import {
  buildAssistantSessionRoot,
  sanitizeWorkspacePathSegment,
  type ProviderGatewayToolExchange
} from "@persai/runtime-contract";

/** Serialized tool-result JSON or retained tool-call arguments above this → spill. */
export const TOOL_WIRE_SOFT_MAX_CHARS = 8000;

/** Human/model skim inside a receipt (chars). */
export const TOOL_RECEIPT_SUMMARY_MAX_CHARS = 2000;

/** Field-aware arg stub targets when present as oversized strings. */
const FIELD_AWARE_ARG_KEYS = [
  "content",
  "text",
  "prompt",
  "stdout",
  "stderr",
  "outline",
  "instructions",
  "input"
] as const;

export type ToolSpillKind = "args" | "result" | "both";

export type ToolSpillReceipt = {
  status: "ok" | "error";
  tool: string;
  action?: string;
  chars: number;
  bytes: number;
  path: string;
  summary: string;
  sha256?: string;
  truncated: true;
  spillKind: ToolSpillKind;
};

/** Seal metadata for a spilled exchange; resultPath present ⇒ demotable later. */
export type ToolSpillSealMeta = {
  toolCallId: string;
  tool: string;
  isError: boolean;
  action?: string;
  spillKind: ToolSpillKind;
  argsPath?: string;
  resultPath?: string;
  resultChars?: number;
  resultBytes?: number;
  resultSha256?: string;
};

export type ToolSpillWriteFn = (input: {
  path: string;
  content: string;
}) => Promise<{ sha256: string; bytes: number }>;

export type SealToolExchangeSpillContext = {
  assistantStableKey: string;
  sessionId: string;
  requestId: string;
  writeSpill: ToolSpillWriteFn;
};

export function exceedsToolWireSoftMax(serialized: string): boolean {
  return serialized.length > TOOL_WIRE_SOFT_MAX_CHARS;
}

export function buildToolSpillPath(input: {
  assistantStableKey: string;
  sessionId: string;
  requestId: string;
  toolCallId: string;
  direction: "in" | "out";
  ext: string;
}): string {
  const sessionRoot = buildAssistantSessionRoot(input.assistantStableKey, input.sessionId);
  const requestSeg = sanitizeWorkspacePathSegment(input.requestId);
  const callSeg = sanitizeWorkspacePathSegment(input.toolCallId);
  const ext = input.ext.replace(/^\./, "").replace(/[^A-Za-z0-9._-]+/g, "") || "txt";
  return `${sessionRoot}/.tool-spill/${requestSeg}/${callSeg}.${input.direction}.${ext}`;
}

export function summarizeSpillBody(
  body: string,
  maxChars: number = TOOL_RECEIPT_SUMMARY_MAX_CHARS
): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized.length > 0 ? normalized : "[empty]";
  }
  const headBudget = Math.max(0, maxChars - 48);
  return `${normalized.slice(0, headBudget)}…[summary truncated ${String(normalized.length - headBudget)} chars]`;
}

export function buildToolSpillReceipt(input: {
  status: "ok" | "error";
  tool: string;
  action?: string | null;
  chars: number;
  bytes: number;
  path: string;
  summarySource: string;
  sha256?: string | null;
  spillKind: ToolSpillKind;
}): ToolSpillReceipt {
  const receipt: ToolSpillReceipt = {
    status: input.status,
    tool: input.tool,
    chars: input.chars,
    bytes: input.bytes,
    path: input.path,
    summary: summarizeSpillBody(input.summarySource),
    truncated: true,
    spillKind: input.spillKind
  };
  if (typeof input.action === "string" && input.action.length > 0) {
    receipt.action = input.action;
  }
  if (typeof input.sha256 === "string" && input.sha256.length > 0) {
    receipt.sha256 = input.sha256;
  }
  return receipt;
}

/** True when content is already an ADR-164 spill receipt (avoid double-demote). */
export function isToolSpillReceiptContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return (
      parsed.truncated === true &&
      typeof parsed.path === "string" &&
      parsed.path.length > 0 &&
      (parsed.spillKind === "args" ||
        parsed.spillKind === "result" ||
        parsed.spillKind === "both")
    );
  } catch {
    return false;
  }
}

function extractOptionalAction(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const action = (value as Record<string, unknown>).action;
  return typeof action === "string" && action.length > 0 ? action : null;
}

function detectSpillExtension(body: string): string {
  const trimmed = body.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // fall through
    }
  }
  return "txt";
}

function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function spilledFieldStub(spillPath: string, chars: number): Record<string, unknown> {
  return {
    __spilled_field: true,
    path: spillPath,
    chars
  };
}

function wholeArgsSpillStub(input: {
  spillPath: string;
  chars: number;
  argumentsValue: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    __spilled_args: true,
    path: input.spillPath,
    chars: input.chars,
    ...(typeof input.argumentsValue.action === "string"
      ? { action: input.argumentsValue.action }
      : {})
  };
}

/**
 * Field-aware stub for known large body keys; otherwise whole-args spill marker.
 * Keeps tool call name/id; oversized string fields become path refs.
 * Huge `seriesItems` arrays (or oversized object `input`) force whole-args spill.
 */
export function stubOversizedToolArguments(input: {
  argumentsValue: Record<string, unknown>;
  spillPath: string;
  chars: number;
}): Record<string, unknown> {
  const seriesItems = input.argumentsValue.seriesItems;
  if (Array.isArray(seriesItems)) {
    const seriesSerialized = JSON.stringify(seriesItems);
    if (exceedsToolWireSoftMax(seriesSerialized)) {
      return wholeArgsSpillStub(input);
    }
  }

  const args = { ...input.argumentsValue };
  let replacedField = false;
  for (const key of FIELD_AWARE_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.length > TOOL_WIRE_SOFT_MAX_CHARS) {
      args[key] = spilledFieldStub(input.spillPath, value.length);
      replacedField = true;
      continue;
    }
    // script `input` is typically an object; spill the field when it alone is huge
    if (
      key === "input" &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const serialized = JSON.stringify(value);
      if (exceedsToolWireSoftMax(serialized)) {
        args[key] = spilledFieldStub(input.spillPath, serialized.length);
        replacedField = true;
      }
    }
  }
  if (replacedField && !exceedsToolWireSoftMax(JSON.stringify(args))) {
    return args;
  }
  return wholeArgsSpillStub(input);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function firstLineOf(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const line = normalized.split("\n").find((entry) => entry.trim().length > 0);
  return line === undefined ? "" : line.trim();
}

function joinSummaryParts(parts: Array<string | null | undefined>): string | null {
  const filtered = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  return filtered.length > 0 ? filtered.join("; ") : null;
}

/**
 * Pure helper: tool-aware summary source for receipts when demoting oversized
 * results. Prefers stable hints from parseable result JSON; falls back to body
 * (with error prefix). Does not change first-seen-full seal behavior.
 */
export function buildToolAwareSummarySource(
  tool: string,
  resultContent: string,
  isError: boolean
): string {
  const toolCode = tool.trim().toLowerCase();
  const errorPrefix = isError ? `error from ${tool}: ` : "";
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asRecord(JSON.parse(resultContent) as unknown);
  } catch {
    parsed = null;
  }

  if (parsed === null) {
    return `${errorPrefix}${resultContent}`;
  }

  let hint: string | null = null;

  if (toolCode === "shell" || toolCode === "exec") {
    const job = asRecord(parsed.job) ?? parsed;
    const exitCode =
      asFiniteNumber(job.exitCode) ?? asFiniteNumber(parsed.exitCode);
    const stdout = asNonEmptyString(job.stdout) ?? asNonEmptyString(parsed.stdout);
    const stderr = asNonEmptyString(job.stderr) ?? asNonEmptyString(parsed.stderr);
    const stdoutBytes =
      stdout === null ? 0 : Buffer.byteLength(stdout, "utf8");
    const stderrBytes =
      stderr === null ? 0 : Buffer.byteLength(stderr, "utf8");
    const firstLine =
      stdout !== null
        ? firstLineOf(stdout)
        : stderr !== null
          ? firstLineOf(stderr)
          : "";
    hint = joinSummaryParts([
      exitCode !== null ? `exitCode=${String(exitCode)}` : null,
      `stdoutBytes=${String(stdoutBytes)}`,
      `stderrBytes=${String(stderrBytes)}`,
      firstLine.length > 0 ? `firstLine=${firstLine}` : null
    ]);
  } else if (toolCode === "browser") {
    const page = asRecord(parsed.page);
    const finalUrl =
      asNonEmptyString(parsed.finalUrl) ??
      (page === null ? null : asNonEmptyString(page.finalUrl));
    const title =
      asNonEmptyString(parsed.title) ??
      (page === null ? null : asNonEmptyString(page.title));
    const elements = page === null ? parsed.elements : page.elements;
    const elementCount = Array.isArray(elements)
      ? elements.length
      : (asFiniteNumber(parsed.elementCount) ??
        (page === null ? null : asFiniteNumber(page.elementCount)));
    hint = joinSummaryParts([
      finalUrl !== null ? `finalUrl=${finalUrl}` : null,
      title !== null ? `title=${title}` : null,
      elementCount !== null ? `elementCount=${String(elementCount)}` : null
    ]);
  } else if (toolCode === "files") {
    const item = asRecord(parsed.item);
    const path =
      asNonEmptyString(parsed.path) ??
      (item === null ? null : asNonEmptyString(item.path));
    const content = asNonEmptyString(parsed.content);
    const chars =
      asFiniteNumber(parsed.charCount) ??
      asFiniteNumber(parsed.chars) ??
      (content === null ? null : content.length);
    hint = joinSummaryParts([
      path !== null ? `path=${path}` : null,
      chars !== null ? `chars=${String(chars)}` : null,
      asNonEmptyString(parsed.action) !== null
        ? `action=${asNonEmptyString(parsed.action)}`
        : null
    ]);
  } else if (toolCode === "web_fetch" || toolCode === "knowledge_fetch") {
    const url = asNonEmptyString(parsed.url);
    const referenceId = asNonEmptyString(parsed.referenceId);
    const content =
      asNonEmptyString(parsed.content) ??
      asNonEmptyString(parsed.text) ??
      asNonEmptyString(parsed.document);
    const chars =
      asFiniteNumber(parsed.charCount) ??
      asFiniteNumber(parsed.chars) ??
      (content === null ? null : content.length);
    hint = joinSummaryParts([
      url !== null ? `url=${url}` : null,
      referenceId !== null ? `referenceId=${referenceId}` : null,
      chars !== null ? `chars=${String(chars)}` : null
    ]);
  } else if (toolCode === "grep") {
    const matchCount =
      asFiniteNumber(parsed.matchCount) ??
      (Array.isArray(parsed.matches) ? parsed.matches.length : null);
    const truncated = parsed.truncated === true;
    hint = joinSummaryParts([
      matchCount !== null ? `matchCount=${String(matchCount)}` : null,
      truncated ? "truncated=true" : "truncated=false"
    ]);
  } else if (toolCode === "glob") {
    const pathCount =
      asFiniteNumber(parsed.pathCount) ??
      (Array.isArray(parsed.paths) ? parsed.paths.length : null);
    const truncated = parsed.truncated === true;
    hint = joinSummaryParts([
      pathCount !== null ? `pathCount=${String(pathCount)}` : null,
      truncated ? "truncated=true" : "truncated=false"
    ]);
  } else if (toolCode === "script" || toolCode.startsWith("script.")) {
    const scriptKey = asNonEmptyString(parsed.scriptKey);
    const status =
      asNonEmptyString(parsed.status) ?? asNonEmptyString(parsed.action);
    hint = joinSummaryParts([
      scriptKey !== null ? `scriptKey=${scriptKey}` : null,
      status !== null ? `status=${status}` : null
    ]);
  }

  if (hint === null) {
    return `${errorPrefix}${resultContent}`;
  }
  return `${errorPrefix}${hint}`;
}

function resolveToolCallId(exchange: ProviderGatewayToolExchange): string {
  return exchange.toolCall.id || exchange.toolResult.toolCallId;
}

function resolveToolName(exchange: ProviderGatewayToolExchange): string {
  return exchange.toolCall.name || exchange.toolResult.name;
}

function buildResultReceiptFromSeal(
  exchange: ProviderGatewayToolExchange,
  seal: ToolSpillSealMeta
): string | null {
  if (typeof seal.resultPath !== "string" || seal.resultPath.length === 0) {
    return null;
  }
  const content =
    typeof exchange.toolResult.content === "string" ? exchange.toolResult.content : "";
  if (isToolSpillReceiptContent(content)) {
    return null;
  }
  const receipt = buildToolSpillReceipt({
    status: seal.isError ? "error" : "ok",
    tool: seal.tool,
    ...(seal.action !== undefined ? { action: seal.action } : {}),
    chars: seal.resultChars ?? content.length,
    bytes: seal.resultBytes ?? Buffer.byteLength(content, "utf8"),
    path: seal.resultPath,
    summarySource: buildToolAwareSummarySource(seal.tool, content, seal.isError),
    ...(seal.resultSha256 !== undefined ? { sha256: seal.resultSha256 } : {}),
    spillKind: seal.spillKind === "args" ? "result" : seal.spillKind
  });
  return JSON.stringify(receipt);
}

function demoteExchangeResultToReceipt(
  exchange: ProviderGatewayToolExchange,
  sealsByCallId: Map<string, ToolSpillSealMeta>
): void {
  const toolCallId = resolveToolCallId(exchange);
  const seal = sealsByCallId.get(toolCallId);
  if (seal === undefined) {
    return;
  }
  const receiptContent = buildResultReceiptFromSeal(exchange, seal);
  if (receiptContent === null) {
    return;
  }
  exchange.toolResult.content = receiptContent;
}

/**
 * Spill oversized args/results at finalize time.
 * - Args over threshold → spill + stub args on the exchange immediately.
 * - Result over threshold → spill body to disk but keep FULL result content;
 *   return seal meta so later demote can replace with a receipt.
 * - Under threshold → no-op (same exchange ref, null seal).
 */
export async function sealToolExchangeSpill(
  exchange: ProviderGatewayToolExchange,
  ctx: SealToolExchangeSpillContext
): Promise<{ exchange: ProviderGatewayToolExchange; seal: ToolSpillSealMeta | null }> {
  const toolName = resolveToolName(exchange);
  const toolCallId = resolveToolCallId(exchange);
  const isError = exchange.toolResult.isError === true;
  const originalArgs = exchange.toolCall.arguments ?? {};
  const serializedArgs = JSON.stringify(originalArgs);
  const resultContent =
    typeof exchange.toolResult.content === "string" ? exchange.toolResult.content : "";
  const argsOver = exceedsToolWireSoftMax(serializedArgs);
  const resultOver = exceedsToolWireSoftMax(resultContent);

  if (!argsOver && !resultOver) {
    return { exchange, seal: null };
  }

  let nextArgs = originalArgs;
  let argsPath: string | undefined;

  if (argsOver) {
    argsPath = buildToolSpillPath({
      assistantStableKey: ctx.assistantStableKey,
      sessionId: ctx.sessionId,
      requestId: ctx.requestId,
      toolCallId,
      direction: "in",
      ext: "json"
    });
    try {
      await ctx.writeSpill({
        path: argsPath,
        content: serializedArgs
      });
    } catch {
      // Spill write is best-effort for hash; stub still points at the path.
    }
    nextArgs = stubOversizedToolArguments({
      argumentsValue: originalArgs,
      spillPath: argsPath,
      chars: serializedArgs.length
    });
  }

  let resultPath: string | undefined;
  let resultChars: number | undefined;
  let resultBytes: number | undefined;
  let resultSha256: string | undefined;
  let action: string | undefined;

  if (resultOver) {
    resultPath = buildToolSpillPath({
      assistantStableKey: ctx.assistantStableKey,
      sessionId: ctx.sessionId,
      requestId: ctx.requestId,
      toolCallId,
      direction: "out",
      ext: detectSpillExtension(resultContent)
    });
    resultChars = resultContent.length;
    resultBytes = Buffer.byteLength(resultContent, "utf8");
    try {
      const written = await ctx.writeSpill({
        path: resultPath,
        content: resultContent
      });
      resultSha256 = written.sha256;
      resultBytes = written.bytes;
    } catch {
      resultSha256 = sha256Utf8(resultContent);
    }

    let parsedAction: string | null = null;
    try {
      parsedAction = extractOptionalAction(JSON.parse(resultContent) as unknown);
    } catch {
      parsedAction = extractOptionalAction(originalArgs);
    }
    if (parsedAction !== null) {
      action = parsedAction;
    }
  } else {
    const argsAction = extractOptionalAction(originalArgs);
    if (argsAction !== null) {
      action = argsAction;
    }
  }

  const spillKind: ToolSpillKind =
    argsOver && resultOver ? "both" : argsOver ? "args" : "result";

  const seal: ToolSpillSealMeta = {
    toolCallId,
    tool: toolName,
    isError,
    spillKind,
    ...(action !== undefined ? { action } : {}),
    ...(argsPath !== undefined ? { argsPath } : {}),
    ...(resultPath !== undefined &&
    resultChars !== undefined &&
    resultBytes !== undefined
      ? {
          resultPath,
          resultChars,
          resultBytes,
          ...(resultSha256 !== undefined ? { resultSha256 } : {})
        }
      : {})
  };

  return {
    exchange: {
      ...exchange,
      toolCall: {
        id: exchange.toolCall.id,
        name: exchange.toolCall.name,
        arguments: nextArgs
      },
      toolResult: {
        toolCallId: exchange.toolResult.toolCallId,
        name: exchange.toolResult.name,
        // First-seen: keep full oversized result; demote later.
        content: resultContent,
        isError
      }
    },
    seal
  };
}

/**
 * Demote sealed oversized results that are strictly older than the current
 * unsent tool wave. Mutates exchanges in place (shared refs in toolHistory +
 * turnState.toolExchanges).
 *
 * `preserveFromIndex` is the history index where the current provider tool_calls
 * wave began. Exchanges at/after that index stay full until the model has seen
 * them (founder first-seen rule). Omitting it preserves only the newest entry
 * (legacy single-tool demote).
 */
export function demoteOlderToolExchangesToReceipts(
  history: ProviderGatewayToolExchange[],
  sealsByCallId: Map<string, ToolSpillSealMeta>,
  preserveFromIndex?: number
): void {
  const cutoff =
    typeof preserveFromIndex === "number" && Number.isFinite(preserveFromIndex)
      ? Math.max(0, Math.min(Math.floor(preserveFromIndex), history.length))
      : Math.max(0, history.length - 1);
  for (let index = 0; index < cutoff; index += 1) {
    const exchange = history[index];
    if (exchange === undefined) {
      continue;
    }
    demoteExchangeResultToReceipt(exchange, sealsByCallId);
  }
}

/**
 * Turn-end: demote every sealed oversized result (including the last) so the
 * next user turn never revives multi‑MB blobs from persisted toolExchanges.
 */
export function demoteAllToolExchangesToReceipts(
  history: ProviderGatewayToolExchange[],
  sealsByCallId: Map<string, ToolSpillSealMeta>
): void {
  for (const exchange of history) {
    demoteExchangeResultToReceipt(exchange, sealsByCallId);
  }
}
