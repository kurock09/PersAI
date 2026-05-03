"use client";

import { useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import {
  getSafeRedirectPathFromSearch,
  navigateAfterClerkAuth,
  withSafeRedirectParam
} from "@/app/lib/clerk-navigation";

export default function SSOCallbackPage() {
  const t = useTranslations("auth");
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const router = useRouter();
  const hasRun = useRef(false);

  useEffect(() => {
    void (async () => {
      if (!clerk.loaded || hasRun.current) return;
      hasRun.current = true;

      const navigateTo = async (path: Route) => {
        router.push(path);
      };
      const signInHref = withSafeRedirectParam("/sign-in", window.location.search);
      const redirectTarget = getSafeRedirectPathFromSearch(window.location.search);

      const finalizeSignIn = async () => {
        await signIn.finalize({
          navigate: async ({ decorateUrl }) => {
            navigateAfterClerkAuth(decorateUrl(redirectTarget ?? "/app"));
          }
        });
      };

      const finalizeSignUp = async () => {
        await signUp.finalize({
          navigate: async ({ decorateUrl }) => {
            navigateAfterClerkAuth(decorateUrl(redirectTarget ?? "/app/setup"));
          }
        });
      };

      if (signIn.status === "complete") {
        await finalizeSignIn();
        return;
      }

      if (signUp.isTransferable) {
        await signIn.create({ transfer: true });
        if ((signIn.status as string) === "complete") {
          await finalizeSignIn();
          return;
        }
        return navigateTo(signInHref as Route);
      }

      if (signIn.isTransferable) {
        await signUp.create({ transfer: true });
        if (signUp.status === "complete") {
          await finalizeSignUp();
          return;
        }
        return navigateTo(signInHref as Route);
      }

      if (signUp.status === "complete") {
        await finalizeSignUp();
        return;
      }

      if (signIn.existingSession || signUp.existingSession) {
        const sessionId = signIn.existingSession?.sessionId || signUp.existingSession?.sessionId;
        if (sessionId) {
          await clerk.setActive({
            session: sessionId,
            navigate: async ({ decorateUrl }) => {
              navigateAfterClerkAuth(decorateUrl(redirectTarget ?? "/app"));
            }
          });
          return;
        }
      }

      return navigateTo(signInHref as Route);
    })();
  }, [clerk, signIn, signUp, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="text-sm text-text-muted">{t("signingIn")}</p>
      </div>
    </div>
  );
}
