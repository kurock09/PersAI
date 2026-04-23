import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BuildReminderContextSnapshotService } from "./build-reminder-context-snapshot.service";
import {
  computeReminderNextRunAtMs,
  parseReminderSchedule,
  type ReminderSchedule
} from "./reminder-schedule";

type ScheduledActionControlAction = "create" | "pause" | "resume" | "cancel";
type ScheduledActionAudience = "user" | "assistant";
const SCHEDULED_ACTION_THREAD_PREFIX = "system:scheduled-action:";

type CreateScheduledActionControlRequest = {
  assistantId: string;
  action: "create";
  audience: ScheduledActionAudience;
  title: string;
  reminderText: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  contextSessionKey?: string;
  conversationContext?: ScheduledActionConversationContext;
  runAt?: string;
  delayMs?: number;
  everyMs?: number;
  anchorAt?: string;
  cronExpr?: string;
  timezone?: string;
  contextMessages?: number;
};

type UpdateScheduledActionControlRequest = {
  assistantId: string;
  action: "pause" | "resume" | "cancel";
  taskId: string;
};

type ScheduledActionConversationContext = {
  channel: string;
  externalThreadKey: string;
};

export type InternalScheduledActionControlRequest =
  | CreateScheduledActionControlRequest
  | UpdateScheduledActionControlRequest;

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalJsonObject(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeScheduledActionConversationContext(
  value: unknown
): ScheduledActionConversationContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const channel = typeof value.channel === "string" ? value.channel.trim() : "";
  const externalThreadKey =
    typeof value.externalThreadKey === "string" ? value.externalThreadKey.trim() : "";
  if (!channel || !externalThreadKey) {
    throw new BadRequestException(
      "conversationContext must include non-empty channel and externalThreadKey."
    );
  }
  return {
    channel,
    externalThreadKey
  };
}

type StoredTelegramReminderTarget = {
  chatId: string;
  chatType: string;
  title: string | null;
  username: string | null;
  source: "telegram_dm" | "telegram_group" | "web_telegram_dm";
  updatedAt: string;
};

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

function parseTelegramChatIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const marker = ":telegram:";
  const index = sessionKey.indexOf(marker);
  if (index === -1) {
    return undefined;
  }
  const chatId = sessionKey.slice(index + marker.length).trim();
  return chatId.length > 0 ? chatId : undefined;
}

function normalizeBindingMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeReminderTaskTargetsMap(
  metadata: Record<string, unknown>
): Record<string, StoredTelegramReminderTarget> {
  const raw = metadata.reminderTaskTargets;
  if (!isRecord(raw)) {
    return {};
  }
  const entries = Object.entries(raw)
    .map(([jobId, target]) => [jobId, normalizeTelegramReminderTarget(target)] as const)
    .filter((entry): entry is readonly [string, StoredTelegramReminderTarget] => entry[1] !== null);
  return Object.fromEntries(entries);
}

function resolveTelegramReminderTargetForCreate(params: {
  metadata: Record<string, unknown>;
  contextSessionKey?: string;
  conversationContext?: ScheduledActionConversationContext;
}): StoredTelegramReminderTarget | null {
  const { metadata, contextSessionKey, conversationContext } = params;
  const contextChatId =
    conversationContext?.channel.toLowerCase() === "telegram"
      ? conversationContext.externalThreadKey
      : parseTelegramChatIdFromSessionKey(contextSessionKey);
  const dmChatId =
    typeof metadata.telegramDmChatId === "string" ? metadata.telegramDmChatId.trim() : "";
  const dmUsername =
    typeof metadata.telegramDmUsername === "string" ? metadata.telegramDmUsername.trim() : "";
  const groupChatId =
    typeof metadata.telegramLastGroupChatId === "string"
      ? metadata.telegramLastGroupChatId.trim()
      : "";
  const groupChatType =
    typeof metadata.telegramLastGroupChatType === "string"
      ? metadata.telegramLastGroupChatType.trim()
      : "";
  const groupTitle =
    typeof metadata.telegramLastGroupChatTitle === "string"
      ? metadata.telegramLastGroupChatTitle.trim()
      : "";
  const genericChatId =
    typeof metadata.reminderDeliveryChatId === "string"
      ? metadata.reminderDeliveryChatId.trim()
      : "";
  const genericChatType =
    typeof metadata.reminderDeliveryChatType === "string"
      ? metadata.reminderDeliveryChatType.trim()
      : "";
  const genericTitle =
    typeof metadata.reminderDeliveryChatTitle === "string"
      ? metadata.reminderDeliveryChatTitle.trim()
      : "";
  const genericUsername =
    typeof metadata.reminderDeliveryUsername === "string"
      ? metadata.reminderDeliveryUsername.trim()
      : "";

  if (contextChatId) {
    if (contextChatId === dmChatId) {
      return {
        chatId: dmChatId,
        chatType: "private",
        title: null,
        username: dmUsername || null,
        source: "telegram_dm",
        updatedAt: new Date().toISOString()
      };
    }
    if (
      contextChatId === groupChatId &&
      (groupChatType === "group" || groupChatType === "supergroup")
    ) {
      return {
        chatId: groupChatId,
        chatType: groupChatType,
        title: groupTitle || null,
        username: null,
        source: "telegram_group",
        updatedAt: new Date().toISOString()
      };
    }
    if (contextChatId === genericChatId && genericChatType) {
      return {
        chatId: genericChatId,
        chatType: genericChatType,
        title: genericTitle || null,
        username: genericChatType === "private" ? genericUsername || null : null,
        source: genericChatType === "private" ? "telegram_dm" : "telegram_group",
        updatedAt: new Date().toISOString()
      };
    }
    return null;
  }

  if (!dmChatId) {
    return null;
  }
  return {
    chatId: dmChatId,
    chatType: "private",
    title: null,
    username: dmUsername || null,
    source: "web_telegram_dm",
    updatedAt: new Date().toISOString()
  };
}

function resolveTaskSourceLabel(params: {
  audience: ScheduledActionAudience;
  schedule: ReminderSchedule;
  actionType?: string;
}): string {
  if (params.audience === "assistant") {
    const actionType = params.actionType?.trim();
    const actionLabel = actionType ? `Assistant ${actionType}` : "Assistant action";
    if (params.schedule.kind === "at") {
      return `${actionLabel} (one-time)`;
    }
    return `${actionLabel} (recurring)`;
  }
  if (params.schedule.kind === "at") {
    return "One-time reminder";
  }
  if (params.schedule.kind === "every" || params.schedule.kind === "cron") {
    return "Recurring reminder";
  }
  return "Scheduled reminder";
}

function buildSchedule(input: CreateScheduledActionControlRequest): ReminderSchedule {
  const definedCount =
    Number(Boolean(input.runAt)) +
    Number(input.delayMs !== undefined) +
    Number(input.everyMs !== undefined) +
    Number(Boolean(input.cronExpr));
  if (definedCount !== 1) {
    throw new BadRequestException(
      "Exactly one of runAt, delayMs, everyMs, or cronExpr is required."
    );
  }
  if (input.runAt) {
    const runAtMs = Date.parse(input.runAt);
    if (!Number.isFinite(runAtMs)) {
      throw new BadRequestException("runAt must be a valid ISO datetime.");
    }
    if (runAtMs <= Date.now()) {
      throw new BadRequestException(
        "Reminder time resolved to the past. Please ask again with a future time."
      );
    }
    return { kind: "at" as const, at: input.runAt };
  }
  if (input.delayMs !== undefined) {
    const delayMs = Math.max(1_000, Math.floor(input.delayMs));
    return { kind: "at" as const, at: new Date(Date.now() + delayMs).toISOString() };
  }
  if (input.everyMs !== undefined) {
    const anchorAtMs = input.anchorAt ? Date.parse(input.anchorAt) : undefined;
    if (input.anchorAt && !Number.isFinite(anchorAtMs)) {
      throw new BadRequestException("anchorAt must be a valid ISO datetime.");
    }
    return {
      kind: "every" as const,
      everyMs: Math.max(1, Math.floor(input.everyMs)),
      ...(anchorAtMs === undefined ? {} : { anchorMs: anchorAtMs })
    };
  }
  return {
    kind: "cron" as const,
    expr: input.cronExpr!,
    ...(input.timezone ? { tz: input.timezone } : {})
  };
}

// ADR-074 F1: window for the soft "duplicate audience create" guard. If the
// model creates two scheduled_actions with the same normalized title and
// opposite audiences within this window we emit a structured warn — diagnostic
// only, the rows are still created so we don't cause regressions on legitimate
// edge cases (e.g. a real assistant-side probe that happens to share a title
// with an unrelated user reminder).
const DUPLICATE_AUDIENCE_CREATE_WINDOW_MS = 60_000;

function normalizeTitleForDuplicateCheck(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

@Injectable()
export class ControlInternalScheduledActionService {
  private readonly logger = new Logger(ControlInternalScheduledActionService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly buildReminderContextSnapshotService: BuildReminderContextSnapshotService
  ) {}

  parseInput(body: unknown): InternalScheduledActionControlRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Body must be an object.");
    }

    const row = body as Record<string, unknown>;
    const assistantId = normalizeRequiredString(row.assistantId, "assistantId");
    const action = normalizeRequiredString(row.action, "action") as ScheduledActionControlAction;
    if (action !== "create" && action !== "pause" && action !== "resume" && action !== "cancel") {
      throw new BadRequestException("action must be create, pause, resume, or cancel.");
    }

    if (action === "create") {
      const audienceRaw = row.audience;
      if (audienceRaw !== "user" && audienceRaw !== "assistant") {
        throw new BadRequestException('audience must be "user" or "assistant".');
      }
      const delayMsRaw = row.delayMs;
      if (
        delayMsRaw !== undefined &&
        (typeof delayMsRaw !== "number" || !Number.isFinite(delayMsRaw) || delayMsRaw < 1)
      ) {
        throw new BadRequestException("delayMs must be a positive number.");
      }
      const everyMsRaw = row.everyMs;
      if (
        everyMsRaw !== undefined &&
        (typeof everyMsRaw !== "number" || !Number.isFinite(everyMsRaw) || everyMsRaw < 1)
      ) {
        throw new BadRequestException("everyMs must be a positive number.");
      }
      const contextMessagesRaw = row.contextMessages;
      if (
        contextMessagesRaw !== undefined &&
        (typeof contextMessagesRaw !== "number" ||
          !Number.isFinite(contextMessagesRaw) ||
          contextMessagesRaw < 0 ||
          contextMessagesRaw > 10)
      ) {
        throw new BadRequestException("contextMessages must be a number between 0 and 10.");
      }
      const actionType = normalizeOptionalString(row.actionType);
      const actionPayload = normalizeOptionalJsonObject(row.actionPayload);
      if (audienceRaw === "assistant" && actionType === undefined) {
        throw new BadRequestException('actionType is required when audience is "assistant".');
      }
      if (audienceRaw === "user" && (actionType !== undefined || actionPayload !== undefined)) {
        throw new BadRequestException(
          'actionType/actionPayload are only allowed when audience is "assistant".'
        );
      }
      if (
        "actionPayload" in row &&
        actionPayload === undefined &&
        row.actionPayload !== undefined
      ) {
        throw new BadRequestException("actionPayload must be a JSON object when provided.");
      }
      return {
        assistantId,
        action,
        audience: audienceRaw,
        title: normalizeRequiredString(row.title, "title"),
        reminderText:
          normalizeOptionalString(row.reminderText) ?? normalizeRequiredString(row.title, "title"),
        ...(actionType === undefined ? {} : { actionType }),
        ...(actionPayload === undefined ? {} : { actionPayload }),
        ...(normalizeOptionalString(row.contextSessionKey)
          ? { contextSessionKey: normalizeOptionalString(row.contextSessionKey)! }
          : normalizeOptionalString(row.sessionKey)
            ? { contextSessionKey: normalizeOptionalString(row.sessionKey)! }
            : {}),
        ...(normalizeScheduledActionConversationContext(row.conversationContext)
          ? {
              conversationContext: normalizeScheduledActionConversationContext(
                row.conversationContext
              )!
            }
          : {}),
        ...(normalizeOptionalString(row.runAt)
          ? { runAt: normalizeOptionalString(row.runAt)! }
          : {}),
        ...(delayMsRaw !== undefined ? { delayMs: delayMsRaw as number } : {}),
        ...(everyMsRaw !== undefined ? { everyMs: everyMsRaw as number } : {}),
        ...(normalizeOptionalString(row.anchorAt)
          ? { anchorAt: normalizeOptionalString(row.anchorAt)! }
          : {}),
        ...(normalizeOptionalString(row.cronExpr)
          ? { cronExpr: normalizeOptionalString(row.cronExpr)! }
          : {}),
        ...(normalizeOptionalString(row.timezone)
          ? { timezone: normalizeOptionalString(row.timezone)! }
          : {}),
        ...(contextMessagesRaw !== undefined
          ? { contextMessages: contextMessagesRaw as number }
          : {})
      };
    }

    return {
      assistantId,
      action,
      taskId: normalizeRequiredString(row.taskId, "taskId")
    };
  }

  async execute(input: InternalScheduledActionControlRequest): Promise<unknown> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    if (input.action === "create") {
      return this.createScheduledAction(assistant, input);
    }

    const task = await this.prisma.assistantTaskRegistryItem.findFirst({
      where: { id: input.taskId, assistantId: assistant.id },
      select: {
        id: true,
        title: true,
        audience: true,
        actionType: true,
        controlStatus: true,
        nextRunAt: true,
        externalRef: true,
        scheduleJson: true
      }
    });
    if (task === null) {
      throw new NotFoundException("Task not found.");
    }

    const nativeSchedule = parseReminderSchedule(task.scheduleJson);
    if (nativeSchedule !== null) {
      return this.controlNativeScheduledAction({
        assistantId: assistant.id,
        action: input.action,
        task: {
          id: task.id,
          title: task.title,
          audience: task.audience,
          actionType: task.actionType,
          controlStatus: task.controlStatus,
          nextRunAt: task.nextRunAt,
          externalRef: task.externalRef,
          schedule: nativeSchedule
        }
      });
    }

    const legacyExternalRef = task.externalRef ?? task.id;
    if (input.action === "cancel") {
      await this.prisma.assistantTaskRegistryItem.delete({
        where: { id: task.id }
      });
      if (task.audience === "user") {
        await this.deleteTelegramReminderTarget(assistant.id, legacyExternalRef);
      }
      return {
        ok: true,
        cancelled: true,
        taskId: task.id,
        title: task.title
      };
    }
    throw new ConflictException(
      "This scheduled action still points at a retired legacy scheduler. Cancel and recreate it to continue."
    );
  }

  private async createScheduledAction(
    assistant: { id: string; userId: string; workspaceId: string },
    input: CreateScheduledActionControlRequest
  ): Promise<unknown> {
    if (
      input.audience === "assistant" &&
      input.contextSessionKey?.startsWith(SCHEDULED_ACTION_THREAD_PREFIX)
    ) {
      throw new BadRequestException(
        'Nested assistant scheduled_action creation is not allowed during assistant background runs. Create audience="user" for any visible follow-up.'
      );
    }
    const schedule = buildSchedule(input);
    const nextRunAtMs = computeReminderNextRunAtMs(schedule, Date.now());
    if (nextRunAtMs === undefined) {
      throw new BadRequestException(
        "Scheduled time resolved to the past. Please ask again with a future time."
      );
    }
    const externalRef = randomUUID();
    const payloadText = await this.buildReminderContextSnapshotService.execute({
      assistantId: assistant.id,
      reminderText: input.reminderText,
      ...(input.contextMessages === undefined ? {} : { contextMessages: input.contextMessages }),
      ...(input.conversationContext === undefined
        ? {}
        : { conversationContext: input.conversationContext })
    });
    const created = await this.prisma.assistantTaskRegistryItem.create({
      data: {
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        title: input.title,
        sourceSurface: "web",
        sourceLabel: resolveTaskSourceLabel({
          audience: input.audience,
          schedule,
          ...(input.actionType === undefined ? {} : { actionType: input.actionType })
        }),
        audience: input.audience,
        actionType: input.actionType ?? null,
        actionPayloadJson:
          input.actionPayload === undefined
            ? Prisma.DbNull
            : (input.actionPayload as unknown as Prisma.InputJsonValue),
        controlStatus: "active",
        nextRunAt: new Date(nextRunAtMs),
        disabledAt: null,
        cancelledAt: null,
        externalRef,
        payloadText,
        scheduleJson: schedule as unknown as Prisma.InputJsonValue,
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      },
      select: {
        id: true,
        title: true,
        audience: true,
        actionType: true,
        controlStatus: true,
        nextRunAt: true
      }
    });
    if (input.audience === "user") {
      await this.persistTelegramReminderTarget(
        assistant.id,
        externalRef,
        input.conversationContext,
        input.contextSessionKey
      );
    }
    await this.warnIfDuplicateAudienceCreate({
      assistantId: assistant.id,
      newTaskId: created.id,
      title: input.title,
      audience: input.audience
    });

    return {
      ok: true,
      created: true,
      task: {
        id: created.id,
        title: created.title,
        audience: created.audience,
        actionType: created.actionType,
        controlStatus: created.controlStatus,
        nextRunAt: created.nextRunAt?.toISOString() ?? null
      }
    };
  }

  private async controlNativeScheduledAction(input: {
    assistantId: string;
    action: "pause" | "resume" | "cancel";
    task: {
      id: string;
      title: string;
      audience: ScheduledActionAudience;
      actionType: string | null;
      controlStatus: "active" | "disabled" | "cancelled";
      nextRunAt: Date | null;
      externalRef: string | null;
      schedule: ReminderSchedule;
    };
  }): Promise<unknown> {
    const externalRef = input.task.externalRef ?? input.task.id;
    if (input.action === "cancel") {
      await this.prisma.assistantTaskRegistryItem.delete({
        where: { id: input.task.id }
      });
      if (input.task.audience === "user") {
        await this.deleteTelegramReminderTarget(input.assistantId, externalRef);
      }
      return {
        ok: true,
        cancelled: true,
        taskId: input.task.id,
        title: input.task.title
      };
    }

    const resumedNextRunAt =
      input.action === "resume"
        ? this.resolveResumedNextRunAt(input.task.schedule, input.task.nextRunAt)
        : input.task.nextRunAt;

    await this.prisma.assistantTaskRegistryItem.update({
      where: { id: input.task.id },
      data: {
        controlStatus: input.action === "pause" ? "disabled" : "active",
        nextRunAt: resumedNextRunAt,
        disabledAt: input.action === "pause" ? new Date() : null,
        cancelledAt: null,
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });

    return {
      ok: true,
      [input.action === "pause" ? "paused" : "resumed"]: true,
      taskId: input.task.id,
      title: input.task.title
    };
  }

  private resolveResumedNextRunAt(
    schedule: ReminderSchedule,
    existingNextRunAt: Date | null
  ): Date | null {
    const nowMs = Date.now();
    if (existingNextRunAt !== null && existingNextRunAt.getTime() > nowMs) {
      return existingNextRunAt;
    }
    const nextRunAtMs = computeReminderNextRunAtMs(schedule, nowMs);
    if (nextRunAtMs === undefined) {
      throw new BadRequestException(
        "This scheduled action no longer resolves to a future time. Please create a new scheduled action."
      );
    }
    return new Date(nextRunAtMs);
  }

  private async persistTelegramReminderTarget(
    assistantId: string,
    externalRef: string,
    conversationContext: ScheduledActionConversationContext | undefined,
    contextSessionKey: string | undefined
  ): Promise<void> {
    const binding =
      await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
        assistantId,
        "telegram",
        "telegram_bot"
      );
    if (binding === null || binding.bindingState !== "active") {
      return;
    }

    const metadata = normalizeBindingMetadata(binding.metadata);
    const target = resolveTelegramReminderTargetForCreate({
      metadata,
      ...(conversationContext === undefined ? {} : { conversationContext }),
      ...(contextSessionKey === undefined ? {} : { contextSessionKey })
    });
    if (target === null) {
      return;
    }

    const reminderTaskTargets = normalizeReminderTaskTargetsMap(metadata);
    reminderTaskTargets[externalRef] = target;
    await this.assistantChannelSurfaceBindingRepository.patchMetadata(
      assistantId,
      "telegram",
      "telegram_bot",
      { reminderTaskTargets }
    );
  }

  // ADR-074 F1: soft "duplicate audience create" guard. The model has been
  // observed to create both audience="user" + audience="assistant" in a single
  // turn for the same intent (e.g. "поставь себе задачу пнуть меня через 2 мин").
  // The new prompt + catalog guidance forbid that, but we still emit a
  // structured warn here so we can spot regressions in GKE without scraping
  // raw `assistant_task_registry_items`. We DO NOT block the second create —
  // false positives would silently break legitimate cases (an assistant probe
  // that incidentally shares a title with an unrelated user reminder).
  private async warnIfDuplicateAudienceCreate(input: {
    assistantId: string;
    newTaskId: string;
    title: string;
    audience: ScheduledActionAudience;
  }): Promise<void> {
    const oppositeAudience: ScheduledActionAudience =
      input.audience === "user" ? "assistant" : "user";
    const since = new Date(Date.now() - DUPLICATE_AUDIENCE_CREATE_WINDOW_MS);
    const normalizedTitle = normalizeTitleForDuplicateCheck(input.title);
    let recent: Array<{ id: string; title: string; audience: ScheduledActionAudience }>;
    try {
      recent = await this.prisma.assistantTaskRegistryItem.findMany({
        where: {
          assistantId: input.assistantId,
          audience: oppositeAudience,
          createdAt: { gte: since },
          id: { not: input.newTaskId }
        },
        select: { id: true, title: true, audience: true },
        take: 10
      });
    } catch {
      return;
    }
    const match = recent.find(
      (row) => normalizeTitleForDuplicateCheck(row.title) === normalizedTitle
    );
    if (match === undefined) {
      return;
    }
    this.logger.warn({
      event: "duplicate_audience_create_detected",
      assistantId: input.assistantId,
      newTaskId: input.newTaskId,
      newTaskAudience: input.audience,
      siblingTaskId: match.id,
      siblingAudience: match.audience,
      normalizedTitle
    });
  }

  private async deleteTelegramReminderTarget(
    assistantId: string,
    externalRef: string
  ): Promise<void> {
    const binding =
      await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
        assistantId,
        "telegram",
        "telegram_bot"
      );
    if (binding === null || binding.bindingState !== "active") {
      return;
    }

    const metadata = normalizeBindingMetadata(binding.metadata);
    const reminderTaskTargets = normalizeReminderTaskTargetsMap(metadata);
    if (!(externalRef in reminderTaskTargets)) {
      return;
    }
    delete reminderTaskTargets[externalRef];
    await this.assistantChannelSurfaceBindingRepository.patchMetadata(
      assistantId,
      "telegram",
      "telegram_bot",
      { reminderTaskTargets }
    );
  }
}
