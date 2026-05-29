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
      {/* Top hairline — sage marker that the brand starts here. */}
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
