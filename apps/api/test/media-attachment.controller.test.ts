import assert from "node:assert/strict";
import { MediaAttachmentController } from "../src/modules/workspace-management/interface/http/media-attachment.controller";

class FakeResponse {
  statusCode = 200;
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
  let deletedWorkspaceFileInput: Record<string, unknown> | null = null;
  const controller = new MediaAttachmentController(
    {
      async deleteWorkspaceFile(input: Record<string, unknown>) {
        deletedWorkspaceFileInput = input;
      }
    } as never,
    {
      async downloadChatFileByPath(input: { path: string; chatId: string }) {
        assert.equal(input.chatId, "chat-1");
        assert.equal(input.path, "/shared/out/recommendations.md");
        return {
          buffer: Buffer.from("Привет\n", "utf8"),
          contentType: "text/markdown",
          mimeType: "text/markdown",
          originalFilename: "рекомендации.md"
        };
      }
    } as never,
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
    } as never,
    {} as never,
    {
      assistantChat: {
        findFirst: async () => ({ id: "chat-1", assistantId: "assistant-1" })
      }
    } as never
  );

  const req = { resolvedAppUser: { id: "user-1" }, requestId: "req-1" };
  const downloadResponse = new FakeResponse();
  await controller.downloadChatFile(
    req as never,
    downloadResponse as never,
    "chat-1",
    "/shared/out/recommendations.md",
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
  await controller.downloadChatFile(
    req as never,
    inlineResponse as never,
    "chat-1",
    "/shared/out/recommendations.md",
    undefined
  );
  assert.equal(inlineResponse.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(
    inlineResponse.headers.get("Content-Disposition"),
    "inline; filename=\"____________.md\"; filename*=UTF-8''%D1%80%D0%B5%D0%BA%D0%BE%D0%BC%D0%B5%D0%BD%D0%B4%D0%B0%D1%86%D0%B8%D0%B8.md"
  );
  assert.equal(inlineResponse.body!.toString("utf8"), "Привет\n");

  const controllerWithOctetStorageType = new MediaAttachmentController(
    {} as never,
    {
      async downloadChatFileByPath() {
        return {
          buffer: Buffer.from([1, 2, 3]),
          contentType: "application/octet-stream",
          mimeType: "video/mp4",
          originalFilename: "clip.mp4"
        };
      }
    } as never,
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
      async execute() {
        throw new Error("not used");
      }
    } as never,
    {} as never,
    {
      assistantChat: {
        findFirst: async () => ({ id: "chat-1", assistantId: "assistant-1" })
      }
    } as never
  );
  const octetResponse = new FakeResponse();
  await controllerWithOctetStorageType.downloadChatFile(
    req as never,
    octetResponse as never,
    "chat-1",
    "/shared/out/clip.mp4",
    "1"
  );
  assert.equal(octetResponse.headers.get("Content-Type"), "video/mp4");

  await assert.doesNotReject(() =>
    controller.deleteWorkspaceFile(req as never, "workspace-1", "/shared/outbound/self/orphan.txt")
  );
  assert.deepEqual(deletedWorkspaceFileInput, {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    path: "/shared/outbound/self/orphan.txt"
  });

  await assert.rejects(
    controller.deleteWorkspaceFile(req as never, "workspace-2", "/shared/outbound/self/orphan.txt"),
    { name: "ForbiddenException" }
  );
  await assert.rejects(
    controller.deleteWorkspaceFile(req as never, "workspace-1", "/workspace/scratch.txt"),
    { name: "BadRequestException" }
  );
  await assert.rejects(
    controller.deleteWorkspaceFile({} as never, "workspace-1", "/shared/outbound/self/orphan.txt"),
    { name: "UnauthorizedException" }
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
