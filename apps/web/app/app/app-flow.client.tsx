"use client";

import { SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type AssistantLifecycleState, type AssistantWebChatListItemState } from "@persai/contracts";
import {
  deleteAssistantWebChat,
  getAssistant,
  getAssistantWebChats,
  patchAssistantDraft,
  patchAssistantWebChat,
  postAssistantCreate,
  postAssistantPublish,
  postAssistantReset,
  postAssistantRollback,
  postAssistantWebChatArchive,
  streamAssistantWebChatTurn,
  toWebChatUxIssue,
  type WebChatUxIssue
} from "./assistant-api-client";
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

type SetupMode = "quick_start" | "advanced_setup";

type QuickStartPayload = {
  displayName: string;
  primaryGoal: string;
};

type AdvancedSetupPayload = {
  displayName: string;
  instructions: string;
};

type PublishStateLabel = "Draft has changes" | "Publishing" | "Published" | "Draft only";
type ApplyStateLabel = "Applying" | "Live" | "Failed" | "Not requested";
type UpdateMarkerTone = "info" | "attention";

type UpdateMarker = {
  id: string;
  tone: UpdateMarkerTone;
  message: string;
};

type StreamingChatMessageRole = "user" | "assistant" | "system";

type StreamingChatMessage = {
  id: string;
  role: StreamingChatMessageRole;
  content: string;
  status: "committed" | "streaming" | "partial";
};

function toInitialPayload(state: CurrentMeResponse | null): OnboardingPayload {
  return {
    displayName: state?.me.appUser.displayName ?? "",
    workspaceName: state?.me.workspace?.name ?? "",
    locale: state?.me.workspace?.locale ?? "en-US",
    timezone: state?.me.workspace?.timezone ?? "UTC"
  };
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildQuickStartInstructions(primaryGoal: string): string {
  const goal = primaryGoal.trim();
  return [
    "Act as a personal assistant for the current user.",
    goal.length > 0 ? `Primary goal: ${goal}.` : "Primary goal: general practical support.",
    "Use concise, actionable responses and maintain continuity with prior draft context."
  ].join(" ");
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

function toPublishStateLabel(
  assistantState: AssistantLifecycleState,
  draftHasChanges: boolean,
  isPublishing: boolean
): PublishStateLabel {
  if (isPublishing) {
    return "Publishing";
  }

  if (draftHasChanges) {
    return "Draft has changes";
  }

  if (assistantState.latestPublishedVersion !== null) {
    return "Published";
  }

  return "Draft only";
}

function toApplyStateLabel(assistantState: AssistantLifecycleState): ApplyStateLabel {
  switch (assistantState.runtimeApply.status) {
    case "pending":
    case "in_progress":
      return "Applying";
    case "succeeded":
      return "Live";
    case "failed":
    case "degraded":
      return "Failed";
    case "not_requested":
    default:
      return "Not requested";
  }
}

function buildUpdateMarkers(
  assistantState: AssistantLifecycleState,
  draftHasChanges: boolean
): UpdateMarker[] {
  const markers: UpdateMarker[] = [];

  if (assistantState.runtimeApply.status === "failed" || assistantState.runtimeApply.status === "degraded") {
    markers.push({
      id: "apply-needs-attention",
      tone: "attention",
      message: "Latest apply needs attention. Consider rollback if a previous version was stable."
    });
  }

  if (assistantState.materialization.sourceAction === "rollback") {
    markers.push({
      id: "recent-rollback",
      tone: "attention",
      message: "Recent recovery event: rollback created a new latest published baseline."
    });
  }

  if (assistantState.materialization.sourceAction === "reset") {
    markers.push({
      id: "recent-reset",
      tone: "attention",
      message: "Recent recovery event: reset created a new blank assistant baseline."
    });
  }

  if (
    assistantState.governance.platformManagedUpdatedAt !== null &&
    assistantState.runtimeApply.status !== "failed" &&
    assistantState.runtimeApply.status !== "degraded"
  ) {
    markers.push({
      id: "soft-platform-update",
      tone: "info",
      message:
        "A soft platform update was applied in the background. Your draft ownership remains unchanged."
    });
  }

  if (
    assistantState.runtimeApply.status === "succeeded" &&
    assistantState.runtimeApply.finishedAt !== null &&
    !draftHasChanges
  ) {
    markers.push({
      id: "assistant-live",
      tone: "info",
      message: "Assistant is live after the latest apply."
    });
  }

  return markers.slice(0, 3);
}

export function AppFlowClient() {
  const { getToken } = useAuth();
  const [flowState, setFlowState] = useState<FlowState>({ type: "loading" });
  const [onboardingPayload, setOnboardingPayload] = useState<OnboardingPayload>(
    toInitialPayload(null)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingAssistant, setIsCreatingAssistant] = useState(false);
  const [isApplyingSetup, setIsApplyingSetup] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>("quick_start");
  const [setupFeedback, setSetupFeedback] = useState<string | null>(null);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  const [rollbackFeedback, setRollbackFeedback] = useState<string | null>(null);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [rollbackTargetVersion, setRollbackTargetVersion] = useState<string>("1");
  const [resetConfirmChecked, setResetConfirmChecked] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [quickStartPayload, setQuickStartPayload] = useState<QuickStartPayload>({
    displayName: "",
    primaryGoal: ""
  });
  const [advancedSetupPayload, setAdvancedSetupPayload] = useState<AdvancedSetupPayload>({
    displayName: "",
    instructions: ""
  });
  const [chatThreadKey, setChatThreadKey] = useState("web-main");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<StreamingChatMessage[]>([]);
  const [chatList, setChatList] = useState<AssistantWebChatListItemState[]>([]);
  const [isLoadingChatList, setIsLoadingChatList] = useState(false);
  const [chatListFeedback, setChatListFeedback] = useState<string | null>(null);
  const [chatRenameDraftById, setChatRenameDraftById] = useState<Record<string, string>>({});
  const [deleteConfirmById, setDeleteConfirmById] = useState<Record<string, string>>({});
  const [streamingIssue, setStreamingIssue] = useState<WebChatUxIssue | null>(null);
  const [streamingMeta, setStreamingMeta] = useState<string | null>(null);
  const [isStreamingChat, setIsStreamingChat] = useState(false);
  const [activeAssistantStreamMessageId, setActiveAssistantStreamMessageId] = useState<string | null>(
    null
  );
  const [chatAbortController, setChatAbortController] = useState<AbortController | null>(null);
  const reachedActiveChatCap = streamingIssue?.classId === "active_chat_cap";

  const loadWebChatList = useCallback(async () => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setChatList([]);
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsLoadingChatList(true);
      const chats = await getAssistantWebChats(token);
      setChatList(chats);
      setChatListFeedback(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load web chat list.";
      setChatListFeedback(message);
    } finally {
      setIsLoadingChatList(false);
    }
  }, [flowState, getToken]);

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

  useEffect(() => {
    if (flowState.type !== "ready") {
      return;
    }

    const draft = flowState.data.assistantState?.draft;
    setQuickStartPayload({
      displayName: draft?.displayName ?? "",
      primaryGoal: ""
    });
    setAdvancedSetupPayload({
      displayName: draft?.displayName ?? "",
      instructions: draft?.instructions ?? ""
    });

    const latestVersion = flowState.data.assistantState?.latestPublishedVersion?.version ?? 1;
    setRollbackTargetVersion(String(Math.max(1, latestVersion - 1)));
    setResetConfirmChecked(false);
    setResetConfirmText("");
  }, [flowState]);

  useEffect(() => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setChatList([]);
      return;
    }

    void loadWebChatList();
  }, [flowState, loadWebChatList]);

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

  async function upsertAssistantDraft(
    updater: (currentAssistant: AssistantLifecycleState | null) => {
      displayName?: string | null;
      instructions?: string | null;
    }
  ): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    if (flowState.type !== "ready") {
      return;
    }

    try {
      setIsApplyingSetup(true);
      setSetupFeedback(null);
      setPublishFeedback(null);
      setRollbackFeedback(null);
      setResetFeedback(null);

      const existingAssistant = flowState.data.assistantState;
      const assistantForUpdate =
        existingAssistant ?? (await postAssistantCreate(token));

      const updatedAssistant = await patchAssistantDraft(token, updater(assistantForUpdate));

      setFlowState({
        type: "ready",
        data: {
          meState: flowState.data.meState,
          assistantState: updatedAssistant
        }
      });
      setSetupFeedback("Draft setup saved. No publish has been performed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant setup update failed.";
      setSetupFeedback(message);
    } finally {
      setIsApplyingSetup(false);
    }
  }

  async function onSubmitQuickStart(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    await upsertAssistantDraft(() => {
      return {
        displayName: toNullable(quickStartPayload.displayName),
        instructions: buildQuickStartInstructions(quickStartPayload.primaryGoal)
      };
    });
  }

  async function onSubmitAdvancedSetup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    await upsertAssistantDraft(() => {
      return {
        displayName: toNullable(advancedSetupPayload.displayName),
        instructions: toNullable(advancedSetupPayload.instructions)
      };
    });
  }

  async function onPublishDraft(): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      return;
    }

    try {
      setIsPublishing(true);
      setPublishFeedback(null);
      setRollbackFeedback(null);
      setResetFeedback(null);
      const updatedAssistant = await postAssistantPublish(token);

      setFlowState({
        type: "ready",
        data: {
          meState: flowState.data.meState,
          assistantState: updatedAssistant
        }
      });
      setPublishFeedback("Publish requested. Apply state is tracked separately.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publish request failed.";
      setPublishFeedback(message);
    } finally {
      setIsPublishing(false);
    }
  }

  async function onRollbackToVersion(): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      return;
    }

    const parsedTargetVersion = Number.parseInt(rollbackTargetVersion, 10);
    if (!Number.isFinite(parsedTargetVersion) || parsedTargetVersion < 1) {
      setRollbackFeedback("Rollback target version must be a number greater than or equal to 1.");
      return;
    }

    try {
      setIsRollingBack(true);
      setRollbackFeedback(null);
      setResetFeedback(null);
      const updatedAssistant = await postAssistantRollback(token, {
        targetVersion: parsedTargetVersion
      });

      setFlowState({
        type: "ready",
        data: {
          meState: flowState.data.meState,
          assistantState: updatedAssistant
        }
      });
      setRollbackFeedback("Rollback requested. A new published version was created from the selected target.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rollback request failed.";
      setRollbackFeedback(message);
    } finally {
      setIsRollingBack(false);
    }
  }

  async function onResetAssistant(): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      return;
    }

    if (!resetConfirmChecked || resetConfirmText.trim() !== "RESET") {
      setResetFeedback("Confirm reset by checking the box and typing RESET.");
      return;
    }

    try {
      setIsResetting(true);
      setResetFeedback(null);
      setRollbackFeedback(null);
      const updatedAssistant = await postAssistantReset(token);

      setFlowState({
        type: "ready",
        data: {
          meState: flowState.data.meState,
          assistantState: updatedAssistant
        }
      });
      setResetFeedback(
        "Reset requested. Draft and published content were reset; account and ownership were preserved."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reset request failed.";
      setResetFeedback(message);
    } finally {
      setIsResetting(false);
    }
  }

  function stopStreamingChat(): void {
    if (chatAbortController !== null) {
      chatAbortController.abort();
    }
  }

  async function onSendStreamingChatMessage(): Promise<void> {
    if (flowState.type !== "ready" || flowState.data.assistantState === null || isStreamingChat) {
      return;
    }

    const trimmedMessage = chatInput.trim();
    const trimmedThreadKey = chatThreadKey.trim();
    if (trimmedMessage.length === 0) {
      setStreamingIssue(toWebChatUxIssue("message must be a non-empty string"));
      return;
    }
    if (trimmedThreadKey.length === 0) {
      setStreamingIssue(toWebChatUxIssue("surfaceThreadKey must be a non-empty string"));
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    const userMessageId = `local-user-${Date.now()}`;
    const assistantMessageId = `local-assistant-${Date.now()}`;
    const controller = new AbortController();
    setChatAbortController(controller);
    setIsStreamingChat(true);
    setStreamingIssue(null);
    setStreamingMeta("Streaming reply...");
    setActiveAssistantStreamMessageId(assistantMessageId);
    setChatInput("");
    setChatMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: "user",
        content: trimmedMessage,
        status: "committed"
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        status: "streaming"
      }
    ]);

    try {
      await streamAssistantWebChatTurn(
        token,
        {
          surfaceThreadKey: trimmedThreadKey,
          message: trimmedMessage
        },
        {
          onDelta: ({ delta }) => {
            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: `${message.content}${delta}`,
                      status: "streaming"
                    }
                  : message
              )
            );
          },
          onRuntimeDone: ({ respondedAt }) => {
            setStreamingMeta(`Runtime completed at ${respondedAt}. Finalizing records...`);
          },
          onCompleted: () => {
            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      status: "committed"
                    }
                  : message
              )
            );
            setStreamingMeta("Streaming completed and response persisted.");
            void loadWebChatList();
          },
          onInterrupted: () => {
            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      status: message.content.trim().length > 0 ? "partial" : "streaming"
                    }
                  : message
              )
            );
            setStreamingMeta("Streaming interrupted. Partial output was preserved if any text arrived.");
            void loadWebChatList();
          },
          onFailed: ({ message }) => {
            setChatMessages((current) =>
              current.map((entry) =>
                entry.id === assistantMessageId
                  ? {
                      ...entry,
                      status: entry.content.trim().length > 0 ? "partial" : "streaming"
                    }
                  : entry
              )
            );
            setStreamingIssue(toWebChatUxIssue(message));
            setStreamingMeta("Streaming failed. Any partial output shown is preserved as-is.");
            void loadWebChatList();
          }
        },
        controller.signal
      );
    } catch (error) {
      setStreamingIssue(toWebChatUxIssue(error));
      setStreamingMeta("Streaming failed before completion.");
      setChatMessages((current) =>
        current.map((entry) =>
          entry.id === assistantMessageId
            ? {
                ...entry,
                status: entry.content.trim().length > 0 ? "partial" : "streaming"
              }
            : entry
        )
      );
      void loadWebChatList();
    } finally {
      setChatAbortController(null);
      setIsStreamingChat(false);
      setActiveAssistantStreamMessageId(null);
    }
  }

  async function onRenameChat(chatId: string): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    const title = (chatRenameDraftById[chatId] ?? "").trim();
    if (title.length === 0) {
      setChatListFeedback("Rename requires a non-empty title.");
      return;
    }

    try {
      const updatedChat = await patchAssistantWebChat(token, chatId, { title });
      setChatList((current) =>
        current.map((item) => (item.chat.id === chatId ? updatedChat : item))
      );
      setChatListFeedback("Chat renamed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rename failed.";
      setChatListFeedback(message);
    }
  }

  async function onArchiveChat(chatId: string): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      const updatedChat = await postAssistantWebChatArchive(token, chatId);
      setChatList((current) =>
        current.map((item) => (item.chat.id === chatId ? updatedChat : item))
      );
      setChatListFeedback("Chat archived (removed from active list, retained in history).");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Archive failed.";
      setChatListFeedback(message);
    }
  }

  async function onHardDeleteChat(chatId: string): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    const confirmText = (deleteConfirmById[chatId] ?? "").trim();
    if (confirmText !== "DELETE") {
      setChatListFeedback("Hard delete requires typing DELETE exactly.");
      return;
    }

    try {
      await deleteAssistantWebChat(token, chatId, { confirmText });
      setChatList((current) => current.filter((item) => item.chat.id !== chatId));
      setDeleteConfirmById((current) => {
        const next = { ...current };
        delete next[chatId];
        return next;
      });
      setChatListFeedback("Chat hard deleted permanently with all message records.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hard delete failed.";
      setChatListFeedback(message);
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
  const publishStateLabel =
    assistantState !== null ? toPublishStateLabel(assistantState, draftHasChanges, isPublishing) : null;
  const applyStateLabel = assistantState !== null ? toApplyStateLabel(assistantState) : null;
  const rollbackAvailable =
    assistantState !== null &&
    assistantState.latestPublishedVersion !== null &&
    assistantState.latestPublishedVersion.version > 1;
  const updateMarkers =
    assistantState !== null ? buildUpdateMarkers(assistantState, draftHasChanges) : [];

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
        {assistantState !== null && (
          <>
            <p>
              <strong>Publish state:</strong> {publishStateLabel}
            </p>
            <p>
              <strong>Apply state:</strong> {applyStateLabel}
            </p>
            <p>
              <strong>Rollback available:</strong> {rollbackAvailable ? "yes" : "no"}
            </p>
          </>
        )}

        <button type="button" onClick={() => void loadMe()}>
          Refresh dashboard
        </button>
        {assistantState === null && (
          <button type="button" disabled={isCreatingAssistant} onClick={() => void onCreateAssistant()}>
            {isCreatingAssistant ? "Creating assistant..." : "Create assistant"}
          </button>
        )}
        {assistantState !== null && (
          <button type="button" disabled={isPublishing} onClick={() => void onPublishDraft()}>
            {isPublishing ? "Publishing..." : "Publish draft"}
          </button>
        )}
        {publishFeedback !== null && <p>{publishFeedback}</p>}
      </section>

      {assistantState !== null && (
        <section>
          <h2>Assistant activity and updates</h2>
          <p>Lightweight lifecycle signals. No internal runtime traces are shown here.</p>
          {updateMarkers.length === 0 ? (
            <p>No visible assistant updates right now.</p>
          ) : (
            <ul>
              {updateMarkers.map((marker) => (
                <li key={marker.id}>
                  <strong>{marker.tone === "attention" ? "Attention" : "Update"}:</strong>{" "}
                  {marker.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {assistantState !== null && (
        <section>
          <h2>Web chats</h2>
          <p>GPT-style chat list with rename, archive, and explicit hard delete actions.</p>
          {isLoadingChatList && <p>Loading chat list...</p>}
          {chatListFeedback !== null && <p>{chatListFeedback}</p>}
          <button type="button" onClick={() => void loadWebChatList()} disabled={isLoadingChatList}>
            Refresh chat list
          </button>
          {chatList.length === 0 ? (
            <p>No chat records yet.</p>
          ) : (
            <ul>
              {chatList.map((item) => {
                const chat = item.chat;
                const renameDraft = chatRenameDraftById[chat.id] ?? chat.title ?? "";
                return (
                  <li key={chat.id}>
                    <p>
                      <strong>{chat.title ?? "Untitled chat"}</strong>{" "}
                      {chat.archivedAt !== null ? "(archived)" : "(active)"}
                    </p>
                    <p>
                      <strong>Thread:</strong> {chat.surfaceThreadKey}
                    </p>
                    <p>
                      <strong>Messages:</strong> {item.messageCount}
                    </p>
                    <p>
                      <strong>Last update:</strong> {chat.lastMessageAt ?? "n/a"}
                    </p>
                    <p>
                      <strong>Preview:</strong> {item.lastMessagePreview ?? "n/a"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setChatThreadKey(chat.surfaceThreadKey)}
                      disabled={isStreamingChat}
                    >
                      Open thread in stream composer
                    </button>
                    <div>
                      <input
                        aria-label={`Rename chat ${chat.id}`}
                        value={renameDraft}
                        onChange={(event) =>
                          setChatRenameDraftById((current) => ({
                            ...current,
                            [chat.id]: event.target.value
                          }))
                        }
                      />
                      <button type="button" onClick={() => void onRenameChat(chat.id)}>
                        Rename
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onArchiveChat(chat.id)}
                      disabled={chat.archivedAt !== null}
                    >
                      {chat.archivedAt === null ? "Archive" : "Already archived"}
                    </button>
                    <div>
                      <p>
                        <strong>Hard delete:</strong> permanently removes this chat and all its
                        messages.
                      </p>
                      <input
                        aria-label={`Delete confirmation for chat ${chat.id}`}
                        value={deleteConfirmById[chat.id] ?? ""}
                        onChange={(event) =>
                          setDeleteConfirmById((current) => ({
                            ...current,
                            [chat.id]: event.target.value
                          }))
                        }
                        placeholder='Type "DELETE" to confirm'
                      />
                      <button type="button" onClick={() => void onHardDeleteChat(chat.id)}>
                        Hard delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {assistantState !== null && (
        <section>
          <h2>Web chat stream</h2>
          <p>Streaming-first transport path for web chat. Request/response is not the default path.</p>
          <p>
            <strong>Thread key:</strong>
          </p>
          <input
            aria-label="Web chat thread key"
            value={chatThreadKey}
            onChange={(event) => setChatThreadKey(event.target.value)}
            disabled={isStreamingChat}
          />
          <p>
            <strong>Message</strong>
          </p>
          <textarea
            aria-label="Web chat message input"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            disabled={isStreamingChat}
          />
          <div>
            <button type="button" disabled={isStreamingChat} onClick={() => void onSendStreamingChatMessage()}>
              {isStreamingChat ? "Streaming..." : "Send message (stream)"}
            </button>
            <button type="button" disabled={!isStreamingChat} onClick={stopStreamingChat}>
              Stop streaming
            </button>
          </div>
          {streamingMeta !== null && <p>{streamingMeta}</p>}
          {streamingIssue !== null && (
            <p>
              <strong>{streamingIssue.message}</strong> {streamingIssue.guidance}
            </p>
          )}
          {reachedActiveChatCap && (
            <p>
              Active chat limit reached for new threads. Archive an existing active chat from the list
              or continue in an existing thread key.
            </p>
          )}
          {chatMessages.length === 0 ? (
            <p>No chat turns yet.</p>
          ) : (
            <ul>
              {chatMessages.map((message) => (
                <li key={message.id}>
                  <strong>{message.role}</strong>
                  {message.id === activeAssistantStreamMessageId && isStreamingChat
                    ? " (streaming)"
                    : message.status === "partial"
                      ? " (partial)"
                      : ""}
                  : {message.content.length > 0 ? message.content : "..."}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {assistantState !== null && (
        <section>
          <h2>Lifecycle safety controls</h2>
          <p>
            <strong>Rollback</strong> returns assistant content to a selected published version by
            creating a new latest published snapshot.
          </p>
          <p>
            <strong>Reset</strong> clears assistant content to a new blank state while preserving
            account ownership and workspace attachment.
          </p>

          <section>
            <h3>Rollback</h3>
            <p>
              Use rollback when a previous version worked better and you want to recover it as the
              new latest published state.
            </p>
            <label htmlFor="rollbackTargetVersion">Target version</label>
            <input
              id="rollbackTargetVersion"
              type="number"
              min={1}
              value={rollbackTargetVersion}
              onChange={(event) => setRollbackTargetVersion(event.target.value)}
            />
            <button
              type="button"
              disabled={isRollingBack || !rollbackAvailable}
              onClick={() => void onRollbackToVersion()}
            >
              {isRollingBack ? "Rolling back..." : "Rollback to selected version"}
            </button>
            {!rollbackAvailable && (
              <p>Rollback becomes available after at least two published versions exist.</p>
            )}
            {rollbackFeedback !== null && <p>{rollbackFeedback}</p>}
          </section>

          <section>
            <h3>Reset</h3>
            <p>
              Reset does not delete your account. It resets assistant draft/published content and
              creates a new blank published baseline.
            </p>
            <label htmlFor="resetConfirmCheckbox">
              <input
                id="resetConfirmCheckbox"
                type="checkbox"
                checked={resetConfirmChecked}
                onChange={(event) => setResetConfirmChecked(event.target.checked)}
              />
              I understand reset changes assistant content and cannot be undone from this screen.
            </label>
            <label htmlFor="resetConfirmText">Type RESET to confirm</label>
            <input
              id="resetConfirmText"
              value={resetConfirmText}
              onChange={(event) => setResetConfirmText(event.target.value)}
            />
            <button type="button" disabled={isResetting} onClick={() => void onResetAssistant()}>
              {isResetting ? "Resetting..." : "Reset assistant"}
            </button>
            {resetFeedback !== null && <p>{resetFeedback}</p>}
          </section>
        </section>
      )}

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

      <section>
        <h2>Assistant setup paths</h2>
        <p>
          Both paths save draft state only. Publish remains explicit and separate.
        </p>
        <p>
          <strong>Active path:</strong>{" "}
          {setupMode === "quick_start" ? "Quick start" : "Advanced setup"}
        </p>
        <button type="button" onClick={() => setSetupMode("quick_start")}>
          Quick start path
        </button>
        <button type="button" onClick={() => setSetupMode("advanced_setup")}>
          Advanced setup path
        </button>

        {setupMode === "quick_start" ? (
          <form onSubmit={(event) => void onSubmitQuickStart(event)}>
            <h3>Quick start</h3>
            <p>Fast draft bootstrap with a guided baseline profile.</p>
            <label htmlFor="quickStartDisplayName">Assistant display name</label>
            <input
              id="quickStartDisplayName"
              value={quickStartPayload.displayName}
              onChange={(event) =>
                setQuickStartPayload({
                  ...quickStartPayload,
                  displayName: event.target.value
                })
              }
            />
            <label htmlFor="quickStartPrimaryGoal">Primary goal</label>
            <input
              id="quickStartPrimaryGoal"
              value={quickStartPayload.primaryGoal}
              onChange={(event) =>
                setQuickStartPayload({
                  ...quickStartPayload,
                  primaryGoal: event.target.value
                })
              }
              required
            />
            <button type="submit" disabled={isApplyingSetup}>
              {isApplyingSetup ? "Saving draft..." : "Apply quick start to draft"}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void onSubmitAdvancedSetup(event)}>
            <h3>Advanced setup</h3>
            <p>Manual draft setup path for explicit assistant instructions.</p>
            <label htmlFor="advancedDisplayName">Assistant display name</label>
            <input
              id="advancedDisplayName"
              value={advancedSetupPayload.displayName}
              onChange={(event) =>
                setAdvancedSetupPayload({
                  ...advancedSetupPayload,
                  displayName: event.target.value
                })
              }
            />
            <label htmlFor="advancedInstructions">Draft instructions</label>
            <textarea
              id="advancedInstructions"
              value={advancedSetupPayload.instructions}
              onChange={(event) =>
                setAdvancedSetupPayload({
                  ...advancedSetupPayload,
                  instructions: event.target.value
                })
              }
              required
            />
            <button type="submit" disabled={isApplyingSetup}>
              {isApplyingSetup ? "Saving draft..." : "Apply advanced setup to draft"}
            </button>
          </form>
        )}
        {setupFeedback !== null && <p>{setupFeedback}</p>}
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
      <SignOutButton />
    </main>
  );
}
