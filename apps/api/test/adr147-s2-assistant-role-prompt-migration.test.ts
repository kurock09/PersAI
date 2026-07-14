import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationUrl = new URL(
  "../prisma/migrations/20260714002000_adr147_s2_assistant_role_prompt_block/migration.sql",
  import.meta.url
);

async function run(): Promise<void> {
  const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
  assert.match(sql, /WHERE "id" = 'system'\s+FOR UPDATE/);
  assert.match(sql, /current_template IS NULL[\s\S]*RAISE EXCEPTION/);
  assert.match(sql, /refuses duplicate assistant_role_block placeholders/);
  assert.match(sql, /cannot locate one canonical identity\/enabled-skills anchor/);
  assert.match(sql, /exists outside the canonical identity\/enabled-skills order/);
  assert.match(
    sql,
    /'\{\{identity_block\}\}'[\s\S]*'\{\{assistant_role_block\}\}'[\s\S]*'\{\{enabled_skills_block\}\}'/
  );
  assert.match(sql, /"template" IS DISTINCT FROM current_template/);
  assert.equal(
    (
      sql.match(/current_template := replace\(\s*current_template,\s*identity_enabled_anchor,/g) ??
      []
    ).length,
    1,
    "migration must have one idempotent insertion operation"
  );
}

void run();
