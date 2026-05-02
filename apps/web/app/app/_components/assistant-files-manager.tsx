"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ChevronDown,
  Archive,
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
  cleanupAssistantFilesCache,
  deleteAssistantFile,
  getAssistantFileDownloadUrl,
  getAssistantFiles,
  patchAssistantFileDisplayName,
  type AssistantFilesCleanupSummary,
  type AssistantFileState
} from "../assistant-api-client";

type FileBucket = AssistantFileState["fileBucket"];

const FILE_BUCKETS: FileBucket[] = [
  "user_files",
  "assistant_created",
  "media_uploads",
  "cache_history"
];

const DEFAULT_EXPANDED_BUCKETS: Record<FileBucket, boolean> = {
  user_files: true,
  assistant_created: true,
  media_uploads: true,
  cache_history: false
};

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

function bucketLabel(
  bucket: FileBucket,
  t: (
    key:
      | "filesBucket_user_files"
      | "filesBucket_assistant_created"
      | "filesBucket_media_uploads"
      | "filesBucket_cache_history"
  ) => string
): string {
  switch (bucket) {
    case "user_files":
      return t("filesBucket_user_files");
    case "assistant_created":
      return t("filesBucket_assistant_created");
    case "media_uploads":
      return t("filesBucket_media_uploads");
    case "cache_history":
      return t("filesBucket_cache_history");
  }
}

function groupFiles(files: AssistantFileState[]): Array<{
  bucket: FileBucket;
  files: AssistantFileState[];
  bytes: number;
}> {
  return FILE_BUCKETS.map((bucket) => {
    const bucketFiles = files.filter((file) => file.fileBucket === bucket);
    return {
      bucket,
      files: bucketFiles,
      bytes: bucketFiles.reduce((sum, file) => sum + Math.max(0, file.sizeBytes), 0)
    };
  }).filter((group) => group.files.length > 0);
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
  const [cleanupSummary, setCleanupSummary] = useState<AssistantFilesCleanupSummary>({
    eligibleCount: 0,
    eligibleBytes: 0
  });
  const [expandedBuckets, setExpandedBuckets] =
    useState<Record<FileBucket, boolean>>(DEFAULT_EXPANDED_BUCKETS);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + Math.max(0, file.sizeBytes), 0),
    [files]
  );
  const groupedFiles = useMemo(() => groupFiles(files), [files]);

  const loadFiles = useCallback(
    async (nextQuery: string) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setLoading(true);
      setFeedback(null);
      try {
        const payload = await getAssistantFiles(token, {
          query: nextQuery,
          limit: 100
        });
        setFiles(payload.files);
        setCleanupSummary(payload.cleanup);
        setCleanupConfirmOpen(false);
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

  const handleCleanupCache = useCallback(async () => {
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setCleanupBusy(true);
    setFeedback(null);
    try {
      const cleanup = await cleanupAssistantFilesCache(token);
      setFiles((current) => current.filter((file) => !file.cleanupEligible));
      setCleanupSummary({ eligibleCount: 0, eligibleBytes: 0 });
      setCleanupConfirmOpen(false);
      setFeedback({
        type: "ok",
        text: t("filesCleanupDone", {
          count: cleanup.deletedCount,
          size: formatBytes(cleanup.deletedBytes)
        })
      });
    } catch (error) {
      setFeedback({
        type: "err",
        text: error instanceof Error ? error.message : t("filesCleanupFailed")
      });
    } finally {
      setCleanupBusy(false);
    }
  }, [getToken, t]);

  return (
    <div className="rounded-[22px] border border-border/70 bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{t("filesTitle")}</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
            {t("filesDescription")}
          </p>
        </div>
        <div className="shrink-0 rounded-full border border-border/60 bg-surface-raised px-2.5 py-1 text-[11px] text-text-subtle">
          {files.length} · {formatBytes(totalBytes)}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadFiles(query);
            }}
            placeholder={t("filesSearchPlaceholder")}
            className="h-11 w-full rounded-2xl border border-border bg-surface-raised pr-3 pl-9 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong sm:h-10 sm:text-xs"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadFiles(query)}
          disabled={loading}
          className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border bg-surface-raised px-4 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60 sm:h-10 sm:text-xs"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("refresh")}
        </button>
      </div>

      {cleanupSummary.eligibleCount > 0 ? (
        <div className="mt-2 rounded-2xl border border-border/50 bg-surface-raised/35 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs text-text-subtle">
              <Archive className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {t("filesCleanupAvailable", {
                  count: cleanupSummary.eligibleCount,
                  size: formatBytes(cleanupSummary.eligibleBytes)
                })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCleanupConfirmOpen((current) => !current)}
              className="rounded-full border border-border/70 bg-surface px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:text-text"
            >
              {t("filesCleanupAction")}
            </button>
          </div>
          {cleanupConfirmOpen ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
              <p className="min-w-[180px] flex-1 text-[11px] leading-relaxed text-text-subtle">
                {t("filesCleanupConfirm")}
              </p>
              <button
                type="button"
                onClick={() => void handleCleanupCache()}
                disabled={cleanupBusy}
                className="rounded-full bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
              >
                {cleanupBusy ? "..." : t("filesCleanupConfirmAction")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 max-h-[min(58vh,430px)] overflow-y-auto pr-1">
        {loading && files.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-surface-raised px-3 py-3 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("filesLoading")}
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 bg-surface-raised/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-text">{t("filesEmptyTitle")}</p>
            <p className="mt-1 text-xs text-text-muted">{t("filesEmptyBody")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedFiles.map((group) => {
              const expanded = expandedBuckets[group.bucket] ?? true;
              return (
                <section
                  key={group.bucket}
                  className="overflow-hidden rounded-2xl border border-border/65 bg-surface-raised/25"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedBuckets((current) => ({
                        ...current,
                        [group.bucket]: !(current[group.bucket] ?? true)
                      }))
                    }
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="min-w-0 text-xs font-medium text-text">
                      {bucketLabel(group.bucket, t)}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-2 text-[11px] text-text-subtle">
                      {group.files.length} · {formatBytes(group.bytes)}
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          !expanded && "-rotate-90"
                        )}
                      />
                    </span>
                  </button>

                  {expanded ? (
                    <div className="divide-y divide-border/55 border-t border-border/55">
                      {group.files.map((file) => {
                        const name = fileDisplayName(file);
                        const isEditing = editingRef === file.fileRef;
                        const busy = busyRef === file.fileRef;
                        const openUrl = getAssistantFileDownloadUrl(file.fileRef);
                        const downloadUrl = getAssistantFileDownloadUrl(file.fileRef, {
                          download: true
                        });
                        return (
                          <div key={file.fileRef} className="px-3 py-3">
                            <div className="flex min-w-0 items-start gap-2.5">
                              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" />
                              <div className="min-w-0 flex-1">
                                {isEditing ? (
                                  <input
                                    value={draftName}
                                    onChange={(event) => setDraftName(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") void handleRename(file.fileRef);
                                      if (event.key === "Escape") setEditingRef(null);
                                    }}
                                    className="h-9 w-full rounded-xl border border-border bg-surface px-2 text-sm text-text outline-none focus:border-border-strong"
                                    autoFocus
                                  />
                                ) : (
                                  <p className="truncate text-sm font-medium leading-5 text-text">
                                    {name}
                                  </p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-subtle">
                                  <span className="rounded-full bg-surface px-2 py-0.5">
                                    {originLabel(file, t)}
                                  </span>
                                  <span>{fileKind(file)}</span>
                                  <span>{formatBytes(file.sizeBytes)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="mt-2 flex items-center gap-1.5 pl-6">
                              {isEditing ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRename(file.fileRef)}
                                  disabled={busy || draftName.trim().length === 0}
                                  className="rounded-full bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                                >
                                  {busy ? "..." : t("save")}
                                </button>
                              ) : (
                                <>
                                  <a
                                    href={openUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-xl border border-border bg-surface px-2.5 py-2 text-text-muted transition-colors hover:text-text"
                                    title={t("filesOpen")}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                  <a
                                    href={downloadUrl}
                                    download={name}
                                    className="rounded-xl border border-border bg-surface px-2.5 py-2 text-text-muted transition-colors hover:text-text"
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
                                    className="rounded-xl border border-border bg-surface px-2.5 py-2 text-text-muted transition-colors hover:text-text"
                                    title={t("filesRename")}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDelete(file.fileRef)}
                                    disabled={busy}
                                    className="rounded-xl border border-border bg-surface px-2.5 py-2 text-text-muted transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
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
                  ) : null}
                </section>
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
