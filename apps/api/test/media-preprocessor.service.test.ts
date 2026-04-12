import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { MediaPreprocessorService } from "../src/modules/workspace-management/application/media/media-preprocessor.service";

type UploadCall = {
  assistantId: string;
  runtimeTier: string;
  chatId: string;
  messageId: string;
  fileBuffer: Buffer;
  mimeType: string;
};

async function run(): Promise<void> {
  const uploadCalls: UploadCall[] = [];
  const deleteBatchCalls: Array<{ assistantId: string; chatId: string; runtimeTier: string }> = [];
  const metrics = new PlatformHttpMetricsService();

  const service = new MediaPreprocessorService(
    {
      async uploadChatMedia(input: UploadCall) {
        uploadCalls.push(input);
        return {
          storagePath: `${input.chatId}/${input.messageId}.mp3`,
          sizeBytes: input.fileBuffer.length,
          mimeType: input.mimeType
        };
      },
      async transcribeMedia() {
        return { text: "  hello from stt  " };
      },
      async deleteChatMediaBatch(assistantId: string, chatId: string, runtimeTier: string) {
        deleteBatchCalls.push({ assistantId, chatId, runtimeTier });
      }
    } as never,
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never,
    metrics
  );

  const first = await service.process(
    Buffer.from("audio-one"),
    "audio/mpeg",
    "voice-1.mp3",
    "assistant-1"
  );
  const second = await service.process(
    Buffer.from("audio-two"),
    "audio/mpeg",
    "voice-2.mp3",
    "assistant-1"
  );

  assert.equal(first.transcription, "hello from stt");
  assert.equal(second.transcription, "hello from stt");
  assert.equal(uploadCalls.length, 2);
  assert.equal(deleteBatchCalls.length, 2);
  assert.ok(uploadCalls[0]?.chatId.startsWith("_stt_tmp_"));
  assert.ok(uploadCalls[1]?.chatId.startsWith("_stt_tmp_"));
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
        series.key.channel === "preprocessor" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 2);

  const failureDeleteCalls: string[] = [];
  const failingMetrics = new PlatformHttpMetricsService();
  const failingService = new MediaPreprocessorService(
    {
      async uploadChatMedia(input: UploadCall) {
        return {
          storagePath: `${input.chatId}/${input.messageId}.mp3`,
          sizeBytes: input.fileBuffer.length,
          mimeType: input.mimeType
        };
      },
      async transcribeMedia() {
        throw new Error("stt unavailable");
      },
      async deleteChatMediaBatch(_assistantId: string, chatId: string) {
        failureDeleteCalls.push(chatId);
      }
    } as never,
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never,
    failingMetrics
  );

  const failed = await failingService.process(
    Buffer.from("audio-three"),
    "audio/mpeg",
    "voice-3.mp3",
    "assistant-1"
  );

  assert.equal(failed.transcription, null);
  assert.equal(failureDeleteCalls.length, 1);
  assert.ok(failureDeleteCalls[0]?.startsWith("_stt_tmp_"));
  const failureSeries = failingMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "stt_transcribe" &&
        series.key.channel === "preprocessor" &&
        series.key.outcome === "failure"
    );
  assert.equal(failureSeries?.count, 1);

  (
    service as unknown as {
      extractWordText(buffer: Buffer): Promise<string | null>;
      extractSpreadsheetText(buffer: Buffer): Promise<string | null>;
    }
  ).extractWordText = async () => "first paragraph\nsecond paragraph";
  (
    service as unknown as {
      extractWordText(buffer: Buffer): Promise<string | null>;
      extractSpreadsheetText(buffer: Buffer): Promise<string | null>;
    }
  ).extractSpreadsheetText = async () => "Sheet \"Budget\"\nmonth,amount\nApr,42";

  const docx = await service.process(
    Buffer.from("fake-docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "notes.docx",
    "assistant-1"
  );
  assert.equal(docx.textExtract, "first paragraph\nsecond paragraph");
  assert.equal(docx.normalizedExtension, "docx");

  const spreadsheet = await service.process(
    Buffer.from("fake-xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "budget.xlsx",
    "assistant-1"
  );
  assert.equal(spreadsheet.textExtract, 'Sheet "Budget"\nmonth,amount\nApr,42');
  assert.equal(spreadsheet.normalizedExtension, "xlsx");
}

void run();
