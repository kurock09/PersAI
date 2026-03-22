import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProtectedAppPage from "./page";

const clerkServerMocks = vi.hoisted(() => {
  return {
    protect: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock("@clerk/nextjs/server", () => {
  return {
    auth: {
      protect: clerkServerMocks.protect
    }
  };
});

vi.mock("./app-flow.client", () => {
  return {
    AppFlowClient: () => <div data-testid="app-flow-client">app-flow</div>
  };
});

describe("Protected /app page", () => {
  it("calls auth.protect and renders app flow client", async () => {
    const view = await ProtectedAppPage();
    render(view);

    expect(clerkServerMocks.protect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("app-flow-client")).toBeInTheDocument();
  });
});
