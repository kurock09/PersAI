import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { RenderAssistantInboundSurfaceMessageService } from "./render-assistant-inbound-surface-message.service";
import {
  createAssistantInboundConflict,
  toAssistantInboundFailurePayload
} from "./assistant-inbound-error";

const REMINDER_WEB_CHAT_THREAD_KEY = "system:reminders";
const REMINDER_WEB_CHAT_TITLE = "Reminders";
const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";

export interface InternalCronFireRequest {
  assistantId: string;
  jobId: string;
  action: "finished";
  status: "ok" | "error" | "skipped";
  summary?: string;
  error?: string;
  runAtMs?: number;
  sessionId?: string;
  nextRunAtMs?: number;
}

const REMINDER_REPLAY_PROVIDER_KEY = "system_notifications";
const REMINDER_REPLAY_SURFACE_TYPE = "system_notification";
const REMINDER_REPLAY_CLAIM_STALE_MS = 120_000;
const REMINDER_REPLAY_WAIT_MS = 8_000;
const REMINDER_REPLAY_POLL_MS = 250;

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type StoredTelegramReminderTarget = {
  chatId: string;
  chatType: string;
  title: string | null;
  username: string | null;
  source: "telegram_dm" | "telegram_group" | "web_telegram_dm";
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBindingMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeTelegramReminderTarget(value: unknown): StoredTelegramReminderTarget | null {
  if (!isRecord(value)) {
    return null;
  }
  const chatId = typeof value.chatId === "string" ? value.chatId.trim() : "";
  const chatType = typeof value.chatType === "string" ? value.chatType.trim() : "";
  const source = value.source;
  if (!chatId || !chatType) {
    return null;
  }
  if (source !== "telegram_dm" && source !== "telegram_group" && source !== "web_telegram_dm") {
    return null;
  }
  return {
    chatId,
    chatType,
    title: typeof value.title === "string" ? value.title.trim() || null : null,
    username: typeof value.username === "string" ? value.username.trim() || null : null,
    source,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
        ? value.updatedAt
        : new Date().toISOString()
  };
}

function resolveTaskTelegramTarget(metadata: Record<string, unknown>, jobId: string) {
  const reminderTaskTargets = metadata.reminderTaskTargets;
  if (!isRecord(reminderTaskTargets)) {
    return null;
  }
  return normalizeTelegramReminderTarget(reminderTaskTargets[jobId]);
}

function resolveDefaultTelegramDmTarget(
  metadata: Record<string, unknown>
): StoredTelegramReminderTarget | null {
  const dmChatId =
    typeof metadata.telegramDmChatId === "string" ? metadata.telegramDmChatId.trim() : "";
  if (dmChatId) {
    return {
      chatId: dmChatId,
      chatType: "private",
      title: null,
      username:
        typeof metadata.telegramDmUsername === "string"
          ? metadata.telegramDmUsername.trim() || null
          : null,
      source: "web_telegram_dm",
      updatedAt:
        typeof metadata.telegramDmUpdatedAt === "string" &&
        metadata.telegramDmUpdatedAt.trim().length > 0
          ? metadata.telegramDmUpdatedAt
          : new Date().toISOString()
    };
  }

  const legacyChatId =
    typeof metadata.reminderDeliveryChatId === "string"
      ? metadata.reminderDeliveryChatId.trim()
      : "";
  const legacyChatType =
    typeof metadata.reminderDeliveryChatType === "string"
      ? metadata.reminderDeliveryChatType.trim()
      : "";
  if (!legacyChatId || legacyChatType !== "private") {
    return null;
  }
  return {
    chatId: legacyChatId,
    chatType: "private",
    title: null,
    username:
      typeof metadata.reminderDeliveryUsername === "string"
        ? metadata.reminderDeliveryUsername.trim() || null
        : null,
    source: "web_telegram_dm",
    updatedAt:
      typeof metadata.reminderDeliveryUpdatedAt === "string" &&
      metadata.reminderDeliveryUpdatedAt.trim().length > 0
        ? metadata.reminderDeliveryUpdatedAt
        : new Date().toISOString()
  };
}

function stripReminderContextArtifact(value: string): string {
  const markerIndex = value.indexOf(REMINDER_CONTEXT_MARKER);
  if (markerIndex === -1) {
    return value.trim();
  }
  return value.slice(0, markerIndex).trim();
}

function buildReminderReplayKey(input: InternalCronFireRequest): string {
  if (input.sessionId) {
    return `session:${input.sessionId}`;
  }
  return `job:${input.jobId}:run:${typeof input.runAtMs === "number" ? input.runAtMs : "na"}:status:${input.status}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class HandleInternalCronFireService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly renderAssistantInboundSurfaceMessageService: RenderAssistantInboundSurfaceMessageService,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  parseInput(assistantId: string, payload: unknown): InternalCronFireRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Cron fire payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const jobId = normalizeOptionalTrimmedString(body.jobId);
    const action = body.action;
    const status = body.status;
    const runAtMs = body.runAtMs;
    const sessionId = normalizeOptionalTrimmedString(body.sessionId);
    const nextRunAtMs = body.nextRunAtMs;

    if (!assistantId.trim()) {
      throw new BadRequestException("assistantId is required.");
    }
    if (!jobId) {
      throw new BadRequestException("jobId is required.");
    }
    if (action !== "finished") {
      throw new BadRequestException("Only cron finished webhook events are supported.");
    }
    if (status !== "ok" && status !== "error" && status !== "skipped") {
      throw new BadRequestException("status must be ok, error, or skipped.");
    }
    if (
      runAtMs !== undefined &&
      runAtMs !== null &&
      (typeof runAtMs !== "number" || !Number.isFinite(runAtMs))
    ) {
      throw new BadRequestException("runAtMs must be a finite number, null, or omitted.");
    }
    if (
      nextRunAtMs !== undefined &&
      nextRunAtMs !== null &&
      (typeof nextRunAtMs !== "number" || !Number.isFinite(nextRunAtMs))
    ) {
      throw new BadRequestException("nextRunAtMs must be a finite number, null, or omitted.");
    }

    const summary = normalizeOptionalTrimmedString(body.summary);
    const error = normalizeOptionalTrimmedString(body.error);

    return {
      assistantId: assistantId.trim(),
      jobId,
      action,
      status,
      ...(summary ? { summary } : {}),
      ...(error ? { error } : {}),
      ...(typeof runAtMs === "number" ? { runAtMs } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(typeof nextRunAtMs === "number" ? { nextRunAtMs } : {})
    };
  }

  async execute(
    input: InternalCronFireRequest
  ): Promise<{ ok: true; deliveredTo: "telegram" | "web" | "fallback_web" | "none" }> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: input.assistantId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        preferredNotificationChannel: true,
        channelSurfaceBindings: {
          where: {
            bindingState: "active",
            providerKey: { in: ["telegram", "whatsapp"] }
          },
          select: { providerKey: true, metadata: true }
        }
      }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    const replayKey = buildReminderReplayKey(input);
    const replayed = await this.claimOrReplayReminderDelivery(assistant.id, replayKey);
    if (replayed !== null) {
      return { ok: true, deliveredTo: replayed.deliveredTo };
    }

    try {
      await this.syncTaskRegistryFromCronRun(input);

      const preferred = assistant.preferredNotificationChannel;
      const hasExternalChannel =
        preferred !== "web" &&
        assistant.channelSurfaceBindings.some((binding) => binding.providerKey === preferred);

      const rawSummary = input.summary ? stripReminderContextArtifact(input.summary) : undefined;
      if (input.status !== "ok" || !rawSummary) {
        await this.bindingRepository.completeReminderDeliveryProcessing(
          assistant.id,
          REMINDER_REPLAY_PROVIDER_KEY,
          REMINDER_REPLAY_SURFACE_TYPE,
          {
            replayKey,
            deliveredTo: "none",
            completedAt: new Date().toISOString()
          }
        );
        return { ok: true, deliveredTo: "none" };
      }

      let summary = rawSummary;
      try {
        const resolved =
          await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
            input.assistantId
          );
        await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn({
          assistant: resolved.assistant,
          surface: "reminder_callback",
          isNewThread: false,
          activeSurfaceChatsCount: 0
        });
      } catch (error) {
        const failure = toAssistantInboundFailurePayload(error);
        summary = this.renderAssistantInboundSurfaceMessageService.renderError(
          "reminder_callback",
          failure.code,
          failure.message
        ).text;
      }

      if (preferred === "telegram") {
        const delivered = await this.tryDeliverReminderToTelegram({
          assistantId: assistant.id,
          jobId: input.jobId,
          summary,
          bindings: assistant.channelSurfaceBindings
        });
        if (delivered) {
          await this.bindingRepository.completeReminderDeliveryProcessing(
            assistant.id,
            REMINDER_REPLAY_PROVIDER_KEY,
            REMINDER_REPLAY_SURFACE_TYPE,
            {
              replayKey,
              deliveredTo: "telegram",
              completedAt: new Date().toISOString()
            }
          );
          return { ok: true, deliveredTo: "telegram" };
        }
      }

      const deliveredTo = hasExternalChannel ? "fallback_web" : "web";
      await this.deliverReminderToWeb({
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        content: summary
      });
      await this.bindingRepository.completeReminderDeliveryProcessing(
        assistant.id,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        {
          replayKey,
          deliveredTo,
          completedAt: new Date().toISOString()
        }
      );

      return { ok: true, deliveredTo };
    } catch (error) {
      await this.bindingRepository.releaseReminderDeliveryProcessing(
        assistant.id,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        replayKey
      );
      throw error;
    }
  }

  private async claimOrReplayReminderDelivery(
    assistantId: string,
    replayKey: string
  ): Promise<{ deliveredTo: "telegram" | "web" | "fallback_web" | "none" } | null> {
    const claim = await this.bindingRepository.claimReminderDeliveryProcessing(
      assistantId,
      REMINDER_REPLAY_PROVIDER_KEY,
      REMINDER_REPLAY_SURFACE_TYPE,
      replayKey,
      new Date(),
      REMINDER_REPLAY_CLAIM_STALE_MS
    );
    if (claim === "claimed") {
      return null;
    }
    if (claim === "duplicate_handled") {
      const completed = await this.bindingRepository.getCompletedReminderDeliveryProcessing(
        assistantId,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        replayKey
      );
      return completed ? { deliveredTo: completed.deliveredTo } : null;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < REMINDER_REPLAY_WAIT_MS) {
      const completed = await this.bindingRepository.getCompletedReminderDeliveryProcessing(
        assistantId,
        REMINDER_REPLAY_PROVIDER_KEY,
        REMINDER_REPLAY_SURFACE_TYPE,
        replayKey
      );
      if (completed !== null) {
        return { deliveredTo: completed.deliveredTo };
      }
      await delay(REMINDER_REPLAY_POLL_MS);
    }

    throw createAssistantInboundConflict(
      "reminder_delivery_inflight",
      "This reminder delivery is already being processed."
    );
  }

  private async tryDeliverReminderToTelegram(params: {
    assistantId: string;
    jobId: string;
    summary: string;
    bindings: Array<{ providerKey: string; metadata: unknown }>;
  }): Promise<boolean> {
    const telegramBinding = params.bindings.find((binding) => binding.providerKey === "telegram");
    if (!telegramBinding) {
      return false;
    }

    const metadata = normalizeBindingMetadata(telegramBinding.metadata);
    const target =
      resolveTaskTelegramTarget(metadata, params.jobId) ?? resolveDefaultTelegramDmTarget(metadata);
    if (!target) {
      return false;
    }

    const botToken =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        `telegram_bot:${params.assistantId}`
      );
    if (!botToken) {
      return false;
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target.chatId,
        text: params.summary
      })
    }).catch(() => null);

    return response?.ok === true;
  }

  private async syncTaskRegistryFromCronRun(input: InternalCronFireRequest): Promise<void> {
    const nextRunAtMs =
      typeof input.nextRunAtMs === "number" && Number.isFinite(input.nextRunAtMs)
        ? input.nextRunAtMs
        : undefined;
    const completedOneShot =
      input.status === "ok" && (nextRunAtMs === undefined || nextRunAtMs <= Date.now());

    if (completedOneShot) {
      await this.prisma.assistantTaskRegistryItem.deleteMany({
        where: {
          assistantId: input.assistantId,
          externalRef: input.jobId
        }
      });
      await this.deleteTelegramReminderTarget(input.assistantId, input.jobId);
      return;
    }

    if (nextRunAtMs !== undefined) {
      await this.prisma.assistantTaskRegistryItem.updateMany({
        where: {
          assistantId: input.assistantId,
          externalRef: input.jobId
        },
        data: {
          nextRunAt: new Date(nextRunAtMs),
          ...(input.status === "error"
            ? {}
            : { controlStatus: "active", disabledAt: null, cancelledAt: null })
        }
      });
    }
  }

  private async deleteTelegramReminderTarget(
    assistantId: string,
    externalRef: string
  ): Promise<void> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
      where: {
        assistantId,
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active"
      },
      select: { id: true, metadata: true }
    });
    if (binding === null) {
      return;
    }

    const metadata = normalizeBindingMetadata(binding.metadata);
    const reminderTaskTargets = isRecord(metadata.reminderTaskTargets)
      ? { ...metadata.reminderTaskTargets }
      : null;
    if (reminderTaskTargets === null || !(externalRef in reminderTaskTargets)) {
      return;
    }

    delete reminderTaskTargets[externalRef];
    await this.prisma.assistantChannelSurfaceBinding.update({
      where: { id: binding.id },
      data: {
        metadata: { ...metadata, reminderTaskTargets } as Prisma.InputJsonValue
      }
    });
  }

  private async deliverReminderToWeb(params: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    content: string;
  }): Promise<void> {
    const chat = await this.assistantChatRepository.findOrCreateChatBySurfaceThread({
      assistantId: params.assistantId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      surface: "web",
      surfaceThreadKey: REMINDER_WEB_CHAT_THREAD_KEY,
      title: REMINDER_WEB_CHAT_TITLE
    });

    await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: params.assistantId,
      author: "assistant",
      content: params.content
    });
  }
}
