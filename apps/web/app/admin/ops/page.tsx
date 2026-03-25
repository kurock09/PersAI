"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Activity,
  Bot,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  AlertTriangle,
  Info
} from "lucide-react";
import {
  type AdminOpsCockpitState,
  type AdminOpsIncidentSignal,
  AdminOpsIncidentSignalSeverity,
  AssistantRuntimeApplyStatus,
  type AssistantRuntimeApplyStatus as ApplyStatus
} from "@persai/contracts";
import { getAdminOpsCockpit, postAssistantReapply } from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

function formatTs(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium"
    });
  } catch {
    return iso;
  }
}

function formatNullable(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function applyStatusTone(status: ApplyStatus): string {
  switch (status) {
    case AssistantRuntimeApplyStatus.succeeded:
      return "border-success/35 bg-success/10 text-success";
    case AssistantRuntimeApplyStatus.failed:
      return "border-destructive/35 bg-destructive/10 text-destructive";
    case AssistantRuntimeApplyStatus.in_progress:
      return "border-warning/40 bg-warning/10 text-warning";
    case AssistantRuntimeApplyStatus.degraded:
      return "border-orange-400/35 bg-orange-400/10 text-orange-400";
    case AssistantRuntimeApplyStatus.pending:
    case AssistantRuntimeApplyStatus.not_requested:
    default:
      return "border-border bg-surface text-text-muted";
  }
}

function incidentSeverityTone(severity: AdminOpsIncidentSignal["severity"]): string {
  switch (severity) {
    case AdminOpsIncidentSignalSeverity.high:
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case AdminOpsIncidentSignalSeverity.elevated:
      return "border-warning/35 bg-warning/10 text-warning";
    case AdminOpsIncidentSignalSeverity.info:
    default:
      return "border-blue-500/25 bg-blue-500/10 text-blue-300";
  }
}

function PreflightDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          ok ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.45)]" : "bg-destructive"
        )}
        aria-hidden
      />
      <span className="text-text-muted">{label}</span>
      <span className={cn("font-medium", ok ? "text-success" : "text-destructive")}>
        {ok ? "Yes" : "No"}
      </span>
    </div>
  );
}

function CardShell({
  title,
  icon: Icon,
  children
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-raised p-3.5">
      <div className="mb-3 flex items-center gap-2 border-b border-border pb-2">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text">{title}</h2>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="min-w-0 break-all text-right font-mono text-text">{value}</span>
    </div>
  );
}

export default function AdminOpsPage() {
  const { getToken } = useAuth();
  const [cockpit, setCockpit] = useState<AdminOpsCockpitState | null>(null);
  const cockpitRef = useRef<AdminOpsCockpitState | null>(null);
  cockpitRef.current = cockpit;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reapplyBusy, setReapplyBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoadError("Not signed in.");
      setCockpit(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoadError(null);
    const incremental = cockpitRef.current !== null;
    if (incremental) setRefreshing(true);
    else setLoading(true);
    try {
      setCockpit(await getAdminOpsCockpit(token));
    } catch (e) {
      setCockpit(null);
      setLoadError(e instanceof Error ? e.message : "Unable to load ops data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const onReapply = useCallback(async () => {
    if (!cockpit?.controls.reapplySupported) return;
    setActionMessage(null);
    const token = await getToken();
    if (!token) {
      setActionMessage("Not signed in.");
      return;
    }
    setReapplyBusy(true);
    try {
      await postAssistantReapply(token);
      setActionMessage("Reapply completed.");
      await load();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Reapply failed.");
    } finally {
      setReapplyBusy(false);
    }
  }, [cockpit?.controls.reapplySupported, getToken, load]);

  const onRestart = useCallback(() => {
    setActionMessage("Runtime restart is not wired in this admin UI yet.");
  }, []);

  if (loading && cockpit === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-bold tracking-tight text-text">Ops Cockpit</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing || loading}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text transition-colors",
            "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </header>

      {loadError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {loadError}
        </p>
      )}

      {cockpit && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <CardShell title="Assistant" icon={Bot}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">Exists</span>
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    cockpit.assistant.exists
                      ? "bg-success/15 text-success"
                      : "bg-surface text-text-muted ring-1 ring-border"
                  )}
                >
                  {cockpit.assistant.exists ? "Yes" : "No"}
                </span>
              </div>
              <DetailRow label="Assistant ID" value={formatNullable(cockpit.assistant.assistantId)} />
              <DetailRow label="Workspace" value={formatNullable(cockpit.assistant.workspaceId)} />
              <div className="border-t border-border pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Latest published
                </p>
                <DetailRow
                  label="Version ID"
                  value={formatNullable(cockpit.assistant.latestPublishedVersion.id)}
                />
                <DetailRow
                  label="Version #"
                  value={formatNullable(cockpit.assistant.latestPublishedVersion.version)}
                />
                <DetailRow
                  label="Published at"
                  value={formatTs(cockpit.assistant.latestPublishedVersion.publishedAt)}
                />
              </div>
              <div className="border-t border-border pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Runtime apply
                </p>
                {cockpit.assistant.runtimeApply === null ? (
                  <p className="text-xs text-text-muted">No apply state</p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          applyStatusTone(cockpit.assistant.runtimeApply.status)
                        )}
                      >
                        {cockpit.assistant.runtimeApply.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <DetailRow
                      label="Target version"
                      value={formatNullable(cockpit.assistant.runtimeApply.targetPublishedVersionId)}
                    />
                    <DetailRow
                      label="Applied version"
                      value={formatNullable(cockpit.assistant.runtimeApply.appliedPublishedVersionId)}
                    />
                    <DetailRow
                      label="Requested"
                      value={formatTs(cockpit.assistant.runtimeApply.requestedAt)}
                    />
                    <DetailRow
                      label="Started"
                      value={formatTs(cockpit.assistant.runtimeApply.startedAt)}
                    />
                    <DetailRow
                      label="Finished"
                      value={formatTs(cockpit.assistant.runtimeApply.finishedAt)}
                    />
                    {cockpit.assistant.runtimeApply.error && (
                      <div className="mt-1 rounded border border-destructive/25 bg-destructive/5 p-2 text-[11px] text-destructive">
                        <span className="font-mono font-semibold">
                          {formatNullable(cockpit.assistant.runtimeApply.error.code)}
                        </span>
                        {cockpit.assistant.runtimeApply.error.message ? (
                          <p className="mt-0.5 text-text-muted">
                            {cockpit.assistant.runtimeApply.error.message}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardShell>

            <CardShell title="Runtime" icon={Server}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">Adapter</span>
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    cockpit.runtime.adapterEnabled
                      ? "bg-success/15 text-success"
                      : "bg-surface text-text-muted ring-1 ring-border"
                  )}
                >
                  {cockpit.runtime.adapterEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <DetailRow
                label="OpenClaw host"
                value={formatNullable(cockpit.runtime.openclawBaseUrlHost)}
              />
              <div className="border-t border-border pt-2">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Preflight
                </p>
                <PreflightDot ok={cockpit.runtime.preflight.live} label="Live" />
                <PreflightDot ok={cockpit.runtime.preflight.ready} label="Ready" />
                <DetailRow label="Checked at" value={formatTs(cockpit.runtime.preflight.checkedAt)} />
              </div>
            </CardShell>
          </div>

          <section className="rounded-lg border border-border bg-surface-raised p-3.5">
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-text">
              Controls
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!cockpit.controls.reapplySupported || reapplyBusy}
                onClick={() => void onReapply()}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors",
                  "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                )}
              >
                {reapplyBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Reapply
              </button>
              <button
                type="button"
                disabled={!cockpit.controls.restartSupported}
                onClick={onRestart}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors",
                  "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                )}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Restart
              </button>
            </div>
            {actionMessage && (
              <p className="mt-2 text-xs text-text-muted">{actionMessage}</p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-surface-raised p-3.5">
            <h2 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text">
              <AlertTriangle className="h-3.5 w-3.5 text-text-muted" />
              Incident signals
            </h2>
            {cockpit.incidentSignals.length === 0 ? (
              <p className="text-xs text-text-muted">No active incident signals.</p>
            ) : (
              <ul className="space-y-2">
                {cockpit.incidentSignals.map((signal, i) => (
                  <li
                    key={`${i}-${signal.code}-${signal.severity}`}
                    className={cn(
                      "rounded-md border px-2.5 py-2 text-xs",
                      incidentSeverityTone(signal.severity)
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {signal.severity === AdminOpsIncidentSignalSeverity.info ? (
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
                      )}
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] font-semibold">{signal.code}</p>
                        <p className="mt-0.5 text-[11px] leading-snug opacity-90">{signal.message}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-center text-[11px] text-text-subtle">
            Last updated {formatTs(cockpit.updatedAt)}
          </p>
        </>
      )}
    </div>
  );
}
