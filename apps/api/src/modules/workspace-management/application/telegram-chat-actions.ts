import type { RuntimeMediaArtifact } from "./assistant-runtime.facade";

export type TelegramChatAction =
  | "typing"
  | "upload_photo"
  | "record_video"
  | "upload_video"
  | "record_voice"
  | "upload_voice"
  | "upload_document";

export function resolveTelegramToolChatAction(params: {
  toolName: string;
  phase: "start" | "end";
  isError: boolean;
}): TelegramChatAction {
  if (params.phase === "end" || params.isError) {
    return "typing";
  }

  switch (params.toolName) {
    case "tts":
      return "record_voice";
    case "video_generate":
      return "record_video";
    case "image_generate":
    case "image_edit":
      return "upload_photo";
    default:
      return "typing";
  }
}

export function resolveTelegramOutboundChatAction(
  media: RuntimeMediaArtifact[]
): TelegramChatAction {
  if (media.some((item) => item.type === "video")) {
    return "upload_video";
  }
  if (media.some((item) => item.type === "audio" && item.audioAsVoice === true)) {
    return "upload_voice";
  }
  if (media.some((item) => item.type === "image")) {
    return "upload_photo";
  }
  if (media.some((item) => item.type === "audio" || item.type === "document")) {
    return "upload_document";
  }
  return "typing";
}
