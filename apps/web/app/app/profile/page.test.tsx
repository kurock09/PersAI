"use client";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProfilePage from "./page";

const clerkMocks = vi.hoisted(() => ({
  useUser: vi.fn(),
  useClerk: vi.fn(),
  push: vi.fn(),
  signOut: vi.fn()
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

describe("ProfilePage", () => {
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
});
