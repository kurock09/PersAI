import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../../../platform-core/application/platform-http-metrics.service";
import { ASSISTANT_RUNTIME_FACADE, type AssistantRuntimeFacade } from "../assistant-runtime.facade";
import { ResolveAssistantRuntimeTierService } from "../resolve-assistant-runtime-tier.service";
import type { PreprocessedMedia } from "./media.types";

const AUDIO_MIMES_NEEDING_CONVERSION = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/x-opus+ogg"
]);

const IMAGE_MIMES_NEEDING_CONVERSION = new Set(["image/heic", "image/heif"]);

const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
  "audio/x-opus+ogg",
  "audio/mp4",
  "audio/aac",
  "audio/flac"
]);

const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"]);

const WORD_DOCUMENT_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const SPREADSHEET_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const DOCUMENT_MIMES_WITH_EXTRACTION = new Set([
  "application/json",
  "application/pdf",
  ...WORD_DOCUMENT_MIMES,
  ...SPREADSHEET_MIMES
]);

const MAX_IMAGE_DIMENSION = 2048;
const MAX_TEXT_EXTRACT_CHARS = 50_000;

@Injectable()
export class MediaPreprocessorService {
  private readonly logger = new Logger(MediaPreprocessorService.name);

  constructor(
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService
  ) {}

  async process(
    buffer: Buffer,
    mime: string,
    originalFilename: string,
    assistantId: string
  ): Promise<PreprocessedMedia> {
    const normalizedMime = this.normalizeMime(mime);

    if (AUDIO_MIMES.has(normalizedMime)) {
      return this.processAudio(buffer, normalizedMime, originalFilename, assistantId);
    }
    if (normalizedMime.startsWith("image/")) {
      return this.processImage(buffer, normalizedMime);
    }
    if (VIDEO_MIMES.has(normalizedMime)) {
      return this.processVideo(buffer, normalizedMime, assistantId);
    }
    if (DOCUMENT_MIMES_WITH_EXTRACTION.has(normalizedMime) || normalizedMime.startsWith("text/")) {
      return this.processDocument(buffer, normalizedMime, originalFilename);
    }
    return this.passthrough(buffer, normalizedMime);
  }

  private async processAudio(
    buffer: Buffer,
    mime: string,
    originalFilename: string,
    assistantId: string
  ): Promise<PreprocessedMedia> {
    let normalizedBuffer = buffer;
    let normalizedMime = mime;
    let normalizedExtension = this.extensionForMime(mime);

    if (AUDIO_MIMES_NEEDING_CONVERSION.has(mime)) {
      try {
        const converted = await this.convertAudioToMp3(buffer);
        normalizedBuffer = converted;
        normalizedMime = "audio/mpeg";
        normalizedExtension = "mp3";
      } catch (err) {
        this.logger.warn(
          `Audio conversion failed for "${originalFilename}", keeping original format: ${String(err)}`
        );
      }
    }

    let transcription: string | null = null;
    try {
      transcription = await this.transcribeAudio(normalizedBuffer, normalizedMime, assistantId);
    } catch (err) {
      this.logger.warn(`STT failed for "${originalFilename}": ${String(err)}`);
    }

    return {
      normalizedBuffer,
      normalizedMime,
      normalizedExtension,
      transcription,
      textExtract: null,
      durationMs: null,
      width: null,
      height: null
    };
  }

  private async processImage(buffer: Buffer, mime: string): Promise<PreprocessedMedia> {
    let normalizedBuffer = buffer;
    let normalizedMime = mime;
    let normalizedExtension = this.extensionForMime(mime);
    let width: number | null = null;
    let height: number | null = null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sharpFn = (await this.loadSharp()) as any;
      if (sharpFn) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pipeline: any = sharpFn(buffer);
        const metadata = await pipeline.metadata();
        width = (metadata.width as number) ?? null;
        height = (metadata.height as number) ?? null;

        if (IMAGE_MIMES_NEEDING_CONVERSION.has(mime)) {
          pipeline = pipeline.jpeg({ quality: 90 });
          normalizedMime = "image/jpeg";
          normalizedExtension = "jpg";
        }

        if ((width && width > MAX_IMAGE_DIMENSION) || (height && height > MAX_IMAGE_DIMENSION)) {
          pipeline = pipeline.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
            fit: "inside",
            withoutEnlargement: true
          });
          const resizedMeta = await pipeline.toBuffer({ resolveWithObject: true });
          width = resizedMeta.info.width as number;
          height = resizedMeta.info.height as number;
          normalizedBuffer = resizedMeta.data as Buffer;
        } else if (IMAGE_MIMES_NEEDING_CONVERSION.has(mime)) {
          normalizedBuffer = (await pipeline.toBuffer()) as Buffer;
        }
      }
    } catch (err) {
      this.logger.warn(`Image processing failed, keeping original: ${String(err)}`);
    }

    return {
      normalizedBuffer,
      normalizedMime,
      normalizedExtension,
      transcription: null,
      textExtract: null,
      durationMs: null,
      width,
      height
    };
  }

  private async processVideo(
    buffer: Buffer,
    mime: string,
    assistantId: string
  ): Promise<PreprocessedMedia> {
    let transcription: string | null = null;

    try {
      const audioTrack = await this.extractAudioFromVideo(buffer);
      if (audioTrack) {
        transcription = await this.transcribeAudio(audioTrack, "audio/mpeg", assistantId);
      }
    } catch (err) {
      this.logger.warn(`Video audio extraction/STT failed: ${String(err)}`);
    }

    return {
      normalizedBuffer: buffer,
      normalizedMime: mime,
      normalizedExtension: this.extensionForMime(mime),
      transcription,
      textExtract: null,
      durationMs: null,
      width: null,
      height: null
    };
  }

  private async processDocument(
    buffer: Buffer,
    mime: string,
    originalFilename: string
  ): Promise<PreprocessedMedia> {
    let textExtract: string | null = null;

    if (mime === "application/pdf") {
      try {
        textExtract = await this.extractPdfText(buffer);
      } catch (err) {
        this.logger.warn(`PDF text extraction failed for "${originalFilename}": ${String(err)}`);
      }
    } else if (mime.startsWith("text/") || mime === "application/json") {
      textExtract = this.toUtf8TextExtract(buffer);
    } else if (WORD_DOCUMENT_MIMES.has(mime)) {
      try {
        textExtract = await this.extractWordText(buffer);
      } catch (err) {
        this.logger.warn(`Word text extraction failed for "${originalFilename}": ${String(err)}`);
      }
    } else if (SPREADSHEET_MIMES.has(mime)) {
      try {
        textExtract = await this.extractSpreadsheetText(buffer);
      } catch (err) {
        this.logger.warn(
          `Spreadsheet text extraction failed for "${originalFilename}": ${String(err)}`
        );
      }
    }

    return {
      normalizedBuffer: buffer,
      normalizedMime: mime,
      normalizedExtension: this.extensionForMime(mime),
      transcription: null,
      textExtract,
      durationMs: null,
      width: null,
      height: null
    };
  }

  private passthrough(buffer: Buffer, mime: string): PreprocessedMedia {
    return {
      normalizedBuffer: buffer,
      normalizedMime: mime,
      normalizedExtension: this.extensionForMime(mime),
      transcription: null,
      textExtract: null,
      durationMs: null,
      width: null,
      height: null
    };
  }

  private async convertAudioToMp3(buffer: Buffer): Promise<Buffer> {
    const { execFile } = await import("child_process");
    const { writeFile, readFile, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { randomUUID } = await import("crypto");

    const id = randomUUID();
    const inputPath = join(tmpdir(), `persai-audio-in-${id}.webm`);
    const outputPath = join(tmpdir(), `persai-audio-out-${id}.mp3`);

    await writeFile(inputPath, buffer);

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          "ffmpeg",
          ["-i", inputPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", outputPath, "-y"],
          { timeout: 30_000 },
          (err) => (err ? reject(err) : resolve())
        );
      });
      return await readFile(outputPath);
    } finally {
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    }
  }

  private async transcribeAudio(
    buffer: Buffer,
    mime: string,
    assistantId: string
  ): Promise<string | null> {
    const startedAt = process.hrtime.bigint();
    let outcome: "success" | "failure" = "failure";
    const runtimeTier =
      await this.resolveAssistantRuntimeTierService.resolveByAssistantId(assistantId);
    const { randomUUID } = await import("crypto");
    const transientChatId = `_stt_tmp_${randomUUID()}`;

    const uploadResult = await this.assistantRuntime.uploadChatMedia({
      assistantId,
      runtimeTier,
      chatId: transientChatId,
      messageId: "transcribe",
      fileBuffer: buffer,
      mimeType: mime
    });

    try {
      const result = await this.assistantRuntime.transcribeMedia(
        assistantId,
        uploadResult.storagePath,
        runtimeTier
      );
      outcome = "success";
      return result.text && result.text.trim().length > 0 ? result.text.trim() : null;
    } finally {
      await this.assistantRuntime.deleteChatMediaBatch(assistantId, transientChatId, runtimeTier);
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.platformHttpMetricsService.recordMediaStage({
        stage: "stt_transcribe",
        channel: "preprocessor",
        outcome,
        latencyMs: Number(latencyMs.toFixed(2))
      });
    }
  }

  private async extractAudioFromVideo(buffer: Buffer): Promise<Buffer | null> {
    try {
      const { execFile } = await import("child_process");
      const { writeFile, readFile, unlink, access } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");
      const { randomUUID } = await import("crypto");

      const id = randomUUID();
      const inputPath = join(tmpdir(), `persai-video-in-${id}.mp4`);
      const outputPath = join(tmpdir(), `persai-video-audio-${id}.mp3`);

      await writeFile(inputPath, buffer);

      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            "ffmpeg",
            ["-i", inputPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", outputPath, "-y"],
            { timeout: 30_000 },
            (err) => (err ? reject(err) : resolve())
          );
        });
        await access(outputPath);
        return await readFile(outputPath);
      } finally {
        await unlink(inputPath).catch(() => {});
        await unlink(outputPath).catch(() => {});
      }
    } catch {
      return null;
    }
  }

  private async extractPdfText(buffer: Buffer): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse") as (
        buf: Buffer,
        opts?: { max?: number }
      ) => Promise<{ text?: string }>;
      const result = await pdfParse(buffer, { max: 100 });
      const text = result.text?.trim() ?? "";
      return this.normalizeExtractedText(text);
    } catch {
      return null;
    }
  }

  private async extractWordText(buffer: Buffer): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WordExtractor = require("word-extractor") as new () => {
      extract(source: Buffer): Promise<Record<string, unknown>>;
    };
    const extractor = new WordExtractor();
    const document = await extractor.extract(buffer);
    const sections = [
      this.readWordSection(document, "getHeaders"),
      this.readWordSection(document, "getBody"),
      this.readWordSection(document, "getFootnotes"),
      this.readWordSection(document, "getEndnotes"),
      this.readWordSection(document, "getAnnotations"),
      this.readWordSection(document, "getFooters")
    ].filter((section): section is string => section !== null);
    return this.normalizeExtractedText(sections.join("\n\n"));
  }

  private async extractSpreadsheetText(buffer: Buffer): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetTexts = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return null;
      }
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
      if (csv.length === 0) {
        return null;
      }
      return `Sheet "${sheetName}":\n${csv}`;
    }).filter((sheetText): sheetText is string => sheetText !== null);
    return this.normalizeExtractedText(sheetTexts.join("\n\n"));
  }

  private toUtf8TextExtract(buffer: Buffer): string | null {
    return this.normalizeExtractedText(buffer.toString("utf-8"));
  }

  private readWordSection(
    document: Record<string, unknown>,
    methodName:
      | "getHeaders"
      | "getBody"
      | "getFootnotes"
      | "getEndnotes"
      | "getAnnotations"
      | "getFooters"
  ): string | null {
    const candidate = document[methodName];
    if (typeof candidate !== "function") {
      return null;
    }
    const value = candidate.call(document);
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private normalizeExtractedText(text: string | null | undefined): string | null {
    if (typeof text !== "string") {
      return null;
    }
    const normalized = text.trim().slice(0, MAX_TEXT_EXTRACT_CHARS);
    return normalized.length > 0 ? normalized : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadSharp(): Promise<any | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("sharp");
    } catch {
      this.logger.warn("sharp not available, image processing disabled.");
      return null;
    }
  }

  private normalizeMime(mime: string): string {
    return (mime.split(";")[0] ?? mime).trim().toLowerCase();
  }

  private extensionForMime(mime: string): string {
    const normalizedMime = this.normalizeMime(mime);
    const map: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/heic": "jpg",
      "image/heif": "jpg",
      "application/json": "json",
      "application/msword": "doc",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/ogg": "ogg",
      "audio/opus": "opus",
      "audio/wav": "wav",
      "audio/webm": "webm",
      "audio/aac": "aac",
      "audio/flac": "flac",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "application/pdf": "pdf",
      "text/csv": "csv",
      "text/plain": "txt",
      "text/markdown": "md"
    };
    return map[normalizedMime] ?? "bin";
  }
}
