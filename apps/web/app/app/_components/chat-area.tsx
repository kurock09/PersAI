"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  FolderKanban,
  X,
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
  CHAT_CHROME_PADDING_DESKTOP_PX,
  CHAT_CHROME_PADDING_MOBILE_PX,
  shouldShowChatAssistantAvatars
} from "./chat-layout";
import {
  type AssistantChatMode,
  type ChatCompactionState,
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
  const stageRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [showAssistantAvatars, setShowAssistantAvatars] = useState(false);
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

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      const desktopChrome =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(min-width: 600px)").matches;
      setShowAssistantAvatars(
        shouldShowChatAssistantAvatars({
          stageWidthPx: stage.clientWidth,
          chromePaddingPx: desktopChrome
            ? CHAT_CHROME_PADDING_DESKTOP_PX
            : CHAT_CHROME_PADDING_MOBILE_PX
        })
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
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

  // ADR-125 follow-up — read the chat-level engagement projection that the
  // API derives from `chat.skillDecisionState` and ships in (a) the history
  // endpoint response on load, (b) the SSE turn-completion payload on each
  // turn. Walking messages was unreliable because reconstructed history
  // messages dropped `engagementSummary`, so the chip disappeared a few
  // seconds after every history reload.
  const activeSkillEngagement = chat.currentEngagement;

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
  const hasChatPlan = !isEmpty && chat.chatPlan.length > 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Stage: messages full-bleed under transparent chrome; edge fade is on the scroll pane (TG). */}
      <div ref={stageRef} className="relative min-h-0 flex-1">
        {/* Full-bleed message scroll — content fades at top/bottom; pills/composer stay opaque overlays. */}
        <div
          ref={scrollRef}
          data-testid="chat-message-scroll"
          className={cn(
            "absolute inset-0 overflow-x-hidden overflow-y-auto",
            // ~pill height top / ~composer height bottom — text softens to the browser edge under chrome.
            "[mask-image:linear-gradient(to_bottom,transparent_0,black_3.75rem,black_calc(100%-5rem),transparent_100%)]",
            "[-webkit-mask-image:linear-gradient(to_bottom,transparent_0,black_3.75rem,black_calc(100%-5rem),transparent_100%)]"
          )}
        >
          {isEmpty ? (
            <EmptyState
              name={assistantName}
              avatarUrl={assistantAvatarUrl}
              avatarEmoji={assistantAvatarEmoji}
              createdAt={assistantCreatedAt}
            />
          ) : (
            <div
              className={cn(
                "mx-auto w-full max-w-[50rem] px-3 pb-[7.5rem] md:px-4 md:pb-32",
                hasChatPlan ? "pt-[8.75rem] md:pt-[8.5rem]" : "pt-[5.5rem] md:pt-24"
              )}
            >
              {" "}
              <div ref={sentinelRef} className="h-1" />
              {chat.olderMessagesLoading && (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
                </div>
              )}
              {(() => {
                const notifyCount = !chat.isStreaming
                  ? (chat.activeMediaJobs ?? []).filter(
                      (job) =>
                        job.notifyState !== undefined &&
                        job.notifyState !== "none" &&
                        ["subscribed", "ready", "claimed", "dispatched"].includes(job.notifyState)
                    ).length +
                    (chat.activeDocumentJobs ?? []).filter(
                      (job) =>
                        job.notifyState !== undefined &&
                        job.notifyState !== "none" &&
                        ["subscribed", "ready", "claimed", "dispatched"].includes(job.notifyState)
                    ).length +
                    (chat.activeSandboxJobs ?? []).filter((job) =>
                      ["subscribed", "ready", "claimed", "dispatched"].includes(job.notifyState)
                    ).length
                  : 0;
                const backgroundWaitFooter =
                  notifyCount === 0
                    ? null
                    : notifyCount === 1
                      ? t("waitingForBackgroundJob")
                      : t("waitingForBackgroundJobs", { count: notifyCount });
                let lastAssistantMessageId: string | null = null;
                for (let i = chat.entries.length - 1; i >= 0; i -= 1) {
                  const entry = chat.entries[i];
                  if (entry?.kind === "message" && entry.message.role === "assistant") {
                    lastAssistantMessageId = entry.message.id;
                    break;
                  }
                }

                return chat.entries.map((entry, index) => {
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
                      showAssistantAvatar={showAssistantAvatars}
                      onAssistantAction={handleAssistantAction}
                      onDocumentJobAccepted={onDocumentJobAccepted}
                      backgroundWaitFooter={
                        entry.message.id === lastAssistantMessageId ? backgroundWaitFooter : null
                      }
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
                });
              })()}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Overlay header: fully transparent shell; opaque pills only. */}
        <header
          data-testid="chat-header-chrome"
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-40 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] md:px-4 md:pt-3",
            hasChatPlan ? "pb-14 md:pb-16" : "pb-10 md:pb-12"
          )}
        >
          {/* Same envelope as composer + messages: name/mode and plan share one column.
              @container drives mode/plan circle↔pill at chat width 500px (not viewport md). */}
          <div className="@container pointer-events-auto relative mx-auto flex w-full max-w-[50rem] flex-col gap-2">
            <div className="flex w-full items-center gap-2">
              <button
                type="button"
                onClick={openSidebar}
                className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/45 bg-surface-raised text-text-muted transition-colors active:bg-surface-hover hover:bg-surface-hover hover:text-text md:hidden"
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" strokeWidth={1.15} />
              </button>
              <div
                data-testid="chat-title-pill"
                className={cn(
                  // Opaque pill — edge dissolve lives on the message scroll mask, not behind chrome.
                  // p-[3px] keeps the left meter circle coaxial with the rounded cap (same inset as composer).
                  // overflow-hidden clips the expanding context meter to this pill.
                  "relative flex h-12 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full border border-border/45 bg-surface-raised p-[3px] pr-3.5 transition-colors"
                )}
              >
                <ChatContextMeter
                  compaction={chat.compaction}
                  compactionRunning={chat.compactionRunning}
                  compactDisabled={!chat.chatId || chat.isStreaming}
                  onCompact={() => void chat.compactNow()}
                />
                <div
                  className={cn(
                    // Stay under the expanding meter (sibling paint order otherwise wins).
                    "relative z-0 flex min-w-0 flex-1 flex-col justify-center",
                    activeSkillEngagement ? "gap-1" : null
                  )}
                >
                  <h1 className="truncate text-sm font-semibold leading-none tracking-tight text-text">
                    {displayTitle}
                  </h1>
                  <ChatHeaderSubtitle engagement={activeSkillEngagement} />
                </div>
              </div>
              <ChatModeToggle
                mode={chatMode}
                paidLightModeActive={paidLightModeActive}
                disabled={!assistantReady || chat.isStreaming}
                onChange={(mode) => void handleChatModeChange(mode)}
              />
            </div>
            {hasChatPlan ? (
              <ChatPlanCard
                todos={chat.chatPlan}
                totalCount={chat.chatPlanTotalCount}
                windowed={chat.chatPlanWindowed}
                onClear={chat.clearChatPlan}
              />
            ) : null}
          </div>
        </header>

        <div
          data-testid="chat-footer-chrome"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40"
        >
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
              activeSandboxJobs={chat.activeSandboxJobs ?? []}
              showScrollToBottom={showScrollToBottom}
              onScrollToBottom={() => scrollToBottom("smooth")}
            />
          </div>
        </div>
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
      className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium leading-none tracking-wide text-text-subtle"
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

function resolveContextMeter(compaction: ChatCompactionState | null): {
  ratio: number | null;
  percent: number | null;
  triggerTokens: number | null;
  currentTokens: number | null;
} {
  if (!compaction) {
    return { ratio: null, percent: null, triggerTokens: null, currentTokens: null };
  }
  const triggerTokens = Math.max(1, compaction.reserveTokens - compaction.keepRecentTokens);
  const currentTokens = compaction.currentTokens;
  if (typeof currentTokens !== "number") {
    return { ratio: null, percent: null, triggerTokens, currentTokens: null };
  }
  const ratio = currentTokens / triggerTokens;
  const percent = Math.round(Math.min(999, Math.max(0, ratio * 100)));
  return { ratio, percent, triggerTokens, currentTokens };
}

const CONTEXT_METER_SHELL_MS = 300;
const CONTEXT_METER_RING_REVEAL_MS = 650;

function ChatContextMeter({
  compaction,
  compactionRunning,
  compactDisabled,
  onCompact
}: {
  compaction: ChatCompactionState | null;
  compactionRunning: boolean;
  compactDisabled: boolean;
  onCompact: () => void;
}) {
  const t = useTranslations("chat");
  const [expanded, setExpanded] = useState(false);
  /** Progress ring stays hidden until the pill→circle width transition finishes. */
  const [ringReady, setRingReady] = useState(true);
  /** One-shot spin when the ring first reappears after collapse. */
  const [ringRevealSpin, setRingRevealSpin] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const wasExpandedRef = useRef(false);
  const meter = resolveContextMeter(compaction);
  const progress = meter.ratio === null ? 0 : Math.min(1, Math.max(0, meter.ratio));
  const overThreshold = meter.ratio !== null && meter.ratio >= 1;
  const size = 42;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  // Indeterminate busy arc (~28% of the ring) while compaction runs.
  const busyDash = `${String(circumference * 0.28)} ${String(circumference * 0.72)}`;
  const percentLabel =
    meter.percent === null ? "–" : meter.percent > 99 ? "99+%" : `${String(meter.percent)}%`;
  const ariaPercent =
    meter.percent === null
      ? t("contextMeterAriaUnknown")
      : t("contextMeterAria", { percent: meter.percent });
  const compactBlocked = compactDisabled || compactionRunning || !compaction;
  const showRing = !expanded && ringReady;
  const ringBusy = showRing && compactionRunning && !ringRevealSpin;

  useEffect(() => {
    if (compactionRunning) {
      setExpanded(false);
      // Skip the collapse-width delay — show the busy arc immediately.
      setRingReady(true);
      setRingRevealSpin(false);
    }
  }, [compactionRunning]);

  useEffect(() => {
    if (expanded) {
      wasExpandedRef.current = true;
      setRingReady(false);
      setRingRevealSpin(false);
      return;
    }
    // Compaction already forced the ring on; don't schedule a reveal delay.
    if (compactionRunning) {
      return;
    }
    // Initial mount: keep the static ring, no reveal spin.
    if (!wasExpandedRef.current) {
      setRingReady(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setRingReady(true);
      setRingRevealSpin(true);
    }, CONTEXT_METER_SHELL_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, compactionRunning]);

  useEffect(() => {
    if (!ringRevealSpin) return;
    const timer = window.setTimeout(() => {
      setRingRevealSpin(false);
    }, CONTEXT_METER_RING_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [ringRevealSpin]);

  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setExpanded(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const runCompact = () => {
    if (compactBlocked) return;
    setExpanded(false);
    onCompact();
  };

  return (
    <div ref={rootRef} className="relative z-20 aspect-square h-full shrink-0">
      <div
        data-testid="chat-context-meter-shell"
        className={cn(
          // Solid opaque gray — never mix --border (it carries alpha and lets the title bleed through).
          "absolute top-0 left-0 z-20 flex h-full overflow-hidden rounded-full bg-surface-hover transition-[width] duration-300 ease-out",
          expanded ? "w-[12.5rem]" : "w-full"
        )}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={expanded}
          aria-label={ariaPercent}
          data-testid="chat-context-meter"
          disabled={compactionRunning}
          onClick={() => {
            if (compactionRunning) return;
            setExpanded((open) => !open);
          }}
          className={cn(
            "relative flex aspect-square h-full shrink-0 items-center justify-center rounded-full transition-colors",
            compactionRunning ? "cursor-wait" : "cursor-pointer hover:bg-black/[0.04]"
          )}
        >
          {showRing ? (
            <svg
              data-testid="chat-context-meter-progress"
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              className={cn(
                "pointer-events-none absolute inset-0 h-full w-full",
                ringRevealSpin && "context-meter-ring-reveal",
                ringBusy && "animate-spin"
              )}
              aria-hidden="true"
            >
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={ringBusy || ringRevealSpin ? busyDash : circumference}
                strokeDashoffset={ringBusy || ringRevealSpin ? 0 : dashOffset}
                transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
                className={cn(
                  ringBusy || ringRevealSpin
                    ? "text-accent"
                    : "transition-[stroke-dashoffset] duration-500 ease-out",
                  !ringBusy && !ringRevealSpin && meter.ratio === null
                    ? "text-transparent"
                    : !ringBusy && !ringRevealSpin && overThreshold
                      ? "text-accent"
                      : !ringBusy && !ringRevealSpin
                        ? "text-accent/80"
                        : null
                )}
              />
            </svg>
          ) : null}
          <span
            className={cn(
              "relative z-[1] max-w-[2.1rem] truncate text-center text-[9px] font-medium tabular-nums leading-none tracking-tight",
              meter.ratio === null ? "text-text-muted/55" : "text-text-muted",
              (ringBusy || ringRevealSpin) && "opacity-70"
            )}
          >
            {percentLabel}
          </span>
        </button>

        <div
          className={cn(
            "flex h-full min-w-0 flex-col items-center justify-center overflow-hidden px-1 text-center transition-[max-width,opacity] duration-300 ease-out",
            // flex-1 (no max-width) so leftover width sits in the text slot — scissors stay flush on the right end-cap.
            expanded ? "min-w-0 flex-1 opacity-100" : "max-w-0 flex-none opacity-0"
          )}
          aria-hidden={!expanded}
        >
          <p className="w-full truncate text-sm font-semibold leading-none tracking-tight text-text">
            {t("contextMeterMenuTitle")}
          </p>
          <button
            type="button"
            tabIndex={expanded ? 0 : -1}
            data-testid="chat-context-meter-compact-link"
            disabled={compactBlocked}
            onClick={runCompact}
            className={cn(
              "mt-1 block w-full truncate text-center text-[11px] leading-none underline-offset-2 transition-colors",
              compactBlocked
                ? "cursor-not-allowed text-text-subtle"
                : "cursor-pointer text-text-muted hover:text-text hover:underline"
            )}
          >
            {t("compactionAction")}
          </button>
        </div>
        <button
          type="button"
          tabIndex={expanded ? 0 : -1}
          data-testid="chat-context-meter-compact-scissors"
          aria-label={t("compactionAction")}
          disabled={compactBlocked}
          onClick={runCompact}
          aria-hidden={!expanded}
          className={cn(
            // Flush to the pill's right end-cap (same diameter as height) so hover + icon share that circle's center.
            "grid shrink-0 place-items-center rounded-full text-text-muted transition-[width,opacity,colors] duration-300 disabled:pointer-events-none disabled:opacity-40",
            "hover:bg-black/[0.04] hover:text-text",
            expanded
              ? "aspect-square h-full opacity-100"
              : "pointer-events-none h-full w-0 overflow-hidden opacity-0"
          )}
        >
          <Scissors className="pointer-events-none block size-3.5 shrink-0" strokeWidth={1.15} />
        </button>
      </div>
    </div>
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
            // Height matches composer/header pills (h-12). Narrow chat (<500px) = icon circle; wider = text pill.
            "inline-flex h-12 cursor-pointer items-center justify-center rounded-full border border-border/45 bg-surface-raised transition-colors",
            "w-12 @[500px]:w-32 @[500px]:gap-1.5 @[500px]:px-3.5",
            mode !== "normal" && "border-accent-premium/25 text-accent-premium",
            mode === "normal" && "text-text-muted",
            menuOpen && "border-border-strong",
            disabled && "cursor-not-allowed brightness-95 saturate-75"
          )}
        >
          <ChatModeIcon
            mode={mode}
            className={cn(
              "h-5 w-5 @[500px]:h-4 @[500px]:w-4",
              mode === "normal" ? "text-text-muted" : "text-accent-premium"
            )}
          />
          <span className="hidden text-xs font-semibold @[500px]:inline">
            {chatModeLabel(t, mode)}
          </span>
          <ChevronDown
            className={cn(
              "hidden h-3.5 w-3.5 text-text-subtle transition-transform @[500px]:block",
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
