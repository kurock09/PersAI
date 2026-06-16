import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RuntimeSkillDecisionState, RuntimeSkillStateContext } from "@persai/runtime-contract";
import { SkillRetrievalStateService } from "./skill-retrieval-state.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

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

  buildRuntimeContext(input: {
    chatId: string;
    currentUserMessageId: string;
    decisionState: RuntimeSkillDecisionState | null;
  }): RuntimeSkillStateContext {
    return { decision: input.decisionState };
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
