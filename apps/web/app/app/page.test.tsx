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

vi.mock("./_components/app-home-page", () => {
  return {
    AppHomePage: () => <div data-testid="app-home-page">home</div>
  };
});

describe("Protected /app page", () => {
  it("calls auth.protect and renders home page", async () => {
    const view = await ProtectedAppPage();
    render(view);

    expect(clerkServerMocks.protect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("app-home-page")).toBeInTheDocument();
  });
});
