import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeFileHandle } from "@persai/runtime-contract";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

type TestWorkingFile = RuntimeFileHandle;

const TEST_SESSION_ROOT = "/workspace/assistants/assistant-handle/sessions/session-id";

function wp(relativePath: string): string {
  return `${TEST_SESSION_ROOT}/${relativePath.replace(/^\/+/, "")}`;
}

function workingFile(input: {
  storagePath: string;
  displayName: string;
  mimeType: string;
  sizeBytes?: number;
  aliases: string[];
  createdAt?: string;
  authorLabel?: "user" | "model" | "sandbox";
  semanticSummaryHint?: string | null;
  sourceToolCode?: string | null;
  visibilityTier?: RuntimeFileHandle["visibilityTier"];
  documentVersionNumber?: number | null;
}): TestWorkingFile {
  return {
    storagePath: input.storagePath,
    displayName: input.displayName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes ?? 10,
    workspaceId: "workspace-1",
    aliases: input.aliases,
    visibilityTier: input.visibilityTier ?? "session",
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(input.authorLabel === undefined ? {} : { authorLabel: input.authorLabel }),
    ...(input.semanticSummaryHint === undefined
      ? {}
      : { semanticSummaryHint: input.semanticSummaryHint }),
    ...(input.sourceToolCode === undefined || input.sourceToolCode === null
      ? {}
      : { sourceToolCode: input.sourceToolCode }),
    ...(input.documentVersionNumber === undefined
      ? {}
      : { documentVersionNumber: input.documentVersionNumber })
  };
}

function buildSection(
  files: TestWorkingFile[],
  context?: {
    currentSessionRoot?: string | null;
  }
): string | null {
  const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
  return (
    service as unknown as {
      buildWorkingFilesDeveloperSection(
        availableWorkingFileHandles: RuntimeFileHandle[],
        context?: {
          currentChatId: string | null;
          producedPaths: ReadonlySet<string>;
          currentSessionRoot?: string | null;
        }
      ): string | null;
    }
  ).buildWorkingFilesDeveloperSection(files, {
    currentChatId: null,
    producedPaths: new Set<string>(),
    currentSessionRoot:
      context !== undefined && "currentSessionRoot" in context
        ? context.currentSessionRoot
        : TEST_SESSION_ROOT
  });
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
          availableWorkingFileHandles: RuntimeFileHandle[],
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
        workingFile({
          storagePath: wp("photo.jpg"),
          displayName: "photo.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 123,
          aliases: ["image #1", "file #1"],
          createdAt: "2026-05-26T11:10:00.000Z",
          authorLabel: "user",
          semanticSummaryHint: "Portrait photo for editing."
        })
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
      workingFile({
        storagePath: wp("old.txt"),
        displayName: "old.txt",
        mimeType: "text/plain",
        aliases: ["file #1"],
        createdAt: "2026-05-24T08:05:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Older user draft."
      }),
      workingFile({
        storagePath: wp("portrait.png"),
        displayName: "portrait.png",
        mimeType: "image/png",
        aliases: ["image #1", "file #2"],
        createdAt: "2026-05-26T14:32:00.000Z",
        authorLabel: "model",
        sourceToolCode: "image_edit",
        semanticSummaryHint: "Makeup strengthened and colors balanced."
      }),
      workingFile({
        storagePath: wp("outputs/report.md"),
        displayName: "report.md",
        mimeType: "text/markdown",
        aliases: ["file #3"],
        createdAt: "2026-05-25T09:15:00.000Z",
        authorLabel: "sandbox",
        sourceToolCode: "files",
        semanticSummaryHint: "Sandbox-generated report."
      })
    ]);

    assert.ok(section);
    assert.match(section ?? "", /## Working Files/);
    assert.match(section ?? "", new RegExp(`cwd: ${TEST_SESSION_ROOT}/`));
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
      historyLines[0]?.includes(
        `| model | image #1 (file #2) | portrait.png | path=${wp("portrait.png")} | last delivered | Makeup strengthened`
      ),
      true
    );
    assert.match(
      historyLines[1] ?? "",
      new RegExp(
        `\\| sandbox \\| file #3 \\| report\\.md \\| path=${wp("outputs/report.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| - \\| Sandbox-generated`
      )
    );
    assert.match(
      historyLines[2] ?? "",
      new RegExp(
        `\\| user \\| file #1 \\| old\\.txt \\| path=${wp("old.txt").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| current source \\| Older user draft`
      )
    );
    assert.doesNotMatch(
      section ?? "",
      /### HISTORY|### OTHER_FILES|current attachment #|last generated image/
    );
    assert.match(section ?? "", /Address files by the exact `path` shown above/);
    assert.match(section ?? "", /Do not reconstruct a path from displayName\/filename/);
    assert.match(
      section ?? "",
      /Recover a forgotten path with `files\.list`, then `files\.search`/
    );
  });

  test("keeps both same-name files visible and disambiguates them", () => {
    const section = buildSection([
      workingFile({
        storagePath: wp("foo-1.png"),
        displayName: "foo.png",
        mimeType: "image/png",
        aliases: ["image #1", "file #1"],
        createdAt: "2026-05-26T14:32:00.000Z",
        authorLabel: "model",
        sourceToolCode: "image_edit",
        semanticSummaryHint: "Makeup strengthened."
      }),
      workingFile({
        storagePath: wp("foo-2.png"),
        displayName: "foo.png",
        mimeType: "image/png",
        aliases: ["image #2", "file #2"],
        createdAt: "2026-05-26T13:32:00.000Z",
        authorLabel: "model",
        sourceToolCode: "image_edit",
        semanticSummaryHint: "Hair color corrected."
      })
    ]);

    assert.ok(section);
    assert.match(
      section ?? "",
      new RegExp(
        `foo\\.png \\[#1\\] \\| path=${wp("foo-1.png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| last delivered \\| Makeup strengthened\\.`
      )
    );
    assert.match(
      section ?? "",
      new RegExp(
        `foo\\.png \\[#2\\] \\| path=${wp("foo-2.png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| - \\| Hair color corrected\\.`
      )
    );
  });

  test("marks the newest user or model delivery with last delivered and ignores sandbox scratch", () => {
    const section = buildSection([
      workingFile({
        storagePath: wp("older-user.docx"),
        displayName: "older-user.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        aliases: ["file #1"],
        createdAt: "2026-05-26T10:00:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Older uploaded source."
      }),
      workingFile({
        storagePath: wp("newer-model.pdf"),
        displayName: "newer-model.pdf",
        mimeType: "application/pdf",
        aliases: ["file #2"],
        createdAt: "2026-05-26T12:00:00.000Z",
        authorLabel: "model",
        sourceToolCode: "document",
        semanticSummaryHint: "Newer delivered PDF."
      }),
      workingFile({
        storagePath: wp("scratch/tmp-notes.md"),
        displayName: "tmp-notes.md",
        mimeType: "text/markdown",
        aliases: ["file #3"],
        createdAt: "2026-05-26T15:00:00.000Z",
        authorLabel: "sandbox",
        sourceToolCode: "files",
        semanticSummaryHint: "Sandbox scratch notes."
      })
    ]);

    assert.ok(section);
    assert.match(
      section ?? "",
      new RegExp(
        `newer-model\\.pdf \\| path=${wp("newer-model.pdf").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| last delivered`
      )
    );
    assert.doesNotMatch(section ?? "", /LAST_DELIVERED_FILE =/);
    assert.doesNotMatch(section ?? "", /Document-tool PDF anchors/);
    const historyLines = (section ?? "").split("\n").filter((line) => line.startsWith("- 2026-"));
    for (const line of historyLines) {
      const microDescription = line.split(" | ").at(-1) ?? "";
      assert.notEqual(microDescription, "-", `microDescription must not be "-" for line: ${line}`);
    }
  });

  test("renders document role markers on file rows without legacy anchor blocks", () => {
    const section = buildSection([
      workingFile({
        storagePath: wp("proposal.docx"),
        displayName: "proposal.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:40:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Current source document for the new PDF."
      }),
      workingFile({
        storagePath: wp("proposal.pdf"),
        displayName: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        aliases: ["file #2"],
        createdAt: "2026-05-26T14:20:00.000Z",
        authorLabel: "model",
        sourceToolCode: "document",
        semanticSummaryHint: "Latest delivered PDF result."
      })
    ]);

    assert.ok(section);
    assert.match(
      section ?? "",
      new RegExp(
        `proposal\\.docx \\| path=${wp("proposal.docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| .*current source`
      )
    );
    assert.doesNotMatch(section ?? "", /last delivered result/);
    assert.match(
      section ?? "",
      new RegExp(
        `proposal\\.docx \\| path=${wp("proposal.docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| .*last delivered`
      )
    );
    assert.doesNotMatch(section ?? "", /Document-tool PDF anchors/);
    assert.doesNotMatch(section ?? "", /DOC_CURRENT_SOURCE/);
    assert.doesNotMatch(section ?? "", /LAST_DELIVERED_FILE =/);
    assert.doesNotMatch(
      section ?? "",
      /### CURRENT_SOURCE|### HISTORY|### OTHER_FILES|RECENT PDFS YOU CAN REVISE/
    );
  });

  test("shows document version marker on registered pdf/docx/xlsx rows", () => {
    const section = buildSection([
      workingFile({
        storagePath: wp("report.xlsx"),
        displayName: "report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:40:00.000Z",
        authorLabel: "model",
        documentVersionNumber: 3,
        semanticSummaryHint: "Competitor pricing workbook."
      })
    ]);

    assert.ok(section);
    assert.match(
      section ?? "",
      new RegExp(
        `report\\.xlsx \\| path=${wp("report.xlsx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| .*v3`
      )
    );
  });

  test("shows exact path when displayName is not the workspace path", () => {
    const section = buildSection([
      workingFile({
        storagePath: wp("report (1).docx"),
        displayName: "report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:45:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Uploaded source document with a collision-suffixed path."
      })
    ]);

    assert.ok(section);
    assert.match(
      section ?? "",
      new RegExp(
        `\\| report\\.docx \\| path=${wp("report (1).docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`
      )
    );
    assert.match(section ?? "", /Do not reconstruct a path from displayName\/filename/);
    assert.doesNotMatch(section ?? "", /path=.*report\.docx \|/);
  });

  test("keeps current source anchor visible when older files exceed the cap", () => {
    const extraFiles = Array.from({ length: 20 }, (_, index) =>
      workingFile({
        storagePath: wp(`extra-${String(index + 1)}.png`),
        displayName: `extra-${String(index + 1)}.png`,
        mimeType: "image/png",
        aliases: [`image #${String(index + 1)}`, `file #${String(index + 1 + 2)}`],
        createdAt: `2026-05-${String(25 - Math.floor(index / 2)).padStart(2, "0")}T${String(
          23 - (index % 2)
        ).padStart(2, "0")}:00:00.000Z`,
        authorLabel: "model",
        sourceToolCode: "image_edit",
        semanticSummaryHint: `Extra image ${String(index + 1)}.`
      })
    );
    const section = buildSection([
      workingFile({
        storagePath: wp("proposal.docx"),
        displayName: "proposal.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:40:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Current source document for the new PDF."
      }),
      ...extraFiles,
      workingFile({
        storagePath: wp("proposal.pdf"),
        displayName: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        aliases: ["file #2"],
        createdAt: "2026-04-01T10:00:00.000Z",
        authorLabel: "model",
        sourceToolCode: "document",
        semanticSummaryHint: "Latest delivered PDF result."
      })
    ]);

    assert.ok(section);
    const historyLines = (section ?? "").split("\n").filter((line) => line.startsWith("- 2026-"));
    assert.equal(historyLines.length, 10);
    assert.match(
      section ?? "",
      new RegExp(
        `proposal\\.docx \\| path=${wp("proposal.docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| .*current source`
      )
    );
    assert.doesNotMatch(section ?? "", /last delivered result/);
    assert.doesNotMatch(section ?? "", /DOC_CURRENT_SOURCE/);
    assert.doesNotMatch(section ?? "", /LAST_DELIVERED_FILE =/);
  });

  test("always shows microdescriptions when present and keeps recovery instructions", () => {
    const section = buildSection([
      workingFile({
        storagePath: wp("final-client-brief.docx"),
        displayName: "final-client-brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 512,
        aliases: ["file #1"],
        createdAt: "2026-05-26T14:50:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Current source document for the new branded PDF."
      })
    ]);

    assert.ok(section);
    assert.match(
      section ?? "",
      new RegExp(
        `\\| final-client-brief\\.docx \\| path=${wp("final-client-brief.docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| .*current source \\| Current source document for the new branded PDF\\.`
      )
    );
    assert.match(
      section ?? "",
      /Recover a forgotten path with `files\.list`, then `files\.search`/i
    );
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
      `Here you go.\n\nAssistant sent an attachment: document "plan.md", storagePath: "${wp("plan.md")}".`
    );

    assert.equal(merged.trimEnd(), "Here you go.");
    assert.doesNotMatch(merged, /Assistant sent an attachment|fileRef/i);
  });

  test("renders cwd when the session has no working files yet", () => {
    const section = buildSection([], { currentSessionRoot: TEST_SESSION_ROOT });

    assert.ok(section);
    assert.equal(
      section,
      [
        "## Working Files",
        `cwd: ${TEST_SESSION_ROOT}/`,
        "Shell/exec already run in this directory — omit `shell.cwd` / `exec.cwd` and do not `cd` here again; use relative paths or the exact file `path` values below.",
        "",
        "Recover a forgotten path with `files.list`, then `files.search` for natural-language lookup, then `files.read` / `files.preview`. If the user refers to a file not listed here, do not assume it is unavailable until you try those tools.",
        "Do not send files or claim delivery/preparation unless the user explicitly asks and the current turn returns the matching tool result."
      ].join("\n")
    );
  });

  test("returns null when there are no files and no session root", () => {
    const section = buildSection([], { currentSessionRoot: null });
    assert.equal(section, null);
  });

  test("adding a newer file does not renumber existing sticky labels", () => {
    const originalSection = buildSection([
      workingFile({
        storagePath: wp("older.png"),
        displayName: "older.png",
        mimeType: "image/png",
        aliases: ["image #1", "file #1"],
        createdAt: "2026-05-20T10:00:00.000Z",
        authorLabel: "model",
        sourceToolCode: "image_edit",
        semanticSummaryHint: "Older image."
      }),
      workingFile({
        storagePath: wp("brief.docx"),
        displayName: "brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        aliases: ["file #2"],
        createdAt: "2026-05-21T10:00:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Older document."
      })
    ]);
    const expandedSection = buildSection([
      workingFile({
        storagePath: wp("older.png"),
        displayName: "older.png",
        mimeType: "image/png",
        aliases: ["image #1", "file #1"],
        createdAt: "2026-05-20T10:00:00.000Z",
        authorLabel: "model",
        sourceToolCode: "image_edit",
        semanticSummaryHint: "Older image."
      }),
      workingFile({
        storagePath: wp("brief.docx"),
        displayName: "brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        aliases: ["file #2"],
        createdAt: "2026-05-21T10:00:00.000Z",
        authorLabel: "user",
        semanticSummaryHint: "Older document."
      }),
      workingFile({
        storagePath: wp("newer.png"),
        displayName: "newer.png",
        mimeType: "image/png",
        aliases: ["image #2", "file #3"],
        createdAt: "2026-05-22T10:00:00.000Z",
        authorLabel: "model",
        sourceToolCode: "image_edit",
        semanticSummaryHint: "Newer image."
      })
    ]);

    assert.match(
      originalSection ?? "",
      new RegExp(
        `\\| image #1 \\(file #1\\) \\| older\\.png \\| path=${wp("older.png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`
      )
    );
    assert.match(
      originalSection ?? "",
      new RegExp(
        `\\| file #2 \\| brief\\.docx \\| path=${wp("brief.docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`
      )
    );
    assert.match(
      expandedSection ?? "",
      new RegExp(
        `\\| image #1 \\(file #1\\) \\| older\\.png \\| path=${wp("older.png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`
      )
    );
    assert.match(
      expandedSection ?? "",
      new RegExp(
        `\\| file #2 \\| brief\\.docx \\| path=${wp("brief.docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`
      )
    );
    assert.match(
      expandedSection ?? "",
      new RegExp(
        `\\| image #2 \\(file #3\\) \\| newer\\.png \\| path=${wp("newer.png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`
      )
    );
  });
});
