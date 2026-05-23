"use client";

import { Zap, Cpu, RefreshCw, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";

export type ActivityType = "runtime_done" | "tool_use" | "system" | "info";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  label: string;
  detail?: string;
  shadowRoutingLabel?: string;
  timestamp?: string;
  afterMessageId?: string;
  emphasis?: "default" | "strong";
}

const TYPE_CONFIG: Record<ActivityType, { icon: typeof Cpu; color: string }> = {
  runtime_done: { icon: Zap, color: "text-text-subtle" },
  tool_use: { icon: Cpu, color: "text-text-subtle" },
  system: { icon: RefreshCw, color: "text-text-subtle" },
  info: { icon: Info, color: "text-text-subtle" }
};

function buildActivityDetail(
  event: ActivityEvent,
  showShadowRoutingLabel: boolean
): string | undefined {
  if (!showShadowRoutingLabel || !event.shadowRoutingLabel) {
    return event.detail;
  }
  return event.detail && event.detail.trim().length > 0
    ? `${event.detail} · ${event.shadowRoutingLabel}`
    : event.shadowRoutingLabel;
}

function resolveActivityDetail(
  detail: string | undefined,
  t: ReturnType<typeof useTranslations>
): string | undefined {
  if (typeof detail !== "string" || detail.trim().length === 0) {
    return detail;
  }
  const structured = resolveStructuredActivityDetail(detail, t);
  if (structured !== null) {
    return structured;
  }
  const mappedKey = ACTIVITY_DETAIL_KEYS[normalizeActivityLabel(detail)];
  return mappedKey ? t(mappedKey) : detail;
}

function resolveStructuredActivityDetail(
  detail: string,
  t: ReturnType<typeof useTranslations>
): string | null {
  const loadedGroundedExcerptMatch = detail.match(
    /^Loaded (\d+) grounded excerpt\(s\) across (\d+) source class\(es\)\.?$/i
  );
  if (loadedGroundedExcerptMatch) {
    return t("activityProjectDetailLoadedGroundedExcerpts", {
      count: Number(loadedGroundedExcerptMatch[1] ?? 0),
      sourceCount: Number(loadedGroundedExcerptMatch[2] ?? 0)
    });
  }

  const followUpPassMatch = detail.match(
    /^Follow-up pass (\d+) is gathering the next missing piece of evidence\.?$/i
  );
  if (followUpPassMatch) {
    return t("activityProjectDetailFollowUpPass", {
      pass: Number(followUpPassMatch[1] ?? 0)
    });
  }

  return null;
}

function renderActivityDetail(detail: string) {
  const skillIconMatch = detail.match(
    /^(.*?)([\p{Emoji_Presentation}\p{Extended_Pictographic}][\p{Emoji_Modifier}\uFE0F\u20E3]?)(.*?)$/u
  );
  if (skillIconMatch === null) {
    return <span className="opacity-50">{detail}</span>;
  }
  const beforeIcon = skillIconMatch[1] ?? "";
  const skillIcon = skillIconMatch[2] ?? "";
  const afterIcon = skillIconMatch[3] ?? "";
  return (
    <span className="inline-flex items-center gap-1 opacity-55">
      {beforeIcon.trimEnd().length > 0 ? <span>{beforeIcon.trimEnd()}</span> : null}
      <span
        className="text-[10px] opacity-75"
        style={{ filter: "saturate(0.68) brightness(1.04)" }}
        aria-hidden="true"
      >
        {skillIcon}
      </span>
      {afterIcon.trimStart().length > 0 ? <span>{afterIcon.trimStart()}</span> : null}
    </span>
  );
}

function normalizeActivityLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveActivityLabelKey(event: ActivityEvent): string | null {
  const normalized = normalizeActivityLabel(event.label);
  return (
    ACTIVITY_LABEL_KEYS[normalized] ??
    (event.type === "tool_use" && normalized.includes("failed")
      ? "activityGenericFailed"
      : event.type === "tool_use" && normalized.includes("finished")
        ? "activityGenericDone"
        : event.type === "tool_use"
          ? "activityGenericRunning"
          : null)
  );
}

function resolveActivityLabel(event: ActivityEvent, t: ReturnType<typeof useTranslations>): string {
  const mappedKey = resolveActivityLabelKey(event);
  return mappedKey ? t(mappedKey) : event.label;
}

const ACTIVITY_LABEL_KEYS: Record<string, string> = {
  searching_the_web: "activityWebSearchStart",
  web_results_ready: "activityWebSearchDone",
  web_search: "activityWebSearchStart",
  web_search_started: "activityWebSearchStart",
  web_search_finished: "activityWebSearchDone",
  web_search_failed: "activityWebSearchFailed",
  reading_the_page: "activityWebFetchStart",
  page_ready: "activityWebFetchDone",
  page_read_failed: "activityWebFetchFailed",
  web_fetch_started: "activityWebFetchStart",
  web_fetch_finished: "activityWebFetchDone",
  web_fetch_failed: "activityWebFetchFailed",
  knowledge_search: "activityKnowledgeSearchStart",
  knowledge_search_started: "activityKnowledgeSearchStart",
  knowledge_search_finished: "activityKnowledgeSearchDone",
  knowledge_search_failed: "activityKnowledgeSearchFailed",
  knowledge_fetch: "activityKnowledgeFetchStart",
  knowledge_fetch_started: "activityKnowledgeFetchStart",
  knowledge_fetch_finished: "activityKnowledgeFetchDone",
  knowledge_fetch_failed: "activityKnowledgeFetchFailed",
  files: "activityFilesStart",
  files_started: "activityFilesStart",
  files_finished: "activityFilesDone",
  files_failed: "activityFilesFailed",
  files_send_started: "activityFilesSendStart",
  files_send_finished: "activityFilesSendDone",
  files_write_started: "activityFilesWriteStart",
  files_write_finished: "activityFilesWriteDone",
  files_write_and_send_started: "activityFilesWriteSendStart",
  files_write_and_send_finished: "activityFilesWriteSendDone",
  generating_image: "activityImageStart",
  image_ready: "activityImageDone",
  image_generation_failed: "activityImageFailed",
  image_generate_started: "activityImageStart",
  image_generate_finished: "activityImageDone",
  image_generate_failed: "activityImageFailed",
  editing_image: "activityImageEditStart",
  edited_image_ready: "activityImageEditDone",
  image_edit_failed: "activityImageEditFailed",
  image_edit_started: "activityImageEditStart",
  image_edit_finished: "activityImageEditDone",
  generating_video: "activityVideoStart",
  video_ready: "activityVideoDone",
  video_generation_failed: "activityVideoFailed",
  video_generate_started: "activityVideoStart",
  video_generate_finished: "activityVideoDone",
  scheduling_task: "activityScheduleStart",
  task_scheduled: "activityScheduleDone",
  task_scheduling_failed: "activityScheduleFailed",
  scheduled_action_started: "activityScheduleStart",
  scheduled_action_finished: "activityScheduleDone",
  recording_voice: "activityVoiceStart",
  voice_ready: "activityVoiceDone",
  voice_generation_failed: "activityVoiceFailed",
  tts_started: "activityVoiceStart",
  tts_finished: "activityVoiceDone",
  summarize_context_started: "activityContextStart",
  summarize_context_finished: "activityContextDone",
  retrieval_skill_started: "activityRetrievalSkillStart",
  retrieval_user_started: "activityRetrievalUserStart",
  retrieval_product_started: "activityRetrievalProductStart",
  retrieval_web_started: "activityRetrievalWebStart",
  response_generated: "activityResponseDone",
  reviewing_local_context_and_planning_the_next_step: "activityProjectSummaryPlanReview",
  checking_whether_the_gathered_context_actually_answers_the_task: "activityProjectSummaryCheckFit",
  local_context_is_still_thin_so_the_search_may_need_to_expand: "activityProjectSummaryThinContext",
  gathering_more_evidence: "activityProjectSummaryGatherMore",
  preparing_the_final_answer: "activityProjectSummaryPrepareAnswer",
  project_stage_plan_started: "activityProjectStagePlanStart",
  project_stage_plan_completed: "activityProjectStagePlanDone",
  project_stage_gather_started: "activityProjectStageGatherStart",
  project_stage_gather_completed: "activityProjectStageGatherDone",
  project_stage_analyze_started: "activityProjectStageAnalyzeStart",
  project_stage_analyze_completed: "activityProjectStageAnalyzeDone",
  project_stage_replan_started: "activityProjectStageReplanStart",
  project_stage_synthesize_started: "activityProjectStageSynthesizeStart",
  project_reasoning_plan: "activityProjectReasoningPlan",
  project_reasoning_check: "activityProjectReasoningCheck",
  project_reasoning_gap: "activityProjectReasoningGap",
  project_reasoning_conflict: "activityProjectReasoningConflict",
  project_reasoning_interim: "activityProjectReasoningInterim",
  project_reasoning_replan: "activityProjectReasoningReplan",
  project_reasoning_synthesis: "activityProjectReasoningSynthesis"
};

const ACTIVITY_DETAIL_KEYS: Record<string, string> = {
  checking_whether_the_local_material_answers_the_task: "activityProjectDetailCheckFit",
  local_context_is_still_thin_so_the_search_may_need_to_expand: "activityProjectDetailThinContext",
  no_direct_grounded_excerpt_yet_keep_gathering_narrower_local_or_external_sources:
    "activityProjectDetailNoGroundedExcerpt"
};

export function ActivityBadge({
  event,
  showShadowRoutingLabel = false
}: {
  event: ActivityEvent;
  showShadowRoutingLabel?: boolean;
}) {
  const t = useTranslations("chat");
  const cfg = TYPE_CONFIG[event.type];
  const Icon = cfg.icon;
  const isStrong = event.emphasis === "strong";
  const mappedLabelKey = resolveActivityLabelKey(event);
  const suppressDetail =
    mappedLabelKey !== null &&
    (mappedLabelKey.startsWith("activityProjectSummary") ||
      mappedLabelKey.startsWith("activityProjectStage") ||
      mappedLabelKey.startsWith("activityProjectReasoning"));
  const detail = suppressDetail
    ? undefined
    : resolveActivityDetail(buildActivityDetail(event, showShadowRoutingLabel), t);
  const label = resolveActivityLabel(event, t);

  return (
    <div className="flex items-center justify-center py-0.5">
      <div
        className={cn(
          "inline-flex items-center gap-1",
          isStrong
            ? "rounded-full border border-border/70 bg-surface-raised/85 px-2.5 py-1 text-[11px] font-medium text-text-subtle/85 shadow-sm"
            : "px-2 py-0.5 text-[10px] text-text-subtle/60"
        )}
      >
        <Icon
          className={cn(isStrong ? "h-3 w-3 opacity-70" : "h-2.5 w-2.5 opacity-40", cfg.color)}
        />
        <span>{label}</span>
        {detail && renderActivityDetail(detail)}
      </div>
    </div>
  );
}
