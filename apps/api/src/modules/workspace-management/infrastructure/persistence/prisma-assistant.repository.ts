import { Injectable } from "@nestjs/common";
import type { Assistant as PrismaAssistant } from "@prisma/client";
import type { Assistant } from "../../domain/assistant.entity";
import type { AssistantRepository } from "../../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantRepository implements AssistantRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findByUserId(userId: string): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { userId }
    });

    return assistant ? this.mapToDomain(assistant) : null;
  }

  private mapToDomain(assistant: PrismaAssistant): Assistant {
    return {
      id: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      createdAt: assistant.createdAt,
      updatedAt: assistant.updatedAt
    };
  }
}
