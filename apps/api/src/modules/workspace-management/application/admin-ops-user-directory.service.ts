import { Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export interface AdminOpsUserRow {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  assistant: {
    id: string;
    draftDisplayName: string | null;
    draftAssistantGender: string | null;
    applyStatus: string;
    latestPublishedVersion: number | null;
    lastPublishedAt: string | null;
  } | null;
}

export interface AdminOpsUserDirectoryResult {
  users: AdminOpsUserRow[];
  total: number;
}

@Injectable()
export class AdminOpsUserDirectoryService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(query: {
    search?: string;
    offset: number;
    limit: number;
  }): Promise<AdminOpsUserDirectoryResult> {
    const where = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: "insensitive" as const } },
            { displayName: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.appUser.findMany({
        where,
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
          assistant: {
            select: {
              id: true,
              draftDisplayName: true,
              draftAssistantGender: true,
              applyStatus: true,
              publishedVersions: {
                orderBy: { version: "desc" as const },
                take: 1,
                select: { version: true, createdAt: true }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: query.offset,
        take: query.limit
      }),
      this.prisma.appUser.count({ where })
    ]);

    return {
      total,
      users: users.map((u) => {
        const a = u.assistant;
        return {
          userId: u.id,
          email: u.email,
          displayName: u.displayName,
          createdAt: u.createdAt.toISOString(),
          assistant: a
            ? {
                id: a.id,
                draftDisplayName: a.draftDisplayName,
                draftAssistantGender: a.draftAssistantGender,
                applyStatus: a.applyStatus,
                latestPublishedVersion: a.publishedVersions[0]?.version ?? null,
                lastPublishedAt: a.publishedVersions[0]?.createdAt?.toISOString() ?? null
              }
            : null
        };
      })
    };
  }
}
