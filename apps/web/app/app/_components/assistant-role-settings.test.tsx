import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import type { AssistantRoleState } from "../assistant-api-client";
import { AssistantRoleSettings } from "./assistant-role-settings";

const api = vi.hoisted(() => ({
  getAssistantRoles: vi.fn(),
  getAssistantRole: vi.fn(),
  updateAssistantRole: vi.fn()
}));

vi.mock("../assistant-api-client", async () => {
  const actual =
    await vi.importActual<typeof import("../assistant-api-client")>("../assistant-api-client");
  return {
    ...actual,
    getAssistantRoles: api.getAssistantRoles,
    getAssistantRole: api.getAssistantRole,
    updateAssistantRole: api.updateAssistantRole
  };
});

const personal: AssistantRoleState = {
  id: "role-personal",
  key: "persai_default",
  name: { en: "Personal assistant", ru: "Личный ассистент" },
  description: { en: "Keeps daily work clear.", ru: "Помогает с повседневными делами." },
  mission: { en: "Plan and follow through.", ru: "Планирует и доводит дела до результата." },
  category: "personal",
  iconEmoji: "P",
  color: "#6D7CFF",
  displayOrder: 1
};

const engineer: AssistantRoleState = {
  id: "role-engineer",
  key: "engineer",
  name: { en: "Engineer", ru: "Инженер" },
  description: { en: "Builds reliable systems.", ru: "Создаёт надёжные системы." },
  mission: {
    en: "Turn requirements into working software.",
    ru: "Превращает требования в работающий продукт."
  },
  category: "engineering",
  iconEmoji: null,
  color: null,
  displayOrder: 2
};

function catalog() {
  return { requestId: "roles", roles: [personal, engineer] };
}

function selection(assistantId: string, role: AssistantRoleState) {
  return { requestId: "role", assistantId, role };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderSettings(assistantId = "assistant-a") {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantRoleSettings assistantId={assistantId} resolveAuthToken={async () => "token"} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  api.getAssistantRoles.mockResolvedValue(catalog());
  api.getAssistantRole.mockResolvedValue(selection("assistant-a", personal));
  api.updateAssistantRole.mockResolvedValue(selection("assistant-a", engineer));
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("AssistantRoleSettings", () => {
  it("validates PUT response, refetches canonical GET, then shows success", async () => {
    api.getAssistantRole
      .mockResolvedValueOnce(selection("assistant-a", personal))
      .mockResolvedValueOnce(selection("assistant-a", engineer));
    renderSettings();

    expect(await screen.findByText("Plan and follow through.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change role" }));
    fireEvent.click(screen.getByRole("button", { name: /Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => {
      expect(api.updateAssistantRole).toHaveBeenCalledWith(
        "token",
        "assistant-a",
        { roleKey: "engineer" },
        expect.any(AbortSignal)
      );
    });
    await waitFor(() => expect(screen.getByText("Role updated.")).toBeInTheDocument());
    expect(api.getAssistantRole).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Turn requirements into working software.")).toBeInTheDocument();
  });

  it("rejects a mismatched PUT assistantId and refetches canonical state without success", async () => {
    api.updateAssistantRole.mockResolvedValue(selection("assistant-b", engineer));
    api.getAssistantRole
      .mockResolvedValueOnce(selection("assistant-a", personal))
      .mockResolvedValueOnce(selection("assistant-a", personal));
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Change role" }));
    fireEvent.click(screen.getByRole("button", { name: /Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => expect(api.getAssistantRole).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Role updated.")).not.toBeInTheDocument();
    expect(await screen.findByText("Could not update the role.")).toBeInTheDocument();
    expect(screen.getAllByText("Plan and follow through.").length).toBeGreaterThan(0);
  });

  it("refetches canonical state after an ambiguous PUT failure", async () => {
    api.updateAssistantRole.mockRejectedValue(new Error("network interrupted"));
    api.getAssistantRole
      .mockResolvedValueOnce(selection("assistant-a", personal))
      .mockResolvedValueOnce(selection("assistant-a", engineer));
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Change role" }));
    fireEvent.click(screen.getByRole("button", { name: /Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => expect(api.getAssistantRole).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("network interrupted")).toBeInTheDocument();
    expect(screen.queryByText("Role updated.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Turn requirements into working software.").length).toBeGreaterThan(
      0
    );
  });

  it("aborts in-flight role requests on unmount", async () => {
    const pendingCatalog = deferred<ReturnType<typeof catalog>>();
    const pendingRole = deferred<ReturnType<typeof selection>>();
    api.getAssistantRoles.mockReturnValue(pendingCatalog.promise);
    api.getAssistantRole.mockReturnValue(pendingRole.promise);
    const { unmount } = renderSettings();

    await waitFor(() => expect(api.getAssistantRole).toHaveBeenCalledTimes(1));
    const signal = api.getAssistantRole.mock.calls[0]?.[2] as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("aborts and rejects stale out-of-order responses when the active assistant switches", async () => {
    const catalogA = deferred<ReturnType<typeof catalog>>();
    const roleA = deferred<ReturnType<typeof selection>>();
    api.getAssistantRoles.mockReturnValueOnce(catalogA.promise).mockResolvedValueOnce(catalog());
    api.getAssistantRole
      .mockReturnValueOnce(roleA.promise)
      .mockResolvedValueOnce(selection("assistant-b", engineer));

    const { rerender } = renderSettings("assistant-a");
    await waitFor(() => expect(api.getAssistantRole).toHaveBeenCalledTimes(1));
    const signalA = api.getAssistantRole.mock.calls[0]?.[2] as AbortSignal;

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantRoleSettings assistantId="assistant-b" resolveAuthToken={async () => "token"} />
      </NextIntlClientProvider>
    );
    expect(signalA.aborted).toBe(true);
    expect(await screen.findByText("Turn requirements into working software.")).toBeInTheDocument();

    catalogA.resolve(catalog());
    roleA.resolve(selection("assistant-a", personal));
    await Promise.resolve();
    expect(screen.queryByText("Plan and follow through.")).not.toBeInTheDocument();
    expect(screen.getByText("Turn requirements into working software.")).toBeInTheDocument();
  });

  it("fails closed when current role is absent from the active catalog", async () => {
    api.getAssistantRoles.mockResolvedValue({ requestId: "roles", roles: [engineer] });
    renderSettings();
    expect(await screen.findByText("Could not load the role.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
