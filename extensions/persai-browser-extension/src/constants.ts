export const EXTENSION_DEVICE_KIND = "extension" as const;

export const PERSAI_WEB_ORIGIN_PATTERNS = [
  "https://persai.dev/*",
  "https://www.persai.dev/*",
  "http://localhost/*",
  "http://127.0.0.1/*"
] as const;

export const MAX_INTERACTIVE_ELEMENTS = 200;
export const MAX_EXTRACT_ITEMS = 50;
export const MAX_OPERATION_COUNT = 12;
export const MAX_DOM_READY_WAIT_MS = 10_000;
export const MAX_NAVIGATION_COMMIT_WAIT_MS = 30_000;
/** Inject + in-page DOM gate must not inherit the outer 45–120s command budget. */
export const MAX_PAGE_RUNNER_WAIT_MS = MAX_DOM_READY_WAIT_MS + 5_000;
export const COMMAND_TRANSPORT_RESERVE_MS = 5_000;
export const DEFAULT_SETTLE_AFTER_GOTO_MS = 3_000;
export const DEFAULT_MUTATION_SETTLE_MS = 800;
export const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
export const DEFAULT_MAX_CHARS = 12_000;
export const SOCKET_IDLE_CLOSE_REASON = "bridge_inactive";
export const UNSUPPORTED_PDF_REASON = "unsupported_pdf";
export const UNSUPPORTED_SCREENSHOT_REASON = "unsupported_screenshot";
export const PERMISSION_DENIED_REASON = "permission_denied";
export const EXECUTOR_ERROR_REASON = "bridge_executor_error";
export const BRIDGE_MESSAGE_SOURCE = "persai-browser-extension";

export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
