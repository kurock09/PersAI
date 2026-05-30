import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoComposer, DemoModeChip, DemoSidebar, DemoWindow } from "./demo-window";

vi.mock("@/app/app/_components/assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

afterEach(() => {
  cleanup();
});

const defaultProps = {
  assistantName: "Aurora",
  headerTitle: "Strategy Chat",
  chats: [{ id: "c1", title: "Q3 Plan", active: true }],
  composerPlaceholder: "Type here…"
};

const modeLabelsMock = {
  normal: "Normal",
  smart: "Smart",
  project: "Project",
  normalCaption: "faster",
  smartCaption: "deeper",
  projectCaption: "analysis"
};

describe("DemoWindow", () => {
  it("renders thread children", () => {
    render(<DemoWindow {...defaultProps}>Thread content here</DemoWindow>);
    expect(screen.getByText("Thread content here")).toBeInTheDocument();
  });

  it("renders headerTitle", () => {
    render(<DemoWindow {...defaultProps}>children</DemoWindow>);
    expect(screen.getByText("Strategy Chat")).toBeInTheDocument();
  });

  it("renders assistantName in the sidebar", () => {
    render(<DemoWindow {...defaultProps}>children</DemoWindow>);
    expect(screen.getByText("Aurora")).toBeInTheDocument();
  });

  it("renders a provided chat row title", () => {
    render(<DemoWindow {...defaultProps}>children</DemoWindow>);
    expect(screen.getByText("Q3 Plan")).toBeInTheDocument();
  });

  it("renders the composer placeholder text", () => {
    render(<DemoWindow {...defaultProps}>children</DemoWindow>);
    expect(screen.getByText("Type here…")).toBeInTheDocument();
  });

  it("renders interactive DemoModeChip when chatMode + onModeChange + modeLabels provided", () => {
    const onChange = vi.fn();
    render(
      <DemoWindow
        {...defaultProps}
        chatMode="normal"
        onModeChange={onChange}
        modeLabels={modeLabelsMock}
      >
        content
      </DemoWindow>
    );
    // The chip shows the current mode label
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("falls back to static headerModeLabel pill when chatMode props are absent", () => {
    render(
      <DemoWindow {...defaultProps} headerModeLabel="Normal">
        content
      </DemoWindow>
    );
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("omits header row when headerTitle is not provided", () => {
    const { container } = render(<DemoWindow assistantName="Aurora">no header</DemoWindow>);
    const headerBorderDiv = container.querySelector(".border-b.border-border.px-4.py-3");
    expect(headerBorderDiv).toBeNull();
  });

  it("renders a custom composer slot when provided", () => {
    render(
      <DemoWindow {...defaultProps} composer={<div>Custom Composer</div>}>
        content
      </DemoWindow>
    );
    expect(screen.getByText("Custom Composer")).toBeInTheDocument();
  });

  it("renders userName and userPlanLabel in the sidebar user card", () => {
    render(
      <DemoWindow {...defaultProps} userName="Alex" userPlanLabel="Pro plan">
        content
      </DemoWindow>
    );
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Pro plan")).toBeInTheDocument();
  });

  it("renders sidebar rows as buttons when onChatSelect is provided", () => {
    const onSelect = vi.fn();
    render(
      <DemoWindow
        {...defaultProps}
        chats={[{ id: "c1", title: "Q3 Plan", active: true }]}
        onChatSelect={onSelect}
      >
        content
      </DemoWindow>
    );
    const btn = screen.getByRole("button", { name: "Q3 Plan" });
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("c1");
  });
});

describe("DemoSidebar", () => {
  it("renders assistant name", () => {
    render(<DemoSidebar assistantName="Aurora" />);
    expect(screen.getByText("Aurora")).toBeInTheDocument();
  });

  it("renders default status label", () => {
    render(<DemoSidebar assistantName="Aurora" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders a custom status label", () => {
    render(<DemoSidebar assistantName="Aurora" assistantStatusLabel="Live" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders chat rows", () => {
    render(
      <DemoSidebar
        assistantName="Aurora"
        chats={[
          { id: "c1", title: "Work session", active: true },
          { id: "c2", title: "Personal notes", time: "14:30" }
        ]}
      />
    );
    expect(screen.getByText("Work session")).toBeInTheDocument();
    expect(screen.getByText("Personal notes")).toBeInTheDocument();
    expect(screen.getByText("14:30")).toBeInTheDocument();
  });

  it("renders the Today group label when chats are provided", () => {
    render(<DemoSidebar assistantName="Aurora" chats={[{ id: "c1", title: "My chat" }]} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("renders rows as buttons and calls onChatSelect when clicked", () => {
    const onSelect = vi.fn();
    render(
      <DemoSidebar
        assistantName="Aurora"
        chats={[
          { id: "c1", title: "Work session", active: true },
          { id: "c2", title: "Personal notes" }
        ]}
        onChatSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Personal notes" }));
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("renders rows as divs (not buttons) when onChatSelect is not provided", () => {
    const { container } = render(
      <DemoSidebar
        assistantName="Aurora"
        chats={[{ id: "c1", title: "Work session", active: true }]}
      />
    );
    // No button for the chat row when no select handler
    const buttons = container.querySelectorAll("button");
    const chatRowBtn = Array.from(buttons).find((b) => b.textContent?.includes("Work session"));
    expect(chatRowBtn).toBeUndefined();
  });
});

describe("DemoComposer", () => {
  it("renders placeholder text", () => {
    render(<DemoComposer placeholder="Write something…" />);
    expect(screen.getByText("Write something…")).toBeInTheDocument();
  });

  it("renders a custom rightSlot when provided", () => {
    render(
      <DemoComposer placeholder="Type here" rightSlot={<button type="button">Send</button>} />
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});

describe("DemoModeChip", () => {
  it("renders the current mode label", () => {
    render(<DemoModeChip mode="normal" onChange={vi.fn()} labels={modeLabelsMock} />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("opens menu on click and shows all three modes", () => {
    render(<DemoModeChip mode="normal" onChange={vi.fn()} labels={modeLabelsMock} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menuitem", { name: /Normal/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Smart/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Project/ })).toBeInTheDocument();
  });

  it("calls onChange with the selected mode and closes the menu", () => {
    const onChange = vi.fn();
    render(<DemoModeChip mode="normal" onChange={onChange} labels={modeLabelsMock} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Smart/ }));
    expect(onChange).toHaveBeenCalledWith("smart");
    // Menu closed
    expect(screen.queryByRole("menuitem", { name: /Smart/ })).toBeNull();
  });

  it("marks the current mode as aria-current", () => {
    render(<DemoModeChip mode="smart" onChange={vi.fn()} labels={modeLabelsMock} />);
    fireEvent.click(screen.getByRole("button"));
    const smartItem = screen.getByRole("menuitem", { name: /Smart/ });
    expect(smartItem).toHaveAttribute("aria-current", "true");
  });
});
