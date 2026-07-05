import { Injectable, UnauthorizedException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import type { ResolvedAppUser } from "./resolved-auth-user.types";
import { isOperatorApiAuthConfigured } from "./operator-api-auth";

function toResolvedAppUser(user: {
  id: string;
  clerkUserId: string | null;
  email: string;
  displayName: string | null;
  birthday: Date | null;
  gender: string | null;
  preferredLocale: string | null;
  countryCode: string | null;
}): ResolvedAppUser {
  return {
    id: user.id,
    clerkUserId: user.clerkUserId ?? "",
    email: user.email,
    displayName: user.displayName,
    birthday: user.birthday ? user.birthday.toISOString().split("T")[0]! : null,
    gender: user.gender as ResolvedAppUser["gender"],
    preferredLocale: user.preferredLocale,
    countryCode: user.countryCode
  };
}

@Injectable()
export class ResolveOperatorActorService {
  private cachedActor: ResolvedAppUser | null | undefined;

  constructor(private readonly prismaService: PrismaService) {}

  isConfigured(): boolean {
    return isOperatorApiAuthConfigured(loadApiConfig(process.env));
  }

  async resolveActorUser(): Promise<ResolvedAppUser> {
    if (this.cachedActor !== undefined) {
      if (this.cachedActor === null) {
        throw new UnauthorizedException("Operator actor user is not configured.");
      }
      return this.cachedActor;
    }

    const config = loadApiConfig(process.env);
    const actorUserId = config.PERSAI_OPERATOR_ACTOR_USER_ID?.trim() ?? "";
    const actorEmail = config.PERSAI_OPERATOR_ACTOR_EMAIL?.trim().toLowerCase() ?? "";

    const user =
      actorUserId.length > 0
        ? await this.prismaService.appUser.findUnique({ where: { id: actorUserId } })
        : actorEmail.length > 0
          ? await this.prismaService.appUser.findUnique({ where: { email: actorEmail } })
          : null;

    if (user === null) {
      this.cachedActor = null;
      throw new UnauthorizedException("Operator actor user is not configured.");
    }

    this.cachedActor = toResolvedAppUser(user);
    return this.cachedActor;
  }
}
