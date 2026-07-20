"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { AdminBusinessPlatformState } from "@persai/contracts";
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
/*  Atoms                                                              */
/* ------------------------------------------------------------------ */

function Fold({
  t,
  open: init = false,
  stretch = false,
  children
}: {
  t: string;
  open?: boolean;
  stretch?: boolean;
  children: React.ReactNode;
}) {
  const [o, setO] = useState(init);
  return (
    <section className={cn(stretch && "flex h-full flex-col")}>
      <button
        type="button"
        onClick={() => setO((v) => !v)}
        className="flex w-full shrink-0 cursor-pointer items-center gap-1.5 py-0.5"
      >
        <ChevronDown
          className={cn("h-3 w-3 text-text-subtle transition-transform", !o && "-rotate-90")}
        />
        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted">{t}</span>
      </button>
      {o && <div className={cn("mt-1", stretch && "flex flex-1 flex-col")}>{children}</div>}
    </section>
  );
}

const CH_LABELS: Record<string, string> = {
  webChat: "Web Chat",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  max: "Max"
};

function formatPaidMinor(totalMinor: number, currency: string): string {
  const amount = totalMinor / 100;
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatCurrencyMicros(totalCostMicros: number, currency: string): string {
  const amount = totalCostMicros / 1_000_000;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  } catch {
    return `${amount.toFixed(4)} ${currency}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AdminBusinessPage() {
  const { getToken } = useAuth();
  const [p, setP] = useState<AdminBusinessPlatformState | null>(null);
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
        setP(await getAdminBusinessPlatform(tk));
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
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:items-stretch">
            <Fold t="Workspace Token Pressure" open stretch>
              <div className="grid h-full flex-1 grid-cols-3 gap-1.5">
                {(
                  [
                    { k: "low", c: "text-success border-success/20 bg-success/5" },
                    { k: "elevated", c: "text-warning border-warning/20 bg-warning/5" },
                    { k: "high", c: "text-destructive border-destructive/20 bg-destructive/5" }
                  ] as const
                ).map(({ k, c }) => (
                  <div
                    key={k}
                    className={cn(
                      "flex min-h-[5.5rem] flex-col items-center justify-center rounded border px-2 py-2 text-center sm:min-h-0 sm:h-full",
                      c
                    )}
                  >
                    <p className="text-[9px] font-bold uppercase">{k}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {p.quotaPressureDistribution[k]}
                    </p>
                    <p className="mt-0.5 text-[8px] text-text-subtle">workspaces</p>
                  </div>
                ))}
              </div>
            </Fold>

            <Fold t="Channel Adoption · Global" open stretch>
              <div className="flex h-full flex-1 flex-col divide-y divide-border/30 rounded border border-border/40 bg-surface">
                {(["webChat", "telegram", "whatsapp", "max"] as const).map((k) => {
                  const v = p.channelAdoption[k];
                  const pct =
                    p.channelAdoption.total > 0
                      ? Math.round((v / p.channelAdoption.total) * 100)
                      : 0;
                  return (
                    <div
                      key={k}
                      className="flex flex-1 items-center justify-between px-2.5 py-1.5 text-[11px]"
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

          <Fold t="Ledger-backed Model Cost · Global · all time" open>
            <div className="space-y-1.5">
              <p className="text-[10px] text-text-muted">
                Cumulative since platform start · {p.ledgerBackedModelCost.totalEvents} ledger
                events ({p.ledgerBackedModelCost.periodSource.replaceAll("_", " ")})
              </p>
              <p className="rounded border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-[10px] leading-relaxed text-text-muted">
                {p.ledgerBackedModelCost.coverageNote}
              </p>

              {p.ledgerBackedModelCost.currencyTotals.length === 0 &&
              p.platformPaymentRevenueAllTime.rubTotalMinor === 0 &&
              p.platformPaymentRevenueAllTime.usdTotalMinor === 0 ? (
                <p className="rounded border border-border/40 bg-surface px-2.5 py-2 text-[11px] text-text-muted">
                  No ledger-backed cost rows or succeeded payments recorded yet.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                    {p.ledgerBackedModelCost.currencyTotals.map((entry) => (
                      <div
                        key={entry.currency}
                        className="rounded border border-border/40 bg-surface px-2.5 py-2"
                      >
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                          Cost · {entry.currency}
                        </p>
                        <p className="mt-0.5 text-lg font-bold tabular-nums text-text">
                          {formatCurrencyMicros(entry.totalCostMicros, entry.currency)}
                        </p>
                        <p className="text-[10px] leading-tight text-text-muted">
                          {entry.eventCount} ledger events · all time
                        </p>
                      </div>
                    ))}
                    <div className="rounded border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                        Payments · RUB
                      </p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-text">
                        {formatPaidMinor(p.platformPaymentRevenueAllTime.rubTotalMinor, "RUB")}
                      </p>
                      <p className="text-[10px] leading-tight text-text-muted">
                        {p.platformPaymentRevenueAllTime.rubSucceededPayments} succeeded
                        {p.platformPaymentRevenueAllTime.rubSucceededPayments === 1
                          ? " payment"
                          : " payments"}
                        {" · all time"}
                      </p>
                      {p.platformPaymentRevenueAllTime.usdTotalMinor > 0 ? (
                        <p className="mt-1 border-t border-border/30 pt-1 text-[10px] tabular-nums text-text-muted">
                          International ·{" "}
                          {formatPaidMinor(p.platformPaymentRevenueAllTime.usdTotalMinor, "USD")} (
                          {p.platformPaymentRevenueAllTime.usdSucceededPayments})
                        </p>
                      ) : null}
                    </div>
                    {p.ledgerBackedModelCost.totalEvents > 0 ? (
                      <>
                        <div className="rounded border border-border/40 bg-surface px-2.5 py-2">
                          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                            Tracked Workspaces
                          </p>
                          <p className="mt-0.5 text-lg font-bold tabular-nums text-text">
                            {p.ledgerBackedModelCost.trackedWorkspaces}
                          </p>
                          <p className="text-[10px] leading-tight text-text-muted">
                            with ledger-backed cost
                          </p>
                        </div>
                        <div className="rounded border border-border/40 bg-surface px-2.5 py-2">
                          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                            Tracked Users
                          </p>
                          <p className="mt-0.5 text-lg font-bold tabular-nums text-text">
                            {p.ledgerBackedModelCost.trackedUsers}
                          </p>
                          <p className="text-[10px] leading-tight text-text-muted">
                            across {p.ledgerBackedModelCost.totalEvents} events
                          </p>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {p.ledgerBackedModelCost.hasMultipleCurrencies && (
                    <p className="rounded border border-warning/25 bg-warning/8 px-2.5 py-1.5 text-[10px] text-text-muted">
                      Mixed currencies detected. Totals are shown per currency instead of one merged
                      money figure.
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    <div className="rounded border border-border/40 bg-surface">
                      <div className="border-b border-border/30 px-2.5 py-1">
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                          Events by Purpose
                        </p>
                      </div>
                      <div className="divide-y divide-border/30">
                        {p.ledgerBackedModelCost.byPurpose.map((entry) => (
                          <div
                            key={entry.key}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-text">{entry.label}</p>
                              <p className="text-[10px] text-text-muted">
                                {entry.eventCount} events
                              </p>
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums text-text">
                              {entry.eventCount}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded border border-border/40 bg-surface">
                      <div className="border-b border-border/30 px-2.5 py-1">
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                          Events by Surface
                        </p>
                      </div>
                      <div className="divide-y divide-border/30">
                        {p.ledgerBackedModelCost.bySurface.map((entry) => (
                          <div
                            key={entry.key}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-text">{entry.label}</p>
                              <p className="text-[10px] text-text-muted">
                                {entry.eventCount} events
                              </p>
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums text-text">
                              {entry.eventCount}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Fold>

          <Fold t="Runtime Usage Context · Global · 7 days" open>
            <p className="mb-1.5 text-[10px] text-text-muted">
              Explicit schema v2 text receipts only. Historical v1 receipts remain in legacy totals
              and are excluded from these cache ratios and savings.
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {(
                [
                  {
                    l: "Avg Total Input",
                    v: p.runtimeTurnAverages.avgTotalInputTokens,
                    s: "tokens / completed turn"
                  },
                  {
                    l: "Avg Uncached",
                    v: p.runtimeTurnAverages.avgUncachedInputTokens,
                    s: "miss / uncached tokens"
                  },
                  {
                    l: "Avg Cache Reads",
                    v: p.runtimeTurnAverages.avgCacheReadInputTokens,
                    s: `${p.runtimeTurnAverages.cacheReadSharePercent?.toFixed(1) ?? "—"}% of total input`
                  },
                  {
                    l: "Avg Cache Writes",
                    v: p.runtimeTurnAverages.avgCacheWriteInputTokens,
                    s: `${p.runtimeTurnAverages.cacheWriteSharePercent?.toFixed(1) ?? "—"}% of total input`
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
                    l: "Read-Hit Turns",
                    v: `${p.runtimeTurnAverages.cacheReadHitTurnSharePercent?.toFixed(1) ?? "—"}%`,
                    s: `${p.runtimeTurnAverages.v2CacheReadHitTurns} of ${p.runtimeTurnAverages.turnsWithV2TextUsageAccounting}`
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
                    l: "V2 Text Calls",
                    v: p.runtimeTurnAverages.v2TextUsageCallCount,
                    s: `${p.runtimeTurnAverages.turnsWithV2TextUsageAccounting} receipt turns`
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

          <Fold t="Text Cache Cost · v2 only" open>
            <p className="mb-1.5 text-[10px] text-text-muted">
              Input-only counterfactual: uncached × input price + writes × write price + reads ×
              read price, compared with total input × input price. Output cost is separate;
              currencies are never blended.
            </p>
            {p.ledgerBackedModelCost.textCacheAccountingV2.map((aggregate) => (
              <div key={aggregate.currency} className="mb-1.5">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                  {aggregate.currency}
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {[
                    {
                      l: "Actual Cached Input",
                      v: formatCurrencyMicros(
                        aggregate.actualCachedInputCostMicros,
                        aggregate.currency
                      )
                    },
                    {
                      l: "No-cache Counterfactual",
                      v: formatCurrencyMicros(aggregate.noCacheInputCostMicros, aggregate.currency)
                    },
                    {
                      l: "Net Input Savings",
                      v: formatCurrencyMicros(aggregate.netCacheSavingsMicros, aggregate.currency),
                      s: `${aggregate.netCacheSavingsPercent?.toFixed(1) ?? "—"}%`
                    },
                    {
                      l: "V2 Hit Calls",
                      v: `${aggregate.hitCallSharePercent?.toFixed(1) ?? "—"}%`,
                      s: `${aggregate.hitCallCount} / ${aggregate.v2CallCount} calls`
                    }
                  ].map((metric) => (
                    <div
                      key={metric.l}
                      className="rounded border border-border/40 bg-surface px-2.5 py-2"
                    >
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
                        {metric.l}
                      </p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-text">{metric.v}</p>
                      {"s" in metric && metric.s ? (
                        <p className="text-[10px] leading-tight text-text-muted">{metric.s}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-1.5 divide-y divide-border/30 rounded border border-border/40 bg-surface">
              {p.ledgerBackedModelCost.textCacheAccountingV2ByProvider.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] text-text-muted">
                  No valid v2 text ledger calls yet.
                </p>
              ) : (
                p.ledgerBackedModelCost.textCacheAccountingV2ByProvider.map((cohort) => (
                  <div
                    key={`${cohort.provider}:${cohort.model}:${cohort.currency}`}
                    className="px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-text">
                        {cohort.provider} · {cohort.model} · {cohort.currency}
                      </span>
                      <span className="tabular-nums text-text-muted">
                        {cohort.v2CallCount} calls / {cohort.v2TurnCount} turns
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-text-muted">
                      reads {cohort.cacheReadInputTokens} · writes {cohort.cacheWriteInputTokens} ·
                      uncached {cohort.uncachedInputTokens} · hit calls{" "}
                      {cohort.hitCallSharePercent?.toFixed(1) ?? "—"}% · savings{" "}
                      {cohort.netCacheSavingsPercent?.toFixed(1) ?? "—"}%
                    </p>
                  </div>
                ))
              )}
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
