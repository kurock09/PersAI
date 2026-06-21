import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityBadge } from "./activity-badge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

describe("ActivityBadge", () => {
  const event = {
    id: "activity-1",
    type: "tool_use" as const,
    label: "files_finished",
    detail: "20:05",
    shadowRoutingLabel: "premium (llm)"
  };

  it("hides shadow routing details by default", () => {
    render(<ActivityBadge event={event} />);

    expect(screen.getAllByText("activityFilesDone").length).toBeGreaterThan(0);
    expect(screen.getByText("20:05")).toBeInTheDocument();
    expect(screen.queryByText(/premium \(llm\)/i)).toBeNull();
  });

  it("renders shadow routing details when enabled", () => {
    render(<ActivityBadge event={event} showShadowRoutingLabel />);

    expect(screen.getByText(/20:05 · premium \(llm\)/i)).toBeInTheDocument();
  });

  it("humanizes raw tool lifecycle labels", () => {
    render(
      <ActivityBadge
        event={{
          id: "activity-2",
          type: "tool_use",
          label: "knowledge_search_finished",
          emphasis: "strong"
        }}
      />
    );

    expect(screen.getByText("activityKnowledgeSearchDone")).toBeInTheDocument();
    expect(screen.queryByText("knowledge_search_finished")).toBeNull();
  });

  it("humanizes files tool lifecycle labels", () => {
    render(
      <ActivityBadge
        event={{
          id: "activity-3",
          type: "tool_use",
          label: "files_finished",
          emphasis: "strong"
        }}
      />
    );

    expect(screen.getAllByText("activityFilesDone").length).toBeGreaterThan(0);
    expect(screen.queryByText("files_finished")).toBeNull();
  });

  it("humanizes ADR-123 workspace tool lifecycle labels", () => {
    render(
      <>
        <ActivityBadge event={{ id: "activity-grep", type: "tool_use", label: "grep_started" }} />
        <ActivityBadge event={{ id: "activity-glob", type: "tool_use", label: "glob_started" }} />
        <ActivityBadge event={{ id: "activity-shell", type: "tool_use", label: "shell_started" }} />
      </>
    );

    expect(screen.getByText("activityGrepStart")).toBeInTheDocument();
    expect(screen.getByText("activityGlobStart")).toBeInTheDocument();
    expect(screen.getByText("activityShellStart")).toBeInTheDocument();
    expect(screen.queryByText("grep_started")).toBeNull();
    expect(screen.queryByText("glob_started")).toBeNull();
    expect(screen.queryByText("shell_started")).toBeNull();
  });

  it("humanizes retrieval activity labels", () => {
    render(
      <ActivityBadge
        event={{
          id: "activity-4",
          type: "info",
          label: "retrieval_skill_started",
          emphasis: "strong"
        }}
      />
    );

    expect(screen.getByText("activityRetrievalSkillStart")).toBeInTheDocument();
    expect(screen.queryByText("retrieval_skill_started")).toBeNull();
  });

  it("localizes project summaries and hides the extra detail copy", () => {
    render(
      <ActivityBadge
        event={{
          id: "activity-project-1",
          type: "info",
          label: "Reviewing local context and planning the next step",
          detail: "Checking whether the local material answers the task.",
          emphasis: "strong"
        }}
      />
    );

    expect(screen.getByText("activityProjectSummaryPlanReview")).toBeInTheDocument();
    expect(screen.queryByText("activityProjectDetailCheckFit")).toBeNull();

    render(
      <ActivityBadge
        event={{
          id: "activity-project-2",
          type: "info",
          label: "Gathering more evidence",
          detail: "Follow-up pass 2 is gathering the next missing piece of evidence."
        }}
      />
    );

    expect(screen.getByText("activityProjectSummaryGatherMore")).toBeInTheDocument();
    expect(screen.queryByText("activityProjectDetailFollowUpPass")).toBeNull();
  });

  it("keeps project badges compact even when structured detail is present", () => {
    render(
      <ActivityBadge
        event={{
          id: "activity-project-3",
          type: "info",
          label: "Checking whether the gathered context actually answers the task.",
          detail: "Loaded 3 grounded excerpt(s) across 2 source class(es)."
        }}
      />
    );

    expect(screen.getByText("activityProjectSummaryCheckFit")).toBeInTheDocument();
    expect(screen.queryByText("activityProjectDetailLoadedGroundedExcerpts")).toBeNull();

    render(
      <ActivityBadge
        event={{
          id: "activity-project-4",
          type: "info",
          label: "Local context is still thin, so the search may need to expand.",
          detail:
            "No direct grounded excerpt yet; keep gathering narrower local or external sources."
        }}
      />
    );

    expect(screen.getByText("activityProjectSummaryThinContext")).toBeInTheDocument();
    expect(screen.queryByText("activityProjectDetailNoGroundedExcerpt")).toBeNull();
  });

  it("shows quiet Skill activity detail when present", () => {
    render(
      <ActivityBadge
        event={{
          id: "activity-5",
          type: "info",
          label: "retrieval_skill_started",
          detail: "Навык - ✈️",
          emphasis: "strong"
        }}
      />
    );

    expect(screen.getAllByText("activityRetrievalSkillStart").length).toBeGreaterThan(0);
    expect(screen.getByText("Навык -")).toBeInTheDocument();
    expect(screen.getByText("✈️")).toBeInTheDocument();
    expect(screen.getByText("✈️")).toHaveStyle({ filter: "saturate(0.68) brightness(1.04)" });
  });
});
