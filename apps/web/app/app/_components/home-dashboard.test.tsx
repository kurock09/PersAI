import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import { HomeDashboard } from "./home-dashboard";
import type { AppData } from "./use-app-data";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

function makeData(): AppData {
  return {
    assistant: {
      id: "assistant-1",
      userId: "user-1",
      workspaceId: "ws-1",
      draft: {
        displayName: "Nova",
        instructions: "",
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
        voiceProfile: null,
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
    },
    assistantStatus: "live",
    assistantResolved: true,
    chats: [],
    telegram: null,
    notificationPreference: null,
    plan: null,
    isAdmin: false,
    isLoading: false,
    isReloading: false,
    isReloadingChats: false,
    error: null,
    reload: vi.fn(),
    reloadChats: vi.fn()
  } as unknown as AppData;
}

function makeDataWithRecentChats(): AppData {
  return {
    ...makeData(),
    chats: [
      {
        chat: {
          id: "chat-project",
          surfaceThreadKey: "thread-project",
          title: "Project plan",
          chatMode: "project",
          archivedAt: null,
          createdAt: "2026-04-01T10:00:00.000Z",
          lastMessageAt: "2026-04-01T10:05:00.000Z"
        },
        messageCount: 2,
        lastMessagePreview: "Quiet latest message",
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: [],
        activeSandboxJobs: [
          {
            jobRef: "sandbox-job-ref-1",
            toolCode: "shell",
            status: "running",
            notifyState: "none",
            createdAt: "2026-04-01T10:04:00.000Z",
            startedAt: "2026-04-01T10:04:01.000Z",
            updatedAt: "2026-04-01T10:04:01.000Z"
          }
        ]
      },
      {
        chat: {
          id: "chat-smart",
          surfaceThreadKey: "thread-smart",
          title: "Smart answer",
          chatMode: "deep",
          archivedAt: null,
          createdAt: "2026-04-01T09:00:00.000Z",
          lastMessageAt: "2026-04-01T09:05:00.000Z"
        },
        messageCount: 3,
        lastMessagePreview: "Thinking in background",
        activeTurn: { clientTurnId: "turn-1" },
        activeMediaJobs: [],
        activeDocumentJobs: [],
        activeSandboxJobs: []
      }
    ]
  } as unknown as AppData;
}

describe("HomeDashboard", () => {
  it("keeps quick actions without the old prompt cards", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HomeDashboard data={makeData()} onSettingsClick={() => undefined} />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "What can you help me with?" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tell me something interesting" })
    ).not.toBeInTheDocument();
  });

  it("renders premium recent-chat mode and activity indicators", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HomeDashboard data={makeDataWithRecentChats()} onSettingsClick={() => undefined} />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("button", { name: /Project plan/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
    expect(screen.getByLabelText("Smarter")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Generating reply")).toHaveLength(2);
    expect(screen.getByText("Quiet latest message")).toBeInTheDocument();
  });
});
