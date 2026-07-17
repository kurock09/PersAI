"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CreditCard,
  Activity,
  TrendingUp,
  Layers,
  Bell,
  Server,
  Shield,
  ShieldAlert,
  Wrench,
  FileText,
  Library,
  GraduationCap,
  Settings,
  Menu,
  X,
  Loader2,
  MessageCircle,
  UserRoundCog,
  Code2
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { getAdminPlanVisibility } from "@/app/app/assistant-api-client";
import { getAdminSessionToken } from "@/app/admin/admin-session";

const NAV_ITEMS = [
  { href: "/admin", label: "System Overview", icon: Shield },
  { href: "/admin/runtime", label: "Runtime", icon: Server },
  { href: "/admin/tools", label: "Tools", icon: Wrench },
  { href: "/admin/presets", label: "Prompt Constructor", icon: FileText },
  { href: "/admin/site-pages", label: "Site Pages", icon: FileText },
  { href: "/admin/knowledge", label: "Knowledge", icon: Library },
  { href: "/admin/skills", label: "Skills", icon: GraduationCap },
  { href: "/admin/scripts", label: "Scripts", labelKey: "scripts", icon: Code2 },
  { href: "/admin/roles", label: "Roles", labelKey: "roles", icon: UserRoundCog },
  { href: "/admin/plans", label: "Plans", icon: CreditCard },
  { href: "/admin/billing-settings", label: "Billing Settings", icon: Settings },
  { href: "/admin/ops", label: "Ops Cockpit", icon: Activity },
  { href: "/admin/support", label: "Support", icon: MessageCircle },
  { href: "/admin/business", label: "Business", icon: TrendingUp },
  { href: "/admin/rollouts", label: "Rollouts", icon: Layers },
  { href: "/admin/abuse", label: "Abuse Controls", icon: ShieldAlert },
  { href: "/admin/notifications", label: "Notifications", icon: Bell }
] as const;

function AdminSidebar({ onClose }: { onClose?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const roleT = useTranslations("adminRoles");
  const scriptT = useTranslations("adminScripts");

  return (
    <aside className="flex h-dvh w-[220px] shrink-0 flex-col border-r border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-accent" />
          <span className="text-xs font-bold uppercase tracking-wider text-text">Admin</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-text-muted hover:text-text md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => {
                router.push(item.href as Route);
                onClose?.();
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {"labelKey" in item && item.labelKey === "roles"
                ? roleT("title")
                : "labelKey" in item && item.labelKey === "scripts"
                  ? scriptT("title")
                  : item.label}
            </button>
          );
        })}
      </nav>

      {/* Back to app */}
      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={() => {
            router.push("/app" as Route);
            onClose?.();
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to app
        </button>
      </div>
    </aside>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "authorized" | "denied">("checking");

  useEffect(() => {
    void (async () => {
      try {
        const token = await getAdminSessionToken(getToken);
        if (!token) {
          setAuthState("denied");
          return;
        }
        await getAdminPlanVisibility(token);
        setAuthState("authorized");
      } catch {
        setAuthState("denied");
      }
    })();
  }, [getToken]);

  useEffect(() => {
    if (authState === "denied") {
      router.replace("/app" as Route);
    }
  }, [authState, router]);

  if (authState !== "authorized") {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <AdminSidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <AdminSidebar onClose={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2.5 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="cursor-pointer rounded-lg p-1.5 text-text-muted hover:text-text"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-xs font-bold uppercase tracking-wider text-text">Admin</span>
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
