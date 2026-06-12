import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { AssistantLifecycleState, AssistantMemoryRegistryItemState } from "@persai/contracts";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import ruMessages from "../../../messages/ru.json";

import { AssistantSettings, mergeMemoryViews } from "./assistant-settings";
import { AssistantSettingsApkFooter } from "./assistant-settings-apk-footer";
import type { AppData } from "./use-app-data";
import type { WorkspaceMemoryItem } from "../assistant-api-client";
import { ApiStructuredError } from "../assistant-api-client";

const billingRecurringMigrationIdle = {
  status: "idle" as const,
  targetMethodClass: null,
  failureReason: null,
  updatedAt: null
};

const billingRecurringMigrationFailed = {
  status: "failed" as const,
  targetMethodClass: "sbp_qr" as const,
  failureReason: "provider_sbp_recurring_not_confirmed",
  updatedAt: "2026-05-10T17:00:00.000Z"
};

const clerkMocks = vi.hoisted(() => ({
  isLoaded: true,
  getToken: vi.fn()
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  getAssistantMemoryItems: vi.fn(),
  getAssistantTaskItems: vi.fn(),
  getAssistantBackgroundTaskItems: vi.fn(),
  getAssistantVoiceSettings: vi.fn(),
  patchAssistantElevenLabsVoiceCuration: vi.fn(),
  postAssistantElevenLabsVoiceCatalogRefresh: vi.fn(),
  getWorkspaceMemoryItems: vi.fn(),
  searchWorkspaceMemory: vi.fn(),
  addWorkspaceMemoryItem: vi.fn(),
  forgetWorkspaceMemoryItem: vi.fn(),
  postAssistantMemoryItemForget: vi.fn(),
  postAssistantMemoryItemCloseOpenLoop: vi.fn(),
  postAssistantTaskItemDisable: vi.fn(),
  postAssistantTaskItemCancel: vi.fn(),
  patchAssistantNotificationPreference: vi.fn(),
  patchAssistantDraft: vi.fn(),
  postAssistantPublish: vi.fn(),
  postAssistantRollback: vi.fn(),
  postAssistantReset: vi.fn(),
  getAssistantFiles: vi.fn(),
  cleanupAssistantFilesCache: vi.fn(),
  patchAssistantFileDisplayName: vi.fn(),
  deleteAssistantFile: vi.fn(),
  uploadAssistantAvatar: vi.fn(),
  getAssistantBillingSubscription: vi.fn(),
  postAssistantBillingEnableAutoRenew: vi.fn(),
  postAssistantBillingDisableAutoRenew: vi.fn(),
  postAssistantBillingChangePlan: vi.fn(),
  getWorkspaceVideoPersonas: vi.fn(),
  getWorkspaceVideoClonedVoices: vi.fn(),
  getWorkspaceVoiceCatalog: vi.fn(),
  createWorkspaceVideoClonedVoice: vi.fn(),
  createWorkspaceVideoPersona: vi.fn(),
  updateWorkspaceVideoPersona: vi.fn(),
  deleteWorkspaceVideoPersona: vi.fn(),
  archiveWorkspaceVideoClonedVoice: vi.fn(),
  setWorkspaceVideoClonedVoiceDefault: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken,
    isLoaded: clerkMocks.isLoaded
  })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
  usePathname: () => "/app/chat"
}));

vi.mock("../assistant-api-client", async () => {
  const actual =
    await vi.importActual<typeof import("../assistant-api-client")>("../assistant-api-client");
  return {
    ...actual,
    getAssistantMemoryItems: assistantApiMocks.getAssistantMemoryItems,
    getAssistantTaskItems: assistantApiMocks.getAssistantTaskItems,
    getAssistantBackgroundTaskItems: assistantApiMocks.getAssistantBackgroundTaskItems,
    getAssistantVoiceSettings: assistantApiMocks.getAssistantVoiceSettings,
    patchAssistantElevenLabsVoiceCuration: assistantApiMocks.patchAssistantElevenLabsVoiceCuration,
    postAssistantElevenLabsVoiceCatalogRefresh:
      assistantApiMocks.postAssistantElevenLabsVoiceCatalogRefresh,
    getWorkspaceMemoryItems: assistantApiMocks.getWorkspaceMemoryItems,
    searchWorkspaceMemory: assistantApiMocks.searchWorkspaceMemory,
    addWorkspaceMemoryItem: assistantApiMocks.addWorkspaceMemoryItem,
    forgetWorkspaceMemoryItem: assistantApiMocks.forgetWorkspaceMemoryItem,
    postAssistantMemoryItemForget: assistantApiMocks.postAssistantMemoryItemForget,
    postAssistantMemoryItemCloseOpenLoop: assistantApiMocks.postAssistantMemoryItemCloseOpenLoop,
    postAssistantTaskItemDisable: assistantApiMocks.postAssistantTaskItemDisable,
    postAssistantTaskItemCancel: assistantApiMocks.postAssistantTaskItemCancel,
    patchAssistantNotificationPreference: assistantApiMocks.patchAssistantNotificationPreference,
    patchAssistantDraft: assistantApiMocks.patchAssistantDraft,
    postAssistantPublish: assistantApiMocks.postAssistantPublish,
    postAssistantRollback: assistantApiMocks.postAssistantRollback,
    postAssistantReset: assistantApiMocks.postAssistantReset,
    getAssistantFiles: assistantApiMocks.getAssistantFiles,
    cleanupAssistantFilesCache: assistantApiMocks.cleanupAssistantFilesCache,
    patchAssistantFileDisplayName: assistantApiMocks.patchAssistantFileDisplayName,
    deleteAssistantFile: assistantApiMocks.deleteAssistantFile,
    uploadAssistantAvatar: assistantApiMocks.uploadAssistantAvatar,
    getAssistantBillingSubscription: assistantApiMocks.getAssistantBillingSubscription,
    postAssistantBillingEnableAutoRenew: assistantApiMocks.postAssistantBillingEnableAutoRenew,
    postAssistantBillingDisableAutoRenew: assistantApiMocks.postAssistantBillingDisableAutoRenew,
    postAssistantBillingChangePlan: assistantApiMocks.postAssistantBillingChangePlan,
    getWorkspaceVideoPersonas: assistantApiMocks.getWorkspaceVideoPersonas,
    getWorkspaceVideoClonedVoices: assistantApiMocks.getWorkspaceVideoClonedVoices,
    getWorkspaceVoiceCatalog: assistantApiMocks.getWorkspaceVoiceCatalog,
    createWorkspaceVideoClonedVoice: assistantApiMocks.createWorkspaceVideoClonedVoice,
    createWorkspaceVideoPersona: assistantApiMocks.createWorkspaceVideoPersona,
    updateWorkspaceVideoPersona: assistantApiMocks.updateWorkspaceVideoPersona,
    deleteWorkspaceVideoPersona: assistantApiMocks.deleteWorkspaceVideoPersona,
    archiveWorkspaceVideoClonedVoice: assistantApiMocks.archiveWorkspaceVideoClonedVoice,
    setWorkspaceVideoClonedVoiceDefault: assistantApiMocks.setWorkspaceVideoClonedVoiceDefault
  };
});

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("./assistant-knowledge-manager", () => ({
  AssistantKnowledgeManager: () => null
}));

vi.mock("./image-lightbox", () => ({
  ImageLightbox: ({ open, alt }: { open: boolean; alt?: string }) =>
    open ? <div data-testid="files-image-lightbox">{alt}</div> : null
}));

function makeAssistantState(): AssistantLifecycleState {
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    draft: {
      displayName: "Nova",
      instructions: "Warm and helpful.",
      traits: {
        formality: 50,
        verbosity: 50,
        playfulness: 50,
        initiative: 50,
        warmth: 50
      },
      archetypeKey: "warm-quiet",
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: "female",
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "ru-RU",
        deliveryKind: "voice_note",
        elevenlabs: { voiceId: null },
        yandex: { voice: "jane", role: "friendly" },
        openai: { voice: "marin" }
      },
      updatedAt: "2026-04-01T10:00:00.000Z"
    },
    latestPublishedVersion: null,
    runtimeApply: {
      status: "not_requested",
      targetPublishedVersionId: null,
      appliedPublishedVersionId: null,
      requestedAt: null,
      startedAt: null,
      finishedAt: null,
      error: null
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      runtimeTierOverride: null,
      memoryControl: null,
      tasksControl: null,
      quotaPlanCode: null,
      quotaHook: null,
      auditHook: null,
      platformManagedUpdatedAt: null
    },
    materialization: {
      latestSpecId: null,
      publishedVersionId: null,
      sourceAction: null,
      algorithmVersion: null,
      contentHash: null,
      generatedAt: null,
      runtimeAssignment: null,
      assistantConfigDocument: null,
      assistantWorkspaceDocument: null
    },
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T10:00:00.000Z"
  };
}

function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return {
    assistant: makeAssistantState(),
    assistants: [],
    activeAssistantId: null,
    assistantLimit: null,
    assistantStatus: "live",
    assistantResolved: true,
    chats: [],
    telegram: null,
    notificationPreference: { selectedChannel: "web", availableChannels: ["web"] },
    plan: null,
    billingSubscription: null,
    isAdmin: false,
    isLoading: false,
    isReloading: false,
    isReloadingChats: false,
    error: null,
    reload: vi.fn(),
    reloadChats: vi.fn(),
    createAssistant: vi.fn(),
    switchAssistant: vi.fn(),
    ...overrides
  } as AppData;
}

function registry(
  overrides: Partial<AssistantMemoryRegistryItemState>
): AssistantMemoryRegistryItemState {
  return {
    id: "registry-1",
    summary: "Default summary",
    sourceType: "assistant",
    sourceLabel: null,
    memoryClass: "core",
    kind: null,
    createdAt: "2026-04-01T10:00:00.000Z",
    chatId: null,
    resolvedAt: null,
    ...overrides
  } as AssistantMemoryRegistryItemState;
}

function workspace(overrides: Partial<WorkspaceMemoryItem>): WorkspaceMemoryItem {
  return {
    id: "ws-1",
    content: "Default workspace content",
    createdAt: "2026-04-01T10:00:00.000Z",
    source: "user",
    ...overrides
  } as WorkspaceMemoryItem;
}

function renderSettings(
  data: AppData = makeAppData(),
  section = "character",
  extraProps: Partial<ComponentProps<typeof AssistantSettings>> = {}
): void {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantSettings data={data} initialSection={section} {...extraProps} />
    </NextIntlClientProvider>
  );
}

function withIntl(node: ReactNode): ReactNode {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; the Section component calls
  // it on mount when expanded. Stub it before each test render.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn()
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn().mockReturnValue("blob:test-default")
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn()
  });
  clerkMocks.isLoaded = true;
  clerkMocks.getToken.mockResolvedValue("token-1");
  assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([]);
  assistantApiMocks.getAssistantTaskItems.mockResolvedValue([]);
  assistantApiMocks.getAssistantBackgroundTaskItems.mockResolvedValue([]);
  assistantApiMocks.getAssistantVoiceSettings.mockResolvedValue({
    schema: "persai.assistantVoiceSettings.v1",
    primaryProviderId: "openai",
    elevenlabs: null
  });
  assistantApiMocks.patchAssistantElevenLabsVoiceCuration.mockResolvedValue({
    schema: "persai.assistantVoiceSettings.v1",
    primaryProviderId: "openai",
    elevenlabs: null
  });
  assistantApiMocks.postAssistantElevenLabsVoiceCatalogRefresh.mockResolvedValue({
    schema: "persai.assistantVoiceSettings.v1",
    primaryProviderId: "openai",
    elevenlabs: null
  });
  assistantApiMocks.getWorkspaceMemoryItems.mockResolvedValue([]);
  assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
    planCode: null,
    planDisplayName: null,
    subscriptionStatus: "unconfigured",
    billingProvider: null,
    providerSubscriptionRef: null,
    autoRenewEnabled: false,
    canDisableAutoRenew: false,
    nextChargeAt: null,
    currentPeriodEndsAt: null,
    lastPaymentMethodLabel: null,
    autoRenewMethodLabel: null,
    recurringMigration: billingRecurringMigrationIdle,
    managePaymentMethodUrl: null,
    managePaymentMethodMode: "unavailable",
    cancelUrl: null,
    warning: null
  });
  assistantApiMocks.postAssistantBillingEnableAutoRenew.mockResolvedValue({
    mode: "subscription_updated",
    subscription: {
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: true,
      canEnableAutoRenew: false,
      canDisableAutoRenew: true,
      nextChargeAt: "2026-06-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-06-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_portal",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      scheduledPlanChange: null,
      warning: null
    }
  });
  assistantApiMocks.postAssistantBillingDisableAutoRenew.mockResolvedValue({
    planCode: "pro",
    planDisplayName: "Pro",
    subscriptionStatus: "active",
    billingProvider: "cloudpayments",
    providerSubscriptionRef: "sub-provider-1",
    autoRenewEnabled: false,
    canDisableAutoRenew: false,
    nextChargeAt: null,
    currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
    lastPaymentMethodLabel: "Bank card",
    autoRenewMethodLabel: null,
    recurringMigration: billingRecurringMigrationIdle,
    managePaymentMethodUrl: "https://my.cloudpayments.ru/",
    managePaymentMethodMode: "provider_portal",
    cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
    warning: null
  });
  assistantApiMocks.getAssistantFiles.mockResolvedValue({
    files: [],
    cleanup: { eligibleCount: 0, eligibleBytes: 0 }
  });
  assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
    personas: [],
    limit: 3,
    creationVcoinCost: 20
  });
  assistantApiMocks.getWorkspaceVideoClonedVoices.mockResolvedValue({
    clonedVoices: [],
    limit: 5,
    creationVcoinCost: 50
  });
  assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
    provider: "heygen",
    voices: []
  });
  assistantApiMocks.createWorkspaceVideoClonedVoice.mockResolvedValue({
    clonedVoice: {
      id: "clone-1",
      displayName: "Brand Voice",
      status: "ready",
      languageHint: "en",
      isDefault: false,
      previewAudioUrl: null,
      createdAt: new Date().toISOString()
    },
    walletBalanceVc: 60
  });
  assistantApiMocks.createWorkspaceVideoPersona.mockResolvedValue({
    persona: {
      id: "persona-1",
      displayName: "Test",
      portraitImageUrl: "/api/persona-portrait/ws-1/persona-1/hash.jpg",
      videoFormat: "1:1",
      heygenVoiceId: "en-US-Amy",
      heygenVoiceLabel: "Amy",
      clonedVoiceId: null,
      clonedVoiceDisplayName: null,
      createdAt: new Date().toISOString()
    },
    walletBalanceVc: 80,
    storageWarning: null
  });
  assistantApiMocks.updateWorkspaceVideoPersona.mockResolvedValue({
    persona: {
      id: "persona-1",
      displayName: "Test",
      portraitImageUrl: "/api/persona-portrait/ws-1/persona-1/hash.jpg",
      videoFormat: "1:1",
      heygenVoiceId: "en-US-Amy",
      heygenVoiceLabel: "Amy",
      clonedVoiceId: null,
      clonedVoiceDisplayName: null,
      createdAt: new Date().toISOString()
    }
  });
  assistantApiMocks.deleteWorkspaceVideoPersona.mockResolvedValue(undefined);
  assistantApiMocks.archiveWorkspaceVideoClonedVoice.mockResolvedValue(undefined);
  assistantApiMocks.setWorkspaceVideoClonedVoiceDefault.mockResolvedValue({
    id: "clone-1",
    displayName: "Brand Voice",
    status: "ready",
    languageHint: "en",
    isDefault: true,
    previewAudioUrl: null,
    createdAt: new Date().toISOString()
  });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { PersaiNative?: unknown }).PersaiNative;
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// mergeMemoryViews — pure dedup + tab-routing logic. ADR-074 Slice M3.3.
// ---------------------------------------------------------------------------

describe("mergeMemoryViews (ADR-074 M3.3 — Memory Center merge + dedup)", () => {
  it("routes structured registry rows (fact/preference/open_loop) to the Workspace tab", () => {
    const items: AssistantMemoryRegistryItemState[] = [
      registry({ id: "r-fact", summary: "User likes oat milk", kind: "fact" }),
      registry({ id: "r-pref", summary: "Prefers morning standups", kind: "preference" }),
      registry({ id: "r-loop", summary: "Open question about pricing", kind: "open_loop" })
    ];

    const { workspace, history } = mergeMemoryViews(items, []);

    expect(workspace.map((row) => row.key)).toEqual([
      "registry:r-fact",
      "registry:r-pref",
      "registry:r-loop"
    ]);
    expect(history).toEqual([]);
  });

  it("routes registry rows with kind=null to the History tab only", () => {
    const items: AssistantMemoryRegistryItemState[] = [
      registry({ id: "r-1", summary: "Mentioned project Aurora", kind: null }),
      registry({ id: "r-2", summary: "Sent a screenshot", kind: null })
    ];

    const { workspace, history } = mergeMemoryViews(items, []);

    expect(workspace).toEqual([]);
    expect(history.map((row) => row.key)).toEqual(["registry:r-1", "registry:r-2"]);
  });

  it("dedups workspace echoes against structured registry rows by normalized text", () => {
    const items: AssistantMemoryRegistryItemState[] = [
      registry({ id: "r-pers", summary: "PERSAI в реале для user", kind: "fact" })
    ];
    const ws: WorkspaceMemoryItem[] = [
      workspace({ id: "ws-pers", content: "  PERSAI В РЕАЛЕ для USER.  " }),
      workspace({ id: "ws-extra", content: "Likes very dark coffee" })
    ];

    const { workspace: merged } = mergeMemoryViews(items, ws);

    expect(merged.map((row) => row.key)).toEqual(["registry:r-pers", "workspace:ws-extra"]);
  });

  it("keeps a workspace row even if a kind=null history row has the same normalized text", () => {
    // History rows are routed elsewhere and must NOT swallow workspace rows.
    const items: AssistantMemoryRegistryItemState[] = [
      registry({ id: "r-history", summary: "PERSAI в реале для user", kind: null })
    ];
    const ws: WorkspaceMemoryItem[] = [
      workspace({ id: "ws-pers", content: "PERSAI в реале для user" })
    ];

    const { workspace: merged, history } = mergeMemoryViews(items, ws);

    expect(merged.map((row) => row.key)).toEqual(["workspace:ws-pers"]);
    expect(history.map((row) => row.key)).toEqual(["registry:r-history"]);
  });

  it("normalizes lowercase, whitespace and trailing dots when deduping", () => {
    const items: AssistantMemoryRegistryItemState[] = [
      registry({ id: "r-1", summary: "hello   world", kind: "fact" })
    ];
    const ws: WorkspaceMemoryItem[] = [
      workspace({ id: "ws-1", content: "Hello World." }),
      workspace({ id: "ws-2", content: "Hello\tworld" }) // tab-separated — also collapses
    ];

    const { workspace: merged } = mergeMemoryViews(items, ws);

    expect(merged.map((row) => row.key)).toEqual(["registry:r-1"]);
  });
});

describe("AssistantSettings character CTA", () => {
  it("uses the shorter customize label in the character section", () => {
    renderSettings(makeAppData(), "character");

    expect(screen.getByRole("button", { name: "Customize" })).toBeInTheDocument();
  }, 10000);

  it("moves memory and recreate into character actions and opens dedicated overlays", async () => {
    renderSettings(makeAppData(), "character");

    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    expect(screen.getByText("Quick actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Character tuning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recreate" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(await screen.findByRole("dialog", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search memories...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recreate" }));
    expect(await screen.findByRole("dialog", { name: "Recreate" })).toBeInTheDocument();
    expect(screen.getByText(/delete chats, memory, and assistant settings/i)).toBeInTheDocument();
  });

  it("shows avatar presets without visible name labels in assistant settings", () => {
    renderSettings(makeAppData(), "character");

    fireEvent.click(screen.getByRole("button", { name: /change avatar/i }));

    expect(screen.getByRole("button", { name: "PersAI" })).toBeInTheDocument();
    expect(screen.queryByText("PersAI")).toBeNull();
    expect(screen.queryByText("Luma")).toBeNull();
    expect(screen.queryByText("Theo")).toBeNull();
  });
});

describe("AssistantSettingsApkFooter", () => {
  it("shows the Android release download banner in settings", () => {
    render(withIntl(<AssistantSettingsApkFooter />));

    expect(screen.getByRole("link", { name: /Download Android APK/i })).toHaveAttribute(
      "href",
      "/mobile/persai-android-release.apk"
    );
  });

  it("uses update copy for the Android release action in the native shell", async () => {
    (window as unknown as { PersaiNative?: unknown }).PersaiNative = {};

    render(withIntl(<AssistantSettingsApkFooter />));

    expect(await screen.findByRole("link", { name: "Update app" })).toHaveAttribute(
      "href",
      "/mobile/persai-android-release.apk"
    );
  });
});

describe("AssistantSettings Files", () => {
  it("renders a compact scrollable Files section with download-first file actions", async () => {
    assistantApiMocks.getAssistantFiles.mockResolvedValue({
      files: Array.from({ length: 12 }, (_, index) => ({
        fileRef: `file-ref-${index}`,
        origin:
          index % 3 === 0
            ? "uploaded_attachment"
            : index % 3 === 1
              ? "runtime_output"
              : "sandbox_output",
        displayName:
          index === 1 ? "Image 1.png" : index === 2 ? "Video 2.mp4" : `Spec ${index}.pdf`,
        filename: index === 1 ? "image-1.png" : index === 2 ? "video-2.mp4" : `file-${index}.pdf`,
        mimeType: index === 1 ? "image/png" : index === 2 ? "video/mp4" : "application/pdf",
        sizeBytes: 1024 + index,
        logicalSizeBytes: 1024 + index,
        fileBucket:
          index === 2
            ? "media_uploads"
            : index % 4 === 0
              ? "user_files"
              : index % 4 === 1
                ? "assistant_created"
                : index % 4 === 2
                  ? "documents"
                  : "media_uploads",
        cleanupEligible: false,
        cleanupReason: null,
        createdAt: "2026-05-02T00:00:00.000Z"
      })),
      cleanup: { eligibleCount: 0, eligibleBytes: 0 }
    });

    renderSettings(makeAppData(), "files");

    await waitFor(() => {
      expect(assistantApiMocks.getAssistantFiles).toHaveBeenCalledWith("token-1", {
        query: "",
        limit: 100
      });
    });
    expect(screen.getByText("Assistant files")).toBeInTheDocument();
    const mediaBucket = screen.getByText("Media");
    const documentsBucket = screen.getByText("Documents");
    const assistantBucket = screen.getByText("Created by assistant");
    const userBucket = screen.getByText("User files");
    expect(
      mediaBucket.compareDocumentPosition(documentsBucket) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      documentsBucket.compareDocumentPosition(assistantBucket) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      assistantBucket.compareDocumentPosition(userBucket) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText("Spec 0.pdf")).toBeNull();
    expect(screen.queryByText("Video 2.mp4")).toBeNull();
    expect(screen.queryByTitle("Open")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Media/i }));
    expect(screen.getByText("Video 2.mp4")).toBeInTheDocument();
    expect(screen.queryByText("Uploaded")).toBeNull();
    expect(screen.queryByText("Generated")).toBeNull();
    expect(screen.queryByText("image")).toBeNull();
    expect(screen.queryByText("video")).toBeNull();
    expect(screen.getAllByTitle("Download")[0]).toHaveAttribute(
      "href",
      "/api/assistant-file/file-ref-2?download=1"
    );
    expect(screen.getAllByTitle("Preview")).toHaveLength(1);
  });

  it("opens image files in an in-app preview instead of a raw open link", async () => {
    assistantApiMocks.getAssistantFiles.mockResolvedValue({
      files: [
        {
          fileRef: "file-image-1",
          origin: "uploaded_attachment",
          displayName: "photo.png",
          filename: "photo.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          logicalSizeBytes: 2048,
          fileBucket: "media_uploads",
          cleanupEligible: false,
          cleanupReason: null,
          createdAt: "2026-05-02T00:00:00.000Z"
        }
      ],
      cleanup: { eligibleCount: 0, eligibleBytes: 0 }
    });

    renderSettings(makeAppData(), "files");

    expect(await screen.findByText("Media")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Media/i }));
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Preview"));

    expect(screen.getByTestId("files-image-lightbox")).toHaveTextContent("photo.png");
  });

  it("keeps cache files out of the main groups and cleans only eligible cache files", async () => {
    assistantApiMocks.getAssistantFiles.mockResolvedValue({
      files: [
        {
          fileRef: "file-user-1",
          origin: "uploaded_attachment",
          displayName: "notes.md",
          filename: "notes.md",
          mimeType: "text/markdown",
          sizeBytes: 512,
          logicalSizeBytes: 512,
          fileBucket: "user_files",
          cleanupEligible: false,
          cleanupReason: null,
          createdAt: "2026-05-02T00:00:00.000Z"
        },
        {
          fileRef: "file-cache-1",
          origin: "uploaded_attachment",
          displayName: "voice-1.webm",
          filename: "voice-1.webm",
          mimeType: "audio/webm",
          sizeBytes: 64,
          logicalSizeBytes: 64,
          fileBucket: "cache_history",
          cleanupEligible: true,
          cleanupReason: "voice_upload_cache",
          createdAt: "2026-05-02T00:00:00.000Z"
        }
      ],
      cleanup: { eligibleCount: 1, eligibleBytes: 64 }
    });
    assistantApiMocks.cleanupAssistantFilesCache.mockResolvedValue({
      eligibleCount: 1,
      eligibleBytes: 64,
      deletedCount: 1,
      deletedBytes: 64
    });

    renderSettings(makeAppData(), "files");

    expect(await screen.findByRole("button", { name: "Clean cache" })).toBeInTheDocument();
    expect(screen.queryByText("notes.md")).toBeNull();
    expect(screen.queryByText("voice-1.webm")).toBeNull();
    expect(screen.queryByRole("button", { name: /History and cache/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clean cache" }));
    fireEvent.click(screen.getByRole("button", { name: "Clean" }));

    await waitFor(() => {
      expect(assistantApiMocks.cleanupAssistantFilesCache).toHaveBeenCalledWith("token-1");
    });
    fireEvent.click(screen.getByRole("button", { name: /User files/i }));
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.queryByText("voice-1.webm")).toBeNull();
  }, 10000);

  it("labels current document outputs and hides direct file delete", async () => {
    assistantApiMocks.getAssistantFiles.mockResolvedValue({
      files: [
        {
          fileRef: "file-doc-v1",
          origin: "runtime_output",
          displayName: "Investor deck.pdf",
          filename: "investor-deck.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          logicalSizeBytes: 2048,
          fileBucket: "documents",
          cleanupEligible: false,
          cleanupReason: null,
          documentLink: {
            docId: "doc-1",
            versionId: "version-1",
            versionNumber: 1,
            descriptorMode: "create_pdf_document",
            documentType: "pdf",
            documentStatus: "active",
            versionStatus: "superseded",
            isCurrentOutput: false
          },
          createdAt: "2026-05-01T00:00:00.000Z"
        },
        {
          fileRef: "file-doc-v2",
          origin: "runtime_output",
          displayName: "Investor deck.pdf",
          filename: "investor-deck.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4096,
          logicalSizeBytes: 4096,
          fileBucket: "documents",
          cleanupEligible: false,
          cleanupReason: null,
          documentLink: {
            docId: "doc-1",
            versionId: "version-2",
            versionNumber: 2,
            descriptorMode: "revise_document",
            documentType: "pdf",
            documentStatus: "active",
            versionStatus: "delivered",
            isCurrentOutput: true
          },
          createdAt: "2026-05-02T00:00:00.000Z"
        }
      ],
      cleanup: { eligibleCount: 0, eligibleBytes: 0 }
    });

    renderSettings(makeAppData(), "files");

    expect(await screen.findByText("Documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Documents/i }));

    expect(screen.getAllByText("Investor deck.pdf")).toHaveLength(1);
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.queryByText("v1")).toBeNull();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AssistantSettings — Memory Center close-button + tabs (ADR-074 M3.3).
// ---------------------------------------------------------------------------

describe("AssistantSettings Memory Center (ADR-074 M3.3)", () => {
  it("close-button removes the open-loop row on success", async () => {
    const openLoop = registry({
      id: "loop-1",
      summary: "Follow up on pricing",
      kind: "open_loop"
    });
    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([openLoop]);
    assistantApiMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue(undefined);

    renderSettings(makeAppData(), "memory");

    await waitFor(() => {
      expect(screen.getByTestId(`close-open-loop-${openLoop.id}`)).toBeInTheDocument();
    });
    expect(screen.getByText(openLoop.summary)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`close-open-loop-${openLoop.id}`));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantMemoryItemCloseOpenLoop).toHaveBeenCalledWith(
        "token-1",
        "loop-1"
      );
    });
    await waitFor(() => {
      expect(screen.queryByText(openLoop.summary)).not.toBeInTheDocument();
    });
  });

  it("close-button surfaces the API error inline (no more silent swallow) on 404/400/409", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const openLoop = registry({
      id: "loop-404",
      summary: "Stale loop",
      kind: "open_loop"
    });
    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([openLoop]);
    assistantApiMocks.postAssistantMemoryItemCloseOpenLoop.mockRejectedValue(
      new Error("Memory item not found.")
    );

    renderSettings(makeAppData(), "memory");

    await waitFor(() => {
      expect(screen.getByTestId(`close-open-loop-${openLoop.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`close-open-loop-${openLoop.id}`));

    await waitFor(() => {
      expect(screen.getByText("Memory item not found.")).toBeInTheDocument();
    });
    // Row stays visible because the close was rejected.
    expect(screen.getByText(openLoop.summary)).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[memory-center] handleCloseOpenLoop failed",
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it("Workspace tab shows structured kinds + workspace rows; History tab shows kind=null only", async () => {
    const structured = registry({
      id: "r-fact",
      summary: "User loves oat milk",
      kind: "fact"
    });
    const echo = registry({
      id: "r-echo",
      summary: "Mentioned aurora project",
      kind: null
    });
    const wsRow = workspace({ id: "ws-1", content: "Curated workspace note" });

    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([structured, echo]);
    assistantApiMocks.getWorkspaceMemoryItems.mockResolvedValue([wsRow]);

    renderSettings(makeAppData(), "memory");

    const workspaceList = await screen.findByTestId("memory-center-workspace-list");
    const wsScope = within(workspaceList);
    expect(wsScope.getByText(structured.summary)).toBeInTheDocument();
    expect(wsScope.getByText(wsRow.content)).toBeInTheDocument();
    expect(wsScope.queryByText(echo.summary)).not.toBeInTheDocument();

    // Switch to History tab. Match the exact tab label so the "Publish
    // history" section button doesn't ambiguously match.
    fireEvent.click(screen.getByRole("button", { name: "History" }));

    const historyList = await screen.findByTestId("memory-center-history-list");
    const histScope = within(historyList);
    expect(histScope.getByText(echo.summary)).toBeInTheDocument();
    expect(histScope.queryByText(structured.summary)).not.toBeInTheDocument();
    expect(histScope.queryByText(wsRow.content)).not.toBeInTheDocument();

    // History tab MUST NOT show "Mark as closed" buttons (echoes have no
    // structured kind to close).
    expect(histScope.queryByLabelText(/mark as closed/i)).not.toBeInTheDocument();
  });

  it("dedups a workspace row that collides with a structured registry row by normalized text", async () => {
    const structured = registry({
      id: "r-pers",
      summary: "PERSAI в реале для user",
      kind: "fact"
    });
    const wsDup = workspace({ id: "ws-pers", content: "PERSAI В РЕАЛЕ для user." });
    const wsUnique = workspace({ id: "ws-unique", content: "Loves dark roast" });

    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([structured]);
    assistantApiMocks.getWorkspaceMemoryItems.mockResolvedValue([wsDup, wsUnique]);

    renderSettings(makeAppData(), "memory");

    const workspaceList = await screen.findByTestId("memory-center-workspace-list");
    const items = within(workspaceList).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const texts = items.map((li) => li.textContent ?? "");
    expect(texts.some((t) => t.includes("PERSAI"))).toBe(true);
    expect(texts.some((t) => t.includes("dark roast"))).toBe(true);
    // The duplicated workspace row's id must not have produced a row.
    expect(within(workspaceList).queryByTestId(`forget-workspace-${wsDup.id}`)).toBeNull();
    expect(
      within(workspaceList).getByTestId(`forget-workspace-${wsUnique.id}`)
    ).toBeInTheDocument();
  });

  it("keeps memory badges on workspace rows that carry registry metadata", async () => {
    const wsRow = workspace({
      id: "ws-core-fact",
      content: "User asked to remember the Mistral OCR integration plan",
      memoryClass: "core",
      kind: "fact"
    });

    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([]);
    assistantApiMocks.getWorkspaceMemoryItems.mockResolvedValue([wsRow]);

    renderSettings(makeAppData(), "memory");

    const workspaceList = await screen.findByTestId("memory-center-workspace-list");
    const row = within(workspaceList).getByText(wsRow.content).closest("li");
    expect(row).not.toBeNull();
    const rowScope = within(row as HTMLElement);
    expect(rowScope.getByText(/^core$/i)).toBeInTheDocument();
    expect(rowScope.getByText(/^fact$/i)).toBeInTheDocument();
  });

  it("keeps the open-loop badge and close action on workspace rows that carry registry metadata", async () => {
    const wsLoop = workspace({
      id: "ws-open-loop",
      content: "Follow up on the OCR ingestion deployment",
      memoryClass: "contextual",
      kind: "open_loop",
      resolvedAt: null
    });

    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([]);
    assistantApiMocks.getWorkspaceMemoryItems.mockResolvedValue([wsLoop]);
    assistantApiMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue(undefined);

    renderSettings(makeAppData(), "memory");

    const workspaceList = await screen.findByTestId("memory-center-workspace-list");
    const row = within(workspaceList).getByText(wsLoop.content).closest("li");
    expect(row).not.toBeNull();
    const rowScope = within(row as HTMLElement);
    expect(rowScope.getByText(/^contextual$/i)).toBeInTheDocument();
    expect(rowScope.getByText(/^open loop$/i)).toBeInTheDocument();

    fireEvent.click(rowScope.getByTestId(`close-open-loop-${wsLoop.id}`));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantMemoryItemCloseOpenLoop).toHaveBeenCalledWith(
        "token-1",
        wsLoop.id
      );
    });
    await waitFor(() => {
      expect(within(workspaceList).queryByText(wsLoop.content)).not.toBeInTheDocument();
    });
  });

  it("only renders the OPEN_LOOP badge + close-button when kind === 'open_loop'", async () => {
    const fact = registry({ id: "r-fact", summary: "Fact row", kind: "fact" });
    const pref = registry({ id: "r-pref", summary: "Preference row", kind: "preference" });
    const loop = registry({ id: "r-loop", summary: "Open loop row", kind: "open_loop" });

    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([fact, pref, loop]);

    renderSettings(makeAppData(), "memory");

    await screen.findByTestId("memory-center-workspace-list");

    // Close-button must appear ONLY for the open_loop row.
    expect(screen.queryByTestId(`close-open-loop-${fact.id}`)).toBeNull();
    expect(screen.queryByTestId(`close-open-loop-${pref.id}`)).toBeNull();
    expect(screen.getByTestId(`close-open-loop-${loop.id}`)).toBeInTheDocument();

    // Each kind gets exactly one badge label, and the OPEN_LOOP badge text
    // must NOT bleed into fact/preference rows (the M3.1 hotfix: the
    // previous fallback ternary defaulted to t("memoryKindOpenLoop") for
    // any non-null kind, which falsely tagged facts/prefs as "Open loop".)
    expect(screen.getByText(/^fact$/i)).toBeInTheDocument();
    expect(screen.getByText(/^preference$/i)).toBeInTheDocument();
    const openLoopBadges = screen.getAllByText(/^open loop$/i);
    expect(openLoopBadges).toHaveLength(1);
  });

  it("hides the close-button on already-resolved open_loop rows (resolvedAt !== null)", async () => {
    const resolved = registry({
      id: "r-resolved",
      summary: "Resolved loop",
      kind: "open_loop",
      resolvedAt: "2026-04-22T19:00:00.000Z"
    });

    assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([resolved]);

    renderSettings(makeAppData(), "memory");

    await screen.findByTestId("memory-center-workspace-list");
    expect(screen.queryByTestId(`close-open-loop-${resolved.id}`)).toBeNull();
    // The "Closed" status badge is rendered.
    expect(screen.getByText(/^closed$/i)).toBeInTheDocument();
  });
});

describe("AssistantSettings limits", () => {
  it("does not crash when monthly media quotas are absent from the plan payload", async () => {
    expect(() =>
      renderSettings(
        makeAppData({
          plan: {
            effectivePlan: {
              code: "pro",
              displayName: "Pro",
              status: "active",
              source: "plan",
              subscriptionStatus: "active",
              trialEndsAt: null,
              graceStartedAt: null,
              graceEndsAt: null,
              currentPeriodEndsAt: "2026-05-31T00:00:00.000Z",
              currentPeriodStartedAt: "2026-05-01T00:00:00.000Z",
              isTrialPlan: false,
              trialFallbackPlanCode: null,
              paidFallbackPlanCode: null,
              price: {
                amount: 9900,
                currency: "RUB",
                billingPeriod: "month"
              }
            },
            status: {
              active: true,
              trial: false,
              expiresAt: null,
              renewsAt: null,
              autoRenew: true,
              max: false
            },
            limits: {
              quotaBuckets: [],
              toolDailyLimits: []
            } as unknown as NonNullable<AppData["plan"]>["limits"],
            entitlements: {
              channelsAndSurfaces: {
                webChat: true,
                telegram: true,
                whatsapp: false,
                max: false
              }
            },
            advisories: [],
            packageOffers: [],
            updatedAt: "2026-05-16T00:00:00.000Z"
          } as unknown as NonNullable<AppData["plan"]>
        }),
        "limits"
      )
    ).not.toThrow();
  });

  it("renders tool quota cards from monthlyToolQuotas when the new payload shape is present", () => {
    const openPricingPage = vi.fn();
    const openPackagesPage = vi.fn();

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "workspace_subscription",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-06-09T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: {
              amount: 49,
              currency: "USD",
              billingPeriod: "month"
            }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            },
            talkingVideoEnabled: false
          },
          advisories: {
            warningThresholdPercent: 90,
            isFreePlan: false,
            higherPaidPlanAvailable: false,
            highestVisiblePaidPlanCode: "pro",
            tokenBudget: {
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: null,
              paidLightModeEligible: false,
              paidLightModeActive: false,
              paidLightModeReason: null
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyToolQuotas: {
              planCode: "pro",
              periodStartedAt: "2026-05-01T00:00:00.000Z",
              periodEndsAt: "2026-06-01T00:00:00.000Z",
              periodSource: "subscription_period",
              tools: [
                {
                  toolCode: "document",
                  displayName: "Documents",
                  usedUnits: 2,
                  reservedUnits: 0,
                  settledUnits: 2,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 10,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 10,
                  bonusExpiresAt: null,
                  remainingUnits: 8,
                  percent: 20,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                },
                {
                  toolCode: "image_generate",
                  displayName: "Image generation",
                  usedUnits: 3,
                  reservedUnits: 0,
                  settledUnits: 3,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 20,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 20,
                  bonusExpiresAt: null,
                  remainingUnits: 17,
                  percent: 15,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                },
                {
                  toolCode: "video_generate",
                  displayName: "Video generation",
                  usedUnits: 1,
                  reservedUnits: 0,
                  settledUnits: 1,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 5,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 5,
                  bonusExpiresAt: null,
                  remainingUnits: 4,
                  percent: 20,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                }
              ]
            },
            toolDailyLimits: [
              {
                toolCode: "image_generate",
                displayName: "Image generation",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                percent: null,
                finiteLimit: false,
                warningThresholdPercent: null,
                warningThresholdReached: false,
                periodStartedAt: null,
                periodEndsAt: null,
                periodSource: null,
                active: true
              },
              {
                toolCode: "video_generate",
                displayName: "Video generation",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                percent: null,
                finiteLimit: false,
                warningThresholdPercent: null,
                warningThresholdReached: false,
                periodStartedAt: null,
                periodEndsAt: null,
                periodSource: null,
                active: true
              }
            ]
          },
          packageOffers: {
            packagesPurchase: null,
            tools: []
          },
          workspaceVcoinBalance: {
            balanceVc: 0,
            videoVcoinMonthlyGrant: 0,
            vcoinExchangeRate: 20
          },
          updatedAt: "2026-05-16T00:00:00.000Z"
        }
      }),
      "limits",
      { onOpenPricingPage: openPricingPage, onOpenPackagesPage: openPackagesPage }
    );

    expect(screen.getByText("Image generation")).toBeInTheDocument();
    expect(screen.getByText("3 / 20")).toBeInTheDocument();
    expect(screen.getByText("Video generation")).toBeInTheDocument();
    // After Slice 6b: video card renders VC balance (balanceVc: 0 in fixture → "Remaining 0 VC").
    expect(screen.getByText("Remaining 0 VC")).toBeInTheDocument();
    expect(screen.queryByText("1 / 5")).toBeNull();
    // Documents card moves into the (collapsed) Tool limits accordion.
    expect(screen.queryByText("Document generation")).toBeNull();
    expect(screen.queryByText("2 / 10")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Tool limits/i }));

    expect(screen.getByText("Document generation")).toBeInTheDocument();
    expect(screen.getByText("2 / 10")).toBeInTheDocument();
    expect(screen.queryAllByText("Image generation")).toHaveLength(1);
    expect(screen.queryAllByText("Video generation")).toHaveLength(1);
  });

  it("prioritizes token budget, keeps document featured in tool limits, and keeps tool limits collapsed by default", () => {
    const openPricingPage = vi.fn();
    const openPackagesPage = vi.fn();

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "trialing",
            trialEndsAt: "2026-05-12T00:00:00.000Z",
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: null,
            isTrialPlan: true,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [
              {
                bucketCode: "token_budget",
                displayName: "Token budget",
                unit: "tokens",
                used: 2100,
                limit: 10000,
                percent: 21,
                usageAvailable: true,
                status: "ok"
              },
              {
                bucketCode: "active_web_chats",
                displayName: "Active chats",
                unit: "count",
                used: 2,
                limit: 5,
                percent: 40,
                usageAvailable: true,
                status: "ok"
              },
              {
                bucketCode: "media_storage_bytes",
                displayName: "Media storage",
                unit: "bytes",
                used: 1024,
                limit: 4096,
                percent: 25,
                usageAvailable: true,
                status: "ok"
              },
              {
                bucketCode: "knowledge_storage_bytes",
                displayName: "Knowledge storage",
                unit: "bytes",
                used: 2048,
                limit: 10240,
                percent: 20,
                usageAvailable: true,
                status: "ok"
              }
            ],
            monthlyMediaQuotas: {
              planCode: "starter_trial",
              periodStartedAt: "2026-04-01T00:00:00.000Z",
              periodEndsAt: "2026-05-01T00:00:00.000Z",
              periodSource: "subscription_period",
              tools: [
                {
                  toolCode: "document",
                  displayName: "Documents",
                  usedUnits: 1,
                  reservedUnits: 0,
                  settledUnits: 1,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 10,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 10,
                  bonusExpiresAt: null,
                  remainingUnits: 9,
                  percent: 10,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                },
                {
                  toolCode: "image_generate",
                  displayName: "Image generation",
                  usedUnits: 2,
                  reservedUnits: 0,
                  settledUnits: 2,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 20,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 20,
                  bonusExpiresAt: null,
                  remainingUnits: 18,
                  percent: 10,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                },
                {
                  toolCode: "image_edit",
                  displayName: "Image editing",
                  usedUnits: 1,
                  reservedUnits: 0,
                  settledUnits: 1,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: null,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: null,
                  bonusExpiresAt: null,
                  remainingUnits: null,
                  percent: null,
                  finiteLimit: false,
                  usageAvailable: true,
                  warningThresholdPercent: null,
                  warningThresholdReached: false,
                  status: "ok"
                },
                {
                  toolCode: "video_generate",
                  displayName: "Video generation",
                  usedUnits: 0,
                  reservedUnits: 0,
                  settledUnits: 0,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: null,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: null,
                  bonusExpiresAt: null,
                  remainingUnits: null,
                  percent: null,
                  finiteLimit: false,
                  usageAvailable: true,
                  warningThresholdPercent: null,
                  warningThresholdReached: false,
                  status: "ok"
                }
              ]
            },
            toolDailyLimits: [
              {
                toolCode: "exec",
                displayName: "Exec",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                active: true
              },
              {
                toolCode: "image_edit",
                displayName: "Image editing",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                active: false
              }
            ]
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits",
      { onOpenPricingPage: openPricingPage, onOpenPackagesPage: openPackagesPage }
    );

    expect(screen.getByText("Trial until May 12")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Token budget")).toBeInTheDocument();
    expect(screen.getByText("2,100/10,000")).toBeInTheDocument();
    expect(screen.getByText("Image generation")).toBeInTheDocument();
    expect(screen.getByText("2 / 20")).toBeInTheDocument();
    expect(screen.getByText("Video generation")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    // image_edit is in toolDailyLimits with active=false → media row renders it
    // as the "Unavailable" disabled card with the Change-plan CTA.
    expect(screen.getByText("Image editing")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    // Documents card now lives inside the collapsed Tool limits accordion.
    expect(screen.queryByText("Document generation")).toBeNull();
    expect(screen.queryByText("1 / 10")).toBeNull();
    expect(screen.queryByText("Image edits")).toBeNull();
    expect(screen.queryByText("Code execution")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    expect(openPricingPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Tool limits/i }));

    expect(screen.getByText("Document generation")).toBeInTheDocument();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
    // Active chats card was removed from Tool limits per UX cleanup.
    expect(screen.queryByText("Active chats")).toBeNull();
    expect(screen.getByText("Media storage")).toBeInTheDocument();
    expect(screen.getByText("Knowledge storage")).toBeInTheDocument();
    expect(screen.queryAllByText("Image generation")).toHaveLength(1);
    expect(screen.queryByText("Image edits")).toBeNull();
    expect(screen.getByText("Code execution")).toBeInTheDocument();
    // Image editing still shows once (in the media row above the accordion).
    expect(screen.queryAllByText("Image editing")).toHaveLength(1);
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("renders media monthly cards under token usage and does not duplicate them inside tool limits", () => {
    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "basic",
            displayName: "Basic",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 560, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "basic",
              periodStartedAt: "2026-05-01T00:00:00.000Z",
              periodEndsAt: "2026-06-01T00:00:00.000Z",
              periodSource: "subscription_period",
              tools: [
                {
                  toolCode: "image_generate",
                  displayName: "Image generation",
                  usedUnits: 4,
                  reservedUnits: 0,
                  settledUnits: 4,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 20,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 20,
                  bonusExpiresAt: null,
                  remainingUnits: 16,
                  percent: 20,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                },
                {
                  toolCode: "video_generate",
                  displayName: "Video generation",
                  usedUnits: 0,
                  reservedUnits: 0,
                  settledUnits: 0,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 1,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 1,
                  bonusExpiresAt: null,
                  remainingUnits: 1,
                  percent: 0,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                }
              ]
            },
            toolDailyLimits: [
              {
                toolCode: "image_generate",
                displayName: "Image generation",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                active: true
              },
              {
                toolCode: "video_generate",
                displayName: "Video generation",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                active: false
              }
            ]
          },
          updatedAt: "2026-05-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    expect(screen.getByText("Image generation")).toBeInTheDocument();
    expect(screen.getByText("4 / 20")).toBeInTheDocument();
    expect(screen.getByText("Video generation")).toBeInTheDocument();
    // video_generate is active=false on the plan → media card flips to the
    // "Unavailable" disabled state instead of showing "0 / 1".
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("0 / 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Tool limits/i }));

    expect(screen.queryAllByText("Image generation")).toHaveLength(1);
    expect(screen.queryAllByText("Video generation")).toHaveLength(1);
  });

  it("video monthly card renders VC balance and per-VC price; image card stays byte-identical", () => {
    const openPackagesPage = vi.fn();

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "workspace_subscription",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-06-09T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 49, currency: "USD", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyToolQuotas: {
              planCode: "pro",
              periodStartedAt: "2026-05-01T00:00:00.000Z",
              periodEndsAt: "2026-06-01T00:00:00.000Z",
              periodSource: "subscription_period",
              tools: [
                {
                  toolCode: "image_generate",
                  displayName: "Image generation",
                  usedUnits: 3,
                  reservedUnits: 0,
                  settledUnits: 3,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 20,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 20,
                  bonusExpiresAt: null,
                  remainingUnits: 17,
                  percent: 15,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                },
                {
                  toolCode: "video_generate",
                  displayName: "Video generation",
                  usedUnits: 2,
                  reservedUnits: 0,
                  settledUnits: 2,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 5,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 5,
                  bonusExpiresAt: null,
                  remainingUnits: 3,
                  percent: 40,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                }
              ]
            },
            toolDailyLimits: [
              {
                toolCode: "image_generate",
                displayName: "Image generation",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                percent: null,
                finiteLimit: false,
                warningThresholdPercent: null,
                warningThresholdReached: false,
                periodStartedAt: null,
                periodEndsAt: null,
                periodSource: null,
                active: true
              },
              {
                toolCode: "video_generate",
                displayName: "Video generation",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                percent: null,
                finiteLimit: false,
                warningThresholdPercent: null,
                warningThresholdReached: false,
                periodStartedAt: null,
                periodEndsAt: null,
                periodSource: null,
                active: true
              }
            ]
          },
          packageOffers: { packagesPurchase: null, tools: [] },
          workspaceVcoinBalance: {
            balanceVc: 250,
            videoVcoinMonthlyGrant: 1000,
            vcoinExchangeRate: 20
          },
          updatedAt: "2026-05-16T00:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits",
      { onOpenPackagesPage: openPackagesPage }
    );

    // Video card renders VC balance — NOT per-unit count.
    expect(screen.getByText("Remaining 250 VC")).toBeInTheDocument();
    expect(screen.getByText("1 VC ≈ $0.05")).toBeInTheDocument();
    expect(screen.queryByText("2 / 5")).toBeNull();
    // Image card is byte-identical: still renders per-unit quota.
    expect(screen.getByText("3 / 20")).toBeInTheDocument();
  });

  it("video monthly card renders Remaining 0 VC when balanceVc is 0 (not fallback to per-unit)", () => {
    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "workspace_subscription",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-06-09T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 49, currency: "USD", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyToolQuotas: {
              planCode: "pro",
              periodStartedAt: "2026-05-01T00:00:00.000Z",
              periodEndsAt: "2026-06-01T00:00:00.000Z",
              periodSource: "subscription_period",
              tools: [
                {
                  toolCode: "video_generate",
                  displayName: "Video generation",
                  usedUnits: 1,
                  reservedUnits: 0,
                  settledUnits: 1,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 5,
                  bonusLimitUnits: 0,
                  effectiveLimitUnits: 5,
                  bonusExpiresAt: null,
                  remainingUnits: 4,
                  percent: 20,
                  finiteLimit: true,
                  usageAvailable: true,
                  warningThresholdPercent: 90,
                  warningThresholdReached: false,
                  status: "ok"
                }
              ]
            },
            toolDailyLimits: [
              {
                toolCode: "video_generate",
                displayName: "Video generation",
                dailyCallLimit: null,
                dailyCallsUsed: 0,
                percent: null,
                finiteLimit: false,
                warningThresholdPercent: null,
                warningThresholdReached: false,
                periodStartedAt: null,
                periodEndsAt: null,
                periodSource: null,
                active: true
              }
            ]
          },
          packageOffers: { packagesPurchase: null, tools: [] },
          workspaceVcoinBalance: {
            balanceVc: 0,
            videoVcoinMonthlyGrant: 1000,
            vcoinExchangeRate: 20
          },
          updatedAt: "2026-05-16T00:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    expect(screen.getByText("Remaining 0 VC")).toBeInTheDocument();
    // Per-unit count must not appear.
    expect(screen.queryByText("1 / 5")).toBeNull();
  });

  it("opens payment settings for recurring subscribers and shows a quiet cancel-subscription action", async () => {
    const openPricingPage = vi.fn();
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_portal",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      warning: null
    });

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits",
      { onOpenPricingPage: openPricingPage }
    );

    const paymentSettingsButton = await screen.findByRole("button", { name: "Payment settings" });
    expect(paymentSettingsButton).toBeInTheDocument();
    expect(paymentSettingsButton.className).toContain("border");
    expect(paymentSettingsButton.className).toContain("bg-surface-raised/72");
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Buy subscription" })).not.toBeInTheDocument();
    fireEvent.click(paymentSettingsButton);

    expect(await screen.findByRole("heading", { name: "Payment settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change plan" })).toBeInTheDocument();
    expect(screen.getAllByText("Bank card").length).toBe(2);
    expect(screen.getByText("On")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }));
    expect(
      await screen.findByText("Cancel the subscription after the current paid period ends?")
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Keep subscription" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Cancel subscription" })[1]!);

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantBillingDisableAutoRenew).toHaveBeenCalledWith(
        "token-1"
      );
    });
    expect(
      await screen.findByText("The subscription will end after the current paid period.")
    ).toBeInTheDocument();
    expect(openPricingPage).not.toHaveBeenCalled();
  }, 15000);

  it("keeps payment settings available for one-time paid access without recurring controls", async () => {
    const openPricingPage = vi.fn();
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: null,
      autoRenewEnabled: false,
      canDisableAutoRenew: false,
      nextChargeAt: null,
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: null,
      autoRenewMethodLabel: null,
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      warning: null
    });

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits",
      { onOpenPricingPage: openPricingPage }
    );

    expect(await screen.findByRole("button", { name: "Payment settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Buy subscription" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Payment settings" }));

    expect(await screen.findByRole("heading", { name: "Payment settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change plan" })).toBeInTheDocument();
    expect(screen.getByText("Access until")).toBeInTheDocument();
    expect(screen.getByText(/May 12, 2026/i)).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("Payment method unknown")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update payment method" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel subscription" })).not.toBeInTheDocument();
  }, 15000);

  it("keeps payment settings available for paused provider-managed subscriptions", async () => {
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "paused",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: true,
      canEnableAutoRenew: false,
      canDisableAutoRenew: false,
      nextChargeAt: "2026-06-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_portal",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      scheduledPlanChange: null,
      warning: null
    });

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "paused",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    const paymentSettingsButton = await screen.findByRole("button", { name: "Payment settings" });
    expect(paymentSettingsButton.className).toContain("border");
    expect(paymentSettingsButton.className).toContain("bg-surface-raised/72");
    fireEvent.click(paymentSettingsButton);

    expect(await screen.findByRole("heading", { name: "Payment settings" })).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Access until")).toBeInTheDocument();
    expect(screen.queryByText("Charge")).toBeNull();
  }, 15000);

  it("shows restore subscription CTA for scheduled FREE and updates billing state", async () => {
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "canceled",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: false,
      canEnableAutoRenew: true,
      canDisableAutoRenew: false,
      nextChargeAt: null,
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_portal",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      scheduledPlanChange: {
        changeKind: "free",
        targetPlanCode: "free",
        targetPlanDisplayName: "Free",
        effectiveAt: "2026-05-12T00:00:00.000Z"
      },
      warning: null
    });

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "canceled",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    const paymentSettingsButton = await screen.findByRole("button", { name: "Payment settings" });
    expect(paymentSettingsButton.className).toContain("bg-accent");
    expect(paymentSettingsButton.className).toContain("text-white");
    fireEvent.click(paymentSettingsButton);
    fireEvent.click(await screen.findByRole("button", { name: "Restore subscription" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantBillingEnableAutoRenew).toHaveBeenCalledWith(
        "token-1",
        {
          paymentMethodClass: "card",
          idempotencyKey: expect.stringContaining("settings:enable-auto-renew:"),
          returnUrl: "/app/chat"
        }
      );
    });
    expect(
      await screen.findByText("Subscription restored and auto-renew is enabled again.")
    ).toBeInTheDocument();
  }, 15000);

  it("shows scheduled downgrade copy instead of ordinary charge copy", async () => {
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: true,
      canEnableAutoRenew: false,
      canDisableAutoRenew: true,
      nextChargeAt: "2026-06-26T00:00:00.000Z",
      currentPeriodEndsAt: "2026-06-26T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_portal",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      scheduledPlanChange: {
        changeKind: "downgrade",
        targetPlanCode: "basic",
        targetPlanDisplayName: "BASIC",
        effectiveAt: "2026-06-26T00:00:00.000Z"
      },
      warning: null
    });

    renderSettings(
      makeAppData({
        billingSubscription: {
          planCode: "pro",
          planDisplayName: "Pro",
          subscriptionStatus: "active",
          billingProvider: "cloudpayments",
          providerSubscriptionRef: "sub-provider-1",
          autoRenewEnabled: true,
          canEnableAutoRenew: false,
          enableAutoRenewMode: "provider_portal",
          canDisableAutoRenew: true,
          canScheduleDowngrade: true,
          canSwitchToFree: true,
          nextChargeAt: "2026-06-26T00:00:00.000Z",
          currentPeriodEndsAt: "2026-06-26T00:00:00.000Z",
          scheduledPlanChange: {
            changeKind: "downgrade",
            targetPlanCode: "basic",
            targetPlanDisplayName: "BASIC",
            effectiveAt: "2026-06-26T00:00:00.000Z"
          },
          lastPaymentMethodLabel: "Bank card",
          autoRenewMethodLabel: "Bank card",
          recurringMigration: billingRecurringMigrationIdle,
          managePaymentMethodUrl: "https://my.cloudpayments.ru/",
          managePaymentMethodMode: "provider_portal",
          cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
          warning: null
        } as never,
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-06-26T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    expect(await screen.findByText(/BASIC c (26 Jun|Jun 26)/i)).toBeInTheDocument();
    expect(screen.queryByText("Charge")).toBeNull();
  }, 15000);

  it("hands bind checkout off to the shell callback instead of leaving settings open", async () => {
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: null,
      autoRenewEnabled: false,
      canEnableAutoRenew: true,
      canDisableAutoRenew: false,
      nextChargeAt: null,
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: null,
      autoRenewMethodLabel: null,
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });
    assistantApiMocks.postAssistantBillingEnableAutoRenew.mockResolvedValue({
      mode: "checkout",
      paymentIntent: {
        id: "intent-bind-1",
        checkoutUrl: "/app/billing/checkout/intent-bind-1"
      }
    });
    const onStartBillingCheckout = vi.fn();

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits",
      { onStartBillingCheckout }
    );

    fireEvent.click(await screen.findByRole("button", { name: "Payment settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enable auto-renew" }));

    await waitFor(() => {
      expect(onStartBillingCheckout).toHaveBeenCalledWith("intent-bind-1");
    });
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Finish linking your card to enable auto-renew.")
    ).toBeInTheDocument();
  }, 15000);

  it("redirects change plan from payment settings to the standard pricing page", async () => {
    const openPricingPage = vi.fn();
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "basic",
      planDisplayName: "Basic",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      canScheduleDowngrade: true,
      canSwitchToFree: true,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_portal",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      scheduledPlanChange: null,
      warning: null
    });

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "basic",
            displayName: "Basic",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 19, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "basic",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits",
      { onOpenPricingPage: openPricingPage }
    );

    fireEvent.click(await screen.findByRole("button", { name: "Payment settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change plan" }));

    expect(openPricingPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Change plan" })).toBeNull();
    expect(
      screen.queryByText(
        "Review upgrades, downgrades, and FREE changes inside the billing management flow."
      )
    ).toBeNull();
  });

  it("keeps zero-price plans outside payment settings and shows indefinite access", () => {
    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "free",
            displayName: "Free",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 0, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "free",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    expect(screen.getByText("Indefinite")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Payment settings" })).not.toBeInTheDocument();
    expect(screen.queryByText("Access until May 12")).toBeNull();
  });

  it("keeps payment settings entry reachable when recurring state refresh fails", async () => {
    const openPricingPage = vi.fn();
    assistantApiMocks.getAssistantBillingSubscription.mockRejectedValue(
      new Error("billing refresh failed")
    );

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits",
      { onOpenPricingPage: openPricingPage }
    );

    const button = await screen.findByRole("button", { name: "Payment settings" });
    fireEvent.click(button);

    expect(await screen.findByRole("heading", { name: "Payment settings" })).toBeInTheDocument();
    expect(
      await screen.findByText("Could not update billing settings. Try again.")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByText("Provider-managed payment method")).toBeNull();
    expect(openPricingPage).not.toHaveBeenCalled();
  });

  it("shows an explicit recurring migration warning when SBP payment did not switch auto-renew", async () => {
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "SBP",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationFailed,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_portal",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      warning: null
    });

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "active",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Payment settings" }));

    expect(
      await screen.findByText(
        "The SBP payment succeeded, but recurring charges are still linked to the previous bank card until the provider confirms the transfer."
      )
    ).toBeInTheDocument();
  });

  it("shows payment-attempt copy in settings and quiet inline issue text during grace period", async () => {
    assistantApiMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "grace_period",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-provider-1",
      autoRenewEnabled: true,
      canEnableAutoRenew: false,
      canDisableAutoRenew: true,
      nextChargeAt: "2026-06-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: "https://my.cloudpayments.ru/",
      managePaymentMethodMode: "provider_managed_recovery",
      cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
      scheduledPlanChange: null,
      warning: null
    });

    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "grace_period",
            trialEndsAt: null,
            graceStartedAt: "2026-05-01T00:00:00.000Z",
            graceEndsAt: "2026-05-12T00:00:00.000Z",
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Payment settings" }));

    expect(await screen.findByText("Payment attempt")).toBeInTheDocument();
    expect(screen.queryByText("Plan change")).toBeNull();
    expect(screen.queryByText("Payment issue")).toBeNull();
    expect(screen.getByText(/next attempt will run automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/Jun 12, 2026|June 12, 2026/i)).toBeInTheDocument();
  }, 15000);

  it("shows access-until copy for canceled subscription state in the limits summary", () => {
    renderSettings(
      makeAppData({
        plan: {
          effectivePlan: {
            code: "pro",
            displayName: "Pro",
            status: "active",
            source: "plan",
            subscriptionStatus: "canceled",
            trialEndsAt: null,
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
            isTrialPlan: false,
            trialFallbackPlanCode: null,
            paidFallbackPlanCode: null,
            price: { amount: 980, currency: "RUB", billingPeriod: "month" }
          },
          entitlements: {
            channelsAndSurfaces: {
              webChat: true,
              telegram: true,
              whatsapp: false,
              max: false
            }
          },
          limits: {
            quotaBuckets: [],
            monthlyMediaQuotas: {
              planCode: "pro",
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: "subscription_period",
              tools: []
            },
            toolDailyLimits: []
          },
          updatedAt: "2026-04-01T10:00:00.000Z"
        } as unknown as AppData["plan"]
      }),
      "limits"
    );

    expect(screen.getByText("Access until May 12")).toBeInTheDocument();
    expect(screen.queryByText("Next billing May 12")).toBeNull();
  });

  it("does not show assistant switch controls for single-assistant plans", () => {
    renderSettings(
      makeAppData({
        assistants: [
          {
            id: "assistant-1",
            displayName: "Nova",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-01T10:00:00.000Z",
            updatedAt: "2026-04-01T10:00:00.000Z"
          }
        ],
        activeAssistantId: "assistant-1",
        assistantLimit: { usedAssistants: 1, maxAssistants: 1 }
      }),
      "character"
    );

    expect(screen.queryByRole("button", { name: "Switch assistant →" })).toBeNull();
  });

  it("renders the assistant switch action as quiet desktop/mobile link copy", () => {
    renderSettings(
      makeAppData({
        assistants: [
          {
            id: "assistant-1",
            displayName: "Nova",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-01T10:00:00.000Z",
            updatedAt: "2026-04-01T10:00:00.000Z"
          },
          {
            id: "assistant-2",
            displayName: "Luma",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-02T10:00:00.000Z",
            updatedAt: "2026-04-02T10:00:00.000Z"
          }
        ],
        activeAssistantId: "assistant-1",
        assistantLimit: { usedAssistants: 2, maxAssistants: 3 }
      }),
      "character"
    );

    expect(screen.getByRole("button", { name: "Switch assistant →" })).toBeInTheDocument();
    expect(screen.getByText("Switch assistant →")).toBeInTheDocument();
    expect(screen.getByText("Switch →")).toBeInTheDocument();
  });

  it("opens the assistant switcher modal and switches assistants", async () => {
    const switchAssistant = vi.fn().mockResolvedValue(undefined);

    renderSettings(
      makeAppData({
        assistants: [
          {
            id: "assistant-1",
            displayName: "Nova",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-01T10:00:00.000Z",
            updatedAt: "2026-04-01T10:00:00.000Z"
          },
          {
            id: "assistant-2",
            displayName: "Luma",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-02T10:00:00.000Z",
            updatedAt: "2026-04-02T10:00:00.000Z"
          }
        ],
        activeAssistantId: "assistant-1",
        assistantLimit: { usedAssistants: 2, maxAssistants: 3 },
        switchAssistant
      }),
      "character"
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch assistant →" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Luma")).toBeInTheDocument();

    const chooseButtons = screen.getAllByRole("button", { name: "Choose" });
    fireEvent.click(chooseButtons[0]!);

    await waitFor(() => {
      expect(switchAssistant).toHaveBeenCalledWith("assistant-2");
    });
  });

  it("shows add assistant only when free slots remain", async () => {
    const createAssistant = vi.fn().mockResolvedValue({
      assistant: {
        ...makeAssistantState(),
        id: "assistant-2"
      },
      assistants: [
        {
          id: "assistant-1",
          displayName: "Nova",
          avatarEmoji: null,
          avatarUrl: null,
          createdAt: "2026-04-01T10:00:00.000Z",
          updatedAt: "2026-04-01T10:00:00.000Z"
        },
        {
          id: "assistant-2",
          displayName: "Luma",
          avatarEmoji: null,
          avatarUrl: null,
          createdAt: "2026-04-02T10:00:00.000Z",
          updatedAt: "2026-04-02T10:00:00.000Z"
        }
      ],
      activeAssistantId: "assistant-2",
      assistantLimit: { usedAssistants: 2, maxAssistants: 2 }
    });

    renderSettings(
      makeAppData({
        assistants: [
          {
            id: "assistant-1",
            displayName: "Nova",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-01T10:00:00.000Z",
            updatedAt: "2026-04-01T10:00:00.000Z"
          }
        ],
        activeAssistantId: "assistant-1",
        assistantLimit: { usedAssistants: 1, maxAssistants: 2 },
        createAssistant
      }),
      "character"
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch assistant →" }));
    fireEvent.click(screen.getByRole("button", { name: "Add assistant" }));

    await waitFor(() => {
      expect(createAssistant).toHaveBeenCalled();
    });
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/setup?entry=assistant-only&intent=create"
    );
  });

  it("shows a calm limit note instead of add assistant when slots are full", () => {
    renderSettings(
      makeAppData({
        assistants: [
          {
            id: "assistant-1",
            displayName: "Nova",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-01T10:00:00.000Z",
            updatedAt: "2026-04-01T10:00:00.000Z"
          },
          {
            id: "assistant-2",
            displayName: "Luma",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-04-02T10:00:00.000Z",
            updatedAt: "2026-04-02T10:00:00.000Z"
          }
        ],
        activeAssistantId: "assistant-1",
        assistantLimit: { usedAssistants: 2, maxAssistants: 2 }
      }),
      "character"
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch assistant →" }));

    expect(screen.queryByRole("button", { name: "Add assistant" })).toBeNull();
    expect(
      screen.getByText(
        "Assistant limit reached for the current plan. Keep using one of your existing assistants for now."
      )
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Smoke: NextIntl wrapping behaviour (sanity check that the test harness
// renders without throwing — guards against future breakage of the helper).
// ---------------------------------------------------------------------------

describe("test harness sanity", () => {
  it("can render an empty AssistantSettings without crashing", async () => {
    render(withIntl(<AssistantSettings data={makeAppData()} initialSection="memory" />));
    await waitFor(() => {
      expect(assistantApiMocks.getAssistantMemoryItems).toHaveBeenCalled();
    });
  });
});

describe("AssistantSettings voice picker", () => {
  it("saves the selected ElevenLabs voice id", async () => {
    assistantApiMocks.getAssistantVoiceSettings.mockResolvedValue({
      schema: "persai.assistantVoiceSettings.v1",
      primaryProviderId: "elevenlabs",
      elevenlabs: {
        configured: true,
        loadState: "ready",
        warning: null,
        voices: [
          {
            voiceId: "eleven-voice-selected",
            name: "Ava",
            gender: "female",
            category: "featured",
            language: "en",
            languageBucket: "en",
            previewUrl: null
          }
        ]
      }
    });

    renderSettings(makeAppData(), "character");

    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ava" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledWith(
        "token-1",
        expect.objectContaining({
          voiceProfile: expect.objectContaining({
            elevenlabs: { voiceId: "eleven-voice-selected" }
          })
        })
      );
    });
    expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledWith("token-1");
  });

  it("keeps the admin top picker on public voices and updates it after approval", async () => {
    assistantApiMocks.getAssistantVoiceSettings.mockResolvedValue({
      schema: "persai.assistantVoiceSettings.v1",
      primaryProviderId: "elevenlabs",
      elevenlabs: {
        configured: true,
        loadState: "ready",
        warning: null,
        voices: [
          {
            voiceId: "public-voice",
            name: "Public Ava",
            gender: "female",
            category: "featured",
            language: "en",
            languageBucket: "en",
            previewUrl: "https://cdn.example.com/public-ava.mp3"
          }
        ],
        admin: {
          publicVoices: [
            {
              voiceId: "public-voice",
              name: "Public Ava",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/public-ava.mp3"
            }
          ],
          voices: [
            {
              voiceId: "public-voice",
              name: "Public Ava",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/public-ava.mp3",
              approved: true,
              hidden: false,
              rank: 1,
              previewOk: true,
              public: true
            },
            {
              voiceId: "candidate-voice",
              name: "Candidate Luna",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/candidate-luna.mp3",
              approved: false,
              hidden: false,
              rank: null,
              previewOk: true,
              public: false
            }
          ]
        }
      }
    });
    assistantApiMocks.patchAssistantElevenLabsVoiceCuration.mockResolvedValue({
      schema: "persai.assistantVoiceSettings.v1",
      primaryProviderId: "elevenlabs",
      elevenlabs: {
        configured: true,
        loadState: "ready",
        warning: null,
        voices: [
          {
            voiceId: "public-voice",
            name: "Public Ava",
            gender: "female",
            category: "featured",
            language: "en",
            languageBucket: "en",
            previewUrl: "https://cdn.example.com/public-ava.mp3"
          },
          {
            voiceId: "candidate-voice",
            name: "Candidate Luna",
            gender: "female",
            category: "featured",
            language: "en",
            languageBucket: "en",
            previewUrl: "https://cdn.example.com/candidate-luna.mp3"
          }
        ],
        admin: {
          publicVoices: [
            {
              voiceId: "public-voice",
              name: "Public Ava",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/public-ava.mp3"
            },
            {
              voiceId: "candidate-voice",
              name: "Candidate Luna",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/candidate-luna.mp3"
            }
          ],
          voices: [
            {
              voiceId: "public-voice",
              name: "Public Ava",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/public-ava.mp3",
              approved: true,
              hidden: false,
              rank: 1,
              previewOk: true,
              public: true
            },
            {
              voiceId: "candidate-voice",
              name: "Candidate Luna",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/candidate-luna.mp3",
              approved: true,
              hidden: false,
              rank: 2,
              previewOk: true,
              public: true
            }
          ]
        }
      }
    });

    renderSettings(makeAppData({ isAdmin: true }), "character");

    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(await screen.findByRole("button", { name: "Public Ava" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Candidate Luna" })).not.toBeInTheDocument();

    const candidateLabel = screen.getByText("Candidate Luna");
    fireEvent.click(within(candidateLabel.closest("label") as HTMLElement).getByRole("checkbox"));

    await waitFor(() => {
      expect(assistantApiMocks.patchAssistantElevenLabsVoiceCuration).toHaveBeenCalledWith(
        "token-1",
        [
          expect.objectContaining({
            voiceId: "candidate-voice",
            approved: true,
            hidden: false
          })
        ]
      );
    });
    expect(await screen.findByRole("button", { name: "Candidate Luna" })).toBeInTheDocument();
  });

  it("refreshes the admin voice catalog on demand", async () => {
    assistantApiMocks.getAssistantVoiceSettings.mockResolvedValue({
      schema: "persai.assistantVoiceSettings.v1",
      primaryProviderId: "elevenlabs",
      elevenlabs: {
        configured: true,
        loadState: "ready",
        warning: null,
        voices: [],
        admin: {
          publicVoices: [],
          voices: [
            {
              voiceId: "stale-candidate",
              name: "Stale Candidate",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/stale-candidate.mp3",
              approved: false,
              hidden: false,
              rank: null,
              previewOk: true,
              public: false
            }
          ]
        }
      }
    });
    assistantApiMocks.postAssistantElevenLabsVoiceCatalogRefresh.mockResolvedValue({
      schema: "persai.assistantVoiceSettings.v1",
      primaryProviderId: "elevenlabs",
      elevenlabs: {
        configured: true,
        loadState: "ready",
        warning: null,
        voices: [
          {
            voiceId: "refreshed-voice",
            name: "Refreshed Iris",
            gender: "female",
            category: "featured",
            language: "en",
            languageBucket: "en",
            previewUrl: "https://cdn.example.com/refreshed-iris.mp3"
          }
        ],
        admin: {
          publicVoices: [
            {
              voiceId: "refreshed-voice",
              name: "Refreshed Iris",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/refreshed-iris.mp3"
            }
          ],
          voices: [
            {
              voiceId: "refreshed-voice",
              name: "Refreshed Iris",
              gender: "female",
              category: "featured",
              language: "en",
              languageBucket: "en",
              previewUrl: "https://cdn.example.com/refreshed-iris.mp3",
              approved: true,
              hidden: false,
              rank: 1,
              previewOk: true,
              public: true
            }
          ]
        }
      }
    });

    renderSettings(makeAppData({ isAdmin: true }), "character");

    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(await screen.findByRole("button", { name: "Refresh cache" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantElevenLabsVoiceCatalogRefresh).toHaveBeenCalledWith(
        "token-1"
      );
    });
    expect(await screen.findByRole("button", { name: "Refreshed Iris" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Characters section — ADR-109 Slice 9
// ---------------------------------------------------------------------------

function makePlanData(
  overrides: { talkingVideoEnabled?: boolean } = {}
): NonNullable<AppData["plan"]> {
  return {
    effectivePlan: {
      code: "pro",
      displayName: "Pro",
      status: "active",
      source: "workspace_subscription",
      subscriptionStatus: "active",
      trialEndsAt: null,
      graceStartedAt: null,
      graceEndsAt: null,
      currentPeriodEndsAt: null,
      isTrialPlan: false,
      trialFallbackPlanCode: null,
      paidFallbackPlanCode: null,
      price: { amount: null, currency: null, billingPeriod: null }
    },
    entitlements: {
      channelsAndSurfaces: { webChat: true, telegram: false, whatsapp: false, max: false },
      ...(overrides.talkingVideoEnabled !== undefined
        ? { talkingVideoEnabled: overrides.talkingVideoEnabled }
        : {})
    },
    advisories: {
      warningThresholdPercent: 90,
      isFreePlan: false,
      higherPaidPlanAvailable: false,
      highestVisiblePaidPlanCode: null,
      tokenBudget: {
        periodStartedAt: null,
        periodEndsAt: null,
        periodSource: null,
        paidLightModeEligible: false,
        paidLightModeActive: false,
        paidLightModeReason: null
      }
    },
    limits: {
      quotaBuckets: [],
      monthlyToolQuotas: { planCode: "pro", periodStartedAt: null, tools: [] },
      toolDailyLimits: []
    },
    packageOffers: { items: [] },
    workspaceVcoinBalance: { balanceVc: 100, videoVcoinMonthlyGrant: 0, vcoinExchangeRate: 20 },
    updatedAt: new Date().toISOString()
  } as unknown as NonNullable<AppData["plan"]>;
}

describe("characters section", () => {
  it("State A (locked): shows locked copy, disabled create slot, and pricing link without demo persona", async () => {
    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: false }) }),
      "characters"
    );

    await waitFor(() => {
      expect(screen.getByText("Characters")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "Saved characters for avatar videos stay visible here and unlock with plan activation."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Sophie")).toBeNull();
    expect(screen.queryAllByTestId("character-card")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Create character" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Change plan" })).toHaveAttribute(
      "href",
      "https://persai.dev/app/pricing"
    );
    // Personas ARE fetched even in locked state
    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled();
    });
  });

  it("State A (locked): no plan still shows disabled create slot and fetches personas", async () => {
    renderSettings(makeAppData({ plan: null }), "characters");

    await waitFor(() => {
      expect(screen.getByText("Characters")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Create character" })).toBeDisabled();
    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled();
    });
  });

  it("State A (locked): shows the new localized locked copy without a demo avatar", async () => {
    render(
      <NextIntlClientProvider locale="ru" messages={ruMessages}>
        <AssistantSettings
          data={makeAppData({ plan: makePlanData({ talkingVideoEnabled: false }) })}
          initialSection="characters"
        />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Персонажи")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "Сохранённые персонажи для аватар видео видны здесь и откроются после активации тарифа."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Софи")).toBeNull();
  });

  it("State A (locked) with real personas: shows saved personas in shared disabled cards and no delete controls", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "p-locked-1",
          displayName: "AliceDisabled",
          portraitImageUrl: "",
          heygenVoiceId: "v-1",
          heygenVoiceLabel: "Voice 1",
          createdAt: new Date().toISOString()
        },
        {
          id: "p-locked-2",
          displayName: "BobDisabled",
          portraitImageUrl: "",
          heygenVoiceId: "v-2",
          heygenVoiceLabel: "Voice 2",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "voice-demo-en",
          name: "Allison",
          language: "English",
          gender: "female",
          previewAudioUrl: "https://cdn.heygen.com/allison.mp3",
          languageBucket: "other"
        }
      ]
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: false }) }),
      "characters"
    );

    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled();
    });

    expect(screen.getAllByTestId("character-card")).toHaveLength(2);
    expect(screen.queryByText("Sophie")).toBeNull();
    expect(screen.getByText("AliceDisabled")).toBeInTheDocument();
    expect(screen.getByText("BobDisabled")).toBeInTheDocument();
    expect(screen.getByText("Voice - Voice 1")).toBeInTheDocument();
    expect(screen.getByText("Voice - Voice 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create character" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete character" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open portrait: AliceDisabled" })).toBeNull();
    expect(
      screen.getByText("AliceDisabled").closest('[data-testid="character-card"]')
    ).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVoiceCatalog).toHaveBeenCalled();
    });
  });

  it("State B (unlocked) empty: renders helper copy and enabled create slot", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: []
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.getByText("Save a face and voice for consistent talking videos.")
      ).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Create character" })).toBeEnabled();
  });

  it("State B (unlocked) with personas: shows shared persona cards", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "p-1",
          displayName: "Masha",
          portraitImageUrl: "/api/persona-portrait/ws-1/p-1/hash.jpg",
          heygenVoiceId: "ru-RU-Masha",
          heygenVoiceLabel: "Masha Russian",
          createdAt: new Date().toISOString()
        },
        {
          id: "p-2",
          displayName: "Boris",
          portraitImageUrl: "/api/persona-portrait/ws-1/p-2/hash.jpg",
          heygenVoiceId: "ru-RU-Boris",
          heygenVoiceLabel: "Boris Russian",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "ru-RU-Masha",
          name: "Masha",
          language: "ru-RU",
          gender: "female",
          previewAudioUrl: "https://cdn.heygen.com/masha.mp3"
        }
      ]
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => {
      expect(screen.getByText("Masha")).toBeInTheDocument();
    });

    expect(screen.getAllByTestId("character-card")).toHaveLength(2);
    expect(screen.getByText("Boris")).toBeInTheDocument();
    expect(screen.getByText("Voice - Masha Russian")).toBeInTheDocument();
    expect(screen.getByText("Voice - Boris Russian")).toBeInTheDocument();
  });

  it("State B (unlocked): clicking a persona portrait opens a lightbox", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "p-1",
          displayName: "Masha",
          portraitImageUrl: "/api/persona-portrait/ws-1/p-1/hash.jpg",
          heygenVoiceId: "ru-RU-Masha",
          heygenVoiceLabel: "Masha Russian",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: []
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    const portraitButton = await screen.findByRole("button", { name: "Open portrait: Masha" });
    fireEvent.click(portraitButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close portrait preview" })).toBeInTheDocument();
      expect(screen.getAllByRole("img", { name: "Masha" }).length).toBeGreaterThan(1);
    });
  });

  it("Create flow: opens modal on Create click", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled();
    });

    const createBtn = await screen.findByRole("button", { name: "Create character" });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Character name")).toBeInTheDocument();
    });
  });

  it("Create flow: locked create slot stays disabled and does not open the modal", async () => {
    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: false }) }),
      "characters"
    );

    const createBtn = await screen.findByRole("button", { name: "Create character" });
    expect(createBtn).toBeDisabled();

    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("Create flow: EN filter still shows human-readable English, and OTHER supports language search", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "voice-en-1",
          name: "Allison",
          language: "English",
          gender: "female",
          previewAudioUrl: null,
          languageBucket: "other"
        },
        {
          voiceId: "voice-ru-1",
          name: "Boris",
          language: "Russian",
          gender: "male",
          previewAudioUrl: null,
          languageBucket: "other"
        },
        {
          voiceId: "voice-es-1",
          name: "Carlos",
          language: "Spanish",
          gender: "male",
          previewAudioUrl: null,
          languageBucket: "other"
        }
      ]
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    const createBtn = await screen.findByRole("button", { name: "Create character" });
    fireEvent.click(createBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "RU" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "OTHER" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "MY" })).toBeInTheDocument();

    await waitFor(() => {
      expect(within(dialog).getByText("Allison")).toBeInTheDocument();
      expect(within(dialog).queryByText("Boris")).toBeNull();
      expect(within(dialog).queryByText("Carlos")).toBeNull();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "OTHER" }));
    await waitFor(() => {
      expect(within(dialog).getByText("Carlos")).toBeInTheDocument();
      expect(within(dialog).getByText("Spanish · male")).toBeInTheDocument();
      expect(within(dialog).queryByText("Allison")).toBeNull();
      expect(within(dialog).queryByText("Boris")).toBeNull();
    });

    fireEvent.change(within(dialog).getByPlaceholderText("Search language, e.g. Spanish"), {
      target: { value: "span" }
    });
    await waitFor(() => {
      expect(within(dialog).getByText("Carlos")).toBeInTheDocument();
    });

    fireEvent.change(within(dialog).getByPlaceholderText("Search language, e.g. Spanish"), {
      target: { value: "italian" }
    });
    await waitFor(() => {
      expect(
        within(dialog).getByText("No voices found for this language search.")
      ).toBeInTheDocument();
      expect(within(dialog).queryByText("Carlos")).toBeNull();
    });
  });

  it("Create flow: RU voice catalog prioritizes ElevenLabs, then pro HeyGen, then other voices", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          catalogId: "ru-gemini",
          voiceId: "ru-gemini",
          name: "Gacrux",
          language: "ru",
          gender: "female",
          previewAudioUrl: "https://static.heygen.ai/voice_preview/gemini/gacrux.wav",
          languageBucket: "ru",
          source: "gemini",
          qualityTags: [],
          qualityRank: -60,
          previewAvailable: false,
          localeControl: false,
          pauseSupport: false
        },
        {
          catalogId: "ru-heygen-pro",
          voiceId: "ru-heygen-pro",
          name: "Dariya - Professional",
          language: "Russian",
          gender: "female",
          previewAudioUrl: "https://resource.heygen.ai/text_to_speech/dariya.wav",
          languageBucket: "ru",
          source: "heygen",
          qualityTags: ["professional"],
          qualityRank: 88,
          previewAvailable: true,
          localeControl: false,
          pauseSupport: true
        },
        {
          catalogId: "ru-eleven",
          voiceId: "ru-eleven",
          name: "Nadia",
          language: "Russian",
          gender: "female",
          previewAudioUrl:
            "https://resource.heygen.ai/text_to_speech/model=eleven_multilingual_v2.mp3",
          languageBucket: "ru",
          source: "elevenlabs",
          qualityTags: [],
          qualityRank: 128,
          previewAvailable: true,
          localeControl: false,
          pauseSupport: true
        }
      ]
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Create character" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "RU" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Nadia")).toBeInTheDocument();
      expect(within(dialog).getByText("ElevenLabs")).toBeInTheDocument();
      expect(within(dialog).getByText("Pro")).toBeInTheDocument();
    });

    const names = within(dialog)
      .getAllByText(/Nadia|Dariya - Professional|Gacrux/)
      .map((node) => node.textContent);
    expect(names).toEqual(["Nadia", "Dariya - Professional", "Gacrux"]);
  });

  it("Create flow: insufficient balance disables submit", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 200
    });

    renderSettings(
      makeAppData({
        plan: {
          ...makePlanData({ talkingVideoEnabled: true }),
          workspaceVcoinBalance: { balanceVc: 10, videoVcoinMonthlyGrant: 0, vcoinExchangeRate: 20 }
        } as unknown as NonNullable<AppData["plan"]>
      }),
      "characters"
    );

    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled();
    });

    const createBtn = await screen.findByRole("button", { name: "Create character" });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText("Insufficient balance — top up")).toBeInTheDocument();
    });
  });

  it("Create flow: persona limit reached disables the shared create slot", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "p-1",
          displayName: "PersonaAlpha",
          portraitImageUrl: "",
          heygenVoiceId: "v-1",
          heygenVoiceLabel: "Voice A",
          createdAt: new Date().toISOString()
        },
        {
          id: "p-2",
          displayName: "PersonaBeta",
          portraitImageUrl: "",
          heygenVoiceId: "v-2",
          heygenVoiceLabel: "Voice B",
          createdAt: new Date().toISOString()
        },
        {
          id: "p-3",
          displayName: "PersonaGamma",
          portraitImageUrl: "",
          heygenVoiceId: "v-3",
          heygenVoiceLabel: "Voice C",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => {
      expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled();
    });

    await waitFor(() => {
      const createBtn = screen.getByRole("button", { name: "Create character" });
      expect(createBtn).toBeDisabled();
      expect(createBtn).toHaveAttribute("title", "Character limit reached (3)");
    });
  });

  it("i18n keys exist for both locales with the cleaner voice label", () => {
    expect(enMessages.settings.charactersVoiceLabel).toBe("Voice - {voice}");
    expect(ruMessages.settings.charactersVoiceLabel).toBe("Голос - {voice}");
    expect(enMessages.settings.voicesMakeDefault).toBe("Default");
    expect(ruMessages.settings.voicesMakeDefault).toBe("По умолчанию");
    expect(enMessages.settings.voicesRecordPromptTitle).toBe("Quick guide");
    expect(ruMessages.settings.voicesRecordPromptTitle).toBe("Краткая инструкция");
    expect(enMessages.settings.voicesRightsConfirmation).toBe("I confirm that I own this voice.");
    expect(ruMessages.settings.voicesRightsConfirmation).toBe(
      "Я подтверждаю, что владею этим голосом."
    );
    expect(enMessages.settings.charactersUsageHint.length).toBeGreaterThan(0);
    expect(ruMessages.settings.charactersUsageHint.length).toBeGreaterThan(0);
    expect(enMessages.settings.charactersLockedBanner.length).toBeGreaterThan(0);
    expect(ruMessages.settings.charactersLockedBanner.length).toBeGreaterThan(0);
  });

  it("Delete flow: opens confirm modal on delete click", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "p-del",
          displayName: "DeleteMe",
          portraitImageUrl: "",
          heygenVoiceId: "v-1",
          heygenVoiceLabel: "Voice 1",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => {
      expect(screen.getByText("DeleteMe")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole("button", { name: "Delete character" });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Delete character «DeleteMe»\? VC is not refunded\./)
      ).toBeInTheDocument();
    });
  });

  it("Delete flow: DELETE called + list refreshes on confirm", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "p-del",
          displayName: "DeleteMe",
          portraitImageUrl: "",
          heygenVoiceId: "v-1",
          heygenVoiceLabel: "Voice 1",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => {
      expect(screen.getByText("DeleteMe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete character" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });

    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(assistantApiMocks.deleteWorkspaceVideoPersona).toHaveBeenCalledWith(
        "token-1",
        "ws-1",
        "p-del"
      );
    });
  });

  it("Create flow: storageWarning 'persona_created_storage_failed' shows warning feedback", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "v-warn-test",
          name: "StorageWarnVoice",
          language: "en-US",
          gender: "female",
          previewAudioUrl: null,
          languageBucket: "en"
        }
      ]
    });
    assistantApiMocks.createWorkspaceVideoPersona.mockResolvedValue({
      persona: {
        id: "p-warn",
        displayName: "WarnPersona",
        portraitImageUrl: "",
        videoFormat: "1:1",
        heygenVoiceId: "v-warn-test",
        heygenVoiceLabel: "StorageWarnVoice",
        createdAt: new Date().toISOString()
      },
      walletBalanceVc: 80,
      storageWarning: "persona_created_storage_failed"
    });

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:test-portrait")
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled());

    const createBtn = await screen.findByRole("button", { name: "Create character" });
    fireEvent.click(createBtn);

    // Wait for dialog with the form
    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(within(dialog).getByPlaceholderText("Character name")).toBeInTheDocument()
    );

    // Fill name
    fireEvent.change(within(dialog).getByPlaceholderText("Character name"), {
      target: { value: "WarnPersona" }
    });

    // Select voice from list (click on the span with the voice name inside the dialog)
    await waitFor(() => expect(within(dialog).getByText("StorageWarnVoice")).toBeInTheDocument());
    const voiceNameSpan = within(dialog).getByText("StorageWarnVoice");
    fireEvent.click(voiceNameSpan.closest('[role="button"]')!);

    // Attach portrait file via hidden file input inside the dialog
    const portraitInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile = new File(["data"], "portrait.jpg", { type: "image/jpeg" });
    Object.defineProperty(portraitInput, "files", {
      value: [fakeFile],
      configurable: true
    });
    fireEvent.change(portraitInput);

    // Submit button inside dialog should now be enabled
    await waitFor(() => {
      const submitBtn = within(dialog).getByRole("button", { name: "Create character" });
      expect(submitBtn).not.toBeDisabled();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create character" }));

    await waitFor(() => {
      expect(assistantApiMocks.createWorkspaceVideoPersona).toHaveBeenCalled();
    });

    // Warning feedback shown (not generic success)
    await waitFor(() => {
      expect(
        screen.getByText(/WarnPersona was created but the portrait could not be saved/)
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Character created.")).toBeNull();
  });

  it("Create flow error: API error code 'persona_limit_reached' maps to i18n message", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "v-err-1",
          name: "ErrVoice",
          language: "en-US",
          gender: "male",
          previewAudioUrl: null,
          languageBucket: "en"
        }
      ]
    });
    assistantApiMocks.createWorkspaceVideoPersona.mockRejectedValue(
      new ApiStructuredError("Character limit reached.", "persona_limit_reached")
    );

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:test-portrait-err")
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled());

    const createBtn = await screen.findByRole("button", { name: "Create character" });
    fireEvent.click(createBtn);

    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(within(dialog).getByPlaceholderText("Character name")).toBeInTheDocument()
    );

    fireEvent.change(within(dialog).getByPlaceholderText("Character name"), {
      target: { value: "LimitTestPersona" }
    });

    await waitFor(() => expect(within(dialog).getByText("ErrVoice")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByText("ErrVoice").closest('[role="button"]')!);

    const portraitInput2 = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile2 = new File(["data"], "portrait.jpg", { type: "image/jpeg" });
    Object.defineProperty(portraitInput2, "files", {
      value: [fakeFile2],
      configurable: true
    });
    fireEvent.change(portraitInput2);

    await waitFor(() => {
      const submitBtn = within(dialog).getByRole("button", { name: "Create character" });
      expect(submitBtn).not.toBeDisabled();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create character" }));

    await waitFor(() => {
      expect(assistantApiMocks.createWorkspaceVideoPersona).toHaveBeenCalled();
    });

    // Should show specific i18n message, not the generic fallback
    await waitFor(() => {
      expect(screen.getByText("Character limit reached for this workspace.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Failed to create character. Please try again.")).toBeNull();
  });

  it("Create flow error: API error code 'persona_duplicate_name' maps to i18n message", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "v-dup-1",
          name: "DupVoice",
          language: "en-US",
          gender: "female",
          previewAudioUrl: null,
          languageBucket: "en"
        }
      ]
    });
    assistantApiMocks.createWorkspaceVideoPersona.mockRejectedValue(
      new ApiStructuredError("Duplicate name.", "persona_duplicate_name")
    );

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:test-portrait-dup")
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => expect(assistantApiMocks.getWorkspaceVideoPersonas).toHaveBeenCalled());

    const createBtn = await screen.findByRole("button", { name: "Create character" });
    fireEvent.click(createBtn);

    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(within(dialog).getByPlaceholderText("Character name")).toBeInTheDocument()
    );

    fireEvent.change(within(dialog).getByPlaceholderText("Character name"), {
      target: { value: "DuplicatePersona" }
    });

    await waitFor(() => expect(within(dialog).getByText("DupVoice")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByText("DupVoice").closest('[role="button"]')!);

    const portraitInput3 = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile3 = new File(["data"], "portrait.jpg", { type: "image/jpeg" });
    Object.defineProperty(portraitInput3, "files", {
      value: [fakeFile3],
      configurable: true
    });
    fireEvent.change(portraitInput3);

    await waitFor(() => {
      const submitBtn = within(dialog).getByRole("button", { name: "Create character" });
      expect(submitBtn).not.toBeDisabled();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create character" }));

    await waitFor(() => {
      expect(assistantApiMocks.createWorkspaceVideoPersona).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("A character with this name already exists.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Failed to create character. Please try again.")).toBeNull();
  });

  it("renders ready, pending, and failed cloned voices and keeps pending/failed out of persona selection", async () => {
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "persona-linked",
          displayName: "Kurock",
          portraitImageUrl: "",
          heygenVoiceId: "voice-default",
          heygenVoiceLabel: "Warm Voice",
          clonedVoiceId: "clone-ready",
          clonedVoiceDisplayName: "Ready Voice",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });
    assistantApiMocks.getWorkspaceVideoClonedVoices.mockResolvedValue({
      clonedVoices: [
        {
          id: "clone-ready",
          displayName: "Ready Voice",
          status: "ready",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: "https://cdn.example.com/ready.mp3",
          createdAt: new Date().toISOString()
        },
        {
          id: "clone-pending",
          displayName: "Pending Voice",
          status: "pending",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "clone-failed",
          displayName: "Failed Voice",
          status: "failed",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        }
      ],
      limit: 5,
      creationVcoinCost: 50
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    await waitFor(() => {
      expect(screen.getByText("My voices")).toBeInTheDocument();
    });

    expect(screen.queryByText("Ready")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /My voices/i }));

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Linked to Kurock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Default" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Create character" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByText("Ready Voice")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "MY" }));

    expect(within(dialog).getByText("Ready Voice")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Pending Voice" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Failed Voice" })).toBeNull();
  });

  it("counts failed cloned voices toward the clone-create limit gate", async () => {
    assistantApiMocks.getWorkspaceVideoClonedVoices.mockResolvedValue({
      clonedVoices: [
        {
          id: "clone-ready-1",
          displayName: "Ready One",
          status: "ready",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "clone-ready-2",
          displayName: "Ready Two",
          status: "ready",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "clone-pending-1",
          displayName: "Pending One",
          status: "pending",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "clone-pending-2",
          displayName: "Pending Two",
          status: "pending",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "clone-failed-1",
          displayName: "Failed One",
          status: "failed",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        }
      ],
      limit: 5,
      creationVcoinCost: 50
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    const cloneButton = await screen.findByRole("button", { name: "Clone a voice" });
    await waitFor(() => {
      expect(cloneButton).toBeDisabled();
    });

    fireEvent.click(cloneButton);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("validates clone upload name, audio, rights, and balance gating", async () => {
    renderSettings(
      makeAppData({
        plan: {
          ...makePlanData({ talkingVideoEnabled: true }),
          workspaceVcoinBalance: { balanceVc: 10, videoVcoinMonthlyGrant: 0, vcoinExchangeRate: 20 }
        } as unknown as NonNullable<AppData["plan"]>
      }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Clone a voice" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).queryByText(
        "One clean sample is enough. Use one speaker in a quiet room and record 20-60 seconds of steady speech."
      )
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Accepted: audio files up to 25 MB. A clean voice sample of at least 60 seconds works best."
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByText("I confirm that I own this voice.")).toBeInTheDocument();
    expect(
      screen.getAllByText("Cost: 50 VC. Balance: 10 VC. Limit: 5 voices").length
    ).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Create voice clone" })).toBeDisabled();

    fireEvent.change(within(dialog).getByPlaceholderText("Voice name"), {
      target: { value: "Founder Voice" }
    });

    const audioInput = document.getElementById("voice-clone-audio-input") as HTMLInputElement;
    const invalidFile = new File(["bad"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(audioInput, "files", {
      value: [invalidFile],
      configurable: true
    });
    fireEvent.change(audioInput);

    await waitFor(() => {
      expect(screen.getByText("Only audio files are accepted.")).toBeInTheDocument();
    });

    const validFile = new File(["voice"], "voice.webm", { type: "audio/webm" });
    Object.defineProperty(audioInput, "files", {
      value: [validFile],
      configurable: true
    });
    fireEvent.change(audioInput);
    fireEvent.click(within(dialog).getByRole("checkbox"));

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Create voice clone" })).toBeDisabled();
    });
  });

  it("revokes cloned-voice preview URLs on replacement and close", async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:voice-preview-1")
      .mockReturnValueOnce("blob:voice-preview-2");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Clone a voice" }));
    const dialog = await screen.findByRole("dialog");
    const audioInput = document.getElementById("voice-clone-audio-input") as HTMLInputElement;

    const firstFile = new File(["voice-one"], "voice-one.webm", { type: "audio/webm" });
    Object.defineProperty(audioInput, "files", {
      value: [firstFile],
      configurable: true
    });
    fireEvent.change(audioInput);

    const secondFile = new File(["voice-two"], "voice-two.webm", { type: "audio/webm" });
    Object.defineProperty(audioInput, "files", {
      value: [secondFile],
      configurable: true
    });
    fireEvent.change(audioInput);

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:voice-preview-1");
    });

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Cancel" })[0]!);

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:voice-preview-2");
    });
  });

  it("shows record-mode microphone fallback copy when permission fails", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied"))
      }
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Clone a voice" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));

    await waitFor(() => {
      expect(
        within(dialog).getByText(
          "Microphone access failed. You can upload an audio sample instead."
        )
      ).toBeInTheDocument();
    });
  });

  it("ignores a stale getUserMedia result after the clone modal closes", async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }]
    } as unknown as MediaStream;
    let resolveGetUserMedia: (value: MediaStream) => void = () => undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        })
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const mediaRecorder = vi.fn();
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Object.assign(mediaRecorder, {
        isTypeSupported: vi.fn(() => true)
      })
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Clone a voice" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Cancel" })[0]!);

    resolveGetUserMedia(stream);

    await waitFor(() => {
      expect(stop).toHaveBeenCalled();
    });
    expect(mediaRecorder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /Stop recording/i })).toBeNull();
  });

  it("ignores an older clone recording start attempt when a newer one begins", async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const firstStream = {
      getTracks: () => [{ stop: firstStop }]
    } as unknown as MediaStream;
    const secondStream = {
      getTracks: () => [{ stop: secondStop }]
    } as unknown as MediaStream;
    let resolveFirst: (value: MediaStream) => void = () => undefined;
    let resolveSecond: (value: MediaStream) => void = () => undefined;
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolveSecond = resolve;
          })
      );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const mediaRecorder = vi.fn(function MediaRecorderMock(this: Record<string, unknown>) {
      this.state = "inactive";
      this.start = vi.fn(() => {
        this.state = "recording";
      });
      this.stop = vi.fn(() => {
        this.state = "inactive";
      });
      this.ondataavailable = null;
      this.onstop = null;
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Object.assign(mediaRecorder, {
        isTypeSupported: vi.fn(() => true)
      })
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Clone a voice" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));

    const startButton = within(dialog).getByRole("button", { name: "Start recording" });
    fireEvent.click(startButton);
    fireEvent.click(startButton);

    resolveFirst(firstStream);
    await waitFor(() => {
      expect(firstStop).toHaveBeenCalled();
    });
    expect(mediaRecorder).not.toHaveBeenCalled();

    resolveSecond(secondStream);
    await waitFor(() => {
      expect(mediaRecorder).toHaveBeenCalledTimes(1);
    });
    expect(mediaRecorder).toHaveBeenCalledWith(secondStream, {
      mimeType: "audio/webm;codecs=opus"
    });
    expect(secondStop).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: /Stop recording/i })).toBeInTheDocument();
  });

  it("revokes persona portrait preview URLs on replacement and cancel", async () => {
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "voice-1",
          name: "Amy",
          language: "English",
          gender: "female",
          previewAudioUrl: null,
          languageBucket: "en"
        }
      ]
    });
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:portrait-preview-1")
      .mockReturnValueOnce("blob:portrait-preview-2");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Create character" }));
    const dialog = await screen.findByRole("dialog");
    const portraitInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;

    const firstFile = new File(["portrait-one"], "portrait-one.jpg", { type: "image/jpeg" });
    Object.defineProperty(portraitInput, "files", {
      value: [firstFile],
      configurable: true
    });
    fireEvent.change(portraitInput);

    const secondFile = new File(["portrait-two"], "portrait-two.jpg", { type: "image/jpeg" });
    Object.defineProperty(portraitInput, "files", {
      value: [secondFile],
      configurable: true
    });
    fireEvent.change(portraitInput);

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:portrait-preview-1");
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:portrait-preview-2");
    });
  });

  it("forwards clonedVoiceId on create and preserves preset fallback on edit clear", async () => {
    assistantApiMocks.getWorkspaceVoiceCatalog.mockResolvedValue({
      provider: "heygen",
      voices: [
        {
          voiceId: "en-US-Amy",
          name: "Amy",
          language: "English",
          gender: "female",
          previewAudioUrl: null,
          languageBucket: "en"
        }
      ]
    });
    assistantApiMocks.getWorkspaceVideoClonedVoices.mockResolvedValue({
      clonedVoices: [
        {
          id: "clone-ready",
          displayName: "Ready Voice",
          status: "ready",
          languageHint: "en",
          isDefault: false,
          previewAudioUrl: null,
          createdAt: new Date().toISOString()
        }
      ],
      limit: 5,
      creationVcoinCost: 50
    });
    assistantApiMocks.getWorkspaceVideoPersonas.mockResolvedValue({
      personas: [
        {
          id: "persona-edit",
          displayName: "Masha",
          portraitImageUrl: "/api/persona-portrait/ws-1/p-1/hash.jpg",
          videoFormat: "1:1",
          heygenVoiceId: "en-US-Amy",
          heygenVoiceLabel: "Preset Voice",
          clonedVoiceId: "clone-ready",
          clonedVoiceDisplayName: "Ready Voice",
          createdAt: new Date().toISOString()
        }
      ],
      limit: 3,
      creationVcoinCost: 20
    });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Create character" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Character name"), {
      target: { value: "Alice" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "MY" }));
    fireEvent.click(within(dialog).getByText("Ready Voice").closest('[role="button"]')!);
    const portraitInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile = new File(["data"], "portrait.jpg", { type: "image/jpeg" });
    Object.defineProperty(portraitInput, "files", {
      value: [fakeFile],
      configurable: true
    });
    fireEvent.change(portraitInput);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create character" }));

    await waitFor(() => {
      expect(assistantApiMocks.createWorkspaceVideoPersona).toHaveBeenCalledWith(
        "token-1",
        "ws-1",
        {
          displayName: "Alice",
          videoFormat: "1:1",
          heygenVoiceId: "en-US-Amy",
          clonedVoiceId: "clone-ready",
          portrait: fakeFile
        }
      );
    });

    fireEvent.click(await screen.findByText("Masha"));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "EN" }));
    fireEvent.click(within(dialog).getByText("Amy").closest('[role="button"]')!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(assistantApiMocks.updateWorkspaceVideoPersona).toHaveBeenCalledWith(
        "token-1",
        "ws-1",
        "persona-edit",
        {
          displayName: "Masha",
          videoFormat: "1:1",
          heygenVoiceId: "en-US-Amy",
          clonedVoiceId: null
        }
      );
    });
  });

  it("inline clone path attaches the new ready voice to the persona form", async () => {
    assistantApiMocks.getWorkspaceVideoClonedVoices
      .mockResolvedValueOnce({
        clonedVoices: [],
        limit: 5,
        creationVcoinCost: 50
      })
      .mockResolvedValueOnce({
        clonedVoices: [
          {
            id: "clone-1",
            displayName: "Fresh Voice",
            status: "ready",
            languageHint: "en",
            isDefault: false,
            previewAudioUrl: null,
            createdAt: new Date().toISOString()
          }
        ],
        limit: 5,
        creationVcoinCost: 50
      });

    renderSettings(
      makeAppData({ plan: makePlanData({ talkingVideoEnabled: true }) }),
      "characters"
    );

    fireEvent.click(await screen.findByRole("button", { name: "Create character" }));
    const personaDialog = await screen.findByRole("dialog");
    fireEvent.click(within(personaDialog).getByRole("button", { name: "MY" }));
    fireEvent.click(within(personaDialog).getByRole("button", { name: "Clone a new voice" }));

    const cloneDialogs = screen.getAllByRole("dialog");
    expect(cloneDialogs).toHaveLength(2);
    const cloneDialog = cloneDialogs[1]!;
    fireEvent.change(within(cloneDialog).getByPlaceholderText("Voice name"), {
      target: { value: "Fresh Voice" }
    });
    const audioInput = document.getElementById("voice-clone-audio-input") as HTMLInputElement;
    const audioFile = new File(["voice"], "fresh.wav", { type: "audio/wav" });
    Object.defineProperty(audioInput, "files", {
      value: [audioFile],
      configurable: true
    });
    fireEvent.change(audioInput);
    fireEvent.click(within(cloneDialog).getByRole("checkbox"));
    fireEvent.click(within(cloneDialog).getByRole("button", { name: "Create voice clone" }));

    await waitFor(() => {
      expect(assistantApiMocks.createWorkspaceVideoClonedVoice).toHaveBeenCalled();
    });
    expect(assistantApiMocks.createWorkspaceVideoClonedVoice).toHaveBeenCalledWith(
      "token-1",
      "ws-1",
      expect.objectContaining({
        displayName: "Fresh Voice",
        audio: audioFile,
        removeBackgroundNoise: true
      }),
      { hardTimeoutMs: 180_000 }
    );
    expect(clerkMocks.getToken).toHaveBeenCalledWith({ skipCache: true });

    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog")).getByText("Using cloned voice: Fresh Voice")
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Smoke: NextIntl wrapping behaviour
// ---------------------------------------------------------------------------

describe("test harness sanity", () => {
  it("can render an empty AssistantSettings without crashing", async () => {
    render(withIntl(<AssistantSettings data={makeAppData()} initialSection="memory" />));
    await waitFor(() => {
      expect(assistantApiMocks.getAssistantMemoryItems).toHaveBeenCalled();
    });
  });
});
