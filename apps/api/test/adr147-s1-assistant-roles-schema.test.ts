import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ASSISTANT_ROLE_CREATE } from "../prisma/assistant-role-seed-data";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(root, "prisma/migrations/20260714001000_adr147_s1_assistant_roles_expand/migration.sql"),
  "utf8"
);
const manageSkillsSource = readFileSync(
  join(root, "src/modules/workspace-management/application/manage-assistant-skills.service.ts"),
  "utf8"
);
const materializeSource = readFileSync(
  join(
    root,
    "src/modules/workspace-management/application/materialize-assistant-published-version.service.ts"
  ),
  "utf8"
);
const readKnowledgeSource = readFileSync(
  join(root, "src/modules/workspace-management/application/read-assistant-knowledge.service.ts"),
  "utf8"
);
const runtimeBootstrapSource = readFileSync(
  join(root, "src/modules/workspace-management/application/seed-tool-catalog.service.ts"),
  "utf8"
);

assert.match(schema, /enum AssistantRoleStatus\s*\{\s*draft\s+active\s+archived\s*\}/m);
assert.match(
  schema,
  /roleId\s+String\s+@default\(dbgenerated\("'00000000-0000-4000-8000-000000000147'::uuid"\)\)\s+@map\("role_id"\)\s+@db\.Uuid/
);
assert.match(
  schema,
  /role\s+AssistantRole\s+@relation\(fields: \[roleId\], references: \[id\], onDelete: Restrict, onUpdate: Cascade\)/
);
assert.match(schema, /@@index\(\[roleId\]\)/);
assert.match(schema, /model AssistantRole \{/);
assert.match(schema, /key\s+String\s+@unique\s+@db\.VarChar\(64\)/);
assert.match(schema, /name\s+Json\s+@db\.JsonB/);
assert.match(schema, /description\s+Json\s+@db\.JsonB/);
assert.match(schema, /mission\s+Json\s+@db\.JsonB/);
assert.match(schema, /skillLinks\s+AssistantRoleSkill\[\]/);
assert.match(
  schema,
  /role\s+AssistantRole\s+@relation\(fields: \[roleId\], references: \[id\], onDelete: Cascade, onUpdate: Cascade\)/
);
assert.match(
  schema,
  /skill\s+Skill\s+@relation\(fields: \[skillId\], references: \[id\], onDelete: Cascade, onUpdate: Cascade\)/
);
assert.match(schema, /@@id\(\[roleId, skillId\]\)/);
assert.match(
  migration,
  /CREATE TYPE "AssistantRoleStatus" AS ENUM \('draft', 'active', 'archived'\)/
);
assert.match(migration, /CREATE TABLE "assistant_roles"/);
assert.match(migration, /CREATE TABLE "assistant_role_skills"/);
assert.match(
  migration,
  /INSERT INTO "assistant_roles"\s*\(\s*"id",\s*"key",\s*"name",\s*"description",\s*"mission",\s*"category",\s*"icon_emoji",\s*"color",\s*"status",\s*"display_order"\s*\)/m
);
assert.match(migration, /'00000000-0000-4000-8000-000000000147'/);
assert.match(
  migration,
  /ALTER TABLE "assistants"\s+ADD COLUMN "role_id" UUID DEFAULT '00000000-0000-4000-8000-000000000147'/m
);
assert.match(
  migration,
  /UPDATE "assistants"\s+SET "role_id" = '00000000-0000-4000-8000-000000000147'\s+WHERE "role_id" IS NULL/m
);
assert.match(migration, /ALTER TABLE "assistants"\s+ALTER COLUMN "role_id" SET NOT NULL/m);
assert.match(
  migration,
  /FOREIGN KEY \("role_id"\) REFERENCES "assistant_roles"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/m
);

const defaultInsertIndex = migration.indexOf('INSERT INTO "assistant_roles"');
const roleColumnIndex = migration.indexOf('ADD COLUMN "role_id"');
const notNullIndex = migration.indexOf('ALTER COLUMN "role_id" SET NOT NULL');
assert.ok(defaultInsertIndex >= 0 && defaultInsertIndex < roleColumnIndex);
assert.ok(roleColumnIndex < notNullIndex);
assert.doesNotMatch(migration.slice(notNullIndex), /ALTER COLUMN "role_id" DROP DEFAULT/);
assert.doesNotMatch(migration, /INSERT INTO "assistant_role_skills"/);
assert.doesNotMatch(migration, /assistant_skill_assignments/i);

const defaultInsert = migration.match(
  /INSERT INTO "assistant_roles"[\s\S]*?\) VALUES \(\s*'([^']+)',\s*'([^']+)',\s*'((?:''|[^'])*)'::jsonb,\s*'((?:''|[^'])*)'::jsonb,\s*'((?:''|[^'])*)'::jsonb,\s*'([^']+)',\s*(NULL|'(?:''|[^'])*'),\s*(NULL|'(?:''|[^'])*'),\s*'([^']+)',\s*(\d+)\s*\);/
);
assert.ok(defaultInsert !== null, "default Role INSERT must keep the canonical column/value shape");
const parseSqlJson = (value: string): unknown => JSON.parse(value.replace(/''/g, "'"));
const parseNullableSqlString = (value: string): string | null =>
  value === "NULL" ? null : value.slice(1, -1).replace(/''/g, "'");
assert.deepEqual(
  {
    id: defaultInsert[1],
    key: defaultInsert[2],
    name: parseSqlJson(defaultInsert[3]),
    description: parseSqlJson(defaultInsert[4]),
    mission: parseSqlJson(defaultInsert[5]),
    category: defaultInsert[6],
    iconEmoji: parseNullableSqlString(defaultInsert[7]),
    color: parseNullableSqlString(defaultInsert[8]),
    status: defaultInsert[9],
    displayOrder: Number(defaultInsert[10])
  },
  {
    id: DEFAULT_ASSISTANT_ROLE_CREATE.id,
    key: DEFAULT_ASSISTANT_ROLE_CREATE.key,
    name: DEFAULT_ASSISTANT_ROLE_CREATE.name,
    description: DEFAULT_ASSISTANT_ROLE_CREATE.description,
    mission: DEFAULT_ASSISTANT_ROLE_CREATE.mission,
    category: DEFAULT_ASSISTANT_ROLE_CREATE.category,
    iconEmoji: DEFAULT_ASSISTANT_ROLE_CREATE.iconEmoji,
    color: DEFAULT_ASSISTANT_ROLE_CREATE.color,
    status: DEFAULT_ASSISTANT_ROLE_CREATE.status,
    displayOrder: DEFAULT_ASSISTANT_ROLE_CREATE.displayOrder
  }
);

assert.match(manageSkillsSource, /assistantSkillAssignment\.findMany/);
assert.match(materializeSource, /assistantRoleSkill\.findMany/);
assert.doesNotMatch(materializeSource, /assistantSkillAssignment/);
assert.match(readKnowledgeSource, /skillLinks:/);
assert.doesNotMatch(readKnowledgeSource, /assistantSkillAssignment/);
assert.doesNotMatch(runtimeBootstrapSource, /assistant-role-bootstrap|assistantRole/);
