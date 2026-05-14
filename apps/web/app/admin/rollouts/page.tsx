"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Layers, Loader2, RefreshCw } from "lucide-react";
import {
  getAdminPlatformRolloutFailedItems,
  getAdminPlatformRollouts,
  postAdminPlatformRolloutCancelPending,
  postAdminPlatformRolloutRetryFailed,
  postAdminForceReapplyAll,
  type ForceReapplyAllSummary,
  type MaterializationRolloutItemView,
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
  const cancelledPct = (rollout.cancelledCount / total) * 100;

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
        <div
          className="h-full bg-warning/60 transition-[width]"
          style={{ width: `${cancelledPct}%` }}
          title={`Cancelled: ${rollout.cancelledCount}`}
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
        {rollout.cancelledCount > 0 && (
          <span className="text-warning">{rollout.cancelledCount} cancelled</span>
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
  const [reapplying, setReapplying] = useState(false);
  const [reapplyError, setReapplyError] = useState<string | null>(null);
  const [reapplySummary, setReapplySummary] = useState<ForceReapplyAllSummary | null>(null);
  const [expandedRolloutId, setExpandedRolloutId] = useState<string | null>(null);
  const [failedItemsByRolloutId, setFailedItemsByRolloutId] = useState<
    Record<string, MaterializationRolloutItemView[]>
  >({});
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [detailsErrorByRolloutId, setDetailsErrorByRolloutId] = useState<
    Record<string, string | null>
  >({});
  const [actionLoading, setActionLoading] = useState<Record<string, "retry" | "cancel" | null>>({});

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

  const loadFailedItems = useCallback(
    async (rolloutId: string) => {
      const token = await getToken();
      if (!token) {
        setDetailsErrorByRolloutId((current) => ({ ...current, [rolloutId]: "Missing session." }));
        return;
      }
      setDetailsLoadingId(rolloutId);
      setDetailsErrorByRolloutId((current) => ({ ...current, [rolloutId]: null }));
      try {
        const response = await getAdminPlatformRolloutFailedItems(token, rolloutId);
        setFailedItemsByRolloutId((current) => ({ ...current, [rolloutId]: response.items }));
      } catch (error) {
        setDetailsErrorByRolloutId((current) => ({
          ...current,
          [rolloutId]: error instanceof Error ? error.message : "Could not load failed items."
        }));
      } finally {
        setDetailsLoadingId((current) => (current === rolloutId ? null : current));
      }
    },
    [getToken]
  );

  const handleToggleFailedItems = useCallback(
    async (rollout: MaterializationRolloutView) => {
      if (expandedRolloutId === rollout.id) {
        setExpandedRolloutId(null);
        return;
      }
      setExpandedRolloutId(rollout.id);
      if (rollout.failedCount > 0 && failedItemsByRolloutId[rollout.id] === undefined) {
        await loadFailedItems(rollout.id);
      }
    },
    [expandedRolloutId, failedItemsByRolloutId, loadFailedItems]
  );

  const handleRetryFailed = useCallback(
    async (rolloutId: string) => {
      const token = await getToken();
      if (!token) {
        setDetailsErrorByRolloutId((current) => ({ ...current, [rolloutId]: "Missing session." }));
        return;
      }
      setActionLoading((current) => ({ ...current, [rolloutId]: "retry" }));
      setDetailsErrorByRolloutId((current) => ({ ...current, [rolloutId]: null }));
      try {
        await postAdminPlatformRolloutRetryFailed(token, rolloutId);
        await Promise.all([load({ quiet: true }), loadFailedItems(rolloutId)]);
      } catch (error) {
        setDetailsErrorByRolloutId((current) => ({
          ...current,
          [rolloutId]: error instanceof Error ? error.message : "Could not retry failed items."
        }));
      } finally {
        setActionLoading((current) => ({ ...current, [rolloutId]: null }));
      }
    },
    [getToken, load, loadFailedItems]
  );

  const handleCancelPending = useCallback(
    async (rolloutId: string) => {
      const token = await getToken();
      if (!token) {
        setDetailsErrorByRolloutId((current) => ({ ...current, [rolloutId]: "Missing session." }));
        return;
      }
      setActionLoading((current) => ({ ...current, [rolloutId]: "cancel" }));
      setDetailsErrorByRolloutId((current) => ({ ...current, [rolloutId]: null }));
      try {
        await postAdminPlatformRolloutCancelPending(token, rolloutId);
        await Promise.all([load({ quiet: true }), loadFailedItems(rolloutId)]);
      } catch (error) {
        setDetailsErrorByRolloutId((current) => ({
          ...current,
          [rolloutId]: error instanceof Error ? error.message : "Could not cancel pending items."
        }));
      } finally {
        setActionLoading((current) => ({ ...current, [rolloutId]: null }));
      }
    },
    [getToken, load, loadFailedItems]
  );

  const handleForceReapplyAll = useCallback(async () => {
    if (
      !window.confirm(
        "This will queue a controlled materialization rollout for all published assistants. Continue?"
      )
    ) {
      return;
    }
    const token = await getToken();
    if (!token) {
      setReapplyError("Missing session.");
      return;
    }
    setReapplying(true);
    setReapplyError(null);
    setReapplySummary(null);
    try {
      const summary = await postAdminForceReapplyAll(token);
      setReapplySummary(summary);
      await load({ quiet: true });
    } catch (error) {
      setReapplyError(error instanceof Error ? error.message : "Failed to queue rollout.");
    } finally {
      setReapplying(false);
    }
  }, [getToken, load]);

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

      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-text">Force reapply all</p>
            <p className="text-xs text-text-muted">
              Queue a controlled <code>manual_reapply</code> rollout for all published assistants.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleForceReapplyAll()}
            disabled={reapplying}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
          >
            {reapplying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Force reapply all
          </button>
        </div>
        {reapplyError && <p className="mt-2 text-xs text-destructive">{reapplyError}</p>}
        {reapplySummary && (
          <p className="mt-2 text-xs text-text-muted">
            Queued rollout <span className="font-mono text-text">{reapplySummary.rolloutId}</span>{" "}
            at generation {reapplySummary.targetGeneration}. {reapplySummary.totalItems} item
            {reapplySummary.totalItems === 1 ? "" : "s"}, {reapplySummary.pendingCount} pending.
          </p>
        )}
      </div>

      {rollouts.length === 0 ? (
        <p className="text-sm text-text-muted">No materialization rollouts yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rollouts.map((rollout) =>
            (() => {
              const failedItems = failedItemsByRolloutId[rollout.id] ?? [];
              return (
                <div
                  key={rollout.id}
                  className="rounded-lg border border-border bg-surface-raised p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-medium text-text">
                          {rollout.id}
                        </span>
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    {rollout.failedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleToggleFailedItems(rollout)}
                        className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/15"
                      >
                        {expandedRolloutId === rollout.id
                          ? "Hide failed items"
                          : "Show failed items"}
                      </button>
                    )}
                    {rollout.failedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleRetryFailed(rollout.id)}
                        disabled={
                          actionLoading[rollout.id] !== undefined &&
                          actionLoading[rollout.id] !== null
                        }
                        className="rounded-md border border-border bg-bg px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-surface-hover disabled:opacity-50"
                      >
                        {actionLoading[rollout.id] === "retry" ? "Retrying..." : "Retry failed"}
                      </button>
                    )}
                    {rollout.pendingCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleCancelPending(rollout.id)}
                        disabled={
                          actionLoading[rollout.id] !== undefined &&
                          actionLoading[rollout.id] !== null
                        }
                        className="rounded-md border border-border bg-bg px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-surface-hover disabled:opacity-50"
                      >
                        {actionLoading[rollout.id] === "cancel"
                          ? "Cancelling..."
                          : "Cancel pending"}
                      </button>
                    )}
                  </div>
                  {detailsErrorByRolloutId[rollout.id] && (
                    <p className="mt-2 text-[10px] text-destructive">
                      {detailsErrorByRolloutId[rollout.id]}
                    </p>
                  )}
                  {expandedRolloutId === rollout.id && rollout.failedCount > 0 && (
                    <div className="mt-3 rounded-lg border border-border bg-bg p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-text">Failed items</p>
                        {detailsLoadingId === rollout.id && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
                        )}
                      </div>
                      {failedItems.length ? (
                        <div className="space-y-2">
                          {failedItems.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-md border border-border bg-surface px-2.5 py-2"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                                <span className="font-mono text-text">{item.id}</span>
                                <span className="text-text-muted">
                                  assistant {item.assistantId}
                                </span>
                                <span className="text-text-subtle">
                                  attempts {item.attempts} · generation {item.targetGeneration}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] text-destructive">
                                {item.lastErrorCode ?? "failed"}:{" "}
                                {item.lastErrorMessage ?? "Unknown error."}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : detailsLoadingId === rollout.id ? null : (
                        <p className="text-[10px] text-text-muted">No failed items found.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
