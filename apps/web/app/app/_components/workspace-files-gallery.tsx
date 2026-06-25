"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
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
  buildWorkspaceFileUrl,
  deleteChatWorkspaceFile,
  listChatWorkspaceFiles,
  type ChatWorkspaceFileTile
} from "../assistant-api-client";
import { AuthenticatedAttachmentImage } from "./authenticated-attachment-image";
import { ImageLightbox } from "./image-lightbox";

type GalleryFilter = "all" | "image" | "video" | "document";

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
}): string | null {
  if (input.tile.chatId !== null) {
    return buildChatFileUrl({
      chatId: input.tile.chatId,
      storagePath: input.tile.storagePath,
      ...(input.download === true ? { download: true } : {})
    });
  }
  if (input.workspaceId !== null) {
    return buildWorkspaceFileUrl({
      workspaceId: input.workspaceId,
      storagePath: input.tile.storagePath,
      ...(input.download === true ? { download: true } : {})
    });
  }
  return null;
}

function documentIcon(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("pdf")) return FileType;
  if (normalized.includes("sheet") || normalized.includes("excel") || normalized.includes("csv")) {
    return FileSpreadsheet;
  }
  return FileText;
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
  }, [chatId, filter, getToken, t]);

  const loadMore = useCallback(async () => {
    if (!chatId || !nextCursor) return;
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setLoadingMore(true);
    setFeedback(null);
    try {
      const payload = await listChatWorkspaceFiles(token, {
        chatId,
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
  }, [chatId, filter, getToken, nextCursor, t]);

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
      // ADR-127 W1 — delete UI for orphan files (`chatId === null`) ships
      // in W3 with the matching workspace-scoped DELETE endpoint. For
      // now, ignore the click to avoid 4xx noise; the menu still renders
      // so the affordance is visible.
      if (file.chatId === null) {
        // eslint-disable-next-line no-console
        console.warn(
          "workspace-files-gallery: delete skipped — orphan tile (chatId=null) handled in ADR-127 W3."
        );
        return;
      }
      const chatIdForDelete = file.chatId;
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setBusyPath(file.storagePath);
      setFeedback(null);
      try {
        await deleteChatWorkspaceFile(token, {
          chatId: chatIdForDelete,
          storagePath: file.storagePath
        });
        setFiles((current) => current.filter((row) => row.storagePath !== file.storagePath));
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : t("filesDeleteFailed"));
      } finally {
        setBusyPath(null);
      }
    },
    [getToken, t]
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
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {files.map((file) => {
              const label = fileLabel(file);
              const thumbUrl =
                file.attachmentType === "image" && file.thumbnailStoragePath
                  ? buildTileUrl({
                      tile: { chatId: file.chatId, storagePath: file.thumbnailStoragePath },
                      workspaceId
                    })
                  : file.attachmentType === "video" && file.posterStoragePath
                    ? buildTileUrl({
                        tile: { chatId: file.chatId, storagePath: file.posterStoragePath },
                        workspaceId
                      })
                    : null;
              const DocIcon = documentIcon(file.mimeType);
              const showMenu = hoveredPath === file.storagePath;
              return (
                <div
                  key={file.storagePath}
                  className="group relative aspect-square overflow-hidden rounded-2xl border border-border/70 bg-surface-raised shadow-sm transition hover:border-border-strong hover:shadow-md"
                  onMouseEnter={() => setHoveredPath(file.storagePath)}
                  onMouseLeave={() =>
                    setHoveredPath((current) => (current === file.storagePath ? null : current))
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setHoveredPath(file.storagePath);
                  }}
                >
                  <button
                    type="button"
                    className="absolute inset-0 flex h-full w-full flex-col"
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
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface to-surface-raised px-3 text-center">
                        {file.attachmentType === "video" ? (
                          <Video className="h-8 w-8 text-text-subtle" />
                        ) : file.attachmentType === "audio" ? (
                          <FileAudio className="h-8 w-8 text-text-subtle" />
                        ) : file.attachmentType === "document" ? (
                          <DocIcon className="h-8 w-8 text-text-subtle" />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-text-subtle" />
                        )}
                        <span className="line-clamp-2 text-[11px] font-medium text-text-muted">
                          {label}
                        </span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-2 py-2 text-left">
                      <p className="truncate text-[11px] font-medium text-white">{label}</p>
                      <p className="text-[10px] text-white/75">{formatBytes(file.sizeBytes)}</p>
                    </div>
                    {file.attachmentType === "video" ? (
                      <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white">
                        <Play className="h-4 w-4" />
                      </span>
                    ) : null}
                  </button>
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
              );
            })}
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
