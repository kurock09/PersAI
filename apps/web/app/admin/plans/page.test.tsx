import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminPlanState } from "@persai/contracts";
import { ToolActivationsEdit, draftToPayload, planToDraft, validatePlanDraft } from "./page";

function createPlanState(): AdminPlanState {
  return {
    code: "pro",
    displayName: "Pro",
    description: "Premium plan",
    status: "active",
    defaultOnRegistration: false,
    trialEnabled: false,
    trialDurationDays: null,
    metadata: {
      commercialTag: null,
      notes: null
    },
    entitlements: {
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
      }
    },
    quotaLimits: {
      tokenBudgetLimit: 1000,
      imageGenerateMonthlyUnitsLimit: 20,
      imageEditMonthlyUnitsLimit: 10,
      videoGenerateMonthlyUnitsLimit: 4,
      mediaStorageBytesLimit: null,
      knowledgeStorageBytesLimit: 128 * 1024 * 1024,
      workspaceStorageBytesLimit: null
    },
    skillPolicy: {
      maxEnabledSkills: 2
    },
    retrievalPolicy: {
      defaultMaxResults: 5,
      maxMaxResults: 8,
      lexicalCandidateLimit: 60,
      vectorCandidateLimit: 240,
      knowledgeFetchWindowRadius: 1,
      chatFetchWindowRadius: 2,
      fetchMaxChars: 6000,
      helperEnabled: true,
      helperCandidateLimit: 6,
      helperMaxOutputTokens: 220,
      embeddingSearchEnabled: true
    },
    sandboxPolicy: {
      enabled: true,
      maxSingleFileWriteBytes: 10 * 1024 * 1024,
      maxWorkspaceBytesPerJob: 25 * 1024 * 1024,
      maxPersistedArtifactsPerJob: 64,
      maxFileCountPerJob: 256,
      maxDirectoryCountPerJob: 128,
      maxProcessRuntimeMs: 15_000,
      maxCpuMsPerJob: 15_000,
      maxMemoryBytesPerJob: 256 * 1024 * 1024,
      maxConcurrentProcesses: 4,
      maxStdoutBytes: 128 * 1024,
      maxStderrBytes: 128 * 1024,
      networkAccessEnabled: false,
      artifactMimeAllowlist: ["text/plain", "application/json"],
      webMaxOutboundBytes: 25 * 1024 * 1024,
      telegramMaxOutboundBytes: 50 * 1024 * 1024,
      sandboxJobsPerDay: 10,
      maxArtifactSendCountPerTurn: 4
    },
    primaryModelKey: "gpt-5.4",
    premiumModelKey: "gpt-5.4",
    reasoningModelKey: "gpt-5.4-mini",
    retrievalModelKey: "gpt-5.4-nano",
    embeddingModelKey: "text-embedding-3-small",
    imageGenerateModelKey: "gpt-image-2",
    imageGenerateFallbackModelKey: "gpt-image-1.5",
    imageEditModelKey: "gpt-image-2",
    imageEditFallbackModelKey: "gpt-image-1.5",
    videoGenerateModelKey: "sora-2-pro",
    videoGenerateFallbackModelKey: "sora-2",
    runtimeTierDefault: "paid_shared_restricted",
    contextPolicy: {
      preset: "balanced",
      targetContextBudget: 24_000,
      compactionTriggerThreshold: 8_000,
      keepRecentMinimum: 4,
      knowledgeHydrationBudget: 2_400,
      autoCompactionWeb: false,
      autoCompactionTelegram: true,
      crossSessionCarryOverTtlDays: 7,
      crossSessionCarryOverIdleHours: 4,
      crossSessionCarryOverCooldownHours: 12
    },
    toolActivations: [
      {
        toolCode: "video_generate",
        displayName: "Video Generate",
        toolClass: "cost_driving",
        policyClass: "plan_managed",
        active: true,
        dailyCallLimit: 2,
        perTurnCap: null,
        visibleInPlanEditor: true
      }
    ],
    toolBudgets: {
      loopLimitByMode: {
        normal: null,
        premium: null,
        reasoning: null
      }
    },
    createdAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z"
  };
}

describe("admin plans page helpers", () => {
  it("maps media fallback model keys between plan state and payload", () => {
    const draft = planToDraft(createPlanState());
    expect(draft.imageGenerateModelKey).toBe("gpt-image-2");
    expect(draft.imageGenerateFallbackModelKey).toBe("gpt-image-1.5");
    expect(draft.imageEditModelKey).toBe("gpt-image-2");
    expect(draft.imageEditFallbackModelKey).toBe("gpt-image-1.5");
    expect(draft.videoGenerateModelKey).toBe("sora-2-pro");
    expect(draft.videoGenerateFallbackModelKey).toBe("sora-2");
    expect(draft.knowledgeStorageMb).toBe("128");
    expect(draft.sharedCompactionSummaryBudgetTokens).toBe("");
    expect(draft.premiumModelKey).toBe("gpt-5.4");
    expect(draft.reasoningModelKey).toBe("gpt-5.4-mini");
    expect(draft.retrievalModelKey).toBe("gpt-5.4-nano");
    expect(draft.imageGenerateMonthlyUnitsLimit).toBe("20");
    expect(draft.imageEditMonthlyUnitsLimit).toBe("10");
    expect(draft.videoGenerateMonthlyUnitsLimit).toBe("4");

    expect(draftToPayload(draft).imageGenerateModelKey).toBe("gpt-image-2");
    expect(draftToPayload(draft).imageGenerateFallbackModelKey).toBe("gpt-image-1.5");
    expect(draftToPayload(draft).imageEditModelKey).toBe("gpt-image-2");
    expect(draftToPayload(draft).imageEditFallbackModelKey).toBe("gpt-image-1.5");
    expect(draftToPayload(draft).videoGenerateModelKey).toBe("sora-2-pro");
    expect(draftToPayload(draft).videoGenerateFallbackModelKey).toBe("sora-2");
    expect(draftToPayload(draft).quotaLimits?.imageGenerateMonthlyUnitsLimit).toBe(20);
    expect(draftToPayload(draft).quotaLimits?.imageEditMonthlyUnitsLimit).toBe(10);
    expect(draftToPayload(draft).quotaLimits?.videoGenerateMonthlyUnitsLimit).toBe(4);
    expect(draftToPayload(draft).quotaLimits?.knowledgeStorageBytesLimit).toBe(128 * 1024 * 1024);
    expect(draftToPayload(draft).toolActivations?.at(0)?.dailyCallLimit).toBeNull();
    expect(draftToPayload({ ...draft, maxEnabledSkills: "0" }).skillPolicy?.maxEnabledSkills).toBe(
      0
    );
    expect(draftToPayload(draft).premiumModelKey).toBe("gpt-5.4");
    expect(draftToPayload(draft).reasoningModelKey).toBe("gpt-5.4-mini");
    expect(draftToPayload(draft).retrievalModelKey).toBe("gpt-5.4-nano");
    expect(draftToPayload(draft).contextPolicy.sharedCompactionSummaryBudgetTokens).toBeUndefined();
    expect("runtimeTierDefault" in draftToPayload(draft)).toBe(false);
    expect(
      draftToPayload({
        ...draft,
        contextPolicyPreset: "custom",
        sharedCompactionSummaryBudgetTokens: "1200"
      }).contextPolicy.sharedCompactionSummaryBudgetTokens
    ).toBe(1200);
    expect(
      draftToPayload({
        ...draft,
        imageGenerateFallbackModelKey: "",
        videoGenerateModelKey: "",
        videoGenerateFallbackModelKey: ""
      }).videoGenerateFallbackModelKey
    ).toBeNull();
  });

  it("flags invalid numeric draft values instead of silently defaulting", () => {
    const draft = planToDraft(createPlanState());
    const invalid = {
      ...draft,
      retrievalDefaultMaxResults: "",
      sandboxMaxFilesPerJob: "abc"
    };

    expect(validatePlanDraft(invalid)).toMatchObject({
      retrievalDefaultMaxResults: expect.stringContaining("required"),
      sandboxMaxFilesPerJob: expect.stringContaining("whole number")
    });
    expect(() => draftToPayload(invalid)).toThrow(/Default results is required/);
  });

  it("renders primary and fallback media model selects for image and video rows", () => {
    const onImageGenerateModelKeyChange = vi.fn();
    const onImageGenerateFallbackModelKeyChange = vi.fn();
    const onImageEditModelKeyChange = vi.fn();
    const onVideoGenerateModelKeyChange = vi.fn();
    const onVideoGenerateFallbackModelKeyChange = vi.fn();

    render(
      <ToolActivationsEdit
        activations={[
          {
            toolCode: "video_generate",
            displayName: "Video Generate",
            toolClass: "cost_driving",
            policyClass: "plan_managed",
            active: true,
            dailyCallLimit: 2,
            perTurnCap: null
          },
          {
            toolCode: "image_generate",
            displayName: "Image Generate",
            toolClass: "cost_driving",
            policyClass: "plan_managed",
            active: true,
            dailyCallLimit: 5,
            perTurnCap: null
          },
          {
            toolCode: "image_edit",
            displayName: "Image Edit",
            toolClass: "cost_driving",
            policyClass: "plan_managed",
            active: true,
            dailyCallLimit: 5,
            perTurnCap: null
          }
        ]}
        onUpdate={() => {}}
        imageGenerateModelKey="gpt-image-2"
        onImageGenerateModelKeyChange={onImageGenerateModelKeyChange}
        imageGenerateFallbackModelKey="gpt-image-1.5"
        onImageGenerateFallbackModelKeyChange={onImageGenerateFallbackModelKeyChange}
        imageEditModelKey="gpt-image-1"
        onImageEditModelKeyChange={onImageEditModelKeyChange}
        imageEditFallbackModelKey=""
        onImageEditFallbackModelKeyChange={vi.fn()}
        videoGenerateModelKey="sora-2-pro"
        onVideoGenerateModelKeyChange={onVideoGenerateModelKeyChange}
        videoGenerateFallbackModelKey="sora-2"
        onVideoGenerateFallbackModelKeyChange={onVideoGenerateFallbackModelKeyChange}
        availableImageModelKeys={[
          { provider: "openai", model: "gpt-image-1" },
          { provider: "openai", model: "gpt-image-1.5" },
          { provider: "openai", model: "gpt-image-2" }
        ]}
        availableVideoModelKeys={[
          { provider: "openai", model: "sora-2" },
          { provider: "openai", model: "sora-2-pro" }
        ]}
      />
    );

    expect(screen.getAllByText("Primary model")).toHaveLength(3);
    expect(screen.getAllByText("Fallback model")).toHaveLength(3);
    const imageSelect = screen.getByDisplayValue("gpt-image-2");
    fireEvent.change(imageSelect, { target: { value: "" } });
    expect(onImageGenerateModelKeyChange).toHaveBeenCalledWith("");
    const imageFallbackSelect = screen.getByDisplayValue("gpt-image-1.5");
    fireEvent.change(imageFallbackSelect, { target: { value: "" } });
    expect(onImageGenerateFallbackModelKeyChange).toHaveBeenCalledWith("");
    const imageEditPrimarySelect = screen.getByDisplayValue("gpt-image-1");
    fireEvent.change(imageEditPrimarySelect, { target: { value: "gpt-image-1.5" } });
    expect(onImageEditModelKeyChange).toHaveBeenCalledWith("gpt-image-1.5");
    const select = screen.getByDisplayValue("sora-2-pro");
    fireEvent.change(select, { target: { value: "sora-2" } });
    expect(onVideoGenerateModelKeyChange).toHaveBeenCalledWith("sora-2");
    const fallbackSelects = screen.getAllByDisplayValue("sora-2");
    fireEvent.change(fallbackSelects.at(-1)!, { target: { value: "" } });
    expect(onVideoGenerateFallbackModelKeyChange).toHaveBeenCalledWith("");
  });
});
