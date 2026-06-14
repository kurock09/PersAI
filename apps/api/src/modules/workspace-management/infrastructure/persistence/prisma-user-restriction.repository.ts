import { Injectable } from "@nestjs/common";
import type {
  UserRestriction as PrismaUserRestriction,
  UserRestrictionKind as PrismaUserRestrictionKind,
  UserRestrictionSource as PrismaUserRestrictionSource,
  UserRestrictionStatus as PrismaUserRestrictionStatus
} from "@prisma/client";
import type { UserRestrictionRepository } from "../../domain/user-restriction.repository";
import type {
  UserRestriction,
  UserRestrictionKind,
  UserRestrictionSource,
  UserRestrictionStatus
} from "../../domain/user-restriction.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

function mapKind(value: PrismaUserRestrictionKind): UserRestrictionKind {
  return value;
}

function mapStatus(value: PrismaUserRestrictionStatus): UserRestrictionStatus {
  return value;
}

function mapSource(value: PrismaUserRestrictionSource): UserRestrictionSource {
  return value;
}

function mapRow(row: PrismaUserRestriction): UserRestriction {
  return {
    id: row.id,
    userId: row.userId,
    kind: mapKind(row.kind),
    status: mapStatus(row.status),
    blockedUntil: row.blockedUntil,
    reasonCode: row.reasonCode,
    source: mapSource(row.source),
    sourceAssistantId: row.sourceAssistantId,
    sourceModerationCaseId: row.sourceModerationCaseId,
    clearedAt: row.clearedAt,
    clearedByUserId: row.clearedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

@Injectable()
export class PrismaUserRestrictionRepository implements UserRestrictionRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findActiveSafetyRestriction(
    userId: string,
    now = new Date()
  ): Promise<UserRestriction | null> {
    const row = await this.prisma.userRestriction.findUnique({
      where: {
        userId_kind: {
          userId,
          kind: "safety"
        }
      }
    });
    if (row === null || row.status !== "active") {
      return null;
    }
    if (row.blockedUntil !== null && row.blockedUntil.getTime() <= now.getTime()) {
      return null;
    }
    return mapRow(row);
  }

  async findActiveSafetyRestrictionsForUserIds(
    userIds: string[],
    now = new Date()
  ): Promise<Map<string, UserRestriction>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.userRestriction.findMany({
      where: {
        userId: { in: userIds },
        kind: "safety",
        status: "active",
        OR: [{ blockedUntil: null }, { blockedUntil: { gt: now } }]
      }
    });
    const result = new Map<string, UserRestriction>();
    for (const row of rows) {
      result.set(row.userId, mapRow(row));
    }
    return result;
  }

  async clearActiveSafetyRestriction(
    userId: string,
    clearedByUserId: string
  ): Promise<UserRestriction | null> {
    const existing = await this.findActiveSafetyRestriction(userId);
    if (existing === null) {
      return null;
    }
    const row = await this.prisma.userRestriction.update({
      where: {
        userId_kind: {
          userId,
          kind: "safety"
        }
      },
      data: {
        status: "cleared",
        clearedAt: new Date(),
        clearedByUserId
      }
    });
    return mapRow(row);
  }

  async upsertAdminSafetyRestriction(input: {
    userId: string;
    reasonCode: string;
    sourceAssistantId: string | null;
    blockedUntil: Date | null;
  }): Promise<UserRestriction> {
    const row = await this.prisma.userRestriction.upsert({
      where: {
        userId_kind: {
          userId: input.userId,
          kind: "safety"
        }
      },
      create: {
        userId: input.userId,
        kind: "safety",
        status: "active",
        reasonCode: input.reasonCode,
        source: "admin",
        sourceAssistantId: input.sourceAssistantId,
        sourceModerationCaseId: null,
        blockedUntil: input.blockedUntil
      },
      update: {
        status: "active",
        reasonCode: input.reasonCode,
        source: "admin",
        sourceAssistantId: input.sourceAssistantId,
        sourceModerationCaseId: null,
        blockedUntil: input.blockedUntil,
        clearedAt: null,
        clearedByUserId: null
      }
    });
    return mapRow(row);
  }
}
