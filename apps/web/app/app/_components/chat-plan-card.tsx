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
  const cls = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  if (status === "completed") {
    return (
      <CheckCircle2 className={cn(cls, "shrink-0 text-emerald-500/80")} aria-label="completed" />
    );
  }
  if (status === "in_progress") {
    return (
      <Loader2
        className={cn(cls, "shrink-0 animate-spin text-text-subtle")}
        aria-label="in_progress"
      />
    );
  }
  return <Circle className={cn(cls, "shrink-0 text-text-muted/50")} aria-label="pending" />;
}

function PlanRow({
  item,
  indented,
  isOrphan,
  t
}: {
  item: RuntimeTodoItem;
  indented: boolean;
  isOrphan: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const isDone = item.status === "completed";
  const isActive = item.status === "in_progress";
  const seedLabel =
    item.origin === "scenario_seeded"
      ? item.seedSkillLabel
        ? t("planSeededFrom", { label: item.seedSkillLabel })
        : t("planSeededFromGeneric")
      : null;

  return (
    <div className={cn("flex items-start gap-2 py-1", indented && "pl-5")}>
      <span className="mt-0.5 shrink-0">
        <StatusIcon status={item.status} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-sm leading-snug",
          isDone && "text-text-muted line-through",
          isActive && "font-medium text-text",
          !isDone && !isActive && "text-text-subtle"
        )}
      >
        {isOrphan ? <span className="mr-1 opacity-60">▸</span> : null}
        {item.content}
      </span>
      {seedLabel ? (
        <span className="ml-1 shrink-0 self-center rounded bg-surface-muted/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          {seedLabel}
        </span>
      ) : null}
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

  const handleConfirmClear = async () => {
    setClearing(true);
    try {
      await onClear();
    } finally {
      setClearing(false);
      setConfirmingClear(false);
    }
  };

  return (
    <div
      className={cn(
        // Frosted-glass card. Sits over the scrolling chat as a sticky
        // header; the supports-[backdrop-filter] fallback keeps the bg
        // readable on browsers without backdrop-filter.
        "overflow-hidden rounded-xl border border-border/40 bg-bg/85 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_-12px_rgba(0,0,0,0.10)] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-bg/70",
        className
      )}
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
          <span className="shrink-0 text-sm font-medium text-text">{t("planTitle")}</span>
          <span className="shrink-0 rounded-full bg-surface-muted/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-text-muted">
            {t("planCounts", { done: doneCount, total: totalCount })}
          </span>
          {hiddenCount > 0 ? (
            <span className="shrink-0 text-[11px] text-text-muted/70">
              {t("planMoreHidden", { count: hiddenCount })}
            </span>
          ) : null}

          {/* Inline preview of the current task in the collapsed state */}
          {!expanded ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span aria-hidden className="shrink-0 text-text-muted/40">
                ·
              </span>
              {allDone ? (
                <span className="truncate text-sm text-text-muted">{t("planAllDone")}</span>
              ) : currentTodo !== null ? (
                <span
                  className={cn(
                    "truncate text-sm",
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
              "ml-1 h-4 w-4 shrink-0 text-text-muted/60 transition-transform duration-200 group-hover:text-text-muted",
              expanded && "rotate-180"
            )}
            aria-label={expanded ? t("planToggleCollapse") : t("planToggleExpand")}
          />
        </button>

        {!confirmingClear ? (
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-text-muted/60 transition-colors hover:bg-surface-hover hover:text-text-muted disabled:pointer-events-none disabled:opacity-40"
            onClick={() => setConfirmingClear(true)}
            disabled={clearing}
            aria-label={t("planClear")}
          >
            {clearing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>

      {/* Inline confirm row */}
      {confirmingClear ? (
        <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
          <span className="flex-1 text-xs text-text-muted">{t("planClearConfirmPrompt")}</span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
            onClick={handleConfirmClear}
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
        <div id={bodyId} className="space-y-0 border-t border-border/40 px-3 py-2">
          {grouped.map(({ item, isOrphan, children }) => (
            <div key={item.id}>
              <PlanRow item={item} indented={false} isOrphan={isOrphan} t={t} />
              {children.map((child) => (
                <PlanRow key={child.id} item={child} indented={true} isOrphan={false} t={t} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
