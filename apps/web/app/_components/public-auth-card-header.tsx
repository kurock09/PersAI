"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

export function PublicAuthCardHeader(props: { title: ReactNode; description?: ReactNode }) {
  const { title, description } = props;

  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0 pr-2">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
        ) : null}
      </div>

      <Link
        href={"/" as Route}
        className="shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-subtle transition-colors hover:text-text-muted"
      >
        Pers<span className="text-accent/80">AI</span>
      </Link>
    </div>
  );
}
