"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Sparkles } from "lucide-react";
import { cn } from "@/app/lib/utils";

const SIZE_CLASSES = {
  sm: { container: "h-7 w-7", icon: "h-3.5 w-3.5", text: "text-sm", rounded: "rounded-full" },
  md: { container: "h-10 w-10", icon: "h-5 w-5", text: "text-xl", rounded: "rounded-full" },
  lg: { container: "h-20 w-20", icon: "h-10 w-10", text: "text-4xl", rounded: "rounded-3xl" }
} as const;

type AvatarSize = keyof typeof SIZE_CLASSES;
const AVATAR_BLOB_CACHE = new Map<string, string>();

interface AssistantAvatarProps {
  avatarUrl?: string | null | undefined;
  avatarEmoji?: string | null | undefined;
  size: AvatarSize;
  className?: string;
}

export function AssistantAvatar({ avatarUrl, avatarEmoji, size, className }: AssistantAvatarProps) {
  const s = SIZE_CLASSES[size];
  const { getToken } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");

  useEffect(() => {
    if (!avatarUrl) {
      setBlobUrl(null);
      setStatus("idle");
      return;
    }

    const cachedBlobUrl = AVATAR_BLOB_CACHE.get(avatarUrl);
    if (cachedBlobUrl) {
      setBlobUrl(cachedBlobUrl);
      setStatus("loaded");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    void (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const res = await fetch(avatarUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok || cancelled) {
          if (!cancelled) setStatus("error");
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const nextBlobUrl = URL.createObjectURL(blob);
        AVATAR_BLOB_CACHE.set(avatarUrl, nextBlobUrl);
        setBlobUrl(nextBlobUrl);
        setStatus("loaded");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarUrl, getToken]);

  const fallbackContent = avatarEmoji ? (
    <span>{avatarEmoji}</span>
  ) : (
    <Sparkles className={s.icon} />
  );

  if (status === "loaded" && blobUrl) {
    return (
      <div
        className={cn("shrink-0 overflow-hidden bg-accent/15", s.container, s.rounded, className)}
      >
        <img src={blobUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center text-accent",
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
