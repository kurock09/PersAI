"use client";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "./page";

const clerkMocks = vi.hoisted(() => ({
  useUser: vi.fn(),
  useClerk: vi.fn(),
  push: vi.fn(),
  signOut: vi.fn(),
  navigateAfterClerkAuth: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => clerkMocks.useUser(),
  useClerk: () => clerkMocks.useClerk()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: clerkMocks.push
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("@/app/lib/clerk-navigation", () => ({
  navigateAfterClerkAuth: clerkMocks.navigateAfterClerkAuth
}));

describe("ProfilePage", () => {
  beforeEach(() => {
    clerkMocks.push.mockClear();
    clerkMocks.signOut.mockReset();
    clerkMocks.signOut.mockResolvedValue(undefined);
    clerkMocks.navigateAfterClerkAuth.mockClear();
    clerkMocks.useUser.mockReset();
    clerkMocks.useClerk.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not crash when user hydrates after an initial empty render", () => {
    const user = {
      firstName: "Alex",
      lastName: "PersAI",
      fullName: "Alex PersAI",
      username: "alex",
      hasImage: false,
      imageUrl: "",
      primaryEmailAddress: { emailAddress: "alex@example.com" },
      primaryEmailAddressId: "email-1",
      emailAddresses: [{ id: "email-1", emailAddress: "alex@example.com" }],
      externalAccounts: [],
      update: vi.fn(),
      setProfileImage: vi.fn(),
      reload: vi.fn(),
      updatePassword: vi.fn()
    };

    clerkMocks.useClerk.mockReturnValue({ signOut: clerkMocks.signOut });
    clerkMocks.useUser.mockReturnValueOnce({ user: null }).mockReturnValue({ user });

    const { container, rerender } = render(<ProfilePage />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ProfilePage />);

    expect(screen.getByText("account")).toBeInTheDocument();
    expect(screen.getByText("Alex PersAI")).toBeInTheDocument();
    expect(screen.getAllByText("alex@example.com")).toHaveLength(2);
  });

  it("prevents repeated logout clicks while signOut is pending", async () => {
    let resolveSignOut: (() => void) | undefined;
    const user = {
      firstName: "Alex",
      lastName: "PersAI",
      fullName: "Alex PersAI",
      username: "alex",
      hasImage: false,
      imageUrl: "",
      primaryEmailAddress: { emailAddress: "alex@example.com" },
      primaryEmailAddressId: "email-1",
      emailAddresses: [{ id: "email-1", emailAddress: "alex@example.com" }],
      externalAccounts: [],
      update: vi.fn(),
      setProfileImage: vi.fn(),
      reload: vi.fn(),
      updatePassword: vi.fn()
    };

    clerkMocks.useClerk.mockReturnValue({
      signOut: clerkMocks.signOut.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        })
      )
    });
    clerkMocks.useUser.mockReturnValue({ user });

    render(<ProfilePage />);

    const logoutButton = screen.getAllByRole("button", { name: "signOut" }).at(-1)!;
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "signingOut" })).toBeDisabled();
      expect(clerkMocks.signOut).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "signingOut" }));
    expect(clerkMocks.signOut).toHaveBeenCalledTimes(1);

    if (resolveSignOut) {
      resolveSignOut();
    }

    await waitFor(() => {
      expect(clerkMocks.navigateAfterClerkAuth).toHaveBeenCalledWith("/", "replace");
    });
  });
});
