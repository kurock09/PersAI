import { Writable } from "node:stream";
import {
  MAX_SCRIPT_BROWSER_REQUEST_BYTES,
  RUNTIME_SCRIPT_BROWSER_ACTIONS,
  SCRIPT_BROWSER_REQUEST_FRAME_PREFIX,
  type RuntimeScriptBrowserSdkRequest
} from "@persai/runtime-contract";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_PROFILE_CHARS = 128;

export function parseScriptBrowserRequestFrame(line: string): RuntimeScriptBrowserSdkRequest {
  if (!line.startsWith(SCRIPT_BROWSER_REQUEST_FRAME_PREFIX)) {
    throw new Error("script_browser_frame_prefix_invalid");
  }
  const encoded = line.slice(SCRIPT_BROWSER_REQUEST_FRAME_PREFIX.length);
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((MAX_SCRIPT_BROWSER_REQUEST_BYTES * 4) / 3)
  ) {
    throw new Error("script_browser_frame_oversized");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, "base64url");
  } catch {
    throw new Error("script_browser_frame_malformed");
  }
  if (bytes.length === 0 || bytes.length > MAX_SCRIPT_BROWSER_REQUEST_BYTES) {
    throw new Error("script_browser_frame_oversized");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("script_browser_frame_malformed");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("script_browser_request_invalid");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.join(",") !== "action,arguments,profile,requestId,version") {
    throw new Error("script_browser_request_invalid");
  }
  if (
    row.version !== 1 ||
    typeof row.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(row.requestId) ||
    typeof row.action !== "string" ||
    !(RUNTIME_SCRIPT_BROWSER_ACTIONS as readonly string[]).includes(row.action) ||
    typeof row.profile !== "string" ||
    row.profile.trim().length === 0 ||
    row.profile.length > MAX_PROFILE_CHARS ||
    row.arguments === null ||
    typeof row.arguments !== "object" ||
    Array.isArray(row.arguments)
  ) {
    throw new Error("script_browser_request_invalid");
  }
  return {
    version: 1,
    requestId: row.requestId,
    action: row.action as RuntimeScriptBrowserSdkRequest["action"],
    profile: row.profile.trim(),
    arguments: row.arguments as Record<string, unknown>
  };
}

/**
 * Keeps broker frames out of the Script result/diagnostic stdout collector.
 * Frames are newline-delimited and bounded; ordinary lines are forwarded
 * byte-for-byte to the existing collector.
 */
export class ScriptBrowserFrameDecoder extends Writable {
  private pending = "";
  private ordinaryLineOpen = false;
  failure: Error | null = null;

  constructor(
    private readonly onFrame: (request: RuntimeScriptBrowserSdkRequest) => void,
    private readonly ordinaryStdout: Writable
  ) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    try {
      this.pending += Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : Buffer.from(chunk, encoding).toString("utf8");
      for (;;) {
        const newline = this.pending.indexOf("\n");
        if (newline < 0) break;
        const line = this.pending.slice(0, newline);
        this.pending = this.pending.slice(newline + 1);
        if (this.ordinaryLineOpen) {
          this.ordinaryStdout.write(`${line}\n`);
          this.ordinaryLineOpen = false;
        } else if (line.startsWith(SCRIPT_BROWSER_REQUEST_FRAME_PREFIX)) {
          this.onFrame(parseScriptBrowserRequestFrame(line));
        } else {
          this.ordinaryStdout.write(`${line}\n`);
        }
      }
      if (Buffer.byteLength(this.pending, "utf8") > MAX_SCRIPT_BROWSER_REQUEST_BYTES * 2) {
        const couldBeFrame =
          !this.ordinaryLineOpen &&
          (this.pending.startsWith(SCRIPT_BROWSER_REQUEST_FRAME_PREFIX) ||
            SCRIPT_BROWSER_REQUEST_FRAME_PREFIX.startsWith(this.pending));
        if (couldBeFrame) {
          throw new Error("script_browser_frame_buffer_oversized");
        }
        this.ordinaryStdout.write(this.pending);
        this.pending = "";
        this.ordinaryLineOpen = true;
      }
      callback();
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      callback(this.failure);
    }
  }

  flushRemainder(): void {
    if (this.pending.length > 0) {
      if (!this.ordinaryLineOpen && this.pending.startsWith(SCRIPT_BROWSER_REQUEST_FRAME_PREFIX)) {
        throw new Error("script_browser_frame_unterminated");
      }
      this.ordinaryStdout.write(this.pending);
      this.pending = "";
    }
  }
}
