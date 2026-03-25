"use client";

import { useAppDataContext, useShellActions } from "./app-shell";
import { HomeDashboard } from "./home-dashboard";

export function AppHomePage() {
  const data = useAppDataContext();
  const { openSettings, openTelegram } = useShellActions();

  return (
    <HomeDashboard data={data} onSettingsClick={openSettings} onTelegramClick={openTelegram} />
  );
}
