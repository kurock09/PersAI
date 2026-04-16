import { Injectable } from "@nestjs/common";
import type {
  PromptTemplate,
  PromptTemplateRepository
} from "../../domain/bootstrap-document-preset.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaPromptTemplateRepository implements PromptTemplateRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findAll(): Promise<PromptTemplate[]> {
    return this.prisma.promptTemplate.findMany({
      orderBy: { id: "asc" }
    });
  }

  async findById(id: string): Promise<PromptTemplate | null> {
    return this.prisma.promptTemplate.findUnique({
      where: { id }
    });
  }

  async update(id: string, template: string): Promise<PromptTemplate> {
    return this.prisma.promptTemplate.update({
      where: { id },
      data: { template }
    });
  }

  async upsert(id: string, template: string): Promise<PromptTemplate> {
    return this.prisma.promptTemplate.upsert({
      where: { id },
      update: { template },
      create: { id, template }
    });
  }
}
