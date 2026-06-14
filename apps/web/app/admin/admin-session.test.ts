import { describe, expect, it, vi } from "vitest";
import { getAdminSessionToken } from "./admin-session";

describe("getAdminSessionToken", () => {
  it("prefers a fresh skipCache token", async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce("fresh-token")
      .mockResolvedValueOnce("cached-token");

    await expect(getAdminSessionToken(getToken)).resolves.toBe("fresh-token");
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("falls back to cached token when skipCache returns null", async () => {
    const getToken = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("cached-token");

    await expect(getAdminSessionToken(getToken)).resolves.toBe("cached-token");
    expect(getToken).toHaveBeenNthCalledWith(1, { skipCache: true });
    expect(getToken).toHaveBeenNthCalledWith(2);
  });
});
