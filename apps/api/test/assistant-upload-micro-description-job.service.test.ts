import assert from "node:assert/strict";
import { AssistantUploadMicroDescriptionJobService } from "../src/modules/workspace-management/application/assistant-upload-micro-description-job.service";

type FileRow = {
  id: string;
  assistantId: string;
  workspaceId: string;
  metadata: Record<string, unknown> | null;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
};

type AttachmentRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type JobRow = {
  id: string;
  assistantId: string;
  workspaceId: string;
  assistantFileId: string;
  sourceAttachmentId: string | null;
  status: "queued" | "running" | "completed" | "failed";
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  lastErrorMessage: string | null;
  schedulerClaimToken: string | null;
  schedulerClaimedAt: Date | null;
  schedulerClaimExpiresAt: Date | null;
  startedAt: Date | null;
  usageJson: Record<string, unknown> | null;
  usageOccurredAt: Date | null;
};

function createHarness(input?: {
  analyzeUploadsOnB2cUpload?: boolean;
  file?: Partial<FileRow>;
  attachment?: Partial<AttachmentRow>;
  generatedSummary?: string | null;
  generatedUsage?: Record<string, unknown> | null;
  generatedRespondedAt?: string;
  existingJob?: Partial<JobRow>;
}) {
  const files = new Map<string, FileRow>();
  const attachments = new Map<string, AttachmentRow>();
  const jobs = new Map<string, JobRow>();
  const fileId = input?.file?.id ?? "file-1";
  const attachmentId = input?.attachment?.id ?? "att-1";
  files.set(fileId, {
    id: fileId,
    assistantId: input?.file?.assistantId ?? "assistant-1",
    workspaceId: input?.file?.workspaceId ?? "workspace-1",
    metadata: input?.file?.metadata ?? null,
    displayName: input?.file?.displayName ?? "brief.txt",
    mimeType: input?.file?.mimeType ?? "text/plain",
    sizeBytes: input?.file?.sizeBytes ?? 42
  });
  attachments.set(attachmentId, {
    id: attachmentId,
    metadata: input?.attachment?.metadata ?? null
  });
  if (input?.existingJob) {
    const row: JobRow = {
      id: input.existingJob.id ?? "job-existing-1",
      assistantId: input.existingJob.assistantId ?? "assistant-1",
      workspaceId: input.existingJob.workspaceId ?? "workspace-1",
      assistantFileId: input.existingJob.assistantFileId ?? fileId,
      sourceAttachmentId: input.existingJob.sourceAttachmentId ?? attachmentId,
      status: input.existingJob.status ?? "queued",
      attemptCount: input.existingJob.attemptCount ?? 0,
      maxAttempts: input.existingJob.maxAttempts ?? 3,
      nextRetryAt: input.existingJob.nextRetryAt ?? null,
      completedAt: input.existingJob.completedAt ?? null,
      failedAt: input.existingJob.failedAt ?? null,
      lastErrorMessage: input.existingJob.lastErrorMessage ?? null,
      schedulerClaimToken: input.existingJob.schedulerClaimToken ?? null,
      schedulerClaimedAt: input.existingJob.schedulerClaimedAt ?? null,
      schedulerClaimExpiresAt: input.existingJob.schedulerClaimExpiresAt ?? null,
      startedAt: input.existingJob.startedAt ?? null,
      usageJson: input.existingJob.usageJson ?? null,
      usageOccurredAt: input.existingJob.usageOccurredAt ?? null
    };
    jobs.set(row.id, row);
  }
  const helperCalls: Array<Record<string, unknown>> = [];
  const ledgerCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    assistantUploadMicroDescriptionJob: {
      async findUnique(args: { where: { assistantFileId?: string; id?: string } }) {
        if (args.where.assistantFileId) {
          return (
            Array.from(jobs.values()).find(
              (job) => job.assistantFileId === args.where.assistantFileId
            ) ?? null
          );
        }
        if (args.where.id) {
          return jobs.get(args.where.id) ?? null;
        }
        return null;
      },
      async create(args: {
        data: {
          assistantId: string;
          workspaceId: string;
          assistantFileId: string;
          sourceAttachmentId: string | null;
        };
      }) {
        const row: JobRow = {
          id: `job-${jobs.size + 1}`,
          assistantId: args.data.assistantId,
          workspaceId: args.data.workspaceId,
          assistantFileId: args.data.assistantFileId,
          sourceAttachmentId: args.data.sourceAttachmentId,
          status: "queued",
          attemptCount: 0,
          maxAttempts: 3,
          nextRetryAt: null,
          completedAt: null,
          failedAt: null,
          lastErrorMessage: null,
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          startedAt: null,
          usageJson: null,
          usageOccurredAt: null
        };
        jobs.set(row.id, row);
        return row;
      },
      async update(args: { where: { id: string }; data: Partial<JobRow> }) {
        const current = jobs.get(args.where.id);
        if (!current) {
          throw new Error(`Missing job ${args.where.id}`);
        }
        const next = { ...current, ...args.data };
        jobs.set(args.where.id, next);
        return next;
      }
    },
    assistantChatMessageAttachment: {
      async findUnique(args: { where: { id: string } }) {
        return attachments.get(args.where.id) ?? null;
      },
      async update(args: {
        where: { id: string };
        data: { metadata: Record<string, unknown> | null };
      }) {
        const current = attachments.get(args.where.id);
        if (!current) {
          throw new Error(`Missing attachment ${args.where.id}`);
        }
        const next = { ...current, metadata: args.data.metadata };
        attachments.set(args.where.id, next);
        return next;
      }
    },
    assistantFile: {
      async findUnique(args: { where: { id: string } }) {
        return files.get(args.where.id) ?? null;
      },
      async update(args: { where: { id: string }; data: { metadata: Record<string, unknown> } }) {
        const current = files.get(args.where.id);
        if (!current) {
          throw new Error(`Missing file ${args.where.id}`);
        }
        const next = { ...current, metadata: args.data.metadata };
        files.set(args.where.id, next);
        return next;
      }
    },
    async $transaction<T>(callback: (tx: typeof prisma) => Promise<T>) {
      return callback(prisma);
    }
  };

  const service = new AssistantUploadMicroDescriptionJobService(
    prisma as never,
    {
      async findAssistantFile(params: {
        assistantId: string;
        workspaceId: string;
        fileRef: string;
      }) {
        const file = files.get(params.fileRef);
        return file &&
          file.assistantId === params.assistantId &&
          file.workspaceId === params.workspaceId
          ? file
          : null;
      }
    } as never,
    {
      async execute() {
        return {
          routerPolicy: {
            analyzeUploadsOnB2cUpload: input?.analyzeUploadsOnB2cUpload ?? false
          }
        };
      }
    } as never,
    {
      async describeCanonicalFile(params: Record<string, unknown>) {
        helperCalls.push(params);
        if (
          input?.generatedSummary === undefined &&
          input?.generatedUsage === undefined &&
          input?.generatedRespondedAt === undefined
        ) {
          return null;
        }
        return {
          summary: input?.generatedSummary ?? null,
          usage:
            input?.generatedUsage === undefined
              ? {
                  providerKey: "openai",
                  modelKey: "gpt-5.4-mini",
                  inputTokens: 12,
                  cachedInputTokens: 0,
                  outputTokens: 4,
                  totalTokens: 16
                }
              : input.generatedUsage,
          respondedAt: input?.generatedRespondedAt ?? "2026-05-22T16:02:03.000Z",
          provider: "openai" as const,
          model: "gpt-5.4-mini"
        };
      }
    } as never,
    {
      async findById(assistantId: string) {
        return assistantId === "assistant-1" ? { id: assistantId, userId: "user-1" } : null;
      }
    } as never,
    {
      async recordToolHelperEvent(params: Record<string, unknown>) {
        ledgerCalls.push(params);
        return 1;
      }
    } as never
  );

  return { service, files, attachments, jobs, helperCalls, ledgerCalls, fileId, attachmentId };
}

async function run(): Promise<void> {
  const gated = createHarness({ analyzeUploadsOnB2cUpload: false });
  const gatedResult = await gated.service.enqueueIfNeeded({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatMode: "normal",
    attachmentId: gated.attachmentId,
    assistantFileId: gated.fileId
  });
  assert.deepEqual(gatedResult, { accepted: false, reason: "policy_disabled" });
  assert.equal(gated.jobs.size, 0);

  const project = createHarness({ analyzeUploadsOnB2cUpload: false });
  const projectResult = await project.service.enqueueIfNeeded({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatMode: "project",
    attachmentId: project.attachmentId,
    assistantFileId: project.fileId
  });
  assert.deepEqual(projectResult, { accepted: true, reason: "queued" });
  assert.equal(project.jobs.size, 1);

  const existingSummary = createHarness({
    analyzeUploadsOnB2cUpload: true,
    file: {
      metadata: {
        semanticSummary: "Existing canonical summary",
        semanticSummarySource: "upload_micro_description"
      }
    }
  });
  const existingResult = await existingSummary.service.enqueueIfNeeded({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatMode: "normal",
    attachmentId: existingSummary.attachmentId,
    assistantFileId: existingSummary.fileId
  });
  assert.deepEqual(existingResult, { accepted: false, reason: "already_summarized" });
  assert.deepEqual(existingSummary.attachments.get(existingSummary.attachmentId)?.metadata, {
    semanticSummary: "Existing canonical summary",
    semanticSummarySource: "upload_micro_description"
  });
  assert.equal(existingSummary.jobs.size, 0);

  const generated = createHarness({
    generatedSummary: "Short project brief for upload analysis"
  });
  const generatedJobId = "job-process-1";
  generated.jobs.set(generatedJobId, {
    id: generatedJobId,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: generated.fileId,
    sourceAttachmentId: generated.attachmentId,
    status: "queued",
    attemptCount: 0,
    maxAttempts: 3,
    nextRetryAt: null,
    completedAt: null,
    failedAt: null,
    lastErrorMessage: null,
    schedulerClaimToken: "claim-1",
    schedulerClaimedAt: new Date("2026-05-22T16:00:00.000Z"),
    schedulerClaimExpiresAt: new Date("2026-05-22T16:10:00.000Z"),
    startedAt: null,
    usageJson: null,
    usageOccurredAt: null
  });
  await generated.service.processClaimedJob({
    id: generatedJobId,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: generated.fileId,
    sourceAttachmentId: generated.attachmentId
  });
  assert.equal(generated.helperCalls.length, 1);
  assert.deepEqual(generated.files.get(generated.fileId)?.metadata, {
    semanticSummary: "Short project brief for upload analysis",
    semanticSummarySource: "upload_micro_description"
  });
  assert.deepEqual(generated.attachments.get(generated.attachmentId)?.metadata, {
    semanticSummary: "Short project brief for upload analysis",
    semanticSummarySource: "upload_micro_description"
  });
  assert.equal(generated.jobs.get(generatedJobId)?.status, "completed");
  assert.deepEqual(generated.jobs.get(generatedJobId)?.usageJson, {
    providerKey: "openai",
    modelKey: "gpt-5.4-mini",
    inputTokens: 12,
    cachedInputTokens: 0,
    outputTokens: 4,
    totalTokens: 16
  });
  assert.equal(
    generated.jobs.get(generatedJobId)?.usageOccurredAt?.toISOString(),
    "2026-05-22T16:02:03.000Z"
  );
  assert.deepEqual(generated.ledgerCalls, [
    {
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "background",
      occurredAt: "2026-05-22T16:02:03.000Z",
      sourceEventId: `upload_micro_description_job:${generatedJobId}`,
      source: "upload_micro_description",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5.4-mini",
        inputTokens: 12,
        cachedInputTokens: 0,
        outputTokens: 4,
        totalTokens: 16
      }
    }
  ]);

  const skipExisting = createHarness({
    file: {
      metadata: {
        semanticSummary: "Already summarized canonically",
        semanticSummarySource: "text_extract"
      }
    },
    generatedSummary: "This should not be used"
  });
  const skipJobId = "job-skip-1";
  skipExisting.jobs.set(skipJobId, {
    id: skipJobId,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: skipExisting.fileId,
    sourceAttachmentId: skipExisting.attachmentId,
    status: "queued",
    attemptCount: 0,
    maxAttempts: 3,
    nextRetryAt: null,
    completedAt: null,
    failedAt: null,
    lastErrorMessage: null,
    schedulerClaimToken: "claim-2",
    schedulerClaimedAt: new Date("2026-05-22T16:00:00.000Z"),
    schedulerClaimExpiresAt: new Date("2026-05-22T16:10:00.000Z"),
    startedAt: null,
    usageJson: null,
    usageOccurredAt: null
  });
  await skipExisting.service.processClaimedJob({
    id: skipJobId,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: skipExisting.fileId,
    sourceAttachmentId: skipExisting.attachmentId
  });
  assert.equal(skipExisting.helperCalls.length, 0);
  assert.deepEqual(skipExisting.attachments.get(skipExisting.attachmentId)?.metadata, {
    semanticSummary: "Already summarized canonically",
    semanticSummarySource: "text_extract"
  });
  assert.equal(skipExisting.jobs.get(skipJobId)?.status, "completed");

  const noUsableSummary = createHarness({
    generatedSummary: null,
    generatedUsage: {
      providerKey: "openai",
      modelKey: "gpt-5.4-mini",
      inputTokens: 20,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 20
    },
    generatedRespondedAt: "2026-05-22T18:00:00.000Z"
  });
  const noSummaryJobId = "job-no-summary-1";
  noUsableSummary.jobs.set(noSummaryJobId, {
    id: noSummaryJobId,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: noUsableSummary.fileId,
    sourceAttachmentId: noUsableSummary.attachmentId,
    status: "queued",
    attemptCount: 0,
    maxAttempts: 3,
    nextRetryAt: null,
    completedAt: null,
    failedAt: null,
    lastErrorMessage: null,
    schedulerClaimToken: "claim-3",
    schedulerClaimedAt: new Date("2026-05-22T17:59:00.000Z"),
    schedulerClaimExpiresAt: new Date("2026-05-22T18:09:00.000Z"),
    startedAt: null,
    usageJson: null,
    usageOccurredAt: null
  });
  await noUsableSummary.service.processClaimedJob({
    id: noSummaryJobId,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: noUsableSummary.fileId,
    sourceAttachmentId: noUsableSummary.attachmentId
  });
  assert.equal(noUsableSummary.files.get(noUsableSummary.fileId)?.metadata, null);
  assert.equal(noUsableSummary.attachments.get(noUsableSummary.attachmentId)?.metadata, null);
  assert.deepEqual(noUsableSummary.jobs.get(noSummaryJobId)?.usageJson, {
    providerKey: "openai",
    modelKey: "gpt-5.4-mini",
    inputTokens: 20,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 20
  });
  assert.equal(
    noUsableSummary.jobs.get(noSummaryJobId)?.usageOccurredAt?.toISOString(),
    "2026-05-22T18:00:00.000Z"
  );
  assert.equal(noUsableSummary.jobs.get(noSummaryJobId)?.status, "completed");
  assert.equal(noUsableSummary.ledgerCalls.length, 1);
}

void run();
