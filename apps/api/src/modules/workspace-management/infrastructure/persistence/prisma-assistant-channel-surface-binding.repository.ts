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
  CompletedReminderReplayState,
  CompletedWebTurnReplayState,
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
  private static readonly WEB_ACTIVE_TURN_ID_KEY = "webActiveTurnId";
  private static readonly WEB_ACTIVE_TURN_CLAIMED_AT_KEY = "webActiveTurnClaimedAt";
  private static readonly WEB_LAST_COMPLETED_TURN_KEY = "webLastCompletedTurn";
  private static readonly REMINDER_ACTIVE_REPLAY_KEY = "reminderActiveReplayKey";
  private static readonly REMINDER_ACTIVE_REPLAY_CLAIMED_AT_KEY = "reminderActiveReplayClaimedAt";
  private static readonly REMINDER_LAST_COMPLETED_REPLAY_KEY = "reminderLastCompletedReplay";

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

  private readTrimmedString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readCompletedWebTurn(value: unknown): CompletedWebTurnReplayState | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const clientTurnId = this.readTrimmedString(row.clientTurnId);
    const chatId = this.readTrimmedString(row.chatId);
    const userMessageId = this.readTrimmedString(row.userMessageId);
    const assistantMessageId = this.readTrimmedString(row.assistantMessageId);
    const followUpAssistantMessageId = this.readTrimmedString(row.followUpAssistantMessageId);
    const respondedAt = this.readTrimmedString(row.respondedAt);
    const completedAt = this.readTrimmedString(row.completedAt);
    if (
      clientTurnId === null ||
      chatId === null ||
      userMessageId === null ||
      assistantMessageId === null ||
      respondedAt === null ||
      completedAt === null
    ) {
      return null;
    }
    const turnRouting = this.readTurnRoutingState(row.turnRouting);
    return {
      clientTurnId,
      chatId,
      userMessageId,
      assistantMessageId,
      ...(followUpAssistantMessageId === null ? {} : { followUpAssistantMessageId }),
      respondedAt,
      degradedByQuotaFallback: row.degradedByQuotaFallback === true,
      quotaFallbackReason: this.readTrimmedString(row.quotaFallbackReason),
      quotaFallbackModel: this.readTrimmedString(row.quotaFallbackModel),
      ...(turnRouting === undefined ? {} : { turnRouting }),
      completedAt
    };
  }

  private readTurnRoutingState(
    value: unknown
  ): CompletedWebTurnReplayState["turnRouting"] | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const mode = row.mode === "shadow" || row.mode === "active" ? row.mode : null;
    const executionMode =
      row.executionMode === "normal" ||
      row.executionMode === "premium" ||
      row.executionMode === "reasoning"
        ? row.executionMode
        : null;
    const source =
      row.source === "precheck" || row.source === "llm" || row.source === "fallback"
        ? row.source
        : null;
    if (mode === null || executionMode === null || source === null) {
      return null;
    }
    return {
      mode,
      executionMode,
      source
    };
  }

  private readCompletedReminderReplay(value: unknown): CompletedReminderReplayState | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const replayKey = this.readTrimmedString(row.replayKey);
    const completedAt = this.readTrimmedString(row.completedAt);
    const deliveredTo = row.deliveredTo;
    if (
      replayKey === null ||
      completedAt === null ||
      (deliveredTo !== "telegram" &&
        deliveredTo !== "web" &&
        deliveredTo !== "fallback_web" &&
        deliveredTo !== "none")
    ) {
      return null;
    }
    return {
      replayKey,
      deliveredTo,
      completedAt
    };
  }

  private async claimStringProcessing(
    tx: Prisma.TransactionClient,
    params: {
      assistantId: string;
      providerKey: AssistantIntegrationProviderKey;
      surfaceType: AssistantIntegrationSurfaceType;
      activeKey: string;
      activeClaimedAtKey: string;
      completedKey: string;
      identifier: string;
      claimedAt: Date;
      staleAfterMs: number;
      readCompleted: (value: unknown) => { clientTurnId?: string; replayKey?: string } | null;
    }
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight"> {
    const binding = await this.lockOrCreateBindingRow(
      tx,
      params.assistantId,
      params.providerKey,
      params.surfaceType
    );
    const metadata = binding.metadata;
    const completed = params.readCompleted(metadata[params.completedKey]);
    const completedId = completed?.clientTurnId ?? completed?.replayKey ?? null;
    if (completedId === params.identifier) {
      return "duplicate_handled";
    }

    const activeId = this.readTrimmedString(metadata[params.activeKey]);
    const activeClaimedAt = this.readDate(metadata[params.activeClaimedAtKey]);
    const activeClaimIsFresh =
      activeId === params.identifier &&
      activeClaimedAt !== null &&
      params.claimedAt.getTime() - activeClaimedAt.getTime() < params.staleAfterMs;
    if (activeClaimIsFresh) {
      return "duplicate_inflight";
    }

    await tx.assistantChannelSurfaceBinding.update({
      where: { id: binding.id },
      data: {
        metadata: {
          ...metadata,
          [params.activeKey]: params.identifier,
          [params.activeClaimedAtKey]: params.claimedAt.toISOString()
        } as Prisma.InputJsonValue
      }
    });
    return "claimed";
  }

  private async completeStringProcessing(
    tx: Prisma.TransactionClient,
    params: {
      assistantId: string;
      providerKey: AssistantIntegrationProviderKey;
      surfaceType: AssistantIntegrationSurfaceType;
      activeKey: string;
      activeClaimedAtKey: string;
      completedKey: string;
      identifier: string;
      completedState: Record<string, unknown>;
    }
  ): Promise<void> {
    const binding = await this.lockBindingRow(
      tx,
      params.assistantId,
      params.providerKey,
      params.surfaceType
    );
    if (!binding) {
      return;
    }
    const metadata = { ...binding.metadata };
    metadata[params.completedKey] = params.completedState;

    const activeId = this.readTrimmedString(metadata[params.activeKey]);
    if (activeId === params.identifier) {
      delete metadata[params.activeKey];
      delete metadata[params.activeClaimedAtKey];
    }

    await tx.assistantChannelSurfaceBinding.update({
      where: { id: binding.id },
      data: { metadata: metadata as Prisma.InputJsonValue }
    });
  }

  private async releaseStringProcessing(
    tx: Prisma.TransactionClient,
    params: {
      assistantId: string;
      providerKey: AssistantIntegrationProviderKey;
      surfaceType: AssistantIntegrationSurfaceType;
      activeKey: string;
      activeClaimedAtKey: string;
      identifier: string;
    }
  ): Promise<void> {
    const binding = await this.lockBindingRow(
      tx,
      params.assistantId,
      params.providerKey,
      params.surfaceType
    );
    if (!binding) {
      return;
    }

    const metadata = { ...binding.metadata };
    const activeId = this.readTrimmedString(metadata[params.activeKey]);
    if (activeId !== params.identifier) {
      return;
    }
    delete metadata[params.activeKey];
    delete metadata[params.activeClaimedAtKey];
    await tx.assistantChannelSurfaceBinding.update({
      where: { id: binding.id },
      data: { metadata: metadata as Prisma.InputJsonValue }
    });
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
      WHERE "assistant_id" = CAST(${assistantId} AS uuid)
        AND "provider_key" = CAST(${providerKey} AS "AssistantIntegrationProviderKey")
        AND "surface_type" = CAST(${surfaceType} AS "AssistantIntegrationSurfaceType")
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

  async claimWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    clientTurnId: string,
    claimedAt: Date,
    staleAfterMs: number
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight"> {
    return this.prisma.$transaction((tx) =>
      this.claimStringProcessing(tx, {
        assistantId,
        providerKey,
        surfaceType,
        activeKey: PrismaAssistantChannelSurfaceBindingRepository.WEB_ACTIVE_TURN_ID_KEY,
        activeClaimedAtKey:
          PrismaAssistantChannelSurfaceBindingRepository.WEB_ACTIVE_TURN_CLAIMED_AT_KEY,
        completedKey: PrismaAssistantChannelSurfaceBindingRepository.WEB_LAST_COMPLETED_TURN_KEY,
        identifier: clientTurnId,
        claimedAt,
        staleAfterMs,
        readCompleted: (value) => this.readCompletedWebTurn(value)
      })
    );
  }

  async getCompletedWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    clientTurnId: string
  ): Promise<CompletedWebTurnReplayState | null> {
    const binding = await this.findByAssistantProviderSurface(
      assistantId,
      providerKey,
      surfaceType
    );
    if (!binding) {
      return null;
    }
    const metadata = this.toMetadataRecord(binding.metadata);
    const completed = this.readCompletedWebTurn(
      metadata[PrismaAssistantChannelSurfaceBindingRepository.WEB_LAST_COMPLETED_TURN_KEY]
    );
    return completed?.clientTurnId === clientTurnId ? completed : null;
  }

  async completeWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    state: CompletedWebTurnReplayState
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.completeStringProcessing(tx, {
        assistantId,
        providerKey,
        surfaceType,
        activeKey: PrismaAssistantChannelSurfaceBindingRepository.WEB_ACTIVE_TURN_ID_KEY,
        activeClaimedAtKey:
          PrismaAssistantChannelSurfaceBindingRepository.WEB_ACTIVE_TURN_CLAIMED_AT_KEY,
        completedKey: PrismaAssistantChannelSurfaceBindingRepository.WEB_LAST_COMPLETED_TURN_KEY,
        identifier: state.clientTurnId,
        completedState: state
      })
    );
  }

  async releaseWebTurnProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    clientTurnId: string
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.releaseStringProcessing(tx, {
        assistantId,
        providerKey,
        surfaceType,
        activeKey: PrismaAssistantChannelSurfaceBindingRepository.WEB_ACTIVE_TURN_ID_KEY,
        activeClaimedAtKey:
          PrismaAssistantChannelSurfaceBindingRepository.WEB_ACTIVE_TURN_CLAIMED_AT_KEY,
        identifier: clientTurnId
      })
    );
  }

  async claimReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    replayKey: string,
    claimedAt: Date,
    staleAfterMs: number
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight"> {
    return this.prisma.$transaction((tx) =>
      this.claimStringProcessing(tx, {
        assistantId,
        providerKey,
        surfaceType,
        activeKey: PrismaAssistantChannelSurfaceBindingRepository.REMINDER_ACTIVE_REPLAY_KEY,
        activeClaimedAtKey:
          PrismaAssistantChannelSurfaceBindingRepository.REMINDER_ACTIVE_REPLAY_CLAIMED_AT_KEY,
        completedKey:
          PrismaAssistantChannelSurfaceBindingRepository.REMINDER_LAST_COMPLETED_REPLAY_KEY,
        identifier: replayKey,
        claimedAt,
        staleAfterMs,
        readCompleted: (value) => this.readCompletedReminderReplay(value)
      })
    );
  }

  async getCompletedReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    replayKey: string
  ): Promise<CompletedReminderReplayState | null> {
    const binding = await this.findByAssistantProviderSurface(
      assistantId,
      providerKey,
      surfaceType
    );
    if (!binding) {
      return null;
    }
    const metadata = this.toMetadataRecord(binding.metadata);
    const completed = this.readCompletedReminderReplay(
      metadata[PrismaAssistantChannelSurfaceBindingRepository.REMINDER_LAST_COMPLETED_REPLAY_KEY]
    );
    return completed?.replayKey === replayKey ? completed : null;
  }

  async completeReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    state: CompletedReminderReplayState
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.completeStringProcessing(tx, {
        assistantId,
        providerKey,
        surfaceType,
        activeKey: PrismaAssistantChannelSurfaceBindingRepository.REMINDER_ACTIVE_REPLAY_KEY,
        activeClaimedAtKey:
          PrismaAssistantChannelSurfaceBindingRepository.REMINDER_ACTIVE_REPLAY_CLAIMED_AT_KEY,
        completedKey:
          PrismaAssistantChannelSurfaceBindingRepository.REMINDER_LAST_COMPLETED_REPLAY_KEY,
        identifier: state.replayKey,
        completedState: state
      })
    );
  }

  async releaseReminderDeliveryProcessing(
    assistantId: string,
    providerKey: AssistantIntegrationProviderKey,
    surfaceType: AssistantIntegrationSurfaceType,
    replayKey: string
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.releaseStringProcessing(tx, {
        assistantId,
        providerKey,
        surfaceType,
        activeKey: PrismaAssistantChannelSurfaceBindingRepository.REMINDER_ACTIVE_REPLAY_KEY,
        activeClaimedAtKey:
          PrismaAssistantChannelSurfaceBindingRepository.REMINDER_ACTIVE_REPLAY_CLAIMED_AT_KEY,
        identifier: replayKey
      })
    );
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
