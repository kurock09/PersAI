import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const REMINDER_WEB_CHAT_THREAD_KEY = "system:reminders";
const REMINDER_WEB_CHAT_TITLE = "Reminders";

export interface InternalCronFireRequest {
  assistantId: string;
  jobId: string;
  action: "finished";
  status: "ok" | "error" | "skipped";
  summary?: string;
  error?: string;
  nextRunAtMs?: number;
}

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

@Injectable()
export class HandleInternalCronFireService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
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

    await this.syncTaskRegistryFromCronRun(input);

    const preferred = assistant.preferredNotificationChannel;
    const hasExternalChannel =
      preferred !== "web" &&
      assistant.channelSurfaceBindings.some((binding) => binding.providerKey === preferred);

    const summary = input.summary?.trim();
    if (input.status !== "ok" || !summary) {
      return { ok: true, deliveredTo: "none" };
    }

    if (preferred === "telegram") {
      const delivered = await this.tryDeliverReminderToTelegram({
        assistantId: assistant.id,
        summary,
        bindings: assistant.channelSurfaceBindings
      });
      if (delivered) {
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

    return { ok: true, deliveredTo };
  }

  private async tryDeliverReminderToTelegram(params: {
    assistantId: string;
    summary: string;
    bindings: Array<{ providerKey: string; metadata: unknown }>;
  }): Promise<boolean> {
    const telegramBinding = params.bindings.find((binding) => binding.providerKey === "telegram");
    if (!telegramBinding) {
      return false;
    }

    const metadata =
      telegramBinding.metadata &&
      typeof telegramBinding.metadata === "object" &&
      !Array.isArray(telegramBinding.metadata)
        ? (telegramBinding.metadata as Record<string, unknown>)
        : null;
    const reminderDeliveryChatId =
      typeof metadata?.reminderDeliveryChatId === "string"
        ? metadata.reminderDeliveryChatId.trim()
        : "";
    if (!reminderDeliveryChatId) {
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
        chat_id: reminderDeliveryChatId,
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

  private async deliverReminderToWeb(params: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    content: string;
  }): Promise<void> {
    const existingChat = await this.assistantChatRepository.findChatBySurfaceThread(
      params.assistantId,
      "web",
      REMINDER_WEB_CHAT_THREAD_KEY
    );
    const chat =
      existingChat ??
      (await this.assistantChatRepository.createChat({
        assistantId: params.assistantId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        surface: "web",
        surfaceThreadKey: REMINDER_WEB_CHAT_THREAD_KEY,
        title: REMINDER_WEB_CHAT_TITLE
      }));

    await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: params.assistantId,
      author: "assistant",
      content: params.content
    });
  }
}
