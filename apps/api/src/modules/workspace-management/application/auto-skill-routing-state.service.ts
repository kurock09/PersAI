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
    activeScenarioDisplayName: null,
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

  /**
   * ADR-118: read-only path used by post-turn flows.
   *
   * The runtime-side `turnRouting.skillState` is always a snapshot of the input state at turn start
   * (see TurnRoutingService — it never produces a new decision; it only echoes back
   * `request.skillStateContext.decision`). Writing it back here would overwrite any state that
   * `RuntimeSkillToolService` persisted in the same turn via `persistDecisionState`.
   *
   * Therefore this method does NOT write. It reads through to whatever the tool wrote (or to the
   * untouched current state when no tool ran) and returns it for the engagement summary.
   */
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
    return await this.readChatSkillState(input.chatId);
  }

  /**
   * ADR-118: the single authoritative write path for skill decision state.
   * Called by `InternalRuntimeSkillStateService` when the model invokes the `skill` tool.
   * Persists the new state and clears mismatching retrieval cache in one logical step.
   */
  async persistDecisionState(input: {
    chatId: string;
    nextState: RuntimeSkillDecisionState | null;
  }): Promise<{ skillDecisionState: RuntimeSkillDecisionState | null }> {
    await this.persistState({
      chatId: input.chatId,
      skillDecisionState: input.nextState
    });
    await this.skillRetrievalStateService.clearForChatWhenSkillMismatches({
      chatId: input.chatId,
      activeSkillId:
        input.nextState !== null && input.nextState.status === "active"
          ? input.nextState.activeSkillId
          : null
    });
    return { skillDecisionState: input.nextState };
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
      activeScenarioDisplayName:
        status === "active" && typeof row.activeScenarioDisplayName === "string"
          ? row.activeScenarioDisplayName
          : null,
      topicSummary: typeof row.topicSummary === "string" ? row.topicSummary : null
    };
  }
}
