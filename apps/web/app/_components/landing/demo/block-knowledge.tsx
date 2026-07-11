"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { FileText, Plus, Trash2 } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { AssistantAvatar } from "@/app/app/_components/assistant-avatar";
import { AssistantRow, UserBubble } from "./chat-atoms";
import { DemoWindow } from "./demo-window";
import type { DemoChatMode, DemoModeChipProps } from "./demo-window";
import { useInteractiveBlockChat } from "./interactive-block-chat";
import { useInViewOnce } from "./use-in-view-once";
import { useStagedDemoReveal } from "./use-staged-demo-reveal";
import { DEMO_ASSISTANT_AVATAR_URL } from "./chat-atoms";

/* ------------------------------------------------------------------ */
/* Motion variants                                                       */
/* ------------------------------------------------------------------ */

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.13 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }
};

/* ------------------------------------------------------------------ */
/* Source row                                                            */
/* ------------------------------------------------------------------ */

function KnowledgeFileRow({
  filename,
  highlighted,
  ext
}: {
  filename: string;
  highlighted?: boolean;
  ext?: "pdf" | "docx";
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-lg px-1 py-1 transition-colors",
        highlighted
          ? "bg-surface-raised text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text"
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs">
        <FileText className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{filename}</span>
        {ext && (
          <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-text-subtle">
            {ext}
          </span>
        )}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

function KnowledgeFilesSidebar({ active }: { active: boolean }) {
  const t = useTranslations();
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col rounded-2xl border border-border bg-surface">
      <div className="px-3 pt-4 pb-3">
        <div className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl bg-surface-raised p-3">
          <AssistantAvatar avatarUrl={DEMO_ASSISTANT_AVATAR_URL} size="md" />
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold text-text">Luma</p>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-success" aria-hidden="true" />
              <span className="text-xs text-text-muted">
                {t("landing.demo.sidebar.statusLabel")}
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex-1 border-b border-border" aria-hidden="true" />
      <div className="px-5 py-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-text-subtle">
            {t("landing.blocks.knowledge.filesTitle")}
          </p>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-surface-raised text-text-subtle shadow-sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
          <KnowledgeFileRow filename={t("landing.blocks.knowledge.source1")} ext="pdf" />
          <KnowledgeFileRow filename={t("landing.blocks.knowledge.source2")} ext="docx" />
          <KnowledgeFileRow
            filename={t("landing.blocks.knowledge.citedSource")}
            ext="pdf"
            highlighted={active}
          />
        </ul>
      </div>
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-surface-raised text-[13px] font-semibold text-text-subtle shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            A
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-text">
              {t("landing.demo.sidebar.userName")}
            </span>
            <span className="block truncate text-[11px] tracking-wide text-text-muted">
              {t("landing.demo.sidebar.userPlan")}
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Flat knowledge window                                                  */
/* ------------------------------------------------------------------ */

function KnowledgeWindow({ animate, reduced }: { animate: boolean; reduced: boolean | null }) {
  const t = useTranslations();
  const [mode, setMode] = useState<DemoChatMode>("smart");
  const { visibleCount, threadViewportRef } = useStagedDemoReveal({
    total: 4,
    active: animate,
    reduced,
    stepDelayMs: 500
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
    placeholder: t("landing.blocks.knowledge.composerPlaceholder"),
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
          <motion.p
            variants={itemVariants}
            className="mb-3 text-[11px] leading-relaxed text-accent"
          >
            {t("landing.blocks.knowledge.citedLabel")}
          </motion.p>
        )}
        {visibleCount >= 2 && (
          <motion.div variants={itemVariants}>
            <UserBubble>{t("landing.blocks.knowledge.userPrompt")}</UserBubble>
          </motion.div>
        )}
        {visibleCount >= 3 && (
          <motion.div variants={itemVariants}>
            <AssistantRow>{t("landing.blocks.knowledge.assistantReply")}</AssistantRow>
          </motion.div>
        )}
      </motion.div>
    )
  });

  return (
    <div aria-label={t("landing.blocks.knowledge.windowLabel")}>
      <DemoWindow
        assistantName="Luma"
        assistantStatusLabel={t("landing.demo.sidebar.statusLabel")}
        headerTitle={t("landing.blocks.knowledge.title")}
        chatMode={mode}
        onModeChange={setMode}
        modeLabels={modeLabels}
        userName={t("landing.demo.sidebar.userName")}
        userPlanLabel={t("landing.demo.sidebar.userPlan")}
        windowHeightClassName="h-[29rem] md:h-[32rem]"
        frameClassName="p-0 sm:p-4"
        composer={interactiveChat.composer}
        threadViewportRef={threadViewportRef}
        sidebar={<KnowledgeFilesSidebar active={visibleCount >= 1} />}
        chats={[
          {
            id: "knowledge",
            title: t("landing.blocks.knowledge.title"),
            time: "20:50",
            active: true
          },
          { id: "source1", title: t("landing.blocks.knowledge.source1"), time: "17:19" },
          { id: "source2", title: t("landing.blocks.knowledge.source2"), time: "11:34" }
        ]}
      >
        {interactiveChat.thread}
      </DemoWindow>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BlockKnowledge (exported)                                             */
/* ------------------------------------------------------------------ */

export function BlockKnowledge({ reversed = false }: { reversed?: boolean }) {
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
          {t("landing.blocks.knowledge.tag")}
        </span>
        <h3 className="mt-5 max-w-md text-2xl font-semibold leading-tight tracking-[-0.02em] text-text sm:text-3xl">
          {t("landing.blocks.knowledge.title")}
        </h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-text-muted">
          {t("landing.blocks.knowledge.body")}
        </p>
      </div>

      {/* Window */}
      <div className={cn("min-w-0 lg:col-span-8", reversed ? "lg:order-1" : null)}>
        <KnowledgeWindow animate={inView} reduced={shouldReduceMotion} />
      </div>
    </article>
  );
}
