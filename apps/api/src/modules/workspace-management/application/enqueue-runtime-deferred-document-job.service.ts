import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AssistantDocumentOutputFormat } from "@prisma/client";
import type { RuntimeAttachmentRef } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  AssistantDocumentJobService,
  type AssistantDocumentRevisionContext,
  type AssistantDocumentSourcePayload
} from "./assistant-document-job.service";
import { QuotaGroundedLimitCopyService } from "./quota-grounded-limit-copy.service";
import { ReadInternalRuntimeQuotaStatusService } from "./read-internal-runtime-quota-status.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { GammaThemePickerService } from "./gamma/gamma-theme-picker.service";
const MAX_OPEN_DOCUMENT_JOBS_PER_CHAT = 2;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocumentDirectToolExecutionPayload = {
  toolCode: "document";
  descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
  request: AssistantDocumentSourcePayload;
  /** ADR-126 v3 — workspace storage path for cross-chat revise. Mutually exclusive with request.docId. */
  path?: string | null;
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
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly gammaThemePickerService: GammaThemePickerService
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
      const storagePath = this.requiredString(row.storagePath, "attachments[].storagePath");
      const mimeType = this.requiredString(row.mimeType, "attachments[].mimeType");
      const sizeBytesRaw = row.sizeBytes;
      const sizeBytes =
        typeof sizeBytesRaw === "number" && Number.isFinite(sizeBytesRaw) && sizeBytesRaw >= 0
          ? sizeBytesRaw
          : 0;
      const displayName =
        typeof row.displayName === "string" && row.displayName.trim().length > 0
          ? row.displayName
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
        storagePath,
        mimeType,
        displayName,
        sizeBytes,
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
        documentType: "presentation";
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
      descriptorMode === "revise_document" || descriptorMode === "export_or_redeliver"
        ? null
        : this.resolveExecutionShape();
    const sourceUserMessageAttachmentsForPayload =
      input.sourceUserMessageAttachments === undefined ||
      input.sourceUserMessageAttachments.length === 0
        ? null
        : input.sourceUserMessageAttachments;
    if (descriptorMode === "revise_document") {
      const requestedPath = input.directToolExecution.path ?? null;
      const requestedDocId = input.directToolExecution.request.docId ?? null;

      if (requestedPath !== null && requestedDocId !== null && requestedDocId.trim().length > 0) {
        return {
          accepted: false,
          code: "revise_document_ambiguous_source",
          message:
            "revise_document received both path and docId — pass exactly one. Use path for a PDF from any chat (identified by workspace storage path), or docId for a PDF created in the current chat.",
          guidance: null
        };
      }

      if (requestedPath !== null) {
        return this.enqueueRevisionByStoragePath({
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
          storagePath: requestedPath
        });
      }

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
        requestedDocId,
        enrichPresentationTheme: true
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
    const sourceJson =
      descriptorMode === "create_presentation"
        ? await this.applyGammaThemeSelection(
            input.directToolExecution.request,
            input.sourceUserMessageText
          )
        : input.directToolExecution.request;
    const persistedSourceJson = {
      ...sourceJson,
      outputFormat: resolvedShape.outputFormat
    };
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
        sourceJson: persistedSourceJson,
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
    const quotaRowRaw =
      status.monthlyToolQuotas === null
        ? null
        : (status.monthlyToolQuotas.tools.find((entry) => entry.toolCode === "document") ?? null);
    // ADR-108 Slice 7: document always uses the units variant; exclude vcoin rows defensively.
    // Accept rows where kind is "units" OR kind is absent (backward-compat with test stubs).
    const quotaRow =
      quotaRowRaw !== null && quotaRowRaw.kind !== "vcoin"
        ? (quotaRowRaw as import("@persai/runtime-contract").RuntimeMonthlyToolQuotaStatusToolRowUnits)
        : null;
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

  private resolveExecutionShape(): {
    documentType: "presentation";
    provider: "gamma";
    outputFormat: "pdf" | "pptx";
  } {
    return {
      documentType: "presentation",
      provider: "gamma",
      // First-class chat presentation delivery is PDF by backend contract.
      // Editable PPTX is prepared through an explicit export_or_redeliver path.
      outputFormat: "pdf"
    };
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
    enrichPresentationTheme?: boolean;
  }): Promise<
    | {
        accepted: true;
        docId: string;
        versionId: string;
        renderJobId: string;
        documentType: "presentation";
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
    if (revisionContext.documentType !== "presentation") {
      return {
        accepted: false,
        code: "revise_document_requires_presentation",
        message:
          "Deferred revise_document only supports Gamma presentations. PDF/DOCX/XLSX documents must stay on the live document tool surface.",
        guidance:
          "Use document.inspect, document.render, or document.convert for ordinary document work. For targeted shell-based edits, save the PDF/DOCX/XLSX output and deliver it with files.attach."
      };
    }

    const provider = "gamma";
    // Chat delivery is PDF-only for presentations, by system contract. We do
    // not inherit the previous version's outputFormat AND we do not honour a
    // model-supplied outputFormat=pptx on revisions either. Editable PPTX is
    // prepared as a separate explicit user action, so the in-chat file for a
    // presentation revision is always the PDF.
    const outputFormat: AssistantDocumentOutputFormat = "pdf";
    const requestSourceJson: AssistantDocumentSourcePayload = {
      ...input.request.sourceJson,
      outputFormat
    };
    const sourceJson =
      input.enrichPresentationTheme === true
        ? await this.applyGammaThemeSelection(
            requestSourceJson,
            input.request.sourceUserMessageText
          )
        : requestSourceJson;
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
      request: {
        ...input.request,
        sourceJson
      }
    });
    return {
      accepted: true,
      docId: created.docId,
      versionId: created.versionId,
      renderJobId: created.renderJobId,
      documentType: revisionContext.documentType
    };
  }

  private async resolveStoragePathToRevisionContext(
    assistantId: string,
    storagePath: string
  ): Promise<
    | { ok: true; context: AssistantDocumentRevisionContext }
    | { ok: false; code: string; message: string; guidance: string | null }
  > {
    const result = await this.assistantDocumentJobService.findRevisionContextByStoragePath({
      assistantId,
      storagePath
    });
    if (!result.ok) {
      return {
        ok: false,
        code: "revise_document_path_not_found",
        message:
          "The path does not resolve to a Gamma presentation accessible to this assistant. Uploaded DOCX/PDF/XLSX workspace files are not revise_document targets.",
        guidance:
          "Do not ask the user to re-upload the same file. For an existing /workspace DOCX/PDF/XLSX file, use document.inspect, document.render, or document.convert directly. For targeted shell-based edits, save the updated file and deliver it with files.attach."
      };
    }
    return { ok: true, context: result.context };
  }

  private async enqueueRevisionByStoragePath(input: {
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
    storagePath: string;
  }): Promise<
    | {
        accepted: true;
        docId: string;
        versionId: string;
        renderJobId: string;
        documentType: "presentation";
      }
    | {
        accepted: false;
        code: string;
        message: string;
        guidance: string | null;
      }
  > {
    const resolved = await this.resolveStoragePathToRevisionContext(
      input.assistantId,
      input.storagePath
    );
    if (!resolved.ok) {
      return {
        accepted: false,
        code: resolved.code,
        message: resolved.message,
        guidance: resolved.guidance
      };
    }
    const revisionContext = resolved.context;

    if (revisionContext.documentType !== "presentation") {
      return {
        accepted: false,
        code: "revise_document_requires_presentation",
        message:
          "Deferred revise_document only supports Gamma presentations. PDF/DOCX/XLSX documents must stay on the live document tool surface.",
        guidance:
          "Use document.inspect, document.render, or document.convert for ordinary document work. For targeted shell-based edits, save the PDF/DOCX/XLSX output and deliver it with files.attach."
      };
    }

    const outputFormat: AssistantDocumentOutputFormat = "pdf";
    const requestSourceJson: AssistantDocumentSourcePayload = {
      ...input.request.sourceJson,
      outputFormat
    };
    const created = await this.assistantDocumentJobService.enqueueRevision({
      assistantId: input.assistantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      // Write stays in the current chat — this is the cross-chat read / local write split.
      chatId: input.chatId,
      surface: input.surface,
      sourceUserMessageId: input.sourceUserMessageId,
      revisionContext,
      provider: "gamma",
      outputFormat,
      request: {
        ...input.request,
        sourceJson: requestSourceJson
      }
    });
    return {
      accepted: true,
      docId: created.docId,
      versionId: created.versionId,
      renderJobId: created.renderJobId,
      documentType: "presentation"
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
        documentType: "presentation";
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
    if (exportContext.documentType !== "presentation") {
      return {
        accepted: false,
        code: "export_or_redeliver_requires_presentation",
        message:
          "Deferred export_or_redeliver only supports Gamma presentations. PDF/DOCX/XLSX files must stay on the live document tool surface.",
        guidance:
          "Use document.inspect, document.render, or document.convert for ordinary document work. For targeted shell-based edits, save the PDF/DOCX/XLSX output and deliver it with files.attach."
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
    const explicitSecondaryPptxRender =
      exportContext.documentType === "presentation" &&
      exportContext.currentOutputFormat === "pdf" &&
      requestedOutputFormat === "pptx";
    if (
      requestedOutputFormat !== exportContext.currentOutputFormat &&
      !explicitSecondaryPptxRender
    ) {
      return {
        accepted: false,
        code: "document_export_format_not_supported",
        message: "Preparing a different output format is not supported for this document.",
        guidance:
          "For now, redeliver the existing ready file in its current format, or revise the document to create a new version."
      };
    }
    if (
      explicitSecondaryPptxRender &&
      !this.isExplicitPptxPreparationRequest(
        input.request.sourceUserMessageText,
        input.request.sourceJson
      )
    ) {
      return {
        accepted: false,
        code: "presentation_pptx_requires_explicit_request",
        message: "Preparing an editable PPTX requires an explicit user request.",
        guidance:
          "Ask for an editable PPTX/PowerPoint copy explicitly, or use the presentation PPTX button under the delivered PDF."
      };
    }

    const provider = "gamma";
    const outputFormat = requestedOutputFormat;
    const created =
      exportContext.latestDeliveredFile !== null &&
      requestedOutputFormat === exportContext.currentOutputFormat
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
            request: input.request,
            preserveCurrentVersionStatus: explicitSecondaryPptxRender
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
      descriptorMode !== "create_presentation" &&
      descriptorMode !== "revise_document" &&
      descriptorMode !== "export_or_redeliver"
    ) {
      if (descriptorMode === "create_pdf_document" || descriptorMode === "create_data_document") {
        throw new BadRequestException({
          code: "descriptor_mode_retired",
          message:
            "Background PDF/DOCX/XLSX document generation is retired. Use document.inspect, document.render, or document.convert on the live document surface instead.",
          guidance:
            "Create or edit visible source files under /workspace, use document.render for authored output, use document.convert for format changes, and use files.attach only when you produced the final PDF/DOCX/XLSX bytes through shell-based editing."
        });
      }
      throw new BadRequestException(
        "directToolExecution.descriptorMode must be create_presentation, revise_document, or export_or_redeliver."
      );
    }
    const request = this.objectValue(row.request, "directToolExecution.request");
    const path =
      typeof row.path === "string" && row.path.trim().length > 0 ? row.path.trim() : null;
    return {
      toolCode: "document",
      descriptorMode,
      ...(path !== null ? { path } : {}),
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
        targetSlideCount: this.optionalTargetSlideCount(request.targetSlideCount),
        outline: request.outline,
        metadata: this.optionalRecord(request.metadata)
      }
    };
  }

  private isExplicitPptxPreparationRequest(
    sourceUserMessageText: string,
    sourceJson: AssistantDocumentSourcePayload
  ): boolean {
    if (sourceJson.metadata?.explicitUserRequestedPptx === true) {
      return true;
    }
    const text = `${sourceUserMessageText}\n${sourceJson.prompt}\n${sourceJson.instructions ?? ""}`;
    return /\b(?:pptx|powerpoint|power\s+point)\b|\.pptx\b|пптх|пауэрпоинт|powerpoint/i.test(text);
  }

  private optionalTargetSlideCount(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    const rounded = Math.round(value);
    if (rounded < 1) {
      return null;
    }
    return Math.min(rounded, 30);
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

  private async applyGammaThemeSelection(
    request: AssistantDocumentSourcePayload,
    sourceUserMessageText: string
  ): Promise<AssistantDocumentSourcePayload> {
    const picked = await this.gammaThemePickerService.pickTheme({
      prompt: request.prompt,
      instructions: request.instructions ?? null,
      sourceUserMessageText,
      visualStyle: request.visualStyle ?? null,
      imagePolicy: request.imagePolicy ?? null,
      visualDensity: request.visualDensity ?? null
    });
    return {
      ...request,
      gammaThemeId: picked.themeId
    };
  }
}
