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
import { AssistantAvatar } from "./assistant-avatar";
import {
  type AssistantChatMode,
  dismissAssistantBrowserProfileView,
  openAssistantBrowserProfileView,
  patchAssistantWebChat,
  postAssistantMemoryDoNotRemember,
  transcribeVoice
} from "../assistant-api-client";
import { getCurrentLocalBrowserBridgeStatus } from "../browser-bridge-client";
import { useShellActions } from "./app-shell";
import {
  dispatchProjectModeActivated,
  markProjectFilesHintShown,
  shouldShowProjectFilesHint
} from "./project-files-events";
import type { UseChatReturn } from "./use-chat";
import { ChatPlanCard } from "./chat-plan-card";
import { BrowserLoginModal } from "./browser-login-modal";

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
  paidLightModeActive?: boolean | undefined;
  assistantId?: string | null | undefined;
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

function resolveSafetyRestrictedBodyKey(reasonCode: string | undefined): string {
  switch (reasonCode) {
    case "hack_abuse":
      return "safetyRestrictedBodyHackAbuse";
    case "violence_extremism":
      return "safetyRestrictedBodyViolence";
    case "unsolicited_adult_spam":
      return "safetyRestrictedBodyAdultSpam";
    case "structural_abuse_signal":
      return "safetyRestrictedBodyStructural";
    default:
      return "safetyRestrictedBodyDefault";
  }
}

function resolveSafetyInboundWarnBodyKey(reasonCode: string | undefined): string {
  switch (reasonCode) {
    case "hack_abuse":
      return "safetyInboundWarnBodyHackAbuse";
    case "violence_extremism":
      return "safetyInboundWarnBodyViolence";
    case "unsolicited_adult_spam":
      return "safetyInboundWarnBodyAdultSpam";
    case "structural_abuse_signal":
      return "safetyInboundWarnBodyStructural";
    default:
      return "safetyInboundWarnBodyDefault";
  }
}

function findLatestSafetyInboundWarn(
  messages: UseChatReturn["messages"]
): { messageId: string; reasonCode: string } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.platformNotice?.kind === "safety_inbound_warn") {
      return {
        messageId: message.id,
        reasonCode: message.platformNotice.reasonCode
      };
    }
  }
  return null;
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
  billingPaymentIntentId,
  paidLightModeActive = false,
  assistantId
}: ChatAreaProps) {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const { openSidebar, openSettings } = useShellActions();
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
  const [dismissedSafetyWarnMessageId, setDismissedSafetyWarnMessageId] = useState<string | null>(
    null
  );
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

  // ADR-125 follow-up — read the chat-level engagement projection that the
  // API derives from `chat.skillDecisionState` and ships in (a) the history
  // endpoint response on load, (b) the SSE turn-completion payload on each
  // turn. Walking messages was unreliable because reconstructed history
  // messages dropped `engagementSummary`, so the chip disappeared a few
  // seconds after every history reload.
  const activeSkillEngagement = chat.currentEngagement;

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
  const showSafetyRestrictedBanner = chat.issue?.classId === "safety_restricted";
  const safetyRestrictedReasonCode =
    showSafetyRestrictedBanner && typeof chat.issue?.data?.reasonCode === "string"
      ? chat.issue.data.reasonCode
      : undefined;
  const latestSafetyInboundWarn = findLatestSafetyInboundWarn(chat.messages);
  const showSafetyInboundWarnBanner =
    !showSafetyRestrictedBanner &&
    latestSafetyInboundWarn !== null &&
    latestSafetyInboundWarn.messageId !== dismissedSafetyWarnMessageId;
  const safetyInboundWarnReasonCode = latestSafetyInboundWarn?.reasonCode;
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

  useEffect(() => {
    const chatId = chat.chatId;
    if (!paidLightModeActive || chatMode === "normal" || !chatId) {
      return;
    }
    setChatMode("normal");
    void (async () => {
      const token = await getToken();
      if (!token) {
        return;
      }
      try {
        await patchAssistantWebChat(token, chatId, { chatMode: "normal" });
        onTitleChanged?.();
      } catch {
        /* keep local normal state; server reset happens on next chat list load */
      }
    })();
  }, [paidLightModeActive, chat.chatId, chatMode, getToken, onTitleChanged]);

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
      if (paidLightModeActive && nextMode !== "normal") {
        return;
      }
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
        if (
          nextMode === "project" &&
          previousMode !== "project" &&
          shouldShowProjectFilesHint(chat.chatId)
        ) {
          markProjectFilesHintShown(chat.chatId);
          if (window.matchMedia("(max-width: 767px)").matches) {
            openSidebar();
          }
          dispatchProjectModeActivated(chat.chatId);
        }
      } catch {
        setChatMode(previousMode);
      }
    },
    [chat.chatId, chatMode, getToken, onTitleChanged, openSidebar, paidLightModeActive]
  );

  const pendingBrowserAssist =
    chat.pendingBrowserLogin?.completionMode === "assist" ? chat.pendingBrowserLogin : null;
  const [browserAssistAction, setBrowserAssistAction] = useState<"open" | "done" | null>(null);
  const [browserAssistError, setBrowserAssistError] = useState<string | null>(null);
  const handleOpenBrowserAssist = useCallback(async () => {
    if (!assistantId || pendingBrowserAssist === null || browserAssistAction !== null) {
      return;
    }
    setBrowserAssistAction("open");
    setBrowserAssistError(null);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error(t("browserAssistActionFailed"));
      }
      const bridgeStatus = await getCurrentLocalBrowserBridgeStatus();
      const bridgeDeviceId =
        bridgeStatus.connected &&
        bridgeStatus.assistantId === assistantId &&
        bridgeStatus.workspaceId === pendingBrowserAssist.workspaceId
          ? bridgeStatus.bridgeDeviceId
          : null;
      if (bridgeDeviceId === null) {
        throw new Error(t("browserAssistActionFailed"));
      }
      await openAssistantBrowserProfileView(
        token,
        assistantId,
        pendingBrowserAssist.profileId,
        bridgeDeviceId
      );
    } catch {
      setBrowserAssistError(t("browserAssistActionFailed"));
    } finally {
      setBrowserAssistAction(null);
    }
  }, [assistantId, browserAssistAction, getToken, pendingBrowserAssist, t]);
  const handleCompleteBrowserAssist = useCallback(async () => {
    if (!assistantId || pendingBrowserAssist === null || browserAssistAction !== null) {
      return;
    }
    setBrowserAssistAction("done");
    setBrowserAssistError(null);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error(t("browserAssistActionFailed"));
      }
      await dismissAssistantBrowserProfileView(token, assistantId, pendingBrowserAssist.profileId);
      chat.clearPendingBrowserLogin();
      await chat.send(t("browserAssistResumeMessage"));
    } catch {
      setBrowserAssistError(t("browserAssistActionFailed"));
    } finally {
      setBrowserAssistAction(null);
    }
  }, [assistantId, browserAssistAction, chat, getToken, pendingBrowserAssist, t]);
  const showBrowserLoginChip =
    chat.pendingBrowserLogin !== null &&
    chat.pendingBrowserLogin.completionMode !== "assist" &&
    !chat.browserLoginModalOpen;
  const browserLoginChipHintKey =
    chat.pendingBrowserLogin?.completionMode === "assist"
      ? "browserLoginAssistContinueHint"
      : "browserLoginContinueHint";

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Stage: messages full-bleed; header/footer overlay so text dissolves under chrome (TG). */}
      <div className="relative min-h-0 flex-1">
        {/* Full-bleed message scroll — chrome overlays this pane. */}
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-x-hidden overflow-y-auto md:[scrollbar-gutter:stable_both-edges]"
        >
          {!isEmpty && chat.chatPlan.length > 0 ? (
            // Match the exact horizontal envelope of the header controls.
            // The top offset leaves an 8px visual gap below the 48px pills,
            // including mobile safe-area inset.
            <div className="sticky top-[calc(max(0.5rem,env(safe-area-inset-top))+3.5rem)] z-10 w-full px-3 md:top-[4.25rem] md:px-4">
              <div className="mx-auto w-full max-w-[50rem]">
                <ChatPlanCard
                  todos={chat.chatPlan}
                  totalCount={chat.chatPlanTotalCount}
                  windowed={chat.chatPlanWindowed}
                  onClear={chat.clearChatPlan}
                />
              </div>
            </div>
          ) : null}
          {isEmpty ? (
            <EmptyState
              name={assistantName}
              avatarUrl={assistantAvatarUrl}
              avatarEmoji={assistantAvatarEmoji}
              createdAt={assistantCreatedAt}
            />
          ) : (
            <div className="mx-auto w-full max-w-[50rem] px-3 pt-[5.5rem] pb-[7.5rem] md:px-0 md:pt-24 md:pb-32">
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
                  !previousUserIsSending
                    ? nextEntry?.kind === "activity"
                      ? { kind: "activity" as const, event: nextEntry.event }
                      : { kind: "thinking" as const }
                    : undefined;

                return entry.kind === "message" ? (
                  <ChatMessageBubble
                    key={entry.message.id}
                    chatId={chat.chatId}
                    message={entry.message}
                    preResponseStatus={preResponseStatus}
                    showShadowRoutingLabel={showShadowRoutingBadge}
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
                      entry.message.role === "user" &&
                      entry.message.status.startsWith("send_failed")
                        ? handleRetryPendingSend
                        : undefined
                    }
                    onCancelPendingSend={
                      entry.message.role === "user" &&
                      entry.message.status.startsWith("send_failed")
                        ? handleCancelPendingSend
                        : undefined
                    }
                  />
                ) : null;
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Overlay header: dissolve veil only; opaque pills; messages scroll underneath. */}
        <header
          data-testid="chat-header-chrome"
          className="pointer-events-none absolute inset-x-0 top-0 z-40 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-10 md:px-4 md:pt-3 md:pb-12"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)] [mask-image:linear-gradient(to_top,transparent_0%,#000_55%,#000_100%)] [-webkit-mask-image:linear-gradient(to_top,transparent_0%,#000_55%,#000_100%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-transparent via-bg/20 to-bg/55"
          />
          {/* Same envelope as composer + messages so desktop name/mode sit as one column, not pane edges. */}
          <div className="pointer-events-auto relative mx-auto flex w-full max-w-[50rem] items-center gap-2">
            <button
              type="button"
              onClick={openSidebar}
              className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/45 bg-surface-raised text-text-muted transition-colors active:bg-surface-hover hover:bg-surface-hover hover:text-text md:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <div
              className={cn(
                // Opaque pill only — dissolve is the overlay veil behind, not a translucent shell.
                "flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-border/45 bg-surface-raised py-0 pr-3.5 pl-1.5 transition-colors",
                editing && "border-accent/45"
              )}
            >
              {editing ? (
                <>
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-accent"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                  </span>
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
                      className="min-w-0 flex-1 bg-transparent text-base font-semibold leading-none tracking-tight text-text outline-none md:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void commitEdit()}
                      className="cursor-pointer rounded-full p-1.5 text-accent transition-colors hover:bg-surface-hover"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={startEdit}
                      aria-label="Rename chat"
                      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-bg text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                    </button>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-text-subtle"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                    </span>
                  )}
                  <div
                    className={cn(
                      "flex min-w-0 flex-1 flex-col justify-center",
                      activeSkillEngagement ? "gap-0" : null
                    )}
                  >
                    <h1
                      className={cn(
                        "truncate text-base font-semibold tracking-tight text-text md:text-sm md:font-medium md:tracking-normal md:text-text-muted",
                        activeSkillEngagement ? "leading-[1.1]" : "leading-none"
                      )}
                    >
                      {displayTitle}
                    </h1>
                    <ChatHeaderSubtitle engagement={activeSkillEngagement} />
                  </div>
                </>
              )}
            </div>
            <ChatModeToggle
              mode={chatMode}
              paidLightModeActive={paidLightModeActive}
              disabled={!assistantReady || chat.isStreaming}
              onChange={(mode) => void handleChatModeChange(mode)}
            />
          </div>
        </header>

        <div
          data-testid="chat-footer-chrome"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)] [mask-image:linear-gradient(to_bottom,transparent_0%,#000_55%,#000_100%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,#000_55%,#000_100%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-bg/20 to-bg/55"
          />
          <div className="pointer-events-auto relative pt-8 md:pt-10">
            {/* Issue banner */}
            {chat.issue && !showChatLimitBanner && !showSafetyRestrictedBanner && (
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
                      <p className={`text-base font-medium md:text-sm ${issueTextClass}`}>
                        {t("voiceTranscriptionEmptyTitle")}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t("voiceTranscriptionEmptyGuidance")}
                      </p>
                    </>
                  ) : chat.issue.classId === "compaction_unavailable" ? (
                    <>
                      <p className={`text-base font-medium md:text-sm ${issueTextClass}`}>
                        {t("issueCompactionUnavailable")}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t("issueCompactionUnavailableGuidance")}
                      </p>
                    </>
                  ) : chat.issue.classId === "provider_failure" ? (
                    <>
                      <p className={`text-base font-medium md:text-sm ${issueTextClass}`}>
                        {t("issueProviderFailure")}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t("issueProviderFailureGuidance")}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className={`text-base font-medium md:text-sm ${issueTextClass}`}>
                        {chat.issue.message}
                      </p>
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
                          onClick={() =>
                            setCompactionBannerSnoozedUntilCount(chat.messages.length + 20)
                          }
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
                        <p className="mt-1 text-[11px] text-text-muted">
                          {t("chatActiveLimitDetail")}
                        </p>
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
            {showSafetyRestrictedBanner ? (
              <div className="px-3 md:px-4">
                <div className="mx-auto mb-2 w-full max-w-[50rem] rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive">
                      <AlertCircle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-destructive">
                        {t("safetyRestrictedTitle")}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                        {t(resolveSafetyRestrictedBodyKey(safetyRestrictedReasonCode))}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                        {t("safetyRestrictedDetail")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openSettings("support")}
                          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border/70 bg-bg/70 px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-hover"
                        >
                          {t("safetyRestrictedOpenSupport")}
                        </button>
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
            {showSafetyInboundWarnBanner ? (
              <div className="px-3 md:px-4">
                <div className="mx-auto mb-2 w-full max-w-[50rem] rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 dark:border-amber-400/20 dark:bg-amber-500/10">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-300/80 bg-amber-100/80 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                        {t("safetyInboundWarnTitle")}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                        {t(resolveSafetyInboundWarnBodyKey(safetyInboundWarnReasonCode))}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                        {t("safetyInboundWarnDetail")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openSettings("support")}
                          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border/70 bg-bg/70 px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-hover"
                        >
                          {t("safetyInboundWarnOpenSupport")}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDismissedSafetyWarnMessageId(latestSafetyInboundWarn?.messageId ?? null)
                      }
                      className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:text-text"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {pendingBrowserAssist !== null ? (
              <div className="px-3 md:px-4" data-testid="browser-assist-banner">
                <div className="mx-auto mb-2 flex w-full max-w-[50rem] flex-col gap-2 rounded-xl border border-accent/25 bg-accent/[0.08] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text">
                      {t("browserAssistBannerTitle")}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
                      {pendingBrowserAssist.userActionPrompt ??
                        t("browserAssistBannerBody", { site: pendingBrowserAssist.displayName })}
                    </p>
                    {browserAssistError ? (
                      <p className="mt-1 text-[11px] text-destructive">{browserAssistError}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpenBrowserAssist()}
                      disabled={browserAssistAction !== null}
                      className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-bg px-3 text-xs font-medium text-text transition hover:bg-surface-hover disabled:cursor-wait disabled:opacity-60"
                    >
                      {browserAssistAction === "open" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {t("browserAssistOpen")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCompleteBrowserAssist()}
                      disabled={browserAssistAction !== null}
                      className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg bg-accent px-3 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
                    >
                      {browserAssistAction === "done" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {t("browserLoginAssistDone")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {showBrowserLoginChip ? (
              <div className="px-3 md:px-4">
                <div className="mx-auto mb-2 flex w-full max-w-[50rem] items-center justify-between gap-3 rounded-lg border border-accent/20 bg-accent/[0.06] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-text">
                      {chat.pendingBrowserLogin?.displayName}
                    </p>
                    <p className="truncate text-[11px] text-text-muted">
                      {t(browserLoginChipHintKey)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void chat.abortBrowserLogin()}
                      className="cursor-pointer rounded-lg border border-border/70 px-2.5 py-1 text-[11px] font-medium text-text-muted transition hover:bg-surface-hover hover:text-text"
                    >
                      {t("browserLoginCancel")}
                    </button>
                    <button
                      type="button"
                      onClick={chat.reopenBrowserLogin}
                      className="cursor-pointer rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-accent-hover"
                    >
                      {t("browserLoginContinue")}
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
        </div>

        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className={cn(
              "absolute right-3 bottom-[5.25rem] z-30 inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-surface-raised/90 px-3 py-2 text-xs font-medium text-text-muted shadow-lg shadow-black/5 backdrop-blur-md transition-all",
              "hover:-translate-y-0.5 hover:border-accent/30 hover:bg-surface-hover hover:text-text active:translate-y-0 md:right-auto md:bottom-24 md:left-1/2 md:-translate-x-1/2"
            )}
            aria-label={t("scrollToBottom")}
            title={t("scrollToBottom")}
          >
            <ArrowDown className="h-4 w-4" />
            <span className="hidden sm:inline">{t("scrollToBottom")}</span>
          </button>
        )}
      </div>

      <BrowserLoginModal
        open={chat.browserLoginModalOpen && chat.pendingBrowserLogin?.completionMode !== "assist"}
        assistantId={assistantId}
        pendingBrowserLogin={chat.pendingBrowserLogin}
        onDismiss={chat.dismissBrowserLogin}
        onCancel={() => void chat.abortBrowserLogin()}
        onCompleted={chat.clearPendingBrowserLogin}
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

function chatModeCaption(
  t: ReturnType<typeof useTranslations>,
  mode: AssistantChatMode,
  paidLightModeActive: boolean
): string {
  if (paidLightModeActive && mode !== "normal") {
    return t("modeLimitReachedCaption");
  }
  switch (mode) {
    case "project":
      return t("modeProjectCaption");
    case "smart":
      return t("modeDeepCaption");
    default:
      return t("modeNormalCaption");
  }
}

/**
 * Second line inside the name pill.
 *
 * Prefer the chat-level active skill engagement (`skill · scenario`).
 * Mode itself lives in the third header control, so we no longer duplicate
 * the mode caption here.
 */
function ChatHeaderSubtitle({
  engagement
}: {
  engagement: { skillDisplayName: string; scenarioDisplayName: string | null } | null;
}) {
  if (engagement === null) return null;

  const fullSkillText = engagement.scenarioDisplayName
    ? `${engagement.skillDisplayName} · ${engagement.scenarioDisplayName}`
    : engagement.skillDisplayName;

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium leading-[1.1] tracking-wide text-text-subtle"
      title={fullSkillText}
    >
      <span className="truncate max-w-[10rem] md:max-w-[22rem]">
        <span className="font-semibold text-text-muted">{engagement.skillDisplayName}</span>
        {engagement.scenarioDisplayName ? (
          <>
            <span aria-hidden className="px-1 text-text-subtle/50">
              ·
            </span>
            <span className="text-text-subtle">{engagement.scenarioDisplayName}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function ChatModeIcon({
  mode,
  className,
  muted = false
}: {
  mode: AssistantChatMode;
  className?: string;
  muted?: boolean;
}) {
  if (mode === "project") {
    return <FolderKanban className={className} />;
  }
  if (mode === "smart") {
    return <Sparkles className={cn(className, !muted && "animate-pulse")} />;
  }
  return <MessageSquare className={className} />;
}

function ChatModeToggle({
  mode,
  paidLightModeActive,
  disabled,
  onChange
}: {
  mode: AssistantChatMode;
  paidLightModeActive: boolean;
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
      if (paidLightModeActive && nextMode !== "normal") {
        return;
      }
      setMenuOpen(false);
      onChange(nextMode);
    },
    [onChange, paidLightModeActive]
  );

  return (
    <div className="shrink-0">
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("modeMenuAria", { mode: chatModeLabel(t, mode) })}
          title={chatModeCaption(t, mode, paidLightModeActive)}
          onClick={() => setMenuOpen((open) => !open)}
          className={cn(
            // Height matches composer/header pills (h-12). Mobile = icon circle; desktop = text pill.
            "inline-flex h-12 cursor-pointer items-center justify-center rounded-full border border-border/45 bg-surface-raised transition-colors",
            "w-12 md:w-auto md:gap-1.5 md:px-3.5",
            mode !== "normal" && "border-accent-premium/25 text-accent-premium",
            mode === "normal" && "text-text-muted",
            menuOpen && "border-border-strong",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          <ChatModeIcon
            mode={mode}
            className={cn(
              "h-5 w-5 md:h-4 md:w-4",
              mode === "normal" ? "text-text-muted" : "text-accent-premium"
            )}
          />
          <span className="hidden text-xs font-semibold md:inline">{chatModeLabel(t, mode)}</span>
          <ChevronDown
            className={cn(
              "hidden h-3.5 w-3.5 text-text-subtle transition-transform md:block",
              menuOpen && "rotate-180"
            )}
          />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("modeMenuAria", { mode: chatModeLabel(t, mode) })}
            className="absolute top-full right-0 z-50 mt-2 flex min-w-[12rem] max-w-[calc(100vw-1rem)] flex-col gap-1 rounded-[1.25rem] border border-border/45 bg-surface-raised p-1.5 md:min-w-[13rem]"
          >
            {CHAT_MODES.map((option) => {
              const optionLimited = paidLightModeActive && option !== "normal";
              return (
                <button
                  key={option}
                  type="button"
                  role="menuitem"
                  aria-current={mode === option ? "true" : undefined}
                  aria-disabled={optionLimited ? "true" : undefined}
                  disabled={disabled || optionLimited}
                  onClick={() => selectMode(option)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left text-xs font-semibold transition-colors",
                    optionLimited ? "cursor-not-allowed opacity-45" : "cursor-pointer",
                    mode === option
                      ? option === "normal"
                        ? "bg-surface text-text"
                        : "bg-accent-premium/10 text-accent-premium"
                      : optionLimited
                        ? "text-text-subtle"
                        : "text-text-muted hover:bg-surface-hover hover:text-text",
                    disabled && !optionLimited && "cursor-not-allowed opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-surface/80",
                      mode === option &&
                        option !== "normal" &&
                        "border-accent-premium/30 bg-accent-premium/10"
                    )}
                  >
                    <ChatModeIcon
                      mode={option}
                      className={cn(
                        "h-4 w-4",
                        optionLimited
                          ? "text-text-subtle"
                          : option === "normal"
                            ? "text-text-muted"
                            : "text-accent-premium"
                      )}
                      muted={optionLimited}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block">{chatModeLabel(t, option)}</span>
                    <span
                      className={cn(
                        "block text-[11px] font-normal",
                        optionLimited ? "text-text-subtle/80" : "text-text-subtle"
                      )}
                    >
                      {chatModeCaption(t, option, paidLightModeActive)}
                    </span>
                  </span>
                </button>
              );
            })}
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
    <div className="flex h-full flex-col items-center justify-center px-6 pt-[5.5rem] pb-[7.5rem] text-center md:pt-24 md:pb-32">
      <AssistantAvatar avatarUrl={avatarUrl} avatarEmoji={avatarEmoji} size="lg" className="mb-6" />
      <h2 className="text-xl font-semibold text-text">{assistantName}</h2>
      <p className="mt-2 text-base text-text-muted md:text-sm">{greeting}</p>
      {daysTogether !== null && daysTogether > 1 && (
        <p className="mt-4 rounded-full bg-surface-raised px-4 py-1.5 text-[11px] text-text-subtle">
          {t("togetherFor", { days: daysTogether })}
        </p>
      )}
    </div>
  );
}
