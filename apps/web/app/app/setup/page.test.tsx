import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantLifecycleState } from "@persai/contracts";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import SetupWizardPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn()
}));

const meApiMocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  postOnboarding: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  getAssistant: vi.fn(),
  postAssistantCreate: vi.fn(),
  patchAssistantDraft: vi.fn(),
  postAssistantSetupPreview: vi.fn(),
  uploadAssistantAvatar: vi.fn(),
  postAssistantPublish: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    )
  }
}));

vi.mock("../me-api-client", async () => {
  const actual = await vi.importActual<typeof import("../me-api-client")>("../me-api-client");
  return {
    ...actual,
    getMe: meApiMocks.getMe,
    postOnboarding: meApiMocks.postOnboarding
  };
});

vi.mock("../assistant-api-client", async () => {
  const actual =
    await vi.importActual<typeof import("../assistant-api-client")>("../assistant-api-client");
  return {
    ...actual,
    getAssistant: assistantApiMocks.getAssistant,
    postAssistantCreate: assistantApiMocks.postAssistantCreate,
    patchAssistantDraft: assistantApiMocks.patchAssistantDraft,
    postAssistantSetupPreview: assistantApiMocks.postAssistantSetupPreview,
    uploadAssistantAvatar: assistantApiMocks.uploadAssistantAvatar,
    postAssistantPublish: assistantApiMocks.postAssistantPublish
  };
});

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
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: "female",
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "ru-RU",
        deliveryKind: "voice_note",
        elevenlabs: {
          voiceId: null
        },
        yandex: {
          voice: "jane",
          role: "friendly"
        },
        openai: {
          voice: "marin"
        }
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

function makeMeResponse() {
  return {
    requestId: "req-1",
    me: {
      appUser: {
        id: "user-1",
        clerkUserId: "clerk-user-1",
        email: "user@example.com",
        displayName: "Alex",
        birthday: "1990-05-20T00:00:00.000Z",
        gender: "male"
      },
      onboarding: {
        isComplete: true,
        status: "completed" as const
      },
      compliance: {
        termsOfService: {
          requiredVersion: "persai_tos_mvp_v1",
          acceptedVersion: "persai_tos_mvp_v1",
          acceptedAt: "2026-03-29T10:00:00.000Z",
          accepted: true
        },
        privacyPolicy: {
          requiredVersion: "persai_privacy_mvp_v1",
          acceptedVersion: "persai_privacy_mvp_v1",
          acceptedAt: "2026-03-29T10:00:00.000Z",
          accepted: true
        },
        retentionAndDeleteBaseline: {
          retentionModel: "user_controlled_no_silent_ttl" as const,
          chatRetention: "retained_until_archive_or_hard_delete" as const,
          memoryRegistryRetention: "retained_until_forget_or_do_not_remember" as const,
          taskRegistryRetention: "retained_until_user_control_change" as const,
          deleteModel: "explicit_action_only" as const,
          auditModel: "append_only_immutable" as const
        }
      },
      workspace: {
        id: "ws-1",
        name: "Alex's workspace",
        locale: "en-US",
        timezone: "Europe/Berlin",
        status: "active" as const,
        role: "owner" as const
      }
    }
  };
}

describe("SetupWizardPage", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:avatar-preview"),
      revokeObjectURL: vi.fn()
    });
    clerkMocks.getToken.mockResolvedValue("token-1");
    assistantApiMocks.getAssistant.mockResolvedValue(null);
    meApiMocks.getMe.mockResolvedValue(makeMeResponse());
    meApiMocks.postOnboarding.mockResolvedValue(makeMeResponse());
    assistantApiMocks.postAssistantCreate.mockResolvedValue({
      assistant: makeAssistantState(),
      alreadyExisted: false
    });
    assistantApiMocks.patchAssistantDraft.mockResolvedValue(makeAssistantState());
    assistantApiMocks.postAssistantSetupPreview.mockResolvedValue({
      message: "Hi Alex, I'm Nova. I'll keep things clear, warm, and proactive.",
      respondedAt: "2026-04-01T10:01:00.000Z"
    });
    assistantApiMocks.uploadAssistantAvatar.mockResolvedValue({
      avatarUrl: "https://example.com/avatar.png"
    });
    assistantApiMocks.postAssistantPublish.mockResolvedValue(makeAssistantState());
  });

  afterEach(() => {
    cleanupLocation();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function renderWithIntl(ui: ReactNode) {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {ui}
      </NextIntlClientProvider>
    );
  }

  it("prefills recreate profile fields from /me and normalizes birthday", async () => {
    renderWithIntl(<SetupWizardPage />);

    expect(await screen.findByDisplayValue("Alex")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1990-05-20")).toBeInTheDocument();
    expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
  });

  it("loads runtime preview from persisted draft and publishes with uploaded avatar", async () => {
    clerkMocks.getToken
      .mockResolvedValueOnce("token-prefill")
      .mockResolvedValueOnce("token-onboarding-preview")
      .mockResolvedValueOnce("token-create-preview")
      .mockResolvedValueOnce("token-patch-preview")
      .mockResolvedValueOnce("token-runtime-preview")
      .mockResolvedValueOnce("token-create")
      .mockResolvedValueOnce("token-avatar")
      .mockResolvedValueOnce("token-final-patch")
      .mockResolvedValueOnce("token-publish");

    const { container } = renderWithIntl(<SetupWizardPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: /continue/i })).at(-1)!);

    fireEvent.change(screen.getByPlaceholderText(/name — e\.g\./i), {
      target: { value: "Nova" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Female" }).at(-1)!);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["avatar"], "avatar.png", { type: "image/png" })]
      }
    });

    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);
    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);

    expect(
      await screen.findByText("Hi Alex, I'm Nova. I'll keep things clear, warm, and proactive.")
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantSetupPreview).toHaveBeenCalledTimes(1);
    });
    expect(meApiMocks.postOnboarding).toHaveBeenCalledWith(
      "token-onboarding-preview",
      expect.any(Object)
    );
    expect(assistantApiMocks.postAssistantCreate).toHaveBeenCalledWith("token-create-preview");
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledWith(
      "token-patch-preview",
      expect.objectContaining({
        displayName: "Nova",
        assistantGender: "female",
        avatarEmoji: null,
        avatarUrl: null
      })
    );
    expect(assistantApiMocks.postAssistantSetupPreview).toHaveBeenCalledWith(
      "token-runtime-preview"
    );

    fireEvent.click(screen.getByRole("button", { name: /create assistant/i }));

    await waitFor(() => {
      expect(assistantApiMocks.uploadAssistantAvatar).toHaveBeenCalledTimes(1);
      expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledTimes(1);
    });
    expect(assistantApiMocks.uploadAssistantAvatar).toHaveBeenCalledWith(
      "token-avatar",
      expect.any(File)
    );
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenLastCalledWith(
      "token-final-patch",
      expect.objectContaining({
        displayName: "Nova",
        assistantGender: "female",
        avatarEmoji: null,
        avatarUrl: "https://example.com/avatar.png"
      })
    );
    expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledWith("token-publish");
  }, 10000);
});

function cleanupLocation() {
  try {
    window.history.replaceState({}, "", "/");
  } catch {
    // ignore jsdom navigation cleanup
  }
}
