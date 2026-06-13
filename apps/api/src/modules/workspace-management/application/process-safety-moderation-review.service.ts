import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type SafetyModerationReviewJob } from "@prisma/client";
import { loadApiConfig } from "@persai/config";
import type { InboundSafetyPrecheckOutcome } from "../domain/safety-policy.types";
import { SAFETY_POLICY_SETTINGS_ID } from "../domain/safety-policy.types";
import type {
  SafetyModerationThreadMessageSnapshot,
  SafetyModerationTriggerSnapshot
} from "../domain/safety-moderation.types";
import { SAFETY_MODERATION_THREAD_PREVIEW_MAX_CHARS } from "../domain/safety-moderation.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { OpenAiModerationClientService } from "./openai-moderation-client.service";
import {
  decideSafetyModerationOutcome,
  type SafetyModerationDecision
} from "./safety-moderation-decision";

type ClaimedSafetyModerationReviewJob = Pick<
  SafetyModerationReviewJob,
  | "id"
  | "triggerKey"
  | "userId"
  | "assistantId"
  | "workspaceId"
  | "chatId"
  | "surface"
  | "surfaceThreadKey"
  | "messageSnapshot"
  | "precheckOutcome"
>;

function readPrecheckOutcome(raw: unknown): InboundSafetyPrecheckOutcome {
  if (raw === null || typeof raw !== "object") {
    return {
      route: "allow",
      confidence: "none",
      reasonCode: "none",
      rulePack: null,
      matchedSignals: []
    };
  }
  const row = raw as Record<string, unknown>;
  const route = row.route;
  const confidence = row.confidence;
  const reasonCode = row.reasonCode;
  const rulePack = row.rulePack;
  const matchedSignals = row.matchedSignals;
  return {
    route:
      route === "defer_contour_2" || route === "block_obvious" || route === "allow"
        ? route
        : "allow",
    confidence:
      confidence === "low" ||
      confidence === "medium" ||
      confidence === "high" ||
      confidence === "none"
        ? confidence
        : "none",
    reasonCode: typeof reasonCode === "string" ? reasonCode : "none",
    rulePack:
      typeof rulePack === "string" ? (rulePack as InboundSafetyPrecheckOutcome["rulePack"]) : null,
    matchedSignals: Array.isArray(matchedSignals)
      ? matchedSignals.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

function readTriggerText(messageSnapshot: unknown): string {
  if (messageSnapshot === null || typeof messageSnapshot !== "object") {
    return "";
  }
  const row = messageSnapshot as Record<string, unknown>;
  if (typeof row.triggerText === "string") {
    return row.triggerText.trim();
  }
  return "";
}

function previewThreadText(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= SAFETY_MODERATION_THREAD_PREVIEW_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, SAFETY_MODERATION_THREAD_PREVIEW_MAX_CHARS)}…`;
}

@Injectable()
export class ProcessSafetyModerationReviewService {
  private readonly logger = new Logger(ProcessSafetyModerationReviewService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly openAiModerationClientService: OpenAiModerationClientService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  async processClaimedJob(job: ClaimedSafetyModerationReviewJob): Promise<void> {
    const config = loadApiConfig(process.env);
    const existingCaseId = await this.findExistingCaseId(job.userId, job.triggerKey);
    if (existingCaseId !== null) {
      await this.prisma.safetyModerationReviewJob.update({
        where: { id: job.id },
        data: { status: "completed" }
      });
      this.logger.debug(
        `Skipped safety moderation review ${job.triggerKey}; case ${existingCaseId} already exists.`
      );
      return;
    }

    const settings = await this.prisma.safetyPolicySettings.findUnique({
      where: { id: SAFETY_POLICY_SETTINGS_ID }
    });
    if (settings?.contour2Enabled === false) {
      await this.completeWithoutModeration(job, "allow", "contour2_disabled");
      return;
    }

    const precheck = readPrecheckOutcome(job.precheckOutcome);
    const triggerText = await this.resolveTriggerText(job);
    if (triggerText.length === 0) {
      await this.completeWithoutModeration(job, "allow", "empty_trigger_text");
      return;
    }

    const threadSnapshot = await this.loadThreadSnapshot(job.chatId, job.assistantId);
    const moderation = await this.openAiModerationClientService.moderateText({
      model: settings?.moderationModelId ?? "omni-moderation-latest",
      text: triggerText
    });
    const decisionOutcome = decideSafetyModerationOutcome({
      moderation,
      precheck,
      blockScoreThreshold: config.SAFETY_MODERATION_BLOCK_SCORE_THRESHOLD
    });

    const triggerSnapshot: SafetyModerationTriggerSnapshot = {
      triggerKey: job.triggerKey,
      triggerText,
      surface: job.surface,
      surfaceThreadKey: job.surfaceThreadKey,
      precheckOutcome: precheck
    };
    const scores = {
      flagged: moderation.flagged,
      categories: moderation.categories,
      categoryScores: moderation.categoryScores,
      maxCategoryScore: decisionOutcome.maxCategoryScore,
      topCategory: decisionOutcome.topCategory
    } as Prisma.InputJsonValue;

    const moderationCase = await this.prisma.moderationCase.create({
      data: {
        userId: job.userId,
        assistantId: job.assistantId,
        chatId: job.chatId,
        surface: job.surface,
        triggerSnapshot: triggerSnapshot as Prisma.InputJsonValue,
        threadSnapshot: threadSnapshot as Prisma.InputJsonValue,
        scores,
        decision: decisionOutcome.decision,
        reasonCode: decisionOutcome.reasonCode
      }
    });

    if (decisionOutcome.decision === "block_user") {
      await this.upsertActiveSafetyRestriction({
        userId: job.userId,
        reasonCode: decisionOutcome.reasonCode,
        assistantId: job.assistantId,
        moderationCaseId: moderationCase.id
      });
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: null,
      eventCategory: "safety",
      eventCode: "safety.moderation_case_decided",
      summary: `Safety moderation case decided (${decisionOutcome.decision}) for user ${job.userId}.`,
      outcome: decisionOutcome.decision === "block_user" ? "denied" : "succeeded",
      details: {
        moderationCaseId: moderationCase.id,
        triggerKey: job.triggerKey,
        userId: job.userId,
        assistantId: job.assistantId,
        workspaceId: job.workspaceId,
        decision: decisionOutcome.decision,
        reasonCode: decisionOutcome.reasonCode,
        surface: job.surface
      }
    });

    await this.prisma.safetyModerationReviewJob.update({
      where: { id: job.id },
      data: { status: "completed" }
    });
  }

  async markJobFailed(jobId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Safety moderation review job ${jobId} failed: ${message}`);
    await this.prisma.safetyModerationReviewJob.update({
      where: { id: jobId },
      data: { status: "failed" }
    });
  }

  private async completeWithoutModeration(
    job: ClaimedSafetyModerationReviewJob,
    decision: SafetyModerationDecision,
    reasonCode: string
  ): Promise<void> {
    const precheck = readPrecheckOutcome(job.precheckOutcome);
    const triggerText = readTriggerText(job.messageSnapshot);
    const triggerSnapshot: SafetyModerationTriggerSnapshot = {
      triggerKey: job.triggerKey,
      triggerText,
      surface: job.surface,
      surfaceThreadKey: job.surfaceThreadKey,
      precheckOutcome: precheck
    };
    await this.prisma.moderationCase.create({
      data: {
        userId: job.userId,
        assistantId: job.assistantId,
        chatId: job.chatId,
        surface: job.surface,
        triggerSnapshot: triggerSnapshot as Prisma.InputJsonValue,
        threadSnapshot: Prisma.JsonNull,
        scores: { skipped: true, reasonCode } as Prisma.InputJsonValue,
        decision,
        reasonCode
      }
    });
    await this.prisma.safetyModerationReviewJob.update({
      where: { id: job.id },
      data: { status: "completed" }
    });
  }

  private async resolveTriggerText(job: ClaimedSafetyModerationReviewJob): Promise<string> {
    const fromSnapshot = readTriggerText(job.messageSnapshot);
    if (fromSnapshot.length > 0) {
      return fromSnapshot;
    }
    if (job.chatId === null) {
      return "";
    }
    const latestUserMessage = await this.prisma.assistantChatMessage.findFirst({
      where: {
        chatId: job.chatId,
        assistantId: job.assistantId,
        author: "user"
      },
      orderBy: { createdAt: "desc" },
      select: { content: true }
    });
    return latestUserMessage?.content.trim() ?? "";
  }

  private async loadThreadSnapshot(
    chatId: string | null,
    assistantId: string
  ): Promise<SafetyModerationThreadMessageSnapshot[] | null> {
    if (chatId === null) {
      return null;
    }
    const config = loadApiConfig(process.env);
    const rows = await this.prisma.assistantChatMessage.findMany({
      where: {
        chatId,
        assistantId,
        author: { in: ["user", "assistant"] }
      },
      orderBy: { createdAt: "desc" },
      take: config.SAFETY_MODERATION_THREAD_MESSAGE_LIMIT,
      select: {
        id: true,
        author: true,
        content: true,
        createdAt: true
      }
    });
    if (rows.length === 0) {
      return null;
    }
    return rows
      .slice()
      .reverse()
      .map((row) => ({
        id: row.id,
        author: row.author as "user" | "assistant",
        contentPreview: previewThreadText(row.content),
        createdAt: row.createdAt.toISOString()
      }));
  }

  private async findExistingCaseId(userId: string, triggerKey: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM moderation_cases
      WHERE user_id = ${userId}::uuid
        AND trigger_snapshot->>'triggerKey' = ${triggerKey}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private async upsertActiveSafetyRestriction(input: {
    userId: string;
    reasonCode: string;
    assistantId: string;
    moderationCaseId: string;
  }): Promise<void> {
    await this.prisma.userRestriction.upsert({
      where: {
        userId_kind: {
          userId: input.userId,
          kind: "safety"
        }
      },
      create: {
        userId: input.userId,
        kind: "safety",
        status: "active",
        reasonCode: input.reasonCode,
        source: "moderation_auto",
        sourceAssistantId: input.assistantId,
        sourceModerationCaseId: input.moderationCaseId,
        blockedUntil: null
      },
      update: {
        status: "active",
        reasonCode: input.reasonCode,
        source: "moderation_auto",
        sourceAssistantId: input.assistantId,
        sourceModerationCaseId: input.moderationCaseId,
        blockedUntil: null,
        clearedAt: null,
        clearedByUserId: null
      }
    });
  }
}
