# ADR-129: Agentic document workspace — extraction, render, inspect, and versioning

## Status

Implemented locally through Wave 6; final deploy/live validation pending.

## Date

2026-06-29

## Founder directive

The current `document` tool is too opaque for production-quality large documents. It hides the useful work inside an async worker: the chat model calls `document`, the backend asks another model to write HTML or Python, the sandbox runs it, and a file may be delivered without the main model being able to inspect and fix the result.

For PROD quality, document work must become a visible workspace workflow:

```text
extract sources -> create/edit workspace source files -> render -> inspect -> fix -> inspect -> files.attach
```

No legacy compatibility tail, no hidden "best effort" document generation for XLSX/DOCX, no TODO scaffolding, no parallel file identity, no PDFMonkey vocabulary. There are no paying users yet, so this program should cut cleanly instead of preserving unshipped behavior.

## Orchestration model

This ADR is intended for orchestrated execution.

- The parent agent is the orchestrator: owns the ADR, dispatches implementation waves, reviews diffs, verifies invariants, reconciles docs, and closes the program.
- Implementation subagents should be GPT-5.4 unless the orchestrator explicitly documents a reason to use a different available model.
- Subagents write code in bounded waves. The orchestrator audits every wave before the next wave starts.
- The orchestrator must not hide blockers, weaken tests, or accept "works for simple cases" as closure.
- Every wave ends with focused tests plus the AGENTS verification gate where applicable.

## Current code truth

Active file/workspace truth after ADR-126/127/128:

- file identity is `(workspaceId, path)`;
- model-visible paths are flat `/workspace/...`;
- `workspace_file_metadata` is the authoritative index;
- GCS stores canonical bytes at `fs/workspaces/<workspaceId>/workspace/<rel>`;
- pod FS is a cache/workspace execution surface;
- final file delivery is structural and should go through `files.attach`.

Active document truth:

- `document` model-facing tool accepts descriptor modes including `create_pdf_document`, `create_presentation`, `revise_document`, `export_or_redeliver`, and `create_data_document`.
- `create_pdf_document` and PDF revisions use the sandbox provider and render PDF from generated/persisted HTML via `render_html_to_pdf`.
- `create_data_document` uses an opaque async worker path: a worker model writes a Python program, sandbox runs `execute_document_code`, and the produced `xlsx`/`docx`/data-PDF is validated mostly by container/file magic plus limited checks.
- source extraction exists, but it is hidden inside API-side `DocumentExtractionService` / `DocumentSourceAttachmentExtractionService` and returns transient payloads to the worker instead of visible `/workspace` sidecars.
- `AssistantDocumentVersion` already has useful fields for PDF source truth (`renderedHtml`, `structureJson`, `styleProfileJson`), but the source is hidden in DB rather than first-class workspace files.
- document delivery metadata still has residual type drift: some delivery payload parsing only preserves older descriptor modes and `pdf|pptx` output formats even though `create_data_document` and `xlsx|docx` exist elsewhere.

## Problem

### P1 — Opaque generation blocks quality loops

The main model cannot:

- open the generated XLSX/DOCX/PDF;
- inspect sheets, formulas, paragraphs, tables, page counts, or extracted text;
- detect semantic failures in a valid container;
- revise the source and rerender;
- attach only after the result is checked.

The current repair loop only handles Python execution failure. A valid-but-wrong document can still be delivered.

### P2 — Extraction is not a visible workspace primitive

Existing local and provider extraction is useful, but it is hidden inside document/knowledge flows. The model cannot ask for "extract this PDF into sidecar files, then let me grep/read pages".

### P3 — PDF source truth is split

PDF source should be HTML/CSS/assets/project files that can be edited in the sandbox, rendered, inspected, and versioned. Persisting HTML in DB is useful as an archive, but it should not be the only editable source.

### P4 — XLSX/DOCX are native editable files

XLSX and DOCX should be opened and modified in the sandbox with `openpyxl`/`python-docx` and inspected after changes. Treating them as hidden document jobs prevents the model from doing the natural Claude Code-style loop.

### P5 — Tool descriptions still teach the old mental model

The model-facing contract still frames `document` as an async generator. That is the wrong primary behavior for high-quality documents.

## Decision

Redesign `document` into a workspace-visible document workflow layer. Keep `files`, `shell`, `grep`, and `glob` as the execution primitives. Keep `files.attach` as the only final delivery path.

### D1 — `document.extract`

Add a model-facing action:

```ts
document({
  action: "extract",
  path: "/workspace/source.pdf",
  mode?: "auto" | "text" | "ocr" | "layout",
  outputDir?: "/workspace/source.extract"
})
```

It uses existing extraction capabilities; it does not invent a new OCR stack.

Inputs:

- any path under `/workspace/...`;
- supported sources: text, PDF, DOCX, XLSX/CSV, images/scanned PDFs where OCR applies.

Execution:

- API/control plane reads canonical bytes by `(workspaceId, path)`;
- local parsers run first where appropriate (`pdf-parse`, `mammoth`, text decode, media preprocessor);
- remote OCR/parsing uses existing `DocumentExtractionService` policy and credentials (`Mistral OCR`, `LlamaParse`) when policy/escalation requires it;
- sandbox-native inspectors may be used for XLSX/DOCX/PDF summaries where libraries are already available.

Outputs are workspace files, not prompt blobs:

```text
/workspace/source.extract/manifest.json
/workspace/source.extract/extracted.md
/workspace/source.extract/pages/page-001.txt
/workspace/source.extract/pages/page-001.ocr.txt
/workspace/source.extract/sheets/Sheet1.csv
```

The tool result returns only a compact manifest: output paths, page/sheet counts, quality, warnings, and suggested next reads.

### D2 — Workspace document projects

Generated or revised documents should live in explicit project folders when the task is non-trivial:

PDF:

```text
/workspace/report/
  source.md
  report.html
  style.css
  assets/
  build.py
  report.pdf
  inspect.json
  manifest.json
```

XLSX/DOCX:

```text
/workspace/finmodel/
  inputs/
  build.py
  inspect.py
  output.xlsx
  inspect.json
  manifest.json
```

The model may create these with `files.write` and `shell`, or with a small `document.init` helper if the implementation keeps that helper. The source files must be visible and editable in `/workspace`.

### D3 — `document.render`

Add a model-facing action for deterministic render from visible workspace sources:

```ts
document({
  action: "render",
  projectPath: "/workspace/report",
  outputPath: "/workspace/report/report.pdf",
  format: "pdf" | "xlsx" | "docx"
});
```

PDF render:

- input is visible HTML/CSS/assets;
- render happens in sandbox using the existing PDF render stack;
- output is written to `/workspace/...` and mirrored to GCS/manifest.

XLSX/DOCX render:

- input is visible Python/source files;
- model or helper runs the project build script in sandbox;
- output is written to `/workspace/...` and mirrored to GCS/manifest.

No hidden worker model should generate XLSX/DOCX behind the main model's back.

### D4 — `document.inspect`

Add a model-facing action:

```ts
document({
  action: "inspect",
  path: "/workspace/report/report.pdf",
  depth?: "quick" | "standard" | "deep"
})
```

Inspection writes an `inspect.json` sidecar and returns a compact summary.

PDF checks:

- file opens and has non-trivial size;
- page count;
- extracted text length;
- empty/near-empty pages;
- obvious truncation/short-body signals;
- optional per-page text sidecars for large PDFs.

XLSX checks:

- workbook opens;
- sheet names;
- dimensions;
- formula count;
- sample rows;
- blank-sheet detection;
- basic type/format sanity.

DOCX checks:

- document opens;
- paragraphs/headings/table count;
- empty-section detection;
- sample headings/paragraphs;
- basic image/table references where available.

Inspection must be semantic enough to catch valid-but-bad outputs, not only file magic.

### D5 — Versioning becomes source snapshot + output + inspection

`AssistantDocumentVersion` should represent a real workspace version:

```text
docId
versionNumber
workspaceProjectPath
sourceManifest
outputPath
inspectionSummary
parentVersionId
```

Implementation may keep DB copies of HTML/structure for PDF archive and recovery, but the editable source of truth is the workspace project snapshot.

For PDF, source snapshot includes HTML/CSS/assets/build metadata.

For XLSX/DOCX, source snapshot includes generator/edit scripts, input references, output path, and inspection summary. Native file edits are allowed; the version records what changed and what was delivered.

### D6 — `revise_document` becomes workspace revision, not hidden regeneration

Revise flow:

1. resolve existing `docId` or `/workspace/...` document path;
2. materialize or locate the prior workspace project/source snapshot;
3. model edits visible source files or native document using sandbox tools;
4. render/save;
5. inspect;
6. register new version;
7. `files.attach` final output.

For XLSX/DOCX, revision should use native libraries (`openpyxl`, `python-docx`) and inspection, not a hidden `create_data_document` rerun.

### D7 — Retire opaque `create_data_document`

The current hidden worker path for XLSX/DOCX must be removed or reduced to a migration-only implementation detail during the cutover wave, then deleted before closure.

After closure:

- model-facing `document` no longer teaches `create_data_document` as a black-box generator;
- no normal path asks a hidden worker model to create and deliver an Office file without the main model inspection loop;
- generated XLSX/DOCX files are produced through visible workspace source/build/inspect flow.

### D8 — Final delivery stays `files.attach`

`document` should not introduce a second delivery mechanism. It may record version metadata, but final user-visible file delivery is:

```ts
files({ action: "attach", path: "/workspace/report/report.pdf" });
```

The attachment metadata may include `documentLink` after `document.register_version`, but delivery is still path-based.

### D9 — Prompt/tool instruction ownership

Update tool documents and prompt surfaces under ADR-117 rules:

- selection guide: when to use `document.extract`, `document.render`, `document.inspect`, `files`, `shell`;
- descriptor: exact actions and params;
- no provider-conditioning prose in model-facing text;
- no PDFMonkey/provider wording for sandbox-generated files;
- no stale `fileRef`, `/shared`, `input/outbound`, or hidden async wording.

## Non-goals

- Reopening ADR-123 sandbox isolation/network decisions.
- Reintroducing PDFMonkey.
- Reintroducing `AssistantFile`/`fileRef`.
- Adding a second file registry.
- Preserving opaque `create_data_document` as a compatibility mode after closure.
- Folding Gamma presentation redesign into this program unless needed to keep contracts compiling. Presentation PPTX follow-up may remain a narrow existing lane.

## Work plan

### Wave 0 — Inventory and contract freeze

Subagent: GPT-5.4.

Deliverable: `docs/ADR/129-document-tool-inventory.md`.

Scope:

- enumerate every current `document` tool path in API/runtime/sandbox/web/tests;
- enumerate extraction call sites and provider credential ownership;
- enumerate model-facing tool docs and prompt text;
- classify each site: keep, replace, delete, or move;
- list exact tests that must be rewritten.

Acceptance:

- no implementation changes;
- inventory covers `document`, `files.attach`, extraction, delivery metadata, versioning, and sandbox tool codes.

### Wave 1 — `document.extract`

Subagent: GPT-5.4.

Implement the explicit extraction action using existing `DocumentExtractionService` and local/sandbox inspectors. Extracted output must be persisted as workspace sidecar files and manifest rows.

Acceptance:

- PDF text-layer extraction writes sidecars;
- scanned/poor PDF can route through existing OCR policy;
- DOCX extraction writes markdown/text sidecar;
- XLSX extraction writes workbook manifest and optional per-sheet CSV/summary;
- tool result is compact and never inlines large extracted content.

### Wave 2 — Render and inspect primitives

Subagent: GPT-5.4.

Implement `document.render` and `document.inspect` for PDF/XLSX/DOCX over visible `/workspace` files.

Acceptance:

- PDF render from visible HTML/CSS project;
- XLSX/DOCX render through visible Python/build script path;
- inspect sidecars are written for all three formats;
- valid-but-empty/obviously truncated outputs are caught.

### Wave 3 — Version registration

Subagent: GPT-5.4.

Refactor document versioning so `AssistantDocumentVersion` records workspace source snapshots, output path, and inspection summary. Keep only useful DB archive fields.

Acceptance:

- version creation records source manifest and output path;
- attachment `documentLink` metadata includes correct descriptor/output facts for PDF/XLSX/DOCX;
- current known data-document metadata drift is fixed;
- version read paths survive refresh/replay.

### Wave 4 — Replace opaque data-document path

Subagent: GPT-5.4.

Remove the black-box `create_data_document` path from the normal model-facing flow. Replace guidance and runtime behavior with explicit extract/render/inspect/version workflow.

Acceptance:

- no normal model-facing path tells the model to call hidden `create_data_document`;
- no backend worker asks a separate model to create XLSX/DOCX and deliver without main-model inspection;
- tests prove the main workflow writes, renders, inspects, revises, then attaches.

### Wave 5 — PDF revise from workspace source

Subagent: GPT-5.4.

Move PDF revision to visible workspace source files: materialize prior HTML/CSS/project source, edit in sandbox, render, inspect, register version, attach.

Acceptance:

- PDF revision does not require hidden DB-only source as the sole editable form;
- DB archived HTML/structure remains optional recovery/archive truth;
- source files are visible in `/workspace`;
- inspection gates delivery.

### Wave 6 — Tool docs, web surfaces, and cleanup

Subagent: GPT-5.4.

Update all model-facing and UI/admin wording. Delete obsolete code, tests, and docs references.

Acceptance:

- no PDFMonkey wording in active code/docs except closed ADR history;
- no `fileRef`/`AssistantFile` active-path wording;
- no `/shared`, `/workspace/input`, `/workspace/outbound` active-path wording;
- no stale "document provider" wording for sandbox-generated PDF/XLSX/DOCX;
- ADR-117 ownership rules hold.

### Wave 7 — Closure and live validation

Orchestrator-owned.

Run full gate, deploy, and live validate:

1. upload a large PDF, extract to sidecars, build a PDF report, inspect, revise source, inspect again, attach;
2. upload a complex XLSX, extract workbook summary, create a new XLSX, inspect sheets/formulas/sample rows, revise, attach;
3. create a DOCX, inspect headings/tables, revise with `python-docx`, attach;
4. refresh chat and verify document metadata survives.

## Verification gate

Every implementation wave must run focused tests for touched paths and then:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/sandbox run typecheck
```

If Prisma or contracts change:

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
```

## Closure invariants

At closure:

1. Large document work is inspectable and repairable before delivery.
2. Extraction results are visible workspace sidecars, not hidden prompt payloads.
3. PDF source is editable workspace HTML/CSS/project state.
4. XLSX/DOCX are native editable sandbox files with inspectors.
5. Versions record source snapshot, output path, and inspection summary.
6. Final delivery is path-based `files.attach`.
7. No opaque XLSX/DOCX black-box worker remains in the normal path.
8. No legacy file identity, provider wording, or TODO scaffolding remains.

## Anti-compromise red flags

- Keeping `create_data_document` as an opaque normal path after closure.
- Saying "validated" when only file magic was checked.
- Inlining large OCR/extracted text into model prompt instead of sidecar files.
- Adding a second delivery path instead of `files.attach`.
- Reintroducing `fileRef`, `AssistantFile`, `/shared`, or role subdirectories.
- Leaving PDFMonkey wording in active surfaces.
- Weakening tests because the refactor is wide.
- Dispatching subagents without a closed file/scope brief.
- Closing the ADR without live validation on real large PDF/XLSX/DOCX examples.
