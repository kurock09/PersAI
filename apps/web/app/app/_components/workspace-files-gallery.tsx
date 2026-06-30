"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Archive,
  Download,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileType,
  ImageIcon,
  Loader2,
  Play,
  Trash2,
  Video
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  buildChatFileUrl,
  buildChatFilePreviewUrl,
  buildWorkspaceFileUrl,
  buildWorkspaceFilePreviewUrl,
  deleteChatWorkspaceFile,
  deleteWorkspaceFile,
  listChatWorkspaceFiles,
  type ChatWorkspaceFileTile
} from "../assistant-api-client";
import { AuthenticatedAttachmentImage } from "./authenticated-attachment-image";
import { ImageLightbox } from "./image-lightbox";

type GalleryFilter = "all" | "image" | "video" | "document";
type GalleryScope = "chat" | "workspace";

const FILTER_OPTIONS: GalleryFilter[] = ["all", "image", "video", "document"];

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

function fileLabel(file: ChatWorkspaceFileTile): string {
  return file.originalFilename ?? file.storagePath.split("/").pop() ?? "file";
}

// ADR-127 W1 — pick chat-scoped URL when the tile has a chat origin,
// otherwise fall back to the workspace-scoped URL (manifest orphan).
function buildTileUrl(input: {
  tile: { chatId: string | null; storagePath: string };
  workspaceId: string | null;
  download?: boolean;
  preview?: boolean;
}): string | null {
  if (input.tile.chatId !== null) {
    if (input.preview === true) {
      return buildChatFilePreviewUrl({
        chatId: input.tile.chatId,
        storagePath: input.tile.storagePath
      });
    }
    return buildChatFileUrl({
      chatId: input.tile.chatId,
      storagePath: input.tile.storagePath,
      ...(input.download === true ? { download: true } : {})
    });
  }
  if (input.workspaceId !== null) {
    if (input.preview === true) {
      return buildWorkspaceFilePreviewUrl({
        workspaceId: input.workspaceId,
        storagePath: input.tile.storagePath
      });
    }
    return buildWorkspaceFileUrl({
      workspaceId: input.workspaceId,
      storagePath: input.tile.storagePath,
      ...(input.download === true ? { download: true } : {})
    });
  }
  return null;
}

function documentIcon(mimeType: string): {
  icon: ComponentType<{ className?: string }>;
  colorClass: string;
} {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("pdf")) return { icon: FileType, colorClass: "text-red-500" };
  if (normalized.includes("sheet") || normalized.includes("excel") || normalized.includes("csv")) {
    return { icon: FileSpreadsheet, colorClass: "text-emerald-500" };
  }
  if (
    normalized.includes("word") ||
    normalized.includes("msword") ||
    normalized.includes("docx") ||
    normalized.includes("odt")
  ) {
    return { icon: FileText, colorClass: "text-blue-500" };
  }
  if (
    normalized.includes("zip") ||
    normalized.includes("archive") ||
    normalized.includes("tar") ||
    normalized.includes("gzip") ||
    normalized.includes("x-rar") ||
    normalized.includes("x-7z")
  ) {
    return { icon: Archive, colorClass: "text-amber-500" };
  }
  return { icon: FileText, colorClass: "text-text-muted" };
}

function TileMenu({
  open,
  onDownload,
  onDelete,
  busy
}: {
  open: boolean;
  onDownload: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const t = useTranslations("settings");
  if (!open) return null;
  return (
    <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-full border border-border/70 bg-surface/95 p-1 shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDownload();
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
        aria-label={t("filesDownload")}
        title={t("filesDownload")}
      >
        <Download className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
        aria-label={t("filesDelete")}
        title={t("filesDelete")}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ADR-127 W1 — `workspaceId` enables the gallery to render manifest-only
// orphan tiles (model `files.write` with no chat attachment). When the
// caller does not have a workspaceId in hand, orphan tiles will fall back
// to chat-scoped URLs which 404 cleanly until the parent threads it
// through.
export function WorkspaceFilesGallery({
  chatId,
  workspaceId
}: {
  chatId: string | null;
  workspaceId: string | null;
}) {
  const t = useTranslations("settings");
  const { getToken } = useAuth();
  const [scope, setScope] = useState<GalleryScope>("chat");
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [files, setFiles] = useState<ChatWorkspaceFileTile[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    src: string;
    downloadUrl: string;
    filename?: string;
    mediaType: "image" | "video";
    galleryItems: Array<{ src: string; downloadUrl?: string; filename?: string; alt?: string }>;
    currentIndex: number;
  } | null>(null);

  const previewableMedia = useMemo(
    () =>
      files.filter((file) => file.attachmentType === "image" || file.attachmentType === "video"),
    [files]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!chatId) {
        setFiles([]);
        setNextCursor(null);
        return;
      }
      const token = await getToken({ skipCache: true });
      if (!token || cancelled) return;
      setLoading(true);
      setFeedback(null);
      try {
        const payload = await listChatWorkspaceFiles(token, {
          chatId,
          scope,
          type: filter,
          cursor: null,
          limit: 24
        });
        if (!cancelled) {
          setFiles(payload.files);
          setNextCursor(payload.nextCursor);
        }
      } catch (error) {
        if (!cancelled) {
          setFeedback(error instanceof Error ? error.message : t("filesLoadFailed"));
          setFiles([]);
          setNextCursor(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, filter, getToken, scope, t]);

  const loadMore = useCallback(async () => {
    if (!chatId || !nextCursor) return;
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setLoadingMore(true);
    setFeedback(null);
    try {
      const payload = await listChatWorkspaceFiles(token, {
        chatId,
        scope,
        type: filter,
        cursor: nextCursor,
        limit: 24
      });
      setFiles((current) => [...current, ...payload.files]);
      setNextCursor(payload.nextCursor);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("filesLoadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }, [chatId, filter, getToken, nextCursor, scope, t]);

  const openPreview = useCallback(
    (file: ChatWorkspaceFileTile) => {
      const galleryItems = previewableMedia
        .map((item) => {
          const src = buildTileUrl({ tile: item, workspaceId });
          if (src === null) return null;
          const downloadUrl = buildTileUrl({ tile: item, workspaceId, download: true }) ?? src;
          return {
            src,
            downloadUrl,
            filename: fileLabel(item),
            alt: fileLabel(item)
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const currentIndex = previewableMedia.findIndex(
        (item) => item.storagePath === file.storagePath
      );
      const fileSrc = buildTileUrl({ tile: file, workspaceId });
      if (fileSrc === null) return;
      const fileDownloadUrl = buildTileUrl({ tile: file, workspaceId, download: true }) ?? fileSrc;
      setPreview({
        src: fileSrc,
        downloadUrl: fileDownloadUrl,
        filename: fileLabel(file),
        mediaType: file.attachmentType === "video" ? "video" : "image",
        galleryItems,
        currentIndex: currentIndex >= 0 ? currentIndex : 0
      });
    },
    [previewableMedia, workspaceId]
  );

  const handleTileClick = useCallback(
    (file: ChatWorkspaceFileTile) => {
      if (file.attachmentType === "image" || file.attachmentType === "video") {
        openPreview(file);
        return;
      }
      const url = buildTileUrl({ tile: file, workspaceId, download: true });
      if (url === null) return;
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [openPreview, workspaceId]
  );

  const handleDelete = useCallback(
    async (file: ChatWorkspaceFileTile) => {
      const token = await getToken({ skipCache: true });
      if (!token) return;
      if (file.chatId === null && workspaceId === null) {
        setFeedback(t("filesDeleteFailed"));
        return;
      }
      setBusyPath(file.storagePath);
      setFeedback(null);
      try {
        if (file.chatId !== null) {
          await deleteChatWorkspaceFile(token, {
            chatId: file.chatId,
            storagePath: file.storagePath
          });
        } else {
          await deleteWorkspaceFile(token, {
            workspaceId: workspaceId!,
            storagePath: file.storagePath
          });
        }
        setFiles((current) => current.filter((row) => row.storagePath !== file.storagePath));
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : t("filesDeleteFailed"));
      } finally {
        setBusyPath(null);
      }
    },
    [getToken, t, workspaceId]
  );

  if (!chatId) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-surface-raised/40 px-4 py-8 text-center">
        <p className="text-sm font-medium text-text">{t("filesEmptyTitle")}</p>
        <p className="mt-1 text-xs text-text-muted">{t("filesEmptyBody")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="workspace-files-gallery">
      <div>
        <p className="text-sm font-medium text-text">{t("filesTitle")}</p>
        <p className="mt-1 text-xs text-text-muted">{t("filesDescription")}</p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="workspace-files-scope">
        <button
          type="button"
          onClick={() => setScope("chat")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            scope === "chat"
              ? "border-accent/40 bg-accent/10 text-text"
              : "border-border/70 bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text"
          )}
        >
          {t("workspaceFilesScopeChat")}
        </button>
        <button
          type="button"
          onClick={() => setScope("workspace")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            scope === "workspace"
              ? "border-accent/40 bg-accent/10 text-text"
              : "border-border/70 bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text"
          )}
        >
          {t("workspaceFilesScopeAll")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="workspace-files-filters">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === option
                ? "border-accent/40 bg-accent/10 text-text"
                : "border-border/70 bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text"
            )}
          >
            {option === "all"
              ? t("workspaceFilesFilterAll")
              : option === "image"
                ? t("workspaceFilesFilterImages")
                : option === "video"
                  ? t("workspaceFilesFilterVideos")
                  : t("workspaceFilesFilterDocuments")}
          </button>
        ))}
      </div>

      {feedback ? <p className="text-xs text-text-subtle">{feedback}</p> : null}

      {loading && files.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("filesLoading")}
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 bg-surface-raised/40 px-4 py-10 text-center">
          <p className="text-sm font-medium text-text">
            {filter === "image"
              ? t("workspaceFilesEmptyImages")
              : filter === "video"
                ? t("workspaceFilesEmptyVideos")
                : filter === "document"
                  ? t("workspaceFilesEmptyDocuments")
                  : t("filesEmptyTitle")}
          </p>
        </div>
      ) : (
        <>
          <div className="max-h-[min(64vh,540px)] overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {files.map((file) => {
                const label = fileLabel(file);
                const thumbUrl =
                  file.attachmentType === "image" && file.thumbnailStoragePath
                    ? buildTileUrl({
                        tile: { chatId: file.chatId, storagePath: file.thumbnailStoragePath },
                        workspaceId,
                        preview: true
                      })
                    : file.attachmentType === "video" && file.posterStoragePath
                      ? buildTileUrl({
                          tile: { chatId: file.chatId, storagePath: file.posterStoragePath },
                          workspaceId,
                          preview: true
                        })
                      : file.attachmentType === "image" || file.attachmentType === "video"
                        ? buildTileUrl({ tile: file, workspaceId, preview: true })
                        : null;
                const { icon: DocIcon, colorClass: docColorClass } = documentIcon(file.mimeType);
                const showMenu = hoveredPath === file.storagePath;
                return (
                  <div
                    key={file.storagePath}
                    className="group"
                    onMouseEnter={() => setHoveredPath(file.storagePath)}
                    onMouseLeave={() =>
                      setHoveredPath((current) => (current === file.storagePath ? null : current))
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setHoveredPath(file.storagePath);
                    }}
                  >
                    <div className="relative aspect-square overflow-hidden rounded-xl border border-border/45 bg-background/35 transition-colors hover:bg-surface-raised/45 hover:border-border/70">
                      <button
                        type="button"
                        className="absolute inset-0 flex h-full w-full items-center justify-center"
                        onClick={() => handleTileClick(file)}
                        data-testid={`workspace-file-tile-${file.attachmentType}`}
                      >
                        {thumbUrl ? (
                          <AuthenticatedAttachmentImage
                            src={thumbUrl}
                            alt={label}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-transparent">
                            {file.attachmentType === "video" ? (
                              <Video className="h-10 w-10 text-text-muted" />
                            ) : file.attachmentType === "audio" ? (
                              <FileAudio className="h-10 w-10 text-purple-500" />
                            ) : file.attachmentType === "document" ? (
                              <DocIcon className={cn("h-10 w-10", docColorClass)} />
                            ) : (
                              <ImageIcon className="h-10 w-10 text-text-muted" />
                            )}
                          </div>
                        )}
                        {file.attachmentType === "video" ? (
                          <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white">
                            <Play className="h-4 w-4" />
                          </span>
                        ) : null}
                      </button>

                      {/* Mobile: always-visible trash icon */}
                      <div className="absolute right-1.5 top-1.5 z-20 md:hidden">
                        <button
                          type="button"
                          disabled={busyPath === file.storagePath}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(file);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-surface/90 text-text-subtle backdrop-blur transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                          aria-label={t("filesDelete")}
                          title={t("filesDelete")}
                        >
                          {busyPath === file.storagePath ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>

                      {/* Desktop: hover menu with download + delete */}
                      <div className="hidden md:block">
                        <TileMenu
                          open={showMenu}
                          busy={busyPath === file.storagePath}
                          onDownload={() => {
                            const url = buildTileUrl({ tile: file, workspaceId, download: true });
                            if (url === null) return;
                            window.open(url, "_blank", "noopener,noreferrer");
                          }}
                          onDelete={() => void handleDelete(file)}
                        />
                      </div>
                    </div>

                    <div className="mt-1.5 space-y-0.5 px-0.5">
                      <p className="truncate text-[12px] font-medium text-text">{label}</p>
                      <p className="text-[11px] text-text-muted">{formatBytes(file.sizeBytes)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {nextCursor ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="rounded-full border border-border/70 bg-surface-raised px-4 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-60"
              >
                {loadingMore ? t("filesLoading") : t("workspaceFilesLoadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}

      {preview ? (
        <ImageLightbox
          open
          src={preview.src}
          downloadUrl={preview.downloadUrl}
          filename={preview.filename}
          alt={preview.filename}
          mediaType={preview.mediaType}
          galleryItems={preview.galleryItems}
          currentIndex={preview.currentIndex}
          onNavigate={(nextIndex) => {
            const next = preview.galleryItems[nextIndex];
            if (!next) return;
            setPreview((current) =>
              current
                ? {
                    ...current,
                    src: next.src,
                    downloadUrl: next.downloadUrl ?? next.src,
                    ...(next.filename ? { filename: next.filename } : {}),
                    mediaType:
                      previewableMedia[nextIndex]?.attachmentType === "video" ? "video" : "image",
                    currentIndex: nextIndex
                  }
                : current
            );
          }}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
