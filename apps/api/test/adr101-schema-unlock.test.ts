import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(root, "prisma/migrations/20260526140000_adr101_multi_assistant_schema_unlock/migration.sql"),
  "utf8"
);

assert.match(schema, /assistants\s+Assistant\[\]/);
assert.match(schema, /activeAssistantId\s+String\?\s+@map\("active_assistant_id"\)\s+@db\.Uuid/);
assert.doesNotMatch(schema, /userId\s+String\s+@unique\s+@map\("user_id"\)\s+@db\.Uuid/);
assert.doesNotMatch(
  schema,
  /@@unique\(\[workspaceId, userId\]\)\s*\n\s+@@unique\(\[id, userId\]\)/
);
assert.match(schema, /@@index\(\[workspaceId, userId\]\)/);
assert.match(schema, /@@unique\(\[id, workspaceId\]\)/);

assert.match(migration, /ADD COLUMN "active_assistant_id" UUID/);
assert.match(migration, /DROP INDEX IF EXISTS "assistants_user_id_key"/);
assert.match(migration, /DROP INDEX IF EXISTS "assistants_workspace_id_user_id_key"/);
assert.match(
  migration,
  /FOREIGN KEY \("active_assistant_id", "workspace_id"\)\s+REFERENCES "assistants"\("id", "workspace_id"\)/
);
assert.match(migration, /"maxAssistants":1/);
