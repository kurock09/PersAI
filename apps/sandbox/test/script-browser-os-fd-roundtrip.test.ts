import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import type { RuntimeScriptBrowserSdkRequest } from "@persai/runtime-contract";
import { buildScriptBrowserResponseFrame } from "../src/script-browser-broker.service";
import { ScriptBrowserFrameDecoder } from "../src/script-browser-frame";
import { ScriptBrowserResponseLifecycle } from "../src/script-browser-response-lifecycle";
import {
  buildScriptExecutionShellCommand,
  buildScriptResultMarker,
  splitScriptExecutionStdout
} from "../src/script-execution-support";

/**
 * ADR-152 P1 repair proof: Kubernetes exec stdin loses oversized single writes
 * (see WORKSPACE_PUSH_CHUNK_BYTES). This launches the real browser-enabled
 * Script wrapper + platform CLI over OS pipes/FDs (no Kubernetes) and proves a
 * fragmented >64 KiB response round-trips while the ordinary result marker
 * remains cleanly separated on stdout.
 *
 * POSIX-only: Windows lacks bash + the inherited FD 3/4 dup model used by the
 * production wrapper.
 */
test(
  "POSIX OS-FD round-trip: fragmented >64KiB response through real wrapper/CLI pipes with result-marker separation",
  { skip: process.platform === "win32" ? "requires POSIX bash and inherited FDs 3/4" : false },
  async () => {
    const scriptDir = await mkdtemp(join(tmpdir(), "persai-script-browser-osfd-"));
    const cliPath = join(process.cwd(), "exec-image", "script-browser-sdk", "persai-browser-cli.js");
    const resultMarker = buildScriptResultMarker("osfd-roundtrip");
    const largePayload = "x".repeat(200 * 1024);
    const entryPath = join(scriptDir, "entry.js");
    await writeFile(
      entryPath,
      [
        '"use strict";',
        "const fs = require('node:fs');",
        "const { execute } = require(process.env.PERSAI_OSFD_CLI_PATH);",
        "const result = execute({ action: 'snapshot', profile: 'Work' });",
        "fs.writeFileSync(process.env.PERSAI_SCRIPT_OUTPUT_PATH, JSON.stringify(result));"
      ].join("\n"),
      "utf8"
    );

    const shell = buildScriptExecutionShellCommand({
      scriptDir,
      entryCommand: `node ${JSON.stringify(entryPath)}`,
      invocationKey: "osfd-roundtrip",
      manifestEnvironment: {},
      resultMarker,
      maxOutputBytes: 512 * 1024,
      browserEnabled: true
    });

    let ordinary = "";
    const ordinarySink = new Writable({
      write(chunk, _encoding, callback) {
        ordinary += chunk.toString("utf8");
        callback();
      }
    });

    const child = spawn("bash", ["-lc", shell], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PERSAI_OSFD_CLI_PATH: cliPath
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    assert.ok(child.stdin, "child stdin must be a pipe");
    assert.ok(child.stdout, "child stdout must be a pipe");

    const lifecycle = new ScriptBrowserResponseLifecycle(child.stdin);
    const decoder = new ScriptBrowserFrameDecoder((request: RuntimeScriptBrowserSdkRequest) => {
      lifecycle.dispatch({
        requestResponse: async () =>
          buildScriptBrowserResponseFrame({
            version: 1,
            requestId: request.requestId,
            ok: true,
            result: { huge: largePayload }
          }),
        failureResponse: (error) =>
          buildScriptBrowserResponseFrame({
            version: 1,
            requestId: request.requestId,
            ok: false,
            error: {
              code: "script_browser_request_failed",
              message: error instanceof Error ? error.message : "failed"
            }
          })
      });
    }, ordinarySink);

    child.stdout.pipe(decoder);

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });

    await lifecycle.close(async () => undefined);
    decoder.flushRemainder();

    try {
      assert.equal(exitCode, 0, `wrapper/CLI failed: ${Buffer.concat(stderrChunks).toString("utf8")}`);
      const { resultText } = splitScriptExecutionStdout(ordinary, resultMarker);
      assert.ok(resultText, "result marker must separate structured Script output on ordinary stdout");
      const parsed = JSON.parse(resultText) as { huge?: string };
      assert.equal(
        parsed.huge,
        largePayload,
        "fragmented >64KiB response must round-trip byte-for-byte through real OS FDs"
      );
      assert.ok(
        !ordinary.includes("___PERSAI_BROWSER_REQUEST_V1___"),
        "broker request frames must not leak into the ordinary result stdout collector"
      );
      assert.ok(
        !ordinary.includes("___PERSAI_BROWSER_RESPONSE_V1___"),
        "broker response frames must not appear on ordinary Script stdout"
      );
    } finally {
      await rm(scriptDir, { recursive: true, force: true });
    }
  }
);
