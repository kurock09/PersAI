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

type Pctl = { p50Ms: number; p95Ms: number; p99Ms: number };
type ChLatency = { avgMs: number; maxMs: number; count: number; percentiles: Pctl };
type LatencySnap = {
  webChatTurns: ChLatency | null;
  telegramTurns: ChLatency | null;
  allRoutes: ChLatency;
};
type Warning = { code: string; severity: "info" | "warning" | "critical"; message: string };
type QueuePressure = { inFlight: number; peakInFlight: number; requestsPerSecond: number };
type PodHealth = {
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
type AggregatedHealth = {
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
  maxPodRssBytes: number;
  maxPodInstanceId: string | null;
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
type DataSource = {
  scope: "api_instance_local";
  instanceId: string;
  podIp: string | null;
};
type LatencyBucket = { le: number; value: number };
type LatencyRollup = {
  count: number;
  durationMsTotal: number;
  maxMs: number;
  buckets: LatencyBucket[];
};
type ExecutionWorkloadPodState = {
  podIp: string;
  address: string;
  live: boolean;
  ready: boolean;
  checkedAt: string;
};
type ExecutionWorkloadState = {
  key: "runtime" | "provider_gateway";
  label: string;
  baseUrlConfigured: boolean;
  endpointHost: string | null;
  desiredReplicas: number | null;
  autoscalingEnabled: boolean;
  autoscalingMinReplicas: number | null;
  autoscalingMaxReplicas: number | null;
  discoveryMode: "headless_dns" | "service_base_url" | "unconfigured";
  discoveryTarget: string | null;
  opaque: boolean;
  live: boolean;
  ready: boolean;
  observedPodCount: number;
  discoveredReadyPodCount: number;
  checkedAt: string;
  notes: string[];
  pods: ExecutionWorkloadPodState[];
};
type RuntimeState = {
  live: boolean;
  ready: boolean;
  checkedAt: string;
  runtime: ExecutionWorkloadState;
  providerGateway: ExecutionWorkloadState;
};
type Dash = {
  dataSource: DataSource;
  latency: LatencySnap;
  aggregation: {
    latency: {
      webChatTurns: LatencyRollup | null;
      telegramTurns: LatencyRollup | null;
      allRoutes: LatencyRollup;
    };
  };
  latencyTrace: TraceState;
  activeUsers: number;
  activeWebChats: number;
  runtime: RuntimeState;
  health: PodHealth;
  queuePressure: QueuePressure;
  warnings: Warning[];
  updatedAt: string;
};
type SourceRegistry = Record<string, DataSource>;
type AggregatedTraceEntry = TraceEntry & { sourceInstanceId: string };
type AggregatedTraceState = {
  mode: "off" | "partial" | "on";
  enabledPodCount: number;
  totalPodCount: number;
  sampleLimit: number;
  updatedAt: string | null;
  recent: AggregatedTraceEntry[];
};
type AggregatedRuntimeState = {
  live: boolean;
  ready: boolean;
  checkedAt: string | null;
  runtime: AggregatedExecutionWorkloadState;
  providerGateway: AggregatedExecutionWorkloadState;
};
type AggregatedExecutionWorkloadState = {
  key: "runtime" | "provider_gateway";
  label: string;
  baseUrlConfigured: boolean;
  endpointHosts: string[];
  desiredReplicas: number | null;
  autoscalingEnabled: boolean;
  autoscalingMinReplicas: number | null;
  autoscalingMaxReplicas: number | null;
  discoveryModes: Array<ExecutionWorkloadState["discoveryMode"]>;
  discoveryTargets: string[];
  opaque: boolean;
  live: boolean;
  ready: boolean;
  observedPodCount: number;
  discoveredReadyPodCount: number;
  checkedAt: string | null;
  notes: string[];
  pods: ExecutionWorkloadPodState[];
};
type AggregatedOverview = {
  apiSources: DataSource[];
  latency: LatencySnap;
  latencyTrace: AggregatedTraceState;
  activeUsers: number;
  activeWebChats: number;
  runtime: AggregatedRuntimeState;
  health: AggregatedHealth;
  queuePressure: QueuePressure;
  warnings: Warning[];
  updatedAt: string;
  oldestProcessStartedAt: string | null;
  newestProcessStartedAt: string | null;
};

const HIGH_MEMORY_THRESHOLD_BYTES = 512 * 1024 * 1024;
const HIGH_LATENCY_THRESHOLD_MS = 3000;
const HIGH_ERROR_RATE_THRESHOLD = 0.05;
const MAX_DISCOVERY_PROBES = 6;
const MAX_STABLE_PROBES = 2;
const TRACE_RECENT_LIMIT = 40;

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

function formatWhen(value: string | null) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short"
      })
    : "—";
}

function traceModeLabel(mode: AggregatedTraceState["mode"]) {
  if (mode === "on") return "ON";
  if (mode === "partial") return "PARTIAL";
  return "OFF";
}

function estimatePercentiles(rollup: LatencyRollup): Pctl {
  if (rollup.count === 0) {
    return { p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }
  const sorted = [...rollup.buckets].sort((a, b) => a.le - b.le);
  const pick = (target: number) => {
    const threshold = Math.ceil(target * rollup.count);
    for (const bucket of sorted) {
      if (bucket.value >= threshold) {
        return bucket.le;
      }
    }
    return Math.round(rollup.maxMs);
  };
  return {
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    p99Ms: pick(0.99)
  };
}

function mergeRollups(rollups: Array<LatencyRollup | null>): LatencyRollup | null {
  const existing = rollups.filter((rollup): rollup is LatencyRollup => rollup !== null);
  if (existing.length === 0) {
    return null;
  }
  const mergedBuckets = existing[0]!.buckets.map((bucket) => ({
    le: bucket.le,
    value: 0
  }));
  let count = 0;
  let durationMsTotal = 0;
  let maxMs = 0;
  for (const rollup of existing) {
    count += rollup.count;
    durationMsTotal += rollup.durationMsTotal;
    maxMs = Math.max(maxMs, rollup.maxMs);
    for (let index = 0; index < mergedBuckets.length; index += 1) {
      mergedBuckets[index]!.value += rollup.buckets[index]?.value ?? 0;
    }
  }
  return {
    count,
    durationMsTotal,
    maxMs,
    buckets: mergedBuckets
  };
}

function buildLatency(rollup: LatencyRollup | null): ChLatency | null {
  if (!rollup || rollup.count === 0) {
    return null;
  }
  return {
    avgMs: Math.round(rollup.durationMsTotal / rollup.count),
    maxMs: Math.round(rollup.maxMs),
    count: rollup.count,
    percentiles: estimatePercentiles(rollup)
  };
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const existing = values.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  if (existing.length === 0) {
    return null;
  }
  return existing.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  ].sort((left, right) => left.localeCompare(right));
}

function aggregateExecutionWorkloadState(
  workloads: ExecutionWorkloadState[]
): AggregatedExecutionWorkloadState {
  const first = workloads[0];
  if (!first) {
    return {
      key: "runtime",
      label: "Runtime",
      baseUrlConfigured: false,
      endpointHosts: [],
      desiredReplicas: null,
      autoscalingEnabled: false,
      autoscalingMinReplicas: null,
      autoscalingMaxReplicas: null,
      discoveryModes: [],
      discoveryTargets: [],
      opaque: true,
      live: false,
      ready: false,
      observedPodCount: 0,
      discoveredReadyPodCount: 0,
      checkedAt: null,
      notes: [],
      pods: []
    };
  }

  const podMap = new Map<string, ExecutionWorkloadPodState>();
  for (const workload of workloads) {
    for (const pod of workload.pods) {
      const key = pod.podIp || pod.address;
      const existing = podMap.get(key);
      if (
        !existing ||
        pod.checkedAt.localeCompare(existing.checkedAt) > 0 ||
        (pod.ready && !existing.ready)
      ) {
        podMap.set(key, pod);
      }
    }
  }
  const pods = [...podMap.values()].sort((left, right) =>
    (left.podIp || left.address).localeCompare(right.podIp || right.address)
  );

  return {
    key: first.key,
    label: first.label,
    baseUrlConfigured: workloads.some((workload) => workload.baseUrlConfigured),
    endpointHosts: uniqueSorted(workloads.map((workload) => workload.endpointHost)),
    desiredReplicas:
      workloads.find((workload) => workload.desiredReplicas !== null)?.desiredReplicas ?? null,
    autoscalingEnabled: workloads.some((workload) => workload.autoscalingEnabled),
    autoscalingMinReplicas:
      workloads.find((workload) => workload.autoscalingMinReplicas !== null)
        ?.autoscalingMinReplicas ?? null,
    autoscalingMaxReplicas:
      workloads.find((workload) => workload.autoscalingMaxReplicas !== null)
        ?.autoscalingMaxReplicas ?? null,
    discoveryModes: [...new Set(workloads.map((workload) => workload.discoveryMode))],
    discoveryTargets: uniqueSorted(workloads.map((workload) => workload.discoveryTarget)),
    opaque: workloads.some((workload) => workload.opaque),
    live: workloads.every((workload) => workload.live),
    ready: workloads.every((workload) => workload.ready),
    observedPodCount: Math.max(...workloads.map((workload) => workload.observedPodCount)),
    discoveredReadyPodCount: Math.max(
      ...workloads.map((workload) => workload.discoveredReadyPodCount)
    ),
    checkedAt: latestIso(workloads.map((workload) => workload.checkedAt)),
    notes: uniqueSorted(workloads.flatMap((workload) => workload.notes)),
    pods
  };
}

function dedupeDashboards(dashboards: Dash[]): Dash[] {
  const map = new Map<string, Dash>();
  for (const dashboard of dashboards) {
    map.set(dashboard.dataSource.instanceId, dashboard);
  }
  return [...map.values()].sort((left, right) =>
    left.dataSource.instanceId.localeCompare(right.dataSource.instanceId)
  );
}

function buildAggregateWarnings(
  dashboards: Dash[],
  aggregate: {
    latency: LatencySnap;
    latencyTrace: AggregatedTraceState;
    runtime: AggregatedRuntimeState;
    health: AggregatedHealth;
    queuePressure: QueuePressure;
  }
): Warning[] {
  const warnings: Warning[] = [];
  if (!aggregate.runtime.live || !aggregate.runtime.ready) {
    warnings.push({
      code: "runtime_unhealthy",
      severity: "critical",
      message: `Execution path unhealthy (runtime ready=${aggregate.runtime.runtime.ready}, provider-gateway ready=${aggregate.runtime.providerGateway.ready}).`
    });
  }

  for (const workload of [aggregate.runtime.runtime, aggregate.runtime.providerGateway]) {
    if (workload.opaque) {
      warnings.push({
        code: `${workload.key}_opaque`,
        severity: "info",
        message: `${workload.label} still exposes only service-level health.`
      });
    }
    if (workload.desiredReplicas !== null && workload.desiredReplicas <= 1) {
      warnings.push({
        code: `${workload.key}_singleton`,
        severity: "warning",
        message: `${workload.label} is still a singleton workload.`
      });
    }
    if (
      workload.desiredReplicas !== null &&
      !workload.opaque &&
      workload.discoveredReadyPodCount < workload.desiredReplicas
    ) {
      warnings.push({
        code: `${workload.key}_partial`,
        severity: "warning",
        message: `${workload.label} has ${workload.discoveredReadyPodCount}/${workload.desiredReplicas} ready endpoints.`
      });
    }
  }

  if (
    aggregate.health.maxPodInstanceId !== null &&
    aggregate.health.maxPodRssBytes > HIGH_MEMORY_THRESHOLD_BYTES
  ) {
    warnings.push({
      code: "high_memory",
      severity: "warning",
      message: `${aggregate.health.maxPodInstanceId} RSS is ${fB(aggregate.health.maxPodRssBytes)}.`
    });
  }

  if (
    aggregate.health.errorRate > HIGH_ERROR_RATE_THRESHOLD &&
    aggregate.health.totalRequests > 10
  ) {
    warnings.push({
      code: "high_error_rate",
      severity: "warning",
      message: `Cluster error rate ${(aggregate.health.errorRate * 100).toFixed(1)}% on ${aggregate.health.totalRequests.toLocaleString()} requests.`
    });
  }

  const webP95 = aggregate.latency.webChatTurns?.percentiles.p95Ms ?? 0;
  const tgP95 = aggregate.latency.telegramTurns?.percentiles.p95Ms ?? 0;
  if (webP95 > HIGH_LATENCY_THRESHOLD_MS || tgP95 > HIGH_LATENCY_THRESHOLD_MS) {
    warnings.push({
      code: "high_p95_latency",
      severity: "warning",
      message: `p95 latency: web=${webP95}ms, TG=${tgP95}ms (threshold ${HIGH_LATENCY_THRESHOLD_MS}ms).`
    });
  }

  if (aggregate.queuePressure.peakInFlight >= 20 || aggregate.queuePressure.inFlight >= 20) {
    warnings.push({
      code: "high_queue_pressure",
      severity:
        aggregate.queuePressure.peakInFlight >= 50 || aggregate.queuePressure.inFlight >= 50
          ? "critical"
          : "warning",
      message: `In-flight now=${aggregate.queuePressure.inFlight}, max pod peak=${aggregate.queuePressure.peakInFlight}.`
    });
  }

  if (aggregate.latencyTrace.mode === "partial" && aggregate.latencyTrace.totalPodCount > 0) {
    warnings.push({
      code: "trace_partial",
      severity: "info",
      message: `Trace capture is enabled on ${aggregate.latencyTrace.enabledPodCount}/${aggregate.latencyTrace.totalPodCount} discovered api pods.`
    });
  }

  if (dashboards.length === 1) {
    warnings.push({
      code: "single_pod_view",
      severity: "info",
      message: "Only one api pod is currently discovered through the admin overview probe path."
    });
  }

  return warnings;
}

function buildAggregatedOverview(dashboards: Dash[]): AggregatedOverview {
  const pods = dedupeDashboards(dashboards);
  if (pods.length === 0) {
    throw new Error("No overview pods discovered.");
  }

  const latencyRollups = {
    webChatTurns: mergeRollups(pods.map((pod) => pod.aggregation.latency.webChatTurns)),
    telegramTurns: mergeRollups(pods.map((pod) => pod.aggregation.latency.telegramTurns)),
    allRoutes: mergeRollups(pods.map((pod) => pod.aggregation.latency.allRoutes)) ?? {
      count: 0,
      durationMsTotal: 0,
      maxMs: 0,
      buckets: []
    }
  };

  const latency: LatencySnap = {
    webChatTurns: buildLatency(latencyRollups.webChatTurns),
    telegramTurns: buildLatency(latencyRollups.telegramTurns),
    allRoutes: buildLatency(latencyRollups.allRoutes) ?? {
      avgMs: 0,
      maxMs: 0,
      count: 0,
      percentiles: { p50Ms: 0, p95Ms: 0, p99Ms: 0 }
    }
  };

  const traceEntries = pods
    .flatMap((pod) =>
      pod.latencyTrace.recent.map(
        (entry): AggregatedTraceEntry => ({
          ...entry,
          sourceInstanceId: pod.dataSource.instanceId
        })
      )
    )
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
    .slice(0, TRACE_RECENT_LIMIT);
  const enabledPodCount = pods.filter((pod) => pod.latencyTrace.enabled).length;
  const latencyTrace: AggregatedTraceState = {
    mode: enabledPodCount === 0 ? "off" : enabledPodCount === pods.length ? "on" : "partial",
    enabledPodCount,
    totalPodCount: pods.length,
    sampleLimit: pods.reduce((total, pod) => total + pod.latencyTrace.sampleLimit, 0),
    updatedAt: latestIso(pods.map((pod) => pod.latencyTrace.updatedAt)),
    recent: traceEntries
  };

  const maxPodByRss = pods.reduce<Dash | null>(
    (current, pod) =>
      current === null || pod.health.rssBytes > current.health.rssBytes ? pod : current,
    null
  );

  const runtimeWorkload = aggregateExecutionWorkloadState(pods.map((pod) => pod.runtime.runtime));
  const providerGatewayWorkload = aggregateExecutionWorkloadState(
    pods.map((pod) => pod.runtime.providerGateway)
  );
  const runtime: AggregatedRuntimeState = {
    live: pods.every((pod) => pod.runtime.live),
    ready: pods.every((pod) => pod.runtime.ready),
    checkedAt: latestIso(pods.map((pod) => pod.runtime.checkedAt)),
    runtime: runtimeWorkload,
    providerGateway: providerGatewayWorkload
  };

  const health: AggregatedHealth = {
    rssBytes: pods.reduce((total, pod) => total + pod.health.rssBytes, 0),
    heapUsedBytes: pods.reduce((total, pod) => total + pod.health.heapUsedBytes, 0),
    heapTotalBytes: pods.reduce((total, pod) => total + pod.health.heapTotalBytes, 0),
    externalBytes: pods.reduce((total, pod) => total + pod.health.externalBytes, 0),
    arrayBuffersBytes: pods.reduce((total, pod) => total + pod.health.arrayBuffersBytes, 0),
    totalRequests: pods.reduce((total, pod) => total + pod.health.totalRequests, 0),
    totalErrors: pods.reduce((total, pod) => total + pod.health.totalErrors, 0),
    errorRate: 0,
    cpuUserMs: pods.reduce((total, pod) => total + pod.health.cpuUserMs, 0),
    cpuSystemMs: pods.reduce((total, pod) => total + pod.health.cpuSystemMs, 0),
    maxPodRssBytes: maxPodByRss?.health.rssBytes ?? 0,
    maxPodInstanceId: maxPodByRss?.dataSource.instanceId ?? null
  };
  health.errorRate = health.totalRequests > 0 ? health.totalErrors / health.totalRequests : 0;

  const queuePressure: QueuePressure = {
    inFlight: pods.reduce((total, pod) => total + pod.queuePressure.inFlight, 0),
    peakInFlight: pods.reduce((peak, pod) => Math.max(peak, pod.queuePressure.peakInFlight), 0),
    requestsPerSecond:
      Math.round(
        pods.reduce((total, pod) => total + pod.queuePressure.requestsPerSecond, 0) * 100
      ) / 100
  };

  const oldestProcessStartedAt =
    [...pods]
      .map((pod) => pod.health.processStartedAt)
      .sort((left, right) => left.localeCompare(right))[0] ?? null;
  const newestProcessStartedAt =
    [...pods]
      .map((pod) => pod.health.processStartedAt)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;

  const aggregate: AggregatedOverview = {
    apiSources: pods.map((pod) => pod.dataSource),
    latency,
    latencyTrace,
    activeUsers: Math.max(...pods.map((pod) => pod.activeUsers)),
    activeWebChats: Math.max(...pods.map((pod) => pod.activeWebChats)),
    runtime,
    health,
    queuePressure,
    warnings: [],
    updatedAt: latestIso(pods.map((pod) => pod.updatedAt)) ?? new Date().toISOString(),
    oldestProcessStartedAt,
    newestProcessStartedAt
  };

  aggregate.warnings = buildAggregateWarnings(pods, aggregate);
  return aggregate;
}

async function fetchDashboard(token: string, routeHint: AdminOverviewRouteHint): Promise<Dash> {
  return (await getAdminOverviewDashboard(token, routeHint)) as unknown as Dash;
}

async function discoverDashboards(token: string, seedSources: DataSource[]): Promise<Dash[]> {
  const discovered = new Map<string, Dash>();
  const remember = (dashboard: Dash) => {
    discovered.set(dashboard.dataSource.instanceId, dashboard);
  };

  remember(await fetchDashboard(token, { mode: "auto" }));

  let stableProbeCount = 0;
  for (
    let attempt = 0;
    attempt < MAX_DISCOVERY_PROBES && stableProbeCount < MAX_STABLE_PROBES;
    attempt += 1
  ) {
    const before = discovered.size;
    try {
      remember(await fetchDashboard(token, { mode: "probe" }));
      stableProbeCount = discovered.size === before ? stableProbeCount + 1 : 0;
    } catch {
      stableProbeCount += 1;
    }
  }

  const candidateSources = new Map<string, DataSource>();
  for (const seed of seedSources) {
    candidateSources.set(seed.instanceId, seed);
  }
  for (const dashboard of discovered.values()) {
    candidateSources.set(dashboard.dataSource.instanceId, dashboard.dataSource);
  }

  const pinnedFetches = await Promise.allSettled(
    [...candidateSources.values()]
      .filter((source) => source.podIp !== null)
      .map((source) => fetchDashboard(token, { mode: "pinned", podIp: source.podIp! }))
  );
  for (const result of pinnedFetches) {
    if (result.status === "fulfilled") {
      remember(result.value);
    }
  }

  return dedupeDashboards([...discovered.values()]);
}

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
        onClick={() => setO((value) => !value)}
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
  if (!d) {
    return (
      <div className="rounded border border-border/40 bg-surface px-2.5 py-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">{label}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">—</p>
      </div>
    );
  }
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
        ).map(([lbl, value]) => (
          <div key={lbl}>
            <p className="text-[8px] uppercase text-text-subtle">{lbl}</p>
            <p className="text-[13px] font-semibold tabular-nums leading-tight text-text">
              {fMs(value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const { getToken } = useAuth();
  const knownSourcesRef = useRef<SourceRegistry>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [traceBusy, setTraceBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [d, setD] = useState<AggregatedOverview | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      const token = await getToken();
      if (!token) {
        return;
      }
      if (refresh) {
        setBusy(true);
      } else {
        setLoading(true);
      }
      setErr(null);
      try {
        const dashboards = await discoverDashboards(token, Object.values(knownSourcesRef.current));
        knownSourcesRef.current = Object.fromEntries(
          dashboards.map((dashboard) => [dashboard.dataSource.instanceId, dashboard.dataSource])
        );
        setD(buildAggregatedOverview(dashboards));
      } catch {
        setD(null);
        setErr("Unable to load dashboard.");
      } finally {
        setLoading(false);
        setBusy(false);
      }
    },
    [getToken]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const toggleTrace = useCallback(async () => {
    const token = await getToken();
    if (!token || !d) {
      return;
    }
    setTraceBusy(true);
    setErr(null);
    try {
      const dashboards = await discoverDashboards(token, Object.values(knownSourcesRef.current));
      const nextEnabled = d.latencyTrace.mode !== "on";
      const targets =
        dashboards.filter((dashboard) => dashboard.dataSource.podIp !== null).length > 0
          ? dashboards
              .filter((dashboard) => dashboard.dataSource.podIp !== null)
              .map((dashboard) =>
                setAdminOverviewLatencyTrace(token, nextEnabled, {
                  mode: "pinned",
                  podIp: dashboard.dataSource.podIp!
                })
              )
          : [setAdminOverviewLatencyTrace(token, nextEnabled, { mode: "auto" })];
      const results = await Promise.allSettled(targets);
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      if (successCount === 0) {
        throw new Error("Trace toggle failed.");
      }
      if (successCount !== targets.length) {
        setErr(`Trace updated on ${successCount}/${targets.length} discovered api pods.`);
      }
      await load(true);
    } catch {
      setErr("Unable to change latency trace mode.");
    } finally {
      setTraceBusy(false);
    }
  }, [d, getToken, load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-2.5 px-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Shield className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold tracking-tight text-text">System Overview</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {d && (
            <button
              type="button"
              disabled={traceBusy}
              onClick={() => void toggleTrace()}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
                d.latencyTrace.mode === "on"
                  ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
                  : d.latencyTrace.mode === "partial"
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/15"
                    : "border-border bg-surface text-text-muted hover:bg-surface-hover",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              {traceBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Trace {traceModeLabel(d.latencyTrace.mode)}
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

      {d && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 rounded border border-border/40 bg-surface px-2.5 py-1.5 text-[10px] text-text-muted">
            <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 font-semibold text-success">
              Multi-pod aggregate
            </span>
            <span>
              Showing the merged overview of{" "}
              <span className="font-medium text-text">{d.apiSources.length}</span> discovered `api`
              pod{d.apiSources.length === 1 ? "" : "s"}.
            </span>
            <span>
              Active users and active web chats still come from shared backend state, while latency,
              trace, request totals, and process pressure are aggregated from the discovered `api`
              fleet.
            </span>
            <span>
              Pods:{" "}
              <span className="font-mono text-text">
                {d.apiSources.map((source) => source.instanceId).join(", ")}
              </span>
            </span>
          </div>

          {d.warnings.length > 0 && (
            <div className="space-y-0.5">
              {d.warnings.map((warning, index) => (
                <div
                  key={`${warning.code}-${index}`}
                  className={cn(
                    "flex items-center gap-2 rounded border-l-2 px-2.5 py-1 text-[10px]",
                    sevBg(warning.severity)
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sevDot(warning.severity))}
                  />
                  <span className="font-mono font-bold text-text-muted">{warning.code}</span>
                  <span className="text-text-muted">{warning.message}</span>
                </div>
              ))}
            </div>
          )}

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
              sub="Cluster now"
              icon={Activity}
            />
            <KPI
              label="Req/s"
              value={String(d.queuePressure.requestsPerSecond)}
              sub={`Max pod peak ${d.queuePressure.peakInFlight}`}
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
            <KPI
              label="API pods"
              value={String(d.apiSources.length)}
              sub={d.apiSources.length > 0 ? d.apiSources[0]!.instanceId : "—"}
            />
          </div>

          <Fold t="Latency · p50 / p95 / p99" open>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <Lat label="Web Chat" d={d.latency.webChatTurns} />
              <Lat label="Telegram" d={d.latency.telegramTurns} />
              <Lat label="All Routes" d={d.latency.allRoutes} />
            </div>
          </Fold>

          <Fold t="Latency Trace" open>
            <div className="space-y-1.5 rounded border border-border/40 bg-surface px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-subtle">
                    Trace capture
                  </p>
                  <p className="text-[10px] text-text-muted">
                    {d.latencyTrace.mode === "on"
                      ? "Enabled across all discovered api pods."
                      : d.latencyTrace.mode === "partial"
                        ? "Enabled only on part of the discovered api fleet."
                        : "Disabled. No stage timings are collected."}
                  </p>
                  <p className="text-[10px] text-text-subtle">
                    The toggle fans out to discovered `api` pods. If a new pod appears after the
                    toggle, refresh and toggle again to include it.
                  </p>
                </div>
                <div className="text-right text-[10px] text-text-subtle">
                  <p>
                    Enabled: {d.latencyTrace.enabledPodCount}/{d.latencyTrace.totalPodCount}
                  </p>
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
                  {d.latencyTrace.recent.map((item) => {
                    const runtimeStages = item.stages.filter(isRuntimeStage);
                    const persaiStages = item.stages.filter((stage) => !isRuntimeStage(stage));
                    const bottleneck = getBottleneckStage(item.stages);
                    return (
                      <div
                        key={`${item.sourceInstanceId}-${item.traceId}`}
                        className="rounded border border-border/40 bg-surface-raised px-2 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-subtle">
                              {surfaceLabel(item.surface)}
                            </p>
                            <p className={cn("text-[11px] font-semibold", statusTone(item.status))}>
                              {item.status} · {fMs(item.totalMs)}
                            </p>
                          </div>
                          <div className="text-right text-[9px] text-text-subtle">
                            <p>{new Date(item.finishedAt).toLocaleTimeString()}</p>
                            <p>{item.threadKey ?? "no-thread"}</p>
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-text-subtle">
                          <span>
                            Source: <span className="font-mono">{item.sourceInstanceId}</span>
                          </span>
                          <span>PersAI stages: {persaiStages.length}</span>
                          <span>Runtime stages: {runtimeStages.length}</span>
                          <span>
                            Bottleneck:{" "}
                            {bottleneck ? `${bottleneck.key} (${fMs(bottleneck.durationMs)})` : "—"}
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
                                  <span className="truncate pr-2 text-text-muted">{stage.key}</span>
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
                              Runtime
                            </p>
                            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                              {runtimeStages.map((stage) => (
                                <div
                                  key={`${item.traceId}-runtime-${stage.key}`}
                                  className="flex items-center justify-between rounded border border-border/30 px-1.5 py-1 text-[10px]"
                                >
                                  <span className="truncate pr-2 text-text-muted">{stage.key}</span>
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
                  })}
                </div>
              )}
            </div>
          </Fold>

          <Fold t="Native Runtime" open>
            <div className="space-y-1.5 rounded border border-border/40 bg-surface px-2.5 py-2">
              <p className="text-[10px] text-text-muted">
                This section now reflects the active native path{" "}
                <span className="font-mono text-text">
                  api -&gt; runtime -&gt; provider-gateway
                </span>
                . The old tier matrix is removed; scale the runtime deployment horizontally instead
                of pretending there are fixed logical tiers here.
              </p>
              <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                {[d.runtime.runtime, d.runtime.providerGateway].map((workload) => (
                  <div
                    key={workload.key}
                    className="rounded border border-border/40 bg-surface-raised px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">
                          {workload.label}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-[13px] font-semibold",
                            workload.live && workload.ready
                              ? "text-success"
                              : workload.live
                                ? "text-warning"
                                : "text-destructive"
                          )}
                        >
                          {workload.live && workload.ready
                            ? "live + ready"
                            : workload.live
                              ? "live but partial"
                              : "degraded"}
                        </p>
                      </div>
                      <div className="text-right text-[10px] text-text-subtle">
                        <p>
                          Ready endpoints: {workload.discoveredReadyPodCount}
                          {workload.desiredReplicas !== null
                            ? ` / ${workload.desiredReplicas}`
                            : ""}
                        </p>
                        <p>
                          Scale:{" "}
                          {workload.autoscalingEnabled
                            ? `${workload.autoscalingMinReplicas ?? workload.desiredReplicas ?? 1}-${workload.autoscalingMaxReplicas ?? workload.desiredReplicas ?? 1} HPA`
                            : `${workload.desiredReplicas ?? "?"} fixed`}
                        </p>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                      <span>
                        Host:{" "}
                        {workload.endpointHosts.length > 0
                          ? workload.endpointHosts.join(", ")
                          : "not configured"}
                      </span>
                      <span>
                        Discovery:{" "}
                        {workload.discoveryModes.length > 0
                          ? workload.discoveryModes.join(", ")
                          : "unconfigured"}
                      </span>
                      {workload.discoveryTargets.length > 0 ? (
                        <span>Target: {workload.discoveryTargets.join(", ")}</span>
                      ) : null}
                    </div>
                    {workload.notes.length > 0 ? (
                      <div className="mt-1 space-y-0.5">
                        {workload.notes.map((note) => (
                          <p
                            key={`${workload.key}-${note}`}
                            className="text-[10px] text-text-subtle"
                          >
                            {note}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {workload.pods.length > 0 ? (
                      <div className="mt-1.5 space-y-1">
                        {workload.pods.map((pod) => (
                          <div
                            key={`${workload.key}-${pod.podIp || pod.address}`}
                            className="flex items-center justify-between rounded border border-border/30 px-1.5 py-1 text-[10px]"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-mono text-text">
                                {pod.podIp || pod.address}
                              </p>
                              <p className="truncate text-text-subtle">{pod.address}</p>
                            </div>
                            <div className="text-right">
                              <p
                                className={cn(
                                  "font-semibold",
                                  pod.ready
                                    ? "text-success"
                                    : pod.live
                                      ? "text-warning"
                                      : "text-destructive"
                                )}
                              >
                                {pod.ready ? "ready" : pod.live ? "live" : "down"}
                              </p>
                              <p className="text-text-subtle">{formatWhen(pod.checkedAt)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[10px] text-text-subtle">
                        No direct pod endpoints discovered for this workload.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-subtle">
                Runtime checked: {formatWhen(d.runtime.checkedAt)}
              </p>
            </div>
          </Fold>

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
                  sub={`${fB(d.health.heapUsedBytes)} / ${fB(d.health.heapTotalBytes)} across ${d.apiSources.length} api pods`}
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
                <span className="text-text-subtle">Oldest pod </span>
                <span className="font-medium tabular-nums text-text">
                  {formatWhen(d.oldestProcessStartedAt)}
                </span>
              </div>
              <div>
                <span className="text-text-subtle">Newest pod </span>
                <span className="font-medium tabular-nums text-text">
                  {formatWhen(d.newestProcessStartedAt)}
                </span>
              </div>
            </div>
          </Fold>

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
