#!/usr/bin/env node
// Unit tests for the detectAffected classifier.
// Run: node --test scripts/ci/detect-affected.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectAffected } from "./detect-affected.mjs";

describe("detect-affected: docs-only change", () => {
  it("classifies a markdown doc change as docsOnly with no deploy and no full-CI", () => {
    const result = detectAffected(["docs/FOO.md"]);
    assert.equal(result.docsOnly, true, "docsOnly should be true");
    assert.equal(result.testOnly, false, "testOnly should be false");
    assert.equal(result.requiresFullCi, false, "requiresFullCi should be false");
    assert.equal(result.requiresIntegration, false, "requiresIntegration should be false");
    assert.equal(result.deployServices.length, 0, "no deploy services for docs-only");
  });
});

describe("detect-affected: test-only change", () => {
  it("classifies an app test file change as testOnly", () => {
    const result = detectAffected(["apps/api/test/foo.test.ts"]);
    assert.equal(result.testOnly, true, "testOnly should be true");
    assert.equal(result.docsOnly, false, "docsOnly should be false");
    assert.equal(result.requiresFullCi, false, "requiresFullCi should be false");
  });
});

describe("detect-affected: migration change", () => {
  it("classifies a Prisma migration file as migrationChanged and requiresIntegration", () => {
    const result = detectAffected([
      "apps/api/prisma/migrations/20240101_init/migration.sql"
    ]);
    assert.equal(result.migrationChanged, true, "migrationChanged should be true");
    assert.equal(result.requiresIntegration, true, "requiresIntegration should be true");
  });
});

describe("detect-affected: contracts change", () => {
  it("classifies a contracts package openapi.yaml change as contracts-boundary risk and requiresIntegration", () => {
    const result = detectAffected(["packages/contracts/openapi.yaml"]);
    assert.ok(
      result.riskReasons.includes("contracts-boundary"),
      `expected contracts-boundary in riskReasons, got: ${result.riskReasons.join(", ")}`
    );
    assert.equal(result.requiresIntegration, true, "requiresIntegration should be true");
    assert.equal(result.requiresFullCi, false, "contracts change must NOT escalate to full-CI");
  });
});
