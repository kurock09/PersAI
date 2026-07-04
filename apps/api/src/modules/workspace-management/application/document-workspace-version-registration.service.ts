import { BadRequestException, Injectable } from "@nestjs/common";
import {
  type DocumentWorkspaceProjectSourceFormat,
  type DocumentWorkspaceProjectSourceKind
} from "@persai/runtime-contract";
import { AssistantDocumentJobService } from "./assistant-document-job.service";
import type { AssistantDocumentWorkspaceFacts } from "./assistant-document-link-metadata";
import {
  resolveVisibleWorkspaceOutputFormatFromPath,
  type DocumentWorkspaceInspectionFacts,
  type VisibleWorkspaceDocumentOutputFormat
} from "./document-workspace-deliverable-gating";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  normalizeActiveWorkspaceDirectoryPath,
  normalizeActiveWorkspaceFilePath
} from "./workspace-visible-paths";

type WorkspaceDocumentRegisterVersionInput = {
  assistantId: string;
  workspaceId: string;
  channel: "web" | "telegram";
  externalThreadKey: string;
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  descriptorMode:
    | "create_document"
    | "create_pdf_document"
    | "revise_document"
    | "create_data_document"
    | null;
  docId: string | null;
  requestedName: string | null;
  workspaceProjectPath: string | null;
  outputPath: string;
  sourceManifestPath: string | null;
  inspectionPath: string | null;
};

type WorkspaceDocumentRegisterVersionRejected = {
  accepted: false;
  code: string;
  message: string;
};

type WorkspaceDocumentRegisterVersionAccepted = {
  accepted: true;
  docId: string;
  versionId: string;
  versionNumber: number;
  descriptorMode: "create_document" | "revise_document";
  documentType: "workspace_document";
  outputFormat: "pdf" | "xlsx" | "docx";
  outputPath: string;
  workspaceProjectPath: string | null;
  sourceManifestPath: string | null;
  inspectionPath: string | null;
};

@Injectable()
export class DocumentWorkspaceVersionRegistrationService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly assistantDocumentJobService: AssistantDocumentJobService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  parseInput(value: unknown): WorkspaceDocumentRegisterVersionInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      channel: row.channel === "telegram" ? "telegram" : "web",
      externalThreadKey: this.requiredString(row.externalThreadKey, "externalThreadKey"),
      sourceUserMessageText: this.requiredString(
        row.sourceUserMessageText,
        "sourceUserMessageText"
      ),
      sourceUserMessageCreatedAt: this.requiredString(
        row.sourceUserMessageCreatedAt,
        "sourceUserMessageCreatedAt"
      ),
      descriptorMode:
        row.descriptorMode === "create_document" ||
        row.descriptorMode === "create_pdf_document" ||
        row.descriptorMode === "revise_document" ||
        row.descriptorMode === "create_data_document"
          ? row.descriptorMode
          : null,
      docId: this.optionalString(row.docId),
      requestedName: this.optionalString(row.requestedName),
      workspaceProjectPath: this.optionalString(row.workspaceProjectPath),
      outputPath: this.requiredString(row.outputPath, "outputPath"),
      sourceManifestPath: this.optionalString(row.sourceManifestPath),
      inspectionPath: this.optionalString(row.inspectionPath)
    };
  }

  async execute(
    input: WorkspaceDocumentRegisterVersionInput
  ): Promise<WorkspaceDocumentRegisterVersionAccepted | WorkspaceDocumentRegisterVersionRejected> {
    const outputPath = normalizeActiveWorkspaceFilePath(input.outputPath);
    if (outputPath === null) {
      return {
        accepted: false,
        code: "invalid_output_path",
        message:
          "Automatic document version registration requires a valid active hierarchical /workspace/... outputPath."
      };
    }
    const requestedWorkspaceProjectPath =
      input.workspaceProjectPath === null
        ? null
        : normalizeActiveWorkspaceDirectoryPath(input.workspaceProjectPath);
    if (input.workspaceProjectPath !== null && requestedWorkspaceProjectPath === null) {
      return {
        accepted: false,
        code: "invalid_project_path",
        message:
          "workspaceProjectPath must be a valid active hierarchical /workspace/... directory when provided."
      };
    }
    const requestedSourceManifestPath =
      input.sourceManifestPath === null
        ? null
        : normalizeActiveWorkspaceFilePath(input.sourceManifestPath);
    if (input.sourceManifestPath !== null && requestedSourceManifestPath === null) {
      return {
        accepted: false,
        code: "invalid_source_manifest_path",
        message:
          "sourceManifestPath must be a valid active hierarchical /workspace/... file path when provided."
      };
    }
    const inspectionPath =
      input.inspectionPath === null ? null : normalizeActiveWorkspaceFilePath(input.inspectionPath);
    if (input.inspectionPath !== null && inspectionPath === null) {
      return {
        accepted: false,
        code: "invalid_inspection_path",
        message:
          "inspectionPath must be a valid active hierarchical /workspace/... file path when provided."
      };
    }

    const outputFormat = resolveVisibleWorkspaceOutputFormatFromPath(outputPath);
    if (outputFormat === null || outputFormat === "pptx") {
      return {
        accepted: false,
        code: "unsupported_output_format",
        message:
          "Automatic document version registration currently supports PDF, XLSX, and DOCX workspace outputs."
      };
    }

    const outputMetadata = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: outputPath
    });
    if (outputMetadata === null) {
      return {
        accepted: false,
        code: "output_not_found",
        message: `Workspace output not found: ${outputPath}`
      };
    }

    const projectContext = await this.resolveProjectContext({
      workspaceId: input.workspaceId,
      requestedWorkspaceProjectPath,
      requestedSourceManifestPath,
      outputPath,
      outputFormat
    });
    if (!projectContext.ok) {
      return {
        accepted: false,
        code: projectContext.code,
        message: projectContext.message
      };
    }

    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        surface: input.channel,
        surfaceThreadKey: input.externalThreadKey
      },
      select: {
        id: true
      }
    });
    if (chat === null) {
      return {
        accepted: false,
        code: "chat_not_found",
        message: "The active chat could not be resolved for document version registration."
      };
    }

    const assistant = await this.prisma.assistant.findFirst({
      where: {
        id: input.assistantId,
        workspaceId: input.workspaceId
      },
      select: {
        userId: true
      }
    });
    if (assistant === null) {
      return {
        accepted: false,
        code: "assistant_not_found",
        message: "The active assistant could not be resolved for document version registration."
      };
    }

    const sourceManifest =
      projectContext.sourceManifestPath === null
        ? null
        : await this.readJsonWorkspaceObject(input.workspaceId, projectContext.sourceManifestPath);
    if (requestedSourceManifestPath !== null && sourceManifest === null) {
      return {
        accepted: false,
        code: "source_manifest_not_found",
        message: `Workspace source manifest not found or invalid JSON: ${projectContext.sourceManifestPath}`
      };
    }

    const inspection =
      inspectionPath === null
        ? null
        : await this.readInspectionFacts(input.workspaceId, inspectionPath);
    const normalizedInspection =
      inspection !== null &&
      inspection.summary !== null &&
      (inspection.sourcePath === null || inspection.sourcePath === outputPath) &&
      (inspection.format ?? inspection.summary.format) === outputFormat
        ? inspection
        : null;

    const effectiveDocId =
      input.docId ??
      (await this.resolveExistingDocIdByOutputPath({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        outputPath
      }));
    const effectiveDescriptorMode: WorkspaceDocumentRegisterVersionInput["descriptorMode"] =
      input.docId === null && effectiveDocId !== null && input.descriptorMode === null
        ? "revise_document"
        : input.descriptorMode;
    const descriptorMode = this.resolveDescriptorMode({
      descriptorMode: effectiveDescriptorMode,
      docId: effectiveDocId,
      outputFormat
    });
    if (descriptorMode === null) {
      return {
        accepted: false,
        code: "invalid_descriptor_mode",
        message:
          "Existing document identities require revise_document semantics. For a new visible workspace output, omit descriptorMode or use create_document."
      };
    }

    const workspaceFacts: AssistantDocumentWorkspaceFacts = {
      workspaceProjectPath: projectContext.workspaceProjectPath,
      projectManifestPath: projectContext.projectManifestPath,
      projectSourcePath: projectContext.projectSourcePath,
      sourceKind: projectContext.sourceKind,
      outputPath,
      sourcePath: projectContext.sourcePath,
      sourceFormat: projectContext.sourceFormat,
      sourceMimeType: projectContext.sourceMimeType,
      sourceManifestPath: projectContext.sourceManifestPath,
      sourceManifest,
      inspectionPath: normalizedInspection === null ? null : inspectionPath,
      inspectionSummary: normalizedInspection?.summary ?? null
    };

    const registered = await this.assistantDocumentJobService.registerVisibleWorkspaceVersion({
      assistantId: input.assistantId,
      userId: assistant.userId,
      workspaceId: input.workspaceId,
      chatId: chat.id,
      sourceUserMessageText: input.sourceUserMessageText,
      sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt,
      descriptorMode,
      outputFormat,
      requestedName: input.requestedName,
      ...(effectiveDocId === null ? {} : { docId: effectiveDocId }),
      workspaceFacts
    });

    return {
      accepted: true,
      docId: registered.docId,
      versionId: registered.versionId,
      versionNumber: registered.versionNumber,
      descriptorMode:
        registered.descriptorMode as WorkspaceDocumentRegisterVersionAccepted["descriptorMode"],
      documentType:
        registered.documentType as WorkspaceDocumentRegisterVersionAccepted["documentType"],
      outputFormat:
        registered.outputFormat as WorkspaceDocumentRegisterVersionAccepted["outputFormat"],
      outputPath,
      workspaceProjectPath: projectContext.workspaceProjectPath,
      sourceManifestPath: projectContext.sourceManifestPath,
      inspectionPath
    };
  }

  private async resolveExistingDocIdByOutputPath(input: {
    assistantId: string;
    workspaceId: string;
    outputPath: string;
  }): Promise<string | null> {
    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        currentVersion: {
          is: {
            sourceJson: {
              path: ["metadata", "documentWorkspace", "outputPath"],
              equals: input.outputPath
            }
          }
        }
      },
      select: { id: true }
    });
    return document?.id ?? null;
  }

  private resolveDescriptorMode(input: {
    descriptorMode: WorkspaceDocumentRegisterVersionInput["descriptorMode"];
    docId: string | null;
    outputFormat: VisibleWorkspaceDocumentOutputFormat;
  }): WorkspaceDocumentRegisterVersionAccepted["descriptorMode"] | null {
    if (input.docId !== null) {
      return input.descriptorMode === null || input.descriptorMode === "revise_document"
        ? "revise_document"
        : null;
    }
    return input.descriptorMode === null ||
      input.descriptorMode === "create_document" ||
      input.descriptorMode === "create_pdf_document" ||
      input.descriptorMode === "create_data_document"
      ? "create_document"
      : null;
  }

  private async resolveProjectContext(input: {
    workspaceId: string;
    requestedWorkspaceProjectPath: string | null;
    requestedSourceManifestPath: string | null;
    outputPath: string;
    outputFormat: VisibleWorkspaceDocumentOutputFormat;
  }): Promise<
    | {
        ok: true;
        workspaceProjectPath: string | null;
        projectManifestPath: string | null;
        projectSourcePath: string | null;
        sourceKind: DocumentWorkspaceProjectSourceKind | null;
        sourcePath: string | null;
        sourceFormat: DocumentWorkspaceProjectSourceFormat | null;
        sourceMimeType: string | null;
        sourceManifestPath: string | null;
      }
    | {
        ok: false;
        code: string;
        message: string;
      }
  > {
    const workspaceProjectPath = input.requestedWorkspaceProjectPath;
    const projectManifestPath =
      workspaceProjectPath === null ? null : `${workspaceProjectPath}/project.json`;
    const existingProjectManifestMetadata =
      projectManifestPath === null
        ? null
        : await this.workspaceFileMetadataService.get({
            workspaceId: input.workspaceId,
            path: projectManifestPath
          });
    const existingProjectManifest =
      existingProjectManifestMetadata === null
        ? null
        : await this.readJsonWorkspaceObject(input.workspaceId, projectManifestPath!);
    if (existingProjectManifestMetadata !== null && existingProjectManifest === null) {
      return {
        ok: false,
        code: "project_manifest_invalid",
        message: `Workspace project manifest is invalid JSON: ${projectManifestPath}`
      };
    }

    const siblingMarkdownPath = await this.resolveSiblingMarkdownPath({
      workspaceId: input.workspaceId,
      outputPath: input.outputPath
    });
    const sourceKind = this.resolveProjectSourceKind(existingProjectManifest, siblingMarkdownPath);
    const sourcePath =
      this.resolveProjectSourcePath(existingProjectManifest) ??
      (sourceKind === "authored_workspace_project" ? siblingMarkdownPath : null);
    const projectSourcePath =
      this.resolveProjectSourceCopyPath(existingProjectManifest) ??
      (sourceKind === "authored_workspace_project" ? sourcePath : null);
    const sourceFormat =
      this.resolveProjectSourceFormat(existingProjectManifest) ??
      (sourceKind === null
        ? null
        : inferProjectSourceFormatFromFacts({
            sourceKind,
            sourcePath,
            outputFormat: input.outputFormat
          }));
    const sourceMimeType =
      this.resolveProjectSourceMimeType(existingProjectManifest) ??
      (sourceFormat === null
        ? null
        : inferProjectSourceMimeType({
            sourceFormat
          }));
    const sourceManifestPath =
      input.requestedSourceManifestPath ??
      this.resolveProjectExtractManifestPath(existingProjectManifest);

    return {
      ok: true,
      workspaceProjectPath,
      projectManifestPath: existingProjectManifestMetadata === null ? null : projectManifestPath,
      projectSourcePath,
      sourceKind,
      sourcePath,
      sourceFormat,
      sourceMimeType,
      sourceManifestPath
    };
  }

  private resolveProjectSourceKind(
    manifest: Record<string, unknown> | null,
    siblingMarkdownPath: string | null
  ): DocumentWorkspaceProjectSourceKind | null {
    const sourceKind = manifest?.["sourceKind"];
    if (sourceKind === "imported_workspace_file" || sourceKind === "authored_workspace_project") {
      return sourceKind;
    }
    return siblingMarkdownPath === null ? null : "authored_workspace_project";
  }

  private resolveProjectSourcePath(manifest: Record<string, unknown> | null): string | null {
    const sourcePath = manifest?.["sourcePath"];
    return typeof sourcePath === "string" && sourcePath.trim().length > 0
      ? sourcePath.trim()
      : null;
  }

  private resolveProjectSourceCopyPath(manifest: Record<string, unknown> | null): string | null {
    const projectSourcePath = manifest?.["projectSourcePath"];
    return typeof projectSourcePath === "string" && projectSourcePath.trim().length > 0
      ? projectSourcePath.trim()
      : null;
  }

  private resolveProjectSourceFormat(
    manifest: Record<string, unknown> | null
  ): DocumentWorkspaceProjectSourceFormat | null {
    const sourceFormat = manifest?.["sourceFormat"];
    return isProjectSourceFormat(sourceFormat) ? sourceFormat : null;
  }

  private resolveProjectSourceMimeType(manifest: Record<string, unknown> | null): string | null {
    const sourceMimeType = manifest?.["sourceMimeType"] ?? manifest?.["mimeType"];
    return typeof sourceMimeType === "string" && sourceMimeType.trim().length > 0
      ? sourceMimeType.trim()
      : null;
  }

  private resolveProjectExtractManifestPath(
    manifest: Record<string, unknown> | null
  ): string | null {
    const extractManifestPath = manifest?.["extractManifestPath"];
    return typeof extractManifestPath === "string" && extractManifestPath.trim().length > 0
      ? extractManifestPath.trim()
      : null;
  }

  private async resolveSiblingMarkdownPath(input: {
    workspaceId: string;
    outputPath: string;
  }): Promise<string | null> {
    const dotIndex = input.outputPath.lastIndexOf(".");
    if (dotIndex <= "/workspace/".length) {
      return null;
    }
    const candidate = `${input.outputPath.slice(0, dotIndex)}.md`;
    const metadata = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: candidate
    });
    return metadata === null ? null : candidate;
  }

  private async readInspectionFacts(
    workspaceId: string,
    path: string
  ): Promise<DocumentWorkspaceInspectionFacts | null> {
    const json = await this.readJsonWorkspaceObject(workspaceId, path);
    if (json === null) {
      return null;
    }
    const counts = json["counts"];
    return {
      sourcePath: typeof json["sourcePath"] === "string" ? json["sourcePath"] : null,
      format:
        json["format"] === "pdf" || json["format"] === "xlsx" || json["format"] === "docx"
          ? json["format"]
          : null,
      summary: {
        format:
          json["format"] === "pdf" || json["format"] === "xlsx" || json["format"] === "docx"
            ? json["format"]
            : null,
        counts: {
          pageCount: readOptionalJsonNumber(counts, "pageCount"),
          sheetCount: readOptionalJsonNumber(counts, "sheetCount"),
          formulaCount: readOptionalJsonNumber(counts, "formulaCount"),
          blankSheetCount: readOptionalJsonNumber(counts, "blankSheetCount"),
          paragraphCount: readOptionalJsonNumber(counts, "paragraphCount"),
          headingCount: readOptionalJsonNumber(counts, "headingCount"),
          tableCount: readOptionalJsonNumber(counts, "tableCount"),
          textCharCount: readOptionalJsonNumber(counts, "textCharCount")
        },
        warnings: Array.isArray(json["warnings"])
          ? json["warnings"].filter((entry): entry is string => typeof entry === "string")
          : []
      }
    };
  }

  private async readJsonWorkspaceObject(
    workspaceId: string,
    path: string
  ): Promise<Record<string, unknown> | null> {
    const metadata = await this.workspaceFileMetadataService.get({
      workspaceId,
      path
    });
    if (metadata === null) {
      return null;
    }
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId,
      workspaceRelPath: path
    });
    const downloaded = await this.mediaObjectStorage.downloadObject(objectKey);
    if (downloaded === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(downloaded.buffer.toString("utf8"));
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private optionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}

function readOptionalJsonNumber(value: unknown, key: string): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null;
}

function inferProjectSourceFormatFromFacts(input: {
  sourceKind: DocumentWorkspaceProjectSourceKind;
  sourcePath: string | null;
  outputFormat: VisibleWorkspaceDocumentOutputFormat;
}): DocumentWorkspaceProjectSourceFormat {
  const lowerSourcePath = input.sourcePath?.toLowerCase() ?? "";
  if (lowerSourcePath.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowerSourcePath.endsWith(".docx")) {
    return "docx";
  }
  if (lowerSourcePath.endsWith(".xlsx")) {
    return "xlsx";
  }
  if (lowerSourcePath.endsWith(".csv")) {
    return "csv";
  }
  if (lowerSourcePath.endsWith(".html") || lowerSourcePath.endsWith(".htm")) {
    return "html";
  }
  if (lowerSourcePath.endsWith(".py")) {
    return "python";
  }
  if (lowerSourcePath.endsWith(".txt") || lowerSourcePath.endsWith(".md")) {
    return "text";
  }
  if (
    lowerSourcePath.endsWith(".png") ||
    lowerSourcePath.endsWith(".jpg") ||
    lowerSourcePath.endsWith(".jpeg") ||
    lowerSourcePath.endsWith(".webp")
  ) {
    return "image";
  }
  if (input.sourceKind === "authored_workspace_project") {
    return input.outputFormat === "pdf" ? "html" : "python";
  }
  return "other";
}

function inferProjectSourceMimeType(input: {
  sourceFormat: DocumentWorkspaceProjectSourceFormat;
}): string | null {
  switch (input.sourceFormat) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv":
      return "text/csv";
    case "text":
      return "text/plain";
    case "html":
      return "text/html";
    case "python":
      return "text/x-python";
    case "image":
      return "image/*";
    case "other":
    default:
      return null;
  }
}

function isProjectSourceFormat(value: unknown): value is DocumentWorkspaceProjectSourceFormat {
  return (
    typeof value === "string" &&
    (["pdf", "docx", "xlsx", "csv", "text", "html", "python", "image", "other"] as const).includes(
      value as DocumentWorkspaceProjectSourceFormat
    )
  );
}
