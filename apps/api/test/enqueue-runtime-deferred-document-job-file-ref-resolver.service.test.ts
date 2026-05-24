/**
 * ADR-097 Slice 4 — cross-chat PDF revise via file_ref.
 *
 * Tests the fileRef resolution branch in EnqueueRuntimeDeferredDocumentJobService:
 * AssistantFile.id → AssistantDocument → latest AssistantDocumentVersion → patch-revise loop.
 * The write always lands in the current chat; the read can cross chats.
 */
import assert from "node:assert/strict";
import { EnqueueRuntimeDeferredDocumentJobService } from "../src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service";

const CROSS_CHAT_FILE_REF = "aaaaaaaa-1111-4111-b111-111111111111";
const CROSS_CHAT_DOC_ID = "bbbbbbbb-2222-4222-b222-222222222222";
const CROSS_CHAT_VERSION_ID = "cccccccc-3333-4333-b333-333333333333";
const CURRENT_CHAT_ID = "dddddddd-4444-4444-b444-444444444444";
const ORIGIN_CHAT_ID = "eeeeeeee-5555-4555-b555-555555555555";
const CROSS_CHAT_HTML =
  "<!DOCTYPE html><html><head></head><body><h1>Cross-chat PDF</h1></body></html>";

function buildCrossChatRevisionContext(overrides?: {
  chatId?: string;
  renderedHtml?: string | null;
  documentType?: "pdf_document" | "presentation";
}) {
  return {
    docId: CROSS_CHAT_DOC_ID,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: overrides?.chatId ?? ORIGIN_CHAT_ID,
    documentType: (overrides?.documentType ?? "pdf_document") as "pdf_document" | "presentation",
    currentVersionId: CROSS_CHAT_VERSION_ID,
    currentVersionNumber: 3,
    currentVersionRenderedHtml:
      overrides?.renderedHtml !== undefined ? overrides.renderedHtml : CROSS_CHAT_HTML,
    currentSourceJson: {
      prompt: "Original cross-chat PDF",
      outputFormat: "pdf" as const,
      requestedName: "cross-chat-report"
    }
  };
}

function buildChatRepo() {
  return {
    async findMessageByIdForAssistant(messageId: string, assistantId: string) {
      return {
        id: messageId,
        chatId: CURRENT_CHAT_ID,
        assistantId,
        author: "user" as const,
        createdAt: new Date("2026-05-24T10:00:00.000Z")
      };
    },
    async findChatById(chatId: string) {
      return {
        id: chatId,
        assistantId: "assistant-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        surface: "web" as const
      };
    }
  } as never;
}

function buildQuotaMocks() {
  return {
    quotaCopy: {
      async build() {
        return null;
      }
    } as never,
    quotaStatus: {
      async execute() {
        return {
          planCode: "pro",
          monthlyToolQuotas: {
            planCode: "pro",
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
            periodSource: "subscription_period" as const,
            tools: [
              {
                toolCode: "document",
                displayName: "Document",
                usedUnits: 0,
                reservedUnits: 0,
                settledUnits: 0,
                releasedUnits: 0,
                reconciliationRequiredUnits: 0,
                limitUnits: 10,
                effectiveLimitUnits: 10,
                remainingUnits: 10,
                usageAvailable: true,
                status: "ok" as const
              }
            ]
          }
        };
      }
    } as never,
    dailyPolicy: {
      async execute() {
        return {
          planCode: "pro",
          tools: [{ toolCode: "document", activationStatus: "active" as const }]
        };
      }
    } as never,
    secretStore: {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    gammaThemePicker: {
      async pickTheme() {
        return { themeId: null, reason: null };
      }
    } as never
  };
}

// ─── Case 1: cross-chat happy path ───────────────────────────────────────────
// fileRef resolves to a PDF created in a different chat. The new revision must
// be enqueued in the CURRENT chat with parentVersionId pointing to the cross-chat
// ancestor and previousVersionRenderedHtml forwarded correctly.
async function runCrossChatHappyPath(): Promise<void> {
  let capturedRevisionInput: Record<string, unknown> | null = null;
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called on revise");
      },
      async findRevisionContextByFileRef() {
        return { ok: true as const, context: buildCrossChatRevisionContext() };
      },
      async enqueueRevision(input: unknown) {
        capturedRevisionInput = input as Record<string, unknown>;
        return {
          docId: CROSS_CHAT_DOC_ID,
          versionId: "new-version-id",
          renderJobId: "new-render-id",
          status: "queued" as const
        };
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-cross",
    sourceUserMessageText: "Revise the cross-chat PDF",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: CROSS_CHAT_FILE_REF,
      request: { prompt: "Add an executive summary", outputFormat: "pdf" }
    }
  });

  assert.equal(result.accepted, true, "cross-chat fileRef revision must be accepted");
  assert.equal(
    (result as { docId: string }).docId,
    CROSS_CHAT_DOC_ID,
    "returned docId must be the resolved cross-chat docId"
  );
  assert.ok(capturedRevisionInput !== null, "enqueueRevision must have been called");
  assert.equal(
    (capturedRevisionInput as { chatId: string }).chatId,
    CURRENT_CHAT_ID,
    "write must land in the CURRENT chat, not the origin chat"
  );
  assert.equal(
    (capturedRevisionInput as { previousVersionRenderedHtml: string }).previousVersionRenderedHtml,
    CROSS_CHAT_HTML,
    "previousVersionRenderedHtml from cross-chat context must be forwarded to enqueueRevision"
  );
  assert.equal(
    (capturedRevisionInput as { revisionContext: { currentVersionId: string } }).revisionContext
      .currentVersionId,
    CROSS_CHAT_VERSION_ID,
    "revisionContext.currentVersionId must be the cross-chat ancestor version (parentVersionId)"
  );
}

// ─── Case 2: same-chat happy path ────────────────────────────────────────────
// fileRef resolves to a PDF that happens to be in the current chat. Functionally
// identical to the cross-chat path but confirms the path works for same-chat too.
async function runSameChatFileRefHappyPath(): Promise<void> {
  let capturedRevisionInput: Record<string, unknown> | null = null;
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called on revise");
      },
      async findRevisionContextByFileRef() {
        return {
          ok: true as const,
          // same-chat: origin chatId equals current chatId
          context: buildCrossChatRevisionContext({ chatId: CURRENT_CHAT_ID })
        };
      },
      async enqueueRevision(input: unknown) {
        capturedRevisionInput = input as Record<string, unknown>;
        return {
          docId: CROSS_CHAT_DOC_ID,
          versionId: "same-chat-version-2",
          renderJobId: "same-chat-render-2",
          status: "queued" as const
        };
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-same",
    sourceUserMessageText: "Revise the same-chat PDF via file_ref",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: CROSS_CHAT_FILE_REF,
      request: { prompt: "Expand section 2", outputFormat: "pdf" }
    }
  });

  assert.equal(result.accepted, true, "same-chat fileRef revision must be accepted");
  assert.ok(capturedRevisionInput !== null, "enqueueRevision must have been called");
  assert.equal(
    (capturedRevisionInput as { previousVersionRenderedHtml: string }).previousVersionRenderedHtml,
    CROSS_CHAT_HTML,
    "renderedHtml must flow through for same-chat fileRef path"
  );
}

// ─── Case 3: security — fileRef belongs to a different assistant ──────────────
// findRevisionContextByFileRef returns not_found because the DB query filters on
// AssistantFile.assistantId. The service must return revise_document_file_ref_not_found.
async function runSecurityDifferentAssistantFileRef(): Promise<void> {
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called");
      },
      async findRevisionContextByFileRef() {
        return { ok: false as const, reason: "not_found" as const };
      },
      async enqueueRevision() {
        throw new Error("enqueueRevision must not be called when fileRef is not found");
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-sec",
    sourceUserMessageText: "Revise someone else's PDF",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      request: { prompt: "Revise it", outputFormat: "pdf" }
    }
  });

  assert.equal(result.accepted, false, "cross-assistant fileRef must be rejected");
  assert.equal(
    (result as { code: string }).code,
    "revise_document_file_ref_not_found",
    "must return revise_document_file_ref_not_found for cross-assistant fileRef"
  );
}

// ─── Case 4: non-existent fileRef ────────────────────────────────────────────
async function runNonExistentFileRef(): Promise<void> {
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called");
      },
      async findRevisionContextByFileRef() {
        return { ok: false as const, reason: "not_found" as const };
      },
      async enqueueRevision() {
        throw new Error("enqueueRevision must not be called when fileRef is not found");
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-noref",
    sourceUserMessageText: "Revise a non-existent PDF",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: "00000000-0000-4000-b000-000000000000",
      request: { prompt: "Revise it", outputFormat: "pdf" }
    }
  });

  assert.equal(result.accepted, false, "non-existent fileRef must be rejected");
  assert.equal(
    (result as { code: string }).code,
    "revise_document_file_ref_not_found",
    "must return revise_document_file_ref_not_found"
  );
}

// ─── Case 5: fileRef resolves to a presentation (not a PDF) ──────────────────
async function runFileRefNotAPdfDocument(): Promise<void> {
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called");
      },
      async findRevisionContextByFileRef() {
        return { ok: false as const, reason: "not_pdf_document" as const };
      },
      async enqueueRevision() {
        throw new Error("enqueueRevision must not be called when type check fails");
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-pptx",
    sourceUserMessageText: "Revise my presentation via file_ref",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: CROSS_CHAT_FILE_REF,
      request: { prompt: "Revise it", outputFormat: "pdf" }
    }
  });

  assert.equal(result.accepted, false, "presentation fileRef must be rejected");
  assert.equal(
    (result as { code: string }).code,
    "revise_document_file_ref_not_a_pdf_document",
    "must return revise_document_file_ref_not_a_pdf_document"
  );
}

// ─── Case 6: fileRef resolves but latest version has null renderedHtml ────────
// This exercises the document_revise_unsupported_legacy_version guard on the
// cross-chat path (same guard as the per-chat path, Slice 2 requirement).
async function runFileRefLegacyVersionRenderedHtmlNull(): Promise<void> {
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called");
      },
      async findRevisionContextByFileRef() {
        return {
          ok: true as const,
          context: buildCrossChatRevisionContext({ renderedHtml: null })
        };
      },
      async enqueueRevision() {
        throw new Error("enqueueRevision must not be called for legacy version");
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-legacy",
    sourceUserMessageText: "Revise a legacy cross-chat PDF",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: CROSS_CHAT_FILE_REF,
      request: { prompt: "Update the intro", outputFormat: "pdf" }
    }
  });

  assert.equal(result.accepted, false, "legacy version (null renderedHtml) must be rejected");
  assert.equal(
    (result as { code: string }).code,
    "document_revise_unsupported_legacy_version",
    "must return document_revise_unsupported_legacy_version for null renderedHtml"
  );
}

// ─── Case 7: both fileRef AND docId passed → ambiguous source error ───────────
async function runAmbiguousSourceBothFileRefAndDocId(): Promise<void> {
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called");
      },
      async findRevisionContextByFileRef() {
        throw new Error("findRevisionContextByFileRef must not be called when both are set");
      },
      async enqueueRevision() {
        throw new Error("enqueueRevision must not be called for ambiguous source");
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-ambig",
    sourceUserMessageText: "Update the report",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: CROSS_CHAT_FILE_REF,
      request: {
        prompt: "Update section 3",
        docId: "12345678-1234-4234-9234-1234567890ab",
        outputFormat: "pdf"
      }
    }
  });

  assert.equal(result.accepted, false, "both file_ref and doc_id must be rejected");
  assert.equal(
    (result as { code: string }).code,
    "revise_document_ambiguous_source",
    "must return revise_document_ambiguous_source when both file_ref and doc_id are present"
  );
}

// ─── Case 8: neither fileRef nor docId → existing revise_document_requires_existing_pdf ──
// Backwards-compatibility: existing per-chat path must stay green when no fileRef is passed.
async function runNeitherFileRefNorDocIdFallsBackToExistingPath(): Promise<void> {
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called");
      },
      async findLatestRevisionContextForChat() {
        return null;
      },
      async enqueueRevision() {
        throw new Error("enqueueRevision must not be called when no context is found");
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-none",
    sourceUserMessageText: "Revise something",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Update the title",
        outputFormat: "pdf"
        // neither docId nor fileRef
      }
    }
  });

  assert.equal(result.accepted, false, "no fileRef/docId with no chat PDF must be rejected");
  assert.equal(
    (result as { code: string }).code,
    "revise_document_requires_existing_pdf",
    "must fall through to existing revise_document_requires_existing_pdf error"
  );
}

// ─── Case 9: cross-chat fileRef — documentType pdf_document guard in service ──
// Extra guard: context comes back from findRevisionContextByFileRef with documentType
// "presentation" as ok:true (should not happen in production due to the DB-level check,
// but the enqueueRevisionByFileRef method has a second guard). Verify the guard fires.
async function runFileRefContextDocumentTypeGuard(): Promise<void> {
  const q = buildQuotaMocks();

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    buildChatRepo(),
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue must not be called");
      },
      async findRevisionContextByFileRef() {
        return {
          ok: true as const,
          context: buildCrossChatRevisionContext({ documentType: "presentation" })
        };
      },
      async enqueueRevision() {
        throw new Error("enqueueRevision must not be called for non-PDF context");
      }
    } as never,
    q.quotaCopy,
    q.quotaStatus,
    q.dailyPolicy,
    q.secretStore,
    q.gammaThemePicker
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "msg-type-guard",
    sourceUserMessageText: "Revise my presentation via file_ref",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      fileRef: CROSS_CHAT_FILE_REF,
      request: { prompt: "Shorten it", outputFormat: "pdf" }
    }
  });

  assert.equal(
    result.accepted,
    false,
    "presentation context returned as ok:true must still be rejected by the secondary guard"
  );
  assert.equal(
    (result as { code: string }).code,
    "revise_document_file_ref_not_a_pdf_document",
    "secondary guard must return revise_document_file_ref_not_a_pdf_document"
  );
}

async function run(): Promise<void> {
  await runCrossChatHappyPath();
  await runSameChatFileRefHappyPath();
  await runSecurityDifferentAssistantFileRef();
  await runNonExistentFileRef();
  await runFileRefNotAPdfDocument();
  await runFileRefLegacyVersionRenderedHtmlNull();
  await runAmbiguousSourceBothFileRefAndDocId();
  await runNeitherFileRefNorDocIdFallsBackToExistingPath();
  await runFileRefContextDocumentTypeGuard();
  console.log("all 9 file-ref-resolver tests passed ✓");
}

void run();
