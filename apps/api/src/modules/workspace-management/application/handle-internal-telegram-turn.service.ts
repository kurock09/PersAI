import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { InboundMediaService } from "./media/inbound-media.service";
import type { RawInboundAttachment } from "./media/media.types";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  OverviewLatencyTraceService,
  type OverviewLatencyTraceHandle
} from "./overview-latency-trace.service";
import { AssistantRuntimeAdapterError } from "./assistant-runtime-adapter.types";

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
  updateId?: number | null;
}

export interface InternalTelegramTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
  deduplicated?: boolean;
  compactionHint?: string;
}

function buildTelegramCompactionHintCopy(locale: string): string {
  return locale === "ru"
    ? "Если этот чат начнёт отвечать медленнее, отправьте /compact, чтобы сжать старый контекст и сохранить быстрые ответы."
    : "If this chat starts slowing down, send /compact to compress older context and keep replies fast.";
}

function isTelegramAutoCompactionEnabled(config: unknown): boolean {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return true;
  }
  return (config as Record<string, unknown>).autoCompactionEnabled !== false;
}

const TELEGRAM_COMPACT_COMMAND_RE = /^\/compact(?:@[A-Za-z0-9_]+)?\s*$/;

function isTelegramCompactSlashCommand(message: string): boolean {
  return TELEGRAM_COMPACT_COMMAND_RE.test(message.trim());
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
  private static readonly TELEGRAM_UPDATE_CLAIM_STALE_MS = 120_000;

  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly enforceAbuseRateLimitService: EnforceAbuseRateLimitService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly inboundMediaService: InboundMediaService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService
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
      attachments: parseAttachments(row.attachments),
      updateId:
        typeof row.updateId === "number" && Number.isFinite(row.updateId) ? row.updateId : null
    };
  }

  async execute(input: InternalTelegramTurnRequest): Promise<InternalTelegramTurnResult> {
    const trace = this.overviewLatencyTraceService.start({
      traceId: randomUUID(),
      surface: "telegram",
      assistantId: input.assistantId,
      threadKey: input.threadId
    });
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
      input.assistantId
    );
    trace.stage("resolved_context");
    const updateClaim = await this.claimTelegramUpdateIfNeeded(
      resolved.assistantId,
      input.updateId
    );
    trace.stage("update_claimed");
    if (updateClaim !== null && typeof updateClaim === "object") {
      trace.finish({
        status: "deduplicated",
        outputPreview: updateClaim.assistantMessage
      });
      return updateClaim;
    }
    const claimedUpdateId = updateClaim;

    try {
      const quotaDecision = await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn(
        {
          assistant: resolved.assistant,
          surface: "telegram",
          isNewThread: false,
          activeSurfaceChatsCount: 0
        }
      );
      trace.stage("quota_checked");
      await this.enforceAbuseRateLimitService.enforceAndRegisterAttempt({
        assistant: resolved.assistant,
        surface: "telegram",
        peerKey: input.threadId
      });
      trace.stage("abuse_checked");

      const workspace = await this.prisma.workspace.findUnique({
        where: { id: resolved.workspaceId },
        select: { timezone: true }
      });
      if (workspace === null) {
        throw new NotFoundException("Workspace does not exist for this assistant.");
      }
      trace.stage("workspace_loaded");

      if (
        (!input.attachments || input.attachments.length === 0) &&
        isTelegramCompactSlashCommand(input.message)
      ) {
        return await this.executeTelegramCompactCommand({
          resolved,
          threadId: input.threadId,
          claimedUpdateId,
          trace
        });
      }

      let enrichedMessage = input.message;
      let mediaSystemNotices: string[] = [];

      if (input.attachments && input.attachments.length > 0) {
        const chat = await this.chatRepository.findOrCreateChatBySurfaceThread({
          assistantId: resolved.assistantId,
          userId: resolved.userId,
          workspaceId: resolved.workspaceId,
          surface: "telegram",
          surfaceThreadKey: input.threadId,
          title: null
        });

        const userMessage = await this.chatRepository.createMessage({
          chatId: chat.id,
          assistantId: resolved.assistantId,
          author: "user",
          content: input.message
        });
        trace.stage("attachment_message_saved");

        const rawAttachments: RawInboundAttachment[] = await this.downloadTelegramAttachments(
          input.attachments,
          resolved.assistantId
        );
        trace.stage("attachments_downloaded");

        const resolved2 = await this.inboundMediaService.resolve({
          channel: "telegram",
          assistantId: resolved.assistantId,
          userId: resolved.userId,
          chatId: chat.id,
          messageId: userMessage.id,
          workspaceId: resolved.workspaceId,
          userMessage: input.message,
          rawAttachments
        });
        enrichedMessage = resolved2.enrichedMessage;
        mediaSystemNotices = resolved2.systemNotices;
        trace.stage("attachments_resolved");
      } else {
        enrichedMessage = input.message;
      }

      const runtimeResponse = await this.assistantRuntimeAdapter.sendChannelTurn({
        assistantId: resolved.assistantId,
        publishedVersionId: resolved.publishedVersionId,
        runtimeTier: resolved.runtimeTier,
        ...(quotaDecision.mode === "degrade_allowed" && resolved.quotaDegradeModelOverride
          ? {
              providerOverride: resolved.quotaDegradeModelOverride.provider,
              modelOverride: resolved.quotaDegradeModelOverride.model
            }
          : {}),
        ...(trace.isEnabled() ? { overviewTraceId: trace.getTraceId() } : {}),
        surface: "telegram",
        threadId: input.threadId,
        userMessage: enrichedMessage,
        userTimezone: workspace.timezone,
        currentTimeIso: new Date().toISOString()
      });
      if (runtimeResponse.runtimeTrace) {
        trace.attachExternalTrace(runtimeResponse.runtimeTrace);
      }
      trace.stage("runtime_done");
      const compactionHint = await this.buildTelegramCompactionHint({
        assistantId: resolved.assistantId,
        runtimeTier: resolved.runtimeTier,
        threadId: input.threadId,
        workspaceId: resolved.workspaceId
      });

      await this.trackWorkspaceQuotaUsageService.recordInboundTurnUsage({
        assistant: resolved.assistant,
        userContent: input.message,
        assistantContent: runtimeResponse.assistantMessage,
        source: "telegram_turn_sync"
      });
      trace.stage("quota_recorded");
      if (claimedUpdateId !== null) {
        await this.bindingRepository.completeTelegramUpdateProcessing(
          resolved.assistantId,
          "telegram",
          "telegram_bot",
          claimedUpdateId,
          new Date()
        );
        trace.stage("update_completed");
      }
      await this.consumeBootstrapBestEffort(resolved.assistantId, resolved.runtimeTier);
      trace.stage("bootstrap_consumed");

      if (mediaSystemNotices.length > 0) {
        const prefix = mediaSystemNotices.join("\n");
        trace.finish({
          status: "completed",
          outputPreview: `${prefix}\n\n${runtimeResponse.assistantMessage}`
        });
        return {
          ...runtimeResponse,
          assistantMessage: `${prefix}\n\n${runtimeResponse.assistantMessage}`,
          ...(compactionHint ? { compactionHint } : {})
        };
      }
      trace.finish({
        status: "completed",
        outputPreview: runtimeResponse.assistantMessage
      });
      return {
        ...runtimeResponse,
        ...(compactionHint ? { compactionHint } : {})
      };
    } catch (error) {
      if (claimedUpdateId !== null) {
        await this.releaseTelegramUpdateClaimBestEffort(resolved.assistantId, claimedUpdateId);
      }
      trace.finish({ status: "failed" });
      throw error;
    }
  }

  private async claimTelegramUpdateIfNeeded(
    assistantId: string,
    updateId: number | null | undefined
  ): Promise<number | InternalTelegramTurnResult | null> {
    if (updateId === null || updateId === undefined) {
      return null;
    }
    const claim = await this.bindingRepository.claimTelegramUpdateProcessing(
      assistantId,
      "telegram",
      "telegram_bot",
      updateId,
      new Date(),
      HandleInternalTelegramTurnService.TELEGRAM_UPDATE_CLAIM_STALE_MS
    );
    if (claim === "claimed" || claim === "missing_binding") {
      return claim === "claimed" ? updateId : null;
    }
    this.logger.warn(
      `[telegram-turn] Dropped duplicate Telegram update ${updateId} for assistant ${assistantId} (${claim})`
    );
    return this.buildDeduplicatedResult();
  }

  private buildDeduplicatedResult(): InternalTelegramTurnResult {
    return {
      assistantMessage: "",
      respondedAt: new Date().toISOString(),
      media: [],
      deduplicated: true
    };
  }

  private async releaseTelegramUpdateClaimBestEffort(
    assistantId: string,
    updateId: number
  ): Promise<void> {
    try {
      await this.bindingRepository.releaseTelegramUpdateProcessing(
        assistantId,
        "telegram",
        "telegram_bot",
        updateId
      );
    } catch (error) {
      this.logger.warn(
        `[telegram-turn] Non-fatal: failed to release Telegram update claim ${updateId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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
        storagePath,
        await this.resolveAssistantInboundRuntimeContextService
          .resolveByAssistantId(assistantId)
          .then((resolved) => resolved.runtimeTier)
      );
      if (downloaded) {
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

  private localizeOpenClawCompactionReason(locale: "ru" | "en", reason: string | null): string {
    const r = (reason ?? "").trim();
    if (locale !== "ru" || r.length === 0) {
      return r;
    }
    const lower = r.toLowerCase();
    if (lower.includes("already compacted")) {
      return "контекст уже был сжат";
    }
    return r;
  }

  private async executeTelegramCompactCommand(params: {
    resolved: {
      assistantId: string;
      runtimeTier: import("./runtime-assignment").RuntimeTier;
      workspaceId: string;
    };
    threadId: string;
    claimedUpdateId: number | null;
    trace: OverviewLatencyTraceHandle;
  }): Promise<InternalTelegramTurnResult> {
    const locale = await this.resolveWorkspaceLocale(params.resolved.workspaceId);
    params.trace.stage("telegram_compact_command");
    try {
      const outcome = await this.assistantRuntimeAdapter.compactTelegramChannelSession({
        assistantId: params.resolved.assistantId,
        runtimeTier: params.resolved.runtimeTier,
        surface: "telegram",
        threadId: params.threadId
      });
      const respondedAt = new Date().toISOString();
      let assistantMessage: string;
      const localizedReason = this.localizeOpenClawCompactionReason(locale, outcome.reason);
      if (locale === "ru") {
        if (outcome.compacted) {
          if (outcome.tokensBefore !== null && outcome.tokensAfter !== null) {
            assistantMessage = `Сжатие выполнено. Оценка токенов: ~${outcome.tokensBefore} → ~${outcome.tokensAfter}.`;
          } else {
            assistantMessage = "Сжатие выполнено.";
          }
        } else {
          assistantMessage =
            localizedReason.length > 0
              ? `Сжатие не потребовалось: ${localizedReason}.`
              : "Сжатие не потребовалось.";
        }
      } else if (outcome.compacted) {
        if (outcome.tokensBefore !== null && outcome.tokensAfter !== null) {
          assistantMessage = `Compaction done. Estimated tokens: ~${outcome.tokensBefore} → ~${outcome.tokensAfter}.`;
        } else {
          assistantMessage = "Compaction done.";
        }
      } else {
        assistantMessage =
          localizedReason.length > 0
            ? `Compaction skipped: ${localizedReason}.`
            : "Compaction was not needed.";
      }

      if (params.claimedUpdateId !== null) {
        await this.bindingRepository.completeTelegramUpdateProcessing(
          params.resolved.assistantId,
          "telegram",
          "telegram_bot",
          params.claimedUpdateId,
          new Date()
        );
        params.trace.stage("update_completed");
      }
      await this.consumeBootstrapBestEffort(
        params.resolved.assistantId,
        params.resolved.runtimeTier
      );
      params.trace.finish({ status: "completed", outputPreview: assistantMessage });
      return {
        assistantMessage,
        respondedAt,
        media: []
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const sessionMissing =
        error instanceof AssistantRuntimeAdapterError &&
        (error.code === "compaction_unavailable" ||
          errMsg.includes("active runtime session") ||
          errMsg.includes("Compaction is unavailable"));
      const assistantMessage =
        locale === "ru"
          ? sessionMissing
            ? "Активная сессия для этого чата ещё не создана. Отправьте обычное сообщение боту, затем снова /compact."
            : `Не удалось сжать контекст: ${errMsg}`
          : sessionMissing
            ? "No active runtime session for this chat yet. Send a normal message first, then try /compact again."
            : `Could not compact context: ${errMsg}`;

      if (params.claimedUpdateId !== null) {
        await this.bindingRepository.completeTelegramUpdateProcessing(
          params.resolved.assistantId,
          "telegram",
          "telegram_bot",
          params.claimedUpdateId,
          new Date()
        );
      }
      params.trace.finish({ status: "completed", outputPreview: assistantMessage });
      return {
        assistantMessage,
        respondedAt: new Date().toISOString(),
        media: []
      };
    }
  }

  private async consumeBootstrapBestEffort(
    assistantId: string,
    runtimeTier: import("./runtime-assignment").RuntimeTier
  ): Promise<void> {
    try {
      await this.assistantRuntimeAdapter.consumeBootstrapWorkspace(assistantId, runtimeTier);
    } catch (error) {
      this.logger.warn(
        `[telegram-turn] Non-fatal: failed to consume BOOTSTRAP.md: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async buildTelegramCompactionHint(params: {
    assistantId: string;
    runtimeTier: import("./runtime-assignment").RuntimeTier;
    threadId: string;
    workspaceId: string;
  }): Promise<string | null> {
    const [runtimeSessionState, platformSettings, binding] = await Promise.all([
      this.assistantRuntimeAdapter.getChannelSessionState({
        assistantId: params.assistantId,
        runtimeTier: params.runtimeTier,
        surface: "telegram",
        threadId: params.threadId
      }),
      this.resolvePlatformRuntimeProviderSettingsService.execute(),
      this.bindingRepository.findByAssistantProviderSurface(
        params.assistantId,
        "telegram",
        "telegram_bot"
      )
    ]);
    if (!runtimeSessionState.found) {
      return null;
    }
    if (isTelegramAutoCompactionEnabled(binding?.config ?? null)) {
      return null;
    }
    const policy = platformSettings.optimizationPolicy.compaction;
    const currentTokens = runtimeSessionState.currentTokens;
    const threshold = Math.max(1, policy.reserveTokens - policy.keepRecentTokens);
    const previousHintTokens = runtimeSessionState.compactionHintTokens;
    const rehintDelta = Math.max(1000, Math.floor(policy.keepRecentTokens * 0.2));
    const shouldSuggest =
      currentTokens !== null &&
      currentTokens >= threshold &&
      runtimeSessionState.compactionCount <= 0 &&
      (previousHintTokens === null || currentTokens >= previousHintTokens + rehintDelta);
    if (!shouldSuggest) {
      return null;
    }
    await this.assistantRuntimeAdapter.markChannelCompactionHintShown({
      assistantId: params.assistantId,
      runtimeTier: params.runtimeTier,
      surface: "telegram",
      threadId: params.threadId,
      tokens: currentTokens
    });
    return buildTelegramCompactionHintCopy(await this.resolveWorkspaceLocale(params.workspaceId));
  }

  private async resolveWorkspaceLocale(workspaceId: string): Promise<"ru" | "en"> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { locale: true }
    });
    const raw = workspace?.locale;
    if (typeof raw !== "string") {
      return "en";
    }
    const norm = raw.trim().toLowerCase();
    if (norm === "ru" || norm.startsWith("ru-")) {
      return "ru";
    }
    return "en";
  }
}
