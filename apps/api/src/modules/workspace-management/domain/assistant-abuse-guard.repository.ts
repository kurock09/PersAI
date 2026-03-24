import type {
  AbuseSurface,
  AssistantAbuseAssistantState,
  AssistantAbuseGuardState
} from "./assistant-abuse-guard.entity";

export const ASSISTANT_ABUSE_GUARD_REPOSITORY = Symbol("ASSISTANT_ABUSE_GUARD_REPOSITORY");

export interface AssistantAbuseGuardRepository {
  findUserState(
    assistantId: string,
    userId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseGuardState | null>;
  findAssistantState(assistantId: string, surface: AbuseSurface): Promise<AssistantAbuseAssistantState | null>;
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
}
