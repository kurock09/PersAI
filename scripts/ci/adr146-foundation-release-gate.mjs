#!/usr/bin/env node
/**
 * ADR-146 Slice 0.1b repository release-gate helpers.
 * Pure helpers + workflow-contract assertions (no cloud mutation).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PIN_DEV_IMAGE_SERVICE_TO_SECTION,
  applyPinDevImageTags,
  analyzePinableServiceImageTags
} from "./pin-dev-image-tags-lib.mjs";
import { ADR146_DEFERRED_RESUME_IMAGE_TREE_PATHS as CENTRALIZED_DEFERRED_RESUME_IMAGE_TREE_PATHS } from "./deploy-build-context-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

export const ADR146_FOUNDATION_GITHUB_ENVIRONMENT = "persai-dev-adr146-foundation";
export const ADR146_MIGRATIONS_GITHUB_ENVIRONMENT = "persai-dev-migrations";
export const ADR146_FOUNDATION_IMMEDIATE_SERVICE = "sandbox";

/** Inventory blob bound into live foundation evidence. */
export const ADR146_FOUNDATION_INVENTORY_REL_PATH =
  "infra/bootstrap/adr146-sandbox-egress-foundation.json";

/** Exact deferred services allowed on the foundation-only resume path. */
export const ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES = Object.freeze([
  "api",
  "web",
  "runtime",
  "provider-gateway"
]);

/**
 * Paths whose drift between target_image_sha and HEAD must fail closed.
 * Shared with root-context build inputs used by detect-affected.
 */
export const ADR146_FOUNDATION_DEFERRED_RESUME_IMAGE_TREE_PATHS =
  CENTRALIZED_DEFERRED_RESUME_IMAGE_TREE_PATHS;

/** Prisma-relevant paths used for migration_changed=false safety. */
export const ADR146_FOUNDATION_DEFERRED_RESUME_PRISMA_PATHS = Object.freeze([
  "apps/api/prisma",
  "apps/api/prisma/schema.prisma"
]);

/**
 * Locked current resume case (coordinated push images + live sandbox proof).
 * target images from 3cd2ea4f; proof/inventory from e5c249c3 restricted gate PASS.
 */
export const ADR146_FOUNDATION_DEFERRED_RESUME_LOCKED_CASE = Object.freeze({
  targetImageSha: "3cd2ea4fa0c82d319c2e8e63724c5753f03b5e0f",
  deferredServices: Object.freeze(["api", "web", "runtime", "provider-gateway"]),
  sandboxProofCommitSha: "e5c249c3dbb9d16406b85637e9dcdd9a418a8a79",
  evidenceInventorySha256: "c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7",
  migrationChanged: false
});

export const ADR146_FOUNDATION_DEFERRED_RESUME_WORKFLOW_REL_PATH =
  ".github/workflows/adr146-foundation-deferred-pin-resume.yml";

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

export function readFoundationDeferredResumeWorkflow() {
  return readFileSync(
    path.join(repoRoot, ADR146_FOUNDATION_DEFERRED_RESUME_WORKFLOW_REL_PATH),
    "utf8"
  );
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
    (_m, jobId, outputName) => JSON.stringify(context?.needs?.[jobId]?.outputs?.[outputName] ?? "")
  );
  rewritten = rewritten.replace(/\bneeds\.([A-Za-z0-9_-]+)\.result\b/gu, (_m, jobId) =>
    JSON.stringify(context?.needs?.[jobId]?.result ?? "")
  );
  rewritten = rewritten.replace(
    /\bgithub\.event_name\b/gu,
    JSON.stringify(context?.github?.event_name ?? "")
  );

  if (
    /[A-Za-z_][A-Za-z0-9_.-]*/u.test(
      rewritten.replace(/\btrue\b|\bfalse\b/gu, "").replace(/'(?:\\'|[^'])*'|"(?:\\"|[^"])*"/gu, "")
    )
  ) {
    throw new Error(`unsupported or unsubstituted identifiers in GHA expression: ${rewritten}`);
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

function defaultGitExec(args, { cwd = repoRoot } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trimEnd();
}

function defaultReadGitBlob(commitSha, relPath, { cwd = repoRoot } = {}) {
  return execFileSync("git", ["show", `${commitSha}:${relPath}`], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

export function normalizeCommitSha(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{7,40}$/u.test(value)) {
    throw new Error(`invalid commit SHA: ${String(raw ?? "")}`);
  }
  return value;
}

export function normalizeInventorySha256(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`invalid inventory SHA-256: ${String(raw ?? "")}`);
  }
  return value;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeDeferredResumeServiceList(raw) {
  const services = normalizeServiceList(raw);
  const seen = new Set();
  const ordered = [];
  for (const service of services) {
    if (seen.has(service)) {
      throw new Error(`duplicate deferred resume service: ${service}`);
    }
    seen.add(service);
    ordered.push(service);
  }
  return ordered;
}

export function readServiceImageTagFromValuesDevText(fileText, serviceName) {
  const section = PIN_DEV_IMAGE_SERVICE_TO_SECTION[serviceName];
  if (!section) {
    throw new Error(`unsupported values-dev service: ${serviceName}`);
  }
  const { tags, ok } = analyzePinableServiceImageTags(fileText);
  if (!ok) {
    throw new Error("unable to analyze values-dev image tags");
  }
  const tag = tags.get(section);
  if (!tag || !String(tag).trim()) {
    throw new Error(`missing values-dev image.tag for service ${serviceName}`);
  }
  return String(tag).trim();
}

/**
 * Assert a foundation-only deferred-pin resume request.
 * Fail closed for migration_changed=true in this slice (no weak dual-gate).
 */
export function assertFoundationDeferredResumeRequest(input, deps = {}) {
  const errors = [];
  const gitExec = deps.gitExec ?? defaultGitExec;
  const headSha = String(deps.headSha ?? gitExec(["rev-parse", "HEAD"])).trim();
  const valuesDevText =
    deps.valuesDevText ?? readFileSync(path.join(repoRoot, "infra/helm/values-dev.yaml"), "utf8");
  const readGitBlob = deps.readGitBlob ?? defaultReadGitBlob;
  const listChangedPaths =
    deps.listChangedPaths ??
    ((fromSha, toSha, paths) => {
      const out = gitExec(["diff", "--name-only", `${fromSha}..${toSha}`, "--", ...paths]);
      return out
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    });
  const isAncestor =
    deps.isAncestor ??
    ((maybeAncestor, descendant) => {
      try {
        gitExec(["merge-base", "--is-ancestor", maybeAncestor, descendant]);
        return true;
      } catch {
        return false;
      }
    });
  const resolveSha =
    deps.resolveSha ?? ((raw) => normalizeCommitSha(gitExec(["rev-parse", `${raw}^{commit}`])));

  let targetImageSha;
  let sandboxProofCommitSha;
  let evidenceInventorySha256;
  let deferredServices;
  try {
    targetImageSha = resolveSha(input.targetImageSha);
    sandboxProofCommitSha = resolveSha(input.sandboxProofCommitSha);
    evidenceInventorySha256 = normalizeInventorySha256(input.evidenceInventorySha256);
    deferredServices = normalizeDeferredResumeServiceList(input.deferredServices);
  } catch (error) {
    return {
      ok: false,
      errors: [String(error?.message ?? error)],
      summary: null
    };
  }

  const migrationChangedRaw = input.migrationChanged;
  if (migrationChangedRaw !== false && migrationChangedRaw !== "false") {
    errors.push(
      'ADR-146 deferred-pin resume is foundation-only: migration_changed must be boolean false or exact string "false"; every other value fails closed'
    );
  }

  if (deferredServices.length === 0) {
    errors.push("deferred_services must be a non-empty CSV of allowed services");
  }

  const allowed = new Set(ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES);
  for (const service of deferredServices) {
    if (service === "sandbox" || service === "sandbox-exec") {
      errors.push(`sandbox must not appear in deferred resume services (got ${service})`);
      continue;
    }
    if (!allowed.has(service)) {
      errors.push(
        `deferred resume service not allowed: ${service} (allowed: ${ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES.join(",")})`
      );
    }
  }
  if (
    deferredServices.length !== ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES.length ||
    ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES.some(
      (service) => !deferredServices.includes(service)
    )
  ) {
    errors.push(
      `this one-off resume requires exact deferred service set: ${ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES.join(",")}`
    );
  }

  if (!isAncestor(targetImageSha, headSha)) {
    errors.push(`target_image_sha ${targetImageSha} must be an ancestor of HEAD ${headSha}`);
  }
  if (!isAncestor(sandboxProofCommitSha, headSha)) {
    errors.push(
      `sandbox_proof_commit_sha ${sandboxProofCommitSha} must be an ancestor of HEAD ${headSha}`
    );
  }

  let proofInventorySha;
  try {
    const proofBytes = readGitBlob(sandboxProofCommitSha, ADR146_FOUNDATION_INVENTORY_REL_PATH);
    proofInventorySha = sha256Hex(proofBytes);
    if (proofInventorySha !== evidenceInventorySha256) {
      errors.push(
        `evidence_inventory_sha256 mismatch for ${sandboxProofCommitSha}:${ADR146_FOUNDATION_INVENTORY_REL_PATH}: expected ${evidenceInventorySha256}, got ${proofInventorySha}`
      );
    }
  } catch (error) {
    errors.push(
      `unable to hash committed inventory at proof SHA: ${String(error?.message ?? error)}`
    );
  }

  let currentSandboxTag;
  let proofSandboxTag;
  try {
    currentSandboxTag = readServiceImageTagFromValuesDevText(valuesDevText, "sandbox");
    const proofValues = readGitBlob(sandboxProofCommitSha, "infra/helm/values-dev.yaml").toString(
      "utf8"
    );
    proofSandboxTag = readServiceImageTagFromValuesDevText(proofValues, "sandbox");
    if (currentSandboxTag !== proofSandboxTag) {
      errors.push(
        `values-dev sandbox.image.tag must remain bound to proof commit tag ${proofSandboxTag} (got ${currentSandboxTag})`
      );
    }
  } catch (error) {
    errors.push(`sandbox proof tag binding failed: ${String(error?.message ?? error)}`);
  }

  try {
    const imageTreeDrift = listChangedPaths(targetImageSha, headSha, [
      ...ADR146_FOUNDATION_DEFERRED_RESUME_IMAGE_TREE_PATHS
    ]);
    if (imageTreeDrift.length > 0) {
      errors.push(
        `app/package image-tree drift between target_image_sha and HEAD blocks stale pin: ${imageTreeDrift.join(", ")}`
      );
    }
  } catch (error) {
    errors.push(`image-tree drift check failed: ${String(error?.message ?? error)}`);
  }

  try {
    const currentApiTag = readServiceImageTagFromValuesDevText(valuesDevText, "api");
    const apiPinSha = resolveSha(currentApiTag);
    const prismaDrift = listChangedPaths(apiPinSha, targetImageSha, [
      ...ADR146_FOUNDATION_DEFERRED_RESUME_PRISMA_PATHS
    ]);
    if (prismaDrift.length > 0) {
      errors.push(
        `prisma-relevant drift between currently pinned api.image.tag ${apiPinSha} and target_image_sha ${targetImageSha} requires migration_changed handling (unsupported here): ${prismaDrift.join(", ")}`
      );
    }
  } catch (error) {
    errors.push(`prisma migration safety check failed: ${String(error?.message ?? error)}`);
  }

  const summary = {
    targetImageSha,
    deferredServices,
    sandboxProofCommitSha,
    evidenceInventorySha256,
    migrationChanged: false,
    headSha,
    sandboxImageTag: currentSandboxTag ?? null,
    proofInventorySha256: proofInventorySha ?? null
  };

  return { ok: errors.length === 0, errors, summary };
}

/**
 * Prove a resume pin changes only the exact authoritative deferred image.tag
 * scalars and leaves every other byte/tag untouched.
 */
export function assertFoundationDeferredResumePinMutation({
  baseValuesDevText,
  headValuesDevText,
  targetImageSha,
  deferredServices
}) {
  const errors = [];
  let services;
  let targetSha;
  try {
    services = normalizeDeferredResumeServiceList(deferredServices);
    targetSha = normalizeCommitSha(targetImageSha);
  } catch (error) {
    return { ok: false, errors: [String(error?.message ?? error)] };
  }

  if (
    services.length !== ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES.length ||
    ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES.some(
      (service) => !services.includes(service)
    )
  ) {
    errors.push(
      `pin mutation requires exact deferred service set: ${ADR146_FOUNDATION_DEFERRED_RESUME_ALLOWED_SERVICES.join(",")}`
    );
  }

  const expected = applyPinDevImageTags(baseValuesDevText, services, targetSha);
  // CRLF→LF only. Do not strip trailing newlines: EOF blank-line drift must
  // remain fail-closed (the live resume failure was an extra trailing `\n`).
  const normalizedHead = String(headValuesDevText).replace(/\r\n/gu, "\n");
  const normalizedExpected = expected.replace(/\r\n/gu, "\n");
  if (normalizedHead !== normalizedExpected) {
    errors.push(
      "resume pin mutation must equal authoritative pin-dev-image-tags output exactly (no unrelated values-dev mutation)"
    );
  }
  if (String(baseValuesDevText).replace(/\r\n/gu, "\n") === normalizedHead) {
    errors.push("resume pin mutation must change at least one deferred image.tag scalar");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate either the worktree mutation (`headRef=WORKTREE`) or one committed
 * pin (`baseRef..headRef`). The committed form also requires exactly one
 * changed path: infra/helm/values-dev.yaml.
 */
export function assertFoundationDeferredResumePinState(
  { baseRef, headRef, targetImageSha, deferredServices },
  deps = {}
) {
  const errors = [];
  const gitExec = deps.gitExec ?? defaultGitExec;
  const readGitBlob = deps.readGitBlob ?? defaultReadGitBlob;
  const valuesPath = "infra/helm/values-dev.yaml";
  const readWorktree =
    deps.readWorktree ??
    (() => readFileSync(path.join(repoRoot, "infra/helm/values-dev.yaml"), "utf8"));

  let baseText;
  let headText;
  try {
    baseText = readGitBlob(baseRef, valuesPath).toString("utf8");
    if (headRef === "WORKTREE") {
      const status = gitExec(["status", "--porcelain=v1"]);
      if (status !== ` M ${valuesPath}`) {
        errors.push(
          `resume pin worktree must contain only unstaged ${valuesPath} (got ${status || "<clean>"})`
        );
      }
      headText = readWorktree();
    } else {
      const changedPaths = gitExec(["diff", "--name-only", `${baseRef}..${headRef}`])
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      if (changedPaths.length !== 1 || changedPaths[0] !== valuesPath) {
        errors.push(
          `resume pin commit must change only ${valuesPath} (got ${changedPaths.join(",") || "<none>"})`
        );
      }
      headText = readGitBlob(headRef, valuesPath).toString("utf8");
    }
  } catch (error) {
    return {
      ok: false,
      errors: [...errors, `resume pin state read failed: ${String(error?.message ?? error)}`]
    };
  }

  const mutation = assertFoundationDeferredResumePinMutation({
    baseValuesDevText: baseText,
    headValuesDevText: headText,
    targetImageSha,
    deferredServices
  });
  errors.push(...mutation.errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Assert the dedicated deferred-pin resume workflow contract.
 * Must not relax ordinary Dev Image Publish push-only split-pin guards.
 */
export function assertFoundationDeferredResumeWorkflowContract(workflowText) {
  const errors = [];
  const requiredSnippets = [
    "workflow_dispatch",
    "target_image_sha",
    "deferred_services",
    "sandbox_proof_commit_sha",
    "evidence_inventory_sha256",
    "migration_changed",
    "validate-resume",
    "pin-foundation-deferred-resume",
    "persai-dev-adr146-foundation",
    "scripts/ci/adr146-foundation-release-gate.mjs",
    "assert-resume",
    "pin-dev-image-tags.mjs",
    "infra/helm/values-dev.yaml",
    "docker manifest inspect",
    "resume ADR-146 foundation deferred pins",
    "assert-resume-pin-state",
    "git fetch origin main",
    "git checkout -B main origin/main",
    "git pull --rebase origin main"
  ];
  for (const snippet of requiredSnippets) {
    if (!workflowText.includes(snippet)) {
      errors.push(`missing required resume workflow snippet: ${snippet}`);
    }
  }

  if (!/^\s*on:\s*\n\s*workflow_dispatch:/mu.test(workflowText)) {
    errors.push("resume workflow must be workflow_dispatch-only (no push trigger)");
  }
  if (/^\s*push:/mu.test(workflowText)) {
    errors.push("resume workflow must not listen to push events");
  }

  if (
    !/pin-foundation-deferred-resume:[\s\S]*environment:\s*\n\s*name:\s*persai-dev-adr146-foundation/u.test(
      workflowText
    )
  ) {
    errors.push("resume pin job must require persai-dev-adr146-foundation Environment");
  }

  const validateJob = workflowText.match(/validate-resume:[\s\S]*?(?=\n  [a-z0-9-]+:|\n*$)/u)?.[0];
  if (!validateJob) {
    errors.push("missing validate-resume job");
  } else if (/environment:/u.test(validateJob)) {
    errors.push("validate-resume must not wait on a GitHub Environment");
  }

  if (/build-and-push:/u.test(workflowText) || /docker\/build-push-action/u.test(workflowText)) {
    errors.push("resume workflow must not rebuild/push images");
  }

  const authSteps = workflowText
    .split("uses: google-github-actions/auth@v3")
    .slice(1)
    .map((segment) => segment.split(/\n      - name:/u)[0]);
  if (authSteps.length === 0) {
    errors.push("resume workflow must contain Google auth steps for GAR manifest checks");
  }
  for (const [index, authStep] of authSteps.entries()) {
    if (!/token_format:\s*access_token/u.test(authStep)) {
      errors.push(`resume auth step ${index + 1} must emit access_token`);
    }
    if (!/create_credentials_file:\s*false/u.test(authStep)) {
      errors.push(
        `resume auth step ${index + 1} must set create_credentials_file: false (no gha-creds worktree pollution)`
      );
    }
  }

  const pinJob = workflowText.match(
    /pin-foundation-deferred-resume:[\s\S]*?(?=\n  [a-z0-9-]+:|\n*$)/u
  )?.[0];
  if (!pinJob) {
    errors.push("missing pin-foundation-deferred-resume job");
  } else {
    if (
      !/uses:\s*actions\/checkout@v5[\s\S]*?with:\s*\n\s*ref:\s*main\s*\n\s*fetch-depth:\s*0/u.test(
        pinJob
      )
    ) {
      errors.push("Environment-gated pin job checkout must use ref: main and fetch-depth: 0");
    }

    const freshFetch = pinJob.indexOf("git fetch origin main");
    const freshCheckout = pinJob.indexOf("git checkout -B main origin/main");
    const gatedAssert = pinJob.indexOf("assert-resume", freshCheckout);
    const pinMutation = pinJob.indexOf("pin-dev-image-tags.mjs", gatedAssert);
    if (
      freshFetch < 0 ||
      freshCheckout <= freshFetch ||
      gatedAssert <= freshCheckout ||
      pinMutation <= gatedAssert
    ) {
      errors.push(
        "Environment-gated pin job must fetch current origin/main, reset branch to origin/main, then assert-resume before pinning"
      );
    }

    const pullRebase = pinJob.indexOf("git pull --rebase origin main");
    const postRebaseAssert = pinJob.indexOf("assert_resume", pullRebase);
    const postRebasePinState = pinJob.indexOf("assert_pin_commit", postRebaseAssert);
    const retryPush = pinJob.indexOf("git push origin HEAD:main", postRebasePinState);
    if (
      pullRebase < 0 ||
      postRebaseAssert <= pullRebase ||
      postRebasePinState <= postRebaseAssert ||
      retryPush <= postRebasePinState
    ) {
      errors.push(
        "every pull --rebase retry must be followed by assert-resume and pin-state validation before the next push"
      );
    }
  }

  if (/^\s+[^#\n]*(gcloud\s|kubectl\s+apply)/mu.test(workflowText)) {
    errors.push("resume workflow must not auto-apply cloud foundation mutations");
  }

  if (
    !/migration_changed[\s\S]*options:\s*\n\s*-\s*['"]?false['"]?/u.test(workflowText) &&
    !/migration_changed[\s\S]*default:\s*['"]false['"]/u.test(workflowText)
  ) {
    errors.push("resume workflow must fail closed to foundation-only (migration_changed=false)");
  }

  if (/persai-dev-migrations/u.test(workflowText)) {
    errors.push("foundation-only resume must not wire persai-dev-migrations in this slice");
  }

  if (
    !/pin-dev-image-tags\.mjs[\s\S]*--services[\s\S]*TARGET_SERVICES|TARGET_SERVICES[\s\S]*pin-dev-image-tags\.mjs/u.test(
      workflowText
    )
  ) {
    errors.push("resume pin must invoke pin-dev-image-tags.mjs for deferred services only");
  }

  if (/sandbox-exec/u.test(workflowText) && /--services[^\n]*sandbox/u.test(workflowText)) {
    errors.push("resume pin must never include sandbox in --services");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Prove ordinary Dev Image Publish pin jobs remain push-only (no dispatch bypass).
 */
export function assertDevImagePublishPinJobsRemainPushOnly(
  workflowText = readDevImagePublishWorkflow()
) {
  const errors = [];
  const pinJobs = [
    "pin-sandbox-foundation-immediate",
    "pin-foundation-deferred-values-tag",
    "pin-approved-migration-values-tag",
    "pin-dev-values-tag",
    "approve-adr146-foundation-before-migration"
  ];
  for (const jobId of pinJobs) {
    const block = workflowText.match(
      new RegExp(`(?:^|\\n)  ${escapeRegExp(jobId)}:[\\s\\S]*?(?=\\n  [a-z0-9-]+:|\\n*$)`, "u")
    )?.[0];
    if (!block) {
      errors.push(`missing Dev Image Publish job ${jobId}`);
      continue;
    }
    if (
      !/github\.event_name\s*==\s*'push'/u.test(block) &&
      !/github\.event_name\s*==\s*"push"/u.test(block)
    ) {
      errors.push(`${jobId} must remain guarded by github.event_name == 'push'`);
    }
  }
  return { ok: errors.length === 0, errors };
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

  if (mode === "assert-resume") {
    const result = assertFoundationDeferredResumeRequest({
      targetImageSha: process.env.TARGET_IMAGE_SHA ?? process.argv[3],
      deferredServices: process.env.DEFERRED_SERVICES ?? process.argv[4],
      sandboxProofCommitSha: process.env.SANDBOX_PROOF_COMMIT_SHA ?? process.argv[5],
      evidenceInventorySha256: process.env.EVIDENCE_INVENTORY_SHA256 ?? process.argv[6],
      migrationChanged: process.env.MIGRATION_CHANGED ?? process.argv[7]
    });
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else {
      // Machine-readable summary only on stdout for workflow consumers.
      process.stdout.write(`${JSON.stringify(result.summary)}\n`);
      console.error("ADR-146 foundation deferred-pin resume request OK");
    }
    process.exit(process.exitCode ?? 0);
  }

  if (mode === "assert-resume-workflow") {
    const workflow = readFoundationDeferredResumeWorkflow();
    const result = assertFoundationDeferredResumeWorkflowContract(workflow);
    const pushOnly = assertDevImagePublishPinJobsRemainPushOnly();
    const errors = [...(result.ok ? [] : result.errors), ...(pushOnly.ok ? [] : pushOnly.errors)];
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("ADR-146 foundation deferred-pin resume workflow contract OK");
    }
    process.exit(process.exitCode ?? 0);
  }

  if (mode === "assert-resume-pin-state") {
    const result = assertFoundationDeferredResumePinState({
      baseRef: process.env.BASE_REF ?? process.argv[3],
      headRef: process.env.HEAD_REF ?? process.argv[4],
      targetImageSha: process.env.TARGET_IMAGE_SHA ?? process.argv[5],
      deferredServices: process.env.DEFERRED_SERVICES ?? process.argv[6]
    });
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("ADR-146 foundation deferred-pin state OK");
    }
    process.exit(process.exitCode ?? 0);
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
