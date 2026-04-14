import assert from "node:assert/strict";
import {
  resolveTelegramOutboundChatAction,
  resolveTelegramToolChatAction
} from "../src/modules/workspace-management/application/telegram-chat-actions";

assert.equal(
  resolveTelegramToolChatAction({
    toolName: "tts",
    phase: "start",
    isError: false
  }),
  "record_voice"
);

assert.equal(
  resolveTelegramToolChatAction({
    toolName: "video_generate",
    phase: "start",
    isError: false
  }),
  "record_video"
);

assert.equal(
  resolveTelegramToolChatAction({
    toolName: "image_generate",
    phase: "start",
    isError: false
  }),
  "upload_photo"
);

assert.equal(
  resolveTelegramToolChatAction({
    toolName: "tts",
    phase: "end",
    isError: false
  }),
  "typing"
);

assert.equal(
  resolveTelegramOutboundChatAction([
    {
      source: "persai_object_storage",
      objectKey: "assistant-media/video.mp4",
      type: "video",
      mimeType: "video/mp4",
      filename: "video.mp4",
      sizeBytes: 123
    }
  ]),
  "upload_video"
);

assert.equal(
  resolveTelegramOutboundChatAction([
    {
      source: "persai_object_storage",
      objectKey: "assistant-media/reply.ogg",
      type: "audio",
      mimeType: "audio/ogg",
      filename: "reply.ogg",
      sizeBytes: 64,
      audioAsVoice: true
    }
  ]),
  "upload_voice"
);

assert.equal(
  resolveTelegramOutboundChatAction([
    {
      source: "persai_object_storage",
      objectKey: "assistant-media/image.png",
      type: "image",
      mimeType: "image/png",
      filename: "image.png",
      sizeBytes: 42
    }
  ]),
  "upload_photo"
);

assert.equal(
  resolveTelegramOutboundChatAction([
    {
      source: "persai_object_storage",
      objectKey: "assistant-media/file.bin",
      type: "document",
      mimeType: "application/octet-stream",
      filename: "file.bin",
      sizeBytes: 11
    }
  ]),
  "upload_document"
);

console.log("telegram chat action mapping tests passed");
