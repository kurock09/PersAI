"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function PageBackButton({ fallbackHref, label }: { fallbackHref: Route; label: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
      className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/80 bg-surface/70 px-3 py-2 text-sm text-text-muted transition-colors hover:border-border hover:bg-surface hover:text-text"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}
