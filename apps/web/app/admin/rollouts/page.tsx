"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChevronUp, Layers, Loader2, Plus, RotateCcw } from "lucide-react";
import type {
  PlatformRolloutPatch,
  PlatformRolloutState,
  PostAdminPlatformRolloutRequest
} from "@persai/contracts";
import { PlatformRolloutStatus } from "@persai/contracts";
import {
  getAdminPlatformRollouts,
  postAdminPlatformRollout,
  postAdminPlatformRolloutRollback
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

function statusBadgeClass(status: PlatformRolloutState["status"]): string {
  switch (status) {
    case PlatformRolloutStatus.in_progress:
      return "bg-accent/15 text-accent";
    case PlatformRolloutStatus.applied:
      return "bg-success/15 text-success";
    case PlatformRolloutStatus.rolled_back:
      return "bg-surface-hover text-text-muted";
    case PlatformRolloutStatus.failed:
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-surface-hover text-text-muted";
  }
}

function canRollbackRollout(r: PlatformRolloutState): boolean {
  if (r.rolledBackAt) return false;
  return (
    r.status === PlatformRolloutStatus.in_progress || r.status === PlatformRolloutStatus.applied
  );
}

function RolloutProgressBar({ r }: { r: PlatformRolloutState }) {
  const ok = r.applySucceededCount;
  const deg = r.applyDegradedCount;
  const fail = r.applyFailedCount;
  const total = Math.max(ok + deg + fail, 1);
  const okPct = (ok / total) * 100;
  const degPct = (deg / total) * 100;
  const failPct = (fail / total) * 100;

  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full bg-success transition-[width]"
          style={{ width: `${okPct}%` }}
          title={`Succeeded: ${ok}`}
        />
        <div
          className="h-full bg-warning transition-[width]"
          style={{ width: `${degPct}%` }}
          title={`Degraded: ${deg}`}
        />
        <div
          className="h-full bg-destructive transition-[width]"
          style={{ width: `${failPct}%` }}
          title={`Failed: ${fail}`}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
        <span className="text-success">{ok} succeeded</span>
        {deg > 0 && <span className="text-warning">{deg} degraded</span>}
        {fail > 0 && <span className="text-destructive">{fail} failed</span>}
        <span className="text-text-subtle">
          {r.targetedAssistants}/{r.totalAssistants} targeted
        </span>
      </div>
    </div>
  );
}

export default function AdminRolloutsPage() {
  const { getToken } = useAuth();
  const [rollouts, setRollouts] = useState<PlatformRolloutState[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"ok" | "err">("ok");

  const [createOpen, setCreateOpen] = useState(false);
  const [rolloutPercent, setRolloutPercent] = useState(10);
  const [targetPatchJson, setTargetPatchJson] = useState("{}");
  const [creating, setCreating] = useState(false);

  const [rollbackingId, setRollbackingId] = useState<string | null>(null);

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

  async function onCreateSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const token = await getToken();
    if (!token) {
      setFeedbackTone("err");
      setFeedback("Missing session.");
      return;
    }
    const pct = Math.round(rolloutPercent);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      setFeedbackTone("err");
      setFeedback("Rollout percent must be between 1 and 100.");
      return;
    }
    let patchObject: Record<string, unknown>;
    try {
      const parsed = JSON.parse(targetPatchJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setFeedbackTone("err");
        setFeedback("Target patch must be a JSON object.");
        return;
      }
      patchObject = parsed as Record<string, unknown>;
    } catch {
      setFeedbackTone("err");
      setFeedback("Target patch JSON is invalid.");
      return;
    }
    const input: PostAdminPlatformRolloutRequest = {
      rolloutPercent: pct,
      targetPatch: patchObject as PlatformRolloutPatch
    };
    setCreating(true);
    setFeedback(null);
    try {
      await postAdminPlatformRollout(token, input);
      setFeedbackTone("ok");
      setFeedback("Rollout created.");
      setCreateOpen(false);
      setTargetPatchJson("{}");
      await load({ quiet: true });
    } catch (err) {
      setFeedbackTone("err");
      setFeedback(err instanceof Error ? err.message : "Could not create rollout.");
    } finally {
      setCreating(false);
    }
  }

  async function onRollback(rolloutId: string): Promise<void> {
    if (
      !confirm(
        "Rollback this rollout? This will revert the platform patch for affected assistants."
      )
    ) {
      return;
    }
    const token = await getToken();
    if (!token) {
      setFeedbackTone("err");
      setFeedback("Missing session.");
      return;
    }
    setRollbackingId(rolloutId);
    setFeedback(null);
    try {
      await postAdminPlatformRolloutRollback(token, rolloutId);
      setFeedbackTone("ok");
      setFeedback("Rollback completed.");
      await load({ quiet: true });
    } catch (err) {
      setFeedbackTone("err");
      setFeedback(err instanceof Error ? err.message : "Could not rollback.");
    } finally {
      setRollbackingId(null);
    }
  }

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
          onClick={() => {
            setCreateOpen((o) => !o);
            setFeedback(null);
          }}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
            createOpen
              ? "border-border bg-surface-raised text-text"
              : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15"
          )}
        >
          {createOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          New rollout
        </button>
      </div>

      {listError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {listError}
        </div>
      )}

      {feedback && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            feedbackTone === "ok"
              ? "border-success/40 bg-success/10 text-success"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}
        >
          {feedback}
        </div>
      )}

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          createOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <form
            onSubmit={(e) => void onCreateSubmit(e)}
            className="mb-1 space-y-3 rounded-lg border border-border bg-surface-raised p-3"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[140px] flex-1 space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Rollout %
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={rolloutPercent}
                    onChange={(ev) => setRolloutPercent(Number(ev.target.value))}
                    className="h-1.5 flex-1 cursor-pointer accent-accent"
                  />
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={rolloutPercent}
                    onChange={(ev) => {
                      const v = Number(ev.target.value);
                      if (Number.isFinite(v)) setRolloutPercent(Math.min(100, Math.max(1, v)));
                    }}
                    className="w-14 rounded border border-border bg-bg px-2 py-1 text-xs text-text"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Target patch (JSON)
              </label>
              <textarea
                value={targetPatchJson}
                onChange={(ev) => setTargetPatchJson(ev.target.value)}
                rows={6}
                spellCheck={false}
                className="w-full resize-y rounded border border-border bg-bg px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text placeholder:text-text-subtle"
                placeholder="{}"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={creating}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create rollout
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setFeedback(null);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      {rollouts.length === 0 ? (
        <p className="text-sm text-text-muted">No rollouts yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rollouts.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-border bg-surface-raised p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium text-text">{r.id}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                        statusBadgeClass(r.status)
                      )}
                    >
                      {r.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-text-muted">{r.rolloutPercent}% rollout</span>
                  </div>
                  <p className="text-[10px] text-text-subtle">
                    Created {new Date(r.createdAt).toLocaleString()} · Updated{" "}
                    {new Date(r.updatedAt).toLocaleString()}
                    {r.rolledBackAt &&
                      ` · Rolled back ${new Date(r.rolledBackAt).toLocaleString()}`}
                  </p>
                </div>
                {canRollbackRollout(r) && (
                  <button
                    type="button"
                    disabled={rollbackingId === r.id}
                    onClick={() => void onRollback(r.id)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-text-muted hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                  >
                    {rollbackingId === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Rollback
                  </button>
                )}
              </div>

              <div className="mt-2">
                <RolloutProgressBar r={r} />
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] font-medium text-text-muted hover:text-text">
                  Target patch
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded border border-border bg-bg p-2 text-[10px] text-text-subtle">
                  {JSON.stringify(r.targetPatch, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
