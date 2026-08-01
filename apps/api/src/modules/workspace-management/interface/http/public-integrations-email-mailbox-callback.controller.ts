import { Controller, Get, Query, Res } from "@nestjs/common";
import { HandleMailboxOAuthCallbackService } from "../../application/handle-mailbox-oauth-callback.service";

type PublicCallbackResponse = {
  redirect(url: string): void;
};

/**
 * ADR-169 D11 — provider redirect target for the mailbox OAuth connect flow.
 * Mail.ru/Yandex call this with no Clerk session, so it is intentionally
 * absent from `CLERK_AUTHENTICATED_ROUTES`; the single-use, expiring `state`
 * in `HandleMailboxOAuthCallbackService` is its only guard.
 */
@Controller("api/v1/public/integrations/email-mailbox")
export class PublicIntegrationsEmailMailboxCallbackController {
  constructor(
    private readonly handleMailboxOAuthCallbackService: HandleMailboxOAuthCallbackService
  ) {}

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() res: PublicCallbackResponse
  ): Promise<void> {
    const { redirectUrl } = await this.handleMailboxOAuthCallbackService.handle({
      code: typeof code === "string" ? code : "",
      state: typeof state === "string" ? state : ""
    });
    res.redirect(redirectUrl);
  }
}
