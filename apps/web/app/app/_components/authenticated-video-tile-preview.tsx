"use client";

import { Video } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useAuthenticatedVideoPosterUrl } from "./use-authenticated-video-poster-url";

export function AuthenticatedVideoTilePreview({
  posterPreviewUrl,
  videoSourceUrl,
  alt,
  className
}: {
  posterPreviewUrl: string | null;
  videoSourceUrl: string | null;
  alt: string;
  className?: string;
}) {
  const { posterUrl, loading, failed } = useAuthenticatedVideoPosterUrl({
    posterPreviewUrl,
    videoSourceUrl
  });

  if (posterUrl !== null) {
    return <img src={posterUrl} alt={alt} className={className} />;
  }

  if (failed) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-surface-hover/40",
          className
        )}
      >
        <Video className="h-10 w-10 text-text-muted" />
      </div>
    );
  }

  return (
    <span className={cn("block animate-pulse bg-surface-hover", className)} aria-hidden={loading} />
  );
}
