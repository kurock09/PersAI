"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Shield,
  Activity,
  Users,
  MessageSquare,
  Server,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Cpu,
  Clock,
  Zap,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { getAdminOverviewDashboard } from "@/app/app/assistant-api-client";

type LatencySnapshot = {
  webChatTurns: { avgMs: number; maxMs: number; count: number } | null;
  telegramTurns: { avgMs: number; maxMs: number; count: number } | null;
  allRoutes: { avgMs: number; maxMs: number; count: number };
};

type SystemWarning = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

type DashboardState = {
  latency: LatencySnapshot;
  activeUsers: number;
  activeWebChats: number;
  runtime: {
    adapterEnabled: boolean;
    runtimeTier: string | null;
    preflight: { live: boolean; ready: boolean; checkedAt: string };
  };
  health: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    inFlightRequests: number;
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
  };
  warnings: SystemWarning[];
  updatedAt: string;
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function MetricCard({
  title,
  icon: Icon,
  value,
  sub,
  color
}: {
  title: string;
  icon: LucideIcon;
  value: string;
  sub?: string | undefined;
  color?: string | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-text-subtle" />
        <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">{title}</p>
      </div>
      <p className={cn("text-xl font-bold tabular-nums", color ?? "text-text")}>{value}</p>
      {sub && <p className="text-[11px] text-text-muted">{sub}</p>}
    </div>
  );
}

function LatencyCard({
  title,
  data
}: {
  title: string;
  data: { avgMs: number; maxMs: number; count: number } | null;
}) {
  if (data === null) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">{title}</p>
        <p className="mt-1 text-sm text-text-muted">No data yet</p>
      </div>
    );
  }
  const avgColor =
    data.avgMs > 3000 ? "text-destructive" : data.avgMs > 1000 ? "text-warning" : "text-success";
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">{title}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("text-xl font-bold tabular-nums", avgColor)}>
          {formatMs(data.avgMs)}
        </span>
        <span className="text-[10px] text-text-muted">avg</span>
      </div>
      <div className="mt-0.5 flex gap-3 text-[10px] text-text-muted">
        <span>max {formatMs(data.maxMs)}</span>
        <span>{data.count.toLocaleString()} requests</span>
      </div>
    </div>
  );
}

function warningSeverityStyle(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "warning":
      return "border-warning/30 bg-warning/10 text-warning";
    default:
      return "border-blue-500/25 bg-blue-500/10 text-blue-300";
  }
}

export default function AdminOverviewPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);

  const load = useCallback(
    async (isRefresh: boolean) => {
      const token = await getToken();
      if (!token) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = (await getAdminOverviewDashboard(token)) as unknown as DashboardState;
        setDashboard(data);
      } catch {
        setDashboard(null);
        setError("Unable to load dashboard.");
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
          <Shield className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-bold text-text">System Overview</h1>
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

      {dashboard && (
        <>
          {dashboard.warnings.length > 0 && (
            <div className="space-y-1.5">
              {dashboard.warnings.map((w, i) => (
                <div
                  key={`${w.code}-${i}`}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                    warningSeverityStyle(w.severity)
                  )}
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
                  <div>
                    <span className="font-mono font-semibold">{w.code}</span>
                    <span className="ml-1.5 opacity-90">{w.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Response Latency
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <LatencyCard title="Web Chat Turns" data={dashboard.latency.webChatTurns} />
              <LatencyCard title="Telegram Turns" data={dashboard.latency.telegramTurns} />
              <LatencyCard title="All Routes" data={dashboard.latency.allRoutes} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Activity
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricCard
                title="Active Users"
                icon={Users}
                value={String(dashboard.activeUsers)}
                sub="Last 15 min"
              />
              <MetricCard
                title="Active Chats"
                icon={MessageSquare}
                value={String(dashboard.activeWebChats)}
                sub="Open web chats"
              />
              <MetricCard
                title="In-Flight"
                icon={Activity}
                value={String(dashboard.health.inFlightRequests)}
                sub="Requests processing"
              />
              <MetricCard
                title="Error Rate"
                icon={Zap}
                value={`${(dashboard.health.errorRate * 100).toFixed(1)}%`}
                sub={`${dashboard.health.totalErrors} / ${dashboard.health.totalRequests.toLocaleString()}`}
                color={
                  dashboard.health.errorRate > 0.05
                    ? "text-destructive"
                    : dashboard.health.errorRate > 0.01
                      ? "text-warning"
                      : "text-success"
                }
              />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Runtime
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface-raised p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                  Preflight
                </p>
                <div className="mt-1 flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        dashboard.runtime.preflight.live
                          ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.45)]"
                          : "bg-destructive"
                      )}
                    />
                    <span className="text-xs text-text-muted">Live</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        dashboard.runtime.preflight.ready
                          ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.45)]"
                          : "bg-destructive"
                      )}
                    />
                    <span className="text-xs text-text-muted">Ready</span>
                  </div>
                </div>
              </div>
              <MetricCard
                title="Runtime Tier"
                icon={Server}
                value={dashboard.runtime.runtimeTier ?? "N/A"}
                sub={dashboard.runtime.adapterEnabled ? "Adapter enabled" : "Adapter disabled"}
              />
              <MetricCard
                title="Adapter"
                icon={Server}
                value={dashboard.runtime.adapterEnabled ? "On" : "Off"}
                color={dashboard.runtime.adapterEnabled ? "text-success" : "text-text-muted"}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Process Health
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricCard
                title="Uptime"
                icon={Clock}
                value={formatUptime(dashboard.health.uptimeSeconds)}
              />
              <MetricCard
                title="RSS Memory"
                icon={Cpu}
                value={formatBytes(dashboard.health.rssBytes)}
                color={dashboard.health.rssBytes > 512 * 1048576 ? "text-warning" : undefined}
              />
              <MetricCard
                title="Heap Used"
                icon={Cpu}
                value={formatBytes(dashboard.health.heapUsedBytes)}
                sub={`/ ${formatBytes(dashboard.health.heapTotalBytes)}`}
              />
              <MetricCard
                title="Total Requests"
                icon={Activity}
                value={dashboard.health.totalRequests.toLocaleString()}
                sub={`${dashboard.health.totalErrors} errors`}
              />
            </div>
          </section>

          <p className="text-center text-[10px] text-text-subtle">
            Updated{" "}
            {new Date(dashboard.updatedAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "medium"
            })}
          </p>
        </>
      )}
    </div>
  );
}
