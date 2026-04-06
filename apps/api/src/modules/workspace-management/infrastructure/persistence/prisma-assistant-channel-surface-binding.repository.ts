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

  private static readonly TELEGRAM_ACTIVE_UPDATE_ID_KEY = "telegramActiveUpdateId";
  private static readonly TELEGRAM_ACTIVE_UPDATE_CLAIMED_AT_KEY = "telegramActiveUpdateClaimedAt";
  private static readonly TELEGRAM_LAST_HANDLED_UPDATE_ID_KEY = "telegramLastHandledUpdateId";
  private static readonly TELEGRAM_LAST_HANDLED_UPDATE_AT_KEY = "telegramLastHandledUpdateAt";

  private toNullableJsonInput(
    value: Record<string, unknown> | null
  ): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
    return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
  }

  private toMetadataRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private readDate(value: unknown): Date | null {
    if (typeof value !== "string" || value.length === 0) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async lockBindingRow(
    tx: Prisma.TransactionClient,
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType
  ): Promise<{ id: string; metadata: Record<string, unknown> } | null> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; metadata: Prisma.JsonValue | null }>
    >(Prisma.sql`
      SELECT "id", "metadata"
      FROM "assistant_channel_surface_bindings"
      WHERE "assistant_id" = ${assistantId}
        AND "provider_key" = ${providerKey}
        AND "surface_type" = ${surfaceType}
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { id: row.id, metadata: this.toMetadataRecord(row.metadata) };
  }

  private async lockOrCreateBindingRow(
    tx: Prisma.TransactionClient,
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType
  ): Promise<{ id: string; metadata: Record<string, unknown> }> {
    const existing = await this.lockBindingRow(tx, assistantId, providerKey, surfaceType);
    if (existing !== null) {
      return existing;
    }

    try {
      const created = await tx.assistantChannelSurfaceBinding.create({
        data: {
          assistantId,
          providerKey,
          surfaceType,
          bindingState: "active",
          tokenFingerprint: null,
          tokenLastFour: null,
          policy: Prisma.DbNull,
          config: Prisma.DbNull,
          metadata: {} as Prisma.InputJsonValue,
          connectedAt: null,
          disconnectedAt: null
        },
        select: {
          id: true,
          metadata: true
        }
      });
      return { id: created.id, metadata: this.toMetadataRecord(created.metadata) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.lockBindingRow(tx, assistantId, providerKey, surfaceType);
        if (raced !== null) {
          return raced;
        }
      }
      throw error;
    }
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

  async claimTelegramUpdateProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    updateId: number,
    claimedAt: Date,
    staleAfterMs: number
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight" | "missing_binding"> {
    return this.prisma.$transaction(async (tx) => {
      const binding = await this.lockOrCreateBindingRow(tx, assistantId, providerKey, surfaceType);
      const metadata = binding.metadata;
      const lastHandled = this.readFiniteNumber(
        metadata[PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_LAST_HANDLED_UPDATE_ID_KEY]
      );
      if (lastHandled !== null && updateId <= lastHandled) {
        return "duplicate_handled";
      }

      const activeUpdateId = this.readFiniteNumber(
        metadata[PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_ID_KEY]
      );
      const activeClaimedAt = this.readDate(
        metadata[
          PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_CLAIMED_AT_KEY
        ]
      );
      const activeClaimIsFresh =
        activeUpdateId === updateId &&
        activeClaimedAt !== null &&
        claimedAt.getTime() - activeClaimedAt.getTime() < staleAfterMs;
      if (activeClaimIsFresh) {
        return "duplicate_inflight";
      }

      await tx.assistantChannelSurfaceBinding.update({
        where: { id: binding.id },
        data: {
          metadata: {
            ...metadata,
            [PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_ID_KEY]:
              updateId,
            [PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_CLAIMED_AT_KEY]:
              claimedAt.toISOString()
          } as Prisma.InputJsonValue
        }
      });
      return "claimed";
    });
  }

  async completeTelegramUpdateProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    updateId: number,
    completedAt: Date
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const binding = await this.lockBindingRow(tx, assistantId, providerKey, surfaceType);
      if (!binding) {
        return;
      }

      const metadata = { ...binding.metadata };
      const lastHandled = this.readFiniteNumber(
        metadata[PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_LAST_HANDLED_UPDATE_ID_KEY]
      );
      if (lastHandled === null || updateId > lastHandled) {
        metadata[
          PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_LAST_HANDLED_UPDATE_ID_KEY
        ] = updateId;
        metadata[
          PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_LAST_HANDLED_UPDATE_AT_KEY
        ] = completedAt.toISOString();
      }

      const activeUpdateId = this.readFiniteNumber(
        metadata[PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_ID_KEY]
      );
      if (activeUpdateId === updateId) {
        delete metadata[
          PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_ID_KEY
        ];
        delete metadata[
          PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_CLAIMED_AT_KEY
        ];
      }

      await tx.assistantChannelSurfaceBinding.update({
        where: { id: binding.id },
        data: { metadata: metadata as Prisma.InputJsonValue }
      });
    });
  }

  async releaseTelegramUpdateProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    updateId: number
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const binding = await this.lockBindingRow(tx, assistantId, providerKey, surfaceType);
      if (!binding) {
        return;
      }

      const metadata = { ...binding.metadata };
      const activeUpdateId = this.readFiniteNumber(
        metadata[PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_ID_KEY]
      );
      if (activeUpdateId !== updateId) {
        return;
      }

      delete metadata[PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_ID_KEY];
      delete metadata[
        PrismaAssistantChannelSurfaceBindingRepository.TELEGRAM_ACTIVE_UPDATE_CLAIMED_AT_KEY
      ];
      await tx.assistantChannelSurfaceBinding.update({
        where: { id: binding.id },
        data: { metadata: metadata as Prisma.InputJsonValue }
      });
    });
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
    const current = this.toMetadataRecord(existing.metadata);
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
