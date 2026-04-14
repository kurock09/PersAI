import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminPlanState } from "@persai/contracts";
import { ToolActivationsEdit, draftToPayload, planToDraft } from "./page";

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
    primaryModelKey: "gpt-5.4",
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

    expect(draftToPayload(draft).videoGenerateModelKey).toBe("sora-2-pro");
    expect(
      draftToPayload({
        ...draft,
        videoGenerateModelKey: ""
      }).videoGenerateModelKey
    ).toBeNull();
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
