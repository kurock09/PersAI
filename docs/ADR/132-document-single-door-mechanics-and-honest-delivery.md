# ADR-132: Document surface — three verbs, clean cutover, honest delivery

## Status

Closed locally 2026-07-02 — all five slices landed under parent-orchestrator supervision:

- **Slice 0** (`99e58c67`) — read-only keep/remove ledger with file:line anchors.
- **Slice 1** (`808960b3` + docs `35304479`) — atomic cutover: `document.inspect`, `document.render`, `document.convert` replace `document.extract` / `document.edit` / `document.register_version`; seeded `render/build.py` / `render/export_pdf.py` scaffolds gone (in-memory program source only); XLSX authored render enabled; D5 sibling-Markdown collocation live; legacy guidance purged from projection / catalog / preset.
- **Slice 2** (`0bc56ca2` + docs `7859b6d2`) — D4 document identity registry with two triggers (`document.render` / `document.convert` at an `outputPath`; `files.attach` on a doc-extension file); honest delivery on partial failure (`rendered` / `converted` with `warning` starting `auto_register_skipped:<code>` / `inspect_skipped:<code>` instead of collapsing to `skipped`); document-scoped delivery walls removed (`validateVisibleWorkspaceDocumentDeliverable` gate and `blocked` outcome deleted; manual `register_version` nudge replaced with structural `InternalServerErrorException`).
- **Slice 3** (`3462e521` + fix `54e5049d` + docs `db53089d`) — Case A guidance (four-step recipe: `files.read` → edit MD → `files.write(replace: true)` → `document.render({contentPath, outputPath})`) added to projection / catalog / preset; hard-rejection tests for the removed `edit` and `register_version` verbs; Case A/B property tests at runtime and API levels; ADR-119 golden prompt snapshot regenerated; **server-side document identity resolution** in `DocumentWorkspaceVersionRegistrationService` (`resolveExistingDocIdByOutputPath`) — runtime is stateless again, always sends `{docId: null, descriptorMode: null}`.
- **Slice 4** (this commit) — docs closure: `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md` updated to reflect the three-verb surface + D4 registry + D5 sibling-Markdown; `docs/CHANGELOG.md` + `docs/SESSION-HANDOFF.md` updated; **ADR-129 marked Closed** (superseded/completed by this ADR); **ADR-131 document-scoped items marked closed** by this ADR (workspace-scope items — Block 1 anti-clobber, Block 2 chat-scoped `files.*`, Block 3 stale-project guidance — remain landed locally in ADR-131 territory and await deploy).
- **Repair slice** (2026-07-03, this commit) — corrected the live-test regression where document delivery still depended on ADR-129 project-layout metadata. `files.attach` now creates the attachment row before best-effort inspect/register/documentLink enrichment, `document.render` / `document.convert` no longer materialize `project.json` in the active authored/convert path, `workspaceProjectPath` is nullable metadata rather than a delivery gate, root-level `/workspace/*.pdf|docx|xlsx` outputs are valid, and active model-facing guidance no longer teaches `document.extract` / `document.register_version` / active document project workflow.

Push=deploy is batched behind ADR-130 completion (founder directive). Live acceptance (criteria 1–11 below) runs post-deploy on `persai.dev` in the founder session.

## Baseline SHA

Pinned at implementation start from a **clean tree**. As of authoring, the working tree is dirty from the parallel ADR-130 agent; this ADR does not begin code work until the tree is clean and the ADR-130 vs ADR-132 collision on document guidance is reconciled (see "Coordination with ADR-130").

## Scope discipline (founder-mandated)

- **This ADR owns the document surface only.** Not sandbox generally, not `files.*`, not session/workspace file identity, not delivery barriers on non-document files, not general workspace versioning. Those are ADR-131's territory and are named here as dependencies, never re-implemented.
- **Clean cutover.** No legacy verbs, no compat shims, no transitional dual paths, no TODO scaffolding. When this ADR lands, the code contains the new surface and nothing else.
- **No fantasy about runtime intelligence.** The runtime never "decides" anything semantic. Every branch is a deterministic lookup in a table or an explicit parameter. Semantic decisions live only in the model.

## Relationship to prior ADRs

- **Supersedes** the model-facing document surface of **ADR-129** (visible extract/render/inspect/register_version/edit lifecycle) and the document-specific delivery decisions in **ADR-131** (Block 3 Problem E attach gate, seeded exporter visibility model). Those ADRs remain the historical record; this ADR is the new source of truth for the document surface. Closes ADR-129 and ADR-131's document-scoped items on live-green.
- **Depends on ADR-131** to correct the session/workspace file model (attach-scope guards on current-turn output, `hardDeleteChat` orphaning). Those are workspace architecture, **not** document architecture, and are owned by ADR-131 (addendum). This ADR consumes their outcome but does not implement them.
- **Depends on ADR-130 D8 / Slice 6** (persist and replay `tool_use`/`tool_result`) as the platform enabler for reliable multi-turn document editing. This ADR does **not** reopen ADR-130 and does **not** re-implement cross-turn memory.
- **Does not reopen** ADR-126 / ADR-127 / ADR-128 (workspace path identity, manifest source of truth, flat `/workspace/` namespace).

## Founder directive

Verbatim intent driving this ADR:

- "мне нужен нормальный рабочий чистый прод" — the goal is a clean production document surface for the whole normal complex, not a narrow converter and not deep-formatting-fidelity edge cases.
- "ничего не фантазировать из фантастики что рунтайм умеет думать. Не оставлять в коде старого легаси (запрещаю полностью) никаких хвостов и переходных моментов. ты должен сделать все чисто на чисто" — clean cutover, no legacy, no dual paths.
- "никаких барьеров и с файлами в sandbox — только если это доки да там можно что-то трогать" — no sandbox-wide guards, only document-scoped mechanics.
- "твоя задача документы а не лезть в sandbox и файлы — есть доставка attach есть доставка инлайн при работе с рендером все, всякие нуарды и обрезки файлов не должно быть" — document verbs deliver via their outputPath; everything else via explicit `files.attach`; no nudges, no post-edit size cuts, no guards on model's own output.

## Context

### Problem in one sentence

PersAI exposed the document mechanics to the model as a large, rigid, multi-verb DSL wrapped in visible "projects", seeded runnable scripts, and safety gates. The model has to learn a bespoke workflow, finds the wrong door (visible `build.py` → `shell`), gates then reject the model's own output, and half the real scenarios (net-new XLSX, in-chat editing, combining multiple files) have no clean path at all.

### Concrete failures (log-confirmed in live PROD)

- **P1 — Net-new XLSX has no door.** `document.render` throws for `format=xlsx` on authored content; model falls into `shell` on visible `build.py` scripts left over from prior sessions and delivers nothing.
- **P2 — Net-new DOCX is unreachable.** The authored `content` path exists mechanically but is buried under "visible project workflow" and "legacy entrypoint" guidance; smaller models (`gpt-5.4-mini`) miss it, resort to shell, deliver nothing.
- **P3 — Editing is fragile.** No coherent contract for editing an authored doc (source may or may not be persisted), and no coherent contract for editing an uploaded doc (previous `edit` verb rejected on stale-project heuristics).
- **P4 — Multi-file→one-doc has no primitive.** The model has no first-class way to consolidate several sources into one deliverable.

### Root cause

The model-facing document surface grew a bespoke DSL (`extract` / `render` / `inspect` / `register_version` / `edit`) plus a visible "project" management burden plus seeded runnable scripts, and delivery gates were bolted on top to compensate for the resulting confusion. The engine underneath (sandbox exec, LibreOffice, WeasyPrint, python-docx, openpyxl, markdown, OCR, manifest identity, exactly-once attach) is sound. The defect is the model-facing layer.

## Decision

### D1 — Model-facing surface: three document verbs plus `shell`

The document surface exposed to the model is exactly three verbs. Every other current model-facing document verb is removed (not deprecated, not aliased — removed).

1. **`document.inspect(path)`** — semantic view of a source. Internally runs extract + OCR + layout deterministically and returns a bounded structured representation the model can address. This is the door the model uses to read a 100-page PDF or a scanned DOCX without dumping bytes into context.

2. **`document.render({ content | contentPath, format, style?, template?, outputPath })`** — declarative authoring door. Model supplies the finished content (Markdown inline or as a workspace file); runtime formats it into `pdf`/`docx`/`xlsx-trivial` at `outputPath` and auto-attaches. Optional `style` selects a bundled theme; optional `template` (DOCX only, standard industry practice) uses a template file as style donor.

3. **`document.convert({ source, targetFormat, outputPath })`** — deterministic format conversion (LibreOffice) between the same content. No semantic change. Auto-attaches the output.

Everything the three verbs cannot express — XLSX with formulas/charts/multi-sheet/conditional formatting, custom PDF/DOCX layouts (invoices, forms), targeted edits of uploaded documents, data-driven document assembly — is done through **`shell` + Python** using the same preinstalled libraries the runtime uses internally (`openpyxl`, `python-docx`, `weasyprint`, `markdown`). Delivery of a shell-produced document is by explicit `files.attach(path)`; the runtime auto-registers a document version on that attach (see D4).

There is no `document.extract` verb (that mechanic lives inside `inspect`), no `document.register_version` verb (that mechanic is triggered automatically — see D4), no `document.edit` verb (editing is described in D3), no `document.execute` verb (that is exactly `shell`).

### D2 — Runtime owns mechanics only; no semantic decisions

The runtime is a deterministic executor. It never decides intent; every branch is:

- an explicit parameter (`format`, `outputPath`, `content` vs `contentPath`), or
- a deterministic lookup in an internal table (path → document identity, path → source markdown link, path → version chain).

The runtime does not classify user intent, does not guess formats, does not run heuristics over model prose, does not decide "how to combine" inputs. Semantic work — reading a source through `inspect`, authoring content, addressing an edit anchor, writing a Python program — is exclusively the model's.

### D3 — Editing model (two mechanically-distinct cases, no ambiguity)

There is no `edit` verb. Editing works as follows, keyed on how the document was produced:

**Case A — Document created by `document.render`.**
`document.render` **always** persists the Markdown source as a workspace file, whether the model supplied it inline (`content`) or as a path (`contentPath`). The source path is stored in the runtime's document identity registry (see D4). To edit:

1. Model reads the relevant slice of the Markdown source via `files.read`.
2. Model writes the revised Markdown back via `files.write(replace: true)`.
3. Model calls `document.render` again with the same `outputPath` — runtime looks up the registry, recognises the path as an existing document, rewrites the output, records version `v+1`.

Untouched sections are preserved byte-for-byte at the output layer because rendering is a pure function of the (possibly edited) full Markdown source.

**Case B — Document created by `shell` + Python (or uploaded).**
No Markdown source exists. To edit:

1. Model writes new Python code (in `shell`) that opens the file with `openpyxl` / `python-docx`, applies targeted mutations, and saves to the same path.
2. Model calls `files.attach(path)` — runtime looks up the registry, recognises the path as an existing document, records version `v+1`, delivers.

Untouched content is preserved byte-for-byte at the object-model layer because openpyxl/python-docx read-modify-save leaves non-mutated structure intact.

The runtime never chooses between Case A and Case B by intelligence. The registry either has a source-Markdown linkage for the path (Case A) or does not (Case B). The two cases are separate code paths driven by that table lookup.

### D4 — Document identity registry (document-scoped, not general workspace versioning)

The runtime maintains an internal table:

```
document_path → {
  isDocument: true,
  currentVersion: N,
  sourceMarkdownPath: string | null,   // set only for render-created docs
  history: [ { version, contentHash, gcsBlobRef, createdAt } ]
}
```

A path enters this table automatically on one of exactly two triggers:

- **Trigger 1 — document verb.** `document.render` or `document.convert` writes to `outputPath` → path is registered as a document at `v1` (or `v+1` if the path is already registered).
- **Trigger 2 — attach on a document-extension file.** `files.attach(path)` on a file with a document extension (`.docx`, `.xlsx`, `.pdf`, further list finalized in Slice 0) registers the path as a document at `v1` (or `v+1` if already registered).

Every registered document has its version bytes preserved in GCS as immutable blobs. The workspace path serves the latest bytes; historical versions are addressable via `{ path, version }` for backend integrity of prior chat attachment links.

Non-document files (temp CSVs, cache files, intermediate scratch) are **not** in this table and receive no version history. `replace: true` on those tupo-overwrites as it does today (ADR-131 Block 1 default remains).

**This is not general workspace file versioning.** General versioning is explicitly deferred (founder-decided 2026-07-02). Only paths that pass one of the two triggers above are tracked.

### D5 — Runtime-internal source persistence for `render`

When `document.render` is called, the runtime **always** materializes the Markdown source as a visible workspace file — including when the model supplied it inline as `content`. Convention: source lives alongside `outputPath` with the same basename and `.md` extension (`report.pdf` → `report.md`; `report.md` → `report.md` if the source path was already given). Collisions with an existing file at that path route through the ADR-131 Block 1 `(N)` mechanic.

This guarantees every rendered document is editable via Case A. The model never has to reconstruct authored content from memory or transcript.

### D6 — No delivery barriers, no post-write cuts, no size nudges, no guards on model output

Every delivery-side guard whose only observable effect is to reject, truncate, or nudge a file the model itself produced or explicitly attached in the current turn is removed from the document delivery path. Concretely, in the document-scoped code paths this ADR touches:

- No document-attach provenance walls that reject a project-owned deliverable for lacking a registered version — the register happens automatically as part of the same operation.
- No post-edit size cuts, content truncation, or heuristic "looks stale" filters on the model's own output.
- No re-parsing of model prose to decide delivery.
- No "safety" gates that intercept a document mid-delivery.

Delivery is defined structurally: an attachment row was produced this turn (via document verb auto-attach or explicit `files.attach`) → user has the file. No attachment row → visible error the model must resolve, not a silent orphan and not a false "готово".

Non-document files, sandbox-general concerns, cross-chat visibility, `files.list` scoping — **not this ADR**. Those are ADR-131 workspace architecture. This ADR names them as dependencies (ADR-131 must correct current-turn attach walls and `hardDeleteChat` orphaning), but the fix is not owned here.

### D7 — Clean cutover; no legacy, no dual paths

When this ADR lands:

- The removed verbs (`document.extract`, `document.register_version`, `document.edit`, any lingering aliases) are **deleted** from the model-facing surface, from tool catalog data, from the projection, from bootstrap presets, and from all runtime dispatch. No aliases, no compat shims, no `deprecated` markers, no "accept for one release" fallbacks.
- Visible seeded runnable scripts (`build.py`, `export_pdf.py`, any authored `build.py`) are **deleted** from extract-time seeding. Runtime generates program source in-memory as it already does for `execute_document_code` (per ADR-131 Wave 2).
- Model-facing guidance in `native-tool-projection.ts`, `tool-catalog-data.ts`, and `bootstrap-preset-data.ts` is rewritten to describe exactly the three-verb surface and the `shell + python` escape. All legacy phrasing ("visible project workflow", "legacy entrypoint", "build.py", "export_pdf.py", "visible runnable script") is removed.
- The XLSX authored-render throw is removed; `render` supports `pdf`/`docx`/`xlsx` (trivial data-only) uniformly.
- Tests that lock stale behavior are updated in the same slice that removes the behavior. No slice preserves stale wording to keep tests green.

## Non-goals

- General workspace file versioning (all files versioned). Only document-registered paths are versioned. Founder-decided 2026-07-02.
- Sandbox-wide file guards, `files.*` scope changes, `hardDeleteChat` orphan cleanup, `cross_scope_required` narrowing to current-turn output. These are ADR-131 addendum territory.
- Cross-turn tool memory implementation. Owned by ADR-130 D8 / Slice 6.
- Document-turn provider timeout / slow-model routing. Founder-owned.
- Reversing ADR-128 flat namespace or introducing content-addressed blobs for non-documents.
- Guaranteeing deep-formatting fidelity of arbitrary imported DOCX beyond what python-docx honestly delivers, or full-document rewrites masquerading as edits.
- Gating or disabling `shell`. `shell` stays fully available and ungated.

## Target architecture

```text
MODEL (intent + semantic content)
  document.inspect(path)                             — read big source semantically
  document.render({ content|contentPath, format, ... , outputPath })
                                                     — author → file
  document.convert({ source, targetFormat, outputPath })
                                                     — format shift
  shell + python (openpyxl / python-docx / weasyprint)
        + files.attach(path)                         — complex xlsx, uploaded-doc edits, custom layout

RUNTIME (mechanics only, no semantics)
  extract + OCR                            (inside inspect)
  markdown → docx/pdf/xlsx-trivial         (inside render, always persists .md source)
  LibreOffice format conversion            (inside convert)
  document identity registry               (path → version chain, source link)
  auto version + auto attach on doc verbs, register on doc-file attach
  ephemeral sandbox exec                   (for shell; existing engine, unchanged)
```

## Work plan

Four implementation slices plus a read-only design slice. The three-verb surface, legacy removal, and visible-script removal happen **atomically in one slice**, not staged — per D7 there is no dual-path transitional state at any commit boundary. Each slice ends with the standard AGENTS gate + focused tests; live acceptance in the founder session is deferred until the founder pushes the full ADR-132 stack (push is founder-gated because push = deploy and the founder is bundling with ADR-130 completion).

### Standard verification gate (every slice)

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck`
6. affected focused tests for touched document surfaces (including new tests that lock the three-verb contract, the source-persistence rule, the registry triggers, and the absence of legacy verbs / visible seeded scripts)
7. commit locally after the gate is green; **no push**

Live acceptance criteria (below) are validated post-push in the founder session and any regressions are handled as follow-up slices in this ADR before it is closed.

### Slice 0 — Read-only ledger (design, no behavior change)

Subagent: GPT-5.4 (read-only). Produce the exact keep/remove ledger with `file:line`:

- The current model-facing verbs, guidance strings, and dispatch code to delete;
- The runtime internal services to keep and call server-side (extract+OCR, LibreOffice, python-docx, openpyxl, weasyprint, markdown, ephemeral exec, manifest);
- The runtime code paths that currently guard/reject/nudge/truncate the model's own current-turn document output — every such path scoped to the document code paths is an ADR-132 anchor; anything scoped to the general `files.*` or session/workspace layer is out-of-scope and belongs to ADR-131 addendum;
- The document-extension list for D4 Trigger 2;
- The exact source-markdown collocation rule for D5 (`<outputPath basename>.md` alongside the output), including collision behavior with existing files at that path;
- Test files that lock stale behavior, mapped to the slice that will update each.

No code change. Orchestrator reviews and signs off before Slice 1 starts.

### Slice 1 — Atomic cutover: three verbs replace legacy in one step

Single-commit atomic cutover of the model-facing document surface. In one slice:

- **Add** `document.inspect`, `document.render` (unified `pdf`/`docx`/`xlsx`, always-persist source per D5), `document.convert`.
- **Delete** `document.extract`, `document.register_version`, `document.edit`, and any residual model-facing document verbs from the projection, tool catalog seed, bootstrap preset, and runtime dispatch. No aliases, no compat shims, no deprecated markers.
- **Delete** visible seeded runnable scripts (`build.py`, `export_pdf.py`, any authored `build.py`) from extract-time output. Runtime generates program source in-memory as it already does for `execute_document_code`.
- **Remove** the XLSX authored-render throw.
- **Purge** legacy guidance from `native-tool-projection.ts`, `tool-catalog-data.ts`, and `bootstrap-preset-data.ts`: no "visible project workflow", no "legacy entrypoint", no `build.py`/`export_pdf.py` mentions, no "visible runnable script" phrasing. The new guidance describes only the three-verb surface plus the `shell + python + files.attach` escape.
- **Update tests in the same commit** — any test locking legacy verb/guidance/seed presence is rewritten to lock the new contract; no test is preserved by keeping stale wording.

Gate green + commit locally. There is no intermediate state where both old and new surfaces coexist.

### Slice 2 — Document identity registry + auto attach/version

Implement the D4 registry (`document_path → { isDocument, currentVersion, sourceMarkdownPath, history }`) with the two triggers:

- **Trigger 1** — `document.render` / `document.convert` at an `outputPath` registers/updates the path in the registry.
- **Trigger 2** — `files.attach(path)` on a file with a document extension (from Slice 0's finalized list) registers/updates the path in the registry.

Rewire document verb outputs to auto-attach on delivery through this registry. Remove **document-scoped** delivery guards named in D6 (provenance walls on document outputs, size-cuts on model-produced document bytes, any prose-parsing of model output). Do **not** touch the general workspace/session file guards (`cross_scope_required`, `hardDeleteChat` orphaning, general `files.*` scope logic) — those are ADR-131 territory and are dependencies, not this ADR's fix.

Historical version bytes are preserved in GCS as immutable blobs keyed on `(path, version)`. The workspace path always serves the latest bytes.

### Slice 3 — Editing paths (Case A + Case B) clean

Land the two mechanically-distinct edit paths from D3 without any `edit` verb:

- **Case A** — model reads/writes the persisted Markdown source (`files.read` + `files.write(replace: true)`), then calls `document.render` again with the same `outputPath`; registry lookup drives the `v+1` recording.
- **Case B** — model writes new Python code in `shell` that uses `openpyxl` / `python-docx` to open, mutate, and save the file at the same path, then calls `files.attach(path)`; registry lookup drives the `v+1` recording.

Slice test additions must lock: (a) Case A byte-preserving untouched content at output level; (b) Case B byte-preserving untouched structure at object-model level; (c) attempts to edit via any removed legacy verb return a hard error, not a fallback.

### Slice 4 — Docs + closure

Update `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md` to match landed code. Record **ADR-129 as closed** and **ADR-131 document-scoped items as closed**. ADR-131 workspace-scope items (current-turn attach walls, `hardDeleteChat` orphaning) are tracked separately in ADR-131's addendum, not left as residuals here.

## Acceptance criteria

This ADR is not complete until, **live-verified in the founder session**:

1. Net-new PDF, DOCX, and XLSX (via `render` + shell for complex xlsx) are created from scratch and delivered in chat first-try, no `shell` script hunting.
2. An edited authored document (Case A) preserves untouched content byte-for-byte at the output level.
3. An edited shell-produced or uploaded document (Case B, e.g. XLSX cell change) preserves untouched structure at the object-model level.
4. Convert delivers correctly for the common source→target pairs.
5. Combining several sources into one deliverable works: model uses `inspect` on inputs, authors consolidated content, `render`s the result.
6. Every produced file delivers exactly once with a working link — no false success, no 404, no orphan.
7. No legacy verb (`extract`, `register_version`, `edit`) remains in the model-facing surface or the codebase.
8. No visible seeded runnable script (`build.py`, `export_pdf.py`, authored `build.py`) remains in the extract-time output or the runtime.
9. No document-scoped delivery guard rejects the model's own current-turn output.
10. `shell` remains available and ungated throughout.
11. Docs match landed code; ADR-129 and ADR-131 (document-scoped items) are recorded closed.

## Coordination with ADR-130 (parallel agent)

A parallel agent is executing ADR-130. That program's Slice 3 (heavy-descriptor re-layering) touches `native-tool-projection.ts`, `tool-catalog-data.ts`, and `bootstrap-preset-data.ts` — the exact document-guidance files this ADR rewrites.

- **ADR-130 Slice 3 does not re-layer the `document` descriptor independently.** That work is owned by this ADR (Slices 1 and 4). Doing it in both places produces conflicting edits.
- ADR-130's other slices (skills catalog compaction, identity/response_contract/memory/files owners, scenario/todo dedupe, character precedence) are orthogonal and proceed normally.
- ADR-130 D8 / Slice 6 is this ADR's editing enabler for reliable multi-turn edits; sequencing is: land the non-document ADR-130 slices + this ADR's document work, with D8 as the shared platform fix (owned by ADR-130, consumed here).
- Implementation of this ADR starts only from a clean tree after that reconciliation.

## Residual risk

- Collapsing five verbs to three changes a quality-sensitive surface; Slice 4 must keep focused projection/catalog tests and gate on live acceptance, not snapshots alone.
- Case B object-model editing has a real python-docx / openpyxl ceiling (deep VBA, some conditional formatting rules, exotic chart types). The runtime must fail honestly with a visible error rather than silently degrade.
- Removing document-scoped delivery guards must not disturb the ADR-131 workspace-scope guards for genuinely-foreign stale files. Slice 2 must scope its guard removal to document-scoped code paths only and add focused tests proving the ADR-131 cross-chat protection still holds.

## Next recommended step

Founder trigger to start implementation: (a) the parallel ADR-130 agent has landed the non-document slices and has **not** independently re-layered the `document` descriptor, (b) the tree is clean. Then run Slice 0 (read-only ledger), pin the baseline SHA, and proceed Slice 1 → Slice 5 with live acceptance per slice, closing ADR-129 and ADR-131 (document-scoped items) at Slice 5.

## References

- `ADR-129` — visible-workspace document lifecycle (superseded by this ADR's three-verb surface).
- `ADR-131` — workspace file identity, isolation, delivery safety (session/workspace file model dependency; addendum owns current-turn attach walls + `hardDeleteChat` orphan cleanup).
- `ADR-130` — prompt layering, cache discipline, lazy lookup; D8 / Slice 6 is this ADR's cross-turn editing enabler; Slice 3 document descriptor folded here.
- `ADR-126` / `127` / `128` — path identity, manifest source of truth, flat namespace (not reopened).
- `ADR-123` — native sandbox runtime isolation and document execution (the kept engine).
