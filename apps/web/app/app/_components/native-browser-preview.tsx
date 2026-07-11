"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  isNativeBrowserBridgeShell,
  showNativeBrowserBridgeView,
  subscribeNativeBrowserPreview,
  type NativeBrowserPreviewEvent
} from "../browser-bridge-client";

const PREVIEW_LINGER_MS = 2_500;

export function NativeBrowserPreview() {
  const t = useTranslations("chat");
  // Capacitor injects its bridge at runtime. Read shell identity on every
  // render instead of freezing an early pre-bridge value for this component's
  // lifetime; viewport width never decides whether the preview is shown.
  const nativeShell = isNativeBrowserBridgeShell();
  const [preview, setPreview] = useState<NativeBrowserPreviewEvent | null>(null);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

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
      clearHideTimer();
      if (event.phase === "end") {
        hideTimerRef.current = window.setTimeout(() => {
          setPreview(null);
          hideTimerRef.current = null;
        }, PREVIEW_LINGER_MS);
        return;
      }
      if (event.phase === "start" && event.imageDataUrl === null) {
        setPreview(null);
        return;
      }
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
  }, [clearHideTimer, nativeShell]);

  useEffect(() => {
    setFaviconFailed(false);
  }, [preview?.pageUrl]);

  const faviconUrl = useMemo(() => {
    if (preview?.pageUrl === null || preview?.pageUrl === undefined) {
      return null;
    }
    try {
      return new URL("/favicon.ico", preview.pageUrl).toString();
    } catch {
      return null;
    }
  }, [preview?.pageUrl]);

  if (!nativeShell) {
    return null;
  }

  return (
    <AnimatePresence>
      {preview?.imageDataUrl ? (
        <motion.button
          type="button"
          key={preview.profileKey}
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          onClick={() =>
            void showNativeBrowserBridgeView(preview.profileKey).catch(() => undefined)
          }
          aria-label={t("browserPreviewOpen")}
          data-testid="native-browser-preview"
          className="fixed z-[85] overflow-hidden rounded-[22px] border border-white/20 bg-black/20 shadow-[0_18px_48px_rgba(0,0,0,0.32)] ring-1 ring-black/10 backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{
            width: "clamp(9rem, 38vw, 22rem)",
            right: "max(0.875rem, env(safe-area-inset-right))",
            bottom: "calc(5.75rem + env(safe-area-inset-bottom))"
          }}
        >
          {/* Native sends a viewport-proportional image, so its intrinsic ratio
              adapts to the actual phone/tablet window without device heuristics. */}
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
                crossOrigin="anonymous"
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
