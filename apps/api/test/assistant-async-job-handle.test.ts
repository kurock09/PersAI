import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ResolveAssistantAsyncJobService } from "../src/modules/workspace-management/application/resolve-assistant-async-job.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import { parseInternalAsyncJobChannel } from "../src/modules/workspace-management/interface/http/internal-runtime-async-jobs.controller";

const ref = `jr1.media.${"A".repeat(32)}`;
const owned = {
  jobRef: ref,
  assistantId: "a",
  workspaceId: "w",
  chatId: "c",
  channel: "web" as const,
  threadKey: "t"
};

export async function runAssistantAsyncJobHandleTest(): Promise<void> {
  const migration = readFileSync(
    path.resolve(
      __dirname,
      "../prisma/migrations/20260717210000_adr152_async_job_handles/migration.sql"
    ),
    "utf8"
  );
  assert.equal((migration.match(/CREATE TABLE "assistant_async_job_handles"/g) ?? []).length, 1);
  assert.match(migration, /gen_random_bytes\(24\)/);
  assert.match(migration, /UNIQUE \("job_ref"\)/);
  assert.match(migration, /UNIQUE \("kind", "canonical_job_id"\)/);
  assert.match(migration, /ON CONFLICT \("kind", "canonical_job_id"\) DO NOTHING/);
  assert.match(ref, /^jr1\.(media|document)\.[A-Za-z0-9_-]{32}$/);
  assert.equal(parseInternalAsyncJobChannel("web"), "web");
  assert.equal(parseInternalAsyncJobChannel("telegram"), "telegram");
  assert.equal(parseInternalAsyncJobChannel("max_ru"), "max_ru");
  for (const invalid of [undefined, null, "", "WEB", "other"]) {
    assert.throws(() => parseInternalAsyncJobChannel(invalid), /channel must be one of/);
  }

  for (const fixture of [
    { kind: "media" as const, canonicalStatus: "completion_pending", expected: "pending" },
    { kind: "media" as const, canonicalStatus: "delivered", expected: "completed" },
    { kind: "media" as const, canonicalStatus: "canceled", expected: "cancelled" },
    { kind: "document" as const, canonicalStatus: "ready_for_delivery", expected: "pending" },
    { kind: "document" as const, canonicalStatus: "failed", expected: "failed" },
    { kind: "document" as const, canonicalStatus: "delivered", expected: "completed" }
  ]) {
    const resolver = new ResolveAssistantAsyncJobService(
      fakePrisma(fixture.kind, fixture.canonicalStatus)
    );
    const result = await resolver.execute(owned);
    assert.equal(result.found, true);
    if (result.found) assert.equal(result.status, fixture.expected);
  }

  const malformed = await new ResolveAssistantAsyncJobService(
    fakePrisma("media", "delivered")
  ).execute({ ...owned, jobRef: "bad" });
  assert.deepEqual(malformed, { found: false, code: "job_not_found" });
  const foreign = await new ResolveAssistantAsyncJobService(
    fakePrisma("media", "delivered", true)
  ).execute(owned);
  assert.deepEqual(foreign, malformed, "foreign and malformed handles must be indistinguishable");
  for (const changed of [
    { assistantId: "other" },
    { workspaceId: "other" },
    { chatId: "other" },
    { threadKey: "other" }
  ]) {
    const result = await new ResolveAssistantAsyncJobService(
      fakePrisma("media", "delivered")
    ).execute({
      ...owned,
      ...changed
    });
    assert.deepEqual(result, malformed);
  }
}

function fakePrisma(
  kind: "media" | "document",
  status: string,
  foreign = false
): WorkspaceManagementPrismaService {
  return {
    assistantChat: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        foreign ||
        where.assistantId !== "a" ||
        where.workspaceId !== "w" ||
        where.id !== "c" ||
        where.surfaceThreadKey !== "t"
          ? null
          : { userId: "u" }
    },
    assistantAsyncJobHandle: { findFirst: async () => ({ kind, canonicalJobId: "id" }) },
    assistantMediaJob: {
      findFirst: async () => ({ status, lastErrorCode: status === "failed" ? "failed" : null })
    },
    assistantDocumentRenderJob: {
      findFirst: async () => ({ status, lastErrorCode: status === "failed" ? "failed" : null })
    }
  } as unknown as WorkspaceManagementPrismaService;
}

void runAssistantAsyncJobHandleTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
