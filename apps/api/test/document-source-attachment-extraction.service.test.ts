import assert from "node:assert/strict";
import { DocumentSourceAttachmentExtractionService } from "../src/modules/workspace-management/application/document-source-attachment-extraction.service";

async function run(): Promise<void> {
  await extractsSupportedSourcesThroughSharedDocumentExtraction();
  await skipsUnsupportedBinaryAttachments();
}

async function extractsSupportedSourcesThroughSharedDocumentExtraction(): Promise<void> {
  const downloadCalls: string[] = [];
  const extractionCalls: unknown[] = [];
  const service = new DocumentSourceAttachmentExtractionService(
    {
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        const relative = input.workspaceRelPath
          .replace(/^\/workspace\//, "")
          .replace(/^\/+/, "")
          .replace(/\\/g, "/");
        return `media/workspaces/${input.workspaceId}/workspace/${relative}`;
      },
      async downloadObject(objectKey: string) {
        downloadCalls.push(objectKey);
        return {
          buffer: Buffer.from("# Source\nReal extracted text", "utf8"),
          contentType: "text/markdown"
        };
      }
    } as never,
    {
      async extract(input: unknown) {
        extractionCalls.push(input);
        return {
          normalizedText: "Real extracted text",
          markdown: "# Source\nReal extracted text",
          provider: {
            providerKey: "local",
            processorMode: "local",
            attemptedProviderKeys: ["local"]
          },
          quality: {
            status: "ok",
            score: 0.8,
            reasonCodes: [],
            textChars: 19
          }
        };
      }
    } as never
  );

  const result = await service.extractSourceFiles({
    jobId: "job-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    attachments: [
      {
        attachmentId: "att-1",
        kind: "file",
        storagePath: "/workspace/outbound/self/source.md",
        mimeType: "text/markdown",
        displayName: "source.md",
        sizeBytes: 128
      }
    ]
  });

  assert.deepEqual(downloadCalls, [
    "media/workspaces/workspace-1/workspace/outbound/self/source.md"
  ]);
  assert.equal(extractionCalls.length, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.text, "Real extracted text");
  assert.equal(result[0]!.markdown, "# Source\nReal extracted text");
  assert.equal(result[0]!.note, null);
  assert.equal(result[0]!.provider?.providerKey, "local");
}

async function skipsUnsupportedBinaryAttachments(): Promise<void> {
  let downloadCalled = false;
  let extractionCalled = false;
  const service = new DocumentSourceAttachmentExtractionService(
    {
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        const relative = input.workspaceRelPath
          .replace(/^\/workspace\//, "")
          .replace(/^\/+/, "")
          .replace(/\\/g, "/");
        return `media/workspaces/${input.workspaceId}/workspace/${relative}`;
      },
      async downloadObject() {
        downloadCalled = true;
        return null;
      }
    } as never,
    {
      async extract() {
        extractionCalled = true;
        throw new Error("should not extract unsupported binaries");
      }
    } as never
  );

  const result = await service.extractSourceFiles({
    jobId: "job-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    attachments: [
      {
        attachmentId: "att-image",
        kind: "image",
        storagePath: "/workspace/outbound/self/photo.png",
        mimeType: "image/png",
        displayName: "photo.png",
        sizeBytes: 1024
      }
    ]
  });

  assert.equal(downloadCalled, false);
  assert.equal(extractionCalled, false);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.text, null);
  assert.match(result[0]!.note ?? "", /not a supported text\/document source/);
}

void run();
