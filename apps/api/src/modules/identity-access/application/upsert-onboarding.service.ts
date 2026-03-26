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
  birthday: string | null;
  gender: string | null;
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

    const birthday = this.parseOptionalDate(body.birthday, "birthday");
    const gender = this.parseOptionalGender(body.gender);

    return {
      displayName: normalizeRequiredField(body.displayName, "displayName"),
      workspaceName: normalizeRequiredField(body.workspaceName, "workspaceName"),
      locale: normalizeRequiredField(body.locale, "locale"),
      timezone: normalizeRequiredField(body.timezone, "timezone"),
      birthday,
      gender,
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
          ...(input.birthday !== null ? { birthday: new Date(input.birthday) } : {}),
          ...(input.gender !== null ? { gender: input.gender } : {}),
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

    await this.prismaService.assistant
      .updateMany({
        where: { userId: resolvedAppUser.id },
        data: { configDirtyAt: new Date() }
      })
      .catch(() => {});

    return this.getCurrentUserStateService.getCurrentUserState({
      id: refreshedAppUser.id,
      clerkUserId: refreshedAppUser.clerkUserId,
      email: refreshedAppUser.email,
      displayName: refreshedAppUser.displayName
    });
  }

  private parseOptionalDate(value: unknown, fieldName: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      throw new BadRequestException(`${fieldName} must be a date string (YYYY-MM-DD) or null.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${fieldName} must be in YYYY-MM-DD format.`);
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} is not a valid date.`);
    }
    return value;
  }

  private parseOptionalGender(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      throw new BadRequestException("gender must be a string or null.");
    }
    const trimmed = value.trim();
    if (trimmed.length > 32) {
      throw new BadRequestException("gender must be at most 32 characters.");
    }
    return trimmed;
  }
}
