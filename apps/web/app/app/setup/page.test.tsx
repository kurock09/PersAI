import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const appDataMocks = vi.hoisted(() => ({
  reload: vi.fn(),
  reloadChats: vi.fn()
}));

const meApiMocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  postOnboarding: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  getAssistant: vi.fn(),
  getAssistantPersonaArchetypes: vi.fn(),
  getAssistantVoiceSettings: vi.fn(),
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

vi.mock("../_components/app-shell", () => ({
  useAppDataContext: () => appDataMocks
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
    getAssistantPersonaArchetypes: assistantApiMocks.getAssistantPersonaArchetypes,
    getAssistantVoiceSettings: assistantApiMocks.getAssistantVoiceSettings,
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
      archetypeKey: "warm-quiet",
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

function makeResetAssistantState(): AssistantLifecycleState {
  const assistant = makeAssistantState();
  return {
    ...assistant,
    draft: {
      ...assistant.draft,
      displayName: null,
      instructions: null,
      traits: null,
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: null
    },
    latestPublishedVersion: null
  };
}

function makeRecoverableAssistantState(): AssistantLifecycleState {
  const assistant = makeAssistantState();
  return {
    ...assistant,
    runtimeApply: {
      ...assistant.runtimeApply,
      status: "failed"
    },
    draft: {
      ...assistant.draft,
      displayName: "Recovered Nova",
      instructions: "Stay concise and warm.",
      avatarEmoji: "🌟",
      assistantGender: "female"
    }
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

function makeVoiceSettings() {
  return {
    schema: "persai.assistantVoiceSettings.v1" as const,
    primaryProviderId: "elevenlabs" as const,
    elevenlabs: {
      configured: true,
      loadState: "ready" as const,
      voices: [
        {
          voiceId: "male-voice",
          name: "Adam",
          gender: "male" as const,
          category: null,
          previewUrl: null
        },
        {
          voiceId: "female-voice",
          name: "Bella",
          gender: "female" as const,
          category: null,
          previewUrl: null
        }
      ],
      warning: null
    }
  };
}

function makePersonaArchetypes() {
  return [
    {
      key: "warm-quiet",
      displayOrder: 1,
      label: { en: "Warm Quiet", ru: "Тёплый спокойный" },
      description: {
        en: "Soft, grounded, caring without pressure.",
        ru: "Мягкий, устойчивый, заботливый без давления."
      },
      voice: {
        sentenceLength: "short" as const,
        pace: "slow" as const,
        irony: 15
      },
      defaultTraits: {
        formality: 35,
        verbosity: 40,
        playfulness: 30,
        initiative: 50,
        warmth: 80
      }
    },
    {
      key: "dry-witty",
      displayOrder: 2,
      label: { en: "Dry Witty", ru: "Сухой остроумный" },
      description: {
        en: "Direct, crisp, slightly ironic when useful.",
        ru: "Прямой, собранный, местами ироничный по делу."
      },
      voice: {
        sentenceLength: "short" as const,
        pace: "quick" as const,
        irony: 55
      },
      defaultTraits: {
        formality: 70,
        verbosity: 35,
        playfulness: 45,
        initiative: 65,
        warmth: 35
      }
    }
  ];
}

describe("SetupWizardPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:avatar-preview"),
      revokeObjectURL: vi.fn()
    });
    clerkMocks.getToken.mockResolvedValue("token-1");
    assistantApiMocks.getAssistant.mockResolvedValue(null);
    assistantApiMocks.getAssistantPersonaArchetypes.mockResolvedValue(makePersonaArchetypes());
    assistantApiMocks.getAssistantVoiceSettings.mockResolvedValue(makeVoiceSettings());
    meApiMocks.getMe.mockResolvedValue(makeMeResponse());
    meApiMocks.postOnboarding.mockResolvedValue(makeMeResponse());
    assistantApiMocks.postAssistantCreate.mockResolvedValue(makeAssistantState());
    assistantApiMocks.patchAssistantDraft.mockResolvedValue(makeAssistantState());
    assistantApiMocks.postAssistantSetupPreview.mockResolvedValue({
      message: "Hi Alex, I'm Nova. I'll keep things clear, warm, and proactive.",
      respondedAt: "2026-04-01T10:01:00.000Z"
    });
    assistantApiMocks.uploadAssistantAvatar.mockResolvedValue({
      avatarUrl: "https://example.com/avatar.png"
    });
    assistantApiMocks.postAssistantPublish.mockResolvedValue(makeAssistantState());
    appDataMocks.reload.mockResolvedValue(undefined);
    appDataMocks.reloadChats.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    cleanupLocation();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
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
        instructions: null,
        assistantGender: "female",
        avatarEmoji: null,
        avatarUrl: null,
        voiceProfile: expect.objectContaining({
          elevenlabs: {
            voiceId: "female-voice"
          },
          yandex: {
            voice: "marina",
            role: null
          },
          openai: {
            voice: "marin"
          }
        })
      })
    );
    expect(assistantApiMocks.postAssistantSetupPreview).toHaveBeenCalledWith(
      "token-runtime-preview"
    );

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(assistantApiMocks.uploadAssistantAvatar).toHaveBeenCalledTimes(1);
      expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledTimes(1);
    });
    expect(meApiMocks.postOnboarding).toHaveBeenCalledTimes(1);
    expect(assistantApiMocks.postAssistantCreate).toHaveBeenCalledTimes(1);
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(2);
    expect(assistantApiMocks.uploadAssistantAvatar).toHaveBeenCalledWith(
      "token-avatar",
      expect.any(File)
    );
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenLastCalledWith(
      "token-final-patch",
      expect.objectContaining({
        avatarEmoji: null,
        avatarUrl: "https://example.com/avatar.png"
      })
    );
    expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledWith("token-publish");
    expect(appDataMocks.reload).toHaveBeenCalledTimes(1);
    expect(appDataMocks.reloadChats).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace).toHaveBeenCalledWith("/app/chat?thread=welcome&welcome=1");
  }, 10000);

  it("publishes from the persisted preview draft without repeating setup writes", async () => {
    clerkMocks.getToken
      .mockResolvedValueOnce("token-prefill")
      .mockResolvedValueOnce("token-onboarding-preview")
      .mockResolvedValueOnce("token-create-preview")
      .mockResolvedValueOnce("token-patch-preview")
      .mockResolvedValueOnce("token-runtime-preview")
      .mockResolvedValueOnce("token-publish");

    renderWithIntl(<SetupWizardPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: /continue/i })).at(-1)!);

    fireEvent.change(screen.getByPlaceholderText(/name — e\.g\./i), {
      target: { value: "Nova" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Female" }).at(-1)!);
    fireEvent.click(
      screen
        .getAllByRole("button")
        .find(
          (button) => button.textContent?.includes("Nova") && button.textContent?.includes("🌟")
        )!
    );

    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);
    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);

    expect(
      await screen.findByText("Hi Alex, I'm Nova. I'll keep things clear, warm, and proactive.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledTimes(1);
    });

    expect(meApiMocks.postOnboarding).toHaveBeenCalledTimes(1);
    expect(assistantApiMocks.postAssistantCreate).toHaveBeenCalledTimes(1);
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(1);
    expect(assistantApiMocks.uploadAssistantAvatar).not.toHaveBeenCalled();
    expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledWith("token-publish");
    expect(appDataMocks.reload).toHaveBeenCalledTimes(1);
    expect(appDataMocks.reloadChats).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace).toHaveBeenCalledWith("/app/chat?thread=welcome&welcome=1");
  });

  it("recovers an existing draft explicitly without retrying assistant creation", async () => {
    clerkMocks.getToken
      .mockResolvedValueOnce("token-prefill")
      .mockResolvedValueOnce("token-onboarding-preview")
      .mockResolvedValueOnce("token-patch-preview")
      .mockResolvedValueOnce("token-runtime-preview")
      .mockResolvedValueOnce("token-publish");
    assistantApiMocks.getAssistant.mockResolvedValue(makeRecoverableAssistantState());

    renderWithIntl(<SetupWizardPage />);

    expect(await screen.findByText("Recover existing draft")).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole("button", { name: /continue/i })).at(-1)!);

    expect(await screen.findByDisplayValue("Recovered Nova")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);
    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);

    expect(
      await screen.findByText("Hi Alex, I'm Nova. I'll keep things clear, warm, and proactive.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^recover$/i }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledTimes(1);
    });

    expect(assistantApiMocks.postAssistantCreate).not.toHaveBeenCalled();
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(1);
    expect(appDataMocks.reloadChats).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace).toHaveBeenCalledWith("/app/chat?thread=welcome&welcome=1");
  });

  it("uses an explicit recreate path after reset without relying on a 409 fallback", async () => {
    clerkMocks.getToken
      .mockResolvedValueOnce("token-prefill")
      .mockResolvedValueOnce("token-onboarding-preview")
      .mockResolvedValueOnce("token-patch-preview")
      .mockResolvedValueOnce("token-runtime-preview")
      .mockResolvedValueOnce("token-publish");
    assistantApiMocks.getAssistant.mockResolvedValue(makeResetAssistantState());

    renderWithIntl(<SetupWizardPage />);

    expect(await screen.findByText("Recreate existing assistant")).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole("button", { name: /continue/i })).at(-1)!);

    fireEvent.change(screen.getByPlaceholderText(/name — e\.g\./i), {
      target: { value: "Nova Rebuilt" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Female" }).at(-1)!);
    fireEvent.click(
      screen
        .getAllByRole("button")
        .find(
          (button) => button.textContent?.includes("Nova") && button.textContent?.includes("🌟")
        )!
    );

    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);
    fireEvent.click(screen.getAllByRole("button", { name: /continue/i }).at(-1)!);

    expect(
      await screen.findByText("Hi Alex, I'm Nova. I'll keep things clear, warm, and proactive.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(assistantApiMocks.postAssistantPublish).toHaveBeenCalledTimes(1);
    });

    expect(assistantApiMocks.postAssistantCreate).not.toHaveBeenCalled();
    expect(assistantApiMocks.patchAssistantDraft).toHaveBeenCalledTimes(1);
    expect(appDataMocks.reloadChats).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace).toHaveBeenCalledWith("/app/chat?thread=welcome&welcome=1");
  });
});

function cleanupLocation() {
  try {
    window.history.replaceState({}, "", "/");
  } catch {
    // ignore jsdom navigation cleanup
  }
}
