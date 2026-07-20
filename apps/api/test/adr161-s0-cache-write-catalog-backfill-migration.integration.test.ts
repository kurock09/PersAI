import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const baseDatabaseUrl =
  process.env.PERSAI_POSTGRES_INTEGRATION_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
const migrationSql = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260720161500_adr161_s0_cache_write_catalog_backfill/migration.sql"
  ),
  "utf8"
);

function databaseUrlForSchema(schema: string): string {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function applyMigration(databaseUrl: string): void {
  const prismaArgs = [
    "pnpm",
    "exec",
    "prisma",
    "db",
    "execute",
    "--stdin",
    "--schema",
    resolve(process.cwd(), "prisma/schema.prisma")
  ];
  const result = spawnSync(
    process.platform === "win32" ? "cmd.exe" : "corepack",
    process.platform === "win32"
      ? ["/d", "/s", "/c", `corepack ${prismaArgs.join(" ")}`]
      : prismaArgs,
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      input: migrationSql,
      encoding: "utf8"
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `migration execution failed (${String(result.status)}; ${result.error?.message ?? "no spawn error"}): ${result.stderr || result.stdout}`
    );
  }
}

function tokenProfile(params: {
  model: string;
  inputWeight: number;
  inputPer1M: number;
  cacheCreationInputPer1M: number;
  cacheWriteInputTokenWeight?: number;
}) {
  return {
    model: params.model,
    billingMode: "token_metered",
    inputTokenWeight: params.inputWeight,
    ...(params.cacheWriteInputTokenWeight === undefined
      ? {}
      : { cacheWriteInputTokenWeight: params.cacheWriteInputTokenWeight }),
    providerPriceMetadata: {
      tokenPricing: {
        inputPer1M: params.inputPer1M,
        cacheCreationInputPer1M: params.cacheCreationInputPer1M
      }
    }
  };
}

async function main(): Promise<void> {
  const schema = `adr161_cache_backfill_${randomUUID().replaceAll("-", "")}`;
  const schemaUrl = databaseUrlForSchema(schema);
  const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
  const scoped = new PrismaClient({ datasources: { db: { url: schemaUrl } } });

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await scoped.$executeRawUnsafe(`
      CREATE TABLE "platform_runtime_provider_settings" (
        "id" varchar(32) PRIMARY KEY,
        "available_models_by_provider" jsonb NOT NULL,
        "available_model_catalog_by_provider" jsonb NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    const catalog = {
      openai: { chat: [], image: [], video: [] },
      anthropic: {
        models: [
          tokenProfile({
            model: "positive-first",
            inputWeight: 4,
            inputPer1M: 10,
            cacheCreationInputPer1M: 12.5
          }),
          tokenProfile({
            model: "zero-second",
            inputWeight: 4,
            inputPer1M: 10,
            cacheCreationInputPer1M: 0
          }),
          tokenProfile({
            model: "explicit-third",
            inputWeight: 4,
            inputPer1M: 10,
            cacheCreationInputPer1M: 12.5,
            cacheWriteInputTokenWeight: 7
          })
        ]
      },
      deepseek: { models: [] },
      runway: { models: { unsupported: true } },
      kling: { retained: "missing models stays unchanged" }
    };
    const availableModels = {
      openai: ["fallback-chat-model"],
      anthropic: [],
      deepseek: []
    };
    await scoped.$executeRawUnsafe(
      `INSERT INTO "platform_runtime_provider_settings"
        ("id", "available_models_by_provider", "available_model_catalog_by_provider")
       VALUES ('valid', $1::jsonb, $2::jsonb)`,
      JSON.stringify(availableModels),
      JSON.stringify(catalog)
    );

    applyMigration(schemaUrl);
    applyMigration(schemaUrl);

    const [valid] = await scoped.$queryRawUnsafe<
      Array<{ available_model_catalog_by_provider: Record<string, unknown> }>
    >(
      `SELECT "available_model_catalog_by_provider"
       FROM "platform_runtime_provider_settings" WHERE "id" = 'valid'`
    );
    assert.ok(valid);
    const migrated = valid.available_model_catalog_by_provider as typeof catalog;
    const models = migrated.anthropic.models as Array<Record<string, unknown>>;
    assert.deepEqual(
      models.map((model) => model.model),
      ["positive-first", "zero-second", "explicit-third"]
    );
    assert.deepEqual(
      models.map((model) => model.cacheWriteInputTokenWeight),
      [5, 4, 7]
    );
    assert.deepEqual((migrated.deepseek as { models: unknown }).models, []);
    assert.deepEqual((migrated.runway as { models: unknown }).models, { unsupported: true });
    assert.deepEqual(migrated.kling, { retained: "missing models stays unchanged" });
    assert.deepEqual(
      (migrated.openai as { models: Array<Record<string, unknown>> }).models.map(
        (model) => model.model
      ),
      ["fallback-chat-model"]
    );

    const malformedCatalog = {
      openai: { chat: "not-an-array", image: [], video: [] }
    };
    await scoped.$executeRawUnsafe(
      `INSERT INTO "platform_runtime_provider_settings"
        ("id", "available_models_by_provider", "available_model_catalog_by_provider")
       VALUES ('malformed', $1::jsonb, $2::jsonb)`,
      JSON.stringify(availableModels),
      JSON.stringify(malformedCatalog)
    );
    const beforeFailure = await scoped.$queryRawUnsafe<
      Array<{ available_model_catalog_by_provider: Record<string, unknown> }>
    >(
      `SELECT "available_model_catalog_by_provider"
       FROM "platform_runtime_provider_settings" WHERE "id" = 'malformed'`
    );
    assert.throws(() => applyMigration(schemaUrl), /malformed legacy provider catalog arrays/);
    const afterFailure = await scoped.$queryRawUnsafe<
      Array<{ available_model_catalog_by_provider: Record<string, unknown> }>
    >(
      `SELECT "available_model_catalog_by_provider"
       FROM "platform_runtime_provider_settings" WHERE "id" = 'malformed'`
    );
    assert.deepEqual(afterFailure, beforeFailure, "failed preflight must roll back every mutation");
  } finally {
    await scoped.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
