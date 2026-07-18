import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { describe, test } from "node:test";
import {
  assertActiveBackgroundJobCap,
  MAX_ACTIVE_BACKGROUND_JOBS_PER_CHAT
} from "../src/modules/workspace-management/application/assert-active-background-job-cap";

function sqlText(value: unknown): string {
  const candidate = value as { strings?: readonly string[] };
  return candidate.strings?.join("?") ?? "";
}

function sqlValues(value: unknown): unknown[] {
  const candidate = value as { values?: unknown[] };
  return Array.isArray(candidate.values) ? candidate.values : [];
}

describe("assertActiveBackgroundJobCap", () => {
  test("SQL excludes delivery-visible completion_pending media and optional sandbox self-id", async () => {
    let countSql = "";
    let countValues: unknown[] = [];
    const selfId = "00000000-0000-4000-8000-000000000010";
    const tx = {
      $queryRaw: async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes("FOR UPDATE")) {
          return [{ id: "chat-1" }];
        }
        if (sql.includes('COUNT(*)::bigint AS "count"')) {
          countSql = sql;
          countValues = sqlValues(query);
          return [{ count: 0n }];
        }
        throw new Error(`Unexpected $queryRaw: ${sql}`);
      }
    };

    await assertActiveBackgroundJobCap(tx as never, "00000000-0000-4000-8000-000000000004", {
      excludeSandboxJobId: selfId
    });

    assert.match(countSql, /completion_pending/);
    assert.match(countSql, /delivered_at/);
    assert.match(countSql, /assistant_chat_message_attachments/);
    assert.match(countSql, /s\."id" <>/);
    assert.ok(countValues.includes(selfId));
  });

  test("allows count 7 when excluding the already-detached self job (8th slot)", async () => {
    const selfId = "00000000-0000-4000-8000-000000000010";
    let sawExclude = false;
    const tx = {
      $queryRaw: async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes("FOR UPDATE")) return [{ id: "chat-1" }];
        if (sql.includes('COUNT(*)::bigint AS "count"')) {
          sawExclude = sqlValues(query).includes(selfId);
          // Others only — self excluded in SQL; 7 others < 8.
          return [{ count: 7n }];
        }
        throw new Error(`Unexpected $queryRaw: ${sql}`);
      }
    };

    await assertActiveBackgroundJobCap(tx as never, "00000000-0000-4000-8000-000000000004", {
      excludeSandboxJobId: selfId
    });
    assert.equal(sawExclude, true);
  });

  test("rejects when 8 other active jobs remain after self-exclusion", async () => {
    const selfId = "00000000-0000-4000-8000-000000000010";
    const tx = {
      $queryRaw: async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes("FOR UPDATE")) return [{ id: "chat-1" }];
        if (sql.includes('COUNT(*)::bigint AS "count"')) {
          return [{ count: BigInt(MAX_ACTIVE_BACKGROUND_JOBS_PER_CHAT) }];
        }
        throw new Error(`Unexpected $queryRaw: ${sql}`);
      }
    };

    await assert.rejects(
      () =>
        assertActiveBackgroundJobCap(tx as never, "00000000-0000-4000-8000-000000000004", {
          excludeSandboxJobId: selfId
        }),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error.getResponse() as { code?: string }).code === "background_job_concurrency_limit"
    );
  });

  test("without exclude, count 8 rejects (pre-submit / media path)", async () => {
    const tx = {
      $queryRaw: async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes("FOR UPDATE")) return [{ id: "chat-1" }];
        if (sql.includes('COUNT(*)::bigint AS "count"')) {
          return [{ count: 8n }];
        }
        throw new Error(`Unexpected $queryRaw: ${sql}`);
      }
    };

    await assert.rejects(
      () => assertActiveBackgroundJobCap(tx as never, "00000000-0000-4000-8000-000000000004"),
      (error: unknown) => error instanceof ConflictException
    );
  });
});
