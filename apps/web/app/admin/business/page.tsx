"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  BarChart3,
  Loader2,
  MessageSquare,
  RefreshCw,
  TrendingUp,
  Users,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown
} from "lucide-react";
import { getAdminBusinessPlatform } from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PlanEntry = {
  planCode: string;
  planDisplayName: string | null;
  userCount: number;
  percent: number;
};

type Platform = {
  totalUsers: number;
  totalAssistants: number;
  activeAssistants: number;
  totalConversations: number;
  totalMessages: number;
  activeWebChats: number;
  planDistribution: PlanEntry[];
  quotaPressureDistribution: { low: number; elevated: number; high: number };
  channelAdoption: {
    webChat: number;
    telegram: number;
    whatsapp: number;
    max: number;
    total: number;
  };
  publishApplyHealth: {
    window: string;
    applySucceeded: number;
    applyDegraded: number;
    applyFailed: number;
    applySuccessPercent: number;
  };
  planCatalog: {
    totalPlans: number;
    activePlans: number;
    inactivePlans: number;
    defaultRegistrationPlanCode: string | null;
  };
  runtimeTurnAverages: {
    window: string;
    completedTurns: number;
    turnsWithUsageAccounting: number;
    cachedInputHitTurns: number;
    avgInputTokens: number;
    avgCachedInputTokens: number;
    avgOutputTokens: number;
    avgTotalTokens: number;
    avgUsageStepsPerTurn: number;
    cachedInputSharePercent: number;
    cachedInputHitTurnPercent: number;
  };
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/*  Atoms                                                              */
/* ------------------------------------------------------------------ */

function Fold({
  t,
  open: init = false,
  children
}: {
  t: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  const [o, setO] = useState(init);
  return (
    <section>
      <button
        type="button"
        onClick={() => setO((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1.5 py-0.5"
      >
        <ChevronDown
          className={cn("h-3 w-3 text-text-subtle transition-transform", !o && "-rotate-90")}
        />
        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted">{t}</span>
      </button>
      {o && <div className="mt-1">{children}</div>}
    </section>
  );
}

const CH_LABELS: Record<string, string> = {
  webChat: "Web Chat",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  max: "Max"
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AdminBusinessPage() {
  const { getToken } = useAuth();
  const [p, setP] = useState<Platform | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      const tk = await getToken();
      if (!tk) {
        setErr("Not signed in.");
        setLoading(false);
        return;
      }
      if (refresh) setBusy(true);
      else setLoading(true);
      setErr(null);
      try {
        setP((await getAdminBusinessPlatform(tk)) as unknown as Platform);
      } catch {
        setP(null);
        setErr("Unable to load business metrics.");
      }
      setLoading(false);
      setBusy(false);
    },
    [getToken]
  );

  useEffect(() => void load(false), [load]);

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );

  return (
    <div className="w-full space-y-2.5 px-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold tracking-tight text-text">Global Business Metrics</h1>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(true)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-text-muted transition-colors",
            "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
          Refresh
        </button>
      </div>

      {err && (
        <p className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {err}
        </p>
      )}

      {p && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {(
              [
                { l: "Users", v: p.totalUsers, icon: Users },
                {
                  l: "Assistants",
                  v: p.activeAssistants,
                  s: `${p.totalAssistants} total`
                },
                {
                  l: "Messages",
                  v: p.totalMessages,
                  s: `${p.totalConversations} threads`,
                  icon: MessageSquare
                },
                { l: "Channels", v: p.channelAdoption.total, s: "Active" },
                {
                  l: "Plans Used",
                  v: p.planDistribution.length,
                  s: `of ${p.planCatalog.totalPlans}`,
                  icon: BarChart3
                },
                {
                  l: "Apply OK",
                  v: `${p.publishApplyHealth.applySuccessPercent}%`,
                  s: "Global · 7 days",
                  c:
                    p.publishApplyHealth.applySuccessPercent >= 90
                      ? "text-success"
                      : "text-warning",
                  icon: CheckCircle
                }
              ] as const
            ).map((k) => {
              const Icon = "icon" in k ? k.icon : undefined;
              return (
                <div
                  key={k.l}
                  className="min-w-0 rounded-md border border-border/50 bg-surface-raised px-2.5 py-2"
                >
                  <div className="flex items-center gap-1">
                    {Icon && <Icon className="h-2.5 w-2.5 shrink-0 text-text-subtle" />}
                    <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                      {k.l}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-bold tabular-nums leading-tight",
                      "c" in k && k.c ? k.c : "text-text"
                    )}
                  >
                    {k.v}
                  </p>
                  {"s" in k && k.s && (
                    <p className="text-[10px] leading-tight text-text-muted">{k.s}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Plan distribution */}
          <Fold t="Users by Plan" open>
            {p.planDistribution.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-text-muted">No plan data.</p>
            ) : (
              <div className="divide-y divide-border/40 rounded border border-border/40 bg-surface">
                {p.planDistribution.map((e) => (
                  <div key={e.planCode} className="flex items-center gap-2 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-text">
                          {e.planDisplayName ?? e.planCode}
                        </span>
                        <span className="rounded bg-border/60 px-1 py-px text-[8px] font-mono text-text-subtle">
                          {e.planCode}
                        </span>
                      </div>
                      <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-border/40">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${e.percent}%` }}
                        />
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-text">
                      {e.userCount}
                      <span className="ml-0.5 font-normal text-text-muted">({e.percent}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Fold>

          {/* Quota pressure + Channels side by side */}
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {/* Quota Pressure */}
            <Fold t="Workspace Token Pressure" open>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { k: "low", c: "text-success border-success/20 bg-success/5" },
                    { k: "elevated", c: "text-warning border-warning/20 bg-warning/5" },
                    { k: "high", c: "text-destructive border-destructive/20 bg-destructive/5" }
                  ] as const
                ).map(({ k, c }) => (
                  <div key={k} className={cn("rounded border px-2 py-1.5 text-center", c)}>
                    <p className="text-[9px] font-bold uppercase">{k}</p>
                    <p className="text-xl font-bold tabular-nums">
                      {p.quotaPressureDistribution[k]}
                    </p>
                    <p className="text-[8px] text-text-subtle">workspaces</p>
                  </div>
                ))}
              </div>
            </Fold>

            {/* Channel Adoption */}
            <Fold t="Channel Adoption · Global" open>
              <div className="divide-y divide-border/30 rounded border border-border/40 bg-surface">
                {(["webChat", "telegram", "whatsapp", "max"] as const).map((k) => {
                  const v = p.channelAdoption[k];
                  const pct =
                    p.channelAdoption.total > 0
                      ? Math.round((v / p.channelAdoption.total) * 100)
                      : 0;
                  return (
                    <div
                      key={k}
                      className="flex items-center justify-between px-2.5 py-1 text-[11px]"
                    >
                      <span className="font-medium text-text">{CH_LABELS[k] ?? k}</span>
                      <span className="tabular-nums">
                        <span className="text-text">{v}</span>
                        <span className="ml-1 text-text-muted">({pct}%)</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Fold>
          </div>

          <Fold t="Runtime Token Economics · Global · 7 days" open>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {(
                [
                  {
                    l: "Avg Input",
                    v: p.runtimeTurnAverages.avgInputTokens,
                    s: "tokens / completed turn"
                  },
                  {
                    l: "Avg Cached",
                    v: p.runtimeTurnAverages.avgCachedInputTokens,
                    s: `${p.runtimeTurnAverages.cachedInputSharePercent}% of input`
                  },
                  {
                    l: "Avg Output",
                    v: p.runtimeTurnAverages.avgOutputTokens,
                    s: "tokens / completed turn"
                  },
                  {
                    l: "Avg Total",
                    v: p.runtimeTurnAverages.avgTotalTokens,
                    s: "tokens / completed turn"
                  },
                  {
                    l: "Cache-Hit Turns",
                    v: `${p.runtimeTurnAverages.cachedInputHitTurnPercent}%`,
                    s: `${p.runtimeTurnAverages.cachedInputHitTurns} of ${p.runtimeTurnAverages.turnsWithUsageAccounting}`
                  },
                  {
                    l: "Avg Usage Steps",
                    v: p.runtimeTurnAverages.avgUsageStepsPerTurn,
                    s: "model/tool calls / turn"
                  },
                  {
                    l: "Completed Turns",
                    v: p.runtimeTurnAverages.completedTurns,
                    s: "last 7 days"
                  },
                  {
                    l: "Turns With Usage",
                    v: p.runtimeTurnAverages.turnsWithUsageAccounting,
                    s: "eligible for economics"
                  }
                ] as const
              ).map((metric) => (
                <div
                  key={metric.l}
                  className="rounded border border-border/40 bg-surface px-2.5 py-2"
                >
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                    {metric.l}
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-text">{metric.v}</p>
                  <p className="text-[10px] leading-tight text-text-muted">{metric.s}</p>
                </div>
              ))}
            </div>
          </Fold>

          {/* Apply Health */}
          <Fold t="Publish / Apply Health · Global · 7 days" open>
            <div className="flex items-center gap-3 rounded border border-border/40 bg-surface px-3 py-2">
              <div className="text-center">
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    p.publishApplyHealth.applySuccessPercent >= 90 ? "text-accent" : "text-warning"
                  )}
                >
                  {p.publishApplyHealth.applySuccessPercent}%
                </p>
                <p className="text-[9px] text-text-subtle">success</p>
              </div>
              <div className="flex flex-1 gap-1 text-center text-[10px]">
                <div className="flex-1 rounded bg-success/10 py-1">
                  <CheckCircle className="mx-auto h-2.5 w-2.5 text-success" />
                  <p className="font-bold tabular-nums text-success">
                    {p.publishApplyHealth.applySucceeded}
                  </p>
                </div>
                <div className="flex-1 rounded bg-warning/10 py-1">
                  <AlertTriangle className="mx-auto h-2.5 w-2.5 text-warning" />
                  <p className="font-bold tabular-nums text-warning">
                    {p.publishApplyHealth.applyDegraded}
                  </p>
                </div>
                <div className="flex-1 rounded bg-destructive/10 py-1">
                  <XCircle className="mx-auto h-2.5 w-2.5 text-destructive" />
                  <p className="font-bold tabular-nums text-destructive">
                    {p.publishApplyHealth.applyFailed}
                  </p>
                </div>
              </div>
            </div>
          </Fold>

          {/* Plan Catalog (admin config, collapsed) */}
          <Fold t="Plan Catalog Config">
            <div className="flex items-center gap-4 rounded border border-border/40 bg-surface px-2.5 py-2 text-[10px]">
              <div>
                <span className="text-text-subtle">Default plan </span>
                <span className="font-mono font-medium text-text">
                  {p.planCatalog.defaultRegistrationPlanCode ?? "—"}
                </span>
              </div>
              <div>
                <span className="text-text-subtle">Active </span>
                <span className="font-bold tabular-nums text-success">
                  {p.planCatalog.activePlans}
                </span>
              </div>
              <div>
                <span className="text-text-subtle">Inactive </span>
                <span className="font-bold tabular-nums text-text-muted">
                  {p.planCatalog.inactivePlans}
                </span>
              </div>
            </div>
          </Fold>

          {/* Footer */}
          <p className="pt-0.5 text-center text-[9px] tabular-nums text-text-subtle/50">
            {new Date(p.updatedAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "medium"
            })}
          </p>
        </>
      )}
    </div>
  );
}
