import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { loadApiConfig } from "@persai/config";
import type { InboundSafetyPrecheckOutcome } from "../domain/safety-policy.types";
import { SAFETY_POLICY_SETTINGS_ID } from "../domain/safety-policy.types";
import type {
  SafetyModerationThreadMessageSnapshot,
  SafetyModerationTriggerSnapshot
} from "../domain/safety-moderation.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { OpenAiModerationClientService } from "./openai-moderation-client.service";
import { decideSafetyModerationOutcome } from "./safety-moderation-decision";
import { previewThreadText } from "./safety-moderation-review.shared";

export type SafetyModerationReviewTriggerInput = {
  triggerKey: string;
  userId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string | null;
  surface: string;
  surfaceThreadKey: string | null;
  triggerText: string;
  precheck: InboundSafetyPrecheckOutcome;
  moderationTimeoutMs?: number;
};

export type SafetyModerationReviewTriggerResult = {
  alreadyExisted: boolean;
  moderationCaseId: string | null;
  decision: "allow" | "warn" | "block_user" | null;
  reasonCode: string | null;
  restrictionCreated: boolean;
};

@Injectable()
export class SafetyModerationReviewCoreService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly openAiModerationClientService: OpenAiModerationClientService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  async findExistingCaseId(userId: string, triggerKey: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM moderation_cases
      WHERE user_id = ${userId}::uuid
        AND trigger_snapshot->>'triggerKey' = ${triggerKey}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  async reviewTrigger(
    input: SafetyModerationReviewTriggerInput
  ): Promise<SafetyModerationReviewTriggerResult> {
    const existingCaseId = await this.findExistingCaseId(input.userId, input.triggerKey);
    if (existingCaseId !== null) {
      return {
        alreadyExisted: true,
        moderationCaseId: existingCaseId,
        decision: null,
        reasonCode: null,
        restrictionCreated: false
      };
    }

    const settings = await this.prisma.safetyPolicySettings.findUnique({
      where: { id: SAFETY_POLICY_SETTINGS_ID }
    });
    if (settings?.contour2Enabled === false) {
      const moderationCaseId = await this.persistSkippedCase(input, "allow", "contour2_disabled");
      return {
        alreadyExisted: false,
        moderationCaseId,
        decision: "allow",
        reasonCode: "contour2_disabled",
        restrictionCreated: false
      };
    }

    const triggerText = input.triggerText.trim();
    if (triggerText.length === 0) {
      const moderationCaseId = await this.persistSkippedCase(input, "allow", "empty_trigger_text");
      return {
        alreadyExisted: false,
        moderationCaseId,
        decision: "allow",
        reasonCode: "empty_trigger_text",
        restrictionCreated: false
      };
    }

    const config = loadApiConfig(process.env);
    const threadSnapshot = await this.loadThreadSnapshot(input.chatId, input.assistantId);
    const moderation = await this.openAiModerationClientService.moderateText({
      model: settings?.moderationModelId ?? "omni-moderation-latest",
      text: triggerText,
      ...(input.moderationTimeoutMs !== undefined ? { timeoutMs: input.moderationTimeoutMs } : {})
    });
    const decisionOutcome = decideSafetyModerationOutcome({
      moderation,
      precheck: input.precheck,
      blockScoreThreshold: config.SAFETY_MODERATION_BLOCK_SCORE_THRESHOLD
    });

    const triggerSnapshot: SafetyModerationTriggerSnapshot = {
      triggerKey: input.triggerKey,
      triggerText,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      precheckOutcome: input.precheck
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
        userId: input.userId,
        assistantId: input.assistantId,
        chatId: input.chatId,
        surface: input.surface,
        triggerSnapshot: triggerSnapshot as Prisma.InputJsonValue,
        threadSnapshot: threadSnapshot as Prisma.InputJsonValue,
        scores,
        decision: decisionOutcome.decision,
        reasonCode: decisionOutcome.reasonCode
      }
    });

    let restrictionCreated = false;
    if (decisionOutcome.decision === "block_user") {
      await this.upsertActiveSafetyRestriction({
        userId: input.userId,
        reasonCode: decisionOutcome.reasonCode,
        assistantId: input.assistantId,
        moderationCaseId: moderationCase.id
      });
      restrictionCreated = true;
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: null,
      eventCategory: "safety",
      eventCode: "safety.moderation_case_decided",
      summary: `Safety moderation case decided (${decisionOutcome.decision}) for user ${input.userId}.`,
      outcome: decisionOutcome.decision === "block_user" ? "denied" : "succeeded",
      details: {
        moderationCaseId: moderationCase.id,
        triggerKey: input.triggerKey,
        userId: input.userId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        decision: decisionOutcome.decision,
        reasonCode: decisionOutcome.reasonCode,
        surface: input.surface
      }
    });

    return {
      alreadyExisted: false,
      moderationCaseId: moderationCase.id,
      decision: decisionOutcome.decision,
      reasonCode: decisionOutcome.reasonCode,
      restrictionCreated
    };
  }

  private async persistSkippedCase(
    input: SafetyModerationReviewTriggerInput,
    decision: "allow" | "warn" | "block_user",
    reasonCode: string
  ): Promise<string> {
    const triggerSnapshot: SafetyModerationTriggerSnapshot = {
      triggerKey: input.triggerKey,
      triggerText: input.triggerText.trim(),
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      precheckOutcome: input.precheck
    };
    const moderationCase = await this.prisma.moderationCase.create({
      data: {
        userId: input.userId,
        assistantId: input.assistantId,
        chatId: input.chatId,
        surface: input.surface,
        triggerSnapshot: triggerSnapshot as Prisma.InputJsonValue,
        threadSnapshot: Prisma.JsonNull,
        scores: { skipped: true, reasonCode } as Prisma.InputJsonValue,
        decision,
        reasonCode
      }
    });
    return moderationCase.id;
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
