"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/nextjs";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  Share2,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  canNativeMediaAction,
  NATIVE_MEDIA_TRANSFER_EVENT,
  tryNativeMediaSave,
  tryNativeMediaShare,
  type NativeMediaTransferEventDetail,
  type NativeMediaTransferRequest
} from "./persai-native-bridge";
import { useHistoryBackToClose } from "./use-history-back-to-close";
import { useAuthenticatedVideoPosterUrl } from "./use-authenticated-video-poster-url";

interface ImageLightboxProps {
  open: boolean;
  src: string;
  downloadUrl?: string | undefined;
  filename?: string | undefined;
  alt?: string | undefined;
  mediaType?: "image" | "video" | undefined;
  posterSrc?: string | null | undefined;
  videoSourceUrl?: string | null | undefined;
  galleryItems?: Array<{
    src: string;
    downloadUrl?: string | undefined;
    filename?: string | undefined;
    alt?: string | undefined;
  }>;
  currentIndex?: number | undefined;
  onNavigate?: ((nextIndex: number) => void) | undefined;
  onClose: () => void;
}

const SCALE_STEPS = [1, 2, 4] as const;
const WHEEL_SENSITIVITY = 0.0015;
const MIN_SCALE = 1;
const MAX_SCALE = 6;
const SWIPE_CLOSE_THRESHOLD_PX = 120;
const SWIPE_GALLERY_THRESHOLD_PX = 72;
const VIDEO_CHROME_AUTO_HIDE_MS = 1800;
const SESSION_TOKEN_HEADER = "X-PersAI-Session-Token";

function safeMediaFilename(
  filename: string | undefined,
  mediaType: "image" | "video" = "image"
): string {
  const trimmed = filename?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  return mediaType === "video" ? "persai-video.mp4" : "persai-image.jpg";
}

function formatMediaTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }
  const rounded = Math.floor(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function guessMimeTypeFromFilename(
  filename: string | undefined,
  mediaType: "image" | "video"
): string | null {
  const normalized = filename?.trim().toLowerCase() ?? "";
  const extension = normalized.includes(".") ? (normalized.split(".").at(-1) ?? "") : "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    default:
      return mediaType === "video" ? "video/mp4" : "image/jpeg";
  }
}

type ResolvedLightboxAsset = {
  blob: Blob;
  objectUrl: string | null;
};

function buildNativeTransferRequest(input: {
  requestId: string;
  mode: "remote" | "inline";
  mediaType: "image" | "video";
  assetUrl: string;
  assetFilename: string;
  assetMimeType: string | null;
  sessionToken: string | null;
  inlineBase64?: string | undefined;
}): NativeMediaTransferRequest | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  return {
    requestId: input.requestId,
    mode: input.mode,
    mediaType: input.mediaType,
    ...(input.mode === "remote" ? { url: new URL(input.assetUrl, window.location.href).href } : {}),
    ...(input.mode === "inline" && input.inlineBase64 ? { inlineBase64: input.inlineBase64 } : {}),
    filename: input.assetFilename,
    title: input.assetFilename,
    userAgent: navigator.userAgent,
    mimeType: input.assetMimeType ?? undefined,
    sessionToken: input.sessionToken ?? undefined
  };
}

type LightboxTransferStage =
  | "preparing"
  | "started"
  | "downloading"
  | "processing"
  | "completed"
  | "failed";

type LightboxNativeTransferState = {
  requestId: string;
  action: "save" | "share";
  stage: LightboxTransferStage;
  progress: number | null;
  bytesDownloaded: number | null;
  totalBytes: number | null;
};

function createTransferRequestId(action: "save" | "share"): string {
  return `lightbox-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      resolve(separator >= 0 ? result.slice(separator + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function resolveTransferProgress(detail: {
  bytesDownloaded?: number | undefined;
  totalBytes?: number | undefined;
}): number | null {
  if (
    typeof detail.bytesDownloaded !== "number" ||
    typeof detail.totalBytes !== "number" ||
    !Number.isFinite(detail.bytesDownloaded) ||
    !Number.isFinite(detail.totalBytes) ||
    detail.totalBytes <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(1, detail.bytesDownloaded / detail.totalBytes));
}

async function fetchAssetBlobWithProgress(
  url: string,
  headers: HeadersInit | undefined,
  onProgress?: (downloaded: number, totalBytes: number | null) => void
): Promise<Blob> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...(headers === undefined ? {} : { headers })
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch media asset: ${response.status}`);
  }
  const contentType = response.headers.get("Content-Type") ?? undefined;
  const totalHeader = response.headers.get("Content-Length");
  const parsedTotal = totalHeader ? Number(totalHeader) : Number.NaN;
  const totalBytes = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;
  if (response.body === null) {
    const blob = await response.blob();
    onProgress?.(blob.size, blob.size);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  onProgress?.(0, totalBytes);
  let readResult = await reader.read();
  while (!readResult.done) {
    if (readResult.value) {
      chunks.push(readResult.value);
      downloaded += readResult.value.length;
      onProgress?.(downloaded, totalBytes ?? downloaded);
    }
    readResult = await reader.read();
  }
  const blob = new Blob(
    chunks as BlobPart[],
    contentType !== undefined ? { type: contentType } : undefined
  );
  onProgress?.(blob.size, blob.size);
  return blob;
}

/**
 * Full-screen image viewer used in chat for tapping image attachments.
 *
 * Why an in-app modal instead of `<a target="_blank">`: in the Capacitor
 * Android shell (ADR-075) opening the raw image URL navigates the WebView
 * away from the app — there are no zoom controls, the system Back button
 * doesn't return to the chat, and the app gets wedged until restart. A
 * client-side lightbox keeps everything inside React, supports zoom/pan
 * out of the box, and integrates with {@link useHistoryBackToClose} so
 * Android Back closes the picture instead of closing the app.
 *
 * Zoom UX:
 *   - Two-finger pinch on touch devices — natural scale + pan, centered on
 *     the midpoint between the fingers.
 *   - Single tap (or click) on the image cycles 1× → 2× → 4× → 1×, with
 *     the zoom centered on the tap point.
 *   - Mouse wheel on desktop does smooth zoom.
 *   - When zoomed in, single-finger drag pans the image.
 *   - Tap on the dark backdrop or the close button dismisses the lightbox.
 */
export function ImageLightbox({
  open,
  src,
  downloadUrl,
  filename,
  alt,
  mediaType = "image",
  posterSrc,
  videoSourceUrl,
  galleryItems,
  currentIndex,
  onNavigate,
  onClose
}: ImageLightboxProps) {
  const t = useTranslations("chat");
  const { getToken } = useAuth();
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [sharing, setSharing] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoDurationSec, setVideoDurationSec] = useState(0);
  const [videoCurrentTimeSec, setVideoCurrentTimeSec] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [swipeDismissOffsetY, setSwipeDismissOffsetY] = useState(0);
  const [nativeTransfer, setNativeTransfer] = useState<LightboxNativeTransferState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const assetFetchRef = useRef<Promise<ResolvedLightboxAsset> | null>(null);
  const assetCacheRef = useRef<ResolvedLightboxAsset | null>(null);
  const videoChromeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeTransferClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNativeTransferRequestIdRef = useRef<string | null>(null);
  // Active pointer tracking for pinch + drag.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
    startPan: { x: number; y: number };
    startMidpoint: { x: number; y: number };
  } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  // Suppress the synthetic onClick that fires after a pinch lifts a finger,
  // otherwise the cycle-zoom would jump scale right after pinch.
  const suppressClickRef = useRef(false);
  const swipeDismissRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    engaged: boolean;
  } | null>(null);
  const gallerySwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    engaged: boolean;
  } | null>(null);
  const swipeDismissOffsetYRef = useRef(0);
  const resolvedGalleryItems =
    mediaType === "image" && galleryItems && galleryItems.length > 1 ? galleryItems : [];
  const hasGallery = resolvedGalleryItems.length > 1 && onNavigate !== undefined;
  const resolvedGalleryIndex =
    hasGallery && typeof currentIndex === "number"
      ? Math.min(Math.max(currentIndex, 0), resolvedGalleryItems.length - 1)
      : 0;
  const galleryPositionLabel = hasGallery
    ? `${resolvedGalleryIndex + 1} / ${resolvedGalleryItems.length}`
    : null;
  const resolvedVideoPosterPreviewUrl = mediaType === "video" ? (posterSrc ?? null) : null;
  const resolvedVideoSourceUrl = mediaType === "video" ? (videoSourceUrl ?? src) : null;
  const { posterUrl: resolvedVideoPosterUrl } = useAuthenticatedVideoPosterUrl({
    posterPreviewUrl: resolvedVideoPosterPreviewUrl,
    videoSourceUrl: resolvedVideoSourceUrl
  });

  useHistoryBackToClose(open, onClose);

  useEffect(() => {
    if (!open) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      setSharing(false);
      setVideoPlaying(false);
      setVideoMuted(false);
      setVideoDurationSec(0);
      setVideoCurrentTimeSec(0);
      setChromeVisible(true);
      setSwipeDismissOffsetY(0);
      setNativeTransfer(null);
      if (videoChromeHideTimeoutRef.current !== null) {
        clearTimeout(videoChromeHideTimeoutRef.current);
        videoChromeHideTimeoutRef.current = null;
      }
      if (nativeTransferClearTimeoutRef.current !== null) {
        clearTimeout(nativeTransferClearTimeoutRef.current);
        nativeTransferClearTimeoutRef.current = null;
      }
      activeNativeTransferRequestIdRef.current = null;
      if (
        assetCacheRef.current?.objectUrl !== null &&
        assetCacheRef.current?.objectUrl !== undefined
      ) {
        URL.revokeObjectURL(assetCacheRef.current.objectUrl);
      }
      assetCacheRef.current = null;
      assetFetchRef.current = null;
      pointersRef.current.clear();
      pinchRef.current = null;
      dragRef.current = null;
      swipeDismissRef.current = null;
      gallerySwipeRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setSwipeDismissOffsetY(0);
    setVideoPlaying(false);
    setVideoMuted(false);
    setNativeTransfer(null);
    pointersRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
    swipeDismissRef.current = null;
    gallerySwipeRef.current = null;
    activeNativeTransferRequestIdRef.current = null;
    if (nativeTransferClearTimeoutRef.current !== null) {
      clearTimeout(nativeTransferClearTimeoutRef.current);
      nativeTransferClearTimeoutRef.current = null;
    }
    if (
      assetCacheRef.current?.objectUrl !== null &&
      assetCacheRef.current?.objectUrl !== undefined
    ) {
      URL.revokeObjectURL(assetCacheRef.current.objectUrl);
    }
    assetCacheRef.current = null;
    assetFetchRef.current = null;
  }, [src]);

  useEffect(() => {
    swipeDismissOffsetYRef.current = swipeDismissOffsetY;
  }, [swipeDismissOffsetY]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleNativeTransferEvent = (event: Event) => {
      const detail = (event as CustomEvent<NativeMediaTransferEventDetail>).detail;
      if (!detail || detail.requestId !== activeNativeTransferRequestIdRef.current) {
        return;
      }
      const nextState: LightboxNativeTransferState = {
        requestId: detail.requestId,
        action: detail.action,
        stage: detail.stage,
        progress: resolveTransferProgress(detail),
        bytesDownloaded:
          typeof detail.bytesDownloaded === "number" && Number.isFinite(detail.bytesDownloaded)
            ? detail.bytesDownloaded
            : null,
        totalBytes:
          typeof detail.totalBytes === "number" && Number.isFinite(detail.totalBytes)
            ? detail.totalBytes
            : null
      };
      setNativeTransfer(nextState);
      if (nativeTransferClearTimeoutRef.current !== null) {
        clearTimeout(nativeTransferClearTimeoutRef.current);
        nativeTransferClearTimeoutRef.current = null;
      }
      if (detail.stage === "completed" || detail.stage === "failed") {
        nativeTransferClearTimeoutRef.current = setTimeout(
          () => {
            setNativeTransfer((current) =>
              current?.requestId === detail.requestId ? null : current
            );
            if (activeNativeTransferRequestIdRef.current === detail.requestId) {
              activeNativeTransferRequestIdRef.current = null;
            }
            nativeTransferClearTimeoutRef.current = null;
          },
          detail.stage === "completed" ? 900 : 2400
        );
      }
    };
    window.addEventListener(
      NATIVE_MEDIA_TRANSFER_EVENT,
      handleNativeTransferEvent as EventListener
    );
    return () => {
      window.removeEventListener(
        NATIVE_MEDIA_TRANSFER_EVENT,
        handleNativeTransferEvent as EventListener
      );
    };
  }, []);

  useEffect(() => {
    if (videoChromeHideTimeoutRef.current !== null) {
      clearTimeout(videoChromeHideTimeoutRef.current);
      videoChromeHideTimeoutRef.current = null;
    }
    if (!open || mediaType !== "video") {
      return;
    }
    if (!videoPlaying) {
      setChromeVisible(true);
      return;
    }
    if (!chromeVisible) {
      return;
    }
    videoChromeHideTimeoutRef.current = setTimeout(() => {
      setChromeVisible(false);
      videoChromeHideTimeoutRef.current = null;
    }, VIDEO_CHROME_AUTO_HIDE_MS);
    return () => {
      if (videoChromeHideTimeoutRef.current !== null) {
        clearTimeout(videoChromeHideTimeoutRef.current);
        videoChromeHideTimeoutRef.current = null;
      }
    };
  }, [chromeVisible, mediaType, open, videoPlaying]);

  useEffect(() => {
    if (!open || mediaType !== "video") {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = videoMuted;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      void playPromise.then(
        () => setVideoPlaying(true),
        () => setVideoPlaying(false)
      );
    }
    if (playPromise === undefined) {
      setVideoPlaying(!video.paused);
    }
  }, [mediaType, open, src, videoMuted]);

  const applyZoom = useCallback(
    (
      anchorX: number,
      anchorY: number,
      nextScale: number,
      basePan: { x: number; y: number },
      baseScale: number
    ) => {
      const container = containerRef.current;
      if (!container) return;
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = anchorX - cx;
      const dy = anchorY - cy;
      const ratio = clamped / baseScale;
      setScale(clamped);
      if (clamped === 1) {
        setPan({ x: 0, y: 0 });
      } else {
        setPan({
          x: basePan.x * ratio + dx * (1 - ratio),
          y: basePan.y * ratio + dy * (1 - ratio)
        });
      }
    },
    []
  );

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      // Read latest scale/pan from state via functional setState pattern —
      // here we use closures over the current state because click/wheel
      // handlers already capture them and re-create on change.
      applyZoom(clientX, clientY, nextScale, pan, scale);
    },
    [applyZoom, pan, scale]
  );

  const navigateGallery = useCallback(
    (direction: -1 | 1) => {
      if (!hasGallery || onNavigate === undefined) {
        return;
      }
      const nextIndex =
        (resolvedGalleryIndex + direction + resolvedGalleryItems.length) %
        resolvedGalleryItems.length;
      onNavigate(nextIndex);
    },
    [hasGallery, onNavigate, resolvedGalleryIndex, resolvedGalleryItems.length]
  );

  // ESC closes on desktop. Arrow keys move through image galleries.
  // Mobile uses the system Back button via useHistoryBackToClose.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (mediaType === "image" && e.key === "ArrowLeft") navigateGallery(-1);
      if (mediaType === "image" && e.key === "ArrowRight") navigateGallery(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mediaType, navigateGallery, open, onClose]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      e.stopPropagation();
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const prefersTapChrome =
        mediaType === "video" ||
        (typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(pointer: coarse)").matches);
      if (prefersTapChrome) {
        setChromeVisible((current) => !current);
        return;
      }
      const idx = SCALE_STEPS.indexOf(scale as (typeof SCALE_STEPS)[number]);
      const next = SCALE_STEPS[(idx + 1) % SCALE_STEPS.length] ?? 1;
      zoomAt(e.clientX, e.clientY, next);
    },
    [mediaType, scale, zoomAt]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!open) return;
      e.preventDefault();
      const next = scale * Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      zoomAt(e.clientX, e.clientY, next);
    },
    [open, scale, zoomAt]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLImageElement>) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      if (typeof target.setPointerCapture === "function") {
        target.setPointerCapture(e.pointerId);
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (scale === 1 && e.pointerType !== "mouse" && pointersRef.current.size === 1) {
        swipeDismissRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          engaged: false
        };
        if (hasGallery && mediaType === "image") {
          gallerySwipeRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            engaged: false
          };
        }
      }

      const points = Array.from(pointersRef.current.values());
      if (points.length === 2) {
        // Second finger landed — start a pinch session. We freeze the scale
        // and pan at this instant and treat all further movement as a delta.
        const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        pinchRef.current = {
          startDistance: distance > 0 ? distance : 1,
          startScale: scale,
          startPan: { ...pan },
          startMidpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        };
        // Cancel any in-flight single-finger drag so the gesture switches
        // cleanly from pan to pinch.
        dragRef.current = null;
      } else if (points.length === 1 && scale > 1) {
        // Single-finger drag-to-pan only when zoomed in.
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y
        };
      }
    },
    [hasGallery, mediaType, scale, pan]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLImageElement>) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const gallerySwipe = gallerySwipeRef.current;
      if (
        gallerySwipe &&
        gallerySwipe.pointerId === e.pointerId &&
        scale === 1 &&
        pointersRef.current.size === 1 &&
        e.pointerType !== "mouse"
      ) {
        const dx = e.clientX - gallerySwipe.startX;
        const dy = e.clientY - gallerySwipe.startY;
        if (!gallerySwipe.engaged) {
          if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.25) {
            gallerySwipe.engaged = true;
            swipeDismissRef.current = null;
          }
        }
        if (gallerySwipe.engaged) {
          return;
        }
      }

      const swipe = swipeDismissRef.current;
      if (
        swipe &&
        swipe.pointerId === e.pointerId &&
        scale === 1 &&
        pointersRef.current.size === 1 &&
        e.pointerType !== "mouse"
      ) {
        const dx = e.clientX - swipe.startX;
        const dy = e.clientY - swipe.startY;
        if (!swipe.engaged) {
          if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(dx) || dy < 0) {
            // keep watching until the gesture direction is obvious
          } else {
            swipe.engaged = true;
          }
        }
        if (swipe.engaged) {
          setSwipeDismissOffsetY(Math.max(0, dy));
          return;
        }
      }

      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const points = Array.from(pointersRef.current.values()).slice(0, 2) as [
          { x: number; y: number },
          { x: number; y: number }
        ];
        const [a, b] = points;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0) {
          const nextScale = pinch.startScale * (distance / pinch.startDistance);
          applyZoom(
            pinch.startMidpoint.x,
            pinch.startMidpoint.y,
            nextScale,
            pinch.startPan,
            pinch.startScale
          );
        }
        return;
      }

      const drag = dragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        setPan({
          x: drag.startPanX + (e.clientX - drag.startX),
          y: drag.startPanY + (e.clientY - drag.startY)
        });
      }
    },
    [applyZoom]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLImageElement>) => {
      pointersRef.current.delete(e.pointerId);
      const wasPinching = pinchRef.current !== null;
      const swipe = swipeDismissRef.current;
      const gallerySwipe = gallerySwipeRef.current;
      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      if (dragRef.current?.pointerId === e.pointerId) {
        dragRef.current = null;
      }
      if (swipe && swipe.pointerId === e.pointerId) {
        if (swipe.engaged) {
          suppressClickRef.current = true;
          if (swipeDismissOffsetYRef.current >= SWIPE_CLOSE_THRESHOLD_PX) {
            onClose();
          } else {
            setSwipeDismissOffsetY(0);
          }
        }
        swipeDismissRef.current = null;
      }
      if (gallerySwipe && gallerySwipe.pointerId === e.pointerId) {
        const dx = e.clientX - gallerySwipe.startX;
        const dy = e.clientY - gallerySwipe.startY;
        if (
          gallerySwipe.engaged &&
          Math.abs(dx) >= SWIPE_GALLERY_THRESHOLD_PX &&
          Math.abs(dx) > Math.abs(dy) * 1.25
        ) {
          suppressClickRef.current = true;
          navigateGallery(dx < 0 ? 1 : -1);
        }
        gallerySwipeRef.current = null;
      }
      // Browsers fire a synthetic click after a touch sequence even if the
      // user clearly meant to pinch — swallow that one click so we don't
      // immediately cycle the zoom.
      if (wasPinching) {
        suppressClickRef.current = true;
      }
    },
    [navigateGallery, onClose]
  );

  const assetFilename = safeMediaFilename(filename ?? alt, mediaType);
  const assetUrl = downloadUrl ?? src;
  const assetMimeType = guessMimeTypeFromFilename(assetFilename, mediaType);

  const triggerDownload = useCallback(
    (resolvedObjectUrl?: string) => {
      if (typeof document === "undefined") return;
      const anchor = document.createElement("a");
      anchor.href = resolvedObjectUrl ?? assetUrl;
      anchor.download = assetFilename;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    },
    [assetFilename, assetUrl]
  );

  const ensureDownloadObjectUrl = useCallback((asset: ResolvedLightboxAsset): string | null => {
    if (asset.objectUrl !== null) {
      return asset.objectUrl;
    }
    if (typeof URL.createObjectURL !== "function") {
      return null;
    }
    asset.objectUrl = URL.createObjectURL(asset.blob);
    return asset.objectUrl;
  }, []);

  const resolveTransferAsset = useCallback(
    async (
      onProgress?: (downloaded: number, totalBytes: number | null) => void
    ): Promise<ResolvedLightboxAsset> => {
      if (assetCacheRef.current !== null) {
        const cached = assetCacheRef.current;
        onProgress?.(cached.blob.size, cached.blob.size);
        return cached;
      }
      if (assetFetchRef.current !== null) {
        return assetFetchRef.current;
      }

      if (mediaType === "image") {
        const image = imageRef.current;
        if (
          image &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0 &&
          typeof document !== "undefined"
        ) {
          if (assetFetchRef.current !== null) {
            return assetFetchRef.current;
          }
          const canvasPromise = (async () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            if (context === null) {
              throw new Error("Failed to acquire canvas context");
            }
            context.drawImage(image, 0, 0);
            const preferredType =
              assetMimeType && assetMimeType.startsWith("image/") ? assetMimeType : "image/png";
            const blob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob((nextBlob) => resolve(nextBlob), preferredType);
            });
            if (blob === null) {
              throw new Error("Failed to encode image blob");
            }
            const resolved: ResolvedLightboxAsset = {
              blob,
              objectUrl: null
            };
            assetCacheRef.current = resolved;
            assetFetchRef.current = null;
            onProgress?.(blob.size, blob.size);
            return resolved;
          })().catch((error) => {
            assetFetchRef.current = null;
            throw error;
          });
          assetFetchRef.current = canvasPromise;
          return canvasPromise;
        }
      }

      const fetchPromise = (async () => {
        const token = (await getToken({ skipCache: true })) ?? (await getToken()) ?? null;
        const headers: HeadersInit | undefined =
          token !== null && assetUrl.startsWith("/")
            ? { [SESSION_TOKEN_HEADER]: token }
            : undefined;
        const blob = await fetchAssetBlobWithProgress(assetUrl, headers, onProgress);
        const resolved: ResolvedLightboxAsset = {
          blob,
          objectUrl: null
        };
        assetCacheRef.current = resolved;
        assetFetchRef.current = null;
        return resolved;
      })().catch((error) => {
        assetFetchRef.current = null;
        throw error;
      });
      assetFetchRef.current = fetchPromise;
      return fetchPromise;
    },
    [assetMimeType, assetUrl, getToken, mediaType]
  );

  useEffect(() => {
    if (!open || mediaType !== "image") {
      return;
    }
    let cancelled = false;
    const warmCache = () => {
      if (cancelled || assetCacheRef.current !== null) {
        return;
      }
      void resolveTransferAsset().catch(() => {
        /* Prefetch is best-effort; share/save will retry with visible progress. */
      });
    };
    const image = imageRef.current;
    if (image !== null && image.complete && image.naturalWidth > 0) {
      warmCache();
      return () => {
        cancelled = true;
      };
    }
    image?.addEventListener("load", warmCache, { once: true });
    return () => {
      cancelled = true;
      image?.removeEventListener("load", warmCache);
    };
  }, [mediaType, open, resolveTransferAsset, src]);

  const publishNativeTransfer = useCallback(
    (
      action: "save" | "share",
      requestId: string,
      stage: LightboxTransferStage,
      bytesDownloaded: number | null,
      totalBytes: number | null
    ) => {
      setNativeTransfer({
        requestId,
        action,
        stage,
        progress: resolveTransferProgress({
          bytesDownloaded: bytesDownloaded ?? undefined,
          totalBytes: totalBytes ?? undefined
        }),
        bytesDownloaded,
        totalBytes
      });
    },
    []
  );

  const pauseVideoPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      setVideoPlaying(false);
      return;
    }
    if (!video.paused && !video.ended) {
      video.pause();
    }
    setVideoPlaying(false);
    setChromeVisible(true);
  }, []);

  const executeNativeMediaTransfer = useCallback(
    async (action: "save" | "share"): Promise<boolean> => {
      const nativeAction = action === "save" ? "saveMedia" : "shareMedia";
      const tryNative = action === "save" ? tryNativeMediaSave : tryNativeMediaShare;
      if (!canNativeMediaAction(nativeAction)) {
        return false;
      }

      const requestId = createTransferRequestId(action);
      activeNativeTransferRequestIdRef.current = requestId;
      if (mediaType === "video") {
        pauseVideoPlayback();
        publishNativeTransfer(action, requestId, "started", 0, null);
      } else {
        publishNativeTransfer(action, requestId, "preparing", null, null);
      }

      const token = (await getToken({ skipCache: true })) ?? (await getToken()) ?? null;

      try {
        if (mediaType === "image") {
          const resolved = await resolveTransferAsset((downloaded, totalBytes) => {
            publishNativeTransfer(action, requestId, "downloading", downloaded, totalBytes);
          });
          publishNativeTransfer(
            action,
            requestId,
            "processing",
            resolved.blob.size,
            resolved.blob.size
          );

          const inlineBase64 = await blobToBase64(resolved.blob);
          const inlineRequest = buildNativeTransferRequest({
            requestId,
            mode: "inline",
            mediaType,
            assetUrl,
            assetFilename,
            assetMimeType,
            sessionToken: token,
            inlineBase64
          });
          if (inlineRequest && tryNative(inlineRequest)) {
            return true;
          }
        }

        if (mediaType !== "video") {
          publishNativeTransfer(action, requestId, "started", null, null);
        }
        const remoteRequest = buildNativeTransferRequest({
          requestId,
          mode: "remote",
          mediaType,
          assetUrl,
          assetFilename,
          assetMimeType,
          sessionToken: token
        });
        if (remoteRequest && tryNative(remoteRequest)) {
          return true;
        }
      } catch {
        publishNativeTransfer(action, requestId, "failed", null, null);
        if (nativeTransferClearTimeoutRef.current !== null) {
          clearTimeout(nativeTransferClearTimeoutRef.current);
        }
        nativeTransferClearTimeoutRef.current = setTimeout(() => {
          setNativeTransfer((current) => (current?.requestId === requestId ? null : current));
          if (activeNativeTransferRequestIdRef.current === requestId) {
            activeNativeTransferRequestIdRef.current = null;
          }
          nativeTransferClearTimeoutRef.current = null;
        }, 2400);
        return false;
      }

      activeNativeTransferRequestIdRef.current = null;
      setNativeTransfer(null);
      return false;
    },
    [
      assetFilename,
      assetMimeType,
      assetUrl,
      getToken,
      mediaType,
      pauseVideoPlayback,
      publishNativeTransfer,
      resolveTransferAsset
    ]
  );

  const handleSave = useCallback(async () => {
    if (await executeNativeMediaTransfer("save")) {
      return;
    }
    try {
      const resolved = await resolveTransferAsset();
      const objectUrl = ensureDownloadObjectUrl(resolved);
      triggerDownload(objectUrl ?? undefined);
    } catch {
      triggerDownload();
    }
  }, [ensureDownloadObjectUrl, executeNativeMediaTransfer, resolveTransferAsset, triggerDownload]);

  const handleShare = useCallback(async () => {
    if (await executeNativeMediaTransfer("share")) {
      return;
    }

    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      await handleSave();
      return;
    }

    setSharing(true);
    try {
      const resolved = await resolveTransferAsset();
      const file = new File([resolved.blob], assetFilename, {
        type:
          resolved.blob.type ||
          assetMimeType ||
          (mediaType === "video" ? "video/mp4" : "image/jpeg")
      });
      const fileShare: ShareData = {
        title: assetFilename,
        files: [file]
      };
      if (typeof navigator.canShare === "function" && navigator.canShare(fileShare)) {
        await navigator.share(fileShare);
        return;
      }
      await navigator.share({
        title: assetFilename,
        url:
          (typeof window !== "undefined"
            ? new URL(assetUrl, window.location.href).href
            : assetUrl) ??
          (typeof window !== "undefined" ? new URL(assetUrl, window.location.href).href : assetUrl)
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        await handleSave();
      }
    } finally {
      setSharing(false);
    }
  }, [
    assetFilename,
    assetMimeType,
    assetUrl,
    executeNativeMediaTransfer,
    handleSave,
    mediaType,
    resolveTransferAsset
  ]);

  const toggleVideoPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused || video.ended) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === "function") {
        await playPromise;
      }
      setVideoPlaying(true);
      return;
    }
    video.pause();
    setVideoPlaying(false);
  }, []);

  const toggleVideoMuted = useCallback(() => {
    const video = videoRef.current;
    const nextMuted = !videoMuted;
    setVideoMuted(nextMuted);
    if (video) {
      video.muted = nextMuted;
    }
  }, [videoMuted]);

  const handleVideoSeek = useCallback((nextValue: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(nextValue)) {
      return;
    }
    video.currentTime = nextValue;
    setVideoCurrentTimeSec(nextValue);
  }, []);

  if (!open) return null;

  const closeLabel = t("lightboxClose");
  const saveLabel = t("lightboxSave");
  const shareLabel = t("lightboxShare");
  const playLabel = t("lightboxPlay");
  const heroPlayLabel = t("lightboxPlayHero");
  const pauseLabel = t("lightboxPause");
  const muteLabel = t("lightboxMute");
  const unmuteLabel = t("lightboxUnmute");
  const mediaTitle = safeMediaFilename(filename ?? alt, mediaType);
  const showTopChrome = chromeVisible;
  const showVideoTransportChrome = mediaType !== "video" || chromeVisible;
  const showVideoHeroPlay = mediaType === "video" && !videoPlaying;
  const showVideoPosterOverlay =
    mediaType === "video" && resolvedVideoPosterUrl !== null && !videoPlaying;
  const nativeTransferBusy =
    nativeTransfer !== null &&
    nativeTransfer.stage !== "completed" &&
    nativeTransfer.stage !== "failed";
  const nativeTransferLabel =
    nativeTransfer === null
      ? null
      : nativeTransfer.stage === "preparing"
        ? t(
            nativeTransfer.action === "save"
              ? "lightboxTransferPreparingSave"
              : "lightboxTransferPreparingShare"
          )
        : nativeTransfer.stage === "downloading"
          ? t(
              nativeTransfer.action === "save"
                ? "lightboxTransferDownloadingSave"
                : "lightboxTransferDownloadingShare"
            )
          : nativeTransfer.stage === "processing"
            ? t(
                nativeTransfer.action === "save"
                  ? "lightboxTransferProcessingSave"
                  : "lightboxTransferProcessingShare"
              )
            : nativeTransfer.stage === "completed"
              ? t(
                  nativeTransfer.action === "save"
                    ? "lightboxTransferCompletedSave"
                    : "lightboxTransferCompletedShare"
                )
              : nativeTransfer.stage === "failed"
                ? t(
                    nativeTransfer.action === "save"
                      ? "lightboxTransferFailedSave"
                      : "lightboxTransferFailedShare"
                  )
                : t(
                    nativeTransfer.action === "save"
                      ? "lightboxTransferStartingSave"
                      : "lightboxTransferStartingShare"
                  );
  const nativeTransferProgressPercent =
    nativeTransfer?.progress !== null && nativeTransfer?.progress !== undefined
      ? Math.round(nativeTransfer.progress * 100)
      : null;
  const nativeTransferIndeterminate = nativeTransferBusy && nativeTransferProgressPercent === null;
  const mediaSurfaceTransform =
    mediaType === "image"
      ? `translate3d(${pan.x}px, ${pan.y + swipeDismissOffsetY}px, 0) scale(${scale})`
      : `translate3d(0, ${swipeDismissOffsetY}px, 0) scale(1)`;
  const mediaSurfaceOpacity =
    swipeDismissOffsetY > 0
      ? Math.max(0.55, 1 - swipeDismissOffsetY / (SWIPE_CLOSE_THRESHOLD_PX * 2))
      : 1;

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 select-none"
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? closeLabel}
      onClick={onClose}
      onWheel={handleWheel}
    >
      {showTopChrome ? (
        <div
          data-testid="media-lightbox-top-chrome"
          className="absolute top-3 right-3 left-3 z-10 flex items-center justify-between gap-3"
        >
          <div className="min-w-0 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] font-medium text-white/75 shadow-lg shadow-black/20 backdrop-blur-md">
            <span className="flex max-w-[48vw] items-center gap-2 truncate sm:max-w-[32rem]">
              <span className="truncate">{mediaTitle}</span>
              {galleryPositionLabel ? (
                <span className="shrink-0 text-white/45">{galleryPositionLabel}</span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/45 p-1 text-white/90 shadow-lg shadow-black/20 backdrop-blur-md">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleSave();
              }}
              disabled={nativeTransferBusy}
              aria-label={saveLabel}
              title={saveLabel}
              className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">{saveLabel}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleShare();
              }}
              disabled={sharing || nativeTransferBusy}
              aria-label={shareLabel}
              title={shareLabel}
              className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">{shareLabel}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={closeLabel}
              title={closeLabel}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}
      {nativeTransfer && nativeTransferLabel ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-4 z-20 flex justify-center">
          <div className="w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-white/10 bg-black/55 px-3 py-3 text-white shadow-xl shadow-black/25 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 text-[12px] font-medium">
              <span>{nativeTransferLabel}</span>
              {nativeTransferProgressPercent !== null ? (
                <span className="shrink-0 text-white/65">{nativeTransferProgressPercent}%</span>
              ) : null}
            </div>
            <div
              className={cn(
                "mt-2 h-1.5 overflow-hidden rounded-full bg-white/12",
                nativeTransferIndeterminate && "animate-pulse"
              )}
            >
              <div
                className={cn(
                  "h-full rounded-full bg-white/85",
                  nativeTransferProgressPercent !== null &&
                    "transition-[width] duration-100 ease-linear"
                )}
                style={{
                  width:
                    nativeTransferProgressPercent !== null
                      ? `${Math.max(8, nativeTransferProgressPercent)}%`
                      : nativeTransferIndeterminate
                        ? "100%"
                        : "100%"
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
      {mediaType === "video" ? (
        <div
          data-testid="media-lightbox-video-surface"
          className="relative flex h-full max-h-[100dvh] w-full items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            setChromeVisible((current) => !current);
          }}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") {
              return;
            }
            swipeDismissRef.current = {
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
              engaged: false
            };
          }}
          onPointerMove={(e) => {
            const swipe = swipeDismissRef.current;
            if (!swipe || swipe.pointerId !== e.pointerId || e.pointerType === "mouse") {
              return;
            }
            const dx = e.clientX - swipe.startX;
            const dy = e.clientY - swipe.startY;
            if (!swipe.engaged) {
              if (Math.abs(dy) >= 10 && Math.abs(dy) > Math.abs(dx) && dy > 0) {
                swipe.engaged = true;
              }
            }
            if (swipe.engaged) {
              setSwipeDismissOffsetY(Math.max(0, dy));
            }
          }}
          onPointerUp={(e) => {
            const swipe = swipeDismissRef.current;
            if (!swipe || swipe.pointerId !== e.pointerId) {
              return;
            }
            if (swipe.engaged) {
              if (swipeDismissOffsetYRef.current >= SWIPE_CLOSE_THRESHOLD_PX) {
                onClose();
              } else {
                setSwipeDismissOffsetY(0);
              }
            }
            swipeDismissRef.current = null;
          }}
          onPointerCancel={() => {
            swipeDismissRef.current = null;
            setSwipeDismissOffsetY(0);
          }}
          style={{
            transform: mediaSurfaceTransform,
            opacity: mediaSurfaceOpacity,
            transition: swipeDismissRef.current?.engaged
              ? "none"
              : "transform 0.18s ease-out, opacity 0.18s ease-out"
          }}
        >
          <video
            ref={videoRef}
            src={src}
            playsInline
            preload="auto"
            muted={videoMuted}
            disableRemotePlayback
            poster={resolvedVideoPosterUrl ?? undefined}
            className={cn(
              "max-h-full max-w-full object-contain",
              showVideoPosterOverlay && "opacity-0"
            )}
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
            onEnded={() => setVideoPlaying(false)}
            onLoadedMetadata={(e) => {
              setVideoDurationSec(e.currentTarget.duration || 0);
              setVideoCurrentTimeSec(e.currentTarget.currentTime || 0);
            }}
            onTimeUpdate={(e) => {
              setVideoCurrentTimeSec(e.currentTarget.currentTime || 0);
            }}
          />
          {showVideoPosterOverlay ? (
            <img
              src={resolvedVideoPosterUrl ?? undefined}
              alt={alt ?? mediaTitle}
              className="pointer-events-none absolute inset-0 m-auto max-h-full max-w-full object-contain"
              data-testid="media-lightbox-video-poster"
            />
          ) : null}
          {showVideoHeroPlay ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void toggleVideoPlayback();
              }}
              aria-label={videoPlaying ? pauseLabel : heroPlayLabel}
              className="absolute inset-0 flex items-center justify-center"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:scale-[1.03]">
                {videoPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-0.5 h-7 w-7" />}
              </span>
            </button>
          ) : null}
          {showVideoTransportChrome ? (
            <div
              data-testid="media-lightbox-video-controls"
              className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-full bg-black/55 px-3 py-2 text-white/90 backdrop-blur-md sm:inset-x-auto sm:left-1/2 sm:w-[min(36rem,calc(100vw-1.5rem))] sm:-translate-x-1/2"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleVideoPlayback();
                }}
                aria-label={videoPlaying ? pauseLabel : playLabel}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
              >
                {videoPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <input
                  type="range"
                  min={0}
                  max={Math.max(videoDurationSec, 0)}
                  step={0.1}
                  value={Math.min(videoCurrentTimeSec, Math.max(videoDurationSec, 0))}
                  onChange={(e) => handleVideoSeek(Number(e.currentTarget.value))}
                  aria-label={t("lightboxSeek")}
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-white/65">
                  <span>{formatMediaTime(videoCurrentTimeSec)}</span>
                  <span>{formatMediaTime(videoDurationSec)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleVideoMuted();
                }}
                aria-label={videoMuted ? unmuteLabel : muteLabel}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
              >
                {videoMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {hasGallery ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateGallery(-1);
                }}
                aria-label={t("lightboxPrevious")}
                className="absolute top-1/2 left-3 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/70 shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-black/45 hover:text-white sm:inline-flex"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateGallery(1);
                }}
                aria-label={t("lightboxNext")}
                className="absolute top-1/2 right-3 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/70 shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-black/45 hover:text-white sm:inline-flex"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}
          <img
            ref={imageRef}
            data-testid="media-lightbox-image-surface"
            src={src}
            alt={alt ?? ""}
            draggable={false}
            crossOrigin={src.startsWith("/") ? "anonymous" : undefined}
            onClick={handleImageClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              transform: mediaSurfaceTransform,
              opacity: mediaSurfaceOpacity,
              transition: dragRef.current ? "none" : "transform 0.18s ease-out",
              touchAction: "none"
            }}
            className={cn(
              "max-h-full max-w-full object-contain",
              scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
            )}
          />
        </>
      )}
    </div>,
    document.body
  );
}
