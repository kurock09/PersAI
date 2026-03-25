"use client";

import { Zap, Cpu, RefreshCw, Info } from "lucide-react";
import { cn } from "@/app/lib/utils";

export type ActivityType = "runtime_done" | "tool_use" | "system" | "info";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  label: string;
  detail?: string;
  timestamp?: string;
  afterMessageId?: string;
}

const TYPE_CONFIG: Record<ActivityType, { icon: typeof Cpu; color: string }> = {
  runtime_done: { icon: Zap, color: "text-text-subtle" },
  tool_use: { icon: Cpu, color: "text-text-subtle" },
  system: { icon: RefreshCw, color: "text-text-subtle" },
  info: { icon: Info, color: "text-text-subtle" }
};

export function ActivityBadge({ event }: { event: ActivityEvent }) {
  const cfg = TYPE_CONFIG[event.type];
  const Icon = cfg.icon;

  return (
    <div className="flex items-center justify-center py-0.5">
      <div
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5",
          "text-[10px] text-text-subtle/60"
        )}
      >
        <Icon className={cn("h-2.5 w-2.5", cfg.color, "opacity-40")} />
        <span>{event.label}</span>
        {event.detail && <span className="opacity-50">{event.detail}</span>}
      </div>
    </div>
  );
}
