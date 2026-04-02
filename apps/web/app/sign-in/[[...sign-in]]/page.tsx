"use client";

import { useState, useCallback } from "react";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { getSafeRedirectPathFromSearch, navigateAfterClerkAuth } from "@/app/lib/clerk-navigation";
import { RedirectSignedInUserToApp } from "@/app/app/_components/redirect-signed-in-to-app";

type Stage = "form" | "verify";

export default function SignInPage() {
  const t = useTranslations("auth");
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const { signIn, errors: clerkErrors, fetchStatus } = useSignIn();
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isBusy = fetchStatus === "fetching";

  const finalize = useCallback(async () => {
    await signIn.finalize({
      navigate: async ({ decorateUrl }) => {
        const target = getSafeRedirectPathFromSearch(window.location.search) ?? "/app";
        navigateAfterClerkAuth(decorateUrl(target));
      }
    });
  }, [signIn]);

  const handleOAuth = useCallback(async () => {
    setError(null);
    try {
      const { error: ssoError } = await signIn.sso({
        strategy: "oauth_google",
        redirectUrl: "/app",
        redirectCallbackUrl: "/sso-callback"
      });
      if (ssoError) {
        setError(ssoError.longMessage ?? ssoError.message ?? t("oauthFailed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    }
  }, [signIn, t]);

  const handlePasswordSubmit = useCallback(async () => {
    if (!email.trim() || !password) return;
    setError(null);
    try {
      const { error: pwError } = await signIn.password({
        emailAddress: email.trim(),
        password
      });
      if (pwError) {
        setError(pwError.longMessage ?? pwError.message ?? t("signInFailed"));
        return;
      }

      if (signIn.status === "complete") {
        await finalize();
      } else if (signIn.status === "needs_client_trust") {
        const emailCodeFactor = signIn.supportedSecondFactors?.find(
          (f: { strategy: string }) => f.strategy === "email_code"
        );
        if (emailCodeFactor) {
          await signIn.mfa.sendEmailCode();
          setStage("verify");
        } else {
          setError(t("additionalVerification"));
        }
      } else if (signIn.status === "needs_second_factor") {
        await signIn.mfa.sendEmailCode();
        setStage("verify");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    }
  }, [email, password, signIn, finalize, t]);

  const handleVerifyCode = useCallback(async () => {
    if (!code.trim()) return;
    setError(null);
    try {
      await signIn.mfa.verifyEmailCode({ code: code.trim() });
      if (signIn.status === "complete") {
        await finalize();
      } else {
        setError(t("verificationFailed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("verificationFailed"));
    }
  }, [code, signIn, finalize, t]);

  const fieldErrors = clerkErrors?.fields as unknown as
    | Record<string, { message: string }>
    | undefined;

  if (!authLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
      </div>
    );
  }

  if (isSignedIn) {
    return <RedirectSignedInUserToApp />;
  }

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
              <h2 className="text-lg font-semibold text-text">{t("signInTitle")}</h2>
              <p className="mt-1 text-xs text-text-muted">{t("signInWelcome")}</p>

              {/* Google OAuth */}
              <button
                type="button"
                onClick={() => void handleOAuth()}
                disabled={isBusy}
                className="mt-6 flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
              >
                <GoogleIcon />
                {t("continueGoogle")}
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-text-subtle">{t("or")}</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Email */}
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
              {fieldErrors?.identifier && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.identifier.message}</p>
              )}

              {/* Password */}
              <label className="mt-4 mb-1.5 block text-xs font-medium text-text-muted">
                {t("passwordLabel")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handlePasswordSubmit();
                }}
                placeholder={t("passwordPlaceholder")}
                className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
              />
              {fieldErrors?.password && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.password.message}</p>
              )}

              {/* Submit */}
              <button
                type="button"
                onClick={() => void handlePasswordSubmit()}
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
                    {t("signInBtn")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
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
                  void signIn.reset();
                }}
                className="mb-4 cursor-pointer text-xs text-text-muted transition-colors hover:text-text"
              >
                {t("back")}
              </button>
              <h2 className="text-lg font-semibold text-text">{t("verifyTitle")}</h2>
              <p className="mt-1 text-xs text-text-muted">{t("verifyDesc", { email })}</p>

              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleVerifyCode();
                }}
                placeholder={t("codePlaceholder")}
                autoFocus
                maxLength={8}
                className="mt-5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-center text-lg tracking-widest text-text placeholder:text-sm placeholder:tracking-normal placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
              />

              <button
                type="button"
                onClick={() => void handleVerifyCode()}
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
                onClick={() => void signIn.mfa.sendEmailCode()}
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
        </div>

        <p className="mt-6 text-xs text-text-subtle">
          {t("noAccount")}{" "}
          <a
            href="/sign-up"
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("signUpLink")}
          </a>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
