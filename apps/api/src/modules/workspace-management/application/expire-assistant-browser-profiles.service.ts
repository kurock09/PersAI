import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_BROWSER_PROFILE_REPOSITORY,
  type AssistantBrowserProfileRepository
} from "../domain/assistant-browser-profile.repository";
import { BROWSERLESS_SESSION_PORT, type BrowserlessSessionPort } from "./browserless-session.port";
import { resolveBrowserToolCredentialSecretId } from "./tool-credential-settings";

@Injectable()
export class ExpireAssistantBrowserProfilesService {
  private readonly logger = new Logger(ExpireAssistantBrowserProfilesService.name);

  constructor(
    @Inject(ASSISTANT_BROWSER_PROFILE_REPOSITORY)
    private readonly repository: AssistantBrowserProfileRepository,
    @Inject(BROWSERLESS_SESSION_PORT)
    private readonly browserlessSessionPort: BrowserlessSessionPort
  ) {}

  async executeBatch(limit: number): Promise<{ expired: number }> {
    const claimed = await this.repository.claimExpiredProfiles(limit);
    const browserCredentialSecretId = resolveBrowserToolCredentialSecretId();
    for (const profile of claimed) {
      try {
        await this.browserlessSessionPort.deleteSession(profile.providerSessionId, {
          browserCredentialSecretId
        });
      } catch (error) {
        this.logger.warn(
          `browser_profile_expiry_provider_delete_failed profileId=${profile.id} message=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return { expired: claimed.length };
  }
}
