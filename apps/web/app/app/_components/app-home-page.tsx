"use client";

import { useCallback } from "react";
import { useAppDataContext, useShellActions } from "./app-shell";
import { HomeDashboard } from "./home-dashboard";
import { PullToRefresh } from "./pull-to-refresh";

export function AppHomePage() {
  const data = useAppDataContext();
  const { openSettings, openTelegram } = useShellActions();

  // Pull-to-refresh on the app home only re-fetches the home dashboard's
  // own data sources (assistant lifecycle + chats + telegram + plan). It
  // does NOT reload the WebView or other surfaces — those have their own
  // refresh paths (chat history reload, slide-over reopen, etc.).
  const handleRefresh = useCallback(async () => {
    await data.reload();
  }, [data]);

  return (
    <PullToRefresh onRefresh={handleRefresh} className="h-full">
      <HomeDashboard data={data} onSettingsClick={openSettings} onTelegramClick={openTelegram} />
    </PullToRefresh>
  );
}
