import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function run(): void {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260503110000_global_admin_knowledge_ownership",
      "migration.sql"
    ),
    "utf8"
  );
  const auditSql = readFileSync(
    join(process.cwd(), "prisma", "audits", "shared-knowledge-platform-ownership.sql"),
    "utf8"
  );

  for (const table of [
    "global_knowledge_sources",
    "global_knowledge_source_chunks",
    "product_knowledge_text_entries",
    "product_knowledge_text_entry_chunks",
    "skills",
    "skill_documents",
    "skill_document_chunks",
    "skill_knowledge_cards",
    "skill_knowledge_card_chunks"
  ]) {
    assert.match(
      migrationSql,
      new RegExp(`ALTER TABLE "${table}"[\\s\\S]*DROP COLUMN IF EXISTS "workspace_id"`)
    );
  }

  for (const sourceType of [
    "global_knowledge_source",
    "skill_document",
    "skill_knowledge_card",
    "product_knowledge_text_entry"
  ]) {
    assert.match(migrationSql, new RegExp(`'${sourceType}'`));
    assert.match(auditSql, new RegExp(`'${sourceType}'`));
  }

  assert.match(migrationSql, /knowledge_indexing_jobs_source_ownership_check/);
  assert.match(migrationSql, /knowledge_vector_chunks_source_ownership_check/);
  assert.match(auditSql, /shared Knowledge indexing jobs with workspace_id remain/);
  assert.match(auditSql, /duplicate Product KB baseline rows remain/);
}

run();
