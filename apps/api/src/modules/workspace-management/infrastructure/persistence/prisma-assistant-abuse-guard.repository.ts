import { Injectable } from "@nestjs/common";
import type {
  AssistantAbuseAssistantState as PrismaAssistantAbuseAssistantState,
  AssistantAbuseGuardState as PrismaAssistantAbuseGuardState
} from "@prisma/client";
import type { AssistantAbuseGuardRepository } from "../../domain/assistant-abuse-guard.repository";
import type {
  AbuseSurface,
  AssistantAbuseAssistantState,
  AssistantAbuseGuardState
} from "../../domain/assistant-abuse-guard.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantAbuseGuardRepository implements AssistantAbuseGuardRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findUserState(
    assistantId: string,
    userId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseGuardState | null> {
    const row = await this.prisma.assistantAbuseGuardState.findUnique({
      where: {
        assistantId_userId_surface: {
          assistantId,
          userId,
          surface
        }
      }
    });
    return row === null ? null : this.toUserDomain(row);
  }

  async findAssistantState(
    assistantId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseAssistantState | null> {
    const row = await this.prisma.assistantAbuseAssistantState.findUnique({
      where: {
        assistantId_surface: {
          assistantId,
          surface
        }
      }
    });
    return row === null ? null : this.toAssistantDomain(row);
  }

  async upsertUserState(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    surface: AbuseSurface;
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }): Promise<AssistantAbuseGuardState> {
    const row = await this.prisma.assistantAbuseGuardState.upsert({
      where: {
        assistantId_userId_surface: {
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface
        }
      },
      create: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: input.surface,
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      },
      update: {
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      }
    });
    return this.toUserDomain(row);
  }

  async upsertAssistantState(input: {
    assistantId: string;
    surface: AbuseSurface;
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }): Promise<AssistantAbuseAssistantState> {
    const row = await this.prisma.assistantAbuseAssistantState.upsert({
      where: {
        assistantId_surface: {
          assistantId: input.assistantId,
          surface: input.surface
        }
      },
      create: {
        assistantId: input.assistantId,
        surface: input.surface,
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      },
      update: {
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      }
    });
    return this.toAssistantDomain(row);
  }

  async applyAdminUnblock(input: {
    assistantId: string;
    userId: string | null;
    surface: AbuseSurface;
    adminOverrideUntil: Date;
  }): Promise<{ userRows: number; assistantRows: number }> {
    const where = {
      assistantId: input.assistantId,
      surface: input.surface,
      ...(input.userId === null ? {} : { userId: input.userId })
    };
    const userResult = await this.prisma.assistantAbuseGuardState.updateMany({
      where,
      data: {
        blockedUntil: null,
        slowedUntil: null,
        blockReason: null,
        requestCount: 0,
        windowStartedAt: new Date(),
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: new Date()
      }
    });
    const assistantResult = await this.prisma.assistantAbuseAssistantState.updateMany({
      where: {
        assistantId: input.assistantId,
        surface: input.surface
      },
      data: {
        blockedUntil: null,
        slowedUntil: null,
        blockReason: null,
        requestCount: 0,
        windowStartedAt: new Date(),
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: new Date()
      }
    });
    return {
      userRows: userResult.count,
      assistantRows: assistantResult.count
    };
  }

  private toUserDomain(row: PrismaAssistantAbuseGuardState): AssistantAbuseGuardState {
    return {
      id: row.id,
      assistantId: row.assistantId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      surface: row.surface,
      windowStartedAt: row.windowStartedAt,
      requestCount: row.requestCount,
      slowedUntil: row.slowedUntil,
      blockedUntil: row.blockedUntil,
      blockReason: row.blockReason,
      adminOverrideUntil: row.adminOverrideUntil,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private toAssistantDomain(row: PrismaAssistantAbuseAssistantState): AssistantAbuseAssistantState {
    return {
      id: row.id,
      assistantId: row.assistantId,
      surface: row.surface,
      windowStartedAt: row.windowStartedAt,
      requestCount: row.requestCount,
      slowedUntil: row.slowedUntil,
      blockedUntil: row.blockedUntil,
      blockReason: row.blockReason,
      adminOverrideUntil: row.adminOverrideUntil,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
