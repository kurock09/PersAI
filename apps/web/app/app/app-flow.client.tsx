"use client";

import { SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CurrentMeResponse, OnboardingPayload, getMe, postOnboarding } from "./me-api-client";

type FlowState =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "ready"; data: CurrentMeResponse };

function toInitialPayload(state: CurrentMeResponse | null): OnboardingPayload {
  return {
    displayName: state?.me.appUser.displayName ?? "",
    workspaceName: state?.me.workspace?.name ?? "",
    locale: state?.me.workspace?.locale ?? "en-US",
    timezone: state?.me.workspace?.timezone ?? "UTC"
  };
}

export function AppFlowClient() {
  const { getToken } = useAuth();
  const [flowState, setFlowState] = useState<FlowState>({ type: "loading" });
  const [onboardingPayload, setOnboardingPayload] = useState<OnboardingPayload>(
    toInitialPayload(null)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadMe = useCallback(async () => {
    setFlowState({ type: "loading" });

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      const me = await getMe(token);
      setFlowState({ type: "ready", data: me });
      setOnboardingPayload(toInitialPayload(me));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load current user state.";
      setFlowState({ type: "error", message });
    }
  }, [getToken]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const onboardingRequired = useMemo(() => {
    return flowState.type === "ready" && flowState.data.me.onboarding.status === "pending";
  }, [flowState]);

  async function onSubmitOnboarding(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsSubmitting(true);
      const updated = await postOnboarding(token, onboardingPayload);
      setFlowState({ type: "ready", data: updated });
      setOnboardingPayload(toInitialPayload(updated));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Onboarding submission failed.";
      setFlowState({ type: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (flowState.type === "loading") {
    return (
      <main>
        <h1>App</h1>
        <p>Loading account state...</p>
      </main>
    );
  }

  if (flowState.type === "error") {
    return (
      <main>
        <h1>App</h1>
        <p>Unable to load state: {flowState.message}</p>
        <button type="button" onClick={() => void loadMe()}>
          Retry
        </button>
      </main>
    );
  }

  const { me } = flowState.data;

  if (onboardingRequired) {
    return (
      <main>
        <h1>Onboarding required</h1>
        <p>Complete these fields to create or update your workspace baseline.</p>
        <form onSubmit={(event) => void onSubmitOnboarding(event)}>
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            value={onboardingPayload.displayName}
            onChange={(event) =>
              setOnboardingPayload((current) => ({ ...current, displayName: event.target.value }))
            }
            required
          />

          <label htmlFor="workspaceName">Workspace name</label>
          <input
            id="workspaceName"
            value={onboardingPayload.workspaceName}
            onChange={(event) =>
              setOnboardingPayload((current) => ({ ...current, workspaceName: event.target.value }))
            }
            required
          />

          <label htmlFor="locale">Locale</label>
          <input
            id="locale"
            value={onboardingPayload.locale}
            onChange={(event) =>
              setOnboardingPayload((current) => ({ ...current, locale: event.target.value }))
            }
            required
          />

          <label htmlFor="timezone">Timezone</label>
          <input
            id="timezone"
            value={onboardingPayload.timezone}
            onChange={(event) =>
              setOnboardingPayload((current) => ({ ...current, timezone: event.target.value }))
            }
            required
          />

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Complete onboarding"}
          </button>
        </form>
      </main>
    );
  }

  if (me.workspace === null) {
    return (
      <main>
        <h1>App</h1>
        <p>No active workspace summary is available yet.</p>
        <button type="button" onClick={() => void loadMe()}>
          Refresh
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Me</h1>
      <p>Authenticated app user and workspace baseline.</p>
      <p>
        <strong>User:</strong> {me.appUser.email}
      </p>
      <p>
        <strong>Display name:</strong> {me.appUser.displayName ?? "not set"}
      </p>
      <p>
        <strong>Onboarding:</strong> {me.onboarding.status}
      </p>
      <p>
        <strong>Workspace:</strong> {me.workspace.name} ({me.workspace.locale},{" "}
        {me.workspace.timezone})
      </p>
      <p>
        <strong>Workspace role:</strong> {me.workspace.role}
      </p>
      <UserButton />
      <SignOutButton>
        <button type="button">Sign out</button>
      </SignOutButton>
    </main>
  );
}
