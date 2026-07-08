import { EXTENSION_DEVICE_KIND } from "./constants.js";

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
