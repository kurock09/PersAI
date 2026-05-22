"use client";

import {
  type ReactNode,
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import type { Route } from "next";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@clerk/nextjs";
import { Sidebar } from "./sidebar";
import { SlideOver } from "./slide-over";
import { useAppData, type AppData } from "./use-app-data";
import { useHistoryBackToClose } from "./use-history-back-to-close";
import { BackButtonBridge } from "./back-button-bridge";
import { AppUrlOpenBridge } from "../../_components/app-url-open-bridge";
import { OfflineGate } from "./offline-gate";
import { StreamingThreadsProvider } from "./streaming-threads";
import type { AppBootstrapInitialData } from "../_server/fetch-app-bootstrap";
import { getMe } from "../me-api-client";
import { getAssistantSupportTickets } from "../assistant-api-client";
import { getLocaleCookie, isWebLocale, setLocaleCookie } from "@/app/lib/locale-sync";

/**
 * ADR-076 Slice 6 — code-split the two heaviest slide-over bodies behind
 * `next/dynamic`. They each weigh tens of KB of TSX and are only mounted
 * the first time the user opens the corresponding panel (Settings or
 * Telegram). `ssr: false` is intentional: both components are deeply
 * client-side (Clerk auth, browser APIs, file uploads) and never need to
 * appear in the initial server-rendered HTML.
 *
 * The actual chunk fetch is gated by the sticky `hasOpenedSettings` /
 * `hasOpenedTelegram` flags below — we only start loading once the user
 * actually opens the panel for the first time, then keep the component
 * mounted so subsequent opens are instant and form state survives.
 */
const AssistantSettings = dynamic(
  () => import("./assistant-settings").then((m) => ({ default: m.AssistantSettings })),
  { ssr: false }
);

const TelegramConnect = dynamic(
  () => import("./telegram-connect").then((m) => ({ default: m.TelegramConnect })),
  { ssr: false }
);

const AppDataContext = createContext<AppData | null>(null);

export interface ShellActions {
  openSidebar: () => void;
  openSettings: (section?: string) => void;
  openTelegram: () => void;
}

const ShellActionsContext = createContext<ShellActions | null>(null);

export function useAppDataContext(): AppData {
  const ctx = useContext(AppDataContext);
  if (ctx === null) throw new Error("useAppDataContext must be used inside AppShell");
  return ctx;
}

export function useShellActions(): ShellActions {
  const ctx = useContext(ShellActionsContext);
  if (ctx === null) throw new Error("useShellActions must be used inside AppShell");
  return ctx;
}

export function AppShell({
  children,
  initialData
}: {
  children: ReactNode;
  initialData: AppBootstrapInitialData | null;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | undefined>();
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  // ADR-076 Slice 6 — sticky "first open" flags. Once true they stay true so
  // the dynamically-imported panel stays mounted across close/reopen cycles
  // (preserves form state, lets <SlideOver>'s framer-motion exit animation
  // play out cleanly, and avoids re-fetching the chunk unnecessarily).
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const [hasOpenedTelegram, setHasOpenedTelegram] = useState(false);
  useEffect(() => {
    if (settingsOpen) setHasOpenedSettings(true);
  }, [settingsOpen]);
  useEffect(() => {
    if (telegramOpen) setHasOpenedTelegram(true);
  }, [telegramOpen]);
  const appData = useAppData(initialData);
  const ts = useTranslations("settings");
  const tt = useTranslations("telegram");
  const locale = useLocale();
  const { getToken, isLoaded: authLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const localeSyncAttemptedRef = useRef(false);
  const isSetup = pathname === "/app/setup";
  const isChatPage = pathname === "/app/chat";

  const refreshSupportUnreadCount = useCallback(async () => {
    if (!authLoaded || !isSignedIn || !appData.assistant?.id) {
      setSupportUnreadCount(0);
      return;
    }
    const token = (await getToken({ skipCache: true })) ?? (await getToken()) ?? null;
    if (!token) {
      return;
    }
    try {
      const rows = await getAssistantSupportTickets(token, appData.assistant.id);
      setSupportUnreadCount(rows.filter((row) => row.hasUnread).length);
    } catch {
      // Keep the last known count when a background poll fails.
    }
  }, [appData.assistant?.id, authLoaded, getToken, isSignedIn]);

  const needsSetup =
    appData.assistantStatus === "none" ||
    (appData.assistantStatus === "draft" &&
      appData.assistant?.runtimeApply.status === "not_requested");

  useEffect(() => {
    if (!appData.isLoading && appData.assistantResolved && needsSetup && !isSetup) {
      router.replace("/app/setup" as Route);
    }
  }, [appData.isLoading, appData.assistantResolved, needsSetup, isSetup, router]);

  useEffect(() => {
    if (!authLoaded || !isSignedIn || localeSyncAttemptedRef.current) {
      return;
    }

    localeSyncAttemptedRef.current = true;

    void (async () => {
      const token = await getToken();
      if (!token) {
        return;
      }

      try {
        const me = await getMe(token);
        const resolvedLocale = me.me.appUser.resolvedLocale;
        if (!isWebLocale(resolvedLocale)) {
          return;
        }

        const cookieLocale = getLocaleCookie();
        if (cookieLocale === resolvedLocale) {
          return;
        }

        setLocaleCookie(resolvedLocale);
        if (locale !== resolvedLocale) {
          window.location.reload();
        }
      } catch {
        // Cookie sync is a best-effort hydration fix for fresh devices.
      }
    })();
  }, [authLoaded, getToken, isSignedIn, locale]);

  useEffect(() => {
    void refreshSupportUnreadCount();
    if (!appData.assistant?.id) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshSupportUnreadCount();
    }, 20_000);
    return () => window.clearInterval(intervalId);
  }, [appData.assistant?.id, refreshSupportUnreadCount]);

  const shellActions: ShellActions = {
    openSidebar: () => setSidebarOpen(true),
    openSettings: (section) => {
      setSettingsInitialSection(section);
      setSettingsOpen(true);
    },
    openTelegram: () => setTelegramOpen(true)
  };

  // Wire mobile slide-out sidebar into the system Back gesture so it
  // dismisses the overlay before navigating the page. Safe now that
  // useHistoryBackToClose uses a JS handler stack instead of pushState
  // markers — no interference with router.push from links inside.
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  useHistoryBackToClose(sidebarOpen, closeSidebar);

  if (isSetup) {
    return (
      <AppDataContext.Provider value={appData}>
        <ShellActionsContext.Provider value={shellActions}>
          <StreamingThreadsProvider>
            <BackButtonBridge />
            <AppUrlOpenBridge />
            <OfflineGate />
            {children}
          </StreamingThreadsProvider>
        </ShellActionsContext.Provider>
      </AppDataContext.Provider>
    );
  }

  return (
    <AppDataContext.Provider value={appData}>
      <ShellActionsContext.Provider value={shellActions}>
        <StreamingThreadsProvider>
          <BackButtonBridge />
          <AppUrlOpenBridge />
          <OfflineGate />
          {/*
          Bento layout on desktop: outer chrome frame (`bg-chrome`) shows
          between the sidebar and main panels via `md:gap-2 md:p-2`. On
          mobile the panels run full-bleed so we don't waste precious edges
          on phones / Capacitor webviews.
        */}
          <div className="flex h-dvh flex-col overflow-hidden bg-chrome">
            <div className="flex flex-1 overflow-hidden md:gap-2 md:p-2">
              {/* Desktop sidebar — always visible */}
              <Suspense>
                <div className="hidden md:flex">
                  <Sidebar
                    data={appData}
                    supportUnreadCount={supportUnreadCount}
                    onAssistantCardClick={() => {
                      setSettingsInitialSection(undefined);
                      setSettingsOpen(true);
                    }}
                    onTelegramClick={() => setTelegramOpen(true)}
                    onLimitsClick={() => {
                      setSettingsInitialSection("limits");
                      setSettingsOpen(true);
                    }}
                  />
                </div>
              </Suspense>

              {/* Mobile sidebar — overlay */}
              <AnimatePresence>
                {sidebarOpen && (
                  <>
                    <motion.div
                      className="fixed inset-0 z-40 bg-black/60 md:hidden"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setSidebarOpen(false)}
                    />
                    <motion.div
                      className="fixed inset-y-0 left-0 z-50 md:hidden"
                      initial={{ x: "-100%" }}
                      animate={{ x: 0 }}
                      exit={{ x: "-100%" }}
                      transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    >
                      <Suspense>
                        <Sidebar
                          data={appData}
                          supportUnreadCount={supportUnreadCount}
                          onClose={() => setSidebarOpen(false)}
                          onAssistantCardClick={() => {
                            setSidebarOpen(false);
                            setSettingsInitialSection(undefined);
                            setSettingsOpen(true);
                          }}
                          onTelegramClick={() => {
                            setSidebarOpen(false);
                            setTelegramOpen(true);
                          }}
                          onLimitsClick={() => {
                            setSidebarOpen(false);
                            setSettingsInitialSection("limits");
                            setSettingsOpen(true);
                          }}
                          onPullToRefresh={appData.reloadChats}
                        />
                      </Suspense>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              {/* Main panel — bento card on desktop, full-bleed on mobile */}
              <div className="flex flex-1 flex-col overflow-hidden bg-bg md:rounded-2xl md:border md:border-border">
                {!isChatPage && (
                  <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
                    <button
                      type="button"
                      onClick={() => setSidebarOpen(true)}
                      className="relative cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <span className="sr-only">Open sidebar</span>
                      {supportUnreadCount > 0 && (
                        <span className="absolute top-0.5 right-0.5 inline-flex min-w-4 items-center justify-center rounded-full border border-accent/20 bg-accent/12 px-1 text-[10px] font-medium leading-4 text-accent">
                          {supportUnreadCount > 9 ? "9+" : supportUnreadCount}
                        </span>
                      )}
                      <svg
                        className="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="3" y1="18" x2="21" y2="18" />
                      </svg>
                    </button>
                    <span className="text-sm font-semibold tracking-tight text-text">
                      Pers<span className="text-accent">AI</span>
                    </span>
                  </header>
                )}

                {/* Page content */}
                <div className="flex-1 overflow-y-auto">{children}</div>
              </div>
            </div>
          </div>

          {/* Assistant settings slide-over (lazy-loaded — ADR-076 Slice 6) */}
          <SlideOver
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsInitialSection(undefined);
            }}
            title={ts("title")}
            size="narrow"
            onPullToRefresh={appData.reload}
          >
            {hasOpenedSettings && (
              <AssistantSettings
                data={appData}
                initialSection={settingsInitialSection}
                onSupportUnreadCountChange={setSupportUnreadCount}
                onOpenTelegramSettings={() => setTelegramOpen(true)}
                onOpenPricingPage={() => {
                  setSettingsOpen(false);
                  setSettingsInitialSection(undefined);
                  router.push("/app/pricing" as Route);
                }}
                onOpenPackagesPage={() => {
                  setSettingsOpen(false);
                  setSettingsInitialSection(undefined);
                  router.push("/app/packages" as Route);
                }}
                onStartBillingCheckout={(paymentIntentId) => {
                  setSettingsOpen(false);
                  setSettingsInitialSection(undefined);
                  router.push(`/app/billing/checkout/${paymentIntentId}` as Route);
                }}
              />
            )}
          </SlideOver>

          {/* Telegram integration slide-over (lazy-loaded — ADR-076 Slice 6) */}
          <SlideOver
            open={telegramOpen}
            onClose={() => setTelegramOpen(false)}
            title={tt("title")}
            size="narrow"
          >
            {hasOpenedTelegram && (
              <TelegramConnect
                integration={appData.telegram}
                capabilityAllowed={appData.plan?.entitlements.channelsAndSurfaces.telegram ?? false}
                assistantAvatarUrl={appData.assistant?.draft.avatarUrl ?? undefined}
                assistantAvatarEmoji={appData.assistant?.draft.avatarEmoji ?? undefined}
                assistantDisplayName={appData.assistant?.draft.displayName ?? undefined}
                onUpdated={() => {
                  void appData.reload();
                }}
              />
            )}
          </SlideOver>
        </StreamingThreadsProvider>
      </ShellActionsContext.Provider>
    </AppDataContext.Provider>
  );
}
