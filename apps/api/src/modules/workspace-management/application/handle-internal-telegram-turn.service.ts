import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter,
  type RuntimeMediaArtifact
} from "./assistant-runtime-adapter.types";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { EnforceAbuseRateLimitService } from "./enforce-abuse-rate-limit.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { InboundMediaService } from "./media/inbound-media.service";
import type { RawInboundAttachment } from "./media/media.types";

export interface InternalTelegramAttachmentInput {
  type: "image" | "audio" | "voice" | "video" | "document";
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
  transcription?: string;
}

export interface InternalTelegramTurnRequest {
  assistantId: string;
  threadId: string;
  message: string;
  attachments?: InternalTelegramAttachmentInput[];
}

export interface InternalTelegramTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function parseAttachments(raw: unknown): InternalTelegramAttachmentInput[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set(["image", "audio", "voice", "video", "document"]);
  const result: InternalTelegramAttachmentInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const type = typeof r.type === "string" ? r.type : "";
    const storagePath = typeof r.storagePath === "string" ? r.storagePath : "";
    const mimeType = typeof r.mimeType === "string" ? r.mimeType : "";
    const sizeBytes = typeof r.sizeBytes === "number" ? r.sizeBytes : 0;
    if (!validTypes.has(type) || !storagePath || !mimeType) continue;
    result.push({
      type: type as InternalTelegramAttachmentInput["type"],
      storagePath,
      mimeType,
      sizeBytes,
      originalFilename: typeof r.originalFilename === "string" ? r.originalFilename : null,
      ...(typeof r.transcription === "string" && r.transcription.length > 0
        ? { transcription: r.transcription }
        : {})
    });
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class HandleInternalTelegramTurnService {
  private readonly logger = new Logger(HandleInternalTelegramTurnService.name);
  private static readonly TELEGRAM_MEDIA_DOWNLOAD_ATTEMPTS = 6;
  private static readonly TELEGRAM_MEDIA_DOWNLOAD_DELAY_MS = 400;

  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly enforceAbuseRateLimitService: EnforceAbuseRateLimitService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly inboundMediaService: InboundMediaService
  ) {}

  parseInput(payload: unknown): InternalTelegramTurnRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Telegram turn payload must be an object.");
    }

    const row = payload as Record<string, unknown>;
    return {
      assistantId: normalizeRequiredString(row.assistantId, "assistantId"),
      threadId: normalizeRequiredString(row.threadId, "threadId"),
      message: normalizeRequiredString(row.message, "message"),
      attachments: parseAttachments(row.attachments)
    };
  }

  async execute(input: InternalTelegramTurnRequest): Promise<InternalTelegramTurnResult> {
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
      input.assistantId
    );

    await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn({
      assistant: resolved.assistant,
      surface: "telegram",
      isNewThread: false,
      activeSurfaceChatsCount: 0
    });
    await this.enforceAbuseRateLimitService.enforceAndRegisterAttempt({
      assistant: resolved.assistant,
      surface: "telegram"
    });

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: resolved.workspaceId },
      select: { timezone: true }
    });
    if (workspace === null) {
      throw new NotFoundException("Workspace does not exist for this assistant.");
    }

    let enrichedMessage = input.message;

    if (input.attachments && input.attachments.length > 0) {
      let chat = await this.chatRepository.findChatBySurfaceThread(
        resolved.assistantId,
        "telegram",
        input.threadId
      );
      if (!chat) {
        chat = await this.chatRepository.createChat({
          assistantId: resolved.assistantId,
          userId: resolved.userId,
          workspaceId: resolved.workspaceId,
          surface: "telegram",
          surfaceThreadKey: input.threadId,
          title: null
        });
      }

      const userMessage = await this.chatRepository.createMessage({
        chatId: chat.id,
        assistantId: resolved.assistantId,
        author: "user",
        content: input.message
      });

      const rawAttachments: RawInboundAttachment[] = await this.downloadTelegramAttachments(
        input.attachments,
        resolved.assistantId
      );

      const resolved2 = await this.inboundMediaService.resolve({
        channel: "telegram",
        assistantId: resolved.assistantId,
        chatId: chat.id,
        messageId: userMessage.id,
        workspaceId: resolved.workspaceId,
        userMessage: input.message,
        rawAttachments
      });
      enrichedMessage = resolved2.enrichedMessage;
    } else {
      enrichedMessage = input.message;
    }

    const runtimeResponse = await this.assistantRuntimeAdapter.sendChannelTurn({
      assistantId: resolved.assistantId,
      publishedVersionId: resolved.publishedVersionId,
      surface: "telegram",
      threadId: input.threadId,
      userMessage: enrichedMessage,
      userTimezone: workspace.timezone,
      currentTimeIso: new Date().toISOString()
    });

    await this.trackWorkspaceQuotaUsageService.recordInboundTurnUsage({
      assistant: resolved.assistant,
      userContent: input.message,
      assistantContent: runtimeResponse.assistantMessage,
      source: "telegram_turn_sync"
    });
    await this.consumeBootstrapBestEffort(resolved.assistantId);

    return runtimeResponse;
  }

  private async downloadTelegramAttachments(
    attachments: InternalTelegramAttachmentInput[],
    assistantId: string
  ): Promise<RawInboundAttachment[]> {
    const results: RawInboundAttachment[] = [];
    for (const att of attachments) {
      try {
        const downloaded = await this.downloadTelegramAttachmentWithRetry(
          assistantId,
          att.storagePath
        );
        if (!downloaded) continue;

        results.push({
          buffer: downloaded.buffer,
          mime: att.mimeType,
          originalFilename: att.originalFilename ?? `telegram-${att.type}`,
          source: "telegram_download"
        });
      } catch (err) {
        this.logger.warn(`Failed to download TG attachment ${att.storagePath}: ${String(err)}`);
      }
    }
    return results;
  }

  private async downloadTelegramAttachmentWithRetry(assistantId: string, storagePath: string) {
    for (
      let attempt = 1;
      attempt <= HandleInternalTelegramTurnService.TELEGRAM_MEDIA_DOWNLOAD_ATTEMPTS;
      attempt += 1
    ) {
      const downloaded = await this.assistantRuntimeAdapter.downloadChatMedia(
        assistantId,
        storagePath
      );
      if (downloaded) {
        if (attempt > 1) {
          this.logger.log(
            `TG attachment became available on retry ${attempt}/${HandleInternalTelegramTurnService.TELEGRAM_MEDIA_DOWNLOAD_ATTEMPTS}: ${storagePath}`
          );
        }
        return downloaded;
      }
      if (attempt < HandleInternalTelegramTurnService.TELEGRAM_MEDIA_DOWNLOAD_ATTEMPTS) {
        await delay(HandleInternalTelegramTurnService.TELEGRAM_MEDIA_DOWNLOAD_DELAY_MS * attempt);
      }
    }

    this.logger.warn(
      `TG attachment unavailable after ${HandleInternalTelegramTurnService.TELEGRAM_MEDIA_DOWNLOAD_ATTEMPTS} attempts: ${storagePath}`
    );
    return null;
  }

  private async consumeBootstrapBestEffort(assistantId: string): Promise<void> {
    try {
      await this.assistantRuntimeAdapter.consumeBootstrapWorkspace(assistantId);
    } catch (error) {
      console.warn("[telegram-turn] Non-fatal: failed to consume BOOTSTRAP.md:", error);
    }
  }
}
