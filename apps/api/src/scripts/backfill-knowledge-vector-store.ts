import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { BackfillKnowledgeVectorStoreService } from "../modules/workspace-management/application/backfill-knowledge-vector-store.service";

/**
 * ADR-120 Slice 3 — one-shot runner for the unified vector-store parity
 * backfill. Idempotent: safe to re-run. Mirrors each ready assistant/global/
 * product source's current-version chunks into `KnowledgeVectorChunk` reusing
 * the embeddings already stored on the legacy chunk rows.
 *
 *   corepack pnpm --filter @persai/api run backfill:knowledge-vector-store
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"]
  });
  try {
    const service = app.get(BackfillKnowledgeVectorStoreService);
    const summary = await service.execute();
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `ADR-120 vector-store backfill failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
