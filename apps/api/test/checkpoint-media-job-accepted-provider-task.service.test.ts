import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CheckpointMediaJobAcceptedProviderTaskService } from "../src/modules/workspace-management/application/checkpoint-media-job-accepted-provider-task.service";

function createService(overrides?: {
  job?: {
    id: string;
    status: string;
    requestJson: unknown;
  } | null;
  updateCount?: number;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    assistantMediaJob: {
      findUnique: async () => overrides?.job ?? null,
      updateMany: async (input: Record<string, unknown>) => {
        updates.push(input);
        return { count: overrides?.updateCount ?? 1 };
      }
    }
  };
  const service = new CheckpointMediaJobAcceptedProviderTaskService(prisma as never);
  return { service, updates };
}

describe("CheckpointMediaJobAcceptedProviderTaskService", () => {
  test("persists acceptedProviderTask into video_generate requestJson", async () => {
    const { service, updates } = createService({
      job: {
        id: "job-video-1",
        status: "running",
        requestJson: {
          directToolExecution: {
            toolCode: "video_generate",
            request: {
              prompt: "hello",
              seconds: 8
            }
          }
        }
      }
    });

    const result = await service.execute({
      mediaJobId: "job-video-1",
      acceptedProviderTask: {
        provider: "heygen",
        model: "heygen-photo-avatar-v3",
        providerTaskId: "vid-checkpoint-1",
        acceptedAt: "2026-06-13T12:00:00.000Z",
        providerStage: "accepted",
        taskKind: "talking_avatar"
      }
    });

    assert.equal(result.checkpointed, true);
    const requestJson = updates[0]?.data as { requestJson?: Record<string, unknown> };
    const direct = requestJson?.requestJson?.directToolExecution as {
      request?: { acceptedProviderTask?: { providerTaskId?: string } };
    };
    assert.equal(direct?.request?.acceptedProviderTask?.providerTaskId, "vid-checkpoint-1");
  });

  test("is idempotent when the same providerTaskId is already checkpointed", async () => {
    const { service, updates } = createService({
      job: {
        id: "job-video-2",
        status: "running",
        requestJson: {
          directToolExecution: {
            toolCode: "video_generate",
            request: {
              acceptedProviderTask: {
                provider: "heygen",
                model: "heygen-photo-avatar-v3",
                providerTaskId: "vid-checkpoint-2",
                acceptedAt: "2026-06-13T12:00:00.000Z",
                providerStage: "accepted"
              }
            }
          }
        }
      }
    });

    const result = await service.execute({
      mediaJobId: "job-video-2",
      acceptedProviderTask: {
        provider: "heygen",
        model: "heygen-photo-avatar-v3",
        providerTaskId: "vid-checkpoint-2",
        acceptedAt: "2026-06-13T12:00:00.000Z",
        providerStage: "accepted"
      }
    });

    assert.equal(result.checkpointed, false);
    assert.equal(updates.length, 0);
  });
});
