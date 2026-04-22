import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
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
  uploadAssistantAvatar: vi.fn()
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
    uploadAssistantAvatar: assistantApiMocks.uploadAssistantAvatar
  };
});

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("./assistant-knowledge-manager", () => ({
  AssistantKnowledgeManager: () => null
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

function renderSettings(data: AppData = makeAppData(), section = "memory"): void {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantSettings data={data} initialSection={section} />
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
  assistantApiMocks.getAssistantVoiceSettings.mockResolvedValue({
    schema: "persai.assistantVoiceSettings.v1",
    primaryProviderId: "openai",
    elevenlabs: null
  });
  assistantApiMocks.getWorkspaceMemoryItems.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
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
