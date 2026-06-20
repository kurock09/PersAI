/**
 * One-shot backfill: migrate legacy `:::working\n...\n:::` content markers to
 * `metadata.workingPreamble` + clean `content`.
 *
 * Run with:
 *   npx ts-node --project tsconfig.json prisma/backfill-working-preamble.ts
 * or via:
 *   corepack pnpm --filter @persai/api exec ts-node prisma/backfill-working-preamble.ts
 *
 * Idempotent: rows that already have `metadata.workingPreamble` are skipped.
 * Processes in batches of 500. Logs final totals.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WORKING_BLOCK_OPEN = ":::working\n";
const WORKING_BLOCK_CLOSE = "\n:::";
const BATCH_SIZE = 500;

interface ParsedWorkingContent {
  workingPreamble: string;
  answerText: string;
}

/**
 * Parse the legacy `:::working` format.
 * Replicates the semantics of the old `splitWorkingMarkdownContent` in
 * `chat-message-streaming.ts` (prior to removal).
 *
 * Returns null when the content does not parse cleanly (missing closing marker,
 * or no leading `:::working\n`).
 */
function parseLegacyWorkingContent(content: string): ParsedWorkingContent | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(WORKING_BLOCK_OPEN)) {
    return null;
  }

  const workingBlocks: string[] = [];
  let cursor = 0;

  while (normalized.startsWith(WORKING_BLOCK_OPEN, cursor)) {
    const blockStart = cursor + WORKING_BLOCK_OPEN.length;
    const blockEnd = normalized.indexOf(WORKING_BLOCK_CLOSE, blockStart);
    if (blockEnd === -1) {
      // Unclosed block — leave row untouched
      return null;
    }
    const blockContent = normalized.slice(blockStart, blockEnd).trim();
    if (blockContent.length > 0) {
      workingBlocks.push(blockContent);
    }
    cursor = blockEnd + WORKING_BLOCK_CLOSE.length;
    while (normalized[cursor] === "\n") {
      cursor += 1;
    }
  }

  if (workingBlocks.length === 0) {
    return null;
  }

  return {
    workingPreamble: workingBlocks.join("\n\n"),
    answerText: normalized.slice(cursor)
  };
}

async function run(): Promise<void> {
  let updated = 0;
  let skipped = 0;
  let unparsed = 0;
  let offset = 0;

  console.log("backfill_start", { batchSize: BATCH_SIZE });

  for (;;) {
    const rows = await prisma.assistantChatMessage.findMany({
      where: {
        content: { startsWith: ":::working\n" }
      },
      select: { id: true, content: true, metadata: true },
      skip: offset,
      take: BATCH_SIZE,
      orderBy: { createdAt: "asc" }
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;

      // Idempotent: skip if already migrated
      if (typeof meta.workingPreamble === "string") {
        skipped += 1;
        continue;
      }

      const parsed = parseLegacyWorkingContent(row.content);
      if (parsed === null) {
        console.warn("backfill_unparsed_legacy_working_message", { id: row.id });
        unparsed += 1;
        continue;
      }

      const nextMeta: Record<string, unknown> = {
        ...meta,
        workingPreamble: parsed.workingPreamble
      };

      await prisma.assistantChatMessage.update({
        where: { id: row.id },
        data: {
          content: parsed.answerText,
          metadata: nextMeta
        }
      });

      updated += 1;
    }

    offset += rows.length;
    // If we got fewer rows than batch size, we've exhausted the result set
    if (rows.length < BATCH_SIZE) {
      break;
    }
  }

  console.log("backfill_done", { updated, skipped, unparsed });
}

run()
  .catch((err) => {
    console.error("backfill_error", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
