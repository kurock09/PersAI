import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullToRefresh } from "./pull-to-refresh";

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

describe("PullToRefresh", () => {
  afterEach(() => {
    cleanup();
  });

  it("calls onRefresh when the user pulls past the trigger distance", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="content">Home</div>
      </PullToRefresh>
    );
    const container = screen.getByTestId("content").parentElement!.parentElement!;

    fireEvent.touchStart(container, { touches: [touch(0)] });
    fireEvent.touchMove(container, { touches: [touch(200)] });
    await act(async () => {
      fireEvent.touchEnd(container, { changedTouches: [touch(200)] });
    });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("does not trigger onRefresh when the pull is below the trigger distance", () => {
    const onRefresh = vi.fn();
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="content">Home</div>
      </PullToRefresh>
    );
    const container = screen.getByTestId("content").parentElement!.parentElement!;

    fireEvent.touchStart(container, { touches: [touch(0)] });
    fireEvent.touchMove(container, { touches: [touch(30)] });
    fireEvent.touchEnd(container, { changedTouches: [touch(30)] });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores the gesture when scrollTop is greater than zero (scrolled content)", () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="content" style={{ height: "9999px" }}>
          Home
        </div>
      </PullToRefresh>
    );
    const scroller = container.firstChild as HTMLDivElement;
    Object.defineProperty(scroller, "scrollTop", { value: 200, configurable: true });

    fireEvent.touchStart(scroller, { touches: [touch(0)] });
    fireEvent.touchMove(scroller, { touches: [touch(300)] });
    fireEvent.touchEnd(scroller, { changedTouches: [touch(300)] });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores a primarily horizontal swipe even if the finger drifts down", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="content">Home</div>
      </PullToRefresh>
    );
    const container = screen.getByTestId("content").parentElement!.parentElement!;

    fireEvent.touchStart(container, { touches: [touch(0, 0)] });
    // Once horizontal direction is locked at the start of the gesture, a
    // later vertical drift must not reactivate the refresh trigger.
    fireEvent.touchMove(container, { touches: [touch(0, 100)] });
    fireEvent.touchMove(container, { touches: [touch(200, 100)] });
    await act(async () => {
      fireEvent.touchEnd(container, { changedTouches: [touch(200, 100)] });
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("still triggers onRefresh on a primarily vertical pull with a small horizontal jitter", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="content">Home</div>
      </PullToRefresh>
    );
    const container = screen.getByTestId("content").parentElement!.parentElement!;

    fireEvent.touchStart(container, { touches: [touch(0, 0)] });
    // dy=200, dx=10 → vertical wins, refresh fires
    fireEvent.touchMove(container, { touches: [touch(200, 10)] });
    await act(async () => {
      fireEvent.touchEnd(container, { changedTouches: [touch(200, 10)] });
    });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("respects the disabled prop and does not trigger onRefresh", () => {
    const onRefresh = vi.fn();
    render(
      <PullToRefresh onRefresh={onRefresh} disabled>
        <div data-testid="content">Home</div>
      </PullToRefresh>
    );
    const container = screen.getByTestId("content").parentElement!.parentElement!;

    fireEvent.touchStart(container, { touches: [touch(0)] });
    fireEvent.touchMove(container, { touches: [touch(300)] });
    fireEvent.touchEnd(container, { changedTouches: [touch(300)] });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
