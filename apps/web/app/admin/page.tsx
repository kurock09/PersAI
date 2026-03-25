"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Shield,
  Server,
  CreditCard,
  Activity,
  TrendingUp,
  Layers,
  Bell,
  ShieldAlert,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  getAdminOpsCockpit,
  getAdminPlans,
  getAdminBusinessCockpit,
} from "@/app/app/assistant-api-client";

interface QuickStat {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}

export default function AdminOverviewPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<QuickStat[]>([]);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const [ops, plans, biz] = await Promise.all([
        getAdminOpsCockpit(token),
        getAdminPlans(token),
        getAdminBusinessCockpit(token),
      ]);

      setStats([
        {
          label: "Runtime",
          value: ops.runtime.preflight.live ? "Live" : "Down",
          sub: ops.runtime.adapterEnabled ? "Adapter on" : "Adapter off",
          color: ops.runtime.preflight.live ? "text-success" : "text-destructive",
        },
        {
          label: "Apply Status",
          value: ops.assistant.runtimeApply?.status ?? "N/A",
          sub: ops.assistant.latestPublishedVersion.version
            ? `v${ops.assistant.latestPublishedVersion.version}`
            : "No version",
        },
        {
          label: "Incidents",
          value: String(ops.incidentSignals.length),
          sub: ops.incidentSignals.length === 0 ? "All clear" : `${ops.incidentSignals.filter((s) => s.severity === "high").length} high`,
          color: ops.incidentSignals.some((s) => s.severity === "high") ? "text-destructive" : "text-success",
        },
        {
          label: "Plans",
          value: `${plans.filter((p) => p.status === "active").length} active`,
          sub: `${plans.length} total`,
        },
        {
          label: "Assistants",
          value: String(biz.activeAssistants.activeAssistants),
          sub: `${biz.activeAssistants.totalAssistants} total`,
        },
        {
          label: "Web Chats",
          value: String(biz.activeChats.activeWebChats),
          sub: `${biz.activeChats.totalWebChats} total`,
        },
        {
          label: "Apply Success",
          value: `${biz.publishApplySuccess.applySuccessPercent}%`,
          sub: `${biz.publishApplySuccess.applyFailed} failed`,
          color: biz.publishApplySuccess.applySuccessPercent >= 90 ? "text-success" : "text-warning",
        },
        {
          label: "Quota Pressure",
          value: biz.quotaPressure.pressureLevel,
          sub: `Tokens ${biz.quotaPressure.tokenBudgetPercent}%`,
          color: biz.quotaPressure.pressureLevel === "low" ? "text-success" : biz.quotaPressure.pressureLevel === "high" ? "text-destructive" : "text-warning",
        },
      ]);
    } catch { /* non-critical */ }
    setLoading(false);
  }, [getToken]);

  useEffect(() => { void load(); }, [load]);

  const NAV = [
    { href: "/admin/runtime", label: "Runtime Settings", icon: Server },
    { href: "/admin/plans", label: "Plan Management", icon: CreditCard },
    { href: "/admin/ops", label: "Ops Cockpit", icon: Activity },
    { href: "/admin/business", label: "Business Cockpit", icon: TrendingUp },
    { href: "/admin/rollouts", label: "Platform Rollouts", icon: Layers },
    { href: "/admin/notifications", label: "Notification Channels", icon: Bell },
    { href: "/admin/abuse", label: "Abuse Controls", icon: ShieldAlert },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Shield className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-bold text-text">Admin Overview</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-surface-raised p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">{s.label}</p>
                <p className={cn("mt-1 text-lg font-bold", s.color ?? "text-text")}>{s.value}</p>
                {s.sub && <p className="text-[11px] text-text-muted">{s.sub}</p>}
              </div>
            ))}
          </div>

          <h2 className="mt-8 mb-3 text-xs font-semibold uppercase tracking-wider text-text-subtle">Quick Access</h2>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => router.push(item.href)}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <Icon className="h-4 w-4 text-text-muted" />
                  <span className="flex-1 text-sm font-medium text-text">{item.label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
