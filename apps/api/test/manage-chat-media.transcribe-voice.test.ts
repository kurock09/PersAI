import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";

const noopRecordModelCostLedgerService = {
  async recordPersistedBillingFactsEvent() {
    return 0;
  }
} as never;

const noopSandboxControlPlaneClient = {
  isConfigured() {
    return false;
  },
  async pushWorkspaceInboundBytes() {
    return { mode: "deferred" as const, reason: "not_configured" as const };
  }
} as never;

const noopPrisma = {
  assistantVoiceTranscriptionEvent: {
    async create() {
      return { id: "voice-event-1", occurredAt: new Date() };
    }
  }
} as never;
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
  sandboxEgressMode: "restricted",
  createdAt: new Date("2026-04-06T00:00:00.000Z"),
  updatedAt: new Date("2026-04-06T00:00:00.000Z")
};

async function run(): Promise<void> {
  const transcriptionCalls: Array<{ buffer: Buffer; mimeType: string; filename: string | null }> =
    [];
  const metrics = new PlatformHttpMetricsService();

  const service = new ManageChatMediaService(
    {
      async execute({ userId }: { userId: string }) {
        if (userId !== "user-1") {
          throw new Error("assistant not found");
        }
        return { assistantId: assistant.id, assistant };
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      async transcribe(input: { buffer: Buffer; mimeType: string; filename: string | null }) {
        transcriptionCalls.push(input);
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: "  transcribed speech  ",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    metrics,
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
    noopPrisma
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
  assert.equal(transcriptionCalls.length, 2);
  assert.equal(transcriptionCalls[0]?.filename, "voice-1.mp3");
  assert.equal(transcriptionCalls[1]?.filename, "voice-2.mp3");
  assert.equal(transcriptionCalls[0]?.mimeType, "audio/mpeg");
  assert.equal(transcriptionCalls[1]?.mimeType, "audio/mpeg");
  const successSeries = metrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "stt_transcribe" &&
        series.key.channel === "voice_http" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 2);

  const convertedCalls: Array<{ buffer: Buffer; mimeType: string; filename: string | null }> = [];
  const convertedService = new ManageChatMediaService(
    {
      async execute() {
        return { assistantId: assistant.id, assistant };
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      async transcribe(input: { buffer: Buffer; mimeType: string; filename: string | null }) {
        convertedCalls.push(input);
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: " converted speech ",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new PlatformHttpMetricsService(),
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
    noopPrisma
  );
  (
    convertedService as unknown as {
      convertAudioToMp3(buffer: Buffer): Promise<Buffer>;
    }
  ).convertAudioToMp3 = async () => Buffer.from("converted-voice");

  const converted = await convertedService.transcribeVoice({
    userId: "user-1",
    file: {
      buffer: Buffer.from("voice-webm"),
      mimetype: "audio/webm",
      originalname: "voice-webm.webm"
    }
  });
  assert.equal(converted.text, "converted speech");
  assert.equal(convertedCalls.length, 1);
  assert.equal(convertedCalls[0]?.mimeType, "audio/mpeg");
  assert.equal(convertedCalls[0]?.filename, "voice-webm.mp3");
  assert.deepEqual(convertedCalls[0]?.buffer, Buffer.from("converted-voice"));

  const emptyMetrics = new PlatformHttpMetricsService();
  const emptyResultService = new ManageChatMediaService(
    {
      async execute() {
        return { assistantId: assistant.id, assistant };
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      async transcribe() {
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: "   ",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    emptyMetrics,
    noopRecordModelCostLedgerService,
    noopSandboxControlPlaneClient,
    noopPrisma
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
