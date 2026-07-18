"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Settings, ArrowRight, FolderKanban, Sparkles } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useTranslations } from "next-intl";
import { AssistantAvatar } from "./assistant-avatar";
import { userPillButtonClassName } from "./form-ui";
import type { AppData } from "./use-app-data";
import type { AssistantWebChatListItemState } from "@persai/contracts";
import {
  useHasThreadActiveDocumentJobs,
  useHasThreadActiveMediaJobs,
  useHasThreadActiveSandboxJobs,
  useIsThreadStreaming
} from "./streaming-threads";

interface HomeDashboardProps {
  data: AppData;
  onSettingsClick: () => void;
}

export function HomeDashboard({ data, onSettingsClick }: HomeDashboardProps) {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("chat");
  const assistantName = data.assistant?.draft.displayName ?? tc("defaultAssistant");
  const daysTogether = data.assistant?.createdAt
    ? Math.max(
        1,
        Math.floor((Date.now() - new Date(data.assistant.createdAt).getTime()) / 86_400_000)
      )
    : null;

  const recentChats = data.chats
    .filter((c) => c.chat.archivedAt === null)
    .sort((a, b) => {
      const da = a.chat.lastMessageAt ?? a.chat.createdAt;
      const db = b.chat.lastMessageAt ?? b.chat.createdAt;
      return new Date(db).getTime() - new Date(da).getTime();
    })
    .slice(0, 5);

  const greetings = [t("greeting1"), t("greeting2"), t("greeting3"), t("greeting4")];
  const greeting = greetings[Math.floor(Date.now() / 86_400_000) % greetings.length]!;

  return (
    <div className="flex min-h-full items-start justify-center">
      <div className="w-full max-w-xl px-6 py-12">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <AssistantAvatar
            avatarUrl={data.assistant?.draft.avatarUrl ?? undefined}
            avatarEmoji={data.assistant?.draft.avatarEmoji ?? undefined}
            size="lg"
            className="mb-5"
          />
          <h1 className="text-2xl font-bold text-text sm:text-3xl">{assistantName}</h1>
          <p className="mt-2 text-base text-text-muted md:text-sm">{greeting}</p>
          {daysTogether !== null && daysTogether > 1 && (
            <p className="mt-3 rounded-full bg-surface-raised px-4 py-1.5 text-[11px] text-text-subtle">
              {t("togetherFor", { days: daysTogether })}
            </p>
          )}
        </div>

        {/* Quick actions */}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <QuickAction
            icon={<MessageSquarePlus className="h-4 w-4" />}
            label={t("newChat")}
            accent
            onClick={() => router.push("/app/chat" as Route)}
          />
          <QuickAction
            icon={<Settings className="h-4 w-4" />}
            label={t("settings")}
            onClick={onSettingsClick}
          />
        </div>

        {/* Recent chats */}
        {recentChats.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-subtle">
              {t("recentConversations")}
            </h2>
            <div className="space-y-1">
              {recentChats.map((item) => (
                <RecentChatRow
                  key={item.chat.id}
                  item={item}
                  assistantId={data.assistant?.id ?? null}
                  onNavigate={() =>
                    router.push(`/app/chat?thread=${item.chat.surfaceThreadKey}` as Route)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentChatRow({
  item,
  assistantId,
  onNavigate
}: {
  item: AssistantWebChatListItemState;
  assistantId: string | null;
  onNavigate: () => void;
}) {
  const t = useTranslations("sidebar");
  const isThreadStreaming = useIsThreadStreaming(item.chat.surfaceThreadKey, assistantId);
  const hasThreadActiveMediaJobs = useHasThreadActiveMediaJobs(
    item.chat.surfaceThreadKey,
    assistantId
  );
  const hasThreadActiveDocumentJobs = useHasThreadActiveDocumentJobs(
    item.chat.surfaceThreadKey,
    assistantId
  );
  const hasThreadActiveSandboxJobs = useHasThreadActiveSandboxJobs(
    item.chat.surfaceThreadKey,
    assistantId
  );
  const showLiveIndicator =
    isThreadStreaming ||
    hasThreadActiveMediaJobs ||
    hasThreadActiveDocumentJobs ||
    hasThreadActiveSandboxJobs ||
    item.activeTurn !== null ||
    (item.activeMediaJobs?.length ?? 0) > 0 ||
    (item.activeDocumentJobs?.length ?? 0) > 0 ||
    (item.activeSandboxJobs?.length ?? 0) > 0;
  const modeLabel =
    item.chat.chatMode === "project"
      ? t("projectModeBadge")
      : item.chat.chatMode === "normal"
        ? null
        : t("deepModeBadge");

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-text">
          {modeLabel ? (
            <span
              title={modeLabel}
              aria-label={modeLabel}
              className="inline-flex shrink-0 text-accent-premium/75 transition-colors group-hover:text-accent-premium"
            >
              {item.chat.chatMode === "project" ? (
                <FolderKanban className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </span>
          ) : null}
          <span className="min-w-0 truncate">{item.chat.title ?? item.chat.surfaceThreadKey}</span>
          {showLiveIndicator ? (
            <span
              title={t("streamingIndicator")}
              aria-label={t("streamingIndicator")}
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-success/85 shadow-[0_0_8px_rgba(115,139,112,0.55)]"
            />
          ) : null}
        </p>
        {item.lastMessagePreview ? (
          <p className="mt-0.5 truncate text-xs text-text-subtle">{item.lastMessagePreview}</p>
        ) : null}
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function QuickAction({
  icon,
  label,
  accent,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(userPillButtonClassName(accent ? "primary" : "secondary", "min-h-10 px-6"))}
    >
      {icon}
      {label}
    </button>
  );
}
