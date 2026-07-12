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

  const migrationPinCondition = assertMigrationPinJobConditionContract(workflowText);
  if (!migrationPinCondition.ok) {
    errors.push(...migrationPinCondition.errors);
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

const MIGRATION_PIN_JOB_ID = "pin-approved-migration-values-tag";

/**
 * Extract one top-level job's `if:` expression (without `${{ }}` wrapper).
 */
export function extractWorkflowJobIfExpression(workflowText, jobId = MIGRATION_PIN_JOB_ID) {
  const jobBlock = workflowText.match(
    new RegExp(`(?:^|\\n)  ${escapeRegExp(jobId)}:[\\s\\S]*?(?=\\n  [a-z0-9-]+:|\\n*$)`, "u")
  )?.[0];
  if (!jobBlock) {
    throw new Error(`workflow job not found: ${jobId}`);
  }
  const match = jobBlock.match(/^\s+if:\s*\$\{\{\s*([\s\S]*?)\s*\}\}\s*$/mu);
  if (!match) {
    throw new Error(`workflow job ${jobId} is missing a \${{ }} if expression`);
  }
  return match[1].replace(/\s+/gu, " ").trim();
}

/**
 * Explicit dual-path grouping required for migration pin:
 * ((foundation=false && sandbox skipped && approve skipped) ||
 *  (foundation=true && sandbox success && approve success))
 */
export const MIGRATION_PIN_EXPLICIT_DUAL_PATH_GROUPING =
  /\(\(\s*needs\.detect-affected\.outputs\.foundation_rollout\s*!=\s*'true'\s*&&\s*needs\.pin-sandbox-foundation-immediate\.result\s*==\s*'skipped'\s*&&\s*needs\.approve-adr146-foundation-before-migration\.result\s*==\s*'skipped'\s*\)\s*\|\|\s*\(\s*needs\.detect-affected\.outputs\.foundation_rollout\s*==\s*'true'\s*&&\s*needs\.pin-sandbox-foundation-immediate\.result\s*==\s*'success'\s*&&\s*needs\.approve-adr146-foundation-before-migration\.result\s*==\s*'success'\s*\)\)/u;

/**
 * Evaluate a GitHub Actions boolean expression against a fixture context.
 * Supports always(), ==/!=, &&/||, (), needs.*.result, needs.*.outputs.*, github.event_name.
 * Uses Function only after substituting context values into literals (no free identifiers).
 */
export function evaluateGithubActionsBooleanExpression(expression, context = {}) {
  const source = String(expression ?? "")
    .replace(/^\$\{\{\s*/u, "")
    .replace(/\s*\}\}$/u, "")
    .trim();
  if (!source) {
    throw new Error("empty GitHub Actions expression");
  }

  let rewritten = source;
  rewritten = rewritten.replace(/\balways\(\)/gu, "true");
  rewritten = rewritten.replace(
    /\bneeds\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_]+)\b/gu,
    (_m, jobId, outputName) =>
      JSON.stringify(context?.needs?.[jobId]?.outputs?.[outputName] ?? "")
  );
  rewritten = rewritten.replace(
    /\bneeds\.([A-Za-z0-9_-]+)\.result\b/gu,
    (_m, jobId) => JSON.stringify(context?.needs?.[jobId]?.result ?? "")
  );
  rewritten = rewritten.replace(
    /\bgithub\.event_name\b/gu,
    JSON.stringify(context?.github?.event_name ?? "")
  );

  if (
    /[A-Za-z_][A-Za-z0-9_.-]*/u.test(
      rewritten
        .replace(/\btrue\b|\bfalse\b/gu, "")
        .replace(/'(?:\\'|[^'])*'|"(?:\\"|[^"])*"/gu, "")
    )
  ) {
    throw new Error(
      `unsupported or unsubstituted identifiers in GHA expression: ${rewritten}`
    );
  }

  // eslint-disable-next-line no-new-func -- evaluate substituted GHA boolean literals only
  const value = Function(`"use strict"; return (${rewritten});`)();
  return Boolean(value);
}

export function buildMigrationPinConditionContext({
  detectResult = "success",
  eventName = "push",
  deployServicesJson = '["api"]',
  migrationChanged = "true",
  foundationRollout = "false",
  sandboxFoundationResult = "skipped",
  foundationApprovalResult = "skipped"
} = {}) {
  return {
    github: { event_name: eventName },
    needs: {
      "detect-affected": {
        result: detectResult,
        outputs: {
          deploy_services_json: deployServicesJson,
          migration_changed: migrationChanged,
          foundation_rollout: foundationRollout
        }
      },
      "pin-sandbox-foundation-immediate": {
        result: sandboxFoundationResult
      },
      "approve-adr146-foundation-before-migration": {
        result: foundationApprovalResult
      }
    }
  };
}

export function assertMigrationPinJobConditionContract(workflowText) {
  const errors = [];
  let expression;
  try {
    expression = extractWorkflowJobIfExpression(workflowText, MIGRATION_PIN_JOB_ID);
  } catch (error) {
    return { ok: false, errors: [String(error?.message ?? error)], expression: null };
  }

  if (!MIGRATION_PIN_EXPLICIT_DUAL_PATH_GROUPING.test(expression)) {
    errors.push(
      "pin-approved-migration-values-tag if must use explicit ((migration-only) || (foundation+migration)) grouping over foundation_rollout + both optional job results"
    );
  }

  const commonRequired = [
    /always\(\)/u,
    /needs\.detect-affected\.result\s*==\s*'success'/u,
    /github\.event_name\s*==\s*'push'/u,
    /needs\.detect-affected\.outputs\.deploy_services_json\s*!=\s*'\[\]'/u,
    /needs\.detect-affected\.outputs\.migration_changed\s*==\s*'true'/u
  ];
  for (const pattern of commonRequired) {
    if (!pattern.test(expression)) {
      errors.push(`migration pin if missing required common guard: ${pattern}`);
    }
  }

  const migrationOnly = evaluateGithubActionsBooleanExpression(
    expression,
    buildMigrationPinConditionContext({
      foundationRollout: "false",
      sandboxFoundationResult: "skipped",
      foundationApprovalResult: "skipped"
    })
  );
  if (migrationOnly !== true) {
    errors.push("semantic: migration-only (foundation=false, optional jobs skipped) must be true");
  }

  const foundationPlusMigration = evaluateGithubActionsBooleanExpression(
    expression,
    buildMigrationPinConditionContext({
      foundationRollout: "true",
      sandboxFoundationResult: "success",
      foundationApprovalResult: "success"
    })
  );
  if (foundationPlusMigration !== true) {
    errors.push(
      "semantic: foundation+migration (foundation=true, optional jobs success) must be true"
    );
  }

  const rejectCases = [
    {
      label: "migration-only with sandbox failure",
      context: buildMigrationPinConditionContext({
        foundationRollout: "false",
        sandboxFoundationResult: "failure",
        foundationApprovalResult: "skipped"
      })
    },
    {
      label: "migration-only with approve cancelled",
      context: buildMigrationPinConditionContext({
        foundationRollout: "false",
        sandboxFoundationResult: "skipped",
        foundationApprovalResult: "cancelled"
      })
    },
    {
      label: "foundation+migration with sandbox skipped",
      context: buildMigrationPinConditionContext({
        foundationRollout: "true",
        sandboxFoundationResult: "skipped",
        foundationApprovalResult: "success"
      })
    },
    {
      label: "foundation+migration with approve failure",
      context: buildMigrationPinConditionContext({
        foundationRollout: "true",
        sandboxFoundationResult: "success",
        foundationApprovalResult: "failure"
      })
    },
    {
      label: "foundation true but optional jobs skipped",
      context: buildMigrationPinConditionContext({
        foundationRollout: "true",
        sandboxFoundationResult: "skipped",
        foundationApprovalResult: "skipped"
      })
    },
    {
      label: "foundation false but optional jobs success",
      context: buildMigrationPinConditionContext({
        foundationRollout: "false",
        sandboxFoundationResult: "success",
        foundationApprovalResult: "success"
      })
    },
    {
      label: "migration_changed false",
      context: buildMigrationPinConditionContext({
        migrationChanged: "false",
        foundationRollout: "false",
        sandboxFoundationResult: "skipped",
        foundationApprovalResult: "skipped"
      })
    },
    {
      label: "empty deploy list",
      context: buildMigrationPinConditionContext({
        deployServicesJson: "[]",
        foundationRollout: "false",
        sandboxFoundationResult: "skipped",
        foundationApprovalResult: "skipped"
      })
    }
  ];

  for (const { label, context } of rejectCases) {
    const value = evaluateGithubActionsBooleanExpression(expression, context);
    if (value !== false) {
      errors.push(`semantic: ${label} must be false (got ${value})`);
    }
  }

  return { ok: errors.length === 0, errors, expression };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

  const workflow = readDevImagePublishWorkflow();
  const result = assertDevImagePublishFoundationContract(workflow);
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("ADR-146 Dev Image Publish foundation contract OK");
  }
}
