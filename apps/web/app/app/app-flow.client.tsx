"use client";

import { SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type AssistantLifecycleState } from "@persai/contracts";
import { getAssistant, postAssistantCreate } from "./assistant-api-client";
import { CurrentMeResponse, OnboardingPayload, getMe, postOnboarding } from "./me-api-client";

type FlowState =
  | { type: "loading" }
  | { type: "error"; message: string }
  | {
      type: "ready";
      data: {
        meState: CurrentMeResponse;
        assistantState: AssistantLifecycleState | null;
      };
    };

const EDITOR_SECTIONS = [
  "Persona",
  "Memory",
  "Tools & Integrations",
  "Channels",
  "Limits & Safety Summary",
  "Publish History"
] as const;

function toInitialPayload(state: CurrentMeResponse | null): OnboardingPayload {
  return {
    displayName: state?.me.appUser.displayName ?? "",
    workspaceName: state?.me.workspace?.name ?? "",
    locale: state?.me.workspace?.locale ?? "en-US",
    timezone: state?.me.workspace?.timezone ?? "UTC"
  };
}

function hasDraftChanges(assistantState: AssistantLifecycleState): boolean {
  if (assistantState.latestPublishedVersion === null) {
    return assistantState.draft.displayName !== null || assistantState.draft.instructions !== null;
  }

  return (
    assistantState.draft.displayName !== assistantState.latestPublishedVersion.snapshot.displayName ||
    assistantState.draft.instructions !== assistantState.latestPublishedVersion.snapshot.instructions
  );
}

export function AppFlowClient() {
  const { getToken } = useAuth();
  const [flowState, setFlowState] = useState<FlowState>({ type: "loading" });
  const [onboardingPayload, setOnboardingPayload] = useState<OnboardingPayload>(
    toInitialPayload(null)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingAssistant, setIsCreatingAssistant] = useState(false);

  const loadAssistantState = useCallback(
    async (token: string, meState: CurrentMeResponse): Promise<AssistantLifecycleState | null> => {
      if (meState.me.onboarding.status === "pending") {
        return null;
      }

      if (meState.me.workspace === null) {
        return null;
      }

      return getAssistant(token);
    },
    []
  );

  const loadMe = useCallback(async () => {
    setFlowState({ type: "loading" });

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      const meState = await getMe(token);
      const assistantState = await loadAssistantState(token, meState);

      setFlowState({
        type: "ready",
        data: {
          meState,
          assistantState
        }
      });
      setOnboardingPayload(toInitialPayload(meState));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load current user state.";
      setFlowState({ type: "error", message });
    }
  }, [getToken, loadAssistantState]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const onboardingRequired = useMemo(() => {
    return flowState.type === "ready" && flowState.data.meState.me.onboarding.status === "pending";
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
      const meState = await postOnboarding(token, onboardingPayload);
      const assistantState = await loadAssistantState(token, meState);

      setFlowState({
        type: "ready",
        data: {
          meState,
          assistantState
        }
      });
      setOnboardingPayload(toInitialPayload(meState));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Onboarding submission failed.";
      setFlowState({ type: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onCreateAssistant(): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    if (flowState.type !== "ready") {
      return;
    }

    try {
      setIsCreatingAssistant(true);
      const assistantState = await postAssistantCreate(token);
      setFlowState({
        type: "ready",
        data: {
          meState: flowState.data.meState,
          assistantState
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant creation failed.";
      setFlowState({ type: "error", message });
    } finally {
      setIsCreatingAssistant(false);
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

  const { meState, assistantState } = flowState.data;
  const { me } = meState;
  const draftHasChanges = assistantState !== null ? hasDraftChanges(assistantState) : false;

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
              setOnboardingPayload({
                ...onboardingPayload,
                displayName: event.target.value
              })
            }
            required
          />

          <label htmlFor="workspaceName">Workspace name</label>
          <input
            id="workspaceName"
            value={onboardingPayload.workspaceName}
            onChange={(event) =>
              setOnboardingPayload({
                ...onboardingPayload,
                workspaceName: event.target.value
              })
            }
            required
          />

          <label htmlFor="locale">Locale</label>
          <input
            id="locale"
            value={onboardingPayload.locale}
            onChange={(event) =>
              setOnboardingPayload({
                ...onboardingPayload,
                locale: event.target.value
              })
            }
            required
          />

          <label htmlFor="timezone">Timezone</label>
          <input
            id="timezone"
            value={onboardingPayload.timezone}
            onChange={(event) =>
              setOnboardingPayload({
                ...onboardingPayload,
                timezone: event.target.value
              })
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
      <h1>Assistant dashboard</h1>
      <p>Minimal control-plane shell for managed assistant lifecycle state.</p>

      <section>
        <h2>Global publish and status bar</h2>
        <p>
          <strong>Onboarding:</strong> {me.onboarding.status}
        </p>
        <p>
          <strong>Assistant entity:</strong>{" "}
          {assistantState === null ? "not created" : "created"}
        </p>
        <p>
          <strong>Draft truth:</strong>{" "}
          {assistantState === null
            ? "unavailable"
            : assistantState.draft.updatedAt === null
              ? "no recorded draft update"
              : `updated at ${assistantState.draft.updatedAt}`}
        </p>
        {assistantState !== null && (
          <p>
            <strong>Draft publish state:</strong>{" "}
            {assistantState.latestPublishedVersion === null
              ? "no published baseline yet"
              : draftHasChanges
                ? "draft has unpublished changes"
                : "draft matches latest published snapshot"}
          </p>
        )}
        <p>
          <strong>Published truth:</strong>{" "}
          {assistantState?.latestPublishedVersion === null || assistantState === null
            ? "no published version"
            : `v${assistantState.latestPublishedVersion.version}`}
        </p>
        <p>
          <strong>Apply truth:</strong>{" "}
          {assistantState === null ? "not_requested" : assistantState.runtimeApply.status}
        </p>
        {assistantState !== null &&
          assistantState.runtimeApply.error !== null &&
          assistantState.runtimeApply.error.message !== null && (
            <p>
              <strong>Apply error:</strong> {assistantState.runtimeApply.error.message}
            </p>
          )}

        <button type="button" onClick={() => void loadMe()}>
          Refresh dashboard
        </button>
        {assistantState === null && (
          <button type="button" disabled={isCreatingAssistant} onClick={() => void onCreateAssistant()}>
            {isCreatingAssistant ? "Creating assistant..." : "Create assistant"}
          </button>
        )}
      </section>

      <section>
        <h2>Assistant summary</h2>
        {assistantState === null ? (
          <p>No assistant exists yet for this account.</p>
        ) : (
          <>
            <p>
              <strong>Assistant ID:</strong> {assistantState.id}
            </p>
            <p>
              <strong>User ID:</strong> {assistantState.userId}
            </p>
            <p>
              <strong>Workspace ID:</strong> {assistantState.workspaceId}
            </p>
            <p>
              <strong>Draft display name:</strong> {assistantState.draft.displayName ?? "not set"}
            </p>
            <p>
              <strong>Draft instructions:</strong>{" "}
              {assistantState.draft.instructions ?? "not set"}
            </p>
            <p>
              <strong>Latest published version ID:</strong>{" "}
              {assistantState.latestPublishedVersion?.id ?? "none"}
            </p>
            <p>
              <strong>Apply target version ID:</strong>{" "}
              {assistantState.runtimeApply.targetPublishedVersionId ?? "none"}
            </p>
            <p>
              <strong>Applied version ID:</strong>{" "}
              {assistantState.runtimeApply.appliedPublishedVersionId ?? "none"}
            </p>
          </>
        )}
      </section>

      {assistantState !== null && (
        <section>
          <h2>Assistant editor</h2>
          <p>Sectioned control surface aligned to draft-based lifecycle behavior.</p>

          <nav aria-label="Assistant editor sections">
            <p>
              <strong>Sections</strong>
            </p>
            <ul>
              {EDITOR_SECTIONS.map((sectionName) => (
                <li key={sectionName}>{sectionName}</li>
              ))}
            </ul>
          </nav>

          <section>
            <h3>Persona</h3>
            <p>Editable draft-facing assistant identity and instruction summary.</p>
            <p>
              <strong>Draft display name:</strong> {assistantState.draft.displayName ?? "not set"}
            </p>
            <p>
              <strong>Draft instructions:</strong> {assistantState.draft.instructions ?? "not set"}
            </p>
          </section>

          <section>
            <h3>Memory</h3>
            <p>Placeholder in B2. Memory controls and policy UX are scheduled for Step 6.</p>
          </section>

          <section>
            <h3>Tools & Integrations</h3>
            <p>Placeholder in B2. Tool catalog and integration governance are not wired yet.</p>
          </section>

          <section>
            <h3>Channels</h3>
            <p>Placeholder in B2. Channel bindings are intentionally deferred beyond this slice.</p>
          </section>

          <section>
            <h3>Limits & Safety Summary</h3>
            <p>Read-only summary placeholder in B2. Full policy/quota controls are not added yet.</p>
            <p>
              <strong>Quota plan code:</strong> {assistantState.governance.quotaPlanCode ?? "not configured"}
            </p>
          </section>

          <section>
            <h3>Publish History</h3>
            <p>Minimal published-version snapshot pointer from control plane.</p>
            <p>
              <strong>Latest published version:</strong>{" "}
              {assistantState.latestPublishedVersion === null
                ? "none"
                : `v${assistantState.latestPublishedVersion.version}`}
            </p>
            <p>
              <strong>Published at:</strong>{" "}
              {assistantState.latestPublishedVersion?.publishedAt ?? "n/a"}
            </p>
          </section>
        </section>
      )}

      <section>
        <h2>Account context</h2>
        <p>
          <strong>User:</strong> {me.appUser.email}
        </p>
        <p>
          <strong>Display name:</strong> {me.appUser.displayName ?? "not set"}
        </p>
        <p>
          <strong>Workspace:</strong> {me.workspace.name} ({me.workspace.locale}, {me.workspace.timezone}
          )
        </p>
        <p>
          <strong>Workspace role:</strong> {me.workspace.role}
        </p>
      </section>

      <UserButton />
      <SignOutButton>
        <button type="button">Sign out</button>
      </SignOutButton>
    </main>
  );
}
