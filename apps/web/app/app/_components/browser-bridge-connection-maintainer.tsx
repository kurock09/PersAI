"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  getExtensionBridgeStatus,
  isNativeBrowserBridgeShell,
  registerExtensionBridgeDevice,
  registerNativeBrowserBridgeDevice
} from "../browser-bridge-client";

const BRIDGE_HEALTH_INTERVAL_MS = 30_000;

export function BrowserBridgeConnectionMaintainer({
  assistantId,
  workspaceId
}: {
  assistantId: string | null;
  workspaceId: string | null;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const refreshInFlightRef = useRef(false);

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

  return null;
}
