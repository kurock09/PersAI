import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantLifecycleState } from "@persai/contracts";
import { AppFlowClient } from "./app-flow.client";
import { CurrentMeResponse } from "./me-api-client";

const clerkMocks = vi.hoisted(() => {
  return {
    getToken: vi.fn()
  };
});

const apiMocks = vi.hoisted(() => {
  return {
    getMe: vi.fn(),
    postOnboarding: vi.fn()
  };
});

const assistantApiMocks = vi.hoisted(() => {
  return {
    getAssistant: vi.fn(),
    getAssistantPlanVisibility: vi.fn(),
    getAssistantMemoryItems: vi.fn(),
    getAssistantTelegramIntegration: vi.fn(),
    getAssistantWebChats: vi.fn(),
    postAssistantCreate: vi.fn(),
    patchAssistantDraft: vi.fn(),
    patchAssistantWebChat: vi.fn(),
    postAssistantPublish: vi.fn(),
    postAssistantRollback: vi.fn(),
    postAssistantReset: vi.fn(),
    postAssistantWebChatArchive: vi.fn(),
    deleteAssistantWebChat: vi.fn(),
    postAssistantMemoryItemForget: vi.fn(),
    postAssistantMemoryDoNotRemember: vi.fn(),
    getAssistantTaskItems: vi.fn(),
    getAdminPlans: vi.fn(),
    getAdminNotificationChannels: vi.fn(),
    getAdminBusinessCockpit: vi.fn(),
    getAdminOpsCockpit: vi.fn(),
    getAdminPlanVisibility: vi.fn(),
    postAdminPlanCreate: vi.fn(),
    patchAdminPlan: vi.fn(),
    patchAdminNotificationWebhookChannel: vi.fn(),
    postAssistantReapply: vi.fn(),
    postAssistantTaskItemDisable: vi.fn(),
    postAssistantTaskItemEnable: vi.fn(),
    postAssistantTaskItemCancel: vi.fn(),
    streamAssistantWebChatTurn: vi.fn(),
    postAssistantTelegramConnect: vi.fn(),
    patchAssistantTelegramConfig: vi.fn()
  };
});

vi.mock("@clerk/nextjs", () => {
  return {
    useAuth: () => ({
      getToken: clerkMocks.getToken
    }),
    UserButton: () => <div data-testid="user-button" />,
    SignOutButton: ({ children }: { children: ReactNode }) => <>{children}</>
  };
});

vi.mock("./me-api-client", async () => {
  const actual = await vi.importActual<typeof import("./me-api-client")>("./me-api-client");

  return {
    ...actual,
    getMe: apiMocks.getMe,
    postOnboarding: apiMocks.postOnboarding
  };
});

vi.mock("./assistant-api-client", async () => {
  const actual = await vi.importActual<typeof import("./assistant-api-client")>(
    "./assistant-api-client"
  );

  return {
    ...actual,
    getAssistant: assistantApiMocks.getAssistant,
    getAssistantPlanVisibility: assistantApiMocks.getAssistantPlanVisibility,
    getAssistantMemoryItems: assistantApiMocks.getAssistantMemoryItems,
    getAssistantTelegramIntegration: assistantApiMocks.getAssistantTelegramIntegration,
    getAssistantWebChats: assistantApiMocks.getAssistantWebChats,
    postAssistantCreate: assistantApiMocks.postAssistantCreate,
    patchAssistantDraft: assistantApiMocks.patchAssistantDraft,
    patchAssistantWebChat: assistantApiMocks.patchAssistantWebChat,
    postAssistantPublish: assistantApiMocks.postAssistantPublish,
    postAssistantRollback: assistantApiMocks.postAssistantRollback,
    postAssistantReset: assistantApiMocks.postAssistantReset,
    postAssistantWebChatArchive: assistantApiMocks.postAssistantWebChatArchive,
    deleteAssistantWebChat: assistantApiMocks.deleteAssistantWebChat,
    postAssistantMemoryItemForget: assistantApiMocks.postAssistantMemoryItemForget,
    postAssistantMemoryDoNotRemember: assistantApiMocks.postAssistantMemoryDoNotRemember,
    getAssistantTaskItems: assistantApiMocks.getAssistantTaskItems,
    getAdminPlans: assistantApiMocks.getAdminPlans,
    getAdminNotificationChannels: assistantApiMocks.getAdminNotificationChannels,
    getAdminBusinessCockpit: assistantApiMocks.getAdminBusinessCockpit,
    getAdminOpsCockpit: assistantApiMocks.getAdminOpsCockpit,
    getAdminPlanVisibility: assistantApiMocks.getAdminPlanVisibility,
    postAdminPlanCreate: assistantApiMocks.postAdminPlanCreate,
    patchAdminPlan: assistantApiMocks.patchAdminPlan,
    patchAdminNotificationWebhookChannel: assistantApiMocks.patchAdminNotificationWebhookChannel,
    postAssistantReapply: assistantApiMocks.postAssistantReapply,
    postAssistantTaskItemDisable: assistantApiMocks.postAssistantTaskItemDisable,
    postAssistantTaskItemEnable: assistantApiMocks.postAssistantTaskItemEnable,
    postAssistantTaskItemCancel: assistantApiMocks.postAssistantTaskItemCancel,
    streamAssistantWebChatTurn: assistantApiMocks.streamAssistantWebChatTurn,
    postAssistantTelegramConnect: assistantApiMocks.postAssistantTelegramConnect,
    patchAssistantTelegramConfig: assistantApiMocks.patchAssistantTelegramConfig
  };
});

function makeMeResponse(status: "pending" | "completed"): CurrentMeResponse {
  return {
    requestId: "req-1",
    me: {
      appUser: {
        id: "user-1",
        clerkUserId: "clerk-user-1",
        email: "user1@example.com",
        displayName: "User One"
      },
      onboarding: {
        isComplete: status === "completed",
        status
      },
      workspace:
        status === "completed"
          ? {
              id: "ws-1",
              name: "Workspace A",
              locale: "en-US",
              timezone: "UTC",
              status: "active",
              role: "owner"
            }
          : null
    }
  };
}

function makeAssistantResponse(): AssistantLifecycleState {
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    draft: {
      displayName: "Operator Assistant",
      instructions: "Use short, useful answers.",
      updatedAt: "2026-03-23T10:00:00.000Z"
    },
    latestPublishedVersion: {
      id: "pub-2",
      version: 2,
      publishedByUserId: "user-1",
      publishedAt: "2026-03-23T10:05:00.000Z",
      snapshot: {
        displayName: "Operator Assistant",
        instructions: "Use short, useful answers."
      }
    },
    runtimeApply: {
      status: "succeeded",
      targetPublishedVersionId: "pub-2",
      appliedPublishedVersionId: "pub-2",
      requestedAt: "2026-03-23T10:05:01.000Z",
      startedAt: "2026-03-23T10:05:02.000Z",
      finishedAt: "2026-03-23T10:05:03.000Z",
      error: null
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      memoryControl: null,
      tasksControl: null,
      quotaPlanCode: null,
      quotaHook: null,
      auditHook: null,
      platformManagedUpdatedAt: null
    },
    materialization: {
      latestSpecId: "spec-2",
      publishedVersionId: "pub-2",
      sourceAction: "publish",
      algorithmVersion: 1,
      contentHash: "hash-2",
      generatedAt: "2026-03-23T10:05:01.000Z",
      openclawBootstrapDocument: "{}",
      openclawWorkspaceDocument: "{}"
    },
    createdAt: "2026-03-23T10:00:00.000Z",
    updatedAt: "2026-03-23T10:05:03.000Z"
  };
}

function makeTelegramIntegrationState() {
  return {
    schema: "persai.telegramIntegration.v1" as const,
    provider: "telegram" as const,
    surfaceType: "telegram_bot" as const,
    capabilityAllowed: true,
    connectionStatus: "not_connected" as const,
    bindingState: "unconfigured" as const,
    connectedAt: null,
    bot: {
      telegramUserId: null,
      username: null,
      displayName: null,
      avatarUrl: null
    },
    tokenHint: {
      lastFour: null
    },
    configPanel: {
      available: false,
      settings: {
        defaultParseMode: "plain_text" as const,
        inboundUserMessagesEnabled: true,
        outboundAssistantMessagesEnabled: true,
        notes: null
      }
    },
    notes: []
  };
}

function makeConnectedTelegramIntegrationState() {
  const state = makeTelegramIntegrationState();
  return {
    ...state,
    connectionStatus: "connected" as const,
    bindingState: "active" as const,
    connectedAt: "2026-03-24T10:00:00.000Z",
    bot: {
      telegramUserId: 777,
      username: "persai_bot",
      displayName: "PersAI Bot",
      avatarUrl: "https://t.me/i/userpic/320/persai_bot.jpg"
    },
    tokenHint: {
      lastFour: "0123"
    },
    configPanel: {
      ...state.configPanel,
      available: true
    }
  };
}

function makeAssistantResponseWithDraft(
  draftDisplayName: string | null,
  draftInstructions: string | null
): AssistantLifecycleState {
  const state = makeAssistantResponse();
  return {
    ...state,
    draft: {
      ...state.draft,
      displayName: draftDisplayName,
      instructions: draftInstructions
    }
  };
}

function makeAssistantResponseWithApplyStatus(
  status: AssistantLifecycleState["runtimeApply"]["status"]
): AssistantLifecycleState {
  const state = makeAssistantResponse();
  return {
    ...state,
    runtimeApply: {
      ...state.runtimeApply,
      status
    }
  };
}

function makeAssistantResponseWithoutVisibleUpdates(): AssistantLifecycleState {
  const state = makeAssistantResponse();
  return {
    ...state,
    draft: {
      displayName: null,
      instructions: null,
      updatedAt: null
    },
    latestPublishedVersion: null,
    runtimeApply: {
      ...state.runtimeApply,
      status: "not_requested",
      finishedAt: null,
      error: null
    },
    governance: {
      ...state.governance,
      platformManagedUpdatedAt: null
    },
    materialization: {
      ...state.materialization,
      sourceAction: null
    }
  };
}

function makeUserPlanVisibility() {
  return {
    effectivePlan: {
      code: "starter_trial",
      displayName: "Starter Trial",
      status: "active" as const,
      source: "workspace_subscription" as const,
      subscriptionStatus: "trialing" as const,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      isTrialPlan: true
    },
    limits: {
      tokenBudgetPercent: 24,
      costDrivingToolsPercent: 18,
      activeWebChatsPercent: 30,
      tasksExcludedFromCommercialQuotas: true
    },
    updatedAt: "2026-03-26T12:00:00.000Z"
  };
}

function makeAdminPlanVisibility() {
  return {
    planState: {
      effectivePlanCode: "starter_trial",
      effectivePlanDisplayName: "Starter Trial",
      effectivePlanStatus: "active" as const,
      defaultRegistrationPlanCode: "starter_trial",
      totalPlans: 2,
      activePlans: 1,
      inactivePlans: 1
    },
    usagePressure: {
      tokenBudgetPercent: 24,
      costDrivingToolsPercent: 18,
      activeWebChatsPercent: 30,
      pressureLevel: "low" as const
    },
    effectiveEntitlements: {
      toolClasses: {
        costDrivingAllowed: false,
        utilityAllowed: true
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      },
      governedFeatures: {
        memoryCenter: true,
        tasksCenter: true,
        viewLimitPercentages: true,
        tasksExcludedFromCommercialQuotas: true
      }
    },
    updatedAt: "2026-03-26T12:00:00.000Z"
  };
}

function makeAdminOpsCockpit() {
  return {
    assistant: {
      exists: true,
      assistantId: "assistant-1",
      workspaceId: "ws-1",
      latestPublishedVersion: {
        id: "pub-2",
        version: 2,
        publishedAt: "2026-03-23T10:05:00.000Z"
      },
      runtimeApply: {
        status: "succeeded" as const,
        targetPublishedVersionId: "pub-2",
        appliedPublishedVersionId: "pub-2",
        requestedAt: "2026-03-23T10:05:01.000Z",
        startedAt: "2026-03-23T10:05:02.000Z",
        finishedAt: "2026-03-23T10:05:03.000Z",
        error: null
      }
    },
    runtime: {
      adapterEnabled: true,
      openclawBaseUrlHost: "openclaw:18789",
      preflight: {
        live: true,
        ready: true,
        checkedAt: "2026-03-26T12:00:00.000Z"
      }
    },
    controls: {
      reapplySupported: true,
      restartSupported: false
    },
    incidentSignals: [],
    updatedAt: "2026-03-26T12:00:00.000Z"
  };
}

function makeAdminBusinessCockpit() {
  return {
    activeAssistants: {
      totalAssistants: 4,
      activeAssistants: 3,
      publishedAssistants: 4
    },
    activeChats: {
      activeWebChats: 12,
      totalWebChats: 22
    },
    channelSplit: {
      channels: [
        { channel: "web_chat" as const, value: 12, percent: 80 },
        { channel: "telegram" as const, value: 3, percent: 20 },
        { channel: "whatsapp" as const, value: 0, percent: 0 },
        { channel: "max" as const, value: 0, percent: 0 }
      ]
    },
    publishApplySuccess: {
      window: "last_7_days" as const,
      publishedVersionEvents: 8,
      applySucceeded: 6,
      applyDegraded: 1,
      applyFailed: 1,
      applySuccessPercent: 75
    },
    quotaPressure: {
      tokenBudgetPercent: 24,
      costDrivingToolsPercent: 18,
      activeWebChatsPercent: 30,
      pressureLevel: "low" as const
    },
    planUsageSnapshot: {
      effectivePlanCode: "starter_trial",
      effectivePlanDisplayName: "Starter Trial",
      effectivePlanStatus: "active" as const,
      defaultRegistrationPlanCode: "starter_trial",
      totalPlans: 2,
      activePlans: 1,
      inactivePlans: 1
    },
    updatedAt: "2026-03-26T12:00:00.000Z"
  };
}

function makeAdminNotificationChannels() {
  return [
    {
      channelType: "webhook" as const,
      status: "active" as const,
      endpointUrl: "https://ops.example.com/persai/admin-alerts",
      hasSigningSecret: true,
      updatedAt: "2026-03-26T12:00:00.000Z",
      lastDelivery: {
        deliveryStatus: "succeeded" as const,
        attemptedAt: "2026-03-26T12:10:00.000Z",
        errorMessage: null
      }
    }
  ];
}

describe("AppFlowClient onboarding gate", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-user-1");
    assistantApiMocks.postAssistantCreate.mockReset();
    assistantApiMocks.getAssistantWebChats.mockReset();
    assistantApiMocks.patchAssistantDraft.mockReset();
    assistantApiMocks.patchAssistantWebChat.mockReset();
    assistantApiMocks.postAssistantPublish.mockReset();
    assistantApiMocks.postAssistantRollback.mockReset();
    assistantApiMocks.postAssistantReset.mockReset();
    assistantApiMocks.postAssistantWebChatArchive.mockReset();
    assistantApiMocks.deleteAssistantWebChat.mockReset();
    assistantApiMocks.streamAssistantWebChatTurn.mockReset();
    assistantApiMocks.getAssistantMemoryItems.mockReset();
    assistantApiMocks.getAssistantTelegramIntegration.mockReset();
    assistantApiMocks.getAssistantPlanVisibility.mockReset();
    assistantApiMocks.postAssistantMemoryItemForget.mockReset();
    assistantApiMocks.postAssistantMemoryDoNotRemember.mockReset();
    assistantApiMocks.getAssistantTaskItems.mockReset();
    assistantApiMocks.getAdminPlans.mockReset();
    assistantApiMocks.getAdminNotificationChannels.mockReset();
    assistantApiMocks.getAdminBusinessCockpit.mockReset();
    assistantApiMocks.getAdminOpsCockpit.mockReset();
    assistantApiMocks.getAdminPlanVisibility.mockReset();
    assistantApiMocks.postAdminPlanCreate.mockReset();
    assistantApiMocks.patchAdminPlan.mockReset();
    assistantApiMocks.patchAdminNotificationWebhookChannel.mockReset();
    assistantApiMocks.postAssistantReapply.mockReset();
    assistantApiMocks.postAssistantTaskItemDisable.mockReset();
    assistantApiMocks.postAssistantTaskItemEnable.mockReset();
    assistantApiMocks.postAssistantTaskItemCancel.mockReset();
    assistantApiMocks.postAssistantTelegramConnect.mockReset();
    assistantApiMocks.patchAssistantTelegramConfig.mockReset();
    assistantApiMocks.getAssistantWebChats.mockResolvedValue([]);
    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([]);
    assistantApiMocks.getAssistantTelegramIntegration.mockResolvedValue(makeTelegramIntegrationState());
    assistantApiMocks.getAssistantPlanVisibility.mockResolvedValue(makeUserPlanVisibility());
    assistantApiMocks.getAssistantTaskItems.mockResolvedValue([]);
    assistantApiMocks.getAdminPlans.mockResolvedValue([]);
    assistantApiMocks.getAdminNotificationChannels.mockResolvedValue(makeAdminNotificationChannels());
    assistantApiMocks.getAdminBusinessCockpit.mockResolvedValue(makeAdminBusinessCockpit());
    assistantApiMocks.getAdminOpsCockpit.mockResolvedValue(makeAdminOpsCockpit());
    assistantApiMocks.getAdminPlanVisibility.mockResolvedValue(makeAdminPlanVisibility());
  });

  it("shows onboarding gate when /me returns pending", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("pending"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Onboarding required")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.queryByText("Me")).not.toBeInTheDocument();
  });

  it("shows assistant dashboard when /me returns completed", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant dashboard")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Global publish and status bar")).toBeInTheDocument();
    });
    expect(screen.getByText("Assistant editor")).toBeInTheDocument();
    expect(screen.getAllByText("Persona").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Memory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tasks").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tools & Integrations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Channels").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Limits & Safety Summary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Publish History").length).toBeGreaterThan(0);
    expect(screen.getByText("Assistant summary")).toBeInTheDocument();
    expect(screen.getAllByText("v2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("succeeded").length).toBeGreaterThan(0);
    expect(screen.getByText("Publish state:")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Apply state:")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Rollback available:")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("Assistant setup paths")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quick start", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quick start path" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced setup path" })).toBeInTheDocument();
    expect(screen.getByText("Lifecycle safety controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rollback to selected version" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset assistant" })).toBeInTheDocument();
    expect(screen.getByText("Assistant activity and updates")).toBeInTheDocument();
    expect(screen.getByText("Plan and limits visibility")).toBeInTheDocument();
    expect(screen.getAllByText("Token budget:").length).toBeGreaterThan(0);
    expect(screen.getAllByText("24%").length).toBeGreaterThan(0);
    expect(screen.getByText("Admin plan visibility")).toBeInTheDocument();
    expect(screen.getByText("Admin system notifications")).toBeInTheDocument();
    expect(screen.getByText("Configured channels")).toBeInTheDocument();
    expect(screen.getByText("Business cockpit")).toBeInTheDocument();
    expect(screen.getByText("Channel split")).toBeInTheDocument();
    expect(screen.getByText("Ops cockpit")).toBeInTheDocument();
    expect(screen.getByText("Runtime preflight:")).toBeInTheDocument();
    expect(screen.getByText("Usage pressure:")).toBeInTheDocument();
    expect(screen.getByText("Update:")).toBeInTheDocument();
    expect(screen.getByText("Assistant is live after the latest apply.")).toBeInTheDocument();
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
  });

  it("shows Tasks Center active and inactive groups when task items load", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    const nextRun = new Date("2026-03-28T15:30:00.000Z").toISOString();
    assistantApiMocks.getAssistantTaskItems.mockResolvedValue([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Daily check-in",
        sourceSurface: "web",
        sourceLabel: "Web assistant",
        controlStatus: "active",
        nextRunAt: nextRun,
        createdAt: "2026-03-26T10:00:00.000Z",
        updatedAt: "2026-03-26T10:00:00.000Z"
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Weekly recap",
        sourceSurface: "web",
        sourceLabel: null,
        controlStatus: "disabled",
        nextRunAt: null,
        createdAt: "2026-03-25T10:00:00.000Z",
        updatedAt: "2026-03-25T12:00:00.000Z"
      }
    ]);

    render(<AppFlowClient />);

    expect(await screen.findByText("Daily check-in")).toBeInTheDocument();
    expect(screen.getByText("Weekly recap")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText(/Next run:/i)).toBeInTheDocument();
  });

  it("shows create assistant control when assistant is absent", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(null);

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant entity:")).toBeInTheDocument();
    expect(screen.getByText("not created")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create assistant" })).toBeInTheDocument();
    expect(screen.queryByText("Assistant editor")).not.toBeInTheDocument();
  });

  it("applies quick start path to assistant draft without publishing", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.patchAssistantDraft.mockResolvedValue(
      makeAssistantResponseWithDraft("Field Ops Copilot", "Act as a personal assistant for the current user.")
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant setup paths")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Assistant display name"), {
      target: { value: "Field Ops Copilot" }
    });
    fireEvent.change(screen.getByLabelText("Primary goal"), {
      target: { value: "Keep me focused on priority tasks" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply quick start to draft" }));

    await waitFor(() => {
      expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(1);
    });
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledWith(
      "token-user-1",
      expect.objectContaining({
        instructions: expect.stringContaining("Primary goal: Keep me focused on priority tasks.")
      })
    );
    expect(screen.getByText("Draft setup saved. No publish has been performed.")).toBeInTheDocument();
  });

  it("shows admin plan management and creates a plan", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.postAdminPlanCreate.mockResolvedValue({
      code: "pro",
      displayName: "Pro",
      description: null,
      status: "active",
      defaultOnRegistration: false,
      trialEnabled: false,
      trialDurationDays: null,
      metadata: { commercialTag: null, notes: null },
      entitlements: {
        capabilities: {
          assistantLifecycle: true,
          memoryCenter: true,
          tasksCenter: true
        },
        toolClasses: {
          costDrivingTools: true,
          utilityTools: true,
          costDrivingQuotaGoverned: true,
          utilityQuotaGoverned: true
        },
        channelsAndSurfaces: {
          webChat: true,
          telegram: true,
          whatsapp: false,
          max: false
        },
        limitsPermissions: {
          viewLimitPercentages: true,
          tasksExcludedFromCommercialQuotas: true
        }
      },
      createdAt: "2026-03-26T10:00:00.000Z",
      updatedAt: "2026-03-26T10:00:00.000Z"
    });

    render(<AppFlowClient />);

    expect(await screen.findByText("Admin plan management")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Plan code"), { target: { value: "pro" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAdminPlanCreate).toHaveBeenCalledTimes(1);
    });
  });

  it("updates admin webhook notification channel", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.patchAdminNotificationWebhookChannel.mockResolvedValue({
      channelType: "webhook",
      status: "active",
      endpointUrl: "https://ops.example.com/persai/updated",
      hasSigningSecret: true,
      updatedAt: "2026-03-26T12:30:00.000Z",
      lastDelivery: null
    });

    render(<AppFlowClient />);

    expect(await screen.findByText("Admin system notifications")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Webhook endpoint URL"), {
      target: { value: "https://ops.example.com/persai/updated" }
    });
    fireEvent.change(screen.getByLabelText("Signing secret (optional)"), {
      target: { value: "secret-123" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save webhook channel" }));

    await waitFor(() => {
      expect(assistantApiMocks.patchAdminNotificationWebhookChannel).toHaveBeenCalledTimes(1);
    });
  });

  it("applies advanced setup path to draft and auto-creates assistant when absent", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(null);
    assistantApiMocks.postAssistantCreate.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.patchAssistantDraft.mockResolvedValue(
      makeAssistantResponseWithDraft("Analyst Assistant", "Follow explicit daily planning instructions.")
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant setup paths")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Advanced setup path" }));
    fireEvent.change(screen.getByLabelText("Assistant display name"), {
      target: { value: "Analyst Assistant" }
    });
    fireEvent.change(screen.getByLabelText("Draft instructions"), {
      target: { value: "Follow explicit daily planning instructions." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply advanced setup to draft" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantCreate).toHaveBeenCalledTimes(1);
      expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Draft setup saved. No publish has been performed.")).toBeInTheDocument();
  });

  it("publishes draft and keeps apply state separate", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponseWithApplyStatus("failed"));
    assistantApiMocks.postAssistantPublish.mockResolvedValue(
      makeAssistantResponseWithApplyStatus("pending")
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Publish draft")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish draft" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Publish requested. Apply state is tracked separately.")).toBeInTheDocument();
    expect(screen.getByText("Applying")).toBeInTheDocument();
  });

  it("reapplies latest published version from ops cockpit", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.postAssistantReapply.mockResolvedValue(makeAssistantResponseWithApplyStatus("pending"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Ops cockpit")).toBeInTheDocument();
    const reapplyButton = await screen.findByRole("button", {
      name: "Reapply latest published version"
    });
    fireEvent.click(reapplyButton);

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantReapply).toHaveBeenCalledTimes(1);
    });
  });

  it("shows recovery-worthy update marker when apply fails", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponseWithApplyStatus("failed"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant activity and updates")).toBeInTheDocument();
    expect(screen.getByText("Attention:")).toBeInTheDocument();
    expect(
      screen.getByText("Latest apply needs attention. Consider rollback if a previous version was stable.")
    ).toBeInTheDocument();
  });

  it("shows no visible marker message when no meaningful update exists", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponseWithoutVisibleUpdates());

    render(<AppFlowClient />);

    expect(await screen.findByText("Assistant activity and updates")).toBeInTheDocument();
    expect(screen.getByText("No visible assistant updates right now.")).toBeInTheDocument();
  });

  it("rolls back to selected published version", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.postAssistantRollback.mockResolvedValue(makeAssistantResponseWithApplyStatus("pending"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Lifecycle safety controls")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target version"), {
      target: { value: "1" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Rollback to selected version" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantRollback).toHaveBeenCalledTimes(1);
    });
    expect(assistantApiMocks.postAssistantRollback).toHaveBeenCalledWith("token-user-1", {
      targetVersion: 1
    });
    expect(
      screen.getByText("Rollback requested. A new published version was created from the selected target.")
    ).toBeInTheDocument();
  });

  it("requires explicit confirmation before reset", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());

    render(<AppFlowClient />);

    expect(await screen.findByText("Lifecycle safety controls")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset assistant" }));
    expect(await screen.findByText(/Confirm reset by checking the box and typing RESET/)).toBeInTheDocument();
    expect(assistantApiMocks.postAssistantReset).not.toHaveBeenCalled();
  });

  it("resets assistant after explicit confirmation", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.postAssistantReset.mockResolvedValue(
      makeAssistantResponseWithDraft(null, null)
    );

    render(<AppFlowClient />);

    expect(await screen.findByText("Lifecycle safety controls")).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText(
        "I understand reset changes assistant content and cannot be undone from this screen."
      )
    );
    fireEvent.change(screen.getByLabelText("Type RESET to confirm"), {
      target: { value: "RESET" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset assistant" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantReset).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Reset requested\./)).toBeInTheDocument();
  });

  it("connects telegram from integrations area", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));
    assistantApiMocks.getAssistant.mockResolvedValue(makeAssistantResponse());
    assistantApiMocks.postAssistantTelegramConnect.mockResolvedValue(
      makeConnectedTelegramIntegrationState()
    );

    render(<AppFlowClient />);

    expect((await screen.findAllByText("Tools & Integrations")).length).toBeGreaterThan(0);
    fireEvent.change(await screen.findByLabelText("Telegram bot token"), {
      target: { value: "123456:ABCDEF01234567890123" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantTelegramConnect).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Telegram bot connected.")).toBeInTheDocument();
    expect(screen.getByText("PersAI Bot")).toBeInTheDocument();
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThanOrEqual(2);
  });
});
