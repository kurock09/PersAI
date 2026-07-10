import type {
  LocalBrowserCommand,
  LocalBrowserResult,
  RuntimeBrowserOperation
} from "./contract.js";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  EXECUTOR_ERROR_REASON,
  NEEDS_USER_ACTION_REASON,
  PERMISSION_DENIED_REASON,
  RECONNECT_BACKOFF_MS,
  UNSUPPORTED_PDF_REASON,
  UNSUPPORTED_SCREENSHOT_REASON
} from "./constants.js";

const USER_CHECKPOINT_TEXT_RE =
  /(captcha|recaptcha|hcaptcha|cf-chl|verify you are human|confirm you are human|checking your browser|verification code|enter (?:the )?(?:security )?code|one[-\s]?time (?:password|code)|otp|2fa|3-d secure|3ds challenge|капча|подтвердите,? что вы не робот|проверка,? что вы не робот|код подтверждения|одноразовый код|код из смс|смс-код)/i;
const SENSITIVE_OPERATION_RE =
  /(pay[-_\s]?now|checkout|place[-_\s]?order|confirm[-_\s]?(?:order|purchase|payment)|purchase[-_\s]?now|card[-_\s]?number|cvv|security[-_\s]?code|verification[-_\s]?code|otp|3-d secure|3ds|оплатить|перейти к оплате|оформить заказ|подтвердить заказ|номер карты|код подтверждения|код из смс|смс-код)/i;

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

export function buildNeedsUserActionResult(
  commandId: string,
  detail?: string | null
): LocalBrowserResult {
  return buildErrorResult(
    commandId,
    NEEDS_USER_ACTION_REASON,
    mergeWarnings("A user-only browser checkpoint was detected.", detail) ?? undefined
  );
}

export function shouldSurfaceNeedsUserAction(input: {
  pageText?: string | null;
  operations?: RuntimeBrowserOperation[] | null;
}): boolean {
  const pageText = input.pageText ?? "";
  if (USER_CHECKPOINT_TEXT_RE.test(pageText)) {
    return true;
  }
  for (const operation of input.operations ?? []) {
    if (operation.kind === "click_at") {
      continue;
    }
    const selectorText = "selector" in operation ? String(operation.selector ?? "") : "";
    if (SENSITIVE_OPERATION_RE.test(selectorText)) {
      return true;
    }
    if (operation.kind === "type" && SENSITIVE_OPERATION_RE.test(operation.text)) {
      return true;
    }
    if (operation.kind === "press" && SENSITIVE_OPERATION_RE.test(operation.key)) {
      return true;
    }
    if (operation.kind === "select_option" && SENSITIVE_OPERATION_RE.test(operation.value)) {
      return true;
    }
  }
  return false;
}
