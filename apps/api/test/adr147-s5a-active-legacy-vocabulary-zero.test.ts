import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ADR-147 S5a active-legacy-vocabulary zero gate.
 *
 * Fail-closed scan of every configured active root. Physical Prisma residue and
 * immutable historical migrations use exact path+term+exactCount allowances.
 * Historical/absence wording uses the same exact-count contract. No wildcards.
 * No allowance may apply to production code.
 */

const GATE_REL_POSIX = "apps/api/test/adr147-s5a-active-legacy-vocabulary-zero.test.ts";

const SCAN_ROOTS = [
  "apps/api/src",
  "apps/api/test",
  "apps/web/app",
  "apps/web/messages",
  "apps/runtime/src",
  "apps/runtime/test",
  "apps/provider-gateway/src",
  "apps/provider-gateway/test",
  "apps/sandbox/src",
  "apps/sandbox/test",
  "extensions/persai-browser-extension/src",
  "extensions/persai-browser-extension/test",
  "packages/contracts/openapi.yaml",
  "packages/contracts/src/generated",
  "packages/persai-admin-mcp/src",
  "packages/persai-admin-mcp/test",
  "packages/persai-admin-mcp/README.md",
  "packages/runtime-bundle/src",
  "packages/runtime-contract/src",
  "packages/config/src",
  "packages/types/src",
  "apps/api/prisma/schema.prisma",
  "apps/api/prisma/migrations",
  "docs/SESSION-HANDOFF.md",
  "docs/CHANGELOG.md",
  "docs/ARCHITECTURE.md",
  "docs/API-BOUNDARY.md",
  "docs/DATA-MODEL.md",
  "docs/TEST-PLAN.md",
  "docs/SKILLS-GROWTH-PLAYBOOK.md",
  "docs/ADR/136-operator-api-access-and-cursor-mcp.md",
  "docs/ADR/147-assistant-roles-and-effective-skills.md"
] as const;

type ExactAllowance = {
  path: string;
  termId: string;
  exactCount: number;
};

/** Current Prisma model/enum/relation residue — exact path + term + count only. */
const PHYSICAL_RESIDUE_ALLOWANCES: ExactAllowance[] = [
  {
    path: "apps/api/prisma/schema.prisma",
    termId: "AssistantSkillAssignment",
    exactCount: 7
  },
  {
    path: "apps/api/prisma/schema.prisma",
    termId: "assistantSkillAssignment",
    exactCount: 2
  },
  {
    path: "apps/api/prisma/schema.prisma",
    termId: "assistant_skill_assignments",
    exactCount: 1
  },
  {
    path: "apps/api/prisma/schema.prisma",
    termId: "AssistantSkillAssignmentStatus",
    exactCount: 2
  },
  {
    path: "apps/api/prisma/migrations/20260501120000_adr079_knowledge_skills_foundation/migration.sql",
    termId: "AssistantSkillAssignment",
    exactCount: 2
  },
  {
    path: "apps/api/prisma/migrations/20260501120000_adr079_knowledge_skills_foundation/migration.sql",
    termId: "assistant_skill_assignments",
    exactCount: 16
  },
  {
    path: "apps/api/prisma/migrations/20260501120000_adr079_knowledge_skills_foundation/migration.sql",
    termId: "AssistantSkillAssignmentStatus",
    exactCount: 2
  },
  {
    path: "apps/api/prisma/migrations/20260505214500_adr079_skill_decision_and_cadence_state/migration.sql",
    termId: "assistant_skill_assignments",
    exactCount: 1
  }
];

/**
 * Honest historical / absence wording — exact path + term + exactCount.
 * Must not apply to production code (enforced separately).
 */
const HISTORICAL_WORDING_ALLOWANCES: ExactAllowance[] = [
  // ADR-147 documents cutover and remaining S5b physical drop.
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "AssistantSkillAssignment",
    exactCount: 6
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "assistant_skill_assignments",
    exactCount: 2
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "/assistant/skills",
    exactCount: 3
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "assistant_skills_assign",
    exactCount: 5
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "maxEnabledSkills",
    exactCount: 3
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "max_enabled_skills",
    exactCount: 1
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "enabled_skills_limit",
    exactCount: 1
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "skill_assignments_limit",
    exactCount: 1
  },
  {
    path: "docs/ADR/147-assistant-roles-and-effective-skills.md",
    termId: "skillPolicy",
    exactCount: 2
  },
  // Current handoff / changelog historical wording.
  {
    path: "docs/SESSION-HANDOFF.md",
    termId: "AssistantSkillAssignment",
    exactCount: 3
  },
  {
    path: "docs/SESSION-HANDOFF.md",
    termId: "/assistant/skills",
    exactCount: 2
  },
  {
    path: "docs/SESSION-HANDOFF.md",
    termId: "manage-assistant-skills",
    exactCount: 2
  },
  {
    path: "docs/SESSION-HANDOFF.md",
    termId: "assistant_skills_assign",
    exactCount: 2
  },
  {
    path: "docs/SESSION-HANDOFF.md",
    termId: "factSkills",
    exactCount: 3
  },
  {
    path: "docs/CHANGELOG.md",
    termId: "AssistantSkillAssignment",
    exactCount: 1
  },
  {
    path: "docs/CHANGELOG.md",
    termId: "/assistant/skills",
    exactCount: 2
  },
  {
    path: "docs/CHANGELOG.md",
    termId: "manage-assistant-skills",
    exactCount: 3
  },
  {
    path: "docs/CHANGELOG.md",
    termId: "assistant_skills_assign",
    exactCount: 2
  },
  {
    path: "docs/CHANGELOG.md",
    termId: "skillPolicy",
    exactCount: 1
  },
  {
    path: "docs/CHANGELOG.md",
    termId: "AdminPlanSkillPolicy",
    exactCount: 1
  },
  {
    path: "docs/CHANGELOG.md",
    termId: "factSkills",
    exactCount: 2
  },
  // S1/S2 authority / absence gates.
  {
    path: "apps/api/test/adr147-s1-assistant-roles-schema.test.ts",
    termId: "AssistantSkillAssignment",
    exactCount: 1
  },
  {
    path: "apps/api/test/adr147-s1-assistant-roles-schema.test.ts",
    termId: "assistantSkillAssignment",
    exactCount: 2
  },
  {
    path: "apps/api/test/adr147-s1-assistant-roles-schema.test.ts",
    termId: "assistant_skill_assignments",
    exactCount: 1
  },
  {
    path: "apps/api/test/adr147-s1-assistant-roles-schema.test.ts",
    termId: "manage-assistant-skills",
    exactCount: 1
  },
  {
    path: "apps/api/test/adr147-s1-assistant-roles-schema.test.ts",
    termId: "assistant-skills.controller",
    exactCount: 1
  },
  {
    path: "apps/api/test/adr147-s2-role-only-effective-skills-source.test.ts",
    termId: "AssistantSkillAssignment",
    exactCount: 1
  },
  {
    path: "apps/api/test/adr147-s2-role-only-effective-skills-source.test.ts",
    termId: "assistantSkillAssignment",
    exactCount: 1
  },
  {
    path: "apps/api/test/adr147-s2-role-only-effective-skills-source.test.ts",
    termId: "manage-assistant-skills",
    exactCount: 1
  },
  {
    path: "apps/api/test/adr147-s2-role-only-effective-skills-source.test.ts",
    termId: "assistant-skills.controller",
    exactCount: 1
  },
  // Plan update fixtures prove ignore + preserve without Admin/Public exposure.
  {
    path: "apps/api/test/manage-admin-plans.service.test.ts",
    termId: "skillPolicy",
    exactCount: 9
  },
  {
    path: "apps/api/test/manage-admin-plans.service.test.ts",
    termId: "maxEnabledSkills",
    exactCount: 3
  },
  {
    path: "apps/api/test/manage-admin-plans.service.test.ts",
    termId: "max_enabled_skills",
    exactCount: 2
  },
  {
    path: "apps/api/test/manage-admin-plans.service.test.ts",
    termId: "enabled_skills_limit",
    exactCount: 2
  },
  {
    path: "apps/api/test/manage-admin-plans.service.test.ts",
    termId: "skill_assignments_limit",
    exactCount: 2
  },
  // Admin-delete: no explicit table DELETE + Assistant FK Cascade pin.
  {
    path: "apps/api/test/admin-delete-user.service.test.ts",
    termId: "assistant_skill_assignments",
    exactCount: 4
  },
  {
    path: "apps/api/test/admin-delete-user.service.test.ts",
    termId: "AssistantSkillAssignment",
    exactCount: 1
  },
  // Pricing copy absence.
  {
    path: "apps/web/app/_components/pricing-page-view.test.tsx",
    termId: "factSkills",
    exactCount: 3
  }
];

const ALL_ALLOWANCES: ExactAllowance[] = [
  ...PHYSICAL_RESIDUE_ALLOWANCES,
  ...HISTORICAL_WORDING_ALLOWANCES
];

const FORBIDDEN_TERMS: Array<{ id: string; term: string }> = [
  { id: "AssistantSkillAssignment", term: "AssistantSkillAssignment" },
  { id: "assistantSkillAssignment", term: "assistantSkillAssignment" },
  { id: "assistant_skill_assignments", term: "assistant_skill_assignments" },
  { id: "/assistant/skills", term: "/assistant/skills" },
  { id: "getAssistantSkills", term: "getAssistantSkills" },
  { id: "updateAssistantSkillAssignments", term: "updateAssistantSkillAssignments" },
  { id: "putAssistantSkillAssignments", term: "putAssistantSkillAssignments" },
  { id: "ManageAssistantSkillsService", term: "ManageAssistantSkillsService" },
  { id: "AssistantSkillsController", term: "AssistantSkillsController" },
  { id: "manage-assistant-skills", term: "manage-assistant-skills" },
  { id: "assistant-skills.controller", term: "assistant-skills.controller" },
  { id: "assistant_skills_assign", term: "assistant_skills_assign" },
  { id: "maxEnabledSkills", term: "maxEnabledSkills" },
  { id: "max_enabled_skills", term: "max_enabled_skills" },
  { id: "enabled_skills_limit", term: "enabled_skills_limit" },
  { id: "skill_assignments_limit", term: "skill_assignments_limit" },
  { id: "skillPolicy", term: "skillPolicy" },
  { id: "AdminPlanSkillPolicy", term: "AdminPlanSkillPolicy" },
  { id: "adminPlanSkillPolicy", term: "adminPlanSkillPolicy" },
  { id: "factSkills", term: "factSkills" },
  { id: "GetAssistantSkillsResponse", term: "GetAssistantSkillsResponse" },
  {
    id: "PutAssistantSkillAssignmentsRequest",
    term: "PutAssistantSkillAssignmentsRequest"
  },
  { id: "AssistantSkillAssignmentState", term: "AssistantSkillAssignmentState" },
  { id: "AssistantSkillCatalogItemState", term: "AssistantSkillCatalogItemState" },
  { id: "AssistantSkillsState", term: "AssistantSkillsState" },
  {
    id: "parseAssistantSkillAssignmentsInput",
    term: "parseAssistantSkillAssignmentsInput"
  },
  {
    id: "toAssistantSkillAssignmentState",
    term: "toAssistantSkillAssignmentState"
  },
  {
    id: "AssistantSkillAssignmentStatus",
    term: "AssistantSkillAssignmentStatus"
  }
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".sql",
  ".prisma"
]);

function toPosix(pathValue: string): string {
  return pathValue.split(/[/\\]/).join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quotedConcat(parts: string[]): RegExp {
  const body = parts.map((part) => `['"]${escapeRegExp(part)}['"]`).join("\\s*\\+\\s*");
  return new RegExp(body, "g");
}

function splitCamelParts(term: string): string[] | null {
  const parts = term.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g);
  return parts !== null && parts.length >= 2 ? parts : null;
}

function buildDetectionPatterns(term: string): RegExp[] {
  const escaped = escapeRegExp(term);
  const patterns: RegExp[] = [
    new RegExp(escaped, "g"),
    new RegExp(`\\[\\s*['"]${escaped}['"]\\s*\\]`, "g")
  ];

  if (term.includes("_") && !term.includes("/") && !term.includes("-") && !term.includes(".")) {
    const snakeParts = term.split("_").filter((part) => part.length > 0);
    if (snakeParts.length >= 2) {
      patterns.push(quotedConcat(snakeParts));
      for (let i = 1; i < snakeParts.length; i += 1) {
        const left = `${snakeParts.slice(0, i).join("_")}_`;
        const right = snakeParts.slice(i).join("_");
        patterns.push(quotedConcat([left, right]));
        const leftBare = snakeParts.slice(0, i).join("_");
        const rightPrefixed = `_${snakeParts.slice(i).join("_")}`;
        patterns.push(quotedConcat([leftBare, rightPrefixed]));
      }
    }
  }

  if (term.includes("-") && !term.includes("/")) {
    const kebabParts = term.split("-").filter((part) => part.length > 0);
    if (kebabParts.length >= 2) {
      patterns.push(quotedConcat(kebabParts));
      for (let i = 1; i < kebabParts.length; i += 1) {
        const left = `${kebabParts.slice(0, i).join("-")}-`;
        const right = kebabParts.slice(i).join("-");
        patterns.push(quotedConcat([left, right]));
        const leftBare = kebabParts.slice(0, i).join("-");
        const rightPrefixed = `-${kebabParts.slice(i).join("-")}`;
        patterns.push(quotedConcat([leftBare, rightPrefixed]));
      }
    }
  }

  if (term.includes(".")) {
    const dotParts = term.split(".").filter((part) => part.length > 0);
    if (dotParts.length >= 2) {
      patterns.push(quotedConcat(dotParts));
      for (let i = 1; i < dotParts.length; i += 1) {
        const left = `${dotParts.slice(0, i).join(".")}.`;
        const right = dotParts.slice(i).join(".");
        patterns.push(quotedConcat([left, right]));
        const leftBare = dotParts.slice(0, i).join(".");
        const rightPrefixed = `.${dotParts.slice(i).join(".")}`;
        patterns.push(quotedConcat([leftBare, rightPrefixed]));
      }
    }
  }

  if (term.includes("/")) {
    const segments = term.split("/").filter((part) => part.length > 0);
    if (segments.length >= 1) {
      const last = segments[segments.length - 1]!;
      const prefix = term.slice(0, term.length - last.length);
      patterns.push(quotedConcat([prefix, last]));
      if (segments.length >= 2) {
        const slashParts: string[] = [];
        if (term.startsWith("/")) {
          slashParts.push("/");
        }
        for (let i = 0; i < segments.length; i += 1) {
          if (i > 0) {
            slashParts.push("/");
          }
          slashParts.push(segments[i]!);
        }
        patterns.push(quotedConcat(slashParts));
      }
    }
  }

  if (!term.includes("_") && !term.includes("-") && !term.includes("/") && !term.includes(".")) {
    const camelParts = splitCamelParts(term);
    if (camelParts !== null) {
      patterns.push(quotedConcat(camelParts));
    }
  }

  return patterns;
}

const FORBIDDEN: Array<{ id: string; term: string; patterns: RegExp[] }> = FORBIDDEN_TERMS.map(
  (entry) => ({
    id: entry.id,
    term: entry.term,
    patterns: buildDetectionPatterns(entry.term)
  })
);

function countHits(text: string, patterns: RegExp[]): number {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) {
        re.lastIndex += 1;
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  let count = 0;
  let lastEnd = -1;
  for (const range of ranges) {
    if (range.start >= lastEnd) {
      count += 1;
      lastEnd = range.end;
    } else {
      lastEnd = Math.max(lastEnd, range.end);
    }
  }
  return count;
}

function patternsFor(termId: string): RegExp[] {
  const entry = FORBIDDEN.find((item) => item.id === termId);
  assert.ok(entry, `unknown forbidden term id: ${termId}`);
  return entry.patterns;
}

function rejectSymlink(stats: Stats, label: string): void {
  assert.equal(stats.isSymbolicLink(), false, `Rejected symlink: ${label}`);
}

function assertInsideRepo(repoRoot: string, canonicalAbs: string, label: string): void {
  const rel = relative(repoRoot, canonicalAbs);
  assert.equal(
    isAbsolute(rel) ||
      rel.startsWith(`..${sep}`) ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\"),
    false,
    `Path escaped repository root: ${label} -> ${canonicalAbs}`
  );
}

function resolveRepoRoot(): string {
  const candidate = fileURLToPath(new URL("../../..", import.meta.url));
  let canonical: string;
  try {
    const st = lstatSync(candidate);
    rejectSymlink(st, candidate);
    canonical = realpathSync(candidate);
  } catch (error) {
    assert.fail(`Failed to resolve repository root from ${candidate}: ${String(error)}`);
  }
  assert.ok(existsSync(join(canonical, "AGENTS.md")), `repo root missing AGENTS.md: ${canonical}`);
  assert.ok(existsSync(join(canonical, "apps")), `repo root missing apps/: ${canonical}`);
  assert.ok(existsSync(join(canonical, "packages")), `repo root missing packages/: ${canonical}`);
  return canonical;
}

function resolveConfiguredRoot(
  repoRoot: string,
  rootRel: string
): { abs: string; isDirectory: boolean; isFile: boolean } {
  const joined = join(repoRoot, rootRel);
  let st: Stats;
  try {
    st = lstatSync(joined);
  } catch (error) {
    assert.fail(`Configured scan root missing or unreadable: ${rootRel} (${String(error)})`);
  }
  rejectSymlink(st, rootRel);
  let canonical: string;
  try {
    canonical = realpathSync(joined);
  } catch (error) {
    assert.fail(`Configured scan root realpath failed: ${rootRel} (${String(error)})`);
  }
  assertInsideRepo(repoRoot, canonical, rootRel);
  assert.ok(
    st.isDirectory() || st.isFile(),
    `Configured scan root is neither file nor directory: ${rootRel}`
  );
  return { abs: canonical, isDirectory: st.isDirectory(), isFile: st.isFile() };
}

function shouldScanFile(repoRoot: string, absPath: string): boolean {
  const relPosix = toPosix(relative(repoRoot, absPath));
  if (relPosix === GATE_REL_POSIX) {
    return false;
  }
  const lower = absPath.toLowerCase();
  if (lower.includes(`${sep}node_modules${sep}`) || lower.includes(`${sep}.next${sep}`)) {
    return false;
  }
  const base = absPath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return TEXT_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

function walk(repoRoot: string, absPath: string, out: string[]): void {
  let st: Stats;
  try {
    st = lstatSync(absPath);
  } catch (error) {
    assert.fail(`Walk lstat failed for ${absPath}: ${String(error)}`);
  }
  rejectSymlink(st, absPath);
  if (st.isDirectory()) {
    let entries: string[];
    try {
      entries = readdirSync(absPath);
    } catch (error) {
      assert.fail(`Walk readdir failed for ${absPath}: ${String(error)}`);
    }
    for (const entry of entries) {
      walk(repoRoot, join(absPath, entry), out);
    }
    return;
  }
  if (!st.isFile()) {
    return;
  }
  if (!shouldScanFile(repoRoot, absPath)) {
    return;
  }
  try {
    readFileSync(absPath, "utf8");
  } catch (error) {
    assert.fail(`Walk read failed for ${absPath}: ${String(error)}`);
  }
  out.push(absPath);
}

function collectScanFiles(repoRoot: string): {
  rootCount: number;
  fileCount: number;
  files: string[];
  filesPerRoot: Map<string, number>;
} {
  const files: string[] = [];
  const filesPerRoot = new Map<string, number>();
  let rootCount = 0;

  for (const rootRel of SCAN_ROOTS) {
    const resolved = resolveConfiguredRoot(repoRoot, rootRel);
    rootCount += 1;
    const before = files.length;
    if (resolved.isDirectory) {
      walk(repoRoot, resolved.abs, files);
    } else if (resolved.isFile) {
      assert.equal(
        shouldScanFile(repoRoot, resolved.abs) ||
          toPosix(relative(repoRoot, resolved.abs)) === GATE_REL_POSIX,
        true,
        `File scan root must be a readable text file: ${rootRel}`
      );
      if (shouldScanFile(repoRoot, resolved.abs)) {
        try {
          readFileSync(resolved.abs, "utf8");
        } catch (error) {
          assert.fail(`File scan root unreadable: ${rootRel} (${String(error)})`);
        }
        files.push(resolved.abs);
      }
    }
    const contributed = files.length - before;
    if (resolved.isDirectory) {
      assert.ok(
        contributed >= 1,
        `Directory scan root must contribute >=1 readable scanned text file: ${rootRel} (got ${String(contributed)})`
      );
    } else {
      assert.equal(
        contributed,
        1,
        `File scan root must contribute exactly one readable scanned text file: ${rootRel} (got ${String(contributed)})`
      );
    }
    filesPerRoot.set(rootRel, contributed);
  }

  assert.equal(rootCount, SCAN_ROOTS.length);
  assert.ok(
    SCAN_ROOTS.length >= 30,
    `S5a vocabulary gate must scan a meaningful root set; got ${String(SCAN_ROOTS.length)}`
  );
  assert.ok(
    files.length >= 2000,
    `S5a vocabulary gate must scan a meaningful file set; got ${String(files.length)} files under ${repoRoot}`
  );
  return { rootCount, fileCount: files.length, files, filesPerRoot };
}

function allowanceExactCount(relPosix: string, termId: string): number {
  for (const rule of ALL_ALLOWANCES) {
    if (rule.path === relPosix && rule.termId === termId) {
      return rule.exactCount;
    }
  }
  return 0;
}

function isProductionPath(relPosix: string): boolean {
  if (
    relPosix.includes(".test.") ||
    relPosix.includes(".spec.") ||
    /\/test\//.test(relPosix) ||
    relPosix.endsWith("/test")
  ) {
    return false;
  }
  return (
    relPosix.startsWith("apps/api/src/") ||
    relPosix.startsWith("apps/web/app/") ||
    relPosix.startsWith("apps/web/messages/") ||
    relPosix.startsWith("apps/runtime/src/") ||
    relPosix.startsWith("apps/provider-gateway/src/") ||
    relPosix.startsWith("apps/sandbox/src/") ||
    relPosix.startsWith("extensions/persai-browser-extension/src/") ||
    relPosix.startsWith("packages/contracts/src/generated/") ||
    relPosix === "packages/contracts/openapi.yaml" ||
    relPosix.startsWith("packages/persai-admin-mcp/src/") ||
    relPosix === "packages/persai-admin-mcp/README.md" ||
    relPosix.startsWith("packages/runtime-bundle/src/") ||
    relPosix.startsWith("packages/runtime-contract/src/") ||
    relPosix.startsWith("packages/config/src/") ||
    relPosix.startsWith("packages/types/src/")
  );
}

function assertNoProductionAllowances(): void {
  for (const rule of HISTORICAL_WORDING_ALLOWANCES) {
    assert.equal(
      isProductionPath(rule.path),
      false,
      `Historical wording allowance must not apply to production path: ${rule.path} :: ${rule.termId}`
    );
  }
}

function runDetectionSelfTests(): void {
  assert.equal(
    countHits('const route = "/assistant/" + "skills";', patternsFor("/assistant/skills")),
    1,
    "must detect /assistant/ + skills route concatenation"
  );
  assert.equal(
    countHits(
      'const tool = "assistant_" + "skills_assign";',
      patternsFor("assistant_skills_assign")
    ),
    1,
    "must detect assistant_ + skills_assign tool concatenation"
  );
  assert.equal(
    countHits(
      'const file = "manage-" + "assistant-skills";',
      patternsFor("manage-assistant-skills")
    ),
    1,
    "must detect manage- + assistant-skills hyphen concatenation"
  );
  assert.equal(
    countHits(
      'const ctrl = "assistant-skills" + ".controller";',
      patternsFor("assistant-skills.controller")
    ),
    1,
    "must detect assistant-skills + .controller dot concatenation"
  );
  assert.equal(
    countHits('obj["maxEnabledSkills"]', patternsFor("maxEnabledSkills")),
    1,
    "must detect bracket access"
  );
  assert.equal(
    countHits('const x = "max" + "Enabled" + "Skills";', patternsFor("maxEnabledSkills")),
    1,
    "must detect camelCase split concatenation"
  );
  assert.equal(
    countHits("plain maxEnabledSkills here", patternsFor("maxEnabledSkills")),
    1,
    "must detect direct term"
  );
  assert.equal(
    countHits("skillToolPolicy stays allowed", patternsFor("skillPolicy")),
    0,
    "skillToolPolicy must not match skillPolicy"
  );
}

function runRootGuardSelfTests(repoRoot: string): void {
  assert.throws(
    () => resolveConfiguredRoot(repoRoot, "does-not-exist-adr147-s5a-missing-root"),
    /missing or unreadable/,
    "missing configured root must fail closed"
  );
  assert.throws(
    () => {
      rejectSymlink({ isSymbolicLink: () => true } as Stats, "synthetic-symlink");
    },
    /Rejected symlink/,
    "symlink stats must fail closed"
  );
  assert.throws(
    () => assertInsideRepo(repoRoot, join(repoRoot, "..", "outside-persai-adr147")),
    /escaped repository root/,
    "path outside repo must fail closed"
  );
}

function scan(): void {
  runDetectionSelfTests();
  const repoRoot = resolveRepoRoot();
  runRootGuardSelfTests(repoRoot);
  assertNoProductionAllowances();

  const { rootCount, fileCount, files } = collectScanFiles(repoRoot);
  const observed = new Map<string, number>();
  const hits: string[] = [];
  const productionHits: string[] = [];

  for (const file of files) {
    const relPosix = toPosix(relative(repoRoot, file));
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      assert.fail(`Failed to read scanned file ${relPosix}: ${String(error)}`);
    }
    for (const rule of FORBIDDEN) {
      const hitCount = countHits(text, rule.patterns);
      if (hitCount === 0) {
        continue;
      }
      const key = `${relPosix}::${rule.id}`;
      observed.set(key, (observed.get(key) ?? 0) + hitCount);
      const expected = allowanceExactCount(relPosix, rule.id);
      if (hitCount === expected) {
        continue;
      }
      const detail = `${relPosix} :: ${rule.id} (hits=${String(hitCount)}, expected=${String(expected)})`;
      hits.push(detail);
      if (isProductionPath(relPosix)) {
        productionHits.push(detail);
      }
    }
  }

  for (const rule of ALL_ALLOWANCES) {
    const key = `${rule.path}::${rule.termId}`;
    const actual = observed.get(key) ?? 0;
    assert.equal(
      actual,
      rule.exactCount,
      `Allowance exactCount mismatch for ${key}: actual=${String(actual)}, expected=${String(rule.exactCount)}`
    );
    assert.equal(
      isProductionPath(rule.path) && HISTORICAL_WORDING_ALLOWANCES.includes(rule),
      false,
      `Allowance must not cover production path: ${key}`
    );
  }

  assert.deepEqual(
    productionHits,
    [],
    `ADR-147 S5a production code must have zero active legacy vocabulary hits.\n${productionHits.join("\n")}`
  );
  assert.deepEqual(
    hits,
    [],
    `ADR-147 S5a active legacy vocabulary must be zero outside exact path+term+exactCount allowances (scanned ${String(rootCount)} roots / ${String(fileCount)} files / ${String(ALL_ALLOWANCES.length)} allowances under ${repoRoot}).\n${hits.join("\n")}`
  );
}

scan();
