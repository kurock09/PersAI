import type {
  AbuseSurface,
  AssistantAbuseAssistantState,
  AssistantAbuseGuardState,
  AssistantAbusePeerState
} from "./assistant-abuse-guard.entity";

export const ASSISTANT_ABUSE_GUARD_REPOSITORY = Symbol("ASSISTANT_ABUSE_GUARD_REPOSITORY");

export type AbuseDecisionSnapshot = {
  blockedUntil: Date | null;
  slowedUntil: Date | null;
  reason: string | null;
};

export type RegisterDistributedAbuseAttemptInput = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  surface: AbuseSurface;
  attemptedAt: Date;
  windowMs: number;
  quotaDecision: AbuseDecisionSnapshot;
  userSlowdownRequestsPerMinute: number;
  userBlockRequestsPerMinute: number;
  assistantSlowdownRequestsPerMinute: number;
  assistantBlockRequestsPerMinute: number;
  tempBlockSeconds: number;
  slowdownSeconds: number;
};

export type RegisterDistributedAbuseAttemptResult = {
  userState: AssistantAbuseGuardState;
  assistantState: AssistantAbuseAssistantState;
  userBypass: boolean;
  assistantBypass: boolean;
  finalBlockedUntil: Date | null;
  finalSlowedUntil: Date | null;
  finalReason: string | null;
};

export interface AssistantAbuseGuardRepository {
  findUserState(
    assistantId: string,
    userId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseGuardState | null>;
  findAssistantState(
    assistantId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseAssistantState | null>;
  registerPeerAttempt(input: {
    assistantId: string;
    surface: AbuseSurface;
    peerKey: string;
    attemptedAt: Date;
    windowStartedAfter: Date;
  }): Promise<AssistantAbusePeerState>;
  registerDistributedAttempt(
    input: RegisterDistributedAbuseAttemptInput
  ): Promise<RegisterDistributedAbuseAttemptResult>;
  upsertUserState(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    surface: AbuseSurface;
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }): Promise<AssistantAbuseGuardState>;
  upsertAssistantState(input: {
    assistantId: string;
    surface: AbuseSurface;
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }): Promise<AssistantAbuseAssistantState>;
  applyAdminUnblock(input: {
    assistantId: string;
    userId: string | null;
    surface: AbuseSurface;
    adminOverrideUntil: Date;
  }): Promise<{ userRows: number; assistantRows: number }>;
  applyPeerAdminUnblock(input: {
    assistantId: string;
    surface: AbuseSurface;
    adminOverrideUntil: Date;
  }): Promise<number>;
}
