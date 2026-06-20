/**
 * Golden tests for the backfill-working-notes script logic.
 * Tests the parsing + migration logic independently (no DB required).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

const WORKING_BLOCK_OPEN = ":::working\n";
const WORKING_BLOCK_CLOSE = "\n:::";

function parseLegacyWorkingContent(content: string): {
  workingNotes: string[];
  answerText: string;
} | null {
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

type Row = { id: string; content: string; metadata: Record<string, unknown> | null };

/**
 * Mirrors the script's per-row decision tree for the final
 * `metadata.workingNotes: string[]` form.
 */
function simulateBackfill(rows: Row[]): {
  updated: Row[];
  skipped: Row[];
  unparsed: Row[];
} {
  const updated: Row[] = [];
  const skipped: Row[] = [];
  const unparsed: Row[] = [];

  for (const row of rows) {
    const meta = row.metadata ?? {};

    // Already in final form.
    if (Array.isArray(meta.workingNotes)) {
      if (typeof meta.workingPreamble === "string") {
        const { workingPreamble: _legacy, ...rest } = meta;
        updated.push({ ...row, metadata: rest });
      } else {
        skipped.push(row);
      }
      continue;
    }

    // Legacy single-string preamble → one-element notes array.
    if (typeof meta.workingPreamble === "string") {
      const { workingPreamble, ...rest } = meta;
      updated.push({ ...row, metadata: { ...rest, workingNotes: [workingPreamble] } });
      continue;
    }

    // Legacy `:::working` content markers.
    const parsed = parseLegacyWorkingContent(row.content);
    if (parsed === null) {
      unparsed.push(row);
      continue;
    }
    updated.push({
      ...row,
      content: parsed.answerText,
      metadata: { ...meta, workingNotes: parsed.workingNotes }
    });
  }

  return { updated, skipped, unparsed };
}

describe("backfill-working-notes", () => {
  test("parses single working block into a one-element notes array", () => {
    const parsed = parseLegacyWorkingContent(":::working\nСмотрю файл.\n:::\n\nВот ответ.");
    assert.deepEqual(parsed, {
      workingNotes: ["Смотрю файл."],
      answerText: "Вот ответ."
    });
  });

  test("parses multiple stacked working blocks into a multi-element notes array", () => {
    const parsed = parseLegacyWorkingContent(
      ":::working\nСмотрю файл.\n:::\n\n:::working\nПроверяю данные.\n:::\n\nГотово."
    );
    assert.deepEqual(parsed, {
      workingNotes: ["Смотрю файл.", "Проверяю данные."],
      answerText: "Готово."
    });
  });

  test("returns null for content that does not start with :::working", () => {
    assert.equal(parseLegacyWorkingContent("Just a normal answer."), null);
  });

  test("returns null for unclosed working block", () => {
    assert.equal(
      parseLegacyWorkingContent(":::working\nUnclosed block without close marker"),
      null
    );
  });

  test("migrates legacy metadata.workingPreamble string to workingNotes array", () => {
    const rows: Row[] = [
      { id: "msg-1", content: "Final answer.", metadata: { workingPreamble: "Проверяю." } }
    ];
    const result = simulateBackfill(rows);
    assert.equal(result.updated.length, 1);
    assert.deepEqual((result.updated[0]?.metadata as Record<string, unknown>)?.workingNotes, [
      "Проверяю."
    ]);
    assert.equal(
      (result.updated[0]?.metadata as Record<string, unknown>)?.workingPreamble,
      undefined,
      "legacy workingPreamble must be dropped after migration"
    );
    // content untouched (already clean for this row form).
    assert.equal(result.updated[0]?.content, "Final answer.");
  });

  test("migrates legacy :::working content markers to workingNotes array + clean content", () => {
    const rows: Row[] = [
      {
        id: "msg-1",
        content: ":::working\nПервый шаг.\n:::\n\n:::working\nВторой шаг.\n:::\n\nИтог.",
        metadata: null
      }
    ];
    const result = simulateBackfill(rows);
    assert.equal(result.updated.length, 1);
    assert.deepEqual((result.updated[0]?.metadata as Record<string, unknown>)?.workingNotes, [
      "Первый шаг.",
      "Второй шаг."
    ]);
    assert.equal(result.updated[0]?.content, "Итог.");
  });

  test("backfill is idempotent: rows already in workingNotes form are skipped", () => {
    const rows: Row[] = [
      { id: "msg-1", content: "Final answer.", metadata: { workingNotes: ["A", "B"] } }
    ];
    const pass1 = simulateBackfill(rows);
    assert.equal(pass1.skipped.length, 1, "already-migrated row must be skipped");
    assert.equal(pass1.updated.length, 0);
  });

  test("end-to-end idempotency: preamble migration then a second pass is a no-op", () => {
    const rows: Row[] = [
      { id: "msg-1", content: ":::working\nШаг.\n:::\n\nОтвет.", metadata: null }
    ];
    const pass1 = simulateBackfill(rows);
    assert.equal(pass1.updated.length, 1);
    assert.deepEqual((pass1.updated[0]?.metadata as Record<string, unknown>)?.workingNotes, [
      "Шаг."
    ]);
    const pass2 = simulateBackfill(pass1.updated);
    assert.equal(pass2.updated.length, 0, "second pass must not re-update migrated rows");
    assert.equal(pass2.skipped.length, 1, "second pass must skip already-migrated row");
  });

  test("leaves unparseable rows untouched and counts them", () => {
    const rows: Row[] = [
      { id: "msg-1", content: ":::working\nUnclosed", metadata: null },
      { id: "msg-2", content: "Normal content", metadata: null }
    ];
    const result = simulateBackfill(rows);
    assert.equal(result.updated.length, 0);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.unparsed.length, 2);
  });
});
