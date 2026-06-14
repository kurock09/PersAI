"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/app/lib/utils";

export function RuntimeFold({
  t,
  open: init = false,
  children
}: {
  t: string;
  open?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(init);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-1.5 py-0.5"
      >
        <ChevronDown
          className={cn("h-3 w-3 text-text-subtle transition-transform", !open && "-rotate-90")}
        />
        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted">{t}</span>
      </button>
      {open ? <div className="mt-1">{children}</div> : null}
    </section>
  );
}

export function RuntimeCard({
  title,
  trailing,
  children
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded border border-border/40 bg-surface px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">{title}</h3>
        {trailing}
      </div>
      {children}
    </div>
  );
}
