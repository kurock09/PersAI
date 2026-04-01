import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter,
  type RuntimeMediaArtifact
} from "./assistant-runtime-adapter.types";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { EnforceAbuseRateLimitService } from "./enforce-abuse-rate-limit.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

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

@Injectable()
export class HandleInternalTelegramTurnService {
  private readonly logger = new Logger(HandleInternalTelegramTurnService.name);

  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly enforceAbuseRateLimitService: EnforceAbuseRateLimitService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly prisma: WorkspaceManagementPrismaService
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

    const enrichedMessage = this.enrichMessageWithAttachments(input.message, input.attachments);

    const runtimeResponse = await this.assistantRuntimeAdapter.sendChannelTurn({
      assistantId: resolved.assistantId,
      publishedVersionId: resolved.publishedVersionId,
      surface: "telegram",
      threadId: input.threadId,
      userMessage: enrichedMessage,
      userTimezone: workspace.timezone,
      currentTimeIso: new Date().toISOString()
    });

    await this.persistTelegramAttachments(
      input,
      resolved.assistantId,
      resolved.workspaceId,
      resolved.userId,
      input.threadId
    );

    await this.trackWorkspaceQuotaUsageService.recordInboundTurnUsage({
      assistant: resolved.assistant,
      userContent: input.message,
      assistantContent: runtimeResponse.assistantMessage,
      source: "telegram_turn_sync"
    });
    await this.consumeBootstrapBestEffort(resolved.assistantId);

    return runtimeResponse;
  }

  private async persistTelegramAttachments(
    input: InternalTelegramTurnRequest,
    assistantId: string,
    workspaceId: string,
    userId: string,
    threadId: string
  ): Promise<void> {
    const attachments = input.attachments;
    if (!attachments || attachments.length === 0) return;

    let chat = await this.chatRepository.findChatBySurfaceThread(assistantId, "telegram", threadId);
    if (!chat) {
      chat = await this.chatRepository.createChat({
        assistantId,
        userId,
        workspaceId,
        surface: "telegram",
        surfaceThreadKey: threadId,
        title: null
      });
    }

    const userMessage = await this.chatRepository.createMessage({
      chatId: chat.id,
      assistantId,
      author: "user",
      content: input.message
    });

    for (const att of attachments) {
      try {
        await this.attachmentRepository.create({
          messageId: userMessage.id,
          chatId: chat.id,
          assistantId,
          workspaceId,
          attachmentType: att.type,
          storagePath: att.storagePath,
          originalFilename: att.originalFilename,
          mimeType: att.mimeType,
          sizeBytes: BigInt(att.sizeBytes),
          durationMs: null,
          width: null,
          height: null,
          processingStatus: "ready",
          transcription: att.transcription ?? null,
          metadata: { source: "telegram_inbound" }
        });
      } catch (error) {
        this.logger.warn(`Failed to persist Telegram attachment: ${att.storagePath}`, error);
      }
    }
  }

  private enrichMessageWithAttachments(
    message: string,
    attachments?: InternalTelegramAttachmentInput[]
  ): string {
    if (!attachments || attachments.length === 0) return message;
    const lines = attachments.map((a) => {
      const name = a.originalFilename ? ` "${a.originalFilename}"` : "";
      return `- media/${a.storagePath} (${a.type}${name})`;
    });
    const prefix = `[Files attached by user:\n${lines.join("\n")}\nYou can read or reference them by their path.]`;
    return `${prefix}\n${message}`;
  }

  private async consumeBootstrapBestEffort(assistantId: string): Promise<void> {
    try {
      await this.assistantRuntimeAdapter.consumeBootstrapWorkspace(assistantId);
    } catch (error) {
      console.warn("[telegram-turn] Non-fatal: failed to consume BOOTSTRAP.md:", error);
    }
  }
}
