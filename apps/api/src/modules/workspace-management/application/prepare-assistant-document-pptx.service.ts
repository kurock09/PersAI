import { Injectable } from "@nestjs/common";
import type { AssistantDocumentOutputFormat } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  EnqueueRuntimeDeferredDocumentJobService,
  type EnqueueRuntimeDeferredDocumentJobInput
} from "./enqueue-runtime-deferred-document-job.service";
import type { AssistantDocumentSourcePayload } from "./assistant-document-job.service";

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const OPEN_DOCUMENT_JOB_STATUSES = [
  "queued",
  "running",
  "provider_processing",
  "fetching_output",
  "ready_for_delivery"
] as const;

export type PrepareAssistantDocumentPptxResult =
  | {
      status: "ready";
      docId: string;
      versionId: string;
      fileRef: string;
    }
  | {
      status: "already_running";
      docId: string;
      versionId: string;
      renderJobId: string;
    }
  | {
      status: "queued";
      docId: string;
      versionId: string;
      renderJobId: string;
    }
  | {
      status: "rejected";
      code: string;
      message: string;
      guidance?: string | null;
    };

@Injectable()
export class PrepareAssistantDocumentPptxService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly enqueueRuntimeDeferredDocumentJobService: EnqueueRuntimeDeferredDocumentJobService
  ) {}

  async execute(input: {
    assistantId: string;
    workspaceId: string;
    docId: string;
    versionId?: string | null;
  }): Promise<PrepareAssistantDocumentPptxResult> {
    const version = await this.resolveReadyCurrentPresentationVersion(input);
    if (version === null) {
      return {
        status: "rejected",
        code: "presentation_version_not_available",
        message: "The requested presentation version is not ready for PPTX preparation.",
        guidance: "Wait for the PDF presentation to finish, then prepare the PPTX again."
      };
    }

    const readyPptx = await this.prisma.assistantDocumentDeliveredFile.findFirst({
      where: {
        docId: input.docId,
        versionId: version.id,
        outputMimeType: PPTX_MIME_TYPE
      },
      orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
      select: {
        assistantFileId: true
      }
    });
    if (readyPptx !== null) {
      return {
        status: "ready",
        docId: input.docId,
        versionId: version.id,
        fileRef: readyPptx.assistantFileId
      };
    }

    const activePptxJob = await this.prisma.assistantDocumentRenderJob.findFirst({
      where: {
        docId: input.docId,
        versionId: version.id,
        outputFormat: "pptx",
        status: { in: [...OPEN_DOCUMENT_JOB_STATUSES] }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true
      }
    });
    if (activePptxJob !== null) {
      return {
        status: "already_running",
        docId: input.docId,
        versionId: version.id,
        renderJobId: activePptxJob.id
      };
    }

    const sourceUserMessageId = version.renderJobs[0]?.sourceUserMessageId ?? null;
    if (sourceUserMessageId === null) {
      return {
        status: "rejected",
        code: "presentation_source_message_missing",
        message: "The source presentation request is no longer available.",
        guidance: "Create a fresh presentation, then prepare the PPTX from that result."
      };
    }

    const sourceJson = normalizeSourcePayload(version.sourceJson);
    const requestedName = toPptxRequestedName(sourceJson.requestedName);
    const enqueueInput: EnqueueRuntimeDeferredDocumentJobInput = {
      assistantId: input.assistantId,
      sourceUserMessageId,
      sourceUserMessageText:
        typeof version.sourceSummaryText === "string" && version.sourceSummaryText.trim().length > 0
          ? version.sourceSummaryText
          : sourceJson.prompt,
      directToolExecution: {
        toolCode: "document",
        descriptorMode: "export_or_redeliver",
        request: {
          ...sourceJson,
          docId: input.docId,
          outputFormat: "pptx",
          requestedName,
          metadata: {
            ...(sourceJson.metadata ?? {}),
            explicitUserRequestedPptx: true,
            sourceVersionId: version.id
          }
        }
      }
    };

    const outcome = await this.enqueueRuntimeDeferredDocumentJobService.execute(enqueueInput);
    if (!outcome.accepted) {
      return {
        status: "rejected",
        code: outcome.code,
        message: outcome.message,
        guidance: outcome.guidance ?? null
      };
    }

    return {
      status: "queued",
      docId: outcome.docId,
      versionId: outcome.versionId,
      renderJobId: outcome.renderJobId
    };
  }

  private async resolveReadyCurrentPresentationVersion(input: {
    assistantId: string;
    workspaceId: string;
    docId: string;
    versionId?: string | null;
  }): Promise<{
    id: string;
    sourceJson: unknown;
    sourceSummaryText: string | null;
    renderJobs: Array<{ sourceUserMessageId: string | null }>;
  } | null> {
    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        id: input.docId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        documentType: "presentation"
      },
      select: {
        currentVersionId: true
      }
    });
    if (document?.currentVersionId === null || document?.currentVersionId === undefined) {
      return null;
    }
    const requestedVersionId =
      typeof input.versionId === "string" && input.versionId.trim().length > 0
        ? input.versionId.trim()
        : document.currentVersionId;
    if (requestedVersionId !== document.currentVersionId) {
      return null;
    }

    const version = await this.prisma.assistantDocumentVersion.findFirst({
      where: {
        id: requestedVersionId,
        docId: input.docId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        status: "ready"
      },
      select: {
        id: true,
        sourceJson: true,
        sourceSummaryText: true,
        renderJobs: {
          where: {
            sourceUserMessageId: { not: null }
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            sourceUserMessageId: true
          }
        }
      }
    });
    return version;
  }
}

function normalizeSourcePayload(value: unknown): AssistantDocumentSourcePayload {
  const row =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    prompt:
      typeof row.prompt === "string" && row.prompt.trim().length > 0 ? row.prompt : "Presentation",
    instructions: typeof row.instructions === "string" ? row.instructions : null,
    outputFormat: readOutputFormat(row.outputFormat),
    docId: typeof row.docId === "string" ? row.docId : null,
    requestedName: typeof row.requestedName === "string" ? row.requestedName : null,
    visualStyle:
      row.visualStyle === "professional_modern" ||
      row.visualStyle === "bold_editorial" ||
      row.visualStyle === "minimal_clean" ||
      row.visualStyle === "illustrated_storytelling"
        ? row.visualStyle
        : null,
    imagePolicy:
      row.imagePolicy === "ai_generated" ||
      row.imagePolicy === "web_free_to_use" ||
      row.imagePolicy === "pictographic" ||
      row.imagePolicy === "text_only"
        ? row.imagePolicy
        : null,
    visualDensity:
      row.visualDensity === "balanced" ||
      row.visualDensity === "visual_heavy" ||
      row.visualDensity === "text_heavy"
        ? row.visualDensity
        : null,
    gammaThemeId:
      typeof row.gammaThemeId === "string" && row.gammaThemeId.trim().length > 0
        ? row.gammaThemeId.trim()
        : null,
    targetSlideCount: readTargetSlideCount(row.targetSlideCount),
    outline: row.outline,
    metadata:
      row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null
  };
}

function readOutputFormat(value: unknown): AssistantDocumentOutputFormat | null {
  return value === "pdf" || value === "pptx" ? value : null;
}

function readTargetSlideCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded >= 1 ? Math.min(rounded, 30) : null;
}

function toPptxRequestedName(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value.trim().replace(/\.pdf$/i, ".pptx");
}
