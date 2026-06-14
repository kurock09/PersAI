import type { UserRestriction } from "./user-restriction.entity";

export const USER_RESTRICTION_REPOSITORY = Symbol("USER_RESTRICTION_REPOSITORY");

export interface UserRestrictionRepository {
  findActiveSafetyRestriction(userId: string, now?: Date): Promise<UserRestriction | null>;
  findActiveSafetyRestrictionsForUserIds(
    userIds: string[],
    now?: Date
  ): Promise<Map<string, UserRestriction>>;
  clearActiveSafetyRestriction(
    userId: string,
    clearedByUserId: string
  ): Promise<UserRestriction | null>;
  upsertAdminSafetyRestriction(input: {
    userId: string;
    reasonCode: string;
    sourceAssistantId: string | null;
    blockedUntil: Date | null;
  }): Promise<UserRestriction>;
}
