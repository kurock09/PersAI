"use client";

import { useEffect, useRef, useState } from "react";
import { getAssistantRole } from "../assistant-api-client";
import { resolveLocalizedRoleText } from "./assistant-role-selector";
import type { AssistantStatus } from "./use-app-data";

export const ASSISTANT_ROLE_CHANGED_EVENT = "persai:assistant-role-changed";

export function notifyAssistantRoleChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(ASSISTANT_ROLE_CHANGED_EVENT));
}

/** Green/live shows the Role name; any other lifecycle status keeps its status label. */
export function resolveAssistantStatusLineText(input: {
  status: AssistantStatus;
  statusLabel: string;
  liveRoleName: string | null;
}): string {
  if (input.status === "live") {
    const roleName = input.liveRoleName?.trim();
    if (roleName && roleName.length > 0) {
      return roleName;
    }
  }
  return input.statusLabel;
}

export function useAssistantLiveRoleName({
  assistantId,
  assistantStatus,
  locale,
  getToken
}: {
  assistantId: string | null | undefined;
  assistantStatus: AssistantStatus;
  locale: string;
  getToken: () => Promise<string | null | undefined>;
}): string | null {
  const [roleName, setRoleName] = useState<string | null>(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const resolvedAssistantId = assistantId ?? null;
  const enabled = assistantStatus === "live" && resolvedAssistantId !== null;

  useEffect(() => {
    if (!enabled || resolvedAssistantId === null) {
      setRoleName(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const token = (await getTokenRef.current()) ?? null;
        if (cancelled || token === null) {
          return;
        }
        const selection = await getAssistantRole(token, resolvedAssistantId, controller.signal);
        if (cancelled || selection.assistantId !== resolvedAssistantId) {
          return;
        }
        const next = resolveLocalizedRoleText(selection.role.name, locale, "").trim();
        setRoleName(next.length > 0 ? next : null);
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setRoleName(null);
        }
      }
    };

    void load();

    const onRoleChanged = () => {
      void load();
    };
    window.addEventListener(ASSISTANT_ROLE_CHANGED_EVENT, onRoleChanged);

    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener(ASSISTANT_ROLE_CHANGED_EVENT, onRoleChanged);
    };
  }, [enabled, locale, resolvedAssistantId]);

  return enabled ? roleName : null;
}
