import assert from "node:assert/strict";
import {
  MAX_MEDIA_FILE_BYTES,
  validatePersaiMediaFile
} from "../src/modules/workspace-management/application/media/media-security-policy";

async function run(): Promise<void> {
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d
  ]);

  const allowed = await validatePersaiMediaFile({
    buffer: pngBuffer,
    mimeType: "application/octet-stream",
    originalFilename: "image.png",
    surface: "chat_upload"
  });
  assert.equal(allowed.effectiveMimeType, "image/png");

  const repairedFilename = await validatePersaiMediaFile({
    buffer: pngBuffer,
    mimeType: "application/octet-stream",
    originalFilename: Buffer.from("Самокат.png", "utf8").toString("latin1"),
    surface: "chat_upload"
  });
  assert.equal(repairedFilename.originalFilename, "Самокат.png");

  const pptxLikeBuffer = Buffer.from("PK\x03\x04pptx");
  const allowedPptx = await validatePersaiMediaFile({
    buffer: pptxLikeBuffer,
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    originalFilename: "deck.pptx",
    surface: "tool_output_persist"
  });
  assert.equal(
    allowedPptx.effectiveMimeType,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );

  const oversizedPresentation = await validatePersaiMediaFile({
    buffer: Buffer.alloc(MAX_MEDIA_FILE_BYTES + 1024),
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    originalFilename: "large-deck.pptx",
    surface: "tool_output_persist"
  });
  assert.equal(
    oversizedPresentation.effectiveMimeType,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );

  await assert.rejects(
    () =>
      validatePersaiMediaFile({
        buffer: Buffer.alloc(MAX_MEDIA_FILE_BYTES + 1024),
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        originalFilename: "upload-deck.pptx",
        surface: "chat_upload"
      }),
    /File exceeds maximum size of 25MB/
  );

  await assert.rejects(
    () =>
      validatePersaiMediaFile({
        buffer: Buffer.from("evil"),
        mimeType: "application/octet-stream",
        originalFilename: "payload.bin",
        surface: "chat_upload"
      }),
    /Generic binary uploads are blocked|Unsupported or unsafe file type/
  );

  await assert.rejects(
    () =>
      validatePersaiMediaFile({
        buffer: Buffer.from("console.log('x')"),
        mimeType: "text/plain",
        originalFilename: "payload.js",
        surface: "chat_upload"
      }),
    /blocked by security policy/
  );
}

void run();
