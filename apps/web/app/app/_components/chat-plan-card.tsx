"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, Trash2 } from "lucide-react";
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
  // Identify items that are children of another item in the current window
  const childIds = new Set<string>();
  for (const item of todos) {
    if (item.parentId !== null && idSet.has(item.parentId)) {
      childIds.add(item.id);
    }
  }
  // Build child lists in server order
  const childrenByParentId = new Map<string, RuntimeTodoItem[]>();
  for (const item of todos) {
    if (childIds.has(item.id) && item.parentId !== null) {
      const list = childrenByParentId.get(item.parentId) ?? [];
      list.push(item);
      childrenByParentId.set(item.parentId, list);
    }
  }
  // Collect root items in server order, skipping pure children
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

function StatusIcon({ status }: { status: PersaiRuntimeTodoWriteStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-label="completed" />;
  }
  if (status === "in_progress") {
    return (
      <Loader2
        className="h-3.5 w-3.5 shrink-0 animate-spin text-text-subtle"
        aria-label="in_progress"
      />
    );
  }
  return <Circle className="h-3.5 w-3.5 shrink-0 text-text-muted/50" aria-label="pending" />;
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
  const seedLabel =
    item.origin === "scenario_seeded"
      ? item.seedSkillLabel
        ? t("planSeededFrom", { label: item.seedSkillLabel })
        : t("planSeededFromGeneric")
      : null;

  return (
    <div className={cn("flex items-start gap-2 py-0.5", indented && "pl-5")}>
      <span className="mt-0.5 shrink-0">
        <StatusIcon status={item.status} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-sm leading-snug",
          isDone ? "text-text-muted line-through" : "text-text-subtle"
        )}
      >
        {isOrphan ? <span className="mr-1 opacity-60">▸</span> : null}
        {item.content}
      </span>
      {seedLabel ? (
        <span className="ml-1 shrink-0 self-center rounded bg-surface-muted px-1.5 py-0.5 text-xs text-text-muted">
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
  const allDone = todos.every((item) => item.status === "completed") && doneCount === totalCount;
  const [expanded, setExpanded] = useState(!allDone);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const hiddenCount = windowed ? Math.max(0, totalCount - todos.length) : 0;
  const bodyId = "chat-plan-body";
  const grouped = groupTodos(todos);

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
        "overflow-hidden rounded-lg border border-border bg-surface text-sm",
        className
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <span className="font-medium text-text-subtle">{t("planTitle")}</span>
          <span className="shrink-0 text-xs text-text-muted">
            {t("planCounts", { done: doneCount, total: totalCount })}
          </span>
          {hiddenCount > 0 ? (
            <span className="shrink-0 text-xs text-text-muted/60">
              {t("planMoreHidden", { count: hiddenCount })}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-text-muted/60 transition-colors group-hover:text-text-muted">
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" aria-label={t("planToggleCollapse")} />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-label={t("planToggleExpand")} />
            )}
          </span>
        </button>

        {!confirmingClear ? (
          <button
            type="button"
            className="ml-1 shrink-0 rounded p-1 text-text-muted/60 transition-colors hover:bg-surface-hover hover:text-text-muted disabled:pointer-events-none disabled:opacity-40"
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
        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
          <span className="flex-1 text-xs text-text-muted">{t("planClearConfirmPrompt")}</span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs font-medium text-text-subtle transition-colors hover:bg-surface-hover disabled:opacity-50"
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

      {/* Body rows */}
      {expanded ? (
        <div id={bodyId} className="space-y-0.5 border-t border-border/60 px-3 py-2">
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
