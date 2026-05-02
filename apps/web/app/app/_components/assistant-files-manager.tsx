"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  deleteAssistantFile,
  getAssistantFileDownloadUrl,
  getAssistantFiles,
  patchAssistantFileDisplayName,
  type AssistantFileState
} from "../assistant-api-client";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function fileDisplayName(file: AssistantFileState): string {
  return file.displayName ?? file.filename;
}

function fileKind(file: AssistantFileState): "image" | "audio" | "video" | "pdf" | "file" {
  if (file.mimeType.startsWith("image/")) return "image";
  if (file.mimeType.startsWith("audio/")) return "audio";
  if (file.mimeType.startsWith("video/")) return "video";
  if (file.mimeType === "application/pdf") return "pdf";
  return "file";
}

function originLabel(
  file: AssistantFileState,
  t: (
    key:
      | "filesOrigin_uploaded_attachment"
      | "filesOrigin_runtime_output"
      | "filesOrigin_sandbox_output"
  ) => string
): string {
  switch (file.origin) {
    case "uploaded_attachment":
      return t("filesOrigin_uploaded_attachment");
    case "runtime_output":
      return t("filesOrigin_runtime_output");
    case "sandbox_output":
      return t("filesOrigin_sandbox_output");
  }
}

export function AssistantFilesManager() {
  const t = useTranslations("settings");
  const { getToken } = useAuth();
  const [files, setFiles] = useState<AssistantFileState[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busyRef, setBusyRef] = useState<string | null>(null);

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + Math.max(0, file.sizeBytes), 0),
    [files]
  );

  const loadFiles = useCallback(
    async (nextQuery: string) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setLoading(true);
      setFeedback(null);
      try {
        const nextFiles = await getAssistantFiles(token, {
          query: nextQuery,
          limit: 100
        });
        setFiles(nextFiles);
      } catch (error) {
        setFeedback({
          type: "err",
          text: error instanceof Error ? error.message : t("filesLoadFailed")
        });
      } finally {
        setLoading(false);
      }
    },
    [getToken, t]
  );

  useEffect(() => {
    void loadFiles("");
  }, [loadFiles]);

  const handleRename = useCallback(
    async (fileRef: string) => {
      const trimmed = draftName.trim();
      if (trimmed.length === 0) return;
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setBusyRef(fileRef);
      setFeedback(null);
      try {
        const updated = await patchAssistantFileDisplayName(token, fileRef, trimmed);
        setFiles((current) =>
          current.map((file) => (file.fileRef === fileRef ? { ...file, ...updated } : file))
        );
        setEditingRef(null);
        setFeedback({ type: "ok", text: t("filesRenamed") });
      } catch (error) {
        setFeedback({
          type: "err",
          text: error instanceof Error ? error.message : t("filesRenameFailed")
        });
      } finally {
        setBusyRef(null);
      }
    },
    [draftName, getToken, t]
  );

  const handleDelete = useCallback(
    async (fileRef: string) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setBusyRef(fileRef);
      setFeedback(null);
      try {
        await deleteAssistantFile(token, fileRef);
        setFiles((current) => current.filter((file) => file.fileRef !== fileRef));
        setFeedback({ type: "ok", text: t("filesDeleted") });
      } catch (error) {
        setFeedback({
          type: "err",
          text: error instanceof Error ? error.message : t("filesDeleteFailed")
        });
      } finally {
        setBusyRef(null);
      }
    },
    [getToken, t]
  );

  return (
    <div className="rounded-2xl border border-border/70 bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{t("filesTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("filesDescription")}</p>
        </div>
        <div className="rounded-full border border-border/60 bg-surface-raised px-2.5 py-1 text-[11px] text-text-subtle">
          {files.length} · {formatBytes(totalBytes)}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadFiles(query);
            }}
            placeholder={t("filesSearchPlaceholder")}
            className="w-full rounded-xl border border-border bg-surface-raised py-2 pr-3 pl-8 text-xs text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadFiles(query)}
          disabled={loading}
          className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("refresh")}
        </button>
      </div>

      <div className="mt-3 max-h-[360px] overflow-y-auto pr-1">
        {loading && files.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface-raised px-3 py-3 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("filesLoading")}
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-surface-raised/50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-text">{t("filesEmptyTitle")}</p>
            <p className="mt-1 text-xs text-text-muted">{t("filesEmptyBody")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-surface-raised/35">
            {files.map((file) => {
              const name = fileDisplayName(file);
              const isEditing = editingRef === file.fileRef;
              const busy = busyRef === file.fileRef;
              const openUrl = getAssistantFileDownloadUrl(file.fileRef);
              const downloadUrl = getAssistantFileDownloadUrl(file.fileRef, { download: true });
              return (
                <div
                  key={file.fileRef}
                  className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-text-subtle" />
                      {isEditing ? (
                        <input
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleRename(file.fileRef);
                            if (event.key === "Escape") setEditingRef(null);
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-border-strong"
                          autoFocus
                        />
                      ) : (
                        <p className="min-w-0 truncate text-sm font-medium text-text">{name}</p>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-[11px] text-text-subtle">
                      <span className="rounded-full bg-surface px-2 py-0.5">
                        {originLabel(file, t)}
                      </span>
                      <span>{fileKind(file)}</span>
                      <span>{formatBytes(file.sizeBytes)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pl-6 sm:pl-0">
                    {isEditing ? (
                      <button
                        type="button"
                        onClick={() => void handleRename(file.fileRef)}
                        disabled={busy || draftName.trim().length === 0}
                        className="rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                      >
                        {busy ? "..." : t("save")}
                      </button>
                    ) : (
                      <>
                        <a
                          href={openUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-border bg-surface px-2 py-1 text-text-muted transition-colors hover:text-text"
                          title={t("filesOpen")}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <a
                          href={downloadUrl}
                          download={name}
                          className="rounded-lg border border-border bg-surface px-2 py-1 text-text-muted transition-colors hover:text-text"
                          title={t("filesDownload")}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRef(file.fileRef);
                            setDraftName(name);
                          }}
                          className="rounded-lg border border-border bg-surface px-2 py-1 text-text-muted transition-colors hover:text-text"
                          title={t("filesRename")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(file.fileRef)}
                          disabled={busy}
                          className="rounded-lg border border-border bg-surface px-2 py-1 text-text-muted transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                          title={t("filesDelete")}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {feedback && (
        <p
          className={cn(
            "mt-2 text-xs",
            feedback.type === "ok" ? "text-success" : "text-destructive"
          )}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
