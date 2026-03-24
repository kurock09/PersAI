import { BadRequestException, Injectable } from "@nestjs/common";
import { WorkspaceRole, WorkspaceStatus } from "@prisma/client";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import { CurrentUserState } from "./current-user-state.types";
import { GetCurrentUserStateService } from "./get-current-user-state.service";
import { ResolvedAppUser } from "./resolved-auth-user.types";
import { MVP_PRIVACY_POLICY_VERSION, MVP_TERMS_OF_SERVICE_VERSION } from "./compliance-baseline";

export interface OnboardingInput {
  displayName: string;
  workspaceName: string;
  locale: string;
  timezone: string;
  acceptTermsOfService: true;
  acceptPrivacyPolicy: true;
  termsOfServiceVersion: string;
  privacyPolicyVersion: string;
}

function normalizeRequiredField(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeOptionalVersion(value: unknown, fallback: string, fieldName: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string when provided.`);
  }
  const normalized = value.trim();
  if (normalized.length > 64) {
    throw new BadRequestException(`${fieldName} must be at most 64 characters.`);
  }
  return normalized;
}

@Injectable()
export class UpsertOnboardingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly getCurrentUserStateService: GetCurrentUserStateService
  ) {}

  parseInput(payload: unknown): OnboardingInput {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Onboarding payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    if (body.acceptTermsOfService !== true) {
      throw new BadRequestException("acceptTermsOfService must be true.");
    }
    if (body.acceptPrivacyPolicy !== true) {
      throw new BadRequestException("acceptPrivacyPolicy must be true.");
    }

    return {
      displayName: normalizeRequiredField(body.displayName, "displayName"),
      workspaceName: normalizeRequiredField(body.workspaceName, "workspaceName"),
      locale: normalizeRequiredField(body.locale, "locale"),
      timezone: normalizeRequiredField(body.timezone, "timezone"),
      acceptTermsOfService: true,
      acceptPrivacyPolicy: true,
      termsOfServiceVersion: normalizeOptionalVersion(
        body.termsOfServiceVersion,
        MVP_TERMS_OF_SERVICE_VERSION,
        "termsOfServiceVersion"
      ),
      privacyPolicyVersion: normalizeOptionalVersion(
        body.privacyPolicyVersion,
        MVP_PRIVACY_POLICY_VERSION,
        "privacyPolicyVersion"
      )
    };
  }

  async upsertOnboarding(
    resolvedAppUser: ResolvedAppUser,
    input: OnboardingInput
  ): Promise<CurrentUserState> {
    if (!input.acceptTermsOfService) {
      throw new BadRequestException("acceptTermsOfService must be true.");
    }
    if (!input.acceptPrivacyPolicy) {
      throw new BadRequestException("acceptPrivacyPolicy must be true.");
    }

    await this.prismaService.$transaction(async (tx) => {
      const existingUser = await tx.appUser.findUnique({
        where: { id: resolvedAppUser.id }
      });
      if (existingUser === null) {
        throw new BadRequestException("Resolved app user is missing.");
      }
      const now = new Date();
      const termsAcceptedAt =
        existingUser.termsOfServiceVersion === input.termsOfServiceVersion &&
        existingUser.termsOfServiceAcceptedAt !== null
          ? existingUser.termsOfServiceAcceptedAt
          : now;
      const privacyAcceptedAt =
        existingUser.privacyPolicyVersion === input.privacyPolicyVersion &&
        existingUser.privacyPolicyAcceptedAt !== null
          ? existingUser.privacyPolicyAcceptedAt
          : now;
      await tx.appUser.update({
        where: { id: resolvedAppUser.id },
        data: {
          displayName: input.displayName,
          termsOfServiceVersion: input.termsOfServiceVersion,
          termsOfServiceAcceptedAt: termsAcceptedAt,
          privacyPolicyVersion: input.privacyPolicyVersion,
          privacyPolicyAcceptedAt: privacyAcceptedAt
        }
      });

      const activeMembership = await tx.workspaceMember.findFirst({
        where: {
          userId: resolvedAppUser.id,
          workspace: { status: WorkspaceStatus.active }
        },
        include: { workspace: true },
        orderBy: { createdAt: "desc" }
      });

      const fallbackMembership =
        activeMembership ??
        (await tx.workspaceMember.findFirst({
          where: { userId: resolvedAppUser.id },
          include: { workspace: true },
          orderBy: { createdAt: "desc" }
        }));

      if (fallbackMembership === null) {
        const workspace = await tx.workspace.create({
          data: {
            name: input.workspaceName,
            locale: input.locale,
            timezone: input.timezone,
            status: WorkspaceStatus.active
          }
        });

        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: resolvedAppUser.id,
            role: WorkspaceRole.owner
          }
        });

        return;
      }

      await tx.workspace.update({
        where: { id: fallbackMembership.workspaceId },
        data: {
          name: input.workspaceName,
          locale: input.locale,
          timezone: input.timezone,
          status: WorkspaceStatus.active
        }
      });

      await tx.workspaceMember.update({
        where: { id: fallbackMembership.id },
        data: { role: WorkspaceRole.owner }
      });
    });

    const refreshedAppUser = await this.prismaService.appUser.findUnique({
      where: { id: resolvedAppUser.id }
    });

    if (refreshedAppUser === null || refreshedAppUser.clerkUserId === null) {
      throw new BadRequestException("Unable to resolve updated app user after onboarding.");
    }

    return this.getCurrentUserStateService.getCurrentUserState({
      id: refreshedAppUser.id,
      clerkUserId: refreshedAppUser.clerkUserId,
      email: refreshedAppUser.email,
      displayName: refreshedAppUser.displayName
    });
  }
}
