"use client";

import { useState, useCallback, useEffect } from "react";
import { useSignUp, useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { navigateAfterClerkAuth } from "@/app/lib/clerk-navigation";
import { RedirectSignedInUserToApp } from "@/app/app/_components/redirect-signed-in-to-app";
import { PasswordField } from "@/app/app/_components/password-field";

type Stage = "form" | "verify";

export default function SignUpPage() {
  const t = useTranslations("auth");
  const { signUp, errors: clerkErrors, fetchStatus } = useSignUp();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isBusy = fetchStatus === "fetching";

  const handleSubmit = useCallback(async () => {
    if (!email.trim() || !password) return;
    setError(null);
    try {
      const { error: pwError } = await signUp.password({
        emailAddress: email.trim(),
        password
      });
      if (pwError) {
        setError(pwError.longMessage ?? pwError.message ?? t("signUpFailed"));
        return;
      }

      await signUp.verifications.sendEmailCode();
      setStage("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    }
  }, [email, password, signUp, t]);

  const handleVerify = useCallback(async () => {
    if (!code.trim()) return;
    setError(null);
    try {
      await signUp.verifications.verifyEmailCode({ code: code.trim() });

      if (signUp.status === "complete") {
        await signUp.finalize({
          navigate: async ({ decorateUrl }) => {
            navigateAfterClerkAuth(decorateUrl("/app/setup"));
          }
        });
      } else {
        setError(t("verificationIncomplete"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("verificationFailed"));
    }
  }, [code, signUp, t]);

  if (!authLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
      </div>
    );
  }

  if (signUp.status === "complete") {
    return <SignUpCompleteSplash />;
  }

  if (isSignedIn) {
    return <RedirectSignedInUserToApp />;
  }

  const fieldErrors = clerkErrors?.fields as unknown as
    | Record<string, { message: string }>
    | undefined;

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden px-4">
      <div className="pointer-events-none absolute top-1/4 -left-32 h-[400px] w-[400px] rounded-full bg-accent/8 blur-[100px] animate-pulse-slow" />
      <div className="pointer-events-none absolute bottom-1/3 -right-32 h-[350px] w-[350px] rounded-full bg-accent/5 blur-[90px] animate-pulse-slow [animation-delay:2s]" />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center animate-fade-in">
        <h1 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Pers<span className="text-accent">AI</span>
        </h1>
        <p className="mb-8 text-sm text-text-muted">{t("tagline")}</p>

        <div className="w-full rounded-2xl border border-border bg-surface p-6 shadow-xl">
          {stage === "form" && (
            <>
              <h2 className="text-lg font-semibold text-text">{t("signUpTitle")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("signUpSubtitle")}</p>

              <label className="mb-1.5 block text-xs font-medium text-text-muted">
                {t("emailLabel")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                autoFocus
                className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
              />
              {fieldErrors?.emailAddress && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.emailAddress.message}</p>
              )}

              <label className="mt-4 mb-1.5 block text-xs font-medium text-text-muted">
                {t("passwordLabel")}
              </label>
              <PasswordField
                value={password}
                onChange={setPassword}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmit();
                }}
                placeholder={t("passwordCreatePlaceholder")}
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
              />
              {fieldErrors?.password && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.password.message}</p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-text-subtle">
                {t("passwordCreateHint")}
              </p>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isBusy || !email.trim() || !password}
                className={cn(
                  "mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  email.trim() && password
                    ? "bg-accent text-white shadow-lg shadow-accent-glow hover:bg-accent-hover"
                    : "cursor-default bg-surface-raised text-text-subtle"
                )}
              >
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t("signUpBtn")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <a
                href="/sign-in?mode=forgot-password"
                className="mt-3 inline-flex text-xs font-medium text-accent transition-colors hover:text-accent-hover"
              >
                {t("forgotPasswordLink")}
              </a>
            </>
          )}

          {stage === "verify" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setStage("form");
                  setError(null);
                  setCode("");
                }}
                className="mb-4 cursor-pointer text-xs text-text-muted transition-colors hover:text-text"
              >
                {t("back")}
              </button>
              <h2 className="text-lg font-semibold text-text">{t("verifyEmailTitle")}</h2>
              <p className="mt-1 text-xs text-text-muted">{t("verifyDesc", { email })}</p>

              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleVerify();
                }}
                placeholder={t("codePlaceholder")}
                autoFocus
                maxLength={8}
                className="mt-5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-center text-lg tracking-widest text-text placeholder:text-sm placeholder:tracking-normal placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
              />
              {fieldErrors?.code && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.code.message}</p>
              )}

              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={isBusy || !code.trim()}
                className={cn(
                  "mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  code.trim()
                    ? "bg-accent text-white shadow-lg shadow-accent-glow hover:bg-accent-hover"
                    : "cursor-default bg-surface-raised text-text-subtle"
                )}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("verifyBtn")}
              </button>

              <button
                type="button"
                onClick={() => void signUp.verifications.sendEmailCode()}
                disabled={isBusy}
                className="mt-3 w-full cursor-pointer text-center text-xs text-text-muted transition-colors hover:text-accent"
              >
                {t("resendCode")}
              </button>
            </>
          )}

          {error && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div id="clerk-captcha" className="mt-3" />
        </div>

        <p className="mt-6 text-xs text-text-subtle">
          {t("hasAccount")}{" "}
          <a
            href="/sign-in"
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("signInLink")}
          </a>
        </p>
      </div>
    </div>
  );
}

/** Avoid blank screen: Clerk may mark sign-up complete before `finalize` navigation runs. */
function SignUpCompleteSplash() {
  const t = useTranslations("auth");

  useEffect(() => {
    const id = window.setTimeout(() => {
      navigateAfterClerkAuth("/app/setup", "replace");
    }, 150);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-sm text-text-muted">{t("signingIn")}</p>
      </div>
    </div>
  );
}
