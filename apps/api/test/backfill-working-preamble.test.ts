/**
 * Golden tests for the backfill-working-preamble script logic.
 * Tests the parsing logic independently (no DB required).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

const WORKING_BLOCK_OPEN = ":::working\n";
const WORKING_BLOCK_CLOSE = "\n:::";

function parseLegacyWorkingContent(content: string): {
  workingPreamble: string;
  answerText: string;
} | null {
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

function simulateBackfill(
  rows: Array<{ id: string; content: string; metadata: Record<string, unknown> | null }>
): {
  updated: typeof rows;
  skipped: typeof rows;
  unparsed: typeof rows;
} {
  const updated: typeof rows = [];
  const skipped: typeof rows = [];
  const unparsed: typeof rows = [];

  for (const row of rows) {
    const meta = row.metadata ?? {};
    if (typeof meta.workingPreamble === "string") {
      skipped.push(row);
      continue;
    }
    const parsed = parseLegacyWorkingContent(row.content);
    if (parsed === null) {
      unparsed.push(row);
      continue;
    }
    updated.push({
      ...row,
      content: parsed.answerText,
      metadata: { ...meta, workingPreamble: parsed.workingPreamble }
    });
  }

  return { updated, skipped, unparsed };
}

describe("backfill-working-preamble", () => {
  test("parses single working block and extracts preamble + answer", () => {
    const parsed = parseLegacyWorkingContent(":::working\nСмотрю файл.\n:::\n\nВот ответ.");
    assert.deepEqual(parsed, {
      workingPreamble: "Смотрю файл.",
      answerText: "Вот ответ."
    });
  });

  test("parses multiple stacked working blocks into joined preamble", () => {
    const parsed = parseLegacyWorkingContent(
      ":::working\nСмотрю файл.\n:::\n\n:::working\nПроверяю данные.\n:::\n\nГотово."
    );
    assert.deepEqual(parsed, {
      workingPreamble: "Смотрю файл.\n\nПроверяю данные.",
      answerText: "Готово."
    });
  });

  test("returns null for content that does not start with :::working", () => {
    const parsed = parseLegacyWorkingContent("Just a normal answer.");
    assert.equal(parsed, null);
  });

  test("returns null for unclosed working block", () => {
    const parsed = parseLegacyWorkingContent(":::working\nUnclosed block without close marker");
    assert.equal(parsed, null);
  });

  test("backfill is idempotent: second pass skips already-migrated rows", () => {
    const rows = [
      {
        id: "msg-1",
        content: ":::working\nПроверяю.\n:::\n\nОтвет.",
        metadata: null
      }
    ];

    const pass1 = simulateBackfill(rows);
    assert.equal(pass1.updated.length, 1);
    assert.equal(pass1.skipped.length, 0);
    assert.equal(pass1.updated[0]?.content, "Ответ.");
    assert.equal(
      (pass1.updated[0]?.metadata as Record<string, unknown>)?.workingPreamble,
      "Проверяю."
    );

    // Run backfill again on already-migrated rows
    const pass2 = simulateBackfill(pass1.updated);
    assert.equal(pass2.updated.length, 0, "second pass must not re-update migrated rows");
    assert.equal(pass2.skipped.length, 1, "second pass must skip already-migrated row");
  });

  test("leaves unparseable rows untouched and counts them", () => {
    const rows = [
      { id: "msg-1", content: ":::working\nUnclosed", metadata: null },
      { id: "msg-2", content: "Normal content", metadata: null }
    ];

    const result = simulateBackfill(rows);
    assert.equal(result.updated.length, 0);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.unparsed.length, 2);
  });
});
