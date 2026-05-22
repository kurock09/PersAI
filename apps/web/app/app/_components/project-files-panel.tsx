"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  getAssistantFileDownloadUrl,
  getChatMessages,
  type ChatHistoryAttachment,
  type ChatHistoryMessage
} from "../assistant-api-client";

export type ProjectFileEntry = {
  fileRef: string;
  originalFilename: string | null;
  mimeType: string;
  createdAt: string;
};

function isPersistedProjectAttachment(att: ChatHistoryAttachment): boolean {
  return att.fileRef != null && att.fileDeleted !== true && !att.id.startsWith("local-");
}

/**
 * Collects unique project files from chat history attachments.
 * Dedupes by fileRef; when duplicates exist, keeps the row with the latest createdAt.
 */
export function collectProjectFilesFromMessages(
  messages: ChatHistoryMessage[]
): ProjectFileEntry[] {
  const byFileRef = new Map<string, ProjectFileEntry>();

  for (const message of messages) {
    for (const att of message.attachments) {
      if (!isPersistedProjectAttachment(att) || att.fileRef == null) {
        continue;
      }
      const entry: ProjectFileEntry = {
        fileRef: att.fileRef,
        originalFilename: att.originalFilename,
        mimeType: att.mimeType,
        createdAt: att.createdAt
      };
      const existing = byFileRef.get(att.fileRef);
      if (
        !existing ||
        new Date(entry.createdAt).getTime() > new Date(existing.createdAt).getTime()
      ) {
        byFileRef.set(att.fileRef, entry);
      }
    }
  }

  return [...byFileRef.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function fetchAllChatMessages(token: string, chatId: string): Promise<ChatHistoryMessage[]> {
  const all: ChatHistoryMessage[] = [];
  let cursor: string | undefined;
  do {
    const page = await getChatMessages(token, chatId, cursor, 50);
    all.push(...page.messages);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

export function ProjectFilesPanel({ chatId }: { chatId: string }) {
  const t = useTranslations("sidebar");
  const { getToken } = useAuth();
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      if (!token) {
        setFiles([]);
        return;
      }
      const messages = await fetchAllChatMessages(token, chatId);
      setFiles(collectProjectFilesFromMessages(messages));
    } catch {
      setLoadError(true);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [chatId, getToken]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  return (
    <div className="shrink-0 border-t border-border px-3 py-2.5" data-testid="project-files-panel">
      <p className="mb-1.5 px-0.5 text-[11px] font-medium text-text-subtle">
        {t("projectFilesTitle")}
      </p>
      {loading ? (
        <div
          className="flex items-center gap-2 px-0.5 py-2 text-xs text-text-muted"
          data-testid="project-files-loading"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {t("projectFilesLoading")}
        </div>
      ) : loadError ? (
        <p className="px-0.5 py-2 text-xs text-text-subtle">{t("projectFilesEmpty")}</p>
      ) : files.length === 0 ? (
        <p className="px-0.5 py-2 text-xs text-text-subtle" data-testid="project-files-empty">
          {t("projectFilesEmpty")}
        </p>
      ) : (
        <ul className="max-h-36 space-y-0.5 overflow-y-auto" data-testid="project-files-list">
          {files.map((file) => {
            const label = file.originalFilename ?? file.fileRef;
            const href = getAssistantFileDownloadUrl(file.fileRef);
            return (
              <li key={file.fileRef}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                  title={label}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
                  <span className="min-w-0 truncate">{label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
