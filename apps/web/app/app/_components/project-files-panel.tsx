"use client";

import { useEffect, useState } from "react";
import { Files, ChevronDown } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { listChatWorkspaceFiles } from "../assistant-api-client";
import { useShellActions } from "./app-shell";
import type { ChatHistoryAttachment, ChatHistoryMessage } from "../assistant-api-client";

export type ProjectFileEntry = {
  storagePath: string;
  originalFilename: string | null;
  mimeType: string;
  createdAt: string;
};

function isPersistedProjectAttachment(att: ChatHistoryAttachment): boolean {
  return (
    att.path != null &&
    att.unavailable !== true &&
    att.processingStatus !== "unavailable" &&
    !att.id.startsWith("local-")
  );
}

/** Collects unique project files from chat history attachments, deduped by storage path. */
export function collectProjectFilesFromMessages(
  messages: ChatHistoryMessage[]
): ProjectFileEntry[] {
  const byPath = new Map<string, ProjectFileEntry>();

  for (const message of messages) {
    for (const att of message.attachments) {
      if (!isPersistedProjectAttachment(att) || att.path == null) {
        continue;
      }
      const entry: ProjectFileEntry = {
        storagePath: att.path,
        originalFilename: att.originalFilename,
        mimeType: att.mimeType,
        createdAt: att.createdAt
      };
      const existing = byPath.get(att.path);
      if (
        !existing ||
        new Date(entry.createdAt).getTime() > new Date(existing.createdAt).getTime()
      ) {
        byPath.set(att.path, entry);
      }
    }
  }

  return [...byPath.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function ProjectFilesPanel({ chatId }: { chatId: string }) {
  const t = useTranslations("sidebar");
  const { getToken } = useAuth();
  const { openSettings } = useShellActions();
  const [fileCount, setFileCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getToken({ skipCache: true });
      if (!token) {
        if (!cancelled) setFileCount(0);
        return;
      }
      try {
        const result = await listChatWorkspaceFiles(token, { chatId, limit: 100 });
        if (!cancelled) {
          setFileCount(result.files.length);
        }
      } catch {
        if (!cancelled) setFileCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, getToken]);

  return (
    <div className="shrink-0 border-t border-border px-3 py-2" data-testid="project-files-panel">
      <button
        type="button"
        onClick={() => openSettings("files")}
        className="flex w-full items-center gap-1.5 rounded-lg px-0.5 py-1 text-left transition-colors hover:bg-surface-hover/60"
        aria-expanded={false}
        data-testid="project-files-open-settings"
      >
        <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-text-subtle" />
        <Files className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
        <span className="truncate text-[11px] font-medium text-text-subtle">
          {t("projectFilesTitle")}
        </span>
        {fileCount > 0 ? (
          <span className="text-[10px] tabular-nums text-text-muted">{fileCount}</span>
        ) : null}
      </button>
    </div>
  );
}
