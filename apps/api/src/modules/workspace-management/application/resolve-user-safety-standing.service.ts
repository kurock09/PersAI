import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import {
  USER_RESTRICTION_REPOSITORY,
  type UserRestrictionRepository
} from "../domain/user-restriction.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type { UserSafetyStandingState } from "./user-safety-standing.types";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ResolveUserSafetyStandingService {
  constructor(
    @Inject(USER_RESTRICTION_REPOSITORY)
    private readonly userRestrictionRepository: UserRestrictionRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(userId: string): Promise<UserSafetyStandingState> {
    const restriction = await this.userRestrictionRepository.findActiveSafetyRestriction(userId);
    if (restriction !== null) {
      return {
        standing: "restricted",
        observationEndsAt: null,
        daysRemaining: null,
        reasonCode: restriction.reasonCode
      };
    }

    const windowDays = loadApiConfig(process.env).SAFETY_MODERATION_STRIKE_WINDOW_DAYS;
    const since = new Date(Date.now() - windowDays * DAY_MS);
    const latestWarn = await this.prisma.moderationCase.findFirst({
      where: {
        userId,
        decision: "warn",
        createdAt: { gte: since }
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        reasonCode: true
      }
    });

    if (latestWarn === null) {
      return {
        standing: "none",
        observationEndsAt: null,
        daysRemaining: null,
        reasonCode: null
      };
    }

    const observationEndsAt = new Date(latestWarn.createdAt.getTime() + windowDays * DAY_MS);
    const daysRemaining = Math.max(
      1,
      Math.ceil((observationEndsAt.getTime() - Date.now()) / DAY_MS)
    );

    return {
      standing: "warn",
      observationEndsAt: observationEndsAt.toISOString(),
      daysRemaining,
      reasonCode: latestWarn.reasonCode
    };
  }
}
