"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Camera,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Save,
  Shield,
  User
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useClerkAvatar } from "../_components/use-clerk-avatar";
import { PasswordField } from "../_components/password-field";

export default function ProfilePage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const t = useTranslations("profile");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clerkAvatar = useClerkAvatar();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  const handleProfileSave = useCallback(async () => {
    if (!user) return;
    setProfileSaving(true);
    setProfileFeedback(null);
    try {
      await user.update({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null
      });
      setProfileFeedback({ type: "ok", text: t("profileSaved") });
    } catch (error) {
      setProfileFeedback({
        type: "err",
        text: error instanceof Error ? error.message : t("profileSaveFailed")
      });
    } finally {
      setProfileSaving(false);
    }
  }, [firstName, lastName, t, user]);

  const handleAvatarChange = useCallback(
    async (file: File) => {
      if (!user) return;
      setAvatarSaving(true);
      setAvatarFeedback(null);
      const localPreviewUrl = URL.createObjectURL(file);
      setAvatarPreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return localPreviewUrl;
      });

      try {
        await user.setProfileImage({ file });
        await user.reload();
        setAvatarFeedback({ type: "ok", text: t("avatarSaved") });
        setAvatarPreviewUrl((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          return null;
        });
      } catch (error) {
        setAvatarFeedback({
          type: "err",
          text: error instanceof Error ? error.message : t("avatarSaveFailed")
        });
      } finally {
        setAvatarSaving(false);
      }
    },
    [t, user]
  );

  const handlePasswordSave = useCallback(async () => {
    if (!user) return;
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: "err", text: t("passwordMismatch") });
      return;
    }

    setPasswordSaving(true);
    setPasswordFeedback(null);
    try {
      await user.updatePassword({
        currentPassword,
        newPassword
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFeedback({ type: "ok", text: t("passwordSaved") });
    } catch (error) {
      setPasswordFeedback({
        type: "err",
        text: error instanceof Error ? error.message : t("passwordSaveFailed")
      });
    } finally {
      setPasswordSaving(false);
    }
  }, [confirmPassword, currentPassword, newPassword, t, user]);
  const isUsingClerkAvatar = avatarPreviewUrl === null && user?.hasImage === true;
  const profileImage = avatarPreviewUrl ?? (isUsingClerkAvatar ? clerkAvatar.imageSrc : null);
  const profileImageBroken = isUsingClerkAvatar ? clerkAvatar.broken : previewBroken;

  useEffect(() => {
    setPreviewBroken(false);
  }, [avatarPreviewUrl]);

  if (!user) return null;

  const displayName = user.fullName ?? user.username ?? t("unnamedUser");
  const initials = (
    user.firstName?.[0] ??
    user.username?.[0] ??
    t("unnamedUser").charAt(0)
  ).toUpperCase();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <button
        type="button"
        onClick={() => router.push("/app" as Route)}
        className="mb-6 flex cursor-pointer items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToChat")}
      </button>

      <h1 className="text-2xl font-bold text-text">{t("account")}</h1>
      <p className="mt-1 text-sm text-text-muted">{t("manageProfile")}</p>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative w-24 shrink-0 self-start">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-surface-raised text-2xl font-bold text-accent shadow-sm">
                {profileImage && !profileImageBroken ? (
                  <img
                    src={profileImage}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => {
                      if (isUsingClerkAvatar) {
                        clerkAvatar.onError();
                      } else {
                        setPreviewBroken(true);
                      }
                    }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  initials
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarSaving}
                className="absolute -bottom-2 -right-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-sm transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-60"
                title={t("changeAvatar")}
              >
                {avatarSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void handleAvatarChange(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-text">{displayName}</p>
              <p className="mt-1 truncate text-sm text-text-muted">
                {user.primaryEmailAddress?.emailAddress}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-text-subtle">{t("avatarHelp")}</p>
              <FeedbackLine feedback={avatarFeedback} />
            </div>
          </div>
        </div>

        <Section icon={<Mail className="h-4 w-4" />} title={t("email")}>
          {user.emailAddresses.map((email) => (
            <div key={email.id} className="flex items-center gap-2">
              <span className="text-sm text-text">{email.emailAddress}</span>
              {email.id === user.primaryEmailAddressId && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  {t("primary")}
                </span>
              )}
            </div>
          ))}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Section icon={<User className="h-4 w-4" />} title={t("profileDetails")}>
          <p className="mb-4 text-sm text-text-muted">{t("profileDetailsHelp")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{t("firstName")}</span>
              <input
                type="text"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{t("lastName")}</span>
              <input
                type="text"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void handleProfileSave()}
            disabled={profileSaving}
            className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
          >
            {profileSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("saveProfile")}
          </button>
          <FeedbackLine feedback={profileFeedback} />
        </Section>

        <Section icon={<KeyRound className="h-4 w-4" />} title={t("passwordTitle")}>
          <p className="mb-4 text-sm text-text-muted">{t("passwordHelp")}</p>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{t("currentPassword")}</span>
              <PasswordField
                value={currentPassword}
                onChange={setCurrentPassword}
                className="px-3 py-2.5"
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{t("newPassword")}</span>
              <PasswordField
                value={newPassword}
                onChange={setNewPassword}
                className="px-3 py-2.5"
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{t("confirmPassword")}</span>
              <PasswordField
                value={confirmPassword}
                onChange={setConfirmPassword}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handlePasswordSave();
                  }
                }}
                className="px-3 py-2.5"
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-text-subtle">{t("passwordHint")}</p>
          <button
            type="button"
            onClick={() => void handlePasswordSave()}
            disabled={
              passwordSaving ||
              !currentPassword.trim() ||
              !newPassword.trim() ||
              !confirmPassword.trim()
            }
            className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-60"
          >
            {passwordSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {t("savePassword")}
          </button>
          <FeedbackLine feedback={passwordFeedback} />
        </Section>
      </div>

      {user.externalAccounts.length > 0 && (
        <div className="mt-4">
          <Section icon={<Shield className="h-4 w-4" />} title={t("connectedAccounts")}>
            {user.externalAccounts.map((account) => (
              <div key={account.id} className="flex items-center gap-2">
                <span className="text-sm capitalize text-text">{account.provider}</span>
                <span className="text-xs text-text-muted">{account.emailAddress}</span>
              </div>
            ))}
          </Section>
        </div>
      )}

      <button
        type="button"
        onClick={() => void signOut({ redirectUrl: "/" })}
        className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        <LogOut className="h-4 w-4" />
        {t("signOut")}
      </button>
    </div>
  );
}

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-text-muted">{icon}</span>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FeedbackLine({ feedback }: { feedback: { type: "ok" | "err"; text: string } | null }) {
  if (!feedback) return null;
  return (
    <p className={cn("mt-3 text-sm", feedback.type === "ok" ? "text-success" : "text-destructive")}>
      {feedback.text}
    </p>
  );
}
