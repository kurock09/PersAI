import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

type TestWorkingFile = {
  fileRef: string;
  origin: "uploaded_attachment" | "runtime_output" | "sandbox_output";
  sourceToolCode: string | null;
  objectKey: string;
  relativePath: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  logicalSizeBytes: number;
  aliases: string[];
  createdAt?: string;
  authorLabel?: "user" | "model" | "sandbox";
  semanticSummaryHint?: string | null;
};

function buildSection(files: TestWorkingFile[]): string | null {
  const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
  return (
    service as unknown as {
      buildWorkingFilesDeveloperSection(availableWorkingFileRefs: TestWorkingFile[]): string | null;
    }
  ).buildWorkingFilesDeveloperSection(files);
}

function formatUtcTimestamp(value: string): string {
  const parsed = new Date(value);
  const year = String(parsed.getUTCFullYear());
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

describe("TurnExecutionService working files developer section", () => {
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
        content: "## Working Files\n- stale"
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
          availableWorkingFileRefs: TestWorkingFile[],
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
          aliases: ["image #1", "file #1"],
          createdAt: "2026-05-26T11:10:00.000Z",
          authorLabel: "user",
          semanticSummaryHint: "Portrait photo for editing."
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

  test("renders working files with sticky labels and marker column", () => {
    const section = buildSection([
      {
        fileRef: "file-old",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "uploads/old.txt",
        relativePath: "uploads/old.txt",
        displayName: "old.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["file #1"],
        createdAt: "2026-05-24T08:05:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Older user draft."
      },
      {
        fileRef: "file-new",
        origin: "runtime_output",
        sourceToolCode: "image_edit",
        objectKey: "generated/portrait.png",
        relativePath: "generated/portrait.png",
        displayName: "portrait.png",
        mimeType: "image/png",
        sizeBytes: 20,
        logicalSizeBytes: 20,
        aliases: ["image #1", "file #2"],
        createdAt: "2026-05-26T14:32:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Makeup strengthened and colors balanced."
      },
      {
        fileRef: "file-sandbox",
        origin: "sandbox_output",
        sourceToolCode: "files",
        objectKey: "sandbox/report.md",
        relativePath: "outputs/report.md",
        displayName: "report.md",
        mimeType: "text/markdown",
        sizeBytes: 30,
        logicalSizeBytes: 30,
        aliases: ["file #3"],
        createdAt: "2026-05-25T09:15:00.000Z",
        authorLabel: "sandbox",
        semanticSummaryHint: "Sandbox-generated report."
      }
    ]);

    assert.ok(section);
    assert.match(section ?? "", /## Working Files/);
    assert.doesNotMatch(section ?? "", /Format:/);
    const historyLines = (section ?? "").split("\n").filter((line) => line.startsWith("- 2026-"));
    assert.deepEqual(
      historyLines.map((line) => line.slice(2, 18)),
      [
        formatUtcTimestamp("2026-05-26T14:32:00.000Z"),
        formatUtcTimestamp("2026-05-25T09:15:00.000Z"),
        formatUtcTimestamp("2026-05-24T08:05:00.000Z")
      ]
    );
    assert.equal(
      historyLines[0]?.startsWith(
        `- ${formatUtcTimestamp("2026-05-26T14:32:00.000Z")} | model | image #1 (file #2) | portrait.png | - | Makeup strengthened`
      ),
      true
    );
    assert.match(
      historyLines[1] ?? "",
      /\| sandbox \| file #3 \| report\.md \| - \| Sandbox-generated/
    );
    assert.match(
      historyLines[2] ?? "",
      /\| user \| file #1 \| old\.txt \| current source \| Older user draft/
    );
    assert.doesNotMatch(
      section ?? "",
      /### HISTORY|### OTHER_FILES|current attachment #|last generated image/
    );
    assert.match(section ?? "", /Use sticky aliases first/);
    assert.match(section ?? "", /do not answer from this block alone/);
  });

  test("keeps both same-name files visible and disambiguates them", () => {
    const section = buildSection([
      {
        fileRef: "aaaaaaaa-1111-1111-1111-11111111abcd",
        origin: "runtime_output",
        sourceToolCode: "image_edit",
        objectKey: "generated/foo-1.png",
        relativePath: "generated/foo-1.png",
        displayName: "foo.png",
        mimeType: "image/png",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["image #1", "file #1"],
        createdAt: "2026-05-26T14:32:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Makeup strengthened."
      },
      {
        fileRef: "bbbbbbbb-2222-2222-2222-22222222dcba",
        origin: "runtime_output",
        sourceToolCode: "image_edit",
        objectKey: "generated/foo-2.png",
        relativePath: "generated/foo-2.png",
        displayName: "foo.png",
        mimeType: "image/png",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["image #2", "file #2"],
        createdAt: "2026-05-26T13:32:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Hair color corrected."
      }
    ]);

    assert.ok(section);
    assert.match(section ?? "", /foo\.png \[1111abcd\] \| - \| Makeup strengthened\./);
    assert.match(section ?? "", /foo\.png \[2222dcba\] \| - \| Hair color corrected\./);
  });

  test("document priority note remains without rendering legacy role sections", () => {
    const section = buildSection([
      {
        fileRef: "file-current-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "uploads/proposal.docx",
        relativePath: "uploads/proposal.docx",
        displayName: "proposal.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        logicalSizeBytes: 512,
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:40:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Current source document for the new PDF."
      },
      {
        fileRef: "file-last-1",
        origin: "runtime_output",
        sourceToolCode: "document",
        objectKey: "generated/proposal.pdf",
        relativePath: "generated/proposal.pdf",
        displayName: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        logicalSizeBytes: 1024,
        aliases: ["file #2"],
        createdAt: "2026-05-26T14:20:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Latest delivered PDF result."
      }
    ]);

    assert.ok(section);
    assert.match(section ?? "", /Document-tool priority \(PDF only\):/);
    assert.match(section ?? "", /CURRENT_SOURCE = file #1 \| proposal\.docx/);
    assert.match(section ?? "", /LAST_DELIVERED_RESULT = file #2 \| proposal\.pdf/);
    assert.match(
      section ?? "",
      /Use CURRENT_SOURCE for new document creation; use LAST_DELIVERED_RESULT only for an explicit revise\/redeliver request\./
    );
    assert.doesNotMatch(
      section ?? "",
      /### CURRENT_SOURCE|### HISTORY|### OTHER_FILES|RECENT PDFS YOU CAN REVISE/
    );
  });

  test("keeps current source and last delivered anchors visible when older files exceed the cap", () => {
    const extraFiles = Array.from({ length: 20 }, (_, index) => ({
      fileRef: `extra-file-${String(index + 1)}`,
      origin: "runtime_output" as const,
      sourceToolCode: "image_edit",
      objectKey: `generated/extra-${String(index + 1)}.png`,
      relativePath: `generated/extra-${String(index + 1)}.png`,
      displayName: `extra-${String(index + 1)}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      logicalSizeBytes: 10,
      aliases: [`image #${String(index + 1)}`, `file #${String(index + 1 + 2)}`],
      createdAt: `2026-05-${String(25 - Math.floor(index / 2)).padStart(2, "0")}T${String(
        23 - (index % 2)
      ).padStart(2, "0")}:00:00.000Z`,
      authorLabel: "model" as const,
      semanticSummaryHint: `Extra image ${String(index + 1)}.`
    }));
    const section = buildSection([
      {
        fileRef: "file-current-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "uploads/proposal.docx",
        relativePath: "uploads/proposal.docx",
        displayName: "proposal.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        logicalSizeBytes: 512,
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:40:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Current source document for the new PDF."
      },
      ...extraFiles,
      {
        fileRef: "file-last-1",
        origin: "runtime_output",
        sourceToolCode: "document",
        objectKey: "generated/proposal.pdf",
        relativePath: "generated/proposal.pdf",
        displayName: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        logicalSizeBytes: 1024,
        aliases: ["file #2"],
        createdAt: "2026-04-01T10:00:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Latest delivered PDF result."
      }
    ]);

    assert.ok(section);
    const historyLines = (section ?? "").split("\n").filter((line) => line.startsWith("- 2026-"));
    assert.equal(historyLines.length, 20);
    assert.match(section ?? "", /CURRENT_SOURCE = file #1 \| proposal\.docx/);
    assert.match(section ?? "", /LAST_DELIVERED_RESULT = file #2 \| proposal\.pdf/);
    assert.match(
      section ?? "",
      /- 2026-04-01 10:00 \| model \| file #2 \| proposal\.pdf \| last delivered result \| Latest delivered PDF result\./
    );
  });

  test("always shows microdescriptions when present and keeps recovery instructions", () => {
    const section = buildSection([
      {
        fileRef: "file-1",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "uploads/final-client-brief.docx",
        relativePath: "uploads/final-client-brief.docx",
        displayName: "final-client-brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        logicalSizeBytes: 512,
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:50:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Current source document for the new branded PDF."
      }
    ]);

    assert.ok(section);
    assert.match(
      section ?? "",
      /\| final-client-brief\.docx \| current source \| Current source document for the new branded PDF\./
    );
    assert.match(section ?? "", /use `files\.list`\/`files\.search`/i);
    assert.match(section ?? "", /Do not send files or claim delivery\/preparation/i);
    assert.doesNotMatch(section ?? "", /fileRef|objectKey|attachmentId|contentPreview/);
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

  test("adding a newer file does not renumber existing sticky labels", () => {
    const originalSection = buildSection([
      {
        fileRef: "older-image",
        origin: "runtime_output",
        sourceToolCode: "image_edit",
        objectKey: "generated/older.png",
        relativePath: "generated/older.png",
        displayName: "older.png",
        mimeType: "image/png",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["image #1", "file #1"],
        createdAt: "2026-05-20T10:00:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Older image."
      },
      {
        fileRef: "older-doc",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "uploads/brief.docx",
        relativePath: "uploads/brief.docx",
        displayName: "brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["file #2"],
        createdAt: "2026-05-21T10:00:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Older document."
      }
    ]);
    const expandedSection = buildSection([
      {
        fileRef: "older-image",
        origin: "runtime_output",
        sourceToolCode: "image_edit",
        objectKey: "generated/older.png",
        relativePath: "generated/older.png",
        displayName: "older.png",
        mimeType: "image/png",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["image #1", "file #1"],
        createdAt: "2026-05-20T10:00:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Older image."
      },
      {
        fileRef: "older-doc",
        origin: "uploaded_attachment",
        sourceToolCode: null,
        objectKey: "uploads/brief.docx",
        relativePath: "uploads/brief.docx",
        displayName: "brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["file #2"],
        createdAt: "2026-05-21T10:00:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Older document."
      },
      {
        fileRef: "newer-image",
        origin: "runtime_output",
        sourceToolCode: "image_edit",
        objectKey: "generated/newer.png",
        relativePath: "generated/newer.png",
        displayName: "newer.png",
        mimeType: "image/png",
        sizeBytes: 10,
        logicalSizeBytes: 10,
        aliases: ["image #2", "file #3"],
        createdAt: "2026-05-22T10:00:00.000Z",
        authorLabel: "model",
        semanticSummaryHint: "Newer image."
      }
    ]);

    assert.match(originalSection ?? "", /\| image #1 \(file #1\) \| older\.png \|/);
    assert.match(originalSection ?? "", /\| file #2 \| brief\.docx \|/);
    assert.match(expandedSection ?? "", /\| image #1 \(file #1\) \| older\.png \|/);
    assert.match(expandedSection ?? "", /\| file #2 \| brief\.docx \|/);
    assert.match(expandedSection ?? "", /\| image #2 \(file #3\) \| newer\.png \|/);
  });
});
