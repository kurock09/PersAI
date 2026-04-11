"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Shield,
  Activity,
  Users,
  MessageSquare,
  Loader2,
  RefreshCw,
  ChevronDown,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  getAdminOverviewDashboard,
  setAdminOverviewLatencyTrace,
  type AdminOverviewRouteHint
} from "@/app/app/assistant-api-client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Pctl = { p50Ms: number; p95Ms: number; p99Ms: number };
type ChLatency = { avgMs: number; maxMs: number; count: number; percentiles: Pctl };
type LatencySnap = {
  webChatTurns: ChLatency | null;
  telegramTurns: ChLatency | null;
  allRoutes: ChLatency;
};
type Warning = { code: string; severity: "info" | "warning" | "critical"; message: string };
type Tier = {
  tier: string;
  live: boolean;
  ready: boolean;
  checkedAt: string;
  flapCount: number;
  lastFlapAt: string | null;
};
type QueuePressure = { inFlight: number; peakInFlight: number; requestsPerSecond: number };
type Health = {
  uptimeSeconds: number;
  processStartedAt: string;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  cpuUserMs: number;
  cpuSystemMs: number;
};
type TraceStage = { key: string; durationMs: number };
type TraceEntry = {
  traceId: string;
  surface: "telegram" | "web_chat_sync" | "web_chat_stream";
  status: "completed" | "failed" | "interrupted" | "replayed" | "deduplicated";
  assistantId: string | null;
  threadKey: string | null;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  outputPreview: string | null;
  stages: TraceStage[];
};
type TraceState = {
  enabled: boolean;
  sampleLimit: number;
  updatedAt: string | null;
  recent: TraceEntry[];
};
type ShadowExecution = {
  status: "completed" | "failed";
  runtimeMs: number;
  firstDeltaMs: number | null;
  deltaCount: number | null;
  code: string | null;
  preview: string | null;
};
type ShadowComparison = {
  comparisonId: string;
  route: "sync" | "stream";
  verdict: "match" | "mismatch";
  assistantId: string;
  threadKey: string;
  clientTurnId: string | null;
  comparedAt: string;
  contentMatch: boolean;
  errorClassMatch: boolean;
  terminalMatch: boolean;
  primary: ShadowExecution;
  shadow: ShadowExecution;
};
type ShadowState = {
  sampleLimit: number;
  updatedAt: string | null;
  recent: ShadowComparison[];
};
type DataSource = {
  scope: "api_instance_local";
  instanceId: string;
  podIp: string | null;
};
type Dash = {
  dataSource: DataSource;
  latency: LatencySnap;
  latencyTrace: TraceState;
  webRuntimeShadowComparisons: ShadowState;
  activeUsers: number;
  activeWebChats: number;
  runtime: { adapterEnabled: boolean; tiers: Tier[] };
  health: Health;
  queuePressure: QueuePressure;
  warnings: Warning[];
  updatedAt: string;
};
type SourceRegistry = Record<string, DataSource>;
type RouteMode = "auto" | "probe" | "pinned";

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

function fUp(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fB(b: number) {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
function fMs(ms: number) {
  if (ms >= 10000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
function cMs(ms: number) {
  if (ms > 3000) return "text-destructive";
  if (ms > 1000) return "text-warning";
  return "text-success";
}
function cPct(p: number) {
  if (p >= 95) return "text-destructive";
  if (p >= 75) return "text-warning";
  return "text-success";
}
function sevBg(s: string) {
  if (s === "critical") return "border-l-destructive bg-destructive/5";
  if (s === "warning") return "border-l-warning bg-warning/5";
  return "border-l-blue-500 bg-blue-500/5";
}
function sevDot(s: string) {
  if (s === "critical") return "bg-destructive";
  if (s === "warning") return "bg-warning";
  return "bg-blue-400";
}
function surfaceLabel(v: TraceEntry["surface"]) {
  if (v === "telegram") return "Telegram";
  if (v === "web_chat_sync") return "Web sync";
  return "Web stream";
}
function statusTone(v: TraceEntry["status"]) {
  if (v === "completed" || v === "replayed" || v === "deduplicated") {
    return "text-success";
  }
  if (v === "interrupted") {
    return "text-warning";
  }
  return "text-destructive";
}
function shadowRouteLabel(route: ShadowComparison["route"]) {
  return route === "sync" ? "Web sync" : "Web stream";
}
function shadowVerdictTone(verdict: ShadowComparison["verdict"]) {
  return verdict === "match" ? "text-success" : "text-destructive";
}
function shadowStatusTone(status: ShadowExecution["status"]) {
  return status === "completed" ? "text-success" : "text-destructive";
}
function isRuntimeStage(stage: TraceStage) {
  return stage.key.startsWith("runtime_");
}
function getBottleneckStage(stages: TraceStage[]) {
  return stages.reduce<TraceStage | null>(
    (longest, stage) =>
      longest === null || stage.durationMs > longest.durationMs ? stage : longest,
    null
  );
}
function sourceLabel(source: DataSource) {
  return source.instanceId;
}
function buildSourceSwitchMessage(previous: DataSource, next: DataSource) {
  return `Overview source switched from ${sourceLabel(previous)} to ${sourceLabel(next)}. Pod-local metrics and trace state can differ between api pods.`;
}
function buildRouteHint(mode: RouteMode, pinnedPodIp: string | null): AdminOverviewRouteHint {
  if (mode === "probe") {
    return { mode: "probe" };
  }
  if (mode === "pinned" && pinnedPodIp) {
    return { mode: "pinned", podIp: pinnedPodIp };
  }
  return { mode: "auto" };
}
function routeModeLabel(mode: RouteMode) {
  if (mode === "probe") return "Probe service";
  if (mode === "pinned") return "Pinned pod";
  return "Auto (sticky)";
}

/* ------------------------------------------------------------------ */
/*  Atoms                                                              */
/* ------------------------------------------------------------------ */

function KPI({
  label,
  value,
  sub,
  color,
  icon: I
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/50 bg-surface-raised px-2.5 py-2">
      <div className="flex items-center gap-1">
        {I && <I className="h-2.5 w-2.5 shrink-0 text-text-subtle" />}
        <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-text-subtle">
          {label}
        </p>
      </div>
      <p
        className={cn("mt-0.5 text-lg font-bold tabular-nums leading-tight", color ?? "text-text")}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] leading-tight text-text-muted">{sub}</p>}
    </div>
  );
}

function Bar({ pct, label, sub }: { pct: number; label: string; sub?: string }) {
  const c = Math.min(100, Math.max(0, pct));
  const bg = c >= 90 ? "bg-destructive" : c >= 70 ? "bg-warning" : "bg-success";
  return (
    <div className="space-y-px">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-text-muted">{label}</span>
        <span className={cn("text-[10px] font-bold tabular-nums", cPct(c))}>{c}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-border/40">
        <div className={cn("h-full rounded-full transition-all", bg)} style={{ width: `${c}%` }} />
      </div>
      {sub && <p className="text-[9px] text-text-subtle">{sub}</p>}
    </div>
  );
}

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

function Lat({ label, d }: { label: string; d: ChLatency | null }) {
  if (!d)
    return (
      <div className="rounded border border-border/40 bg-surface px-2.5 py-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">{label}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">—</p>
      </div>
    );
  return (
    <div className="rounded border border-border/40 bg-surface px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">{label}</p>
        <span className="text-[9px] tabular-nums text-text-subtle">
          {d.count.toLocaleString()} req
        </span>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-x-1 text-center">
        {(
          [
            ["avg", d.avgMs],
            ["p50", d.percentiles.p50Ms],
            ["p95", d.percentiles.p95Ms],
            ["p99", d.percentiles.p99Ms],
            ["max", d.maxMs]
          ] as const
        ).map(([lbl, v]) => (
          <div key={lbl}>
            <p className="text-[8px] uppercase text-text-subtle">{lbl}</p>
            <p
              className={cn(
                "text-[13px] font-semibold tabular-nums leading-tight",
                lbl === "avg" || lbl === "p95" || lbl === "p99" ? cMs(v) : "text-text"
              )}
            >
              {fMs(v)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AdminOverviewPage() {
  const { getToken } = useAuth();
  const sourceRef = useRef<DataSource | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>("auto");
  const [pinnedPodIp, setPinnedPodIp] = useState<string | null>(null);
  const [knownSources, setKnownSources] = useState<SourceRegistry>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [traceBusy, setTraceBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [d, setD] = useState<Dash | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      const tk = await getToken();
      if (!tk) return;
      if (refresh) setBusy(true);
      else setLoading(true);
      setErr(null);
      try {
        const next = (await getAdminOverviewDashboard(
          tk,
          buildRouteHint(routeMode, pinnedPodIp)
        )) as unknown as Dash;
        const previousSource = sourceRef.current;
        if (previousSource !== null && previousSource.instanceId !== next.dataSource.instanceId) {
          setSourceNotice(buildSourceSwitchMessage(previousSource, next.dataSource));
        }
        sourceRef.current = next.dataSource;
        setKnownSources((prev) => ({
          ...prev,
          [next.dataSource.instanceId]: next.dataSource
        }));
        if (routeMode === "probe" && next.dataSource.podIp) {
          setPinnedPodIp(next.dataSource.podIp);
          setRouteMode("pinned");
        }
        setD(next);
      } catch {
        setD(null);
        setErr("Unable to load dashboard.");
      }
      setLoading(false);
      setBusy(false);
    },
    [getToken, pinnedPodIp, routeMode]
  );

  useEffect(() => void load(false), [load]);

  const toggleTrace = useCallback(async () => {
    const tk = await getToken();
    if (!tk || !d) return;
    setTraceBusy(true);
    setErr(null);
    try {
      const next = await setAdminOverviewLatencyTrace(
        tk,
        !d.latencyTrace.enabled,
        buildRouteHint(routeMode, pinnedPodIp)
      );
      const latencyTrace = next.latencyTrace as TraceState;
      const nextSource = (next.dataSource as DataSource | undefined) ?? d.dataSource;
      const previousSource = sourceRef.current;
      if (previousSource !== null && previousSource.instanceId !== nextSource.instanceId) {
        setSourceNotice(buildSourceSwitchMessage(previousSource, nextSource));
      }
      sourceRef.current = nextSource;
      setKnownSources((prev) => ({
        ...prev,
        [nextSource.instanceId]: nextSource
      }));
      setD((prev) =>
        prev
          ? {
              ...prev,
              dataSource: nextSource,
              latencyTrace
            }
          : prev
      );
    } catch {
      setErr("Unable to change latency trace mode.");
    } finally {
      setTraceBusy(false);
    }
  }, [d, getToken, pinnedPodIp, routeMode]);

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-2.5 px-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Shield className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold tracking-tight text-text">System Overview</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {d && (
            <div className="flex items-center gap-1 rounded border border-border/60 bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
              <span className="font-medium text-text-subtle">Route</span>
              <select
                value={
                  routeMode === "pinned" && pinnedPodIp
                    ? `pinned:${pinnedPodIp}`
                    : routeMode === "probe"
                      ? "probe"
                      : "auto"
                }
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSourceNotice(null);
                  if (nextValue === "auto") {
                    setRouteMode("auto");
                    setPinnedPodIp(null);
                    void load(true);
                    return;
                  }
                  if (nextValue === "probe") {
                    setRouteMode("probe");
                    setPinnedPodIp(null);
                    void load(true);
                    return;
                  }
                  if (nextValue.startsWith("pinned:")) {
                    const nextPodIp = nextValue.slice("pinned:".length);
                    setRouteMode("pinned");
                    setPinnedPodIp(nextPodIp);
                    void load(true);
                  }
                }}
                className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-text"
              >
                <option value="auto">Auto (sticky)</option>
                <option value="probe">Probe service</option>
                {Object.values(knownSources)
                  .filter((source) => source.podIp !== null)
                  .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
                  .map((source) => (
                    <option key={source.instanceId} value={`pinned:${source.podIp}`}>
                      Pin {source.instanceId}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {d && (
            <button
              type="button"
              disabled={traceBusy}
              onClick={() => void toggleTrace()}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
                d.latencyTrace.enabled
                  ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
                  : "border-border bg-surface text-text-muted hover:bg-surface-hover",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              {traceBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Trace {d.latencyTrace.enabled ? "ON" : "OFF"}
            </button>
          )}
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
      </div>

      {err && (
        <p className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {err}
        </p>
      )}

      {sourceNotice && (
        <p className="rounded border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[10px] text-warning">
          {sourceNotice}
        </p>
      )}

      {d && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 rounded border border-border/40 bg-surface px-2.5 py-1.5 text-[10px] text-text-muted">
            <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-semibold text-warning">
              Pod-local
            </span>
            <span>
              Source: <span className="font-mono text-text">{sourceLabel(d.dataSource)}</span>
            </span>
            <span>
              Latency, trace, in-flight, peak, process pressure, and flap counters are local to the
              current `api` pod.
            </span>
            <span>
              Admin overview requests are kept sticky to one pod when possible so refresh and trace
              toggle stay aligned.
            </span>
            <span>
              Route mode: <span className="font-medium text-text">{routeModeLabel(routeMode)}</span>
              {routeMode === "pinned" && d.dataSource.podIp ? ` (${d.dataSource.podIp})` : ""}
            </span>
            <span>Active users and active web chats come from shared backend state.</span>
          </div>

          {/* Alerts */}
          {d.warnings.length > 0 && (
            <div className="space-y-0.5">
              {d.warnings.map((w, i) => (
                <div
                  key={`${w.code}-${i}`}
                  className={cn(
                    "flex items-center gap-2 rounded border-l-2 px-2.5 py-1 text-[10px]",
                    sevBg(w.severity)
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sevDot(w.severity))} />
                  <span className="font-mono font-bold text-text-muted">{w.code}</span>
                  <span className="text-text-muted">{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            <KPI label="Users" value={String(d.activeUsers)} sub="15 min" icon={Users} />
            <KPI
              label="Chats"
              value={String(d.activeWebChats)}
              sub="Active web"
              icon={MessageSquare}
            />
            <KPI
              label="In-flight"
              value={String(d.queuePressure.inFlight)}
              sub="Now"
              icon={Activity}
            />
            <KPI
              label="Peak in-flight"
              value={String(d.queuePressure.peakInFlight)}
              sub={`${d.queuePressure.requestsPerSecond} avg req/s`}
            />
            <KPI
              label="Error rate"
              value={`${(d.health.errorRate * 100).toFixed(1)}%`}
              sub={`${d.health.totalErrors}/${d.health.totalRequests.toLocaleString()}`}
              color={
                d.health.errorRate > 0.05
                  ? "text-destructive"
                  : d.health.errorRate > 0.01
                    ? "text-warning"
                    : "text-success"
              }
            />
            <KPI label="Uptime" value={fUp(d.health.uptimeSeconds)} sub="Since restart" />
          </div>

          {/* Latency */}
          <Fold t="Latency · p50 / p95 / p99" open>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <Lat label="Web Chat" d={d.latency.webChatTurns} />
              <Lat label="Telegram" d={d.latency.telegramTurns} />
              <Lat label="All Routes" d={d.latency.allRoutes} />
            </div>
          </Fold>

          <Fold t="Latency Trace Debug" open>
            <div className="space-y-1.5 rounded border border-border/40 bg-surface px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-subtle">
                    Trace capture
                  </p>
                  <p className="text-[10px] text-text-muted">
                    {d.latencyTrace.enabled
                      ? "Enabled only while investigating delays."
                      : "Disabled. No stage timings are collected."}
                  </p>
                  <p className="text-[10px] text-text-subtle">
                    This toggle and trace history apply only to{" "}
                    <span className="font-mono">{sourceLabel(d.dataSource)}</span>.
                  </p>
                </div>
                <div className="text-right text-[10px] text-text-subtle">
                  <p>
                    Samples: {d.latencyTrace.recent.length}/{d.latencyTrace.sampleLimit}
                  </p>
                  <p>
                    Updated:{" "}
                    {d.latencyTrace.updatedAt
                      ? new Date(d.latencyTrace.updatedAt).toLocaleTimeString()
                      : "—"}
                  </p>
                </div>
              </div>
              {d.latencyTrace.recent.length === 0 ? (
                <p className="text-[10px] text-text-muted">
                  No captured traces yet. Turn trace on, reproduce the slow Telegram/Web turn, then
                  refresh.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {d.latencyTrace.recent.map((item) =>
                    (() => {
                      const runtimeStages = item.stages.filter(isRuntimeStage);
                      const persaiStages = item.stages.filter((stage) => !isRuntimeStage(stage));
                      const bottleneck = getBottleneckStage(item.stages);
                      return (
                        <div
                          key={item.traceId}
                          className="rounded border border-border/40 bg-surface-raised px-2 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-text-subtle">
                                {surfaceLabel(item.surface)}
                              </p>
                              <p
                                className={cn("text-[11px] font-semibold", statusTone(item.status))}
                              >
                                {item.status} · {fMs(item.totalMs)}
                              </p>
                            </div>
                            <div className="text-right text-[9px] text-text-subtle">
                              <p>{new Date(item.finishedAt).toLocaleTimeString()}</p>
                              <p>{item.threadKey ?? "no-thread"}</p>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-text-subtle">
                            <span>PersAI stages: {persaiStages.length}</span>
                            <span>Runtime stages: {runtimeStages.length}</span>
                            <span>
                              Bottleneck:{" "}
                              {bottleneck
                                ? `${bottleneck.key} (${fMs(bottleneck.durationMs)})`
                                : "—"}
                            </span>
                          </div>
                          {item.outputPreview && (
                            <p className="mt-1 rounded bg-background/40 px-1.5 py-1 text-[10px] text-text-muted">
                              {item.outputPreview}
                            </p>
                          )}
                          {persaiStages.length > 0 && (
                            <div className="mt-1.5">
                              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-text-subtle">
                                PersAI
                              </p>
                              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                {persaiStages.map((stage) => (
                                  <div
                                    key={`${item.traceId}-persai-${stage.key}`}
                                    className="flex items-center justify-between rounded border border-border/30 px-1.5 py-1 text-[10px]"
                                  >
                                    <span className="truncate pr-2 text-text-muted">
                                      {stage.key}
                                    </span>
                                    <span
                                      className={cn(
                                        "shrink-0 font-semibold tabular-nums",
                                        cMs(stage.durationMs)
                                      )}
                                    >
                                      {fMs(stage.durationMs)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {runtimeStages.length > 0 && (
                            <div className="mt-1.5">
                              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-text-subtle">
                                OpenClaw runtime
                              </p>
                              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                {runtimeStages.map((stage) => (
                                  <div
                                    key={`${item.traceId}-runtime-${stage.key}`}
                                    className="flex items-center justify-between rounded border border-border/30 px-1.5 py-1 text-[10px]"
                                  >
                                    <span className="truncate pr-2 text-text-muted">
                                      {stage.key}
                                    </span>
                                    <span
                                      className={cn(
                                        "shrink-0 font-semibold tabular-nums",
                                        cMs(stage.durationMs)
                                      )}
                                    >
                                      {fMs(stage.durationMs)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </div>
              )}
            </div>
          </Fold>

          <Fold t="Web Runtime Shadow Compare" open>
            <div className="space-y-1.5 rounded border border-border/40 bg-surface px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-subtle">
                    Shadow comparison samples
                  </p>
                  <p className="text-[10px] text-text-muted">
                    Pod-local recent sync/stream parity checks captured when web runtime mode is
                    `shadow`.
                  </p>
                  <p className="text-[10px] text-text-subtle">
                    Samples apply only to{" "}
                    <span className="font-mono">{sourceLabel(d.dataSource)}</span>.
                  </p>
                </div>
                <div className="text-right text-[10px] text-text-subtle">
                  <p>
                    Samples: {d.webRuntimeShadowComparisons.recent.length}/
                    {d.webRuntimeShadowComparisons.sampleLimit}
                  </p>
                  <p>
                    Updated:{" "}
                    {d.webRuntimeShadowComparisons.updatedAt
                      ? new Date(d.webRuntimeShadowComparisons.updatedAt).toLocaleTimeString()
                      : "—"}
                  </p>
                </div>
              </div>
              {d.webRuntimeShadowComparisons.recent.length === 0 ? (
                <p className="text-[10px] text-text-muted">
                  No shadow comparisons yet. Enable one bounded web `shadow` window, reproduce sync
                  or stream traffic, then refresh.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {d.webRuntimeShadowComparisons.recent.map((item) => (
                    <div
                      key={item.comparisonId}
                      className="rounded border border-border/40 bg-surface-raised px-2 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-text-subtle">
                            {shadowRouteLabel(item.route)}
                          </p>
                          <p
                            className={cn(
                              "text-[11px] font-semibold uppercase",
                              shadowVerdictTone(item.verdict)
                            )}
                          >
                            {item.verdict}
                          </p>
                        </div>
                        <div className="text-right text-[9px] text-text-subtle">
                          <p>{new Date(item.comparedAt).toLocaleTimeString()}</p>
                          <p>{item.threadKey}</p>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-text-subtle">
                        <span>Assistant: {item.assistantId}</span>
                        <span>Client turn: {item.clientTurnId ?? "n/a"}</span>
                        <span>Terminal: {item.terminalMatch ? "match" : "drift"}</span>
                        <span>Content: {item.contentMatch ? "match" : "drift"}</span>
                        <span>Error class: {item.errorClassMatch ? "match" : "drift"}</span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {(
                          [
                            ["Primary", item.primary],
                            ["Shadow", item.shadow]
                          ] as const
                        ).map(([label, side]) => (
                          <div
                            key={`${item.comparisonId}-${label}`}
                            className="rounded border border-border/30 bg-background/20 px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">
                                {label}
                              </p>
                              <span
                                className={cn(
                                  "text-[10px] font-semibold uppercase",
                                  shadowStatusTone(side.status)
                                )}
                              >
                                {side.status}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-text-subtle">
                              <span>Runtime: {fMs(side.runtimeMs)}</span>
                              <span>
                                First delta:{" "}
                                {side.firstDeltaMs === null ? "n/a" : fMs(side.firstDeltaMs)}
                              </span>
                              <span>Delta count: {side.deltaCount ?? "n/a"}</span>
                              <span>Code: {side.code ?? "completed"}</span>
                            </div>
                            {side.preview ? (
                              <p className="mt-1 rounded bg-background/40 px-1.5 py-1 text-[10px] text-text-muted">
                                {side.preview}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Fold>

          {/* Runtime Tiers */}
          <Fold t="Runtime Tiers" open>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {d.runtime.tiers.map((t) => {
                const ok = t.live && t.ready;
                return (
                  <div
                    key={t.tier}
                    className={cn(
                      "flex items-center justify-between rounded border px-2.5 py-1.5",
                      ok ? "border-border/50 bg-surface" : "border-destructive/30 bg-destructive/5"
                    )}
                  >
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                        {t.tier.replace(/_/g, " ")}
                      </span>
                      {t.flapCount > 0 && (
                        <p className="text-[9px] text-warning">
                          {t.flapCount} flap{t.flapCount > 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {(["live", "ready"] as const).map((k) => {
                        const on = k === "live" ? t.live : t.ready;
                        return (
                          <span key={k} className="flex items-center gap-1">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                on
                                  ? "bg-success shadow-[0_0_4px_rgba(34,197,94,.5)]"
                                  : "bg-destructive"
                              )}
                            />
                            <span className="text-[9px] capitalize text-text-subtle">{k}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Fold>

          {/* Process pressure */}
          <Fold t="Process Pressure" open>
            <div className="rounded border border-border/40 bg-surface px-2.5 py-2">
              <div className="space-y-2">
                <Bar
                  pct={
                    d.health.heapTotalBytes > 0
                      ? Math.round((d.health.heapUsedBytes / d.health.heapTotalBytes) * 100)
                      : 0
                  }
                  label="Heap"
                  sub={`${fB(d.health.heapUsedBytes)} / ${fB(d.health.heapTotalBytes)}`}
                />
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                  <div>
                    <span className="text-text-subtle">RSS </span>
                    <span className="font-medium tabular-nums text-text">
                      {fB(d.health.rssBytes)}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-subtle">External </span>
                    <span className="font-medium tabular-nums text-text">
                      {fB(d.health.externalBytes)}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-subtle">Buffers </span>
                    <span className="font-medium tabular-nums text-text">
                      {fB(d.health.arrayBuffersBytes)}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-subtle">CPU </span>
                    <span className="font-medium tabular-nums text-text">
                      {(d.health.cpuUserMs / 1000).toFixed(1)}s /{" "}
                      {(d.health.cpuSystemMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Fold>

          {/* Process details — collapsed */}
          <Fold t="Request Details">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded border border-border/40 bg-surface px-2.5 py-2 text-[10px] sm:grid-cols-4">
              <div>
                <span className="text-text-subtle">Total </span>
                <span className="font-medium tabular-nums text-text">
                  {d.health.totalRequests.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-text-subtle">Errors </span>
                <span className="font-medium tabular-nums text-text">
                  {d.health.totalErrors.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-text-subtle">In-flight </span>
                <span className="font-medium tabular-nums text-text">
                  {d.queuePressure.inFlight}
                </span>
              </div>
              <div>
                <span className="text-text-subtle">Started </span>
                <span className="font-medium tabular-nums text-text">
                  {new Date(d.health.processStartedAt).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short"
                  })}
                </span>
              </div>
            </div>
          </Fold>

          {/* Footer */}
          <p className="pt-0.5 text-center text-[9px] tabular-nums text-text-subtle/50">
            {new Date(d.updatedAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "medium"
            })}
          </p>
        </>
      )}
    </div>
  );
}
