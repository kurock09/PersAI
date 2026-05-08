import { Inject, Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { Assistant } from "../domain/assistant.entity";
import {
  ASSISTANT_ABUSE_GUARD_REPOSITORY,
  type AbuseDecisionSnapshot,
  type AssistantAbuseGuardRepository
} from "../domain/assistant-abuse-guard.repository";
import type { AbuseSurface } from "../domain/assistant-abuse-guard.entity";
import {
  WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
  type WorkspaceQuotaAccountingRepository
} from "../domain/workspace-quota-accounting.repository";
import { createAssistantInboundRateLimitError } from "./assistant-inbound-error";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";

const WINDOW_MS = 60_000;

function throwTooManyRequests(message: string): never {
  throw createAssistantInboundRateLimitError(message);
}

@Injectable()
export class EnforceAbuseRateLimitService {
  private readonly logger = new Logger(EnforceAbuseRateLimitService.name);

  constructor(
    @Inject(ASSISTANT_ABUSE_GUARD_REPOSITORY)
    private readonly assistantAbuseGuardRepository: AssistantAbuseGuardRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    _workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository,
    _trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {
    void _workspaceQuotaAccountingRepository;
    void _trackWorkspaceQuotaUsageService;
  }

  async enforceAndRegisterAttempt(params: {
    assistant: Assistant;
    surface: AbuseSurface;
    peerKey?: string | undefined;
  }): Promise<void> {
    const now = new Date();
    const config = loadApiConfig(process.env);

    if (params.peerKey) {
      await this.enforcePeerLimit(params.assistant.id, params.surface, params.peerKey, config, now);
    }

    const registered = await this.assistantAbuseGuardRepository.registerDistributedAttempt({
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      workspaceId: params.assistant.workspaceId,
      surface: params.surface,
      attemptedAt: now,
      windowMs: WINDOW_MS,
      quotaDecision: this.emptyDecisionSnapshot(),
      userSlowdownRequestsPerMinute: config.ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE,
      userBlockRequestsPerMinute: config.ABUSE_USER_BLOCK_REQUESTS_PER_MINUTE,
      assistantSlowdownRequestsPerMinute: config.ABUSE_ASSISTANT_SLOWDOWN_REQUESTS_PER_MINUTE,
      assistantBlockRequestsPerMinute: config.ABUSE_ASSISTANT_BLOCK_REQUESTS_PER_MINUTE,
      tempBlockSeconds: config.ABUSE_TEMP_BLOCK_SECONDS,
      slowdownSeconds: config.ABUSE_SLOWDOWN_SECONDS
    });

    if (
      registered.finalBlockedUntil != null &&
      registered.finalBlockedUntil.getTime() > now.getTime()
    ) {
      this.logDistributedDecision(params.assistant.id, params.surface, registered);
      throwTooManyRequests("Requests temporarily blocked due to abuse/rate-limit protection.");
    }
    if (
      registered.finalSlowedUntil != null &&
      registered.finalSlowedUntil.getTime() > now.getTime()
    ) {
      this.logDistributedDecision(params.assistant.id, params.surface, registered);
      throwTooManyRequests("Requests temporarily slowed due to abuse/rate-limit protection.");
    }
  }

  private async enforcePeerLimit(
    assistantId: string,
    surface: AbuseSurface,
    peerKey: string,
    config: ReturnType<typeof loadApiConfig>,
    now: Date
  ): Promise<void> {
    const peerState = await this.assistantAbuseGuardRepository.registerPeerAttempt({
      assistantId,
      surface,
      peerKey,
      attemptedAt: now,
      windowStartedAfter: new Date(now.getTime() - WINDOW_MS)
    });
    const peerBypass =
      peerState.adminOverrideUntil != null &&
      peerState.adminOverrideUntil.getTime() > now.getTime();

    if (peerBypass) {
      return;
    }
    if (peerState.requestCount >= config.ABUSE_PEER_BLOCK_REQUESTS_PER_MINUTE) {
      this.logger.warn(
        `[abuse-rate-limit] peer_block assistant=${assistantId} surface=${surface} peerKey=${peerKey} count=${peerState.requestCount} threshold=${config.ABUSE_PEER_BLOCK_REQUESTS_PER_MINUTE}`
      );
      throwTooManyRequests(
        "Requests temporarily blocked for this peer due to rate-limit protection."
      );
    }
    if (peerState.requestCount >= config.ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE) {
      this.logger.warn(
        `[abuse-rate-limit] peer_slowdown assistant=${assistantId} surface=${surface} peerKey=${peerKey} count=${peerState.requestCount} threshold=${config.ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE}`
      );
      throwTooManyRequests(
        "Requests temporarily slowed for this peer due to rate-limit protection."
      );
    }
  }

  private emptyDecisionSnapshot(): AbuseDecisionSnapshot {
    return {
      blockedUntil: null,
      slowedUntil: null,
      reason: null
    };
  }

  private logDistributedDecision(
    assistantId: string,
    surface: AbuseSurface,
    registered: {
      userState: { requestCount: number };
      assistantState: { requestCount: number };
      finalBlockedUntil: Date | null;
      finalSlowedUntil: Date | null;
      finalReason: string | null;
    }
  ): void {
    const decision =
      registered.finalBlockedUntil != null
        ? "distributed_block"
        : registered.finalSlowedUntil != null
          ? "distributed_slowdown"
          : "distributed_decision";
    this.logger.warn(
      `[abuse-rate-limit] ${decision} assistant=${assistantId} surface=${surface} userCount=${registered.userState.requestCount} assistantCount=${registered.assistantState.requestCount} reason=${registered.finalReason ?? "unknown"}`
    );
  }
}
