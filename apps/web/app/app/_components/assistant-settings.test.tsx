import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { AssistantLifecycleState, AssistantMemoryRegistryItemState } from "@persai/contracts";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";

import { AssistantSettings, mergeMemoryViews } from "./assistant-settings";
import type { AppData } from "./use-app-data";
import type { WorkspaceMemoryItem } from "../assistant-api-client";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  getAssistantMemoryItems: vi.fn(),
  getAssistantTaskItems: vi.fn(),
  getAssistantBackgroundTaskItems: vi.fn(),
  getAssistantVoiceSettings: vi.fn(),
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
  postAssistantBillingDisableAutoRenew: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks
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
    postAssistantBillingDisableAutoRenew: assistantApiMocks.postAssistantBillingDisableAutoRenew
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
    assistantStatus: "live",
    assistantResolved: true,
    chats: [],
    telegram: null,
    notificationPreference: { selectedChannel: "web", availableChannels: ["web"] },
    plan: null,
    isAdmin: false,
    isLoading: false,
    isReloading: false,
    isReloadingChats: false,
    error: null,
    reload: vi.fn(),
    reloadChats: vi.fn(),
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
  section = "memory",
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
  clerkMocks.getToken.mockResolvedValue("token-1");
  assistantApiMocks.getAssistantMemoryItems.mockResolvedValue([]);
  assistantApiMocks.getAssistantTaskItems.mockResolvedValue([]);
  assistantApiMocks.getAssistantBackgroundTaskItems.mockResolvedValue([]);
  assistantApiMocks.getAssistantVoiceSettings.mockResolvedValue({
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
    paymentMethodLabel: null,
    managePaymentMethodUrl: null,
    managePaymentMethodMode: "unavailable",
    cancelUrl: null,
    warning: null
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
    paymentMethodLabel: "Bank card",
    managePaymentMethodUrl: "https://my.cloudpayments.ru/",
    managePaymentMethodMode: "provider_portal",
    cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
    warning: null
  });
  assistantApiMocks.getAssistantFiles.mockResolvedValue({
    files: [],
    cleanup: { eligibleCount: 0, eligibleBytes: 0 }
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

  it("shows the Android release download banner in settings", () => {
    renderSettings(makeAppData(), "character");

    expect(screen.getByRole("link", { name: /Download Android APK/i })).toHaveAttribute(
      "href",
      "/mobile/persai-android-release.apk"
    );
  });

  it("uses update copy for the Android release action in the native shell", async () => {
    (window as unknown as { PersaiNative?: unknown }).PersaiNative = {};

    renderSettings(makeAppData(), "character");

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
          index % 3 === 0 ? "user_files" : index % 3 === 1 ? "assistant_created" : "media_uploads",
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
    const assistantBucket = screen.getByText("Created by assistant");
    const userBucket = screen.getByText("User files");
    expect(
      mediaBucket.compareDocumentPosition(assistantBucket) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      assistantBucket.compareDocumentPosition(userBucket) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText("Spec 0.pdf")).toBeNull();
    expect(screen.queryByText("Video 2.mp4")).toBeNull();
    expect(screen.queryByTitle("Open")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Media/i }));
    expect(screen.getByText("Video 2.mp4")).toBeInTheDocument();
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

    renderSettings();

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

    renderSettings();

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

    renderSettings();

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

    renderSettings();

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

    renderSettings();

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

    renderSettings();

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

    renderSettings();

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

    renderSettings();

    await screen.findByTestId("memory-center-workspace-list");
    expect(screen.queryByTestId(`close-open-loop-${resolved.id}`)).toBeNull();
    // The "Closed" status badge is rendered.
    expect(screen.getByText(/^closed$/i)).toBeInTheDocument();
  });
});

describe("AssistantSettings limits", () => {
  it("prioritizes token budget, hides disabled monthly media, and keeps tool limits collapsed by default", () => {
    const openPricingPage = vi.fn();

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
            paidFallbackPlanCode: null
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
                  toolCode: "image_generate",
                  displayName: "Image generation",
                  usedUnits: 2,
                  reservedUnits: 0,
                  settledUnits: 2,
                  releasedUnits: 0,
                  reconciliationRequiredUnits: 0,
                  limitUnits: 20,
                  remainingUnits: 18,
                  usageAvailable: true,
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
                  remainingUnits: null,
                  usageAvailable: true,
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
                  remainingUnits: null,
                  usageAvailable: true,
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
      { onOpenPricingPage: openPricingPage }
    );

    expect(screen.getByText("Trial until May 12")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Token budget")).toBeInTheDocument();
    expect(screen.getByText("2,100/10,000")).toBeInTheDocument();
    expect(screen.getByText("Image generations")).toBeInTheDocument();
    expect(screen.getByText("2/20")).toBeInTheDocument();
    expect(screen.queryByText("Image edits")).toBeNull();
    expect(screen.queryByText("Code execution")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    expect(openPricingPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Tool limits/i }));

    expect(screen.getByText("Active chats")).toBeInTheDocument();
    expect(screen.getByText("Media storage")).toBeInTheDocument();
    expect(screen.getByText("Knowledge storage")).toBeInTheDocument();
    expect(screen.getByText("Code execution")).toBeInTheDocument();
    expect(screen.getByText("Image editing")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("opens payment settings for recurring subscribers and disables auto-renew", async () => {
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
      paymentMethodLabel: "Bank card",
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
            paidFallbackPlanCode: null
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
    fireEvent.click(screen.getByRole("button", { name: "Payment settings" }));

    expect(
      await screen.findByText(
        "Manage auto-renew and payment method from server-truth billing state."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Bank card")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disable auto-renew" }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantBillingDisableAutoRenew).toHaveBeenCalledWith(
        "token-1"
      );
    });
    expect(
      await screen.findByText("Auto-renew was turned off for the current paid period.")
    ).toBeInTheDocument();
    expect(openPricingPage).not.toHaveBeenCalled();
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
            paidFallbackPlanCode: null
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
    expect(await screen.findByText("billing refresh failed")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByText("Provider-managed payment method")).toBeNull();
    expect(openPricingPage).not.toHaveBeenCalled();
  });

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
            paidFallbackPlanCode: null
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
