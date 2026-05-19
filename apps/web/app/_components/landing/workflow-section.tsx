import { getTranslations } from "next-intl/server";
import { cn } from "@/app/lib/utils";
import { LandingSection, SectionEyebrow, SectionLead, SectionTitle } from "./section";
import {
  WorkflowSurface,
  type WorkflowSurfaceKind,
  type WorkflowSurfaceStrings
} from "./workflow-surface";

const SCENES: { key: WorkflowSurfaceKind }[] = [
  { key: "personality" },
  { key: "memory" },
  { key: "media" },
  { key: "documents" },
  { key: "plans" },
  { key: "knowledge" }
];

export async function LandingWorkflowSection() {
  const t = await getTranslations("landing.workflow");

  // Pre-resolve all per-scene surface strings here so the surface components
  // stay synchronous and trivially testable.
  const surfaces: Record<WorkflowSurfaceKind, WorkflowSurfaceStrings> = {
    personality: {
      kind: "personality",
      values: {
        prompt: t("scenes.personality.surface.prompt"),
        reply: t("scenes.personality.surface.reply"),
        nameLabel: t("scenes.personality.surface.nameLabel"),
        chosenName: t("scenes.personality.surface.chosenName"),
        toneLabel: t("scenes.personality.surface.toneLabel"),
        toneWarm: t("scenes.personality.surface.toneWarm"),
        toneDirect: t("scenes.personality.surface.toneDirect"),
        toneFormal: t("scenes.personality.surface.toneFormal"),
        voiceLabel: t("scenes.personality.surface.voiceLabel")
      }
    },
    memory: {
      kind: "memory",
      values: {
        prompt: t("scenes.memory.surface.prompt"),
        reply: t("scenes.memory.surface.reply"),
        recall: t("scenes.memory.surface.recall"),
        memoryTag: t("scenes.memory.surface.memoryTag")
      }
    },
    plans: {
      kind: "plans",
      values: {
        prompt: t("scenes.plans.surface.prompt"),
        reply: t("scenes.plans.surface.reply"),
        task1: t("scenes.plans.surface.task1"),
        task2: t("scenes.plans.surface.task2"),
        task3: t("scenes.plans.surface.task3"),
        task4: t("scenes.plans.surface.task4")
      }
    },
    documents: {
      kind: "documents",
      values: {
        prompt: t("scenes.documents.surface.prompt"),
        reply: t("scenes.documents.surface.reply"),
        deckCaption: t("scenes.documents.surface.deckCaption")
      }
    },
    media: {
      kind: "media",
      values: {
        prompt: t("scenes.media.surface.prompt"),
        reply: t("scenes.media.surface.reply")
      }
    },
    knowledge: {
      kind: "knowledge",
      values: {
        prompt: t("scenes.knowledge.surface.prompt"),
        reply: t("scenes.knowledge.surface.reply"),
        skillsLabel: t("scenes.knowledge.surface.skillsLabel"),
        sourcesLabel: t("scenes.knowledge.surface.sourcesLabel"),
        usingLabel: t("scenes.knowledge.surface.usingLabel"),
        sourceFile: t("scenes.knowledge.surface.sourceFile")
      }
    }
  };

  return (
    <LandingSection id="workflow" className="py-16 sm:py-24">
      <SectionEyebrow>{t("eyebrow")}</SectionEyebrow>
      <SectionTitle className="mt-4">{t("title")}</SectionTitle>
      <SectionLead className="mt-4">{t("subtitle")}</SectionLead>

      <div className="mt-12 flex flex-col gap-12 sm:mt-16 sm:gap-20">
        {SCENES.map((scene, idx) => {
          const reversed = idx % 2 === 1;
          return (
            <article
              key={scene.key}
              className="grid gap-8 sm:gap-12 lg:grid-cols-12 lg:items-center"
            >
              <div className={cn("lg:col-span-5", reversed ? "lg:order-2 lg:pl-2" : "lg:pr-2")}>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface-raised/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-text-subtle">
                  <span className="h-1 w-1 rounded-full bg-accent/55" aria-hidden />
                  {t(`scenes.${scene.key}.tag`)}
                </span>
                <h3 className="mt-5 max-w-md text-2xl font-semibold leading-tight tracking-[-0.02em] text-text sm:text-3xl">
                  {t(`scenes.${scene.key}.title`)}
                </h3>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-text-muted sm:text-base">
                  {t(`scenes.${scene.key}.body`)}
                </p>
              </div>

              <div className={cn("lg:col-span-7", reversed ? "lg:order-1" : null)}>
                <WorkflowSurface kind={scene.key} strings={surfaces[scene.key]} />
              </div>
            </article>
          );
        })}
      </div>
    </LandingSection>
  );
}
