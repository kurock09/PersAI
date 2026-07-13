#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertActiveCodeLegacyEgressClean,
  repoRoot,
  scanActiveCodeForLegacyEgressViolations,
  scanEgressCopyForViolations,
  scanFileForViolations
} from "./adr146-active-code-audit.mjs";

describe("ADR-146 active-code legacy egress audit", () => {
  it("passes on the current active tree", () => {
    const result = assertActiveCodeLegacyEgressClean();
    assert.ok(result.scannedFileCount >= 500);
    assert.equal(result.violations.length, 0);
  });

  it("allows sandbox-policy parser rejection of networkAccessEnabled", () => {
    const policyPath = path.join(
      repoRoot,
      "apps/api/src/modules/workspace-management/application/sandbox-policy.ts"
    );
    const content = readFileSync(policyPath, "utf8");
    assert.match(content, /networkAccessEnabled is not supported/);
    const result = scanActiveCodeForLegacyEgressViolations({
      roots: [
        "apps/api/src/modules/workspace-management/application/sandbox-policy.ts",
        "apps/sandbox/src/sandbox-egress-mode.ts"
      ]
    });
    assert.equal(result.scannedFileCount, 2);
    assert.equal(result.violations.length, 0);
  });

  it("fails closed when a forbidden legacy field appears in a synthetic active file", () => {
    for (const source of [
      "const direct = networkAccessEnabled;",
      'const bracket = policy["networkAccessEnabled"];',
      'const split = "network" + "AccessEnabled";'
    ]) {
      const violations = scanFileForViolations("apps/sandbox/src/stale-copy.ts", source);
      assert.ok(violations.length >= 1, source);
    }
  });

  it("detects false egress copy across line boundaries", () => {
    const violations = scanEgressCopyForViolations(
      "apps/web/messages/en.json",
      '"sandboxNetwork": "Sandbox internet is\\n unrestricted"'
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, "unlimited-egress-copy");
  });

  it("fails closed for missing roots and too-small scans", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "adr146-active-audit-"));
    try {
      assert.throws(
        () =>
          scanActiveCodeForLegacyEgressViolations({
            rootDir: tempRoot,
            roots: ["missing"],
            minimumScannedFiles: 1
          }),
        /ENOENT/
      );
      mkdirSync(path.join(tempRoot, "apps"), { recursive: true });
      writeFileSync(path.join(tempRoot, "apps", "one.ts"), "export const ok = true;\n");
      assert.throws(
        () =>
          scanActiveCodeForLegacyEgressViolations({
            rootDir: tempRoot,
            roots: ["apps"],
            minimumScannedFiles: 2
          }),
        /minimum is 2/
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlink traversal outside the configured root", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "adr146-active-audit-root-"));
    const outside = mkdtempSync(path.join(tmpdir(), "adr146-active-audit-outside-"));
    try {
      writeFileSync(path.join(outside, "escape.ts"), "export const escaped = true;\n");
      symlinkSync(outside, path.join(tempRoot, "linked"), "junction");
      assert.throws(
        () =>
          scanActiveCodeForLegacyEgressViolations({
            rootDir: tempRoot,
            roots: ["linked"],
            minimumScannedFiles: 1
          }),
        /escapes repository root/
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("direct CLI executes and prints PASS with counts", () => {
    const output = execFileSync(process.execPath, ["scripts/ci/adr146-active-code-audit.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.match(output, /PASS \(\d+ roots, \d+ files\)/);
    assert.match(output, /Static limitation:/);
  });
});
