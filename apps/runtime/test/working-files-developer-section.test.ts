import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

describe("TurnExecutionService working-files developer section", () => {
  test("tool-loop rebuild preserves neighboring sections and avoids duplicates", () => {
    const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
    (
      service as unknown as {
        turnContextHydrationService: {
          pruneClosedOpenLoopRefsDeveloperBlock(
            block: string | null,
            closedRefs: readonly string[]
          ): string | null;
        };
      }
    ).turnContextHydrationService = {
      pruneClosedOpenLoopRefsDeveloperBlock(block: string | null): string | null {
        return block;
      }
    };
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
          closedOpenLoopRefs: string[],
          hasToolHistory: boolean,
          toolHistory: Array<unknown>,
          availableToolNames: string[],
          forceFinalTextOnly: boolean,
          deferredMediaJobs: Array<{ toolCode: string }>,
          deferredDocumentJobs: Array<unknown>
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
      [],
      false,
      [],
      [],
      false,
      [],
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

  test("document roles and priority note are rendered inside Working Files", () => {
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
        fileRef: "file-ref-current-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/proposal.docx",
        relativePath: "uploads/proposal.docx",
        displayName: "proposal.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        logicalSizeBytes: 512,
        aliases: ["current attachment #1"],
        semanticSummaryHint: "Founder-ready proposal draft for PersAI enterprise launch."
      },
      {
        fileRef: "file-ref-last-pdf",
        origin: "runtime_output",
        sourceToolCode: "document",
        objectKey: "assistant-media/generated/proposal.pdf",
        relativePath: "generated/proposal.pdf",
        displayName: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        logicalSizeBytes: 1024,
        aliases: ["last generated file", "previous attachment #1"],
        semanticSummaryHint: "Previously delivered PDF version of the proposal."
      },
      {
        fileRef: "file-ref-history-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/notes.txt",
        relativePath: "uploads/notes.txt",
        displayName: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 256,
        logicalSizeBytes: 256,
        aliases: ["previous attachment #2"],
        semanticSummaryHint: "Earlier draft notes from the same discussion."
      }
    ]);

    assert.ok(section, "section must be non-null");
    assert.match(
      section ?? "",
      /Document-tool priority:/,
      "document priority note must be present"
    );
    assert.match(section ?? "", /CURRENT_SOURCE/, "current source role must be rendered");
    assert.match(
      section ?? "",
      /LAST_DELIVERED_RESULT/,
      "last delivered result role must be rendered"
    );
    assert.match(section ?? "", /HISTORY/, "history role must be rendered");
    assert.match(
      section ?? "",
      /prefer `CURRENT_SOURCE` when the user wants a new PDF/,
      "priority note must make current source authoritative for new document creation"
    );
    assert.match(
      section ?? "",
      /Use `LAST_DELIVERED_RESULT` only when the user explicitly wants to modify/,
      "priority note must mark last delivered result as modify-only"
    );
    assert.doesNotMatch(
      section ?? "",
      /RECENT PDFS YOU CAN REVISE/,
      "separate recent-pdfs revise section must be gone"
    );
    assert.match(
      section ?? "",
      /- current attachment #1: file "proposal\.docx" — Founder-ready proposal draft/,
      "current-source rendering must keep the current alias authoritative"
    );
    assert.doesNotMatch(
      section ?? "",
      /current attachment #1, previous attachment #1: file "proposal\.docx"/,
      "current-source rendering must not mix conflicting history aliases into the CURRENT_SOURCE line"
    );
    assert.match(
      section ?? "",
      /- last generated file: document "proposal\.pdf" — Previously delivered PDF version/,
      "last-delivered rendering must keep the last-generated alias authoritative"
    );
    assert.doesNotMatch(
      section ?? "",
      /last generated file, previous attachment #1: document "proposal\.pdf"/,
      "last-delivered rendering must not mix conflicting history aliases into the LAST_DELIVERED_RESULT line"
    );
  });

  test("recent discovered files stay inside Working Files without separate revise section", () => {
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
        objectKey: "assistant-media/uploads/report.docx",
        relativePath: "uploads/report.docx",
        displayName: "report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 123,
        logicalSizeBytes: 123,
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
      },
      {
        fileRef: "file-ref-recent-2",
        origin: "runtime_output",
        sourceToolCode: null,
        objectKey: "assistant-media/discoveries/outline.pdf",
        relativePath: "discoveries/outline.pdf",
        displayName: "outline.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        logicalSizeBytes: 1024,
        aliases: ["recent file #2"],
        semanticSummaryHint: "Earlier discovered PDF outline."
      },
      {
        fileRef: "file-ref-other-1",
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
      /### RECENT_DISCOVERED/,
      "recent discovered role must be present when recent file aliases exist"
    );
    assert.match(
      section ?? "",
      /A photo of a Viking warrior on a longship/,
      "recent discovered semanticSummaryHint must still be shown"
    );
    assert.doesNotMatch(
      section ?? "",
      /RECENT PDFS YOU CAN REVISE/,
      "recent discovered files must not be rendered through a separate revise section"
    );
  });

  test("important document roles always surface semantic hints even with strong filenames", () => {
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
        fileRef: "file-ref-current-strong",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "assistant-media/uploads/final-client-brief.docx",
        relativePath: "uploads/final-client-brief.docx",
        displayName: "final-client-brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        logicalSizeBytes: 512,
        aliases: ["current attachment #1"],
        semanticSummaryHint: "Current source document for the new branded PDF."
      },
      {
        fileRef: "file-ref-last-strong",
        origin: "runtime_output",
        sourceToolCode: "document",
        objectKey: "assistant-media/generated/final-client-brief.pdf",
        relativePath: "generated/final-client-brief.pdf",
        displayName: "final-client-brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        logicalSizeBytes: 1024,
        aliases: ["last generated file", "previous attachment #1"],
        semanticSummaryHint: "Most recent delivered PDF result for revision only."
      },
      {
        fileRef: "file-ref-recent-strong",
        origin: "runtime_output",
        sourceToolCode: null,
        objectKey: "assistant-media/discoveries/brand-guidelines.pdf",
        relativePath: "discoveries/brand-guidelines.pdf",
        displayName: "brand-guidelines.pdf",
        mimeType: "application/pdf",
        sizeBytes: 768,
        logicalSizeBytes: 768,
        aliases: ["recent file #1"],
        semanticSummaryHint:
          "Recently discovered brand-guidelines PDF from an earlier files search."
      }
    ]);

    assert.ok(section, "section must be non-null");
    assert.match(
      section ?? "",
      /- current attachment #1: file "final-client-brief\.docx" — Current source document/,
      "strong filenames must still show the current-source alias and semantic hint cleanly"
    );
    assert.match(section ?? "", /final-client-brief\.docx" — Current source document/);
    assert.match(
      section ?? "",
      /- last generated file: document "final-client-brief\.pdf" — Most recent delivered PDF result/,
      "strong filenames must still show the last-delivered alias and semantic hint cleanly"
    );
    assert.match(section ?? "", /final-client-brief\.pdf" — Most recent delivered PDF result/);
    assert.match(section ?? "", /brand-guidelines\.pdf" — Recently discovered brand-guidelines/);
    assert.doesNotMatch(
      section ?? "",
      /last generated file, previous attachment #1: document "final-client-brief\.pdf"/,
      "strong filename rendering must not reintroduce conflicting history aliases for the last delivered result"
    );
    assert.doesNotMatch(section ?? "", /fileRef|objectKey|contentPreview/);
  });

  test("recent discovered role is absent when no entry has a recent file alias", () => {
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
      /### RECENT_DISCOVERED/,
      "recent discovered role must be absent when no recent file aliases are present"
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

    assert.equal(merged.trimEnd(), "Here you go.");
    assert.doesNotMatch(merged, /Assistant sent an attachment|fileRef/i);
  });
});
