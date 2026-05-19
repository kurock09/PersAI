import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationOriginalDownloadAction } from "./presentation-original-download-action";

const getTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: getTokenMock
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_CREATE_OBJECT_URL = URL.createObjectURL;
const ORIGINAL_REVOKE_OBJECT_URL = URL.revokeObjectURL;

function assertPresent<T>(value: T | null | undefined): asserts value is T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
}

function requirePresent<T>(value: T | null | undefined): T {
  assertPresent(value);
  return value;
}

describe("PresentationOriginalDownloadAction", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:pptx")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    getTokenMock.mockReset();
    global.fetch = ORIGINAL_FETCH;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: ORIGINAL_CREATE_OBJECT_URL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: ORIGINAL_REVOKE_OBJECT_URL
    });
  });

  it("fetches the BFF with a same-origin session token header and triggers a blob download", async () => {
    getTokenMock.mockResolvedValue("fresh-client-token");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const capturedAnchors: HTMLAnchorElement[] = [];
    const appendChild = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) {
        capturedAnchors.push(node);
      }
      return appendChild(node);
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response("pptx-bytes", {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": "attachment; filename*=UTF-8''%D0%A8%D0%BA%D0%BE%D0%BB%D0%B0.pptx"
        }
      })
    ) as typeof fetch;

    render(
      <PresentationOriginalDownloadAction
        href="/api/assistant-document/doc-1/original?versionId=version-1"
        filename="fallback.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
      assertPresent(capturedAnchors[0]);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/assistant-document/doc-1/original?versionId=version-1",
      expect.objectContaining({
        credentials: "same-origin",
        headers: {
          "X-PersAI-Session-Token": "fresh-client-token"
        }
      })
    );
    const requestInit = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.stringify(requestInit?.headers)).not.toContain("Authorization");
    const downloadAnchor = requirePresent(capturedAnchors[0]);
    expect(downloadAnchor.href).toBe("blob:pptx");
    expect(downloadAnchor.download).toBe("Школа.pptx");
    expect(screen.getByRole("button", { name: "presentationDownloadPptxAction" })).toHaveAttribute(
      "aria-busy",
      "false"
    );
  });

  it("shows the unavailable modal for a 410 Gamma export response", async () => {
    getTokenMock.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue(new Response("gone", { status: 410 })) as typeof fetch;

    render(
      <PresentationOriginalDownloadAction
        href="/api/assistant-document/doc-1/original"
        filename="deck.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));

    const dialog = await screen.findByRole("dialog", {
      name: "presentationDownloadPptxUnavailableTitle"
    });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("presentationDownloadPptxUnavailableBody")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "presentationDownloadPptxClose" })).toHaveFocus();
    });
  });

  it.each([401, 500])("shows the failed modal for status %s", async (status) => {
    getTokenMock.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue(new Response("failed", { status })) as typeof fetch;

    render(
      <PresentationOriginalDownloadAction
        href="/api/assistant-document/doc-1/original"
        filename="deck.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));

    expect(
      await screen.findByRole("dialog", { name: "presentationDownloadPptxFailedTitle" })
    ).toBeInTheDocument();
    expect(screen.getByText("presentationDownloadPptxFailedBody")).toBeInTheDocument();
  });

  it("restores focus to the trigger when the modal is closed", async () => {
    getTokenMock.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue(new Response("gone", { status: 410 })) as typeof fetch;

    render(
      <PresentationOriginalDownloadAction
        href="/api/assistant-document/doc-1/original"
        filename="deck.pdf"
      />
    );
    const trigger = screen.getByRole("button", { name: "presentationDownloadPptxAction" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "presentationDownloadPptxClose" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("aborts the in-flight download when unmounted", async () => {
    getTokenMock.mockResolvedValue(null);
    const capturedSignals: AbortSignal[] = [];
    const abortListener = vi.fn();
    global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal instanceof AbortSignal) {
        capturedSignals.push(init.signal);
        init.signal.addEventListener("abort", abortListener);
      }
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;

    const { unmount } = render(
      <PresentationOriginalDownloadAction
        href="/api/assistant-document/doc-1/original"
        filename="deck.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));
    await waitFor(() => {
      assertPresent(capturedSignals[0]);
    });
    const downloadSignal = requirePresent(capturedSignals[0]);

    unmount();

    expect(downloadSignal.aborted).toBe(true);
    expect(abortListener).toHaveBeenCalledTimes(1);
  });
});
