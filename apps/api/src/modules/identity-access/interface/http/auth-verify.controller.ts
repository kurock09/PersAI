import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";

@Controller("api/v1/auth")
export class AuthVerifyController {
  @Get("verify")
  getVerification(@Req() req: RequestWithPlatformContext): {
    requestId: string | null;
    authenticated: true;
    appUser: {
      id: string;
      clerkUserId: string;
      email: string;
      displayName: string | null;
    };
  } {
    const resolvedAppUser = req.resolvedAppUser;
    if (resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    return {
      requestId: req.requestId ?? null,
      authenticated: true,
      appUser: resolvedAppUser
    };
  }
}
