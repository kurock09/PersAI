import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppFlowClient } from "./app-flow.client";
import { CurrentMeResponse } from "./me-api-client";

const clerkMocks = vi.hoisted(() => {
  return {
    getToken: vi.fn()
  };
});

const apiMocks = vi.hoisted(() => {
  return {
    getMe: vi.fn(),
    postOnboarding: vi.fn()
  };
});

vi.mock("@clerk/nextjs", () => {
  return {
    useAuth: () => ({
      getToken: clerkMocks.getToken
    }),
    UserButton: () => <div data-testid="user-button" />,
    SignOutButton: ({ children }: { children: ReactNode }) => <>{children}</>
  };
});

vi.mock("./me-api-client", async () => {
  const actual = await vi.importActual<typeof import("./me-api-client")>("./me-api-client");

  return {
    ...actual,
    getMe: apiMocks.getMe,
    postOnboarding: apiMocks.postOnboarding
  };
});

function makeMeResponse(status: "pending" | "completed"): CurrentMeResponse {
  return {
    requestId: "req-1",
    me: {
      appUser: {
        id: "user-1",
        clerkUserId: "clerk-user-1",
        email: "user1@example.com",
        displayName: "User One"
      },
      onboarding: {
        isComplete: status === "completed",
        status
      },
      workspace:
        status === "completed"
          ? {
              id: "ws-1",
              name: "Workspace A",
              locale: "en-US",
              timezone: "UTC",
              status: "active",
              role: "owner"
            }
          : null
    }
  };
}

describe("AppFlowClient onboarding gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.getToken.mockResolvedValue("token-user-1");
  });

  it("shows onboarding gate when /me returns pending", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("pending"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Onboarding required")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.queryByText("Me")).not.toBeInTheDocument();
  });

  it("shows me screen when /me returns completed", async () => {
    apiMocks.getMe.mockResolvedValue(makeMeResponse("completed"));

    render(<AppFlowClient />);

    expect(await screen.findByText("Me")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Workspace A/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
  });
});
