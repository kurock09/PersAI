import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  RuntimeSkillDecisionState,
  RuntimeSkillStateCheckResult,
  RuntimeSkillStateContext
} from "@persai/runtime-contract";
import { SkillRetrievalStateService } from "./skill-retrieval-state.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const MAX_RECENT_ROUTING_MESSAGES = 30;
const MAX_RECENT_ROUTING_USER_TURNS = 5;

export function createInactiveSkillDecisionState(input?: {
  topicSummary?: string | null;
}): RuntimeSkillDecisionState {
  return {
    status: "inactive",
    activeSkillId: null,
    activeSkillName: null,
    activeScenarioKey: null,
    topicSummary: input?.topicSummary ?? null
  };
}

@Injectable()
export class AutoSkillRoutingStateService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly skillRetrievalStateService: SkillRetrievalStateService
  ) {}

  async buildRuntimeContext(input: {
    chatId: string;
    currentUserMessageId: string;
    decisionState: RuntimeSkillDecisionState | null;
  }): Promise<RuntimeSkillStateContext> {
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
      decision: input.decisionState,
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

  extractDecisionStateFromTurnRouting(input: {
    turnRouting:
      | {
          skillState?: RuntimeSkillDecisionState | null;
        }
      | null
      | undefined;
  }): RuntimeSkillDecisionState | null | undefined {
    return this.normalizeDecisionState(input.turnRouting?.skillState);
  }

  async persistFromTurnRouting(input: {
    chatId: string;
    turnRouting:
      | {
          skillState?: RuntimeSkillDecisionState | null;
        }
      | null
      | undefined;
  }): Promise<{
    skillDecisionState: RuntimeSkillDecisionState | null;
  }> {
    const current = await this.readChatSkillState(input.chatId);
    const nextDecision = this.extractDecisionStateFromTurnRouting({
      turnRouting: input.turnRouting
    });
    if (nextDecision === undefined) {
      return current;
    }
    await this.persistDecisionIfChanged({
      chatId: input.chatId,
      currentDecision: current.skillDecisionState,
      nextDecision
    });
    return { skillDecisionState: nextDecision };
  }

  async persistFromSkillCheckResult(input: {
    chatId: string;
    result: RuntimeSkillStateCheckResult;
  }): Promise<void> {
    const nextDecision = this.normalizeDecisionState(input.result.skillState) ?? null;
    const current = await this.readChatSkillState(input.chatId);
    await this.persistDecisionIfChanged({
      chatId: input.chatId,
      currentDecision: current.skillDecisionState,
      nextDecision
    });
  }

  private async persistDecisionIfChanged(input: {
    chatId: string;
    currentDecision: RuntimeSkillDecisionState | null;
    nextDecision: RuntimeSkillDecisionState | null;
  }): Promise<void> {
    if (!this.shouldPersistSkillDecisionState(input.currentDecision, input.nextDecision)) {
      return;
    }
    await this.persistState({
      chatId: input.chatId,
      skillDecisionState: input.nextDecision
    });
    await this.skillRetrievalStateService.clearForChatWhenSkillMismatches({
      chatId: input.chatId,
      activeSkillId:
        input.nextDecision?.status === "active" ? input.nextDecision.activeSkillId : null
    });
  }

  private shouldPersistSkillDecisionState(
    currentState: RuntimeSkillDecisionState | null | undefined,
    nextState: RuntimeSkillDecisionState | null
  ): boolean {
    if (currentState === undefined || currentState === null) {
      return nextState !== null;
    }
    if (nextState === null) {
      return true;
    }
    return (
      currentState.status !== nextState.status ||
      currentState.activeSkillId !== nextState.activeSkillId ||
      currentState.activeSkillName !== nextState.activeSkillName ||
      currentState.activeScenarioKey !== nextState.activeScenarioKey ||
      currentState.topicSummary !== nextState.topicSummary
    );
  }

  private async readChatSkillState(chatId: string): Promise<{
    skillDecisionState: RuntimeSkillDecisionState | null;
  }> {
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: {
        skillDecisionState: true
      }
    });
    return {
      skillDecisionState: this.normalizeDecisionState(chat?.skillDecisionState) ?? null
    };
  }

  private async persistState(input: {
    chatId: string;
    skillDecisionState: RuntimeSkillDecisionState | null;
  }): Promise<void> {
    await this.prisma.assistantChat.update({
      where: { id: input.chatId },
      data: {
        skillDecisionState:
          input.skillDecisionState === null
            ? Prisma.DbNull
            : (input.skillDecisionState as unknown as Prisma.InputJsonValue)
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

  private normalizeDecisionState(value: unknown): RuntimeSkillDecisionState | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const status = row.status === "active" || row.status === "inactive" ? row.status : null;
    if (status === null) {
      return null;
    }
    return {
      status,
      activeSkillId:
        status === "active" && typeof row.activeSkillId === "string" ? row.activeSkillId : null,
      activeSkillName:
        status === "active" && typeof row.activeSkillName === "string" ? row.activeSkillName : null,
      activeScenarioKey:
        status === "active" && typeof row.activeScenarioKey === "string"
          ? row.activeScenarioKey
          : null,
      topicSummary: typeof row.topicSummary === "string" ? row.topicSummary : null
    };
  }
}
