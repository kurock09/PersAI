import { auth } from "@clerk/nextjs/server";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { LandingFinaleSection } from "./_components/landing/finale-section";
import { LandingFooter } from "./_components/landing/landing-footer";
import { LandingHeader } from "./_components/landing/landing-header";
import { LandingHeroSection } from "./_components/landing/hero-section";
import { LandingSystemSection } from "./_components/landing/system-section";
import { LandingWorkflowSection } from "./_components/landing/workflow-section";

export default async function HomePage() {
  const { userId } = await auth();
  if (userId !== null) {
    redirect("/app" as Route);
  }

  // Resolve every async section in parallel so the returned tree is plain
  // synchronous JSX. This keeps server-render behaviour identical to inline
  // <Section /> usage while making the page tractable for unit tests
  // (React Testing Library does not unwrap nested async components).
  const [hero, workflow, system, finale, footer] = await Promise.all([
    LandingHeroSection(),
    LandingWorkflowSection(),
    LandingSystemSection(),
    LandingFinaleSection(),
    LandingFooter()
  ]);

  return (
    <div className="relative min-h-screen min-h-[100svh] overflow-x-hidden bg-chrome">
      {/* Aurora — pinned to viewport so it stays calm and constant while the
          user scrolls through the editorial sections. Halos live inside an
          `overflow-hidden` parent so blur cannot bleed past the frame.
          Intentionally STATIC: pulsing three 600px / 400px / 350px elements
          with 120–160px blur is a real GPU cost on integrated graphics and
          shows up as scroll jank; premium landings (Apple, Linear, Stripe)
          use static gradients for exactly this reason. The halos still
          carry depth and warmth, they just do not breathe. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute left-[5%] top-[10%] h-[600px] w-[600px] rounded-full bg-accent/[0.13] blur-[160px]" />
        <div className="absolute right-[5%] top-[30%] h-[400px] w-[400px] rounded-full bg-accent/[0.07] blur-[130px]" />
        <div className="absolute bottom-[5%] left-[35%] h-[350px] w-[350px] rounded-full bg-accent/[0.09] blur-[120px]" />
      </div>

      {/* Tactile grain — subtle SVG noise overlay, kept fixed so the texture
          stays continuous across sections instead of repeating per block. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"
        }}
      />

      {/* Top hairline — sage gradient marker that the brand starts here. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent"
      />

      <div className="relative z-10 flex min-h-screen min-h-[100svh] flex-col">
        <LandingHeader />
        <main className="flex-1">
          {hero}
          {workflow}
          {system}
          {finale}
        </main>
        {footer}
      </div>
    </div>
  );
}
