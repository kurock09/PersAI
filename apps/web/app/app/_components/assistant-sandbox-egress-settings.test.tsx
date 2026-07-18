import { cleanup, fireEvent, render, screen, waitFor, act, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ContractsApiError } from "@persai/contracts";
import enMessages from "../../../messages/en.json";
import ruMessages from "../../../messages/ru.json";
import { AssistantSandboxEgressSettings } from "./assistant-sandbox-egress-settings";

const apiMocks = vi.hoisted(() => ({
  getAssistantSandboxEgress: vi.fn(),
  putAssistantSandboxEgress: vi.fn()
}));

const streamingMocks = vi.hoisted(() => ({
  activeThreads: new Set<string>(),
  activeMediaThreads: new Set<string>(),
  activeDocumentThreads: new Set<string>(),
  activeSandboxThreads: new Set<string>()
}));

vi.mock("../assistant-api-client", () => ({
  getAssistantSandboxEgress: apiMocks.getAssistantSandboxEgress,
  putAssistantSandboxEgress: apiMocks.putAssistantSandboxEgress
}));

vi.mock("./streaming-threads", () => ({
  useStreamingThreadsRegistry: () => ({
    activeThreads: streamingMocks.activeThreads,
    activeMediaThreads: streamingMocks.activeMediaThreads,
    activeDocumentThreads: streamingMocks.activeDocumentThreads,
    activeSandboxThreads: streamingMocks.activeSandboxThreads,
    markStreaming: vi.fn(),
    markMediaActive: vi.fn(),
    markDocumentActive: vi.fn(),
    markSandboxActive: vi.fn()
  })
}));

const ASSISTANT_ID = "11111111-1111-4111-8111-111111111111";
const ASSISTANT_B_ID = "22222222-2222-4222-8222-222222222222";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderControl(
  locale: "en" | "ru" = "en",
  props: Partial<{
    assistantId: string;
    resolveAuthToken: () => Promise<string | null>;
  }> = {}
) {
  const resolveAuthToken = props.resolveAuthToken ?? (async () => "token-1");
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ru" ? ruMessages : enMessages}>
      <AssistantSandboxEgressSettings
        assistantId={props.assistantId ?? ASSISTANT_ID}
        resolveAuthToken={resolveAuthToken}
      />
    </NextIntlClientProvider>
  );
}

function getSwitch(): HTMLElement {
  return screen.getByRole("switch", {
    name: /internet access for the assistant|доступ в интернет для ассистента/i
  });
}

describe("AssistantSandboxEgressSettings", () => {
  beforeEach(() => {
    apiMocks.getAssistantSandboxEgress.mockReset();
    apiMocks.putAssistantSandboxEgress.mockReset();
    streamingMocks.activeThreads = new Set();
    streamingMocks.activeMediaThreads = new Set();
    streamingMocks.activeDocumentThreads = new Set();
    streamingMocks.activeSandboxThreads = new Set();
    apiMocks.getAssistantSandboxEgress.mockResolvedValue({
      requestId: "req-1",
      assistantId: ASSISTANT_ID,
      mode: "restricted",
      recycled: false
    });
    apiMocks.putAssistantSandboxEgress.mockResolvedValue({
      requestId: "req-2",
      assistantId: ASSISTANT_ID,
      mode: "full_public",
      recycled: true
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders EN honest copy for the enable confirmation modal", async () => {
    renderControl("en");
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(getSwitch());

    expect(screen.getByRole("dialog", { name: /allow full internet access/i })).toBeInTheDocument();
    expect(screen.getByText(/any public website/i)).toBeInTheDocument();
    expect(screen.getByText(/built-in browser and web search are unchanged/i)).toBeInTheDocument();
    expect(screen.queryByText(/pod|kubernetes|shell|exec/i)).not.toBeInTheDocument();
  });

  it("renders RU honest copy for the enable confirmation modal", async () => {
    renderControl("ru");
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(getSwitch());

    expect(
      screen.getByRole("dialog", { name: /разрешить полный доступ в интернет/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/любые публичные сайты/i)).toBeInTheDocument();
    expect(screen.getByText(/встроенный браузер и веб-поиск не меняются/i)).toBeInTheDocument();
    expect(screen.queryByText(/под|kubernetes|shell|exec/i)).not.toBeInTheDocument();
  });

  it("loads canonical GET state on mount", async () => {
    apiMocks.getAssistantSandboxEgress.mockResolvedValueOnce({
      requestId: "req-1",
      assistantId: ASSISTANT_ID,
      mode: "full_public",
      recycled: false
    });
    renderControl();
    await waitFor(() => {
      expect(apiMocks.getAssistantSandboxEgress).toHaveBeenCalledWith(
        "token-1",
        ASSISTANT_ID,
        expect.any(AbortSignal)
      );
      expect(getSwitch()).toHaveAttribute("aria-checked", "true");
    });
  });

  it("keeps the switch unchecked when enable confirmation is cancelled", async () => {
    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(getSwitch()).toHaveAttribute("aria-checked", "false");
    expect(apiMocks.putAssistantSandboxEgress).not.toHaveBeenCalled();
  });

  it("confirms enable with canonical PUT and refetched checked state", async () => {
    apiMocks.getAssistantSandboxEgress
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      })
      .mockResolvedValueOnce({
        requestId: "req-3",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: false
      });
    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => {
      expect(apiMocks.putAssistantSandboxEgress).toHaveBeenCalledWith(
        "token-1",
        ASSISTANT_ID,
        "full_public",
        expect.any(AbortSignal)
      );
      expect(apiMocks.getAssistantSandboxEgress).toHaveBeenCalledTimes(2);
      expect(getSwitch()).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(getSwitch()).toHaveFocus());
  });

  it("does not optimistically check before PUT success", async () => {
    apiMocks.getAssistantSandboxEgress
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      })
      .mockResolvedValueOnce({
        requestId: "req-3",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: false
      });
    let resolvePut: ((value: unknown) => void) | null = null;
    apiMocks.putAssistantSandboxEgress.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = resolve;
        })
    );

    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => expect(apiMocks.putAssistantSandboxEgress).toHaveBeenCalledTimes(1));
    expect(getSwitch()).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      resolvePut?.({
        requestId: "req-2",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: true
      });
    });
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "true"));
  });

  it("prevents duplicate PUT actions while saving", async () => {
    let resolvePut: ((value: unknown) => void) | null = null;
    apiMocks.putAssistantSandboxEgress.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = resolve;
        })
    );

    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(getSwitch());

    const confirm = screen.getByRole("button", { name: /allow full access/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(apiMocks.putAssistantSandboxEgress).toHaveBeenCalledTimes(1));
    fireEvent.click(confirm);

    expect(apiMocks.putAssistantSandboxEgress).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(getSwitch()).toBeDisabled();
    expect(getSwitch()).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolvePut?.({
        requestId: "req-2",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: true
      });
    });
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    expect(getSwitch()).toHaveAttribute("aria-busy", "false");
  });

  it("disables immediately to restricted with canonical PUT", async () => {
    apiMocks.getAssistantSandboxEgress
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: false
      })
      .mockResolvedValueOnce({
        requestId: "req-4",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      });
    apiMocks.putAssistantSandboxEgress.mockResolvedValue({
      requestId: "req-3",
      assistantId: ASSISTANT_ID,
      mode: "restricted",
      recycled: true
    });

    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(getSwitch());

    await waitFor(() => {
      expect(apiMocks.putAssistantSandboxEgress).toHaveBeenCalledWith(
        "token-1",
        ASSISTANT_ID,
        "restricted",
        expect.any(AbortSignal)
      );
      expect(getSwitch()).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders stable 409 busy error and refetches canonical state", async () => {
    apiMocks.getAssistantSandboxEgress
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      })
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      });
    apiMocks.putAssistantSandboxEgress.mockRejectedValue(
      new ContractsApiError("Busy", 409, null, "sandbox_egress_change_busy")
    );

    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      const alert = within(dialog).getByRole("alert");
      expect(alert).toHaveTextContent(/assistant is busy right now/i);
      expect(dialog.getAttribute("aria-describedby")).toContain(alert.id);
      expect(getSwitch().getAttribute("aria-describedby")).toContain(alert.id);
      expect(getSwitch()).toHaveAttribute("aria-checked", "false");
      expect(apiMocks.getAssistantSandboxEgress).toHaveBeenCalledTimes(2);
    });
  });

  it("renders honest 503 recycle failure, refetches, and does not claim success", async () => {
    apiMocks.getAssistantSandboxEgress
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      })
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: false
      });
    apiMocks.putAssistantSandboxEgress.mockRejectedValue(
      new ContractsApiError("Recycle failed", 503, null, "sandbox_egress_recycle_failed")
    );

    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => {
      const alert = within(screen.getByRole("dialog")).getByRole("alert");
      expect(alert).toHaveTextContent(/may already be saved/i);
      expect(alert).toHaveTextContent(/applying it failed/i);
      expect(getSwitch()).toHaveAttribute("aria-checked", "true");
      expect(apiMocks.getAssistantSandboxEgress).toHaveBeenCalledTimes(2);
    });
  });

  it("maps generic save errors through the inline alert", async () => {
    apiMocks.putAssistantSandboxEgress.mockRejectedValue(new Error("Network down"));

    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /could not update the internet access setting/i
      );
      expect(screen.queryByText(/network down/i)).not.toBeInTheDocument();
    });
  });

  it("disables the switch while assistant sandbox work is active", async () => {
    streamingMocks.activeThreads = new Set([`${ASSISTANT_ID}::thread-1`]);
    renderControl();
    await waitFor(() => expect(getSwitch()).toBeDisabled());
    expect(screen.getByText(/unavailable while the assistant is working/i)).toBeInTheDocument();
  });

  it("supports keyboard activation on the semantic switch", async () => {
    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.keyDown(getSwitch(), { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("supports Space activation and blocks keyboard activation while disabled", async () => {
    renderControl();
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));

    fireEvent.keyDown(getSwitch(), { key: " " });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    cleanup();
    streamingMocks.activeThreads = new Set([`${ASSISTANT_ID}::thread-1`]);
    renderControl();
    await waitFor(() => expect(getSwitch()).toBeDisabled());
    fireEvent.keyDown(getSwitch(), { key: " " });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiMocks.putAssistantSandboxEgress).not.toHaveBeenCalled();
  });

  it("closes on Escape without PUT and restores focus to the switch", async () => {
    renderControl();
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    const sandboxSwitch = getSwitch();
    fireEvent.click(sandboxSwitch);
    expect(screen.getByRole("button", { name: /allow full access/i })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(sandboxSwitch).toHaveFocus());
    expect(apiMocks.putAssistantSandboxEgress).not.toHaveBeenCalled();
  });

  it("cancels from the backdrop and restores focus", async () => {
    renderControl();
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    const sandboxSwitch = getSwitch();
    fireEvent.click(sandboxSwitch);
    fireEvent.click(screen.getByRole("presentation"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(sandboxSwitch).toHaveFocus());
    expect(apiMocks.putAssistantSandboxEgress).not.toHaveBeenCalled();
  });

  it("blocks Escape and backdrop dismissal while PUT is in flight", async () => {
    const pendingPut = deferred<{
      requestId: string;
      assistantId: string;
      mode: "full_public";
      recycled: boolean;
    }>();
    apiMocks.putAssistantSandboxEgress.mockReturnValue(pendingPut.promise);
    renderControl();
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));
    await waitFor(() => expect(apiMocks.putAssistantSandboxEgress).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pendingPut.resolve({
      requestId: "req-2",
      assistantId: ASSISTANT_ID,
      mode: "full_public",
      recycled: false
    });
  });

  it("contains Tab focus between modal actions", async () => {
    renderControl();
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    fireEvent.click(getSwitch());
    const cancel = screen.getByRole("button", { name: /cancel/i });
    const confirm = screen.getByRole("button", { name: /allow full access/i });

    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it("associates busy reason and exposes load/save aria-busy", async () => {
    const pendingGet = deferred<{
      requestId: string;
      assistantId: string;
      mode: "restricted";
      recycled: boolean;
    }>();
    apiMocks.getAssistantSandboxEgress.mockReturnValueOnce(pendingGet.promise);
    const { unmount } = renderControl();
    expect(getSwitch()).toHaveAttribute("aria-busy", "true");
    expect(getSwitch()).toBeDisabled();
    unmount();
    pendingGet.resolve({
      requestId: "req-1",
      assistantId: ASSISTANT_ID,
      mode: "restricted",
      recycled: false
    });

    cleanup();
    streamingMocks.activeThreads = new Set([`${ASSISTANT_ID}::thread-1`]);
    renderControl();
    await waitFor(() => expect(getSwitch()).toBeDisabled());
    const descriptionIds = getSwitch().getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(descriptionIds.length).toBeGreaterThan(1);
    expect(document.getElementById(descriptionIds[1] ?? "")).toHaveTextContent(
      /unavailable while the assistant is working/i
    );
    expect(getSwitch()).toHaveAttribute("aria-busy", "false");
  });

  it("sanitizes GET errors and fails closed on mismatched assistant responses", async () => {
    apiMocks.getAssistantSandboxEgress.mockRejectedValueOnce(
      new ContractsApiError("Sensitive server detail", 403, null, "forbidden")
    );
    renderControl();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /could not load the internet access setting/i
      );
      expect(screen.queryByText(/sensitive server detail/i)).not.toBeInTheDocument();
      expect(getSwitch()).toBeDisabled();
    });

    cleanup();
    apiMocks.getAssistantSandboxEgress.mockResolvedValueOnce({
      requestId: "req-wrong",
      assistantId: ASSISTANT_B_ID,
      mode: "full_public",
      recycled: false
    });
    renderControl();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /could not load the internet access setting/i
      );
      expect(getSwitch()).toHaveAttribute("aria-checked", "false");
      expect(getSwitch()).toBeDisabled();
    });
  });

  it("ignores an old assistant PUT completion after switching to a new assistant", async () => {
    const pendingPut = deferred<{
      requestId: string;
      assistantId: string;
      mode: "full_public";
      recycled: boolean;
    }>();
    apiMocks.getAssistantSandboxEgress.mockImplementation((_token: string, assistantId: string) =>
      Promise.resolve({
        requestId: "req-get",
        assistantId,
        mode: "restricted",
        recycled: false
      })
    );
    apiMocks.putAssistantSandboxEgress.mockReturnValueOnce(pendingPut.promise);
    const auth = async () => "token-1";
    const view = renderControl("en", { assistantId: ASSISTANT_ID, resolveAuthToken: auth });
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));
    await waitFor(() => expect(apiMocks.putAssistantSandboxEgress).toHaveBeenCalledTimes(1));

    view.rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantSandboxEgressSettings assistantId={ASSISTANT_B_ID} resolveAuthToken={auth} />
      </NextIntlClientProvider>
    );
    await waitFor(() => {
      expect(getSwitch()).toHaveAttribute("aria-checked", "false");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await act(async () => {
      pendingPut.resolve({
        requestId: "req-a-put",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: true
      });
    });

    expect(getSwitch()).toHaveAttribute("aria-checked", "false");
    expect(getSwitch()).not.toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets the newest assistant GET win when responses complete out of order", async () => {
    const getA = deferred<{
      requestId: string;
      assistantId: string;
      mode: "full_public";
      recycled: boolean;
    }>();
    const getB = deferred<{
      requestId: string;
      assistantId: string;
      mode: "restricted";
      recycled: boolean;
    }>();
    apiMocks.getAssistantSandboxEgress.mockImplementation((_token: string, assistantId: string) =>
      assistantId === ASSISTANT_ID ? getA.promise : getB.promise
    );
    const auth = async () => "token-1";
    const view = renderControl("en", { assistantId: ASSISTANT_ID, resolveAuthToken: auth });
    view.rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantSandboxEgressSettings assistantId={ASSISTANT_B_ID} resolveAuthToken={auth} />
      </NextIntlClientProvider>
    );

    await act(async () => {
      getB.resolve({
        requestId: "req-b",
        assistantId: ASSISTANT_B_ID,
        mode: "restricted",
        recycled: false
      });
    });
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());

    await act(async () => {
      getA.resolve({
        requestId: "req-a",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: false
      });
    });
    expect(getSwitch()).toHaveAttribute("aria-checked", "false");
    expect(getSwitch()).not.toBeDisabled();
  });

  it("lets the newest same-assistant generation win after switching away and back", async () => {
    const firstA = deferred<{
      requestId: string;
      assistantId: string;
      mode: "full_public";
      recycled: boolean;
    }>();
    let aRequestCount = 0;
    apiMocks.getAssistantSandboxEgress.mockImplementation((_token: string, assistantId: string) => {
      if (assistantId === ASSISTANT_B_ID) {
        return Promise.resolve({
          requestId: "req-b",
          assistantId: ASSISTANT_B_ID,
          mode: "full_public",
          recycled: false
        });
      }
      aRequestCount += 1;
      if (aRequestCount === 1) {
        return firstA.promise;
      }
      return Promise.resolve({
        requestId: "req-a-new",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      });
    });
    const auth = async () => "token-1";
    const view = renderControl("en", { assistantId: ASSISTANT_ID, resolveAuthToken: auth });
    await waitFor(() =>
      expect(apiMocks.getAssistantSandboxEgress).toHaveBeenCalledWith(
        "token-1",
        ASSISTANT_ID,
        expect.any(AbortSignal)
      )
    );

    view.rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantSandboxEgressSettings assistantId={ASSISTANT_B_ID} resolveAuthToken={auth} />
      </NextIntlClientProvider>
    );
    await waitFor(() => expect(getSwitch()).toHaveAttribute("aria-checked", "true"));

    view.rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantSandboxEgressSettings assistantId={ASSISTANT_ID} resolveAuthToken={auth} />
      </NextIntlClientProvider>
    );
    await waitFor(() => {
      expect(getSwitch()).toHaveAttribute("aria-checked", "false");
      expect(getSwitch()).not.toBeDisabled();
    });

    await act(async () => {
      firstA.resolve({
        requestId: "req-a-old",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: false
      });
    });
    expect(getSwitch()).toHaveAttribute("aria-checked", "false");
    expect(getSwitch()).not.toBeDisabled();
  });

  it("ignores deferred GET completion after unmount", async () => {
    const pendingGet = deferred<{
      requestId: string;
      assistantId: string;
      mode: "full_public";
      recycled: boolean;
    }>();
    apiMocks.getAssistantSandboxEgress.mockReturnValueOnce(pendingGet.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = renderControl();
    view.unmount();

    await act(async () => {
      pendingGet.resolve({
        requestId: "req-late",
        assistantId: ASSISTANT_ID,
        mode: "full_public",
        recycled: false
      });
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("requires canonical GET after PUT and fails closed if refetch fails", async () => {
    apiMocks.getAssistantSandboxEgress
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      })
      .mockRejectedValueOnce(new Error("private refetch detail"));
    renderControl();
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => {
      expect(apiMocks.getAssistantSandboxEgress).toHaveBeenCalledTimes(2);
      expect(getSwitch()).toHaveAttribute("aria-checked", "false");
      expect(getSwitch()).toBeDisabled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
        /may have been saved/i
      );
      expect(screen.queryByText(/private refetch detail/i)).not.toBeInTheDocument();
    });
  });

  it("uses unique load/save alert ids when PUT and canonical refetch both fail", async () => {
    apiMocks.getAssistantSandboxEgress
      .mockResolvedValueOnce({
        requestId: "req-1",
        assistantId: ASSISTANT_ID,
        mode: "restricted",
        recycled: false
      })
      .mockRejectedValueOnce(new Error("private refetch detail"));
    apiMocks.putAssistantSandboxEgress.mockRejectedValueOnce(
      new ContractsApiError("private save detail", 409, null, "sandbox_egress_change_busy")
    );
    renderControl();
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(2);
      const [loadAlert, modalAlert] = alerts;
      expect(loadAlert).toHaveTextContent(/could not load the internet access setting/i);
      expect(modalAlert).toHaveTextContent(/assistant is busy right now/i);
      expect(loadAlert?.id).toBeTruthy();
      expect(modalAlert?.id).toBeTruthy();
      expect(loadAlert?.id).not.toBe(modalAlert?.id);

      for (const alert of alerts) {
        expect(document.querySelectorAll(`[id="${alert.id}"]`)).toHaveLength(1);
      }

      const switchDescriptionIds =
        getSwitch().getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
      expect(new Set(switchDescriptionIds).size).toBe(switchDescriptionIds.length);
      expect(switchDescriptionIds).toContain(loadAlert?.id);
      expect(switchDescriptionIds).toContain(modalAlert?.id);

      const dialog = screen.getByRole("dialog");
      const dialogDescriptionIds =
        dialog.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
      expect(new Set(dialogDescriptionIds).size).toBe(dialogDescriptionIds.length);
      expect(dialogDescriptionIds).toContain(modalAlert?.id);
      expect(dialogDescriptionIds).not.toContain(loadAlert?.id);
    });
  });

  it("rejects mismatched PUT assistantId and keeps the modal open with localized error", async () => {
    apiMocks.putAssistantSandboxEgress.mockResolvedValueOnce({
      requestId: "req-wrong",
      assistantId: ASSISTANT_B_ID,
      mode: "full_public",
      recycled: false
    });
    renderControl();
    await waitFor(() => expect(getSwitch()).not.toBeDisabled());
    fireEvent.click(getSwitch());
    fireEvent.click(screen.getByRole("button", { name: /allow full access/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /could not update the internet access setting/i
      );
      expect(getSwitch()).toHaveAttribute("aria-checked", "false");
    });
  });
});
