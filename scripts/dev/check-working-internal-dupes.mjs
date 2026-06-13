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
    workingBlocks.push(content.slice(blockStart, blockEnd));
    cursor = blockEnd + close.length;
    while (content[cursor] === "\n") {
      cursor += 1;
    }
  }
  return { workingBlocks, answerText: content.slice(cursor) };
}

function hasInternalDuplicate(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized.split(/(?<=[.!?…])\s+/).filter(Boolean);
  for (let i = 1; i < sentences.length; i += 1) {
    if (sentences[i] === sentences[i - 1]) {
      return { type: "adjacent_sentence", value: sentences[i] };
    }
  }
  if (/(.{30,}?)\1/.test(normalized)) {
    return { type: "repeated_substring", value: normalized.slice(0, 120) };
  }
  return null;
}

try {
  const recent = await prisma.$queryRawUnsafe(`
    SELECT id, created_at, content
    FROM assistant_chat_messages
    WHERE author = 'assistant'
      AND content LIKE '%:::working%'
    ORDER BY created_at DESC
    LIMIT 30
  `);

  let affected = 0;
  for (const row of recent) {
    const { workingBlocks, answerText } = splitWorkingMarkdown(row.content);
    const dupBlocks = workingBlocks
      .map((block, index) => ({ index, dup: hasInternalDuplicate(block), block }))
      .filter((entry) => entry.dup !== null);

    const answerDup = hasInternalDuplicate(answerText);

    if (dupBlocks.length === 0 && !answerDup) {
      continue;
    }

    affected += 1;
    console.log("---");
    console.log(`id=${row.id}`);
    console.log(`created_at=${row.created_at}`);
    console.log(`working_blocks=${workingBlocks.length}`);
    for (const entry of dupBlocks) {
      console.log(`dup_in_working[${entry.index}]=${entry.dup.type}`);
      console.log(`block=${JSON.stringify(entry.block)}`);
    }
    if (answerDup) {
      console.log(`dup_in_answer=${answerDup.type}`);
      console.log(`answer=${JSON.stringify(answerText.slice(0, 400))}`);
    }
  }

  console.log("---");
  console.log(`messages_with_internal_dupes=${affected}/${recent.length}`);

  const target = recent.find((row) =>
    row.content.includes("доберу официальные сайты")
  );
  if (target) {
    const split = splitWorkingMarkdown(target.content);
    console.log("--- TARGET официальные сайты ---");
    console.log(`id=${target.id}`);
    for (let i = 0; i < split.workingBlocks.length; i += 1) {
      const block = split.workingBlocks[i];
      console.log(`block[${i}]=${JSON.stringify(block)}`);
      console.log(`dup=${JSON.stringify(hasInternalDuplicate(block))}`);
    }
  } else {
    console.log("no message with 'доберу официальные сайты' in recent 30");
  }
} finally {
  await prisma.$disconnect();
}
