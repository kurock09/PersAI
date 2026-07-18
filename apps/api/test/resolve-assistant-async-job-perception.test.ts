import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ResolveAssistantAsyncJobService } from "../src/modules/workspace-management/application/resolve-assistant-async-job.service";

const OWNED = {
  jobRef: "jr1.media.abcdefghijklmnopqrstuvwxyz012345",
  assistantId: "assistant-1",
  workspaceId: "workspace-1",
  chatId: "chat-1",
  channel: "web" as const,
  threadKey: "thread-1"
};

function createService(prisma: {
  assistantAsyncJobHandle: {
    findFirst(input: unknown): Promise<{ canonicalJobId: string } | null>;
  };
  assistantMediaJob: {
    findUnique(input: unknown): Promise<{
      kind: string;
      artifactsJson: unknown;
    } | null>;
  };
}): ResolveAssistantAsyncJobService {
  return new ResolveAssistantAsyncJobService({} as never, prisma as never);
}

describe("ResolveAssistantAsyncJobService.executePerceptionArtifacts (ADR-157 D2)", () => {
  test("returns image output artifacts for an owned media handle", async () => {
    const service = createService({
      assistantAsyncJobHandle: {
        async findFirst() {
          return { canonicalJobId: "media-job-1" };
        }
      },
      assistantMediaJob: {
        async findUnique() {
          return {
            kind: "image",
            artifactsJson: [
              {
                storagePath: "assistant-media/a1/out.png",
                mimeType: "image/png",
                filename: "out.png"
              },
              {
                storagePath: "assistant-media/a1/notes.txt",
                mimeType: "text/plain",
                filename: "notes.txt"
              }
            ]
          };
        }
      }
    });

    const result = await service.executePerceptionArtifacts(OWNED);
    assert.deepEqual(result, {
      artifacts: [
        {
          storagePath: "assistant-media/a1/out.png",
          mimeType: "image/png",
          filename: "out.png",
          role: "output"
        }
      ]
    });
  });

  test("returns empty artifacts for malformed jobRef, max_ru, missing handle, or non-image jobs", async () => {
    const service = createService({
      assistantAsyncJobHandle: {
        async findFirst() {
          return { canonicalJobId: "media-job-1" };
        }
      },
      assistantMediaJob: {
        async findUnique() {
          return {
            kind: "video",
            artifactsJson: [
              {
                storagePath: "assistant-media/a1/out.mp4",
                mimeType: "video/mp4",
                filename: "out.mp4"
              }
            ]
          };
        }
      }
    });

    assert.deepEqual(await service.executePerceptionArtifacts({ ...OWNED, jobRef: "bad" }), {
      artifacts: []
    });
    assert.deepEqual(await service.executePerceptionArtifacts({ ...OWNED, channel: "max_ru" }), {
      artifacts: []
    });
    assert.deepEqual(await service.executePerceptionArtifacts(OWNED), { artifacts: [] });

    const missingHandle = createService({
      assistantAsyncJobHandle: {
        async findFirst() {
          return null;
        }
      },
      assistantMediaJob: {
        async findUnique() {
          throw new Error("must not load media job without handle");
        }
      }
    });
    assert.deepEqual(await missingHandle.executePerceptionArtifacts(OWNED), { artifacts: [] });
  });

  test("caps perception artifacts at 10 image outputs", async () => {
    const service = createService({
      assistantAsyncJobHandle: {
        async findFirst() {
          return { canonicalJobId: "media-job-many" };
        }
      },
      assistantMediaJob: {
        async findUnique() {
          return {
            kind: "image",
            artifactsJson: Array.from({ length: 15 }, (_, index) => ({
              storagePath: `assistant-media/a1/out-${index}.png`,
              mimeType: "image/png",
              filename: `out-${index}.png`
            }))
          };
        }
      }
    });

    const result = await service.executePerceptionArtifacts(OWNED);
    assert.equal(result.artifacts.length, 10);
    assert.equal(result.artifacts[0]?.storagePath, "assistant-media/a1/out-0.png");
    assert.equal(result.artifacts[9]?.storagePath, "assistant-media/a1/out-9.png");
  });
});
