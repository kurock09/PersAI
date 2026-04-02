"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut, Mail, Shield, User } from "lucide-react";

export default function ProfilePage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  if (!user) return null;

  const initials = (user.firstName?.[0] ?? user.username?.[0] ?? "U").toUpperCase();

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.push("/app")}
        className="mb-6 flex cursor-pointer items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to chat
      </button>

      <h1 className="text-2xl font-bold text-text">Account</h1>
      <p className="mt-1 text-sm text-text-muted">Manage your profile</p>

      {/* Profile card */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent/20 text-lg font-bold text-accent overflow-hidden">
            {user.imageUrl ? (
              <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-text">
              {user.fullName ?? user.username ?? "User"}
            </p>
            <p className="truncate text-sm text-text-muted">
              {user.primaryEmailAddress?.emailAddress}
            </p>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="mt-4 space-y-3">
        {/* Email */}
        <Section
          icon={<Mail className="h-4 w-4" />}
          title="Email addresses"
        >
          {user.emailAddresses.map((email) => (
            <div key={email.id} className="flex items-center gap-2">
              <span className="text-sm text-text">{email.emailAddress}</span>
              {email.id === user.primaryEmailAddressId && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  Primary
                </span>
              )}
            </div>
          ))}
        </Section>

        {/* Connected accounts */}
        {user.externalAccounts.length > 0 && (
          <Section
            icon={<Shield className="h-4 w-4" />}
            title="Connected accounts"
          >
            {user.externalAccounts.map((account) => (
              <div key={account.id} className="flex items-center gap-2">
                <span className="text-sm text-text capitalize">{account.provider}</span>
                <span className="text-xs text-text-muted">{account.emailAddress}</span>
              </div>
            ))}
          </Section>
        )}

        {/* Profile details */}
        <Section
          icon={<User className="h-4 w-4" />}
          title="Profile details"
        >
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-text-muted text-xs">First name</p>
              <p className="text-text">{user.firstName ?? "—"}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Last name</p>
              <p className="text-text">{user.lastName ?? "—"}</p>
            </div>
          </div>
        </Section>
      </div>

      {/* Sign out */}
      <button
        type="button"
        onClick={() => void signOut({ redirectUrl: "/" })}
        className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        <LogOut className="h-4 w-4" />
        Sign out
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
