"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { useUser, useClerk } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import type { Route } from "next";
import {
  AlertTriangle,
  OctagonX,
  MessageSquarePlus,
  MessageCircle,
  X,
  MoreHorizontal,
  Loader2,
  Shield,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  FolderKanban,
  Sparkles,
  Sun,
  Moon,
  Monitor,
  LogOut,
  Settings,
  ChevronDown
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/app/lib/utils";
import { AssistantAvatar } from "./assistant-avatar";
import type { AppData, AssistantStatus } from "./use-app-data";
import type { AssistantWebChatListItemState } from "@persai/contracts";
import { useTheme } from "./use-theme";
import { useNetworkOnline } from "./use-network-online";
import { resolveBillingSummaryCopy } from "./billing-summary";
import { AndroidAppDownloadBanner } from "../../_components/android-app-download-banner";
import { navigateAfterClerkAuth } from "@/app/lib/clerk-navigation";
import { isWebLocale, switchWebLocale } from "@/app/lib/locale-sync";
import {
  patchAssistantWebChat,
  postAssistantWebChatArchive,
  postAssistantWebChatUnarchive,
  deleteAssistantWebChat
} from "../assistant-api-client";
import {
  resolveAssistantStatusLineText,
  useAssistantLiveRoleName
} from "./use-assistant-live-role-name";
import {
  useHasThreadActiveDocumentJobs,
  useHasThreadActiveMediaJobs,
  useIsThreadStreaming
} from "./streaming-threads";
import { PullToRefresh } from "./pull-to-refresh";
import { ProjectFilesPanel } from "./project-files-panel";
import {
  SIDEBAR_CARD_SETTINGS_AFFORDANCE_CLASS,
  SIDEBAR_CARD_SETTINGS_ICON_CLASS,
  SIDEBAR_CARD_SAFETY_RESTRICTED_AFFORDANCE_CLASS,
  SIDEBAR_CARD_SAFETY_WARN_AFFORDANCE_CLASS
} from "./sidebar-card-settings-affordance";
import { AssistantSafetyStandingModal } from "./assistant-safety-standing-modal";

interface SidebarProps {
  onClose?: () => void;
  onAssistantCardClick?: () => void;
  onTelegramClick?: () => void;
  onLimitsClick?: () => void;
  onOpenSupportClick?: () => void;
  data: AppData;
  supportUnreadCount?: number;
  /**
   * Optional pull-to-refresh handler attached to the chat-list scroll
   * container. Provided by the mobile overlay in `app-shell.tsx` so that a
   * swipe-down inside the open sidebar refreshes only the chat list. The
   * desktop sidebar passes the same handler harmlessly — touch events do
   * not fire on pointer devices, so it is a no-op on a mouse.
   */
  onPullToRefresh?: () => Promise<void> | void;
}

const STATUS_CONFIG: Record<AssistantStatus, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-success" },
  applying: { label: "Applying...", dot: "bg-warning" },
  draft: { label: "Draft", dot: "bg-text-subtle" },
  failed: { label: "Failed", dot: "bg-destructive" },
  degraded: { label: "Degraded", dot: "bg-warning" },
  none: { label: "Not created", dot: "bg-text-subtle" }
};

/** Mouse/trackpad surfaces keep the compact portal menu; everything else is touch-first. */
const FINE_POINTER_CHAT_LIST_QUERY = "(hover: hover) and (pointer: fine)";
const MOBILE_ROW_ACTIONS_IDLE_MS = 10_000;
const MOBILE_SWIPE_ARCHIVE_WIDTH_PX = 96;
const MOBILE_SWIPE_ARCHIVE_TRIGGER_PX = 68;
const MOBILE_INLINE_ACTIONS_FALLBACK_WIDTH_PX = 176;

function usesTouchChatListActions(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia(FINE_POINTER_CHAT_LIST_QUERY).matches
  );
}

function sortChatsByRecency(chats: AssistantWebChatListItemState[]) {
  return [...chats].sort((a, b) => {
    const da = a.chat.lastMessageAt ?? a.chat.createdAt;
    const db = b.chat.lastMessageAt ?? b.chat.createdAt;
    return new Date(db).getTime() - new Date(da).getTime();
  });
}

/**
 * Context-aware timestamp for the chat list right edge.
 *
 * The list is already grouped by Today / Yesterday / This week / Older, so
 * per-row timestamps repeat the group label when shown unconditionally. To
 * keep the row readable we collapse to the smallest informative unit per
 * group: HH:MM for today and yesterday, weekday short for this week, "d MMM"
 * for older.
 */
export function formatChatRowTimestamp(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86_400_000);
  if (d >= yesterdayStart) {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
  }
  if (d >= weekStart) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

function groupChatsByDate(
  chats: AssistantWebChatListItemState[],
  labels: { today: string; yesterday: string; previous7: string; older: string }
) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86_400_000);

  const groups: { label: string; items: AssistantWebChatListItemState[] }[] = [
    { label: labels.today, items: [] },
    { label: labels.yesterday, items: [] },
    { label: labels.previous7, items: [] },
    { label: labels.older, items: [] }
  ];

  const sorted = sortChatsByRecency(chats.filter((chat) => chat.chat.archivedAt === null));

  for (const chat of sorted) {
    const d = new Date(chat.chat.lastMessageAt ?? chat.chat.createdAt);
    if (d >= todayStart) groups[0]!.items.push(chat);
    else if (d >= yesterdayStart) groups[1]!.items.push(chat);
    else if (d >= weekStart) groups[2]!.items.push(chat);
    else groups[3]!.items.push(chat);
  }

  return groups.filter((g) => g.items.length > 0);
}

function shouldShowAndroidSidebarDownload(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const maybeNative = window as unknown as {
    PersaiNative?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (
    maybeNative.PersaiNative ||
    (typeof maybeNative.Capacitor?.isNativePlatform === "function" &&
      maybeNative.Capacitor.isNativePlatform())
  ) {
    return false;
  }
  return /Android/i.test(window.navigator.userAgent);
}

export function Sidebar({
  onClose,
  onAssistantCardClick,
  onTelegramClick,
  onLimitsClick,
  onOpenSupportClick,
  data,
  supportUnreadCount = 0,
  onPullToRefresh
}: SidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isOnline, recheck } = useNetworkOnline();
  const activeThread = searchParams.get("thread");
  const [mounted, setMounted] = useState(false);
  const [showAndroidSidebarDownload, setShowAndroidSidebarDownload] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setShowAndroidSidebarDownload(shouldShowAndroidSidebarDownload());
  }, []);

  const t = useTranslations("sidebar");
  const ts = useTranslations("settings");
  const locale = useLocale();
  const { getToken } = useAuth();
  const statusCfg = STATUS_CONFIG[data.assistantStatus];
  const statusLabelMap: Record<string, string> = {
    live: ts("live"),
    applying: ts("applying"),
    draft: ts("draft"),
    failed: ts("failed"),
    degraded: ts("degraded"),
    none: ts("notCreated")
  };
  const statusLabel = statusLabelMap[data.assistantStatus] ?? statusCfg.label;
  const liveRoleName = useAssistantLiveRoleName({
    assistantId: data.assistant?.id,
    assistantStatus: data.assistantStatus,
    locale,
    getToken
  });
  const statusLineLabel = resolveAssistantStatusLineText({
    status: data.assistantStatus,
    statusLabel,
    liveRoleName
  });
  const assistantName = data.assistant?.draft.displayName ?? t("defaultAssistant");
  const hasUnreadSupport = supportUnreadCount > 0;
  const hasMultiAssistantAccess = (data.assistantLimit?.maxAssistants ?? 1) > 1;
  const [safetyModalKind, setSafetyModalKind] = useState<"warn" | "restricted" | null>(null);
  const [mobileArchiveRevealed, setMobileArchiveRevealed] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const userSafetyStanding = data.userSafetyStanding?.standing ?? "none";
  const safetyDaysRemaining = data.userSafetyStanding?.daysRemaining ?? null;
  /*
   * Hydration safety: groupChatsByDate / formatChatRowTimestamp depend on
   * `new Date()` and the device timezone. On the server (UTC pod) and on
   * the client (local TZ) this can yield different group buckets and
   * timestamp strings, which trips React error #418 in production builds
   * and forces a full client re-render. In Capacitor's WebView that
   * re-render reliably loses freshly-mounted pointer event handlers
   * (mic hold-to-record, attachment menu, etc.). We defer all date-aware
   * rendering until after mount so the SSR and first client render are
   * structurally identical.
   */
  const chatGroups = mounted
    ? groupChatsByDate(data.chats, {
        today: t("today"),
        yesterday: t("yesterday"),
        previous7: t("previous7"),
        older: t("older")
      })
    : [];
  const archivedChats = mounted
    ? sortChatsByRecency(data.chats.filter((item) => item.chat.archivedAt !== null))
    : [];
  useEffect(() => {
    if (mounted && archivedChats.length === 0) {
      setMobileArchiveRevealed(false);
      setArchiveExpanded(false);
    }
  }, [archivedChats.length, mounted]);
  const activeProjectChat =
    mounted && activeThread
      ? data.chats.find(
          (item) =>
            item.chat.surfaceThreadKey === activeThread &&
            item.chat.archivedAt === null &&
            item.chat.chatMode === "project"
        )
      : undefined;
  const guardedNavigate = useCallback(
    async (navigate: () => void) => {
      if (!isOnline) {
        return;
      }
      const confirmedOnline = await recheck();
      if (!confirmedOnline) {
        return;
      }
      navigate();
    },
    [isOnline, recheck]
  );
  return (
    <aside className="relative flex h-dvh w-full shrink-0 flex-col overflow-hidden border-r border-border bg-surface md:h-full md:w-full md:rounded-[1.375rem] md:border md:border-border">
      {/* Mobile close button */}
      {onClose && (
        <div className="flex justify-end px-2 pt-2 md:hidden">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* 1. Assistant card */}
      <div className={cn("relative px-3", onClose ? "pt-1 pb-3" : "pt-4 pb-3")}>
        <div className="group relative flex w-full items-center gap-0 overflow-hidden rounded-xl bg-surface-raised p-3 transition-colors hover:bg-surface-hover">
          {hasMultiAssistantAccess ? (
            <span
              data-testid="assistant-card-premium-strip"
              aria-hidden="true"
              className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gradient-to-b from-[#b9c9a8]/90 via-[#d7c48d]/85 to-[#c29d62]/85"
            />
          ) : null}
          <button
            type="button"
            onClick={onAssistantCardClick}
            aria-label={t("assistantSettingsHint")}
            title={t("assistantSettingsHint")}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 bg-transparent text-left"
          >
            <AssistantAvatar
              avatarUrl={data.assistant?.draft.avatarUrl ?? undefined}
              avatarEmoji={data.assistant?.draft.avatarEmoji ?? undefined}
              size="md"
            />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-base font-semibold text-text md:text-sm">
                {assistantName}
              </p>
              {hasUnreadSupport ? (
                <span className="flex items-center gap-1.5 text-xs text-accent">
                  <MessageCircle className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {t("supportUnreadStatus", { count: supportUnreadCount })}
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className={cn("inline-block h-2 w-2 rounded-full", statusCfg.dot)} />
                  <span className="text-xs text-text-muted">{statusLineLabel}</span>
                </span>
              )}
            </div>
          </button>
          <div className="ml-1 flex shrink-0 items-center gap-0.5">
            {userSafetyStanding === "restricted" ? (
              <button
                type="button"
                aria-label={t("safetyRestrictedIconAria")}
                className={SIDEBAR_CARD_SAFETY_RESTRICTED_AFFORDANCE_CLASS}
                onClick={() => setSafetyModalKind("restricted")}
              >
                <OctagonX className={SIDEBAR_CARD_SETTINGS_ICON_CLASS} />
              </button>
            ) : userSafetyStanding === "warn" ? (
              <button
                type="button"
                aria-label={t("safetyWarnIconAria")}
                className={SIDEBAR_CARD_SAFETY_WARN_AFFORDANCE_CLASS}
                onClick={() => setSafetyModalKind("warn")}
              >
                <AlertTriangle className={SIDEBAR_CARD_SETTINGS_ICON_CLASS} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAssistantCardClick}
              aria-hidden="true"
              tabIndex={-1}
              className={SIDEBAR_CARD_SETTINGS_AFFORDANCE_CLASS}
            >
              <Settings className={SIDEBAR_CARD_SETTINGS_ICON_CLASS} />
            </button>
          </div>
        </div>
        {safetyModalKind !== null ? (
          <AssistantSafetyStandingModal
            kind={safetyModalKind}
            daysRemaining={safetyDaysRemaining}
            onClose={() => setSafetyModalKind(null)}
            onOpenSupport={() => onOpenSupportClick?.()}
          />
        ) : null}
      </div>

      {/* 2. New chat button — ghost so it doesn't outweigh the active chat */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => {
            void guardedNavigate(() => {
              onClose?.();
              router.push("/app/chat" as Route);
            });
          }}
          className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-base font-medium text-text transition-colors hover:border-border-strong hover:bg-surface-hover [@media(hover:hover)_and_(pointer:fine)]:h-9 [@media(hover:hover)_and_(pointer:fine)]:text-sm"
        >
          <MessageSquarePlus className="h-4 w-4 text-text-muted" />
          {t("newChat")}
        </button>
      </div>

      {/*
       * 3. Chat list (scrollable).
       *
       * Wrapped in `PullToRefresh` when the consumer (the mobile overlay in
       * `app-shell.tsx`) supplies an `onPullToRefresh` handler. Pulling down
       * inside the open sidebar refreshes only the chat list via
       * `data.reloadChats` — it does not reload the home dashboard
       * underneath. On desktop / pointer devices the handler is a no-op
       * because touch events never fire.
       *
       * ADR-076 Slice 5 — targeted skeleton policy:
       *   - `isLoading` (cold start without SSR seed) shows a few ghost rows
       *     so the sidebar never feels empty during fan-out.
       *   - `isReloadingChats` only triggers the skeleton when the visible
       *     list happens to be empty (e.g. right after deleting the last
       *     chat). When chats are still visible we keep them on screen —
       *     no global spinner, no flash, just steady content.
       *   - `isLoading` no longer trips on `reload()` for assistant
       *     mutations (that path uses `isReloading` now), so settings saves
       *     never wipe the sidebar.
       */}
      {(() => {
        const renderChatItem = (item: AssistantWebChatListItemState) => (
          <ChatListItem
            key={item.chat.id}
            item={item}
            assistantId={data.activeAssistantId}
            locale={locale}
            isActive={activeThread === item.chat.surfaceThreadKey}
            onNavigate={() => {
              const url = `/app/chat?thread=${encodeURIComponent(item.chat.surfaceThreadKey)}`;
              void guardedNavigate(() => {
                onClose?.();
                router.push(url as Route);
              });
            }}
            onChanged={data.reloadChats}
          />
        );

        const archiveGroup =
          archivedChats.length > 0 ? (
            <div
              data-testid="archived-chat-group"
              className={cn("mb-3", mobileArchiveRevealed ? "block" : "hidden md:block")}
            >
              <button
                type="button"
                aria-expanded={archiveExpanded}
                onClick={() => setArchiveExpanded((expanded) => !expanded)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                  <Archive className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-medium md:text-xs">
                  {t("archivedChats")}
                </span>
                <span className="text-xs tabular-nums text-text-subtle">
                  {archivedChats.length}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-text-subtle transition-transform duration-200",
                    archiveExpanded && "rotate-180"
                  )}
                />
              </button>
              <AnimatePresence initial={false}>
                {archiveExpanded ? (
                  <motion.div
                    key="archived-chat-list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="pt-1">{archivedChats.map(renderChatItem)}</div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null;

        const chatListContent =
          !mounted || data.isLoading || (data.isReloadingChats && data.chats.length === 0) ? (
            <ChatListSkeleton />
          ) : (
            <>
              {archiveGroup}
              {chatGroups.length === 0 && archivedChats.length === 0 ? (
                <p className="pb-4 pt-6 text-center text-xs text-text-subtle">{t("startFirst")}</p>
              ) : (
                chatGroups.map((group) => (
                  <div key={group.label} className="mb-3">
                    <p className="mb-1 px-2 text-[11px] font-medium text-text-subtle">
                      {group.label}
                    </p>
                    {group.items.map(renderChatItem)}
                  </div>
                ))
              )}
            </>
          );

        if (onPullToRefresh) {
          const revealArchiveOnFirstPull = archivedChats.length > 0 && !mobileArchiveRevealed;
          return (
            <PullToRefresh
              onRefresh={async () => {
                if (revealArchiveOnFirstPull) {
                  setMobileArchiveRevealed(true);
                  return;
                }
                await onPullToRefresh();
              }}
              pullIndicator={
                revealArchiveOnFirstPull ? (
                  <Archive className="h-4 w-4 text-text-muted" />
                ) : undefined
              }
              className="flex-1 px-3"
            >
              {chatListContent}
            </PullToRefresh>
          );
        }
        return <div className="flex-1 overflow-y-auto px-3">{chatListContent}</div>;
      })()}

      {activeProjectChat ? <ProjectFilesPanel chatId={activeProjectChat.chat.id} /> : null}

      {/* Bottom: single account row, everything else lives behind the popup */}
      <div
        className="relative z-20 shrink-0 border-t border-border bg-surface p-2"
        suppressHydrationWarning
      >
        {mounted && onClose && showAndroidSidebarDownload ? (
          <div className="px-1 pb-2">
            <AndroidAppDownloadBanner
              tone="utility"
              className="w-full"
              copy={{ cta: ts("androidAppCta") }}
            />
          </div>
        ) : null}
        {mounted && (
          <AccountFooter
            data={data}
            {...(onTelegramClick ? { onTelegramClick } : {})}
            {...(onLimitsClick ? { onLimitsClick } : {})}
            {...(onClose ? { onClose } : {})}
          />
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat list skeleton (ADR-076 Slice 5)                               */
/*                                                                     */
/*  Three ghost rows roughly matching the real chat row geometry. We   */
/*  intentionally don't show a date-group label here — at the moment   */
/*  the skeleton renders we genuinely don't know which group(s) the    */
/*  data will resolve into, and a fake "Today" header would lie.       */
/* ------------------------------------------------------------------ */

function ChatListSkeleton() {
  return (
    <div aria-hidden="true" data-testid="chat-list-skeleton" className="space-y-1.5 pt-1">
      {[72, 60, 80].map((width, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2"
          style={{ opacity: 1 - i * 0.18 }}
        >
          <div
            className="h-3 animate-pulse rounded bg-surface-raised"
            style={{ width: `${width}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Account footer — single trigger row + rich popup                   */
/*                                                                     */
/*  Replaces the old four-block footer (integrations / token bar /     */
/*  admin / user row) with one Cursor-style identity row that opens    */
/*  a popup carrying everything that used to live there.               */
/* ------------------------------------------------------------------ */

const LOCALES = [
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" }
] as const;

function AccountFooter({
  data,
  onTelegramClick,
  onLimitsClick,
  onClose
}: {
  data: AppData;
  onTelegramClick?: () => void;
  onLimitsClick?: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations("sidebar");
  const ts = useTranslations("settings");
  const locale = useLocale();
  const { getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { isOnline, recheck } = useNetworkOnline();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logoutInFlightRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const initials = (user?.firstName?.[0] ?? user?.username?.[0] ?? "U").toUpperCase();

  const planName =
    data.plan?.effectivePlan.displayName ?? data.plan?.effectivePlan.code ?? t("freePlan");
  const tokenBucket =
    data.plan?.limits.quotaBuckets.find((bucket) => bucket.bucketCode === "token_budget") ?? null;
  const tokenUsage = tokenBucket?.percent ?? 0;
  const paidLightModeActive = data.plan?.advisories?.tokenBudget?.paidLightModeActive ?? false;
  const graceBadgeActive =
    data.plan?.effectivePlan.subscriptionStatus === "grace_period" ||
    data.plan?.effectivePlan.subscriptionStatus === "past_due";
  const billingSummary = resolveBillingSummaryCopy(
    data.plan?.effectivePlan,
    locale,
    data.billingSubscription?.scheduledPlanChange
  );

  const telegramConnected = data.telegram?.connectionStatus === "connected";
  const anyIntegrationConnected = telegramConnected;
  const telegramStatusLabel =
    data.telegram?.connectionStatus === "connected"
      ? t("connected")
      : data.telegram?.connectionStatus === "claim_required"
        ? t("telegramClaimRequired")
        : data.telegram?.connectionStatus === "invalid_token"
          ? t("telegramInvalidToken")
          : t("notConnected");

  const displayName = user?.firstName ?? user?.username ?? "User";
  const expandedName = user?.fullName ?? displayName;
  const expandedEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  const currentLocale =
    (typeof document !== "undefined" &&
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("persai-locale="))
        ?.split("=")[1]) ||
    (typeof document !== "undefined" ? document.documentElement.lang : "en") ||
    "en";

  const guardedNavigate = useCallback(
    async (navigate: () => void) => {
      if (!isOnline) {
        return;
      }
      const confirmedOnline = await recheck();
      if (!confirmedOnline) {
        return;
      }
      navigate();
    },
    [isOnline, recheck]
  );

  const switchLocale = (code: string) => {
    if (!isWebLocale(code)) {
      return;
    }
    void guardedNavigate(async () => {
      setOpen(false);
      const token = await getToken();
      await switchWebLocale(code, token);
    });
  };

  const themeOptions: { id: "system" | "light" | "dark"; icon: React.ReactNode; label: string }[] =
    [
      {
        id: "system",
        icon: <Monitor className="h-4 w-4 md:h-3.5 md:w-3.5" />,
        label: t("themeSystem")
      },
      {
        id: "light",
        icon: <Sun className="h-4 w-4 md:h-3.5 md:w-3.5" />,
        label: t("themeLight")
      },
      {
        id: "dark",
        icon: <Moon className="h-4 w-4 md:h-3.5 md:w-3.5" />,
        label: t("themeDark")
      }
    ];

  const renderAccountButton = (options?: { placeholder?: boolean }) => (
    <motion.button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-hidden={options?.placeholder === true && open ? true : undefined}
      tabIndex={options?.placeholder === true && open ? -1 : undefined}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors",
        open ? "bg-transparent" : "hover:bg-surface-hover"
      )}
      animate={{ y: open ? -4 : 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-surface-raised text-[13px] font-semibold text-text-subtle shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text">
          {open ? expandedName : displayName}
        </span>
        <span className="block truncate text-[11px] tracking-wide text-text-muted">
          {open
            ? expandedEmail
            : `${planName} · ${tokenUsage}%${
                graceBadgeActive
                  ? ` · ${t("paymentIssueBadge")}`
                  : paidLightModeActive
                    ? ` · ${t("lightModeBadge")}`
                    : ""
              }`}
        </span>
      </span>
      <span aria-hidden="true" className={SIDEBAR_CARD_SETTINGS_AFFORDANCE_CLASS}>
        <Settings className={SIDEBAR_CARD_SETTINGS_ICON_CLASS} />
      </span>
    </motion.button>
  );

  return (
    <div ref={ref} className="relative">
      <div className={cn(open && "pointer-events-none invisible")}>
        {renderAccountButton({ placeholder: true })}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="absolute -inset-x-2 bottom-0 z-30 border-t border-border/60 bg-surface shadow-[0_-10px_18px_-16px_rgba(24,22,17,0.58)]"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
          >
            <div className="px-2 pt-2.5">{renderAccountButton()}</div>
            <motion.div
              role="menu"
              className="overflow-hidden"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className="bg-surface px-2 pb-1 pt-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onLimitsClick?.();
                  }}
                  className="block w-full cursor-pointer rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover/55"
                >
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-text-muted">{t("tokenUsage")}</span>
                    <span className="text-text-subtle">
                      {ts("tokenPercentCompact", { pct: tokenUsage })}
                    </span>
                  </div>
                  <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-border/70 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        tokenUsage >= 90
                          ? "bg-destructive"
                          : "bg-accent shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                      )}
                      style={{ width: `${Math.min(tokenUsage, 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                    <span className="max-w-[160px] truncate text-text-muted">{planName}</span>
                    {graceBadgeActive ? (
                      <span className="rounded-full border border-warning/35 bg-warning/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-warning">
                        {t("paymentIssueBadge")}
                      </span>
                    ) : paidLightModeActive ? (
                      <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-warning">
                        {t("lightModeBadge")}
                      </span>
                    ) : null}
                  </div>
                  {billingSummary.dateKey && billingSummary.dateLabel ? (
                    <p className="mt-1.5 text-[10px] text-text-subtle">
                      {ts(billingSummary.dateKey, { date: billingSummary.dateLabel })}
                    </p>
                  ) : null}
                </button>

                <div className="my-1.5 border-t border-border/70" />

                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onTelegramClick?.();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-hover/70"
                >
                  <img
                    src="/integrations/telegram-logo.png"
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-full object-contain"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-text">
                    {t("integrations")}
                  </span>
                  <span className="text-[10px] text-text-subtle">{telegramStatusLabel}</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-text-subtle">
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        anyIntegrationConnected ? "bg-success" : "bg-text-subtle"
                      )}
                    />
                  </span>
                </button>

                <div className="my-1.5 border-t border-border/70" />

                <div className="rounded-xl px-3 py-2.5">
                  <div
                    data-testid="account-theme-language-controls"
                    className="grid grid-cols-2 gap-3"
                  >
                    <div
                      data-testid="account-theme-switcher"
                      className="flex h-11 w-full items-center rounded-full border border-border/45 bg-surface/55 p-1 md:h-9"
                    >
                      {themeOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setTheme(opt.id)}
                          title={opt.label}
                          aria-label={opt.label}
                          className={cn(
                            "flex h-full min-w-0 flex-1 items-center justify-center rounded-full transition-colors",
                            theme === opt.id
                              ? "bg-surface-raised text-text"
                              : "text-text-subtle hover:text-text"
                          )}
                        >
                          {opt.icon}
                        </button>
                      ))}
                    </div>
                    <div
                      data-testid="account-language-switcher"
                      className="flex h-11 w-full items-center rounded-full border border-border/45 bg-surface/55 p-1 md:h-9"
                    >
                      {LOCALES.map((loc) => (
                        <button
                          key={loc.code}
                          type="button"
                          onClick={() => switchLocale(loc.code)}
                          aria-label={loc.code.toUpperCase()}
                          className={cn(
                            "flex h-full min-w-0 flex-1 items-center justify-center rounded-full text-sm font-medium transition-colors md:text-[11px]",
                            currentLocale === loc.code
                              ? "bg-surface-raised text-text"
                              : "text-text-subtle hover:text-text"
                          )}
                        >
                          {loc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="my-1.5 border-t border-border/70" />

                {data.isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      void guardedNavigate(() => {
                        setOpen(false);
                        onClose?.();
                        router.push("/admin" as Route);
                      });
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover/70 hover:text-text"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    {t("adminPanel")}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    void guardedNavigate(() => {
                      setOpen(false);
                      onClose?.();
                      router.push("/app/profile" as Route);
                    });
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover/70 hover:text-text"
                >
                  <Settings className="h-3.5 w-3.5" />
                  {t("accountSettings")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (logoutInFlightRef.current) return;
                    logoutInFlightRef.current = true;
                    setSigningOut(true);
                    void signOut({ redirectUrl: "/" })
                      .catch(() => undefined)
                      .finally(() => {
                        navigateAfterClerkAuth("/", "replace");
                      });
                  }}
                  disabled={signingOut}
                  aria-busy={signingOut}
                  aria-label={t("signOut")}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs text-destructive transition-colors hover:bg-destructive/10",
                    signingOut ? "cursor-wait opacity-70" : "cursor-pointer"
                  )}
                >
                  {signingOut ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  {signingOut ? t("signingOut") : t("signOut")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat list item with three-dot menu                                 */
/* ------------------------------------------------------------------ */

function ChatListItem({
  item,
  assistantId,
  locale,
  isActive,
  onNavigate,
  onChanged
}: {
  item: AssistantWebChatListItemState;
  assistantId: string | null;
  locale: string;
  isActive: boolean;
  onNavigate: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations("sidebar");
  const { getToken } = useAuth();
  // Slice 1.1 — surface a small pulsing dot on rows whose stream is in
  // flight. Pure read of the shared registry — no work happens here when
  // the thread is idle.
  const isThreadStreaming = useIsThreadStreaming(item.chat.surfaceThreadKey, assistantId);
  const hasThreadActiveMediaJobs = useHasThreadActiveMediaJobs(
    item.chat.surfaceThreadKey,
    assistantId
  );
  const hasThreadActiveDocumentJobs = useHasThreadActiveDocumentJobs(
    item.chat.surfaceThreadKey,
    assistantId
  );
  const showLiveIndicator =
    isThreadStreaming ||
    hasThreadActiveMediaJobs ||
    hasThreadActiveDocumentJobs ||
    (item.activeDocumentJobs?.length ?? 0) > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [mobileActionVersion, setMobileActionVersion] = useState(0);
  const [inlineActionsWidth, setInlineActionsWidth] = useState(
    MOBILE_INLINE_ACTIONS_FALLBACK_WIDTH_PX
  );
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const mobileActionsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const swipeStartRef = useRef<{
    x: number;
    y: number;
    direction: "undecided" | "horizontal" | "vertical";
  } | null>(null);
  const suppressNavigateRef = useRef(false);
  const isArchived = item.chat.archivedAt !== null;

  // Compute fixed-position coords for the kebab dropdown so it can render
  // through a portal and escape the sidebar's overflow-y-auto clip when the
  // chat list scrolls. Auto-flips above the row when the row is too close to
  // the viewport bottom.
  const openMenu = useCallback(() => {
    const rect = kebabRef.current?.getBoundingClientRect();
    if (!rect) {
      setMenuOpen(true);
      return;
    }
    const MENU_W = 144; // w-36
    const MENU_H_EST = 132; // ~3 items + divider; conservative so we flip early
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < MENU_H_EST + 16;
    setMenuPos({
      top: flipUp ? Math.max(8, rect.top - MENU_H_EST - 6) : rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right)
    });
    void MENU_W; // reserved for future left-overflow handling on narrow viewports
    setMenuOpen(true);
    setConfirmDelete(false);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setConfirmDelete(false);
  }, []);

  const closeMobileActions = useCallback(() => {
    setMobileActionsOpen(false);
    setConfirmDelete(false);
  }, []);

  const touchMobileActions = useCallback(() => {
    setMobileActionVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close on clicks inside the menu itself, or on the kebab that
      // toggles it (otherwise mousedown would close it before the click
      // toggle re-opens it, leaving the menu in a confused state).
      if (menuRef.current?.contains(target)) return;
      if (kebabRef.current?.contains(target)) return;
      closeMenu();
    };
    const onScrollOrResize = () => closeMenu();
    document.addEventListener("mousedown", handler);
    // capture: true so we catch scroll on any nested overflow container
    // (the chat list itself is overflow-y-auto and won't bubble scroll).
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    if (!mobileActionsOpen) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rowRef.current?.contains(event.target)) {
        closeMobileActions();
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    const timer = window.setTimeout(closeMobileActions, MOBILE_ROW_ACTIONS_IDLE_MS);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      window.clearTimeout(timer);
    };
  }, [closeMobileActions, mobileActionVersion, mobileActionsOpen]);

  useLayoutEffect(() => {
    if (!mobileActionsOpen) return;
    const width = mobileActionsRef.current?.offsetWidth;
    if (typeof width === "number" && width > 0) {
      setInlineActionsWidth(width);
    }
  }, [confirmDelete, mobileActionsOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(FINE_POINTER_CHAT_LIST_QUERY);
    const handlePointerCapabilityChange = () => {
      if (media.matches) {
        closeMobileActions();
        setSwipeX(0);
      }
    };
    media.addEventListener("change", handlePointerCapabilityChange);
    return () => media.removeEventListener("change", handlePointerCapabilityChange);
  }, [closeMobileActions]);

  useEffect(() => {
    if (renaming) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [renaming]);

  const handleRename = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      setRenaming(false);
      return;
    }
    try {
      await patchAssistantWebChat(token, item.chat.id, { title: trimmed });
      onChanged();
    } catch {
      /* non-critical */
    }
    setRenaming(false);
  }, [getToken, item.chat.id, renameValue, onChanged]);

  const handleArchive = useCallback(async (): Promise<boolean> => {
    if (isArchived || archiving) return false;
    const token = await getToken();
    if (!token) return false;
    setArchiving(true);
    try {
      await postAssistantWebChatArchive(token, item.chat.id);
      await onChanged();
      return true;
    } catch {
      return false;
    } finally {
      setArchiving(false);
      setMenuOpen(false);
      closeMobileActions();
    }
  }, [archiving, closeMobileActions, getToken, isArchived, item.chat.id, onChanged]);

  const handleRestore = useCallback(async (): Promise<boolean> => {
    if (!isArchived || restoring) return false;
    const token = await getToken();
    if (!token) return false;
    setRestoring(true);
    try {
      await postAssistantWebChatUnarchive(token, item.chat.id);
      await onChanged();
      return true;
    } catch {
      return false;
    } finally {
      setRestoring(false);
      setMenuOpen(false);
      closeMobileActions();
    }
  }, [closeMobileActions, getToken, isArchived, item.chat.id, onChanged, restoring]);

  const handleDelete = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setDeleting(true);
    try {
      await deleteAssistantWebChat(token, item.chat.id, { confirmText: "DELETE" });
      onChanged();
    } catch {
      /* non-critical */
    }
    setDeleting(false);
    setMenuOpen(false);
    closeMobileActions();
  }, [closeMobileActions, getToken, item.chat.id, onChanged]);

  const toggleRowActions = useCallback(() => {
    if (usesTouchChatListActions()) {
      setSwipeX(0);
      setMobileActionsOpen((open) => {
        const next = !open;
        if (next) touchMobileActions();
        else setConfirmDelete(false);
        return next;
      });
      return;
    }
    if (menuOpen) closeMenu();
    else openMenu();
  }, [closeMenu, menuOpen, openMenu, touchMobileActions]);

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (archiving || restoring || mobileActionsOpen || !usesTouchChatListActions()) {
        swipeStartRef.current = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      swipeStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        direction: "undecided"
      };
      suppressNavigateRef.current = false;
    },
    [archiving, mobileActionsOpen, restoring]
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = swipeStartRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (start.direction === "undecided") {
        if (Math.abs(dx) + Math.abs(dy) < 8) return;
        start.direction = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
      if (start.direction !== "horizontal") return;
      suppressNavigateRef.current = true;
      setSwiping(true);
      event.preventDefault();
      if (isArchived) {
        const rightward = Math.max(0, dx);
        setSwipeX(Math.min(MOBILE_SWIPE_ARCHIVE_WIDTH_PX, rightward * 0.85));
      } else {
        const leftward = Math.min(0, dx);
        setSwipeX(Math.max(-MOBILE_SWIPE_ARCHIVE_WIDTH_PX, leftward * 0.85));
      }
    },
    [isArchived]
  );

  const finishSwipe = useCallback(async () => {
    const wasHorizontal = swipeStartRef.current?.direction === "horizontal";
    swipeStartRef.current = null;
    setSwiping(false);
    if (!wasHorizontal) return;
    if (isArchived && swipeX >= MOBILE_SWIPE_ARCHIVE_TRIGGER_PX) {
      setSwipeX(MOBILE_SWIPE_ARCHIVE_WIDTH_PX);
      const restored = await handleRestore();
      if (!restored) setSwipeX(0);
      return;
    }
    if (!isArchived && swipeX <= -MOBILE_SWIPE_ARCHIVE_TRIGGER_PX) {
      setSwipeX(-MOBILE_SWIPE_ARCHIVE_WIDTH_PX);
      const archived = await handleArchive();
      if (!archived) setSwipeX(0);
      return;
    }
    setSwipeX(0);
  }, [handleArchive, handleRestore, isArchived, swipeX]);

  const cancelSwipe = useCallback(() => {
    swipeStartRef.current = null;
    suppressNavigateRef.current = false;
    setSwiping(false);
    setSwipeX(0);
  }, []);

  if (renaming) {
    return (
      <div className="flex items-center gap-1 px-1 py-1">
        <input
          ref={inputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          onBlur={() => void handleRename()}
          className="min-w-0 flex-1 rounded-lg border border-accent bg-surface-raised px-2 py-1.5 text-base text-text outline-none md:text-sm"
          maxLength={80}
        />
      </div>
    );
  }

  const timestamp = formatChatRowTimestamp(item.chat.lastMessageAt ?? item.chat.createdAt, locale);
  const rowOffset = mobileActionsOpen ? -inlineActionsWidth : swipeX;

  return (
    <div ref={rowRef} data-testid={`chat-row-${item.chat.id}`} className="relative overflow-hidden">
      {!isArchived && !mobileActionsOpen ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 flex w-24 items-center justify-center gap-1.5 rounded-r-lg bg-accent text-xs font-semibold text-white [@media(hover:hover)_and_(pointer:fine)]:hidden"
        >
          <Archive className="h-4 w-4" />
          {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("archive")}
        </div>
      ) : null}
      {isArchived && !mobileActionsOpen ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 flex w-24 items-center justify-center gap-1.5 rounded-l-lg bg-success text-xs font-semibold text-white [@media(hover:hover)_and_(pointer:fine)]:hidden"
        >
          <ArchiveRestore className="h-4 w-4" />
          {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : t("restore")}
        </div>
      ) : null}

      {mobileActionsOpen ? (
        <div
          ref={mobileActionsRef}
          data-testid={`mobile-chat-actions-${item.chat.id}`}
          className="absolute inset-y-0 right-0 flex items-stretch pr-1 [@media(hover:hover)_and_(pointer:fine)]:hidden"
          onPointerDown={touchMobileActions}
        >
          <div className="flex h-full items-stretch">
            <button
              type="button"
              onClick={() => {
                touchMobileActions();
                if (confirmDelete) {
                  void handleDelete();
                } else {
                  setConfirmDelete(true);
                }
              }}
              disabled={deleting}
              className="flex items-center px-3.5 text-xs font-semibold text-destructive transition-colors hover:text-destructive disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : confirmDelete ? (
                t("confirmDelete")
              ) : (
                t("delete")
              )}
            </button>
            <span aria-hidden="true" className="my-auto h-3.5 w-px shrink-0 bg-border/70" />
            <button
              type="button"
              onClick={() => {
                setRenameValue(item.chat.title ?? "");
                setRenaming(true);
                closeMobileActions();
              }}
              disabled={deleting}
              className="flex items-center px-3.5 text-xs font-medium text-text transition-colors hover:text-text disabled:opacity-50"
            >
              {t("rename")}
            </button>
          </div>
        </div>
      ) : null}

      <div
        data-testid={`chat-row-surface-${item.chat.id}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => void finishSwipe()}
        onTouchCancel={cancelSwipe}
        style={{ transform: `translateX(${rowOffset}px)` }}
        className={cn(
          "group relative z-10 flex h-11 w-full items-center gap-1.5 rounded-lg bg-surface px-2.5 text-left [touch-action:pan-y] [@media(hover:hover)_and_(pointer:fine)]:h-auto [@media(hover:hover)_and_(pointer:fine)]:min-h-0 [@media(hover:hover)_and_(pointer:fine)]:gap-1 [@media(hover:hover)_and_(pointer:fine)]:py-2",
          !swiping && "transition-[transform,background-color] duration-200 ease-out",
          isActive
            ? "bg-chat-active-tint text-text"
            : "text-text-muted hover:bg-surface-hover hover:text-text"
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (suppressNavigateRef.current) {
              suppressNavigateRef.current = false;
              return;
            }
            if (mobileActionsOpen) {
              closeMobileActions();
              return;
            }
            onNavigate();
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-medium md:text-[14px]">
                {item.chat.title ?? item.chat.surfaceThreadKey}
              </span>
              {showLiveIndicator && (
                <span
                  title={t("streamingIndicator")}
                  aria-label={t("streamingIndicator")}
                  className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                />
              )}
              {item.chat.chatMode !== "normal" && (
                <span
                  title={
                    item.chat.chatMode === "project" ? t("projectModeBadge") : t("deepModeBadge")
                  }
                  aria-label={
                    item.chat.chatMode === "project" ? t("projectModeBadge") : t("deepModeBadge")
                  }
                  className="inline-flex shrink-0 items-center text-accent-premium/70"
                >
                  {item.chat.chatMode === "project" ? (
                    <FolderKanban className="h-3 w-3" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                </span>
              )}
            </span>
          </span>
          {timestamp && (
            <time
              aria-hidden="true"
              className="shrink-0 pl-1 text-[11px] tabular-nums text-text-subtle"
              dateTime={item.chat.lastMessageAt ?? item.chat.createdAt}
            >
              {timestamp}
            </time>
          )}
        </button>
        <button
          type="button"
          ref={kebabRef}
          aria-label={t("chatActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen || mobileActionsOpen}
          onClick={(e) => {
            e.stopPropagation();
            toggleRowActions();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              toggleRowActions();
            }
          }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full opacity-80 transition-opacity hover:bg-surface-raised [@media(hover:hover)_and_(pointer:fine)]:h-6 [@media(hover:hover)_and_(pointer:fine)]:w-6 [@media(hover:hover)_and_(pointer:fine)]:rounded-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-transparent [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4 text-text-subtle md:h-3.5 md:w-3.5" />
        </button>
      </div>

      {/*
       * Dropdown rendered via portal + position: fixed so it escapes the
       * sidebar's overflow-y-auto clip. Without this, opening the menu on a
       * row near the bottom of a long chat list would visually cut the menu
       * off inside the scroll container.
       */}
      {menuOpen &&
        menuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
            className="z-50 w-36 rounded-lg border border-border bg-surface py-1 shadow-xl"
          >
            <button
              type="button"
              onClick={() => {
                if (deleting || archiving || restoring) return;
                setRenameValue(item.chat.title ?? "");
                setRenaming(true);
                setMenuOpen(false);
              }}
              disabled={deleting || archiving || restoring}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Pencil className="h-3 w-3" />
              {t("rename")}
            </button>
            {!isArchived ? (
              <button
                type="button"
                onClick={() => void handleArchive()}
                disabled={deleting || archiving}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                {archiving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Archive className="h-3 w-3" />
                )}
                {t("archive")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={deleting || restoring}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                {restoring ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArchiveRestore className="h-3 w-3" />
                )}
                {t("restore")}
              </button>
            )}
            <div className="my-1 border-t border-border" />
            {confirmDelete ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting || archiving || restoring}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                {deleting ? t("deleting") : t("confirmDelete")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || archiving || restoring}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                {t("delete")}
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
