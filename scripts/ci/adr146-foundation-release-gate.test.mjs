#!/usr/bin/env node
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "yaml";

import {
  ADR146_FOUNDATION_GITHUB_ENVIRONMENT,
  ADR146_MIGRATIONS_GITHUB_ENVIRONMENT,
  MIGRATION_PIN_EXPLICIT_DUAL_PATH_GROUPING,
  assertDevImagePublishFoundationContract,
  assertMigrationPinJobConditionContract,
  buildMigrationPinConditionContext,
  evaluateGithubActionsBooleanExpression,
  extractWorkflowJobIfExpression,
  readDevImagePublishWorkflow,
  resolveFoundationPinPlan
} from "./adr146-foundation-release-gate.mjs";

const parseYaml = yaml.parse.bind(yaml);

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

  it("parses Dev Image Publish YAML and keeps migration pin Environment wiring", () => {
    const workflow = readDevImagePublishWorkflow();
    const parsed = parseYaml(workflow);
    assert.equal(typeof parsed, "object");
    assert.equal(typeof parsed.jobs, "object");
    assert.ok(parsed.jobs["pin-approved-migration-values-tag"]);
    assert.equal(
      parsed.jobs["pin-approved-migration-values-tag"].environment?.name,
      ADR146_MIGRATIONS_GITHUB_ENVIRONMENT
    );
    assert.deepEqual(parsed.jobs["pin-approved-migration-values-tag"].needs, [
      "detect-affected",
      "build-and-push",
      "pin-sandbox-foundation-immediate",
      "approve-adr146-foundation-before-migration"
    ]);
    assert.equal(
      parsed.jobs["approve-adr146-foundation-before-migration"].environment?.name,
      ADR146_FOUNDATION_GITHUB_ENVIRONMENT
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
  });

  it("semantically proves migration pin if for migration-only and foundation+migration", () => {
    const workflow = readDevImagePublishWorkflow();
    const expression = extractWorkflowJobIfExpression(workflow);
    assert.match(expression, MIGRATION_PIN_EXPLICIT_DUAL_PATH_GROUPING);

    const contract = assertMigrationPinJobConditionContract(workflow);
    assert.equal(contract.ok, true, contract.errors.join("; "));

    assert.equal(
      evaluateGithubActionsBooleanExpression(
        expression,
        buildMigrationPinConditionContext({
          foundationRollout: "false",
          sandboxFoundationResult: "skipped",
          foundationApprovalResult: "skipped"
        })
      ),
      true,
      "migration-only must allow migrations Environment pin"
    );
    assert.equal(
      evaluateGithubActionsBooleanExpression(
        expression,
        buildMigrationPinConditionContext({
          foundationRollout: "true",
          sandboxFoundationResult: "success",
          foundationApprovalResult: "success"
        })
      ),
      true,
      "foundation+migration must allow migrations Environment pin after both successes"
    );
  });

  it("rejects failed/cancelled/unexpected optional-job results on migration pin if", () => {
    const expression = extractWorkflowJobIfExpression(readDevImagePublishWorkflow());
    const cases = [
      buildMigrationPinConditionContext({
        foundationRollout: "false",
        sandboxFoundationResult: "failure",
        foundationApprovalResult: "skipped"
      }),
      buildMigrationPinConditionContext({
        foundationRollout: "false",
        sandboxFoundationResult: "skipped",
        foundationApprovalResult: "cancelled"
      }),
      buildMigrationPinConditionContext({
        foundationRollout: "true",
        sandboxFoundationResult: "cancelled",
        foundationApprovalResult: "success"
      }),
      buildMigrationPinConditionContext({
        foundationRollout: "true",
        sandboxFoundationResult: "success",
        foundationApprovalResult: "failure"
      }),
      buildMigrationPinConditionContext({
        foundationRollout: "true",
        sandboxFoundationResult: "skipped",
        foundationApprovalResult: "skipped"
      }),
      buildMigrationPinConditionContext({
        foundationRollout: "false",
        sandboxFoundationResult: "success",
        foundationApprovalResult: "success"
      })
    ];
    for (const context of cases) {
      assert.equal(
        evaluateGithubActionsBooleanExpression(expression, context),
        false,
        JSON.stringify(context.needs)
      );
    }
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
