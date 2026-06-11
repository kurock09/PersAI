"use client";

import { cn } from "@/app/lib/utils";

export function userFieldClassName(className?: string): string {
  return cn(
    "w-full rounded-2xl border border-border/80 bg-background px-4 py-3 text-sm text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(0,0,0,0.03)] outline-none transition-[border-color,background-color,box-shadow] placeholder:text-text-subtle hover:border-border hover:bg-background focus:border-accent/50 focus:bg-background focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_0_0_3px_rgba(191,148,84,0.12)]",
    className
  );
}

export function userTextareaClassName(className?: string): string {
  return userFieldClassName(cn("resize-y leading-6", className));
}

export function userPillButtonClassName(
  variant: "primary" | "secondary" | "danger" = "secondary",
  className?: string
): string {
  return cn(
    "inline-flex min-h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
    variant === "primary"
      ? "bg-accent text-white shadow-[0_10px_24px_rgba(0,0,0,0.12)] hover:bg-accent-hover"
      : variant === "danger"
        ? "border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15"
        : "border border-border/45 bg-surface-raised/72 text-text shadow-[0_6px_18px_rgba(0,0,0,0.04)] hover:border-border/60 hover:bg-surface-hover/92",
    className
  );
}
