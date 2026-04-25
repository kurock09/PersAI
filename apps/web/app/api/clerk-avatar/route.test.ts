import { afterEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock
}));

import { GET } from "./route";

const ORIGINAL_FETCH = global.fetch;

describe("clerk avatar route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
    authMock.mockReset();
    currentUserMock.mockReset();
  });

  it("requires an authenticated Clerk session", async () => {
    authMock.mockResolvedValue({ userId: null });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(currentUserMock).not.toHaveBeenCalled();
  });

  it("streams the current user's Clerk image through same-origin web", async () => {
    authMock.mockResolvedValue({ userId: "user-1" });
    currentUserMock.mockResolvedValue({ imageUrl: "https://img.clerk.com/user-1" });
    global.fetch = vi.fn().mockResolvedValue(
      new Response("image-bytes", {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    ) as typeof fetch;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(await response.text()).toBe("image-bytes");
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("https://img.clerk.com/user-1"),
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "image/*" }
      })
    );
  });

  it("does not proxy non-image responses", async () => {
    authMock.mockResolvedValue({ userId: "user-1" });
    currentUserMock.mockResolvedValue({ imageUrl: "https://img.clerk.com/user-1" });
    global.fetch = vi.fn().mockResolvedValue(
      new Response("not-image", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      })
    ) as typeof fetch;

    const response = await GET();

    expect(response.status).toBe(502);
  });
});
