import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX } from "./desktop-sidebar-width";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  getAssistantSupportTickets: vi.fn(async () => [
    { id: "ticket-1", hasUnread: true },
    { id: "ticket-2", hasUnread: true }
  ])
}));

const meApiMocks = vi.hoisted(() => ({
  getMe: vi.fn(async () => ({
    me: { appUser: { resolvedLocale: "en" } }
  }))
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
  useRouter: () => routerMocks
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
    isLoaded: true,
    isSignedIn: true
  })
}));

vi.mock("./sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />
}));

vi.mock("./slide-over", () => ({
  SlideOver: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("./use-app-data", () => ({
  useAppData: () => ({
    assistant: { id: "assistant-1" },
    assistantStatus: "live",
    assistantResolved: true,
    isLoading: false,
    chats: [],
    isReloading: false,
    isReloadingChats: false,
    reloadChats: vi.fn(),
    reload: vi.fn()
  })
}));

vi.mock("./use-history-back-to-close", () => ({
  useHistoryBackToClose: () => undefined
}));

vi.mock("./back-button-bridge", () => ({
  BackButtonBridge: () => null
}));

vi.mock("../../_components/app-url-open-bridge", () => ({
  AppUrlOpenBridge: () => null
}));

vi.mock("./offline-gate", () => ({
  OfflineGate: () => null
}));

vi.mock("./streaming-threads", () => ({
  StreamingThreadsProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useStreamingThreadsRegistry: () => ({ activeThreads: new Set<string>() })
}));

vi.mock("../me-api-client", () => ({
  getMe: meApiMocks.getMe
}));

vi.mock("../assistant-api-client", () => ({
  getAssistantSupportTickets: assistantApiMocks.getAssistantSupportTickets
}));

vi.mock("@/app/lib/locale-sync", () => ({
  getLocaleCookie: () => "en",
  isWebLocale: () => true,
  setLocaleCookie: vi.fn()
}));

afterEach(() => {
  assistantApiMocks.getAssistantSupportTickets.mockClear();
  meApiMocks.getMe.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.push.mockClear();
});

describe("AppShell", () => {
  it("renders an opaque support unread badge slightly above and right of the mobile menu button", async () => {
    const { unmount } = render(
      <AppShell initialData={null}>
        <div>content</div>
      </AppShell>
    );

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    const badge = screen.getByText("2");
    expect(badge.className).toContain("-top-1");
    expect(badge.className).toContain("-right-1");
    expect(badge.className).toContain("bg-accent");
    expect(badge.className).toContain("text-white");
    expect(badge.className).not.toContain("bg-accent/12");
    expect(screen.getByTestId("app-main-panel")).toHaveClass("md:rounded-[1.375rem]");
    expect(screen.getByTestId("app-desktop-shell")).toHaveClass("md:gap-4", "md:p-4");
    expect(screen.getByTestId("sidebar-resize-handle")).toHaveAttribute("role", "separator");
    expect(screen.getByTestId("app-desktop-sidebar-column")).toHaveStyle({
      width: `${String(DESKTOP_SIDEBAR_WIDTH_DESKTOP_DEFAULT_PX)}px`
    });

    await waitFor(() => {
      expect(meApiMocks.getMe).toHaveBeenCalledTimes(1);
    });

    unmount();
  });
});
