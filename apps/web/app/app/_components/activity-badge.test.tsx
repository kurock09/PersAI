import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityBadge } from "./activity-badge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

describe("ActivityBadge", () => {
  const event = {
    id: "activity-1",
    type: "runtime_done" as const,
    label: "Response generated",
    detail: "20:05",
    shadowRoutingLabel: "premium (llm)"
  };

  it("hides shadow routing details by default", () => {
    render(<ActivityBadge event={event} />);

    expect(screen.getByText("activityResponseDone")).toBeInTheDocument();
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

    expect(screen.getByText("activityFilesDone")).toBeInTheDocument();
    expect(screen.queryByText("files_finished")).toBeNull();
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

  it("renders project summaries as human text instead of canned codes", () => {
    render(
      <ActivityBadge
        event={{
          id: "activity-project-1",
          type: "info",
          label: "Gathering project context",
          detail: "Checking whether the local material answers the task.",
          emphasis: "strong"
        }}
      />
    );

    expect(screen.getByText("Gathering project context")).toBeInTheDocument();
    expect(
      screen.getByText("Checking whether the local material answers the task.")
    ).toBeInTheDocument();

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

    expect(screen.getByText("Gathering more evidence")).toBeInTheDocument();
    expect(
      screen.getByText("Follow-up pass 2 is gathering the next missing piece of evidence.")
    ).toBeInTheDocument();
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
