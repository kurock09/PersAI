"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import { ArtifactPill, AssistantRow, UserBubble } from "./chat-atoms";
import { DemoWindow, type DemoChatMode, type DemoModeChipProps } from "./demo-window";
import { useInteractiveBlockChat } from "./interactive-block-chat";
import { useInViewOnce } from "./use-in-view-once";
import { useStagedDemoReveal } from "./use-staged-demo-reveal";

/* ------------------------------------------------------------------ */
/* Motion variants                                                       */
/* ------------------------------------------------------------------ */

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }
};

/* ------------------------------------------------------------------ */
/* Project window                                                        */
/* ------------------------------------------------------------------ */

type ProjectModePreviewPhase = "closed" | "open" | "hover-smart" | "hover-project" | "selected";

function ProjectWindow({ animate, reduced }: { animate: boolean; reduced: boolean | null }) {
  const t = useTranslations();
  const [mode, setMode] = useState<DemoChatMode>("normal");
  const [previewPhase, setPreviewPhase] = useState<ProjectModePreviewPhase>("closed");
  const { visibleCount, threadViewportRef } = useStagedDemoReveal({
    total: 3,
    active: animate,
    reduced,
    stepDelayMs: 520
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

  useEffect(() => {
    if (!animate || reduced) return;
    setMode("normal");
    setPreviewPhase("closed");
    const timers = [
      window.setTimeout(() => setPreviewPhase("open"), 900),
      window.setTimeout(() => setPreviewPhase("hover-smart"), 1350),
      window.setTimeout(() => setPreviewPhase("hover-project"), 1800),
      window.setTimeout(() => {
        setMode("project");
        setPreviewPhase("selected");
      }, 2250),
      window.setTimeout(() => setPreviewPhase("closed"), 2600)
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [animate, reduced]);

  useEffect(() => {
    if (reduced) setMode("project");
  }, [reduced]);

  const interactiveChat = useInteractiveBlockChat({
    placeholder: t("landing.blocks.project.composerPlaceholder"),
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
            <UserBubble>{t("landing.blocks.project.userPrompt")}</UserBubble>
          </motion.div>
        )}
        {visibleCount >= 2 && (
          <motion.div variants={itemVariants}>
            <AssistantRow>{t("landing.blocks.project.assistantReply")}</AssistantRow>
          </motion.div>
        )}
        {visibleCount >= 3 && (
          <motion.div variants={itemVariants}>
            <AssistantRow showAvatar={false}>
              <ArtifactPill
                kind="pdf"
                filename={t("landing.blocks.project.artifactName")}
                meta={t("landing.blocks.project.artifactMeta")}
              />
            </AssistantRow>
          </motion.div>
        )}
      </motion.div>
    )
  });

  return (
    <div aria-label={t("landing.blocks.project.windowLabel")}>
      <DemoWindow
        assistantName="Luma"
        assistantStatusLabel={t("landing.demo.sidebar.statusLabel")}
        headerTitle={t("landing.blocks.project.title")}
        chatMode={mode}
        onModeChange={setMode}
        modeLabels={modeLabels}
        modePreviewOpen={
          previewPhase === "open" ||
          previewPhase === "hover-smart" ||
          previewPhase === "hover-project"
        }
        modePreviewHoverMode={
          previewPhase === "hover-smart"
            ? "smart"
            : previewPhase === "hover-project"
              ? "project"
              : null
        }
        hideSidebar
        userName={t("landing.demo.sidebar.userName")}
        userPlanLabel={t("landing.demo.sidebar.userPlan")}
        windowHeightClassName="h-[29rem] md:h-[32rem]"
        frameClassName="p-0 sm:p-4"
        composer={interactiveChat.composer}
        threadViewportRef={threadViewportRef}
      >
        {interactiveChat.thread}
      </DemoWindow>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BlockProject (exported)                                               */
/* ------------------------------------------------------------------ */

export function BlockProject({ reversed = false }: { reversed?: boolean }) {
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
          {t("landing.blocks.project.tag")}
        </span>
        <h3 className="mt-5 max-w-md text-2xl font-semibold leading-tight tracking-[-0.02em] text-text sm:text-3xl">
          {t("landing.blocks.project.title")}
        </h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-text-muted">
          {t("landing.blocks.project.body")}
        </p>
      </div>

      {/* Window */}
      <div className={cn("min-w-0 lg:col-span-8", reversed ? "lg:order-1" : null)}>
        <ProjectWindow animate={inView} reduced={shouldReduceMotion} />
      </div>
    </article>
  );
}
