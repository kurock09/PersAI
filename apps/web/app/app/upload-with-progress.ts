"use client";

/**
 * XHR-based upload helper with stall detection.
 *
 * `fetch()` does not expose upload progress events, so file/voice uploads
 * that need to detect a stalled connection (no bytes flowing for N seconds)
 * fall back to `XMLHttpRequest`. We intentionally keep this thin: same
 * shape as a `Response` consumer would expect (`ok`, `status`, body text,
 * headers), with a stall watchdog and an optional hard upper bound.
 *
 * Design:
 *  - `stallTimeoutMs` arms a 1-Hz watchdog that aborts the request when no
 *    `progress` event has been seen for that many ms. Distinguishes a stuck
 *    connection from a slow-but-progressing one (large file, weak signal).
 *  - `hardTimeoutMs` is the worst-case upper bound (e.g. 5 minutes) so we
 *    never let an upload run forever even if the server keeps the socket
 *    technically alive.
 *  - `signal` integrates with the same `AbortController` callers already
 *    use for the rest of the chat send pipeline.
 *
 * Errors are typed so the caller can tell stall/timeout/abort/network apart
 * — that mapping is what drives the "send_failed" pending bubble in
 * useChat.send (see ADR-075 "Single-slot pending send").
 */

export interface XhrUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface XhrUploadOptions {
  authToken?: string;
  signal?: AbortSignal;
  onProgress?: (progress: XhrUploadProgress) => void;
  stallTimeoutMs?: number;
  hardTimeoutMs?: number;
}

export interface XhrUploadResponse {
  ok: boolean;
  status: number;
  statusText: string;
  responseText: string;
  headers: Headers;
}

export class XhrStallError extends Error {
  constructor() {
    super("Upload stalled.");
    this.name = "XhrStallError";
  }
}

export class XhrTimeoutError extends Error {
  constructor() {
    super("Upload timed out.");
    this.name = "XhrTimeoutError";
  }
}

export class XhrAbortError extends Error {
  constructor() {
    super("Upload aborted.");
    this.name = "XhrAbortError";
  }
}

export class XhrNetworkError extends Error {
  constructor() {
    super("Network error during upload.");
    this.name = "XhrNetworkError";
  }
}

const STALL_WATCHDOG_TICK_MS = 1000;

export function uploadWithProgress(
  url: string,
  body: FormData,
  opts: XhrUploadOptions = {}
): Promise<XhrUploadResponse> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new XhrAbortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    let lastProgressAt = Date.now();
    let stallInterval: ReturnType<typeof setInterval> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (stallInterval !== null) {
        clearInterval(stallInterval);
        stallInterval = null;
      }
      if (hardTimer !== null) {
        clearTimeout(hardTimer);
        hardTimer = null;
      }
      if (opts.signal !== undefined) {
        opts.signal.removeEventListener("abort", abortHandler);
      }
    };

    const finishOnce = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      cb();
    };

    const abortHandler = () => {
      finishOnce(() => {
        try {
          xhr.abort();
        } catch {
          /* ignore */
        }
        reject(new XhrAbortError());
      });
    };

    if (opts.signal !== undefined) {
      opts.signal.addEventListener("abort", abortHandler);
    }

    xhr.open("POST", url);
    if (opts.authToken !== undefined && opts.authToken.length > 0) {
      xhr.setRequestHeader("Authorization", `Bearer ${opts.authToken}`);
    }

    if (opts.stallTimeoutMs !== undefined && opts.stallTimeoutMs > 0) {
      const limit = opts.stallTimeoutMs;
      stallInterval = setInterval(() => {
        if (Date.now() - lastProgressAt > limit) {
          finishOnce(() => {
            try {
              xhr.abort();
            } catch {
              /* ignore */
            }
            reject(new XhrStallError());
          });
        }
      }, STALL_WATCHDOG_TICK_MS);
    }

    if (opts.hardTimeoutMs !== undefined && opts.hardTimeoutMs > 0) {
      hardTimer = setTimeout(() => {
        finishOnce(() => {
          try {
            xhr.abort();
          } catch {
            /* ignore */
          }
          reject(new XhrTimeoutError());
        });
      }, opts.hardTimeoutMs);
    }

    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      lastProgressAt = Date.now();
      if (e.lengthComputable && opts.onProgress !== undefined && e.total > 0) {
        opts.onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.min(100, Math.round((e.loaded / e.total) * 100))
        });
      }
    });

    // Server-side responses also reset the stall window (covers large response bodies).
    xhr.addEventListener("progress", () => {
      lastProgressAt = Date.now();
    });

    xhr.addEventListener("load", () => {
      finishOnce(() => {
        const headers = new Headers();
        const raw = xhr.getAllResponseHeaders();
        for (const line of raw.split(/\r?\n/)) {
          const idx = line.indexOf(":");
          if (idx > 0) {
            headers.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
          }
        }
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          statusText: xhr.statusText,
          responseText: xhr.responseText,
          headers
        });
      });
    });

    xhr.addEventListener("error", () => {
      finishOnce(() => reject(new XhrNetworkError()));
    });

    xhr.addEventListener("abort", () => {
      // Aborts triggered via abortHandler/finishOnce already rejected;
      // this branch covers browser-initiated aborts (rare) so we still settle.
      finishOnce(() => reject(new XhrAbortError()));
    });

    xhr.send(body);
  });
}

export function isXhrPreHeadersFailure(error: unknown): boolean {
  return (
    error instanceof XhrStallError ||
    error instanceof XhrTimeoutError ||
    error instanceof XhrAbortError ||
    error instanceof XhrNetworkError
  );
}
