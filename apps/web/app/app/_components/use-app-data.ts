"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type {
  AssistantLifecycleState,
  AssistantWebChatListItemState,
  TelegramIntegrationState,
  UserPlanVisibilityState
} from "@persai/contracts";
import {
  getAssistant,
  getAssistantWebChats,
  getAssistantTelegramIntegration,
  getAssistantPlanVisibility,
  getAdminPlanVisibility
} from "../assistant-api-client";

export type AssistantStatus = "live" | "applying" | "draft" | "failed" | "degraded" | "none";

export function deriveAssistantStatus(state: AssistantLifecycleState | null): AssistantStatus {
  if (state === null) return "none";
  if (state.latestPublishedVersion === null) return "draft";
  const s = state.runtimeApply.status;
  if (s === "succeeded") return "live";
  if (s === "pending" || s === "in_progress") return "applying";
  if (s === "failed") return "failed";
  if (s === "degraded") return "degraded";
  return "draft";
}

export interface AppData {
  assistant: AssistantLifecycleState | null;
  assistantStatus: AssistantStatus;
  /** true once getAssistant resolved (even if result is null/404) */
  assistantResolved: boolean;
  chats: AssistantWebChatListItemState[];
  telegram: TelegramIntegrationState | null;
  plan: UserPlanVisibilityState | null;
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  reloadChats: () => void;
}

export function useAppData(): AppData {
  const { getToken } = useAuth();
  const [assistant, setAssistant] = useState<AssistantLifecycleState | null>(null);
  const [chats, setChats] = useState<AssistantWebChatListItemState[]>([]);
  const [telegram, setTelegram] = useState<TelegramIntegrationState | null>(null);
  const [plan, setPlan] = useState<UserPlanVisibilityState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [assistantResolved, setAssistantResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const token = await getToken();
    if (token === null) return;

    setIsLoading(true);
    setError(null);

    try {
      const [assistantRes, chatsRes, telegramRes, planRes, adminProbe] = await Promise.allSettled([
        getAssistant(token),
        getAssistantWebChats(token),
        getAssistantTelegramIntegration(token),
        getAssistantPlanVisibility(token),
        getAdminPlanVisibility(token)
      ]);

      if (assistantRes.status === "fulfilled") {
        setAssistant(assistantRes.value);
        setAssistantResolved(true);
      }
      if (chatsRes.status === "fulfilled") setChats(chatsRes.value);
      if (telegramRes.status === "fulfilled") setTelegram(telegramRes.value);
      if (planRes.status === "fulfilled") setPlan(planRes.value);
      setIsAdmin(adminProbe.status === "fulfilled");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load app data.");
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const reloadChats = useCallback(async () => {
    const token = await getToken();
    if (token === null) return;
    try {
      const result = await getAssistantWebChats(token);
      setChats(result);
    } catch {
      /* non-critical */
    }
  }, [getToken]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return {
    assistant,
    assistantStatus: deriveAssistantStatus(assistant),
    assistantResolved,
    chats,
    telegram,
    plan,
    isAdmin,
    isLoading,
    error,
    reload: () => void loadAll(),
    reloadChats: () => void reloadChats()
  };
}
