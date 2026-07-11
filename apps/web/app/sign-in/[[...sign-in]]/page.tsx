"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  getSafeRedirectPathFromSearch,
  navigateAfterClerkAuth,
  withSafeRedirectParam
} from "@/app/lib/clerk-navigation";
import { RedirectSignedInUserToApp } from "@/app/app/_components/redirect-signed-in-to-app";
import { mapClerkError } from "@/app/lib/clerk-error-messages";
import { PasswordField } from "@/app/app/_components/password-field";
import { useSearchParams } from "next/navigation";
import { PublicAuthCardHeader } from "@/app/_components/public-auth-card-header";
import { PublicAuthShell } from "@/app/_components/public-auth-shell";

type Stage = "form" | "verify" | "forgot-request" | "forgot-code" | "forgot-password";

export default function SignInPage() {
  const t = useTranslations("auth");
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const { signIn, errors: clerkErrors } = useSignIn();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const signUpHref = withSafeRedirectParam("/sign-up", currentSearch);
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isBusy = submitting;

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
    if (isBusy || !email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: pwError } = await signIn.password({
        emailAddress: email.trim(),
        password
      });
      if (pwError) {
        setError(mapClerkError(pwError, t, "signInFailed"));
        return;
      }

      if (signIn.status === "complete") {
        void finalize();
        return;
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
    } catch {
      setError(t("somethingWrong"));
    } finally {
      setSubmitting(false);
    }
  }, [email, password, isBusy, signIn, finalize, t]);

  const handleVerifyCode = useCallback(async () => {
    if (isBusy || !code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn.mfa.verifyEmailCode({ code: code.trim() });
      if (signIn.status === "complete") {
        void finalize();
        return;
      } else {
        setError(t("verificationFailed"));
      }
    } catch {
      setError(t("verificationFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [code, isBusy, signIn, finalize, t]);

  const resetForgotPasswordState = useCallback(async () => {
    setResetCode("");
    setResetPassword("");
    setResetPasswordConfirm("");
    setError(null);
    await signIn.reset();
  }, [signIn]);

  const handleForgotRequest = useCallback(async () => {
    if (isBusy || !resetEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: createError } = await signIn.create({
        identifier: resetEmail.trim()
      });
      if (createError) {
        setError(mapClerkError(createError, t, "forgotPasswordRequestFailed"));
        return;
      }

      const { error: sendCodeError } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendCodeError) {
        setError(mapClerkError(sendCodeError, t, "forgotPasswordRequestFailed"));
        return;
      }

      setStage("forgot-code");
    } catch {
      setError(t("somethingWrong"));
    } finally {
      setSubmitting(false);
    }
  }, [resetEmail, isBusy, signIn, t]);

  const handleForgotVerifyCode = useCallback(async () => {
    if (isBusy || !resetCode.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: verifyError } = await signIn.resetPasswordEmailCode.verifyCode({
        code: resetCode.trim()
      });
      if (verifyError) {
        setError(mapClerkError(verifyError, t, "verificationFailed"));
        return;
      }

      if (signIn.status === "needs_new_password") {
        setStage("forgot-password");
      } else {
        setError(t("verificationIncomplete"));
      }
    } catch {
      setError(t("verificationFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [resetCode, isBusy, signIn, t]);

  const handleForgotSubmitPassword = useCallback(async () => {
    if (isBusy || !resetPassword.trim() || !resetPasswordConfirm.trim()) return;
    if (resetPassword !== resetPasswordConfirm) {
      setError(t("passwordMismatch"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { error: passwordError } = await signIn.resetPasswordEmailCode.submitPassword({
        password: resetPassword
      });
      if (passwordError) {
        setError(mapClerkError(passwordError, t, "passwordResetFailed"));
        return;
      }

      if (signIn.status === "complete") {
        void finalize();
        return;
      } else if (signIn.status === "needs_second_factor") {
        setError(t("additionalVerification"));
      } else {
        setError(t("verificationIncomplete"));
      }
    } catch {
      setError(t("passwordResetFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [finalize, resetPassword, resetPasswordConfirm, isBusy, signIn, t]);

  const fieldErrors = clerkErrors?.fields as unknown as Record<string, unknown> | undefined;

  if (!authLoaded || !signIn) {
    return (
      <PublicAuthShell showFooter>
        <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
      </PublicAuthShell>
    );
  }

  if (isSignedIn) {
    return <RedirectSignedInUserToApp />;
  }

  return (
    <PublicAuthShell showFooter>
      <div className="flex w-full max-w-sm flex-col items-center animate-fade-in">
        <div className="w-full rounded-2xl border border-border/85 bg-surface-raised/88 p-6 shadow-[0_14px_36px_rgba(0,0,0,0.12)]">
          {stage === "form" && (
            <>
              <PublicAuthCardHeader title={t("signInTitle")} description={t("signInWelcome")} />

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
                className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-base text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent md:text-sm"
              />
              {fieldErrors?.identifier && (
                <p className="mt-1 text-xs text-destructive">
                  {mapClerkError(fieldErrors.identifier, t, "signInFailed")}
                </p>
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
                <p className="mt-1 text-xs text-destructive">
                  {mapClerkError(fieldErrors.password, t, "signInFailed")}
                </p>
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
                    ? "bg-accent text-white shadow-[0_0_18px_var(--accent-glow)] hover:bg-accent-hover"
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
              <PublicAuthCardHeader
                title={t("verifyTitle")}
                description={t("verifyDesc", { email })}
              />

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
                className="mt-5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-center text-lg tracking-widest text-text placeholder:text-base placeholder:tracking-normal placeholder:text-text-subtle md:placeholder:text-sm outline-none transition-colors focus:border-accent"
              />

              <button
                type="button"
                onClick={() => void handleVerifyCode()}
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
              <PublicAuthCardHeader
                title={t("forgotPasswordTitle")}
                description={t("forgotPasswordSubtitle")}
              />

              <label className="mt-5 mb-1.5 block text-xs font-medium text-text-muted">
                {t("emailLabel")}
              </label>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                autoFocus
                className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-base text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent md:text-sm"
              />

              <button
                type="button"
                onClick={() => void handleForgotRequest()}
                disabled={isBusy || !resetEmail.trim()}
                className={cn(
                  "mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  resetEmail.trim()
                    ? "bg-accent text-white shadow-[0_0_18px_var(--accent-glow)] hover:bg-accent-hover"
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
              <PublicAuthCardHeader
                title={t("resetCodeTitle")}
                description={t("resetCodeSubtitle", { email: resetEmail })}
              />

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
                className="mt-5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-center text-lg tracking-widest text-text placeholder:text-base placeholder:tracking-normal placeholder:text-text-subtle md:placeholder:text-sm outline-none transition-colors focus:border-accent"
              />

              <button
                type="button"
                onClick={() => void handleForgotVerifyCode()}
                disabled={isBusy || !resetCode.trim()}
                className={cn(
                  "mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  resetCode.trim()
                    ? "bg-accent text-white shadow-[0_0_18px_var(--accent-glow)] hover:bg-accent-hover"
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
              <PublicAuthCardHeader
                title={t("newPasswordTitle")}
                description={t("newPasswordSubtitle", { email: resetEmail })}
              />

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
            href={signUpHref}
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("signUpLink")}
          </a>
        </p>
      </div>
    </PublicAuthShell>
  );
}
