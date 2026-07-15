"use client";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import type { AssistantRoleState } from "../assistant-api-client";
import {
  AssistantChangeRoleModal,
  clampRoleListColumnWidthPx,
  ROLE_LIST_COLUMN_DEFAULT_PX,
  ROLE_LIST_COLUMN_MAX_PX,
  ROLE_LIST_COLUMN_MIN_PX
} from "./assistant-change-role-modal";

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
  displayOrder: 1,
  skills: [
    {
      skillId: "skill-1",
      displayOrder: 1,
      name: { en: "Daily planner", ru: "Планировщик" },
      category: "productivity",
      iconEmoji: "📅",
      color: null
    }
  ]
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
  displayOrder: 2,
  skills: []
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

function renderModal(
  assistantId = "assistant-a",
  onClose = vi.fn(),
  resolveAuthToken: () => Promise<string | null> = async () => "token"
) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantChangeRoleModal
        open
        assistantId={assistantId}
        resolveAuthToken={resolveAuthToken}
        onClose={onClose}
      />
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

describe("clampRoleListColumnWidthPx", () => {
  it("defaults to +15% of the previous 220px column and clamps ±20%", () => {
    expect(ROLE_LIST_COLUMN_DEFAULT_PX).toBe(253);
    expect(ROLE_LIST_COLUMN_MIN_PX).toBe(202);
    expect(ROLE_LIST_COLUMN_MAX_PX).toBe(304);
    expect(clampRoleListColumnWidthPx(100)).toBe(ROLE_LIST_COLUMN_MIN_PX);
    expect(clampRoleListColumnWidthPx(500)).toBe(ROLE_LIST_COLUMN_MAX_PX);
    expect(clampRoleListColumnWidthPx(ROLE_LIST_COLUMN_DEFAULT_PX)).toBe(
      ROLE_LIST_COLUMN_DEFAULT_PX
    );
  });
});

describe("AssistantChangeRoleModal", () => {
  it("shows split catalog detail with read-only connected skills", async () => {
    renderModal();

    expect(await screen.findByRole("dialog", { name: "Choose a new role" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Personal assistant/ })).toBeInTheDocument();
    expect(screen.getByText("Plan and follow through.")).toBeInTheDocument();
    expect(screen.getByText("Connected skills")).toBeInTheDocument();
    expect(screen.getByText("Daily planner")).toBeInTheDocument();
    expect(screen.getByTestId("change-role-list-resize-handle")).toBeInTheDocument();
    expect(document.querySelector("[data-role-list-width]")).toHaveAttribute(
      "data-role-list-width",
      String(ROLE_LIST_COLUMN_DEFAULT_PX)
    );
  });

  it("resizes the role list column within ±20% of the default", async () => {
    renderModal();
    expect(await screen.findByRole("dialog", { name: "Choose a new role" })).toBeInTheDocument();
    const handle = screen.getByTestId("change-role-list-resize-handle");
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(document.querySelector("[data-role-list-width]")).toHaveAttribute(
      "data-role-list-width",
      String(ROLE_LIST_COLUMN_MAX_PX)
    );
  });

  it("validates PUT response, refetches canonical GET, then closes", async () => {
    const onClose = vi.fn();
    api.getAssistantRole
      .mockResolvedValueOnce(selection("assistant-a", personal))
      .mockResolvedValueOnce(selection("assistant-a", engineer));
    renderModal("assistant-a", onClose);

    expect(await screen.findByText("Plan and follow through.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => {
      expect(api.updateAssistantRole).toHaveBeenCalledWith(
        "token",
        "assistant-a",
        { roleKey: "engineer" },
        expect.any(AbortSignal)
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.getAssistantRole).toHaveBeenCalledTimes(2);
  });

  it("rejects a mismatched PUT assistantId and refetches canonical state without closing", async () => {
    const onClose = vi.fn();
    api.updateAssistantRole.mockResolvedValue(selection("assistant-b", engineer));
    api.getAssistantRole
      .mockResolvedValueOnce(selection("assistant-a", personal))
      .mockResolvedValueOnce(selection("assistant-a", personal));
    renderModal("assistant-a", onClose);

    fireEvent.click(await screen.findByRole("option", { name: /Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => expect(api.updateAssistantRole).toHaveBeenCalled());
    expect(api.getAssistantRole).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("Could not update the role.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Personal assistant/ })).toBeInTheDocument();
    expect(screen.getByText("Turn requirements into working software.")).toBeInTheDocument();
  });

  it("refetches canonical state after an ambiguous PUT failure", async () => {
    const onClose = vi.fn();
    api.updateAssistantRole.mockRejectedValue(new Error("network interrupted"));
    api.getAssistantRole
      .mockResolvedValueOnce(selection("assistant-a", personal))
      .mockResolvedValueOnce(selection("assistant-a", engineer));
    renderModal("assistant-a", onClose);

    fireEvent.click(await screen.findByRole("option", { name: /Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => expect(api.getAssistantRole).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("network interrupted")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Turn requirements into working software.")).toBeInTheDocument();
  });

  it("aborts in-flight role requests on unmount", async () => {
    const pendingCatalog = deferred<ReturnType<typeof catalog>>();
    const pendingRole = deferred<ReturnType<typeof selection>>();
    api.getAssistantRoles.mockReturnValue(pendingCatalog.promise);
    api.getAssistantRole.mockReturnValue(pendingRole.promise);
    const { unmount } = renderModal();

    await waitFor(() => expect(api.getAssistantRole).toHaveBeenCalledTimes(1));
    const signal = api.getAssistantRole.mock.calls[0]?.[2] as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("does not restart canonical loading when only the auth resolver identity changes", async () => {
    const firstResolver = vi.fn(async () => "token-a");
    const secondResolver = vi.fn(async () => "token-b");
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantChangeRoleModal
          open
          assistantId="assistant-a"
          resolveAuthToken={firstResolver}
          onClose={() => undefined}
        />
      </NextIntlClientProvider>
    );

    expect(await screen.findByText("Plan and follow through.")).toBeInTheDocument();
    expect(api.getAssistantRoles).toHaveBeenCalledTimes(1);
    expect(api.getAssistantRole).toHaveBeenCalledTimes(1);

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantChangeRoleModal
          open
          assistantId="assistant-a"
          resolveAuthToken={secondResolver}
          onClose={() => undefined}
        />
      </NextIntlClientProvider>
    );
    await Promise.resolve();

    expect(firstResolver).toHaveBeenCalledTimes(1);
    expect(secondResolver).not.toHaveBeenCalled();
    expect(api.getAssistantRoles).toHaveBeenCalledTimes(1);
    expect(api.getAssistantRole).toHaveBeenCalledTimes(1);
  });

  it("aborts and rejects stale out-of-order responses when the active assistant switches", async () => {
    const catalogA = deferred<ReturnType<typeof catalog>>();
    const roleA = deferred<ReturnType<typeof selection>>();
    api.getAssistantRoles.mockReturnValueOnce(catalogA.promise).mockResolvedValueOnce(catalog());
    api.getAssistantRole
      .mockReturnValueOnce(roleA.promise)
      .mockResolvedValueOnce(selection("assistant-b", engineer));

    const { rerender } = renderModal("assistant-a");
    await waitFor(() => expect(api.getAssistantRole).toHaveBeenCalledTimes(1));
    const signalA = api.getAssistantRole.mock.calls[0]?.[2] as AbortSignal;

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantChangeRoleModal
          open
          assistantId="assistant-b"
          resolveAuthToken={async () => "token"}
          onClose={() => undefined}
        />
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
    renderModal();
    expect(await screen.findByText("Could not load the role.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
