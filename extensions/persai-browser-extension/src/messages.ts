import type {
  LocalBrowserBridgeDeviceRegisterRequest,
  LocalBrowserBridgeDeviceRegisterResult
} from "./contract.js";

export interface RegisterDeviceFromWebMessage {
  type: "persai.bridge.register_device_request";
  apiBaseUrl: string;
  bearerToken: string;
  payload: LocalBrowserBridgeDeviceRegisterRequest;
}

export interface RegisterDeviceResultFromWebMessage {
  type: "persai.bridge.register_device_result";
  apiBaseUrl?: string | null;
  payload: LocalBrowserBridgeDeviceRegisterResult & {
    assistantId: string;
    workspaceId: string;
    deviceLabel?: string | null;
    clientVersion?: string | null;
  };
}

export interface BridgeStatusRequestMessage {
  type: "persai.bridge.status";
  /**
   * When provided, the background worker also reports (and consumes) any
   * pending Готово/Отмена completion action recorded for this profile from
   * the extension action popup.
   */
  profileKey?: string | null;
}

export type WebBridgeRequestMessage =
  | RegisterDeviceFromWebMessage
  | RegisterDeviceResultFromWebMessage
  | BridgeStatusRequestMessage;

export interface WebBridgeEnvelope {
  source: "persai-browser-extension";
  requestId: string;
  payload: WebBridgeRequestMessage;
}

export interface WebBridgeResponseEnvelope {
  source: "persai-browser-extension";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
