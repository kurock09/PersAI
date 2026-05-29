"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function isActiveTicket(ticket: SupportTicketSummary): boolean {
  return ticket.status !== "closed";
}

function sortTickets(tickets: SupportTicketSummary[]): SupportTicketSummary[] {
  return [...tickets].sort((left, right) => {
    if (left.hasUnread !== right.hasUnread) {
      return left.hasUnread ? -1 : 1;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

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

function SupportTicketMessageList({
  messages,
  formatMessageBody,
  formatAuthorLabel
}: {
  messages: SupportTicketMessage[];
  formatMessageBody: (message: SupportTicketMessage) => string;
  formatAuthorLabel: (message: SupportTicketMessage) => string;
}) {
  return (
    <ul className="space-y-2">
      {messages.map((message) => {
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
            {text.length > 0 && <p className="whitespace-pre-wrap text-text">{text}</p>}
            <SupportAttachmentLinks attachments={message.attachments} />
          </li>
        );
      })}
    </ul>
  );
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
  const [modalTicketId, setModalTicketId] = useState<string | null>(null);
  const [showClosedTickets, setShowClosedTickets] = useState(false);
  const [ticketDetails, setTicketDetails] = useState<Record<string, SupportTicketDetail>>({});
  const [ticketLoadErrors, setTicketLoadErrors] = useState<Record<string, string>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [newFormExpanded, setNewFormExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [fb, setFb] = useState<ActionFeedback>(null);

  const unreadCount = useMemo(() => tickets.filter((ticket) => ticket.hasUnread).length, [tickets]);

  const activeTickets = useMemo(() => sortTickets(tickets.filter(isActiveTicket)), [tickets]);
  const closedTickets = useMemo(
    () => sortTickets(tickets.filter((ticket) => ticket.status === "closed")),
    [tickets]
  );
  const visibleTickets = useMemo(
    () => (showClosedTickets ? [...activeTickets, ...closedTickets] : activeTickets),
    [activeTickets, closedTickets, showClosedTickets]
  );

  const modalTicket = useMemo(
    () => (modalTicketId ? tickets.find((ticket) => ticket.id === modalTicketId) : undefined),
    [modalTicketId, tickets]
  );
  const modalDetail = modalTicketId ? ticketDetails[modalTicketId] : undefined;
  const modalLoading = modalTicketId !== null && detailLoadingId === modalTicketId;
  const modalError = modalTicketId ? ticketLoadErrors[modalTicketId] : undefined;

  useEffect(() => {
    onActivityChange?.({ unreadCount });
  }, [onActivityChange, unreadCount]);

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

  const closeTicketModal = useCallback(() => {
    setModalTicketId(null);
  }, []);

  const openTicketModal = useCallback((ticketId: string) => {
    setModalTicketId(ticketId);
  }, []);

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
  }, [reloadList]);

  useEffect(() => {
    if (!modalTicketId) return;
    void loadTicketDetail(modalTicketId, { markRead: true });
  }, [loadTicketDetail, modalTicketId]);

  useEffect(() => {
    if (!modalTicketId) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTicketModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeTicketModal, modalTicketId]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const rows = await reloadList({ silent: true });
          if (!rows || !modalTicketId) return;
          const openTicket = rows.find((row) => row.id === modalTicketId);
          await loadTicketDetail(modalTicketId, {
            markRead: Boolean(openTicket?.hasUnread),
            silent: true
          });
        } catch {
          // Silent refresh must not disturb the user.
        }
      })();
    };

    const intervalId = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadTicketDetail, modalTicketId, reloadList]);

  function clearAttachment() {
    setAttachmentFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
      setModalTicketId(ticket.id);
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
        ) : visibleTickets.length === 0 ? (
          <p className="mt-2 text-[11px] text-text-subtle">{t("supportNoActiveTickets")}</p>
        ) : (
          <ul
            className={cn(
              "mt-2 space-y-1.5",
              visibleTickets.length > 3 &&
                "max-h-[10.75rem] overflow-y-auto overscroll-contain pr-0.5"
            )}
          >
            {visibleTickets.map((ticket) => {
              const isClosed = ticket.status === "closed";
              return (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => openTicketModal(ticket.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      ticket.hasUnread
                        ? "border-accent/30 bg-accent/[0.05] hover:border-accent/45 hover:bg-accent/[0.08]"
                        : "border-border hover:border-border-strong hover:bg-surface-hover/40",
                      isClosed && "opacity-80"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-text">
                          <span className="truncate">#{ticket.shortId}</span>
                          {ticket.hasUnread && (
                            <span
                              className="inline-flex h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_2px_var(--color-surface-raised)]"
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
                </li>
              );
            })}
          </ul>
        )}

        {!loading && closedTickets.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowClosedTickets((value) => !value)}
            className="mt-2 cursor-pointer text-[11px] font-medium text-text-subtle transition-colors hover:text-text"
          >
            {showClosedTickets
              ? t("supportHideClosed")
              : t("supportShowClosed", { count: closedTickets.length })}
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised/60">
        <button
          type="button"
          onClick={() => setNewFormExpanded((value) => !value)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover/60"
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
                  className="cursor-pointer rounded-full p-0.5 text-text-subtle hover:bg-surface-hover hover:text-text"
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
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-text-muted transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                aria-label={t("supportAttachImage")}
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="inline-flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-xs font-medium text-accent disabled:opacity-50"
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

      {modalTicketId &&
        modalTicket &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-ticket-dialog-title"
            className="fixed inset-0 z-[9000] flex items-end justify-center bg-bg/80 px-3 pb-3 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={closeTicketModal}
          >
            <div
              className="flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-[24px] border border-border-strong/70 bg-surface-raised/95 text-text shadow-[0_24px_70px_rgba(0,0,0,0.32)]"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2
                      id="support-ticket-dialog-title"
                      className="truncate text-sm font-semibold tracking-tight text-text"
                    >
                      #{modalTicket.shortId}
                    </h2>
                    {modalTicket.hasUnread && (
                      <span
                        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_2px_var(--color-surface-raised)]"
                        title={t("supportUnreadReply")}
                      />
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-text-subtle">
                    {statusLabel(modalTicket.status)}
                  </p>
                  {modalDetail?.subject ? (
                    <p className="mt-1 truncate text-[11px] text-text-muted">
                      {modalDetail.subject}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={closeTicketModal}
                  className="cursor-pointer rounded-full p-2 text-text-subtle transition-colors hover:bg-surface hover:text-text"
                  aria-label={t("supportCloseTicketDialog")}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {modalError && !modalDetail ? (
                  <div className="space-y-2 py-1">
                    <p className="text-[11px] text-danger">{modalError}</p>
                    <button
                      type="button"
                      onClick={() => void loadTicketDetail(modalTicketId, { markRead: true })}
                      className="cursor-pointer text-[11px] font-medium text-accent hover:underline"
                    >
                      {t("supportRetryOpen")}
                    </button>
                  </div>
                ) : modalLoading && !modalDetail ? (
                  <div className="flex items-center gap-2 py-6 text-[11px] text-text-subtle">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("supportOpeningTicket")}
                  </div>
                ) : modalDetail ? (
                  <SupportTicketMessageList
                    messages={modalDetail.messages}
                    formatMessageBody={formatMessageBody}
                    formatAuthorLabel={formatAuthorLabel}
                  />
                ) : null}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
