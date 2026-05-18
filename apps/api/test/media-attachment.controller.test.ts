import assert from "node:assert/strict";
import { MediaAttachmentController } from "../src/modules/workspace-management/interface/http/media-attachment.controller";

class FakeResponse {
  statusCode = 0;
  headers = new Map<string, string | number | readonly string[]>();
  body: Buffer | null = null;

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.headers.set(name, value);
  }

  end(body: Buffer): void {
    this.body = body;
  }
}

async function run(): Promise<void> {
  const controller = new MediaAttachmentController(
    {} as never,
    {
      async execute(userId: string) {
        assert.equal(userId, "user-1");
        return {
          id: "assistant-1",
          workspaceId: "workspace-1"
        };
      }
    } as never,
    {
      async downloadAssistantFile() {
        return {
          file: {
            displayName: "рекомендации.md"
          },
          buffer: Buffer.from("Привет\n", "utf8"),
          contentType: "text/markdown"
        };
      }
    } as never,
    {
      async downloadOriginalPresentation() {
        return {
          buffer: Buffer.from("pptx-bytes"),
          contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          filename: "deck-original.pptx"
        };
      }
    } as never
  );

  const req = { resolvedAppUser: { id: "user-1" }, requestId: "req-1" };
  const downloadResponse = new FakeResponse();
  await controller.downloadAssistantFile(
    req as never,
    downloadResponse as never,
    "file-ref-1",
    "1"
  );
  assert.equal(downloadResponse.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(
    downloadResponse.headers.get("Content-Disposition"),
    "attachment; filename=\"____________.md\"; filename*=UTF-8''%D1%80%D0%B5%D0%BA%D0%BE%D0%BC%D0%B5%D0%BD%D0%B4%D0%B0%D1%86%D0%B8%D0%B8.md"
  );
  assert.deepEqual([...downloadResponse.body!.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(downloadResponse.body!.subarray(3).toString("utf8"), "Привет\n");

  const inlineResponse = new FakeResponse();
  await controller.downloadAssistantFile(
    req as never,
    inlineResponse as never,
    "file-ref-1",
    undefined
  );
  assert.equal(inlineResponse.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(
    inlineResponse.headers.get("Content-Disposition"),
    "inline; filename=\"____________.md\"; filename*=UTF-8''%D1%80%D0%B5%D0%BA%D0%BE%D0%BC%D0%B5%D0%BD%D0%B4%D0%B0%D1%86%D0%B8%D0%B8.md"
  );
  assert.equal(inlineResponse.body!.toString("utf8"), "Привет\n");

  const originalResponse = new FakeResponse();
  await controller.downloadOriginalPresentationDocument(
    req as never,
    originalResponse as never,
    "doc-1",
    "version-1"
  );
  assert.equal(
    originalResponse.headers.get("Content-Type"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
  assert.equal(
    originalResponse.headers.get("Content-Disposition"),
    "attachment; filename=\"deck-original.pptx\"; filename*=UTF-8''deck-original.pptx"
  );
  assert.equal(originalResponse.body!.toString("utf8"), "pptx-bytes");
}

void run();
