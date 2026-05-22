"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, MessageCircle, Paperclip, X } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  getAssistantSupportTicket,
  getAssistantSupportTickets,
  postAssistantSupportTicket,
  postAssistantSupportTicketRead,
  type SupportTicketDetail,
  type SupportTicketMessage,
  type SupportTicketSummary
} from "../assistant-api-client";
import { SupportAttachmentLinks } from "./support-attachment-links";

/** Must match API `SUPPORT_SYSTEM_MESSAGE_CODE_PENDING`. */
const SYSTEM_PENDING_CODE = "[[code:pending]]";
const POLL_MS = 20_000;

type ActionFeedback = { kind: "error" | "success"; message: string } | null;

function mergeTicketList(
  previous: SupportTicketSummary[],
  incoming: SupportTicketSummary[]
): SupportTicketSummary[] {
  const byId = new Map(previous.map((ticket) => [ticket.id, ticket]));
  return incoming.map((ticket) => {
    const existing = byId.get(ticket.id);
    if (!existing) return ticket;
    if (existing.updatedAt === ticket.updatedAt && existing.hasUnread === ticket.hasUnread) {
      return existing;
    }
    return ticket;
  });
}

export function AssistantSupportSection({
  assistantId,
  className,
  onActivityChange
}: {
  assistantId: string;
  className?: string;
  onActivityChange?: (activity: { unreadCount: number }) => void;
}) {
  const t = useTranslations("settings");
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [ticketDetails, setTicketDetails] = useState<Record<string, SupportTicketDetail>>({});
  const [ticketLoadErrors, setTicketLoadErrors] = useState<Record<string, string>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [newFormExpanded, setNewFormExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [fb, setFb] = useState<ActionFeedback>(null);

  const unreadCount = useMemo(() => tickets.filter((ticket) => ticket.hasUnread).length, [tickets]);

  useEffect(() => {
    onActivityChange?.({ unreadCount });
  }, [onActivityChange, unreadCount]);

  useEffect(() => {
    if (tickets.length === 0) {
      setNewFormExpanded(true);
    }
  }, [tickets.length]);

  const statusLabel = useCallback(
    (status: SupportTicketSummary["status"]) => {
      switch (status) {
        case "open":
          return t("supportStatusOpen");
        case "pending":
          return t("supportStatusPending");
        case "answered":
          return t("supportStatusAnswered");
        case "closed":
          return t("supportStatusClosed");
        default:
          return status;
      }
    },
    [t]
  );

  const formatMessageBody = useCallback(
    (message: SupportTicketMessage) => {
      if (message.author === "system" && message.body.trim() === SYSTEM_PENDING_CODE) {
        return t("supportSystemPending");
      }
      return message.body.trim();
    },
    [t]
  );

  const formatAuthorLabel = useCallback(
    (message: SupportTicketMessage) => {
      if (message.author === "admin") {
        return message.adminDisplayName
          ? `${t("supportAuthorSupport")} · ${message.adminDisplayName}`
          : t("supportAuthorSupport");
      }
      if (message.author === "system") {
        return t("supportAuthorSystem");
      }
      return t("supportAuthorYou");
    },
    [t]
  );

  const reloadList = useCallback(
    async (options?: { silent?: boolean }) => {
      const token = await getToken();
      if (!token) return;
      const rows = await getAssistantSupportTickets(token, assistantId);
      setTickets((current) => (options?.silent ? mergeTicketList(current, rows) : rows));
      return rows;
    },
    [assistantId, getToken]
  );

  const applyTicketDetail = useCallback((ticket: SupportTicketDetail) => {
    setTicketDetails((current) => ({ ...current, [ticket.id]: ticket }));
    setTickets((current) =>
      current.map((row) =>
        row.id === ticket.id
          ? {
              ...row,
              status: ticket.status,
              updatedAt: ticket.updatedAt,
              answeredAt: ticket.answeredAt,
              hasUnread: ticket.hasUnread
            }
          : row
      )
    );
  }, []);

  const loadTicketDetail = useCallback(
    async (ticketId: string, options?: { markRead?: boolean; silent?: boolean }) => {
      const token = await getToken();
      if (!token) return;

      if (!options?.silent) {
        setDetailLoadingId(ticketId);
      }
      setTicketLoadErrors((current) => {
        if (current[ticketId] === undefined) return current;
        const next = { ...current };
        delete next[ticketId];
        return next;
      });

      try {
        const ticket = await getAssistantSupportTicket(token, ticketId);
        applyTicketDetail(ticket);

        if (options?.markRead) {
          applyTicketDetail({ ...ticket, hasUnread: false });
          try {
            const readTicket = await postAssistantSupportTicketRead(token, ticketId);
            applyTicketDetail(readTicket);
          } catch {
            // Keep optimistic unread=false when the read cursor API is unavailable.
          }
        }
      } catch {
        if (!options?.silent) {
          setTicketLoadErrors((current) => ({
            ...current,
            [ticketId]: t("supportLoadTicketFailed")
          }));
        }
      } finally {
        if (!options?.silent) {
          setDetailLoadingId((current) => (current === ticketId ? null : current));
        }
      }
    },
    [applyTicketDetail, getToken, t]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await reloadList();
      } catch {
        if (!cancelled) {
          setFb({
            kind: "error",
            message: t("supportLoadTicketsFailed")
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadList, t]);

  useEffect(() => {
    if (!expandedTicketId) return;
    void loadTicketDetail(expandedTicketId, { markRead: true });
  }, [expandedTicketId, loadTicketDetail]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const rows = await reloadList({ silent: true });
          if (!rows || !expandedTicketId) return;
          const expanded = rows.find((row) => row.id === expandedTicketId);
          await loadTicketDetail(expandedTicketId, {
            markRead: Boolean(expanded?.hasUnread),
            silent: true
          });
        } catch {
          // Silent refresh must not disturb the user.
        }
      })();
    };

    const intervalId = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [expandedTicketId, loadTicketDetail, reloadList, ticketDetails]);

  function clearAttachment() {
    setAttachmentFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function toggleTicket(ticketId: string) {
    setExpandedTicketId((current) => (current === ticketId ? null : ticketId));
  }

  async function handleSubmit() {
    const trimmed = body.trim();
    if (trimmed.length < 3 && !attachmentFile) {
      setFb({ kind: "error", message: t("supportSubmitErrorShort") });
      return;
    }
    setSubmitting(true);
    setFb(null);
    try {
      const token = await getToken();
      if (!token) throw new Error(t("supportSignInRequired"));
      const ticket = await postAssistantSupportTicket(token, {
        assistantId,
        body: trimmed,
        subject: subject.trim() || null,
        attachment: attachmentFile
      });
      setBody("");
      setSubject("");
      clearAttachment();
      setNewFormExpanded(false);
      await reloadList();
      setExpandedTicketId(ticket.id);
      setTicketDetails((current) => ({ ...current, [ticket.id]: ticket }));
      setFb({ kind: "success", message: t("supportSubmitSuccess") });
    } catch {
      setFb({
        kind: "error",
        message: t("supportSubmitFailed")
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
        <p className="text-xs font-medium text-text">{t("supportMyTickets")}</p>
        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-text-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("supportLoading")}
          </div>
        ) : tickets.length === 0 ? (
          <p className="mt-2 text-[11px] text-text-subtle">{t("supportNoTickets")}</p>
        ) : (
          <ul
            className={cn(
              "mt-2 space-y-1.5",
              tickets.length > 3 && "max-h-[10.75rem] overflow-y-auto overscroll-contain pr-0.5"
            )}
          >
            {tickets.map((ticket) => {
              const expanded = expandedTicketId === ticket.id;
              const detail = ticketDetails[ticket.id];
              const loadingDetail = detailLoadingId === ticket.id;
              return (
                <li
                  key={ticket.id}
                  className={cn(
                    "overflow-hidden rounded-lg border transition-colors",
                    expanded ? "border-accent/35 bg-accent/5" : "border-border"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleTicket(ticket.id)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
                  >
                    <ChevronDown
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle transition-transform",
                        expanded && "rotate-180"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-text">
                          #{ticket.shortId}
                          {ticket.hasUnread && (
                            <span
                              className="inline-flex h-2 w-2 rounded-full bg-success shadow-[0_0_0_2px_var(--color-surface-raised)]"
                              title={t("supportUnreadReply")}
                            />
                          )}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-subtle">
                          {statusLabel(ticket.status)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-text-muted">{ticket.preview}</p>
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-border/70 px-3 pb-3 pt-2">
                      {ticketLoadErrors[ticket.id] && !detail ? (
                        <div className="space-y-2 py-1">
                          <p className="text-[11px] text-danger">{ticketLoadErrors[ticket.id]}</p>
                          <button
                            type="button"
                            onClick={() => void loadTicketDetail(ticket.id, { markRead: true })}
                            className="text-[11px] font-medium text-accent hover:underline"
                          >
                            {t("supportRetryOpen")}
                          </button>
                        </div>
                      ) : loadingDetail && !detail ? (
                        <div className="flex items-center gap-2 py-2 text-[11px] text-text-subtle">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("supportOpeningTicket")}
                        </div>
                      ) : detail ? (
                        <div className="space-y-2">
                          {detail.subject && (
                            <p className="text-[10px] text-text-subtle">{detail.subject}</p>
                          )}
                          <ul className="space-y-2">
                            {detail.messages.map((message) => {
                              const text = formatMessageBody(message);
                              return (
                                <li
                                  key={message.id}
                                  className={cn(
                                    "rounded-lg border px-3 py-2 text-[11px]",
                                    message.author === "admin"
                                      ? "border-accent/25 bg-accent/5"
                                      : message.author === "system"
                                        ? "border-border/60 bg-surface-raised/40 italic text-text-subtle"
                                        : "border-border bg-background/60"
                                  )}
                                >
                                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                                    {formatAuthorLabel(message)}
                                  </p>
                                  {text.length > 0 && (
                                    <p className="whitespace-pre-wrap text-text">{text}</p>
                                  )}
                                  <SupportAttachmentLinks attachments={message.attachments} />
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised/60">
        <button
          type="button"
          onClick={() => setNewFormExpanded((value) => !value)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover/60"
        >
          <span className="text-xs font-medium text-text">{t("supportNewRequest")}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-text-subtle transition-transform",
              newFormExpanded && "rotate-180"
            )}
          />
        </button>

        {newFormExpanded && (
          <div className="space-y-2 border-t border-border/70 px-3 pb-3 pt-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("supportSubjectOptional")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-text"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder={t("supportBodyPlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-text"
            />
            {attachmentFile && (
              <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-background/80 px-2.5 py-1.5 text-[11px] text-text-muted">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={attachmentFile.name}>
                  {attachmentFile.name}
                </span>
                <button
                  type="button"
                  onClick={clearAttachment}
                  className="rounded-full p-0.5 text-text-subtle hover:bg-surface-hover hover:text-text"
                  aria-label={t("supportRemoveAttachment")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setAttachmentFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-text-muted transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                aria-label={t("supportAttachImage")}
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-xs font-medium text-accent disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MessageCircle className="h-3.5 w-3.5" />
                )}
                {t("supportSubmit")}
              </button>
            </div>
            {fb && (
              <p className={cn("text-[11px]", fb.kind === "error" ? "text-danger" : "text-accent")}>
                {fb.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
