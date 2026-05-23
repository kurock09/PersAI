"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  FolderKanban,
  X,
  Pencil,
  Check,
  Loader2,
  Menu,
  MessageSquare,
  Scissors,
  Sparkles
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import { ChatMessageBubble } from "./chat-message";
import { ChatInput, type ChatInputHandle } from "./chat-input";
import { ActivityBadge } from "./activity-badge";
import { AssistantAvatar } from "./assistant-avatar";
import {
  type AssistantChatMode,
  patchAssistantWebChat,
  postAssistantMemoryDoNotRemember,
  transcribeVoice
} from "../assistant-api-client";
import { useShellActions } from "./app-shell";
import type { UseChatReturn } from "./use-chat";

interface ChatAreaProps {
  chat: UseChatReturn;
  title?: string | undefined;
  chatMode?: AssistantChatMode | undefined;
  deepModeEnabled?: boolean | undefined;
  assistantReady?: boolean | undefined;
  assistantName?: string | undefined;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  assistantCreatedAt?: string | undefined;
  showShadowRoutingBadge?: boolean | undefined;
  onTitleChanged?: (() => void) | undefined;
  onUserSend?: (() => void) | undefined;
  onDocumentJobAccepted?: (() => void) | undefined;
  billingReturnKind?: "success" | "failed" | "pending" | undefined;
  billingPlanCode?: string | undefined;
  billingPaymentIntentId?: string | undefined;
}

function formatBillingPlanLabel(planCode: string | undefined): string {
  if (!planCode) {
    return "?";
  }
  return planCode
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isMediaPackageBillingReturn(planCode: string | undefined): boolean {
  return planCode === "__media_package__";
}

export function ChatArea({
  chat,
  title,
  chatMode: initialChatMode,
  deepModeEnabled = false,
  assistantReady = true,
  assistantName,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  assistantCreatedAt,
  showShadowRoutingBadge = false,
  onTitleChanged,
  onUserSend,
  onDocumentJobAccepted,
  billingReturnKind,
  billingPlanCode,
  billingPaymentIntentId
}: ChatAreaProps) {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const { openSidebar } = useShellActions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [chatMode, setChatMode] = useState<AssistantChatMode>(
    initialChatMode ?? (deepModeEnabled ? "smart" : "normal")
  );
  const [forgottenIds, setForgottenIds] = useState<Set<string>>(new Set());
  const [compactionBannerSnoozedUntilCount, setCompactionBannerSnoozedUntilCount] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [dismissedBillingReturnKey, setDismissedBillingReturnKey] = useState<string | null>(null);
  const billingReturnKey =
    billingReturnKind !== undefined
      ? `${billingReturnKind}:${billingPlanCode ?? ""}:${billingPaymentIntentId ?? ""}`
      : null;
  const isMediaPackageReturn = isMediaPackageBillingReturn(billingPlanCode);

  // Restore the cancelled draft into the composer when the user picks
  // "Cancel" on a failed pending-send bubble (text only — media/voice
  // blobs cannot be re-attached because they live in the now-removed
  // bubble's File objects).
  const handleCancelPendingSend = useCallback(() => {
    const restoredText = chat.cancelPendingSend();
    if (restoredText !== null && restoredText.length > 0) {
      chatInputRef.current?.setDraft(restoredText);
    }
  }, [chat]);

  const handleRetryPendingSend = useCallback(() => {
    void chat.retryPendingSend();
  }, [chat]);

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
  const handleAssistantAction = useCallback((text: string) => {
    chatInputRef.current?.setDraft(text);
  }, []);
  const handleDoNotRememberClick = useCallback(
    (messageId: string) => {
      void handleDoNotRemember(messageId);
    },
    [handleDoNotRemember]
  );

  useEffect(() => {
    setDismissedBillingReturnKey(null);
  }, [billingReturnKey]);

  const isInitialLoad = useRef(true);
  const prevMessageCount = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const preserveScrollOnOlderLoadRef = useRef(false);
  const skipAutoScrollOnHistoryPrependRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const scrollStateChatIdRef = useRef(chat.chatId);

  const scrollToBottom = useCallback((behavior: ScrollBehavior | "instant") => {
    shouldStickToBottomRef.current = true;
    const container = scrollRef.current;
    if (container) {
      const top = container.scrollHeight;
      const scrollBehavior = behavior === "instant" ? "auto" : behavior;
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top, behavior: scrollBehavior });
      } else {
        container.scrollTop = top;
      }
    } else {
      bottomRef.current?.scrollIntoView({ behavior });
    }
  }, []);

  const updateShouldStickToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= 96;
    shouldStickToBottomRef.current = nearBottom;
    setShowScrollToBottom(distanceFromBottom > 280);
  }, []);

  // Keep streaming replies pinned only while the user remains near the bottom.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    updateShouldStickToBottom();
    const handleScroll = () => {
      updateShouldStickToBottom();
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [chat.chatId, updateShouldStickToBottom]);

  // Scroll to bottom on new outgoing/incoming messages, and keep following live stream deltas
  // while the user stays anchored near the bottom. Do not auto-jump on history prepend.
  useEffect(() => {
    const count = chat.messages.length;
    const hasNewMessage = count > prevMessageCount.current;
    const shouldSkipHistoryPrependAutoScroll =
      skipAutoScrollOnHistoryPrependRef.current && (hasNewMessage || !chat.olderMessagesLoading);
    if (!isInitialLoad.current && shouldSkipHistoryPrependAutoScroll) {
      skipAutoScrollOnHistoryPrependRef.current = false;
      prevMessageCount.current = count;
      return;
    }
    const shouldFollowStreamingDelta =
      !hasNewMessage && chat.isStreaming && count > 0 && shouldStickToBottomRef.current;
    if (!isInitialLoad.current && (hasNewMessage || shouldFollowStreamingDelta)) {
      scrollToBottom(hasNewMessage ? "smooth" : "auto");
    }
    prevMessageCount.current = count;
  }, [chat.entries.length, chat.isStreaming, chat.messages, scrollToBottom]);

  // On initial history load, jump to bottom instantly (no animation).
  useEffect(() => {
    if (!chat.historyLoading && chat.messages.length > 0 && isInitialLoad.current) {
      isInitialLoad.current = false;
      scrollToBottom("instant");
    }
  }, [chat.chatId, chat.historyLoading, chat.messages.length, scrollToBottom]);

  // Preserve scroll position when older messages are prepended.
  const prevScrollHeight = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !preserveScrollOnOlderLoadRef.current || chat.olderMessagesLoading) return;
    if (el.scrollHeight > prevScrollHeight.current && prevScrollHeight.current > 0) {
      const delta = el.scrollHeight - prevScrollHeight.current;
      el.scrollTop += delta;
    }
    preserveScrollOnOlderLoadRef.current = false;
    prevScrollHeight.current = 0;
  }, [chat.chatId, chat.messages.length, chat.olderMessagesLoading]);

  // IntersectionObserver on the top sentinel to trigger loading older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && chat.hasOlderMessages && !chat.olderMessagesLoading) {
          prevScrollHeight.current = container.scrollHeight;
          preserveScrollOnOlderLoadRef.current = true;
          skipAutoScrollOnHistoryPrependRef.current = true;
          void chat.loadOlderMessages();
        }
      },
      { root: container, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [chat.hasOlderMessages, chat.olderMessagesLoading, chat.loadOlderMessages]);

  /*
   * Empty-state gating: while history is being fetched (or the
   * threadKey-change reset has just run and the post-render effect hasn't
   * yet had a chance to either start a fetch or call `markHistoryEmpty`),
   * we render nothing in the messages slot rather than the EmptyState. The
   * old behaviour flashed the EmptyState for the entire 0.5–1s history
   * fetch every time the user switched chats, which felt especially bad on
   * mobile. Fetch typically completes before the user perceives a void, so
   * a transient empty pane is far less noisy than a full empty-state hero.
   */
  const isEmpty = !chat.historyLoading && chat.messages.length === 0;
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

  const issueIsWarning =
    chat.issue?.classId === "input_validation" ||
    chat.issue?.classId === "voice_transcription_empty";
  const showChatLimitBanner =
    chat.issue?.classId === "active_chat_cap" || chat.issue?.classId === "chat_message_limit";
  const issueContainerClass = issueIsWarning
    ? "border-amber-200 bg-amber-50"
    : "border-destructive/20 bg-destructive/5";
  const issueIconClass = issueIsWarning ? "text-amber-600" : "text-destructive";
  const issueTextClass = issueIsWarning ? "text-amber-900" : "text-destructive";
  const showBillingReturnBanner =
    billingReturnKind !== undefined && billingReturnKey !== dismissedBillingReturnKey;
  const billingBannerCardTone =
    billingReturnKind === "success"
      ? "border-success/15 bg-surface/95 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
      : billingReturnKind === "failed"
        ? "border-warning/15 bg-surface/95 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
        : "border-accent/15 bg-surface/95 shadow-[0_10px_30px_rgba(0,0,0,0.18)]";
  const billingBannerBadgeTone =
    billingReturnKind === "success"
      ? "border-success/20 bg-success/10 text-success"
      : billingReturnKind === "failed"
        ? "border-warning/20 bg-warning/10 text-warning"
        : "border-accent/15 bg-accent/8 text-accent";
  const compactionTokensLabel =
    typeof chat.compaction?.currentTokens === "number"
      ? t("compactionTokensValue", { count: chat.compaction.currentTokens })
      : t("compactionTokensNone");
  const recentAutoCompaction = chat.recentAutoCompaction;
  const compactionBannerMode =
    chat.compaction?.exhaustedAtPlanLimit === true
      ? "exhausted"
      : recentAutoCompaction !== null
        ? "auto_compacted"
        : "pressure";
  const compactionBannerTitle =
    compactionBannerMode === "exhausted"
      ? t("compactionExhaustedTitle")
      : compactionBannerMode === "auto_compacted"
        ? t("compactionAutoSuccessTitle")
        : chat.compaction?.autoCompactionEnabled
          ? t("compactionPressureAutoTitle")
          : t("compactionPressureManualTitle");
  const compactionBannerBody =
    compactionBannerMode === "exhausted"
      ? t("compactionExhaustedBody", {
          tokens: compactionTokensLabel,
          count: String(chat.compaction?.recentAutoCompactionStreak ?? 0)
        })
      : compactionBannerMode === "auto_compacted"
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
    : compactionBannerMode === "exhausted"
      ? t("compactionExhaustedDetail")
      : compactionBannerMode === "auto_compacted"
        ? t("compactionAutoSuccessDetail")
        : chat.compaction?.autoCompactionEnabled
          ? t("compactionHintAutoDetail")
          : t("compactionHintManualDetail");
  const compactionPressureSnoozed =
    compactionBannerMode === "pressure" && chat.messages.length < compactionBannerSnoozedUntilCount;
  const compactionPressureSuppressedByAutoMode =
    compactionBannerMode === "pressure" && chat.compaction?.autoCompactionEnabled === true;
  const showCompactionBanner =
    !compactionPressureSnoozed &&
    !compactionPressureSuppressedByAutoMode &&
    (chat.compaction?.exhaustedAtPlanLimit === true ||
      chat.compaction?.suggested === true ||
      recentAutoCompaction !== null);

  useEffect(() => {
    setCompactionBannerSnoozedUntilCount(0);
  }, [chat.chatId]);

  useEffect(() => {
    setChatMode(initialChatMode ?? (deepModeEnabled ? "smart" : "normal"));
  }, [chat.chatId, initialChatMode, deepModeEnabled]);

  useLayoutEffect(() => {
    if (scrollStateChatIdRef.current === chat.chatId) return;
    scrollStateChatIdRef.current = chat.chatId;
    isInitialLoad.current = true;
    prevMessageCount.current = 0;
    preserveScrollOnOlderLoadRef.current = false;
    skipAutoScrollOnHistoryPrependRef.current = false;
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
  }, [chat.chatId]);

  const handleChatModeChange = useCallback(
    async (nextMode: AssistantChatMode) => {
      const previousMode = chatMode;
      setChatMode(nextMode);
      if (!chat.chatId) {
        return;
      }
      const token = await getToken();
      if (!token) {
        return;
      }
      try {
        await patchAssistantWebChat(token, chat.chatId, { chatMode: nextMode });
        onTitleChanged?.();
      } catch {
        setChatMode(previousMode);
      }
    },
    [chat.chatId, chatMode, getToken, onTitleChanged]
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* Header: title on the left, mode toggle pinned right on all form factors. */}
      <header className="border-b border-border px-3 py-2.5 md:px-5 md:py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openSidebar}
            className="cursor-pointer rounded-xl border border-border bg-surface-raised p-2.5 text-text-muted shadow-sm transition-colors active:bg-surface-hover hover:bg-surface-hover hover:text-text md:hidden"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex min-w-0 items-center gap-1.5">
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
                  className="min-w-0 flex-1 rounded-lg border border-accent/50 bg-bg/70 px-2.5 py-1.5 text-base font-semibold tracking-tight text-text outline-none md:text-[17px]"
                />
                <button
                  type="button"
                  onClick={() => void commitEdit()}
                  className="cursor-pointer rounded-lg p-1.5 text-accent transition-colors hover:bg-surface-hover"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="group flex min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h1 className="truncate text-sm font-medium tracking-normal text-text-muted md:text-sm">
                    {displayTitle}
                  </h1>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={startEdit}
                      aria-label="Rename chat"
                      className="shrink-0 cursor-pointer rounded-lg p-1 text-text-subtle opacity-70 transition-all hover:bg-surface-hover hover:text-text-muted md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {chatMode !== "normal" && (
                  // Subtitle is desktop-only on purpose: on mobile the
                  // Sparkles pill on the right already carries the
                  // "premium / costs more" signal; doubling it here would
                  // turn a 280px header into noise.
                  <span className="mt-0.5 hidden items-center gap-1 text-[10px] font-medium tracking-wide text-accent-premium/80 md:inline-flex">
                    {chatMode === "project" ? (
                      <FolderKanban className="h-2.5 w-2.5 text-accent-premium" />
                    ) : (
                      <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                    )}
                    <span className="truncate">
                      {chatMode === "project" ? t("modeProjectCaption") : t("modeDeepCaption")}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
          <ChatModeToggle
            mode={chatMode}
            disabled={!assistantReady || chat.isStreaming}
            onChange={(mode) => void handleChatModeChange(mode)}
          />
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-hidden overflow-y-auto md:[scrollbar-gutter:stable_both-edges]"
      >
        {isEmpty ? (
          <EmptyState
            name={assistantName}
            avatarUrl={assistantAvatarUrl}
            avatarEmoji={assistantAvatarEmoji}
            createdAt={assistantCreatedAt}
          />
        ) : (
          <div className="mx-auto w-full max-w-[50rem] px-3 pt-4 pb-24 md:px-0 md:pb-28">
            <div ref={sentinelRef} className="h-1" />
            {chat.olderMessagesLoading && (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
              </div>
            )}
            {chat.entries.map((entry, index) => {
              const previousEntry = chat.entries[index - 1];
              const nextEntry = chat.entries[index + 1];
              const previousUserIsSending =
                previousEntry?.kind === "message" &&
                previousEntry.message.role === "user" &&
                (previousEntry.message.status === "sending" ||
                  previousEntry.message.status === "reconciling");
              const preResponseStatus =
                entry.kind === "message" &&
                entry.message.role === "assistant" &&
                entry.message.status === "streaming" &&
                entry.message.content.trim().length === 0 &&
                !previousUserIsSending
                  ? nextEntry?.kind === "activity" && nextEntry.event.type === "tool_use"
                    ? "working"
                    : "thinking"
                  : undefined;

              return entry.kind === "message" ? (
                <ChatMessageBubble
                  key={entry.message.id}
                  message={entry.message}
                  preResponseStatus={preResponseStatus}
                  assistantAvatarUrl={assistantAvatarUrl}
                  assistantAvatarEmoji={assistantAvatarEmoji}
                  onAssistantAction={handleAssistantAction}
                  onDocumentJobAccepted={onDocumentJobAccepted}
                  onDoNotRemember={
                    entry.message.role === "assistant" &&
                    entry.message.status === "committed" &&
                    !forgottenIds.has(entry.message.id)
                      ? handleDoNotRememberClick
                      : undefined
                  }
                  forgotten={forgottenIds.has(entry.message.id)}
                  onRetryPendingSend={
                    entry.message.role === "user" && entry.message.status.startsWith("send_failed")
                      ? handleRetryPendingSend
                      : undefined
                  }
                  onCancelPendingSend={
                    entry.message.role === "user" && entry.message.status.startsWith("send_failed")
                      ? handleCancelPendingSend
                      : undefined
                  }
                />
              ) : (
                <ActivityBadge
                  key={entry.event.id}
                  event={entry.event}
                  showShadowRoutingLabel={showShadowRoutingBadge}
                />
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {showScrollToBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className={cn(
            "absolute right-3 bottom-[5.25rem] z-20 inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-surface-raised/90 px-3 py-2 text-xs font-medium text-text-muted shadow-lg shadow-black/5 backdrop-blur-md transition-all",
            "hover:-translate-y-0.5 hover:border-accent/30 hover:bg-surface-hover hover:text-text active:translate-y-0 md:right-auto md:bottom-24 md:left-1/2 md:-translate-x-1/2"
          )}
          aria-label={t("scrollToBottom")}
          title={t("scrollToBottom")}
        >
          <ArrowDown className="h-4 w-4" />
          <span className="hidden sm:inline">{t("scrollToBottom")}</span>
        </button>
      )}

      {/* Issue banner */}
      {chat.issue && !showChatLimitBanner && (
        <div
          className={`mx-4 mb-2 flex items-start gap-3 rounded-lg border px-4 py-3 ${issueContainerClass}`}
        >
          {issueIsWarning ? (
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issueIconClass}`} />
          ) : (
            <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${issueIconClass}`} />
          )}
          <div className="min-w-0 flex-1">
            {chat.issue.classId === "voice_transcription_empty" ? (
              <>
                <p className={`text-sm font-medium ${issueTextClass}`}>
                  {t("voiceTranscriptionEmptyTitle")}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t("voiceTranscriptionEmptyGuidance")}
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
            ) : chat.issue.classId === "provider_failure" ? (
              <>
                <p className={`text-sm font-medium ${issueTextClass}`}>
                  {t("issueProviderFailure")}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t("issueProviderFailureGuidance")}
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
          <div className="mx-auto mb-2 w-full max-w-[50rem] rounded-lg border border-border/70 bg-surface px-3 py-2">
            <div className="flex items-start gap-2.5">
              <div
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                  compactionBannerMode === "auto_compacted"
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-warning/30 bg-warning/10 text-warning"
                )}
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
      {showBillingReturnBanner ? (
        <div className="px-3 md:px-4">
          <div
            className={cn(
              "mx-auto mb-2 w-full max-w-[50rem] rounded-2xl border px-3 py-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-sm",
              billingBannerCardTone
            )}
          >
            <div className="flex items-start gap-2.5">
              <div
                className={cn(
                  "relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                  billingBannerBadgeTone
                )}
              >
                {billingReturnKind === "success" ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-success/15 animate-ping"
                    />
                    <span className="relative flex h-full w-full items-center justify-center rounded-full">
                      <Check className="h-4 w-4" />
                    </span>
                  </>
                ) : billingReturnKind === "pending" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text">
                  {billingReturnKind === "success"
                    ? isMediaPackageReturn
                      ? t("billingReturnPackageSuccessTitle")
                      : t("billingReturnSuccessTitle", {
                          plan: formatBillingPlanLabel(billingPlanCode)
                        })
                    : billingReturnKind === "failed"
                      ? isMediaPackageReturn
                        ? t("billingReturnPackageFailedTitle")
                        : t("billingReturnFailedTitle")
                      : isMediaPackageReturn
                        ? t("billingReturnPackagePendingTitle")
                        : t("billingReturnPendingTitle")}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                  {billingReturnKind === "success"
                    ? isMediaPackageReturn
                      ? t("billingReturnPackageSuccessBody")
                      : t("billingReturnSuccessBody")
                    : billingReturnKind === "failed"
                      ? isMediaPackageReturn
                        ? t("billingReturnPackageFailedBody")
                        : t("billingReturnFailedBody")
                      : isMediaPackageReturn
                        ? t("billingReturnPackagePendingBody")
                        : t("billingReturnPendingBody")}
                </p>
                {billingReturnKind === "failed" ? (
                  <Link
                    href={(isMediaPackageReturn ? "/app/packages" : "/app/pricing") as Route}
                    className="mt-2 inline-flex min-h-8 items-center justify-center rounded-lg border border-border/70 bg-bg/70 px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-hover"
                  >
                    {isMediaPackageReturn
                      ? t("billingReturnPackageRetry")
                      : t("billingReturnRetry")}
                  </Link>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setDismissedBillingReturnKey(billingReturnKey)}
                className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showChatLimitBanner ? (
        <div className="px-3 md:px-4">
          <div className="mx-auto mb-2 w-full max-w-[50rem] rounded-lg border border-warning/20 bg-surface px-3 py-2">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-warning/25 bg-warning/10 text-warning">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text">
                  {chat.issue?.classId === "chat_message_limit"
                    ? t("chatMessageLimitTitle")
                    : t("chatActiveLimitTitle")}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                  {chat.issue?.classId === "chat_message_limit"
                    ? t("chatMessageLimitBody")
                    : t("chatActiveLimitBody")}
                </p>
                {chat.issue?.classId === "active_chat_cap" ? (
                  <p className="mt-1 text-[11px] text-text-muted">{t("chatActiveLimitDetail")}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {chat.issue?.classId === "chat_message_limit" ? (
                    <Link
                      href={"/app/chat" as Route}
                      className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border/70 bg-bg/70 px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-hover"
                    >
                      {t("chatMessageLimitNewChat")}
                    </Link>
                  ) : null}
                  <Link
                    href={"/app/pricing" as Route}
                    className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border/70 bg-bg/70 px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-hover"
                  >
                    {t("chatLimitOpenPricing")}
                  </Link>
                </div>
              </div>
              <button
                type="button"
                onClick={chat.clearIssue}
                className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ChatInput
        ref={chatInputRef}
        onSend={(text, files, options) => {
          onUserSend?.();
          return void chat.send(text, files, {
            ...(options ?? {}),
            chatMode,
            deepModeEnabled: chatMode !== "normal"
          });
        }}
        onTranscribeVoice={async (blob, filename) => {
          const token = await getToken();
          if (!token) throw new Error("Not authenticated.");
          return transcribeVoice(token, blob, filename);
        }}
        onVoiceTranscriptionError={chat.reportIssue}
        onStop={chat.stop}
        isStreaming={chat.isStreaming}
        disabled={!assistantReady}
        pendingSendStatus={chat.pendingSendStatus}
        activeMediaJobs={chat.activeMediaJobs}
        activeDocumentJobs={chat.activeDocumentJobs}
      />
    </div>
  );
}

const CHAT_MODES: AssistantChatMode[] = ["normal", "smart", "project"];

function chatModeLabel(t: ReturnType<typeof useTranslations>, mode: AssistantChatMode): string {
  switch (mode) {
    case "project":
      return t("modeProjectLabel");
    case "smart":
      return t("modeDeepLabel");
    default:
      return t("modeNormalLabel");
  }
}

function chatModeCaption(t: ReturnType<typeof useTranslations>, mode: AssistantChatMode): string {
  switch (mode) {
    case "project":
      return t("modeProjectCaption");
    case "smart":
      return t("modeDeepCaption");
    default:
      return t("modeNormalCaption");
  }
}

function ChatModeIcon({ mode, className }: { mode: AssistantChatMode; className?: string }) {
  if (mode === "project") {
    return <FolderKanban className={className} />;
  }
  if (mode === "smart") {
    return <Sparkles className={cn(className, "animate-pulse")} />;
  }
  return <MessageSquare className={className} />;
}

function ChatModeToggle({
  mode,
  disabled,
  onChange
}: {
  mode: AssistantChatMode;
  disabled?: boolean;
  onChange: (mode: AssistantChatMode) => void;
}) {
  const t = useTranslations("chat");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const selectMode = useCallback(
    (nextMode: AssistantChatMode) => {
      setMenuOpen(false);
      onChange(nextMode);
    },
    [onChange]
  );

  return (
    <div className="shrink-0">
      {/* One compact chip opens the same 3-mode menu on mobile and desktop. */}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("modeMenuAria", { mode: chatModeLabel(t, mode) })}
          title={chatModeCaption(t, mode)}
          onClick={() => setMenuOpen((open) => !open)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-raised/90 px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm backdrop-blur-sm transition-colors md:px-3 md:py-1.5",
            mode !== "normal" && "border-accent-premium/25 text-accent-premium",
            menuOpen && "border-border-strong bg-surface-raised",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          <ChatModeIcon
            mode={mode}
            className={cn(
              "h-3.5 w-3.5",
              mode === "normal" ? "text-text-muted" : "text-accent-premium"
            )}
          />
          <span>{chatModeLabel(t, mode)}</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 text-text-subtle transition-transform",
              menuOpen && "rotate-180"
            )}
          />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("modeMenuAria", { mode: chatModeLabel(t, mode) })}
            className="absolute top-full right-0 z-30 mt-2 min-w-[11rem] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface-raised p-1 shadow-xl backdrop-blur-sm md:min-w-[12rem]"
          >
            {CHAT_MODES.map((option) => (
              <button
                key={option}
                type="button"
                role="menuitem"
                aria-current={mode === option ? "true" : undefined}
                disabled={disabled}
                onClick={() => selectMode(option)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold transition-colors",
                  mode === option
                    ? option === "normal"
                      ? "bg-surface text-text"
                      : "bg-accent-premium/10 text-accent-premium"
                    : "text-text-muted hover:bg-surface-hover hover:text-text",
                  disabled && "cursor-not-allowed opacity-50"
                )}
              >
                <ChatModeIcon
                  mode={option}
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    option === "normal" ? "text-text-muted" : "text-accent-premium"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{chatModeLabel(t, option)}</span>
                  <span className="block text-[10px] font-normal text-text-subtle">
                    {chatModeCaption(t, option)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  name,
  avatarUrl,
  avatarEmoji,
  createdAt
}: {
  name?: string | undefined;
  avatarUrl?: string | undefined;
  avatarEmoji?: string | undefined;
  createdAt?: string | undefined;
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
      <h2 className="text-xl font-semibold text-text">{assistantName}</h2>
      <p className="mt-2 text-sm text-text-muted">{greeting}</p>
      {daysTogether !== null && daysTogether > 1 && (
        <p className="mt-4 rounded-full bg-surface-raised px-4 py-1.5 text-[11px] text-text-subtle">
          {t("togetherFor", { days: daysTogether })}
        </p>
      )}
    </div>
  );
}
