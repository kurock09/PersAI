/**
 * ADR-164 P1 — mid-loop wire hygiene: spill oversized tool args/results to
 * session `.tool-spill/`, keep first-seen result full, then demote older
 * oversized results to short receipts (path + summary) once a newer exchange
 * is appended. Args stub immediately after success.
 *
 * “Append full” (ADR-161) means every tool-call ↔ tool-result pair stays on the
 * wire with honest status; it does not mean replaying multi‑MB JSON each round.
 *
 * P2 note: `files.read` of spill (or any large file) is further bounded via this
 * same soft-max helper. Seal+demote already covers `files.read` results so a
 * huge read becomes a receipt after the next exchange (and at turn end).
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
  "instructions"
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

/**
 * Field-aware stub for known large body keys; otherwise whole-args spill marker.
 * Keeps tool call name/id; oversized string fields become path refs.
 */
export function stubOversizedToolArguments(input: {
  argumentsValue: Record<string, unknown>;
  spillPath: string;
  chars: number;
}): Record<string, unknown> {
  const args = { ...input.argumentsValue };
  let replacedField = false;
  for (const key of FIELD_AWARE_ARG_KEYS) {
    const value = args[key];
    if (typeof value !== "string" || value.length <= TOOL_WIRE_SOFT_MAX_CHARS) {
      continue;
    }
    args[key] = {
      __spilled_field: true,
      path: input.spillPath,
      chars: value.length
    };
    replacedField = true;
  }
  if (replacedField && !exceedsToolWireSoftMax(JSON.stringify(args))) {
    return args;
  }
  return {
    __spilled_args: true,
    path: input.spillPath,
    chars: input.chars,
    ...(typeof input.argumentsValue.action === "string"
      ? { action: input.argumentsValue.action }
      : {})
  };
}

function buildErrorAwareSummarySource(input: {
  body: string;
  isError: boolean;
  tool: string;
}): string {
  if (!input.isError) {
    return input.body;
  }
  const prefix = `error from ${input.tool}: `;
  return `${prefix}${input.body}`;
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
    summarySource: buildErrorAwareSummarySource({
      body: content,
      isError: seal.isError,
      tool: seal.tool
    }),
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
 * Demote all but the last exchange: oversized sealed results → receipt.
 * Mutates exchanges in place (shared refs in toolHistory + turnState.toolExchanges).
 */
export function demoteOlderToolExchangesToReceipts(
  history: ProviderGatewayToolExchange[],
  sealsByCallId: Map<string, ToolSpillSealMeta>
): void {
  if (history.length <= 1) {
    return;
  }
  for (let index = 0; index < history.length - 1; index += 1) {
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
