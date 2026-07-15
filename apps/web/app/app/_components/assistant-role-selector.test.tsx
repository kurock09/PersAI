import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import ruMessages from "../../../messages/ru.json";
import type { AssistantRoleState } from "../assistant-api-client";
import {
  AssistantRoleCard,
  AssistantRoleSelector,
  resolveRoleCategoryLabel
} from "./assistant-role-selector";

const roles: AssistantRoleState[] = [
  {
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
  },
  {
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
  }
];

function renderLocalized(locale: "en" | "ru", node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ru" ? ruMessages : enMessages}>
      {node}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

describe("AssistantRoleSelector", () => {
  it("renders a catalog with description and skills, never the mission prompt", () => {
    const { unmount } = renderLocalized(
      "en",
      <AssistantRoleSelector roles={roles} selectedRoleKey="engineer" onSelect={() => undefined} />
    );
    expect(screen.getByTestId("assistant-role-catalog")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Engineer/ })).toBeInTheDocument();
    expect(screen.getByText("Builds reliable systems.")).toBeInTheDocument();
    expect(screen.getByText("Connected skills")).toBeInTheDocument();
    expect(screen.getByText("No skills are linked to this role.")).toBeInTheDocument();
    expect(screen.queryByText("Turn requirements into working software.")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan and follow through.")).not.toBeInTheDocument();
    unmount();

    renderLocalized(
      "ru",
      <AssistantRoleSelector roles={roles} selectedRoleKey="engineer" onSelect={() => undefined} />
    );
    expect(screen.getByRole("option", { name: /Инженер/ })).toBeInTheDocument();
    expect(screen.getByText("Создаёт надёжные системы.")).toBeInTheDocument();
    expect(screen.getByText("Подключённые Skills")).toBeInTheDocument();
    expect(
      screen.queryByText("Превращает требования в работающий продукт.")
    ).not.toBeInTheDocument();
  });

  it("shows connected skills for the selected role without mission copy", () => {
    renderLocalized(
      "en",
      <AssistantRoleSelector
        roles={roles}
        selectedRoleKey="persai_default"
        onSelect={() => undefined}
      />
    );
    expect(screen.getByText("Keeps daily work clear.")).toBeInTheDocument();
    expect(screen.getByText("Daily planner")).toBeInTheDocument();
    expect(screen.queryByText("Plan and follow through.")).not.toBeInTheDocument();
  });

  it("covers loading, empty, error, and retry states", () => {
    const retry = vi.fn();
    const { rerender } = renderLocalized(
      "en",
      <AssistantRoleSelector
        roles={null}
        selectedRoleKey={null}
        onSelect={() => undefined}
        loading
      />
    );
    expect(screen.getByText("Loading roles...")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantRoleSelector roles={[]} selectedRoleKey={null} onSelect={() => undefined} />
      </NextIntlClientProvider>
    );
    expect(screen.getByText("No roles are available yet")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantRoleSelector
          roles={null}
          selectedRoleKey={null}
          onSelect={() => undefined}
          error="Could not load roles."
          onRetry={retry}
        />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses listbox option semantics and one meaningful current state", () => {
    const onSelect = vi.fn();
    renderLocalized(
      "en",
      <AssistantRoleSelector
        roles={roles}
        selectedRoleKey="persai_default"
        currentRoleKey="persai_default"
        onSelect={onSelect}
      />
    );

    const engineer = screen.getByRole("option", { name: /Engineer/ });
    fireEvent.click(engineer);
    expect(onSelect).toHaveBeenCalledWith("engineer");
    expect(engineer).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByText("Current")).toHaveLength(1);
  });

  it("shows current badge on a standalone card without mission prompt", () => {
    renderLocalized("en", <AssistantRoleCard role={roles[0]!} selected={false} current />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.queryByText("Selected")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan and follow through.")).not.toBeInTheDocument();
    expect(screen.getByText("Keeps daily work clear.")).toBeInTheDocument();
  });

  it("resolves category labels from localized messages without a hardcoded dictionary", () => {
    expect(
      resolveRoleCategoryLabel(
        "engineering",
        enMessages.assistantRole.categories as Record<string, string>
      )
    ).toBe("Engineering");
    expect(
      resolveRoleCategoryLabel(
        "custom",
        enMessages.assistantRole.categories as Record<string, string>
      )
    ).toBe("custom");
    expect(
      resolveRoleCategoryLabel(
        "engineering",
        ruMessages.assistantRole.categories as Record<string, string>
      )
    ).toBe("Инженерия");
  });

  it("uses localized role-name initials when iconEmoji is null", () => {
    renderLocalized("en", <AssistantRoleCard role={roles[1]!} selected={false} />);
    expect(screen.getByText("E")).toBeInTheDocument();
    expect(screen.queryByLabelText(/user cog/i)).not.toBeInTheDocument();
  });
});
