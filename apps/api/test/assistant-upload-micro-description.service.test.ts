import assert from "node:assert/strict";
import { AssistantUploadMicroDescriptionService } from "../src/modules/workspace-management/application/assistant-upload-micro-description.service";

async function run(): Promise<void> {
  const service = new AssistantUploadMicroDescriptionService(
    {} as never,
    {} as never,
    {} as never,
    {} as never
  ) as unknown as {
    buildUserContent(input: {
      mimeType: string;
      filename: string | null;
      sizeBytes: number;
      buffer: Buffer;
    }): unknown;
  };

  const underLimit = service.buildUserContent({
    mimeType: "image/png",
    filename: "image-under-limit.png",
    sizeBytes: 4 * 1024 * 1024,
    buffer: Buffer.alloc(16, 1)
  });
  assert.notEqual(underLimit, null);

  const overLimit = service.buildUserContent({
    mimeType: "image/png",
    filename: "image-over-limit.png",
    sizeBytes: 4 * 1024 * 1024 + 1,
    buffer: Buffer.alloc(16, 1)
  });
  assert.equal(overLimit, null);
}

void run();
