import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AssistantChatSurface,
  AssistantDocumentDescriptorMode,
  AssistantDocumentOutputFormat,
  AssistantDocumentRenderProvider,
  AssistantDocumentType
} from "@prisma/client";
import type {
  PersaiRuntimePresentationImagePolicy,
  PersaiRuntimePresentationVisualDensity,
  PersaiRuntimePresentationVisualStyle,
  RuntimeAttachmentRef,
  RuntimeOutputArtifact,
  RuntimeFileRef
} from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVISION_VERSION_ALLOCATION_ATTEMPTS = 3;

export type AssistantDocumentSourcePayload = {
  prompt: string;
  instructions?: string | null;
  outputFormat?: "pdf" | "pptx" | null;
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
  descriptorMode: AssistantDocumentDescriptorMode;
  sourceJson: AssistantDocumentSourcePayload;
  // Attachments from the triggering user message. Persisted on the render
  // job's requestJson so the runtime worker can inline text-extractable
  // source content (txt/md/csv/json/xml/html) directly into the HTML
  // generation prompt. Optional/nullable for backward compatibility with
  // previously enqueued jobs that predate this field.
  sourceUserMessageAttachments?: RuntimeAttachmentRef[] | null;
};

export type AssistantDocumentRevisionContext = {
  docId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  documentType: AssistantDocumentType;
  currentVersionId: string;
  currentVersionNumber: number;
  currentSourceJson: AssistantDocumentSourcePayload;
  /** ADR-097 Slice 2 — null when the version pre-dates Slice 1 (legacy). */
  currentVersionRenderedHtml: string | null;
  currentVersionStructureJson: Record<string, unknown> | null;
  currentVersionStyleProfileJson: Record<string, unknown> | null;
  currentVersionEditStrategy: "fast_small" | "structured_large" | null;
};

export type AssistantDocumentExportOrRedeliverContext = AssistantDocumentRevisionContext & {
  currentVersionStatus:
    | "draft"
    | "render_requested"
    | "rendering"
    | "ready"
    | "failed"
    | "superseded";
  currentOutputFormat: AssistantDocumentOutputFormat;
  latestDeliveredFile: {
    fileRef: string;
    origin: "uploaded_attachment" | "runtime_output" | "sandbox_output";
    sourceToolCode: string | null;
    objectKey: string;
    relativePath: string;
    displayName: string | null;
    mimeType: string;
    sizeBytes: number;
    logicalSizeBytes: number | null;
  } | null;
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
    descriptorMode: AssistantDocumentDescriptorMode;
    documentType: AssistantDocumentType;
    provider: AssistantDocumentRenderProvider;
    outputFormat: AssistantDocumentOutputFormat;
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
            sourceJson: true,
            renderedHtml: true,
            structureJson: true,
            styleProfileJson: true,
            editStrategy: true
          }
        }
      }
    });
    if (
      document === null ||
      document.currentVersionId === null ||
      document.currentVersion === null ||
      document.currentVersion.id !== document.currentVersionId
    ) {
      return null;
    }
    return {
      docId: document.id,
      assistantId: document.assistantId,
      workspaceId: document.workspaceId,
      chatId: document.chatId,
      documentType: document.documentType,
      currentVersionId: document.currentVersion.id,
      currentVersionNumber: document.currentVersion.versionNumber,
      currentSourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson),
      ...this.mapStructuredVersionFields(document.currentVersion)
    };
  }

  /**
   * ADR-097 Slice 4 — resolve an AssistantFile.id (fileRef) to a revision
   * context for cross-chat PDF revise. Does NOT filter by chatId: the read
   * crosses chats, but the write stays in the current chat (handled by the
   * caller). Uses AssistantFile.assistantId for scoping (assistant-level
   * security, not workspace-level). Returns the LATEST version of the
   * document (not the version pinned by the delivered file row).
   */
  async findRevisionContextByFileRef(input: {
    assistantId: string;
    fileRef: string;
  }): Promise<
    | { ok: true; context: AssistantDocumentRevisionContext }
    | { ok: false; reason: "not_found" | "not_pdf_document" }
  > {
    if (!this.isUuid(input.fileRef)) {
      return { ok: false, reason: "not_found" };
    }
    const deliveredFileRow = await this.prisma.assistantDocumentDeliveredFile.findFirst({
      where: {
        assistantFileId: input.fileRef,
        assistantFile: {
          assistantId: input.assistantId
        }
      },
      select: {
        document: {
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
                renderedHtml: true,
                structureJson: true,
                styleProfileJson: true,
                editStrategy: true
              }
            }
          }
        }
      }
    });
    if (deliveredFileRow === null || deliveredFileRow.document === null) {
      return { ok: false, reason: "not_found" };
    }
    const doc = deliveredFileRow.document;
    if (doc.documentType !== "pdf_document") {
      return { ok: false, reason: "not_pdf_document" };
    }
    if (
      doc.currentVersionId === null ||
      doc.currentVersion === null ||
      doc.currentVersion.id !== doc.currentVersionId
    ) {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      context: {
        docId: doc.id,
        assistantId: doc.assistantId,
        workspaceId: doc.workspaceId,
        chatId: doc.chatId,
        documentType: doc.documentType,
        currentVersionId: doc.currentVersion.id,
        currentVersionNumber: doc.currentVersion.versionNumber,
        currentSourceJson: this.normalizeSourcePayload(doc.currentVersion.sourceJson),
        ...this.mapStructuredVersionFields(doc.currentVersion)
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
    provider: AssistantDocumentRenderProvider;
    outputFormat: AssistantDocumentOutputFormat;
    /**
     * ADR-097 Slice 2 — for PDF revise jobs, the HTML persisted on the
     * previous version is forwarded here so the scheduler can pass it to the
     * runtime worker. Null for presentations or when absent for legacy versions
     * (caller must pre-validate before calling enqueueRevision).
     */
    previousVersionRenderedHtml: string | null;
    previousVersionStructureJson?: Record<string, unknown> | null;
    previousVersionStyleProfileJson?: Record<string, unknown> | null;
    previousVersionEditStrategy?: "fast_small" | "structured_large" | null;
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
                sourceJson: mergedSourceJson,
                ...(input.previousVersionRenderedHtml !== null
                  ? { previousVersionRenderedHtml: input.previousVersionRenderedHtml }
                  : {}),
                ...(input.previousVersionStructureJson !== null &&
                input.previousVersionStructureJson !== undefined
                  ? { previousVersionStructureJson: input.previousVersionStructureJson }
                  : {}),
                ...(input.previousVersionStyleProfileJson !== null &&
                input.previousVersionStyleProfileJson !== undefined
                  ? { previousVersionStyleProfileJson: input.previousVersionStyleProfileJson }
                  : {}),
                ...(input.previousVersionEditStrategy !== null &&
                input.previousVersionEditStrategy !== undefined
                  ? { previousVersionEditStrategy: input.previousVersionEditStrategy }
                  : {})
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
            status: true,
            renderedHtml: true,
            structureJson: true,
            styleProfileJson: true,
            editStrategy: true
          }
        },
        deliveredFiles: {
          where: {
            isCurrentOutput: true
          },
          orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            assistantFile: {
              select: {
                id: true,
                origin: true,
                sourceToolCode: true,
                objectKey: true,
                relativePath: true,
                displayName: true,
                mimeType: true,
                sizeBytes: true,
                logicalSizeBytes: true
              }
            }
          }
        }
      }
    });
    if (
      document === null ||
      document.currentVersionId === null ||
      document.currentVersion === null ||
      document.currentVersion.id !== document.currentVersionId
    ) {
      return null;
    }
    const latestDeliveredAssistantFile = document.deliveredFiles[0]?.assistantFile ?? null;
    return {
      docId: document.id,
      assistantId: document.assistantId,
      workspaceId: document.workspaceId,
      chatId: document.chatId,
      documentType: document.documentType,
      currentVersionId: document.currentVersion.id,
      currentVersionNumber: document.currentVersion.versionNumber,
      ...this.mapStructuredVersionFields(document.currentVersion),
      currentVersionStatus: document.currentVersion.status,
      currentSourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson),
      currentOutputFormat: this.resolveCurrentOutputFormat({
        documentType: document.documentType,
        sourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson),
        deliveredMimeType: latestDeliveredAssistantFile?.mimeType ?? null
      }),
      latestDeliveredFile:
        latestDeliveredAssistantFile === null
          ? null
          : {
              fileRef: latestDeliveredAssistantFile.id,
              origin: latestDeliveredAssistantFile.origin,
              sourceToolCode: latestDeliveredAssistantFile.sourceToolCode,
              objectKey: latestDeliveredAssistantFile.objectKey,
              relativePath: latestDeliveredAssistantFile.relativePath,
              displayName: latestDeliveredAssistantFile.displayName,
              mimeType: latestDeliveredAssistantFile.mimeType,
              sizeBytes: Number(latestDeliveredAssistantFile.sizeBytes),
              logicalSizeBytes:
                latestDeliveredAssistantFile.logicalSizeBytes === null
                  ? null
                  : Number(latestDeliveredAssistantFile.logicalSizeBytes)
            }
    };
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
            sourceJson: true,
            renderedHtml: true,
            structureJson: true,
            styleProfileJson: true,
            editStrategy: true
          }
        }
      }
    });
    if (
      document === null ||
      document.currentVersionId === null ||
      document.currentVersion === null ||
      document.currentVersion.id !== document.currentVersionId
    ) {
      return null;
    }
    return {
      docId: document.id,
      assistantId: document.assistantId,
      workspaceId: document.workspaceId,
      chatId: document.chatId,
      documentType: document.documentType,
      currentVersionId: document.currentVersion.id,
      currentVersionNumber: document.currentVersion.versionNumber,
      currentSourceJson: this.normalizeSourcePayload(document.currentVersion.sourceJson),
      ...this.mapStructuredVersionFields(document.currentVersion)
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
    provider: AssistantDocumentRenderProvider;
    outputFormat: AssistantDocumentOutputFormat;
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
    provider: AssistantDocumentRenderProvider;
    outputFormat: AssistantDocumentOutputFormat;
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

  private normalizeSourcePayload(value: unknown): AssistantDocumentSourcePayload {
    const row =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return {
      prompt: typeof row.prompt === "string" ? row.prompt : "",
      instructions: typeof row.instructions === "string" ? row.instructions : null,
      outputFormat:
        row.outputFormat === "pdf" || row.outputFormat === "pptx" ? row.outputFormat : null,
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

  private mapStructuredVersionFields(version: {
    renderedHtml: string | null;
    structureJson: unknown;
    styleProfileJson: unknown;
    editStrategy: string | null;
  }): Pick<
    AssistantDocumentRevisionContext,
    | "currentVersionRenderedHtml"
    | "currentVersionStructureJson"
    | "currentVersionStyleProfileJson"
    | "currentVersionEditStrategy"
  > {
    return {
      currentVersionRenderedHtml: version.renderedHtml ?? null,
      currentVersionStructureJson: this.normalizeJsonObject(version.structureJson),
      currentVersionStyleProfileJson: this.normalizeJsonObject(version.styleProfileJson),
      currentVersionEditStrategy: this.normalizeEditStrategy(version.editStrategy)
    };
  }

  private normalizeJsonObject(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private normalizeEditStrategy(
    value: string | null | undefined
  ): "fast_small" | "structured_large" | null {
    return value === "fast_small" || value === "structured_large" ? value : null;
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
  }): AssistantDocumentOutputFormat {
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
    const runtimeFileRef: RuntimeFileRef = {
      fileRef: file.fileRef,
      origin: file.origin,
      sourceToolCode: file.sourceToolCode,
      objectKey: file.objectKey,
      relativePath: file.relativePath,
      displayName: file.displayName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      logicalSizeBytes: file.logicalSizeBytes
    };
    return {
      artifactId: randomUUID(),
      fileRef: file.fileRef,
      file: runtimeFileRef,
      kind: "file",
      sourceToolCode: "document",
      objectKey: file.objectKey,
      mimeType: file.mimeType,
      filename: file.displayName ?? null,
      sizeBytes: file.sizeBytes,
      voiceNote: false
    };
  }
}
