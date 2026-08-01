import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  InternalRuntimeEmailSendService,
  type InternalRuntimeEmailSendResult
} from "../../application/internal-runtime-email-send.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * ADR-168 — internal send endpoint used by the runtime `email_send` native
 * tool via `PersaiInternalApiClientService`.
 */
@Controller("api/v1/internal/runtime/email")
export class InternalRuntimeEmailController {
  constructor(private readonly internalRuntimeEmailSendService: InternalRuntimeEmailSendService) {}

  @HttpCode(200)
  @Post("send")
  async send(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<InternalRuntimeEmailSendResult> {
    this.assertAuthorized(req);
    const input = this.internalRuntimeEmailSendService.parseInput(body);
    return this.internalRuntimeEmailSendService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime email APIs.",
      "Internal runtime email authorization failed."
    );
  }
}
