import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  AssistantDocumentDescriptorMode,
  AssistantDocumentOutputFormat
} from "@prisma/client";
import { AssistantDocumentJobService } from "./assistant-document-job.service";
import type {
  AssistantDocumentInspectionSummary,
  AssistantDocumentWorkspaceFacts
} from "./assistant-document-link-metadata";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

type WorkspaceDocumentRegisterVersionInput = {
  assistantId: string;
  workspaceId: string;
  channel: "web" | "telegram";
  externalThreadKey: string;
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  descriptorMode: "create_pdf_document" | "revise_document" | "create_data_document" | null;
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
  descriptorMode: "create_pdf_document" | "revise_document" | "create_data_document";
  documentType: "pdf_document" | "data_document";
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
    const outputPath = normalizeWorkspacePath(input.outputPath);
    if (outputPath === null) {
      return {
        accepted: false,
        code: "invalid_output_path",
        message: "document.register_version outputPath must be a valid /workspace/... file path."
      };
    }
    const workspaceProjectPath =
      input.workspaceProjectPath === null
        ? null
        : normalizeWorkspaceDirectory(input.workspaceProjectPath);
    if (input.workspaceProjectPath !== null && workspaceProjectPath === null) {
      return {
        accepted: false,
        code: "invalid_project_path",
        message:
          "document.register_version workspaceProjectPath must be a valid /workspace/... directory."
      };
    }
    const sourceManifestPath =
      input.sourceManifestPath === null ? null : normalizeWorkspacePath(input.sourceManifestPath);
    if (input.sourceManifestPath !== null && sourceManifestPath === null) {
      return {
        accepted: false,
        code: "invalid_source_manifest_path",
        message:
          "document.register_version sourceManifestPath must be a valid /workspace/... file path."
      };
    }
    const inspectionPath =
      input.inspectionPath === null ? null : normalizeWorkspacePath(input.inspectionPath);
    if (input.inspectionPath !== null && inspectionPath === null) {
      return {
        accepted: false,
        code: "invalid_inspection_path",
        message:
          "document.register_version inspectionPath must be a valid /workspace/... file path."
      };
    }

    const outputFormat = resolveOutputFormatFromPath(outputPath);
    if (outputFormat === null || outputFormat === "pptx") {
      return {
        accepted: false,
        code: "unsupported_output_format",
        message:
          "document.register_version currently supports rendered PDF, XLSX, and DOCX workspace outputs."
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
      sourceManifestPath === null
        ? null
        : await this.readJsonWorkspaceObject(input.workspaceId, sourceManifestPath);
    if (sourceManifestPath !== null && sourceManifest === null) {
      return {
        accepted: false,
        code: "source_manifest_not_found",
        message: `Workspace source manifest not found or invalid JSON: ${sourceManifestPath}`
      };
    }

    const inspectionSummary =
      inspectionPath === null
        ? null
        : await this.readInspectionSummary(input.workspaceId, inspectionPath);
    if (inspectionPath !== null && inspectionSummary === null) {
      return {
        accepted: false,
        code: "inspection_not_found",
        message: `Workspace inspection sidecar not found or invalid JSON: ${inspectionPath}`
      };
    }

    const descriptorMode = this.resolveDescriptorMode({
      descriptorMode: input.descriptorMode,
      docId: input.docId,
      outputFormat
    });
    if (descriptorMode === null) {
      return {
        accepted: false,
        code: "invalid_descriptor_mode",
        message:
          "document.register_version must use revise_document for an existing docId. For a new visible workspace output, omit descriptorMode or use create_pdf_document for PDF outputs."
      };
    }

    const workspaceFacts: AssistantDocumentWorkspaceFacts = {
      workspaceProjectPath,
      outputPath,
      sourceManifestPath,
      sourceManifest,
      inspectionPath,
      inspectionSummary
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
      ...(input.docId === null ? {} : { docId: input.docId }),
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
      workspaceProjectPath,
      sourceManifestPath,
      inspectionPath
    };
  }

  private resolveDescriptorMode(input: {
    descriptorMode: WorkspaceDocumentRegisterVersionInput["descriptorMode"];
    docId: string | null;
    outputFormat: AssistantDocumentOutputFormat;
  }): AssistantDocumentDescriptorMode | null {
    if (input.docId !== null) {
      return input.descriptorMode === null || input.descriptorMode === "revise_document"
        ? "revise_document"
        : null;
    }
    if (input.outputFormat === "xlsx" || input.outputFormat === "docx") {
      return input.descriptorMode === null || input.descriptorMode === "create_data_document"
        ? "create_data_document"
        : null;
    }
    return input.descriptorMode === null || input.descriptorMode === "create_pdf_document"
      ? "create_pdf_document"
      : null;
  }

  private async readInspectionSummary(
    workspaceId: string,
    path: string
  ): Promise<AssistantDocumentInspectionSummary | null> {
    const json = await this.readJsonWorkspaceObject(workspaceId, path);
    if (json === null) {
      return null;
    }
    const counts = json["counts"];
    return {
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
  const path = normalizeWorkspacePath(value);
  if (path === null) {
    return null;
  }
  const normalized = path.replace(/\/+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function resolveOutputFormatFromPath(path: string): "pdf" | "pptx" | "xlsx" | "docx" | null {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowered.endsWith(".pptx")) {
    return "pptx";
  }
  if (lowered.endsWith(".xlsx")) {
    return "xlsx";
  }
  if (lowered.endsWith(".docx")) {
    return "docx";
  }
  return null;
}

function readOptionalJsonNumber(value: unknown, key: string): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null;
}
