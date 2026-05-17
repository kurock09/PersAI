import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AssistantDocumentDescriptorMode,
  AssistantDocumentOutputFormat,
  AssistantDocumentRenderProvider,
  AssistantDocumentType
} from "@prisma/client";
import type { RuntimeAttachmentRef } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  AssistantDocumentJobService,
  type AssistantDocumentSourcePayload
} from "./assistant-document-job.service";
import { QuotaGroundedLimitCopyService } from "./quota-grounded-limit-copy.service";
import { ReadInternalRuntimeQuotaStatusService } from "./read-internal-runtime-quota-status.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { DOCUMENT_PROVIDER_CONFIG_KEYS } from "./tool-credential-settings";

const MAX_OPEN_DOCUMENT_JOBS_PER_CHAT = 2;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocumentDirectToolExecutionPayload = {
  toolCode: "document";
  descriptorMode:
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver";
  request: AssistantDocumentSourcePayload;
};

export type EnqueueRuntimeDeferredDocumentJobInput = {
  assistantId: string;
  sourceUserMessageId: string;
  sourceUserMessageText: string;
  // Attachments captured from the triggering user message. The runtime
  // worker uses them to inline text-extractable source-file content into
  // the HTML generation prompt instead of forcing the model to invent
  // content when the user asked to rebuild/convert/restyle a real file.
  // The runtime tool always sends this field today; the optional shape is
  // kept as a defensive shim during rollouts where a partially-deployed
  // runtime caller might still be on the previous contract.
  sourceUserMessageAttachments?: RuntimeAttachmentRef[];
  directToolExecution: DocumentDirectToolExecutionPayload;
};

@Injectable()
export class EnqueueRuntimeDeferredDocumentJobService {
  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly assistantDocumentJobService: AssistantDocumentJobService,
    private readonly quotaGroundedLimitCopyService: QuotaGroundedLimitCopyService,
    private readonly readInternalRuntimeQuotaStatusService: ReadInternalRuntimeQuotaStatusService,
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  parseInput(payload: unknown): EnqueueRuntimeDeferredDocumentJobInput {
    const row = this.objectValue(payload, "payload");
    const attachments = this.parseOptionalAttachments(row.attachments);
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      sourceUserMessageId: this.requiredString(row.sourceUserMessageId, "sourceUserMessageId"),
      sourceUserMessageText: this.requiredString(
        row.sourceUserMessageText,
        "sourceUserMessageText"
      ),
      ...(attachments === null ? {} : { sourceUserMessageAttachments: attachments }),
      directToolExecution: this.directToolExecution(row.directToolExecution)
    };
  }

  private parseOptionalAttachments(value: unknown): RuntimeAttachmentRef[] | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (!Array.isArray(value)) {
      throw new BadRequestException("attachments must be an array when provided.");
    }
    const refs: RuntimeAttachmentRef[] = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new BadRequestException("attachments[] entries must be objects.");
      }
      const row = entry as Record<string, unknown>;
      const attachmentId = this.requiredString(row.attachmentId, "attachments[].attachmentId");
      const kindRaw = this.requiredString(row.kind, "attachments[].kind");
      if (kindRaw !== "image" && kindRaw !== "audio" && kindRaw !== "video" && kindRaw !== "file") {
        throw new BadRequestException(
          'attachments[].kind must be one of "image", "audio", "video", "file".'
        );
      }
      const objectKey = this.requiredString(row.objectKey, "attachments[].objectKey");
      const mimeType = this.requiredString(row.mimeType, "attachments[].mimeType");
      const sizeBytesRaw = row.sizeBytes;
      const sizeBytes =
        typeof sizeBytesRaw === "number" && Number.isFinite(sizeBytesRaw) && sizeBytesRaw >= 0
          ? sizeBytesRaw
          : 0;
      const filename =
        typeof row.filename === "string" && row.filename.trim().length > 0 ? row.filename : null;
      const fileRef =
        row.fileRef === undefined
          ? undefined
          : row.fileRef === null
            ? null
            : typeof row.fileRef === "string" && row.fileRef.trim().length > 0
              ? row.fileRef
              : null;
      const aliases =
        row.aliases === undefined
          ? undefined
          : row.aliases === null
            ? null
            : Array.isArray(row.aliases)
              ? row.aliases.filter(
                  (alias): alias is string => typeof alias === "string" && alias.trim().length > 0
                )
              : null;
      refs.push({
        attachmentId,
        kind: kindRaw,
        objectKey,
        mimeType,
        filename,
        sizeBytes,
        ...(fileRef === undefined ? {} : { fileRef }),
        ...(aliases === undefined ? {} : { aliases })
      });
    }
    return refs;
  }

  async execute(input: EnqueueRuntimeDeferredDocumentJobInput): Promise<
    | {
        accepted: true;
        docId: string;
        versionId: string;
        renderJobId: string;
        documentType: "pdf_document" | "presentation";
      }
    | {
        accepted: false;
        code: string;
        message: string;
        guidance?: string | null;
      }
  > {
    const sourceMessage = await this.assistantChatRepository.findMessageByIdForAssistant(
      input.sourceUserMessageId,
      input.assistantId
    );
    if (sourceMessage === null || sourceMessage.author !== "user") {
      throw new NotFoundException(
        "Source user message was not found for deferred document enqueue."
      );
    }
    const chat = await this.assistantChatRepository.findChatById(sourceMessage.chatId);
    if (chat === null || chat.assistantId !== input.assistantId) {
      throw new NotFoundException("Chat was not found for deferred document enqueue.");
    }

    const openJobCount = await this.assistantDocumentJobService.countOpenJobsForChat({
      assistantId: input.assistantId,
      chatId: chat.id
    });
    if (openJobCount >= MAX_OPEN_DOCUMENT_JOBS_PER_CHAT) {
      return {
        accepted: false,
        code: "document_job_queue_full",
        message: "There are already active background document jobs for this chat.",
        guidance: null
      };
    }

    const descriptorMode = input.directToolExecution.descriptorMode;
    const skipQuotaPrecheckForPersistedRedelivery =
      descriptorMode === "export_or_redeliver" &&
      (await this.shouldBypassQuotaPrecheckForPersistedRedelivery({
        assistantId: input.assistantId,
        workspaceId: chat.workspaceId,
        chatId: chat.id,
        requestedDocId: input.directToolExecution.request.docId ?? null,
        requestedOutputFormat: input.directToolExecution.request.outputFormat ?? null
      }));
    const admission = await this.precheckToolAvailabilityAndQuota(
      input.assistantId,
      skipQuotaPrecheckForPersistedRedelivery
    );
    if (admission.allowed !== true) {
      return {
        accepted: false,
        code: admission.code,
        message: admission.message,
        guidance: admission.guidance
      };
    }

    const resolvedShape =
      descriptorMode === "revise_document"
        ? null
        : descriptorMode === "export_or_redeliver"
          ? null
          : this.resolveExecutionShape(descriptorMode);
    if (
      descriptorMode === "create_pdf_document" &&
      (await this.readPersistedPdfMonkeyTemplateId()) === null
    ) {
      return {
        accepted: false,
        code: "document_template_not_configured",
        message:
          'Document provider "pdfmonkey" requires an operator-configured template before this request can be accepted.',
        guidance:
          "Configure the PDFMonkey template for the document tool first, then retry the document request."
      };
    }
    const sourceUserMessageAttachmentsForPayload =
      input.sourceUserMessageAttachments === undefined ||
      input.sourceUserMessageAttachments.length === 0
        ? null
        : input.sourceUserMessageAttachments;
    if (descriptorMode === "revise_document") {
      return this.enqueueRevision({
        assistantId: input.assistantId,
        userId: chat.userId,
        workspaceId: chat.workspaceId,
        chatId: chat.id,
        surface: chat.surface,
        sourceUserMessageId: sourceMessage.id,
        request: {
          sourceUserMessageText: input.sourceUserMessageText,
          sourceUserMessageCreatedAt: sourceMessage.createdAt.toISOString(),
          descriptorMode: "revise_document",
          sourceJson: input.directToolExecution.request,
          sourceUserMessageAttachments: sourceUserMessageAttachmentsForPayload
        },
        requestedDocId: input.directToolExecution.request.docId ?? null
      });
    }
    if (descriptorMode === "export_or_redeliver") {
      return this.enqueueExportOrRedeliver({
        assistantId: input.assistantId,
        userId: chat.userId,
        workspaceId: chat.workspaceId,
        chatId: chat.id,
        surface: chat.surface,
        sourceUserMessageId: sourceMessage.id,
        request: {
          sourceUserMessageText: input.sourceUserMessageText,
          sourceUserMessageCreatedAt: sourceMessage.createdAt.toISOString(),
          descriptorMode: "export_or_redeliver",
          sourceJson: input.directToolExecution.request,
          sourceUserMessageAttachments: sourceUserMessageAttachmentsForPayload
        },
        requestedDocId: input.directToolExecution.request.docId ?? null
      });
    }
    if (resolvedShape === null) {
      throw new BadRequestException("Document execution shape could not be resolved.");
    }
    const created = await this.assistantDocumentJobService.enqueue({
      assistantId: input.assistantId,
      userId: chat.userId,
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      surface: chat.surface,
      sourceUserMessageId: sourceMessage.id,
      descriptorMode,
      documentType: resolvedShape.documentType,
      provider: resolvedShape.provider,
      outputFormat: resolvedShape.outputFormat,
      request: {
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: sourceMessage.createdAt.toISOString(),
        descriptorMode,
        sourceJson: input.directToolExecution.request,
        sourceUserMessageAttachments: sourceUserMessageAttachmentsForPayload
      }
    });
    return {
      accepted: true,
      docId: created.docId,
      versionId: created.versionId,
      renderJobId: created.renderJobId,
      documentType: resolvedShape.documentType
    };
  }

  private async precheckToolAvailabilityAndQuota(
    assistantId: string,
    skipQuotaCheck = false
  ): Promise<
    { allowed: true } | { allowed: false; code: string; message: string; guidance: string | null }
  > {
    try {
      const policy = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
        assistantId,
        toolCode: "document"
      });
      const effectiveTool = policy.tools[0];
      if (effectiveTool === undefined || effectiveTool.activationStatus !== "active") {
        return {
          allowed: false,
          code: "plan_feature_unavailable",
          message: "This document tool is not active for the current plan or configuration.",
          guidance: null
        };
      }
    } catch {
      return {
        allowed: false,
        code: "plan_feature_unavailable",
        message: "This document tool is not active for the current plan or configuration.",
        guidance: null
      };
    }

    if (skipQuotaCheck) {
      return { allowed: true };
    }
    const status = await this.readInternalRuntimeQuotaStatusService.execute({ assistantId });
    const quotaRow =
      status.monthlyToolQuotas === null
        ? null
        : (status.monthlyToolQuotas.tools.find((entry) => entry.toolCode === "document") ?? null);
    if (quotaRow?.status === "limit_reached" || quotaRow?.remainingUnits === 0) {
      const copy = await this.quotaGroundedLimitCopyService.build({
        assistantId,
        code: "monthly_tool_quota_exceeded",
        details: {
          toolCode: "document",
          currentUsedUnits: quotaRow.usedUnits,
          limitUnits:
            typeof quotaRow.effectiveLimitUnits === "number"
              ? quotaRow.effectiveLimitUnits
              : quotaRow.limitUnits,
          requestedUnits: 1,
          periodStartedAt: status.monthlyToolQuotas?.periodStartedAt ?? null,
          periodEndsAt: status.monthlyToolQuotas?.periodEndsAt ?? null,
          periodSource: status.monthlyToolQuotas?.periodSource ?? null
        }
      });
      return {
        allowed: false,
        code: "monthly_tool_quota_exceeded",
        message: copy?.message ?? "The monthly document quota for this tool has been exhausted.",
        guidance: copy?.guidance ?? null
      };
    }
    if (quotaRow?.status === "usage_unavailable" || quotaRow === null) {
      return {
        allowed: false,
        code: "runtime_degraded",
        message: "Document quota status is temporarily unavailable.",
        guidance: null
      };
    }
    return { allowed: true };
  }

  private async shouldBypassQuotaPrecheckForPersistedRedelivery(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
    requestedDocId: string | null;
    requestedOutputFormat: string | null;
  }): Promise<boolean> {
    if (
      input.requestedDocId === null ||
      (input.requestedOutputFormat !== null &&
        input.requestedOutputFormat !== "pdf" &&
        input.requestedOutputFormat !== "pptx")
    ) {
      return false;
    }
    const context = await this.assistantDocumentJobService.findExportOrRedeliverContext({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      docId: input.requestedDocId
    });
    if (context === null || context.latestDeliveredFile === null) {
      return false;
    }
    const requestedOutputFormat = input.requestedOutputFormat ?? context.currentOutputFormat;
    return requestedOutputFormat === context.currentOutputFormat;
  }

  private resolveExecutionShape(descriptorMode: AssistantDocumentDescriptorMode): {
    documentType: AssistantDocumentType;
    provider: AssistantDocumentRenderProvider;
    outputFormat: AssistantDocumentOutputFormat;
  } {
    if (descriptorMode === "create_pdf_document") {
      return {
        documentType: "pdf_document",
        provider: "pdfmonkey",
        outputFormat: "pdf"
      };
    }
    if (descriptorMode === "create_presentation") {
      return {
        documentType: "presentation",
        provider: "gamma",
        outputFormat: "pptx"
      };
    }
    if (descriptorMode === "revise_document") {
      throw new BadRequestException(
        "revise_document execution shape must be resolved from the existing document context."
      );
    }
    throw new BadRequestException("Unsupported document descriptor mode.");
  }

  private async enqueueRevision(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: "web" | "telegram";
    sourceUserMessageId: string;
    request: {
      sourceUserMessageText: string;
      sourceUserMessageCreatedAt: string;
      descriptorMode: "revise_document";
      sourceJson: AssistantDocumentSourcePayload;
      sourceUserMessageAttachments?: RuntimeAttachmentRef[] | null;
    };
    requestedDocId: string | null;
  }): Promise<
    | {
        accepted: true;
        docId: string;
        versionId: string;
        renderJobId: string;
        documentType: "pdf_document" | "presentation";
      }
    | {
        accepted: false;
        code: string;
        message: string;
        guidance: string | null;
      }
  > {
    const requestedDocId = input.requestedDocId?.trim() ?? "";
    const revisionContext =
      requestedDocId.length > 0 && this.isUuid(requestedDocId)
        ? await this.assistantDocumentJobService.findRevisionContext({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            docId: requestedDocId
          })
        : await this.assistantDocumentJobService.findLatestRevisionContextForChat({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            chatId: input.chatId
          });
    if (revisionContext === null) {
      return {
        accepted: false,
        code: "document_not_found",
        message: "The requested document could not be found for this assistant chat.",
        guidance:
          requestedDocId.length > 0
            ? "Use a valid document created in this chat, or omit doc_id so PersAI can target the latest document in context."
            : "Use a document created in this chat, or create a new document if there is no existing document to revise."
      };
    }
    const provider = revisionContext.documentType === "presentation" ? "gamma" : "pdfmonkey";
    const outputFormat = revisionContext.documentType === "presentation" ? "pptx" : "pdf";
    const created = await this.assistantDocumentJobService.enqueueRevision({
      assistantId: input.assistantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      surface: input.surface,
      sourceUserMessageId: input.sourceUserMessageId,
      revisionContext,
      provider,
      outputFormat,
      request: input.request
    });
    return {
      accepted: true,
      docId: created.docId,
      versionId: created.versionId,
      renderJobId: created.renderJobId,
      documentType: revisionContext.documentType
    };
  }

  private async enqueueExportOrRedeliver(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: "web" | "telegram";
    sourceUserMessageId: string;
    request: {
      sourceUserMessageText: string;
      sourceUserMessageCreatedAt: string;
      descriptorMode: "export_or_redeliver";
      sourceJson: AssistantDocumentSourcePayload;
      sourceUserMessageAttachments?: RuntimeAttachmentRef[] | null;
    };
    requestedDocId: string | null;
  }): Promise<
    | {
        accepted: true;
        docId: string;
        versionId: string;
        renderJobId: string;
        documentType: "pdf_document" | "presentation";
      }
    | {
        accepted: false;
        code: string;
        message: string;
        guidance: string | null;
      }
  > {
    const requestedDocId = input.requestedDocId?.trim() ?? "";
    if (requestedDocId.length === 0) {
      return {
        accepted: false,
        code: "document_export_target_missing",
        message: "Document export or redelivery requires a target doc_id.",
        guidance: "Pass the existing document identifier when requesting document redelivery."
      };
    }
    if (!this.isUuid(requestedDocId)) {
      return {
        accepted: false,
        code: "document_not_found",
        message: "The requested document could not be found for this assistant chat.",
        guidance: "Pass a valid document doc_id when requesting document redelivery or export."
      };
    }

    const exportContext = await this.assistantDocumentJobService.findExportOrRedeliverContext({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      docId: requestedDocId
    });
    if (exportContext === null) {
      return {
        accepted: false,
        code: "document_not_found",
        message: "The requested document could not be found for this assistant chat.",
        guidance:
          "Use a document created in this chat, or create a new document if you do not have a valid doc_id."
      };
    }
    if (exportContext.currentVersionStatus !== "ready") {
      return {
        accepted: false,
        code: "document_version_not_ready",
        message: "Only the current ready document version can be exported or redelivered.",
        guidance:
          "Wait for the current document version to finish rendering, then retry the export or redelivery request."
      };
    }

    const requestedOutputFormat =
      input.request.sourceJson.outputFormat ?? exportContext.currentOutputFormat;
    if (requestedOutputFormat !== exportContext.currentOutputFormat) {
      return {
        accepted: false,
        code: "document_export_format_not_supported",
        message:
          "Cross-format document export is not wired yet for existing documents in this rollout.",
        guidance:
          "For now, redeliver the existing ready file in its current format, or revise the document to create a new version."
      };
    }

    const provider = exportContext.documentType === "presentation" ? "gamma" : "pdfmonkey";
    const outputFormat = exportContext.currentOutputFormat;
    const created =
      exportContext.latestDeliveredFile !== null
        ? await this.assistantDocumentJobService.enqueuePersistedFileRedelivery({
            assistantId: input.assistantId,
            userId: input.userId,
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            surface: input.surface,
            sourceUserMessageId: input.sourceUserMessageId,
            redeliveryContext: exportContext,
            provider,
            outputFormat,
            request: input.request
          })
        : await this.assistantDocumentJobService.enqueueExportRender({
            assistantId: input.assistantId,
            userId: input.userId,
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            surface: input.surface,
            sourceUserMessageId: input.sourceUserMessageId,
            exportContext,
            provider,
            outputFormat,
            request: input.request
          });
    return {
      accepted: true,
      docId: created.docId,
      versionId: created.versionId,
      renderJobId: created.renderJobId,
      documentType: exportContext.documentType
    };
  }

  private directToolExecution(value: unknown): DocumentDirectToolExecutionPayload {
    const row = this.objectValue(value, "directToolExecution");
    if (row.toolCode !== "document") {
      throw new BadRequestException("directToolExecution.toolCode must be document.");
    }
    const descriptorMode = this.requiredString(
      row.descriptorMode,
      "directToolExecution.descriptorMode"
    );
    if (
      descriptorMode !== "create_pdf_document" &&
      descriptorMode !== "create_presentation" &&
      descriptorMode !== "revise_document" &&
      descriptorMode !== "export_or_redeliver"
    ) {
      throw new BadRequestException(
        "directToolExecution.descriptorMode must be create_pdf_document, create_presentation, revise_document, or export_or_redeliver."
      );
    }
    const request = this.objectValue(row.request, "directToolExecution.request");
    return {
      toolCode: "document",
      descriptorMode,
      request: {
        prompt: this.requiredString(request.prompt, "directToolExecution.request.prompt"),
        instructions: typeof request.instructions === "string" ? request.instructions : null,
        outputFormat:
          request.outputFormat === "pdf" || request.outputFormat === "pptx"
            ? request.outputFormat
            : null,
        docId: typeof request.docId === "string" ? request.docId : null,
        requestedName: typeof request.requestedName === "string" ? request.requestedName : null,
        visualStyle:
          request.visualStyle === "professional_modern" ||
          request.visualStyle === "bold_editorial" ||
          request.visualStyle === "minimal_clean" ||
          request.visualStyle === "illustrated_storytelling"
            ? request.visualStyle
            : null,
        imagePolicy:
          request.imagePolicy === "ai_generated" ||
          request.imagePolicy === "web_free_to_use" ||
          request.imagePolicy === "pictographic" ||
          request.imagePolicy === "text_only"
            ? request.imagePolicy
            : null,
        visualDensity:
          request.visualDensity === "balanced" ||
          request.visualDensity === "visual_heavy" ||
          request.visualDensity === "text_heavy"
            ? request.visualDensity
            : null,
        outline: request.outline,
        metadata: this.optionalRecord(request.metadata)
      }
    };
  }

  private objectValue(value: unknown, fieldName: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an object.`);
    }
    return value as Record<string, unknown>;
  }

  private requiredString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

  private isUuid(value: string | null | undefined): value is string {
    return typeof value === "string" && UUID_REGEX.test(value.trim());
  }

  private optionalRecord(value: unknown): Record<string, unknown> | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("directToolExecution.request.metadata must be an object.");
    }
    return value as Record<string, unknown>;
  }

  private async readPersistedPdfMonkeyTemplateId(): Promise<string | null> {
    const templateId =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        DOCUMENT_PROVIDER_CONFIG_KEYS.pdfmonkeyTemplateId
      );
    return typeof templateId === "string" && templateId.trim().length > 0
      ? templateId.trim()
      : null;
  }
}
