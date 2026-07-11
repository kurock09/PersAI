"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  getExtensionBridgeStatus,
  isNativeBrowserBridgeShell,
  releaseLocalBrowserObserverLocks,
  registerExtensionBridgeDevice,
  registerNativeBrowserBridgeDevice
} from "../browser-bridge-client";
import { useStreamingThreadsRegistry } from "./streaming-threads";

const BRIDGE_HEALTH_INTERVAL_MS = 30_000;
const OBSERVER_TAB_HEARTBEAT_MS = 15_000;
const OBSERVER_TAB_STALE_MS = 60_000;
const OBSERVER_TAB_STORAGE_PREFIX = "persai:browser-observer-active:";

function observerTabStorageKey(assistantId: string | null, tabId: string): string {
  return `${OBSERVER_TAB_STORAGE_PREFIX}${assistantId ?? "unknown"}:${tabId}`;
}

function writeObserverTabHeartbeat(storageKey: string): void {
  try {
    window.localStorage.setItem(storageKey, String(Date.now()));
  } catch {
    // Storage-disabled browsers degrade to this tab's lifecycle only.
  }
}

function removeObserverTabHeartbeat(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Storage-disabled browsers degrade to this tab's lifecycle only.
  }
}

function hasAnotherActiveObserverTab(assistantId: string | null): boolean {
  try {
    const prefix = `${OBSERVER_TAB_STORAGE_PREFIX}${assistantId ?? "unknown"}:`;
    const staleBefore = Date.now() - OBSERVER_TAB_STALE_MS;
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key === null || !key.startsWith(prefix)) {
        continue;
      }
      const updatedAt = Number(window.localStorage.getItem(key));
      if (Number.isFinite(updatedAt) && updatedAt >= staleBefore) {
        return true;
      }
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage-disabled browsers have no cross-tab coordination surface.
  }
  return false;
}

export function BrowserBridgeConnectionMaintainer({
  assistantId,
  workspaceId
}: {
  assistantId: string | null;
  workspaceId: string | null;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { activeThreads } = useStreamingThreadsRegistry();
  const refreshInFlightRef = useRef(false);
  const observerTurnActiveRef = useRef(false);
  const observerTabIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const maintainConnection = useCallback(async () => {
    if (
      refreshInFlightRef.current ||
      !isLoaded ||
      !isSignedIn ||
      assistantId === null ||
      workspaceId === null
    ) {
      return;
    }
    refreshInFlightRef.current = true;
    try {
      const nativeShell = isNativeBrowserBridgeShell();
      if (!nativeShell) {
        try {
          const status = await getExtensionBridgeStatus();
          if (
            status.connected &&
            status.assistantId === assistantId &&
            status.workspaceId === workspaceId
          ) {
            return;
          }
        } catch {
          // Missing extension: stay silent so ordinary web use is unaffected.
        }
      }

      const token = await getToken();
      if (!token) {
        return;
      }
      const input = { token, assistantId, workspaceId };
      if (nativeShell) {
        await registerNativeBrowserBridgeDevice(input);
      } else {
        await registerExtensionBridgeDevice(input);
      }
    } catch {
      // Background maintenance is best-effort. Product-owned login/assist
      // modals still surface actionable bridge errors when the user invokes one.
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [assistantId, getToken, isLoaded, isSignedIn, workspaceId]);

  useEffect(() => {
    void maintainConnection();
    const intervalId = window.setInterval(() => {
      void maintainConnection();
    }, BRIDGE_HEALTH_INTERVAL_MS);
    const handleOnline = () => void maintainConnection();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void maintainConnection();
      }
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [maintainConnection]);

  useEffect(() => {
    const assistantPrefix = assistantId === null ? null : `${assistantId}::`;
    const assistantIsStreaming = Array.from(activeThreads).some(
      (threadKey) => assistantPrefix === null || threadKey.startsWith(assistantPrefix)
    );
    const storageKey = observerTabStorageKey(assistantId, observerTabIdRef.current);
    const observerTurnWasActive = observerTurnActiveRef.current;
    observerTurnActiveRef.current = assistantIsStreaming;
    if (assistantIsStreaming) {
      writeObserverTabHeartbeat(storageKey);
      const heartbeatId = window.setInterval(
        () => writeObserverTabHeartbeat(storageKey),
        OBSERVER_TAB_HEARTBEAT_MS
      );
      return () => window.clearInterval(heartbeatId);
    }
    if (observerTurnWasActive) {
      removeObserverTabHeartbeat(storageKey);
      if (!hasAnotherActiveObserverTab(assistantId)) {
        void releaseLocalBrowserObserverLocks().catch(() => undefined);
      }
    }
    return undefined;
  }, [activeThreads, assistantId]);

  return null;
}
