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
});
