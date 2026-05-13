"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Layers, Loader2, RefreshCw } from "lucide-react";
import {
  getAdminPlatformRollouts,
  type MaterializationRolloutView
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

function statusBadgeClass(status: MaterializationRolloutView["status"]): string {
  switch (status) {
    case "running":
      return "bg-accent/15 text-accent";
    case "succeeded":
      return "bg-success/15 text-success";
    case "failed":
      return "bg-destructive/15 text-destructive";
    case "cancelled":
      return "bg-warning/15 text-warning";
    default:
      return "bg-surface-hover text-text-muted";
  }
}

function formatTimestamp(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function RolloutProgressBar({ rollout }: { rollout: MaterializationRolloutView }) {
  const total = Math.max(rollout.totalItems, 1);
  const okPct = (rollout.succeededCount / total) * 100;
  const degPct = (rollout.degradedCount / total) * 100;
  const failPct = (rollout.failedCount / total) * 100;
  const skipPct = (rollout.skippedCount / total) * 100;

  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full bg-success transition-[width]"
          style={{ width: `${okPct}%` }}
          title={`Succeeded: ${rollout.succeededCount}`}
        />
        <div
          className="h-full bg-warning transition-[width]"
          style={{ width: `${degPct}%` }}
          title={`Degraded: ${rollout.degradedCount}`}
        />
        <div
          className="h-full bg-destructive transition-[width]"
          style={{ width: `${failPct}%` }}
          title={`Failed: ${rollout.failedCount}`}
        />
        <div
          className="h-full bg-surface-hover/80 transition-[width]"
          style={{ width: `${skipPct}%` }}
          title={`Skipped: ${rollout.skippedCount}`}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
        <span className="text-success">{rollout.succeededCount} succeeded</span>
        {rollout.degradedCount > 0 && (
          <span className="text-warning">{rollout.degradedCount} degraded</span>
        )}
        {rollout.failedCount > 0 && (
          <span className="text-destructive">{rollout.failedCount} failed</span>
        )}
        {rollout.skippedCount > 0 && (
          <span className="text-text-subtle">{rollout.skippedCount} skipped</span>
        )}
        <span className="text-text-subtle">
          {rollout.pendingCount} pending, {rollout.runningCount} running
        </span>
      </div>
    </div>
  );
}

export default function AdminRolloutsPage() {
  const { getToken } = useAuth();
  const [rollouts, setRollouts] = useState<MaterializationRolloutView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const token = await getToken();
      if (!token) {
        setListError("Missing session.");
        setLoading(false);
        return;
      }
      if (opts?.quiet) setRefreshing(true);
      else setLoading(true);
      setListError(null);
      try {
        setRollouts(await getAdminPlatformRollouts(token));
      } catch (e) {
        setListError(e instanceof Error ? e.message : "Could not load rollouts.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getToken]
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && rollouts.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-border bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 shrink-0 text-accent" />
          <h1 className="text-lg font-bold text-text">Rollouts</h1>
          {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />}
        </div>
        <button
          type="button"
          onClick={() => void load({ quiet: true })}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {listError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {listError}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-raised px-3 py-3 text-xs text-text-muted">
        <code>Force reapply all</code> now queues a controlled <code>manual_reapply</code> rollout
        from <code>Admin &gt; Plans</code>. This page is now read-only and shows rollout execution
        state only.
      </div>

      {rollouts.length === 0 ? (
        <p className="text-sm text-text-muted">No materialization rollouts yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rollouts.map((rollout) => (
            <div
              key={rollout.id}
              className="rounded-lg border border-border bg-surface-raised p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium text-text">{rollout.id}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                        statusBadgeClass(rollout.status)
                      )}
                    >
                      {rollout.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {rollout.rolloutType.replace(/_/g, " ")} · generation{" "}
                      {rollout.targetGeneration}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-subtle">
                    Created {formatTimestamp(rollout.createdAt)} · Updated{" "}
                    {formatTimestamp(rollout.updatedAt)}
                    {rollout.startedAt && ` · Started ${formatTimestamp(rollout.startedAt)}`}
                    {rollout.finishedAt && ` · Finished ${formatTimestamp(rollout.finishedAt)}`}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-bg px-2 py-1 text-[10px] text-text-muted">
                  {rollout.totalItems} item{rollout.totalItems === 1 ? "" : "s"}
                </div>
              </div>

              <div className="mt-2">
                <RolloutProgressBar rollout={rollout} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
