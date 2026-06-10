"use client";

import type {
  AssistantLiveVoiceClientConfigState,
  AssistantLiveVoiceSessionStartState,
  AssistantLiveVoiceSessionState,
  AssistantLiveVoiceTransportState
} from "@persai/contracts";

export type LiveVoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "working"
  | "recovering"
  | "stopping"
  | "error"
  | "unavailable";

export type LiveVoiceTransport = "direct-webrtc" | "direct-websocket" | "relay-websocket";

export type LiveVoiceError = {
  code: string;
  message: string;
};

export type {
  AssistantLiveVoiceClientConfigState,
  AssistantLiveVoiceSessionStartState,
  AssistantLiveVoiceSessionState,
  AssistantLiveVoiceTransportState
};

export function isLiveVoiceUnavailableCode(code: string | null | undefined): boolean {
  if (typeof code !== "string" || code.trim().length === 0) {
    return false;
  }
  const normalized = code.trim().toLowerCase();
  return normalized.includes("live_voice") && normalized.includes("unavailable");
}

export function deriveLiveVoiceTransport(
  transport: AssistantLiveVoiceTransportState,
  clientConfig: AssistantLiveVoiceClientConfigState,
  preferRelay: boolean
): LiveVoiceTransport | null {
  if (preferRelay) {
    return "relay-websocket";
  }
  if (transport.protocol === "webrtc" && clientConfig.connectionType === "webrtc") {
    return "direct-webrtc";
  }
  if (clientConfig.connectionType === "websocket") {
    return "direct-websocket";
  }
  return null;
}
