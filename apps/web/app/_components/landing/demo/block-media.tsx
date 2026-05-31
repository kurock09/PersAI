"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { AssistantRow, UserBubble } from "./chat-atoms";
import { DemoWindow } from "./demo-window";
import type { DemoChatMode, DemoModeChipProps } from "./demo-window";
import { useInteractiveBlockChat } from "./interactive-block-chat";
import { useInViewOnce } from "./use-in-view-once";
import { useStagedDemoReveal } from "./use-staged-demo-reveal";

const MEDIA_ORIGINAL_SRC = "/landing/media-demo/selfie-original.png";
const MEDIA_RESULT_SRC = "/landing/media-demo/selfie-cartoon.png";

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.14 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }
};

function MediaImagePreview({
  src,
  alt,
  onOpen,
  align = "left"
}: {
  src: string;
  alt: string;
  onOpen: () => void;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("flex py-2", align === "right" ? "justify-end" : "justify-start")}>
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

function MediaJobPill({ label }: { label: string }) {
  return (
    <div className="flex justify-end py-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised/95 px-3 py-1.5 text-xs font-medium text-text-muted shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

function DemoImageLightbox({
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
/* Media window                                                          */
/* ------------------------------------------------------------------ */

function MediaWindow({ animate, reduced }: { animate: boolean; reduced: boolean | null }) {
  const t = useTranslations();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<DemoChatMode>("normal");
  const { visibleCount, threadViewportRef } = useStagedDemoReveal({
    total: 6,
    active: animate,
    reduced,
    initialDelayMs: 260,
    stepDelayMs: 650
  });
  const animateState = reduced ? "visible" : animate ? "visible" : "hidden";
  const modeLabels: DemoModeChipProps["labels"] = {
    normal: t("landing.demo.modes.normal"),
    smart: t("landing.demo.modes.smart"),
    project: t("landing.demo.modes.project"),
    normalCaption: t("landing.demo.modes.normalCaption"),
    smartCaption: t("landing.demo.modes.smartCaption"),
    projectCaption: t("landing.demo.modes.projectCaption")
  };

  const interactiveChat = useInteractiveBlockChat({
    placeholder: t("landing.blocks.media.composerPlaceholder"),
    viewportRef: threadViewportRef,
    reducedMotion: reduced,
    children: (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate={animateState}
        className="flex flex-col"
      >
        {visibleCount >= 1 && (
          <motion.div variants={itemVariants}>
            <MediaImagePreview
              src={MEDIA_ORIGINAL_SRC}
              alt={t("landing.blocks.media.originalAlt")}
              align="right"
              onOpen={() => setLightboxSrc(MEDIA_ORIGINAL_SRC)}
            />
          </motion.div>
        )}
        {visibleCount >= 2 && (
          <motion.div variants={itemVariants}>
            <UserBubble>{t("landing.blocks.media.userPrompt")}</UserBubble>
          </motion.div>
        )}
        {visibleCount >= 3 && (
          <motion.div variants={itemVariants}>
            <AssistantRow>{t("landing.blocks.media.workingReply")}</AssistantRow>
          </motion.div>
        )}
        {visibleCount >= 4 && (
          <motion.div variants={itemVariants}>
            <MediaJobPill label={t("landing.blocks.media.progressLabel")} />
          </motion.div>
        )}
        {visibleCount >= 5 && (
          <motion.div variants={itemVariants}>
            <AssistantRow>{t("landing.blocks.media.assistantReply")}</AssistantRow>
          </motion.div>
        )}
        {visibleCount >= 6 && (
          <motion.div variants={itemVariants}>
            <AssistantRow showAvatar={false}>
              <MediaImagePreview
                src={MEDIA_RESULT_SRC}
                alt={t("landing.blocks.media.resultAlt")}
                onOpen={() => setLightboxSrc(MEDIA_RESULT_SRC)}
              />
            </AssistantRow>
          </motion.div>
        )}
      </motion.div>
    )
  });

  return (
    <div aria-label={t("landing.blocks.media.windowLabel")}>
      <DemoWindow
        assistantName="Luma"
        assistantStatusLabel={t("landing.demo.sidebar.statusLabel")}
        headerTitle={t("landing.blocks.media.title")}
        chatMode={mode}
        onModeChange={setMode}
        modeLabels={modeLabels}
        userName={t("landing.demo.sidebar.userName")}
        userPlanLabel={t("landing.demo.sidebar.userPlan")}
        windowHeightClassName="h-[29rem] md:h-[32rem]"
        frameClassName="p-0 sm:p-4"
        composer={interactiveChat.composer}
        threadViewportRef={threadViewportRef}
        chats={[
          { id: "media", title: t("landing.blocks.media.title"), time: "20:50", active: true },
          { id: "media-brand", title: t("landing.blocks.media.secondaryChat"), time: "17:19" }
        ]}
        overlay={
          <DemoImageLightbox
            src={lightboxSrc ?? MEDIA_RESULT_SRC}
            alt={t("landing.blocks.media.resultAlt")}
            closeLabel={t("landing.blocks.media.lightboxClose")}
            open={lightboxSrc !== null}
            onClose={() => setLightboxSrc(null)}
          />
        }
      >
        {interactiveChat.thread}
      </DemoWindow>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BlockMedia (exported)                                                 */
/* ------------------------------------------------------------------ */

export function BlockMedia({ reversed = false }: { reversed?: boolean }) {
  const t = useTranslations();
  const { ref, inView } = useInViewOnce<HTMLElement>({ rootMargin: "0px", threshold: 0.5 });
  const shouldReduceMotion = useReducedMotion();

  return (
    <article
      ref={ref}
      className="grid w-full min-w-0 gap-8 overflow-hidden sm:gap-12 lg:grid-cols-12 lg:items-center lg:overflow-visible"
    >
      {/* Copy */}
      <div className={cn("lg:col-span-4", reversed ? "lg:order-2 lg:pl-2" : "lg:pr-2")}>
        <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface-raised/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-text-subtle">
          <span className="h-1 w-1 rounded-full bg-accent/55" aria-hidden />
          {t("landing.blocks.media.tag")}
        </span>
        <h3 className="mt-5 max-w-md text-2xl font-semibold leading-tight tracking-[-0.02em] text-text sm:text-3xl">
          {t("landing.blocks.media.title")}
        </h3>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-text-muted sm:text-base">
          {t("landing.blocks.media.body")}
        </p>
      </div>

      {/* Window */}
      <div className={cn("min-w-0 lg:col-span-8", reversed ? "lg:order-1" : null)}>
        <MediaWindow animate={inView} reduced={shouldReduceMotion} />
      </div>
    </article>
  );
}
