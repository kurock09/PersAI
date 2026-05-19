import type { ReactNode } from "react";
import { cn } from "@/app/lib/utils";

export function LandingSection(props: { id?: string; className?: string; children: ReactNode }) {
  const { id, className, children } = props;
  return (
    <section id={id} className={cn("mx-auto w-full max-w-6xl px-5 sm:px-10", className)}>
      {children}
    </section>
  );
}

export function SectionEyebrow({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[10px] font-semibold uppercase tracking-[0.26em] text-text-subtle",
        className
      )}
    >
      {children}
    </p>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "max-w-3xl text-balance text-[clamp(1.7rem,3.4vw,2.6rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-text",
        className
      )}
    >
      {children}
    </h2>
  );
}

export function SectionLead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("max-w-2xl text-base leading-relaxed text-text-muted sm:text-lg", className)}>
      {children}
    </p>
  );
}
