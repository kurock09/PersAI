import type { ReactNode } from "react";
import { AppShell } from "./_components/app-shell";
import { fetchAppBootstrap } from "./_server/fetch-app-bootstrap";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const initialData = await fetchAppBootstrap();
  return <AppShell initialData={initialData}>{children}</AppShell>;
}
