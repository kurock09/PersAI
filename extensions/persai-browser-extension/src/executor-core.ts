import type { LocalBrowserCommand, LocalBrowserResult } from "./contract.js";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  EXECUTOR_ERROR_REASON,
  PERMISSION_DENIED_REASON,
  RECONNECT_BACKOFF_MS,
  UNSUPPORTED_PDF_REASON,
  UNSUPPORTED_SCREENSHOT_REASON
} from "./constants.js";

export function computeReconnectDelayMs(attempt: number): number {
  const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return RECONNECT_BACKOFF_MS[Math.min(safeAttempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
}

export function normalizeCommandTimeout(command: LocalBrowserCommand): number {
  return Number.isInteger(command.timeoutMs) && Number(command.timeoutMs) > 0
    ? Number(command.timeoutMs)
    : DEFAULT_COMMAND_TIMEOUT_MS;
}

export function mergeWarnings(...warnings: Array<string | null | undefined>): string | null {
  const items = warnings
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return items.length > 0 ? items.join("; ") : null;
}

export function buildErrorResult(
  commandId: string,
  errorReason: string,
  warning?: string | null
): LocalBrowserResult {
  return {
    commandId,
    ok: false,
    errorReason,
    warning: warning ?? null
  };
}

export function buildPermissionDeniedResult(
  commandId: string,
  originPattern: string
): LocalBrowserResult {
  return buildErrorResult(
    commandId,
    PERMISSION_DENIED_REASON,
    `Host permission was denied for ${originPattern}.`
  );
}

export function buildUnsupportedPdfResult(commandId: string): LocalBrowserResult {
  return buildErrorResult(
    commandId,
    UNSUPPORTED_PDF_REASON,
    "Chrome extension PDF capture is not supported in this MVP."
  );
}

export function buildUnsupportedScreenshotResult(
  commandId: string,
  detail?: string | null
): LocalBrowserResult {
  return buildErrorResult(
    commandId,
    UNSUPPORTED_SCREENSHOT_REASON,
    mergeWarnings(
      "Chrome did not allow screenshot capture for this tab in the current extension state.",
      detail
    ) ?? undefined
  );
}

export function buildExecutorFailureResult(commandId: string, detail: string): LocalBrowserResult {
  return buildErrorResult(commandId, EXECUTOR_ERROR_REASON, detail);
}
