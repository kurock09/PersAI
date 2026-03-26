import { Controller, HttpCode, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ForceReapplyAllService,
  type ForceReapplyAllSummary
} from "../../application/force-reapply-all.service";

@Controller("api/v1/admin/runtime")
export class AdminForceReapplyController {
  constructor(private readonly forceReapplyAllService: ForceReapplyAllService) {}

  @HttpCode(200)
  @Post("force-reapply-all")
  async forceReapplyAll(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    summary: ForceReapplyAllSummary;
  }> {
    const userId = this.resolveRequestUserId(req);
    const summary = await this.forceReapplyAllService.execute(userId, this.resolveStepUpToken(req));
    return {
      requestId: req.requestId ?? null,
      summary
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private resolveStepUpToken(req: RequestWithPlatformContext): string | null {
    const header = req.headers["x-persai-step-up-token"];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return typeof header === "string" ? header : null;
  }
}
