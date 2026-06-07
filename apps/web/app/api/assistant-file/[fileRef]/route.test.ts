import { afterEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock
}));

import { GET } from "./route";

const ORIGINAL_FETCH = global.fetch;

function request(path: string, headers?: HeadersInit): Request {
  const init: RequestInit = {
    method: "GET"
  };
  if (headers !== undefined) {
    init.headers = headers;
  }
  return new Request(`https://persai.dev${path}`, {
    ...init
  });
}

function params(fileRef = "file-1"): { params: Promise<unknown> } {
  return { params: Promise.resolve({ fileRef }) };
}

describe("assistant file BFF route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
    authMock.mockReset();
  });

  it("returns a JSON 401 when no Clerk token is available", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue(null)
    });

    const response = await GET(request("/api/assistant-file/file-1"), params());

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(global.fetch).toBe(ORIGINAL_FETCH);
  });

  it("forwards range validators upstream and preserves ranged video response headers", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("server-token")
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response("video-chunk", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "11",
          "Content-Range": "bytes 0-10/42",
          "Accept-Ranges": "bytes",
          ETag: '"etag-1"',
          "Last-Modified": "Sun, 07 Jun 2026 10:00:00 GMT"
        }
      })
    ) as typeof fetch;

    const response = await GET(
      request("/api/assistant-file/file-1?download=1", {
        Range: "bytes=0-10",
        "If-Range": '"etag-1"',
        "If-None-Match": '"etag-1"',
        "If-Modified-Since": "Sun, 07 Jun 2026 10:00:00 GMT"
      }),
      params()
    );

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("video-chunk");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Content-Length")).toBe("11");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-10/42");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("ETag")).toBe('"etag-1"');
    expect(response.headers.get("Last-Modified")).toBe("Sun, 07 Jun 2026 10:00:00 GMT");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(upstreamUrl)).toContain("/api/v1/assistant/files/file-1/download?download=1");
    expect((init as RequestInit | undefined)?.headers).toEqual({
      Authorization: "Bearer server-token",
      Range: "bytes=0-10",
      "If-Range": '"etag-1"',
      "If-None-Match": '"etag-1"',
      "If-Modified-Since": "Sun, 07 Jun 2026 10:00:00 GMT"
    });
  });

  it("uses the generic octet-stream fallback only when upstream omits content type", async () => {
    authMock.mockResolvedValue({
      getToken: vi.fn().mockResolvedValue("server-token")
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          "Content-Length": "4"
        }
      })
    ) as typeof fetch;

    const response = await GET(request("/api/assistant-file/file-1"), params());

    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  });
});
