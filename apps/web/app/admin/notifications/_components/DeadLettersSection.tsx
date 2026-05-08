"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type {
  NotificationDeadLetterView,
  ListNotificationDeadLettersParams
} from "@persai/contracts";
import {
  listNotificationDeadLetters,
  replayNotificationDeadLetter,
  discardNotificationDeadLetter
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type Props = {
  getToken: () => Promise<string | null>;
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy(): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className="inline-flex h-4 w-4 items-center justify-center rounded text-text-muted hover:text-text"
      aria-label="Copy value"
    >
      {copied ? (
        <span className="text-[8px] text-success font-semibold">✓</span>
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

type ConfirmDialogProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-80 rounded-xl border border-border bg-surface-raised p-5 shadow-xl">
        <p className="mb-4 text-sm text-text">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

type RowAction = { type: "replay"; id: string; intentId: string } | { type: "discard"; id: string };

export function DeadLettersSection({ getToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationDeadLetterView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [pendingAction, setPendingAction] = useState<RowAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [filters, setFilters] = useState<{ source: string; status: string }>({
    source: "",
    status: ""
  });

  const load = useCallback(
    async (p: number) => {
      const token = await getToken();
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const params: ListNotificationDeadLettersParams = { page: p, pageSize };
        if (filters.source) params.source = filters.source;
        const result = await listNotificationDeadLetters(token, params);
        setItems(result.deadLetters);
        setTotal(result.total);
        setPage(result.page);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load dead letters.");
      } finally {
        setLoading(false);
      }
    },
    [getToken, filters, pageSize]
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  async function executeAction(): Promise<void> {
    if (!pendingAction) return;
    const token = await getToken();
    if (!token) return;
    setActionLoading(true);
    try {
      if (pendingAction.type === "replay") {
        await replayNotificationDeadLetter(token, pendingAction.id);
      } else {
        await discardNotificationDeadLetter(token, pendingAction.id);
      }
      setPendingAction(null);
      await load(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
      setPendingAction(null);
    } finally {
      setActionLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction.type === "replay"
              ? `Re-attempt delivery for intent ${pendingAction.intentId.slice(0, 8)}…?`
              : `Discard this dead letter? It will be marked resolved without sending.`
          }
          onConfirm={() => void executeAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={filters.source}
          placeholder="Source filter"
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() => void load(1)}
          className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:opacity-90"
        >
          Filter
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-muted">
          No active dead letters. All notifications are delivering successfully.
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-xs" aria-label="Dead letters">
            <thead className="bg-surface-raised">
              <tr>
                {["Source", "Class", "Escalations", "Created", "Intent ID", "Actions"].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-surface-raised">
                  <td className="whitespace-nowrap px-3 py-2 text-text">{item.source}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-muted">{item.class}</td>
                  <td className="px-3 py-2 text-center text-text-muted">
                    {item.escalationAttempts}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1">
                      <span className="font-mono text-[9px] text-text-muted">
                        {item.intentId.slice(0, 8)}…
                      </span>
                      <CopyButton value={item.intentId} />
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAction({ type: "replay", id: item.id, intentId: item.intentId })
                        }
                        disabled={actionLoading}
                        title="Replay — re-attempt delivery"
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium",
                          "border border-border text-text-muted hover:border-accent/40 hover:text-accent",
                          "disabled:cursor-not-allowed disabled:opacity-40"
                        )}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Replay
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction({ type: "discard", id: item.id })}
                        disabled={actionLoading}
                        title="Discard — mark resolved without sending"
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium",
                          "border border-border text-text-muted hover:border-destructive/40 hover:text-destructive",
                          "disabled:cursor-not-allowed disabled:opacity-40"
                        )}
                      >
                        <Trash2 className="h-3 w-3" />
                        Discard
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            {total} total · page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load(page - 1)}
              disabled={page <= 1}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-border disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void load(page + 1)}
              disabled={page >= totalPages}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-border disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
