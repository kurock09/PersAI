"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Loader2, RefreshCw } from "lucide-react";
import type { DeliveryIntentView, ListNotificationDeliveriesParams } from "@persai/contracts";
import { listNotificationDeliveries } from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type Props = {
  getToken: () => Promise<string | null>;
};

const STATUS_COLORS: Record<string, string> = {
  delivered: "text-success",
  failed: "text-destructive",
  dead_letter: "text-destructive",
  pending: "text-text-muted",
  claimed: "text-warning",
  skipped: "text-text-muted",
  deferred_quiet_hours: "text-text-muted",
  deferred_rate_limit: "text-text-muted"
};

const SOURCE_OPTIONS = [
  "idle_reengagement",
  "quota_advisory",
  "reminder",
  "background_task_push",
  "billing_lifecycle",
  "admin_system",
  "system_event"
] as const;

const CLASS_OPTIONS = ["conversational", "transactional", "operational", "administrative"] as const;

const STATUS_OPTIONS = [
  "pending",
  "claimed",
  "delivered",
  "failed",
  "dead_letter",
  "skipped",
  "deferred_quiet_hours",
  "deferred_rate_limit"
] as const;

const CHANNEL_OPTIONS = [
  "telegram_thread",
  "web_thread",
  "web_notification_center",
  "email",
  "admin_webhook",
  "web_push",
  "mobile_push"
] as const;

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

export function DeliveryHistorySection({ getToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DeliveryIntentView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [filters, setFilters] = useState<{
    source: string;
    class: string;
    status: string;
    channel: string;
    dateFrom: string;
    dateTo: string;
  }>({ source: "", class: "", status: "", channel: "", dateFrom: "", dateTo: "" });

  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedFilters(filters), 450);
    return () => clearTimeout(id);
  }, [filters]);

  const load = useCallback(
    async (p: number) => {
      const token = await getToken();
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const params: ListNotificationDeliveriesParams = { page: p, pageSize };
        if (debouncedFilters.source) params.source = debouncedFilters.source;
        if (debouncedFilters.class) params.class = debouncedFilters.class;
        if (debouncedFilters.status) params.status = debouncedFilters.status;
        if (debouncedFilters.channel) params.channel = debouncedFilters.channel;
        if (debouncedFilters.dateFrom) params.dateFrom = debouncedFilters.dateFrom;
        if (debouncedFilters.dateTo) params.dateTo = debouncedFilters.dateTo;
        const result = await listNotificationDeliveries(token, params);
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load delivery history.");
      } finally {
        setLoading(false);
      }
    },
    [getToken, debouncedFilters, pageSize]
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  // Auto-refresh: re-poll every 30s, but only when the tab is visible.
  // Operators frequently keep this tab open while triggering test sends or
  // waiting for a real notification — without polling they had to manually
  // hit Filter to see the new row.
  useEffect(() => {
    const POLL_MS = 30_000;
    let timerId: ReturnType<typeof setInterval> | null = null;

    const start = (): void => {
      if (timerId !== null) return;
      timerId = setInterval(() => {
        if (document.visibilityState === "visible") {
          void load(page);
        }
      }, POLL_MS);
    };
    const stop = (): void => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    if (document.visibilityState === "visible") start();

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        void load(page);
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          aria-label="Source"
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={filters.class}
          onChange={(e) => setFilters((f) => ({ ...f, class: e.target.value }))}
          aria-label="Class"
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All classes</option>
          {CLASS_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          aria-label="Status"
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={filters.channel}
          onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}
          aria-label="Channel"
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All channels</option>
          {CHANNEL_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={filters.dateFrom}
          onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          aria-label="Date from"
          title="Date from"
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="datetime-local"
          value={filters.dateTo}
          onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          aria-label="Date to"
          title="Date to"
          className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() =>
            setFilters({
              source: "",
              class: "",
              status: "",
              channel: "",
              dateFrom: "",
              dateTo: ""
            })
          }
          className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-text-muted hover:text-text"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => void load(1)}
          className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:opacity-90"
        >
          Filter
        </button>
        <button
          type="button"
          onClick={() => void load(page)}
          title="Refresh"
          aria-label="Refresh"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-medium text-text-muted hover:text-text"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
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
          No deliveries found.
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-xs" aria-label="Delivery history">
            <thead className="bg-surface-raised">
              <tr>
                {[
                  "Source",
                  "Class",
                  "Status",
                  "Channel(s)",
                  "Attempts",
                  "Created",
                  "Intent ID",
                  "Dedupe key",
                  "Trace ID"
                ].map((h) => (
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
                <React.Fragment key={item.id}>
                  <tr
                    className="cursor-pointer hover:bg-surface-raised"
                    onClick={() => setExpanded((v) => (v === item.id ? null : item.id))}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-text">{item.source}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-muted">{item.class}</td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2 font-medium",
                        STATUS_COLORS[item.lifecycleStatus] ?? "text-text"
                      )}
                    >
                      {item.lifecycleStatus}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {item.attempts.length > 0
                        ? [...new Set(item.attempts.map((a) => a.channel))].join(", ")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-center text-text-muted">
                      {item.attempts.length}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1">
                        <span className="font-mono text-[9px] text-text-muted">
                          {item.id.slice(0, 8)}…
                        </span>
                        <CopyButton value={item.id} />
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {item.dedupeKey ? (
                        <span className="flex items-center gap-1">
                          <span className="font-mono text-[9px] text-text-muted">
                            {item.dedupeKey.slice(0, 12)}…
                          </span>
                          <CopyButton value={item.dedupeKey} />
                        </span>
                      ) : (
                        <span className="text-[9px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {item.traceId ? (
                        <span className="flex items-center gap-1">
                          <span className="font-mono text-[9px] text-text-muted">
                            {item.traceId.slice(0, 8)}…
                          </span>
                          <CopyButton value={item.traceId} />
                        </span>
                      ) : (
                        <span className="text-[9px] text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                  {expanded === item.id && (
                    <tr key={`${item.id}-detail`}>
                      <td colSpan={9} className="bg-surface px-4 py-3">
                        {" "}
                        <p className="mb-1 text-[10px] font-semibold text-text-muted">
                          Delivery attempts
                        </p>
                        {item.attempts.length === 0 ? (
                          <p className="text-[10px] text-text-muted">No attempts yet.</p>
                        ) : (
                          <table
                            className="w-full text-[10px]"
                            aria-label="Delivery attempt detail"
                          >
                            <thead>
                              <tr className="text-left text-[9px] text-text-muted">
                                <th className="pr-3 py-1">#</th>
                                <th className="pr-3 py-1">Channel</th>
                                <th className="pr-3 py-1">Status</th>
                                <th className="pr-3 py-1">Provider ref</th>
                                <th className="pr-3 py-1">Started</th>
                                <th className="pr-3 py-1">Completed</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {item.attempts.map((a) => (
                                <tr key={a.id}>
                                  <td className="pr-3 py-1">{a.attemptNumber}</td>
                                  <td className="pr-3 py-1">{a.channel}</td>
                                  <td
                                    className={cn(
                                      "pr-3 py-1 font-medium",
                                      a.status === "delivered"
                                        ? "text-success"
                                        : a.status === "failed" || a.status === "bounced"
                                          ? "text-destructive"
                                          : "text-text-muted"
                                    )}
                                  >
                                    {a.status}
                                  </td>
                                  <td className="pr-3 py-1 font-mono text-[9px] text-text-muted">
                                    {a.providerRef ?? "—"}
                                  </td>
                                  <td className="pr-3 py-1 text-text-muted">
                                    {new Date(a.startedAt).toLocaleString()}
                                  </td>
                                  <td className="pr-3 py-1 text-text-muted">
                                    {a.completedAt ? new Date(a.completedAt).toLocaleString() : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
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
