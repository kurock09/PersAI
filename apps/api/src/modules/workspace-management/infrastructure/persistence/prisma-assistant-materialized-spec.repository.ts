import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AssistantMaterializedSpec as PrismaAssistantMaterializedSpec } from "@prisma/client";
import type {
  AssistantMaterializedSpecRepository,
  CreateAssistantMaterializedSpecInput
} from "../../domain/assistant-materialized-spec.repository";
import type { AssistantMaterializedSpec } from "../../domain/assistant-materialized-spec.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantMaterializedSpecRepository implements AssistantMaterializedSpecRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findLatestByAssistantId(assistantId: string): Promise<AssistantMaterializedSpec | null> {
    const spec = await this.prisma.assistantMaterializedSpec.findFirst({
      where: { assistantId },
      orderBy: [{ createdAt: "desc" }]
    });

    return spec ? this.mapToDomain(spec) : null;
  }

  async findByPublishedVersionId(
    publishedVersionId: string
  ): Promise<AssistantMaterializedSpec | null> {
    const spec = await this.prisma.assistantMaterializedSpec.findUnique({
      where: { publishedVersionId }
    });

    return spec ? this.mapToDomain(spec) : null;
  }

  async create(input: CreateAssistantMaterializedSpecInput): Promise<AssistantMaterializedSpec> {
    try {
      const spec = await this.prisma.assistantMaterializedSpec.create({
        data: {
          assistantId: input.assistantId,
          publishedVersionId: input.publishedVersionId,
          sourceAction: input.sourceAction,
          algorithmVersion: input.algorithmVersion,
          layers: input.layers as Prisma.InputJsonValue,
          openclawBootstrap: input.openclawBootstrap as Prisma.InputJsonValue,
          openclawWorkspace: input.openclawWorkspace as Prisma.InputJsonValue,
          layersDocument: input.layersDocument,
          openclawBootstrapDocument: input.openclawBootstrapDocument,
          openclawWorkspaceDocument: input.openclawWorkspaceDocument,
          contentHash: input.contentHash
        }
      });

      return this.mapToDomain(spec);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existingSpec = await this.findByPublishedVersionId(input.publishedVersionId);
        if (existingSpec !== null) {
          return existingSpec;
        }
      }

      throw error;
    }
  }

  private mapToDomain(spec: PrismaAssistantMaterializedSpec): AssistantMaterializedSpec {
    return {
      id: spec.id,
      assistantId: spec.assistantId,
      publishedVersionId: spec.publishedVersionId,
      sourceAction: spec.sourceAction,
      algorithmVersion: spec.algorithmVersion,
      layers: spec.layers,
      openclawBootstrap: spec.openclawBootstrap,
      openclawWorkspace: spec.openclawWorkspace,
      layersDocument: spec.layersDocument,
      openclawBootstrapDocument: spec.openclawBootstrapDocument,
      openclawWorkspaceDocument: spec.openclawWorkspaceDocument,
      contentHash: spec.contentHash,
      createdAt: spec.createdAt
    };
  }
}
