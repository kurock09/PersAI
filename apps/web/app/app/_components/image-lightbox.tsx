"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import { useHistoryBackToClose } from "./use-history-back-to-close";

interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt?: string | undefined;
  onClose: () => void;
}

const SCALE_STEPS = [1, 2, 4] as const;
const WHEEL_SENSITIVITY = 0.0015;
const MIN_SCALE = 1;
const MAX_SCALE = 6;

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
 * Zoom UX: double-tap (or click) on the image cycles through 1× → 2× → 4×
 * → 1×, with the zoom centered on the tap point. On desktop, the mouse
 * wheel does smooth zoom. When zoomed in, dragging pans the image. Tap on
 * the dark backdrop or the close button dismisses the lightbox.
 */
export function ImageLightbox({ open, src, alt, onClose }: ImageLightboxProps) {
  const t = useTranslations("chat");
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  useHistoryBackToClose(open, onClose);

  useEffect(() => {
    if (!open) {
      setScale(1);
      setPan({ x: 0, y: 0 });
    }
  }, [open]);

  // ESC closes on desktop. Mobile uses the system Back button via
  // useHistoryBackToClose, so no extra wiring is needed there.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const zoomAt = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const container = containerRef.current;
    if (!container) return;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Keep the point under the cursor stationary while zooming.
    const dx = clientX - cx;
    const dy = clientY - cy;
    setScale((prevScale) => {
      const ratio = clamped / prevScale;
      setPan((prev) => {
        if (clamped === 1) return { x: 0, y: 0 };
        return {
          x: prev.x * ratio + dx * (1 - ratio),
          y: prev.y * ratio + dy * (1 - ratio)
        };
      });
      return clamped;
    });
  }, []);

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      e.stopPropagation();
      const idx = SCALE_STEPS.indexOf(scale as (typeof SCALE_STEPS)[number]);
      const next = SCALE_STEPS[(idx + 1) % SCALE_STEPS.length] ?? 1;
      zoomAt(e.clientX, e.clientY, next);
    },
    [scale, zoomAt]
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
      if (scale <= 1) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y
      };
    },
    [scale, pan]
  );

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setPan({
      x: drag.startPanX + (e.clientX - drag.startX),
      y: drag.startPanY + (e.clientY - drag.startY)
    });
  }, []);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }, []);

  if (!open) return null;

  const closeLabel = t("lightboxClose");

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none"
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? closeLabel}
      onClick={onClose}
      onWheel={handleWheel}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={closeLabel}
        title={closeLabel}
        className="absolute top-3 right-3 z-10 rounded-full bg-black/40 p-2 text-white/90 backdrop-blur transition hover:bg-black/60 hover:text-white"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt ?? ""}
        draggable={false}
        onClick={handleImageClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
          transition: dragRef.current ? "none" : "transform 0.18s ease-out",
          touchAction: "none"
        }}
        className={cn(
          "max-h-full max-w-full object-contain",
          scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        )}
      />
    </div>
  );
}
