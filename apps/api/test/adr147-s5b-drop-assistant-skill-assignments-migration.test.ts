import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ADR-147 S5b migration contract: JSON cleanup vocabulary/shape, drop order,
 * idempotent guards, and immutable historical migrations unchanged.
 */

const root = process.cwd();
const S5B_REL =
  "prisma/migrations/20260714003000_adr147_s5b_drop_assistant_skill_assignments/migration.sql";
const HISTORICAL_CREATE =
  "prisma/migrations/20260501120000_adr079_knowledge_skills_foundation/migration.sql";
const HISTORICAL_READ =
  "prisma/migrations/20260505214500_adr079_skill_decision_and_cadence_state/migration.sql";

const sql = readFileSync(join(root, S5B_REL), "utf8");
const historicalCreate = readFileSync(join(root, HISTORICAL_CREATE), "utf8");
const historicalRead = readFileSync(join(root, HISTORICAL_READ), "utf8");

function indexOfRequired(haystack: string, needle: string, label: string): number {
  const index = haystack.indexOf(needle);
  assert.ok(index >= 0, `${label} must appear in S5b migration`);
  return index;
}

// --- JSON cleanup vocabulary / shape ---
assert.match(
  sql,
  /UPDATE\s+"plan_catalog_plans"\s+SET\s+"billing_provider_hints"\s+=\s+"billing_provider_hints"\s+-\s+'skillPolicy'/m
);
assert.match(sql, /"billing_provider_hints"\s+\?\s+'skillPolicy'/);
assert.match(sql, /jsonb_typeof\("billing_provider_hints"\)\s+=\s+'object'/);
assert.doesNotMatch(sql, /billing_provider_hints"\s+=\s+NULL/i);
assert.doesNotMatch(sql, /SET\s+"billing_provider_hints"\s+=\s+'null'::jsonb/i);

assert.match(sql, /UPDATE\s+"plan_catalog_entitlements"/);
assert.match(sql, /SET\s+"limits_permissions"\s+=\s+COALESCE\s*\(/);
assert.match(sql, /jsonb_agg\(elem\s+ORDER\s+BY\s+ord\)/);
assert.match(sql, /jsonb_array_elements\("limits_permissions"\)\s+WITH\s+ORDINALITY/);
assert.match(sql, /'enabled_skills_limit'/);
assert.match(sql, /'max_enabled_skills'/);
assert.match(sql, /'skill_assignments_limit'/);
assert.match(sql, /COALESCE\([\s\S]*?,\s*'\[\]'::jsonb\s*\)/m);
assert.match(sql, /jsonb_typeof\("limits_permissions"\)\s+=\s+'array'/);
assert.doesNotMatch(sql, /SET\s+"limits_permissions"\s+=\s+NULL/i);

// --- Drop order: JSON cleanup → DROP TABLE → DROP TYPE ---
const hintsUpdateIndex = indexOfRequired(
  sql,
  'UPDATE "plan_catalog_plans"',
  "billing_provider_hints cleanup"
);
const limitsUpdateIndex = indexOfRequired(
  sql,
  'UPDATE "plan_catalog_entitlements"',
  "limits_permissions cleanup"
);
const dropTableIndex = indexOfRequired(
  sql,
  'DROP TABLE IF EXISTS "assistant_skill_assignments"',
  "DROP TABLE"
);
const dropTypeIndex = indexOfRequired(
  sql,
  'DROP TYPE IF EXISTS "AssistantSkillAssignmentStatus"',
  "DROP TYPE"
);
assert.ok(
  hintsUpdateIndex < dropTableIndex,
  "billing_provider_hints cleanup must precede DROP TABLE"
);
assert.ok(limitsUpdateIndex < dropTableIndex, "limits_permissions cleanup must precede DROP TABLE");
assert.ok(dropTableIndex < dropTypeIndex, "DROP TABLE must precede DROP TYPE");
assert.ok(
  hintsUpdateIndex < limitsUpdateIndex,
  "billing_provider_hints cleanup must precede limits_permissions cleanup"
);
// --- Idempotent guards ---
assert.match(sql, /DROP TABLE IF EXISTS "assistant_skill_assignments"/);
assert.match(sql, /DROP TYPE IF EXISTS "AssistantSkillAssignmentStatus"/);
assert.match(sql, /"billing_provider_hints"\s+\?\s+'skillPolicy'/);
assert.match(
  sql,
  /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+jsonb_array_elements\("limits_permissions"\)/m
);

// --- Immutable historical migrations unchanged / not repurposed ---
assert.match(historicalCreate, /CREATE TYPE "AssistantSkillAssignmentStatus" AS ENUM/);
assert.match(historicalCreate, /CREATE TABLE "assistant_skill_assignments"/);
assert.doesNotMatch(historicalCreate, /DROP TABLE IF EXISTS "assistant_skill_assignments"/);
assert.doesNotMatch(historicalCreate, /DROP TYPE IF EXISTS "AssistantSkillAssignmentStatus"/);
assert.doesNotMatch(historicalCreate, /skillPolicy/);
assert.match(historicalRead, /assistant_skill_assignments/);
assert.doesNotMatch(historicalRead, /DROP TABLE IF EXISTS "assistant_skill_assignments"/);
assert.doesNotMatch(sql, /CREATE TABLE "assistant_skill_assignments"/);
assert.doesNotMatch(sql, /CREATE TYPE "AssistantSkillAssignmentStatus"/);

// Schema must no longer declare the residual model/enum after S5b.
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
assert.doesNotMatch(schema, /model AssistantSkillAssignment\s*\{/);
assert.doesNotMatch(schema, /enum AssistantSkillAssignmentStatus/);
assert.doesNotMatch(schema, /@@map\("assistant_skill_assignments"\)/);
