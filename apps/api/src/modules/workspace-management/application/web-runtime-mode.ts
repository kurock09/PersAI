import { loadApiConfig } from "@persai/config";

export type WebChatRuntimeMode = "legacy" | "shadow" | "native";

export function getWebChatSyncRuntimeMode(): WebChatRuntimeMode {
  return loadApiConfig(process.env).PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE;
}

export function getWebChatStreamRuntimeMode(): WebChatRuntimeMode {
  return loadApiConfig(process.env).PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE;
}
