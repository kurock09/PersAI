import type { ReactNode } from "react";
import { AppShell } from "./_components/app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
