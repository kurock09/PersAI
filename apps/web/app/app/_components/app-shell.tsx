"use client";

import { type ReactNode, Suspense, createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { SlideOver } from "./slide-over";
import { AssistantSettings } from "./assistant-settings";
import { TelegramConnect } from "./telegram-connect";
import { useAppData, type AppData } from "./use-app-data";

const AppDataContext = createContext<AppData | null>(null);

export interface ShellActions {
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
  const [telegramOpen, setTelegramOpen] = useState(false);
  const appData = useAppData();
  const pathname = usePathname();
  const router = useRouter();
  const isSetup = pathname === "/app/setup";

  useEffect(() => {
    if (!appData.isLoading && appData.assistantResolved && appData.assistantStatus === "none" && !isSetup) {
      router.replace("/app/setup");
    }
  }, [appData.isLoading, appData.assistantResolved, appData.assistantStatus, isSetup, router]);

  const shellActions: ShellActions = {
    openSettings: () => setSettingsOpen(true),
    openTelegram: () => setTelegramOpen(true)
  };

  if (isSetup) {
    return (
      <AppDataContext.Provider value={appData}>
        <ShellActionsContext.Provider value={shellActions}>{children}</ShellActionsContext.Provider>
      </AppDataContext.Provider>
    );
  }

  return (
    <AppDataContext.Provider value={appData}>
      <ShellActionsContext.Provider value={shellActions}>
        <div className="flex h-dvh overflow-hidden bg-bg">
          {/* Desktop sidebar — always visible */}
          <Suspense>
            <div className="hidden md:flex">
              <Sidebar
                data={appData}
                onAssistantCardClick={() => setSettingsOpen(true)}
                onTelegramClick={() => setTelegramOpen(true)}
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
                        setSettingsOpen(true);
                      }}
                      onTelegramClick={() => {
                        setSidebarOpen(false);
                        setTelegramOpen(true);
                      }}
                    />
                  </Suspense>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Main column */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Mobile top bar */}
            <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="text-sm font-semibold tracking-tight text-text">
                Pers<span className="text-accent">AI</span>
              </span>
            </header>

            {/* Page content */}
            <div className="flex-1 overflow-y-auto">{children}</div>
          </div>
        </div>

        {/* Assistant settings slide-over */}
        <SlideOver
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="Assistant settings"
        >
          <AssistantSettings data={appData} />
        </SlideOver>

        {/* Telegram integration slide-over */}
        <SlideOver open={telegramOpen} onClose={() => setTelegramOpen(false)} title="Telegram">
          <TelegramConnect
            integration={appData.telegram}
            capabilityAllowed={appData.plan?.limits.activeWebChatsPercent !== undefined}
            onUpdated={() => {
              void appData.reload();
            }}
          />
        </SlideOver>
      </ShellActionsContext.Provider>
    </AppDataContext.Provider>
  );
}
