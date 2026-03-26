"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import {
  MessageSquarePlus,
  Send,
  Smartphone,
  MessageCircle,
  Sparkles,
  X,
  MoreHorizontal,
  Loader2,
  Shield,
  Pencil,
  Archive,
  Trash2,
  Sun,
  Moon
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/app/lib/utils";
import type { AppData, AssistantStatus } from "./use-app-data";
import type { AssistantWebChatListItemState } from "@persai/contracts";
import { useTheme } from "./use-theme";
import {
  patchAssistantWebChat,
  postAssistantWebChatArchive,
  deleteAssistantWebChat
} from "../assistant-api-client";

interface SidebarProps {
  onClose?: () => void;
  onAssistantCardClick?: () => void;
  onTelegramClick?: () => void;
  data: AppData;
}

const STATUS_CONFIG: Record<AssistantStatus, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-success" },
  applying: { label: "Applying...", dot: "bg-warning" },
  draft: { label: "Draft", dot: "bg-text-subtle" },
  failed: { label: "Failed", dot: "bg-destructive" },
  degraded: { label: "Degraded", dot: "bg-warning" },
  none: { label: "Not created", dot: "bg-text-subtle" }
};

function groupChatsByDate(chats: AssistantWebChatListItemState[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86_400_000);

  const groups: { label: string; items: AssistantWebChatListItemState[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] }
  ];

  const sorted = [...chats]
    .filter((c) => c.chat.archivedAt === null)
    .sort((a, b) => {
      const da = a.chat.lastMessageAt ?? a.chat.createdAt;
      const db = b.chat.lastMessageAt ?? b.chat.createdAt;
      return new Date(db).getTime() - new Date(da).getTime();
    });

  for (const chat of sorted) {
    const d = new Date(chat.chat.lastMessageAt ?? chat.chat.createdAt);
    if (d >= todayStart) groups[0]!.items.push(chat);
    else if (d >= yesterdayStart) groups[1]!.items.push(chat);
    else if (d >= weekStart) groups[2]!.items.push(chat);
    else groups[3]!.items.push(chat);
  }

  return groups.filter((g) => g.items.length > 0);
}

function IntegrationRow({
  icon,
  name,
  status,
  muted,
  connected,
  onClick
}: {
  icon: React.ReactNode;
  name: string;
  status: string;
  muted?: boolean;
  connected?: boolean;
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      disabled={muted}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        muted ? "cursor-default opacity-50" : "cursor-pointer hover:bg-surface-hover"
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-raised text-text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-text">{name}</span>
        <span className="flex items-center gap-1.5">
          {connected !== undefined && (
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                connected ? "bg-success" : "bg-text-subtle"
              )}
            />
          )}
          <span
            className={cn(
              "block truncate text-[11px]",
              muted ? "text-text-subtle" : "text-text-muted"
            )}
          >
            {status}
          </span>
        </span>
      </span>
    </button>
  );
}

export function Sidebar({ onClose, onAssistantCardClick, onTelegramClick, data }: SidebarProps) {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeThread = searchParams.get("thread");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const statusCfg = STATUS_CONFIG[data.assistantStatus];
  const assistantName = data.assistant?.draft.displayName ?? "Your Assistant";
  const chatGroups = groupChatsByDate(data.chats);
  const telegramConnected = data.telegram?.connectionStatus === "connected";
  const planName = data.plan?.effectivePlan.displayName ?? "Free plan";
  const chatUsage = data.plan?.limits.activeWebChatsPercent ?? 0;

  return (
    <aside className="flex h-dvh w-[280px] shrink-0 flex-col border-r border-border bg-surface">
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
      <div className={cn("px-3", onClose ? "pt-1 pb-3" : "pt-4 pb-3")}>
        <button
          type="button"
          onClick={onAssistantCardClick}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-surface-raised p-3 transition-colors hover:bg-surface-hover"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent text-xl overflow-hidden">
            {data.assistant?.draft.avatarUrl ? (
              <img
                src={data.assistant.draft.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              (data.assistant?.draft.avatarEmoji ?? <Sparkles className="h-5 w-5" />)
            )}
          </div>
          <div className="min-w-0 text-left">
            <p className="truncate text-sm font-semibold text-text">{assistantName}</p>
            <span className="flex items-center gap-1.5">
              <span className={cn("inline-block h-2 w-2 rounded-full", statusCfg.dot)} />
              <span className="text-xs text-text-muted">{statusCfg.label}</span>
            </span>
          </div>
        </button>
      </div>

      {/* 2. New chat button */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => {
            router.push("/app/chat");
            onClose?.();
          }}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white shadow-sm shadow-accent-glow transition-colors hover:bg-accent-hover"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </button>
      </div>

      {/* 3. Chat list (scrollable) */}
      <div className="flex-1 overflow-y-auto px-3">
        {data.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
          </div>
        ) : chatGroups.length === 0 ? (
          <p className="pb-4 pt-6 text-center text-xs text-text-subtle">
            Start your first conversation
          </p>
        ) : (
          chatGroups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
                {group.label}
              </p>
              {group.items.map((item) => (
                <ChatListItem
                  key={item.chat.id}
                  item={item}
                  isActive={activeThread === item.chat.surfaceThreadKey}
                  onNavigate={() => {
                    router.push(`/app/chat?thread=${item.chat.surfaceThreadKey}`);
                    onClose?.();
                  }}
                  onChanged={data.reloadChats}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Bottom fixed sections */}
      <div className="shrink-0 border-t border-border">
        {/* 5. Integrations */}
        <div className="px-3 pt-3 pb-2">
          <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
            Integrations
          </p>
          <IntegrationRow
            icon={<Send className="h-3.5 w-3.5" />}
            name="Telegram"
            status={telegramConnected ? "Connected" : "Not connected"}
            connected={telegramConnected}
            onClick={onTelegramClick}
          />
          <IntegrationRow
            icon={<Smartphone className="h-3.5 w-3.5" />}
            name="WhatsApp"
            status="Coming soon"
            muted
          />
          <IntegrationRow
            icon={<MessageCircle className="h-3.5 w-3.5" />}
            name="MAX"
            status="Coming soon"
            muted
          />
        </div>

        {/* 6. Limits */}
        <div className="border-t border-border px-3 py-2.5">
          <div className="flex items-center justify-between px-2.5">
            <span className="text-xs text-text-muted">{planName}</span>
            {chatUsage > 0 && (
              <span className="text-[11px] text-text-subtle">{chatUsage}% chats</span>
            )}
          </div>
          {chatUsage > 0 && (
            <div className="mx-2.5 mt-1.5 h-1 overflow-hidden rounded-full bg-surface-raised">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  chatUsage >= 90 ? "bg-destructive" : "bg-accent"
                )}
                style={{ width: `${Math.min(chatUsage, 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Admin button (visible only for admins) */}
        {data.isAdmin && (
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => {
                router.push("/admin");
                onClose?.();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Shield className="h-3.5 w-3.5" />
              Admin panel
            </button>
          </div>
        )}

        {/* 7. User */}
        <div
          className="flex items-center gap-3 border-t border-border px-3 py-3"
          suppressHydrationWarning
        >
          {mounted && <UserButton />}
          <span className="min-w-0 flex-1 truncate text-sm text-text-muted">
            {user?.firstName ?? user?.username ?? "User"}
          </span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Theme toggle                                                       */
/* ------------------------------------------------------------------ */

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="shrink-0 cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat list item with three-dot menu                                 */
/* ------------------------------------------------------------------ */

function ChatListItem({
  item,
  isActive,
  onNavigate,
  onChanged
}: {
  item: AssistantWebChatListItemState;
  isActive: boolean;
  onNavigate: () => void;
  onChanged: () => void;
}) {
  const { getToken } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

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

  const handleArchive = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      await postAssistantWebChatArchive(token, item.chat.id);
      onChanged();
    } catch {
      /* non-critical */
    }
    setMenuOpen(false);
  }, [getToken, item.chat.id, onChanged]);

  const handleDelete = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      await deleteAssistantWebChat(token, item.chat.id, { confirmText: "DELETE" });
      onChanged();
    } catch {
      /* non-critical */
    }
    setMenuOpen(false);
    setConfirmDelete(false);
  }, [getToken, item.chat.id, onChanged]);

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
          className="min-w-0 flex-1 rounded-lg border border-accent bg-surface-raised px-2 py-1.5 text-xs text-text outline-none"
          maxLength={80}
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onNavigate}
        className={cn(
          "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
          isActive
            ? "bg-surface-hover text-text"
            : "text-text-muted hover:bg-surface-hover hover:text-text"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">
            {item.chat.title ?? item.chat.surfaceThreadKey}
          </span>
          {item.lastMessagePreview && (
            <span className="block truncate text-[11px] text-text-subtle">
              {item.lastMessagePreview}
            </span>
          )}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
            setConfirmDelete(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }
          }}
          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-raised group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5 text-text-subtle" />
        </span>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-1 top-full z-20 mt-0.5 w-36 rounded-lg border border-border bg-surface py-1 shadow-xl"
        >
          <button
            type="button"
            onClick={() => {
              setRenameValue(item.chat.title ?? "");
              setRenaming(true);
              setMenuOpen(false);
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <Pencil className="h-3 w-3" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => void handleArchive()}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <Archive className="h-3 w-3" />
            Archive
          </button>
          <div className="my-1 border-t border-border" />
          {confirmDelete ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" />
              Confirm delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
