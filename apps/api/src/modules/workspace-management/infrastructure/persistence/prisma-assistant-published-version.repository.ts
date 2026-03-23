import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AssistantPublishedVersion as PrismaAssistantPublishedVersion } from "@prisma/client";
import type {
  AssistantPublishedVersionRepository,
  CreateAssistantPublishedVersionInput
} from "../../domain/assistant-published-version.repository";
import type { AssistantPublishedVersion } from "../../domain/assistant-published-version.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantPublishedVersionRepository implements AssistantPublishedVersionRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findLatestByAssistantId(assistantId: string): Promise<AssistantPublishedVersion | null> {
    const publishedVersion = await this.prisma.assistantPublishedVersion.findFirst({
      where: { assistantId },
      orderBy: [{ version: "desc" }]
    });

    return publishedVersion ? this.mapToDomain(publishedVersion) : null;
  }

  async create(input: CreateAssistantPublishedVersionInput): Promise<AssistantPublishedVersion> {
    try {
      const publishedVersion = await this.prisma.$transaction(async (tx) => {
        const latestVersion = await tx.assistantPublishedVersion.findFirst({
          where: { assistantId: input.assistantId },
          orderBy: [{ version: "desc" }],
          select: { version: true }
        });

        return tx.assistantPublishedVersion.create({
          data: {
            assistantId: input.assistantId,
            version: (latestVersion?.version ?? 0) + 1,
            snapshotDisplayName: input.snapshotDisplayName,
            snapshotInstructions: input.snapshotInstructions,
            publishedByUserId: input.publishedByUserId
          }
        });
      });

      return this.mapToDomain(publishedVersion);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Concurrent publish conflict. Retry publish.");
      }

      throw error;
    }
  }

  private mapToDomain(
    publishedVersion: PrismaAssistantPublishedVersion
  ): AssistantPublishedVersion {
    return {
      id: publishedVersion.id,
      assistantId: publishedVersion.assistantId,
      version: publishedVersion.version,
      snapshotDisplayName: publishedVersion.snapshotDisplayName,
      snapshotInstructions: publishedVersion.snapshotInstructions,
      publishedByUserId: publishedVersion.publishedByUserId,
      createdAt: publishedVersion.createdAt
    };
  }
}
