"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

const ACTIVE_TODO_LIMIT = 7;
const PLAN_BODY_MAX_HEIGHT_CLASS = "max-h-[min(40vh,280px)]";
const PLAN_IDLE_COLLAPSE_MS = 10_000;
const MOBILE_PLAN_QUERY = "(max-width: 767px)";

function isMobilePlanViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_PLAN_QUERY).matches
  );
}

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
  hiddenRowCount: number;
  firstActiveRowId: string | null;
} {
  const firstActiveRowId = rows.find((row) => row.item.status !== "completed")?.item.id ?? null;

  if (showAllActive) {
    return {
      visibleRows: rows,
      hiddenRowCount: 0,
      firstActiveRowId
    };
  }

  if (rows.length <= ACTIVE_TODO_LIMIT) {
    return {
      visibleRows: rows,
      hiddenRowCount: 0,
      firstActiveRowId
    };
  }

  const firstActiveIndex = rows.findIndex((row) => row.item.status !== "completed");
  if (firstActiveIndex === -1) {
    return {
      visibleRows: rows.slice(0, ACTIVE_TODO_LIMIT),
      hiddenRowCount: rows.length - ACTIVE_TODO_LIMIT,
      firstActiveRowId: null
    };
  }

  const activeCount = rows.length - firstActiveIndex;
  const completedBeforeActive = firstActiveIndex;
  const completedToShow = Math.min(
    completedBeforeActive,
    Math.max(0, ACTIVE_TODO_LIMIT - activeCount)
  );
  const startIndex = Math.max(0, firstActiveIndex - completedToShow);
  const visibleRows = rows.slice(startIndex, startIndex + ACTIVE_TODO_LIMIT);

  return {
    visibleRows,
    hiddenRowCount: rows.length - visibleRows.length,
    firstActiveRowId
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
  // Match lucide Circle / CheckCircle2 geometry (24×24, r=10, stroke 2) so the ring
  // reads the same diameter as pending/completed icons. Arrow starts left of center and
  // may extend slightly past the ring; overflow stays visible inside the fixed h/w box.
  return (
    <svg
      viewBox="0 0 24 24"
      overflow="visible"
      className={cn("shrink-0 overflow-visible text-text-muted/55", className)}
      aria-label="in_progress"
      fill="none"
    >
      <path
        d="M 21.39 15.78 A 10 10 0 1 1 21.39 8.22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M 9 12 H 19.2 M 17.2 10.1 21.8 12 17.2 13.9"
        stroke="currentColor"
        strokeWidth="2"
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
  const [mobileCircle, setMobileCircle] = useState(true);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const planBodyRef = useRef<HTMLDivElement>(null);

  const sortedTodos = useMemo(() => sortTodosForDisplay(todos), [todos]);
  const grouped = useMemo(() => groupTodos(sortedTodos), [sortedTodos]);
  const allRows = useMemo(() => flattenGroupedRows(grouped), [grouped]);
  const { visibleRows, hiddenRowCount, firstActiveRowId } = useMemo(
    () => buildVisiblePlanRows(allRows, showAllActive),
    [allRows, showAllActive]
  );

  useEffect(() => {
    if (!expanded) {
      setShowAllActive(false);
    }
  }, [expanded]);

  useEffect(() => {
    const collapseForViewport = () => {
      setExpanded(false);
      setConfirmingClear(false);
      if (isMobilePlanViewport()) {
        setMobileCircle(true);
      }
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !cardRef.current?.contains(event.target)) {
        collapseForViewport();
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, []);

  useEffect(() => {
    const shouldCollapseAfterIdle = expanded || (!mobileCircle && isMobilePlanViewport());
    if (!shouldCollapseAfterIdle) return;
    const timer = window.setTimeout(() => {
      setExpanded(false);
      setConfirmingClear(false);
      if (isMobilePlanViewport()) {
        setMobileCircle(true);
      }
    }, PLAN_IDLE_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, interactionVersion, mobileCircle]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_PLAN_QUERY);
    const handleViewportChange = () => {
      setExpanded(false);
      setConfirmingClear(false);
      setMobileCircle(media.matches);
    };
    media.addEventListener("change", handleViewportChange);
    return () => media.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    if (!expanded || !showAllActive || firstActiveRowId === null) {
      return;
    }
    const anchor = planBodyRef.current?.querySelector(
      `[data-plan-first-active="${firstActiveRowId}"]`
    );
    if (anchor instanceof HTMLElement && typeof anchor.scrollIntoView === "function") {
      anchor.scrollIntoView({ block: "start" });
    }
  }, [expanded, firstActiveRowId, showAllActive]);

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

  const handleHeaderClick = () => {
    if (isMobilePlanViewport() && mobileCircle) {
      setMobileCircle(false);
      return;
    }
    setExpanded((prev) => !prev);
  };

  return (
    <div
      ref={cardRef}
      data-testid="chat-plan-card"
      onPointerDownCapture={() => setInteractionVersion((version) => version + 1)}
      className={cn(
        "overflow-hidden border border-border/40 bg-surface-raised transition-[width] duration-300 ease-out",
        mobileCircle ? "ml-auto h-11 w-11 md:ml-0 md:h-auto md:w-full" : "w-full",
        // Instant radius snap — width may animate, but stadium corners must not lag.
        expanded ? "rounded-[1.375rem]" : "rounded-full",
        className
      )}
    >
      {mobileCircle ? (
        <button
          type="button"
          data-testid="chat-plan-mobile-circle"
          className="flex h-11 w-11 items-center justify-center whitespace-nowrap text-[11px] font-semibold tabular-nums text-text md:hidden"
          onClick={handleHeaderClick}
          aria-label={t("planCounts", { done: doneCount, total: totalCount })}
        >
          <span>{doneCount}</span>
          <span className="px-px text-text-subtle/60">/</span>
          <span>{totalCount}</span>
        </button>
      ) : null}
      <div
        className={cn(
          "h-11 items-center gap-1.5 pl-3 pr-1.5",
          mobileCircle ? "hidden md:flex" : "flex"
        )}
      >
        {confirmingClear ? (
          <>
            <span className="min-w-0 flex-1 truncate px-0.5 text-xs text-text-muted">
              {t("planClearConfirmPrompt")}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
              onClick={() => setConfirmingClear(false)}
              disabled={clearing}
            >
              {t("planClearCancel")}
            </button>
            <button
              type="button"
              className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50"
              onClick={runClear}
              disabled={clearing}
            >
              {clearing ? (
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
              ) : (
                t("planClearConfirmAction")
              )}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="group flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={handleHeaderClick}
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

            <button
              type="button"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40",
                allDone
                  ? "text-emerald-600/70 hover:bg-emerald-500/10 hover:text-emerald-600"
                  : "text-text-muted/50 hover:bg-surface-hover hover:text-text-muted"
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
          </>
        )}
      </div>

      {expanded ? (
        <>
          <div
            id={bodyId}
            ref={planBodyRef}
            className={cn(
              "space-y-0 border-t border-border/30 px-3 py-2",
              PLAN_BODY_MAX_HEIGHT_CLASS,
              showAllActive ? "overflow-y-auto" : "overflow-hidden"
            )}
          >
            {visibleRows.map((row) => (
              <div
                key={row.item.id}
                {...(showAllActive && row.item.id === firstActiveRowId
                  ? { "data-plan-first-active": row.item.id }
                  : {})}
              >
                <PlanRow item={row.item} indented={row.indented} isOrphan={row.isOrphan} />
              </div>
            ))}
          </div>
          {hiddenRowCount > 0 ? (
            <div className="border-t border-border/20 px-3 py-2">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-[12px] font-medium text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
                onClick={() => setShowAllActive(true)}
                data-testid="chat-plan-show-more"
              >
                {t("planShowMore", { count: hiddenRowCount })}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
