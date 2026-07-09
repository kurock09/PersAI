import { EXTENSION_DEVICE_KIND } from "./constants.js";

export type PendingCompletionAction = "complete" | "cancel";

export interface StoredRegistration {
  assistantId: string;
  workspaceId: string;
  bridgeDeviceId: string;
  deviceKind: typeof EXTENSION_DEVICE_KIND;
  deviceToken: string;
  websocketUrl: string;
  apiBaseUrl?: string | null;
  deviceLabel?: string | null;
  clientVersion?: string | null;
  updatedAt: number;
}

export interface ProfileSessionRecord {
  profileKey: string;
  windowId?: number | null;
  tabId?: number | null;
  lastKnownUrl?: string | null;
  originPattern?: string | null;
  visible: boolean;
  /**
   * True while an `open_view` window is waiting for the PersAI web modal to
   * confirm or cancel the login/action.
   */
  awaitingCompletion?: boolean;
  /**
   * Internal relay slot for any future extension-side fallback completion.
   * The primary UX keeps completion buttons in the PersAI web modal.
   */
  pendingCompletionAction?: PendingCompletionAction | null;
  updatedAt: number;
}

export interface ExtensionStorageState {
  registration?: StoredRegistration | null;
  profiles: Record<string, ProfileSessionRecord>;
  lastProfileKey?: string | null;
}

export function createEmptyState(): ExtensionStorageState {
  return {
    registration: null,
    profiles: {},
    lastProfileKey: null
  };
}

export function upsertProfileRecord(
  state: ExtensionStorageState,
  profileKey: string,
  patch: Partial<ProfileSessionRecord>
): ExtensionStorageState {
  const next = structuredClone(state);
  const existing = next.profiles[profileKey];
  next.profiles[profileKey] = {
    profileKey,
    visible: existing?.visible ?? false,
    updatedAt: patch.updatedAt ?? Date.now(),
    ...existing,
    ...patch
  };
  next.lastProfileKey = profileKey;
  return next;
}

export function setProfileVisibility(
  state: ExtensionStorageState,
  profileKey: string,
  visible: boolean,
  updatedAt = Date.now()
): ExtensionStorageState {
  return upsertProfileRecord(state, profileKey, { visible, updatedAt });
}

export function storeRegistration(
  state: ExtensionStorageState,
  registration: StoredRegistration
): ExtensionStorageState {
  const next = structuredClone(state);
  next.registration = registration;
  return next;
}

export function clearMissingProfileWindow(
  state: ExtensionStorageState,
  profileKey: string,
  updatedAt = Date.now()
): ExtensionStorageState {
  return upsertProfileRecord(state, profileKey, {
    windowId: null,
    tabId: null,
    visible: false,
    updatedAt
  });
}

export function setAwaitingCompletion(
  state: ExtensionStorageState,
  profileKey: string,
  awaiting: boolean,
  updatedAt = Date.now()
): ExtensionStorageState {
  return upsertProfileRecord(state, profileKey, {
    awaitingCompletion: awaiting,
    ...(awaiting ? { pendingCompletionAction: null } : {}),
    updatedAt
  });
}

export function resolvePendingCompletion(
  state: ExtensionStorageState,
  profileKey: string,
  action: PendingCompletionAction,
  updatedAt = Date.now()
): ExtensionStorageState {
  return upsertProfileRecord(state, profileKey, {
    awaitingCompletion: false,
    pendingCompletionAction: action,
    updatedAt
  });
}

export function consumePendingCompletion(
  state: ExtensionStorageState,
  profileKey: string
): { state: ExtensionStorageState; action: PendingCompletionAction | null } {
  const action = state.profiles[profileKey]?.pendingCompletionAction ?? null;
  if (action === null || action === undefined) {
    return { state, action: null };
  }
  return {
    state: upsertProfileRecord(state, profileKey, { pendingCompletionAction: null }),
    action
  };
}

export function listAwaitingCompletionProfiles(
  state: ExtensionStorageState
): Array<{ profileKey: string; lastKnownUrl: string | null }> {
  return Object.values(state.profiles)
    .filter((record) => record.awaitingCompletion === true)
    .map((record) => ({
      profileKey: record.profileKey,
      lastKnownUrl: record.lastKnownUrl ?? null
    }));
}
