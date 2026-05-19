import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationPptxPrepareAction } from "./presentation-pptx-prepare-action";

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

function assertPresent<T>(value: T | null | undefined): asserts value is T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
}

describe("PresentationPptxPrepareAction", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    getTokenMock.mockReset();
    global.fetch = ORIGINAL_FETCH;
  });

  it("opens a confirmation modal before starting the second PPTX render", async () => {
    getTokenMock.mockResolvedValue("fresh-client-token");
    global.fetch = vi.fn().mockResolvedValue(Response.json({ status: "queued" })) as typeof fetch;

    render(
      <PresentationPptxPrepareAction
        href="/api/assistant-document/doc-1/prepare-pptx?versionId=version-1"
        filename="deck.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));

    expect(
      await screen.findByRole("dialog", { name: "presentationDownloadPptxConfirmTitle" })
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxConfirmAction" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/assistant-document/doc-1/prepare-pptx?versionId=version-1",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          headers: {
            "X-PersAI-Session-Token": "fresh-client-token"
          }
        })
      );
    });
    const requestInit = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.stringify(requestInit?.headers)).not.toContain("Authorization");
    expect(
      await screen.findByRole("dialog", { name: "presentationDownloadPptxAcceptedTitle" })
    ).toBeInTheDocument();
  });

  it("shows the already-running acknowledgement without duplicating the job", async () => {
    getTokenMock.mockResolvedValue(null);
    global.fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "already_running" })) as typeof fetch;

    render(
      <PresentationPptxPrepareAction
        href="/api/assistant-document/doc-1/prepare-pptx"
        filename="deck.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "presentationDownloadPptxConfirmAction" })
    );

    expect(
      await screen.findByText("presentationDownloadPptxAlreadyRunningBody")
    ).toBeInTheDocument();
  });

  it("notifies the parent when the PPTX preparation is accepted", async () => {
    getTokenMock.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue(Response.json({ status: "queued" })) as typeof fetch;
    const onAccepted = vi.fn();

    render(
      <PresentationPptxPrepareAction
        href="/api/assistant-document/doc-1/prepare-pptx"
        filename="deck.pdf"
        onAccepted={onAccepted}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "presentationDownloadPptxConfirmAction" })
    );

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a failed modal for non-2xx preparation responses", async () => {
    getTokenMock.mockResolvedValue(null);
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("failed", { status: 500 })) as typeof fetch;

    render(
      <PresentationPptxPrepareAction
        href="/api/assistant-document/doc-1/prepare-pptx"
        filename="deck.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "presentationDownloadPptxConfirmAction" })
    );

    expect(
      await screen.findByRole("dialog", { name: "presentationDownloadPptxFailedTitle" })
    ).toBeInTheDocument();
    expect(screen.getByText("presentationDownloadPptxFailedBody")).toBeInTheDocument();
  });

  it("restores focus to the trigger when the modal is closed", async () => {
    getTokenMock.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue(Response.json({ status: "queued" })) as typeof fetch;

    render(
      <PresentationPptxPrepareAction
        href="/api/assistant-document/doc-1/prepare-pptx"
        filename="deck.pdf"
      />
    );
    const trigger = screen.getByRole("button", { name: "presentationDownloadPptxAction" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "presentationDownloadPptxCancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("aborts the in-flight preparation when unmounted", async () => {
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
      <PresentationPptxPrepareAction
        href="/api/assistant-document/doc-1/prepare-pptx"
        filename="deck.pdf"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "presentationDownloadPptxAction" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "presentationDownloadPptxConfirmAction" })
    );
    await waitFor(() => {
      assertPresent(capturedSignals[0]);
    });

    unmount();

    expect(capturedSignals[0]?.aborted).toBe(true);
    expect(abortListener).toHaveBeenCalledTimes(1);
  });
});
