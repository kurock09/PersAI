"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { getSafeRedirectPathFromSearch, navigateAfterClerkAuth } from "@/app/lib/clerk-navigation";
import { RedirectSignedInUserToApp } from "@/app/app/_components/redirect-signed-in-to-app";
import { PasswordField } from "@/app/app/_components/password-field";
import { useSearchParams } from "next/navigation";

type Stage = "form" | "verify" | "forgot-request" | "forgot-code" | "forgot-password";

export default function SignInPage() {
  const t = useTranslations("auth");
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const { signIn, errors: clerkErrors, fetchStatus } = useSignIn();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isBusy = fetchStatus === "fetching";

  useEffect(() => {
    if (searchParams.get("mode") === "forgot-password") {
      setStage((current) => (current === "form" ? "forgot-request" : current));
      setResetEmail((current) => current || email);
    }
  }, [email, searchParams]);

  const finalize = useCallback(async () => {
    await signIn.finalize({
      navigate: async ({ decorateUrl }) => {
        const target = getSafeRedirectPathFromSearch(window.location.search) ?? "/app";
        navigateAfterClerkAuth(decorateUrl(target));
      }
    });
  }, [signIn]);

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

  const resetForgotPasswordState = useCallback(async () => {
    setResetCode("");
    setResetPassword("");
    setResetPasswordConfirm("");
    setError(null);
    await signIn.reset();
  }, [signIn]);

  const handleForgotRequest = useCallback(async () => {
    if (!resetEmail.trim()) return;
    setError(null);
    try {
      const { error: createError } = await signIn.create({
        identifier: resetEmail.trim()
      });
      if (createError) {
        setError(
          createError.longMessage ?? createError.message ?? t("forgotPasswordRequestFailed")
        );
        return;
      }

      const { error: sendCodeError } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendCodeError) {
        setError(
          sendCodeError.longMessage ?? sendCodeError.message ?? t("forgotPasswordRequestFailed")
        );
        return;
      }

      setStage("forgot-code");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    }
  }, [resetEmail, signIn, t]);

  const handleForgotVerifyCode = useCallback(async () => {
    if (!resetCode.trim()) return;
    setError(null);
    try {
      const { error: verifyError } = await signIn.resetPasswordEmailCode.verifyCode({
        code: resetCode.trim()
      });
      if (verifyError) {
        setError(verifyError.longMessage ?? verifyError.message ?? t("verificationFailed"));
        return;
      }

      if (signIn.status === "needs_new_password") {
        setStage("forgot-password");
      } else {
        setError(t("verificationIncomplete"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("verificationFailed"));
    }
  }, [resetCode, signIn, t]);

  const handleForgotSubmitPassword = useCallback(async () => {
    if (!resetPassword.trim() || !resetPasswordConfirm.trim()) return;
    if (resetPassword !== resetPasswordConfirm) {
      setError(t("passwordMismatch"));
      return;
    }

    setError(null);
    try {
      const { error: passwordError } = await signIn.resetPasswordEmailCode.submitPassword({
        password: resetPassword
      });
      if (passwordError) {
        setError(passwordError.longMessage ?? passwordError.message ?? t("passwordResetFailed"));
        return;
      }

      if (signIn.status === "complete") {
        await finalize();
      } else if (signIn.status === "needs_second_factor") {
        setError(t("additionalVerification"));
      } else {
        setError(t("verificationIncomplete"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("passwordResetFailed"));
    }
  }, [finalize, resetPassword, resetPasswordConfirm, signIn, t]);

  const fieldErrors = clerkErrors?.fields as unknown as
    | Record<string, { message: string }>
    | undefined;

  if (!authLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
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
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("signInWelcome")}</p>

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
              <PasswordField
                value={password}
                onChange={setPassword}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handlePasswordSubmit();
                }}
                placeholder={t("passwordPlaceholder")}
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
              />
              {fieldErrors?.password && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.password.message}</p>
              )}

              <button
                type="button"
                onClick={() => {
                  setResetEmail(email);
                  setStage("forgot-request");
                  setError(null);
                }}
                className="mt-3 cursor-pointer text-xs font-medium text-accent transition-colors hover:text-accent-hover"
              >
                {t("forgotPasswordLink")}
              </button>

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

          {stage === "forgot-request" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setStage("form");
                  void resetForgotPasswordState();
                }}
                className="mb-4 cursor-pointer text-xs text-text-muted transition-colors hover:text-text"
              >
                {t("back")}
              </button>
              <h2 className="text-lg font-semibold text-text">{t("forgotPasswordTitle")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {t("forgotPasswordSubtitle")}
              </p>

              <label className="mt-5 mb-1.5 block text-xs font-medium text-text-muted">
                {t("emailLabel")}
              </label>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                autoFocus
                className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
              />

              <button
                type="button"
                onClick={() => void handleForgotRequest()}
                disabled={isBusy || !resetEmail.trim()}
                className={cn(
                  "mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  resetEmail.trim()
                    ? "bg-accent text-white shadow-lg shadow-accent-glow hover:bg-accent-hover"
                    : "cursor-default bg-surface-raised text-text-subtle"
                )}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("sendResetCode")}
              </button>
            </>
          )}

          {stage === "forgot-code" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setStage("forgot-request");
                  setError(null);
                  setResetCode("");
                }}
                className="mb-4 cursor-pointer text-xs text-text-muted transition-colors hover:text-text"
              >
                {t("back")}
              </button>
              <h2 className="text-lg font-semibold text-text">{t("resetCodeTitle")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {t("resetCodeSubtitle", { email: resetEmail })}
              </p>

              <input
                type="text"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleForgotVerifyCode();
                }}
                placeholder={t("codePlaceholder")}
                autoFocus
                maxLength={8}
                className="mt-5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-center text-lg tracking-widest text-text placeholder:text-sm placeholder:tracking-normal placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
              />

              <button
                type="button"
                onClick={() => void handleForgotVerifyCode()}
                disabled={isBusy || !resetCode.trim()}
                className={cn(
                  "mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  resetCode.trim()
                    ? "bg-accent text-white shadow-lg shadow-accent-glow hover:bg-accent-hover"
                    : "cursor-default bg-surface-raised text-text-subtle"
                )}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("verifyResetCode")}
              </button>

              <button
                type="button"
                onClick={() => void signIn.resetPasswordEmailCode.sendCode()}
                disabled={isBusy}
                className="mt-3 w-full cursor-pointer text-center text-xs text-text-muted transition-colors hover:text-accent"
              >
                {t("resendCode")}
              </button>
            </>
          )}

          {stage === "forgot-password" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setStage("forgot-code");
                  setError(null);
                  setResetPassword("");
                  setResetPasswordConfirm("");
                }}
                className="mb-4 cursor-pointer text-xs text-text-muted transition-colors hover:text-text"
              >
                {t("back")}
              </button>
              <h2 className="text-lg font-semibold text-text">{t("newPasswordTitle")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {t("newPasswordSubtitle", { email: resetEmail })}
              </p>

              <label className="mt-5 mb-1.5 block text-xs font-medium text-text-muted">
                {t("newPasswordLabel")}
              </label>
              <PasswordField
                value={resetPassword}
                onChange={setResetPassword}
                placeholder={t("passwordCreatePlaceholder")}
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
              />

              <label className="mt-4 mb-1.5 block text-xs font-medium text-text-muted">
                {t("confirmPasswordLabel")}
              </label>
              <PasswordField
                value={resetPasswordConfirm}
                onChange={setResetPasswordConfirm}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleForgotSubmitPassword();
                }}
                placeholder={t("confirmPasswordPlaceholder")}
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
              />

              <button
                type="button"
                onClick={() => void handleForgotSubmitPassword()}
                disabled={isBusy || !resetPassword.trim() || !resetPasswordConfirm.trim()}
                className={cn(
                  "mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  resetPassword.trim() && resetPasswordConfirm.trim()
                    ? "bg-accent text-white shadow-lg shadow-accent-glow hover:bg-accent-hover"
                    : "cursor-default bg-surface-raised text-text-subtle"
                )}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("saveNewPassword")}
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
