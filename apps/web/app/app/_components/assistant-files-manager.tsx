"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ChevronDown,
  Archive,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import { userFieldClassName, userPillButtonClassName } from "./form-ui";
import {
  cleanupAssistantFilesCache,
  deleteAssistantFile,
  getAssistantFileDownloadUrl,
  getAssistantFiles,
  patchAssistantFileDisplayName,
  type AssistantFilesCleanupSummary,
  type AssistantFileState
} from "../assistant-api-client";
import { ImageLightbox } from "./image-lightbox";
import { useHistoryBackToClose } from "./use-history-back-to-close";

type FileBucket = AssistantFileState["fileBucket"];

const FILE_BUCKETS: FileBucket[] = [
  "media_uploads",
  "documents",
  "assistant_created",
  "user_files"
];

const DEFAULT_EXPANDED_BUCKETS: Record<FileBucket, boolean> = {
  user_files: false,
  assistant_created: false,
  documents: false,
  media_uploads: false,
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

function isPreviewableMedia(file: AssistantFileState): boolean {
  return file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/");
}

function documentVersionLabel(file: AssistantFileState): string | null {
  const link = file.documentLink;
  if (!link) {
    return null;
  }
  return typeof link.versionNumber === "number" ? `v${link.versionNumber}` : null;
}

function bucketLabel(
  bucket: FileBucket,
  t: (
    key:
      | "filesBucket_user_files"
      | "filesBucket_assistant_created"
      | "filesBucket_documents"
      | "filesBucket_media_uploads"
      | "filesBucket_cache_history"
  ) => string
): string {
  switch (bucket) {
    case "user_files":
      return t("filesBucket_user_files");
    case "assistant_created":
      return t("filesBucket_assistant_created");
    case "documents":
      return t("filesBucket_documents");
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

function isVisibleInMainFilesList(file: AssistantFileState): boolean {
  return (
    file.documentLink === null ||
    file.documentLink === undefined ||
    file.documentLink.isCurrentOutput
  );
}

function VideoPreviewModal({
  file,
  src,
  downloadUrl,
  onClose
}: {
  file: AssistantFileState;
  src: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const name = fileDisplayName(file);
  useHistoryBackToClose(true, onClose);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={onClose}
    >
      <div className="absolute top-3 right-3 left-3 z-10 flex items-center justify-end gap-2">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/45 p-1 text-white/90 shadow-lg shadow-black/20 backdrop-blur-md">
          <a
            href={downloadUrl}
            download={name}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("filesDownload")}
            title={t("filesDownload")}
            className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium transition hover:bg-white/10 hover:text-white"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t("filesDownload")}</span>
          </a>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label={t("filesPreviewClose")}
            title={t("filesPreviewClose")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <video
        controls
        playsInline
        preload="metadata"
        src={src}
        className="max-h-full max-w-full rounded-2xl border border-white/10 bg-black"
        onClick={(event) => event.stopPropagation()}
      >
        <track kind="captions" />
      </video>
    </div>
  );
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
  const [previewFileRef, setPreviewFileRef] = useState<string | null>(null);

  const totalBytes = useMemo(
    () =>
      files
        .filter((file) => !file.cleanupEligible)
        .filter(isVisibleInMainFilesList)
        .reduce((sum, file) => sum + Math.max(0, file.sizeBytes), 0),
    [files]
  );
  const visibleFileCount = useMemo(
    () => files.filter((file) => !file.cleanupEligible).filter(isVisibleInMainFilesList).length,
    [files]
  );
  const groupedFiles = useMemo(() => groupFiles(files.filter(isVisibleInMainFilesList)), [files]);
  const previewFile = useMemo(
    () => files.find((file) => file.fileRef === previewFileRef) ?? null,
    [files, previewFileRef]
  );

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
        if (previewFileRef === fileRef) {
          setPreviewFileRef(null);
        }
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
    [getToken, previewFileRef, t]
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
    <div className="px-1 py-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{t("filesTitle")}</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
            {t("filesDescription")}
          </p>
        </div>
        <div className="shrink-0 rounded-full border border-border/50 bg-surface-raised/55 px-2.5 py-1 text-[11px] text-text-subtle">
          {visibleFileCount} · {formatBytes(totalBytes)}
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
            className={userFieldClassName("h-11 pr-3 pl-9 sm:h-10 sm:text-xs")}
          />
        </div>
        <button
          type="button"
          onClick={() => void loadFiles(query)}
          disabled={loading}
          className={userPillButtonClassName("secondary", "h-11 sm:h-10 sm:text-xs")}
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
        <div className="mt-2 rounded-2xl border border-accent/20 bg-accent/8 px-3 py-2">
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
              className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15"
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
        ) : groupedFiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 bg-surface-raised/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-text">{t("filesEmptyTitle")}</p>
            <p className="mt-1 text-xs text-text-muted">{t("filesEmptyBody")}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {groupedFiles.map((group) => {
              const expanded = expandedBuckets[group.bucket] ?? true;
              return (
                <section
                  key={group.bucket}
                  className="overflow-hidden rounded-xl border border-border/45 bg-background/28"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedBuckets((current) => ({
                        ...current,
                        [group.bucket]: !(current[group.bucket] ?? true)
                      }))
                    }
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover/35"
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
                    <div className="divide-y divide-border/45 border-t border-border/45">
                      {group.files.map((file) => {
                        const name = fileDisplayName(file);
                        const isEditing = editingRef === file.fileRef;
                        const busy = busyRef === file.fileRef;
                        const versionLabel = documentVersionLabel(file);
                        const currentOutputPinned =
                          file.documentLink?.isCurrentOutput === true
                            ? t("filesDocumentCurrentOutputPinnedShort")
                            : null;
                        const downloadUrl = getAssistantFileDownloadUrl(file.fileRef, {
                          download: true
                        });
                        return (
                          <div key={file.fileRef} className="px-3 py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <FileText className="h-4 w-4 shrink-0 text-text-subtle" />
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  {isEditing ? (
                                    <input
                                      value={draftName}
                                      onChange={(event) => setDraftName(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") void handleRename(file.fileRef);
                                        if (event.key === "Escape") setEditingRef(null);
                                      }}
                                      className="h-8 min-w-0 flex-1 rounded-xl border border-border/55 bg-background/55 px-2 text-sm text-text outline-none focus:border-border-strong"
                                      autoFocus
                                    />
                                  ) : (
                                    <p className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-text">
                                      {name}
                                    </p>
                                  )}
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
                                      <span className="shrink-0 text-[11px] text-text-subtle">
                                        {formatBytes(file.sizeBytes)}
                                      </span>
                                      <div className="ml-2 flex shrink-0 items-center gap-1">
                                        {isPreviewableMedia(file) ? (
                                          <button
                                            type="button"
                                            onClick={() => setPreviewFileRef(file.fileRef)}
                                            className="rounded-full border border-border/45 bg-background/55 p-2 text-text-muted transition-colors hover:text-text"
                                            title={t("filesPreview")}
                                            aria-label={t("filesPreview")}
                                          >
                                            <Eye className="h-3.5 w-3.5" />
                                          </button>
                                        ) : null}
                                        <a
                                          href={downloadUrl}
                                          download={name}
                                          className="rounded-full border border-border/45 bg-background/55 p-2 text-text-muted transition-colors hover:text-text"
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
                                          className="rounded-full border border-border/45 bg-background/55 p-2 text-text-muted transition-colors hover:text-text"
                                          title={t("filesRename")}
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleDelete(file.fileRef)}
                                          disabled={busy}
                                          className="rounded-full border border-border/45 bg-background/55 p-2 text-text-muted transition-colors hover:border-destructive/35 hover:text-destructive disabled:opacity-50"
                                          title={t("filesDelete")}
                                        >
                                          {busy ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          ) : (
                                            <Trash2 className="h-3.5 w-3.5" />
                                          )}
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                                {currentOutputPinned || versionLabel ? (
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-subtle">
                                    {currentOutputPinned ? (
                                      <span className="rounded-full bg-surface-raised/45 px-2 py-0.5">
                                        {currentOutputPinned}
                                      </span>
                                    ) : null}
                                    {versionLabel ? (
                                      <span className="rounded-full bg-surface-raised/45 px-2 py-0.5 text-text-subtle">
                                        {versionLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
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
      {previewFile?.mimeType.startsWith("image/") ? (
        <ImageLightbox
          open
          src={getAssistantFileDownloadUrl(previewFile.fileRef)}
          downloadUrl={getAssistantFileDownloadUrl(previewFile.fileRef, { download: true })}
          filename={fileDisplayName(previewFile)}
          alt={fileDisplayName(previewFile)}
          onClose={() => setPreviewFileRef(null)}
        />
      ) : null}
      {previewFile?.mimeType.startsWith("video/") ? (
        <VideoPreviewModal
          file={previewFile}
          src={getAssistantFileDownloadUrl(previewFile.fileRef)}
          downloadUrl={getAssistantFileDownloadUrl(previewFile.fileRef, { download: true })}
          onClose={() => setPreviewFileRef(null)}
        />
      ) : null}
    </div>
  );
}
