import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  RuntimeSkillCadenceState,
  RuntimeSkillDecisionState,
  RuntimeSkillStateCheckResult,
  RuntimeSkillStateContext
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

export function createInactiveSkillDecisionState(input?: {
  checkedAtMessageIndex?: number;
  confidence?: RuntimeSkillDecisionState["confidence"];
  topicSummary?: string | null;
}): RuntimeSkillDecisionState {
  return {
    status: "inactive",
    activeSkillId: null,
    activeSkillName: null,
    topicSummary: input?.topicSummary ?? null,
    confidence: input?.confidence ?? "low",
    checkedAtMessageIndex: input?.checkedAtMessageIndex ?? 0
  };
}

export function createSkillCadenceState(input?: {
  messageCountSinceCheck?: number;
  backgroundCheckQueuedAtMessageIndex?: number | null;
  needsBootstrap?: boolean;
  bootstrapReason?: RuntimeSkillCadenceState["bootstrapReason"];
}): RuntimeSkillCadenceState {
  return {
    messageCountSinceCheck: input?.messageCountSinceCheck ?? 0,
    backgroundCheckQueuedAtMessageIndex: input?.backgroundCheckQueuedAtMessageIndex ?? null,
    needsBootstrap: input?.needsBootstrap ?? false,
    bootstrapReason: input?.bootstrapReason ?? null
  };
}

export function createNewChatSkillCadenceState(): RuntimeSkillCadenceState {
  return createSkillCadenceState({
    needsBootstrap: true,
    bootstrapReason: "new_chat"
  });
}

export function createEnabledSkillBootstrapCadenceState(): RuntimeSkillCadenceState {
  return createSkillCadenceState({
    needsBootstrap: true,
    bootstrapReason: "skills_enabled_after_chat_started"
  });
}

export function createMigrationRepairSkillCadenceState(): RuntimeSkillCadenceState {
  return createSkillCadenceState({
    needsBootstrap: true,
    bootstrapReason: "migration_repair"
  });
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
    decisionState: RuntimeSkillDecisionState | null;
    cadenceState: RuntimeSkillCadenceState | null;
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
      cadence: input.cadenceState,
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

  async shouldRunBackgroundCheck(context: RuntimeSkillStateContext): Promise<boolean> {
    const currentUserMessageIndex = context.currentUserMessageIndex;
    if (currentUserMessageIndex <= 0) {
      return false;
    }
    const policy = await this.readSkillRoutingPolicy();
    const decision = context.decision;
    const cadence =
      context.cadence ??
      (decision === null ? createMigrationRepairSkillCadenceState() : createSkillCadenceState());
    const checkedAtMessageIndex = decision?.checkedAtMessageIndex ?? 0;
    if (
      typeof cadence.backgroundCheckQueuedAtMessageIndex === "number" &&
      cadence.backgroundCheckQueuedAtMessageIndex > checkedAtMessageIndex
    ) {
      return false;
    }
    if (cadence.needsBootstrap) {
      if (cadence.bootstrapReason === "new_chat") {
        return currentUserMessageIndex >= policy.initialCheckUserMessageIndex;
      }
      return currentUserMessageIndex >= 1;
    }
    if (currentUserMessageIndex <= checkedAtMessageIndex) {
      return false;
    }
    return cadence.messageCountSinceCheck >= policy.backgroundRecheckIntervalMessages;
  }

  createBackgroundCheckContext(context: RuntimeSkillStateContext): RuntimeSkillStateContext {
    return {
      ...context,
      forceCheck: true,
      checkReason:
        context.cadence?.needsBootstrap === true ? "background_bootstrap" : "background_cadence"
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

  async markBackgroundCheckQueued(input: {
    chatId: string;
    context: RuntimeSkillStateContext;
  }): Promise<void> {
    const chat = await this.readChatSkillState(input.chatId);
    const currentDecision = chat.skillDecisionState ?? input.context.decision ?? null;
    const currentCadence =
      chat.skillCadenceState ??
      input.context.cadence ??
      (currentDecision === null
        ? createMigrationRepairSkillCadenceState()
        : createSkillCadenceState());
    const queuedAtMessageIndex = input.context.currentUserMessageIndex;
    if (queuedAtMessageIndex < (currentDecision?.checkedAtMessageIndex ?? 0)) {
      return;
    }
    const nextCadence: RuntimeSkillCadenceState = {
      ...(currentCadence ?? createMigrationRepairSkillCadenceState()),
      messageCountSinceCheck: 0,
      backgroundCheckQueuedAtMessageIndex: Math.max(
        queuedAtMessageIndex,
        currentCadence?.backgroundCheckQueuedAtMessageIndex ?? 0
      )
    };
    await this.persistState({
      chatId: input.chatId,
      skillDecisionState: currentDecision,
      skillCadenceState: nextCadence
    });
  }

  runBackgroundCheck(input: {
    chatId: string;
    execute: () => Promise<RuntimeSkillStateCheckResult>;
  }): void {
    void input
      .execute()
      .then((result) =>
        this.persistFromSkillCheckResult({
          chatId: input.chatId,
          result
        })
      )
      .catch(async (error: unknown) => {
        this.logger.warn(
          `Background Skill routing check failed for chat ${input.chatId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        await this.markBackgroundCheckFailed(input.chatId);
      });
  }

  async persistFromTurnRouting(input: {
    chatId: string;
    currentUserMessageIndex: number;
    turnRouting:
      | {
          skillState?: RuntimeSkillDecisionState | null;
        }
      | null
      | undefined;
  }): Promise<{
    skillDecisionState: RuntimeSkillDecisionState | null;
    skillCadenceState: RuntimeSkillCadenceState | null;
  }> {
    const current = await this.readChatSkillState(input.chatId);
    const nextDecision = this.extractDecisionStateFromTurnRouting({
      turnRouting: input.turnRouting
    });
    const carriesForwardStaleDecision =
      nextDecision !== undefined &&
      nextDecision !== null &&
      nextDecision.checkedAtMessageIndex < input.currentUserMessageIndex;
    if (nextDecision !== undefined) {
      if (carriesForwardStaleDecision) {
        return this.persistFromTurnRouting({
          chatId: input.chatId,
          currentUserMessageIndex: input.currentUserMessageIndex,
          turnRouting: {}
        });
      }
      const normalizedDecision = nextDecision === null ? null : nextDecision;
      const nextCadence =
        normalizedDecision === null
          ? current.skillCadenceState
          : createSkillCadenceState({
              messageCountSinceCheck: 0,
              needsBootstrap: false
            });
      await this.persistDecisionAndCadence({
        chatId: input.chatId,
        currentDecision: current.skillDecisionState,
        nextDecision: normalizedDecision,
        skillCadenceState: nextCadence
      });
      return {
        skillDecisionState: normalizedDecision,
        skillCadenceState: nextCadence
      };
    }

    const currentCadence =
      current.skillCadenceState ??
      (current.skillDecisionState === null ? createMigrationRepairSkillCadenceState() : null);
    if (currentCadence === null) {
      return current;
    }
    const nextCadence =
      currentCadence.needsBootstrap === true
        ? {
            ...currentCadence,
            backgroundCheckQueuedAtMessageIndex: null
          }
        : {
            ...currentCadence,
            messageCountSinceCheck: Math.max(0, currentCadence.messageCountSinceCheck + 1),
            backgroundCheckQueuedAtMessageIndex: null
          };
    await this.persistState({
      chatId: input.chatId,
      skillDecisionState: current.skillDecisionState,
      skillCadenceState: nextCadence
    });
    return {
      skillDecisionState: current.skillDecisionState,
      skillCadenceState: nextCadence
    };
  }

  async persistFromSkillCheckResult(input: {
    chatId: string;
    result: RuntimeSkillStateCheckResult;
  }): Promise<void> {
    const nextDecision = this.normalizeDecisionState(input.result.skillState) ?? null;
    const nextCadence =
      nextDecision === null
        ? null
        : createSkillCadenceState({
            messageCountSinceCheck: 0,
            needsBootstrap: false
          });
    const current = await this.readChatSkillState(input.chatId);
    await this.persistDecisionAndCadence({
      chatId: input.chatId,
      currentDecision: current.skillDecisionState,
      nextDecision,
      skillCadenceState: nextCadence
    });
  }

  private async persistDecisionAndCadence(input: {
    chatId: string;
    currentDecision: RuntimeSkillDecisionState | null;
    nextDecision: RuntimeSkillDecisionState | null;
    skillCadenceState: RuntimeSkillCadenceState | null;
  }): Promise<void> {
    if (!this.shouldPersistSkillDecisionState(input.currentDecision, input.nextDecision)) {
      return;
    }
    await this.persistState({
      chatId: input.chatId,
      skillDecisionState: input.nextDecision,
      skillCadenceState: input.skillCadenceState
    });
    await this.skillRetrievalStateService.clearForChatWhenSkillMismatches({
      chatId: input.chatId,
      activeSkillId:
        input.nextDecision?.status === "active" ? input.nextDecision.activeSkillId : null
    });
  }

  private async markBackgroundCheckFailed(chatId: string): Promise<void> {
    const current = await this.readChatSkillState(chatId);
    if (current.skillCadenceState === null) {
      return;
    }
    const policy = await this.readSkillRoutingPolicy();
    const nextCadence: RuntimeSkillCadenceState = {
      ...current.skillCadenceState,
      backgroundCheckQueuedAtMessageIndex: null,
      messageCountSinceCheck:
        current.skillCadenceState.needsBootstrap === true
          ? current.skillCadenceState.messageCountSinceCheck
          : policy.backgroundRecheckIntervalMessages
    };
    await this.persistState({
      chatId,
      skillDecisionState: current.skillDecisionState,
      skillCadenceState: nextCadence
    });
  }

  private shouldPersistSkillDecisionState(
    currentState: RuntimeSkillDecisionState | null | undefined,
    nextState: RuntimeSkillDecisionState | null
  ): boolean {
    if (currentState === undefined || currentState === null) {
      return true;
    }
    if (nextState === null) {
      return true;
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
    return true;
  }

  private async readChatSkillState(chatId: string): Promise<{
    skillDecisionState: RuntimeSkillDecisionState | null;
    skillCadenceState: RuntimeSkillCadenceState | null;
  }> {
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: {
        skillDecisionState: true,
        skillCadenceState: true
      }
    });
    return {
      skillDecisionState: this.normalizeDecisionState(chat?.skillDecisionState) ?? null,
      skillCadenceState: this.normalizeCadenceState(chat?.skillCadenceState) ?? null
    };
  }

  private async persistState(input: {
    chatId: string;
    skillDecisionState: RuntimeSkillDecisionState | null;
    skillCadenceState: RuntimeSkillCadenceState | null;
  }): Promise<void> {
    await this.prisma.assistantChat.update({
      where: { id: input.chatId },
      data: {
        skillDecisionState:
          input.skillDecisionState === null
            ? Prisma.DbNull
            : (input.skillDecisionState as unknown as Prisma.InputJsonValue),
        skillCadenceState:
          input.skillCadenceState === null
            ? Prisma.DbNull
            : (input.skillCadenceState as unknown as Prisma.InputJsonValue)
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
    const confidence =
      row.confidence === "high" || row.confidence === "medium" || row.confidence === "low"
        ? row.confidence
        : null;
    const checkedAtMessageIndex =
      typeof row.checkedAtMessageIndex === "number" && Number.isInteger(row.checkedAtMessageIndex)
        ? row.checkedAtMessageIndex
        : null;
    if (status === null || confidence === null || checkedAtMessageIndex === null) {
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
      checkedAtMessageIndex
    };
  }

  private normalizeCadenceState(value: unknown): RuntimeSkillCadenceState | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const messageCountSinceCheck =
      typeof row.messageCountSinceCheck === "number" && Number.isInteger(row.messageCountSinceCheck)
        ? row.messageCountSinceCheck
        : null;
    const needsBootstrap = typeof row.needsBootstrap === "boolean" ? row.needsBootstrap : null;
    if (messageCountSinceCheck === null || needsBootstrap === null) {
      return null;
    }
    return {
      messageCountSinceCheck,
      backgroundCheckQueuedAtMessageIndex:
        typeof row.backgroundCheckQueuedAtMessageIndex === "number" &&
        Number.isInteger(row.backgroundCheckQueuedAtMessageIndex)
          ? row.backgroundCheckQueuedAtMessageIndex
          : null,
      needsBootstrap,
      bootstrapReason:
        row.bootstrapReason === "new_chat" ||
        row.bootstrapReason === "skills_enabled_after_chat_started" ||
        row.bootstrapReason === "migration_repair"
          ? row.bootstrapReason
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
