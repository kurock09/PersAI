import type { PendingBrowserLoginState } from "@persai/runtime-contract";
import type { AssistantBrowserProfileRepository } from "../domain/assistant-browser-profile.repository";
import { extractPendingBrowserLoginFromTurn } from "./extract-pending-browser-login-from-turn";

export async function resolvePendingBrowserLoginForWebChat(input: {
  browserProfileRepository: Pick<
    AssistantBrowserProfileRepository,
    "findMostRecentPendingLoginForChat"
  >;
  assistantId: string;
  chatId: string;
}): Promise<PendingBrowserLoginState | null> {
  const pendingProfile = await input.browserProfileRepository.findMostRecentPendingLoginForChat(
    input.assistantId,
    input.chatId
  );
  if (pendingProfile === null || pendingProfile.liveUrl === null) {
    return null;
  }

  return {
    profileId: pendingProfile.id,
    profileKey: pendingProfile.profileKey,
    displayName: pendingProfile.displayName,
    liveUrl: pendingProfile.liveUrl,
    loginUrl: pendingProfile.loginUrl
  };
}

export function resolvePendingBrowserLoginFromRuntimeTurn(input: {
  toolInvocations?: Parameters<typeof extractPendingBrowserLoginFromTurn>[0];
  toolExchanges?: Parameters<typeof extractPendingBrowserLoginFromTurn>[1];
}): PendingBrowserLoginState | null {
  return extractPendingBrowserLoginFromTurn(input.toolInvocations, input.toolExchanges) ?? null;
}
