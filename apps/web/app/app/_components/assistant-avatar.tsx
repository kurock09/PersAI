"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/app/lib/utils";

const SIZE_CLASSES = {
  sm: { container: "h-7 w-7", icon: "h-3.5 w-3.5", text: "text-sm", rounded: "rounded-full" },
  md: { container: "h-10 w-10", icon: "h-5 w-5", text: "text-xl", rounded: "rounded-full" },
  lg: { container: "h-20 w-20", icon: "h-10 w-10", text: "text-4xl", rounded: "rounded-3xl" }
} as const;

type AvatarSize = keyof typeof SIZE_CLASSES;

interface AssistantAvatarProps {
  avatarUrl?: string | null | undefined;
  avatarEmoji?: string | null | undefined;
  size: AvatarSize;
  className?: string;
}

/**
 * ADR-076 Slice 4 — purely presentational avatar.
 *
 * Lifecycle state delivers `avatarUrl` in the form `/api/avatar/<hash>.<ext>`
 * which is served by the same-origin BFF route handler with cookie auth and
 * `Cache-Control: private, max-age=31536000, immutable`. The browser handles
 * caching; this component just renders an `<img>`. Falls back to the emoji
 * (or sparkles) when no URL is present.
 */
export function AssistantAvatar({ avatarUrl, avatarEmoji, size, className }: AssistantAvatarProps) {
  const s = SIZE_CLASSES[size];

  if (avatarUrl) {
    return (
      <div
        className={cn("shrink-0 overflow-hidden bg-accent/15", s.container, s.rounded, className)}
      >
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  const fallbackContent = avatarEmoji ? (
    <span
      role="img"
      className="inline-flex h-full w-full items-center justify-center leading-[1] select-none"
    >
      {avatarEmoji}
    </span>
  ) : (
    <Sparkles className={s.icon} />
  );

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden text-accent",
        avatarEmoji ? "bg-accent/20" : "bg-accent/15",
        s.container,
        s.text,
        s.rounded,
        className
      )}
    >
      {fallbackContent}
    </div>
  );
}
