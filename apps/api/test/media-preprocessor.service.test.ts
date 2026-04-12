import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { MediaPreprocessorService } from "../src/modules/workspace-management/application/media/media-preprocessor.service";

async function run(): Promise<void> {
  const transcriptionCalls: Array<{ buffer: Buffer; mimeType: string; filename: string | null }> =
    [];
  const metrics = new PlatformHttpMetricsService();

  const service = new MediaPreprocessorService(
    {
      async transcribe(input: { buffer: Buffer; mimeType: string; filename: string | null }) {
        transcriptionCalls.push(input);
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: "  hello from stt  ",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    metrics
  );

  const first = await service.process(Buffer.from("audio-one"), "audio/mpeg", "voice-1.mp3");
  const second = await service.process(Buffer.from("audio-two"), "audio/mpeg", "voice-2.mp3");

  assert.equal(first.transcription, "hello from stt");
  assert.equal(second.transcription, "hello from stt");
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
        series.key.channel === "preprocessor" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 2);

  const convertedCalls: Array<{ buffer: Buffer; mimeType: string; filename: string | null }> = [];
  const convertedService = new MediaPreprocessorService(
    {
      async transcribe(input: { buffer: Buffer; mimeType: string; filename: string | null }) {
        convertedCalls.push(input);
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: " converted from webm ",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    new PlatformHttpMetricsService()
  );
  (
    convertedService as unknown as {
      convertAudioToMp3(buffer: Buffer): Promise<Buffer>;
    }
  ).convertAudioToMp3 = async () => Buffer.from("converted-audio");

  const converted = await convertedService.process(
    Buffer.from("audio-webm"),
    "audio/webm",
    "voice-note.webm"
  );
  assert.equal(converted.transcription, "converted from webm");
  assert.equal(convertedCalls.length, 1);
  assert.equal(convertedCalls[0]?.mimeType, "audio/mpeg");
  assert.equal(convertedCalls[0]?.filename, "voice-note.mp3");
  assert.deepEqual(convertedCalls[0]?.buffer, Buffer.from("converted-audio"));

  const failingMetrics = new PlatformHttpMetricsService();
  const failingService = new MediaPreprocessorService(
    {
      async transcribe() {
        throw new Error("stt unavailable");
      }
    } as never,
    failingMetrics
  );

  const failed = await failingService.process(
    Buffer.from("audio-three"),
    "audio/mpeg",
    "voice-3.mp3"
  );

  assert.equal(failed.transcription, null);
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
  ).extractSpreadsheetText = async () => 'Sheet "Budget"\nmonth,amount\nApr,42';

  const docx = await service.process(
    Buffer.from("fake-docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "notes.docx"
  );
  assert.equal(docx.textExtract, "first paragraph\nsecond paragraph");
  assert.equal(docx.normalizedExtension, "docx");

  const spreadsheet = await service.process(
    Buffer.from("fake-xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "budget.xlsx"
  );
  assert.equal(spreadsheet.textExtract, 'Sheet "Budget"\nmonth,amount\nApr,42');
  assert.equal(spreadsheet.normalizedExtension, "xlsx");
}

void run();
