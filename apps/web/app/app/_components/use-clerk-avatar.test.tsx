"use client";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerkMocks = vi.hoisted(() => ({
  useUser: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => clerkMocks.useUser()
}));

import { useClerkAvatar } from "./use-clerk-avatar";

const FIXED_TODAY = "2026-04-25";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${FIXED_TODAY}T10:00:00.000Z`));
  window.sessionStorage.clear();
  clerkMocks.useUser.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useClerkAvatar", () => {
  it("returns null when there is no user", () => {
    clerkMocks.useUser.mockReturnValue({ user: null });

    const { result } = renderHook(() => useClerkAvatar());

    expect(result.current.imageSrc).toBeNull();
    expect(result.current.broken).toBe(false);
  });

  it("appends a day-bucketed cache buster to Clerk imageUrl", () => {
    const updatedAt = new Date("2026-04-20T08:00:00.000Z");
    clerkMocks.useUser.mockReturnValue({
      user: {
        imageUrl: "https://img.clerk.com/abc",
        updatedAt,
        reload: vi.fn().mockResolvedValue(undefined)
      }
    });

    const { result } = renderHook(() => useClerkAvatar());

    expect(result.current.imageSrc).toBe(
      `https://img.clerk.com/abc?v=${updatedAt.getTime()}-${FIXED_TODAY}-0`
    );
    expect(result.current.broken).toBe(false);
  });

  it("preserves existing query string with `&` separator", () => {
    clerkMocks.useUser.mockReturnValue({
      user: {
        imageUrl: "https://img.clerk.com/abc?width=256",
        updatedAt: new Date("2026-04-20T08:00:00.000Z"),
        reload: vi.fn().mockResolvedValue(undefined)
      }
    });

    const { result } = renderHook(() => useClerkAvatar());

    expect(result.current.imageSrc).toContain("width=256&v=");
  });

  it("retries once on the first error before falling back to initials", () => {
    const updatedAt = new Date("2026-04-20T08:00:00.000Z");
    clerkMocks.useUser.mockReturnValue({
      user: {
        imageUrl: "https://img.clerk.com/abc",
        updatedAt,
        reload: vi.fn().mockResolvedValue(undefined)
      }
    });

    const { result } = renderHook(() => useClerkAvatar());

    const firstUrl = result.current.imageSrc;
    expect(firstUrl).toContain(`-${FIXED_TODAY}-0`);

    act(() => {
      result.current.onError();
    });

    expect(result.current.broken).toBe(false);
    expect(result.current.imageSrc).toContain(`-${FIXED_TODAY}-1`);
    expect(result.current.imageSrc).not.toBe(firstUrl);

    act(() => {
      result.current.onError();
    });

    expect(result.current.broken).toBe(true);
    expect(result.current.imageSrc).toBeNull();
  });

  it("calls user.reload exactly once per browser session", () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    clerkMocks.useUser.mockReturnValue({
      user: {
        imageUrl: "https://img.clerk.com/abc",
        updatedAt: new Date(),
        reload
      }
    });

    const { unmount } = renderHook(() => useClerkAvatar());
    expect(reload).toHaveBeenCalledTimes(1);

    unmount();

    renderHook(() => useClerkAvatar());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not crash when user.reload returns undefined (vi.fn default)", () => {
    clerkMocks.useUser.mockReturnValue({
      user: {
        imageUrl: "https://img.clerk.com/abc",
        updatedAt: new Date(),
        reload: vi.fn()
      }
    });

    expect(() => renderHook(() => useClerkAvatar())).not.toThrow();
  });
});
