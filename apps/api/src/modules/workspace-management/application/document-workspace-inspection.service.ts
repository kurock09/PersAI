import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DocumentExtractionService } from "./document-extraction.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { SandboxControlPlaneClientService } from "./sandbox-control-plane.client.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { normalizeActiveWorkspaceFilePath } from "./workspace-visible-paths";
import type { KnowledgeDocumentProcessingInput } from "./knowledge-processing.types";

type WorkspaceDocumentInspectInput = {
  assistantId: string;
  workspaceId: string;
  path: string;
  depth: "quick" | "standard" | "deep";
  outputPath: string | null;
};

type WorkspaceDocumentInspectRejected = {
  accepted: false;
  code: string;
  message: string;
};

type WorkspaceDocumentInspectEditMethod = "shell_native" | "render_from_markdown";

type WorkspaceDocumentInspectAccepted = {
  accepted: true;
  sourcePath: string;
  inspectPath: string;
  format: "pdf" | "xlsx" | "docx";
  editMethod: WorkspaceDocumentInspectEditMethod;
  siblingMarkdownPath: string | null;
  extractedMdPath: string | null;
  counts: {
    pageCount: number | null;
    sheetCount: number | null;
    formulaCount: number | null;
    blankSheetCount: number | null;
    paragraphCount: number | null;
    headingCount: number | null;
    tableCount: number | null;
    textCharCount: number | null;
  };
  warnings: string[];
  suggestedReadPaths: string[];
};

type WorkspaceDocumentInspectionSidecar = {
  sourcePath: string;
  inspectPath: string;
  format: "pdf" | "xlsx" | "docx";
  editMethod?: WorkspaceDocumentInspectEditMethod;
  siblingMarkdownPath?: string | null;
  extractedMdPath?: string | null;
  depth: WorkspaceDocumentInspectInput["depth"];
  counts: WorkspaceDocumentInspectAccepted["counts"];
  warnings: string[];
  details: Record<string, unknown>;
};

type WorkbookSheetFacts = {
  name: string;
  range: string | null;
  rowCount: number;
  columnCount: number;
  formulaCount: number;
  blank: boolean;
  sampleRows: string[][];
};

type WorkbookInspectionFacts = {
  counts: WorkspaceDocumentInspectAccepted["counts"];
  warnings: string[];
  details: {
    workbookSheets: WorkbookSheetFacts[];
  };
};

type DocxInspectionFacts = {
  counts: WorkspaceDocumentInspectAccepted["counts"];
  warnings: string[];
  details: {
    sampleHeadings: string[];
    sampleParagraphs: string[];
  };
};

const SUPPORTED_INSPECT_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

@Injectable()
export class DocumentWorkspaceInspectionService {
  private readonly logger = new Logger(DocumentWorkspaceInspectionService.name);

  constructor(
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly sandboxControlPlaneClient: SandboxControlPlaneClientService,
    private readonly documentExtractionService: DocumentExtractionService
  ) {}

  parseInput(value: unknown): WorkspaceDocumentInspectInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      path: this.requiredString(row.path, "path"),
      depth:
        row.depth === "quick" || row.depth === "deep"
          ? row.depth
          : row.depth === "standard"
            ? "standard"
            : "standard",
      outputPath:
        typeof row.outputPath === "string" && row.outputPath.trim().length > 0
          ? row.outputPath.trim()
          : null
    };
  }

  async execute(
    input: WorkspaceDocumentInspectInput
  ): Promise<WorkspaceDocumentInspectAccepted | WorkspaceDocumentInspectRejected> {
    const sourcePath = normalizeWorkspacePath(input.path);
    if (sourcePath === null) {
      return {
        accepted: false,
        code: "invalid_source_path",
        message: "document.inspect path must be a valid /workspace/... file path."
      };
    }
    const inspectPath = normalizeWorkspacePath(
      input.outputPath ?? deriveDefaultInspectPath(sourcePath)
    );
    if (inspectPath === null) {
      return {
        accepted: false,
        code: "invalid_output_path",
        message: "document.inspect outputPath must be a valid /workspace/... file path."
      };
    }
    if (inspectPath === sourcePath || !inspectPath.toLowerCase().endsWith(".inspect.json")) {
      return {
        accepted: false,
        code: "invalid_output_path",
        message: "document.inspect outputPath must be a separate /workspace/*.inspect.json path."
      };
    }
    const sourceMetadata = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: sourcePath
    });
    if (sourceMetadata === null) {
      return {
        accepted: false,
        code: "path_not_found",
        message: `Workspace file not found: ${sourcePath}`
      };
    }
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: sourcePath
    });
    const downloaded = await this.mediaObjectStorage.downloadObject(objectKey);
    if (downloaded === null) {
      return {
        accepted: false,
        code: "path_not_found",
        message: `Workspace file bytes not found for ${sourcePath}`
      };
    }

    const mimeType = resolveEffectiveMimeType(
      sourceMetadata.mimeType || downloaded.contentType,
      sourcePath
    );
    if (!SUPPORTED_INSPECT_MIME_TYPES.has(mimeType)) {
      return {
        accepted: false,
        code: "unsupported_source_type",
        message: `document.inspect does not support ${mimeType || "this file type"} yet.`
      };
    }

    const sidecar =
      mimeType === "application/pdf" || mimeType === "application/x-pdf"
        ? await this.inspectPdf({
            sourcePath,
            inspectPath,
            depth: input.depth,
            buffer: downloaded.buffer
          })
        : mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          ? await this.inspectWorkbook({
              sourcePath,
              inspectPath,
              depth: input.depth,
              buffer: downloaded.buffer
            })
          : await this.inspectDocx({
              sourcePath,
              inspectPath,
              depth: input.depth,
              buffer: downloaded.buffer
            });

    const siblingMarkdownPath = await this.resolveSiblingMarkdownPath({
      workspaceId: input.workspaceId,
      sourcePath
    });
    const editMethod: WorkspaceDocumentInspectEditMethod =
      siblingMarkdownPath === null ? "shell_native" : "render_from_markdown";

    let extractedMdPath: string | null = null;
    const extractedMdWarnings: string[] = [];
    if (sidecar.format === "pdf" && this.shouldExtractPdfText(sidecar)) {
      const extracted = await this.maybePersistExtractedMarkdown({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        sourcePath,
        mimeType,
        buffer: downloaded.buffer
      });
      extractedMdPath = extracted.extractedMdPath;
      extractedMdWarnings.push(...extracted.warnings);
    }

    sidecar.editMethod = editMethod;
    sidecar.siblingMarkdownPath = siblingMarkdownPath;
    sidecar.extractedMdPath = extractedMdPath;
    if (extractedMdWarnings.length > 0) {
      sidecar.warnings = [...sidecar.warnings, ...extractedMdWarnings];
    }

    const pushWarning = await this.persistInspectSidecar({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      inspectPath,
      sidecar
    });

    const suggestedReadPaths = [inspectPath];
    if (extractedMdPath !== null) {
      suggestedReadPaths.push(extractedMdPath);
    }

    return {
      accepted: true,
      sourcePath,
      inspectPath,
      format: sidecar.format,
      editMethod,
      siblingMarkdownPath,
      extractedMdPath,
      counts: sidecar.counts,
      warnings: pushWarning === null ? sidecar.warnings : [...sidecar.warnings, pushWarning],
      suggestedReadPaths
    };
  }

  private async inspectPdf(input: {
    sourcePath: string;
    inspectPath: string;
    depth: WorkspaceDocumentInspectInput["depth"];
    buffer: Buffer;
  }): Promise<WorkspaceDocumentInspectionSidecar> {
    const warnings: string[] = [];
    if (!input.buffer.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
      warnings.push("File does not start with the %PDF- magic header.");
    }

    let pageCount: number | null = null;
    let extractedText = "";
    try {
      const parsed = await parsePdf(input.buffer);
      pageCount = parsed.pageCount;
      extractedText = parsed.text;
    } catch (error) {
      warnings.push(
        `PDF text extraction failed: ${error instanceof Error ? error.message : "unknown error"}.`
      );
    }

    const normalizedText = extractedText.replace(/\s+/g, " ").trim();
    const textCharCount = normalizedText.length;
    if (textCharCount === 0) {
      warnings.push("PDF text layer is empty or unreadable.");
    } else if (textCharCount < 80 || (pageCount !== null && textCharCount < pageCount * 40)) {
      warnings.push("PDF text layer looks very short for the reported page count.");
    }

    return {
      sourcePath: input.sourcePath,
      inspectPath: input.inspectPath,
      format: "pdf",
      depth: input.depth,
      counts: {
        pageCount,
        sheetCount: null,
        formulaCount: null,
        blankSheetCount: null,
        paragraphCount: null,
        headingCount: null,
        tableCount: null,
        textCharCount
      },
      warnings,
      details: {
        sampleText:
          textCharCount === 0
            ? []
            : [normalizedText.slice(0, resolveTextSampleLength(input.depth))],
        sizeBytes: input.buffer.length
      }
    };
  }

  private async inspectWorkbook(input: {
    sourcePath: string;
    inspectPath: string;
    depth: WorkspaceDocumentInspectInput["depth"];
    buffer: Buffer;
  }): Promise<WorkspaceDocumentInspectionSidecar> {
    const facts = this.analyzeWorkbook(input.buffer, input.depth);

    return {
      sourcePath: input.sourcePath,
      inspectPath: input.inspectPath,
      format: "xlsx",
      depth: input.depth,
      counts: facts.counts,
      warnings: facts.warnings,
      details: facts.details
    };
  }

  private async inspectDocx(input: {
    sourcePath: string;
    inspectPath: string;
    depth: WorkspaceDocumentInspectInput["depth"];
    buffer: Buffer;
  }): Promise<WorkspaceDocumentInspectionSidecar> {
    const facts = await this.analyzeDocx(input.buffer, input.depth);
    return {
      sourcePath: input.sourcePath,
      inspectPath: input.inspectPath,
      format: "docx",
      depth: input.depth,
      counts: facts.counts,
      warnings: facts.warnings,
      details: facts.details
    };
  }

  private analyzeWorkbook(
    buffer: Buffer,
    depth: WorkspaceDocumentInspectInput["depth"]
  ): WorkbookInspectionFacts {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const warnings: string[] = [];
    const sheets: WorkbookSheetFacts[] = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const range = typeof sheet?.["!ref"] === "string" ? sheet["!ref"] : null;
      const decodedRange = range ? XLSX.utils.decode_range(range) : null;
      const rowCount = decodedRange ? decodedRange.e.r - decodedRange.s.r + 1 : 0;
      const columnCount = decodedRange ? decodedRange.e.c - decodedRange.s.c + 1 : 0;
      let formulaCount = 0;
      let nonEmptyCellCount = 0;
      for (const [cellRef, cell] of Object.entries(sheet ?? {})) {
        if (cellRef.startsWith("!")) {
          continue;
        }
        if (cell && typeof cell === "object" && "f" in cell && typeof cell.f === "string") {
          formulaCount += 1;
        }
        if (
          cell &&
          typeof cell === "object" &&
          "v" in cell &&
          cell.v !== null &&
          String(cell.v).trim().length > 0
        ) {
          nonEmptyCellCount += 1;
        }
      }
      const rows = XLSX.utils.sheet_to_json(sheet ?? {}, {
        header: 1,
        raw: false,
        blankrows: false
      }) as unknown[][];
      const sampleRows = rows
        .filter(
          (row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim().length > 0)
        )
        .slice(0, resolveWorkbookSampleRowCount(depth))
        .map((row) => row.map((cell) => String(cell ?? "")));
      const blank = nonEmptyCellCount === 0;
      if (blank) {
        warnings.push(`Sheet "${sheetName}" is blank.`);
      }
      return {
        name: sheetName,
        range,
        rowCount,
        columnCount,
        formulaCount,
        blank,
        sampleRows
      };
    });

    if (sheets.length === 0) {
      warnings.push("Workbook contains no sheets.");
    }

    return {
      counts: {
        pageCount: null,
        sheetCount: sheets.length,
        formulaCount: sheets.reduce((sum, sheet) => sum + sheet.formulaCount, 0),
        blankSheetCount: sheets.filter((sheet) => sheet.blank).length,
        paragraphCount: null,
        headingCount: null,
        tableCount: null,
        textCharCount: null
      },
      warnings,
      details: {
        workbookSheets: sheets
      }
    };
  }

  private async analyzeDocx(
    buffer: Buffer,
    depth: WorkspaceDocumentInspectInput["depth"]
  ): Promise<DocxInspectionFacts> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require("mammoth") as {
      convertToHtml(source: { buffer: Buffer }): Promise<{ value?: string }>;
      extractRawText(source: { buffer: Buffer }): Promise<{ value?: string }>;
    };

    const htmlResult = await mammoth.convertToHtml({ buffer });
    const rawTextResult = await mammoth.extractRawText({ buffer });
    const html = htmlResult.value ?? "";
    const rawText = (rawTextResult.value ?? "").replace(/\s+/g, " ").trim();
    const headingMatches = Array.from(html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi));
    const paragraphMatches = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
    const tableMatches = Array.from(html.matchAll(/<table\b/gi));
    const headings = headingMatches
      .map((match) => stripHtml(match[1] ?? ""))
      .filter((value) => value.length > 0)
      .slice(0, resolveDocxSampleCount(depth));
    const paragraphs = paragraphMatches
      .map((match) => stripHtml(match[1] ?? ""))
      .filter((value) => value.length > 0)
      .slice(0, resolveDocxSampleCount(depth));
    const warnings: string[] = [];
    if (rawText.length === 0 && headingMatches.length === 0 && paragraphMatches.length === 0) {
      warnings.push("DOCX appears empty or contains no readable paragraph text.");
    }
    return {
      counts: {
        pageCount: null,
        sheetCount: null,
        formulaCount: null,
        blankSheetCount: null,
        paragraphCount: paragraphMatches.length,
        headingCount: headingMatches.length,
        tableCount: tableMatches.length,
        textCharCount: rawText.length
      },
      warnings,
      details: {
        sampleHeadings: headings,
        sampleParagraphs: paragraphs
      }
    };
  }

  private shouldExtractPdfText(sidecar: WorkspaceDocumentInspectionSidecar): boolean {
    if (sidecar.format !== "pdf") {
      return false;
    }
    if ((sidecar.counts.textCharCount ?? 0) === 0) {
      return true;
    }
    return sidecar.warnings.some((warning) =>
      /PDF text layer is empty or unreadable/i.test(warning)
    );
  }

  private async resolveSiblingMarkdownPath(input: {
    workspaceId: string;
    sourcePath: string;
  }): Promise<string | null> {
    const candidate = deriveSiblingMarkdownPath(input.sourcePath);
    const metadata = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: candidate
    });
    return metadata === null ? null : candidate;
  }

  private async maybePersistExtractedMarkdown(input: {
    assistantId: string;
    workspaceId: string;
    sourcePath: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ extractedMdPath: string | null; warnings: string[] }> {
    const extractedMdPath = deriveDefaultExtractedMarkdownPath(input.sourcePath);
    const existing = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: extractedMdPath
    });
    if (existing !== null) {
      return { extractedMdPath, warnings: [] };
    }

    const warnings: string[] = [];
    try {
      const extraction = await this.documentExtractionService.extract(
        this.toExtractionInput({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          sourcePath: input.sourcePath,
          mimeType: input.mimeType,
          buffer: input.buffer
        })
      );
      const extractedText = extraction.markdown?.trim().length
        ? extraction.markdown.trim()
        : extraction.normalizedText.trim();
      if (extractedText.length === 0) {
        warnings.push("OCR/full-text extraction did not produce readable text for this PDF.");
        return { extractedMdPath: null, warnings };
      }
      const pushWarning = await this.persistMarkdownSidecar({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        path: extractedMdPath,
        content: extractedText,
        shortDescription: `Extracted text for ${input.sourcePath}`
      });
      if (pushWarning !== null) {
        warnings.push(pushWarning);
      }
      return { extractedMdPath, warnings };
    } catch (error) {
      warnings.push(
        `OCR/full-text extraction failed: ${
          error instanceof Error ? error.message : "unknown error"
        }.`
      );
      return { extractedMdPath: null, warnings };
    }
  }

  private toExtractionInput(input: {
    assistantId: string;
    workspaceId: string;
    sourcePath: string;
    mimeType: string;
    buffer: Buffer;
  }): KnowledgeDocumentProcessingInput {
    return {
      source: {
        sourceType: "assistant_knowledge_source",
        sourceId: `workspace-document-inspect:${input.workspaceId}:${input.sourcePath}`,
        sourceVersion: 1,
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        skillId: null,
        provenance: {
          originKind: "uploaded_file",
          mimeType: input.mimeType,
          storagePath: input.sourcePath,
          originalFilename: lastPathSegment(input.sourcePath)
        },
        metadata: {
          runtimeDocumentInspect: true
        }
      },
      content: {
        kind: "bytes",
        buffer: input.buffer,
        mimeType: input.mimeType,
        originalFilename: lastPathSegment(input.sourcePath) ?? "source",
        sizeBytes: input.buffer.length
      },
      requestedMode: "auto"
    };
  }

  private async persistMarkdownSidecar(input: {
    assistantId: string;
    workspaceId: string;
    path: string;
    content: string;
    shortDescription: string;
  }): Promise<string | null> {
    const buffer = Buffer.from(input.content, "utf8");
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: input.path
    });
    await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer,
      mimeType: "text/markdown"
    });
    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: input.path,
      mimeType: "text/markdown",
      sizeBytes: buffer.length,
      shortDescription: input.shortDescription
    });
    const basename = lastPathSegment(input.path) ?? "extracted.md";
    const pushOutcome = await this.sandboxControlPlaneClient.pushWorkspaceFileBytes({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      basename,
      path: input.path,
      storagePath: input.path,
      mimeType: "text/markdown"
    });
    if (pushOutcome.mode === "error") {
      this.logger.warn(
        `document_inspect_extracted_md_push_failed workspace=${input.workspaceId} path=${input.path} reason=${pushOutcome.reason ?? "unknown"}`
      );
      return `Extracted markdown ${input.path} will appear after the next workspace hydrate if no hot pod is available.`;
    }
    return null;
  }

  private async persistInspectSidecar(input: {
    assistantId: string;
    workspaceId: string;
    inspectPath: string;
    sidecar: WorkspaceDocumentInspectionSidecar;
  }): Promise<string | null> {
    const buffer = Buffer.from(
      JSON.stringify(
        {
          schema: "persai.document.inspect.v1",
          ...input.sidecar
        },
        null,
        2
      ),
      "utf8"
    );
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: input.inspectPath
    });
    await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer,
      mimeType: "application/json"
    });
    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: input.inspectPath,
      mimeType: "application/json",
      sizeBytes: buffer.length,
      shortDescription: `Document inspection sidecar for ${input.sidecar.sourcePath}`
    });
    const basename = lastPathSegment(input.inspectPath) ?? "inspect.json";
    const pushOutcome = await this.sandboxControlPlaneClient.pushWorkspaceFileBytes({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      basename,
      path: input.inspectPath,
      storagePath: input.inspectPath,
      mimeType: "application/json"
    });
    if (pushOutcome.mode === "error") {
      this.logger.warn(
        `document_inspect_hot_pod_push_failed workspace=${input.workspaceId} path=${input.inspectPath} reason=${pushOutcome.reason ?? "unknown"}`
      );
      return `Inspect sidecar ${input.inspectPath} will appear after the next workspace hydrate if no hot pod is available.`;
    }
    return null;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string.`);
    }
    return value.trim();
  }
}

function normalizeWorkspacePath(value: string): string | null {
  return normalizeActiveWorkspaceFilePath(value);
}

function deriveDefaultInspectPath(sourcePath: string): string {
  const dot = sourcePath.lastIndexOf(".");
  const stem = dot > "/workspace/".length ? sourcePath.slice(0, dot) : sourcePath;
  return `${stem}.inspect.json`;
}

function deriveSiblingMarkdownPath(sourcePath: string): string {
  const dot = sourcePath.lastIndexOf(".");
  const stem = dot > "/workspace/".length ? sourcePath.slice(0, dot) : sourcePath;
  return `${stem}.md`;
}

function deriveDefaultExtractedMarkdownPath(sourcePath: string): string {
  const dot = sourcePath.lastIndexOf(".");
  const stem = dot > "/workspace/".length ? sourcePath.slice(0, dot) : sourcePath;
  return `${stem}.extracted.md`;
}

function normalizeMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function resolveEffectiveMimeType(mimeType: string | null | undefined, path: string): string {
  const normalized = normalizeMime(mimeType);
  if (
    normalized.length === 0 ||
    normalized === "application/octet-stream" ||
    normalized === "binary/octet-stream"
  ) {
    return inferMimeFromPath(path);
  }
  return normalized;
}

function resolveTextSampleLength(depth: WorkspaceDocumentInspectInput["depth"]): number {
  switch (depth) {
    case "quick":
      return 200;
    case "deep":
      return 1200;
    case "standard":
    default:
      return 600;
  }
}

function resolveWorkbookSampleRowCount(depth: WorkspaceDocumentInspectInput["depth"]): number {
  switch (depth) {
    case "quick":
      return 2;
    case "deep":
      return 8;
    case "standard":
    default:
      return 4;
  }
}

function resolveDocxSampleCount(depth: WorkspaceDocumentInspectInput["depth"]): number {
  switch (depth) {
    case "quick":
      return 2;
    case "deep":
      return 8;
    case "standard":
    default:
      return 4;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastPathSegment(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const last = parts[parts.length - 1] ?? "";
  return last.length > 0 ? last : null;
}

async function parsePdf(buffer: Buffer): Promise<{ pageCount: number | null; text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParseModule = require("pdf-parse") as
    | ((
        dataBuffer: Buffer,
        options?: { max?: number }
      ) => Promise<{ text?: string; numpages?: number }>)
    | {
        PDFParse?: new (input: { data: Buffer }) => {
          getText(): Promise<string | { text?: string; pages?: unknown[]; numpages?: number }>;
          destroy(): Promise<void>;
        };
      };
  if (typeof pdfParseModule === "function") {
    const result = await pdfParseModule(buffer, { max: 100 });
    return {
      pageCount: typeof result.numpages === "number" ? result.numpages : null,
      text: result.text ?? ""
    };
  }
  if (typeof pdfParseModule.PDFParse !== "function") {
    throw new Error("pdf-parse module does not expose a supported parser API.");
  }
  const parser = new pdfParseModule.PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    if (typeof result === "string") {
      return { pageCount: null, text: result };
    }
    return {
      pageCount: typeof result.numpages === "number" ? result.numpages : null,
      text: result.text ?? ""
    };
  } finally {
    await parser.destroy();
  }
}
