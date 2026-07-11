"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  hideNativeBrowserBridgeView,
  isNativeBrowserBridgeShell,
  showNativeBrowserBridgeView,
  subscribeNativeBrowserPreview,
  type NativeBrowserPreviewEvent
} from "../browser-bridge-client";
import { pushBackHandler } from "./back-handler-stack";

const PREVIEW_LINGER_MS = 10_000;

function resolveFaviconUrl(event: NativeBrowserPreviewEvent): string | null {
  if (event.faviconDataUrl) {
    return event.faviconDataUrl;
  }
  if (event.pageUrl === null || event.pageUrl === undefined) {
    return null;
  }
  try {
    const host = new URL(event.pageUrl).hostname;
    if (!host) {
      return null;
    }
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return null;
  }
}

export function NativeBrowserPreview() {
  const t = useTranslations("chat");
  const nativeShell = isNativeBrowserBridgeShell();
  const [preview, setPreview] = useState<NativeBrowserPreviewEvent | null>(null);
  const [overlayOpenProfileKey, setOverlayOpenProfileKey] = useState<string | null>(null);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setPreview(null);
      hideTimerRef.current = null;
    }, PREVIEW_LINGER_MS);
  }, [clearHideTimer]);

  useEffect(() => {
    if (!nativeShell) {
      return;
    }
    let disposed = false;
    let removeListener: (() => Promise<void>) | null = null;
    void subscribeNativeBrowserPreview((event) => {
      if (disposed) {
        return;
      }
      if (event.phase === "overlay_hidden") {
        setOverlayOpenProfileKey((current) => (current === event.profileKey ? null : current));
        return;
      }
      if (event.phase === "end") {
        scheduleHide();
        return;
      }
      clearHideTimer();
      if (event.imageDataUrl !== null) {
        setPreview(event);
      }
    })
      .then((remove) => {
        if (disposed) {
          void remove();
          return;
        }
        removeListener = remove;
      })
      .catch(() => {
        // Older installed shells do not expose preview events; browser work
        // remains fully functional without the optional visual companion.
      });
    return () => {
      disposed = true;
      clearHideTimer();
      if (removeListener !== null) {
        void removeListener();
      }
    };
  }, [clearHideTimer, nativeShell, scheduleHide]);

  useEffect(() => {
    if (overlayOpenProfileKey === null) {
      return;
    }
    const remove = pushBackHandler(
      () => {
        void hideNativeBrowserBridgeView(overlayOpenProfileKey)
          .catch(() => undefined)
          .finally(() => {
            setOverlayOpenProfileKey(null);
          });
      },
      { priority: 100 }
    );
    return remove;
  }, [overlayOpenProfileKey]);

  useEffect(() => {
    setFaviconFailed(false);
  }, [preview?.pageUrl, preview?.faviconDataUrl]);

  const faviconUrl = useMemo(
    () => (preview === null ? null : resolveFaviconUrl(preview)),
    [preview]
  );

  if (!nativeShell) {
    return null;
  }

  return (
    <AnimatePresence>
      {preview?.imageDataUrl ? (
        <motion.button
          type="button"
          key={preview.profileKey}
          initial={{ opacity: 0, scale: 0.94, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => {
            void showNativeBrowserBridgeView(preview.profileKey)
              .then(() => {
                setOverlayOpenProfileKey(preview.profileKey);
              })
              .catch(() => undefined);
          }}
          aria-label={t("browserPreviewOpen")}
          data-testid="native-browser-preview"
          className="fixed z-[85] overflow-hidden rounded-[22px] border border-white/20 bg-black/20 shadow-[0_18px_48px_rgba(0,0,0,0.32)] ring-1 ring-black/10 backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{
            width: "clamp(9rem, 38vw, 22rem)",
            right: "max(0.875rem, env(safe-area-inset-right))",
            top: "calc(0.875rem + env(safe-area-inset-top))"
          }}
        >
          <img
            src={preview.imageDataUrl}
            alt=""
            className="block h-auto max-h-[42dvh] w-full object-contain"
            draggable={false}
          />
          <span className="absolute left-2.5 top-2.5 grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-white/35 bg-black/45 shadow-sm backdrop-blur-md">
            {faviconUrl !== null && !faviconFailed ? (
              <img
                src={faviconUrl}
                alt=""
                className="h-4 w-4 rounded-sm object-contain"
                referrerPolicy="no-referrer"
                onError={() => setFaviconFailed(true)}
              />
            ) : (
              <Globe2 className="h-3.5 w-3.5 text-white/90" />
            )}
          </span>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
