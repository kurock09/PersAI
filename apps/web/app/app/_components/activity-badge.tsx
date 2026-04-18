"use client";

import { Zap, Cpu, RefreshCw, Info } from "lucide-react";
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

export function ActivityBadge({
  event,
  showShadowRoutingLabel = false
}: {
  event: ActivityEvent;
  showShadowRoutingLabel?: boolean;
}) {
  const cfg = TYPE_CONFIG[event.type];
  const Icon = cfg.icon;
  const isStrong = event.emphasis === "strong";
  const detail = buildActivityDetail(event, showShadowRoutingLabel);

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
        <span>{event.label}</span>
        {detail && <span className="opacity-50">{detail}</span>}
      </div>
    </div>
  );
}
