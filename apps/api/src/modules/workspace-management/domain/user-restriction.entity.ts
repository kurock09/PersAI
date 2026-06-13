export type UserRestrictionKind = "safety" | "spam_global";

export type UserRestrictionStatus = "active" | "cleared";

export type UserRestrictionSource = "moderation_auto" | "admin";

export type UserRestriction = {
  id: string;
  userId: string;
  kind: UserRestrictionKind;
  status: UserRestrictionStatus;
  blockedUntil: Date | null;
  reasonCode: string;
  source: UserRestrictionSource;
  sourceAssistantId: string | null;
  sourceModerationCaseId: string | null;
  clearedAt: Date | null;
  clearedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
