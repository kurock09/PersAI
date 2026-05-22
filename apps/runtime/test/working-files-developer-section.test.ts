import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

describe("TurnExecutionService working-files developer section", () => {
  test("tool-loop rebuild preserves neighboring sections and avoids duplicates", () => {
    const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
    const baseSections = [
      {
        key: "routing_hints",
        content: "## Early Routing Hints\nSelected execution mode: normal."
      },
      {
        key: "working_files",
        content:
          '## Working Files\nServer-owned reusable file aliases for this turn. These aliases are not ordinary conversation text.\n- stale alias: image "old-photo.jpg"'
      },
      {
        key: "presence",
        content: "# Sense of Time\n- Current local time (user's timezone): 19:42"
      },
      {
        key: "open_media_jobs",
        content:
          "## Open Media Jobs\n1. image_edit job is running; created 2026-05-07T16:42:12.156Z, started 2026-05-07T16:42:13.613Z."
      }
    ];

    const refreshed = (
      service as unknown as {
        buildToolLoopDeveloperInstructions(
          baseSections: Array<{ key: string; content: string }>,
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
          }>,
          hasToolHistory: boolean,
          forceFinalTextOnly: boolean,
          deferredMediaJobs: Array<{ toolCode: string }>
        ): string | null;
      }
    ).buildToolLoopDeveloperInstructions(
      baseSections,
      [
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
      ],
      false,
      false,
      []
    );

    assert.ok(refreshed);
    assert.equal((refreshed.match(/## Working Files/g) ?? []).length, 1);
    assert.match(refreshed ?? "", /# Sense of Time/);
    assert.match(refreshed ?? "", /## Open Media Jobs/);
  });

  test("working files section shows bounded semantic hints without dumping previews", () => {
    const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
    const section = (
      service as unknown as {
        buildWorkingFilesDeveloperSection(
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
            semanticSummaryHint?: string | null;
          }>
        ): string | null;
      }
    ).buildWorkingFilesDeveloperSection([
      {
        fileRef: "file-ref-weak",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/file.bin",
        relativePath: "uploads/file.bin",
        displayName: "file.bin",
        mimeType: "application/pdf",
        sizeBytes: 100,
        logicalSizeBytes: 100,
        aliases: ["previous attachment #1"],
        semanticSummaryHint:
          "Quarterly revenue breakdown by region with notes about EMEA slowdown and APAC expansion targets for the next fiscal year."
      },
      {
        fileRef: "file-ref-strong",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/revenue-q2.pdf",
        relativePath: "uploads/revenue-q2.pdf",
        displayName: "revenue-q2.pdf",
        mimeType: "application/pdf",
        sizeBytes: 200,
        logicalSizeBytes: 200,
        aliases: ["previous attachment #2"],
        semanticSummaryHint: "Should not appear because filename is descriptive."
      }
    ]);

    assert.ok(section);
    assert.match(section ?? "", /— Quarterly revenue breakdown/);
    assert.doesNotMatch(section ?? "", /EMEA slowdown and APAC expansion targets/);
    assert.doesNotMatch(section ?? "", /revenue-q2\.pdf.*—/);
    assert.doesNotMatch(section ?? "", /contentPreview|fileRef|objectKey/);
  });

  test("working files section caps model-visible files and avoids raw technical identifier wording", () => {
    const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
    const section = (
      service as unknown as {
        buildWorkingFilesDeveloperSection(
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
    ).buildWorkingFilesDeveloperSection(
      Array.from({ length: 25 }, (_, index) => ({
        fileRef: `file-ref-${index + 1}`,
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: `assistant-media/uploads/file-${index + 1}.png`,
        relativePath: `uploads/file-${index + 1}.png`,
        displayName: `file-${index + 1}.png`,
        mimeType: "image/png",
        sizeBytes: 100 + index,
        logicalSizeBytes: 100 + index,
        aliases: [`current image #${index + 1}`]
      }))
    );

    assert.ok(section);
    assert.equal(
      (section?.match(/^- current image #/gm) ?? []).length,
      20,
      "only the latest model-visible working files should be rendered"
    );
    assert.doesNotMatch(section ?? "", /fileRef|artifactId|objectKey|attachmentId/);
  });

  test("legacy technical attachment summary is stripped before tool-loop reinjection", () => {
    const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
    const merged = (
      service as unknown as {
        mergeAssistantTurnText(existingText: string, nextText: string | null): string;
      }
    ).mergeAssistantTurnText(
      "",
      'Here you go.\n\nAssistant sent an attachment: document "plan.md", fileRef: "file-ref-1".'
    );

    assert.equal(merged, "Here you go.");
    assert.doesNotMatch(merged, /Assistant sent an attachment|fileRef/i);
  });
});
