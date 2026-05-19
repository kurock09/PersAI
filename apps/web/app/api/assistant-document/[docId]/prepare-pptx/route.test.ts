import { afterEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock
}));

import { POST } from "./route";

const ORIGINAL_FETCH = global.fetch;

function request(path: string): Request {
  return new Request(`https://persai.dev${path}`, { method: "POST" });
}

function requestWithSessionHeader(path: string, token: string): Request {
  return new Request(`https://persai.dev${path}`, {
    method: "POST",
    headers: {
      "X-PersAI-Session-Token": token
    }
  });
}

function params(docId = "doc-1"): { params: Promise<unknown> } {
  return { params: Promise.resolve({ docId }) };
}

describe("assistant document PPTX prepare BFF route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
    authMock.mockReset();
  });

  it("returns a JSON 401 when no Clerk token is available", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue(null)
    });

    const response = await POST(
      request("/api/assistant-document/doc-1/prepare-pptx?versionId=version-1"),
      params()
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(global.fetch).toBe(ORIGINAL_FETCH);
  });

  it("forwards the prepare request with Bearer auth and versionId body", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("server-token")
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "queued", renderJobId: "job-1" })) as typeof fetch;

    const response = await POST(
      request("/api/assistant-document/doc-1/prepare-pptx?versionId=version-1"),
      params()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "queued", renderJobId: "job-1" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(upstreamUrl)).toContain("/api/v1/assistant/documents/doc-1/prepare-pptx");
    expect((init as RequestInit | undefined)?.method).toBe("POST");
    expect((init as RequestInit | undefined)?.headers).toEqual({
      Authorization: "Bearer server-token",
      "Content-Type": "application/json",
      Accept: "application/json"
    });
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual({
      versionId: "version-1"
    });
  });

  it("prefers the fresh same-origin session token over the server cookie token", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("stale-server-token")
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "already_running" })) as typeof fetch;

    const response = await POST(
      requestWithSessionHeader("/api/assistant-document/doc-1/prepare-pptx", "fresh-client-token"),
      params()
    );

    expect(response.status).toBe(200);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect((init as RequestInit | undefined)?.headers).toEqual({
      Authorization: "Bearer fresh-client-token",
      "Content-Type": "application/json",
      Accept: "application/json"
    });
  });

  it("passes through upstream rejection JSON and status", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("server-token")
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: "rejected", code: "monthly_tool_quota_exceeded" }, { status: 409 })
      ) as typeof fetch;

    const response = await POST(request("/api/assistant-document/doc-1/prepare-pptx"), params());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "rejected",
      code: "monthly_tool_quota_exceeded"
    });
  });
});
