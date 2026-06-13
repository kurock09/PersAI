import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const open = ":::working\n";
const close = "\n:::";

function splitWorkingMarkdown(content) {
  const workingBlocks = [];
  let cursor = 0;
  while (content.startsWith(open, cursor)) {
    const blockStart = cursor + open.length;
    const blockEnd = content.indexOf(close, blockStart);
    if (blockEnd === -1) {
      break;
    }
    const blockContent = content.slice(blockStart, blockEnd).trim();
    if (blockContent.length > 0) {
      workingBlocks.push(blockContent);
    }
    cursor = blockEnd + close.length;
    while (content[cursor] === "\n") {
      cursor += 1;
    }
  }
  return { workingBlocks, answerText: content.slice(cursor) };
}

function findAdjacentDuplicateSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const duplicates = [];
  for (let i = 1; i < sentences.length; i += 1) {
    if (sentences[i] === sentences[i - 1]) {
      duplicates.push(sentences[i]);
    }
  }
  return duplicates;
}

function hasRepeatedSubstring(text, minLen = 40) {
  const normalized = text.replace(/\s+/g, " ");
  return new RegExp(`(.{${minLen},}?)\\1`).test(normalized);
}

try {
  const recent = await prisma.$queryRawUnsafe(`
    SELECT id, created_at, content
    FROM assistant_chat_messages
    WHERE author = 'assistant'
      AND content LIKE '%:::working%'
    ORDER BY created_at DESC
    LIMIT 25
  `);

  console.log(`recent_working_messages=${recent.length}`);

  let dupCount = 0;
  for (const row of recent) {
    const { workingBlocks, answerText } = splitWorkingMarkdown(row.content);
    const adjacentDupes = findAdjacentDuplicateSentences(answerText);
    const repeated = hasRepeatedSubstring(answerText);
    const answerPhraseDupes = workingBlocks.some((block) => {
      const trimmed = block.trim();
      return trimmed.length > 20 && answerText.includes(trimmed);
    });

    if (adjacentDupes.length === 0 && !repeated && !answerPhraseDupes) {
      continue;
    }

    dupCount += 1;
    console.log("--- DUPLICATE_CANDIDATE ---");
    console.log(`id=${row.id}`);
    console.log(`created_at=${row.created_at}`);
    console.log(`working_blocks=${workingBlocks.length}`);
    console.log(`answer_len=${answerText.length}`);
    console.log(`adjacent_dupes=${JSON.stringify(adjacentDupes)}`);
    console.log(`repeated_substring=${repeated}`);
    console.log(`working_in_answer=${answerPhraseDupes}`);
    console.log(`answer_preview=${JSON.stringify(answerText.slice(0, 600))}`);
    if (workingBlocks.length > 0) {
      console.log(
        `last_working_block=${JSON.stringify(workingBlocks[workingBlocks.length - 1].slice(0, 200))}`
      );
    }
  }
  console.log(`duplicate_candidates=${dupCount}`);

  const partial = await prisma.$queryRawUnsafe(`
    SELECT id, created_at::text AS created_at, length(content) AS len
    FROM assistant_chat_messages
    WHERE author = 'assistant'
      AND content ILIKE '%доберу официальные%'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log("---");
  console.log(`partial_phrase_matches=${partial.length}`);
  console.log(JSON.stringify(partial, null, 2));

  console.log("--- RECENT_PREVIEWS ---");
  for (const row of recent.slice(0, 3)) {
    const { workingBlocks, answerText } = splitWorkingMarkdown(row.content);
    console.log(`id=${row.id} created_at=${row.created_at}`);
    console.log(`working_blocks=${workingBlocks.length} answer_len=${answerText.length}`);
    console.log(`content_start=${JSON.stringify(row.content.slice(0, 400))}`);
    console.log(`answer_start=${JSON.stringify(answerText.slice(0, 300))}`);
  }
} finally {
  await prisma.$disconnect();
}
