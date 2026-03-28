import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { Assistant } from "../domain/assistant.entity";
import {
  ASSISTANT_ABUSE_GUARD_REPOSITORY,
  type AssistantAbuseGuardRepository
} from "../domain/assistant-abuse-guard.repository";
import type { AbuseSurface } from "../domain/assistant-abuse-guard.entity";
import {
  WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
  type WorkspaceQuotaAccountingRepository
} from "../domain/workspace-quota-accounting.repository";
import { createAssistantInboundRateLimitError } from "./assistant-inbound-error";

const WINDOW_MS = 60_000;

type AbuseDecision = {
  blockedUntil: Date | null;
  slowedUntil: Date | null;
  reason: string | null;
};

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return a.getTime() >= b.getTime() ? a : b;
}

function throwTooManyRequests(message: string): never {
  throw createAssistantInboundRateLimitError(message);
}

@Injectable()
export class EnforceAbuseRateLimitService {
  constructor(
    @Inject(ASSISTANT_ABUSE_GUARD_REPOSITORY)
    private readonly assistantAbuseGuardRepository: AssistantAbuseGuardRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository
  ) {}

  async enforceAndRegisterAttempt(params: {
    assistant: Assistant;
    surface: AbuseSurface;
  }): Promise<void> {
    const now = new Date();
    const config = loadApiConfig(process.env);
    const userState = await this.assistantAbuseGuardRepository.findUserState(
      params.assistant.id,
      params.assistant.userId,
      params.surface
    );
    const assistantState = await this.assistantAbuseGuardRepository.findAssistantState(
      params.assistant.id,
      params.surface
    );

    const userBypass =
      userState !== null &&
      userState.adminOverrideUntil !== null &&
      userState.adminOverrideUntil.getTime() > now.getTime();
    const assistantBypass =
      assistantState !== null &&
      assistantState.adminOverrideUntil !== null &&
      assistantState.adminOverrideUntil.getTime() > now.getTime();

    if (
      !userBypass &&
      userState !== null &&
      userState.blockedUntil !== null &&
      userState.blockedUntil.getTime() > now.getTime()
    ) {
      throwTooManyRequests(
        "Requests temporarily blocked for this user-assistant channel due to abuse protection."
      );
    }
    if (
      !assistantBypass &&
      assistantState !== null &&
      assistantState.blockedUntil !== null &&
      assistantState.blockedUntil.getTime() > now.getTime()
    ) {
      throwTooManyRequests(
        "Requests temporarily blocked for this assistant channel due to abuse protection."
      );
    }

    const userWindowStartedAt =
      userState === null || now.getTime() - userState.windowStartedAt.getTime() > WINDOW_MS
        ? now
        : userState.windowStartedAt;
    const assistantWindowStartedAt =
      assistantState === null ||
      now.getTime() - assistantState.windowStartedAt.getTime() > WINDOW_MS
        ? now
        : assistantState.windowStartedAt;

    const userCount =
      userState === null || userWindowStartedAt.getTime() === now.getTime()
        ? 1
        : userState.requestCount + 1;
    const assistantCount =
      assistantState === null || assistantWindowStartedAt.getTime() === now.getTime()
        ? 1
        : assistantState.requestCount + 1;

    let userDecision: AbuseDecision = {
      blockedUntil: userState?.blockedUntil ?? null,
      slowedUntil: userState?.slowedUntil ?? null,
      reason: userState?.blockReason ?? null
    };
    if (!userBypass) {
      if (userCount >= config.ABUSE_USER_BLOCK_REQUESTS_PER_MINUTE) {
        userDecision = {
          blockedUntil: new Date(now.getTime() + config.ABUSE_TEMP_BLOCK_SECONDS * 1000),
          slowedUntil: null,
          reason: "user_request_rate_limit_blocked"
        };
      } else if (userCount >= config.ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE) {
        userDecision = {
          blockedUntil: null,
          slowedUntil: new Date(now.getTime() + config.ABUSE_SLOWDOWN_SECONDS * 1000),
          reason: "user_request_rate_limit_slowdown"
        };
      }
    }

    let assistantDecision: AbuseDecision = {
      blockedUntil: assistantState?.blockedUntil ?? null,
      slowedUntil: assistantState?.slowedUntil ?? null,
      reason: assistantState?.blockReason ?? null
    };
    if (!assistantBypass) {
      if (assistantCount >= config.ABUSE_ASSISTANT_BLOCK_REQUESTS_PER_MINUTE) {
        assistantDecision = {
          blockedUntil: new Date(now.getTime() + config.ABUSE_TEMP_BLOCK_SECONDS * 1000),
          slowedUntil: null,
          reason: "assistant_request_rate_limit_blocked"
        };
      } else if (assistantCount >= config.ABUSE_ASSISTANT_SLOWDOWN_REQUESTS_PER_MINUTE) {
        assistantDecision = {
          blockedUntil: null,
          slowedUntil: new Date(now.getTime() + config.ABUSE_SLOWDOWN_SECONDS * 1000),
          reason: "assistant_request_rate_limit_slowdown"
        };
      }
    }

    const quotaDecision = await this.evaluateQuotaPressureDecision(params.assistant, now);

    const finalBlockedUntil = maxDate(
      maxDate(userDecision.blockedUntil, assistantDecision.blockedUntil),
      quotaDecision.blockedUntil
    );
    const finalSlowedUntil = maxDate(
      maxDate(userDecision.slowedUntil, assistantDecision.slowedUntil),
      quotaDecision.slowedUntil
    );
    const finalReason =
      quotaDecision.reason ?? assistantDecision.reason ?? userDecision.reason ?? null;

    await this.assistantAbuseGuardRepository.upsertUserState({
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      workspaceId: params.assistant.workspaceId,
      surface: params.surface,
      windowStartedAt: userWindowStartedAt,
      requestCount: userCount,
      slowedUntil: finalSlowedUntil,
      blockedUntil: finalBlockedUntil,
      blockReason: finalReason,
      adminOverrideUntil: userBypass ? (userState?.adminOverrideUntil ?? null) : null,
      lastSeenAt: now
    });

    await this.assistantAbuseGuardRepository.upsertAssistantState({
      assistantId: params.assistant.id,
      surface: params.surface,
      windowStartedAt: assistantWindowStartedAt,
      requestCount: assistantCount,
      slowedUntil: finalSlowedUntil,
      blockedUntil: finalBlockedUntil,
      blockReason: finalReason,
      adminOverrideUntil: assistantBypass ? (assistantState?.adminOverrideUntil ?? null) : null,
      lastSeenAt: now
    });

    if (finalBlockedUntil !== null && finalBlockedUntil.getTime() > now.getTime()) {
      throwTooManyRequests("Requests temporarily blocked due to abuse/rate-limit protection.");
    }
    if (finalSlowedUntil !== null && finalSlowedUntil.getTime() > now.getTime()) {
      throwTooManyRequests(
        "Requests temporarily slowed due to abuse/rate-limit and quota pressure protection."
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

    const tokenLimit = quotaState.tokenBudgetLimit;
    const toolLimit = quotaState.costOrTokenDrivingToolClassUnitsLimit;
    const tokenPercent =
      tokenLimit === null || tokenLimit <= BigInt(0)
        ? 0
        : Number((quotaState.tokenBudgetUsed * BigInt(100)) / tokenLimit);
    const toolPercent =
      toolLimit === null || toolLimit <= 0
        ? 0
        : Math.floor((quotaState.costOrTokenDrivingToolClassUnitsUsed * 100) / toolLimit);
    const maxPercent = Math.max(tokenPercent, toolPercent);

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
}
