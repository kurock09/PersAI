import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

describe("TurnExecutionService working-files developer section", () => {
  test("refreshing working files preserves neighboring sections and avoids duplicates", () => {
    const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
    const existing = [
      "## Early Routing Hints",
      "Selected execution mode: normal.",
      "",
      "## Working Files",
      "Server-owned reusable file aliases for this turn. These aliases are not ordinary conversation text.",
      '- current image #1: image "photo.jpg"',
      "",
      "# Sense of Time",
      "- Current local time (user's timezone): 19:42",
      "",
      "## Open Media Jobs",
      "1. image_edit job is running; created 2026-05-07T16:42:12.156Z, started 2026-05-07T16:42:13.613Z."
    ].join("\n");

    const refreshed = (
      service as unknown as {
        replaceWorkingFilesDeveloperSection(
          existing: string | null,
          availableWorkingFileRefs: Array<{
            fileRef: string;
            origin: string;
            sourceToolCode: string | null;
            objectKey: string;
            relativePath: string;
            displayName: string;
            mimeType: string;
            sizeBytes: number;
            logicalSizeBytes: number;
            aliases: string[];
          }>
        ): string | null;
      }
    ).replaceWorkingFilesDeveloperSection(existing, [
      {
        fileRef: "file-ref-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/photo.jpg",
        relativePath: "uploads/photo.jpg",
        displayName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 123,
        logicalSizeBytes: 123,
        aliases: ["current image #1", "current attachment #1"]
      }
    ]);

    assert.ok(refreshed);
    assert.equal((refreshed.match(/## Working Files/g) ?? []).length, 1);
    assert.match(refreshed ?? "", /# Sense of Time/);
    assert.match(refreshed ?? "", /## Open Media Jobs/);
  });
});
