import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type WorkspaceQuotaAccountingState as PrismaWorkspaceQuotaAccountingState
} from "@prisma/client";
import type {
  ApplyKnowledgeStorageUsageInput,
  ApplyKnowledgeStorageUsageResult,
  ApplyMediaStorageUsageInput,
  ApplyMediaStorageUsageResult,
  ReleaseKnowledgeStorageUsageInput,
  ReleaseKnowledgeStorageUsageResult,
  ReleaseMediaStorageUsageInput,
  ReleaseMediaStorageUsageResult,
  ApplyTokenBudgetUsageInput,
  ApplyTokenBudgetUsageResult,
  FindMonthlyMediaQuotaCounterInput,
  FindTokenBudgetPeriodCounterInput,
  MonthlyMediaQuotaMutationInput,
  RefreshActiveWebChatsQuotaInput,
  ReserveMonthlyMediaQuotaResult,
  IncrementWorkspaceQuotaUsageInput,
  WorkspaceQuotaAccountingRepository,
  WorkspaceMonthlyMediaQuotaCounter,
  WorkspaceTokenBudgetPeriodCounter,
  WorkspaceMonthlyMediaQuotaToolCode
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

  async findTokenBudgetPeriodCounter(
    input: FindTokenBudgetPeriodCounterInput
  ): Promise<WorkspaceTokenBudgetPeriodCounter | null> {
    const counter = await this.prisma.workspaceTokenBudgetPeriodCounter.findUnique({
      where: {
        workspaceId_periodStartedAt_periodEndsAt: {
          workspaceId: input.workspaceId,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt
        }
      }
    });
    return counter ? this.mapTokenBudgetPeriodCounter(counter) : null;
  }

  async findMonthlyMediaQuotaCounter(
    input: FindMonthlyMediaQuotaCounterInput
  ): Promise<WorkspaceMonthlyMediaQuotaCounter | null> {
    const counter = await this.prisma.workspaceMediaMonthlyQuotaCounter.findUnique({
      where: {
        workspaceId_toolCode_periodStartedAt_periodEndsAt: {
          workspaceId: input.workspaceId,
          toolCode: input.toolCode,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt
        }
      }
    });
    if (counter === null) {
      return null;
    }
    return this.mapMonthlyMediaQuotaCounter(counter);
  }

  async reserveMonthlyMediaQuota(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<ReserveMonthlyMediaQuotaResult> {
    return this.withSerializableRetry("reserve monthly media quota", async () =>
      this.prisma.$transaction(
        async (tx) => {
          const counter = await this.upsertMonthlyMediaQuotaCounter(tx, input);
          const currentUsedUnits = counter.reservedUnits + counter.settledUnits;
          const allowed =
            input.limitUnits === null || currentUsedUnits + input.units <= input.limitUnits;
          if (!allowed) {
            return {
              allowed: false,
              currentUsedUnits,
              limitUnits: input.limitUnits,
              counter: this.mapMonthlyMediaQuotaCounter(counter)
            };
          }

          const updated = await tx.workspaceMediaMonthlyQuotaCounter.update({
            where: { id: counter.id },
            data: {
              reservedUnits: { increment: input.units },
              limitUnits: input.limitUnits,
              lastComputedAt: new Date()
            }
          });

          return {
            allowed: true,
            currentUsedUnits: currentUsedUnits + input.units,
            limitUnits: input.limitUnits,
            counter: this.mapMonthlyMediaQuotaCounter(updated)
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  async settleMonthlyMediaQuota(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<WorkspaceMonthlyMediaQuotaCounter> {
    return this.mutateMonthlyMediaQuota(input, (units) => ({
      reservedUnits: { decrement: units },
      settledUnits: { increment: units }
    }));
  }

  async releaseMonthlyMediaQuota(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<WorkspaceMonthlyMediaQuotaCounter> {
    return this.mutateMonthlyMediaQuota(input, (units) => ({
      reservedUnits: { decrement: units },
      releasedUnits: { increment: units }
    }));
  }

  async markMonthlyMediaQuotaReconciliationRequired(
    input: MonthlyMediaQuotaMutationInput
  ): Promise<WorkspaceMonthlyMediaQuotaCounter> {
    return this.mutateMonthlyMediaQuota(input, (units) => ({
      reservedUnits: { decrement: units },
      reconciliationRequiredUnits: { increment: units }
    }));
  }

  private async mutateMonthlyMediaQuota(
    input: MonthlyMediaQuotaMutationInput,
    dataForUnits: (units: number) => Prisma.WorkspaceMediaMonthlyQuotaCounterUpdateInput
  ): Promise<WorkspaceMonthlyMediaQuotaCounter> {
    return this.withSerializableRetry("mutate monthly media quota", async () =>
      this.prisma.$transaction(
        async (tx) => {
          const counter = await this.upsertMonthlyMediaQuotaCounter(tx, input);
          const units = Math.min(input.units, counter.reservedUnits);
          if (units <= 0) {
            return this.mapMonthlyMediaQuotaCounter(counter);
          }
          const updated = await tx.workspaceMediaMonthlyQuotaCounter.update({
            where: { id: counter.id },
            data: {
              ...dataForUnits(units),
              limitUnits: input.limitUnits,
              lastComputedAt: new Date()
            }
          });
          return this.mapMonthlyMediaQuotaCounter(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async upsertMonthlyMediaQuotaCounter(
    tx: Prisma.TransactionClient,
    input: MonthlyMediaQuotaMutationInput
  ) {
    return tx.workspaceMediaMonthlyQuotaCounter.upsert({
      where: {
        workspaceId_toolCode_periodStartedAt_periodEndsAt: {
          workspaceId: input.workspaceId,
          toolCode: input.toolCode,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt
        }
      },
      update: {
        limitUnits: input.limitUnits,
        lastComputedAt: new Date()
      },
      create: {
        workspaceId: input.workspaceId,
        toolCode: input.toolCode,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        limitUnits: input.limitUnits,
        lastComputedAt: new Date()
      }
    });
  }

  private mapMonthlyMediaQuotaCounter(counter: {
    workspaceId: string;
    toolCode: string;
    periodStartedAt: Date;
    periodEndsAt: Date;
    reservedUnits: number;
    settledUnits: number;
    releasedUnits: number;
    reconciliationRequiredUnits: number;
    limitUnits: number | null;
    lastComputedAt: Date;
  }): WorkspaceMonthlyMediaQuotaCounter {
    return {
      workspaceId: counter.workspaceId,
      toolCode: this.toMonthlyMediaQuotaToolCode(counter.toolCode),
      periodStartedAt: counter.periodStartedAt,
      periodEndsAt: counter.periodEndsAt,
      reservedUnits: counter.reservedUnits,
      settledUnits: counter.settledUnits,
      releasedUnits: counter.releasedUnits,
      reconciliationRequiredUnits: counter.reconciliationRequiredUnits,
      limitUnits: counter.limitUnits,
      lastComputedAt: counter.lastComputedAt
    };
  }

  private mapTokenBudgetPeriodCounter(counter: {
    workspaceId: string;
    periodStartedAt: Date;
    periodEndsAt: Date;
    usedCredits: bigint;
    limitCredits: bigint | null;
    lastComputedAt: Date;
  }): WorkspaceTokenBudgetPeriodCounter {
    return {
      workspaceId: counter.workspaceId,
      periodStartedAt: counter.periodStartedAt,
      periodEndsAt: counter.periodEndsAt,
      usedCredits: counter.usedCredits,
      limitCredits: counter.limitCredits,
      lastComputedAt: counter.lastComputedAt
    };
  }

  private async withSerializableRetry<T>(label: string, execute: () => Promise<T>): Promise<T> {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await execute();
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Failed to ${label} after serialization retries.`);
  }

  private toMonthlyMediaQuotaToolCode(toolCode: string): WorkspaceMonthlyMediaQuotaToolCode {
    if (
      toolCode === "image_generate" ||
      toolCode === "image_edit" ||
      toolCode === "video_generate"
    ) {
      return toolCode;
    }
    throw new Error(`Unexpected monthly media quota tool code "${toolCode}".`);
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
            : input.dimension === "knowledge_storage_bytes"
              ? { knowledgeStorageBytesUsed: { increment: input.delta } }
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

  async applyKnowledgeStorageUsage(
    input: ApplyKnowledgeStorageUsageInput
  ): Promise<ApplyKnowledgeStorageUsageResult> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.applyKnowledgeStorageUsageTx(tx, input),
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

    throw new Error("Failed to apply knowledge storage usage after serialization retries.");
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

  async releaseKnowledgeStorageUsage(
    input: ReleaseKnowledgeStorageUsageInput
  ): Promise<ReleaseKnowledgeStorageUsageResult> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.releaseKnowledgeStorageUsageTx(tx, input),
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

    throw new Error("Failed to release knowledge storage usage after serialization retries.");
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
    const existingCounter = await tx.workspaceTokenBudgetPeriodCounter.findUnique({
      where: {
        workspaceId_periodStartedAt_periodEndsAt: {
          workspaceId: input.workspaceId,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt
        }
      }
    });

    const used = existingCounter?.usedCredits ?? BigInt(0);
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

    const nextCounter = await tx.workspaceTokenBudgetPeriodCounter.upsert({
      where: {
        workspaceId_periodStartedAt_periodEndsAt: {
          workspaceId: input.workspaceId,
          periodStartedAt: input.periodStartedAt,
          periodEndsAt: input.periodEndsAt
        }
      },
      update: {
        usedCredits: { increment: appliedDelta },
        limitCredits: input.limits.tokenBudgetLimit,
        lastComputedAt: new Date()
      },
      create: {
        workspaceId: input.workspaceId,
        periodStartedAt: input.periodStartedAt,
        periodEndsAt: input.periodEndsAt,
        usedCredits: appliedDelta,
        limitCredits: input.limits.tokenBudgetLimit,
        lastComputedAt: new Date()
      }
    });

    const nextState = await tx.workspaceQuotaAccountingState.upsert({
      where: { workspaceId: input.workspaceId },
      update: {
        tokenBudgetUsed: nextCounter.usedCredits,
        ...this.toLimitUpdateInput(input.limits),
        lastComputedAt: new Date()
      },
      create: {
        workspaceId: input.workspaceId,
        ...this.toLimitCreateInput(input.limits),
        ...this.toUsageCreateInput("token_budget", nextCounter.usedCredits),
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
        metadata: {
          ...(input.metadata ?? {}),
          periodStartedAt: input.periodStartedAt.toISOString(),
          periodEndsAt: input.periodEndsAt.toISOString()
        } as Prisma.InputJsonValue,
        limitValue: this.resolveLimitValueForDimension("token_budget", input.limits)
      }
    });

    return {
      state: this.mapToDomain(nextState),
      counter: this.mapTokenBudgetPeriodCounter(nextCounter),
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

  private async applyKnowledgeStorageUsageTx(
    tx: Prisma.TransactionClient,
    input: ApplyKnowledgeStorageUsageInput
  ): Promise<ApplyKnowledgeStorageUsageResult> {
    const existing = await tx.workspaceQuotaAccountingState.findUnique({
      where: { workspaceId: input.workspaceId }
    });

    const used = existing?.knowledgeStorageBytesUsed ?? BigInt(0);
    const limit = input.limits.knowledgeStorageBytesLimit;
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
            knowledgeStorageBytesUsed: { increment: appliedDelta },
            ...this.toLimitUpdateInput(input.limits),
            lastComputedAt: new Date()
          }
        })
      : await tx.workspaceQuotaAccountingState.create({
          data: {
            workspaceId: input.workspaceId,
            ...this.toLimitCreateInput(input.limits),
            ...this.toUsageCreateInput("knowledge_storage_bytes", appliedDelta),
            lastComputedAt: new Date()
          }
        });

    await tx.workspaceQuotaUsageEvent.create({
      data: {
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        dimension: "knowledge_storage_bytes",
        delta: appliedDelta,
        source: input.source,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        limitValue: this.resolveLimitValueForDimension("knowledge_storage_bytes", input.limits)
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

  private async releaseKnowledgeStorageUsageTx(
    tx: Prisma.TransactionClient,
    input: ReleaseKnowledgeStorageUsageInput
  ): Promise<ReleaseKnowledgeStorageUsageResult> {
    const existing = await tx.workspaceQuotaAccountingState.findUnique({
      where: { workspaceId: input.workspaceId }
    });

    const used = existing?.knowledgeStorageBytesUsed ?? BigInt(0);
    const releasedDelta =
      input.delta <= BigInt(0) ? BigInt(0) : input.delta < used ? input.delta : used;

    const nextState = existing
      ? await tx.workspaceQuotaAccountingState.update({
          where: { workspaceId: input.workspaceId },
          data: {
            knowledgeStorageBytesUsed: { decrement: releasedDelta },
            ...this.toLimitUpdateInput(input.limits),
            lastComputedAt: new Date()
          }
        })
      : await tx.workspaceQuotaAccountingState.create({
          data: {
            workspaceId: input.workspaceId,
            ...this.toLimitCreateInput(input.limits),
            ...this.toUsageCreateInput("knowledge_storage_bytes", BigInt(0)),
            lastComputedAt: new Date()
          }
        });

    await tx.workspaceQuotaUsageEvent.create({
      data: {
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        dimension: "knowledge_storage_bytes",
        delta: -releasedDelta,
        source: input.source,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        limitValue: this.resolveLimitValueForDimension("knowledge_storage_bytes", input.limits)
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

    if (dimension === "knowledge_storage_bytes") {
      return limits.knowledgeStorageBytesLimit;
    }

    return limits.activeWebChatsLimit === null ? null : BigInt(limits.activeWebChatsLimit);
  }

  private toUsageCreateInput(
    dimension: IncrementWorkspaceQuotaUsageInput["dimension"],
    delta: bigint
  ): Pick<
    Prisma.WorkspaceQuotaAccountingStateCreateInput,
    | "tokenBudgetUsed"
    | "costOrTokenDrivingToolClassUnitsUsed"
    | "mediaStorageBytesUsed"
    | "knowledgeStorageBytesUsed"
  > {
    return {
      tokenBudgetUsed: dimension === "token_budget" ? delta : BigInt(0),
      costOrTokenDrivingToolClassUnitsUsed:
        dimension === "cost_or_token_driving_tool_class" ? Number(delta) : 0,
      mediaStorageBytesUsed: dimension === "media_storage_bytes" ? delta : BigInt(0),
      knowledgeStorageBytesUsed: dimension === "knowledge_storage_bytes" ? delta : BigInt(0)
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
    | "knowledgeStorageBytesLimit"
  > {
    return {
      tokenBudgetLimit: limits.tokenBudgetLimit,
      costOrTokenDrivingToolClassUnitsLimit:
        limits.costOrTokenDrivingToolClassUnitsLimit === null
          ? null
          : limits.costOrTokenDrivingToolClassUnitsLimit,
      activeWebChatsLimit: limits.activeWebChatsLimit,
      mediaStorageBytesLimit: limits.mediaStorageBytesLimit,
      knowledgeStorageBytesLimit: limits.knowledgeStorageBytesLimit
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
    | "knowledgeStorageBytesLimit"
  > {
    return {
      tokenBudgetLimit: limits.tokenBudgetLimit,
      costOrTokenDrivingToolClassUnitsLimit:
        limits.costOrTokenDrivingToolClassUnitsLimit === null
          ? null
          : limits.costOrTokenDrivingToolClassUnitsLimit,
      activeWebChatsLimit: limits.activeWebChatsLimit,
      mediaStorageBytesLimit: limits.mediaStorageBytesLimit,
      knowledgeStorageBytesLimit: limits.knowledgeStorageBytesLimit
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
      knowledgeStorageBytesUsed: state.knowledgeStorageBytesUsed,
      knowledgeStorageBytesLimit: state.knowledgeStorageBytesLimit,
      lastComputedAt: state.lastComputedAt,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    };
  }
}
