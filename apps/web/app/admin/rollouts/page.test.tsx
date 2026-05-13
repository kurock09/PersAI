import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminRolloutsPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  getAdminPlatformRollouts: vi.fn(),
  postAdminForceReapplyAll: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("@/app/app/assistant-api-client", () => ({
  getAdminPlatformRollouts: apiMocks.getAdminPlatformRollouts,
  postAdminForceReapplyAll: apiMocks.postAdminForceReapplyAll
}));

describe("AdminRolloutsPage", () => {
  beforeEach(() => {
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminPlatformRollouts.mockResolvedValue([]);
    apiMocks.postAdminForceReapplyAll.mockResolvedValue({
      rolloutId: "rollout-1",
      targetGeneration: 791,
      totalItems: 1,
      pendingCount: 1,
      runningCount: 0,
      succeeded: 0,
      degraded: 0,
      failed: 0,
      skipped: 0,
      cancelledCount: 0,
      status: "pending"
    });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("queues force reapply from the rollouts page and refreshes the list", async () => {
    render(<AdminRolloutsPage />);

    await waitFor(() => expect(apiMocks.getAdminPlatformRollouts).toHaveBeenCalledWith("token-1"));

    fireEvent.click(screen.getByRole("button", { name: "Force reapply all" }));

    await waitFor(() => expect(apiMocks.postAdminForceReapplyAll).toHaveBeenCalledWith("token-1"));
    await waitFor(() => expect(apiMocks.getAdminPlatformRollouts).toHaveBeenCalledTimes(2));

    expect(screen.getByText(/Queued rollout/i)).toBeInTheDocument();
    expect(screen.getByText(/generation 791/i)).toBeInTheDocument();
    expect(screen.getByText(/1 item, 1 pending/i)).toBeInTheDocument();
  });
});
