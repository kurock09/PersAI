import type {
  AssistantBrowserProfileStatus,
  LocalBrowserBridgeDeviceKind
} from "@persai/runtime-contract";

export const ASSISTANT_BROWSER_PROFILE_REPOSITORY = Symbol("ASSISTANT_BROWSER_PROFILE_REPOSITORY");

export type AssistantBrowserProfileRow = {
  id: string;
  assistantId: string;
  workspaceId: string;
  profileKey: string;
  displayName: string;
  loginUrl: string;
  originHost: string;
  bridgeSessionRef: string | null;
  bridgeClientKind: LocalBrowserBridgeDeviceKind | null;
  originatingChatId: string | null;
  status: AssistantBrowserProfileStatus;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAssistantBrowserProfileInput = {
  assistantId: string;
  workspaceId: string;
  profileKey: string;
  displayName: string;
  loginUrl: string;
  originHost: string;
  bridgeSessionRef?: string | null;
  bridgeClientKind?: LocalBrowserBridgeDeviceKind | null;
  originatingChatId?: string | null;
  status: AssistantBrowserProfileStatus;
};

export interface AssistantBrowserProfileRepository {
  findByAssistantAndKey(
    assistantId: string,
    profileKey: string
  ): Promise<AssistantBrowserProfileRow | null>;
  findById(id: string): Promise<AssistantBrowserProfileRow | null>;
  listByAssistant(assistantId: string): Promise<AssistantBrowserProfileRow[]>;
  listProfileKeysWithPrefix(assistantId: string, prefix: string): Promise<string[]>;
  findMostRecentPendingLogin(assistantId: string): Promise<AssistantBrowserProfileRow | null>;
  findMostRecentPendingLoginForChat(
    assistantId: string,
    chatId: string
  ): Promise<AssistantBrowserProfileRow | null>;
  findReusableByAssistantAndOriginHost(
    assistantId: string,
    originHost: string,
    originatingChatId?: string | null
  ): Promise<AssistantBrowserProfileRow | null>;
  create(input: CreateAssistantBrowserProfileInput): Promise<AssistantBrowserProfileRow>;
  updateStatus(id: string, status: AssistantBrowserProfileStatus): Promise<void>;
  updatePendingLogin(
    id: string,
    input: {
      bridgeSessionRef: string | null;
      bridgeClientKind: LocalBrowserBridgeDeviceKind;
    }
  ): Promise<void>;
  activate(
    id: string,
    input: {
      bridgeSessionRef: string;
      bridgeClientKind: LocalBrowserBridgeDeviceKind;
      lastUsedAt: Date;
      expiresAt: Date;
    }
  ): Promise<void>;
  updateBridgeSessionRef(id: string, bridgeSessionRef: string | null): Promise<void>;
  touch(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void>;
  markExpired(id: string): Promise<void>;
  deleteById(id: string): Promise<boolean>;
  claimExpiredProfiles(limit: number): Promise<AssistantBrowserProfileRow[]>;
}
