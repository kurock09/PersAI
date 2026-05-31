"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { X } from "lucide-react";
import { AssistantRow, UserBubble } from "./chat-atoms";
import { useStagedDemoReveal } from "./use-staged-demo-reveal";
import { useScrollToBottom } from "./use-autoscroll";

/* ------------------------------------------------------------------ */
/* Asset helpers                                                         */
/* ------------------------------------------------------------------ */

const MARKET_REF_SRC = "/landing/market/ref.webp";

function getSlides(isRu: boolean) {
  const suffix = isRu ? "ru" : "en";
  return [
    {
      src: `/landing/market/cover-${suffix}.webp`,
      altKey: "landing.demo.market.coverAlt" as const
    },
    {
      src: `/landing/market/detail-${suffix}.webp`,
      altKey: "landing.demo.market.detailAlt" as const
    },
    {
      src: `/landing/market/social-${suffix}.webp`,
      altKey: "landing.demo.market.socialAlt" as const
    }
  ] as const;
}

/* ------------------------------------------------------------------ */
/* Animation variants — match block-media cadence                       */
/* ------------------------------------------------------------------ */

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.14 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }
};

/* ------------------------------------------------------------------ */
/* Sub-components                                                        */
/* ------------------------------------------------------------------ */

function MarketRefImage({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  return (
    <div className="flex justify-end py-2">
      <button
        type="button"
        onClick={onOpen}
        className="overflow-hidden rounded-[14px] border border-border bg-surface-raised shadow-sm transition-transform hover:scale-[1.01]"
      >
        <img src={src} alt={alt} className="max-h-48 max-w-[240px] object-cover" />
      </button>
    </div>
  );
}

function MarketCardButton({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm transition-transform hover:scale-[1.01]"
    >
      <img src={src} alt={alt} className="aspect-square w-full object-cover" />
    </button>
  );
}

function MarketLightbox({
  src,
  alt,
  closeLabel,
  open,
  onClose
}: {
  src: string;
  alt: string;
  closeLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl bg-bg/82 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={onClose}
        >
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="absolute top-4 right-4 rounded-full border border-border bg-surface-raised/90 p-2 text-text-muted shadow-sm backdrop-blur-sm transition-colors hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <motion.img
            src={src}
            alt={alt}
            className="max-h-full max-w-full rounded-[20px] border border-border object-contain shadow-2xl"
            initial={{ scale: 0.98, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* useMarketplaceThread hook                                             */
/* ------------------------------------------------------------------ */

interface UseMarketplaceThreadOptions {
  active: boolean;
  extraMessages: string[];
}

/**
 * Returns `{ thread, overlay, threadViewportRef }` for the marketplace
 * carousel scripted chat. Call at the top of HeroDemo and pass
 * `threadViewportRef` to DemoWindow when this chat is active.
 */
export function useMarketplaceThread({ active, extraMessages }: UseMarketplaceThreadOptions) {
  const t = useTranslations();
  const locale = useLocale();
  const reduced = useReducedMotion();
  const isRu = locale.startsWith("ru");
  const slides = getSlides(isRu);

  const [lightboxState, setLightboxState] = useState<{ src: string; alt: string } | null>(null);

  const { visibleCount, threadViewportRef } = useStagedDemoReveal({
    total: 6,
    active,
    reduced,
    initialDelayMs: 240,
    stepDelayMs: 600
  });

  // Close the lightbox when leaving the marketplace chat
  useEffect(() => {
    if (!active) {
      setLightboxState(null);
    }
  }, [active]);

  // Pin to the newest message when the visitor types into this chat.
  useScrollToBottom(threadViewportRef, extraMessages.length, reduced);

  const animateState = reduced ? "visible" : active ? "visible" : "hidden";

  const thread = (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate={animateState}
      className="flex flex-col"
    >
      {/* 1. Reference image — user aligned right, clickable */}
      {visibleCount >= 1 && (
        <motion.div variants={itemVariants}>
          <MarketRefImage
            src={MARKET_REF_SRC}
            alt={t("landing.demo.market.refAlt")}
            onOpen={() =>
              setLightboxState({ src: MARKET_REF_SRC, alt: t("landing.demo.market.refAlt") })
            }
          />
        </motion.div>
      )}

      {/* 2. User prompt bubble */}
      {visibleCount >= 2 && (
        <motion.div variants={itemVariants}>
          <UserBubble>{t("landing.demo.market.userPrompt")}</UserBubble>
        </motion.div>
      )}

      {/* 3. Assistant working reply */}
      {visibleCount >= 3 && (
        <motion.div variants={itemVariants}>
          <AssistantRow>{t("landing.demo.market.workingReply")}</AssistantRow>
        </motion.div>
      )}

      {/* 4–6. Carousel cards — one per step, inside a single assistant turn */}
      {visibleCount >= 4 && (
        <motion.div variants={itemVariants}>
          <AssistantRow showAvatar={false}>
            {/* grid-cols-1 on mobile; single 3-column row on sm+ */}
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {/* Card 1 — always visible when the block appears */}
              <MarketCardButton
                src={slides[0].src}
                alt={t("landing.demo.market.coverAlt")}
                onOpen={() =>
                  setLightboxState({
                    src: slides[0].src,
                    alt: t("landing.demo.market.coverAlt")
                  })
                }
              />

              {/* Card 2 — step 5 */}
              {visibleCount >= 5 && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                >
                  <MarketCardButton
                    src={slides[1].src}
                    alt={t("landing.demo.market.detailAlt")}
                    onOpen={() =>
                      setLightboxState({
                        src: slides[1].src,
                        alt: t("landing.demo.market.detailAlt")
                      })
                    }
                  />
                </motion.div>
              )}

              {/* Card 3 — step 6 */}
              {visibleCount >= 6 && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                >
                  <MarketCardButton
                    src={slides[2].src}
                    alt={t("landing.demo.market.socialAlt")}
                    onOpen={() =>
                      setLightboxState({
                        src: slides[2].src,
                        alt: t("landing.demo.market.socialAlt")
                      })
                    }
                  />
                </motion.div>
              )}
            </div>
          </AssistantRow>
        </motion.div>
      )}

      {/* User messages typed into this chat via the composer */}
      {extraMessages.map((msg, index) => (
        <UserBubble key={`market-user-${index}`}>{msg}</UserBubble>
      ))}
    </motion.div>
  );

  const overlay = (
    <MarketLightbox
      src={lightboxState?.src ?? ""}
      alt={lightboxState?.alt ?? ""}
      closeLabel={t("landing.demo.market.lightboxClose")}
      open={lightboxState !== null}
      onClose={() => setLightboxState(null)}
    />
  );

  return { thread, overlay, threadViewportRef };
}
