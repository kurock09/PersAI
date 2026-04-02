import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProtectedAppPage from "./page";

const clerkServerMocks = vi.hoisted(() => {
  return {
    auth: vi.fn().mockResolvedValue({ userId: "user_1" })
  };
});

vi.mock("@clerk/nextjs/server", () => {
  return {
    auth: clerkServerMocks.auth
  };
});

vi.mock("./_components/app-home-page", () => {
  return {
    AppHomePage: () => <div data-testid="app-home-page">home</div>
  };
});

describe("Protected /app page", () => {
  it("renders home when signed in", async () => {
    const view = await ProtectedAppPage();
    render(view);

    expect(clerkServerMocks.auth).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("app-home-page")).toBeInTheDocument();
  });
});
