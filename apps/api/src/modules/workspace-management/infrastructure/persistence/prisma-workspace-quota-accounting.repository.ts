import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type WorkspaceQuotaAccountingState as PrismaWorkspaceQuotaAccountingState
} from "@prisma/client";
import type {
  ApplyMediaStorageUsageInput,
  ApplyMediaStorageUsageResult,
  ReleaseMediaStorageUsageInput,
  ReleaseMediaStorageUsageResult,
  ApplyTokenBudgetUsageInput,
  ApplyTokenBudgetUsageResult,
  RefreshActiveWebChatsQuotaInput,
  IncrementWorkspaceQuotaUsageInput,
  WorkspaceQuotaAccountingRepository
} from "../../domain/workspace-quota-accounting.repository";
import type { WorkspaceQuotaAccountingState } from "../../domain/workspace-quota-accounting.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaWorkspaceQuotaAccountingRepository implements WorkspaceQuotaAccountingRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findByWorkspaceId(workspaceId: string): Promise<WorkspaceQuotaAccountingState | null> {
    const state = await this.prisma.workspaceQuotaAccountingState.findUnique({
      where: { workspaceId }
    });
    return state ? this.mapToDomain(state) : null;
  }

  async incrementUsage(
    input: IncrementWorkspaceQuotaUsageInput
  ): Promise<WorkspaceQuotaAccountingState> {
    const usageData =
      input.dimension === "token_budget"
        ? { tokenBudgetUsed: { increment: input.delta } }
        : input.dimension === "cost_or_token_driving_tool_class"
          ? { costOrTokenDrivingToolClassUnitsUsed: { increment: Number(input.delta) } }
          : input.dimension === "media_storage_bytes"
            ? { mediaStorageBytesUsed: { increment: input.delta } }
            : {};

    const [state] = await this.prisma.$transaction([
      this.prisma.workspaceQuotaAccountingState.upsert({
        where: { workspaceId: input.workspaceId },
        update: {
          ...usageData,
          ...this.toLimitUpdateInput(input.limits),
          lastComputedAt: new Date()
        },
        create: {
          workspaceId: input.workspaceId,
          ...this.toLimitCreateInput(input.limits),
          ...this.toUsageCreateInput(input.dimension, input.delta),
          lastComputedAt: new Date()
        }
      }),
      this.prisma.workspaceQuotaUsageEvent.create({
        data: {
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          userId: input.userId,
          dimension: input.dimension,
          delta: input.delta,
          source: input.source,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
          limitValue: this.resolveLimitValueForDimension(input.dimension, input.limits)
        }
      })
    ]);

    return this.mapToDomain(state);
  }

  async applyTokenBudgetUsage(
    input: ApplyTokenBudgetUsageInput
  ): Promise<ApplyTokenBudgetUsageResult> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.applyTokenBudgetUsageTx(tx, input),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
          }
        );
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to apply token budget usage after serialization retries.");
  }

  async applyMediaStorageUsage(
    input: ApplyMediaStorageUsageInput
  ): Promise<ApplyMediaStorageUsageResult> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.applyMediaStorageUsageTx(tx, input),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
          }
        );
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to apply media storage usage after serialization retries.");
  }

  async releaseMediaStorageUsage(
    input: ReleaseMediaStorageUsageInput
  ): Promise<ReleaseMediaStorageUsageResult> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.releaseMediaStorageUsageTx(tx, input),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
          }
        );
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to release media storage usage after serialization retries.");
  }

  async refreshActiveWebChatsUsage(
    input: RefreshActiveWebChatsQuotaInput
  ): Promise<WorkspaceQuotaAccountingState> {
    const [state] = await this.prisma.$transaction([
      this.prisma.workspaceQuotaAccountingState.upsert({
        where: { workspaceId: input.workspaceId },
        update: {
          activeWebChatsCurrent: input.currentActiveWebChats,
          ...this.toLimitUpdateInput(input.limits),
          lastComputedAt: new Date()
        },
        create: {
          workspaceId: input.workspaceId,
          activeWebChatsCurrent: input.currentActiveWebChats,
          ...this.toLimitCreateInput(input.limits),
          lastComputedAt: new Date()
        }
      }),
      this.prisma.workspaceQuotaUsageEvent.create({
        data: {
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          userId: input.userId,
          dimension: "active_web_chats_cap",
          delta: BigInt(0),
          currentValue: BigInt(input.currentActiveWebChats),
          limitValue:
            input.limits.activeWebChatsLimit === null
              ? null
              : BigInt(input.limits.activeWebChatsLimit),
          source: input.source,
          metadata: Prisma.DbNull
        }
      })
    ]);

    return this.mapToDomain(state);
  }

  private async applyTokenBudgetUsageTx(
    tx: Prisma.TransactionClient,
    input: ApplyTokenBudgetUsageInput
  ): Promise<ApplyTokenBudgetUsageResult> {
    const existing = await tx.workspaceQuotaAccountingState.findUnique({
      where: { workspaceId: input.workspaceId }
    });

    const used = existing?.tokenBudgetUsed ?? BigInt(0);
    const limit = input.limits.tokenBudgetLimit;
    const remaining = limit === null ? null : limit - used;
    const normalizedRemaining =
      remaining === null ? null : remaining > BigInt(0) ? remaining : BigInt(0);
    const appliedDelta =
      normalizedRemaining === null
        ? input.delta
        : input.delta < normalizedRemaining
          ? input.delta
          : normalizedRemaining;

    const nextState = existing
      ? await tx.workspaceQuotaAccountingState.update({
          where: { workspaceId: input.workspaceId },
          data: {
            tokenBudgetUsed: { increment: appliedDelta },
            ...this.toLimitUpdateInput(input.limits),
            lastComputedAt: new Date()
          }
        })
      : await tx.workspaceQuotaAccountingState.create({
          data: {
            workspaceId: input.workspaceId,
            ...this.toLimitCreateInput(input.limits),
            ...this.toUsageCreateInput("token_budget", appliedDelta),
            lastComputedAt: new Date()
          }
        });

    await tx.workspaceQuotaUsageEvent.create({
      data: {
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        dimension: "token_budget",
        delta: appliedDelta,
        source: input.source,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        limitValue: this.resolveLimitValueForDimension("token_budget", input.limits)
      }
    });

    return {
      state: this.mapToDomain(nextState),
      appliedDelta,
      capped: appliedDelta < input.delta
    };
  }

  private async applyMediaStorageUsageTx(
    tx: Prisma.TransactionClient,
    input: ApplyMediaStorageUsageInput
  ): Promise<ApplyMediaStorageUsageResult> {
    const existing = await tx.workspaceQuotaAccountingState.findUnique({
      where: { workspaceId: input.workspaceId }
    });

    const used = existing?.mediaStorageBytesUsed ?? BigInt(0);
    const limit = input.limits.mediaStorageBytesLimit;
    const remaining = limit === null ? null : limit - used;
    const normalizedRemaining =
      remaining === null ? null : remaining > BigInt(0) ? remaining : BigInt(0);
    const appliedDelta =
      normalizedRemaining === null
        ? input.delta
        : input.delta < normalizedRemaining
          ? input.delta
          : normalizedRemaining;

    const nextState = existing
      ? await tx.workspaceQuotaAccountingState.update({
          where: { workspaceId: input.workspaceId },
          data: {
            mediaStorageBytesUsed: { increment: appliedDelta },
            ...this.toLimitUpdateInput(input.limits),
            lastComputedAt: new Date()
          }
        })
      : await tx.workspaceQuotaAccountingState.create({
          data: {
            workspaceId: input.workspaceId,
            ...this.toLimitCreateInput(input.limits),
            ...this.toUsageCreateInput("media_storage_bytes", appliedDelta),
            lastComputedAt: new Date()
          }
        });

    await tx.workspaceQuotaUsageEvent.create({
      data: {
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        dimension: "media_storage_bytes",
        delta: appliedDelta,
        source: input.source,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        limitValue: this.resolveLimitValueForDimension("media_storage_bytes", input.limits)
      }
    });

    return {
      state: this.mapToDomain(nextState),
      appliedDelta,
      capped: appliedDelta < input.delta
    };
  }

  private async releaseMediaStorageUsageTx(
    tx: Prisma.TransactionClient,
    input: ReleaseMediaStorageUsageInput
  ): Promise<ReleaseMediaStorageUsageResult> {
    const existing = await tx.workspaceQuotaAccountingState.findUnique({
      where: { workspaceId: input.workspaceId }
    });

    const used = existing?.mediaStorageBytesUsed ?? BigInt(0);
    const releasedDelta =
      input.delta <= BigInt(0) ? BigInt(0) : input.delta < used ? input.delta : used;

    const nextState = existing
      ? await tx.workspaceQuotaAccountingState.update({
          where: { workspaceId: input.workspaceId },
          data: {
            mediaStorageBytesUsed: { decrement: releasedDelta },
            ...this.toLimitUpdateInput(input.limits),
            lastComputedAt: new Date()
          }
        })
      : await tx.workspaceQuotaAccountingState.create({
          data: {
            workspaceId: input.workspaceId,
            ...this.toLimitCreateInput(input.limits),
            ...this.toUsageCreateInput("media_storage_bytes", BigInt(0)),
            lastComputedAt: new Date()
          }
        });

    await tx.workspaceQuotaUsageEvent.create({
      data: {
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        dimension: "media_storage_bytes",
        delta: -releasedDelta,
        source: input.source,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        limitValue: this.resolveLimitValueForDimension("media_storage_bytes", input.limits)
      }
    });

    return {
      state: this.mapToDomain(nextState),
      releasedDelta
    };
  }

  private resolveLimitValueForDimension(
    dimension: IncrementWorkspaceQuotaUsageInput["dimension"],
    limits: IncrementWorkspaceQuotaUsageInput["limits"]
  ): bigint | null {
    if (dimension === "token_budget") {
      return limits.tokenBudgetLimit;
    }

    if (dimension === "cost_or_token_driving_tool_class") {
      return limits.costOrTokenDrivingToolClassUnitsLimit === null
        ? null
        : BigInt(limits.costOrTokenDrivingToolClassUnitsLimit);
    }

    if (dimension === "media_storage_bytes") {
      return limits.mediaStorageBytesLimit;
    }

    return limits.activeWebChatsLimit === null ? null : BigInt(limits.activeWebChatsLimit);
  }

  private toUsageCreateInput(
    dimension: IncrementWorkspaceQuotaUsageInput["dimension"],
    delta: bigint
  ): Pick<
    Prisma.WorkspaceQuotaAccountingStateCreateInput,
    "tokenBudgetUsed" | "costOrTokenDrivingToolClassUnitsUsed" | "mediaStorageBytesUsed"
  > {
    return {
      tokenBudgetUsed: dimension === "token_budget" ? delta : BigInt(0),
      costOrTokenDrivingToolClassUnitsUsed:
        dimension === "cost_or_token_driving_tool_class" ? Number(delta) : 0,
      mediaStorageBytesUsed: dimension === "media_storage_bytes" ? delta : BigInt(0)
    };
  }

  private toLimitCreateInput(
    limits: IncrementWorkspaceQuotaUsageInput["limits"]
  ): Pick<
    Prisma.WorkspaceQuotaAccountingStateCreateInput,
    | "tokenBudgetLimit"
    | "costOrTokenDrivingToolClassUnitsLimit"
    | "activeWebChatsLimit"
    | "mediaStorageBytesLimit"
  > {
    return {
      tokenBudgetLimit: limits.tokenBudgetLimit,
      costOrTokenDrivingToolClassUnitsLimit:
        limits.costOrTokenDrivingToolClassUnitsLimit === null
          ? null
          : limits.costOrTokenDrivingToolClassUnitsLimit,
      activeWebChatsLimit: limits.activeWebChatsLimit,
      mediaStorageBytesLimit: limits.mediaStorageBytesLimit
    };
  }

  private toLimitUpdateInput(
    limits: IncrementWorkspaceQuotaUsageInput["limits"]
  ): Pick<
    Prisma.WorkspaceQuotaAccountingStateUpdateInput,
    | "tokenBudgetLimit"
    | "costOrTokenDrivingToolClassUnitsLimit"
    | "activeWebChatsLimit"
    | "mediaStorageBytesLimit"
  > {
    return {
      tokenBudgetLimit: limits.tokenBudgetLimit,
      costOrTokenDrivingToolClassUnitsLimit:
        limits.costOrTokenDrivingToolClassUnitsLimit === null
          ? null
          : limits.costOrTokenDrivingToolClassUnitsLimit,
      activeWebChatsLimit: limits.activeWebChatsLimit,
      mediaStorageBytesLimit: limits.mediaStorageBytesLimit
    };
  }

  private mapToDomain(state: PrismaWorkspaceQuotaAccountingState): WorkspaceQuotaAccountingState {
    return {
      id: state.id,
      workspaceId: state.workspaceId,
      tokenBudgetUsed: state.tokenBudgetUsed,
      tokenBudgetLimit: state.tokenBudgetLimit,
      costOrTokenDrivingToolClassUnitsUsed: state.costOrTokenDrivingToolClassUnitsUsed,
      costOrTokenDrivingToolClassUnitsLimit: state.costOrTokenDrivingToolClassUnitsLimit,
      activeWebChatsCurrent: state.activeWebChatsCurrent,
      activeWebChatsLimit: state.activeWebChatsLimit,
      mediaStorageBytesUsed: state.mediaStorageBytesUsed,
      mediaStorageBytesLimit: state.mediaStorageBytesLimit,
      lastComputedAt: state.lastComputedAt,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    };
  }
}
