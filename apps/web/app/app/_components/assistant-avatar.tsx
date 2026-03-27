"use client";

import { useMemo } from "react";
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

function bustCache(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${Math.floor(Date.now() / 60_000)}`;
}

export function AssistantAvatar({ avatarUrl, avatarEmoji, size, className }: AssistantAvatarProps) {
  const s = SIZE_CLASSES[size];
  const resolvedUrl = useMemo(() => (avatarUrl ? bustCache(avatarUrl) : null), [avatarUrl]);

  if (resolvedUrl) {
    return (
      <div
        className={cn(
          "shrink-0 overflow-hidden bg-accent/15",
          s.container,
          s.rounded,
          className
        )}
      >
        <img src={resolvedUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  if (avatarEmoji) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-accent/20 text-accent",
          s.container,
          s.text,
          s.rounded,
          className
        )}
      >
        {avatarEmoji}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center bg-accent/15 text-accent",
        s.container,
        s.rounded,
        className
      )}
    >
      <Sparkles className={s.icon} />
    </div>
  );
}
