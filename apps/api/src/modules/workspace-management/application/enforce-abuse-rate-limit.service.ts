import { Inject, Injectable } from "@nestjs/common";
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

type AbuseDecision = {
  blockedUntil: Date | null;
  slowedUntil: Date | null;
  reason: string | null;
};

function throwTooManyRequests(message: string): never {
  throw createAssistantInboundRateLimitError(message);
}

@Injectable()
export class EnforceAbuseRateLimitService {
  constructor(
    @Inject(ASSISTANT_ABUSE_GUARD_REPOSITORY)
    private readonly assistantAbuseGuardRepository: AssistantAbuseGuardRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

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

    const quotaDecision = await this.evaluateQuotaPressureDecision(params.assistant, now);
    const registered = await this.assistantAbuseGuardRepository.registerDistributedAttempt({
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      workspaceId: params.assistant.workspaceId,
      surface: params.surface,
      attemptedAt: now,
      windowMs: WINDOW_MS,
      quotaDecision: this.toDecisionSnapshot(quotaDecision),
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
      throwTooManyRequests("Requests temporarily blocked due to abuse/rate-limit protection.");
    }
    if (
      registered.finalSlowedUntil != null &&
      registered.finalSlowedUntil.getTime() > now.getTime()
    ) {
      throwTooManyRequests(
        "Requests temporarily slowed due to abuse/rate-limit and quota pressure protection."
      );
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
      throwTooManyRequests(
        "Requests temporarily blocked for this peer due to rate-limit protection."
      );
    }
    if (peerState.requestCount >= config.ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE) {
      throwTooManyRequests(
        "Requests temporarily slowed for this peer due to rate-limit protection."
      );
    }
  }

  private async evaluateQuotaPressureDecision(
    assistant: Assistant,
    now: Date
  ): Promise<AbuseDecision> {
    const config = loadApiConfig(process.env);
    const quotaState = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      assistant.workspaceId
    );
    if (quotaState === null) {
      return {
        blockedUntil: null,
        slowedUntil: null,
        reason: null
      };
    }

    const limits =
      await this.trackWorkspaceQuotaUsageService.resolveEffectiveLimitsForAssistant(assistant);
    const tokenLimit = limits.tokenBudgetLimit;
    const tokenPercent =
      tokenLimit === null || tokenLimit <= BigInt(0)
        ? 0
        : Number((quotaState.tokenBudgetUsed * BigInt(100)) / tokenLimit);
    const maxPercent = tokenPercent;

    if (maxPercent >= config.ABUSE_QUOTA_BLOCK_PERCENT) {
      return {
        blockedUntil: new Date(now.getTime() + config.ABUSE_TEMP_BLOCK_SECONDS * 1000),
        slowedUntil: null,
        reason: "quota_pressure_temporary_block"
      };
    }
    if (maxPercent >= config.ABUSE_QUOTA_SLOWDOWN_PERCENT) {
      return {
        blockedUntil: null,
        slowedUntil: new Date(now.getTime() + config.ABUSE_SLOWDOWN_SECONDS * 1000),
        reason: "quota_pressure_slowdown"
      };
    }
    return {
      blockedUntil: null,
      slowedUntil: null,
      reason: null
    };
  }

  private toDecisionSnapshot(decision: AbuseDecision): AbuseDecisionSnapshot {
    return {
      blockedUntil: decision.blockedUntil,
      slowedUntil: decision.slowedUntil,
      reason: decision.reason
    };
  }
}
