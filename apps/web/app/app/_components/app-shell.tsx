"use client";

import {
  type ReactNode,
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from "react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Sidebar } from "./sidebar";
import { SlideOver } from "./slide-over";
import { AssistantSettings } from "./assistant-settings";
import { TelegramConnect } from "./telegram-connect";
import { useAppData, type AppData } from "./use-app-data";
import { useHistoryBackToClose } from "./use-history-back-to-close";
import { BackButtonBridge } from "./back-button-bridge";

const AppDataContext = createContext<AppData | null>(null);

export interface ShellActions {
  openSidebar: () => void;
  openSettings: () => void;
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

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | undefined>();
  const [telegramOpen, setTelegramOpen] = useState(false);
  const appData = useAppData();
  const ts = useTranslations("settings");
  const tt = useTranslations("telegram");
  const pathname = usePathname();
  const router = useRouter();
  const isSetup = pathname === "/app/setup";
  const isChatPage = pathname === "/app/chat";

  const needsSetup =
    appData.assistantStatus === "none" ||
    (appData.assistantStatus === "draft" &&
      appData.assistant?.runtimeApply.status === "not_requested");

  useEffect(() => {
    if (!appData.isLoading && appData.assistantResolved && needsSetup && !isSetup) {
      router.replace("/app/setup" as Route);
    }
  }, [appData.isLoading, appData.assistantResolved, needsSetup, isSetup, router]);

  const shellActions: ShellActions = {
    openSidebar: () => setSidebarOpen(true),
    openSettings: () => setSettingsOpen(true),
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
          <BackButtonBridge />
          {children}
        </ShellActionsContext.Provider>
      </AppDataContext.Provider>
    );
  }

  return (
    <AppDataContext.Provider value={appData}>
      <ShellActionsContext.Provider value={shellActions}>
        <BackButtonBridge />
        <div className="flex h-dvh overflow-hidden bg-bg">
          {/* Desktop sidebar — always visible */}
          <Suspense>
            <div className="hidden md:flex">
              <Sidebar
                data={appData}
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
                    />
                  </Suspense>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Main column */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {!isChatPage && (
              <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                >
                  <span className="sr-only">Open sidebar</span>
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

        {/* Assistant settings slide-over */}
        <SlideOver
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsInitialSection(undefined);
          }}
          title={ts("title")}
          size="narrow"
        >
          <AssistantSettings data={appData} initialSection={settingsInitialSection} />
        </SlideOver>

        {/* Telegram integration slide-over */}
        <SlideOver open={telegramOpen} onClose={() => setTelegramOpen(false)} title={tt("title")}>
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
        </SlideOver>
      </ShellActionsContext.Provider>
    </AppDataContext.Provider>
  );
}
