import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlideOver } from "./slide-over";

function touch(clientY: number, clientX = 0): Touch {
  return {
    identifier: 0,
    target: document.body,
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    screenX: clientX,
    screenY: clientY,
    radiusX: 0,
    radiusY: 0,
    rotationAngle: 0,
    force: 1
  } as Touch;
}

describe("SlideOver", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not wrap its body in pull-to-refresh when onPullToRefresh is not provided", () => {
    const { container } = render(
      <SlideOver open onClose={() => undefined} title="Title">
        <div data-testid="body">body</div>
      </SlideOver>
    );

    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(container).not.toContainElement(screen.getByTestId("body"));
    expect(document.querySelector("[data-pull-state]")).toBeNull();
  });

  it("wraps its body in pull-to-refresh when onPullToRefresh is provided", () => {
    const onPullToRefresh = vi.fn();
    render(
      <SlideOver open onClose={() => undefined} title="Title" onPullToRefresh={onPullToRefresh}>
        <div data-testid="body">body</div>
      </SlideOver>
    );

    expect(document.querySelector("[data-pull-state]")).not.toBeNull();
  });

  it("invokes onPullToRefresh when the body is pulled past the trigger distance", async () => {
    const onPullToRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <SlideOver open onClose={() => undefined} title="Title" onPullToRefresh={onPullToRefresh}>
        <div data-testid="body">body</div>
      </SlideOver>
    );

    const ptrContainer = document.querySelector("[data-pull-state]") as HTMLDivElement;
    expect(ptrContainer).not.toBeNull();

    fireEvent.touchStart(ptrContainer, { touches: [touch(0, 0)] });
    fireEvent.touchMove(ptrContainer, { touches: [touch(200, 0)] });
    await act(async () => {
      fireEvent.touchEnd(ptrContainer, { changedTouches: [touch(200, 0)] });
    });

    await waitFor(() => {
      expect(onPullToRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the title bar outside the pull-to-refresh scroll container so it does not translate with the gesture", () => {
    render(
      <SlideOver open onClose={() => undefined} title="Header" onPullToRefresh={vi.fn()}>
        <div data-testid="body">body</div>
      </SlideOver>
    );

    const header = screen.getByRole("heading", { name: "Header" });
    const ptrContainer = document.querySelector("[data-pull-state]") as HTMLElement;
    expect(ptrContainer.contains(header)).toBe(false);
  });

  it("renders an optional footer outside the pull-to-refresh scroll container", () => {
    render(
      <SlideOver
        open
        onClose={() => undefined}
        title="Header"
        onPullToRefresh={vi.fn()}
        footer={<div data-testid="footer">footer</div>}
      >
        <div data-testid="body">body</div>
      </SlideOver>
    );

    const ptrContainer = document.querySelector("[data-pull-state]") as HTMLElement;
    const footer = screen.getByTestId("footer");
    expect(ptrContainer.contains(footer)).toBe(false);
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  it("uses left-sidebar chrome on desktop and exposes a 500–800 resize handle", () => {
    render(
      <SlideOver open onClose={() => undefined} title="Settings" size="narrow">
        <div>body</div>
      </SlideOver>
    );

    const panel = screen.getByTestId("slide-over-panel");
    expect(panel).toHaveClass("md:rounded-[1.375rem]");
    expect(panel).toHaveClass("md:inset-y-4");
    expect(panel).toHaveClass("md:right-4");
    expect(panel).toHaveAttribute("data-slide-over-width", "600");

    const handle = screen.getByTestId("slide-over-resize-handle");
    expect(handle).toHaveAttribute("aria-valuemin", "500");
    expect(handle).toHaveAttribute("aria-valuemax", "800");
    expect(handle).toHaveClass("-translate-x-1/2");
    expect(handle).toHaveClass("opacity-35");

    fireEvent.pointerDown(handle, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(panel).toHaveAttribute("data-slide-over-width", "800");
  });
});
