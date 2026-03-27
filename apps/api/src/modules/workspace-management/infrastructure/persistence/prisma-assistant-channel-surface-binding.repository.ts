import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AssistantChannelSurfaceBinding as PrismaAssistantChannelSurfaceBinding } from "@prisma/client";
import type {
  AssistantChannelSurfaceBinding,
  AssistantIntegrationProviderKey,
  AssistantIntegrationSurfaceType
} from "../../domain/assistant-channel-surface-binding.entity";
import type {
  AssistantChannelSurfaceBindingRepository,
  UpsertAssistantChannelSurfaceBindingInput
} from "../../domain/assistant-channel-surface-binding.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantChannelSurfaceBindingRepository implements AssistantChannelSurfaceBindingRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  private toNullableJsonInput(
    value: Record<string, unknown> | null
  ): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
    return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
  }

  async findByAssistantProviderSurface(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType
  ): Promise<AssistantChannelSurfaceBinding | null> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.findUnique({
      where: {
        assistantId_providerKey_surfaceType: {
          assistantId,
          providerKey,
          surfaceType
        }
      }
    });

    return binding === null ? null : this.toDomain(binding);
  }

  async upsert(
    input: UpsertAssistantChannelSurfaceBindingInput
  ): Promise<AssistantChannelSurfaceBinding> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.upsert({
      where: {
        assistantId_providerKey_surfaceType: {
          assistantId: input.assistantId,
          providerKey: input.providerKey,
          surfaceType: input.surfaceType
        }
      },
      create: {
        assistantId: input.assistantId,
        providerKey: input.providerKey,
        surfaceType: input.surfaceType,
        bindingState: input.bindingState,
        tokenFingerprint: input.tokenFingerprint,
        tokenLastFour: input.tokenLastFour,
        policy: this.toNullableJsonInput(input.policy),
        config: this.toNullableJsonInput(input.config),
        metadata: this.toNullableJsonInput(input.metadata),
        connectedAt: input.connectedAt,
        disconnectedAt: input.disconnectedAt
      },
      update: {
        bindingState: input.bindingState,
        tokenFingerprint: input.tokenFingerprint,
        tokenLastFour: input.tokenLastFour,
        policy: this.toNullableJsonInput(input.policy),
        config: this.toNullableJsonInput(input.config),
        metadata: this.toNullableJsonInput(input.metadata),
        connectedAt: input.connectedAt,
        disconnectedAt: input.disconnectedAt
      }
    });

    return this.toDomain(binding);
  }

  async patchMetadata(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    patch: Record<string, unknown>
  ): Promise<void> {
    const existing = await this.findByAssistantProviderSurface(
      assistantId,
      providerKey,
      surfaceType
    );
    if (!existing) return;
    const current =
      existing.metadata !== null &&
      typeof existing.metadata === "object" &&
      !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {};
    const merged = { ...current, ...patch };
    await this.prisma.assistantChannelSurfaceBinding.update({
      where: {
        assistantId_providerKey_surfaceType: { assistantId, providerKey, surfaceType }
      },
      data: { metadata: merged as Prisma.InputJsonValue }
    });
  }

  async hasActiveBindingForProvider(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey
  ): Promise<boolean> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
      where: {
        assistantId,
        providerKey,
        bindingState: "active"
      },
      select: { id: true }
    });

    return binding !== null;
  }

  private toDomain(binding: PrismaAssistantChannelSurfaceBinding): AssistantChannelSurfaceBinding {
    return {
      id: binding.id,
      assistantId: binding.assistantId,
      providerKey: binding.providerKey,
      surfaceType: binding.surfaceType,
      bindingState: binding.bindingState,
      tokenFingerprint: binding.tokenFingerprint,
      tokenLastFour: binding.tokenLastFour,
      policy: binding.policy,
      config: binding.config,
      metadata: binding.metadata,
      connectedAt: binding.connectedAt,
      disconnectedAt: binding.disconnectedAt,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt
    };
  }
}
