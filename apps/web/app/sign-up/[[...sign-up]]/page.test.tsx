import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import SignUpPage from "./page";

const routerState = vi.hoisted(() => ({
  searchParams: new URLSearchParams()
}));

const clerkState = vi.hoisted(() => ({
  signUpLoaded: true
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    isSignedIn: false,
    isLoaded: true
  }),
  useSignUp: () => ({
    isLoaded: clerkState.signUpLoaded,
    signUp: clerkState.signUpLoaded
      ? {
          status: "missing_requirements",
          sso: vi.fn(async () => ({ error: null })),
          password: vi.fn(async () => ({ error: null })),
          verifications: {
            sendEmailCode: vi.fn(async () => undefined),
            verifyEmailCode: vi.fn(async () => undefined)
          },
          finalize: vi.fn(async () => undefined)
        }
      : undefined,
    errors: undefined,
    fetchStatus: "idle"
  })
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => routerState.searchParams
}));

vi.mock("@/app/lib/clerk-navigation", () => ({
  getSafeRedirectPathFromSearch: () => "/app/pricing",
  navigateAfterClerkAuth: vi.fn(),
  withSafeRedirectParam: (path: string, search: string) =>
    search.length > 0 ? `${path}${path.includes("?") ? "&" : "?"}${search}` : path
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
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    routerState.searchParams = new URLSearchParams();
    clerkState.signUpLoaded = true;
  });

  it("waits for the Clerk sign-up resource before rendering the custom form", () => {
    clerkState.signUpLoaded = false;

    renderWithIntl(<SignUpPage />);

    expect(screen.queryByPlaceholderText("you@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign up" })).not.toBeInTheDocument();
  });

  it("links to the custom forgot-password flow", () => {
    renderWithIntl(<SignUpPage />);

    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/sign-in?mode=forgot-password"
    );
  });

  it("preserves redirect_url for sign-in and forgot-password links", () => {
    routerState.searchParams = new URLSearchParams("redirect_url=%2Fapp%2Fpricing");

    renderWithIntl(<SignUpPage />);

    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/sign-in?mode=forgot-password&redirect_url=%2Fapp%2Fpricing"
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?redirect_url=%2Fapp%2Fpricing"
    );
  });
});
