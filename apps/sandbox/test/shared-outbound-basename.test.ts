import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMacOsCollisionBasename } from "../src/shared-outbound-basename";

test("resolveMacOsCollisionBasename: empty set returns exact basename", () => {
  assert.equal(resolveMacOsCollisionBasename("report.pdf", new Set()), "report.pdf");
});

test("resolveMacOsCollisionBasename: increments numeric suffix", () => {
  const existing = new Set(["report.pdf"]);
  assert.equal(resolveMacOsCollisionBasename("report.pdf", existing), "report (2).pdf");
  existing.add("report (2).pdf");
  assert.equal(resolveMacOsCollisionBasename("report.pdf", existing), "report (3).pdf");
});
