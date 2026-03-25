"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Bot,
  Gauge,
  Loader2,
  MessageSquare,
  RefreshCw,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import {
  AdminBusinessCockpitStatePublishApplySuccessWindow,
  type AdminBusinessCockpitState,
  type BusinessCockpitPressureLevel,
} from "@persai/contracts";
import { getAdminBusinessCockpit } from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

function formatWindow(window: string): string {
  if (window === AdminBusinessCockpitStatePublishApplySuccessWindow.last_7_days) {
    return "Last 7 days";
  }
  return window.replace(/_/g, " ");
}

function formatChannelLabel(channel: string): string {
  return channel
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function pressureBadgeClass(level: BusinessCockpitPressureLevel): string {
  switch (level) {
    case "low":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "elevated":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "high":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-border text-text-muted border-border";
  }
}

function QuotaBar({
  label,
  percent,
  icon: Icon,
}: {
  label: string;
  percent: number;
  icon: typeof Gauge;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span className="flex items-center gap-1.5 font-medium text-text">
          <Icon className="h-3 w-3 shrink-0 text-text-subtle" />
          {label}
        </span>
        <span className="tabular-nums text-text-muted">{clamped.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function MetricCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Bot;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminBusinessPage() {
  const { getToken } = useAuth();
  const [cockpit, setCockpit] = useState<AdminBusinessCockpitState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh: boolean) => {
      const token = await getToken();
      if (!token) {
        setError("Not signed in.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setCockpit(await getAdminBusinessCockpit(token));
      } catch {
        setCockpit(null);
        setError("Unable to load business cockpit.");
      }
      setLoading(false);
      setRefreshing(false);
    },
    [getToken]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const updatedLabel = useMemo(() => {
    if (!cockpit?.updatedAt) return null;
    try {
      return new Date(cockpit.updatedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return cockpit.updatedAt;
    }
  }, [cockpit?.updatedAt]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-bold text-text">Business Cockpit</h1>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void load(true)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition-colors",
            "hover:border-accent/40 hover:text-text",
            "disabled:pointer-events-none disabled:opacity-50"
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {cockpit && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricCard title="Assistants" icon={Bot}>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-[10px] text-text-subtle">Total</dt>
                  <dd className="text-lg font-semibold tabular-nums text-text">
                    {cockpit.activeAssistants.totalAssistants}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-text-subtle">Active</dt>
                  <dd className="text-lg font-semibold tabular-nums text-text">
                    {cockpit.activeAssistants.activeAssistants}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-text-subtle">Published</dt>
                  <dd className="text-lg font-semibold tabular-nums text-text">
                    {cockpit.activeAssistants.publishedAssistants}
                  </dd>
                </div>
              </dl>
            </MetricCard>

            <MetricCard title="Web chats" icon={MessageSquare}>
              <dl className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <dt className="text-[10px] text-text-subtle">Active</dt>
                  <dd className="text-lg font-semibold tabular-nums text-text">
                    {cockpit.activeChats.activeWebChats}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-text-subtle">Total</dt>
                  <dd className="text-lg font-semibold tabular-nums text-text">
                    {cockpit.activeChats.totalWebChats}
                  </dd>
                </div>
              </dl>
            </MetricCard>

            <MetricCard title="Publish apply" icon={Zap}>
              <div className="mb-2 text-center">
                <span className="text-2xl font-bold tabular-nums text-accent">
                  {cockpit.publishApplySuccess.applySuccessPercent.toFixed(1)}%
                </span>
                <span className="ml-1 text-[10px] text-text-subtle">success</span>
              </div>
              <p className="mb-2 text-center text-[10px] text-text-muted">
                {formatWindow(cockpit.publishApplySuccess.window)} ·{" "}
                {cockpit.publishApplySuccess.publishedVersionEvents} version events
              </p>
              <dl className="grid grid-cols-3 gap-1 text-center text-[10px]">
                <div className="rounded bg-emerald-500/10 py-1">
                  <dt className="text-text-subtle">OK</dt>
                  <dd className="font-semibold tabular-nums text-emerald-400">
                    {cockpit.publishApplySuccess.applySucceeded}
                  </dd>
                </div>
                <div className="rounded bg-amber-500/10 py-1">
                  <dt className="text-text-subtle">Degraded</dt>
                  <dd className="font-semibold tabular-nums text-amber-400">
                    {cockpit.publishApplySuccess.applyDegraded}
                  </dd>
                </div>
                <div className="rounded bg-red-500/10 py-1">
                  <dt className="text-text-subtle">Failed</dt>
                  <dd className="font-semibold tabular-nums text-red-400">
                    {cockpit.publishApplySuccess.applyFailed}
                  </dd>
                </div>
              </dl>
            </MetricCard>
          </div>

          <Section title="Quota pressure">
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-text-muted">Composite load vs. limits</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    pressureBadgeClass(cockpit.quotaPressure.pressureLevel)
                  )}
                >
                  {cockpit.quotaPressure.pressureLevel}
                </span>
              </div>
              <div className="space-y-3">
                <QuotaBar
                  label="Token budget"
                  percent={cockpit.quotaPressure.tokenBudgetPercent}
                  icon={Wallet}
                />
                <QuotaBar
                  label="Cost-driving tools"
                  percent={cockpit.quotaPressure.costDrivingToolsPercent}
                  icon={Zap}
                />
                <QuotaBar
                  label="Active web chats"
                  percent={cockpit.quotaPressure.activeWebChatsPercent}
                  icon={MessageSquare}
                />
              </div>
            </div>
          </Section>

          <Section title="Plan snapshot">
            <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                    Effective plan
                  </p>
                  <p className="mt-0.5 font-medium text-text">
                    {cockpit.planUsageSnapshot.effectivePlanDisplayName ??
                      cockpit.planUsageSnapshot.effectivePlanCode ??
                      "—"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-text-muted">
                    {cockpit.planUsageSnapshot.effectivePlanCode && (
                      <span className="rounded bg-border px-1.5 py-0.5 font-mono">
                        {cockpit.planUsageSnapshot.effectivePlanCode}
                      </span>
                    )}
                    {cockpit.planUsageSnapshot.effectivePlanStatus && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">
                        {cockpit.planUsageSnapshot.effectivePlanStatus}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                    Default registration plan
                  </p>
                  <p className="mt-0.5 font-mono text-text">
                    {cockpit.planUsageSnapshot.defaultRegistrationPlanCode ?? "—"}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                <div>
                  <dt className="text-[10px] text-text-subtle">Total plans</dt>
                  <dd className="text-sm font-semibold tabular-nums text-text">
                    {cockpit.planUsageSnapshot.totalPlans}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-text-subtle">Active</dt>
                  <dd className="text-sm font-semibold tabular-nums text-emerald-400">
                    {cockpit.planUsageSnapshot.activePlans}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-text-subtle">Inactive</dt>
                  <dd className="text-sm font-semibold tabular-nums text-text-muted">
                    {cockpit.planUsageSnapshot.inactivePlans}
                  </dd>
                </div>
              </dl>
            </div>
          </Section>

          <Section title="Channel split">
            {cockpit.channelSplit.channels.length === 0 ? (
              <p className="text-xs text-text-subtle">No channel data.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface-raised">
                {cockpit.channelSplit.channels.map((row) => (
                  <li
                    key={row.channel}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-text">{formatChannelLabel(row.channel)}</span>
                    <span className="flex items-center gap-2 tabular-nums text-text-muted">
                      <span className="text-text">{row.value}</span>
                      <span className="text-[10px]">({row.percent.toFixed(1)}%)</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {updatedLabel && (
            <p className="text-[10px] text-text-subtle">Last updated: {updatedLabel}</p>
          )}
        </>
      )}

      {!cockpit && !error && (
        <p className="text-sm text-text-subtle">Unable to load business data.</p>
      )}
    </div>
  );
}
