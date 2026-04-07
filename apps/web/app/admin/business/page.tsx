"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
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
  XCircle
} from "lucide-react";
import { getAdminBusinessPlatform } from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type PlanDistributionEntry = {
  planCode: string;
  planDisplayName: string | null;
  userCount: number;
  percent: number;
};

type PlatformState = {
  totalUsers: number;
  planDistribution: PlanDistributionEntry[];
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
  updatedAt: string;
};

function Section({
  title,
  children,
  className
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

function formatChannelLabel(key: string): string {
  const labels: Record<string, string> = {
    webChat: "Web Chat",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    max: "Max"
  };
  return labels[key] ?? key;
}

export default function AdminBusinessPage() {
  const { getToken } = useAuth();
  const [platform, setPlatform] = useState<PlatformState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh: boolean) => {
      const token = await getToken();
      if (!token) {
        setError("Not signed in.");
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = (await getAdminBusinessPlatform(token)) as unknown as PlatformState;
        setPlatform(data);
      } catch {
        setPlatform(null);
        setError("Unable to load business metrics.");
      }
      setLoading(false);
      setRefreshing(false);
    },
    [getToken]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

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
          <h1 className="text-lg font-bold text-text">Business Metrics</h1>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void load(true)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text transition-colors",
            "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {platform && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <Users className="h-3 w-3 text-text-subtle" />
                <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                  Total Users
                </p>
              </div>
              <p className="text-xl font-bold tabular-nums text-text">{platform.totalUsers}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <BarChart3 className="h-3 w-3 text-text-subtle" />
                <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                  Active Plans
                </p>
              </div>
              <p className="text-xl font-bold tabular-nums text-text">
                {platform.planCatalog.activePlans}
              </p>
              <p className="text-[11px] text-text-muted">{platform.planCatalog.totalPlans} total</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <MessageSquare className="h-3 w-3 text-text-subtle" />
                <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                  Channels
                </p>
              </div>
              <p className="text-xl font-bold tabular-nums text-text">
                {platform.channelAdoption.total}
              </p>
              <p className="text-[11px] text-text-muted">Active connections</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3 text-text-subtle" />
                <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                  Apply Success
                </p>
              </div>
              <p
                className={cn(
                  "text-xl font-bold tabular-nums",
                  platform.publishApplyHealth.applySuccessPercent >= 90
                    ? "text-success"
                    : "text-warning"
                )}
              >
                {platform.publishApplyHealth.applySuccessPercent}%
              </p>
              <p className="text-[11px] text-text-muted">Last 7 days</p>
            </div>
          </div>

          <Section title="Users by Plan">
            <div className="rounded-lg border border-border bg-surface-raised">
              {platform.planDistribution.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-text-muted">
                  No plan data available.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {platform.planDistribution.map((entry) => (
                    <div key={entry.planCode} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-text">
                            {entry.planDisplayName ?? entry.planCode}
                          </span>
                          <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-mono text-text-muted">
                            {entry.planCode}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-300"
                            style={{ width: `${entry.percent}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold tabular-nums text-text">
                          {entry.userCount}
                        </span>
                        <span className="ml-1 text-[10px] text-text-muted">({entry.percent}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          <Section title="Quota Pressure Distribution">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                <p className="text-[10px] font-medium uppercase text-emerald-400">Low</p>
                <p className="text-2xl font-bold tabular-nums text-emerald-400">
                  {platform.quotaPressureDistribution.low}
                </p>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-center">
                <p className="text-[10px] font-medium uppercase text-amber-400">Elevated</p>
                <p className="text-2xl font-bold tabular-nums text-amber-400">
                  {platform.quotaPressureDistribution.elevated}
                </p>
              </div>
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center">
                <p className="text-[10px] font-medium uppercase text-red-400">High</p>
                <p className="text-2xl font-bold tabular-nums text-red-400">
                  {platform.quotaPressureDistribution.high}
                </p>
              </div>
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Channel Adoption">
              <div className="rounded-lg border border-border bg-surface-raised">
                <div className="divide-y divide-border">
                  {(["webChat", "telegram", "whatsapp", "max"] as const).map((key) => {
                    const value =
                      platform.channelAdoption[key as keyof typeof platform.channelAdoption];
                    const total = platform.channelAdoption.total;
                    const percent = total > 0 ? Math.round(((value as number) / total) * 100) : 0;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-text">{formatChannelLabel(key)}</span>
                        <span className="flex items-center gap-2 tabular-nums text-text-muted">
                          <span className="text-text">{value as number}</span>
                          <span className="text-[10px]">({percent}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Section>

            <Section title="Publish / Apply Health (7 days)">
              <div className="rounded-lg border border-border bg-surface-raised p-3">
                <div className="mb-3 text-center">
                  <span
                    className={cn(
                      "text-2xl font-bold tabular-nums",
                      platform.publishApplyHealth.applySuccessPercent >= 90
                        ? "text-accent"
                        : "text-warning"
                    )}
                  >
                    {platform.publishApplyHealth.applySuccessPercent}%
                  </span>
                  <span className="ml-1 text-[10px] text-text-subtle">success rate</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
                  <div className="rounded bg-emerald-500/10 py-1.5">
                    <div className="flex items-center justify-center gap-1 text-text-subtle">
                      <CheckCircle className="h-2.5 w-2.5" />
                      OK
                    </div>
                    <p className="font-semibold tabular-nums text-emerald-400">
                      {platform.publishApplyHealth.applySucceeded}
                    </p>
                  </div>
                  <div className="rounded bg-amber-500/10 py-1.5">
                    <div className="flex items-center justify-center gap-1 text-text-subtle">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Degraded
                    </div>
                    <p className="font-semibold tabular-nums text-amber-400">
                      {platform.publishApplyHealth.applyDegraded}
                    </p>
                  </div>
                  <div className="rounded bg-red-500/10 py-1.5">
                    <div className="flex items-center justify-center gap-1 text-text-subtle">
                      <XCircle className="h-2.5 w-2.5" />
                      Failed
                    </div>
                    <p className="font-semibold tabular-nums text-red-400">
                      {platform.publishApplyHealth.applyFailed}
                    </p>
                  </div>
                </div>
              </div>
            </Section>
          </div>

          <Section title="Plan Catalog">
            <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                    Default Registration Plan
                  </p>
                  <p className="mt-0.5 font-mono text-text">
                    {platform.planCatalog.defaultRegistrationPlanCode ?? "—"}
                  </p>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="text-[10px] text-text-subtle">Total</dt>
                    <dd className="text-sm font-semibold tabular-nums text-text">
                      {platform.planCatalog.totalPlans}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-text-subtle">Active</dt>
                    <dd className="text-sm font-semibold tabular-nums text-emerald-400">
                      {platform.planCatalog.activePlans}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-text-subtle">Inactive</dt>
                    <dd className="text-sm font-semibold tabular-nums text-text-muted">
                      {platform.planCatalog.inactivePlans}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </Section>

          <p className="text-center text-[10px] text-text-subtle">
            Updated{" "}
            {new Date(platform.updatedAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "medium"
            })}
          </p>
        </>
      )}

      {!platform && !error && (
        <p className="text-sm text-text-subtle">Unable to load business data.</p>
      )}
    </div>
  );
}
