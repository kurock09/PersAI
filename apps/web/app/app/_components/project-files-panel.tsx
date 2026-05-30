"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  deleteAssistantFile,
  getAssistantFileDownloadUrl,
  getChatMessages,
  stageWebChatAttachment,
  type ChatHistoryAttachment,
  type ChatHistoryMessage
} from "../assistant-api-client";
import {
  consumePendingProjectFilesHighlight,
  dispatchProjectFilesChanged,
  PROJECT_FILES_CHANGED_EVENT,
  PROJECT_MODE_ACTIVATED_EVENT
} from "./project-files-events";

const PROJECT_FILES_HINT_MS = 2000;

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

function createClientTurnId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function ProjectFilesPanel({ chatId, threadKey }: { chatId: string; threadKey: string }) {
  const t = useTranslations("sidebar");
  const { getToken } = useAuth();
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyDeleteRef, setBusyDeleteRef] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [hintActive, setHintActive] = useState(false);

  const runProjectFilesHint = useCallback(() => {
    panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setHintActive(true);
  }, []);

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

  useEffect(() => {
    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail;
      if (detail?.chatId === chatId) {
        void loadFiles();
      }
    };
    window.addEventListener(PROJECT_FILES_CHANGED_EVENT, handleChanged as EventListener);
    return () => {
      window.removeEventListener(PROJECT_FILES_CHANGED_EVENT, handleChanged as EventListener);
    };
  }, [chatId, loadFiles]);

  useEffect(() => {
    if (!hintActive) {
      return;
    }
    const timer = window.setTimeout(() => setHintActive(false), PROJECT_FILES_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hintActive]);

  useEffect(() => {
    const handleActivated = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail;
      if (detail?.chatId === chatId) {
        runProjectFilesHint();
      }
    };
    window.addEventListener(PROJECT_MODE_ACTIVATED_EVENT, handleActivated as EventListener);
    if (consumePendingProjectFilesHighlight(chatId)) {
      window.requestAnimationFrame(() => {
        runProjectFilesHint();
      });
    }
    return () => {
      window.removeEventListener(PROJECT_MODE_ACTIVATED_EVENT, handleActivated as EventListener);
    };
  }, [chatId, runProjectFilesHint]);

  const handleUploadFiles = useCallback(
    async (selected: FileList | null) => {
      if (!selected || selected.length === 0) {
        return;
      }
      if (selected.length > 3) {
        setFeedback(t("projectFilesUploadLimit"));
        return;
      }
      const token = await getToken({ skipCache: true });
      if (!token) {
        setFeedback(t("projectFilesUploadFailed"));
        return;
      }
      setUploading(true);
      setFeedback(null);
      const batchClientTurnId = createClientTurnId();
      try {
        let resolvedChatId = chatId;
        for (const [index, file] of Array.from(selected).entries()) {
          const staged = await stageWebChatAttachment(
            token,
            threadKey,
            batchClientTurnId,
            `${batchClientTurnId}-${index}`,
            file
          );
          resolvedChatId = staged.chatId;
        }
        dispatchProjectFilesChanged(resolvedChatId);
        await loadFiles();
      } catch {
        setFeedback(t("projectFilesUploadFailed"));
      } finally {
        setUploading(false);
        if (uploadInputRef.current) {
          uploadInputRef.current.value = "";
        }
      }
    },
    [chatId, getToken, loadFiles, t, threadKey]
  );

  const handleDelete = useCallback(
    async (fileRef: string) => {
      const token = await getToken({ skipCache: true });
      if (!token) {
        setFeedback(t("projectFilesDeleteFailed"));
        return;
      }
      setBusyDeleteRef(fileRef);
      setFeedback(null);
      try {
        await deleteAssistantFile(token, fileRef);
        dispatchProjectFilesChanged(chatId);
        await loadFiles();
      } catch {
        setFeedback(t("projectFilesDeleteFailed"));
      } finally {
        setBusyDeleteRef(null);
      }
    },
    [chatId, getToken, loadFiles, t]
  );

  return (
    <div
      ref={panelRef}
      className={cn(
        "shrink-0 border-t border-border px-3 py-2.5",
        hintActive && "project-files-hint"
      )}
      data-testid="project-files-panel"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <p className="text-[11px] font-medium text-text-subtle">{t("projectFilesTitle")}</p>
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          disabled={loading || uploading || busyDeleteRef !== null}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/70 bg-surface-raised text-text-subtle transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          aria-label={t("projectFilesAdd")}
          title={t("projectFilesAdd")}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleUploadFiles(event.target.files);
          }}
        />
      </div>
      {feedback ? (
        <p
          className="mb-1.5 px-0.5 text-[11px] text-text-subtle"
          data-testid="project-files-feedback"
        >
          {feedback}
        </p>
      ) : null}
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
                <div className="flex items-center gap-1 rounded-lg px-1 py-1">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                    title={label}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
                    <span className="min-w-0 truncate">{label}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDelete(file.fileRef)}
                    disabled={uploading || busyDeleteRef === file.fileRef}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
                    aria-label={t("delete")}
                    title={t("delete")}
                  >
                    {busyDeleteRef === file.fileRef ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
