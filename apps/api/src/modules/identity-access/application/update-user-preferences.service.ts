import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import { CurrentUserState } from "./current-user-state.types";
import { GetCurrentUserStateService } from "./get-current-user-state.service";
import { normalizeLocaleInput, type SupportedLocale } from "./locale-resolution";
import { ResolvedAppUser } from "./resolved-auth-user.types";

export interface UpdateUserPreferencesInput {
  preferredLocale?: SupportedLocale;
  countryCode?: string | null;
}

function normalizeCountryCode(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException("countryCode must be a string or null.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized.length === 0) {
    return null;
  }
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new BadRequestException("countryCode must be a two-letter ISO country code.");
  }
  return normalized;
}

@Injectable()
export class UpdateUserPreferencesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly getCurrentUserStateService: GetCurrentUserStateService
  ) {}

  parseInput(payload: unknown): UpdateUserPreferencesInput {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Preferences payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const hasPreferredLocale = Object.prototype.hasOwnProperty.call(body, "preferredLocale");
    const hasCountryCode = Object.prototype.hasOwnProperty.call(body, "countryCode");

    if (!hasPreferredLocale && !hasCountryCode) {
      throw new BadRequestException("At least one of preferredLocale or countryCode is required.");
    }

    const input: UpdateUserPreferencesInput = {};

    if (hasPreferredLocale) {
      if (typeof body.preferredLocale !== "string") {
        throw new BadRequestException("preferredLocale must be a string.");
      }
      const normalized = normalizeLocaleInput(body.preferredLocale);
      if (normalized === null) {
        throw new BadRequestException("preferredLocale must be one of: en, ru.");
      }
      input.preferredLocale = normalized;
    }

    if (hasCountryCode) {
      input.countryCode = normalizeCountryCode(body.countryCode);
    }

    return input;
  }

  async updatePreferences(
    resolvedAppUser: ResolvedAppUser,
    input: UpdateUserPreferencesInput
  ): Promise<CurrentUserState> {
    await this.prismaService.appUser.update({
      where: { id: resolvedAppUser.id },
      data: {
        ...(input.preferredLocale !== undefined ? { preferredLocale: input.preferredLocale } : {}),
        ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {})
      }
    });

    const refreshedAppUser = await this.prismaService.appUser.findUnique({
      where: { id: resolvedAppUser.id }
    });
    if (refreshedAppUser === null || refreshedAppUser.clerkUserId === null) {
      throw new Error("Resolved app user disappeared while updating preferences.");
    }

    return this.getCurrentUserStateService.getCurrentUserState({
      ...resolvedAppUser,
      preferredLocale: refreshedAppUser.preferredLocale,
      countryCode: refreshedAppUser.countryCode
    });
  }
}
