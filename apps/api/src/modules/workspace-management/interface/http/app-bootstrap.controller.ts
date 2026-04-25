import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  GetAssistantAppBootstrapService,
  type AppBootstrapSectionsState
} from "../../application/get-assistant-app-bootstrap.service";

/**
 * ADR-076 Slice 3 — single bootstrap surface for the web shell.
 *
 * `apps/web/app/app/layout.tsx` (RSC) calls this exactly once during the
 * initial server-side render and seeds the client cache with `initialData`,
 * so the post-hydration UI never flashes loading skeletons over the six
 * resources that were previously fan-fired from the browser.
 */
@Controller("api/v1/app")
export class AppBootstrapController {
  constructor(private readonly getAssistantAppBootstrapService: GetAssistantAppBootstrapService) {}

  @Get("bootstrap")
  async getBootstrap(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    sections: AppBootstrapSectionsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const sections = await this.getAssistantAppBootstrapService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      sections
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
