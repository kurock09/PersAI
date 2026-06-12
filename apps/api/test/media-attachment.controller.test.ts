import assert from "node:assert/strict";
import { getAttachmentDerivativeRefs } from "../src/modules/workspace-management/application/media/media.types";
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
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return {
          assistantId: "assistant-1",
          assistant: {
            id: "assistant-1",
            workspaceId: "workspace-1"
          }
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
      async execute(input: {
        assistantId: string;
        workspaceId: string;
        docId: string;
        versionId?: string | null;
      }) {
        assert.deepEqual(input, {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          docId: "doc-1",
          versionId: "version-1"
        });
        return {
          status: "queued" as const,
          docId: input.docId,
          versionId: input.versionId!,
          renderJobId: "render-pptx-1"
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

  const controllerWithoutDisplayName = new MediaAttachmentController(
    {} as never,
    {
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return {
          assistantId: "assistant-1",
          assistant: {
            id: "assistant-1",
            workspaceId: "workspace-1"
          }
        };
      }
    } as never,
    {
      async downloadAssistantFile() {
        return {
          file: {
            displayName: null,
            relativePath: "assistant-files/generated/friendly-name.mp4",
            mimeType: "video/mp4"
          },
          buffer: Buffer.from([1, 2, 3]),
          contentType: "video/mp4"
        };
      }
    } as never,
    {
      async execute() {
        throw new Error("not used");
      }
    } as never
  );
  const fallbackNameResponse = new FakeResponse();
  await controllerWithoutDisplayName.downloadAssistantFile(
    req as never,
    fallbackNameResponse as never,
    "file-ref-video-1",
    "1"
  );
  assert.equal(
    fallbackNameResponse.headers.get("Content-Disposition"),
    "attachment; filename=\"friendly-name.mp4\"; filename*=UTF-8''friendly-name.mp4"
  );

  const controllerWithOctetStorageType = new MediaAttachmentController(
    {} as never,
    {
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return {
          assistantId: "assistant-1",
          assistant: {
            id: "assistant-1",
            workspaceId: "workspace-1"
          }
        };
      }
    } as never,
    {
      async downloadAssistantFile() {
        return {
          file: {
            displayName: "clip.mp4",
            relativePath: "assistant-files/generated/clip.mp4",
            mimeType: "video/mp4"
          },
          buffer: Buffer.from([1, 2, 3]),
          contentType: "application/octet-stream"
        };
      }
    } as never,
    {
      async execute() {
        throw new Error("not used");
      }
    } as never
  );
  const octetResponse = new FakeResponse();
  await controllerWithOctetStorageType.downloadAssistantFile(
    req as never,
    octetResponse as never,
    "file-ref-video-octet",
    "1"
  );
  assert.equal(octetResponse.headers.get("Content-Type"), "video/mp4");

  assert.deepEqual(
    getAttachmentDerivativeRefs({
      thumbnailFileRef: " thumbnail-ref-1 ",
      posterFileRef: "poster-ref-1",
      derivativesStatus: "ready"
    }),
    {
      thumbnailFileRef: "thumbnail-ref-1",
      posterFileRef: "poster-ref-1",
      derivativesStatus: "ready"
    }
  );

  assert.deepEqual(
    await controller.preparePresentationPptx(req as never, "doc-1", { versionId: "version-1" }),
    {
      requestId: "req-1",
      status: "queued",
      docId: "doc-1",
      versionId: "version-1",
      renderJobId: "render-pptx-1"
    }
  );
}

void run();
