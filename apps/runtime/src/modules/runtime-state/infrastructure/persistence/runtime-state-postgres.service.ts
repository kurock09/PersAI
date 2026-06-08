import { Injectable } from "@nestjs/common";
import type { PersaiRuntimeTier, RuntimeConversationAddress } from "@persai/runtime-contract";
import { Prisma } from "@prisma/client";
import { RuntimeStatePrismaService } from "./runtime-state-prisma.service";

export interface UpsertRuntimeBundleStateInput {
  assistantId: string;
  workspaceId: string;
  materializedSpecId: string;
  publishedVersionId: string;
  runtimeTier: PersaiRuntimeTier;
  bundleHash: string;
  lastWarmedAt?: Date | null;
  invalidatedAt?: Date | null;
}

export interface UpsertRuntimeSessionInput {
  conversationKey: string;
  conversation: RuntimeConversationAddress;
  runtimeTier: PersaiRuntimeTier;
  currentPublishedVersionId?: string | null;
  currentBundleHash?: string | null;
  currentTokens?: number | null;
  totalTokensFresh?: boolean;
  compactionCount?: number;
  compactionHintTokens?: number | null;
  memoryExtractionWatermark?: number;
  providerKey?: string | null;
  modelKey?: string | null;
  lastTurnAt?: Date | null;
  closedAt?: Date | null;
}

export interface AppendRuntimeSessionCompactionInput {
  runtimeSessionId: string;
  assistantId: string;
  workspaceId: string;
  requestId?: string | null;
  reason?: string | null;
  instructions?: string | null;
  summaryPayload?: unknown;
  tokensBefore?: number | null;
  tokensAfter?: number | null;
}

export interface CreateAcceptedRuntimeTurnReceiptInput {
  runtimeSessionId?: string | null;
  publishedVersionId?: string | null;
  runtimeTier: PersaiRuntimeTier;
  conversationKey: string;
  conversation: RuntimeConversationAddress;
  requestId: string;
  idempotencyKey: string;
  bundleHash?: string | null;
}

export interface UpdateRuntimeSessionInput {
  sessionId: string;
  currentPublishedVersionId?: string | null;
  runtimeTier?: PersaiRuntimeTier;
  currentBundleHash?: string | null;
  currentTokens?: number | null;
  totalTokensFresh?: boolean;
  compactionCount?: number;
  compactionHintTokens?: number | null;
  memoryExtractionWatermark?: number;
  providerKey?: string | null;
  modelKey?: string | null;
  lastTurnAt?: Date | null;
  closedAt?: Date | null;
}

@Injectable()
export class RuntimeStatePostgresService {
  constructor(private readonly prisma: RuntimeStatePrismaService) {}

  upsertBundleState(input: UpsertRuntimeBundleStateInput) {
    const updateData: Prisma.RuntimeBundleStateUncheckedUpdateInput = {
      materializedSpecId: input.materializedSpecId,
      runtimeTier: input.runtimeTier,
      bundleHash: input.bundleHash,
      ...(input.lastWarmedAt !== undefined ? { lastWarmedAt: input.lastWarmedAt } : {}),
      ...(input.invalidatedAt !== undefined ? { invalidatedAt: input.invalidatedAt } : {})
    };

    return this.prisma.runtimeBundleState.upsert({
      where: {
        publishedVersionId: input.publishedVersionId
      },
      create: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        materializedSpecId: input.materializedSpecId,
        publishedVersionId: input.publishedVersionId,
        runtimeTier: input.runtimeTier,
        bundleHash: input.bundleHash,
        lastWarmedAt: input.lastWarmedAt ?? null,
        invalidatedAt: input.invalidatedAt ?? null
      },
      update: updateData
    });
  }

  findBundleStateByPublishedVersionId(publishedVersionId: string) {
    return this.prisma.runtimeBundleState.findUnique({
      where: {
        publishedVersionId
      }
    });
  }

  markBundleStateWarmed(publishedVersionId: string, warmedAt: Date) {
    return this.prisma.runtimeBundleState.update({
      where: {
        publishedVersionId
      },
      data: {
        lastWarmedAt: warmedAt,
        invalidatedAt: null
      }
    });
  }

  invalidateBundleStates(input: {
    assistantId: string;
    publishedVersionId?: string;
    invalidatedAt: Date;
  }) {
    return this.prisma.runtimeBundleState.updateMany({
      where: {
        assistantId: input.assistantId,
        ...(input.publishedVersionId ? { publishedVersionId: input.publishedVersionId } : {})
      },
      data: {
        invalidatedAt: input.invalidatedAt
      }
    });
  }

  upsertSession(input: UpsertRuntimeSessionInput) {
    const updateData: Prisma.RuntimeSessionUncheckedUpdateInput = {
      runtimeTier: input.runtimeTier,
      channel: input.conversation.channel,
      externalThreadKey: input.conversation.externalThreadKey,
      externalUserKey: input.conversation.externalUserKey,
      mode: input.conversation.mode,
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
      ...(input.memoryExtractionWatermark !== undefined
        ? {
            memoryExtractionWatermark: Math.max(0, Math.floor(input.memoryExtractionWatermark))
          }
        : {}),
      ...(input.providerKey !== undefined ? { providerKey: input.providerKey } : {}),
      ...(input.modelKey !== undefined ? { modelKey: input.modelKey } : {}),
      ...(input.lastTurnAt !== undefined ? { lastTurnAt: input.lastTurnAt } : {}),
      ...(input.closedAt !== undefined ? { closedAt: input.closedAt } : {})
    };

    return this.prisma.runtimeSession.upsert({
      where: {
        conversationKey: input.conversationKey
      },
      create: {
        assistantId: input.conversation.assistantId,
        workspaceId: input.conversation.workspaceId,
        currentPublishedVersionId: input.currentPublishedVersionId ?? null,
        runtimeTier: input.runtimeTier,
        conversationKey: input.conversationKey,
        channel: input.conversation.channel,
        externalThreadKey: input.conversation.externalThreadKey,
        externalUserKey: input.conversation.externalUserKey,
        mode: input.conversation.mode,
        currentBundleHash: input.currentBundleHash ?? null,
        currentTokens: input.currentTokens ?? null,
        totalTokensFresh: input.totalTokensFresh ?? true,
        compactionCount: input.compactionCount ?? 0,
        compactionHintTokens: input.compactionHintTokens ?? null,
        memoryExtractionWatermark: Math.max(0, Math.floor(input.memoryExtractionWatermark ?? 0)),
        providerKey: input.providerKey ?? null,
        modelKey: input.modelKey ?? null,
        lastTurnAt: input.lastTurnAt ?? null,
        closedAt: input.closedAt ?? null
      },
      update: updateData
    });
  }

  findSessionByConversationKey(conversationKey: string) {
    return this.prisma.runtimeSession.findUnique({
      where: {
        conversationKey
      }
    });
  }

  findSessionById(id: string) {
    return this.prisma.runtimeSession.findUnique({
      where: {
        id
      }
    });
  }

  findLatestSessionCompaction(runtimeSessionId: string) {
    return this.prisma.runtimeSessionCompaction.findFirst({
      where: {
        runtimeSessionId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  }

  updateSession(input: UpdateRuntimeSessionInput) {
    const data: Prisma.RuntimeSessionUncheckedUpdateInput = {
      ...(input.currentPublishedVersionId !== undefined
        ? { currentPublishedVersionId: input.currentPublishedVersionId }
        : {}),
      ...(input.runtimeTier !== undefined ? { runtimeTier: input.runtimeTier } : {}),
      ...(input.currentBundleHash !== undefined
        ? { currentBundleHash: input.currentBundleHash }
        : {}),
      ...(input.currentTokens !== undefined ? { currentTokens: input.currentTokens } : {}),
      ...(input.totalTokensFresh !== undefined ? { totalTokensFresh: input.totalTokensFresh } : {}),
      ...(input.compactionCount !== undefined ? { compactionCount: input.compactionCount } : {}),
      ...(input.compactionHintTokens !== undefined
        ? { compactionHintTokens: input.compactionHintTokens }
        : {}),
      ...(input.memoryExtractionWatermark !== undefined
        ? {
            memoryExtractionWatermark: Math.max(0, Math.floor(input.memoryExtractionWatermark))
          }
        : {}),
      ...(input.providerKey !== undefined ? { providerKey: input.providerKey } : {}),
      ...(input.modelKey !== undefined ? { modelKey: input.modelKey } : {}),
      ...(input.lastTurnAt !== undefined ? { lastTurnAt: input.lastTurnAt } : {}),
      ...(input.closedAt !== undefined ? { closedAt: input.closedAt } : {})
    };

    return this.prisma.runtimeSession.update({
      where: {
        id: input.sessionId
      },
      data
    });
  }

  appendSessionCompaction(input: AppendRuntimeSessionCompactionInput) {
    const summaryPayload = this.toNullableJsonInput(input.summaryPayload);

    return this.prisma.runtimeSessionCompaction.create({
      data: {
        runtimeSessionId: input.runtimeSessionId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        requestId: input.requestId ?? null,
        reason: input.reason ?? null,
        instructions: input.instructions ?? null,
        ...(summaryPayload !== undefined ? { summaryPayload } : {}),
        tokensBefore: input.tokensBefore ?? null,
        tokensAfter: input.tokensAfter ?? null
      }
    });
  }

  createAcceptedTurnReceipt(input: CreateAcceptedRuntimeTurnReceiptInput) {
    return this.prisma.runtimeTurnReceipt.create({
      data: {
        assistantId: input.conversation.assistantId,
        workspaceId: input.conversation.workspaceId,
        runtimeSessionId: input.runtimeSessionId ?? null,
        publishedVersionId: input.publishedVersionId ?? null,
        runtimeTier: input.runtimeTier,
        conversationKey: input.conversationKey,
        channel: input.conversation.channel,
        externalThreadKey: input.conversation.externalThreadKey,
        externalUserKey: input.conversation.externalUserKey,
        mode: input.conversation.mode,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        bundleHash: input.bundleHash ?? null,
        status: "accepted"
      }
    });
  }

  findTurnReceiptByRequestId(requestId: string) {
    return this.prisma.runtimeTurnReceipt.findUnique({
      where: {
        requestId
      }
    });
  }

  findTurnReceiptByConversationAndIdempotencyKey(conversationKey: string, idempotencyKey: string) {
    return this.prisma.runtimeTurnReceipt.findUnique({
      where: {
        conversationKey_idempotencyKey: {
          conversationKey,
          idempotencyKey
        }
      }
    });
  }

  markTurnReceiptCompleted(input: {
    requestId: string;
    resultPayload: unknown;
    completedAt: Date;
  }) {
    const resultPayload = this.toRequiredNullableJsonInput(input.resultPayload);

    return this.prisma.runtimeTurnReceipt.update({
      where: {
        requestId: input.requestId
      },
      data: {
        status: "completed",
        resultPayload,
        errorCode: null,
        errorMessage: null,
        completedAt: input.completedAt
      }
    });
  }

  markTurnReceiptInterrupted(input: {
    requestId: string;
    resultPayload: unknown;
    completedAt: Date | null;
  }) {
    const resultPayload = this.toRequiredNullableJsonInput(input.resultPayload);

    return this.prisma.runtimeTurnReceipt.update({
      where: {
        requestId: input.requestId
      },
      data: {
        status: "interrupted",
        resultPayload,
        errorCode: null,
        errorMessage: null,
        completedAt: input.completedAt
      }
    });
  }

  markTurnReceiptFailed(input: {
    requestId: string;
    resultPayload?: unknown;
    errorCode: string;
    errorMessage: string;
    completedAt: Date;
  }) {
    const resultPayload = this.toNullableJsonInput(input.resultPayload);

    return this.prisma.runtimeTurnReceipt.update({
      where: {
        requestId: input.requestId
      },
      data: {
        status: "failed",
        ...(resultPayload === undefined ? {} : { resultPayload }),
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: input.completedAt
      }
    });
  }

  private toNullableJsonInput(
    value: unknown | null | undefined
  ): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return Prisma.DbNull;
    }
    return value as Prisma.InputJsonValue;
  }

  private toRequiredNullableJsonInput(
    value: unknown | null
  ): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
    return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
  }
}
