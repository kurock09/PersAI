"use client";

import { SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type AssistantLifecycleState,
  type AssistantMemoryRegistryItemState,
  type AssistantTaskRegistryItemState,
  type AssistantWebChatListItemState
} from "@persai/contracts";
import {
  type AdminPlanVisibilityState,
  type AdminPlanCreateRequest,
  type AdminPlanState,
  type AdminPlanUpdateRequest,
  type AssistantTelegramConfigUpdateRequest,
  type TelegramIntegrationState,
  type UserPlanVisibilityState,
  deleteAssistantWebChat,
  getAdminPlanVisibility,
  getAdminPlans,
  getAssistant,
  getAssistantPlanVisibility,
  getAssistantMemoryItems,
  getAssistantTelegramIntegration,
  getAssistantTaskItems,
  getAssistantWebChats,
  patchAssistantDraft,
  patchAdminPlan,
  patchAssistantWebChat,
  patchAssistantTelegramConfig,
  postAssistantCreate,
  postAdminPlanCreate,
  postAssistantMemoryDoNotRemember,
  postAssistantMemoryItemForget,
  postAssistantTaskItemCancel,
  postAssistantTaskItemDisable,
  postAssistantTaskItemEnable,
  postAssistantPublish,
  postAssistantReset,
  postAssistantRollback,
  postAssistantTelegramConnect,
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
  "Tasks",
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

type PlanDraft = {
  displayName: string;
  description: string;
  status: "active" | "inactive";
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadataCommercialTag: string;
  metadataNotes: string;
  capabilityAssistantLifecycle: boolean;
  capabilityMemoryCenter: boolean;
  capabilityTasksCenter: boolean;
  toolCostDriving: boolean;
  toolUtility: boolean;
  toolCostDrivingQuotaGoverned: boolean;
  toolUtilityQuotaGoverned: boolean;
  channelWebChat: boolean;
  channelTelegram: boolean;
  channelWhatsapp: boolean;
  channelMax: boolean;
  limitsViewPercentages: boolean;
  limitsTasksExcludedFromCommercialQuotas: boolean;
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

function isMessageUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
}

function findPreviousUserServerMessageId(
  messages: StreamingChatMessage[],
  assistantIndex: number
): string | null {
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    if (entry === undefined) {
      continue;
    }
    if (entry.role === "user" && isMessageUuid(entry.id)) {
      return entry.id;
    }
  }
  return null;
}

function formatMemorySourceLine(
  sourceType: AssistantMemoryRegistryItemState["sourceType"],
  sourceLabel: AssistantMemoryRegistryItemState["sourceLabel"]
): string {
  if (sourceLabel !== null && sourceLabel.trim().length > 0) {
    return sourceLabel.trim();
  }
  if (sourceType === "web_chat") {
    return "Web chat";
  }
  return String(sourceType);
}

function formatTaskSourceLine(
  sourceSurface: AssistantTaskRegistryItemState["sourceSurface"],
  sourceLabel: AssistantTaskRegistryItemState["sourceLabel"]
): string {
  if (sourceLabel !== null && sourceLabel.trim().length > 0) {
    return sourceLabel.trim();
  }
  if (sourceSurface === "web") {
    return "Web";
  }
  return String(sourceSurface);
}

function formatTaskNextRunText(
  nextRunAt: string | null,
  controlStatus: AssistantTaskRegistryItemState["controlStatus"]
): string {
  if (controlStatus === "cancelled") {
    return "This reminder will not run again.";
  }
  if (controlStatus === "disabled") {
    return "Paused — nothing new will run while this is off.";
  }
  if (nextRunAt === null) {
    return "Next run isn’t set yet.";
  }
  return `Next run: ${new Date(nextRunAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  })}`;
}

function taskStatusPillClass(controlStatus: AssistantTaskRegistryItemState["controlStatus"]): string {
  if (controlStatus === "active") {
    return "task-pill-status task-pill-status-active";
  }
  if (controlStatus === "disabled") {
    return "task-pill-status task-pill-status-paused";
  }
  return "task-pill-status task-pill-status-stopped";
}

function taskStatusLabel(controlStatus: AssistantTaskRegistryItemState["controlStatus"]): string {
  if (controlStatus === "active") {
    return "Active";
  }
  if (controlStatus === "disabled") {
    return "Paused";
  }
  return "Stopped";
}

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

function toPlanDraft(plan?: AdminPlanState): PlanDraft {
  if (plan === undefined) {
    return {
      displayName: "",
      description: "",
      status: "active",
      defaultOnRegistration: false,
      trialEnabled: false,
      trialDurationDays: null,
      metadataCommercialTag: "",
      metadataNotes: "",
      capabilityAssistantLifecycle: true,
      capabilityMemoryCenter: true,
      capabilityTasksCenter: true,
      toolCostDriving: false,
      toolUtility: true,
      toolCostDrivingQuotaGoverned: true,
      toolUtilityQuotaGoverned: true,
      channelWebChat: true,
      channelTelegram: true,
      channelWhatsapp: false,
      channelMax: false,
      limitsViewPercentages: true,
      limitsTasksExcludedFromCommercialQuotas: true
    };
  }

  return {
    displayName: plan.displayName,
    description: plan.description ?? "",
    status: plan.status,
    defaultOnRegistration: plan.defaultOnRegistration,
    trialEnabled: plan.trialEnabled,
    trialDurationDays: plan.trialDurationDays,
    metadataCommercialTag: plan.metadata.commercialTag ?? "",
    metadataNotes: plan.metadata.notes ?? "",
    capabilityAssistantLifecycle: plan.entitlements.capabilities.assistantLifecycle,
    capabilityMemoryCenter: plan.entitlements.capabilities.memoryCenter,
    capabilityTasksCenter: plan.entitlements.capabilities.tasksCenter,
    toolCostDriving: plan.entitlements.toolClasses.costDrivingTools,
    toolUtility: plan.entitlements.toolClasses.utilityTools,
    toolCostDrivingQuotaGoverned: plan.entitlements.toolClasses.costDrivingQuotaGoverned,
    toolUtilityQuotaGoverned: plan.entitlements.toolClasses.utilityQuotaGoverned,
    channelWebChat: plan.entitlements.channelsAndSurfaces.webChat,
    channelTelegram: plan.entitlements.channelsAndSurfaces.telegram,
    channelWhatsapp: plan.entitlements.channelsAndSurfaces.whatsapp,
    channelMax: plan.entitlements.channelsAndSurfaces.max,
    limitsViewPercentages: plan.entitlements.limitsPermissions.viewLimitPercentages,
    limitsTasksExcludedFromCommercialQuotas:
      plan.entitlements.limitsPermissions.tasksExcludedFromCommercialQuotas
  };
}

function toAdminPlanPayload(draft: PlanDraft): Omit<AdminPlanCreateRequest, "code"> {
  return {
    displayName: draft.displayName.trim(),
    description: toNullable(draft.description),
    status: draft.status,
    defaultOnRegistration: draft.defaultOnRegistration,
    trialEnabled: draft.trialEnabled,
    trialDurationDays: draft.trialEnabled ? draft.trialDurationDays : null,
    metadata: {
      commercialTag: toNullable(draft.metadataCommercialTag),
      notes: toNullable(draft.metadataNotes)
    },
    entitlements: {
      capabilities: {
        assistantLifecycle: draft.capabilityAssistantLifecycle,
        memoryCenter: draft.capabilityMemoryCenter,
        tasksCenter: draft.capabilityTasksCenter
      },
      toolClasses: {
        costDrivingTools: draft.toolCostDriving,
        utilityTools: draft.toolUtility,
        costDrivingQuotaGoverned: draft.toolCostDrivingQuotaGoverned,
        utilityQuotaGoverned: draft.toolUtilityQuotaGoverned
      },
      channelsAndSurfaces: {
        webChat: draft.channelWebChat,
        telegram: draft.channelTelegram,
        whatsapp: draft.channelWhatsapp,
        max: draft.channelMax
      },
      limitsPermissions: {
        viewLimitPercentages: draft.limitsViewPercentages,
        tasksExcludedFromCommercialQuotas: draft.limitsTasksExcludedFromCommercialQuotas
      }
    }
  };
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

function isAssistantLiveForWebChat(assistantState: AssistantLifecycleState): boolean {
  if (assistantState.latestPublishedVersion === null) {
    return false;
  }

  return (
    assistantState.runtimeApply.status === "succeeded" &&
    assistantState.runtimeApply.appliedPublishedVersionId === assistantState.latestPublishedVersion.id
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
  const [memoryItems, setMemoryItems] = useState<AssistantMemoryRegistryItemState[]>([]);
  const [isLoadingMemoryItems, setIsLoadingMemoryItems] = useState(false);
  const [memoryItemsFeedback, setMemoryItemsFeedback] = useState<string | null>(null);
  const [memoryForgetWorkingId, setMemoryForgetWorkingId] = useState<string | null>(null);
  const [taskItems, setTaskItems] = useState<AssistantTaskRegistryItemState[]>([]);
  const [isLoadingTaskItems, setIsLoadingTaskItems] = useState(false);
  const [taskItemsFeedback, setTaskItemsFeedback] = useState<string | null>(null);
  const [taskActionWorkingId, setTaskActionWorkingId] = useState<string | null>(null);
  const [chatDoNotRememberWorkingId, setChatDoNotRememberWorkingId] = useState<string | null>(null);
  const [adminPlans, setAdminPlans] = useState<AdminPlanState[]>([]);
  const [isLoadingAdminPlans, setIsLoadingAdminPlans] = useState(false);
  const [adminPlansFeedback, setAdminPlansFeedback] = useState<string | null>(null);
  const [newPlanCode, setNewPlanCode] = useState("");
  const [newPlanDraft, setNewPlanDraft] = useState<PlanDraft>(toPlanDraft());
  const [editingPlanCode, setEditingPlanCode] = useState<string | null>(null);
  const [editingPlanDraft, setEditingPlanDraft] = useState<PlanDraft>(toPlanDraft());
  const [isSavingAdminPlan, setIsSavingAdminPlan] = useState(false);
  const [assistantPlanVisibility, setAssistantPlanVisibility] = useState<UserPlanVisibilityState | null>(
    null
  );
  const [isLoadingAssistantPlanVisibility, setIsLoadingAssistantPlanVisibility] = useState(false);
  const [assistantPlanVisibilityFeedback, setAssistantPlanVisibilityFeedback] = useState<string | null>(
    null
  );
  const [telegramIntegration, setTelegramIntegration] = useState<TelegramIntegrationState | null>(null);
  const [isLoadingTelegramIntegration, setIsLoadingTelegramIntegration] = useState(false);
  const [telegramIntegrationFeedback, setTelegramIntegrationFeedback] = useState<string | null>(null);
  const [telegramBotTokenInput, setTelegramBotTokenInput] = useState("");
  const [isConnectingTelegram, setIsConnectingTelegram] = useState(false);
  const [isTelegramConfigPanelOpen, setIsTelegramConfigPanelOpen] = useState(false);
  const [isSavingTelegramConfig, setIsSavingTelegramConfig] = useState(false);
  const [telegramConfigDraft, setTelegramConfigDraft] =
    useState<AssistantTelegramConfigUpdateRequest>({
      defaultParseMode: "plain_text",
      inboundUserMessagesEnabled: true,
      outboundAssistantMessagesEnabled: true,
      notes: null
    });
  const [adminPlanVisibility, setAdminPlanVisibility] = useState<AdminPlanVisibilityState | null>(
    null
  );
  const [isLoadingAdminPlanVisibility, setIsLoadingAdminPlanVisibility] = useState(false);
  const [adminPlanVisibilityFeedback, setAdminPlanVisibilityFeedback] = useState<string | null>(null);
  const reachedActiveChatCap = streamingIssue?.classId === "active_chat_cap";
  const assistantIsLiveForWebChat =
    flowState.type === "ready" && flowState.data.assistantState !== null
      ? isAssistantLiveForWebChat(flowState.data.assistantState)
      : false;

  const loadMemoryItems = useCallback(async () => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setMemoryItems([]);
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsLoadingMemoryItems(true);
      const items = await getAssistantMemoryItems(token);
      setMemoryItems(items);
      setMemoryItemsFeedback(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load memory items.";
      setMemoryItemsFeedback(message);
    } finally {
      setIsLoadingMemoryItems(false);
    }
  }, [flowState, getToken]);

  const loadTaskItems = useCallback(async () => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setTaskItems([]);
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsLoadingTaskItems(true);
      const items = await getAssistantTaskItems(token);
      setTaskItems(items);
      setTaskItemsFeedback(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load tasks.";
      setTaskItemsFeedback(message);
    } finally {
      setIsLoadingTaskItems(false);
    }
  }, [flowState, getToken]);

  const loadAdminPlans = useCallback(async () => {
    if (flowState.type !== "ready" || flowState.data.meState.me.workspace?.role !== "owner") {
      setAdminPlans([]);
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsLoadingAdminPlans(true);
      const plans = await getAdminPlans(token);
      setAdminPlans(plans);
      setAdminPlansFeedback(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load plan catalog.";
      setAdminPlansFeedback(message);
    } finally {
      setIsLoadingAdminPlans(false);
    }
  }, [flowState, getToken]);

  const loadAssistantPlanVisibility = useCallback(async () => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setAssistantPlanVisibility(null);
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsLoadingAssistantPlanVisibility(true);
      const visibility = await getAssistantPlanVisibility(token);
      setAssistantPlanVisibility(visibility);
      setAssistantPlanVisibilityFeedback(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load plan visibility.";
      setAssistantPlanVisibilityFeedback(message);
    } finally {
      setIsLoadingAssistantPlanVisibility(false);
    }
  }, [flowState, getToken]);

  const loadTelegramIntegration = useCallback(async () => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setTelegramIntegration(null);
      return;
    }
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }
    try {
      setIsLoadingTelegramIntegration(true);
      const integration = await getAssistantTelegramIntegration(token);
      setTelegramIntegration(integration);
      setTelegramIntegrationFeedback(null);
      setTelegramConfigDraft({
        defaultParseMode: integration.configPanel.settings.defaultParseMode,
        inboundUserMessagesEnabled: integration.configPanel.settings.inboundUserMessagesEnabled,
        outboundAssistantMessagesEnabled:
          integration.configPanel.settings.outboundAssistantMessagesEnabled,
        notes: integration.configPanel.settings.notes
      });
      if (!integration.configPanel.available) {
        setIsTelegramConfigPanelOpen(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load Telegram integration.";
      setTelegramIntegrationFeedback(message);
    } finally {
      setIsLoadingTelegramIntegration(false);
    }
  }, [flowState, getToken]);

  const loadAdminPlanVisibility = useCallback(async () => {
    if (flowState.type !== "ready" || flowState.data.meState.me.workspace?.role !== "owner") {
      setAdminPlanVisibility(null);
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsLoadingAdminPlanVisibility(true);
      const visibility = await getAdminPlanVisibility(token);
      setAdminPlanVisibility(visibility);
      setAdminPlanVisibilityFeedback(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load admin plan visibility.";
      setAdminPlanVisibilityFeedback(message);
    } finally {
      setIsLoadingAdminPlanVisibility(false);
    }
  }, [flowState, getToken]);

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

  useEffect(() => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setMemoryItems([]);
      return;
    }

    void loadMemoryItems();
  }, [flowState, loadMemoryItems]);

  useEffect(() => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setTaskItems([]);
      return;
    }

    void loadTaskItems();
  }, [flowState, loadTaskItems]);

  useEffect(() => {
    if (flowState.type !== "ready" || flowState.data.meState.me.workspace?.role !== "owner") {
      setAdminPlans([]);
      return;
    }

    void loadAdminPlans();
  }, [flowState, loadAdminPlans]);

  useEffect(() => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setAssistantPlanVisibility(null);
      return;
    }
    void loadAssistantPlanVisibility();
  }, [flowState, loadAssistantPlanVisibility]);

  useEffect(() => {
    if (flowState.type !== "ready" || flowState.data.assistantState === null) {
      setTelegramIntegration(null);
      return;
    }
    void loadTelegramIntegration();
  }, [flowState, loadTelegramIntegration]);

  useEffect(() => {
    if (flowState.type !== "ready" || flowState.data.meState.me.workspace?.role !== "owner") {
      setAdminPlanVisibility(null);
      return;
    }
    void loadAdminPlanVisibility();
  }, [flowState, loadAdminPlanVisibility]);

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

  async function onConnectTelegram(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }
    try {
      setIsConnectingTelegram(true);
      setTelegramIntegrationFeedback(null);
      const integration = await postAssistantTelegramConnect(token, {
        botToken: telegramBotTokenInput
      });
      setTelegramIntegration(integration);
      setTelegramBotTokenInput("");
      setTelegramConfigDraft({
        defaultParseMode: integration.configPanel.settings.defaultParseMode,
        inboundUserMessagesEnabled: integration.configPanel.settings.inboundUserMessagesEnabled,
        outboundAssistantMessagesEnabled:
          integration.configPanel.settings.outboundAssistantMessagesEnabled,
        notes: integration.configPanel.settings.notes
      });
      setTelegramIntegrationFeedback("Telegram bot connected.");
      setIsTelegramConfigPanelOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram connect failed.";
      setTelegramIntegrationFeedback(message);
    } finally {
      setIsConnectingTelegram(false);
    }
  }

  async function onSaveTelegramConfig(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }
    try {
      setIsSavingTelegramConfig(true);
      setTelegramIntegrationFeedback(null);
      const integration = await patchAssistantTelegramConfig(token, telegramConfigDraft);
      setTelegramIntegration(integration);
      setTelegramIntegrationFeedback("Telegram configuration updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram config update failed.";
      setTelegramIntegrationFeedback(message);
    } finally {
      setIsSavingTelegramConfig(false);
    }
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

  async function onPauseTaskItem(itemId: string): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setTaskActionWorkingId(itemId);
      await postAssistantTaskItemDisable(token, itemId);
      setTaskItemsFeedback("That reminder is paused.");
      await loadTaskItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not pause this reminder.";
      setTaskItemsFeedback(message);
    } finally {
      setTaskActionWorkingId(null);
    }
  }

  async function onResumeTaskItem(itemId: string): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setTaskActionWorkingId(itemId);
      await postAssistantTaskItemEnable(token, itemId);
      setTaskItemsFeedback("That reminder is active again.");
      await loadTaskItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not turn this reminder back on.";
      setTaskItemsFeedback(message);
    } finally {
      setTaskActionWorkingId(null);
    }
  }

  async function onStopTaskItem(itemId: string): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setTaskActionWorkingId(itemId);
      await postAssistantTaskItemCancel(token, itemId);
      setTaskItemsFeedback("That reminder is stopped.");
      await loadTaskItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not stop this reminder.";
      setTaskItemsFeedback(message);
    } finally {
      setTaskActionWorkingId(null);
    }
  }

  async function onForgetMemoryItem(itemId: string): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setMemoryForgetWorkingId(itemId);
      await postAssistantMemoryItemForget(token, itemId);
      setMemoryItemsFeedback("Removed from your Memory Center list.");
      await loadMemoryItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not forget this item.";
      setMemoryItemsFeedback(message);
    } finally {
      setMemoryForgetWorkingId(null);
    }
  }

  async function onDoNotRememberChatTurn(
    assistantMessageId: string,
    userMessageId: string | null
  ): Promise<void> {
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setChatDoNotRememberWorkingId(assistantMessageId);
      const result = await postAssistantMemoryDoNotRemember(token, {
        assistantMessageId,
        userMessageId: userMessageId ?? null
      });
      setStreamingMeta(
        `Preference saved. ${result.forgottenRegistryItems} related summary line(s) removed from Memory Center.`
      );
      await loadMemoryItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not apply do-not-remember.";
      setStreamingIssue({
        classId: "unknown",
        message: "Do not remember could not be applied.",
        guidance: message
      });
    } finally {
      setChatDoNotRememberWorkingId(null);
    }
  }

  async function onSendStreamingChatMessage(): Promise<void> {
    if (flowState.type !== "ready" || flowState.data.assistantState === null || isStreamingChat) {
      return;
    }

    if (!isAssistantLiveForWebChat(flowState.data.assistantState)) {
      setStreamingIssue(
        toWebChatUxIssue(
          "Assistant transport requires the latest published version to be successfully applied."
        )
      );
      setStreamingMeta("Publish/apply the latest assistant version before sending chat messages.");
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
          onCompleted: ({ transport }) => {
            const t = transport as {
              userMessage?: { id?: string };
              assistantMessage?: { id?: string };
            } | null;
            setChatMessages((current) =>
              current.map((message) => {
                if (message.id === assistantMessageId && typeof t?.assistantMessage?.id === "string") {
                  return {
                    ...message,
                    id: t.assistantMessage.id,
                    status: "committed" as const
                  };
                }
                if (message.id === userMessageId && typeof t?.userMessage?.id === "string") {
                  return { ...message, id: t.userMessage.id };
                }
                return message;
              })
            );
            setStreamingMeta("Streaming completed and response persisted.");
            void loadWebChatList();
            void loadMemoryItems();
            void loadTaskItems();
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

  function onSelectPlanForEditing(planCode: string): void {
    const selected = adminPlans.find((plan) => plan.code === planCode);
    if (selected === undefined) {
      return;
    }
    setEditingPlanCode(planCode);
    setEditingPlanDraft(toPlanDraft(selected));
    setAdminPlansFeedback(null);
  }

  async function onCreateAdminPlan(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    if (newPlanCode.trim().length === 0) {
      setAdminPlansFeedback("Plan code is required.");
      return;
    }

    try {
      setIsSavingAdminPlan(true);
      const created = await postAdminPlanCreate(token, {
        code: newPlanCode.trim().toLowerCase(),
        ...toAdminPlanPayload(newPlanDraft)
      });
      setAdminPlans((current) => [created, ...current.filter((plan) => plan.code !== created.code)]);
      setNewPlanCode("");
      setNewPlanDraft(toPlanDraft());
      setAdminPlansFeedback("Plan created.");
      await loadAdminPlans();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create plan.";
      setAdminPlansFeedback(message);
    } finally {
      setIsSavingAdminPlan(false);
    }
  }

  async function onSaveEditedAdminPlan(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editingPlanCode === null) {
      return;
    }

    const token = await getToken();
    if (token === null) {
      setFlowState({ type: "error", message: "Missing Clerk session token." });
      return;
    }

    try {
      setIsSavingAdminPlan(true);
      const updated = await patchAdminPlan(
        token,
        editingPlanCode,
        toAdminPlanPayload(editingPlanDraft) as AdminPlanUpdateRequest
      );
      setAdminPlans((current) => current.map((plan) => (plan.code === updated.code ? updated : plan)));
      setAdminPlansFeedback("Plan updated.");
      await loadAdminPlans();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update plan.";
      setAdminPlansFeedback(message);
    } finally {
      setIsSavingAdminPlan(false);
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
          <h2>Plan and limits visibility</h2>
          <p>Your current plan and limit usage in a simple percentage view.</p>
          {isLoadingAssistantPlanVisibility && <p>Loading plan visibility…</p>}
          {assistantPlanVisibilityFeedback !== null && <p>{assistantPlanVisibilityFeedback}</p>}
          {assistantPlanVisibility !== null && (
            <>
              <p>
                <strong>Current plan:</strong>{" "}
                {assistantPlanVisibility.effectivePlan.displayName ??
                  assistantPlanVisibility.effectivePlan.code ??
                  "Not configured"}
              </p>
              <p>
                <strong>Plan state:</strong> {assistantPlanVisibility.effectivePlan.subscriptionStatus}
              </p>
              <p>
                <strong>Token budget:</strong> {assistantPlanVisibility.limits.tokenBudgetPercent}%
              </p>
              <p>
                <strong>Cost-driving tools:</strong>{" "}
                {assistantPlanVisibility.limits.costDrivingToolsPercent}%
              </p>
              <p>
                <strong>Active web chats:</strong>{" "}
                {assistantPlanVisibility.limits.activeWebChatsPercent}%
              </p>
              <p>
                <strong>Tasks/reminders commercial quota:</strong>{" "}
                {assistantPlanVisibility.limits.tasksExcludedFromCommercialQuotas
                  ? "excluded"
                  : "included"}
              </p>
            </>
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
            <button
              type="button"
              disabled={isStreamingChat || !assistantIsLiveForWebChat}
              onClick={() => void onSendStreamingChatMessage()}
            >
              {isStreamingChat ? "Streaming..." : "Send message (stream)"}
            </button>
            <button type="button" disabled={!isStreamingChat} onClick={stopStreamingChat}>
              Stop streaming
            </button>
          </div>
          {!assistantIsLiveForWebChat && (
            <p>Chat will unlock after publish/apply succeeds for the latest assistant version.</p>
          )}
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
            <ul className="web-chat-turn-list">
              {chatMessages.map((message, index) => (
                <li key={message.id} className="web-chat-turn">
                  <div>
                    <strong>{message.role}</strong>
                    {message.id === activeAssistantStreamMessageId && isStreamingChat
                      ? " (streaming)"
                      : message.status === "partial"
                        ? " (partial)"
                        : ""}
                    : {message.content.length > 0 ? message.content : "..."}
                  </div>
                  {message.role === "assistant" &&
                    message.status === "committed" &&
                    isMessageUuid(message.id) && (
                      <div className="web-chat-dnr-wrap">
                        <button
                          type="button"
                          className="btn-quiet"
                          disabled={chatDoNotRememberWorkingId !== null || isStreamingChat}
                          onClick={() => {
                            const prevUser = findPreviousUserServerMessageId(chatMessages, index);
                            void onDoNotRememberChatTurn(message.id, prevUser);
                          }}
                        >
                          {chatDoNotRememberWorkingId === message.id
                            ? "Saving preference…"
                            : "Do not remember this"}
                        </button>
                      </div>
                    )}
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

          <section className="memory-center">
            <h3>Memory</h3>
            <p className="memory-center-lead">
              Calm summaries from your web chats show here. This is your Memory Center—not a technical log
              and not raw runtime internals.
            </p>
            {memoryItemsFeedback !== null && <p className="memory-feedback">{memoryItemsFeedback}</p>}
            {isLoadingMemoryItems ? (
              <p>Loading memory summaries…</p>
            ) : memoryItems.length === 0 ? (
              <p className="memory-empty">
                No summaries yet. After a web chat reply finishes, a short one-line summary may appear
                here. You can remove it anytime.
              </p>
            ) : (
              <ul className="memory-item-list">
                {memoryItems.map((item) => (
                  <li key={item.id} className="memory-item-card">
                    <p className="memory-item-summary">{item.summary}</p>
                    <p className="memory-item-meta">
                      <span className="memory-pill">
                        {formatMemorySourceLine(item.sourceType, item.sourceLabel)}
                      </span>
                      <span className="memory-date">
                        {new Date(item.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short"
                        })}
                      </span>
                    </p>
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={memoryForgetWorkingId !== null}
                      onClick={() => void onForgetMemoryItem(item.id)}
                    >
                      {memoryForgetWorkingId === item.id ? "Removing…" : "Forget from list"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="task-center">
            <h3>Tasks</h3>
            <p className="task-center-lead">
              Your reminders and scheduled tasks in one calm place. This is a simple control panel—not a
              workflow builder and not a technical runtime view.
            </p>
            {taskItemsFeedback !== null && <p className="task-feedback">{taskItemsFeedback}</p>}
            {isLoadingTaskItems ? (
              <p>Loading reminders…</p>
            ) : taskItems.length === 0 ? (
              <p className="task-empty">
                Nothing here yet. When your assistant sets up reminders or repeating tasks, they’ll show up
                so you can pause or stop them anytime.
              </p>
            ) : (
              <>
                <section className="task-center-group">
                  <h4 className="task-center-subheading">Active</h4>
                  {taskItems.filter((t) => t.controlStatus === "active").length === 0 ? (
                    <p className="task-empty-inline">No active reminders right now.</p>
                  ) : (
                    <ul className="task-item-list">
                      {taskItems
                        .filter((t) => t.controlStatus === "active")
                        .map((item) => (
                          <li key={item.id} className="task-item-card">
                            <p className="task-item-title">{item.title}</p>
                            <p className="task-item-meta">
                              <span className="task-pill-surface">
                                {formatTaskSourceLine(item.sourceSurface, item.sourceLabel)}
                              </span>
                              <span className={taskStatusPillClass(item.controlStatus)}>
                                {taskStatusLabel(item.controlStatus)}
                              </span>
                            </p>
                            <p className="task-item-next">{formatTaskNextRunText(item.nextRunAt, item.controlStatus)}</p>
                            <div className="task-item-actions">
                              <button
                                type="button"
                                className="btn-quiet"
                                disabled={taskActionWorkingId !== null}
                                onClick={() => void onPauseTaskItem(item.id)}
                              >
                                {taskActionWorkingId === item.id ? "Working…" : "Pause"}
                              </button>
                              <button
                                type="button"
                                className="btn-quiet"
                                disabled={taskActionWorkingId !== null}
                                onClick={() => void onStopTaskItem(item.id)}
                              >
                                {taskActionWorkingId === item.id ? "Working…" : "Stop"}
                              </button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
                <section className="task-center-group">
                  <h4 className="task-center-subheading">Inactive</h4>
                  <p className="task-inactive-hint">
                    Paused or stopped items stay listed so you always know what you changed.
                  </p>
                  {taskItems.filter((t) => t.controlStatus !== "active").length === 0 ? (
                    <p className="task-empty-inline">No paused or stopped reminders.</p>
                  ) : (
                    <ul className="task-item-list">
                      {taskItems
                        .filter((t) => t.controlStatus !== "active")
                        .map((item) => (
                          <li key={item.id} className="task-item-card">
                            <p className="task-item-title">{item.title}</p>
                            <p className="task-item-meta">
                              <span className="task-pill-surface">
                                {formatTaskSourceLine(item.sourceSurface, item.sourceLabel)}
                              </span>
                              <span className={taskStatusPillClass(item.controlStatus)}>
                                {taskStatusLabel(item.controlStatus)}
                              </span>
                            </p>
                            <p className="task-item-next">{formatTaskNextRunText(item.nextRunAt, item.controlStatus)}</p>
                            <div className="task-item-actions">
                              {item.controlStatus === "disabled" ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn-quiet"
                                    disabled={taskActionWorkingId !== null}
                                    onClick={() => void onResumeTaskItem(item.id)}
                                  >
                                    {taskActionWorkingId === item.id ? "Working…" : "Turn back on"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-quiet"
                                    disabled={taskActionWorkingId !== null}
                                    onClick={() => void onStopTaskItem(item.id)}
                                  >
                                    {taskActionWorkingId === item.id ? "Working…" : "Stop"}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </section>

          <section>
            <h3>Tools & Integrations</h3>
            <p>Connect external delivery surfaces while keeping web as the main control plane.</p>
            {isLoadingTelegramIntegration && <p>Loading Telegram integration…</p>}
            {telegramIntegrationFeedback !== null && <p>{telegramIntegrationFeedback}</p>}
            {telegramIntegration === null ? (
              <p>Telegram integration state is not available yet.</p>
            ) : (
              <>
                <article className="task-item-card">
                  <h4>Telegram bot</h4>
                  <p>
                    <strong>Capability:</strong>{" "}
                    {telegramIntegration.capabilityAllowed ? "allowed" : "not allowed by plan"}
                  </p>
                  <p>
                    <strong>Status:</strong>{" "}
                    {telegramIntegration.connectionStatus === "connected" ? "Connected" : "Not connected"}
                  </p>
                  {telegramIntegration.connectionStatus === "connected" && (
                    <>
                      <p>
                        <strong>Bot:</strong>{" "}
                        {telegramIntegration.bot.displayName ??
                          telegramIntegration.bot.username ??
                          "Unnamed bot"}
                      </p>
                      {telegramIntegration.bot.username !== null && (
                        <p>
                          <strong>Username:</strong> @{telegramIntegration.bot.username}
                        </p>
                      )}
                      {telegramIntegration.bot.avatarUrl !== null && (
                        <img
                          src={telegramIntegration.bot.avatarUrl}
                          alt="Telegram bot avatar"
                          width={48}
                          height={48}
                        />
                      )}
                    </>
                  )}
                  {telegramIntegration.connectionStatus !== "connected" && (
                    <form onSubmit={(event) => void onConnectTelegram(event)}>
                      <p>
                        1) Open Telegram and create/get your bot via @BotFather. 2) Paste bot token.
                        3) Connect.
                      </p>
                      <label htmlFor="telegramBotTokenInput">Telegram bot token</label>
                      <input
                        id="telegramBotTokenInput"
                        type="password"
                        value={telegramBotTokenInput}
                        onChange={(event) => setTelegramBotTokenInput(event.target.value)}
                        placeholder="123456789:AA..."
                        required
                      />
                      <button
                        type="submit"
                        disabled={!telegramIntegration.capabilityAllowed || isConnectingTelegram}
                      >
                        {isConnectingTelegram ? "Connecting…" : "Connect Telegram"}
                      </button>
                    </form>
                  )}
                  {telegramIntegration.connectionStatus === "connected" && (
                    <>
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => setIsTelegramConfigPanelOpen((current) => !current)}
                      >
                        {isTelegramConfigPanelOpen
                          ? "Close Telegram configuration panel"
                          : "Open Telegram configuration panel"}
                      </button>
                      {isTelegramConfigPanelOpen && (
                        <form onSubmit={(event) => void onSaveTelegramConfig(event)}>
                          <label htmlFor="telegramParseMode">Default parse mode</label>
                          <select
                            id="telegramParseMode"
                            value={telegramConfigDraft.defaultParseMode ?? "plain_text"}
                            onChange={(event) =>
                              setTelegramConfigDraft((current) => ({
                                ...current,
                                defaultParseMode:
                                  event.target.value === "markdown" ? "markdown" : "plain_text"
                              }))
                            }
                          >
                            <option value="plain_text">Plain text</option>
                            <option value="markdown">Markdown</option>
                          </select>
                          <label>
                            <input
                              type="checkbox"
                              checked={telegramConfigDraft.inboundUserMessagesEnabled ?? true}
                              onChange={(event) =>
                                setTelegramConfigDraft((current) => ({
                                  ...current,
                                  inboundUserMessagesEnabled: event.target.checked
                                }))
                              }
                            />
                            Inbound user messages enabled
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={telegramConfigDraft.outboundAssistantMessagesEnabled ?? true}
                              onChange={(event) =>
                                setTelegramConfigDraft((current) => ({
                                  ...current,
                                  outboundAssistantMessagesEnabled: event.target.checked
                                }))
                              }
                            />
                            Outbound assistant messages enabled
                          </label>
                          <label htmlFor="telegramConfigNotes">Notes</label>
                          <textarea
                            id="telegramConfigNotes"
                            value={telegramConfigDraft.notes ?? ""}
                            onChange={(event) =>
                              setTelegramConfigDraft((current) => ({
                                ...current,
                                notes: event.target.value
                              }))
                            }
                          />
                          <button type="submit" disabled={isSavingTelegramConfig}>
                            {isSavingTelegramConfig ? "Saving…" : "Save Telegram configuration"}
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </article>
              </>
            )}
          </section>

          <section>
            <h3>Channels</h3>
            <p>
              Web remains primary for setup and governance. Telegram is an interaction/delivery surface
              connected from Integrations.
            </p>
          </section>

          <section>
            <h3>Limits & Safety Summary</h3>
            <p>Read-only summary with plan-aware percentage limits.</p>
            <p>
              <strong>Quota plan code:</strong> {assistantState.governance.quotaPlanCode ?? "not configured"}
            </p>
            {assistantPlanVisibility !== null && (
              <>
                <p>
                  <strong>Token budget usage:</strong> {assistantPlanVisibility.limits.tokenBudgetPercent}%
                </p>
                <p>
                  <strong>Cost-driving tools usage:</strong>{" "}
                  {assistantPlanVisibility.limits.costDrivingToolsPercent}%
                </p>
                <p>
                  <strong>Active web chats usage:</strong>{" "}
                  {assistantPlanVisibility.limits.activeWebChatsPercent}%
                </p>
              </>
            )}
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

      {me.workspace.role === "owner" && (
        <section>
          <h2>Admin plan visibility</h2>
          <p>Current plan state, usage pressure, and effective entitlements for this workspace.</p>
          {isLoadingAdminPlanVisibility && <p>Loading admin visibility…</p>}
          {adminPlanVisibilityFeedback !== null && <p>{adminPlanVisibilityFeedback}</p>}
          {adminPlanVisibility !== null && (
            <>
              <p>
                <strong>Effective plan:</strong>{" "}
                {adminPlanVisibility.planState.effectivePlanDisplayName ??
                  adminPlanVisibility.planState.effectivePlanCode ??
                  "Not configured"}
              </p>
              <p>
                <strong>Catalog state:</strong> {adminPlanVisibility.planState.activePlans} active /{" "}
                {adminPlanVisibility.planState.inactivePlans} inactive
              </p>
              <p>
                <strong>Usage pressure:</strong> {adminPlanVisibility.usagePressure.pressureLevel}
              </p>
              <p>
                <strong>Token budget pressure:</strong>{" "}
                {adminPlanVisibility.usagePressure.tokenBudgetPercent}%
              </p>
              <p>
                <strong>Cost-driving pressure:</strong>{" "}
                {adminPlanVisibility.usagePressure.costDrivingToolsPercent}%
              </p>
              <p>
                <strong>Web chats pressure:</strong>{" "}
                {adminPlanVisibility.usagePressure.activeWebChatsPercent}%
              </p>
              {adminPlanVisibility.effectiveEntitlements !== null && (
                <>
                  <p>
                    <strong>Effective web chat entitlement:</strong>{" "}
                    {adminPlanVisibility.effectiveEntitlements.channelsAndSurfaces.webChat
                      ? "enabled"
                      : "disabled"}
                  </p>
                  <p>
                    <strong>Effective cost-driving tools:</strong>{" "}
                    {adminPlanVisibility.effectiveEntitlements.toolClasses.costDrivingAllowed
                      ? "enabled"
                      : "disabled"}
                  </p>
                </>
              )}
            </>
          )}
        </section>
      )}

      {me.workspace.role === "owner" && (
        <section>
          <h2>Admin plan management</h2>
          <p>
            Create and edit commercial plan packaging in one place. This is control-plane configuration,
            not a billing provider console.
          </p>
          {adminPlansFeedback !== null && <p>{adminPlansFeedback}</p>}
          {isLoadingAdminPlans && <p>Loading plan catalog…</p>}
          <button type="button" disabled={isLoadingAdminPlans} onClick={() => void loadAdminPlans()}>
            Refresh plans
          </button>

          <section>
            <h3>Create plan</h3>
            <form onSubmit={(event) => void onCreateAdminPlan(event)}>
              <label htmlFor="adminPlanCode">Plan code</label>
              <input
                id="adminPlanCode"
                value={newPlanCode}
                onChange={(event) => setNewPlanCode(event.target.value)}
                placeholder="starter_trial"
                required
              />
              <label htmlFor="adminPlanDisplayName">Display name</label>
              <input
                id="adminPlanDisplayName"
                value={newPlanDraft.displayName}
                onChange={(event) =>
                  setNewPlanDraft((current) => ({ ...current, displayName: event.target.value }))
                }
                required
              />
              <label htmlFor="adminPlanDescription">Description</label>
              <textarea
                id="adminPlanDescription"
                value={newPlanDraft.description}
                onChange={(event) =>
                  setNewPlanDraft((current) => ({ ...current, description: event.target.value }))
                }
              />
              <label htmlFor="adminPlanStatus">Status</label>
              <select
                id="adminPlanStatus"
                value={newPlanDraft.status}
                onChange={(event) =>
                  setNewPlanDraft((current) => ({
                    ...current,
                    status: event.target.value === "inactive" ? "inactive" : "active"
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.defaultOnRegistration}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({
                      ...current,
                      defaultOnRegistration: event.target.checked
                    }))
                  }
                />
                Default on first registration
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.trialEnabled}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, trialEnabled: event.target.checked }))
                  }
                />
                Trial enabled
              </label>
              <label htmlFor="adminPlanTrialDuration">Trial duration (days)</label>
              <input
                id="adminPlanTrialDuration"
                type="number"
                min={1}
                value={newPlanDraft.trialDurationDays ?? ""}
                onChange={(event) =>
                  setNewPlanDraft((current) => ({
                    ...current,
                    trialDurationDays:
                      event.target.value.trim().length === 0 ? null : Number.parseInt(event.target.value, 10)
                  }))
                }
                disabled={!newPlanDraft.trialEnabled}
              />
              <label htmlFor="adminPlanCommercialTag">Commercial tag</label>
              <input
                id="adminPlanCommercialTag"
                value={newPlanDraft.metadataCommercialTag}
                onChange={(event) =>
                  setNewPlanDraft((current) => ({ ...current, metadataCommercialTag: event.target.value }))
                }
              />
              <label htmlFor="adminPlanNotes">Admin notes</label>
              <textarea
                id="adminPlanNotes"
                value={newPlanDraft.metadataNotes}
                onChange={(event) =>
                  setNewPlanDraft((current) => ({ ...current, metadataNotes: event.target.value }))
                }
              />
              <p>
                <strong>Entitlements</strong>
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.capabilityAssistantLifecycle}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({
                      ...current,
                      capabilityAssistantLifecycle: event.target.checked
                    }))
                  }
                />
                Assistant lifecycle controls
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.capabilityMemoryCenter}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, capabilityMemoryCenter: event.target.checked }))
                  }
                />
                Memory Center
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.capabilityTasksCenter}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, capabilityTasksCenter: event.target.checked }))
                  }
                />
                Tasks Center
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.toolCostDriving}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, toolCostDriving: event.target.checked }))
                  }
                />
                Cost-driving tools available
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.toolCostDrivingQuotaGoverned}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({
                      ...current,
                      toolCostDrivingQuotaGoverned: event.target.checked
                    }))
                  }
                />
                Cost-driving tools quota-governed
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.toolUtility}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, toolUtility: event.target.checked }))
                  }
                />
                Utility tools available
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.toolUtilityQuotaGoverned}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({
                      ...current,
                      toolUtilityQuotaGoverned: event.target.checked
                    }))
                  }
                />
                Utility tools quota-governed
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.channelWebChat}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, channelWebChat: event.target.checked }))
                  }
                />
                Web chat surface
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.channelTelegram}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, channelTelegram: event.target.checked }))
                  }
                />
                Telegram surface
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.channelWhatsapp}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, channelWhatsapp: event.target.checked }))
                  }
                />
                WhatsApp surface
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.channelMax}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, channelMax: event.target.checked }))
                  }
                />
                MAX surface
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.limitsViewPercentages}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({ ...current, limitsViewPercentages: event.target.checked }))
                  }
                />
                Show limits as percentages
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newPlanDraft.limitsTasksExcludedFromCommercialQuotas}
                  onChange={(event) =>
                    setNewPlanDraft((current) => ({
                      ...current,
                      limitsTasksExcludedFromCommercialQuotas: event.target.checked
                    }))
                  }
                />
                Tasks/reminders excluded from commercial quotas
              </label>
              <button type="submit" disabled={isSavingAdminPlan}>
                {isSavingAdminPlan ? "Saving..." : "Create plan"}
              </button>
            </form>
          </section>

          <section>
            <h3>Edit existing plan</h3>
            {adminPlans.length === 0 ? (
              <p>No plans available yet.</p>
            ) : (
              <>
                <p>Select a plan, adjust controls, and save.</p>
                <ul>
                  {adminPlans.map((plan) => (
                    <li key={plan.code}>
                      <button type="button" onClick={() => onSelectPlanForEditing(plan.code)}>
                        {plan.displayName} ({plan.code})
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {editingPlanCode !== null && (
              <form onSubmit={(event) => void onSaveEditedAdminPlan(event)}>
                <p>
                  <strong>Editing:</strong> {editingPlanCode}
                </p>
                <label htmlFor="editPlanDisplayName">Display name</label>
                <input
                  id="editPlanDisplayName"
                  value={editingPlanDraft.displayName}
                  onChange={(event) =>
                    setEditingPlanDraft((current) => ({ ...current, displayName: event.target.value }))
                  }
                  required
                />
                <label htmlFor="editPlanDescription">Description</label>
                <textarea
                  id="editPlanDescription"
                  value={editingPlanDraft.description}
                  onChange={(event) =>
                    setEditingPlanDraft((current) => ({ ...current, description: event.target.value }))
                  }
                />
                <label htmlFor="editPlanStatus">Status</label>
                <select
                  id="editPlanStatus"
                  value={editingPlanDraft.status}
                  onChange={(event) =>
                    setEditingPlanDraft((current) => ({
                      ...current,
                      status: event.target.value === "inactive" ? "inactive" : "active"
                    }))
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.defaultOnRegistration}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        defaultOnRegistration: event.target.checked
                      }))
                    }
                  />
                  Default on first registration
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.trialEnabled}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        trialEnabled: event.target.checked
                      }))
                    }
                  />
                  Trial enabled
                </label>
                <label htmlFor="editPlanTrialDuration">Trial duration (days)</label>
                <input
                  id="editPlanTrialDuration"
                  type="number"
                  min={1}
                  value={editingPlanDraft.trialDurationDays ?? ""}
                  onChange={(event) =>
                    setEditingPlanDraft((current) => ({
                      ...current,
                      trialDurationDays:
                        event.target.value.trim().length === 0 ? null : Number.parseInt(event.target.value, 10)
                    }))
                  }
                  disabled={!editingPlanDraft.trialEnabled}
                />
                <label htmlFor="editPlanCommercialTag">Commercial tag</label>
                <input
                  id="editPlanCommercialTag"
                  value={editingPlanDraft.metadataCommercialTag}
                  onChange={(event) =>
                    setEditingPlanDraft((current) => ({
                      ...current,
                      metadataCommercialTag: event.target.value
                    }))
                  }
                />
                <label htmlFor="editPlanNotes">Admin notes</label>
                <textarea
                  id="editPlanNotes"
                  value={editingPlanDraft.metadataNotes}
                  onChange={(event) =>
                    setEditingPlanDraft((current) => ({ ...current, metadataNotes: event.target.value }))
                  }
                />
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.capabilityAssistantLifecycle}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        capabilityAssistantLifecycle: event.target.checked
                      }))
                    }
                  />
                  Assistant lifecycle controls
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.capabilityMemoryCenter}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        capabilityMemoryCenter: event.target.checked
                      }))
                    }
                  />
                  Memory Center
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.capabilityTasksCenter}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        capabilityTasksCenter: event.target.checked
                      }))
                    }
                  />
                  Tasks Center
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.toolCostDriving}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({ ...current, toolCostDriving: event.target.checked }))
                    }
                  />
                  Cost-driving tools available
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.toolCostDrivingQuotaGoverned}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        toolCostDrivingQuotaGoverned: event.target.checked
                      }))
                    }
                  />
                  Cost-driving tools quota-governed
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.toolUtility}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({ ...current, toolUtility: event.target.checked }))
                    }
                  />
                  Utility tools available
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.toolUtilityQuotaGoverned}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        toolUtilityQuotaGoverned: event.target.checked
                      }))
                    }
                  />
                  Utility tools quota-governed
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.channelWebChat}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({ ...current, channelWebChat: event.target.checked }))
                    }
                  />
                  Web chat surface
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.channelTelegram}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({ ...current, channelTelegram: event.target.checked }))
                    }
                  />
                  Telegram surface
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.channelWhatsapp}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({ ...current, channelWhatsapp: event.target.checked }))
                    }
                  />
                  WhatsApp surface
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.channelMax}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({ ...current, channelMax: event.target.checked }))
                    }
                  />
                  MAX surface
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.limitsViewPercentages}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        limitsViewPercentages: event.target.checked
                      }))
                    }
                  />
                  Show limits as percentages
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingPlanDraft.limitsTasksExcludedFromCommercialQuotas}
                    onChange={(event) =>
                      setEditingPlanDraft((current) => ({
                        ...current,
                        limitsTasksExcludedFromCommercialQuotas: event.target.checked
                      }))
                    }
                  />
                  Tasks/reminders excluded from commercial quotas
                </label>
                <button type="submit" disabled={isSavingAdminPlan}>
                  {isSavingAdminPlan ? "Saving..." : "Save plan changes"}
                </button>
              </form>
            )}
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
