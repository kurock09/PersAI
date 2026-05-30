"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type {
  AssistantLifecycleState,
  AssistantLimitState,
  AssistantListItemState,
  AssistantWebChatListItemState,
  TelegramIntegrationState,
  UserPlanVisibilityState
} from "@persai/contracts";
import {
  getAssistantLifecycleView,
  getAssistantNotificationPreference,
  getAssistantWebChats,
  getAssistantTelegramIntegration,
  getAssistantPlanVisibility,
  getAdminPlanVisibility,
  postAssistantCreateLifecycleView,
  postAssistantSwitch,
  type AssistantLifecycleViewState,
  type AssistantNotificationPreferenceState
} from "../assistant-api-client";
import type { AppBootstrapInitialData } from "../_server/fetch-app-bootstrap";

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
  assistants: AssistantListItemState[];
  activeAssistantId: string | null;
  assistantLimit: AssistantLimitState | null;
  assistantStatus: AssistantStatus;
  /** true once getAssistant resolved (even if result is null/404) */
  assistantResolved: boolean;
  chats: AssistantWebChatListItemState[];
  telegram: TelegramIntegrationState | null;
  notificationPreference: AssistantNotificationPreferenceState | null;
  plan: UserPlanVisibilityState | null;
  isAdmin: boolean;
  /**
   * ADR-076 Slice 5 — true only during the cold-start fan-out (when the SSR
   * bootstrap was unavailable so the client must fetch everything from
   * scratch). With seeded `initialData` this stays false from first paint
   * onwards, which is what lets us avoid global "isLoading" skeletons after
   * the first render.
   */
  isLoading: boolean;
  /**
   * ADR-076 Slice 5 — true while an explicit `reload()` is in flight after
   * initial cold-start has resolved. Surfaces are encouraged to ignore this
   * (existing data stays visible) unless they have a genuinely empty pending
   * window, in which case a small targeted shimmer is acceptable.
   */
  isReloading: boolean;
  /**
   * ADR-076 Slice 5 — true while `reloadChats()` is in flight. Used by the
   * sidebar to show a 2–3 row shimmer in the chat list, but only when the
   * list is currently empty (e.g. right after the user deleted their last
   * chat). When the list is non-empty we keep existing rows visible to
   * preserve perceived continuity.
   */
  isReloadingChats: boolean;
  error: string | null;
  reload: () => Promise<void>;
  reloadChats: () => Promise<void>;
  createAssistant: () => Promise<AssistantLifecycleViewState>;
  switchAssistant: (assistantId: string) => Promise<AssistantLifecycleViewState>;
  markChatListActivity: (surfaceThreadKey: string) => void;
}

interface SeededState {
  assistant: AssistantLifecycleState | null;
  assistants: AssistantListItemState[];
  activeAssistantId: string | null;
  assistantLimit: AssistantLimitState | null;
  chats: AssistantWebChatListItemState[];
  telegram: TelegramIntegrationState | null;
  notificationPreference: AssistantNotificationPreferenceState | null;
  plan: UserPlanVisibilityState | null;
  isAdmin: boolean;
  assistantResolved: boolean;
  isLoading: boolean;
  /**
   * ADR-076 Slice 3 hotfix — true when the SSR bootstrap envelope arrived but
   * the assistant section was not `ok` (e.g. upstream 401/5xx). In that case
   * we still need to run the client fan-out to give the user a real chance
   * at recovery instead of silently rendering "ассистент не создан" forever.
   */
  needsClientFallback: boolean;
  error: string | null;
}

function seedFromInitialData(initialData: AppBootstrapInitialData | null): SeededState {
  if (initialData === null) {
    return {
      assistant: null,
      assistants: [],
      activeAssistantId: null,
      assistantLimit: null,
      chats: [],
      telegram: null,
      notificationPreference: null,
      plan: null,
      isAdmin: false,
      assistantResolved: false,
      isLoading: true,
      needsClientFallback: false,
      error: null
    };
  }

  const assistantSection = initialData.assistant;
  const chatsSection = initialData.chats;
  const telegramSection = initialData.telegram;
  const preferenceSection = initialData.notificationPreference;
  const planSection = initialData.plan;
  const adminSection = initialData.admin;

  return {
    assistant: assistantSection.ok ? assistantSection.data.assistant : null,
    assistants: assistantSection.ok ? assistantSection.data.assistants : [],
    activeAssistantId: assistantSection.ok ? assistantSection.data.activeAssistantId : null,
    assistantLimit: assistantSection.ok ? assistantSection.data.assistantLimit : null,
    chats: chatsSection.ok ? chatsSection.data : [],
    telegram: telegramSection.ok ? telegramSection.data : null,
    notificationPreference: preferenceSection.ok ? preferenceSection.data : null,
    plan: planSection.ok ? planSection.data : null,
    isAdmin: adminSection.ok,
    assistantResolved: assistantSection.ok,
    isLoading: !assistantSection.ok,
    needsClientFallback: !assistantSection.ok,
    error: assistantSection.ok ? null : assistantSection.error.message
  };
}

/**
 * ADR-076 Slice 3 — when `initialData` is provided by the async RSC layout,
 * the hook seeds state synchronously and skips the cold-start fan-out so the
 * UI never renders a blank skeleton on first paint. Subsequent `reload()`
 * calls keep using the per-endpoint client so mutations refresh just the
 * surface they touched.
 */
export function useAppData(initialData: AppBootstrapInitialData | null): AppData {
  const { getToken } = useAuth();
  const seed = useRef(seedFromInitialData(initialData));
  const [assistant, setAssistant] = useState<AssistantLifecycleState | null>(
    seed.current.assistant
  );
  const [assistants, setAssistants] = useState<AssistantListItemState[]>(seed.current.assistants);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(
    seed.current.activeAssistantId
  );
  const [assistantLimit, setAssistantLimit] = useState<AssistantLimitState | null>(
    seed.current.assistantLimit
  );
  const [chats, setChats] = useState<AssistantWebChatListItemState[]>(seed.current.chats);
  const [telegram, setTelegram] = useState<TelegramIntegrationState | null>(seed.current.telegram);
  const [notificationPreference, setNotificationPreference] =
    useState<AssistantNotificationPreferenceState | null>(seed.current.notificationPreference);
  const [plan, setPlan] = useState<UserPlanVisibilityState | null>(seed.current.plan);
  const [isAdmin, setIsAdmin] = useState(seed.current.isAdmin);
  const [isLoading, setIsLoading] = useState(seed.current.isLoading);
  const [isReloading, setIsReloading] = useState(false);
  const [isReloadingChats, setIsReloadingChats] = useState(false);
  const [assistantResolved, setAssistantResolved] = useState(seed.current.assistantResolved);
  const [error, setError] = useState<string | null>(seed.current.error);

  const applyAssistantLifecycleView = useCallback((view: AssistantLifecycleViewState) => {
    setAssistant(view.assistant);
    setAssistants(view.assistants);
    setActiveAssistantId(view.activeAssistantId);
    setAssistantLimit(view.assistantLimit);
    setAssistantResolved(true);
  }, []);

  const refreshAssistantScopedSlices = useCallback(
    async (token: string) => {
      const [chatsRes, telegramRes, preferenceRes, planRes] = await Promise.allSettled([
        getAssistantWebChats(token),
        getAssistantTelegramIntegration(token),
        getAssistantNotificationPreference(token),
        getAssistantPlanVisibility(token)
      ]);

      if (chatsRes.status === "fulfilled") {
        setChats(chatsRes.value);
      }
      if (telegramRes.status === "fulfilled") {
        setTelegram(telegramRes.value);
      }
      if (preferenceRes.status === "fulfilled") {
        setNotificationPreference(preferenceRes.value);
      }
      if (planRes.status === "fulfilled") {
        setPlan(planRes.value);
      }
    },
    [setChats, setNotificationPreference, setTelegram, setPlan]
  );

  const runAssistantDirectoryMutation = useCallback(
    async (action: (token: string) => Promise<AssistantLifecycleViewState>) => {
      const token = await getToken({ skipCache: true });
      if (token === null) {
        throw new Error("Session expired.");
      }

      setIsReloading(true);
      setError(null);

      try {
        const view = await action(token);
        applyAssistantLifecycleView(view);
        setChats([]);
        setTelegram(null);
        setNotificationPreference(null);
        await refreshAssistantScopedSlices(token);
        return view;
      } catch (mutationError) {
        setError(
          mutationError instanceof Error ? mutationError.message : "Failed to update assistant."
        );
        throw mutationError;
      } finally {
        setIsReloading(false);
      }
    },
    [applyAssistantLifecycleView, getToken, refreshAssistantScopedSlices]
  );

  /**
   * ADR-076 Slice 5 — `isLoading` is reserved for the cold-start fan-out only
   * (i.e. the very first time `loadAll()` runs without seeded data). Any
   * subsequent reload after the assistant has been resolved switches on the
   * `isReloading` flag instead, so callers like `<Sidebar>` keep showing
   * existing content rather than flashing a global skeleton.
   */
  const loadAll = useCallback(async () => {
    const token = await getToken();
    if (token === null) return;

    const isInitial = !assistantResolved;
    if (isInitial) setIsLoading(true);
    else setIsReloading(true);
    setError(null);

    try {
      const [assistantRes, chatsRes, telegramRes, preferenceRes, planRes, adminProbe] =
        await Promise.allSettled([
          getAssistantLifecycleView(token),
          getAssistantWebChats(token),
          getAssistantTelegramIntegration(token),
          getAssistantNotificationPreference(token),
          getAssistantPlanVisibility(token),
          getAdminPlanVisibility(token)
        ]);

      if (assistantRes.status === "fulfilled") {
        applyAssistantLifecycleView(assistantRes.value);
      } else if (assistantRes.status === "rejected") {
        setError(
          assistantRes.reason instanceof Error
            ? assistantRes.reason.message
            : "Assistant load failed."
        );
      }
      if (chatsRes.status === "fulfilled") setChats(chatsRes.value);
      if (telegramRes.status === "fulfilled") setTelegram(telegramRes.value);
      if (preferenceRes.status === "fulfilled") setNotificationPreference(preferenceRes.value);
      if (planRes.status === "fulfilled") setPlan(planRes.value);
      setIsAdmin(adminProbe.status === "fulfilled");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load app data.");
    } finally {
      setIsLoading(false);
      setIsReloading(false);
    }
  }, [applyAssistantLifecycleView, getToken, assistantResolved]);

  const reloadChats = useCallback(async () => {
    const token = await getToken();
    if (token === null) return;
    setIsReloadingChats(true);
    try {
      const result = await getAssistantWebChats(token);
      setChats(result);
    } catch {
      /* non-critical */
    } finally {
      setIsReloadingChats(false);
    }
  }, [getToken]);

  const markChatListActivity = useCallback((surfaceThreadKey: string) => {
    const nextLastMessageAt = new Date().toISOString();
    setChats((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.chat.surfaceThreadKey !== surfaceThreadKey) {
          return item;
        }
        changed = true;
        return {
          ...item,
          chat: {
            ...item.chat,
            lastMessageAt: nextLastMessageAt
          }
        };
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (initialData === null) {
      void loadAll();
      return;
    }
    /**
     * ADR-076 Slice 3 hotfix — when SSR bootstrap returned an envelope but
     * the assistant section is errored (e.g. upstream 401), fall back to the
     * legacy client fan-out instead of leaving the user staring at an empty
     * "ассистент не создан" sidebar. The check fires once on first paint
     * because `seed.current` is initialised synchronously in this hook.
     */
    if (seed.current.needsClientFallback) {
      void loadAll();
    }
  }, [initialData, loadAll]);

  return {
    assistant,
    assistants,
    activeAssistantId,
    assistantLimit,
    assistantStatus: deriveAssistantStatus(assistant),
    assistantResolved,
    chats,
    telegram,
    notificationPreference,
    plan,
    isAdmin,
    isLoading,
    isReloading,
    isReloadingChats,
    error,
    reload: loadAll,
    reloadChats,
    createAssistant: () =>
      runAssistantDirectoryMutation((token) => postAssistantCreateLifecycleView(token)),
    switchAssistant: (assistantId: string) =>
      runAssistantDirectoryMutation((token) => postAssistantSwitch(token, assistantId)),
    markChatListActivity
  };
}
