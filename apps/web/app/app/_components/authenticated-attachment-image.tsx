"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { cn } from "@/app/lib/utils";

export function useAuthenticatedBlobUrl(src: string | null): {
  blobUrl: string | null;
  failed: boolean;
} {
  const { getToken } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setBlobUrl(null);
      setFailed(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setBlobUrl(null);

    void (async () => {
      try {
        const token = await getToken();
        const headers: HeadersInit = {};
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(src, {
          credentials: "include",
          headers,
          cache: "no-store"
        });
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setBlobUrl(objectUrl);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [getToken, src]);

  return { blobUrl, failed };
}

export function AuthenticatedAttachmentImage({
  src,
  alt,
  className
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const { blobUrl, failed } = useAuthenticatedBlobUrl(src);

  if (failed) {
    return (
      <span className={cn("px-1 text-[10px] text-text-subtle", className)} title={alt}>
        {alt}
      </span>
    );
  }

  if (!blobUrl) {
    return <span className={cn("block animate-pulse bg-surface-hover", className)} aria-hidden />;
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}
