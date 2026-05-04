import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  RuntimeAutoSkillRoutingState,
  RuntimeSkillRoutingCheckResult,
  RuntimeSkillRoutingContext
} from "@persai/runtime-contract";
import {
  DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES,
  DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX,
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID
} from "./platform-runtime-provider-settings";
import { SkillRetrievalStateService } from "./skill-retrieval-state.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const MAX_RECENT_ROUTING_MESSAGES = 30;
const MAX_RECENT_ROUTING_USER_TURNS = 5;
const SKILL_ROUTING_POLICY_CACHE_TTL_MS = 10_000;

export function createDormantAutoSkillRoutingState(): RuntimeAutoSkillRoutingState {
  return {
    status: "inactive",
    activeSkillId: null,
    activeSkillName: null,
    topicSummary: null,
    confidence: "low",
    checkedAtMessageIndex: 0,
    messageCountSinceCheck: 0,
    backgroundCheckQueuedAtMessageIndex: null
  };
}

@Injectable()
export class AutoSkillRoutingStateService {
  private readonly logger = new Logger(AutoSkillRoutingStateService.name);
  private skillRoutingPolicyCache: {
    expiresAt: number;
    initialCheckUserMessageIndex: number;
    backgroundRecheckIntervalMessages: number;
  } | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly skillRetrievalStateService: SkillRetrievalStateService
  ) {}

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

  async shouldRunBackgroundCheck(context: RuntimeSkillRoutingContext): Promise<boolean> {
    const currentUserMessageIndex = context.currentUserMessageIndex;
    if (currentUserMessageIndex <= 0) {
      return false;
    }
    const policy = await this.readSkillRoutingPolicy();
    const state = context.state;
    if (state === null) {
      return currentUserMessageIndex === policy.initialCheckUserMessageIndex;
    }
    if (currentUserMessageIndex <= state.checkedAtMessageIndex) {
      return false;
    }
    if (
      typeof state.backgroundCheckQueuedAtMessageIndex === "number" &&
      state.backgroundCheckQueuedAtMessageIndex > state.checkedAtMessageIndex
    ) {
      return false;
    }
    return state.messageCountSinceCheck >= policy.backgroundRecheckIntervalMessages;
  }

  createBackgroundCheckContext(context: RuntimeSkillRoutingContext): RuntimeSkillRoutingContext {
    return {
      ...context,
      forceCheck: true
    };
  }

  async markBackgroundCheckQueued(input: {
    chatId: string;
    context: RuntimeSkillRoutingContext;
  }): Promise<void> {
    const queuedAtMessageIndex = input.context.currentUserMessageIndex;
    const nextState =
      input.context.state === null
        ? {
            ...createDormantAutoSkillRoutingState(),
            checkedAtMessageIndex: Math.max(0, queuedAtMessageIndex),
            messageCountSinceCheck: 0,
            backgroundCheckQueuedAtMessageIndex: queuedAtMessageIndex
          }
        : {
            ...input.context.state,
            checkedAtMessageIndex: Math.max(
              queuedAtMessageIndex,
              input.context.state.checkedAtMessageIndex
            ),
            messageCountSinceCheck: 0,
            backgroundCheckQueuedAtMessageIndex: Math.max(
              queuedAtMessageIndex,
              input.context.state.backgroundCheckQueuedAtMessageIndex ?? 0
            )
          };
    const currentChat = await this.prisma.assistantChat.findUnique({
      where: { id: input.chatId },
      select: { autoSkillRoutingState: true }
    });
    const currentState = this.normalizeState(currentChat?.autoSkillRoutingState);
    if (!this.shouldPersistAutoSkillRoutingState(currentState, nextState)) {
      return;
    }
    await this.prisma.assistantChat.update({
      where: { id: input.chatId },
      data: {
        autoSkillRoutingState: nextState as unknown as Prisma.InputJsonValue
      }
    });
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
    const currentChat = await this.prisma.assistantChat.findUnique({
      where: { id: input.chatId },
      select: { autoSkillRoutingState: true }
    });
    const currentState = this.normalizeState(currentChat?.autoSkillRoutingState);
    if (!this.shouldPersistAutoSkillRoutingState(currentState, state)) {
      return;
    }
    await this.prisma.assistantChat.update({
      where: { id: input.chatId },
      data: {
        autoSkillRoutingState:
          state === null
            ? Prisma.DbNull
            : ({
                ...state,
                backgroundCheckQueuedAtMessageIndex: null
              } as unknown as Prisma.InputJsonValue)
      }
    });
    await this.skillRetrievalStateService.clearForChatWhenSkillMismatches({
      chatId: input.chatId,
      activeSkillId: state?.status === "active" ? state.activeSkillId : null
    });
  }

  private shouldPersistAutoSkillRoutingState(
    currentState: RuntimeAutoSkillRoutingState | null | undefined,
    nextState: RuntimeAutoSkillRoutingState | null
  ): boolean {
    if (currentState === undefined || currentState === null) {
      return true;
    }
    if (nextState === null) {
      return false;
    }
    if (nextState.checkedAtMessageIndex > currentState.checkedAtMessageIndex) {
      return true;
    }
    if (nextState.checkedAtMessageIndex < currentState.checkedAtMessageIndex) {
      return false;
    }
    if (currentState.status === "inactive" && nextState.status === "active") {
      return false;
    }
    if (currentState.status === "active" && nextState.status === "inactive") {
      return true;
    }
    return true;
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
      messageCountSinceCheck,
      backgroundCheckQueuedAtMessageIndex:
        typeof row.backgroundCheckQueuedAtMessageIndex === "number" &&
        Number.isInteger(row.backgroundCheckQueuedAtMessageIndex)
          ? row.backgroundCheckQueuedAtMessageIndex
          : null
    };
  }

  private async readSkillRoutingPolicy(): Promise<{
    initialCheckUserMessageIndex: number;
    backgroundRecheckIntervalMessages: number;
  }> {
    const now = Date.now();
    if (this.skillRoutingPolicyCache !== null && this.skillRoutingPolicyCache.expiresAt > now) {
      return this.skillRoutingPolicyCache;
    }
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { routerPolicy: true }
    });
    const routerPolicy =
      row?.routerPolicy !== null &&
      row?.routerPolicy !== undefined &&
      typeof row.routerPolicy === "object" &&
      !Array.isArray(row.routerPolicy)
        ? (row.routerPolicy as Record<string, unknown>)
        : null;
    const skillRoutingPolicy =
      routerPolicy?.skillRoutingPolicy !== null &&
      routerPolicy?.skillRoutingPolicy !== undefined &&
      typeof routerPolicy.skillRoutingPolicy === "object" &&
      !Array.isArray(routerPolicy.skillRoutingPolicy)
        ? (routerPolicy.skillRoutingPolicy as Record<string, unknown>)
        : null;
    const policy = {
      expiresAt: now + SKILL_ROUTING_POLICY_CACHE_TTL_MS,
      initialCheckUserMessageIndex:
        typeof skillRoutingPolicy?.initialCheckUserMessageIndex === "number" &&
        Number.isInteger(skillRoutingPolicy.initialCheckUserMessageIndex)
          ? skillRoutingPolicy.initialCheckUserMessageIndex
          : DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX,
      backgroundRecheckIntervalMessages:
        typeof skillRoutingPolicy?.backgroundRecheckIntervalMessages === "number" &&
        Number.isInteger(skillRoutingPolicy.backgroundRecheckIntervalMessages)
          ? skillRoutingPolicy.backgroundRecheckIntervalMessages
          : DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES
    };
    this.skillRoutingPolicyCache = policy;
    return policy;
  }
}
