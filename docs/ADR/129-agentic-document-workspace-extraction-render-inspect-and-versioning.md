# ADR-129: Agentic document workspace — extraction, render, inspect, and versioning

## Status

Implemented locally through Wave 6, hard-cutover cleanup, and deep cleanup (deferred document pipeline narrowed to presentation-only end-to-end, including Prisma enum shrink for render-job tables); final deploy/live validation pending.

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

Active document truth after local implementation:

- PDF/DOCX/XLSX document work is action-based and visible: `document.extract`, `document.render`, `document.inspect`, optional `document.register_version`, then `files.attach`.
- The model-facing `document` descriptor no longer advertises PDF/DOCX/XLSX descriptor generation. Stray `create_pdf_document` and `create_data_document` enqueue attempts are rejected with visible-workflow guidance.
- `document.extract` writes sidecars only into a clean output directory; it rejects an existing file path or non-empty sidecar directory instead of deleting/replacing prior work.
- Presentation generation is intentionally unchanged by this ADR hard cleanup: `create_presentation` and presentation export/revise delivery remain on the existing presentation worker path.
- Historical `AssistantDocumentVersion` / `documentLink` metadata remains readable for already persisted rows.

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

### Deep cleanup follow-up (2026-06-29)

After the hard cutover the founder flagged that the cleanup had not gone far enough ("ЧИСТО"). The orchestrator then carried the cleanup further on top of the hard cutover, treating the deferred `document` job pipeline as presentation-only end-to-end. The scope of this follow-up was:

- runtime `document` tool parser collapses to a single `presentation_enqueue` shape with `descriptorMode ∈ {create_presentation, revise_document, export_or_redeliver}` and `outputFormat ∈ {pdf, pptx}`. Retired descriptor modes (`create_pdf_document`, `create_data_document`) now fail at parse with `invalid_arguments` and a guidance that points at the visible workspace actions. `buildRetiredDescriptorModeResult`, `resolvePresentationDescriptorMode`, and the runtime-side dispatch through them were removed.
- `RuntimeDeferredDocumentJobSummary`, `AssistantWebChatActiveDocumentJobState`, the deferred-document acknowledgement copy, `extractDeferredDocumentJob`, the runtime jobs controller, the web active-document-job chip, and the API enqueue/job/scheduler/delivery/read/completion/failure surfaces were narrowed to `documentType = "presentation"`. The dead `create_pdf_document` default branches in the acknowledgement copy and web chip were removed.
- the runtime worker (`runtime-document-provider-adapter.service.ts`) was already Gamma-only after the hard cutover; this follow-up made the rest of the deferred pipeline match.
- the Prisma `AssistantDocumentRenderProvider` enum was shrunk to `gamma` and `AssistantDocumentOutputFormat` to `pdf | pptx` via the `20260629200000_adr129_presentation_only_document_enums` migration, which also purges historical non-presentation render-job rows and drops the dead PDF-structure columns (`rendered_html`, `structure_json`, `style_profile_json`, `edit_strategy`, `structure_version`) from `assistant_document_versions`.
- the obsolete worker-path runtime tests (`PDF revise`, `create_pdf_document`, `storagePath-based PDF`, `create_data_document`, `legacy xlsx outputFormat`) were collapsed into a single compact parse-rejection test that exercises the new error message.

Out of scope (explicit founder directive "не зацеп презентации" + `document.register_version` reality):

- visible-workspace document registration still writes PDF/XLSX/DOCX rows into `AssistantDocument`, so the broader Prisma enums (`AssistantDocumentType`, `AssistantDocumentDescriptorMode`) and the chat-attachment `documentLink` metadata stay wide. They are not legacy in the new architecture.
- presentation generation, delivery, and the `gamma` worker remain operational on the existing presentation worker path.

### Wave 8 — Split model-facing `document` and `presentation` tools (2026-06-30)

Problem: a single `document` tool still exposed both visible workspace PDF/DOCX/XLSX actions and deferred Gamma presentation modes. Models kept choosing `create_presentation` for ordinary PDF document requests because one-call presentation delivery also returns PDF.

Decision:

- `document` tool surface: only `extract`, `inspect`, `render`, `register_version`.
- `presentation` tool surface: only `create_presentation`, `revise_document`, `export_or_redeliver`.
- Billing/quota/plan enablement stay on `document`; `presentation` mirrors `document` activation and reuses the same Gamma enqueue path internally.

Acceptance:

- ordinary PDF/manual/report requests route through `document` visible workflow guidance;
- slide-deck requests route through `presentation`;
- catalog/presets expose separate descriptors for both tools;
- no second plan quota knob or admin billing surface.

### Wave 9 — Delivery truth, session-scoped file visibility, and media-claim guards (opened 2026-06-30)

Problem (live-validated on PDF-instruction turn `e6fb2fa3`, chat `web-1782814156432`):

1. **False delivery claims.** `document.render` succeeded in sandbox but `files.attach` never ran. `applyFinalDeliveryHonestyCorrection` only fires when `attemptedArtifactCount > 0` (stream `RuntimeOutputArtifact`s). Render produces `artifacts: []`, so the model's "готово / пришлю" prose is never corrected — same blind spot for any workspace-only produce path.
2. **No session-scoped file truth for the model.** `RuntimeFileHandle` has no `chatId` / session tier. `## Working Files` mixes current chat, other chats, and orphan manifest paths with no ordering contract. Models stat wrong files (e.g. old Gamma PDFs) after a new render.
3. **Settings → Files gallery defaults to workspace-wide truth.** `listChatWorkspaceFiles` merges the full workspace manifest; the UI type pill `all` is the default. Users and operators expect **this chat/session first**.
4. **False media-start claims (~50%).** Model prose says image generation started without a same-turn structural `image_generate` / `image_edit` / `pending_delivery` result. `## Open Media Jobs` blocks stale jobs but does not guard new-turn false starts.

Prod decisions (no second delivery path; keep `files.attach` as sole chat delivery):

#### D9 — Structural turn delivery facts (API-owned honesty)

Runtime turn completion MUST emit structural delivery facts independent of model prose:

```ts
turnDeliveryFacts: {
  producedPaths: string[];      // document.render outputPath, files.write binary paths, etc.
  attachedPaths: string[];      // successful files.attach paths this turn
  pendingMediaJobIds: string[]; // same-turn pending_delivery media jobs
  pendingDocumentJobIds: string[];
  mediaToolCalls: Array<"image_generate" | "image_edit" | "video_generate">; // successful or pending this turn
}
```

API post-runtime (`complete-web-post-runtime-turn`, telegram adapter, async job completion) applies honesty from **facts**, not artifact count alone:

| Condition | System action |
| --- | --- |
| `producedPaths.length > 0 && attachedPaths.length === 0 && pending* empty` | Append structural correction: file exists in workspace but was **not** delivered to this message; strip delivery-claiming prose. |
| User asked for artifact && `mediaToolCalls.length === 0 && pendingMedia empty` | Append correction: no media job was actually started this turn. |
| `attachedPaths.length > 0` | Keep current delivered-filename link stripping only. |

Optional product mode (founder toggle, default **off** for Wave 9): `autoAttachAfterDocumentRender` — when `document.render` returns `action: "rendered"`, runtime enqueues a batched `files.attach` on the same output path before turn end. **Default remains manual attach** to preserve inspect gate; auto-attach is an explicit escape hatch, not the primary path.

#### D10 — Three-tier file visibility for the model

Working Files and `files.list` default scope for chat turns:

1. **Current chat/session** — attachments with `chatId`, paths under `/workspace/chats/<chatId>/`, files produced this turn (`producedPaths`).
2. **This assistant** — same `assistantId`, other chats, outbound artefacts.
3. **Workspace / siblings** — orphan manifest rows, `/shared/` (read-only enumeration per ADR-126).

Implementation:

- Add optional `originChatId` + `originAssistantId` on `workspace_file_metadata` (migration); set on `files.write`, render persist, and `files.attach`.
- Extend `RuntimeFileHandle` with `scopeTier: "chat" | "assistant" | "workspace"`.
- `buildWorkingFilesDeveloperSection` emits three subsections in that order; cap each tier separately so session files are never pushed out by history noise.
- `document.render` MUST register output in `producedPaths` and merge into turn `fileHandles` even when `artifacts: []`.

#### D11 — Settings Files UI: session-first scope

- API: `GET .../workspace-files?scope=chat|workspace` — default **`chat`**.
  - `chat`: tiles where `attachment.chatId === chatId` OR path prefix `/workspace/chats/<chatId>/`.
  - `workspace`: current ADR-127 manifest join (all assistant workspace files).
- Web `WorkspaceFilesGallery`: default scope = chat; add pill/toggle **«Все файлы»** (maps to `scope=workspace`). Type filters (`image` / `video` / `document`) apply **within** the active scope.

#### D12 — Media-start structural guard

- Runtime: if the user turn requests image/video creation (lightweight classifier on user message **or** scenario seed), set `turnDeliveryFacts.expectsMediaArtifact = true`.
- Post-runtime: when `expectsMediaArtifact && mediaToolCalls.length === 0 && pendingMedia empty`, append honest notice (RU/EN) — same machinery as D9, no prose regex.
- Strengthen `## Open Media Jobs` copy: *"Absence of a new pending_delivery result this turn means you have NOT started a new image/video job yet."*

Wave 9 slices (implementation order):

1. **Slice 1 — D9 delivery facts + honesty extension** (runtime emit + API correct; closes PDF false-delivery).
2. **Slice 2 — D10 Working Files tiers + render → fileHandles** (model stops grabbing old Gamma paths).
3. **Slice 3 — D11 session-first gallery API + UI** (settings files default).
4. **Slice 4 — D12 media-start guard** (50% false image claims).
5. **Slice 5 — optional `originChatId` manifest migration** (persistent scope across pod restarts).

Acceptance:

- PDF-instruction live turn: either `files.attach` chip appears OR assistant text honestly says file is in workspace but not attached — never silent "готово".
- Working Files lists current-chat outputs above `2026-06-30T07:43:26Z-pdf-pdf.pdf`.
- Settings → Files opens on session files; «Все файлы» reveals workspace-wide manifest.
- Image request with no tool call gets structural correction, not "генерация запущена".

### Wave 10 — Document project binding (opened 2026-06-30)

Problem (live-validated on DOCX→premium PDF turn, chat `e39204e9`):

1. **Extract and render were disconnected.** `document.extract` wrote sidecars, but `document.render` accepted any `projectPath` the model guessed — including unrelated projects such as `test_pdf_project`.
2. **No bounded project object.** Workspace stayed a flat file pile; the model manually bridged `*.extract/extracted.md` → HTML → PDF and often truncated or picked the wrong HTML.
3. **Symptom-only guards were insufficient.** PDF magic / page-count checks catch bad output after the fact; the cause is missing project ownership at extract time.

Decisions:

1. Default `document.extract` (when `outputDir` is omitted) creates a **document project** under `/workspace/projects/<slug>/`:
   - `project.json`
   - `extract/` sidecars
   - `render/report.html` scaffold seeded from full extracted text (PDF/DOCX/text sources)
   - `output/` reserved for render products
2. Runtime tracks **`activeDocumentProjectPath`** for the turn after a successful extract.
3. **`document.render` is bound** to the active project: `projectPath`, render entrypoint, and `outputPath` must stay inside that project tree.
4. Working Files adds a short **Active document project** note (not a full Working Files refactor).

Wave 10b supersedes the Wave 10 legacy `outputDir` escape hatch — see below.

### Wave 10b — Kill legacy extract from model path + full-text PDF render (opened 2026-06-30)

Problem (live-validated after Wave 10 deploy `9d86953f`, chat `39b57bc2`):

1. **Model-facing prompt still taught `*.extract`.** The model passed explicit `outputDir`, bypassing project layout; `activeDocumentProjectPath` never engaged.
2. **Truncated HTML.** Model read `extracted.md` via `files.read` (50 KB cap), hand-built HTML, then `document.render` used that partial HTML — ~78 pages of content with awful formatting after 37 tool steps.
3. **Legacy path in prod is useless.** Flat `*.extract` sidecars without project binding recreate the pre-Wave-10 failure mode.

Decisions:

1. **Remove `outputDir` from model-facing `document.extract`.** Tool schema and runtime reject legacy `outputDir`; API returns `legacy_output_dir_rejected` if supplied.
2. **Always project layout on extract.** Every `document.extract` creates `/workspace/projects/<slug>/` with extract sidecars, scaffold HTML, and output dir.
3. **Full-text PDF render embed.** `document.render(format=pdf)` on a document project rebuilds HTML from full `extract/extracted.md` server-side before WeasyPrint — no dependence on model-assembled HTML or partial `files.read` chunks.
4. **Prompt alignment.** Native tool description and Working Files active-project note steer extract → render on default project paths; no `.extract` guidance.

Out of scope this wave: inspect gate on page count, blocking ad-hoc `build.py` marathons (optional follow-up).

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
