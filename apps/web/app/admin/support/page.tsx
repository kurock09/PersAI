"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2, MessageCircle, RefreshCw } from "lucide-react";
import {
  getAdminSupportTicket,
  getAdminSupportTickets,
  postAdminSupportTicketClose,
  postAdminSupportTicketPending,
  postAdminSupportTicketReply,
  type SupportTicketDetail,
  type SupportTicketSummary
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";
import {
  getAdminSupportAttachmentUrl,
  type SupportTicketMessage
} from "@/app/app/assistant-api-client";
import { SupportAttachmentThumbs } from "@/app/app/_components/support-attachment-thumbs";

const ADMIN_SYSTEM_PENDING = "[[code:pending]]";

function formatAdminMessageBody(message: SupportTicketMessage): string {
  if (message.author === "system" && message.body.trim() === ADMIN_SYSTEM_PENDING) {
    return "Request received. We will reply soon.";
  }
  return message.body.trim();
}

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "answered", label: "Answered" },
  { value: "closed", label: "Closed" }
] as const;

function statusBadge(status: SupportTicketSummary["status"]) {
  const styles: Record<SupportTicketSummary["status"], string> = {
    open: "bg-amber-500/15 text-amber-200",
    pending: "bg-sky-500/15 text-sky-200",
    answered: "bg-emerald-500/15 text-emerald-200",
    closed: "bg-text-subtle/20 text-text-subtle"
  };
  return styles[status];
}

export default function AdminSupportPage() {
  const { getToken } = useAuth();
  const [statusFilter, setStatusFilter] = useState("");
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reloadList = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const params: { status?: string; limit?: number } = { limit: 100 };
    if (statusFilter) {
      params.status = statusFilter;
    }
    const rows = await getAdminSupportTickets(token, params);
    setTickets(rows);
  }, [getToken, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await reloadList();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load tickets.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setDetailLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const ticket = await getAdminSupportTicket(token, selectedId);
        if (!cancelled) setDetail(ticket);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load ticket.");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, selectedId]);

  async function runAction(action: () => Promise<SupportTicketDetail>, successMessage: string) {
    setActing(true);
    setError(null);
    setSuccess(null);
    try {
      const ticket = await action();
      setDetail(ticket);
      setSelectedId(ticket.id);
      setReplyBody("");
      await reloadList();
      setSuccess(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-accent" />
          <div>
            <h1 className="text-lg font-semibold text-text">Support</h1>
            <p className="text-xs text-text-subtle">
              User tickets, replies, and delivery via email + push.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reloadList()}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => {
              setStatusFilter(filter.value);
              setSelectedId(null);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              statusFilter === filter.value
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-text-muted hover:bg-surface-hover"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {(error || success) && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            error
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-accent/30 bg-accent/10 text-accent"
          )}
        >
          {error ?? success}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface">
          {loading ? (
            <div className="flex items-center gap-2 p-4 text-xs text-text-subtle">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tickets…
            </div>
          ) : tickets.length === 0 ? (
            <p className="p-4 text-xs text-text-subtle">No tickets in this filter.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(ticket.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-surface-hover",
                      selectedId === ticket.id && "bg-accent/5"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-text">#{ticket.shortId}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                          statusBadge(ticket.status)
                        )}
                      >
                        {ticket.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-text-muted">
                      {ticket.userEmail ?? "unknown user"} · {ticket.preview}
                    </p>
                    <p className="mt-1 text-[10px] text-text-subtle">
                      {new Date(ticket.updatedAt).toLocaleString()}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-4">
          {!selectedId ? (
            <p className="text-xs text-text-subtle">
              Select a ticket to view the thread and reply.
            </p>
          ) : detailLoading || !detail ? (
            <div className="flex items-center gap-2 text-xs text-text-subtle">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading ticket…
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-text">
                  #{detail.shortId}
                  {detail.subject ? ` · ${detail.subject}` : ""}
                </h2>
                <p className="mt-1 text-xs text-text-subtle">
                  {detail.userEmail}
                  {detail.assistantDisplayName ? ` · ${detail.assistantDisplayName}` : ""}
                </p>
              </div>

              <ul className="space-y-2">
                {detail.messages.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      message.author === "admin"
                        ? "border-accent/30 bg-accent/5"
                        : "border-border bg-surface-raised/40"
                    )}
                  >
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                      {message.author}
                      {message.adminDisplayName ? ` · ${message.adminDisplayName}` : ""} ·{" "}
                      {new Date(message.createdAt).toLocaleString()}
                    </p>
                    <p className="whitespace-pre-wrap text-text">
                      {formatAdminMessageBody(message)}
                    </p>
                    <SupportAttachmentThumbs
                      attachments={message.attachments}
                      resolveUrl={getAdminSupportAttachmentUrl}
                    />
                  </li>
                ))}
              </ul>

              {detail.status !== "closed" && (
                <div className="space-y-3 border-t border-border pt-4">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={5}
                    placeholder="Reply to the user (email + preferred notification channel)"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-text"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={acting || replyBody.trim().length < 3}
                      onClick={() => {
                        const tokenPromise = getToken();
                        void runAction(async () => {
                          const token = await tokenPromise;
                          if (!token) throw new Error("Sign in required.");
                          return postAdminSupportTicketReply(token, detail.id, replyBody.trim());
                        }, "Reply sent. User will get email and push.");
                      }}
                      className="rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-xs font-medium text-accent disabled:opacity-50"
                    >
                      Send reply
                    </button>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => {
                        const tokenPromise = getToken();
                        void runAction(async () => {
                          const token = await tokenPromise;
                          if (!token) throw new Error("Sign in required.");
                          return postAdminSupportTicketPending(token, detail.id);
                        }, "Marked as pending.");
                      }}
                      className="rounded-full border border-border px-4 py-2 text-xs text-text-muted hover:bg-surface-hover disabled:opacity-50"
                    >
                      Reply later
                    </button>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => {
                        const tokenPromise = getToken();
                        void runAction(async () => {
                          const token = await tokenPromise;
                          if (!token) throw new Error("Sign in required.");
                          return postAdminSupportTicketClose(token, detail.id);
                        }, "Ticket closed.");
                      }}
                      className="rounded-full border border-border px-4 py-2 text-xs text-text-muted hover:bg-surface-hover disabled:opacity-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
