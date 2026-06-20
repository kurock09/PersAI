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

describe("detect-affected: sandbox-exec image change", () => {
  it("classifies exec-image Dockerfile change as sandbox-exec deploy only (not sandbox control-plane)", () => {
    const result = detectAffected(["apps/sandbox/exec-image/Dockerfile"]);
    const deployNames = result.deployServices.map((s) => s.service);
    assert.ok(
      deployNames.includes("sandbox-exec"),
      `expected sandbox-exec in deploy services, got: ${deployNames.join(", ")}`
    );
    assert.ok(
      !deployNames.includes("sandbox"),
      `sandbox control-plane must NOT be deployed for exec-image changes, got: ${deployNames.join(", ")}`
    );
    assert.equal(result.docsOnly, false, "exec-image Dockerfile is not docs-only");
    assert.equal(result.requiresFullCi, false, "exec-image change does not require full CI");
  });

  it("classifies exec-image requirements.txt change as sandbox-exec deploy only", () => {
    const result = detectAffected(["apps/sandbox/exec-image/requirements.txt"]);
    const deployNames = result.deployServices.map((s) => s.service);
    assert.ok(
      deployNames.includes("sandbox-exec"),
      `expected sandbox-exec in deploy services for requirements.txt, got: ${deployNames.join(", ")}`
    );
    assert.ok(
      !deployNames.includes("sandbox"),
      `sandbox control-plane must NOT be deployed for exec-image requirements, got: ${deployNames.join(", ")}`
    );
  });

  it("classifies sandbox control-plane src change as sandbox deploy (not sandbox-exec)", () => {
    const result = detectAffected(["apps/sandbox/src/exec-pod-bridge.service.ts"]);
    const deployNames = result.deployServices.map((s) => s.service);
    assert.ok(
      deployNames.includes("sandbox"),
      `expected sandbox in deploy services for src change, got: ${deployNames.join(", ")}`
    );
    assert.ok(
      !deployNames.includes("sandbox-exec"),
      `sandbox-exec must NOT be deployed for control-plane src changes, got: ${deployNames.join(", ")}`
    );
  });
});
