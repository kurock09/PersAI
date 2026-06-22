"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Circle, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { RuntimeTodoItem, PersaiRuntimeTodoWriteStatus } from "@persai/runtime-contract";

export interface ChatPlanCardProps {
  todos: RuntimeTodoItem[];
  totalCount: number;
  windowed: boolean;
  onClear: () => Promise<void>;
  className?: string;
}

interface GroupedTodo {
  item: RuntimeTodoItem;
  isOrphan: boolean;
  children: RuntimeTodoItem[];
}

function groupTodos(todos: RuntimeTodoItem[]): GroupedTodo[] {
  const idSet = new Set(todos.map((t) => t.id));
  const childIds = new Set<string>();
  for (const item of todos) {
    if (item.parentId !== null && idSet.has(item.parentId)) {
      childIds.add(item.id);
    }
  }
  const childrenByParentId = new Map<string, RuntimeTodoItem[]>();
  for (const item of todos) {
    if (childIds.has(item.id) && item.parentId !== null) {
      const list = childrenByParentId.get(item.parentId) ?? [];
      list.push(item);
      childrenByParentId.set(item.parentId, list);
    }
  }
  const result: GroupedTodo[] = [];
  for (const item of todos) {
    if (childIds.has(item.id)) continue;
    result.push({
      item,
      isOrphan: item.parentId !== null && !idSet.has(item.parentId),
      children: childrenByParentId.get(item.id) ?? []
    });
  }
  return result;
}

// Pick the task to preview in the collapsed header:
// 1) first in_progress (anywhere)
// 2) else first pending
// 3) else null (all completed)
function selectCurrentTodo(todos: RuntimeTodoItem[]): RuntimeTodoItem | null {
  const inProgress = todos.find((t) => t.status === "in_progress");
  if (inProgress !== undefined) return inProgress;
  const pending = todos.find((t) => t.status === "pending");
  if (pending !== undefined) return pending;
  return null;
}

function StatusIcon({
  status,
  size
}: {
  status: PersaiRuntimeTodoWriteStatus;
  size?: "sm" | "md";
}) {
  // ADR-125 follow-up — smaller and more muted icons to match the quieter banner styling.
  const cls = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  if (status === "completed") {
    return (
      <CheckCircle2 className={cn(cls, "shrink-0 text-emerald-500/70")} aria-label="completed" />
    );
  }
  if (status === "in_progress") {
    return (
      <Loader2
        className={cn(cls, "shrink-0 animate-spin text-text-subtle/80")}
        aria-label="in_progress"
      />
    );
  }
  return <Circle className={cn(cls, "shrink-0 text-text-muted/40")} aria-label="pending" />;
}

function PlanRow({
  item,
  indented,
  isOrphan
}: {
  item: RuntimeTodoItem;
  indented: boolean;
  isOrphan: boolean;
}) {
  const isDone = item.status === "completed";
  const isActive = item.status === "in_progress";

  return (
    <div className={cn("flex items-start gap-2 py-1", indented && "pl-5")}>
      <span className="mt-0.5 shrink-0">
        <StatusIcon status={item.status} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-[13px] leading-snug",
          isDone && "text-text-muted/70 line-through",
          isActive && "font-medium text-text",
          !isDone && !isActive && "text-text-subtle"
        )}
      >
        {isOrphan ? <span className="mr-1 opacity-60">▸</span> : null}
        {item.content}
      </span>
    </div>
  );
}

export function ChatPlanCard({
  todos,
  totalCount,
  windowed,
  onClear,
  className
}: ChatPlanCardProps) {
  const validTodos = todos.filter(
    (item) =>
      typeof item.id === "string" &&
      item.id.length > 0 &&
      typeof item.content === "string" &&
      item.content.length > 0
  );
  if (validTodos.length === 0) return null;
  const doneCount = validTodos.filter((item) => item.status === "completed").length;
  return (
    <ChatPlanCardBody
      todos={validTodos}
      totalCount={totalCount}
      windowed={windowed}
      onClear={onClear}
      doneCount={doneCount}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

function ChatPlanCardBody({
  todos,
  totalCount,
  windowed,
  onClear,
  doneCount,
  className
}: {
  todos: RuntimeTodoItem[];
  totalCount: number;
  windowed: boolean;
  onClear: () => Promise<void>;
  doneCount: number;
  className?: string;
}) {
  const t = useTranslations("chat");
  // Collapsed by default. Best practice: keep the plan compact, surface
  // the current task as a one-line preview, let the user expand on demand.
  const [expanded, setExpanded] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const allDone = doneCount === totalCount && totalCount > 0;
  const currentTodo = selectCurrentTodo(todos);
  const hiddenCount = windowed ? Math.max(0, totalCount - todos.length) : 0;
  const bodyId = "chat-plan-body";
  const grouped = groupTodos(todos);

  // Status indicator on the very left of the header:
  // - all done → green check
  // - in_progress task exists → spinner
  // - otherwise → muted circle
  const headerStatus: PersaiRuntimeTodoWriteStatus = allDone
    ? "completed"
    : currentTodo?.status === "in_progress"
      ? "in_progress"
      : "pending";

  const runClear = async () => {
    setClearing(true);
    try {
      await onClear();
    } finally {
      setClearing(false);
      setConfirmingClear(false);
    }
  };

  // ADR-125 follow-up — when the plan is fully completed, the trash click
  // is a single-tap delete with no confirmation prompt (the plan is done
  // anyway). Otherwise, a confirmation row gates the destructive action.
  const handleTrashClick = () => {
    if (allDone) {
      void runClear();
      return;
    }
    setConfirmingClear(true);
  };

  return (
    <div
      className={cn(
        // ADR-125 follow-up — quieter banner styling.
        //
        // Mobile (`< md`): flush against the chat header, no rounded
        // corners on the sides, no left/right borders, just a hairline
        // along the bottom edge to separate it from the message stream.
        //
        // Desktop (`md+`): subtle hairline border + slight rounding, no
        // shadow / "floating" feel. The background uses `color-mix()` so
        // the banner blends into the current surface variable instead of
        // hard-coding a tone (works in both light and dark themes).
        "border-b border-border/30 backdrop-blur-xl backdrop-saturate-150",
        "md:rounded-[0.625rem] md:border md:border-border/40",
        className
      )}
      style={{
        // Slightly more transparent on mobile, a touch more opaque on
        // desktop where the banner sits over the chat surface.
        backgroundColor: "color-mix(in srgb, var(--surface-raised) 78%, transparent)"
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <StatusIcon status={headerStatus} size="md" />
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-text-subtle">
            {t("planTitle")}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-text-muted/80">
            {t("planCounts", { done: doneCount, total: totalCount })}
          </span>
          {hiddenCount > 0 ? (
            <span className="shrink-0 text-[11px] text-text-muted/60">
              {t("planMoreHidden", { count: hiddenCount })}
            </span>
          ) : null}

          {/* Inline preview of the current task in the collapsed state */}
          {!expanded ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span aria-hidden className="shrink-0 text-text-muted/30">
                ·
              </span>
              {allDone ? (
                <span className="truncate text-[12px] text-text-muted">{t("planAllDone")}</span>
              ) : currentTodo !== null ? (
                <span
                  className={cn(
                    "truncate text-[12px]",
                    currentTodo.status === "in_progress"
                      ? "font-medium text-text"
                      : "text-text-subtle"
                  )}
                >
                  {currentTodo.content}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="flex-1" />
          )}

          <ChevronDown
            className={cn(
              "ml-1 h-3.5 w-3.5 shrink-0 text-text-muted/50 transition-transform duration-200 group-hover:text-text-muted",
              expanded && "rotate-180"
            )}
            aria-label={expanded ? t("planToggleCollapse") : t("planToggleExpand")}
          />
        </button>

        {!confirmingClear ? (
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-md p-1.5 transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40",
              allDone
                ? "text-emerald-600/70 hover:text-emerald-600"
                : "text-text-muted/50 hover:text-text-muted"
            )}
            onClick={handleTrashClick}
            disabled={clearing}
            aria-label={t("planClear")}
            data-all-done={allDone ? "true" : "false"}
          >
            {clearing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>

      {/* Inline confirm row (only when the plan is not yet fully done) */}
      {confirmingClear ? (
        <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2">
          <span className="flex-1 text-xs text-text-muted">{t("planClearConfirmPrompt")}</span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
            onClick={runClear}
            disabled={clearing}
          >
            {clearing ? (
              <Loader2 className="inline h-3 w-3 animate-spin" />
            ) : (
              t("planClearConfirmAction")
            )}
          </button>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-hover disabled:opacity-50"
            onClick={() => setConfirmingClear(false)}
            disabled={clearing}
          >
            {t("planClearCancel")}
          </button>
        </div>
      ) : null}

      {/* Body */}
      {expanded ? (
        <div id={bodyId} className="space-y-0 border-t border-border/30 px-3 py-2">
          {grouped.map(({ item, isOrphan, children }) => (
            <div key={item.id}>
              <PlanRow item={item} indented={false} isOrphan={isOrphan} />
              {children.map((child) => (
                <PlanRow key={child.id} item={child} indented={true} isOrphan={false} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
