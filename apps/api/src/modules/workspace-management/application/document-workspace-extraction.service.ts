import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  buildDocumentProjectPdfExportEntrypoint,
  buildDocumentProjectPythonRenderEntrypoint,
  applyDocumentProjectPathSuffix,
  buildDocumentProjectSourceCopyPath,
  buildDocumentProjectManifest,
  buildDocumentProjectRenderScaffoldHtml,
  buildDocumentWorkspaceProjectLayout,
  deriveDefaultDocumentProjectPath,
  resolveDocumentProjectDefaultRenderEntrypoint,
  type DocumentWorkspaceProjectSourceFormat,
  shouldScaffoldDocumentProjectRenderHtml
} from "@persai/runtime-contract";
import { DocumentExtractionService } from "./document-extraction.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { SandboxControlPlaneClientService } from "./sandbox-control-plane.client.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import type {
  KnowledgeDocumentProcessingInput,
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderTrace
} from "./knowledge-processing.types";

type WorkspaceDocumentExtractInput = {
  assistantId: string;
  workspaceId: string;
  path: string;
  mode: "auto" | "text" | "ocr" | "layout";
  outputDir: string | null;
};

type WorkspaceDocumentExtractRejected = {
  accepted: false;
  code: string;
  message: string;
};

type WorkspaceDocumentExtractSuggestedNextAction = {
  tool: "document";
  action: "render";
  args: {
    action: "render";
    projectPath: string;
    outputPath: string;
    format: "pdf" | "xlsx" | "docx";
  };
  reason: string;
};

type WorkspaceDocumentExtractAccepted = {
  accepted: true;
  sourcePath: string;
  outputDir: string;
  manifestPath: string;
  projectPath: string | null;
  projectManifestPath: string | null;
  projectSourcePath: string | null;
  defaultRenderEntrypoint: string | null;
  defaultPdfOutputPath: string | null;
  outputPaths: string[];
  suggestedReadPaths: string[];
  counts: {
    documentCount: number | null;
    pageCount: number | null;
    sheetCount: number | null;
  };
  provider: KnowledgeProcessingProviderTrace | null;
  quality: KnowledgeExtractionQuality | null;
  warnings: string[];
  suggestedNextActions: WorkspaceDocumentExtractSuggestedNextAction[] | null;
};

type SidecarFile = {
  path: string;
  mimeType: string;
  buffer: Buffer;
  shortDescription: string;
};

type ExtractionBuild = {
  provider: KnowledgeProcessingProviderTrace | null;
  quality: KnowledgeExtractionQuality | null;
  counts: {
    documentCount: number | null;
    pageCount: number | null;
    sheetCount: number | null;
  };
  warnings: string[];
  files: SidecarFile[];
  suggestedReadPaths: string[];
};

const SIMPLE_TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml",
  "text/x-markdown"
]);

const SHARED_EXTRACTION_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values"
]);

const MAX_RETURNED_OUTPUT_PATHS = 50;
const MAX_VERSIONED_SOURCE_SIBLING_SCAN = 200;

@Injectable()
export class DocumentWorkspaceExtractionService {
  private readonly logger = new Logger(DocumentWorkspaceExtractionService.name);

  constructor(
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly documentExtractionService: DocumentExtractionService,
    private readonly sandboxControlPlaneClient: SandboxControlPlaneClientService
  ) {}

  parseInput(value: unknown): WorkspaceDocumentExtractInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      path: this.requiredString(row.path, "path"),
      mode: row.mode === "text" || row.mode === "ocr" || row.mode === "layout" ? row.mode : "auto",
      outputDir:
        typeof row.outputDir === "string" && row.outputDir.trim().length > 0
          ? row.outputDir.trim()
          : null
    };
  }

  async execute(
    input: WorkspaceDocumentExtractInput
  ): Promise<WorkspaceDocumentExtractAccepted | WorkspaceDocumentExtractRejected> {
    if (input.outputDir !== null) {
      return {
        accepted: false,
        code: "legacy_output_dir_rejected",
        message:
          "document.extract no longer accepts outputDir; extraction creates a document project under /workspace/projects/<slug>/."
      };
    }
    const requestedSourcePath = normalizeWorkspacePath(input.path);
    if (requestedSourcePath === null) {
      return {
        accepted: false,
        code: "invalid_source_path",
        message: "document.extract path must be a valid /workspace/... file path."
      };
    }
    const sourcePath = await this.resolveNewestVersionedSourcePath({
      workspaceId: input.workspaceId,
      requestedPath: requestedSourcePath
    });
    const projectPath = await this.resolveUniqueDocumentProjectPath({
      workspaceId: input.workspaceId,
      sourcePath
    });
    if (projectPath === null) {
      return {
        accepted: false,
        code: "invalid_project_path",
        message: "Could not derive a valid document project path for document.extract."
      };
    }
    const projectLayout = buildDocumentWorkspaceProjectLayout(projectPath);
    const existingProjectChildren = await this.workspaceFileMetadataService.list({
      workspaceId: input.workspaceId,
      pathPrefix: `${projectPath}/`,
      limit: 1
    });
    if (existingProjectChildren.length > 0) {
      return {
        accepted: false,
        code: "project_path_not_empty",
        message: `document.extract project path already contains workspace files: ${projectPath}`
      };
    }
    const resolvedOutputDir = projectLayout.extractDir;
    const existingOutputFile = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: resolvedOutputDir
    });
    if (existingOutputFile !== null) {
      return {
        accepted: false,
        code: "invalid_output_dir",
        message: `document.extract outputDir points at an existing workspace file: ${resolvedOutputDir}`
      };
    }
    const existingOutputChildren = await this.workspaceFileMetadataService.list({
      workspaceId: input.workspaceId,
      pathPrefix: `${resolvedOutputDir}/`,
      limit: 1
    });
    if (existingOutputChildren.length > 0) {
      return {
        accepted: false,
        code: "output_dir_not_empty",
        message: `document.extract outputDir already contains workspace files: ${resolvedOutputDir}`
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
    const sourceFormat = inferDocumentProjectSourceFormat({
      sourcePath,
      mimeType
    });
    if (!isSupportedExtractionMime(mimeType, sourcePath)) {
      return {
        accepted: false,
        code: "unsupported_source_type",
        message: `document.extract does not support ${mimeType || "this file type"} yet.`
      };
    }

    const build = SPREADSHEET_MIME_TYPES.has(mimeType)
      ? await this.buildSpreadsheetExtraction({
          workspaceId: input.workspaceId,
          sourcePath,
          outputDir: resolvedOutputDir,
          mimeType,
          buffer: downloaded.buffer
        })
      : await this.buildSharedExtraction({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          sourcePath,
          outputDir: resolvedOutputDir,
          mimeType,
          buffer: downloaded.buffer,
          mode: input.mode
        });
    const sourceResolutionWarnings =
      sourcePath === requestedSourcePath
        ? []
        : [
            `Requested source ${requestedSourcePath} was resolved to the newest sibling version ${sourcePath}.`
          ];

    const manifestPath = `${resolvedOutputDir}/manifest.json`;
    const manifest = this.buildManifest({
      sourcePath,
      outputDir: resolvedOutputDir,
      projectPath,
      sourceFormat,
      sourceMimeType: mimeType,
      mode: input.mode,
      mimeType,
      counts: build.counts,
      provider: build.provider,
      quality: build.quality,
      warnings: build.warnings,
      files: build.files.map((file) => ({
        path: file.path,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length
      }))
    });
    const manifestFile: SidecarFile = {
      path: manifestPath,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      shortDescription: `Document extract manifest for ${sourcePath}`
    };

    const projectFiles: SidecarFile[] = [];
    if (projectLayout !== null) {
      const extractedTextFile = build.files.find((file) => file.path.endsWith("/extracted.md"));
      const extractedText = extractedTextFile?.buffer.toString("utf8") ?? "";
      const projectSourcePath = buildDocumentProjectSourceCopyPath(projectLayout, sourcePath);
      const defaultRenderEntrypoint = resolveDocumentProjectDefaultRenderEntrypoint({
        layout: projectLayout,
        sourceKind: "imported_workspace_file",
        sourceFormat
      });
      const projectManifest = buildDocumentProjectManifest({
        layout: projectLayout,
        sourceKind: "imported_workspace_file",
        sourcePath,
        projectSourcePath,
        sourceFormat,
        sourceMimeType: mimeType,
        sourceDisplayName: lastPathSegment(sourcePath),
        extractManifestPath: manifestPath,
        mimeType
      });
      projectFiles.push({
        path: projectLayout.projectManifestPath,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(projectManifest, null, 2), "utf8"),
        shortDescription: `Document project manifest for ${sourcePath}`
      });
      if (projectSourcePath !== null) {
        projectFiles.push({
          path: projectSourcePath,
          mimeType,
          buffer: downloaded.buffer,
          shortDescription: `Project-native source copy for ${sourcePath}`
        });
      }
      if (projectSourcePath !== null && (sourceFormat === "docx" || sourceFormat === "xlsx")) {
        projectFiles.push({
          path: buildDocumentProjectPythonRenderEntrypoint(projectLayout),
          mimeType: "text/x-python",
          buffer: Buffer.from(
            buildImportedOfficeRenderScaffold({
              sourceFormat,
              projectSourcePath
            }),
            "utf8"
          ),
          shortDescription: `Native render scaffold for ${sourcePath}`
        });
        projectFiles.push({
          path: buildDocumentProjectPdfExportEntrypoint(projectLayout),
          mimeType: "text/x-python",
          buffer: Buffer.from(
            buildImportedOfficePdfExportScaffold({
              sourceFormat,
              projectSourcePath
            }),
            "utf8"
          ),
          shortDescription: `Office PDF export scaffold for ${sourcePath}`
        });
      }
      if (
        sourceFormat !== "docx" &&
        shouldScaffoldDocumentProjectRenderHtml(mimeType) &&
        extractedText.trim().length > 0
      ) {
        projectFiles.push({
          path: defaultRenderEntrypoint,
          mimeType: "text/html",
          buffer: Buffer.from(
            buildDocumentProjectRenderScaffoldHtml({
              sourcePath,
              extractedText
            }),
            "utf8"
          ),
          shortDescription: `Render scaffold HTML for ${sourcePath}`
        });
      }
    }

    const allFiles = [...build.files, manifestFile, ...projectFiles];
    const pushWarnings: string[] = [];
    for (const file of allFiles) {
      const pushWarning = await this.persistSidecar({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        file
      });
      if (pushWarning !== null) {
        pushWarnings.push(pushWarning);
      }
    }

    const allOutputPaths = allFiles.map((file) => file.path);
    const resultWarnings =
      allOutputPaths.length > MAX_RETURNED_OUTPUT_PATHS
        ? [
            ...build.warnings,
            `Extraction wrote ${String(allOutputPaths.length)} sidecar files; read ${manifestPath} for the full file list.`
          ]
        : build.warnings;
    const suggestedNextActions = this.buildExtractSuggestedNextActions({
      projectPath,
      projectLayout,
      sourceFormat
    });
    return {
      accepted: true,
      sourcePath,
      outputDir: resolvedOutputDir,
      manifestPath,
      projectPath,
      projectManifestPath: projectLayout?.projectManifestPath ?? null,
      projectSourcePath:
        projectLayout === null
          ? null
          : buildDocumentProjectSourceCopyPath(projectLayout, sourcePath),
      defaultRenderEntrypoint:
        projectLayout === null
          ? null
          : resolveDocumentProjectDefaultRenderEntrypoint({
              layout: projectLayout,
              sourceKind: "imported_workspace_file",
              sourceFormat
            }),
      defaultPdfOutputPath: projectLayout?.defaultPdfOutputPath ?? null,
      outputPaths: allOutputPaths.slice(0, MAX_RETURNED_OUTPUT_PATHS),
      suggestedReadPaths: uniquePaths([
        ...(projectLayout?.projectManifestPath ? [projectLayout.projectManifestPath] : []),
        ...(projectLayout === null
          ? []
          : [buildDocumentProjectSourceCopyPath(projectLayout, sourcePath)].filter(
              (value): value is string => typeof value === "string"
            )),
        ...(projectLayout === null
          ? []
          : [
              resolveDocumentProjectDefaultRenderEntrypoint({
                layout: projectLayout,
                sourceKind: "imported_workspace_file",
                sourceFormat
              }),
              ...(sourceFormat === "docx" || sourceFormat === "xlsx"
                ? [buildDocumentProjectPdfExportEntrypoint(projectLayout)]
                : [])
            ]),
        manifestPath,
        ...build.suggestedReadPaths
      ]),
      counts: build.counts,
      provider: build.provider,
      quality: build.quality,
      warnings: [...resultWarnings, ...sourceResolutionWarnings, ...pushWarnings],
      suggestedNextActions
    };
  }

  private buildExtractSuggestedNextActions(input: {
    projectPath: string | null;
    projectLayout: ReturnType<typeof buildDocumentWorkspaceProjectLayout> | null;
    sourceFormat: DocumentWorkspaceProjectSourceFormat;
  }): WorkspaceDocumentExtractSuggestedNextAction[] | null {
    if (input.projectPath === null || input.projectLayout === null) {
      return null;
    }
    if (input.sourceFormat !== "docx" && input.sourceFormat !== "xlsx") {
      return null;
    }
    return [
      {
        tool: "document",
        action: "render",
        args: {
          action: "render",
          projectPath: input.projectPath,
          outputPath: input.projectLayout.defaultPdfOutputPath,
          format: "pdf"
        },
        reason: `Convert the imported ${input.sourceFormat.toUpperCase()} to PDF via the seeded LibreOffice export_pdf.py entrypoint. Do not read the source content chunk by chunk; call this action directly.`
      }
    ];
  }

  private async buildSharedExtraction(input: {
    assistantId: string;
    workspaceId: string;
    sourcePath: string;
    outputDir: string;
    mimeType: string;
    buffer: Buffer;
    mode: WorkspaceDocumentExtractInput["mode"];
  }): Promise<ExtractionBuild> {
    const fallbackWarnings: string[] = [];
    let extraction;
    try {
      extraction = await this.documentExtractionService.extract(
        this.toExtractionInput({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          sourcePath: input.sourcePath,
          mimeType: input.mimeType,
          buffer: input.buffer,
          requestedMode: mapExtractMode(input.mode)
        })
      );
    } catch (error) {
      if (input.mode !== "layout") {
        throw error;
      }
      extraction = await this.documentExtractionService.extract(
        this.toExtractionInput({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          sourcePath: input.sourcePath,
          mimeType: input.mimeType,
          buffer: input.buffer,
          requestedMode: mapExtractMode("text")
        })
      );
      fallbackWarnings.push(
        `Layout extraction fell back to text mode after the high-quality pass failed: ${
          error instanceof Error ? error.message : "unknown extraction error"
        }`
      );
    }
    const extractedText = extraction.markdown?.trim().length
      ? extraction.markdown.trim()
      : extraction.normalizedText.trim();
    const extractedPath = `${input.outputDir}/extracted.md`;
    const warnings = [
      ...fallbackWarnings,
      ...this.buildWarnings(extraction.quality, extraction.provider)
    ];
    const pageCount =
      input.mimeType === "application/pdf" || input.mimeType === "application/x-pdf"
        ? await readPdfPageCount(input.buffer)
        : null;
    return {
      provider: extraction.provider ?? null,
      quality: extraction.quality ?? null,
      counts: {
        documentCount: 1,
        pageCount,
        sheetCount: null
      },
      warnings,
      files: [
        {
          path: extractedPath,
          mimeType: "text/markdown",
          buffer: Buffer.from(extractedText, "utf8"),
          shortDescription: `Extracted text for ${input.sourcePath}`
        }
      ],
      suggestedReadPaths: [extractedPath]
    };
  }

  private async buildSpreadsheetExtraction(input: {
    workspaceId: string;
    sourcePath: string;
    outputDir: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<ExtractionBuild> {
    if (input.mimeType === "text/csv" || input.mimeType === "text/tab-separated-values") {
      return this.buildCsvExtraction(input);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.read(input.buffer, { type: "buffer" });
    const summaryLines = [`# Workbook extract`, ``, `Source: ${input.sourcePath}`, ``];
    const files: SidecarFile[] = [];
    const suggestedReadPaths: string[] = [];

    workbook.SheetNames.forEach((sheetName, index) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return;
      }
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
      const csvPath = `${input.outputDir}/sheets/${String(index + 1).padStart(2, "0")}-${sanitizeSheetName(sheetName)}.csv`;
      files.push({
        path: csvPath,
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
        shortDescription: `Extracted sheet ${sheetName} from ${input.sourcePath}`
      });
      suggestedReadPaths.push(csvPath);
      const range = typeof sheet["!ref"] === "string" ? sheet["!ref"] : null;
      const decodedRange = range ? XLSX.utils.decode_range(range) : null;
      const rowCount = decodedRange ? decodedRange.e.r - decodedRange.s.r + 1 : null;
      const columnCount = decodedRange ? decodedRange.e.c - decodedRange.s.c + 1 : null;
      let formulaCount = 0;
      for (const [cellRef, cell] of Object.entries(sheet)) {
        if (cellRef.startsWith("!")) {
          continue;
        }
        if (cell && typeof cell === "object" && "f" in cell && typeof cell.f === "string") {
          formulaCount += 1;
        }
      }
      summaryLines.push(
        `## ${sheetName}`,
        `- rows: ${rowCount ?? 0}`,
        `- columns: ${columnCount ?? 0}`,
        `- formulas: ${formulaCount}`,
        `- sidecar: ${csvPath}`,
        ``
      );
    });

    const extractedPath = `${input.outputDir}/extracted.md`;
    files.unshift({
      path: extractedPath,
      mimeType: "text/markdown",
      buffer: Buffer.from(summaryLines.join("\n").trim(), "utf8"),
      shortDescription: `Workbook extract summary for ${input.sourcePath}`
    });
    return {
      provider: {
        providerKey: "local",
        processorMode: "local",
        attemptedProviderKeys: ["local"]
      },
      quality: {
        status: "ok",
        score: null,
        reasonCodes: [],
        textChars: summaryLines.join("\n").length
      },
      counts: {
        documentCount: 1,
        pageCount: null,
        sheetCount: workbook.SheetNames.length
      },
      warnings: [],
      files,
      suggestedReadPaths: [extractedPath, ...suggestedReadPaths.slice(0, 3)]
    };
  }

  private buildCsvExtraction(input: {
    workspaceId: string;
    sourcePath: string;
    outputDir: string;
    mimeType: string;
    buffer: Buffer;
  }): ExtractionBuild {
    const csvText = input.buffer.toString("utf8").replace(/\r\n/g, "\n").trim();
    const lineCount = csvText.length === 0 ? 0 : csvText.split("\n").length;
    const sheetPath = `${input.outputDir}/sheets/01-Sheet1.csv`;
    const extractedPath = `${input.outputDir}/extracted.md`;
    const summary = [
      "# Workbook extract",
      "",
      `Source: ${input.sourcePath}`,
      "",
      "## Sheet1",
      `- rows: ${lineCount}`,
      `- sidecar: ${sheetPath}`
    ].join("\n");
    return {
      provider: {
        providerKey: "local",
        processorMode: "local",
        attemptedProviderKeys: ["local"]
      },
      quality: {
        status: "ok",
        score: null,
        reasonCodes: [],
        textChars: summary.length
      },
      counts: {
        documentCount: 1,
        pageCount: null,
        sheetCount: 1
      },
      warnings: [],
      files: [
        {
          path: extractedPath,
          mimeType: "text/markdown",
          buffer: Buffer.from(summary, "utf8"),
          shortDescription: `CSV extract summary for ${input.sourcePath}`
        },
        {
          path: sheetPath,
          mimeType: "text/csv",
          buffer: Buffer.from(csvText, "utf8"),
          shortDescription: `Extracted sheet Sheet1 from ${input.sourcePath}`
        }
      ],
      suggestedReadPaths: [extractedPath, sheetPath]
    };
  }

  private async resolveUniqueDocumentProjectPath(input: {
    workspaceId: string;
    sourcePath: string;
  }): Promise<string | null> {
    const preferred = deriveDefaultDocumentProjectPath(input.sourcePath);
    const normalizedPreferred = normalizeWorkspaceDirectory(preferred);
    if (normalizedPreferred === null) {
      return null;
    }
    let suffix = 1;
    while (suffix <= 100) {
      const candidate = applyDocumentProjectPathSuffix(normalizedPreferred, suffix);
      const existingProjectManifest = await this.workspaceFileMetadataService.get({
        workspaceId: input.workspaceId,
        path: `${candidate}/project.json`
      });
      const existingChildren = await this.workspaceFileMetadataService.list({
        workspaceId: input.workspaceId,
        pathPrefix: `${candidate}/`,
        limit: 1
      });
      if (existingProjectManifest === null && existingChildren.length === 0) {
        return candidate;
      }
      suffix += 1;
    }
    return null;
  }

  private async resolveNewestVersionedSourcePath(input: {
    workspaceId: string;
    requestedPath: string;
  }): Promise<string> {
    const requested = parseVersionedWorkspaceFilename(input.requestedPath);
    if (requested === null) {
      return input.requestedPath;
    }
    const siblings = await this.workspaceFileMetadataService.list({
      workspaceId: input.workspaceId,
      pathPrefix: `${requested.directory}/`,
      limit: MAX_VERSIONED_SOURCE_SIBLING_SCAN
    });
    const candidates = siblings
      .filter((row) => workspaceDirectory(row.path) === requested.directory)
      .map((row) => {
        const parsed = parseVersionedWorkspaceFilename(row.path);
        return parsed !== null && parsed.familyKey === requested.familyKey ? { row, parsed } : null;
      })
      .filter(
        (
          candidate
        ): candidate is {
          row: (typeof siblings)[number];
          parsed: Exclude<ReturnType<typeof parseVersionedWorkspaceFilename>, null>;
        } => candidate !== null
      )
      .sort((left, right) => {
        if (left.parsed.versionNumber !== right.parsed.versionNumber) {
          return right.parsed.versionNumber - left.parsed.versionNumber;
        }
        const updatedAtDiff = right.row.updatedAt.getTime() - left.row.updatedAt.getTime();
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }
        const createdAtDiff = right.row.createdAt.getTime() - left.row.createdAt.getTime();
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return right.row.path.localeCompare(left.row.path);
      });
    return candidates[0]?.row.path ?? input.requestedPath;
  }

  private async persistSidecar(input: {
    assistantId: string;
    workspaceId: string;
    file: SidecarFile;
  }): Promise<string | null> {
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: input.file.path
    });
    await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer: input.file.buffer,
      mimeType: input.file.mimeType
    });
    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: input.file.path,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.buffer.length,
      shortDescription: input.file.shortDescription
    });
    const basename = lastPathSegment(input.file.path) ?? "sidecar.bin";
    const pushOutcome = await this.sandboxControlPlaneClient.pushWorkspaceFileBytes({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      basename,
      path: input.file.path,
      storagePath: input.file.path,
      mimeType: input.file.mimeType
    });
    if (pushOutcome.mode === "error") {
      this.logger.warn(
        `document_extract_hot_pod_push_failed workspace=${input.workspaceId} path=${input.file.path} reason=${pushOutcome.reason ?? "unknown"}`
      );
      return `Sidecar ${input.file.path} will appear after the next workspace hydrate if no hot pod is available.`;
    }
    return null;
  }

  private buildManifest(input: {
    sourcePath: string;
    outputDir: string;
    projectPath: string;
    sourceFormat: DocumentWorkspaceProjectSourceFormat;
    sourceMimeType: string;
    mode: WorkspaceDocumentExtractInput["mode"];
    mimeType: string;
    counts: WorkspaceDocumentExtractAccepted["counts"];
    provider: KnowledgeProcessingProviderTrace | null;
    quality: KnowledgeExtractionQuality | null;
    warnings: string[];
    files: Array<{ path: string; mimeType: string; sizeBytes: number }>;
  }): Record<string, unknown> {
    return {
      schema: "persai.document.extract.v1",
      kind: "extraction_view",
      sourcePath: input.sourcePath,
      projectPath: input.projectPath,
      sourceFormat: input.sourceFormat,
      sourceMimeType: input.sourceMimeType,
      outputDir: input.outputDir,
      mode: input.mode,
      mimeType: input.mimeType,
      counts: input.counts,
      provider: input.provider,
      quality: input.quality,
      warnings: input.warnings,
      files: input.files
    };
  }

  private toExtractionInput(input: {
    assistantId: string;
    workspaceId: string;
    sourcePath: string;
    mimeType: string;
    buffer: Buffer;
    requestedMode: KnowledgeDocumentProcessingInput["requestedMode"];
  }): KnowledgeDocumentProcessingInput {
    return {
      source: {
        sourceType: "assistant_knowledge_source",
        sourceId: `workspace-document-extract:${input.workspaceId}:${input.sourcePath}`,
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
          runtimeDocumentExtract: true
        }
      },
      content: {
        kind: "bytes",
        buffer: input.buffer,
        mimeType: input.mimeType,
        originalFilename: lastPathSegment(input.sourcePath) ?? "source",
        sizeBytes: input.buffer.length
      },
      ...(input.requestedMode === undefined ? {} : { requestedMode: input.requestedMode })
    };
  }

  private buildWarnings(
    quality: KnowledgeExtractionQuality | null | undefined,
    provider: KnowledgeProcessingProviderTrace | null | undefined
  ): string[] {
    const warnings: string[] = [];
    if (quality && quality.status !== "ok") {
      warnings.push(`Extraction quality is ${quality.status}.`);
    }
    for (const reasonCode of quality?.reasonCodes ?? []) {
      warnings.push(`Quality signal: ${reasonCode}.`);
    }
    if (provider && provider.attemptedProviderKeys.length > 1) {
      warnings.push(
        `Extraction escalated across providers: ${provider.attemptedProviderKeys.join(" -> ")}.`
      );
    }
    return warnings;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string.`);
    }
    return value.trim();
  }
}

function normalizeWorkspacePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed.startsWith("/workspace/") || trimmed.includes("..")) {
    return null;
  }
  if (
    trimmed === "/workspace/input" ||
    trimmed.startsWith("/workspace/input/") ||
    trimmed === "/workspace/outbound" ||
    trimmed.startsWith("/workspace/outbound/")
  ) {
    return null;
  }
  return trimmed;
}

function normalizeWorkspaceDirectory(value: string): string | null {
  const normalized = normalizeWorkspacePath(value);
  if (normalized === null) {
    return null;
  }
  return normalized.replace(/\/+$/g, "");
}

function normalizeMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

function resolveEffectiveMimeType(mimeType: string | null | undefined, path: string): string {
  const normalized = normalizeMime(mimeType);
  const inferred = inferMimeFromPath(path);
  if (
    normalized.length === 0 ||
    normalized === "application/octet-stream" ||
    normalized === "binary/octet-stream"
  ) {
    return inferred;
  }
  return normalized;
}

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".tsv")) return "text/tab-separated-values";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".xml")) return "application/xml";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/yaml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function inferDocumentProjectSourceFormat(input: {
  sourcePath: string;
  mimeType: string;
}): DocumentWorkspaceProjectSourceFormat {
  const lowerPath = input.sourcePath.toLowerCase();
  const normalizedMime = normalizeMime(input.mimeType);
  if (lowerPath.endsWith(".pdf") || normalizedMime === "application/pdf") {
    return "pdf";
  }
  if (
    lowerPath.endsWith(".docx") ||
    normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    lowerPath.endsWith(".xlsx") ||
    normalizedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  if (lowerPath.endsWith(".csv") || normalizedMime === "text/csv") {
    return "csv";
  }
  if (normalizedMime.startsWith("text/")) {
    return "text";
  }
  if (normalizedMime.startsWith("image/")) {
    return "image";
  }
  return "other";
}

function isSupportedExtractionMime(mimeType: string, sourcePath: string): boolean {
  if (mimeType.startsWith("image/")) {
    return true;
  }
  return (
    SIMPLE_TEXT_MIME_TYPES.has(mimeType) ||
    SHARED_EXTRACTION_MIME_TYPES.has(mimeType) ||
    SPREADSHEET_MIME_TYPES.has(mimeType) ||
    inferMimeFromPath(sourcePath) !== "application/octet-stream"
  );
}

function mapExtractMode(
  mode: WorkspaceDocumentExtractInput["mode"]
): KnowledgeDocumentProcessingInput["requestedMode"] {
  switch (mode) {
    case "text":
      return "local";
    case "ocr":
      return "default_provider";
    case "layout":
      return "high_quality_fallback";
    case "auto":
    default:
      return "auto";
  }
}

function sanitizeSheetName(sheetName: string): string {
  return sheetName.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Sheet";
}

function lastPathSegment(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const last = parts[parts.length - 1] ?? "";
  return last.length > 0 ? last : null;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter((path) => path.trim().length > 0)));
}

function workspaceDirectory(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized;
}

function parseVersionedWorkspaceFilename(path: string): {
  directory: string;
  familyKey: string;
  versionNumber: number;
} | null {
  const name = lastPathSegment(path);
  if (name === null) {
    return null;
  }
  const match = /^(.*?)(?: \((\d+)\))?(\.[^./]+)$/.exec(name);
  if (match === null) {
    return null;
  }
  const baseName = (match[1] ?? "").trim();
  const extension = (match[3] ?? "").trim().toLowerCase();
  if (baseName.length === 0 || extension.length === 0) {
    return null;
  }
  return {
    directory: workspaceDirectory(path),
    familyKey: `${baseName.toLowerCase()}${extension}`,
    versionNumber: Number.parseInt(match[2] ?? "0", 10) || 0
  };
}

function buildImportedOfficeRenderScaffold(input: {
  sourceFormat: "docx" | "xlsx";
  projectSourcePath: string;
}): string {
  if (input.sourceFormat === "docx") {
    return [
      "from pathlib import Path",
      "from docx import Document",
      "",
      `SOURCE_PATH = Path(${JSON.stringify(input.projectSourcePath)})`,
      "OUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)",
      "",
      "def build() -> None:",
      "    document = Document(str(SOURCE_PATH))",
      "    # Edit the loaded DOCX deterministically before saving if needed.",
      "    document.save(str(OUTPUT_PATH))",
      "",
      'if __name__ == "__main__":',
      "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
      "    build()"
    ].join("\n");
  }
  return [
    "from pathlib import Path",
    "from openpyxl import load_workbook",
    "",
    `SOURCE_PATH = Path(${JSON.stringify(input.projectSourcePath)})`,
    "OUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)",
    "",
    "def build() -> None:",
    "    workbook = load_workbook(filename=str(SOURCE_PATH))",
    "    # Edit the loaded workbook deterministically before saving if needed.",
    "    workbook.save(str(OUTPUT_PATH))",
    "",
    'if __name__ == "__main__":',
    "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
    "    build()"
  ].join("\n");
}

function buildImportedOfficePdfExportScaffold(input: {
  sourceFormat: "docx" | "xlsx";
  projectSourcePath: string;
}): string {
  return [
    "from pathlib import Path",
    "import shutil",
    "import subprocess",
    "import tempfile",
    "",
    `SOURCE_PATH = Path(${JSON.stringify(input.projectSourcePath)})`,
    "OUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)",
    "",
    "def export_pdf() -> None:",
    '    with tempfile.TemporaryDirectory(prefix="persai-office-pdf-", dir="/tmp") as tmp_dir:',
    "        temp_root = Path(tmp_dir)",
    "        out_dir = temp_root / 'out'",
    "        out_dir.mkdir(parents=True, exist_ok=True)",
    "        # Keep LibreOffice first-run state in writable /tmp, not the read-only image layer.",
    "        profile_uri = (temp_root / 'libreoffice-profile').resolve().as_uri()",
    "        command = [",
    "            'soffice',",
    "            '--headless',",
    "            '--nologo',",
    "            '--nodefault',",
    "            '--norestore',",
    "            '--nolockcheck',",
    "            '--nofirststartwizard',",
    "            f'-env:UserInstallation={profile_uri}',",
    "            '--convert-to',",
    "            'pdf',",
    "            '--outdir',",
    "            str(out_dir),",
    "            str(SOURCE_PATH),",
    "        ]",
    "        completed = subprocess.run(command, capture_output=True, text=True)",
    "        if completed.returncode != 0:",
    `            raise RuntimeError(${JSON.stringify(
      `LibreOffice failed to export imported ${input.sourceFormat.toUpperCase()} to PDF`
    )} + f": {completed.stderr.strip() or completed.stdout.strip() or 'unknown error'}")`,
    "        exported = out_dir / f'{SOURCE_PATH.stem}.pdf'",
    "        if not exported.is_file():",
    "            pdf_candidates = sorted(out_dir.glob('*.pdf'))",
    "            if len(pdf_candidates) != 1:",
    `                raise FileNotFoundError(${JSON.stringify(
      `LibreOffice did not create the declared PDF for imported ${input.sourceFormat.toUpperCase()} export.`
    )})`,
    "            exported = pdf_candidates[0]",
    "        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
    "        shutil.move(str(exported), str(OUTPUT_PATH))",
    "",
    "if __name__ == '__main__':",
    "    export_pdf()"
  ].join("\n");
}

async function readPdfPageCount(buffer: Buffer): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (
      dataBuffer: Buffer,
      options?: { max?: number }
    ) => Promise<{ numpages?: number }>;
    const result = await pdfParse(buffer, { max: 1 });
    return typeof result.numpages === "number" && Number.isFinite(result.numpages)
      ? result.numpages
      : null;
  } catch {
    return null;
  }
}
