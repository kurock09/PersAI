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
}
