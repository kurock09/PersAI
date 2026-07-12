#!/usr/bin/env node
/**
 * ADR-146 Slice 0.1b repository release-gate helpers.
 * Pure helpers + workflow-contract assertions (no cloud mutation).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

export const ADR146_FOUNDATION_GITHUB_ENVIRONMENT = "persai-dev-adr146-foundation";
export const ADR146_MIGRATIONS_GITHUB_ENVIRONMENT = "persai-dev-migrations";
export const ADR146_FOUNDATION_IMMEDIATE_SERVICE = "sandbox";

/**
 * Resolve which successfully-built services may pin immediately vs after approval.
 * Fail closed when a foundation rollout is missing a successful sandbox build.
 *
 * Approval chain (GitHub jobs have one Environment each):
 * - foundation-only: [foundation] then pin remaining
 * - migration-only: [migrations] then pin all built
 * - foundation+migration: [foundation approval-only gate] then [migrations pin]
 */
export function resolveFoundationPinPlan({
  foundationRollout,
  migrationChanged,
  successfullyBuiltServices
}) {
  const built = normalizeServiceList(successfullyBuiltServices);
  if (!foundationRollout) {
    const orderedApprovalEnvironments = migrationChanged
      ? [ADR146_MIGRATIONS_GITHUB_ENVIRONMENT]
      : [];
    return {
      foundationRollout: false,
      migrationChanged: Boolean(migrationChanged),
      immediateServices: built,
      deferredServices: [],
      requireSandboxImmediate: false,
      requiresFoundationApproval: false,
      requiresMigrationApproval: Boolean(migrationChanged),
      foundationApprovalOnlyBeforeMigrationPin: false,
      orderedApprovalEnvironments,
      deferredApprovalEnvironment: migrationChanged ? ADR146_MIGRATIONS_GITHUB_ENVIRONMENT : null
    };
  }

  if (!built.includes(ADR146_FOUNDATION_IMMEDIATE_SERVICE)) {
    throw new Error(
      "ADR-146 foundation rollout fail-closed: sandbox image build/pin marker is missing or failed"
    );
  }

  const immediateServices = [ADR146_FOUNDATION_IMMEDIATE_SERVICE];
  const deferredServices = built.filter(
    (service) => service !== ADR146_FOUNDATION_IMMEDIATE_SERVICE
  );
  const both = Boolean(migrationChanged);
  const orderedApprovalEnvironments = both
    ? [ADR146_FOUNDATION_GITHUB_ENVIRONMENT, ADR146_MIGRATIONS_GITHUB_ENVIRONMENT]
    : [ADR146_FOUNDATION_GITHUB_ENVIRONMENT];

  return {
    foundationRollout: true,
    migrationChanged: both,
    immediateServices,
    deferredServices,
    requireSandboxImmediate: true,
    requiresFoundationApproval: true,
    requiresMigrationApproval: both,
    foundationApprovalOnlyBeforeMigrationPin: both,
    orderedApprovalEnvironments,
    // Last Environment that performs remaining pins (foundation-only pins on
    // foundation env; foundation+migration pins on migrations after prior gate).
    deferredApprovalEnvironment: both
      ? ADR146_MIGRATIONS_GITHUB_ENVIRONMENT
      : ADR146_FOUNDATION_GITHUB_ENVIRONMENT
  };
}

export function normalizeServiceList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Assert Dev Image Publish encodes the split-pin contract without CI cloud-apply.
 * Foundation+migration must require BOTH Environments in order.
 */
export function assertDevImagePublishFoundationContract(workflowText) {
  const errors = [];
  const requiredSnippets = [
    "foundation_rollout",
    "foundation_immediate_service_names_csv",
    "foundation_deferred_service_names_csv",
    "pin-sandbox-foundation-immediate",
    "approve-adr146-foundation-before-migration",
    "pin-foundation-deferred-values-tag",
    "pin-approved-migration-values-tag",
    "persai-dev-adr146-foundation",
    "persai-dev-migrations",
    "scripts/ci/adr146-foundation-release-gate.mjs",
    "infra/bootstrap/adr146-sandbox-egress-foundation.json",
    "infra/helm/templates/sandbox-serviceaccount.yaml",
    "infra/helm/templates/networkpolicies.yaml",
    "infra/helm/values.yaml",
    "infra/helm/values-dev.yaml"
  ];

  for (const snippet of requiredSnippets) {
    if (!workflowText.includes(snippet)) {
      errors.push(`missing required workflow contract snippet: ${snippet}`);
    }
  }

  // values-dev must be in the push paths trigger so any non-tag edit
  // enters detect-affected; image-tag-only bot pins may start the workflow but
  // must not recurse (build/pin jobs require non-empty deploy_services_json).
  if (
    !/on:\s*\n\s*push:\s*\n[\s\S]*?paths:\s*\n[\s\S]*?- infra\/helm\/values-dev\.yaml/u.test(
      workflowText
    )
  ) {
    errors.push("Dev Image Publish push paths must include infra/helm/values-dev.yaml");
  }

  if (
    !/build-and-push:[\s\S]*?if: \$\{\{\s*needs\.detect-affected\.outputs\.deploy_services_json != '\[\]'\s*\}\}/u.test(
      workflowText
    )
  ) {
    errors.push("build-and-push must skip when deploy_services_json is empty (bot pin no-loop)");
  }

  if (
    !/pin-dev-values-tag:[\s\S]*deploy_services_json != '\[\]'[\s\S]*foundation_rollout != 'true'/u.test(
      workflowText
    ) &&
    !/pin-dev-values-tag:[\s\S]*foundation_rollout != 'true'[\s\S]*deploy_services_json != '\[\]'/u.test(
      workflowText
    )
  ) {
    // pin-dev-values-tag already checked for foundation_rollout skip; also require empty-deploy skip
    const pinDevJob = workflowText.match(
      /pin-dev-values-tag:[\s\S]*?(?=\n  [a-z0-9-]+:|\n*$)/u
    )?.[0];
    if (!pinDevJob || !/deploy_services_json != '\[\]'/.test(pinDevJob)) {
      errors.push(
        "pin-dev-values-tag must require non-empty deploy_services_json (bot pin no-loop)"
      );
    }
  }

  if (
    !/pin-sandbox-foundation-immediate:[\s\S]*approve-adr146-foundation-before-migration:/u.test(
      workflowText
    )
  ) {
    errors.push(
      "sandbox-immediate pin job must appear before foundation approval-before-migration"
    );
  }

  if (
    !/approve-adr146-foundation-before-migration:[\s\S]*environment:\s*\n\s*name:\s*persai-dev-adr146-foundation/u.test(
      workflowText
    )
  ) {
    errors.push("foundation+migration gate must require persai-dev-adr146-foundation Environment");
  }

  if (
    !/pin-foundation-deferred-values-tag:[\s\S]*environment:\s*\n\s*name:\s*persai-dev-adr146-foundation/u.test(
      workflowText
    )
  ) {
    errors.push("foundation deferred pin must require persai-dev-adr146-foundation Environment");
  }

  if (
    !/pin-approved-migration-values-tag:[\s\S]*environment:\s*\n\s*name:\s*persai-dev-migrations/u.test(
      workflowText
    )
  ) {
    errors.push("migration pin must require persai-dev-migrations Environment");
  }

  if (
    !/pin-approved-migration-values-tag:[\s\S]*needs:[\s\S]*approve-adr146-foundation-before-migration/u.test(
      workflowText
    )
  ) {
    errors.push("migration pin must depend on approve-adr146-foundation-before-migration");
  }

  if (
    !/approve-adr146-foundation-before-migration:[\s\S]*foundation_rollout == 'true'[\s\S]*migration_changed == 'true'/u.test(
      workflowText
    ) &&
    !/approve-adr146-foundation-before-migration:[\s\S]*foundation_rollout == "true"[\s\S]*migration_changed == "true"/u.test(
      workflowText
    )
  ) {
    errors.push(
      "foundation approval-before-migration must run only for foundation+migration composition"
    );
  }

  if (
    !/pin-foundation-deferred-values-tag:[\s\S]*migration_changed != 'true'/u.test(workflowText) &&
    !/pin-foundation-deferred-values-tag:[\s\S]*migration_changed != "true"/u.test(workflowText)
  ) {
    errors.push("foundation deferred pin must skip when migration_changed is true");
  }

  const sandboxJob = workflowText.match(
    /pin-sandbox-foundation-immediate:[\s\S]*?(?=\n  [a-z0-9-]+:|\n*$)/u
  )?.[0];
  if (sandboxJob && /environment:/u.test(sandboxJob)) {
    errors.push("sandbox-immediate pin must not wait on a GitHub Environment");
  }

  if (
    !/pin-dev-values-tag:[\s\S]*foundation_rollout != 'true'/u.test(workflowText) &&
    !/pin-dev-values-tag:[\s\S]*foundation_rollout != "true"/u.test(workflowText)
  ) {
    errors.push("ordinary pin-dev-values-tag must skip foundation rollouts");
  }

  if (/^\s+[^#\n]*(gcloud\s|kubectl\s+apply)/mu.test(workflowText)) {
    errors.push("workflow must not auto-apply cloud foundation mutations");
  }

  if (!workflowText.includes("infra/helm/values-dev.yaml")) {
    errors.push("workflow must continue pinning infra/helm/values-dev.yaml selectively");
  }

  return { ok: errors.length === 0, errors };
}

export function readDevImagePublishWorkflow() {
  return readFileSync(path.join(repoRoot, ".github/workflows/dev-image-publish.yml"), "utf8");
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const mode = process.argv[2] ?? "assert-workflow";
  if (mode === "resolve-pin-plan") {
    const plan = resolveFoundationPinPlan({
      foundationRollout: process.env.FOUNDATION_ROLLOUT === "true",
      migrationChanged: process.env.MIGRATION_CHANGED === "true",
      successfullyBuiltServices: process.env.BUILT_SERVICES ?? ""
    });
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    process.exit(0);
  }

  const result = assertDevImagePublishFoundationContract(readDevImagePublishWorkflow());
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("ADR-146 Dev Image Publish foundation contract OK");
  }
}
