import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import SignInPage from "./page";

const routerState = vi.hoisted(() => ({
  searchParams: new URLSearchParams()
}));

const clerkMocks = vi.hoisted(() => {
  const signInResource = {
    status: "needs_identifier",
    supportedSecondFactors: [],
    sso: vi.fn(async () => ({ error: null })),
    password: vi.fn(async () => ({ error: null })),
    finalize: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ error: null })),
    mfa: {
      sendEmailCode: vi.fn(async () => undefined),
      verifyEmailCode: vi.fn(async () => undefined)
    },
    resetPasswordEmailCode: {
      sendCode: vi.fn(async () => ({ error: null })),
      verifyCode: vi.fn(async () => {
        signInResource.status = "needs_new_password";
        return { error: null };
      }),
      submitPassword: vi.fn(async () => {
        signInResource.status = "complete";
        return { error: null };
      })
    }
  };

  return {
    signInResource
  };
});

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    isSignedIn: false,
    isLoaded: true
  }),
  useSignIn: () => ({
    signIn: clerkMocks.signInResource,
    errors: undefined,
    fetchStatus: "idle"
  })
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => routerState.searchParams
}));

vi.mock("@/app/lib/clerk-navigation", () => ({
  getSafeRedirectPathFromSearch: () => "/app",
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

describe("SignInPage", () => {
  beforeEach(() => {
    routerState.searchParams = new URLSearchParams();
    clerkMocks.signInResource.status = "needs_identifier";
    clerkMocks.signInResource.sso.mockClear();
    clerkMocks.signInResource.password.mockClear();
    clerkMocks.signInResource.finalize.mockClear();
    clerkMocks.signInResource.reset.mockClear();
    clerkMocks.signInResource.create.mockClear();
    clerkMocks.signInResource.mfa.sendEmailCode.mockClear();
    clerkMocks.signInResource.mfa.verifyEmailCode.mockClear();
    clerkMocks.signInResource.resetPasswordEmailCode.sendCode.mockClear();
    clerkMocks.signInResource.resetPasswordEmailCode.verifyCode.mockClear();
    clerkMocks.signInResource.resetPasswordEmailCode.submitPassword.mockClear();
  });

  it("runs the forgot-password flow from the custom sign-in screen", async () => {
    routerState.searchParams = new URLSearchParams("mode=forgot-password");

    renderWithIntl(<SignInPage />);

    expect(await screen.findByText("Reset your password")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "user@example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => {
      expect(clerkMocks.signInResource.create).toHaveBeenCalledWith({
        identifier: "user@example.com"
      });
      expect(clerkMocks.signInResource.resetPasswordEmailCode.sendCode).toHaveBeenCalled();
    });

    expect(await screen.findByText("Check your email")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter verification code"), {
      target: { value: "123456" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() => {
      expect(clerkMocks.signInResource.resetPasswordEmailCode.verifyCode).toHaveBeenCalledWith({
        code: "123456"
      });
    });

    expect(await screen.findByText("Set a new password")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Create a password"), {
      target: { value: "StrongPass123!" }
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm your password"), {
      target: { value: "StrongPass123!" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));

    await waitFor(() => {
      expect(clerkMocks.signInResource.resetPasswordEmailCode.submitPassword).toHaveBeenCalledWith({
        password: "StrongPass123!"
      });
      expect(clerkMocks.signInResource.finalize).toHaveBeenCalled();
    });
  });
});
