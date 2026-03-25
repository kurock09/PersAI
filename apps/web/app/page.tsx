import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const { userId } = await auth();
  if (userId !== null) {
    redirect("/app");
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Ambient glow orbs */}
      <div className="pointer-events-none absolute top-1/3 -left-40 h-[480px] w-[480px] rounded-full bg-accent/8 blur-[120px] animate-pulse-slow" />
      <div className="pointer-events-none absolute bottom-1/4 -right-40 h-[400px] w-[400px] rounded-full bg-accent/5 blur-[100px] animate-pulse-slow [animation-delay:2s]" />

      <div className="relative z-10 flex flex-col items-center px-6 text-center max-w-md animate-fade-in-up">
        <h1 className="text-6xl font-bold tracking-tight sm:text-7xl">
          Pers
          <span className="text-accent">AI</span>
        </h1>

        <p className="mt-5 text-lg leading-relaxed text-text-muted sm:text-xl">
          Your personal AI assistant.
          <br />
          One mind. Everywhere.
        </p>

        <SignInButton mode="modal">
          <button
            type="button"
            className="mt-10 cursor-pointer rounded-xl bg-accent px-10 py-3.5 text-base font-semibold text-white shadow-lg shadow-accent-glow transition-colors duration-200 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent animate-fade-in-up-delay"
          >
            Get started
          </button>
        </SignInButton>

        <p className="mt-16 text-xs text-text-subtle">
          By continuing you agree to the Terms&nbsp;of&nbsp;Service
        </p>
      </div>
    </div>
  );
}
