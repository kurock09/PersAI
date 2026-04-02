import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden px-4">
      <div className="pointer-events-none absolute top-1/4 -left-32 h-[400px] w-[400px] rounded-full bg-accent/8 blur-[100px] animate-pulse-slow" />
      <div className="pointer-events-none absolute bottom-1/3 -right-32 h-[350px] w-[350px] rounded-full bg-accent/5 blur-[90px] animate-pulse-slow [animation-delay:2s]" />

      <div className="relative z-10 flex flex-col items-center animate-fade-in">
        <h1 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
          Pers<span className="text-accent">AI</span>
        </h1>

        <SignIn
          routing="path"
          path="/sign-in"
          fallbackRedirectUrl="/app"
          signUpFallbackRedirectUrl="/app"
        />
      </div>
    </div>
  );
}
