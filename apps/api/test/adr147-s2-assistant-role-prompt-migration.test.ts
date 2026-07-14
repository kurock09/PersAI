import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { VISIBLE_PROMPT_TEMPLATE_DEFAULTS } from "../prisma/bootstrap-preset-data.js";

const migrationUrl = new URL(
  "../prisma/migrations/20260714002000_adr147_s2_assistant_role_prompt_block/migration.sql",
  import.meta.url
);
const historicalSeedUrl = new URL(
  "../prisma/migrations/20260401100001_h3_bootstrap_preset_seed_data/migration.sql",
  import.meta.url
);
const historicalPolishUrl = new URL(
  "../prisma/migrations/20260518003000_prompt_constructor_polish_prod/migration.sql",
  import.meta.url
);

const ROLE_PLACEHOLDER = "{{assistant_role_block}}";
const PREROLE_DOLLAR_TAG = "adr147_s2_prerole";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function expectedCanonicalPreroleSystem(): string {
  const current = VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system ?? "";
  assert.equal(
    countOccurrences(current, ROLE_PLACEHOLDER),
    1,
    "source system default must contain exactly one assistant_role_block"
  );
  const prerole = current.replace(`\n\n${ROLE_PLACEHOLDER}`, "");
  assert.equal(
    countOccurrences(prerole, ROLE_PLACEHOLDER),
    0,
    "canonical prerole system must omit assistant_role_block"
  );
  assert.equal(
    prerole.includes("{{identity_block}}\n\n{{enabled_skills_block}}"),
    true,
    "canonical prerole system must keep the identity/enabled-skills anchor"
  );
  return prerole;
}

function extractPreroleLiteral(sql: string): string {
  const open = `$${PREROLE_DOLLAR_TAG}$`;
  const close = `$${PREROLE_DOLLAR_TAG}$`;
  const start = sql.indexOf(open);
  assert.ok(start >= 0, "migration must dollar-quote the canonical prerole system template");
  const contentStart = start + open.length;
  const end = sql.indexOf(close, contentStart);
  assert.ok(end > contentStart, "migration prerole dollar-quote must be closed");
  assert.equal(
    sql.indexOf(open, end + close.length),
    -1,
    "migration must contain exactly one prerole dollar-quoted literal"
  );
  return sql.slice(contentStart, end);
}

async function run(): Promise<void> {
  const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
  const historicalSeed = await readFile(fileURLToPath(historicalSeedUrl), "utf8");
  const historicalPolish = await readFile(fileURLToPath(historicalPolishUrl), "utf8");

  // Existing production-row lock + fail-closed / idempotent patch contract.
  assert.match(sql, /WHERE "id" = 'system'\s+FOR UPDATE/);
  assert.match(
    sql,
    /assistant_count <> 0 OR workspace_count <> 0[\s\S]*RAISE EXCEPTION[\s\S]*requires canonical bootstrap_document_presets\.id=system/
  );
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

  // Pristine migration-only bootstrap: insert only when assistants/workspaces are empty.
  assert.match(sql, /SELECT COUNT\(\*\)::bigint INTO assistant_count FROM "assistants"/);
  assert.match(sql, /SELECT COUNT\(\*\)::bigint INTO workspace_count FROM "workspaces"/);
  assert.match(
    sql,
    /INSERT INTO "bootstrap_document_presets" \("id", "template", "updated_at", "created_at"\)\s+VALUES \('system', canonical_prerole_system, now\(\), now\(\)\)/
  );
  assert.match(
    sql,
    /IF current_template IS NULL THEN[\s\S]*INSERT INTO "bootstrap_document_presets"[\s\S]*FOR UPDATE/
  );
  // Populated-missing remains fail-closed; pristine path must not swallow that branch.
  assert.equal(
    (sql.match(/requires canonical bootstrap_document_presets\.id=system/g) ?? []).length,
    1,
    "populated-missing fail must remain exactly one fail-closed raise"
  );

  // Exact canonical template parity with source minus only assistant_role_block.
  const expectedPrerole = expectedCanonicalPreroleSystem();
  assert.equal(
    extractPreroleLiteral(sql),
    expectedPrerole,
    "S2 migration prerole system literal must match VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system minus assistant_role_block"
  );

  // Historical migrations stay untouched: seed never inserts system; polish only UPDATEs.
  assert.doesNotMatch(
    historicalSeed,
    /'system'/,
    "historical h3 seed must remain without bootstrap_document_presets.id=system"
  );
  assert.match(historicalSeed, /\('soul'/);
  assert.match(historicalSeed, /\('user'/);
  assert.match(historicalSeed, /\('identity'/);
  assert.match(historicalSeed, /\('agents'/);
  assert.doesNotMatch(
    historicalPolish,
    /INSERT INTO "bootstrap_document_presets"/,
    "historical polish migration must not gain a system INSERT"
  );
  assert.match(historicalPolish, /UPDATE "bootstrap_document_presets"[\s\S]*WHERE "id" = 'system'/);
}

void run();
