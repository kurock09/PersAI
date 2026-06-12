import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { MediaPreprocessorService } from "../src/modules/workspace-management/application/media/media-preprocessor.service";

async function run(): Promise<void> {
  const transcriptionCalls: Array<{ buffer: Buffer; mimeType: string; filename: string | null }> =
    [];
  const metrics = new PlatformHttpMetricsService();
  const noopPdfTextExtractor = {
    async extractText() {
      return null;
    }
  } as never;

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
    metrics,
    noopPdfTextExtractor
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
    new PlatformHttpMetricsService(),
    noopPdfTextExtractor
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
    failingMetrics,
    noopPdfTextExtractor
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

  const pdfFallbackCalls: Array<{ buffer: Buffer; filename: string | null }> = [];
  const pdfFallbackService = new MediaPreprocessorService(
    {
      async transcribe() {
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: "unused",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    new PlatformHttpMetricsService(),
    {
      async extractText(input: { buffer: Buffer; filename: string | null }) {
        pdfFallbackCalls.push(input);
        return "  OCR heading\nVisible label  ";
      }
    } as never
  );
  (
    pdfFallbackService as unknown as {
      extractPdfText(buffer: Buffer): Promise<string | null>;
    }
  ).extractPdfText = async () => null;

  const pdfFallback = await pdfFallbackService.process(
    Buffer.from("fake-pdf"),
    "application/pdf",
    "Самокат.pdf",
    { enableDocumentVisualFallback: true }
  );
  assert.equal(pdfFallback.textExtract, "OCR heading\nVisible label");
  assert.equal(pdfFallbackCalls.length, 1);
  assert.equal(pdfFallbackCalls[0]?.filename, "Самокат.pdf");

  const noFallbackCalls: Array<{ buffer: Buffer; filename: string | null }> = [];
  const noFallbackService = new MediaPreprocessorService(
    {
      async transcribe() {
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: "unused",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    new PlatformHttpMetricsService(),
    {
      async extractText(input: { buffer: Buffer; filename: string | null }) {
        noFallbackCalls.push(input);
        return "ignored";
      }
    } as never
  );
  (
    noFallbackService as unknown as {
      extractPdfText(buffer: Buffer): Promise<string | null>;
    }
  ).extractPdfText = async () => null;

  const noFallback = await noFallbackService.process(
    Buffer.from("fake-pdf"),
    "application/pdf",
    "diagram.pdf"
  );
  assert.equal(noFallback.textExtract, null);
  assert.equal(noFallbackCalls.length, 0);

  const videoService = new MediaPreprocessorService(
    {} as never,
    new PlatformHttpMetricsService(),
    noopPdfTextExtractor
  );
  (
    videoService as unknown as {
      extractAudioFromVideo: (buffer: Buffer) => Promise<Buffer | null>;
      transcribeAudio: (
        buffer: Buffer,
        mime: string,
        originalFilename: string
      ) => Promise<{
        transcription: string | null;
        billingFacts: Record<string, unknown> | null;
      }>;
    }
  ).extractAudioFromVideo = async () => Buffer.from("fake-audio-track");
  (
    videoService as unknown as {
      transcribeAudio: (
        buffer: Buffer,
        mime: string,
        originalFilename: string
      ) => Promise<{
        transcription: string | null;
        billingFacts: Record<string, unknown> | null;
      }>;
    }
  ).transcribeAudio = async (_buffer: Buffer, mime: string, originalFilename: string) => {
    assert.equal(mime, "audio/mpeg");
    assert.equal(originalFilename, "video-audio.mp3");
    return {
      transcription: "hello from video",
      billingFacts: {
        providerKey: "openai",
        modelKey: "gpt-4o-mini-transcribe",
        capability: "speech_to_text",
        occurredAt: "2026-05-05T09:05:00.000Z",
        metering: {
          meteringKind: "time_metered",
          durationMs: 5400,
          durationSeconds: 5.4
        }
      }
    };
  };

  const processedVideo = await videoService.process(
    Buffer.from("fake-video"),
    "video/mp4",
    "clip.mp4"
  );
  assert.equal(processedVideo.normalizedMime, "video/mp4");
  assert.equal(processedVideo.normalizedExtension, "mp4");
  assert.equal(processedVideo.transcription, "hello from video");
  assert.deepEqual(processedVideo.billingFacts, {
    providerKey: "openai",
    modelKey: "gpt-4o-mini-transcribe",
    capability: "speech_to_text",
    occurredAt: "2026-05-05T09:05:00.000Z",
    metering: {
      meteringKind: "time_metered",
      durationMs: 5400,
      durationSeconds: 5.4
    }
  });

  await runImageProcessingTests();
}

async function runImageProcessingTests(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require("sharp") as typeof import("sharp");
  const noopPdfTextExtractor = {
    async extractText() {
      return null;
    }
  } as never;
  const imageService = new MediaPreprocessorService(
    {
      async transcribe() {
        return {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: "unused",
          respondedAt: "2026-04-12T12:00:01.000Z"
        };
      }
    } as never,
    new PlatformHttpMetricsService(),
    noopPdfTextExtractor
  );

  const oversizedJpeg = await sharp({
    create: {
      width: 4000,
      height: 3000,
      channels: 3,
      background: { r: 200, g: 100, b: 50 }
    }
  })
    .jpeg({ quality: 100 })
    .toBuffer();
  const oversizedResult = await imageService.process(oversizedJpeg, "image/jpeg", "big.jpg");
  assert.equal(oversizedResult.normalizedMime, "image/jpeg");
  assert.equal(oversizedResult.normalizedExtension, "jpg");
  assert.equal(oversizedResult.width, 4000);
  assert.equal(oversizedResult.height, 3000);
  assert.ok(
    oversizedResult.normalizedBuffer.length < oversizedJpeg.length,
    "oversized JPEG should be smaller after normalization"
  );

  const portraitWithExif = await sharp({
    create: {
      width: 200,
      height: 100,
      channels: 3,
      background: { r: 0, g: 128, b: 255 }
    }
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const portraitResult = await imageService.process(portraitWithExif, "image/jpeg", "portrait.jpg");
  assert.equal(portraitResult.width, 100, "EXIF orientation 6 should swap width to short side");
  assert.equal(portraitResult.height, 200, "EXIF orientation 6 should swap height to long side");
  const portraitMeta = await sharp(portraitResult.normalizedBuffer).metadata();
  assert.equal(
    portraitMeta.orientation ?? 1,
    1,
    "EXIF orientation tag should be stripped after rotation"
  );

  const transparentPng = await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .png()
    .toBuffer();
  const pngResult = await imageService.process(transparentPng, "image/png", "alpha.png");
  assert.equal(pngResult.normalizedMime, "image/png");
  assert.equal(pngResult.normalizedExtension, "png");
  const pngMeta = await sharp(pngResult.normalizedBuffer).metadata();
  assert.equal(pngMeta.format, "png", "PNG should keep its format to preserve transparency");
  assert.equal(pngMeta.channels, 4, "PNG alpha channel should survive normalization");

  // Smallest possible single-frame GIF (89a, 1×1 transparent). The pipeline
  // must NOT touch GIF buffers so animation survives end-to-end.
  const singleFrameGif = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b
  ]);
  const gifResult = await imageService.process(singleFrameGif, "image/gif", "anim.gif");
  assert.equal(gifResult.normalizedMime, "image/gif");
  assert.equal(gifResult.normalizedExtension, "gif");
  assert.equal(
    gifResult.normalizedBuffer,
    singleFrameGif,
    "GIF buffer must pass through unchanged to preserve animation"
  );

  // Untouched-size JPEG should still be re-encoded so EXIF rotation always
  // lands and quality settles on q85 — the original buffer must change.
  const smallHeavyJpeg = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 10, g: 200, b: 10 }
    }
  })
    .jpeg({ quality: 100 })
    .toBuffer();
  const smallResult = await imageService.process(smallHeavyJpeg, "image/jpeg", "small.jpg");
  assert.equal(smallResult.width, 800);
  assert.equal(smallResult.height, 600);
  assert.ok(
    smallResult.normalizedBuffer.length < smallHeavyJpeg.length,
    "small high-quality JPEG should shrink at q85 mozjpeg"
  );
}

void run();
