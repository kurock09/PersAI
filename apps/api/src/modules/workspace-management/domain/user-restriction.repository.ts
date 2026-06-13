import type { UserRestriction } from "./user-restriction.entity";

export const USER_RESTRICTION_REPOSITORY = Symbol("USER_RESTRICTION_REPOSITORY");

export interface UserRestrictionRepository {
  findActiveSafetyRestriction(userId: string, now?: Date): Promise<UserRestriction | null>;
}
