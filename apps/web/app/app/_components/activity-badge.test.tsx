import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityBadge } from "./activity-badge";

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

    expect(screen.getByText("Response generated")).toBeInTheDocument();
    expect(screen.getByText("20:05")).toBeInTheDocument();
    expect(screen.queryByText(/premium \(llm\)/i)).toBeNull();
  });

  it("renders shadow routing details when enabled", () => {
    render(<ActivityBadge event={event} showShadowRoutingLabel />);

    expect(screen.getByText(/20:05 · premium \(llm\)/i)).toBeInTheDocument();
  });
});
