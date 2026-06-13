import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PHRASE =
  "Сначала доберу официальные сайты самых близких российских кандидатов";

function countPhraseOccurrences(text, phrase) {
  if (!phrase || phrase.length === 0) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while (true) {
    const found = text.indexOf(phrase, index);
    if (found === -1) {
      break;
    }
    count += 1;
    index = found + phrase.length;
  }
  return count;
}

function splitWorkingMarkdown(content) {
  const open = ":::working\n";
  const close = "\n:::";
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
  return {
    workingBlocks,
    answerText: content.slice(cursor)
  };
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

  for (const row of recent) {
    const { workingBlocks, answerText } = splitWorkingMarkdown(row.content);
    const phraseInAnswer = countPhraseOccurrences(answerText, PHRASE);
    const adjacentDupes = findAdjacentDuplicateSentences(answerText);
    const hasDup =
      phraseInAnswer > 1 || adjacentDupes.length > 0 || /(.{40,}?)\1/.test(answerText.replace(/\s+/g, " "));

    if (!hasDup && phraseInAnswer === 0 && adjacentDupes.length === 0) {
      continue;
    }

    console.log("---");
    console.log(`id=${row.id}`);
    console.log(`created_at=${row.created_at}`);
    console.log(`working_blocks=${workingBlocks.length}`);
    console.log(`answer_len=${answerText.length}`);
    console.log(`phrase_in_answer=${phraseInAnswer}`);
    console.log(`adjacent_duplicate_sentences=${JSON.stringify(adjacentDupes)}`);
    console.log(`answer_preview=${JSON.stringify(answerText.slice(0, 500))}`);
  }

  const phraseMatches = await prisma.$queryRawUnsafe(
    `SELECT id, created_at::text AS created_at, length(content) AS len
     FROM assistant_chat_messages
     WHERE author = 'assistant'
       AND content LIKE $1
     ORDER BY created_at DESC
     LIMIT 10`,
    `%${PHRASE}%`
  );
  console.log("---");
  console.log(`phrase_match_rows=${phraseMatches.length}`);
  console.log(JSON.stringify(phraseMatches, null, 2));
} finally {
  await prisma.$disconnect();
}
