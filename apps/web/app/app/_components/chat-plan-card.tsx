"use client";

import { useEffect, useMemo, useState } from "react";
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

const ACTIVE_TODO_LIMIT = 10;

interface GroupedTodo {
  item: RuntimeTodoItem;
  isOrphan: boolean;
  children: RuntimeTodoItem[];
}

interface PlanDisplayRow {
  item: RuntimeTodoItem;
  indented: boolean;
  isOrphan: boolean;
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

function sortTodosForDisplay(todos: RuntimeTodoItem[]): RuntimeTodoItem[] {
  const statusRank = (status: PersaiRuntimeTodoWriteStatus): number => {
    if (status === "completed") return 0;
    if (status === "in_progress") return 1;
    return 2;
  };
  return todos
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rankDelta = statusRank(left.item.status) - statusRank(right.item.status);
      if (rankDelta !== 0) return rankDelta;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function flattenGroupedRows(grouped: GroupedTodo[]): PlanDisplayRow[] {
  const rows: PlanDisplayRow[] = [];
  for (const { item, isOrphan, children } of grouped) {
    rows.push({ item, indented: false, isOrphan });
    for (const child of children) {
      rows.push({ item: child, indented: true, isOrphan: false });
    }
  }
  return rows;
}

function buildVisiblePlanRows(
  rows: PlanDisplayRow[],
  showAllActive: boolean
): {
  visibleRows: PlanDisplayRow[];
  hiddenActiveCount: number;
  activeRowCount: number;
} {
  const completedRows = rows.filter((row) => row.item.status === "completed");
  const activeRows = rows.filter((row) => row.item.status !== "completed");
  const visibleActiveRows =
    showAllActive || activeRows.length <= ACTIVE_TODO_LIMIT
      ? activeRows
      : activeRows.slice(0, ACTIVE_TODO_LIMIT);
  return {
    visibleRows: [...completedRows, ...visibleActiveRows],
    hiddenActiveCount: Math.max(0, activeRows.length - visibleActiveRows.length),
    activeRowCount: activeRows.length
  };
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

function TodoInProgressIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("shrink-0 text-text-muted/55", className)}
      aria-label="in_progress"
      fill="none"
    >
      {/* Ring with a gap on the right where the arrow exits (Cursor-style). */}
      <path
        d="M 12.53 10.11 A 5 5 0 1 1 12.53 5.89"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Horizontal arrow from center through the gap. */}
      <path
        d="M 8 8 H 11.6 M 10.4 6.75 12.75 8 10.4 9.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusIcon({
  status,
  size
}: {
  status: PersaiRuntimeTodoWriteStatus;
  size?: "sm" | "md";
}) {
  const cls = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  if (status === "completed") {
    return (
      <CheckCircle2 className={cn(cls, "shrink-0 text-emerald-500/70")} aria-label="completed" />
    );
  }
  if (status === "in_progress") {
    return <TodoInProgressIcon className={cls} />;
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
  const [expanded, setExpanded] = useState(false);
  const [showAllActive, setShowAllActive] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const sortedTodos = useMemo(() => sortTodosForDisplay(todos), [todos]);
  const grouped = useMemo(() => groupTodos(sortedTodos), [sortedTodos]);
  const allRows = useMemo(() => flattenGroupedRows(grouped), [grouped]);
  const { visibleRows, hiddenActiveCount, activeRowCount } = useMemo(
    () => buildVisiblePlanRows(allRows, showAllActive),
    [allRows, showAllActive]
  );

  useEffect(() => {
    if (!expanded) {
      setShowAllActive(false);
    }
  }, [expanded]);

  useEffect(() => {
    setShowAllActive(false);
  }, [todos]);

  const allDone = doneCount === totalCount && totalCount > 0;
  const currentTodo = selectCurrentTodo(sortedTodos);
  const hiddenCount = windowed ? Math.max(0, totalCount - todos.length) : 0;
  const bodyId = "chat-plan-body";

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
        "border-b border-border/30 backdrop-blur-xl backdrop-saturate-150",
        "md:rounded-[0.625rem] md:border md:border-border/40",
        className
      )}
      style={{
        backgroundColor: "color-mix(in srgb, var(--surface-raised) 78%, transparent)"
      }}
    >
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

      {expanded ? (
        <>
          <div
            id={bodyId}
            className={cn(
              "space-y-0 border-t border-border/30 px-3 py-2",
              showAllActive &&
                activeRowCount > ACTIVE_TODO_LIMIT &&
                "max-h-[min(40vh,280px)] overflow-y-auto"
            )}
          >
            {visibleRows.map((row) => (
              <PlanRow
                key={row.item.id}
                item={row.item}
                indented={row.indented}
                isOrphan={row.isOrphan}
              />
            ))}
          </div>
          {hiddenActiveCount > 0 ? (
            <div className="border-t border-border/20 px-3 py-2">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-[12px] font-medium text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
                onClick={() => setShowAllActive(true)}
                data-testid="chat-plan-show-more"
              >
                {t("planShowMore", { count: hiddenActiveCount })}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
