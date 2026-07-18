#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const REQUEST_PREFIX = "___PERSAI_BROWSER_REQUEST_V1___";
const RESPONSE_PREFIX = "___PERSAI_BROWSER_RESPONSE_V1___";
const MAX_RESPONSE_BYTES = 1024 * 1024;

function readLine(fd) {
  const chunks = [];
  let total = 0;
  const byte = Buffer.allocUnsafe(1);
  for (;;) {
    const count = fs.readSync(fd, byte, 0, 1, null);
    if (count === 0) throw new Error("script_browser_response_closed");
    if (byte[0] === 10) break;
    chunks.push(Buffer.from(byte));
    total += 1;
    if (total > MAX_RESPONSE_BYTES * 2) throw new Error("script_browser_response_oversized");
  }
  return Buffer.concat(chunks).toString("utf8");
}

function execute(input) {
  if (process.env.PERSAI_SCRIPT_BROWSER_ENABLED !== "1") {
    throw new Error("script_browser_capability_absent");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("script_browser_request_invalid");
  }
  const { action, profile, ...argumentsValue } = input;
  if (
    (action !== "snapshot" && action !== "act") ||
    typeof profile !== "string" ||
    !profile.trim()
  ) {
    throw new Error("script_browser_request_invalid");
  }
  const request = {
    version: 1,
    requestId: crypto.randomBytes(18).toString("base64url"),
    action,
    profile: profile.trim(),
    arguments: argumentsValue
  };
  const frame =
    REQUEST_PREFIX + Buffer.from(JSON.stringify(request), "utf8").toString("base64url") + "\n";
  fs.writeSync(3, frame);
  const line = readLine(4);
  if (!line.startsWith(RESPONSE_PREFIX)) throw new Error("script_browser_response_malformed");
  const response = JSON.parse(
    Buffer.from(line.slice(RESPONSE_PREFIX.length), "base64url").toString("utf8")
  );
  if (
    response.version !== 1 ||
    response.requestId !== request.requestId ||
    typeof response.ok !== "boolean"
  ) {
    throw new Error("script_browser_response_mismatched");
  }
  if (!response.ok) {
    const error = new Error(response.error?.message || "script_browser_request_failed");
    error.code = response.error?.code || "script_browser_request_failed";
    throw error;
  }
  return response.result;
}

if (require.main === module) {
  try {
    const raw = process.argv[2] || fs.readFileSync(0, "utf8");
    process.stdout.write(JSON.stringify(execute(JSON.parse(raw))));
  } catch (error) {
    process.stderr.write(`${error.code || "script_browser_failed"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { execute };
