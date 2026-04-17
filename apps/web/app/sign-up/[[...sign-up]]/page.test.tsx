import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import SignUpPage from "./page";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    isSignedIn: false,
    isLoaded: true
  }),
  useSignUp: () => ({
    signUp: {
      status: "missing_requirements",
      sso: vi.fn(async () => ({ error: null })),
      password: vi.fn(async () => ({ error: null })),
      verifications: {
        sendEmailCode: vi.fn(async () => undefined),
        verifyEmailCode: vi.fn(async () => undefined)
      },
      finalize: vi.fn(async () => undefined)
    },
    errors: undefined,
    fetchStatus: "idle"
  })
}));

vi.mock("@/app/lib/clerk-navigation", () => ({
  navigateAfterClerkAuth: vi.fn()
}));

vi.mock("@/app/app/_components/redirect-signed-in-to-app", () => ({
  RedirectSignedInUserToApp: () => <div>redirecting</div>
}));

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("SignUpPage", () => {
  it("links to the custom forgot-password flow", () => {
    renderWithIntl(<SignUpPage />);

    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/sign-in?mode=forgot-password"
    );
  });
});
