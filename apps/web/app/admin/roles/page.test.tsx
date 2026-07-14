import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import ruMessages from "../../../messages/ru.json";
import type { AdminRoleState } from "@/app/app/assistant-api-client";
import AdminRolesPage, {
  draftToCreatePayload,
  draftToUpdatePayload,
  roleToDraft,
  validateRoleDraft
} from "./page";

const api = vi.hoisted(() => ({
  getAdminRoles: vi.fn(),
  getAdminSkills: vi.fn(),
  createAdminRole: vi.fn(),
  updateAdminRole: vi.fn(),
  archiveAdminRole: vi.fn(),
  replaceAdminRoleSkills: vi.fn(),
  previewAdminRole: vi.fn()
}));
const clerk = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: clerk.getToken })
}));

vi.mock("@/app/app/assistant-api-client", async () => {
  const actual = await vi.importActual<typeof import("@/app/app/assistant-api-client")>(
    "@/app/app/assistant-api-client"
  );
  return { ...actual, ...api };
});

function createRole(overrides: Partial<AdminRoleState> = {}): AdminRoleState {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    key: "analyst",
    name: { en: "Analyst", ru: "Аналитик" },
    description: { en: "Analysis role", ru: "Роль аналитика" },
    mission: { en: "Analyze carefully.", ru: "Анализируй внимательно." },
    category: "work",
    iconEmoji: null,
    color: null,
    status: "active",
    displayOrder: 10,
    isDefault: false,
    assistantCount: 0,
    inUse: false,
    skillIds: ["00000000-0000-4000-8000-000000000301"],
    skills: [],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides
  };
}

const skillOne = {
  id: "00000000-0000-4000-8000-000000000301",
  status: "active",
  name: { en: "Research", ru: "Исследование" },
  category: "work"
};
const skillTwo = {
  id: "00000000-0000-4000-8000-000000000302",
  status: "active",
  name: { en: "Writing", ru: "Тексты" },
  category: "work"
};

function renderPage(locale: "en" | "ru") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ru" ? ruMessages : enMessages}>
      <AdminRolesPage />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  clerk.getToken.mockResolvedValue("token");
  api.getAdminRoles.mockResolvedValue([createRole()]);
  api.getAdminSkills.mockResolvedValue([skillOne, skillTwo]);
  api.createAdminRole.mockResolvedValue(createRole({ key: "ops_lead", skillIds: [] }));
  api.updateAdminRole.mockImplementation(async (_token, _id, payload) => ({
    ...createRole(),
    ...payload
  }));
  api.replaceAdminRoleSkills.mockImplementation(async (_token, _id, payload) =>
    createRole({ skillIds: payload.skillIds })
  );
  api.previewAdminRole.mockResolvedValue({
    locale: "ru",
    missionBlock: "<assistant_role>точно</assistant_role>",
    enabledSkillsBlock: "<enabled_skills>точно</enabled_skills>",
    skillIds: [skillOne.id, skillTwo.id]
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin roles page helpers", () => {
  it("round-trips role draft and create/update payloads", () => {
    const draft = roleToDraft(createRole());
    expect(draft.key).toBe("analyst");
    expect(draft.nameRu).toBe("Аналитик");
    expect(draft.skillIds).toEqual(["00000000-0000-4000-8000-000000000301"]);

    const createPayload = draftToCreatePayload({
      ...draft,
      id: null,
      key: "ops_lead"
    });
    expect(createPayload.key).toBe("ops_lead");
    expect(createPayload.mission.en).toBe("Analyze carefully.");

    const updatePayload = draftToUpdatePayload(draft);
    expect(updatePayload).not.toHaveProperty("key");
    expect(updatePayload.status).toBe("active");
  });

  it("requires both RU and EN localized fields and valid key on create", () => {
    const draft = roleToDraft(createRole());
    expect(validateRoleDraft({ ...draft, id: null, key: "Bad Key" }, "create")).toBe("invalidKey");
    expect(validateRoleDraft({ ...draft, nameRu: "" }, "update")).toBe("localizedName");
    expect(validateRoleDraft({ ...draft, missionEn: "" }, "update")).toBe("localizedMission");
  });

  it("protects default role skill and status invariants in client validation", () => {
    const draft = roleToDraft(
      createRole({
        key: "persai_default",
        isDefault: true,
        skillIds: [],
        status: "active"
      })
    );
    expect(validateRoleDraft({ ...draft, status: "draft" }, "update")).toBe("defaultStatus");
    expect(
      validateRoleDraft({ ...draft, skillIds: ["00000000-0000-4000-8000-000000000301"] }, "update")
    ).toBe("defaultSkills");
  });

  it("protects active status for an in-use role", () => {
    const draft = roleToDraft(createRole({ assistantCount: 2, inUse: true }));
    expect(validateRoleDraft({ ...draft, status: "archived" }, "update")).toBe("inUseStatus");
  });
});

describe("AdminRolesPage integration", () => {
  it("renders EN and RU catalogs and performs initial Role/Skill loads", async () => {
    const first = renderPage("en");
    expect(screen.getByText("Loading roles…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Roles" })).toBeInTheDocument();
    expect(await screen.findByText("Analyst")).toBeInTheDocument();
    expect(api.getAdminRoles).toHaveBeenCalledWith("token");
    expect(api.getAdminSkills).toHaveBeenCalledWith("token");

    first.unmount();
    renderPage("ru");
    expect(await screen.findByRole("heading", { name: "Роли" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Новая роль" })).toBeInTheDocument();
    expect(screen.queryByText("New role")).not.toBeInTheDocument();
  }, 15_000);

  it("renders localized empty and load-error states", async () => {
    api.getAdminRoles.mockResolvedValueOnce([]);
    const empty = renderPage("en");
    expect(await screen.findByText("No roles yet.")).toBeInTheDocument();
    empty.unmount();

    api.getAdminRoles.mockRejectedValueOnce(new Error("backend unavailable"));
    renderPage("ru");
    expect(await screen.findByText("Не удалось загрузить роли.")).toBeInTheDocument();
  });

  it("disables in-use/default protected controls and shows authoritative count", async () => {
    const inUse = createRole({ assistantCount: 2, inUse: true });
    const defaultRole = createRole({
      id: "00000000-0000-4000-8000-000000000147",
      key: "persai_default",
      name: { en: "Default", ru: "По умолчанию" },
      isDefault: true,
      skillIds: []
    });
    api.getAdminRoles.mockResolvedValue([inUse, defaultRole]);
    renderPage("en");

    fireEvent.click(await screen.findByRole("button", { name: /Analyst/ }));
    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(screen.getByText(/Used by 2 assistant/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Default/ }));
    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(screen.getByLabelText("Use Skill: Research")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("sends exact preview and renders exact server blocks", async () => {
    const role = createRole({ skillIds: [skillOne.id, skillTwo.id] });
    api.getAdminRoles.mockResolvedValue([role]);
    renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: /Analyst/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Preview locale" }), {
      target: { value: "ru" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() =>
      expect(api.previewAdminRole).toHaveBeenCalledWith("token", {
        locale: "ru",
        mission: { en: "Analyze carefully.", ru: "Анализируй внимательно." },
        skillIds: [skillOne.id, skillTwo.id]
      })
    );
    expect(await screen.findByText("<assistant_role>точно</assistant_role>")).toBeInTheDocument();
    expect(screen.getByText("<enabled_skills>точно</enabled_skills>")).toBeInTheDocument();
  });

  it("updates core then full-replaces ordered Skills", async () => {
    renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: /Analyst/ }));
    fireEvent.click(screen.getByLabelText("Use Skill: Writing"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateAdminRole).toHaveBeenCalledWith(
        "token",
        "00000000-0000-4000-8000-000000000201",
        {
          name: { en: "Analyst", ru: "Аналитик" },
          description: { en: "Analysis role", ru: "Роль аналитика" },
          mission: { en: "Analyze carefully.", ru: "Анализируй внимательно." },
          category: "work",
          iconEmoji: null,
          color: null,
          displayOrder: 10,
          status: "active"
        }
      )
    );
    expect(api.replaceAdminRoleSkills).toHaveBeenCalledWith(
      "token",
      "00000000-0000-4000-8000-000000000201",
      { skillIds: [skillOne.id, skillTwo.id] }
    );
  });

  it("refetches canonical state and reports localized partial save", async () => {
    const canonical = createRole({ name: { en: "Canonical", ru: "Каноническая" } });
    api.getAdminRoles.mockResolvedValueOnce([createRole()]).mockResolvedValueOnce([canonical]);
    api.replaceAdminRoleSkills.mockRejectedValueOnce(new Error("replace failed"));
    renderPage("ru");
    fireEvent.click(await screen.findByRole("button", { name: /Аналитик/ }));
    fireEvent.click(screen.getByLabelText("Использовать Skill: Тексты"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      await screen.findByText(
        "Данные роли сохранены, но Skills — нет. Загружено актуальное состояние."
      )
    ).toBeInTheDocument();
    expect(api.getAdminRoles).toHaveBeenCalledTimes(2);
    expect(screen.getByDisplayValue("Canonical")).toBeInTheDocument();
  });

  it("creates a Role with the exact immutable key and localized core payload", async () => {
    renderPage("en");
    await screen.findByText("Analyst");
    fireEvent.click(screen.getByRole("button", { name: "New role" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Key/ }), {
      target: { value: "ops_lead" }
    });
    fireEvent.change(screen.getByLabelText("Name (EN)"), { target: { value: "Ops Lead" } });
    fireEvent.change(screen.getByLabelText("Name (RU)"), { target: { value: "Руководитель" } });
    fireEvent.change(screen.getByLabelText("Description (EN)"), {
      target: { value: "Leads operations." }
    });
    fireEvent.change(screen.getByLabelText("Description (RU)"), {
      target: { value: "Руководит операциями." }
    });
    fireEvent.change(screen.getByLabelText("Mission (EN)"), {
      target: { value: "Keep operations reliable." }
    });
    fireEvent.change(screen.getByLabelText("Mission (RU)"), {
      target: { value: "Обеспечивай надёжность." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.createAdminRole).toHaveBeenCalledWith("token", {
        key: "ops_lead",
        name: { en: "Ops Lead", ru: "Руководитель" },
        description: { en: "Leads operations.", ru: "Руководит операциями." },
        mission: { en: "Keep operations reliable.", ru: "Обеспечивай надёжность." },
        category: "general",
        iconEmoji: null,
        color: null,
        displayOrder: 100,
        status: "draft"
      })
    );
  });
});
