import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const ORIGINAL_FETCH = global.fetch;

describe("clerk proxy route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
  });

  it("pins major-only Clerk JS requests to a concrete version", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("console.log('clerk');", {
        status: 200,
        headers: {
          "content-encoding": "gzip",
          "content-type": "application/javascript; charset=utf-8"
        }
      })
    ) as typeof fetch;

    const response = await GET(
      new Request("https://persai.dev/clerk-proxy/npm/@clerk/clerk-js@6/dist/clerk.browser.js")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6.22.0/dist/clerk.browser.js",
      expect.objectContaining({
        method: "GET",
        redirect: "follow"
      })
    );
  });
});
