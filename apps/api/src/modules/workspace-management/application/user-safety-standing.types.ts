export type UserSafetyStanding = "none" | "warn" | "restricted";

export type UserSafetyStandingState = {
  standing: UserSafetyStanding;
  observationEndsAt: string | null;
  daysRemaining: number | null;
  reasonCode: string | null;
};
