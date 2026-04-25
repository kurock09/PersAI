"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  AlertTriangle,
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
  patchAssistantWebChat,
  postAssistantMemoryDoNotRemember,
  transcribeVoice
} from "../assistant-api-client";
import { useShellActions } from "./app-shell";
import type { UseChatReturn } from "./use-chat";

interface ChatAreaProps {
  chat: UseChatReturn;
  title?: string | undefined;
  deepModeEnabled?: boolean | undefined;
  assistantReady?: boolean | undefined;
  assistantName?: string | undefined;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  assistantCreatedAt?: string | undefined;
  showShadowRoutingBadge?: boolean | undefined;
  onTitleChanged?: (() => void) | undefined;
}

export function ChatArea({
  chat,
  title,
  deepModeEnabled = false,
  assistantReady = true,
  assistantName,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  assistantCreatedAt,
  showShadowRoutingBadge = false,
  onTitleChanged
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
  const [deepMode, setDeepMode] = useState(deepModeEnabled);
  const [forgottenIds, setForgottenIds] = useState<Set<string>>(new Set());
  const [compactionBannerSnoozedUntilCount, setCompactionBannerSnoozedUntilCount] = useState(0);

  const sendPrompt = useCallback(
    (text: string, files?: File[]) => {
      if (assistantReady) void chat.send(text, files, { deepModeEnabled: deepMode });
    },
    [assistantReady, chat, deepMode]
  );

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

  const isInitialLoad = useRef(true);
  const prevMessageCount = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const preserveScrollOnOlderLoadRef = useRef(false);
  const skipAutoScrollOnHistoryPrependRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior | "instant") => {
    shouldStickToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const updateShouldStickToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 96;
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
  }, [chat.historyLoading, chat.messages.length, scrollToBottom]);

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
  const compactionPressureSuppressedByAutoMode =
    compactionBannerMode === "pressure" && chat.compaction?.autoCompactionEnabled === true;
  const showCompactionBanner =
    !compactionPressureSnoozed &&
    !compactionPressureSuppressedByAutoMode &&
    (chat.compaction?.suggested === true || recentAutoCompaction !== null);

  useEffect(() => {
    setCompactionBannerSnoozedUntilCount(0);
  }, [chat.chatId]);

  useEffect(() => {
    setDeepMode(deepModeEnabled);
  }, [chat.chatId, deepModeEnabled]);

  const handleDeepModeChange = useCallback(
    async (enabled: boolean) => {
      setDeepMode(enabled);
      if (!chat.chatId) {
        return;
      }
      const token = await getToken();
      if (!token) {
        return;
      }
      try {
        await patchAssistantWebChat(token, chat.chatId, { deepModeEnabled: enabled });
        onTitleChanged?.();
      } catch {
        setDeepMode(!enabled);
      }
    },
    [chat.chatId, getToken, onTitleChanged]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header — premium two-zone composition: title is the primary
          subject (left, h1 weight + tight tracking), mode-toggle is a
          quiet utility chip pinned to the right. The previous wrapped
          capsule with a "/" separator collapsed both into one breadcrumb
          which broke the visual hierarchy. */}
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
                  <h1 className="truncate text-base font-semibold tracking-tight text-text md:text-[17px]">
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
                {deepMode && (
                  // Subtitle is desktop-only on purpose: on mobile the
                  // Sparkles pill on the right already carries the
                  // "premium / costs more" signal; doubling it here would
                  // turn a 280px header into noise.
                  <span className="mt-0.5 hidden items-center gap-1 text-[10px] font-medium tracking-wide text-accent-premium/80 md:inline-flex">
                    <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                    <span className="truncate">{t("modeDeepCaption")}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          <ChatModeToggle
            enabled={deepMode}
            disabled={!assistantReady || chat.isStreaming}
            onChange={(enabled) => void handleDeepModeChange(enabled)}
          />
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-x-hidden overflow-y-auto">
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
                  onRetryPendingSend={
                    entry.message.role === "user" && entry.message.status === "send_failed"
                      ? handleRetryPendingSend
                      : undefined
                  }
                  onCancelPendingSend={
                    entry.message.role === "user" && entry.message.status === "send_failed"
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
      <ChatInput
        ref={chatInputRef}
        onSend={(text, files, options) =>
          void chat.send(text, files, {
            ...(options ?? {}),
            ...(deepMode ? { deepModeEnabled: true } : {})
          })
        }
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
      />
    </div>
  );
}

function ChatModeToggle({
  enabled,
  disabled,
  onChange
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const t = useTranslations("chat");

  return (
    <div className="shrink-0">
      {/*
       * Outer capsule chrome (segmented background, ring, backdrop blur,
       * eyelash shadow) is desktop-only: on mobile the Normal pill is
       * hidden and the single Sparkles pill carries its own premium
       * styling, so the outer capsule would become a redundant
       * "capsule-in-a-capsule" wrapper around one tiny control.
       */}
      <div
        className="inline-flex md:rounded-xl md:bg-surface-raised/70 md:p-0.5 md:shadow-[0_1px_0_rgba(0,0,0,0.04)] md:ring-1 md:ring-border/60 md:backdrop-blur-sm"
        title={enabled ? t("modeDeepCaption") : t("modeNormalCaption")}
      >
        {/*
         * "Normal" pill is hidden on phones to keep the chat header narrow:
         * on touch viewports the single "Smart" pill toggles on/off in one
         * tap (off = normal mode). On desktop the two-pill segmented
         * control is preserved.
         */}
        <button
          type="button"
          aria-pressed={!enabled}
          disabled={disabled}
          onClick={() => onChange(false)}
          className={cn(
            "hidden items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-all md:inline-flex md:text-[11px]",
            !enabled ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          <MessageSquare className="h-3 w-3" />
          <span>{t("modeNormalLabel")}</span>
        </button>
        <button
          type="button"
          aria-pressed={enabled}
          disabled={disabled}
          onClick={() => onChange(!enabled)}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-all md:text-[11px]",
            enabled
              ? "bg-accent-premium/12 text-accent-premium ring-1 ring-accent-premium/25"
              : "text-text-muted hover:text-text",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          <Sparkles
            className={cn(
              "h-3 w-3",
              enabled ? "animate-pulse text-accent-premium" : "text-accent-premium/45"
            )}
          />
          <span>{t("modeDeepLabel")}</span>
        </button>
      </div>
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
      <h2 className="text-xl font-semibold text-text">{assistantName}</h2>
      <p className="mt-2 text-sm text-text-muted">{greeting}</p>
      {daysTogether !== null && daysTogether > 1 && (
        <p className="mt-4 rounded-full bg-surface-raised px-4 py-1.5 text-[11px] text-text-subtle">
          {t("togetherFor", { days: daysTogether })}
        </p>
      )}
      <div className="mt-8 grid w-full max-w-md grid-cols-1 gap-2.5 sm:mt-10 sm:grid-cols-2">
        {(["prompt1", "prompt2", "prompt3", "prompt4"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPrompt?.(t(key))}
            className="cursor-pointer rounded-2xl border border-border bg-surface-raised/70 px-4 py-3 text-left text-[13px] leading-snug text-text-muted transition-all hover:border-accent/40 hover:bg-surface-raised hover:text-text"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
