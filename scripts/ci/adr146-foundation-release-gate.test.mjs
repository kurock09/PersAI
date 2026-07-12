#!/usr/bin/env node
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ADR146_FOUNDATION_GITHUB_ENVIRONMENT,
  ADR146_MIGRATIONS_GITHUB_ENVIRONMENT,
  assertDevImagePublishFoundationContract,
  readDevImagePublishWorkflow,
  resolveFoundationPinPlan
} from "./adr146-foundation-release-gate.mjs";

describe("ADR-146 foundation release-gate pin plan", () => {
  it("keeps non-foundation builds on the ordinary immediate pin path", () => {
    const plan = resolveFoundationPinPlan({
      foundationRollout: false,
      migrationChanged: false,
      successfullyBuiltServices: ["api", "web", "sandbox"]
    });
    assert.deepEqual(plan.immediateServices, ["api", "web", "sandbox"]);
    assert.deepEqual(plan.deferredServices, []);
    assert.equal(plan.deferredApprovalEnvironment, null);
    assert.deepEqual(plan.orderedApprovalEnvironments, []);
    assert.equal(plan.requiresFoundationApproval, false);
    assert.equal(plan.requiresMigrationApproval, false);
    assert.equal(plan.foundationApprovalOnlyBeforeMigrationPin, false);
  });

  it("routes non-foundation migrations to persai-dev-migrations for all built services", () => {
    const plan = resolveFoundationPinPlan({
      foundationRollout: false,
      migrationChanged: true,
      successfullyBuiltServices: "api,runtime,sandbox"
    });
    assert.deepEqual(plan.immediateServices, ["api", "runtime", "sandbox"]);
    assert.deepEqual(plan.deferredServices, []);
    assert.equal(plan.deferredApprovalEnvironment, ADR146_MIGRATIONS_GITHUB_ENVIRONMENT);
    assert.deepEqual(plan.orderedApprovalEnvironments, [ADR146_MIGRATIONS_GITHUB_ENVIRONMENT]);
    assert.equal(plan.requiresFoundationApproval, false);
    assert.equal(plan.requiresMigrationApproval, true);
    assert.equal(plan.foundationApprovalOnlyBeforeMigrationPin, false);
  });

  it("pins only sandbox immediately on foundation rollout and defers the rest", () => {
    const plan = resolveFoundationPinPlan({
      foundationRollout: true,
      migrationChanged: false,
      successfullyBuiltServices: ["api", "provider-gateway", "runtime", "sandbox", "web"]
    });
    assert.deepEqual(plan.immediateServices, ["sandbox"]);
    assert.deepEqual(plan.deferredServices, ["api", "provider-gateway", "runtime", "web"]);
    assert.equal(plan.deferredApprovalEnvironment, ADR146_FOUNDATION_GITHUB_ENVIRONMENT);
    assert.deepEqual(plan.orderedApprovalEnvironments, [ADR146_FOUNDATION_GITHUB_ENVIRONMENT]);
    assert.equal(plan.requiresFoundationApproval, true);
    assert.equal(plan.requiresMigrationApproval, false);
    assert.equal(plan.foundationApprovalOnlyBeforeMigrationPin, false);
  });

  it("requires ordered foundation then migrations Environments for foundation+migration", () => {
    const plan = resolveFoundationPinPlan({
      foundationRollout: true,
      migrationChanged: true,
      successfullyBuiltServices: ["api", "runtime", "sandbox"]
    });
    assert.deepEqual(plan.immediateServices, ["sandbox"]);
    assert.deepEqual(plan.deferredServices, ["api", "runtime"]);
    assert.equal(plan.deferredApprovalEnvironment, ADR146_MIGRATIONS_GITHUB_ENVIRONMENT);
    assert.deepEqual(plan.orderedApprovalEnvironments, [
      ADR146_FOUNDATION_GITHUB_ENVIRONMENT,
      ADR146_MIGRATIONS_GITHUB_ENVIRONMENT
    ]);
    assert.equal(plan.requiresFoundationApproval, true);
    assert.equal(plan.requiresMigrationApproval, true);
    assert.equal(plan.foundationApprovalOnlyBeforeMigrationPin, true);
  });

  it("fails closed when foundation rollout lacks a successful sandbox build", () => {
    assert.throws(
      () =>
        resolveFoundationPinPlan({
          foundationRollout: true,
          migrationChanged: false,
          successfullyBuiltServices: ["api", "web"]
        }),
      /sandbox image build\/pin marker is missing or failed/
    );
  });
});

describe("ADR-146 Dev Image Publish workflow contract", () => {
  it("encodes split-pin Environment approval without CI cloud-apply", () => {
    const workflow = readDevImagePublishWorkflow();
    const result = assertDevImagePublishFoundationContract(workflow);
    assert.equal(result.ok, true, result.errors.join("; "));
  });

  it("includes values-dev in push paths so non-tag edits enter the gate", () => {
    const workflow = readDevImagePublishWorkflow();
    assert.match(
      workflow,
      /on:\s*\n\s*push:\s*\n[\s\S]*?paths:\s*\n[\s\S]*?- infra\/helm\/values-dev\.yaml/
    );
  });

  it("proves ordered dual Environment gates for foundation+migration", () => {
    const workflow = readDevImagePublishWorkflow();
    assert.match(
      workflow,
      /approve-adr146-foundation-before-migration:[\s\S]*environment:\s*\n\s*name:\s*persai-dev-adr146-foundation/
    );
    assert.match(
      workflow,
      /pin-approved-migration-values-tag:[\s\S]*needs:[\s\S]*approve-adr146-foundation-before-migration/
    );
    assert.match(
      workflow,
      /pin-approved-migration-values-tag:[\s\S]*environment:\s*\n\s*name:\s*persai-dev-migrations/
    );
    assert.match(
      workflow,
      /approve-adr146-foundation-before-migration:[\s\S]*foundation_rollout == 'true'[\s\S]*migration_changed == 'true'/
    );
    assert.match(workflow, /pin-foundation-deferred-values-tag:[\s\S]*migration_changed != 'true'/);
    assert.match(
      workflow,
      /pin-approved-migration-values-tag:[\s\S]*foundation_rollout == 'true' && needs\.approve-adr146-foundation-before-migration\.result == 'success'/
    );
  });

  it("proves image-tag-only bot pins cannot build/pin (no recursive loop)", () => {
    const workflow = readDevImagePublishWorkflow();
    assert.match(
      workflow,
      /build-and-push:[\s\S]*?if: \$\{\{\s*needs\.detect-affected\.outputs\.deploy_services_json != '\[\]'\s*\}\}/
    );
    const pinJobs = [
      "pin-sandbox-foundation-immediate",
      "pin-foundation-deferred-values-tag",
      "pin-approved-migration-values-tag",
      "pin-dev-values-tag"
    ];
    for (const job of pinJobs) {
      const block = workflow.match(
        new RegExp(`${job}:[\\s\\S]*?(?=\\n  [a-z0-9-]+:|\\n*$)`, "u")
      )?.[0];
      assert.ok(block, `missing job ${job}`);
      assert.match(block, /deploy_services_json != '\[\]'/, `${job} must skip empty deploy`);
    }
  });

  it("preserves CI values-dev path-ignore while Dev Image Publish includes values-dev", () => {
    const workflow = readDevImagePublishWorkflow();
    assert.match(workflow, /- infra\/helm\/values-dev\.yaml/);
    const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    assert.match(ci, /paths-ignore:[\s\S]*infra\/helm\/values-dev\.yaml/);
  });
});
