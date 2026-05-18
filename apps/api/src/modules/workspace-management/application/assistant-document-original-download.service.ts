import { GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { RuntimeDocumentGammaCompanionOriginal } from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ORIGINAL_PPTX_GONE_MESSAGE =
  "Original PPTX is no longer available. The PDF preview is still available.";
const GAMMA_ALLOWED_EXPORT_HOST_SUFFIX = ".gamma.app";

type OriginalGammaExportRef = {
  exportUrl: string;
  filename: string | null;
};

@Injectable()
export class AssistantDocumentOriginalDownloadService {
  private readonly logger = new Logger(AssistantDocumentOriginalDownloadService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async downloadOriginalPresentation(input: {
    assistantId: string;
    workspaceId: string;
    docId: string;
    versionId?: string | null;
  }): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const resolved = await this.resolveVersionForDownload(input);
    if (resolved === null) {
      this.logger.log(
        `[document-original] resolve_failed docId=${input.docId} versionId=${
          input.versionId ?? "current"
        }`
      );
      throw new NotFoundException("Presentation document was not found.");
    }
    const originalExport = this.readOriginalPptxExport(
      resolved.providerMetadataJson,
      this.resolveFallbackPptxFilename(resolved.sourceJson)
    );
    if (originalExport === null) {
      this.logger.log(
        `[document-original] no_companion docId=${input.docId} versionId=${
          input.versionId ?? "current"
        }`
      );
      throw new GoneException(ORIGINAL_PPTX_GONE_MESSAGE);
    }

    this.logger.log(
      `[document-original] streaming docId=${input.docId} versionId=${
        input.versionId ?? "current"
      } filename=${originalExport.filename ?? "fallback"}`
    );
    const response = await fetch(originalExport.exportUrl, { method: "GET" }).catch(() => null);
    if (response === null || !response.ok) {
      this.logger.log(
        `[document-original] export_fetch_failed docId=${input.docId} versionId=${
          input.versionId ?? "current"
        } status=${response?.status ?? "no_response"}`
      );
      throw new GoneException(ORIGINAL_PPTX_GONE_MESSAGE);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      this.logger.log(
        `[document-original] empty_body docId=${input.docId} versionId=${
          input.versionId ?? "current"
        }`
      );
      throw new GoneException(ORIGINAL_PPTX_GONE_MESSAGE);
    }

    return {
      buffer,
      contentType: response.headers.get("content-type")?.split(";")[0]?.trim() || PPTX_MIME_TYPE,
      filename: originalExport.filename ?? this.resolveFallbackPptxFilename(resolved.sourceJson)
    };
  }

  private async resolveVersionForDownload(input: {
    assistantId: string;
    workspaceId: string;
    docId: string;
    versionId?: string | null;
  }): Promise<{ sourceJson: unknown; providerMetadataJson: unknown } | null> {
    if (typeof input.versionId === "string" && input.versionId.trim().length > 0) {
      const version = await this.prisma.assistantDocumentVersion.findFirst({
        where: {
          id: input.versionId,
          docId: input.docId,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          document: {
            id: input.docId,
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            documentType: "presentation"
          }
        },
        select: {
          sourceJson: true,
          providerMappings: {
            where: { provider: "gamma" },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { providerMetadataJson: true }
          }
        }
      });
      return version === null
        ? null
        : {
            sourceJson: version.sourceJson,
            providerMetadataJson: version.providerMappings[0]?.providerMetadataJson ?? null
          };
    }

    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        id: input.docId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        documentType: "presentation"
      },
      select: {
        currentVersion: {
          select: {
            sourceJson: true,
            providerMappings: {
              where: { provider: "gamma" },
              orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { providerMetadataJson: true }
            }
          }
        }
      }
    });
    return document?.currentVersion === null || document?.currentVersion === undefined
      ? null
      : {
          sourceJson: document.currentVersion.sourceJson,
          providerMetadataJson:
            document.currentVersion.providerMappings[0]?.providerMetadataJson ?? null
        };
  }

  private readOriginalPptxExport(
    value: unknown,
    fallbackFilename: string
  ): OriginalGammaExportRef | null {
    const row = this.asObject(value);
    const companionOriginal = this.readCompanionOriginal(row?.companionOriginal);
    if (companionOriginal !== null && companionOriginal.status === "ready") {
      return {
        exportUrl: companionOriginal.exportUrl,
        filename: this.readFilenameOrFallback(companionOriginal.filename, fallbackFilename)
      };
    }
    const legacyCompanionOriginal = this.asObject(row?.companionOriginal);
    const legacyCompanionExportUrl =
      typeof legacyCompanionOriginal?.exportUrl === "string"
        ? this.readTrustedGammaExportUrl(legacyCompanionOriginal.exportUrl)
        : null;
    if (legacyCompanionOriginal?.format === "pptx" && legacyCompanionOriginal?.status === "ready") {
      if (legacyCompanionExportUrl !== null) {
        return {
          exportUrl: legacyCompanionExportUrl,
          filename: this.readFilenameOrFallback(legacyCompanionOriginal.filename, fallbackFilename)
        };
      }
    }
    const trustedTopLevelExportUrl =
      typeof row?.exportUrl === "string" ? this.readTrustedGammaExportUrl(row.exportUrl) : null;
    if (
      row?.provider === "gamma" &&
      row.outputType === "pptx" &&
      trustedTopLevelExportUrl !== null
    ) {
      return {
        exportUrl: trustedTopLevelExportUrl,
        filename: this.readFilenameOrFallback(row.filename, fallbackFilename)
      };
    }
    return null;
  }

  private resolveFallbackPptxFilename(sourceJson: unknown): string {
    const row =
      sourceJson !== null && typeof sourceJson === "object" && !Array.isArray(sourceJson)
        ? (sourceJson as Record<string, unknown>)
        : null;
    const requestedName =
      typeof row?.requestedName === "string" && row.requestedName.trim().length > 0
        ? row.requestedName.trim()
        : "presentation";
    const sanitizedBase = requestedName
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\.pdf$/i, "")
      .replace(/\.pptx$/i, "")
      .trim();
    return `${sanitizedBase.length > 0 ? sanitizedBase : "presentation"}.pptx`;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private readCompanionOriginal(value: unknown): RuntimeDocumentGammaCompanionOriginal | null {
    const row = this.asObject(value);
    if (row?.format !== "pptx" || (row?.status !== "ready" && row?.status !== "unavailable")) {
      return null;
    }
    if (row.status === "ready") {
      const exportUrl =
        typeof row.exportUrl === "string" ? this.readTrustedGammaExportUrl(row.exportUrl) : null;
      if (
        typeof row.generationId !== "string" ||
        typeof row.gammaId !== "string" ||
        exportUrl === null ||
        row.outputType !== "pptx"
      ) {
        return null;
      }
      return {
        format: "pptx",
        status: "ready",
        generationId: row.generationId,
        gammaId: row.gammaId,
        gammaUrl:
          typeof row.gammaUrl === "string" && row.gammaUrl.trim().length > 0
            ? row.gammaUrl.trim()
            : null,
        exportUrl,
        filename: typeof row.filename === "string" ? row.filename : null,
        outputType: "pptx",
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null
      };
    }
    return {
      format: "pptx",
      status: "unavailable",
      filename: typeof row.filename === "string" ? row.filename : null,
      errorCode: typeof row.errorCode === "string" ? row.errorCode : null,
      message: typeof row.message === "string" ? row.message : null,
      retryable: typeof row.retryable === "boolean" ? row.retryable : null,
      providerFailure: this.asObject(row.providerFailure)
    };
  }

  private readFilenameOrFallback(value: unknown, fallbackFilename: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallbackFilename;
  }

  private readTrustedGammaExportUrl(value: string): string | null {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:") {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      return hostname === "gamma.app" || hostname.endsWith(GAMMA_ALLOWED_EXPORT_HOST_SUFFIX)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }
}
