import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminRolloutsPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  getAdminPlatformRollouts: vi.fn(),
  getAdminPlatformRolloutFailedItems: vi.fn(),
  postAdminPlatformRolloutCancelPending: vi.fn(),
  postAdminPlatformRolloutRetryFailed: vi.fn(),
  postAdminForceReapplyAll: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("@/app/app/assistant-api-client", () => ({
  getAdminPlatformRolloutFailedItems: apiMocks.getAdminPlatformRolloutFailedItems,
  getAdminPlatformRollouts: apiMocks.getAdminPlatformRollouts,
  postAdminPlatformRolloutCancelPending: apiMocks.postAdminPlatformRolloutCancelPending,
  postAdminPlatformRolloutRetryFailed: apiMocks.postAdminPlatformRolloutRetryFailed,
  postAdminForceReapplyAll: apiMocks.postAdminForceReapplyAll
}));

describe("AdminRolloutsPage", () => {
  beforeEach(() => {
    clerkMocks.getToken.mockResolvedValue("token-1");
    apiMocks.getAdminPlatformRollouts.mockResolvedValue([]);
    apiMocks.getAdminPlatformRolloutFailedItems.mockResolvedValue({
      rollout: {
        id: "rollout-1",
        rolloutType: "manual_reapply",
        targetGeneration: 791,
        totalItems: 2,
        pendingCount: 1,
        runningCount: 0,
        succeededCount: 0,
        degradedCount: 0,
        failedCount: 1,
        skippedCount: 0,
        cancelledCount: 0,
        status: "failed",
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-05-14T07:00:00.000Z",
        updatedAt: "2026-05-14T07:00:00.000Z"
      },
      items: [
        {
          id: "item-1",
          rolloutId: "rollout-1",
          assistantId: "assistant-1",
          workspaceId: "ws-1",
          userId: "user-1",
          targetGeneration: 791,
          priority: 100,
          status: "failed",
          attempts: 2,
          nextRetryAt: null,
          lastErrorCode: "apply_exception",
          lastErrorMessage: "Apply failed.",
          startedAt: null,
          finishedAt: null,
          claimedAt: null,
          materializedSpecId: null,
          materializedContentHash: null,
          runtimeBundleHash: null,
          createdAt: "2026-05-14T07:00:00.000Z",
          updatedAt: "2026-05-14T07:00:00.000Z"
        }
      ]
    });
    apiMocks.postAdminPlatformRolloutRetryFailed.mockResolvedValue({
      rollout: {},
      retriedCount: 1
    });
    apiMocks.postAdminPlatformRolloutCancelPending.mockResolvedValue({
      rollout: {},
      cancelledCount: 1
    });
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

  it("shows failed items and triggers retry/cancel controls", async () => {
    apiMocks.getAdminPlatformRollouts.mockResolvedValue([
      {
        id: "rollout-1",
        rolloutType: "manual_reapply",
        targetGeneration: 791,
        totalItems: 2,
        pendingCount: 1,
        runningCount: 0,
        succeededCount: 0,
        degradedCount: 0,
        failedCount: 1,
        skippedCount: 0,
        cancelledCount: 0,
        status: "failed",
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-05-14T07:00:00.000Z",
        updatedAt: "2026-05-14T07:00:00.000Z"
      }
    ]);

    render(<AdminRolloutsPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show failed items" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Show failed items" }));

    await waitFor(() =>
      expect(apiMocks.getAdminPlatformRolloutFailedItems).toHaveBeenCalledWith(
        "token-1",
        "rollout-1"
      )
    );
    expect(screen.getByText(/Apply failed\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() =>
      expect(apiMocks.postAdminPlatformRolloutRetryFailed).toHaveBeenCalledWith(
        "token-1",
        "rollout-1"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel pending" }));
    await waitFor(() =>
      expect(apiMocks.postAdminPlatformRolloutCancelPending).toHaveBeenCalledWith(
        "token-1",
        "rollout-1"
      )
    );
  });

  it("shows cancelled rollout counts in the progress summary", async () => {
    apiMocks.getAdminPlatformRollouts.mockResolvedValue([
      {
        id: "rollout-2",
        rolloutType: "manual_reapply",
        targetGeneration: 792,
        totalItems: 4,
        pendingCount: 0,
        runningCount: 0,
        succeededCount: 1,
        degradedCount: 0,
        failedCount: 0,
        skippedCount: 1,
        cancelledCount: 2,
        status: "cancelled",
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-05-14T07:00:00.000Z",
        updatedAt: "2026-05-14T07:00:00.000Z"
      }
    ]);

    render(<AdminRolloutsPage />);

    await waitFor(() => expect(screen.getByText(/2 cancelled/i)).toBeInTheDocument());
  });
});
