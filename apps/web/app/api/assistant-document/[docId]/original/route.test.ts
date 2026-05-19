import { afterEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock
}));

import { GET } from "./route";

const ORIGINAL_FETCH = global.fetch;

function request(path: string): Request {
  return new Request(`https://persai.dev${path}`);
}

function requestWithSessionHeader(path: string, token: string): Request {
  return new Request(`https://persai.dev${path}`, {
    headers: {
      "X-PersAI-Session-Token": token
    }
  });
}

function params(docId = "doc-1"): { params: Promise<unknown> } {
  return { params: Promise.resolve({ docId }) };
}

describe("assistant document original BFF route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
    authMock.mockReset();
  });

  it("returns a JSON 401 when the Clerk session has no server token", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue(null)
    });

    const response = await GET(
      request("/api/assistant-document/doc-1/original?versionId=version-1"),
      params()
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(global.fetch).toBe(ORIGINAL_FETCH);
  });

  it("streams an upstream 200 response with passthrough headers and a fresh Bearer", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("server-token")
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response("pptx-bytes", {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": "attachment; filename*=UTF-8''deck.pptx",
          "Content-Length": "10",
          ETag: '"pptx-etag"'
        }
      })
    ) as typeof fetch;

    const response = await GET(
      request("/api/assistant-document/doc-1/original?versionId=version-1"),
      params()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''deck.pptx"
    );
    expect(response.headers.get("ETag")).toBe('"pptx-etag"');
    expect(await response.text()).toBe("pptx-bytes");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(upstreamUrl)).toContain(
      "/api/v1/assistant/documents/doc-1/download-original?versionId=version-1"
    );
    expect((init as RequestInit | undefined)?.headers).toEqual({
      Authorization: "Bearer server-token"
    });
  });

  it("uses the same-origin session header when server cookie auth returns no token", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue(null)
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("pptx-bytes", { status: 200 })) as typeof fetch;

    const response = await GET(
      requestWithSessionHeader("/api/assistant-document/doc-1/original", "client-session-token"),
      params()
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect((init as RequestInit | undefined)?.headers).toEqual({
      Authorization: "Bearer client-session-token"
    });
  });

  it("prefers the fresh same-origin session header over a stale server cookie token", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("stale-server-token")
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("pptx-bytes", { status: 200 })) as typeof fetch;

    const response = await GET(
      requestWithSessionHeader("/api/assistant-document/doc-1/original", "fresh-client-token"),
      params()
    );

    expect(response.status).toBe(200);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect((init as RequestInit | undefined)?.headers).toEqual({
      Authorization: "Bearer fresh-client-token"
    });
  });

  it("maps an upstream 410 to the quiet standalone gone page for non-JS navigations", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("server-token")
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { message: "Original PPTX is no longer available. The PDF preview is still available." },
          { status: 410 }
        )
      ) as typeof fetch;

    const response = await GET(request("/api/assistant-document/doc-1/original"), params());
    const html = await response.text();

    expect(response.status).toBe(410);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(html).toContain("Original PPTX expired");
    expect(html).toContain(
      "Original PPTX is no longer available. The PDF preview is still available."
    );
  });

  it("maps an upstream 500 to the quiet standalone failed page for non-JS navigations", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("server-token")
    });
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: "Gamma export is temporarily unavailable." }, { status: 500 })
      ) as typeof fetch;

    const response = await GET(request("/api/assistant-document/doc-1/original"), params());
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(html).toContain("PPTX download unavailable");
    expect(html).toContain("Gamma export is temporarily unavailable.");
  });
});
