#!/usr/bin/env node
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";

import {
  ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES,
  ADR146_FOUNDATION_DEFERRED_RESUME_IMAGE_TREE_PATHS,
  ADR146_FOUNDATION_DEFERRED_RESUME_LOCKED_CASE,
  ADR146_FOUNDATION_GITHUB_ENVIRONMENT,
  ADR146_FOUNDATION_INVENTORY_REL_PATH,
  ADR146_MIGRATIONS_GITHUB_ENVIRONMENT,
  MIGRATION_PIN_EXPLICIT_DUAL_PATH_GROUPING,
  assertDevImagePublishFoundationContract,
  assertDevImagePublishPinJobsRemainPushOnly,
  assertFoundationDeferredResumeRequest,
  assertFoundationDeferredResumePinMutation,
  assertFoundationDeferredResumePinState,
  assertFoundationDeferredResumeWorkflowContract,
  assertMigrationPinJobConditionContract,
  buildMigrationPinConditionContext,
  evaluateGithubActionsBooleanExpression,
  extractWorkflowJobIfExpression,
  readDevImagePublishWorkflow,
  readFoundationDeferredResumeWorkflow,
  resolveFoundationPinPlan,
  sha256Hex
} from "./adr146-foundation-release-gate.mjs";
import { applyPinDevImageTags } from "./pin-dev-image-tags-lib.mjs";

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

  it("keeps ordinary Dev Image Publish pin jobs push-only (no dispatch bypass)", () => {
    const result = assertDevImagePublishPinJobsRemainPushOnly();
    assert.equal(result.ok, true, result.errors.join("; "));
  });
});

describe("ADR-146 foundation deferred-pin resume", () => {
  const locked = ADR146_FOUNDATION_DEFERRED_RESUME_LOCKED_CASE;
  const valuesDevText = readFileSync(
    new URL("../../infra/helm/values-dev.yaml", import.meta.url),
    "utf8"
  );
  const inventoryBytes = readFileSync(
    new URL(`../../${ADR146_FOUNDATION_INVENTORY_REL_PATH}`, import.meta.url)
  );
  const liveInventorySha = sha256Hex(inventoryBytes);

  function baseDeps(overrides = {}) {
    return {
      headSha: locked.sandboxProofCommitSha,
      valuesDevText,
      resolveSha: (raw) => String(raw).trim().toLowerCase(),
      isAncestor: () => true,
      listChangedPaths: () => [],
      readGitBlob: (commitSha, relPath) => {
        if (relPath === ADR146_FOUNDATION_INVENTORY_REL_PATH) {
          return Buffer.from(inventoryBytes);
        }
        if (relPath === "infra/helm/values-dev.yaml") {
          return Buffer.from(valuesDevText, "utf8");
        }
        throw new Error(`unexpected blob ${commitSha}:${relPath}`);
      },
      ...overrides
    };
  }

  it("locks the current coordinated-push resume case", () => {
    assert.equal(locked.targetImageSha, "3cd2ea4fa0c82d319c2e8e63724c5753f03b5e0f");
    assert.deepEqual([...locked.deferredServices], ["api", "web", "runtime", "provider-gateway"]);
    assert.equal(locked.sandboxProofCommitSha, "e5c249c3dbb9d16406b85637e9dcdd9a418a8a79");
    assert.equal(
      locked.evidenceInventorySha256,
      "c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7"
    );
    assert.equal(locked.migrationChanged, false);
    assert.deepEqual(
      [...ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES],
      ["api", "web", "runtime", "provider-gateway"]
    );
    for (const path of [
      ".dockerignore",
      "extensions",
      "services",
      "scripts/smoke",
      "packages",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml"
    ]) {
      assert.ok(
        ADR146_FOUNDATION_DEFERRED_RESUME_IMAGE_TREE_PATHS.includes(path),
        `missing build-context drift path ${path}`
      );
    }
    assert.equal(liveInventorySha, locked.evidenceInventorySha256);
  });

  it("accepts the locked current resume fixture against live helpers", () => {
    const result = assertFoundationDeferredResumeRequest({
      targetImageSha: locked.targetImageSha,
      deferredServices: locked.deferredServices.join(","),
      sandboxProofCommitSha: locked.sandboxProofCommitSha,
      evidenceInventorySha256: locked.evidenceInventorySha256,
      migrationChanged: false
    });
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(result.summary.targetImageSha, locked.targetImageSha);
    assert.deepEqual(result.summary.deferredServices, [...locked.deferredServices]);
    assert.equal(result.summary.sandboxProofCommitSha, locked.sandboxProofCommitSha);
    assert.equal(result.summary.evidenceInventorySha256, locked.evidenceInventorySha256);
    assert.equal(result.summary.migrationChanged, false);
  });

  it("accepts the locked fixture through injectable deps", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: [...locked.deferredServices],
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: "false"
      },
      baseDeps()
    );
    assert.equal(result.ok, true, result.errors.join("; "));
  });

  it("accepts only boolean false and exact string false for migration_changed", () => {
    for (const migrationChanged of [false, "false"]) {
      const result = assertFoundationDeferredResumeRequest(
        {
          targetImageSha: locked.targetImageSha,
          deferredServices: locked.deferredServices.join(","),
          sandboxProofCommitSha: locked.sandboxProofCommitSha,
          evidenceInventorySha256: locked.evidenceInventorySha256,
          migrationChanged
        },
        baseDeps()
      );
      assert.equal(
        result.ok,
        true,
        `${JSON.stringify(migrationChanged)}: ${result.errors.join("; ")}`
      );
    }
  });

  it("rejects every other migration_changed representation fail-closed", () => {
    const rejected = [
      true,
      "true",
      "1",
      "0",
      "yes",
      "",
      undefined,
      null,
      "False",
      "FALSE",
      "TRUE",
      "false ",
      " false",
      "garbage",
      0,
      1,
      {},
      []
    ];
    for (const migrationChanged of rejected) {
      const result = assertFoundationDeferredResumeRequest(
        {
          targetImageSha: locked.targetImageSha,
          deferredServices: locked.deferredServices.join(","),
          sandboxProofCommitSha: locked.sandboxProofCommitSha,
          evidenceInventorySha256: locked.evidenceInventorySha256,
          migrationChanged
        },
        baseDeps()
      );
      assert.equal(result.ok, false, `unexpectedly accepted ${JSON.stringify(migrationChanged)}`);
      assert.match(
        result.errors.join("\n"),
        /migration_changed must be boolean false or exact string "false"/
      );
    }
  });

  it("rejects sandbox in deferred services", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: "api,sandbox,web",
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: false
      },
      baseDeps()
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /sandbox must not appear/);
  });

  it("rejects an allowed subset because this one-off requires the exact service set", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: "api,web,runtime",
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: false
      },
      baseDeps()
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /requires exact deferred service set/);
  });

  it("rejects inventory hash mismatch", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: locked.deferredServices.join(","),
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: createHash("sha256").update("wrong").digest("hex"),
        migrationChanged: false
      },
      baseDeps()
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /evidence_inventory_sha256 mismatch/);
  });

  it("rejects non-ancestor target", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: locked.deferredServices.join(","),
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: false
      },
      baseDeps({
        isAncestor: (maybeAncestor) => maybeAncestor !== locked.targetImageSha
      })
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /must be an ancestor of HEAD/);
  });

  it("rejects app/package image-tree drift between target and HEAD", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: locked.deferredServices.join(","),
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: false
      },
      baseDeps({
        listChangedPaths: (_fromSha, _toSha, paths) => {
          if (paths.includes("apps/api")) {
            return ["apps/api/src/index.ts"];
          }
          return [];
        }
      })
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /image-tree drift/);
  });

  for (const changedPath of [
    ".dockerignore",
    "extensions/persai-browser-extension/package.json",
    "services/example/package.json",
    "scripts/smoke/package.json"
  ]) {
    it(`rejects root build-context drift at ${changedPath}`, () => {
      const result = assertFoundationDeferredResumeRequest(
        {
          targetImageSha: locked.targetImageSha,
          deferredServices: locked.deferredServices.join(","),
          sandboxProofCommitSha: locked.sandboxProofCommitSha,
          evidenceInventorySha256: locked.evidenceInventorySha256,
          migrationChanged: false
        },
        baseDeps({
          listChangedPaths: (_fromSha, _toSha, paths) =>
            paths.some(
              (candidate) => changedPath === candidate || changedPath.startsWith(`${candidate}/`)
            )
              ? [changedPath]
              : []
        })
      );
      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /image-tree drift/);
    });
  }

  it("rejects Prisma drift between the currently pinned API and target image", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: locked.deferredServices.join(","),
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: false
      },
      baseDeps({
        listChangedPaths: (_fromSha, _toSha, paths) =>
          paths.includes("apps/api/prisma/schema.prisma")
            ? ["apps/api/prisma/migrations/example/migration.sql"]
            : []
      })
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /prisma-relevant drift/);
  });

  it("rejects wrong sandbox tag binding vs proof commit", () => {
    const wrongValues = valuesDevText.replace(
      /^(\s+tag: )8a0043dded0349bec33bda2bff4b2b2fcbe20a5f$/mu,
      "$1deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    );
    assert.notEqual(wrongValues, valuesDevText);
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: locked.deferredServices.join(","),
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: false
      },
      baseDeps({
        valuesDevText: wrongValues
      })
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /sandbox\.image\.tag must remain bound/);
  });

  it("rejects disallowed deferred service names", () => {
    const result = assertFoundationDeferredResumeRequest(
      {
        targetImageSha: locked.targetImageSha,
        deferredServices: "api,worker",
        sandboxProofCommitSha: locked.sandboxProofCommitSha,
        evidenceInventorySha256: locked.evidenceInventorySha256,
        migrationChanged: false
      },
      baseDeps()
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /not allowed: worker/);
  });

  it("accepts only the authoritative exact tag mutation", () => {
    const expected = valuesDevText.replace(
      /^(\s+tag: )(?:f35498e6b595d2b58f4cb16d8e721a12524bd598|f1f4407835113b7e934637f327d2f29006e08d51)$/gmu,
      `$1${locked.targetImageSha}`
    );
    const result = assertFoundationDeferredResumePinMutation({
      baseValuesDevText: valuesDevText,
      headValuesDevText: expected,
      targetImageSha: locked.targetImageSha,
      deferredServices: locked.deferredServices
    });
    assert.equal(result.ok, true, result.errors.join("; "));
  });

  it("rejects unrelated values-dev mutation in the resume pin", () => {
    const expected = valuesDevText
      .replace(
        /^(\s+tag: )(?:f35498e6b595d2b58f4cb16d8e721a12524bd598|f1f4407835113b7e934637f327d2f29006e08d51)$/gmu,
        `$1${locked.targetImageSha}`
      )
      .replace("replicaCount: 2", "replicaCount: 3");
    const result = assertFoundationDeferredResumePinMutation({
      baseValuesDevText: valuesDevText,
      headValuesDevText: expected,
      targetImageSha: locked.targetImageSha,
      deferredServices: locked.deferredServices
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /no unrelated values-dev mutation/);
  });

  it("rejects a committed resume pin containing any unrelated path", () => {
    const expected = valuesDevText.replace(
      /^(\s+tag: )(?:f35498e6b595d2b58f4cb16d8e721a12524bd598|f1f4407835113b7e934637f327d2f29006e08d51)$/gmu,
      `$1${locked.targetImageSha}`
    );
    const result = assertFoundationDeferredResumePinState(
      {
        baseRef: "base",
        headRef: "head",
        targetImageSha: locked.targetImageSha,
        deferredServices: locked.deferredServices
      },
      {
        gitExec: () => "infra/helm/values-dev.yaml\ndocs/CHANGELOG.md",
        readGitBlob: (ref) => Buffer.from(ref === "base" ? valuesDevText : expected, "utf8")
      }
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /must change only infra\/helm\/values-dev.yaml/);
  });

  it("rejects gha-creds worktree pollution even when deferred tags are exact", () => {
    const expected = valuesDevText.replace(
      /^(\s+tag: )(?:f35498e6b595d2b58f4cb16d8e721a12524bd598|f1f4407835113b7e934637f327d2f29006e08d51)$/gmu,
      `$1${locked.targetImageSha}`
    );
    const result = assertFoundationDeferredResumePinState(
      {
        baseRef: "base",
        headRef: "WORKTREE",
        targetImageSha: locked.targetImageSha,
        deferredServices: locked.deferredServices
      },
      {
        gitExec: () => " M infra/helm/values-dev.yaml\n?? gha-creds-deadbeefdeadbeef.json",
        readGitBlob: () => Buffer.from(valuesDevText, "utf8"),
        readWorktree: () => expected
      }
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /worktree must contain only unstaged/);
  });

  it("encodes Environment-gated resume workflow without rebuild or cloud-apply", () => {
    const workflow = readFoundationDeferredResumeWorkflow();
    const result = assertFoundationDeferredResumeWorkflowContract(workflow);
    assert.equal(result.ok, true, result.errors.join("; "));
    const parsed = parseYaml(workflow);
    assert.equal(typeof parsed.on?.workflow_dispatch, "object");
    assert.equal(parsed.on?.push, undefined);
    assert.equal(
      parsed.jobs["pin-foundation-deferred-resume"].environment?.name,
      ADR146_FOUNDATION_GITHUB_ENVIRONMENT
    );
    assert.equal(parsed.jobs["validate-resume"].environment, undefined);
    assert.equal(parsed.jobs["build-and-push"], undefined);
    assert.deepEqual(parsed.on.workflow_dispatch.inputs.migration_changed.options, ["false"]);
    const authSteps = Object.values(parsed.jobs).flatMap((job) =>
      (job.steps ?? []).filter((step) => step.uses === "google-github-actions/auth@v3")
    );
    assert.equal(authSteps.length, 2);
    for (const authStep of authSteps) {
      assert.equal(authStep.with?.token_format, "access_token");
      assert.equal(authStep.with?.create_credentials_file, false);
    }
    assert.match(
      workflow,
      /resume ADR-146 foundation deferred pins for \$\{TARGET_IMAGE_SHA\} \(proof \$\{SANDBOX_PROOF_COMMIT_SHA\}\)/
    );
  });

  it("fails workflow contract if any auth step creates a credentials file", () => {
    const workflow = readFoundationDeferredResumeWorkflow();
    const broken = workflow.replace(
      "          create_credentials_file: false",
      "          create_credentials_file: true"
    );
    assert.notEqual(broken, workflow);
    const result = assertFoundationDeferredResumeWorkflowContract(broken);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /create_credentials_file: false/);
  });

  it("fails workflow contract without fresh-main checkout/validation ordering", () => {
    const workflow = readFoundationDeferredResumeWorkflow();
    const broken = workflow.replace(
      "git fetch origin main\n          git checkout -B main origin/main",
      "git checkout -B main origin/main\n          git fetch origin main"
    );
    assert.notEqual(broken, workflow);
    const result = assertFoundationDeferredResumeWorkflowContract(broken);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /fetch current origin\/main/);
  });

  it("fails workflow contract unless every post-rebase push is revalidated in order", () => {
    const workflow = readFoundationDeferredResumeWorkflow();
    const broken = workflow.replace(
      "git pull --rebase origin main\n            assert_resume\n            assert_pin_commit\n            if git push origin HEAD:main",
      "git pull --rebase origin main\n            assert_pin_commit\n            if git push origin HEAD:main"
    );
    assert.notEqual(broken, workflow);
    const result = assertFoundationDeferredResumeWorkflowContract(broken);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /every pull --rebase retry/);
  });

  it("rejects protected-path drift after a real isolated git rebase before push", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "persai-adr146-resume-"));
    const remotePath = path.join(tempRoot, "origin.git");
    const seedPath = path.join(tempRoot, "seed");
    const runnerPath = path.join(tempRoot, "runner");
    const gitIdentityEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "ADR146 Test",
      GIT_AUTHOR_EMAIL: "adr146-test@example.invalid",
      GIT_COMMITTER_NAME: "ADR146 Test",
      GIT_COMMITTER_EMAIL: "adr146-test@example.invalid"
    };
    const git = (cwd, args, encoding = "utf8") =>
      execFileSync("git", args, {
        cwd,
        env: gitIdentityEnv,
        encoding,
        stdio: ["ignore", "pipe", "pipe"]
      });
    const writeRepoFile = (root, relPath, contents) => {
      const absolute = path.join(root, ...relPath.split("/"));
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
    };
    const valuesText = ({ api, web, runtime, providerGateway, sandbox }) => `api:
  image:
    tag: ${api}
web:
  image:
    tag: ${web}
runtime:
  image:
    tag: ${runtime}
providerGateway:
  image:
    tag: ${providerGateway}
sandbox:
  image:
    tag: ${sandbox}
`;

    try {
      mkdirSync(seedPath);
      git(tempRoot, ["init", "--bare", remotePath]);
      git(seedPath, ["init", "-b", "main"]);

      const oldTag = "1111111111111111111111111111111111111111";
      const sandboxTag = "2222222222222222222222222222222222222222";
      const inventory = `${JSON.stringify({ releaseGate: { repositoryEnforced: true } })}\n`;
      writeRepoFile(seedPath, ADR146_FOUNDATION_INVENTORY_REL_PATH, inventory);
      writeRepoFile(
        seedPath,
        "infra/helm/values-dev.yaml",
        valuesText({
          api: oldTag,
          web: oldTag,
          runtime: oldTag,
          providerGateway: oldTag,
          sandbox: sandboxTag
        })
      );
      git(seedPath, ["add", "."]);
      git(seedPath, ["commit", "-m", "target image commit"]);
      const targetSha = git(seedPath, ["rev-parse", "HEAD"]).trim();

      const proofValues = valuesText({
        api: targetSha,
        web: oldTag,
        runtime: oldTag,
        providerGateway: oldTag,
        sandbox: sandboxTag
      });
      writeRepoFile(seedPath, "infra/helm/values-dev.yaml", proofValues);
      git(seedPath, ["add", "infra/helm/values-dev.yaml"]);
      git(seedPath, ["commit", "-m", "sandbox proof commit"]);
      const proofSha = git(seedPath, ["rev-parse", "HEAD"]).trim();
      const inventorySha = sha256Hex(Buffer.from(inventory, "utf8"));

      git(seedPath, ["remote", "add", "origin", remotePath]);
      git(seedPath, ["push", "-u", "origin", "main"]);
      git(tempRoot, ["clone", "--branch", "main", remotePath, runnerPath]);

      const request = {
        targetImageSha: targetSha,
        deferredServices: locked.deferredServices,
        sandboxProofCommitSha: proofSha,
        evidenceInventorySha256: inventorySha,
        migrationChanged: "false"
      };
      const validateRunner = () =>
        assertFoundationDeferredResumeRequest(request, {
          gitExec: (args) => git(runnerPath, args).trimEnd(),
          readGitBlob: (commitSha, relPath) =>
            git(runnerPath, ["show", `${commitSha}:${relPath}`], null),
          valuesDevText: readFileSync(
            path.join(runnerPath, "infra", "helm", "values-dev.yaml"),
            "utf8"
          )
        });

      assert.equal(git(runnerPath, ["status", "--porcelain"]).trim(), "");
      const dispatchValidation = validateRunner();
      assert.equal(dispatchValidation.ok, true, dispatchValidation.errors.join("; "));

      writeRepoFile(
        seedPath,
        "extensions/persai-browser-extension/security-boundary.ts",
        "export const protectedDrift = true;\n"
      );
      git(seedPath, ["add", "."]);
      git(seedPath, ["commit", "-m", "newer protected build-context drift"]);
      const originDriftSha = git(seedPath, ["rev-parse", "HEAD"]).trim();
      git(seedPath, ["push", "origin", "main"]);

      const pinnedValues = applyPinDevImageTags(proofValues, locked.deferredServices, targetSha);
      writeRepoFile(runnerPath, "infra/helm/values-dev.yaml", pinnedValues);
      git(runnerPath, ["add", "infra/helm/values-dev.yaml"]);
      git(runnerPath, ["commit", "-m", "resume deferred pins"]);

      const stalePreRebaseValidation = validateRunner();
      assert.equal(stalePreRebaseValidation.ok, true, stalePreRebaseValidation.errors.join("; "));

      git(runnerPath, ["pull", "--rebase", "origin", "main"]);
      assert.equal(git(runnerPath, ["status", "--porcelain"]).trim(), "");
      assert.equal(git(runnerPath, ["rev-parse", "origin/main"]).trim(), originDriftSha);
      assert.notEqual(git(runnerPath, ["rev-parse", "HEAD"]).trim(), originDriftSha);

      const postRebaseValidation = validateRunner();
      assert.equal(postRebaseValidation.ok, false);
      assert.match(
        postRebaseValidation.errors.join("\n"),
        /extensions\/persai-browser-extension\/security-boundary\.ts/
      );
      assert.match(postRebaseValidation.errors.join("\n"), /image-tree drift/);
      assert.equal(
        git(tempRoot, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"]).trim(),
        originDriftSha,
        "runner must not push after post-rebase rejection"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
