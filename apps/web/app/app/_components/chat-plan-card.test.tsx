import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPlanCard } from "./chat-plan-card";
import type { RuntimeTodoItem } from "@persai/runtime-contract";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key
}));

afterEach(cleanup);

function makeTodo(overrides: Partial<RuntimeTodoItem> & { id: string }): RuntimeTodoItem {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? null,
    content: overrides.content ?? `Task ${overrides.id}`,
    status: overrides.status ?? "pending",
    origin: overrides.origin ?? "model_authored",
    seedSkillLabel: overrides.seedSkillLabel ?? null
  };
}

const noop = async () => {};

describe("ChatPlanCard", () => {
  it("renders nothing when todos is empty", () => {
    const { container } = render(
      <ChatPlanCard todos={[]} totalCount={0} windowed={false} onClear={noop} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when all todos have missing content", () => {
    const badTodo: RuntimeTodoItem = {
      id: "1",
      parentId: null,
      content: "",
      status: "pending",
      origin: "model_authored",
      seedSkillLabel: null
    };
    const { container } = render(
      <ChatPlanCard todos={[badTodo]} totalCount={1} windowed={false} onClear={noop} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders parent then child indented below it, in input order", () => {
    const todos = [
      makeTodo({ id: "1", content: "Parent task" }),
      makeTodo({ id: "2", parentId: "1", content: "Child task" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={2} windowed={false} onClear={noop} />
    );
    const parent = within(container).getByText("Parent task");
    const child = within(container).getByText("Child task");
    // parent appears before child in DOM
    expect(parent.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // child has indentation class
    expect(child.closest("div.pl-5")).not.toBeNull();
  });

  it("shows scenario_seeded badge with seedSkillLabel", () => {
    const todos = [
      makeTodo({
        id: "1",
        origin: "scenario_seeded",
        seedSkillLabel: "Marketer",
        content: "Seeded task"
      })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={1} windowed={false} onClear={noop} />
    );
    expect(within(container).getByText(/planSeededFrom/)).toBeInTheDocument();
    expect(within(container).getByText(/planSeededFrom/).textContent).toMatch("Marketer");
  });

  it("shows generic fallback when seedSkillLabel is null", () => {
    const todos = [
      makeTodo({ id: "1", origin: "scenario_seeded", seedSkillLabel: null, content: "Seeded task" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={1} windowed={false} onClear={noop} />
    );
    expect(within(container).getByText("planSeededFromGeneric")).toBeInTheDocument();
  });

  it("counts header shows done/total via planCounts key", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done task" }),
      makeTodo({ id: "2", status: "pending", content: "Pending task" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={5} windowed={false} onClear={noop} />
    );
    // planCounts rendered in header with done=1, total=5
    const countsEl = within(container).getAllByText(/planCounts/)[0];
    expect(countsEl).toBeInTheDocument();
    expect(countsEl?.textContent).toMatch(/"done":1/);
    expect(countsEl?.textContent).toMatch(/"total":5/);
  });

  it("shows +N more hint when windowed and totalCount > todos.length", () => {
    const todos = [
      makeTodo({ id: "1", content: "Task 1" }),
      makeTodo({ id: "2", content: "Task 2" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={5} windowed={true} onClear={noop} />
    );
    expect(within(container).getAllByText(/planMoreHidden/).length).toBeGreaterThan(0);
  });

  it("does NOT show +N more when not windowed", () => {
    const todos = [makeTodo({ id: "1", content: "Task 1" })];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={3} windowed={false} onClear={noop} />
    );
    expect(within(container).queryByText(/planMoreHidden/)).toBeNull();
  });

  it("defaults to expanded when at least one todo is non-completed", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done" }),
      makeTodo({ id: "2", status: "pending", content: "Pending" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={2} windowed={false} onClear={noop} />
    );
    expect(within(container).getByText("Done")).toBeInTheDocument();
    expect(within(container).getByText("Pending")).toBeInTheDocument();
  });

  it("defaults to collapsed when all todos are completed AND doneCount === totalCount", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done 1" }),
      makeTodo({ id: "2", status: "completed", content: "Done 2" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={2} windowed={false} onClear={noop} />
    );
    expect(within(container).queryByText("Done 1")).toBeNull();
    expect(within(container).queryByText("Done 2")).toBeNull();
  });

  it("toggle expand/collapse works", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done 1" }),
      makeTodo({ id: "2", status: "completed", content: "Done 2" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={2} windowed={false} onClear={noop} />
    );
    // Initially collapsed (all completed, totalCount===doneCount)
    expect(within(container).queryByText("Done 1")).toBeNull();

    // The header button is the one with aria-expanded attribute
    const toggleBtn = container.querySelector("button[aria-expanded]") as HTMLElement;
    expect(toggleBtn).not.toBeNull();
    fireEvent.click(toggleBtn);
    expect(within(container).getByText("Done 1")).toBeInTheDocument();

    // Collapse again
    fireEvent.click(toggleBtn);
    expect(within(container).queryByText("Done 1")).toBeNull();
  });

  it("clear button shows confirmation row; Cancel does not call onClear", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    const todos = [makeTodo({ id: "1", content: "Task 1" })];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={1} windowed={false} onClear={onClear} />
    );

    // Click the clear (trash) button - has aria-label="planClear"
    const clearBtn = within(container).getByRole("button", { name: "planClear" });
    fireEvent.click(clearBtn);

    // Confirmation row appears
    expect(within(container).getByText("planClearConfirmPrompt")).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(within(container).getByText("planClearCancel"));
    expect(within(container).queryByText("planClearConfirmPrompt")).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("confirm clear calls onClear", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    const todos = [makeTodo({ id: "1", content: "Task 1" })];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={1} windowed={false} onClear={onClear} />
    );

    fireEvent.click(within(container).getByRole("button", { name: "planClear" }));
    // Now click confirm
    const confirmBtn = within(container).getByText("planClearConfirmAction");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  it("skips rows with missing content defensively", () => {
    const badTodo: RuntimeTodoItem = {
      id: "1",
      parentId: null,
      content: "",
      status: "pending",
      origin: "model_authored",
      seedSkillLabel: null
    };
    const goodTodo = makeTodo({ id: "2", content: "Good task" });
    const { container } = render(
      <ChatPlanCard todos={[badTodo, goodTodo]} totalCount={2} windowed={false} onClear={noop} />
    );
    expect(within(container).getByText("Good task")).toBeInTheDocument();
  });

  it("renders orphan child with ▸ prefix un-indented", () => {
    const orphan = makeTodo({ id: "2", parentId: "missing-parent", content: "Orphan task" });
    const { container } = render(
      <ChatPlanCard todos={[orphan]} totalCount={1} windowed={false} onClear={noop} />
    );
    const orphanRow = within(container).getByText("Orphan task").closest("div");
    // Should NOT have indentation
    expect(orphanRow?.classList.contains("pl-5")).toBe(false);
    // Should have ▸ marker nearby
    expect(within(container).getByText("▸", { exact: false })).toBeInTheDocument();
  });
});
