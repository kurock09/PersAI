"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertCircle, AlertTriangle, X, Pencil, Check, Loader2, Scissors } from "lucide-react";
import { useTranslations } from "next-intl";
import { ChatMessageBubble } from "./chat-message";
import { ChatInput } from "./chat-input";
import { ActivityBadge } from "./activity-badge";
import { AssistantAvatar } from "./assistant-avatar";
import {
  patchAssistantWebChat,
  postAssistantMemoryDoNotRemember,
  transcribeVoice
} from "../assistant-api-client";
import type { UseChatReturn } from "./use-chat";

interface ChatAreaProps {
  chat: UseChatReturn;
  title?: string | undefined;
  assistantReady?: boolean | undefined;
  assistantName?: string | undefined;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  assistantCreatedAt?: string | undefined;
  onTitleChanged?: (() => void) | undefined;
}

export function ChatArea({
  chat,
  title,
  assistantReady = true,
  assistantName,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  assistantCreatedAt,
  onTitleChanged
}: ChatAreaProps) {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [forgottenIds, setForgottenIds] = useState<Set<string>>(new Set());
  const [compactionBannerSnoozedUntilCount, setCompactionBannerSnoozedUntilCount] = useState(0);

  const sendPrompt = useCallback(
    (text: string, files?: File[]) => {
      if (assistantReady) void chat.send(text, files);
    },
    [assistantReady, chat]
  );

  const handleDoNotRemember = useCallback(
    async (messageId: string) => {
      const token = await getToken();
      if (!token) return;
      try {
        await postAssistantMemoryDoNotRemember(token, {
          assistantMessageId: messageId
        });
        setForgottenIds((prev) => new Set(prev).add(messageId));
      } catch {
        /* non-critical */
      }
    },
    [getToken]
  );

  const isInitialLoad = useRef(true);
  const prevMessageCount = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new outgoing/incoming messages, but not on history prepend.
  useEffect(() => {
    const count = chat.messages.length;
    if (count > prevMessageCount.current && !isInitialLoad.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCount.current = count;
  }, [chat.entries.length, chat.messages[chat.messages.length - 1]?.content]);

  // On initial history load, jump to bottom instantly (no animation).
  useEffect(() => {
    if (!chat.historyLoading && chat.messages.length > 0 && isInitialLoad.current) {
      isInitialLoad.current = false;
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [chat.historyLoading, chat.messages.length]);

  // Preserve scroll position when older messages are prepended.
  const prevScrollHeight = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight > prevScrollHeight.current && prevScrollHeight.current > 0) {
      const delta = el.scrollHeight - prevScrollHeight.current;
      el.scrollTop += delta;
    }
    prevScrollHeight.current = el.scrollHeight;
  });

  // IntersectionObserver on the top sentinel to trigger loading older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && chat.hasOlderMessages && !chat.olderMessagesLoading) {
          prevScrollHeight.current = container.scrollHeight;
          void chat.loadOlderMessages();
        }
      },
      { root: container, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [chat.hasOlderMessages, chat.olderMessagesLoading, chat.loadOlderMessages]);

  const isEmpty = chat.messages.length === 0;
  const displayTitle = title ?? t("newChat");
  const canEdit = !!chat.chatId;

  const startEdit = useCallback(() => {
    if (!canEdit) return;
    setEditValue(title ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [canEdit, title]);

  const commitEdit = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (!chat.chatId || trimmed.length === 0) return;
    const token = await getToken();
    if (!token) return;
    try {
      await patchAssistantWebChat(token, chat.chatId, { title: trimmed });
      onTitleChanged?.();
    } catch {
      /* non-critical */
    }
  }, [chat.chatId, editValue, getToken, onTitleChanged]);

  const issueIsWarning = chat.issue?.classId === "input_validation";
  const issueContainerClass = issueIsWarning
    ? "border-amber-200 bg-amber-50"
    : "border-destructive/20 bg-destructive/5";
  const issueIconClass = issueIsWarning ? "text-amber-600" : "text-destructive";
  const issueTextClass = issueIsWarning ? "text-amber-900" : "text-destructive";
  const compactionTokensLabel =
    typeof chat.compaction?.currentTokens === "number"
      ? t("compactionTokensValue", { count: chat.compaction.currentTokens })
      : t("compactionTokensNone");
  const recentAutoCompaction = chat.recentAutoCompaction;
  const compactionBannerMode = recentAutoCompaction !== null ? "auto_compacted" : "pressure";
  const compactionBannerTitle =
    compactionBannerMode === "auto_compacted"
      ? t("compactionAutoSuccessTitle")
      : chat.compaction?.autoCompactionEnabled
        ? t("compactionPressureAutoTitle")
        : t("compactionPressureManualTitle");
  const compactionBannerBody =
    compactionBannerMode === "auto_compacted"
      ? t("compactionAutoSuccessBody")
      : chat.compaction?.autoCompactionEnabled
        ? t("compactionHintAuto", { tokens: compactionTokensLabel })
        : t("compactionHintManual", { tokens: compactionTokensLabel });
  const hasAutoCompactionTokenDetail =
    compactionBannerMode === "auto_compacted" &&
    recentAutoCompaction !== null &&
    recentAutoCompaction.tokensBefore !== null &&
    recentAutoCompaction.tokensAfter !== null;
  const compactionBannerDetail = hasAutoCompactionTokenDetail
    ? t("compactionDetailTokens", {
        before: recentAutoCompaction!.tokensBefore!,
        after: recentAutoCompaction!.tokensAfter!
      })
    : compactionBannerMode === "auto_compacted"
      ? t("compactionAutoSuccessDetail")
      : chat.compaction?.autoCompactionEnabled
        ? t("compactionHintAutoDetail")
        : t("compactionHintManualDetail");
  const compactionPressureSnoozed =
    compactionBannerMode === "pressure" && chat.messages.length < compactionBannerSnoozedUntilCount;
  const showCompactionBanner =
    !compactionPressureSnoozed &&
    (chat.compaction?.suggested === true || recentAutoCompaction !== null);

  useEffect(() => {
    setCompactionBannerSnoozedUntilCount(0);
  }, [chat.chatId]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center border-b border-border px-3 py-2 md:px-5 md:py-3">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={() => void commitEdit()}
              maxLength={80}
              className="min-w-0 flex-1 rounded-md border border-accent bg-surface-raised px-2 py-1 text-sm font-semibold text-text outline-none"
            />
            <button
              type="button"
              onClick={() => void commitEdit()}
              className="cursor-pointer rounded p-1 text-accent transition-colors hover:bg-surface-hover"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="group flex min-w-0 flex-1 items-center gap-1.5">
            <h1 className="truncate text-sm font-semibold text-text">{displayTitle}</h1>
            {canEdit && (
              <button
                type="button"
                onClick={startEdit}
                className="shrink-0 cursor-pointer rounded p-1 text-text-subtle opacity-0 transition-all hover:bg-surface-hover hover:text-text-muted group-hover:opacity-100"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState
            name={assistantName}
            avatarUrl={assistantAvatarUrl}
            avatarEmoji={assistantAvatarEmoji}
            createdAt={assistantCreatedAt}
            onPrompt={sendPrompt}
          />
        ) : (
          <div className="mx-auto max-w-3xl py-4">
            <div ref={sentinelRef} className="h-1" />
            {chat.olderMessagesLoading && (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
              </div>
            )}
            {chat.entries.map((entry) =>
              entry.kind === "message" ? (
                <ChatMessageBubble
                  key={entry.message.id}
                  message={entry.message}
                  assistantAvatarUrl={assistantAvatarUrl}
                  assistantAvatarEmoji={assistantAvatarEmoji}
                  onDoNotRemember={
                    entry.message.role === "assistant" &&
                    entry.message.status === "committed" &&
                    !forgottenIds.has(entry.message.id)
                      ? (id) => void handleDoNotRemember(id)
                      : undefined
                  }
                  forgotten={forgottenIds.has(entry.message.id)}
                />
              ) : (
                <ActivityBadge key={entry.event.id} event={entry.event} />
              )
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Issue banner */}
      {chat.issue && (
        <div
          className={`mx-4 mb-2 flex items-start gap-3 rounded-lg border px-4 py-3 ${issueContainerClass}`}
        >
          {issueIsWarning ? (
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issueIconClass}`} />
          ) : (
            <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${issueIconClass}`} />
          )}
          <div className="min-w-0 flex-1">
            {(chat.issue.classId === "media_storage_full" ||
              chat.issue.classId === "workspace_storage_full") &&
            typeof chat.issue.data?.limitMb === "number" ? (
              <>
                <p className={`text-sm font-medium ${issueTextClass}`}>
                  {t(
                    chat.issue.classId === "workspace_storage_full"
                      ? "workspaceStorageFull"
                      : "mediaStorageFull",
                    {
                      used: String(chat.issue.data?.usedMb ?? "?"),
                      limit: String(chat.issue.data.limitMb)
                    }
                  )}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t(
                    chat.issue.classId === "workspace_storage_full"
                      ? "workspaceStorageFullGuidance"
                      : "mediaStorageFullGuidance"
                  )}
                </p>
              </>
            ) : chat.issue.classId === "media_storage_full" ||
              chat.issue.classId === "workspace_storage_full" ? (
              <>
                <p className={`text-sm font-medium ${issueTextClass}`}>
                  {t(
                    chat.issue.classId === "workspace_storage_full"
                      ? "workspaceStorageFullNoLimit"
                      : "mediaStorageFullNoLimit"
                  )}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t(
                    chat.issue.classId === "workspace_storage_full"
                      ? "workspaceStorageFullGuidance"
                      : "mediaStorageFullGuidance"
                  )}
                </p>
              </>
            ) : chat.issue.classId === "compaction_unavailable" ? (
              <>
                <p className={`text-sm font-medium ${issueTextClass}`}>
                  {t("issueCompactionUnavailable")}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t("issueCompactionUnavailableGuidance")}
                </p>
              </>
            ) : (
              <>
                <p className={`text-sm font-medium ${issueTextClass}`}>{chat.issue.message}</p>
                <p className="mt-0.5 text-xs text-text-muted">{chat.issue.guidance}</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={chat.clearIssue}
            className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Input */}
      {showCompactionBanner && (
        <div className="px-3 md:px-4">
          <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-border/70 bg-surface px-3 py-2">
            <div className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                  compactionBannerMode === "auto_compacted"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-600"
                }`}
              >
                {compactionBannerMode === "auto_compacted" ? (
                  <Scissors className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text">{compactionBannerTitle}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                  {compactionBannerBody}
                </p>
                <p className="mt-1 text-[11px] text-text-muted">{compactionBannerDetail}</p>
              </div>
              {compactionBannerMode === "pressure" && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCompactionBannerSnoozedUntilCount(chat.messages.length + 20)}
                    className="cursor-pointer rounded-lg px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    {t("compactionPostponeBatch")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void chat.compactNow()}
                    disabled={chat.compactionRunning || chat.isStreaming}
                    className="cursor-pointer rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {chat.compactionRunning ? t("compactionRunning") : t("compactionAction")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <ChatInput
        onSend={(text, files, options) => void chat.send(text, files, options)}
        onTranscribeVoice={async (blob, filename) => {
          const token = await getToken();
          if (!token) throw new Error("Not authenticated.");
          return transcribeVoice(token, blob, filename);
        }}
        onVoiceTranscriptionError={chat.reportIssue}
        onStop={chat.stop}
        isStreaming={chat.isStreaming}
        disabled={!assistantReady}
      />
    </div>
  );
}

function EmptyState({
  name,
  avatarUrl,
  avatarEmoji,
  createdAt,
  onPrompt
}: {
  name?: string | undefined;
  avatarUrl?: string | undefined;
  avatarEmoji?: string | undefined;
  createdAt?: string | undefined;
  onPrompt?: (text: string) => void;
}) {
  const t = useTranslations("chat");
  const assistantName = name ?? t("defaultAssistant");
  const daysTogether = createdAt
    ? Math.max(1, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000))
    : null;

  const greetings = [t("greeting1"), t("greeting2"), t("greeting3"), t("greeting4")];
  const greeting = greetings[Math.floor(Date.now() / 86_400_000) % greetings.length]!;

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <AssistantAvatar avatarUrl={avatarUrl} avatarEmoji={avatarEmoji} size="lg" className="mb-6" />
      <h2 className="text-xl font-bold text-text">{assistantName}</h2>
      <p className="mt-2 text-sm text-text-muted">{greeting}</p>
      {daysTogether !== null && daysTogether > 1 && (
        <p className="mt-4 rounded-full bg-surface-raised px-4 py-1.5 text-[11px] text-text-subtle">
          {t("togetherFor", { days: daysTogether })}
        </p>
      )}
      <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-2 sm:mt-8 sm:grid-cols-2">
        {(["prompt1", "prompt2", "prompt3", "prompt4"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPrompt?.(t(key))}
            className="cursor-pointer rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-xs text-text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
