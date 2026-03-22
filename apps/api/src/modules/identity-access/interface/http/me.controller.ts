import { Body, Controller, Get, Post, Req, UnauthorizedException } from "@nestjs/common";
import { GetCurrentUserStateService } from "../../application/get-current-user-state.service";
import { CurrentUserState } from "../../application/current-user-state.types";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { UpsertOnboardingService } from "../../application/upsert-onboarding.service";

@Controller("api/v1")
export class MeController {
  constructor(
    private readonly getCurrentUserStateService: GetCurrentUserStateService,
    private readonly upsertOnboardingService: UpsertOnboardingService
  ) {}

  @Get("me")
  async getCurrentUser(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    me: CurrentUserState;
  }> {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    const me = await this.getCurrentUserStateService.getCurrentUserState(req.resolvedAppUser);

    return {
      requestId: req.requestId ?? null,
      me
    };
  }

  @Post("me/onboarding")
  async upsertOnboarding(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    me: CurrentUserState;
  }> {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    const input = this.upsertOnboardingService.parseInput(body);
    const me = await this.upsertOnboardingService.upsertOnboarding(req.resolvedAppUser, input);

    return {
      requestId: req.requestId ?? null,
      me
    };
  }
}
