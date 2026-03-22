import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import { GetCurrentUserStateService } from "../../application/get-current-user-state.service";
import { CurrentUserState } from "../../application/current-user-state.types";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";

@Controller("api/v1")
export class MeController {
  constructor(private readonly getCurrentUserStateService: GetCurrentUserStateService) {}

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
}
