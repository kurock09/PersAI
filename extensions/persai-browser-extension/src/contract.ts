export const LOCAL_BROWSER_COMMAND_ACTIONS = [
  "navigate",
  "snapshot",
  "act",
  "open_view",
  "close_view",
  "check_view"
] as const;

export type LocalBrowserCommandAction = (typeof LOCAL_BROWSER_COMMAND_ACTIONS)[number];
export type LocalBrowserBridgeDeviceKind = "extension" | "capacitor";
export type PersaiRuntimeBrowserSnapshotFormat = "text" | "png" | "jpeg" | "webp" | "pdf";

export interface RuntimeBrowserClickOperation {
  kind: "click";
  selector: string;
  matchIndex?: number | null;
}

export interface RuntimeBrowserClickAtOperation {
  kind: "click_at";
  x: number;
  y: number;
}

export interface RuntimeBrowserTypeOperation {
  kind: "type";
  selector: string;
  text: string;
  matchIndex?: number | null;
}

export interface RuntimeBrowserPressOperation {
  kind: "press";
  key: string;
}

export interface RuntimeBrowserSelectOptionOperation {
  kind: "select_option";
  selector: string;
  value: string;
  matchIndex?: number | null;
}

export interface RuntimeBrowserWaitForSelectorOperation {
  kind: "wait_for_selector";
  selector: string;
  timeoutMs: number | null;
  matchIndex?: number | null;
}

export interface RuntimeBrowserWaitForTimeoutOperation {
  kind: "wait_for_timeout";
  timeoutMs: number;
}

export interface RuntimeBrowserScrollOperation {
  kind: "scroll";
  selector: string | null;
  matchIndex?: number | null;
}

export interface RuntimeBrowserGotoOperation {
  kind: "goto";
  url: string;
}

export interface RuntimeBrowserHoverOperation {
  kind: "hover";
  selector: string;
  matchIndex?: number | null;
}

export interface RuntimeBrowserExtractOperation {
  kind: "extract";
  selector: string;
  maxItems?: number | null;
}

export type RuntimeBrowserOperation =
  | RuntimeBrowserClickOperation
  | RuntimeBrowserClickAtOperation
  | RuntimeBrowserTypeOperation
  | RuntimeBrowserPressOperation
  | RuntimeBrowserSelectOptionOperation
  | RuntimeBrowserWaitForSelectorOperation
  | RuntimeBrowserWaitForTimeoutOperation
  | RuntimeBrowserScrollOperation
  | RuntimeBrowserGotoOperation
  | RuntimeBrowserHoverOperation
  | RuntimeBrowserExtractOperation;

export interface RuntimeBrowserInteractiveElement {
  selector: string;
  tagName: string;
  text: string | null;
  role: string | null;
  type: string | null;
  href: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  disabled: boolean;
  matchIndex?: number | null;
}

export interface RuntimeBrowserExtractedItem {
  selector: string;
  tagName: string;
  text: string | null;
  href: string | null;
  ariaLabel: string | null;
  matchIndex?: number | null;
}

export interface LocalBrowserCommand {
  commandId: string;
  profileKey: string;
  action: LocalBrowserCommandAction;
  url?: string | null;
  stayOnPage?: boolean | null;
  operations?: RuntimeBrowserOperation[] | null;
  format?: PersaiRuntimeBrowserSnapshotFormat | null;
  optimizeForSpeed?: boolean | null;
  timeoutMs?: number | null;
  showWindow?: boolean | null;
}

export interface LocalBrowserArtifact {
  mimeType: string;
  base64: string;
}

export interface LocalBrowserResult {
  commandId: string;
  ok: boolean;
  finalUrl?: string | null;
  title?: string | null;
  loadStatus?: "stable" | "partial" | null;
  content?: string | null;
  truncated?: boolean | null;
  elements?: RuntimeBrowserInteractiveElement[] | null;
  extracted?: RuntimeBrowserExtractedItem[] | null;
  warning?: string | null;
  artifact?: LocalBrowserArtifact | null;
  errorReason?: string | null;
}

export interface LocalBrowserBridgeDeviceRegisterRequest {
  assistantId: string;
  workspaceId: string;
  deviceKind: LocalBrowserBridgeDeviceKind;
  bridgeDeviceId?: string | null;
  deviceLabel?: string | null;
  clientVersion?: string | null;
}

export interface LocalBrowserBridgeDeviceRegisterResult {
  bridgeDeviceId: string;
  deviceKind: LocalBrowserBridgeDeviceKind;
  deviceToken: string;
  websocketUrl: string;
}

export interface LocalBrowserBridgeWebSocketConnectRequest {
  assistantId: string;
  workspaceId: string;
  bridgeDeviceId: string;
  deviceKind: LocalBrowserBridgeDeviceKind;
  deviceToken: string;
}
