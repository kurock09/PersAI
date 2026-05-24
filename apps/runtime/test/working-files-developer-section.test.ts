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

  test("closed-world phrasing is gone and recovery instruction is present", () => {
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
        fileRef: "file-ref-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/photo.jpg",
        relativePath: "uploads/photo.jpg",
        displayName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 123,
        logicalSizeBytes: 123,
        aliases: ["current image #1"],
        semanticSummaryHint: null
      }
    ]);

    assert.ok(section, "section must be non-null");
    assert.doesNotMatch(section ?? "", /Use only these aliases/);
    assert.match(
      section ?? "",
      /These are the reusable file handles the system has already prepared for this turn\./
    );
    assert.match(section ?? "", /[Aa]lways call `files\.list`/);
  });

  test("delivery rule is present", () => {
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
        fileRef: "file-ref-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/photo.jpg",
        relativePath: "uploads/photo.jpg",
        displayName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 123,
        logicalSizeBytes: 123,
        aliases: ["current image #1"],
        semanticSummaryHint: null
      }
    ]);

    assert.ok(section, "section must be non-null");
    assert.match(
      section ?? "",
      /MUST call `files\.send`.*alias/i,
      "delivery rule must instruct model to call files.send with alias"
    );
  });

  test("corpus rule covers find/list/search/re-check and orders files.list before files.search", () => {
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
        fileRef: "file-ref-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/photo.jpg",
        relativePath: "uploads/photo.jpg",
        displayName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 123,
        logicalSizeBytes: 123,
        aliases: ["current image #1"],
        semanticSummaryHint: null
      }
    ]);

    assert.ok(section, "section must be non-null");
    assert.match(
      section ?? "",
      /find.*list.*search.*re-check|find, list, search, or re-check/i,
      "corpus rule must mention find/list/search/re-check triggers"
    );
    const listPos = (section ?? "").indexOf("files.list");
    const searchPos = (section ?? "").indexOf("files.search");
    assert.ok(listPos !== -1, "files.list must appear in corpus rule");
    assert.ok(searchPos !== -1, "files.search must appear in corpus rule");
    assert.ok(listPos < searchPos, "files.list must appear before files.search in corpus rule");
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

  test("recent files sub-header appears and semanticSummaryHint is shown when recent file aliases present", () => {
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
        fileRef: "file-ref-attach-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/report.pdf",
        relativePath: "uploads/report.pdf",
        displayName: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        logicalSizeBytes: 512,
        aliases: ["current attachment #1"],
        semanticSummaryHint: null
      },
      {
        fileRef: "file-ref-recent-1",
        origin: "runtime_output",
        sourceToolCode: null,
        objectKey: "assistant-media/discoveries/viking.png",
        relativePath: "discoveries/viking.png",
        displayName: "viking.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        logicalSizeBytes: 1024,
        aliases: ["recent file #1"],
        semanticSummaryHint: "A photo of a Viking warrior on a longship"
      }
    ]);

    assert.ok(section, "section must be non-null");
    assert.match(
      section ?? "",
      /### Recent Files \(found via the files tool earlier in this chat\)/,
      "recent files sub-header must be present"
    );
    assert.match(
      section ?? "",
      /A photo of a Viking warrior on a longship/,
      "semanticSummaryHint must appear in the recent files sub-section"
    );
    assert.match(section ?? "", /current attachment #1/, "regular attachment must still appear");
  });

  test("recent files sub-header is absent when no entry has a recent file alias", () => {
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
        fileRef: "file-ref-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/photo.jpg",
        relativePath: "uploads/photo.jpg",
        displayName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 123,
        logicalSizeBytes: 123,
        aliases: ["current image #1"],
        semanticSummaryHint: null
      }
    ]);

    assert.ok(section, "section must be non-null");
    assert.doesNotMatch(
      section ?? "",
      /### Recent Files/,
      "recent files sub-header must be absent when no recent file aliases are present"
    );
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
