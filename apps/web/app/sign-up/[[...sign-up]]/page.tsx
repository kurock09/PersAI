"use client";

import { useState, useCallback, useEffect } from "react";
import { useSignUp, useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  getSafeRedirectPathFromSearch,
  navigateAfterClerkAuth,
  withSafeRedirectParam
} from "@/app/lib/clerk-navigation";
import { RedirectSignedInUserToApp } from "@/app/app/_components/redirect-signed-in-to-app";
import { PasswordField } from "@/app/app/_components/password-field";
import { mapClerkError } from "@/app/lib/clerk-error-messages";
import { PublicAuthCardHeader } from "@/app/_components/public-auth-card-header";
import { PublicAuthShell } from "@/app/_components/public-auth-shell";

type Stage = "form" | "verify";

export default function SignUpPage() {
  const t = useTranslations("auth");
  const { signUp, errors: clerkErrors, fetchStatus } = useSignUp();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isBusy = fetchStatus === "fetching";
  const currentSearch = searchParams.toString();
  const signInHref = withSafeRedirectParam("/sign-in", currentSearch);
  const forgotPasswordHref = withSafeRedirectParam("/sign-in?mode=forgot-password", currentSearch);

  const handleSubmit = useCallback(async () => {
    if (!email.trim() || !password) return;
    setError(null);
    try {
      const { error: pwError } = await signUp.password({
        emailAddress: email.trim(),
        password
      });
      if (pwError) {
        setError(mapClerkError(pwError, t, "signUpFailed"));
        return;
      }

      await signUp.verifications.sendEmailCode();
      setStage("verify");
    } catch {
      setError(t("somethingWrong"));
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
            const target = getSafeRedirectPathFromSearch(window.location.search) ?? "/app/setup";
            navigateAfterClerkAuth(decorateUrl(target));
          }
        });
      } else {
        setError(t("verificationIncomplete"));
      }
    } catch {
      setError(t("verificationFailed"));
    }
  }, [code, signUp, t]);

  if (!authLoaded) {
    return (
      <PublicAuthShell>
        <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
      </PublicAuthShell>
    );
  }

  if (signUp.status === "complete") {
    return <SignUpCompleteSplash />;
  }

  if (isSignedIn) {
    return <RedirectSignedInUserToApp />;
  }

  const fieldErrors = clerkErrors?.fields as unknown as Record<string, unknown> | undefined;

  return (
    <PublicAuthShell>
      <div className="flex w-full max-w-sm flex-col items-center animate-fade-in">
        <div className="w-full rounded-2xl border border-border/85 bg-surface-raised/88 p-6 shadow-[0_14px_36px_rgba(0,0,0,0.12)]">
          {stage === "form" && (
            <>
              <PublicAuthCardHeader title={t("signUpTitle")} description={t("signUpSubtitle")} />

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
                <p className="mt-1 text-xs text-destructive">
                  {mapClerkError(fieldErrors.emailAddress, t, "signUpFailed")}
                </p>
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
                <p className="mt-1 text-xs text-destructive">
                  {mapClerkError(fieldErrors.password, t, "signUpFailed")}
                </p>
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
                    ? "bg-accent text-white shadow-[0_0_18px_var(--accent-glow)] hover:bg-accent-hover"
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
                href={forgotPasswordHref}
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
              <PublicAuthCardHeader
                title={t("verifyEmailTitle")}
                description={t("verifyDesc", { email })}
              />

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
                <p className="mt-1 text-xs text-destructive">
                  {mapClerkError(fieldErrors.code, t, "verificationFailed")}
                </p>
              )}

              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={isBusy || !code.trim()}
                className={cn(
                  "mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  code.trim()
                    ? "bg-accent text-white shadow-[0_0_18px_var(--accent-glow)] hover:bg-accent-hover"
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
            href={signInHref}
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("signInLink")}
          </a>
        </p>
      </div>
    </PublicAuthShell>
  );
}

/** Avoid blank screen: Clerk may mark sign-up complete before `finalize` navigation runs. */
function SignUpCompleteSplash() {
  const t = useTranslations("auth");

  useEffect(() => {
    const id = window.setTimeout(() => {
      const target = getSafeRedirectPathFromSearch(window.location.search) ?? "/app/setup";
      navigateAfterClerkAuth(target, "replace");
    }, 150);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <PublicAuthShell>
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-sm text-text-muted">{t("signingIn")}</p>
      </div>
    </PublicAuthShell>
  );
}
