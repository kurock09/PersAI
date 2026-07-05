import assert from "node:assert/strict";
import { test } from "node:test";
import { writeRuntimeOutboundArtifact } from "../src/modules/turns/write-runtime-outbound-artifact";

test("writeRuntimeOutboundArtifact upserts manifest after GCS save", async () => {
  let upserted = false;
  const artifact = await writeRuntimeOutboundArtifact({
    mediaObjectStorage: {
      buildWorkspaceObjectKey: (input: { workspaceId: string; workspaceRelPath: string }) =>
        `workspaces/${input.workspaceId}/${input.workspaceRelPath}`,
      saveObject: async (input: { buffer: Buffer; mimeType: string }) => ({
        objectKey: "saved",
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType
      })
    } as never,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    buffer: Buffer.from("image-bytes"),
    mimeType: "image/png",
    slugSourceText: "marketing poster",
    filenameHint: "poster.png",
    kind: "image",
    sourceToolCode: "image_generate",
    manifest: {
      persaiInternalApiClient: {
        async sumWorkspaceFileStorageBytes() {
          return 0;
        },
        async upsertWorkspaceFileMetadata(input) {
          upserted = true;
          assert.equal(
            input.path.startsWith("/workspace/assistants/assistant-1/sessions/session-1/"),
            true
          );
          assert.equal(input.mimeType, "image/png");
          assert.equal(input.sizeBytes, 11);
          assert.equal(input.originChatId, "chat-1");
          return { documentRegistration: null };
        }
      },
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      originChatId: "chat-1",
      sourceUserMessageText: "draw a poster",
      sourceUserMessageCreatedAt: "2026-07-05T00:00:00.000Z"
    },
    quota: {
      workspaceQuotaBytes: 1_000_000,
      sharedQuotaBytes: null
    }
  });

  assert.equal(upserted, true);
  assert.equal(artifact.mimeType, "image/png");
  assert.equal(artifact.sizeBytes, 11);
});

test("writeRuntimeOutboundArtifact rejects writes over workspace quota", async () => {
  await assert.rejects(
    () =>
      writeRuntimeOutboundArtifact({
        mediaObjectStorage: {
          buildWorkspaceObjectKey: () => "key",
          saveObject: async () => {
            throw new Error("should not save when quota blocks");
          }
        } as never,
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        buffer: Buffer.alloc(200),
        mimeType: "image/png",
        slugSourceText: "poster",
        filenameHint: null,
        kind: "image",
        sourceToolCode: "image_generate",
        manifest: {
          persaiInternalApiClient: {
            async sumWorkspaceFileStorageBytes() {
              return 900;
            },
            async upsertWorkspaceFileMetadata() {
              return { documentRegistration: null };
            }
          },
          workspaceId: "workspace-1",
          assistantId: "assistant-1"
        },
        quota: {
          workspaceQuotaBytes: 1000,
          sharedQuotaBytes: null
        }
      }),
    /workspace_quota_exhausted/
  );
});
