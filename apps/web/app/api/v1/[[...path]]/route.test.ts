import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock
}));

import { GET } from "./route";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_PROXY_TARGET = process.env.PERSAI_WEB_API_PROXY_TARGET;

describe("api v1 proxy route", () => {
  beforeEach(() => {
    process.env.PERSAI_WEB_API_PROXY_TARGET = "http://api:3001";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
    process.env.PERSAI_WEB_API_PROXY_TARGET = ORIGINAL_PROXY_TARGET;
  });

  it("injects a fresh Clerk bearer when Authorization is missing", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("session-token")
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    const response = await GET(new NextRequest("https://persai.dev/api/v1/me"), {
      params: Promise.resolve({ path: ["me"] })
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api:3001/api/v1/me",
      expect.objectContaining({
        method: "GET",
        redirect: "manual"
      })
    );
    const fetchHeaders = (vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit | undefined)
      ?.headers as Headers | undefined;
    expect(fetchHeaders?.get("Authorization")).toBe("Bearer session-token");
  });

  it("prefers a fresh Clerk bearer over an incoming Authorization header", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("session-token")
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("https://persai.dev/api/v1/me", {
        headers: { Authorization: "Bearer explicit-token" }
      }),
      {
        params: Promise.resolve({ path: ["me"] })
      }
    );

    expect(response.status).toBe(200);
    const fetchHeaders = (vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit | undefined)
      ?.headers as Headers | undefined;
    expect(fetchHeaders?.get("Authorization")).toBe("Bearer session-token");
  });

  it("keeps the incoming Authorization header when Clerk does not return a session token", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue(null)
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("https://persai.dev/api/v1/me", {
        headers: { Authorization: "Bearer explicit-token" }
      }),
      {
        params: Promise.resolve({ path: ["me"] })
      }
    );

    expect(response.status).toBe(200);
    const fetchHeaders = (vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit | undefined)
      ?.headers as Headers | undefined;
    expect(fetchHeaders?.get("Authorization")).toBe("Bearer explicit-token");
  });
});
