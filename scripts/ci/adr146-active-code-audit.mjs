#!/usr/bin/env node
/**
 * ADR-146 Slice 5 — fail-closed active-code audit for removed legacy egress field
 * and stale product copy. Historical ADR/migration/rejection tests are allowlisted.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");

export const ACTIVE_SCAN_ROOTS = [
  "apps/api/src",
  "apps/api/prisma/schema.prisma",
  "apps/web/app",
  "apps/web/messages",
  "apps/sandbox/src",
  "apps/runtime/src",
  "apps/provider-gateway/src",
  "packages/contracts/openapi.yaml",
  "packages/contracts/src/generated",
  "packages/runtime-contract/src",
  "packages/config/src",
  "infra/helm/templates"
];

const INTENTIONAL_REJECTION_FILE =
  "apps/api/src/modules/workspace-management/application/sandbox-policy.ts";

const RULES = [
  {
    id: "networkAccessEnabled",
    pattern: /networkAccessEnabled/g,
    message: "removed plan field networkAccessEnabled must not appear in active code"
  },
  {
    id: "split-networkAccessEnabled",
    pattern:
      /(["'`])network\1\s*\+\s*(["'`])AccessEnabled\2|(["'`])networkAccess\3\s*\+\s*(["'`])Enabled\4/gi,
    message: "obvious quoted concatenation of removed networkAccessEnabled must not appear"
  },
  {
    id: "sandboxNetworkAccessEnabled",
    pattern: /sandboxNetworkAccessEnabled/g,
    message: "removed sandboxNetworkAccessEnabled alias must not appear in active code"
  },
  {
    id: "allow-sandbox-network-admin-copy",
    pattern: /Allow sandbox network/g,
    message: "removed Admin Plans switch copy must not appear in active code"
  },
  {
    id: "all-proxy-assumption",
    pattern: /all-proxy|every request on Squid|allow-all ACL/gi,
    message: "stale all-proxy egress assumption must not appear in active runtime/contracts"
  }
];

const EGRESS_COPY_SCAN_ROOTS = [
  "apps/web/messages",
  "apps/web/app/app/_components/assistant-sandbox-egress-settings.tsx",
  "apps/web/app/app/_components/assistant-settings.tsx"
];

const EGRESS_COPY_RULE = {
  id: "unlimited-egress-copy",
  pattern:
    /\b(unlimited|unrestricted|без ограничений)\b[\s\S]{0,300}\b(network|internet|egress|sandbox)\b|\b(network|internet|egress|sandbox)\b[\s\S]{0,300}\b(unlimited|unrestricted|без ограничений)\b/gi,
  message:
    "false unlimited/unrestricted sandbox-network copy must not appear in active product strings"
};

function normalizeRelPath(relPath) {
  return relPath.replaceAll("\\", "/");
}

function isAllowlistedPath(relPath) {
  return false;
}

function assertInsideRoot(rootDirectory, candidate) {
  const relative = path.relative(rootDirectory, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`scan path escapes repository root: ${candidate}`);
  }
}

function walkFiles(rootDirectory, rootRelPath, files = []) {
  const absolute = path.resolve(rootDirectory, rootRelPath);
  assertInsideRoot(rootDirectory, absolute);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    const target = realpathSync(absolute);
    assertInsideRoot(rootDirectory, target);
    throw new Error(`symbolic links are not scanned: ${normalizeRelPath(rootRelPath)}`);
  }
  if (stat.isFile()) {
    files.push(rootRelPath);
    return files;
  }
  if (!stat.isDirectory()) {
    throw new Error(`configured scan root is neither file nor directory: ${rootRelPath}`);
  }
  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next") {
      continue;
    }
    walkFiles(rootDirectory, path.join(rootRelPath, entry), files);
  }
  return files;
}

function isScannableFile(relPath) {
  const normalized = normalizeRelPath(relPath);
  if (normalized.endsWith(".test.ts") || normalized.endsWith(".test.tsx")) {
    return false;
  }
  return (
    normalized.endsWith(".ts") ||
    normalized.endsWith(".tsx") ||
    normalized.endsWith(".js") ||
    normalized.endsWith(".yaml") ||
    normalized.endsWith(".yml") ||
    normalized.endsWith(".json") ||
    normalized.endsWith(".mjs") ||
    normalized.endsWith(".prisma")
  );
}

function violationFromMatch(rule, relPath, content, match) {
  const line = content.slice(0, match.index).split(/\r?\n/).length;
  const lineStart = content.lastIndexOf("\n", match.index) + 1;
  const nextNewline = content.indexOf("\n", match.index + match[0].length);
  const lineEnd = nextNewline === -1 ? content.length : nextNewline;
  return {
    ruleId: rule.id,
    file: normalizeRelPath(relPath),
    line,
    message: rule.message,
    excerpt: content.slice(lineStart, lineEnd).replace(/\s+/g, " ").trim().slice(0, 240)
  };
}

function isIntentionalRejectionViolation(violation) {
  return (
    violation.file === INTENTIONAL_REJECTION_FILE &&
    violation.ruleId === "networkAccessEnabled" &&
    (/hasOwnProperty\.call\(row,\s*"networkAccessEnabled"\)/.test(violation.excerpt) ||
      /networkAccessEnabled is not supported/.test(violation.excerpt))
  );
}

export function scanFileForViolations(relPath, content) {
  if (isAllowlistedPath(relPath) || !isScannableFile(relPath)) {
    return [];
  }
  const violations = [];
  for (const rule of RULES) {
    for (const match of content.matchAll(rule.pattern)) {
      const violation = violationFromMatch(rule, relPath, content, match);
      if (!isIntentionalRejectionViolation(violation)) {
        violations.push(violation);
      }
    }
    rule.pattern.lastIndex = 0;
  }
  return violations;
}

export function scanEgressCopyForViolations(relPath, content) {
  if (isAllowlistedPath(relPath) || !isScannableFile(relPath)) {
    return [];
  }
  const violations = [];
  for (const match of content.matchAll(EGRESS_COPY_RULE.pattern)) {
    violations.push(violationFromMatch(EGRESS_COPY_RULE, relPath, content, match));
  }
  EGRESS_COPY_RULE.pattern.lastIndex = 0;
  return violations;
}

export function scanActiveCodeForLegacyEgressViolations(options = {}) {
  const rootDirectory = path.resolve(options.rootDir ?? repoRoot);
  const roots = options.roots ?? ACTIVE_SCAN_ROOTS;
  const copyRoots =
    options.copyRoots ?? (options.roots === undefined ? EGRESS_COPY_SCAN_ROOTS : []);
  const violations = [];
  const scannedFiles = new Set();

  for (const root of roots) {
    for (const relPath of walkFiles(rootDirectory, root)) {
      if (!isScannableFile(relPath) || isAllowlistedPath(relPath)) {
        continue;
      }
      scannedFiles.add(normalizeRelPath(relPath));
      const content = readFileSync(path.join(rootDirectory, relPath), "utf8");
      for (const violation of scanFileForViolations(relPath, content)) {
        violations.push(violation);
      }
    }
  }

  for (const root of copyRoots) {
    for (const relPath of walkFiles(rootDirectory, root)) {
      if (!isScannableFile(relPath) || isAllowlistedPath(relPath)) {
        continue;
      }
      scannedFiles.add(normalizeRelPath(relPath));
      const content = readFileSync(path.join(rootDirectory, relPath), "utf8");
      violations.push(...scanEgressCopyForViolations(relPath, content));
    }
  }

  const minimumScannedFiles =
    options.minimumScannedFiles ?? (options.roots === undefined ? 500 : 1);
  if (scannedFiles.size < minimumScannedFiles) {
    throw new Error(
      `ADR-146 active-code audit scanned ${scannedFiles.size} file(s); minimum is ${minimumScannedFiles}`
    );
  }
  return {
    configuredRootCount: roots.length,
    scannedFileCount: scannedFiles.size,
    violations
  };
}

export function assertActiveCodeLegacyEgressClean(options = {}) {
  const result = scanActiveCodeForLegacyEgressViolations(options);
  if (result.violations.length > 0) {
    const details = result.violations
      .map(
        (violation) =>
          `${violation.file}:${violation.line} [${violation.ruleId}] ${violation.message} — ${violation.excerpt}`
      )
      .join("\n");
    throw new Error(
      `ADR-146 active-code legacy egress audit failed (${result.violations.length} violation(s)):\n${details}`
    );
  }
  return result;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const result = assertActiveCodeLegacyEgressClean();
    process.stdout.write(
      `ADR-146 active-code legacy egress audit PASS (${result.configuredRootCount} roots, ${result.scannedFileCount} files)\n` +
        "Static limitation: lexical audit catches direct/bracket identifiers and simple quoted concatenation; it is not a JavaScript parser.\n"
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
