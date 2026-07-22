import { Injectable } from "@nestjs/common";
import type { RuntimeSession } from "@prisma/client";
import type {
  PersaiRuntimeTier,
  RuntimeSessionResolveInput,
  RuntimeSessionSummary
} from "@persai/runtime-contract";
import { RuntimeStateRedisService } from "../runtime-state/infrastructure/coordination/runtime-state-redis.service";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { RuntimeStateKeyspaceService } from "../runtime-state/runtime-state-keyspace.service";

export interface ResolvedRuntimeSession {
  conversationKey: string;
  found: boolean;
  session: RuntimeSessionSummary | null;
}

export interface EnsureRuntimeSessionInput extends RuntimeSessionResolveInput {
  currentPublishedVersionId?: string | null;
  currentBundleHash?: string | null;
  currentTokens?: number | null;
  totalTokensFresh?: boolean;
  compactionCount?: number;
  compactionHintTokens?: number | null;
  priorToolMicroClearActive?: boolean;
  priorToolMicroClearNextArmPercent?: number;
  priorToolMicroClearPendingEval?: boolean;
  priorToolMicroClearLastArmPercent?: number | null;
  memoryExtractionWatermark?: number;
  providerKey?: string | null;
  modelKey?: string | null;
  lastTurnAt?: Date | null;
  closedAt?: Date | null;
}

export interface EnsuredRuntimeSession {
  conversationKey: string;
  created: boolean;
  session: RuntimeSessionSummary;
}

export interface UpdateRuntimeSessionSummaryInput {
  sessionId: string;
  currentPublishedVersionId?: string | null;
  currentBundleHash?: string | null;
  currentTokens?: number | null;
  totalTokensFresh?: boolean;
  compactionCount?: number;
  compactionHintTokens?: number | null;
  priorToolMicroClearActive?: boolean;
  priorToolMicroClearNextArmPercent?: number;
  priorToolMicroClearPendingEval?: boolean;
  priorToolMicroClearLastArmPercent?: number | null;
  memoryExtractionWatermark?: number;
  providerKey?: string | null;
  modelKey?: string | null;
  lastTurnAt?: Date | null;
  closedAt?: Date | null;
}

@Injectable()
export class SessionStoreService {
  constructor(
    private readonly runtimeStateKeyspaceService: RuntimeStateKeyspaceService,
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService,
    private readonly runtimeStateRedisService: RuntimeStateRedisService
  ) {}

  async resolveSession(input: RuntimeSessionResolveInput): Promise<ResolvedRuntimeSession> {
    const conversationKey = this.runtimeStateKeyspaceService.createConversationKey(
      input.conversation
    );
    const pointerSession = await this.resolveFromConversationPointer(
      input.conversation,
      conversationKey,
      input.runtimeTier
    );
    if (pointerSession) {
      return {
        conversationKey,
        found: true,
        session: this.toSessionSummary(pointerSession)
      };
    }

    const persistedSession =
      await this.runtimeStatePostgresService.findSessionByConversationKey(conversationKey);
    if (!this.isCompatibleSession(persistedSession, input.runtimeTier)) {
      return {
        conversationKey,
        found: false,
        session: null
      };
    }

    await this.trySetConversationPointer(input.conversation, persistedSession.id);

    return {
      conversationKey,
      found: true,
      session: this.toSessionSummary(persistedSession)
    };
  }

  async ensureSession(input: EnsureRuntimeSessionInput): Promise<EnsuredRuntimeSession> {
    const resolved = await this.resolveSession(input);
    if (resolved.session !== null && !this.hasSessionUpdateFields(input)) {
      return {
        conversationKey: resolved.conversationKey,
        created: false,
        session: resolved.session
      };
    }

    const persistedSession = await this.runtimeStatePostgresService.upsertSession({
      conversationKey: resolved.conversationKey,
      conversation: input.conversation,
      runtimeTier: input.runtimeTier,
      ...(input.currentPublishedVersionId !== undefined
        ? { currentPublishedVersionId: input.currentPublishedVersionId }
        : {}),
      ...(input.currentBundleHash !== undefined
        ? { currentBundleHash: input.currentBundleHash }
        : {}),
      ...(input.currentTokens !== undefined ? { currentTokens: input.currentTokens } : {}),
      ...(input.totalTokensFresh !== undefined ? { totalTokensFresh: input.totalTokensFresh } : {}),
      ...(input.compactionCount !== undefined ? { compactionCount: input.compactionCount } : {}),
      ...(input.compactionHintTokens !== undefined
        ? { compactionHintTokens: input.compactionHintTokens }
        : {}),
      ...(input.priorToolMicroClearActive !== undefined
        ? { priorToolMicroClearActive: input.priorToolMicroClearActive }
        : {}),
      ...(input.priorToolMicroClearNextArmPercent !== undefined
        ? { priorToolMicroClearNextArmPercent: input.priorToolMicroClearNextArmPercent }
        : {}),
      ...(input.priorToolMicroClearPendingEval !== undefined
        ? { priorToolMicroClearPendingEval: input.priorToolMicroClearPendingEval }
        : {}),
      ...(input.priorToolMicroClearLastArmPercent !== undefined
        ? { priorToolMicroClearLastArmPercent: input.priorToolMicroClearLastArmPercent }
        : {}),
      ...(input.memoryExtractionWatermark !== undefined
        ? { memoryExtractionWatermark: input.memoryExtractionWatermark }
        : {}),
      ...(input.providerKey !== undefined ? { providerKey: input.providerKey } : {}),
      ...(input.modelKey !== undefined ? { modelKey: input.modelKey } : {}),
      ...(input.lastTurnAt !== undefined ? { lastTurnAt: input.lastTurnAt } : {}),
      ...(input.closedAt !== undefined ? { closedAt: input.closedAt } : { closedAt: null })
    });

    await this.trySetConversationPointer(input.conversation, persistedSession.id);

    return {
      conversationKey: resolved.conversationKey,
      created: resolved.session === null,
      session: this.toSessionSummary(persistedSession)
    };
  }

  async updateSessionSummary(
    input: UpdateRuntimeSessionSummaryInput
  ): Promise<RuntimeSessionSummary> {
    const persistedSession = await this.runtimeStatePostgresService.updateSession({
      sessionId: input.sessionId,
      ...(input.currentPublishedVersionId !== undefined
        ? { currentPublishedVersionId: input.currentPublishedVersionId }
        : {}),
      ...(input.currentBundleHash !== undefined
        ? { currentBundleHash: input.currentBundleHash }
        : {}),
      ...(input.currentTokens !== undefined ? { currentTokens: input.currentTokens } : {}),
      ...(input.totalTokensFresh !== undefined ? { totalTokensFresh: input.totalTokensFresh } : {}),
      ...(input.compactionCount !== undefined ? { compactionCount: input.compactionCount } : {}),
      ...(input.compactionHintTokens !== undefined
        ? { compactionHintTokens: input.compactionHintTokens }
        : {}),
      ...(input.priorToolMicroClearActive !== undefined
        ? { priorToolMicroClearActive: input.priorToolMicroClearActive }
        : {}),
      ...(input.priorToolMicroClearNextArmPercent !== undefined
        ? { priorToolMicroClearNextArmPercent: input.priorToolMicroClearNextArmPercent }
        : {}),
      ...(input.priorToolMicroClearPendingEval !== undefined
        ? { priorToolMicroClearPendingEval: input.priorToolMicroClearPendingEval }
        : {}),
      ...(input.priorToolMicroClearLastArmPercent !== undefined
        ? { priorToolMicroClearLastArmPercent: input.priorToolMicroClearLastArmPercent }
        : {}),
      ...(input.memoryExtractionWatermark !== undefined
        ? { memoryExtractionWatermark: input.memoryExtractionWatermark }
        : {}),
      ...(input.providerKey !== undefined ? { providerKey: input.providerKey } : {}),
      ...(input.modelKey !== undefined ? { modelKey: input.modelKey } : {}),
      ...(input.lastTurnAt !== undefined ? { lastTurnAt: input.lastTurnAt } : {}),
      ...(input.closedAt !== undefined ? { closedAt: input.closedAt } : {})
    });

    return this.toSessionSummary(persistedSession);
  }

  private async resolveFromConversationPointer(
    conversation: RuntimeSessionResolveInput["conversation"],
    conversationKey: string,
    runtimeTier: PersaiRuntimeTier
  ): Promise<RuntimeSession | null> {
    const pointedSessionId = await this.tryReadConversationPointer(conversation);
    if (pointedSessionId === null) {
      return null;
    }

    const pointedSession = await this.runtimeStatePostgresService.findSessionById(pointedSessionId);
    if (
      pointedSession === null ||
      pointedSession.conversationKey !== conversationKey ||
      !this.isCompatibleSession(pointedSession, runtimeTier)
    ) {
      await this.tryClearConversationPointer(conversation);
      return null;
    }

    await this.trySetConversationPointer(conversation, pointedSession.id);
    return pointedSession;
  }

  private isCompatibleSession(
    session: RuntimeSession | null,
    runtimeTier: PersaiRuntimeTier
  ): session is RuntimeSession {
    if (session === null) {
      return false;
    }

    return session.closedAt === null && session.runtimeTier === runtimeTier;
  }

  private hasSessionUpdateFields(input: EnsureRuntimeSessionInput): boolean {
    return (
      input.currentPublishedVersionId !== undefined ||
      input.currentBundleHash !== undefined ||
      input.currentTokens !== undefined ||
      input.totalTokensFresh !== undefined ||
      input.compactionCount !== undefined ||
      input.compactionHintTokens !== undefined ||
      input.priorToolMicroClearActive !== undefined ||
      input.priorToolMicroClearNextArmPercent !== undefined ||
      input.priorToolMicroClearPendingEval !== undefined ||
      input.priorToolMicroClearLastArmPercent !== undefined ||
      input.memoryExtractionWatermark !== undefined ||
      input.providerKey !== undefined ||
      input.modelKey !== undefined ||
      input.lastTurnAt !== undefined ||
      input.closedAt !== undefined
    );
  }

  private toSessionSummary(session: RuntimeSession): RuntimeSessionSummary {
    return {
      sessionId: session.id,
      conversation: {
        assistantId: session.assistantId,
        workspaceId: session.workspaceId,
        channel: session.channel,
        externalThreadKey: session.externalThreadKey,
        externalUserKey: session.externalUserKey,
        mode: session.mode
      },
      currentTokens: session.currentTokens,
      totalTokensFresh: session.totalTokensFresh,
      compactionCount: session.compactionCount,
      compactionHintTokens: session.compactionHintTokens,
      priorToolMicroClearActive: session.priorToolMicroClearActive === true,
      priorToolMicroClearNextArmPercent:
        typeof session.priorToolMicroClearNextArmPercent === "number"
          ? session.priorToolMicroClearNextArmPercent
          : 50,
      priorToolMicroClearPendingEval: session.priorToolMicroClearPendingEval === true,
      priorToolMicroClearLastArmPercent:
        typeof session.priorToolMicroClearLastArmPercent === "number"
          ? session.priorToolMicroClearLastArmPercent
          : null,
      providerKey: session.providerKey,
      modelKey: session.modelKey,
      updatedAt: session.updatedAt.toISOString()
    };
  }

  private async tryReadConversationPointer(
    conversation: RuntimeSessionResolveInput["conversation"]
  ): Promise<string | null> {
    try {
      return await this.runtimeStateRedisService.getConversationSessionPointer(conversation);
    } catch {
      return null;
    }
  }

  private async trySetConversationPointer(
    conversation: RuntimeSessionResolveInput["conversation"],
    sessionId: string
  ): Promise<void> {
    try {
      await this.runtimeStateRedisService.setConversationSessionPointer(conversation, sessionId);
    } catch {
      // Postgres remains the durable session summary truth.
    }
  }

  private async tryClearConversationPointer(
    conversation: RuntimeSessionResolveInput["conversation"]
  ): Promise<void> {
    try {
      await this.runtimeStateRedisService.clearConversationSessionPointer(conversation);
    } catch {
      // A stale pointer can still be healed from the durable Postgres row later.
    }
  }
}
