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
      mediaStorageBytesLimit: null,
      workspaceStorageBytesLimit: null
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
      maxPersistedArtifactsPerJob: 8,
      maxFileCountPerJob: 32,
      maxDirectoryCountPerJob: 16,
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
    videoGenerateModelKey: "sora-2-pro",
    runtimeTierDefault: "paid_shared_restricted",
    contextPolicy: {
      preset: "balanced",
      targetContextBudget: 24_000,
      compactionTriggerThreshold: 8_000,
      keepRecentMinimum: 4,
      knowledgeHydrationBudget: 2_400,
      autoCompactionWeb: false,
      autoCompactionTelegram: true
    },
    toolActivations: [
      {
        toolCode: "video_generate",
        displayName: "Video Generate",
        toolClass: "cost_driving",
        policyClass: "plan_managed",
        active: true,
        dailyCallLimit: 2,
        visibleInPlanEditor: true
      }
    ],
    createdAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z"
  };
}

describe("admin plans page helpers", () => {
  it("maps videoGenerateModelKey between plan state and payload", () => {
    const draft = planToDraft(createPlanState());
    expect(draft.videoGenerateModelKey).toBe("sora-2-pro");
    expect(draft.sharedCompactionSummaryBudgetTokens).toBe("");
    expect(draft.premiumModelKey).toBe("gpt-5.4");
    expect(draft.reasoningModelKey).toBe("gpt-5.4-mini");
    expect(draft.retrievalModelKey).toBe("gpt-5.4-nano");

    expect(draftToPayload(draft).videoGenerateModelKey).toBe("sora-2-pro");
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
        videoGenerateModelKey: ""
      }).videoGenerateModelKey
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

  it("renders a video model select only for the video row", () => {
    const onVideoGenerateModelKeyChange = vi.fn();

    render(
      <ToolActivationsEdit
        activations={[
          {
            toolCode: "video_generate",
            displayName: "Video Generate",
            toolClass: "cost_driving",
            policyClass: "plan_managed",
            active: true,
            dailyCallLimit: 2
          },
          {
            toolCode: "image_generate",
            displayName: "Image Generate",
            toolClass: "cost_driving",
            policyClass: "plan_managed",
            active: true,
            dailyCallLimit: 5
          }
        ]}
        onUpdate={() => {}}
        videoGenerateModelKey="sora-2-pro"
        onVideoGenerateModelKeyChange={onVideoGenerateModelKeyChange}
      />
    );

    expect(screen.getAllByText("Model")).toHaveLength(1);
    const select = screen.getByDisplayValue("sora-2-pro");
    fireEvent.change(select, { target: { value: "sora-2" } });
    expect(onVideoGenerateModelKeyChange).toHaveBeenCalledWith("sora-2");
  });
});
