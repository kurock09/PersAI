import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { ManageChatMediaService } from "../src/modules/workspace-management/application/manage-chat-media.service";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";

const assistant: Assistant = {
  id: "assistant-1",
  userId: "user-1",
  workspaceId: "workspace-1",
  draftDisplayName: null,
  draftInstructions: null,
  draftTraits: null,
  draftAvatarEmoji: null,
  draftAvatarUrl: null,
  draftAssistantGender: null,
  draftUpdatedAt: null,
  applyStatus: "succeeded",
  applyTargetVersionId: null,
  applyAppliedVersionId: null,
  applyRequestedAt: null,
  applyStartedAt: null,
  applyFinishedAt: null,
  applyErrorCode: null,
  applyErrorMessage: null,
  configDirtyAt: null,
  createdAt: new Date("2026-04-06T00:00:00.000Z"),
  updatedAt: new Date("2026-04-06T00:00:00.000Z")
};

async function run(): Promise<void> {
  const uploadCalls: Array<{ assistantId: string; runtimeTier: string; chatId: string }> = [];
  const deleteBatchCalls: Array<{ assistantId: string; chatId: string; runtimeTier: string }> = [];
  const metrics = new PlatformHttpMetricsService();

  const service = new ManageChatMediaService(
    {
      async findByUserId(userId: string) {
        return userId === "user-1" ? assistant : null;
      }
    } as never,
    {} as never,
    {} as never,
    {
      async uploadChatMedia(input: {
        assistantId: string;
        runtimeTier: string;
        chatId: string;
        messageId: string;
        fileBuffer: Buffer;
        mimeType: string;
      }) {
        uploadCalls.push({
          assistantId: input.assistantId,
          runtimeTier: input.runtimeTier,
          chatId: input.chatId
        });
        return {
          storagePath: `${input.chatId}/${input.messageId}.mp3`,
          sizeBytes: input.fileBuffer.length,
          mimeType: input.mimeType
        };
      },
      async transcribeMedia() {
        return { text: "  transcribed speech  " };
      },
      async deleteChatMediaBatch(assistantId: string, chatId: string, runtimeTier: string) {
        deleteBatchCalls.push({ assistantId, chatId, runtimeTier });
      }
    } as never,
    {} as never,
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never,
    {} as never,
    metrics
  );

  const first = await service.transcribeVoice({
    userId: "user-1",
    file: {
      buffer: Buffer.from("voice-one"),
      mimetype: "audio/mpeg",
      originalname: "voice-1.mp3"
    }
  });
  const second = await service.transcribeVoice({
    userId: "user-1",
    file: {
      buffer: Buffer.from("voice-two"),
      mimetype: "audio/mpeg",
      originalname: "voice-2.mp3"
    }
  });

  assert.equal(first.text, "transcribed speech");
  assert.equal(second.text, "transcribed speech");
  assert.equal(uploadCalls.length, 2);
  assert.equal(deleteBatchCalls.length, 2);
  assert.ok(uploadCalls[0]?.chatId.startsWith("_voice_tmp_"));
  assert.ok(uploadCalls[1]?.chatId.startsWith("_voice_tmp_"));
  assert.notEqual(uploadCalls[0]?.chatId, uploadCalls[1]?.chatId);
  assert.deepEqual(
    deleteBatchCalls.map((call) => call.chatId),
    uploadCalls.map((call) => call.chatId)
  );
  const successSeries = metrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "stt_transcribe" &&
        series.key.channel === "voice_http" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 2);

  const emptyMetrics = new PlatformHttpMetricsService();
  const emptyResultService = new ManageChatMediaService(
    {
      async findByUserId() {
        return assistant;
      }
    } as never,
    {} as never,
    {} as never,
    {
      async uploadChatMedia(input: {
        assistantId: string;
        runtimeTier: string;
        chatId: string;
        messageId: string;
        fileBuffer: Buffer;
        mimeType: string;
      }) {
        return {
          storagePath: `${input.chatId}/${input.messageId}.mp3`,
          sizeBytes: input.fileBuffer.length,
          mimeType: input.mimeType
        };
      },
      async transcribeMedia() {
        return { text: "   " };
      },
      async deleteChatMediaBatch() {}
    } as never,
    {} as never,
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never,
    {} as never,
    emptyMetrics
  );

  await assert.rejects(
    () =>
      emptyResultService.transcribeVoice({
        userId: "user-1",
        file: {
          buffer: Buffer.from("voice-three"),
          mimetype: "audio/mpeg",
          originalname: "voice-3.mp3"
        }
      }),
    (error) =>
      error instanceof BadRequestException &&
      error.message === "Voice transcription returned empty text. Please try again."
  );
  const failureSeries = emptyMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "stt_transcribe" &&
        series.key.channel === "voice_http" &&
        series.key.outcome === "failure"
    );
  assert.equal(failureSeries?.count, 1);
}

void run();
