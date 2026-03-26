import { Injectable } from "@nestjs/common";
import type {
  BootstrapDocumentPreset,
  BootstrapDocumentPresetRepository
} from "../../domain/bootstrap-document-preset.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaBootstrapDocumentPresetRepository implements BootstrapDocumentPresetRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findAll(): Promise<BootstrapDocumentPreset[]> {
    return this.prisma.bootstrapDocumentPreset.findMany({
      orderBy: { id: "asc" }
    });
  }

  async findById(id: string): Promise<BootstrapDocumentPreset | null> {
    return this.prisma.bootstrapDocumentPreset.findUnique({
      where: { id }
    });
  }

  async update(id: string, template: string): Promise<BootstrapDocumentPreset> {
    return this.prisma.bootstrapDocumentPreset.update({
      where: { id },
      data: { template }
    });
  }
}
