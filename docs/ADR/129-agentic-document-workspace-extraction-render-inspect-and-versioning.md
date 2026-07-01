# ADR-129: Production document workspace for PDF, DOCX, and XLSX

## Status

Open. The repo contains a partial local implementation of the new document system, but the production closure is not complete yet.

## Date

2026-06-29

## Addendum — 2026-07-01: auto-register on render + extract nextAction hint

The originally documented flow required the model to explicitly call `document.register_version` after each successful `document.render` in order to produce a `v1` badge. In PROD this produced two observed failure modes:

1. **PDF vs Office asymmetry.** In neutral repro on a clean workspace the model correctly called `register_version` after `document.render(format=xlsx)` and `document.render(format=docx)`, but skipped it after `document.render(format=pdf)`. Deliverable PDFs shipped without a `v1` badge and without stored document/version metadata.
2. **Explicit `register_version` was noise on the happy path.** The advanced parameters (`descriptorMode="revise_document"`, non-default `sourceManifestPath` / `inspectionPath`) are only meaningful when revising an existing document by `docId`. Requiring the model to call the action for every fresh render was extra opportunity for it to skip or mis-fill it.

Both are now addressed server-side. This does not change ADR-129's DoD; it changes how the DoD is satisfied.

- `RuntimeDocumentToolService.executeRenderToolCall` now chains into `PersaiInternalApiClientService.registerDocumentVersion` on successful `persistRenderedWorkspaceFile`. The render payload carries `versionId`, `docId`, `descriptorMode`, and a `registration` summary uniformly for PDF/DOCX/XLSX.
- Auto-register is best-effort. On failure the render itself is still valid and `attach` still works; a `warning` starting with `auto_register_skipped:<code>` is surfaced so the model can decide to retry or degrade explicitly. When no chat conversation can be resolved for the render, the warning is `auto_register_skipped:no_conversation_context: …` and no API call is made.
- `document.register_version` stays in the tool surface as an explicit advanced action for revising an existing `docId` (`descriptorMode="revise_document"`), for attaching non-default `sourceManifestPath` / `inspectionPath`, or for the model to explicitly re-register after an `auto_register_skipped` warning. The standard render → attach flow does not need it.

The addendum also adds an explicit `suggestedNextActions` hint to `document.extract` for imported DOCX and XLSX sources, so the model calls the seeded LibreOffice `export_pdf.py` path verbatim instead of hand-assembling HTML from partial `files.read` chunks. Imported PDF returns `null` (no obvious conversion). The runtime plumbs this through `RuntimeDocumentExtractionSummary.suggestedNextActions` (contract-level `RuntimeDocumentSuggestedNextAction`) and both the native tool projection and the documents-category selector guidance now instruct the model to follow the suggestion when present.

Cross-turn workspace pollution and wrong-file attachment (files from previous turns delivered as if freshly rendered) were also observed on this same live-validation, but that class of problems needs deeper design work than a simple server-side chain. It is captured as a separate program in ADR-131 and is intentionally not resolved in this addendum.

## Addendum II — 2026-07-01: intent-level document tool, deterministic runtime pipeline, and full polishing plan

This addendum is the **authoritative plan of record** for closing the document block to PROD. Later implementation must not deviate from it without a new founder-approved amendment. It is grounded in a six-scenario live-test matrix run on `persai.dev` with per-turn sandbox/DB logs.

### Live-test evidence (2026-07-01, workspace `24926096-953e-49b9-af56-f3551ce6f602`)

| # | Scenario | Result | Sandbox jobs | Failure mode |
|---|----------|--------|-------------:|--------------|
| S1 | Imported DOCX -> PDF (`Карнаух`) | FAIL — runaway loop, stopped manually | 33+ | ignored seeded `export_pdf.py`; hand-rolled `markdown`+`weasyprint`; picked older `(5).docx` over `(6)` |
| S2 | New PDF from scratch | HEALTHY | 7 | none — `files.write` HTML -> render -> attach; registered `v1` |
| S3 | New DOCX | works, noisy | 16 | `python-docx` not preinstalled (pip round); 3× `build.py` rewrites; delivered generic `output.docx`; no version |
| S4 | New XLSX | works | 12 | `PERSAI_OUTPUT_PATH` wrong on first try; double `files.attach`; no version |
| S5 | Table-heavy -> PDF | works | 11 | wrote `.html` as a file then read it as a directory (mkdir+mv); double attach; no version |
| S6 | Imported PDF -> DOCX | works, manual | 10 | `document.extract` layout mode timed out -> text fallback surfaced as error; `python-docx` pip; delivered via manual `shell build.py`, no `document.render`, no version |

### Confirmed problem set

- **P1 (critical)** — imported source -> convert bypasses `document.render` / seeded `export_pdf.py`; the model hand-rolls a parallel pipeline (S1 catastrophic, S6 manual).
- **P2 (critical)** — no bound on the model's manual tool loop; a turn ran 33+ jobs and had to be stopped by a human.
- **P3** — exec image lacks `python-docx` (S3, S6 both pip-install at runtime).
- **P4** — `PERSAI_OUTPUT_PATH` / project-path confusion recurs (S4 wrong path, S5 `.html`-as-directory).
- **P5** — the same file is attached twice (S2, S4, S5).
- **P6** — generic delivered filename (`output.docx`) instead of a meaningful name (S3).
- **P7** — `document.extract` layout mode times out on large PDF and surfaces as a user-visible error (S6).
- **P8** — naive source selection: first `glob` hit instead of newest version (S1 took `(5)` not `(6)`).
- **P9** — versioning is inconsistent: only S2 registered a version. Two independent causes:
  1. **Bypass** (S3, S6): deliverable built by manual `shell build.py` + `files.attach`; `document.render` never ran, so nothing registers.
  2. **Silent skip** (S4, S5): `document.render` ran, but `outputPath` was at workspace root (not inside the project dir), `registerDocumentVersion` was rejected, and the render still returned success with an unseen `auto_register_skipped:*` warning.
  S2 registered only because it happened to write the output inside the project directory.

### North-star principle (non-negotiable)

> **Content integrity and rendering are deterministic runtime mechanics. Design, authored text, and edits are the model's declarative input. The model has one door for producing a deliverable; there is no hand-assembly of document bytes through `shell`.**

We do not fight symptoms (no "block small PDF", no "forbid weasyprint", no size heuristics). We remove the cause: the model hand-rolls because we ask it to orchestrate low-level assembly. We collapse the surface to one intent-level tool that covers 100% of the cases it currently hand-rolls, so there is no incentive to escape into `shell`.

### Model-facing surface (declarative intent)

The model expresses intent through three declarative inputs, plus an optional `source`:

| Input | Meaning | Owner |
|-------|---------|-------|
| `content` | authored text as markdown/structure | model (creative) |
| `template` | design: theme / CSS / layout / title / running heads | model (creative) |
| `edit` | targeted operations over existing content (`find`/`replace`, section patch) | model (creative) |
| `source` | path to imported `DOCX`/`PDF`/`XLSX` | user/workspace |

The model never writes `build.py`, never chooses the render engine, never sets `PERSAI_OUTPUT_PATH`, never runs `mkdir`/`mv`/`pip` for document work.

### Deterministic runtime pipeline (one transaction)

```text
source? -> extract (full content, never truncated)
        -> apply (model edit-ops, surgical; untouched content passes through byte-for-byte)
        -> render (engine chosen by source type: LibreOffice export_pdf.py for imported Office; HTML/CSS template for authored)
        -> register version
        -> attach
```

The result is exactly one of: a complete, versioned, attached file — or an honest failure. "Success with a truncated file" is impossible by construction, not by a size check.

### Content vs creativity split (how "take text from DOCX, make a beautiful PDF" works)

- **Content completeness = mechanics.** Extraction yields the full text/structure; the model never re-types or reassembles it.
- **Design = creativity, expressed as data.** The model supplies a `template`/`theme` and (if it restructures) `content` as markdown — not a build script. The runtime binds full content into the model's template and renders deterministically.
- **Edits in a big doc = operations, not rewrites.** The model locates the passage (`grep`/targeted read) and emits an `edit` op; the runtime applies it to the full content and re-renders. Pervasive edits (translate/retone all) are runtime-orchestrated section-by-section with guaranteed full coverage — the model never holds the whole document as a blob.

### Implementation slices (authoritative; supersede the older "Remaining implementation slices" list below)

| Slice | Deliverable | Closes | Priority |
|------:|-------------|--------|:--------:|
| P-1 | `document.render` is the single deliverable producer and itself performs `register_version` + `attach` in one operation; runtime normalizes `outputPath` inside the project and derives a meaningful filename | P1, P4, P5, P6, P9 | critical |
| P-2 | Render engine chosen automatically by source type; imported `DOCX`/`XLSX` -> PDF always uses the seeded LibreOffice `export_pdf.py`; the model cannot pick the engine | P1 (S1/S6) | critical |
| P-3 | `document.edit` — declarative targeted/section edit operations applied server-side over full content | big-doc edits | high |
| P-4 | `template`/`content` accepted as declarative render inputs (model owns design; runtime binds full content) | creative layer | high |
| P-5 | Anti-loop: extract->render is runtime-orchestrated (extract emits `suggestedNextActions` with the exact single `document.render` call), so the model has no reason to hand-assemble via `shell`. **No document-specific tool-budget cap** — see the note below. | P2 (S1 runaway) | critical |
| P-6 | Extract robustness: layout timeout auto-falls back to text without a user-visible error; newest source version selected instead of first `glob` hit | P7, P8 | high |
| P-7 | Exec image preinstalls `python-docx` (verify `openpyxl`/`markdown`/`weasyprint`); removes runtime pip rounds | P3 | high (independent, can land first) |

Structural invariant introduced by P-1 (not a heuristic): **a document deliverable is produced only by `document.render`.** A file assembled ad hoc in `shell` is not a document-to-deliver. When `document.render` succeeds but `registerDocumentVersion` is rejected, that is not a silent success — it is either fixed (path normalization) or surfaced honestly.

#### P-5 correction (2026-07-01, founder review): no document-specific tool-budget cap

An initial P-5 implementation added a per-turn counter that hard-stopped model `shell`/`exec` calls after `document.extract` opened a project (cap = 2). This is **dropped**. Rationale, consistent with this ADR's north-star (remove the cause, do not fight symptoms):

- The runaway loop in S1 was caused by hand-assembly through `shell`; P-1/P-2 remove that cause by making `document.render` the single deterministic door and having `extract` emit `suggestedNextActions` with the exact render call. There is no longer an incentive to loop.
- A fixed count (`2`) has **no principled basis** and can false-positive on legitimate unrelated `shell` work in the same turn — precisely the kind of "locked logic" this ADR rejects.
- Runaway tool use is already bounded generically by the existing per-turn tool-budget (`toolBudgetPolicy` / reservation exhaustion), which is tool-agnostic and does not need a document-specific duplicate.

Anti-loop for P-5 is therefore purely structural: single door (P-1) + engine-by-source (P-2) + `suggestedNextActions` (extract) + the pre-existing generic per-turn tool budget. The document-specific counter and its tests are removed.

### Symptom-patch revert (mandatory precondition)

The uncommitted working-tree guard `blockSmallPdfAfterDocumentStdoutLimit` (a `< 64 KB` PDF attach block after a stdout-limit turn) in `runtime-files-tool.service.ts`, `turn-execution.service.ts`, and `runtime-files-tool.service.test.ts` is a symptom fix. It is **reverted** before implementation begins. Slices P-1 and P-2 make the truncated-delivery outcome impossible by construction, so no size heuristic is needed.

### Verification and live regression (acceptance)

Gate (per touched slice, and full before any push): `lint` + `format:check` + `typecheck` for api/web/runtime/sandbox + focused runtime/sandbox tests + regenerated golden fixtures (ADR-119 prompt fixture, native-tool-projection fixtures) when tool guidance/schema changes.

Live regression re-runs all six scenarios. Acceptance invariant across all six:

- imported DOCX/PDF conversions go through `export_pdf.py`/`document.render`, never manual `shell build.py`;
- delivered file is full-size (S1 must not shrink a 70-page DOCX to a 2-page PDF);
- exactly one registered version per delivered file;
- exactly one `files.attach` per delivered file;
- zero runtime `pip install` for document work;
- no runaway loop (S1 completes in well under ten sandbox jobs).

### Sequencing and risk

Order: **P-7 (infra, independent) + symptom revert -> P-1 + P-2 (core: one door + engine) -> P-5 (anti-loop) -> P-6 (extract) -> P-3 (edit) -> P-4 (design)**.

Risk: P-1 changes the `document` contract (render now owns attach/register), so tool guidance, the ADR-119 golden prompt fixture, and `runtime-document-tool.service.test.ts` / `native-tool-projection.test.ts` must be updated in the same slice. Every push deploys to `persai-dev`; therefore each slice runs the full gate and the six-scenario live regression, and push happens only on explicit founder instruction. Full cleanup is mandatory: no parallel/legacy document-assembly path, no dead `execute_document_code`-as-deliverable route, no TODO scaffolding left behind.

### Orchestration note

Implementation is executed by GPT-5.4 / Sonnet implementation subagents. The parent agent is orchestrator/auditor only: it does not write product code directly, it reviews subagent diffs against this addendum, runs the gate, and drives the live regression before any deploy.

## Addendum III — 2026-07-01 — P-4 and P-3 declarative contracts (in PROD scope)

Addendum II left P-3 (`document.edit`) and P-4 (`template`/`content`) at principle level. This addendum fixes their concrete model-facing contract so the declarative creative layer is production-defined, not improvised. Both are additive to the single-door `document.render` model of P-1/P-2 — no new escape hatch, no hand-assembly.

### P-4 — declarative authored render (`content` + `template`)

`document.render` gains two optional inputs used for **authored** documents (not imported Office sources, which stay on the fixed LibreOffice engine from P-2):

- `content` — authored body as Markdown (a string, or a `/workspace/...` markdown file path). When present, the runtime deterministically builds the render entrypoint from `content` bound into the chosen template (Markdown → HTML via the seeded `markdown` python lib preinstalled by P-7), writes it as a visible project source under `render/`, and renders to the requested `format` (`pdf`/`docx`). The model no longer hand-writes `index.html`/`build.py` for authored docs.
- `template` — declarative design object (all optional): `title`, `theme` (small seeded enum, e.g. `default`|`report`|`minimal`), `css` (extra CSS appended), `pageSize` (`A4`|`Letter`), `runningHeader`, `runningFooter`.

Rules:
- If `content` is provided and the project is **not** an imported Office source, the runtime owns entrypoint generation; a model-provided `entrypoint` is ignored for that render.
- If `content` is omitted, existing entrypoint-based render is unchanged.
- Imported Office → PDF (P-2) always wins and ignores `content`/`template`.
- Render remains the single deliverable door: it still registers + delivers exactly once (P-1). `content`/`template` change only how the authored entrypoint is produced, never the delivery contract.

This is the concrete answer to "take the text and assemble a beautiful PDF — the runtime is mechanics, not creativity": full content is bound by the runtime; design is declarative data.

### P-3 — `document.edit` (surgical server-side edits over full content)

New `action="edit"` on the `document` tool. It edits the project's canonical editable content (`extract/extracted.md` for imported/extracted projects; the authored `content` source for authored projects) server-side over the **full** content, then optionally re-renders.

- Inputs: `projectPath` (the document project), `edits` (ordered array), optional `rerender` + `format`/`outputPath`.
- `edits[]` operations:
  - `{ op: "replace", find, replaceWith, all? }` — literal replace. Default `all:false` replaces the first occurrence and requires the `find` to be unambiguous; a zero-match or ambiguous non-`all` match returns an honest per-op failure (no silent no-op).
  - `{ op: "section", heading, content }` — replace the body under the given Markdown heading with `content`, leaving all other sections byte-for-byte intact.
- The runtime applies ops surgically (untouched content preserved verbatim), writes the updated content back as a visible source, and returns applied/failed counts per op. The model locates passages via `grep`/targeted `files.read` and emits ops; it never holds the whole document as a blob. If `rerender` is set, the edit chains into the single-door render (register + deliver once).

This is the concrete answer to "what if the model must fix some text in a big doc": operations, not rewrites; guaranteed full-coverage passthrough for untouched content.

### Sequencing, gate, and scope

Order: **P-4 (authored content/template) → P-3 (edit)**. Each is a bounded slice with the full AGENTS gate (lint/format/typecheck api+web+runtime+sandbox + suites + regenerated golden fixtures because the `document` schema/guidance changes). No parallel/legacy authoring path; the seeded scaffold remains the only mechanism. Live regression (six scenarios + a new authored-content scenario and an edit scenario) runs on `persai-dev` after the founder authorizes deploy (push = deploy).

## Purpose

This ADR defines the final production design for the active `document` system.

The goal is simple:

- document work must be visible and repairable in `/workspace`;
- imported documents must keep native source truth;
- final delivery must be honest and structurally verified;
- no hidden fallback path may silently generate or deliver a wrong file.

This ADR is about the active document path only:

- `PDF`
- `DOCX`
- `XLSX`

Presentation generation stays on the separate `presentation` path and is out of scope here.

## What "production-ready" means here

For this block, "production-ready" does **not** mean "some local slices work and tests are green".

It means all of the following are true at the same time:

1. The supported document flows work end to end on deployed pods.
2. Native files remain the source of truth for imported Office/PDF work.
3. Render/export paths are deterministic and format-appropriate.
4. Wrong fallback paths are blocked instead of silently used.
5. `document.inspect` checks output quality structurally, not only file existence.
6. Final attach is grounded in project/source/render/inspect/version facts.
7. UI and history reflect the real document stage, not raw tool noise.

If any of those is missing, the document block is not closed as PROD.

## Final production model

### 1. One visible document workflow

All active document work follows one visible loop:

```text
import or author source -> edit visible project source -> render/export -> inspect -> fix -> inspect -> register_version -> files.attach
```

No hidden worker model may replace this loop for normal PDF/DOCX/XLSX work.

### 2. Every deliverable belongs to a document project

Each user-ready output must belong to a project under `/workspace/projects/<slug>/`.

A project owns:

- source truth
- render/export source files
- output files
- inspection sidecars
- provenance metadata

### 3. Source of truth is native when the user started from a native file

For imported files:

- imported `DOCX` keeps native `DOCX` source truth;
- imported `XLSX` keeps native `XLSX` source truth;
- imported `PDF` keeps native `PDF` source truth.

`extract` is a view of the source, not a replacement for it.

`extract/extracted.md` may help with reading, search, and repair, but it must not silently become the editable truth for imported Office/PDF projects.

### 4. Final delivery path stays single

There is only one user-visible delivery path:

```ts
files({ action: "attach", path: "/workspace/..." })
```

`document` may produce provenance/version facts, but it does not invent a second delivery channel.

## Supported production behaviors

### Authored PDF projects

Supported production path:

- visible HTML/CSS/assets in the project;
- deterministic PDF render through the existing PDF stack;
- inspect before attach.

### Imported DOCX projects

Required production behavior:

- native source copy is materialized inside the project;
- same-format DOCX revision is done through visible native files/tools;
- DOCX output can be inspected against the source;
- DOCX to PDF export must use a real supported export path, not HTML rebuilt from extracted text.

### Imported XLSX projects

Required production behavior:

- native source copy is materialized inside the project;
- same-format XLSX revision is done through visible native files/tools;
- XLSX output can be inspected against the source;
- XLSX to PDF export must use a real supported export path, not a fake fallback.

### Imported PDF projects

Required production behavior:

- PDF stays a native source document project;
- inspect must work on the actual PDF;
- any supported edit/export path must be explicit and truthful.

If a requested path is not implemented yet, the system must stop honestly instead of inventing a workaround.

## Required tool behavior

### `document.extract`

`document.extract` reads a workspace file and creates a bounded document project plus sidecars.

It must:

- create or bind the project;
- preserve native source provenance;
- write extract sidecars as helper views;
- return compact facts, not huge prompt blobs.

### `document.render`

`document.render` is deterministic.

It must choose its execution path from explicit project/source facts, not from intent guessing in prose.

Allowed examples:

- authored PDF project -> HTML/CSS render path;
- imported DOCX project -> native DOCX same-format path;
- imported XLSX project -> native XLSX same-format path.

Forbidden examples:

- imported DOCX/XLSX -> fake PDF via `extracted.md` + ad-hoc HTML rebuild;
- imported PDF/DOCX/XLSX -> random `shell`/`exec` output treated as official project output without provenance.

### `document.inspect`

`document.inspect` is not just "does the file open".

It must produce meaningful structural facts for the output format:

- PDF: page count, readable text presence, obvious truncation signals;
- XLSX: sheet names, dimensions, formulas, blank sheets, structural drift;
- DOCX: headings, paragraphs, tables, readable text, structural drift.

For imported same-format Office revisions, inspect should compare output against project-native source where possible.

### `document.register_version`

Each registered version must point back to:

- project path
- source truth
- output path
- inspect result
- parent/currentness facts where applicable

### `files.attach`

Attach is the final step only after the output is structurally good enough for delivery.

## Production invariants

The following are mandatory at closure:

1. Every deliverable PDF/DOCX/XLSX output belongs to a document project.
2. Imported Office/PDF files keep native source truth.
3. `extract` stays a sidecar view and never silently replaces native truth.
4. Output provenance survives refresh/replay and attachment readback.
5. Inspect facts exist for deliverable outputs.
6. Final attach cannot outrun project/source/render/inspect truth.
7. Wrong or unsupported render/export paths stop honestly instead of silently degrading.
8. No normal path uses hidden `create_data_document` style generation for active Office work.

## Forbidden production paths

These are explicitly not acceptable as the production system:

- rebuilding imported Office output from `extract/extracted.md` as a substitute for native export;
- delivering a workspace file without attach truth;
- saying "ready" when the file was only produced, not delivered;
- treating ad-hoc `shell`/`exec` output as the official document pipeline;
- keeping hidden Office generation as the normal path;
- provider-era wording or legacy file identity leaking back into the active path.

## Current local state

As of the current local tree:

- visible project/source/provenance seams exist;
- imported native source is materialized into the project;
- imported `DOCX`/`XLSX` same-format visible revision path exists locally;
- inspect comparison for imported same-format Office outputs exists locally;
- false HTML fallback for imported native projects is blocked locally.

But the block is still **not closed as PROD** because the full remaining production gap is not empty.

## Remaining production gaps

The remaining closure work is now small and explicit:

1. Real production-grade export path for imported `DOCX -> PDF`.
2. Real production-grade export path for imported `XLSX -> PDF`.
3. Final delivery/version gating on inspect/provenance truth.
4. Independent final audit that removes old, parallel, and dead document-path code before `push/deploy`.
5. Deploy and live validation on real incident-style files.

Until those are done, this ADR stays open.

## Definition of done

This ADR may be closed only when all of the following are true:

1. Authored PDF workflow works on deployed pods.
2. Imported DOCX same-format revision works on deployed pods.
3. Imported XLSX same-format revision works on deployed pods.
4. Imported DOCX to PDF export works on deployed pods through a real supported path.
5. Imported XLSX to PDF export works on deployed pods through a real supported path.
6. Inspect/provenance truth gates final delivery.
7. Refresh/replay keeps document version/output/source facts intact.
8. Independent cleanup audit removes stale, parallel, and dead active-path code before release.
9. Live validation proves the old bad fallback path is gone.

## Verification gate

Each implementation slice must run focused tests for touched paths and then:

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

## Implementation plan

The implementation plan is subordinate to the final production design above.

### Done locally, not yet final PROD closure

- Hard cutover: active PDF/DOCX/XLSX work moved off opaque worker generation.
- Presentation path split out from `document`.
- Document projects, native source provenance, and version metadata were strengthened.
- Imported `DOCX`/`XLSX` same-format visible native revision path was added locally.
- Imported Office inspect comparison against project-native source was added locally.
- Wrong imported-native HTML fallback was blocked locally.

### Remaining implementation slices

1. Production-grade imported `DOCX -> PDF` export path.
2. Production-grade imported `XLSX -> PDF` export path.
3. Attach/version gating from inspect/provenance truth.
4. Independent cleanup audit that deletes stale, parallel, and dead document-path code.
5. Deploy and live validation.

## Historical notes

This ADR previously accumulated detailed wave-by-wave implementation notes and local fix history. That history was useful while the refactor was in flight, but it obscured the final target state.

The key historical facts that remain relevant are:

- old async hidden document generation for active Office work is no longer the target architecture;
- presentation generation remains intentionally separate;
- several local cleanup waves already landed to remove stale worker-era behavior and wrong fallbacks;
- the current repo still contains an intermediate local state rather than a fully closed production system.

## Anti-compromise red flags

- Calling this ADR closed before the imported Office to PDF export path is real.
- Treating `extract` text as the true editable source for imported Office/PDF.
- Allowing attach to outrun inspect/provenance truth.
- Saying "validated" when only file existence or file magic was checked.
- Reintroducing hidden Office generation as the normal path.
- Closing without live validation on real DOCX/XLSX/PDF incident files.
