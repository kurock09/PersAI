import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  RuntimeAutoSkillRoutingState,
  RuntimeSkillRoutingCheckResult,
  RuntimeSkillRoutingContext
} from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const MAX_RECENT_ROUTING_MESSAGES = 30;
const MAX_RECENT_ROUTING_USER_TURNS = 5;
const INITIAL_BACKGROUND_CHECK_MESSAGE_INDEXES = new Set([3]);
const BACKGROUND_RECHECK_INTERVAL_MESSAGES = 5;

export function createDormantAutoSkillRoutingState(): RuntimeAutoSkillRoutingState {
  return {
    status: "inactive",
    activeSkillId: null,
    activeSkillName: null,
    topicSummary: null,
    confidence: "low",
    checkedAtMessageIndex: 0,
    messageCountSinceCheck: 0
  };
}

@Injectable()
export class AutoSkillRoutingStateService {
  private readonly logger = new Logger(AutoSkillRoutingStateService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async buildRuntimeContext(input: {
    chatId: string;
    currentUserMessageId: string;
    state: RuntimeAutoSkillRoutingState | null;
  }): Promise<RuntimeSkillRoutingContext> {
    const currentMessage = await this.prisma.assistantChatMessage.findUnique({
      where: { id: input.currentUserMessageId },
      select: { createdAt: true }
    });
    const [currentUserMessageIndex, recentRows] = await Promise.all([
      currentMessage === null
        ? Promise.resolve(0)
        : this.prisma.assistantChatMessage.count({
            where: {
              chatId: input.chatId,
              author: "user",
              createdAt: { lte: currentMessage.createdAt }
            }
          }),
      this.prisma.assistantChatMessage.findMany({
        where: {
          chatId: input.chatId,
          author: { in: ["user", "assistant"] }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_RECENT_ROUTING_MESSAGES,
        select: {
          author: true,
          content: true,
          createdAt: true,
          id: true
        }
      })
    ]);

    return {
      state: input.state,
      currentUserMessageIndex,
      recentMessages: this.selectRecentRoutingRows(
        recentRows.sort((left, right) => {
          const byTime = left.createdAt.getTime() - right.createdAt.getTime();
          return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
        })
      ).map((row) => ({
        role: row.author === "assistant" ? ("assistant" as const) : ("user" as const),
        text: row.content
      }))
    };
  }

  shouldRunBackgroundCheck(context: RuntimeSkillRoutingContext): boolean {
    const currentUserMessageIndex = context.currentUserMessageIndex;
    if (currentUserMessageIndex <= 0) {
      return false;
    }
    const state = context.state;
    if (state === null) {
      return INITIAL_BACKGROUND_CHECK_MESSAGE_INDEXES.has(currentUserMessageIndex);
    }
    if (currentUserMessageIndex <= state.checkedAtMessageIndex) {
      return false;
    }
    return state.messageCountSinceCheck >= BACKGROUND_RECHECK_INTERVAL_MESSAGES;
  }

  createBackgroundCheckContext(context: RuntimeSkillRoutingContext): RuntimeSkillRoutingContext {
    return {
      ...context,
      forceCheck: true
    };
  }

  extractStateFromTurnRouting(input: {
    turnRouting:
      | {
          autoSkillState?: RuntimeAutoSkillRoutingState | null;
        }
      | null
      | undefined;
  }): RuntimeAutoSkillRoutingState | null | undefined {
    return this.normalizeState(input.turnRouting?.autoSkillState);
  }

  runBackgroundCheck(input: {
    chatId: string;
    execute: () => Promise<RuntimeSkillRoutingCheckResult>;
  }): void {
    void input
      .execute()
      .then((result) =>
        this.persistFromTurnRouting({
          chatId: input.chatId,
          turnRouting: result.turnRouting
        })
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Background Skill routing check failed for chat ${input.chatId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  }

  async persistFromTurnRouting(input: {
    chatId: string;
    turnRouting:
      | {
          autoSkillState?: RuntimeAutoSkillRoutingState | null;
        }
      | null
      | undefined;
  }): Promise<void> {
    const state = this.extractStateFromTurnRouting({
      turnRouting: input.turnRouting
    });
    if (state === undefined) {
      return;
    }
    await this.prisma.assistantChat.update({
      where: { id: input.chatId },
      data: {
        autoSkillRoutingState:
          state === null ? Prisma.DbNull : (state as unknown as Prisma.InputJsonValue)
      }
    });
  }

  private selectRecentRoutingRows<
    T extends {
      author: string;
    }
  >(rows: T[]): T[] {
    let remainingUserTurns = MAX_RECENT_ROUTING_USER_TURNS;
    let startIndex = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]?.author !== "user") {
        continue;
      }
      remainingUserTurns -= 1;
      startIndex = index;
      if (remainingUserTurns === 0) {
        break;
      }
    }
    return rows.slice(startIndex);
  }

  private normalizeState(value: unknown): RuntimeAutoSkillRoutingState | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const status = row.status === "active" || row.status === "inactive" ? row.status : null;
    const confidence =
      row.confidence === "high" || row.confidence === "medium" || row.confidence === "low"
        ? row.confidence
        : null;
    const checkedAtMessageIndex =
      typeof row.checkedAtMessageIndex === "number" && Number.isInteger(row.checkedAtMessageIndex)
        ? row.checkedAtMessageIndex
        : null;
    const messageCountSinceCheck =
      typeof row.messageCountSinceCheck === "number" && Number.isInteger(row.messageCountSinceCheck)
        ? row.messageCountSinceCheck
        : null;
    if (
      status === null ||
      confidence === null ||
      checkedAtMessageIndex === null ||
      messageCountSinceCheck === null
    ) {
      return null;
    }
    return {
      status,
      activeSkillId:
        status === "active" && typeof row.activeSkillId === "string" ? row.activeSkillId : null,
      activeSkillName:
        status === "active" && typeof row.activeSkillName === "string" ? row.activeSkillName : null,
      topicSummary: typeof row.topicSummary === "string" ? row.topicSummary : null,
      confidence,
      checkedAtMessageIndex,
      messageCountSinceCheck
    };
  }
}
