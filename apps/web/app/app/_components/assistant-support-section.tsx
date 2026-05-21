"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  getAssistantSupportTicket,
  getAssistantSupportTickets,
  postAssistantSupportTicket,
  type SupportTicketDetail,
  type SupportTicketSummary
} from "../assistant-api-client";

/** Must match API `SUPPORT_SYSTEM_MESSAGE_CODE_PENDING`. */
const SYSTEM_PENDING_CODE = "[[code:pending]]";

type ActionFeedback = { kind: "error" | "success"; message: string } | null;

export function AssistantSupportSection({
  assistantId,
  className
}: {
  assistantId: string;
  className?: string;
}) {
  const t = useTranslations("settings");
  const { getToken } = useAuth();
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [fb, setFb] = useState<ActionFeedback>(null);

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
    (message: SupportTicketDetail["messages"][number]) => {
      if (message.author === "system" && message.body.trim() === SYSTEM_PENDING_CODE) {
        return t("supportSystemPending");
      }
      return message.body;
    },
    [t]
  );

  const formatAuthorLabel = useCallback(
    (message: SupportTicketDetail["messages"][number]) => {
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

  const reloadList = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const rows = await getAssistantSupportTickets(token, assistantId);
    setTickets(rows);
  }, [assistantId, getToken]);

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
        const ticket = await getAssistantSupportTicket(token, selectedId);
        if (!cancelled) setDetail(ticket);
      } catch {
        if (!cancelled) {
          setFb({
            kind: "error",
            message: t("supportLoadTicketFailed")
          });
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, selectedId, t]);

  async function handleSubmit() {
    const trimmed = body.trim();
    if (trimmed.length < 3) {
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
        subject: subject.trim() || null
      });
      setBody("");
      setSubject("");
      await reloadList();
      setSelectedId(ticket.id);
      setDetail(ticket);
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
      <div className="space-y-2 rounded-xl border border-border bg-surface-raised/60 p-3">
        <p className="text-xs font-medium text-text">{t("supportNewRequest")}</p>
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
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleSubmit()}
          className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-xs font-medium text-accent disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageCircle className="h-3.5 w-3.5" />
          )}
          {t("supportSubmit")}
        </button>
        {fb && (
          <p className={cn("text-[11px]", fb.kind === "error" ? "text-danger" : "text-accent")}>
            {fb.message}
          </p>
        )}
      </div>

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
          <ul className="mt-2 space-y-1.5">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(ticket.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-[11px] transition-colors",
                    selectedId === ticket.id
                      ? "border-accent/40 bg-accent/5"
                      : "border-border hover:bg-surface-hover"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text">#{ticket.shortId}</span>
                    <span className="text-text-subtle">{statusLabel(ticket.status)}</span>
                  </div>
                  <p className="mt-1 truncate text-text-muted">{ticket.preview}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedId && (
        <div className="rounded-xl border border-border bg-background p-3">
          {detailLoading || !detail ? (
            <div className="flex items-center gap-2 text-[11px] text-text-subtle">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("supportOpeningTicket")}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-text">
                  #{detail.shortId}
                  {detail.subject ? ` · ${detail.subject}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-text-subtle">{statusLabel(detail.status)}</p>
              </div>
              <ul className="space-y-2">
                {detail.messages.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-[11px]",
                      message.author === "admin"
                        ? "border-accent/25 bg-accent/5"
                        : message.author === "system"
                          ? "border-border/60 bg-surface-raised/40 italic text-text-subtle"
                          : "border-border bg-surface-raised/30"
                    )}
                  >
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                      {formatAuthorLabel(message)}
                    </p>
                    <p className="whitespace-pre-wrap text-text">{formatMessageBody(message)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
