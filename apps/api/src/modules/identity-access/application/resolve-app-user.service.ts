import { Injectable } from "@nestjs/common";
import { AppUser } from "@prisma/client";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import { ResolvedAppUser, ResolvedAuthUser } from "./resolved-auth-user.types";

function toResolvedAppUser(user: AppUser): ResolvedAppUser {
  return {
    id: user.id,
    clerkUserId: user.clerkUserId ?? "",
    email: user.email,
    displayName: user.displayName
  };
}

@Injectable()
export class ResolveAppUserService {
  constructor(private readonly prismaService: PrismaService) {}

  async resolveOrCreate(authenticatedUser: ResolvedAuthUser): Promise<ResolvedAppUser> {
    const existingByClerkId = await this.prismaService.appUser.findUnique({
      where: { clerkUserId: authenticatedUser.clerkUserId }
    });

    if (existingByClerkId !== null) {
      return toResolvedAppUser(existingByClerkId);
    }

    const normalizedEmail = authenticatedUser.email.toLowerCase();
    const existingByEmail = await this.prismaService.appUser.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingByEmail !== null) {
      const updatedUser = await this.prismaService.appUser.update({
        where: { id: existingByEmail.id },
        data: {
          clerkUserId: authenticatedUser.clerkUserId,
          displayName: authenticatedUser.displayName
        }
      });
      return toResolvedAppUser(updatedUser);
    }

    const createdUser = await this.prismaService.appUser.create({
      data: {
        clerkUserId: authenticatedUser.clerkUserId,
        email: normalizedEmail,
        displayName: authenticatedUser.displayName
      }
    });

    return toResolvedAppUser(createdUser);
  }
}
