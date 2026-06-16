import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import type { RuntimeSkillDecisionState } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { AutoSkillRoutingStateService } from "./auto-skill-routing-state.service";
import type { AssistantChatSurface } from "../domain/assistant-chat.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type SkillStateInput = {
  assistantId: string;
  channel: string;
  surfaceThreadKey: string;
  action: "engage" | "release";
  skillId?: string | null;
  scenarioKey?: string | null;
};

export type SkillStateEngageResult = {
  action: "engaged";
  skillId: string;
  skillDisplayName: string;
  scenarioKey: string | null;
  scenarioDisplayName: string | null;
};

export type SkillStateReleaseResult = {
  action: "released";
  previousSkillId: string | null;
};

export type SkillStateResult = SkillStateEngageResult | SkillStateReleaseResult;

@Injectable()
export class InternalRuntimeSkillStateService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly autoSkillRoutingStateService: AutoSkillRoutingStateService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  async apply(input: SkillStateInput): Promise<SkillStateResult> {
    const surface = this.resolveChannel(input.channel);
    if (surface === null) {
      throw new BadRequestException(`Unsupported channel: ${input.channel}`);
    }

    const chat = await this.assistantChatRepository.findChatBySurfaceThread(
      input.assistantId,
      surface,
      input.surfaceThreadKey
    );
    if (chat === null) {
      throw new NotFoundException(
        `Chat not found for assistant=${input.assistantId} channel=${input.channel} thread=${input.surfaceThreadKey}`
      );
    }
    const chatId = chat.id;

    const currentState = this.autoSkillRoutingStateService.extractDecisionStateFromTurnRouting({
      turnRouting: { skillState: chat.skillDecisionState as RuntimeSkillDecisionState | null }
    }) as RuntimeSkillDecisionState | null;

    if (input.action === "release") {
      const previousSkillId =
        currentState?.status === "active" ? (currentState.activeSkillId ?? null) : null;
      const nextState: RuntimeSkillDecisionState = {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        activeScenarioKey: null,
        activeScenarioDisplayName: null,
        topicSummary: currentState?.topicSummary ?? null
      };
      await this.autoSkillRoutingStateService.persistDecisionState({ chatId, nextState });
      return { action: "released", previousSkillId };
    }

    // engage action
    const skillId = input.skillId?.trim() ?? null;
    if (!skillId) {
      throw new BadRequestException("skillId is required for engage action.");
    }

    // Look up the skill to get display name
    const skill = await this.prisma.skill.findFirst({
      where: { id: skillId },
      select: { id: true, name: true }
    });
    if (skill === null) {
      throw new NotFoundException(`Skill not found: ${skillId}`);
    }

    const skillDisplayName = this.resolveSkillDisplayName(skill.name);

    // Resolve scenario display name when scenarioKey is provided
    const scenarioKey = input.scenarioKey?.trim() || null;
    let activeScenarioDisplayName: string | null = null;
    if (scenarioKey !== null) {
      const scenario = await this.prisma.skillScenario.findFirst({
        where: { skillId, key: scenarioKey },
        select: { displayName: true }
      });
      if (scenario !== null) {
        activeScenarioDisplayName = this.resolveSkillDisplayName(scenario.displayName);
      }
    }

    const nextState: RuntimeSkillDecisionState = {
      status: "active",
      activeSkillId: skillId,
      activeSkillName: skillDisplayName,
      activeScenarioKey: scenarioKey,
      activeScenarioDisplayName,
      topicSummary: currentState?.topicSummary ?? null
    };
    await this.autoSkillRoutingStateService.persistDecisionState({ chatId, nextState });

    return {
      action: "engaged",
      skillId,
      skillDisplayName,
      scenarioKey,
      scenarioDisplayName: activeScenarioDisplayName
    };
  }

  private resolveChannel(channel: string): AssistantChatSurface | null {
    if (channel === "web" || channel === "telegram") {
      return channel;
    }
    return null;
  }

  private resolveSkillDisplayName(name: unknown): string {
    if (typeof name === "string") {
      return name;
    }
    if (name !== null && typeof name === "object" && !Array.isArray(name)) {
      const localized = name as Record<string, unknown>;
      if (typeof localized.ru === "string" && localized.ru.trim().length > 0) {
        return localized.ru;
      }
      if (typeof localized.en === "string" && localized.en.trim().length > 0) {
        return localized.en;
      }
      const first = Object.values(localized).find(
        (value) => typeof value === "string" && (value as string).trim().length > 0
      );
      if (typeof first === "string") {
        return first;
      }
    }
    return "Skill";
  }
}
