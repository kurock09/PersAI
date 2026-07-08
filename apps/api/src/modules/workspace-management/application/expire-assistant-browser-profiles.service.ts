import { Inject, Injectable, Logger } from "@nestjs/common";
import { BrowserBridgeRelayService } from "../../browser-bridge/application/browser-bridge-relay.service";
import {
  ASSISTANT_BROWSER_PROFILE_REPOSITORY,
  type AssistantBrowserProfileRepository
} from "../domain/assistant-browser-profile.repository";
import { randomUUID } from "node:crypto";

@Injectable()
export class ExpireAssistantBrowserProfilesService {
  private readonly logger = new Logger(ExpireAssistantBrowserProfilesService.name);

  constructor(
    @Inject(ASSISTANT_BROWSER_PROFILE_REPOSITORY)
    private readonly repository: AssistantBrowserProfileRepository,
    private readonly browserBridgeRelayService: BrowserBridgeRelayService
  ) {}

  async executeBatch(limit: number): Promise<{ expired: number }> {
    const claimed = await this.repository.claimExpiredProfiles(limit);
    for (const profile of claimed) {
      if (profile.bridgeSessionRef === null) {
        continue;
      }
      try {
        const dispatched = this.browserBridgeRelayService.dispatchCommand({
          assistantId: profile.assistantId,
          workspaceId: profile.workspaceId,
          bridgeDeviceId: profile.bridgeSessionRef,
          command: {
            commandId: randomUUID(),
            profileKey: profile.profileKey,
            action: "close_view"
          }
        });
        if (dispatched.accepted !== true) {
          const code = "code" in dispatched ? dispatched.code : "bridge_unavailable";
          this.logger.warn(
            `browser_profile_expiry_bridge_close_skipped profileId=${profile.id} code=${code}`
          );
        }
      } catch (error) {
        this.logger.warn(
          `browser_profile_expiry_bridge_close_failed profileId=${profile.id} message=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return { expired: claimed.length };
  }
}
