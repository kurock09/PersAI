/**
 * One-shot backfill: bring legacy assistant messages to the final
 * `metadata.workingNotes: string[]` form.
 *
 * Run with:
 *   npx ts-node --project tsconfig.json prisma/backfill-working-notes.ts
 * or via:
 *   corepack pnpm --filter @persai/api exec ts-node prisma/backfill-working-notes.ts
 *
 * Idempotent. For each candidate row:
 *   - if `metadata.workingNotes` is already an array → skip;
 *   - else if `metadata.workingPreamble` is a string → set
 *     `workingNotes = [workingPreamble]` and drop `workingPreamble`;
 *   - else if `content` starts with the legacy `:::working\n...\n:::` markers →
 *     parse the blocks into `workingNotes` and replace `content` with the clean
 *     answer text.
 *
 * Processes in batches of 500. Logs final totals.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WORKING_BLOCK_OPEN = ":::working\n";
const WORKING_BLOCK_CLOSE = "\n:::";
const BATCH_SIZE = 500;

interface ParsedLegacyWorkingContent {
  workingNotes: string[];
  answerText: string;
}

/**
 * Parse the legacy `:::working` content markers into discrete notes.
 * Returns null when the content does not parse cleanly (no leading
 * `:::working\n`, or an unclosed block).
 */
export function parseLegacyWorkingContent(content: string): ParsedLegacyWorkingContent | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(WORKING_BLOCK_OPEN)) {
    return null;
  }

  const workingNotes: string[] = [];
  let cursor = 0;

  while (normalized.startsWith(WORKING_BLOCK_OPEN, cursor)) {
    const blockStart = cursor + WORKING_BLOCK_OPEN.length;
    const blockEnd = normalized.indexOf(WORKING_BLOCK_CLOSE, blockStart);
    if (blockEnd === -1) {
      // Unclosed block — leave the row untouched.
      return null;
    }
    const blockContent = normalized.slice(blockStart, blockEnd).trim();
    if (blockContent.length > 0) {
      workingNotes.push(blockContent);
    }
    cursor = blockEnd + WORKING_BLOCK_CLOSE.length;
    while (normalized[cursor] === "\n") {
      cursor += 1;
    }
  }

  if (workingNotes.length === 0) {
    return null;
  }

  return {
    workingNotes,
    answerText: normalized.slice(cursor)
  };
}

async function run(): Promise<void> {
  let updated = 0;
  let skipped = 0;
  let unparsed = 0;

  console.log("backfill_start", { batchSize: BATCH_SIZE });

  // Pass 1: rows that still carry the legacy `metadata.workingPreamble` string.
  for (;;) {
    const rows = await prisma.assistantChatMessage.findMany({
      where: {
        // Postgres JSON filter: matches rows whose metadata.workingPreamble is a
        // string (empty `string_contains` matches any string at the path).
        metadata: { path: ["workingPreamble"], string_contains: "" }
      },
      select: { id: true, content: true, metadata: true },
      take: BATCH_SIZE,
      orderBy: { createdAt: "asc" }
    });

    if (rows.length === 0) {
      break;
    }

    let progressed = 0;
    for (const row of rows) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;

      if (Array.isArray(meta.workingNotes)) {
        // Already migrated: drop the legacy field if it lingers.
        if (typeof meta.workingPreamble === "string") {
          const { workingPreamble: _legacy, ...rest } = meta;
          await prisma.assistantChatMessage.update({
            where: { id: row.id },
            data: { metadata: rest }
          });
          updated += 1;
          progressed += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      if (typeof meta.workingPreamble !== "string") {
        skipped += 1;
        continue;
      }

      const { workingPreamble, ...rest } = meta;
      await prisma.assistantChatMessage.update({
        where: { id: row.id },
        data: {
          metadata: { ...rest, workingNotes: [workingPreamble] }
        }
      });
      updated += 1;
      progressed += 1;
    }

    // Updated rows no longer match the where-clause; stop when a full batch made
    // no forward progress (only already-migrated/skip rows remain).
    if (progressed === 0) {
      break;
    }
  }

  // Pass 2: legacy `:::working` content markers.
  let offset = 0;
  for (;;) {
    const rows = await prisma.assistantChatMessage.findMany({
      where: {
        content: { startsWith: WORKING_BLOCK_OPEN }
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

      if (Array.isArray(meta.workingNotes)) {
        skipped += 1;
        continue;
      }

      const parsed = parseLegacyWorkingContent(row.content);
      if (parsed === null) {
        console.warn("backfill_unparsed_legacy_working_message", { id: row.id });
        unparsed += 1;
        continue;
      }

      const { workingPreamble: _legacy, ...rest } = meta;
      await prisma.assistantChatMessage.update({
        where: { id: row.id },
        data: {
          content: parsed.answerText,
          metadata: { ...rest, workingNotes: parsed.workingNotes }
        }
      });
      updated += 1;
    }

    offset += rows.length;
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
