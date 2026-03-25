"use client";

import { useRouter } from "next/navigation";
import {
  Sparkles,
  MessageSquarePlus,
  Settings,
  Send,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import type { AppData } from "./use-app-data";

interface HomeDashboardProps {
  data: AppData;
  onSettingsClick: () => void;
  onTelegramClick: () => void;
}

export function HomeDashboard({
  data,
  onSettingsClick,
  onTelegramClick,
}: HomeDashboardProps) {
  const router = useRouter();
  const assistantName =
    data.assistant?.draft.displayName ?? "Your assistant";
  const daysTogether = data.assistant?.createdAt
    ? Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(data.assistant.createdAt).getTime()) /
            86_400_000
        )
      )
    : null;

  const telegramConnected =
    data.telegram?.connectionStatus === "connected";

  const recentChats = data.chats
    .filter((c) => c.chat.archivedAt === null)
    .sort((a, b) => {
      const da = a.chat.lastMessageAt ?? a.chat.createdAt;
      const db = b.chat.lastMessageAt ?? b.chat.createdAt;
      return new Date(db).getTime() - new Date(da).getTime();
    })
    .slice(0, 5);

  const greetings = [
    "What's on your mind today?",
    "Ready to pick up where we left off?",
    "How can I help you today?",
    "Good to see you!",
  ];
  const greeting =
    greetings[Math.floor(Date.now() / 86_400_000) % greetings.length]!;

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto">
      <div className="w-full max-w-xl px-6 py-12">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-accent/10 text-accent">
            <Sparkles className="h-10 w-10" />
          </div>
          <h1 className="text-2xl font-bold text-text sm:text-3xl">
            {assistantName}
          </h1>
          <p className="mt-2 text-sm text-text-muted">{greeting}</p>
          {daysTogether !== null && daysTogether > 1 && (
            <p className="mt-3 rounded-full bg-surface-raised px-4 py-1.5 text-[11px] text-text-subtle">
              Together for {daysTogether}{" "}
              {daysTogether === 1 ? "day" : "days"}
            </p>
          )}
        </div>

        {/* Quick prompts */}
        <div className="mt-8 grid grid-cols-2 gap-2">
          {[
            "What can you help me with?",
            "Tell me something interesting",
            "Help me plan my day",
            "Summarize what we talked about",
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() =>
                router.push(
                  `/app/chat?prompt=${encodeURIComponent(prompt)}`
                )
              }
              className="cursor-pointer rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-xs text-text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Quick actions */}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <QuickAction
            icon={<MessageSquarePlus className="h-4 w-4" />}
            label="New chat"
            accent
            onClick={() => router.push("/app/chat")}
          />
          <QuickAction
            icon={<Settings className="h-4 w-4" />}
            label="Settings"
            onClick={onSettingsClick}
          />
          <QuickAction
            icon={<Send className="h-4 w-4" />}
            label={telegramConnected ? "Telegram" : "Connect Telegram"}
            onClick={onTelegramClick}
          />
        </div>

        {/* Recent chats */}
        {recentChats.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-subtle">
              Recent conversations
            </h2>
            <div className="space-y-1">
              {recentChats.map((item) => (
                <button
                  key={item.chat.id}
                  type="button"
                  onClick={() =>
                    router.push(
                      `/app/chat?thread=${item.chat.surfaceThreadKey}`
                    )
                  }
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">
                      {item.chat.title ?? item.chat.surfaceThreadKey}
                    </p>
                    {item.lastMessagePreview && (
                      <p className="mt-0.5 truncate text-xs text-text-subtle">
                        {item.lastMessagePreview}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  accent,
  onClick,
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
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all",
        accent
          ? "bg-accent text-white shadow-sm shadow-accent-glow hover:bg-accent-hover"
          : "border border-border bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
