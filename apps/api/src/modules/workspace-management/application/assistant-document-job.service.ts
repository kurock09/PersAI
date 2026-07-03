import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AssistantChatSurface,
  AssistantDocumentDescriptorMode,
  AssistantDocumentType
} from "@prisma/client";
import type {
  PersaiRuntimePresentationImagePolicy,
  PersaiRuntimePresentationVisualDensity,
  PersaiRuntimePresentationVisualStyle,
  RuntimeAttachmentRef,
  RuntimeOutputArtifact
} from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  buildAssistantDocumentLinkMetadata,
  type AssistantDocumentWorkspaceFacts,
  normalizeDocumentWorkspaceFacts
} from "./assistant-document-link-metadata";
import type { AssistantWebChatMessageAttachmentDocumentLink } from "./web-chat.types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVISION_VERSION_ALLOCATION_ATTEMPTS = 3;

export type AssistantDocumentSourcePayload = {
  prompt: string;
  instructions?: string | null;
  outputFormat?: "pdf" | "pptx" | "xlsx" | "docx" | null;
  docId?: string | null;
  requestedName?: string | null;
  visualStyle?: PersaiRuntimePresentationVisualStyle | null;
  imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
  visualDensity?: PersaiRuntimePresentationVisualDensity | null;
  gammaThemeId?: string | null;
  // Authoritative slide count for presentations. When set, the runtime
  // adapter forwards this number to Gamma's numCards instead of guessing
  // from outline/text length.
  targetSlideCount?: number | null;
  outline?: unknown;
  metadata?: Record<string, unknown> | null;
  transferMode?: "verbatim" | "transform" | null;
  contentIntent?: "preserve_content" | "rewrite_content" | null;
  editOperation?: "style_only" | "content_patch" | "section_rewrite" | null;
  targetSectionIds?: string[] | null;
};

export type AssistantDocumentRequestPayload = {
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  runtimeSessionId: string;
  descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
  sourceJson: AssistantDocumentSourcePayload;
  // Attachments from the triggering user message. Presentation workers can use
  // these as source material; non-presentation documents use visible workspace
  // extraction/render/inspect instead of deferred jobs.
  sourceUserMessageAttachments?: RuntimeAttachmentRef[] | null;
};

export type AssistantDocumentRevisionContext = {
  docId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  documentType: "presentation";
  currentVersionId: string;
  currentVersionNumber: number;
  currentSourceJson: AssistantDocumentSourcePayload;
};

export type AssistantDocumentExportOrRedeliverContext = AssistantDocumentRevisionContext & {
  currentVersionStatus:
    | "draft"
    | "render_requested"
    | "rendering"
    | "ready"
    | "failed"
    | "superseded";
  currentOutputFormat: "pdf" | "pptx";
  latestDeliveredFile: {
    attachmentId: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    originalFilename: string | null;
  } | null;
};

// Visible-workspace document outputs are PDF/XLSX/DOCX. Presentations do not
// use the visible-workspace version-registration lane — they stay on the
// deferred Gamma render pipeline. The Prisma enum AssistantDocumentOutputFormat
// is intentionally narrowed to the deferred render-job tables only (pdf/pptx).
export type VisibleWorkspaceDocumentOutputFormat = "pdf" | "xlsx" | "docx";

export type RegisterVisibleWorkspaceDocumentVersionInput = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string;
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  descriptorMode: "create_document" | "revise_document";
  outputFormat: VisibleWorkspaceDocumentOutputFormat;
  requestedName: string | null;
  docId?: string | null;
  workspaceFacts: AssistantDocumentWorkspaceFacts;
};

export type CurrentDocumentLinkLookupOutcome =
  | {
      status: "none";
    }
  | {
      status: "ready";
      link: AssistantWebChatMessageAttachmentDocumentLink;
    };

@Injectable()
export class AssistantDocumentJobService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  isUuid(value: string | null | undefined): value is string {
    return typeof value === "string" && UUID_REGEX.test(value.trim());
  }

  async countOpenJobsForChat(input: { assistantId: string; chatId: string }): Promise<number> {
    return this.prisma.assistantDocumentRenderJob.count({
      where: {
        assistantId: input.assistantId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running", "provider_processing", "fetching_output", "ready_for_delivery"]
        }
      }
    });
  }

  async enqueue(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: AssistantChatSurface;
    sourceUserMessageId: string;
    descriptorMode: "create_presentation";
    documentType: "presentation";
    provider: "gamma";
    outputFormat: "pdf" | "pptx";
    request: AssistantDocumentRequestPayload;
  }): Promise<{ docId: string; versionId: string; renderJobId: string; status: "queued" }> {
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.assistantDocument.create({
        data: {
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          documentType: input.documentType,
          status: "drafting"
        },
        select: { id: true }
      });

      const version = await tx.assistantDocumentVersion.create({
        data: {
          docId: document.id,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          versionNumber: 1,
          descriptorMode: input.descriptorMode,
          sourceJson: input.request.sourceJson as never,
          sourceSummaryText: input.request.sourceUserMessageText,
          sourceOutlineJson:
            input.request.sourceJson.outline === undefined
              ? Prisma.JsonNull
              : (input.request.sourceJson.outline as never),
          status: "render_requested"
        },
        select: { id: true }
      });

      await tx.assistantDocument.update({
        where: { id: document.id },
        data: {
          currentVersionId: version.id,
          status: "rendering"
        }
      });

      const renderJob = await tx.assistantDocumentRenderJob.create({
        data: {
          docId: document.id,
          versionId: version.id,
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          surface: input.surface,
          provider: input.provider,
          outputFormat: input.outputFormat,
          status: "queued",
          sourceUserMessageId: input.sourceUserMessageId,
          requestJson: input.request as never
        },
        select: { id: true }
      });

      return {
        docId: document.id,
        versionId: version.id,
        renderJobId: renderJob.id,
        status: "queued" as const
      };
    });
  }

  async findRevisionContext(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
    docId: string;
  }): Promise<AssistantDocumentRevisionContext | null> {
    if (!this.isUuid(input.docId)) {
      return null;
    }
    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        id: input.docId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId
      },
      select: {
        id: true,
        assistantId: true,
        workspaceId: true,
        chatId: true,
        documentType: true,
        currentVersionId: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            sourceJson: true
          }
        }
      }
    });
    if (
      document === null ||
      document.currentVersionId === null ||
      document.currentVersion === null ||
      document.currentVersion.id !== document.currentVersionId ||
      document.documentType !== "presentation"
    ) {
      return null;
    }
    return {
      docId: document.id,
      assistantId: document.assistantId,
      workspaceId: document.workspaceId,
      chatId: document.chatId,
      documentType: "presentation",
      currentVersionId: document.currentVersion.id,
      currentVersionNumber: document.currentVersion.versionNumber,
      currentSourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson)
    };
  }

  /**
   * Resolve a workspace storage path to a presentation revision context via
   * attachment documentLink metadata. Historical PDF/data rows are not a
   * deferred-job revision target after ADR-129.
   */
  async findRevisionContextByStoragePath(input: {
    assistantId: string;
    storagePath: string;
  }): Promise<
    | { ok: true; context: AssistantDocumentRevisionContext }
    | { ok: false; reason: "not_found" | "not_presentation" }
  > {
    const storagePath = input.storagePath.trim();
    if (storagePath.length === 0) {
      return { ok: false, reason: "not_found" };
    }
    const attachment = await this.prisma.assistantChatMessageAttachment.findFirst({
      where: {
        assistantId: input.assistantId,
        storagePath
      },
      orderBy: { createdAt: "desc" },
      select: {
        metadata: true
      }
    });
    if (attachment === null) {
      return { ok: false, reason: "not_found" };
    }
    const metadata =
      attachment.metadata !== null &&
      typeof attachment.metadata === "object" &&
      !Array.isArray(attachment.metadata)
        ? (attachment.metadata as Record<string, unknown>)
        : null;
    const documentLink = metadata?.documentLink;
    const docId =
      documentLink !== null &&
      documentLink !== undefined &&
      typeof documentLink === "object" &&
      !Array.isArray(documentLink) &&
      typeof (documentLink as Record<string, unknown>).docId === "string"
        ? ((documentLink as Record<string, unknown>).docId as string)
        : null;
    if (docId === null) {
      return { ok: false, reason: "not_found" };
    }
    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        id: docId,
        assistantId: input.assistantId
      },
      select: {
        id: true,
        assistantId: true,
        workspaceId: true,
        chatId: true,
        documentType: true,
        currentVersionId: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            sourceJson: true
          }
        }
      }
    });
    if (document === null) {
      return { ok: false, reason: "not_found" };
    }
    if (document.documentType !== "presentation") {
      return { ok: false, reason: "not_presentation" };
    }
    if (
      document.currentVersionId === null ||
      document.currentVersion === null ||
      document.currentVersion.id !== document.currentVersionId
    ) {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      context: {
        docId: document.id,
        assistantId: document.assistantId,
        workspaceId: document.workspaceId,
        chatId: document.chatId,
        documentType: "presentation",
        currentVersionId: document.currentVersion.id,
        currentVersionNumber: document.currentVersion.versionNumber,
        currentSourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson)
      }
    };
  }

  async enqueueRevision(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: AssistantChatSurface;
    sourceUserMessageId: string;
    revisionContext: AssistantDocumentRevisionContext;
    request: AssistantDocumentRequestPayload;
    provider: "gamma";
    outputFormat: "pdf" | "pptx";
  }): Promise<{ docId: string; versionId: string; renderJobId: string; status: "queued" }> {
    const mergedSourceJson = this.buildRevisionSourcePayload(
      input.revisionContext.currentSourceJson,
      input.request.sourceJson
    );
    for (let attempt = 1; attempt <= MAX_REVISION_VERSION_ALLOCATION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const latestVersionRow = await tx.assistantDocumentVersion.findFirst({
            where: {
              docId: input.revisionContext.docId
            },
            orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }, { id: "desc" }],
            select: { versionNumber: true }
          });
          const nextVersionNumber =
            Math.max(
              input.revisionContext.currentVersionNumber,
              latestVersionRow?.versionNumber ?? 0
            ) + 1;

          const version = await tx.assistantDocumentVersion.create({
            data: {
              docId: input.revisionContext.docId,
              assistantId: input.assistantId,
              workspaceId: input.workspaceId,
              versionNumber: nextVersionNumber,
              parentVersionId: input.revisionContext.currentVersionId,
              descriptorMode: "revise_document",
              sourceJson: mergedSourceJson as never,
              sourceSummaryText: input.request.sourceUserMessageText,
              sourceOutlineJson:
                mergedSourceJson.outline === undefined
                  ? Prisma.JsonNull
                  : (mergedSourceJson.outline as never),
              status: "render_requested"
            },
            select: { id: true }
          });

          await tx.assistantDocument.update({
            where: { id: input.revisionContext.docId },
            data: {
              status: "rendering"
            }
          });

          const renderJob = await tx.assistantDocumentRenderJob.create({
            data: {
              docId: input.revisionContext.docId,
              versionId: version.id,
              assistantId: input.assistantId,
              userId: input.userId,
              workspaceId: input.workspaceId,
              chatId: input.chatId,
              surface: input.surface,
              provider: input.provider,
              outputFormat: input.outputFormat,
              status: "queued",
              sourceUserMessageId: input.sourceUserMessageId,
              requestJson: {
                ...input.request,
                sourceJson: mergedSourceJson
              } as never
            },
            select: { id: true }
          });

          await tx.assistantDocumentRevisionLog.create({
            data: {
              docId: input.revisionContext.docId,
              workspaceId: input.workspaceId,
              previousVersionId: input.revisionContext.currentVersionId,
              newVersionId: version.id,
              userRevisionRequestText: input.request.sourceUserMessageText,
              interpretedPatchIntent: input.request.sourceJson.prompt,
              structuredPatchJson: {
                revisionPrompt: input.request.sourceJson.prompt,
                revisionInstructions: input.request.sourceJson.instructions ?? null,
                requestedName: input.request.sourceJson.requestedName ?? null,
                outputFormat: input.request.sourceJson.outputFormat ?? null,
                outline: input.request.sourceJson.outline ?? null
              } as never,
              runtimeProvenanceJson: {
                source: "assistant_document_job_service.enqueue_revision",
                descriptorMode: "revise_document"
              } as never
            }
          });

          return {
            docId: input.revisionContext.docId,
            versionId: version.id,
            renderJobId: renderJob.id,
            status: "queued" as const
          };
        });
      } catch (error) {
        if (
          !this.isRevisionVersionAllocationConflict(error) ||
          attempt >= MAX_REVISION_VERSION_ALLOCATION_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    throw new Error("enqueueRevision exhausted bounded allocation retries.");
  }

  async findExportOrRedeliverContext(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
    docId: string;
  }): Promise<AssistantDocumentExportOrRedeliverContext | null> {
    if (!this.isUuid(input.docId)) {
      return null;
    }
    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        id: input.docId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId
      },
      select: {
        id: true,
        assistantId: true,
        workspaceId: true,
        chatId: true,
        documentType: true,
        currentVersionId: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            sourceJson: true,
            status: true
          }
        }
      }
    });
    if (
      document === null ||
      document.currentVersionId === null ||
      document.currentVersion === null ||
      document.currentVersion.id !== document.currentVersionId ||
      document.documentType !== "presentation"
    ) {
      return null;
    }
    const latestDeliveredAttachment = await this.findLatestDeliveredDocumentAttachment({
      assistantId: input.assistantId,
      chatId: input.chatId,
      docId: document.id
    });
    return {
      docId: document.id,
      assistantId: document.assistantId,
      workspaceId: document.workspaceId,
      chatId: document.chatId,
      documentType: "presentation",
      currentVersionId: document.currentVersion.id,
      currentVersionNumber: document.currentVersion.versionNumber,
      currentVersionStatus: document.currentVersion.status,
      currentSourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson),
      currentOutputFormat: this.resolveCurrentOutputFormat({
        documentType: document.documentType,
        sourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson),
        deliveredMimeType: latestDeliveredAttachment?.mimeType ?? null
      }),
      latestDeliveredFile:
        latestDeliveredAttachment === null
          ? null
          : {
              attachmentId: latestDeliveredAttachment.id,
              storagePath: latestDeliveredAttachment.storagePath as string,
              mimeType: latestDeliveredAttachment.mimeType,
              sizeBytes: Number(latestDeliveredAttachment.sizeBytes),
              originalFilename: latestDeliveredAttachment.originalFilename
            }
    };
  }

  private async findLatestDeliveredDocumentAttachment(input: {
    assistantId: string;
    chatId: string;
    docId: string;
  }) {
    const attachments = await this.prisma.assistantChatMessageAttachment.findMany({
      where: {
        assistantId: input.assistantId,
        chatId: input.chatId,
        storagePath: { not: null }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        storagePath: true,
        mimeType: true,
        sizeBytes: true,
        originalFilename: true,
        metadata: true
      }
    });
    for (const attachment of attachments) {
      const metadata =
        attachment.metadata !== null &&
        typeof attachment.metadata === "object" &&
        !Array.isArray(attachment.metadata)
          ? (attachment.metadata as Record<string, unknown>)
          : null;
      const documentLink = metadata?.documentLink;
      if (
        documentLink === null ||
        documentLink === undefined ||
        typeof documentLink !== "object" ||
        Array.isArray(documentLink)
      ) {
        continue;
      }
      const link = documentLink as Record<string, unknown>;
      if (link.docId !== input.docId || link.isCurrentOutput !== true) {
        continue;
      }
      if (metadata?.kind !== "document" && metadata?.source !== "tool_output") {
        continue;
      }
      return attachment;
    }
    return null;
  }

  async findLatestRevisionContextForChat(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
  }): Promise<AssistantDocumentRevisionContext | null> {
    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        currentVersionId: { not: null }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        assistantId: true,
        workspaceId: true,
        chatId: true,
        documentType: true,
        currentVersionId: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            sourceJson: true
          }
        }
      }
    });
    if (
      document === null ||
      document.currentVersionId === null ||
      document.currentVersion === null ||
      document.currentVersion.id !== document.currentVersionId ||
      document.documentType !== "presentation"
    ) {
      return null;
    }
    return {
      docId: document.id,
      assistantId: document.assistantId,
      workspaceId: document.workspaceId,
      chatId: document.chatId,
      documentType: "presentation",
      currentVersionId: document.currentVersion.id,
      currentVersionNumber: document.currentVersion.versionNumber,
      currentSourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson)
    };
  }

  async enqueueExportRender(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: AssistantChatSurface;
    sourceUserMessageId: string;
    exportContext: AssistantDocumentExportOrRedeliverContext;
    provider: "gamma";
    outputFormat: "pdf" | "pptx";
    request: AssistantDocumentRequestPayload;
    preserveCurrentVersionStatus?: boolean;
  }): Promise<{ docId: string; versionId: string; renderJobId: string; status: "queued" }> {
    const sourceJson = this.buildExportOrRedeliverSourcePayload(
      input.exportContext.currentSourceJson,
      input.request.sourceJson
    );
    return this.prisma.$transaction(async (tx) => {
      if (input.preserveCurrentVersionStatus !== true) {
        await tx.assistantDocument.update({
          where: { id: input.exportContext.docId },
          data: {
            status: "rendering"
          }
        });

        await tx.assistantDocumentVersion.update({
          where: { id: input.exportContext.currentVersionId },
          data: {
            status: "render_requested"
          }
        });
      }

      const renderJob = await tx.assistantDocumentRenderJob.create({
        data: {
          docId: input.exportContext.docId,
          versionId: input.exportContext.currentVersionId,
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          surface: input.surface,
          provider: input.provider,
          outputFormat: input.outputFormat,
          status: "queued",
          sourceUserMessageId: input.sourceUserMessageId,
          requestJson: {
            ...input.request,
            sourceJson
          } as never
        },
        select: { id: true }
      });

      return {
        docId: input.exportContext.docId,
        versionId: input.exportContext.currentVersionId,
        renderJobId: renderJob.id,
        status: "queued" as const
      };
    });
  }

  async enqueuePersistedFileRedelivery(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: AssistantChatSurface;
    sourceUserMessageId: string;
    redeliveryContext: AssistantDocumentExportOrRedeliverContext;
    provider: "gamma";
    outputFormat: "pdf" | "pptx";
    request: AssistantDocumentRequestPayload;
  }): Promise<{
    docId: string;
    versionId: string;
    renderJobId: string;
    status: "ready_for_delivery";
  }> {
    const deliveredFile = input.redeliveryContext.latestDeliveredFile;
    if (deliveredFile === null) {
      throw new Error("Persisted file redelivery requires an existing delivered file.");
    }
    const artifact = this.toPersistedRuntimeArtifact(deliveredFile);
    const renderJob = await this.prisma.assistantDocumentRenderJob.create({
      data: {
        docId: input.redeliveryContext.docId,
        versionId: input.redeliveryContext.currentVersionId,
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        surface: input.surface,
        provider: input.provider,
        outputFormat: input.outputFormat,
        status: "ready_for_delivery",
        sourceUserMessageId: input.sourceUserMessageId,
        requestJson: input.request as never,
        providerStatusJson: {
          artifacts: [artifact],
          assistantText: null,
          quotaConsumed: true,
          reusedDeliveredFileTruth: true
        } as never
      },
      select: { id: true }
    });

    return {
      docId: input.redeliveryContext.docId,
      versionId: input.redeliveryContext.currentVersionId,
      renderJobId: renderJob.id,
      status: "ready_for_delivery" as const
    };
  }

  async registerVisibleWorkspaceVersion(
    input: RegisterVisibleWorkspaceDocumentVersionInput
  ): Promise<{
    docId: string;
    versionId: string;
    versionNumber: number;
    descriptorMode: AssistantDocumentDescriptorMode;
    documentType: AssistantDocumentType;
    outputFormat: VisibleWorkspaceDocumentOutputFormat;
  }> {
    const requestedName =
      typeof input.requestedName === "string" && input.requestedName.trim().length > 0
        ? input.requestedName.trim()
        : this.basename(input.workspaceFacts.outputPath);
    const sourceJson = this.buildVisibleWorkspaceSourcePayload({
      sourceUserMessageText: input.sourceUserMessageText,
      outputFormat: input.outputFormat,
      requestedName,
      docId: input.docId ?? null,
      workspaceFacts: input.workspaceFacts
    });
    const documentType = this.resolveDocumentTypeFromOutputFormat(input.outputFormat);
    if (input.docId !== null && input.docId !== undefined) {
      const docId = input.docId;
      if (!this.isUuid(docId)) {
        throw new Error("registerVisibleWorkspaceVersion requires a valid docId when provided.");
      }
      return this.prisma.$transaction(async (tx) => {
        const current = await tx.assistantDocument.findUnique({
          where: { id: docId },
          include: {
            currentVersion: {
              select: {
                id: true,
                versionNumber: true
              }
            }
          }
        });
        if (
          current === null ||
          current.assistantId !== input.assistantId ||
          current.workspaceId !== input.workspaceId ||
          current.currentVersionId === null ||
          current.currentVersion === null ||
          current.currentVersion.id !== current.currentVersionId
        ) {
          throw new Error("Visible workspace document version registration target was not found.");
        }
        const version = await tx.assistantDocumentVersion.create({
          data: {
            docId: current.id,
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            versionNumber: current.currentVersion.versionNumber + 1,
            parentVersionId: current.currentVersionId,
            descriptorMode: input.descriptorMode,
            sourceJson: sourceJson as never,
            sourceSummaryText: input.sourceUserMessageText,
            sourceOutlineJson: Prisma.JsonNull,
            status: "ready"
          },
          select: {
            id: true,
            versionNumber: true
          }
        });
        await tx.assistantDocumentVersion.updateMany({
          where: {
            id: current.currentVersionId,
            status: "ready"
          },
          data: {
            status: "superseded"
          }
        });
        await tx.assistantDocument.update({
          where: { id: current.id },
          data: {
            currentVersionId: version.id,
            documentType,
            status: "ready"
          }
        });
        return {
          docId: current.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          descriptorMode: input.descriptorMode,
          documentType,
          outputFormat: input.outputFormat
        };
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.assistantDocument.create({
        data: {
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          documentType,
          status: "ready"
        },
        select: { id: true }
      });
      const version = await tx.assistantDocumentVersion.create({
        data: {
          docId: document.id,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          versionNumber: 1,
          descriptorMode: input.descriptorMode,
          sourceJson: sourceJson as never,
          sourceSummaryText: input.sourceUserMessageText,
          sourceOutlineJson: Prisma.JsonNull,
          status: "ready"
        },
        select: {
          id: true,
          versionNumber: true
        }
      });
      await tx.assistantDocument.update({
        where: { id: document.id },
        data: {
          currentVersionId: version.id
        }
      });
      return {
        docId: document.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        descriptorMode: input.descriptorMode,
        documentType,
        outputFormat: input.outputFormat
      };
    });
  }

  async findCurrentDocumentLinkByOutputPath(input: {
    assistantId: string;
    workspaceId: string;
    outputPath: string;
  }): Promise<CurrentDocumentLinkLookupOutcome> {
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
      select: {
        id: true,
        status: true,
        documentType: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            descriptorMode: true,
            status: true,
            sourceJson: true
          }
        }
      }
    });
    if (document === null || document.currentVersion === null) {
      return { status: "none" };
    }
    const sourceJson = this.normalizeSourcePayload(document.currentVersion.sourceJson);
    const workspaceFacts = this.readDocumentWorkspaceFacts(sourceJson.metadata);
    return {
      status: "ready",
      link: buildAssistantDocumentLinkMetadata({
        docId: document.id,
        versionId: document.currentVersion.id,
        versionNumber: document.currentVersion.versionNumber,
        descriptorMode: document.currentVersion.descriptorMode,
        documentType: document.documentType,
        outputFormat:
          sourceJson.outputFormat ??
          this.resolveOutputFormatFromWorkspaceFacts(sourceJson.metadata),
        documentStatus: document.status,
        versionStatus: document.currentVersion.status,
        isCurrentOutput: true,
        workspaceFacts
      })
    };
  }

  private normalizeSourcePayload(value: unknown): AssistantDocumentSourcePayload {
    const row =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return {
      prompt: typeof row.prompt === "string" ? row.prompt : "",
      instructions: typeof row.instructions === "string" ? row.instructions : null,
      outputFormat:
        row.outputFormat === "pdf" ||
        row.outputFormat === "pptx" ||
        row.outputFormat === "xlsx" ||
        row.outputFormat === "docx"
          ? row.outputFormat
          : null,
      docId: typeof row.docId === "string" ? row.docId : null,
      requestedName: typeof row.requestedName === "string" ? row.requestedName : null,
      visualStyle: this.readPresentationVisualStyle(row.visualStyle),
      imagePolicy: this.readPresentationImagePolicy(row.imagePolicy),
      visualDensity: this.readPresentationVisualDensity(row.visualDensity),
      gammaThemeId: this.readGammaThemeId(row.gammaThemeId),
      targetSlideCount: this.readTargetSlideCount(row.targetSlideCount),
      outline: row.outline,
      metadata:
        row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null,
      transferMode:
        row.transferMode === "verbatim" || row.transferMode === "transform"
          ? row.transferMode
          : null,
      contentIntent:
        row.contentIntent === "preserve_content" || row.contentIntent === "rewrite_content"
          ? row.contentIntent
          : null,
      editOperation:
        row.editOperation === "style_only" ||
        row.editOperation === "content_patch" ||
        row.editOperation === "section_rewrite"
          ? row.editOperation
          : null,
      targetSectionIds: Array.isArray(row.targetSectionIds)
        ? row.targetSectionIds.filter((entry): entry is string => typeof entry === "string")
        : null
    };
  }

  private buildRevisionSourcePayload(
    current: AssistantDocumentSourcePayload,
    revision: AssistantDocumentSourcePayload
  ): AssistantDocumentSourcePayload {
    const combinedInstructions = [
      current.instructions?.trim() || null,
      revision.prompt.trim().length > 0 ? `Revision request:\n${revision.prompt.trim()}` : null,
      revision.instructions?.trim()
        ? `Additional revision instructions:\n${revision.instructions.trim()}`
        : null
    ]
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join("\n\n");

    return {
      prompt: current.prompt.trim().length > 0 ? current.prompt : revision.prompt,
      instructions: combinedInstructions.length > 0 ? combinedInstructions : null,
      // Chat-delivered presentations are PDF-first by default. We never
      // inherit the previous version's outputFormat for revisions: the
      // resolved value comes from the new request alone (or the enqueue
      // service's typed default).
      outputFormat: revision.outputFormat ?? null,
      docId: current.docId ?? revision.docId ?? null,
      requestedName: revision.requestedName ?? current.requestedName ?? null,
      visualStyle: revision.visualStyle ?? current.visualStyle ?? null,
      imagePolicy: revision.imagePolicy ?? current.imagePolicy ?? null,
      visualDensity: revision.visualDensity ?? current.visualDensity ?? null,
      gammaThemeId: revision.gammaThemeId ?? current.gammaThemeId ?? null,
      targetSlideCount: revision.targetSlideCount ?? current.targetSlideCount ?? null,
      outline: revision.outline ?? current.outline,
      transferMode: revision.transferMode ?? current.transferMode ?? null,
      contentIntent: revision.contentIntent ?? null,
      editOperation: revision.editOperation ?? current.editOperation ?? null,
      targetSectionIds: revision.targetSectionIds ?? current.targetSectionIds ?? null,
      metadata: {
        ...(current.metadata ?? {}),
        ...(revision.metadata ?? {}),
        revisionRequested: true
      }
    };
  }

  private isRevisionVersionAllocationConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return false;
    }
    const metaTarget = error.meta?.target;
    const targets = Array.isArray(metaTarget)
      ? metaTarget.map((entry) => String(entry))
      : typeof metaTarget === "string"
        ? [metaTarget]
        : [];
    return (
      targets.includes("assistant_document_versions_doc_version_number_key") ||
      (targets.includes("doc_id") && targets.includes("version_number")) ||
      (targets.includes("docId") && targets.includes("versionNumber"))
    );
  }

  private buildExportOrRedeliverSourcePayload(
    current: AssistantDocumentSourcePayload,
    request: AssistantDocumentSourcePayload
  ): AssistantDocumentSourcePayload {
    return {
      prompt: current.prompt,
      instructions: current.instructions ?? null,
      outputFormat: request.outputFormat ?? current.outputFormat ?? null,
      docId: current.docId ?? request.docId ?? null,
      requestedName: request.requestedName ?? current.requestedName ?? null,
      visualStyle: request.visualStyle ?? current.visualStyle ?? null,
      imagePolicy: request.imagePolicy ?? current.imagePolicy ?? null,
      visualDensity: request.visualDensity ?? current.visualDensity ?? null,
      gammaThemeId: current.gammaThemeId ?? request.gammaThemeId ?? null,
      targetSlideCount: request.targetSlideCount ?? current.targetSlideCount ?? null,
      outline: current.outline,
      metadata: {
        ...(current.metadata ?? {}),
        ...(request.metadata ?? {}),
        exportOrRedeliverRequested: true,
        exportOrRedeliverPrompt:
          request.prompt.trim().length > 0 ? request.prompt.trim() : undefined,
        exportOrRedeliverInstructions: request.instructions?.trim().length
          ? request.instructions.trim()
          : undefined
      }
    };
  }

  private resolveCurrentOutputFormat(input: {
    documentType: AssistantDocumentType;
    sourceJson: AssistantDocumentSourcePayload;
    deliveredMimeType: string | null;
  }): "pdf" | "pptx" {
    if (input.sourceJson.outputFormat === "pdf" || input.sourceJson.outputFormat === "pptx") {
      return input.sourceJson.outputFormat;
    }
    if (input.deliveredMimeType === "application/pdf") {
      return "pdf";
    }
    if (
      input.deliveredMimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      return "pptx";
    }
    return "pdf";
  }

  private buildVisibleWorkspaceSourcePayload(input: {
    sourceUserMessageText: string;
    outputFormat: VisibleWorkspaceDocumentOutputFormat;
    requestedName: string | null;
    docId: string | null;
    workspaceFacts: AssistantDocumentWorkspaceFacts;
  }): Record<string, unknown> {
    return {
      prompt: input.sourceUserMessageText.trim(),
      instructions: null,
      outputFormat: input.outputFormat,
      docId: input.docId,
      requestedName: input.requestedName,
      metadata: {
        documentWorkspace: {
          workspaceProjectPath: input.workspaceFacts.workspaceProjectPath,
          projectManifestPath: input.workspaceFacts.projectManifestPath,
          projectSourcePath: input.workspaceFacts.projectSourcePath,
          sourceKind: input.workspaceFacts.sourceKind,
          outputPath: input.workspaceFacts.outputPath,
          sourcePath: input.workspaceFacts.sourcePath,
          sourceFormat: input.workspaceFacts.sourceFormat,
          sourceMimeType: input.workspaceFacts.sourceMimeType,
          sourceManifestPath: input.workspaceFacts.sourceManifestPath,
          sourceManifest: input.workspaceFacts.sourceManifest,
          inspectionPath: input.workspaceFacts.inspectionPath,
          inspectionSummary: input.workspaceFacts.inspectionSummary
        }
      }
    };
  }

  private readDocumentWorkspaceFacts(
    metadata: AssistantDocumentSourcePayload["metadata"]
  ): AssistantDocumentWorkspaceFacts {
    return normalizeDocumentWorkspaceFacts((metadata ?? {})["documentWorkspace"]);
  }

  private resolveOutputFormatFromWorkspaceFacts(
    metadata: AssistantDocumentSourcePayload["metadata"]
  ): "pdf" | "pptx" | "xlsx" | "docx" | null {
    const outputPath = this.readDocumentWorkspaceFacts(metadata).outputPath;
    if (outputPath === null) {
      return null;
    }
    const lowered = outputPath.toLowerCase();
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

  private resolveDocumentTypeFromOutputFormat(
    _outputFormat: VisibleWorkspaceDocumentOutputFormat
  ): "workspace_document" {
    return "workspace_document";
  }

  private basename(path: string | null): string | null {
    if (path === null) {
      return null;
    }
    const normalized = path.trim().replace(/\/+$/g, "");
    const segments = normalized.split("/");
    const last = segments[segments.length - 1] ?? "";
    return last.length > 0 ? last : null;
  }

  private readPresentationVisualStyle(value: unknown): PersaiRuntimePresentationVisualStyle | null {
    return value === "professional_modern" ||
      value === "bold_editorial" ||
      value === "minimal_clean" ||
      value === "illustrated_storytelling"
      ? value
      : null;
  }

  private readPresentationImagePolicy(value: unknown): PersaiRuntimePresentationImagePolicy | null {
    return value === "ai_generated" ||
      value === "web_free_to_use" ||
      value === "pictographic" ||
      value === "text_only"
      ? value
      : null;
  }

  private readPresentationVisualDensity(
    value: unknown
  ): PersaiRuntimePresentationVisualDensity | null {
    return value === "balanced" || value === "visual_heavy" || value === "text_heavy"
      ? value
      : null;
  }

  private readGammaThemeId(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private readTargetSlideCount(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    const rounded = Math.round(value);
    if (rounded < 1) {
      return null;
    }
    return Math.min(rounded, 30);
  }

  private toPersistedRuntimeArtifact(
    file: NonNullable<AssistantDocumentExportOrRedeliverContext["latestDeliveredFile"]>
  ): RuntimeOutputArtifact {
    return {
      artifactId: randomUUID(),
      storagePath: file.storagePath,
      kind: "file",
      sourceToolCode: "document",
      mimeType: file.mimeType,
      filename: file.originalFilename,
      sizeBytes: file.sizeBytes,
      voiceNote: false
    };
  }
}
