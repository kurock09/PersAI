"use client";

import { useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

export default function SSOCallbackPage() {
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const router = useRouter();
  const hasRun = useRef(false);

  useEffect(() => {
    void (async () => {
      if (!clerk.loaded || hasRun.current) return;
      hasRun.current = true;

      const navigateTo = async (path: string) => {
        router.push(path);
      };

      const finalizeSignIn = async () => {
        await signIn.finalize({
          navigate: async ({ decorateUrl }) => {
            const url = decorateUrl("/app");
            if (url.startsWith("http")) {
              window.location.href = url;
            } else {
              router.push(url);
            }
          }
        });
      };

      const finalizeSignUp = async () => {
        await signUp.finalize({
          navigate: async ({ decorateUrl }) => {
            const url = decorateUrl("/app");
            if (url.startsWith("http")) {
              window.location.href = url;
            } else {
              router.push(url);
            }
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
        return navigateTo("/sign-in");
      }

      if (signIn.isTransferable) {
        await signUp.create({ transfer: true });
        if (signUp.status === "complete") {
          await finalizeSignUp();
          return;
        }
        return navigateTo("/sign-in");
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
              const url = decorateUrl("/app");
              if (url.startsWith("http")) {
                window.location.href = url;
              } else {
                router.push(url);
              }
            }
          });
          return;
        }
      }

      return navigateTo("/sign-in");
    })();
  }, [clerk, signIn, signUp, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="text-sm text-text-muted">Signing you in...</p>
      </div>
    </div>
  );
}
