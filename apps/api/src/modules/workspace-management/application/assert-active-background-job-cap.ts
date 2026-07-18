import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const MAX_ACTIVE_BACKGROUND_JOBS_PER_CHAT = 8;

export type AssertActiveBackgroundJobCapOptions = {
  /**
   * Sandbox job already admitted (detached / about to register). Excluded so
   * post-detach re-assert and register do not self-count the same slot.
   */
  excludeSandboxJobId?: string | null;
};

export async function assertActiveBackgroundJobCap(
  tx: Prisma.TransactionClient,
  chatId: string,
  options?: AssertActiveBackgroundJobCapOptions
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "assistant_chats"
    WHERE "id" = ${chatId}::uuid
    FOR UPDATE
  `);
  const excludeSandboxJobId = options?.excludeSandboxJobId?.trim() || null;
  // Count media/document by chat_id, plus sandbox by handle join OR by the
  // chat's open runtime session (foreground shell/exec before register).
  // Delivery-visible media (deliveredAt or attachment on completion message)
  // is terminal for await and must not burn a cap slot.
  const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    FROM (
      SELECT m."id" FROM "assistant_media_jobs" m
      WHERE m."chat_id" = ${chatId}::uuid
        AND (
          m."status" IN ('queued', 'running')
          OR (
            m."status" = 'completion_pending'
            AND m."delivered_at" IS NULL
            AND (
              m."completion_assistant_message_id" IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM "assistant_chat_message_attachments" a
                WHERE a."message_id" = m."completion_assistant_message_id"
              )
            )
          )
        )
      UNION ALL
      SELECT "id" FROM "assistant_document_render_jobs"
      WHERE "chat_id" = ${chatId}::uuid
        AND "status" IN ('queued', 'running', 'provider_processing', 'fetching_output', 'ready_for_delivery')
      UNION ALL
      SELECT DISTINCT s."id" FROM "sandbox_jobs" s
      WHERE s."status" IN ('queued', 'running', 'detached')
        AND s."tool_code" IN ('shell', 'exec')
        AND (${excludeSandboxJobId}::uuid IS NULL OR s."id" <> ${excludeSandboxJobId}::uuid)
        AND (
          EXISTS (
            SELECT 1 FROM "assistant_async_job_handles" h
            WHERE h."kind" = 'sandbox'::"AssistantAsyncJobHandleKind"
              AND h."canonical_job_id" = s."id"
              AND h."chat_id" = ${chatId}::uuid
          )
          OR EXISTS (
            SELECT 1
            FROM "runtime_sessions" rs
            INNER JOIN "assistant_chats" c
              ON c."id" = ${chatId}::uuid
             AND c."assistant_id" = rs."assistant_id"
             AND c."workspace_id" = rs."workspace_id"
             AND c."surface"::text = rs."channel"::text
             AND c."surface_thread_key" = rs."external_thread_key"
            WHERE rs."id" = s."runtime_session_id"
              AND rs."closed_at" IS NULL
          )
        )
    ) active_jobs
  `);
  const count = Number(rows[0]?.count ?? 0n);
  if (count >= MAX_ACTIVE_BACKGROUND_JOBS_PER_CHAT) {
    throw new ConflictException({
      code: "background_job_concurrency_limit",
      message: `This chat already has ${String(count)} active background jobs. The maximum is ${String(MAX_ACTIVE_BACKGROUND_JOBS_PER_CHAT)}.`,
      activeJobs: count,
      maxActiveJobs: MAX_ACTIVE_BACKGROUND_JOBS_PER_CHAT
    });
  }
}
