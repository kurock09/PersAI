import {
  clearMissingProfileWindow,
  createEmptyState,
  type ExtensionStorageState,
  type ProfileSessionRecord
} from "./profile-state.js";

const STORAGE_KEY = "persaiBrowserBridgeState";

export async function readState(): Promise<ExtensionStorageState> {
  const payload = await chrome.storage.local.get(STORAGE_KEY);
  const raw = payload?.[STORAGE_KEY];
  if (raw && typeof raw === "object" && raw !== null) {
    const value = raw as {
      registration?: ExtensionStorageState["registration"];
      profiles?: ExtensionStorageState["profiles"];
      lastProfileKey?: ExtensionStorageState["lastProfileKey"];
    };
    return {
      registration: value.registration ?? null,
      profiles: value.profiles ?? {},
      lastProfileKey: value.lastProfileKey ?? null
    };
  }
  return createEmptyState();
}

export async function writeState(state: ExtensionStorageState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function updateState(
  updater: (state: ExtensionStorageState) => ExtensionStorageState | Promise<ExtensionStorageState>
): Promise<ExtensionStorageState> {
  const current = await readState();
  const next = await updater(current);
  await writeState(next);
  return next;
}

export async function getProfileRecord(profileKey: string): Promise<ProfileSessionRecord | null> {
  const state = await readState();
  return state.profiles[profileKey] ?? null;
}

export async function reconcileProfileRecord(profileKey: string): Promise<ProfileSessionRecord | null> {
  const record = await getProfileRecord(profileKey);
  if (record === null) {
    return null;
  }
  try {
    if (typeof record.windowId === "number") {
      await chrome.windows.get(record.windowId);
    }
    if (typeof record.tabId === "number") {
      await chrome.tabs.get(record.tabId);
    }
    return record;
  } catch {
    const next = await updateState((state) => clearMissingProfileWindow(state, profileKey));
    return next.profiles[profileKey] ?? null;
  }
}
