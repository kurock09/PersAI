import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type WorkspaceQuotaAccountingState as PrismaWorkspaceQuotaAccountingState
} from "@prisma/client";
import type {
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
