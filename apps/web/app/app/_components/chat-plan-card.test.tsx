import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPlanCard } from "./chat-plan-card";
import type { RuntimeTodoItem } from "@persai/runtime-contract";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeTodo(overrides: Partial<RuntimeTodoItem> & { id: string }): RuntimeTodoItem {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? null,
    content: overrides.content ?? `Task ${overrides.id}`,
    status: overrides.status ?? "pending"
  };
}

const noop = async () => {};

function expand(container: HTMLElement): void {
  const btn = container.querySelector("button[aria-expanded]") as HTMLElement;
  fireEvent.click(btn);
}

function useMobileViewport(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  );
}

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
      status: "pending"
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
    expand(container);
    const body = container.querySelector("#chat-plan-body") as HTMLElement;
    const parent = within(body).getByText("Parent task");
    const child = within(body).getByText("Child task");
    expect(parent.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(child.closest("div.pl-5")).not.toBeNull();
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

  it("defaults to collapsed and shows in_progress task as a header preview", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done task" }),
      makeTodo({ id: "2", status: "in_progress", content: "Currently working" }),
      makeTodo({ id: "3", status: "pending", content: "Future task" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={3} windowed={false} onClear={noop} />
    );
    // collapsed body → in_progress label visible in header, other items NOT visible
    const toggleBtn = container.querySelector("button[aria-expanded]") as HTMLElement;
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
    expect(within(container).getByText("Currently working")).toBeInTheDocument();
    expect(within(container).queryByText("Done task")).toBeNull();
    expect(within(container).queryByText("Future task")).toBeNull();
  });

  it("falls back to the first pending task in the header preview when nothing is in_progress", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done task" }),
      makeTodo({ id: "2", status: "pending", content: "Next up" }),
      makeTodo({ id: "3", status: "pending", content: "After that" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={3} windowed={false} onClear={noop} />
    );
    expect(within(container).getByText("Next up")).toBeInTheDocument();
    expect(within(container).queryByText("After that")).toBeNull();
  });

  it("shows the All-done indicator in the header preview when every task is completed", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done 1" }),
      makeTodo({ id: "2", status: "completed", content: "Done 2" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={2} windowed={false} onClear={noop} />
    );
    expect(within(container).getByText("planAllDone")).toBeInTheDocument();
    // body stays collapsed → individual rows are not in the visible body
    expect(within(container).queryByText("Done 1")).toBeNull();
  });

  it("toggle expand/collapse flips aria-expanded and reveals the body rows", () => {
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done 1" }),
      makeTodo({ id: "2", status: "pending", content: "Pending row" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={2} windowed={false} onClear={noop} />
    );
    const toggleBtn = container.querySelector("button[aria-expanded]") as HTMLElement;
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggleBtn);
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
    const bodyRegion = container.querySelector("#chat-plan-body") as HTMLElement;
    expect(bodyRegion).not.toBeNull();
    expect(within(bodyRegion).getByText("Done 1")).toBeInTheDocument();
    expect(within(bodyRegion).getByText("Pending row")).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#chat-plan-body")).toBeNull();
  });

  it("uses circle → compact pill → expanded list progression on mobile", () => {
    useMobileViewport();
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done" }),
      makeTodo({ id: "2", content: "Next" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={7} windowed={true} onClear={noop} />
    );

    const circle = within(container).getByTestId("chat-plan-mobile-circle");
    expect(circle).toHaveTextContent("1/7");
    expect(circle).toHaveClass("h-11", "w-11");
    expect(container.firstChild).toHaveClass("ml-auto", "h-11", "w-11", "rounded-full");
    expect(container.querySelector("button[aria-expanded]")?.parentElement).toHaveClass(
      "hidden",
      "md:flex"
    );

    fireEvent.click(circle);
    const compactToggle = container.querySelector("button[aria-expanded]") as HTMLElement;
    expect(within(container).queryByTestId("chat-plan-mobile-circle")).toBeNull();
    expect(compactToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(compactToggle);
    expect(compactToggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector("#chat-plan-body")).not.toBeNull();
  });

  it("returns an open mobile plan to its progress circle after 10 seconds idle", () => {
    vi.useFakeTimers();
    useMobileViewport();
    const { container } = render(
      <ChatPlanCard
        todos={[makeTodo({ id: "1", content: "Next" })]}
        totalCount={7}
        windowed={true}
        onClear={noop}
      />
    );

    fireEvent.click(within(container).getByTestId("chat-plan-mobile-circle"));
    fireEvent.click(container.querySelector("button[aria-expanded]") as HTMLElement);
    act(() => vi.advanceTimersByTime(10_000));

    expect(within(container).getByTestId("chat-plan-mobile-circle")).toBeInTheDocument();
    expect(container.querySelector("#chat-plan-body")).toBeNull();
  });

  it("collapses a mobile plan to its circle when the user taps elsewhere", () => {
    useMobileViewport();
    const { container } = render(
      <ChatPlanCard
        todos={[makeTodo({ id: "1", content: "Next" })]}
        totalCount={1}
        windowed={false}
        onClear={noop}
      />
    );

    fireEvent.click(within(container).getByTestId("chat-plan-mobile-circle"));
    fireEvent.pointerDown(document.body);

    expect(within(container).getByTestId("chat-plan-mobile-circle")).toBeInTheDocument();
  });

  it("returns an expanded desktop plan to its compact pill after 10 seconds idle", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ChatPlanCard
        todos={[makeTodo({ id: "1", content: "Next" })]}
        totalCount={1}
        windowed={false}
        onClear={noop}
      />
    );
    const toggle = container.querySelector("button[aria-expanded]") as HTMLElement;

    fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(10_000));

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("#chat-plan-body")).toBeNull();
    expect(within(container).queryByTestId("chat-plan-mobile-circle")).toBeInTheDocument();
  });

  it("collapses an expanded desktop plan when the user clicks elsewhere", () => {
    const { container } = render(
      <ChatPlanCard
        todos={[makeTodo({ id: "1", content: "Next" })]}
        totalCount={1}
        windowed={false}
        onClear={noop}
      />
    );
    const toggle = container.querySelector("button[aria-expanded]") as HTMLElement;
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("clear button on an active plan shows inline confirmation; Cancel does not call onClear", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    const todos = [makeTodo({ id: "1", content: "Task 1" })];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={1} windowed={false} onClear={onClear} />
    );

    const clearBtn = within(container).getByRole("button", { name: "planClear" });
    fireEvent.click(clearBtn);

    expect(within(container).getByText("planClearConfirmPrompt")).toBeInTheDocument();

    fireEvent.click(within(container).getByText("planClearCancel"));
    expect(within(container).queryByText("planClearConfirmPrompt")).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("confirm clear on an active plan calls onClear", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    const todos = [makeTodo({ id: "1", content: "Task 1" })];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={1} windowed={false} onClear={onClear} />
    );

    fireEvent.click(within(container).getByRole("button", { name: "planClear" }));
    const confirmBtn = within(container).getByText("planClearConfirmAction");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  it("clear button on a fully completed plan deletes immediately without confirmation", async () => {
    // ADR-125 follow-up: when every row is done the plan is already "closed"
    // in the user's head — a confirm prompt would be obstructive noise.
    const onClear = vi.fn().mockResolvedValue(undefined);
    const todos = [
      makeTodo({ id: "1", status: "completed", content: "Done 1" }),
      makeTodo({ id: "2", status: "completed", content: "Done 2" })
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={2} windowed={false} onClear={onClear} />
    );

    const clearBtn = within(container).getByRole("button", { name: "planClear" });
    fireEvent.click(clearBtn);

    expect(within(container).queryByText("planClearConfirmPrompt")).toBeNull();
    await waitFor(() => {
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  it("skips rows with missing content defensively", () => {
    const badTodo: RuntimeTodoItem = {
      id: "1",
      parentId: null,
      content: "",
      status: "pending"
    };
    const goodTodo = makeTodo({ id: "2", content: "Good task" });
    const { container } = render(
      <ChatPlanCard todos={[badTodo, goodTodo]} totalCount={2} windowed={false} onClear={noop} />
    );
    expand(container);
    const body = container.querySelector("#chat-plan-body") as HTMLElement;
    expect(within(body).getByText("Good task")).toBeInTheDocument();
  });

  it("renders orphan child with ▸ prefix un-indented", () => {
    const orphan = makeTodo({ id: "2", parentId: "missing-parent", content: "Orphan task" });
    const { container } = render(
      <ChatPlanCard todos={[orphan]} totalCount={1} windowed={false} onClear={noop} />
    );
    expand(container);
    const body = container.querySelector("#chat-plan-body") as HTMLElement;
    const orphanRow = within(body).getByText("Orphan task").closest("div");
    expect(orphanRow?.classList.contains("pl-5")).toBe(false);
    expect(within(body).getByText("▸", { exact: false })).toBeInTheDocument();
  });

  it("orders completed tasks above active tasks in the scrollable full list", () => {
    const todos = [
      makeTodo({ id: "done-1", status: "completed", content: "Done A" }),
      makeTodo({ id: "done-2", status: "completed", content: "Done B" }),
      makeTodo({ id: "active-0", status: "in_progress", content: "Currently working" }),
      ...Array.from({ length: 9 }, (_, index) =>
        makeTodo({ id: `active-${String(index + 1)}`, content: `Pending ${String(index + 1)}` })
      )
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={todos.length} windowed={false} onClear={noop} />
    );
    expand(container);
    fireEvent.click(within(container).getByTestId("chat-plan-show-more"));
    const body = container.querySelector("#chat-plan-body") as HTMLElement;
    const doneA = within(body).getByText("Done A");
    const doneB = within(body).getByText("Done B");
    const current = within(body).getByText("Currently working");
    const next = within(body).getByText("Pending 1");
    expect(doneA.compareDocumentPosition(doneB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(doneB.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows every row with no More button when the plan has 7 or fewer tasks", () => {
    const todos = [
      makeTodo({ id: "done-1", status: "completed", content: "Done 1" }),
      makeTodo({ id: "done-2", status: "completed", content: "Done 2" }),
      makeTodo({ id: "done-3", status: "completed", content: "Done 3" }),
      ...Array.from({ length: 4 }, (_, index) =>
        makeTodo({ id: `active-${String(index + 1)}`, content: `Active ${String(index + 1)}` })
      )
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={todos.length} windowed={false} onClear={noop} />
    );
    expand(container);
    const body = container.querySelector("#chat-plan-body") as HTMLElement;
    expect(within(body).getByText("Done 1")).toBeInTheDocument();
    expect(within(body).getByText("Done 3")).toBeInTheDocument();
    expect(within(body).getByText("Active 4")).toBeInTheDocument();
    expect(within(container).queryByTestId("chat-plan-show-more")).toBeNull();
  });

  it("shows one completed tail plus all active rows when 3 done and 6 active exceed the cap", () => {
    const todos = [
      makeTodo({ id: "done-1", status: "completed", content: "Done 1" }),
      makeTodo({ id: "done-2", status: "completed", content: "Done 2" }),
      makeTodo({ id: "done-3", status: "completed", content: "Done 3" }),
      makeTodo({ id: "active-0", status: "in_progress", content: "Currently working" }),
      ...Array.from({ length: 5 }, (_, index) =>
        makeTodo({ id: `active-${String(index + 1)}`, content: `Pending ${String(index + 1)}` })
      )
    ];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={todos.length} windowed={false} onClear={noop} />
    );
    expand(container);
    const body = container.querySelector("#chat-plan-body") as HTMLElement;
    expect(within(body).queryByText("Done 1")).toBeNull();
    expect(within(body).queryByText("Done 2")).toBeNull();
    expect(within(body).getByText("Done 3")).toBeInTheDocument();
    expect(within(body).getByText("Currently working")).toBeInTheDocument();
    expect(within(body).getByText("Pending 5")).toBeInTheDocument();
    expect(within(container).getByTestId("chat-plan-show-more")).toBeInTheDocument();
    expect(body.className).toMatch(/overflow-hidden/);
  });

  it("shows a More button when more than 7 tasks are expanded", () => {
    const todos = Array.from({ length: 9 }, (_, index) =>
      makeTodo({ id: String(index + 1), content: `Task ${index + 1}`, status: "pending" })
    );
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={9} windowed={false} onClear={noop} />
    );
    expand(container);
    expect(within(container).getByTestId("chat-plan-show-more")).toBeInTheDocument();
    expect(within(container).queryByText("Task 7")).toBeInTheDocument();
    expect(within(container).queryByText("Task 8")).toBeNull();
    expect(within(container).queryByText("Task 9")).toBeNull();
  });

  it("reveals the full scrollable list after More is clicked without changing body height class", () => {
    const todos = Array.from({ length: 9 }, (_, index) =>
      makeTodo({ id: String(index + 1), content: `Task ${index + 1}`, status: "pending" })
    );
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={9} windowed={false} onClear={noop} />
    );
    expand(container);
    const body = container.querySelector("#chat-plan-body") as HTMLElement;
    expect(body.className).toMatch(/max-h-/);
    expect(body.className).toMatch(/overflow-hidden/);
    fireEvent.click(within(container).getByTestId("chat-plan-show-more"));
    expect(within(container).getByText("Task 8")).toBeInTheDocument();
    expect(within(container).getByText("Task 9")).toBeInTheDocument();
    expect(within(container).queryByTestId("chat-plan-show-more")).toBeNull();
    expect(body.className).toMatch(/overflow-y-auto/);
    expect(body.className).toMatch(/max-h-/);
  });

  it("keeps the expanded active list open after a benign todos rerender", () => {
    const todos = Array.from({ length: 9 }, (_, index) =>
      makeTodo({ id: String(index + 1), content: `Task ${index + 1}`, status: "pending" })
    );
    const { container, rerender } = render(
      <ChatPlanCard todos={todos} totalCount={9} windowed={false} onClear={noop} />
    );
    expand(container);
    fireEvent.click(within(container).getByTestId("chat-plan-show-more"));
    rerender(<ChatPlanCard todos={[...todos]} totalCount={9} windowed={false} onClear={noop} />);
    expect(within(container).getByText("Task 8")).toBeInTheDocument();
    expect(within(container).queryByTestId("chat-plan-show-more")).toBeNull();
  });

  it("uses the cursor-style in_progress icon instead of a spinner", () => {
    const todos = [makeTodo({ id: "1", status: "in_progress", content: "Working" })];
    const { container } = render(
      <ChatPlanCard todos={todos} totalCount={1} windowed={false} onClear={noop} />
    );
    expand(container);
    expect(container.querySelector('[aria-label="in_progress"]')).not.toBeNull();
    expect(container.querySelector(".lucide-loader-2")).toBeNull();
    expect(
      container.querySelector('[aria-label="in_progress"]')?.classList.contains("animate-spin")
    ).toBe(false);
  });
});
