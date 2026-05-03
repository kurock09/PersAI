import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../messages/en.json";
import SSOCallbackPage from "./page";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn()
}));

const navigationMocks = vi.hoisted(() => ({
  navigateAfterClerkAuth: vi.fn()
}));

const clerkMocks = vi.hoisted(() => ({
  clerk: {
    loaded: true,
    setActive: vi.fn(async () => undefined)
  },
  signIn: {
    status: "complete",
    isTransferable: false,
    existingSession: null,
    finalize: vi.fn(
      async ({
        navigate
      }: {
        navigate: (args: { decorateUrl: (path: string) => string }) => Promise<void>;
      }) => {
        await navigate({ decorateUrl: (path) => path });
      }
    ),
    create: vi.fn(async () => undefined)
  },
  signUp: {
    status: "missing_requirements",
    isTransferable: false,
    existingSession: null,
    finalize: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined)
  }
}));

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => clerkMocks.clerk,
  useSignIn: () => ({ signIn: clerkMocks.signIn }),
  useSignUp: () => ({ signUp: clerkMocks.signUp })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks
}));

vi.mock("@/app/lib/clerk-navigation", () => ({
  getSafeRedirectPathFromSearch: () => "/app/pricing",
  navigateAfterClerkAuth: navigationMocks.navigateAfterClerkAuth,
  withSafeRedirectParam: (path: string) => `${path}?redirect_url=%2Fapp%2Fpricing`
}));

function renderWithIntl(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe("SSOCallbackPage", () => {
  beforeEach(() => {
    routerMocks.push.mockClear();
    navigationMocks.navigateAfterClerkAuth.mockClear();
    clerkMocks.clerk.setActive.mockClear();
    clerkMocks.signIn.finalize.mockClear();
    clerkMocks.signIn.create.mockClear();
    clerkMocks.signUp.finalize.mockClear();
    clerkMocks.signUp.create.mockClear();
    clerkMocks.signIn.status = "complete";
    clerkMocks.signIn.isTransferable = false;
    clerkMocks.signUp.isTransferable = false;
  });

  it("uses the safe redirect target after Clerk finalizes sign-in", async () => {
    renderWithIntl(<SSOCallbackPage />);

    await waitFor(() => {
      expect(clerkMocks.signIn.finalize).toHaveBeenCalled();
      expect(navigationMocks.navigateAfterClerkAuth).toHaveBeenCalledWith("/app/pricing");
    });
  });
});
