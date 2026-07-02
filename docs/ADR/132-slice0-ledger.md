# ADR-132 Slice 0 — Keep/remove ledger (read-only)

Read-only inventory produced by GPT-5.4 worker under orchestrator audit. Every claim carries a concrete `file:line` (or range) anchor. No behavior change in this slice.

## Section 1 — Model-facing document verbs (current) → target action

| action | projection | runtime dispatch | catalog | bootstrap preset | Slice 1 target |
| --- | --- | --- | --- | --- | --- |
| `extract` | `apps/runtime/src/modules/turns/native-tool-projection.ts:1322-1324`, `1339-1344`, `1366-1375` | dispatch `apps/runtime/src/modules/turns/runtime-document-tool.service.ts:123-127`; impl `375-444`; parser `1768-1785` | `apps/api/prisma/tool-catalog-data.ts:121-146` | `apps/api/prisma/bootstrap-preset-data.ts:216-225` | `DELETE (cutover)` — extract mechanic keeps living inside runtime-internal `document.inspect` path |
| `inspect` | `native-tool-projection.ts:1323-1324`, `1341-1344`, `1366-1375`, `1491-1494` | dispatch `runtime-document-tool.service.ts:123-127`; impl `470-545`; parser `1787-1805` | `tool-catalog-data.ts:127-131`, `137-146` | `bootstrap-preset-data.ts:223-229` | `REPLACE WITH: document.inspect(path)` — thin model-facing surface backed by existing `DocumentWorkspaceInspectionService` + extract engine |
| `render` | `native-tool-projection.ts:1324-1331`, `1347-1350`, `1366-1414`, `1491-1499` | dispatch `runtime-document-tool.service.ts:130-142`; impl `571-1021`; parser `1806-1837` | `tool-catalog-data.ts:121-146` | `bootstrap-preset-data.ts:216-229` | `REPLACE WITH: document.render({ content \| contentPath, format, style?, template?, outputPath })` — unified `pdf`/`docx`/`xlsx`, always-persist source (D5) |
| `edit` | `native-tool-projection.ts:1325-1326`, `1352-1355`, `1444-1489` | dispatch `runtime-document-tool.service.ts:156-168`; impl `1023-1246`; parser `1839-1879` | `tool-catalog-data.ts:132-146` | `bootstrap-preset-data.ts:224-228` | `DELETE (cutover)` — replaced by Case A (source read/write + re-render) and Case B (shell + python + attach) per D3 |
| `register_version` | `native-tool-projection.ts:1326`, `1358-1362`, `1505-1529` | dispatch `runtime-document-tool.service.ts:145-153`; impl `1551-1687`; parser `1881-1905` | `tool-catalog-data.ts:135-146` | `bootstrap-preset-data.ts:224` | `DELETE (cutover)` — registration is runtime-internal via D4 registry auto-triggers |
| `convert` | *not exposed today* — needs adding: `native-tool-projection.ts:1366-1370`; runtime action type `runtime-document-tool.service.ts:1918-1922` | *no current dispatch* | *no current catalog row* | *no current preset row* | `ADD: document.convert({ source, targetFormat, outputPath })` — LibreOffice deterministic, format-only (no semantic change) |

Notes:

- Action enum today is exactly `extract | inspect | render | edit | register_version` (`native-tool-projection.ts:1366-1370`, `runtime-document-tool.service.ts:1918-1922`). No `convert` verb exists — Slice 1 adds it fresh, does not rename.
- No aliases retained. Slice 1 deletes `extract`/`edit`/`register_version` from the enum in the same commit that adds `convert` and replaces `inspect`/`render`.

## Section 2 — Runtime internal services KEPT (server-side, not model-facing)

| service | file | mechanics | callers today / rewire seam |
| --- | --- | --- | --- |
| `DocumentExtractionService` | `apps/api/src/modules/workspace-management/application/document-extraction.service.ts:46-125`, `185-204`, `224-301` | shared extraction engine: text/PDF/DOCX extraction, provider select/escalate, Mistral OCR / LlamaParse fallback, quality metadata, OCR billing | called from `document-workspace-extraction.service.ts:518-568`; wire under `document.inspect` internals |
| `DocumentWorkspaceExtractionService` | `apps/api/src/modules/workspace-management/application/document-workspace-extraction.service.ts:153-245`, `352-489`, `733-823` | project reuse (idempotent), native source copy, extract sidecars, manifest, `suggestedNextActions` | HTTP `internal-runtime-document-extract.controller.ts:2-20`; runtime `runtime-document-tool.service.ts:390-396`. Keep mechanics; hide behind `document.inspect` server-side |
| `DocumentWorkspaceInspectionService` | `apps/api/src/modules/workspace-management/application/document-workspace-inspection.service.ts:125-246`, `249-304`, `306-340` | deterministic PDF/DOCX/XLSX inspect + `.inspect.json` sidecar + native-source comparison for imported same-format outputs | HTTP `internal-runtime-document-inspect.controller.ts:2-20`; runtime `runtime-document-tool.service.ts:496-502`, `920-933`; attach path `register-chat-attachment.service.ts:440-446`. Keep as engine for `document.inspect` and attach/render registration |
| `DocumentWorkspaceVersionRegistrationService` | `apps/api/src/modules/workspace-management/application/document-workspace-version-registration.service.ts:108-320` | resolve project context, validate deliverable, read manifest/inspection sidecars, register `AssistantDocument` version | HTTP `internal-runtime-document-register-version.controller.ts:2-20`; runtime manual register `runtime-document-tool.service.ts:1620-1634`; render finalize `941-956`; attach path `register-chat-attachment.service.ts:453-467`. **This is the best seam to absorb the D4 registry behavior** |
| `AssistantDocumentJobService` | `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts:785-923`, `926-1001` | persist document/version graph; resolve current output → `documentLink` | version-registration `document-workspace-version-registration.service.ts:291-303`; attach path `register-chat-attachment.service.ts:315-320`, `474-479`. **Extend existing `AssistantDocument` domain rather than a parallel `document_path_registry`** |
| `RuntimeDocumentToolService.buildRenderProgramSource()` + `runDocumentCodeSandboxJob()` | `apps/runtime/src/modules/turns/runtime-document-tool.service.ts:768-788`, `2843-2955`, `3213-3229` | in-memory program-source assembly (office same-format, office→PDF, authored markdown, HTML→PDF) + sandbox `execute_document_code` | render `768-788`; edit rerender `1154-1159`. Keep engine; collapse model surface only |
| `buildImportedOfficeRenderScaffold()` / `buildImportedOfficePdfExportScaffold()` | `packages/runtime-contract/src/index.ts:4366-4404`, `4406-4462` | internal Python builders for DOCX/XLSX same-format and Office→PDF via LibreOffice | runtime in-memory assembly `runtime-document-tool.service.ts:2861-2881`. Keep server-side; stop advertising `.py` entrypoint paths |
| `RegisterChatAttachmentService.resolveFilesAttachDocumentLink()` | `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts:309-355`, `381-488` | Trigger-2 attach path: detect doc-scoped output, run inspect + register if needed, resolve `documentLink` | called from `register-chat-attachment.service.ts:199`. Keep trigger; remove refusal/nudge branches per Section 3 |

## Section 3 — Document-scoped delivery guards / nudges / post-write cuts to REMOVE

Document-scoped branches to remove or rewire (all must go in Slice 2):

- `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts:333-337` — hard `BadRequestException` when `findCurrentDocumentLinkByOutputPath()` returns `blocked`. Remove refusal; keep auto-register mechanic.
- `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts:389-407` — manual "Run document.register_version..." / "Run document.inspect, then..." nudge branch when auto-register deps unavailable. Remove document-specific manual steering.
- `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts:964-983` — `status: "blocked"` classifier in `findCurrentDocumentLinkByOutputPath` that fabricates the delivery wall.
- `apps/api/src/modules/workspace-management/application/document-workspace-deliverable-gating.ts:109-199` — five gate reasons (`project_path_required`, `project_output_mismatch`, `project_manifest_missing`, `provenance_missing`, `inspect_missing`/`inspect_*`) that currently block document-scoped delivery on constraints. If kept at all, must not refuse the model's own current-turn output — become internal enrichment only.
- `apps/runtime/src/modules/turns/runtime-document-tool.service.ts:833-839`, `957-990` — `document.render` can succeed at persist but rewrite result into `action:"skipped"` if register fails. Preserve honest failure but stop suppressing the produced file's delivery.

Post-write byte-size/content-size cuts: **none found**. Render path gates on sandbox completion + persist + inspect/register only (`runtime-document-tool.service.ts:797-839`, `957-990`); size fields (`sizeBytes`, `truncated`) are informational (`805-864`, `3348-3405`).

Prose parsing over model output text to decide delivery: **none found**. Render decides from sandbox/job/persist/register structure (`runtime-document-tool.service.ts:768-839`, `920-990`); attach decides from output path + project lookup + inspect + register (`register-chat-attachment.service.ts:315-488`).

### OUT-OF-SCOPE — hand to ADR-131 addendum

- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts:303-315` — `cross_scope_required` guard on general `files.*` (workspace visibility scope, not document delivery).
- `apps/api/src/modules/workspace-management/application/list-workspace-files-from-manifest.service.ts:148-160` — manifest scope filters by `originChatId`/`originAssistantId` (general `files.list` policy).
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts:329-355` — `hardDeleteChat` orphaning of `workspace_file_metadata` (session/workspace file GC).

These are NOT ADR-132 anchors. ADR-131 addendum owns them.

## Section 4 — Visible seeded runnable scripts (extract-time) — status + remaining delete targets

Active `document.extract` **no longer materializes** visible `render/build.py` / `render/export_pdf.py` at extract time — that was already fixed by ADR-131 Wave 2. Extract currently persists only project manifest, native source copy, and an optional `render/report.html` scaffold for text-like non-DOCX sources (`document-workspace-extraction.service.ts:352-407`). **Confirmed.**

Remaining visible-script surface still pointing at deleted mechanics (must all go in Slice 1):

- Extract result advertises Python entrypoint paths through manifest/read-path metadata:
  - `defaultRenderEntrypoint` and PDF export read path: `document-workspace-extraction.service.ts:360-364`, `447-474`
  - `suggestedReadPaths` includes PDF export entrypoint for DOCX/XLSX: `document-workspace-extraction.service.ts:467-474`
- Shared layout/helpers still name visible entrypoints:
  - `defaultPdfExportEntrypoint: .../render/export_pdf.py` — `packages/runtime-contract/src/index.ts:4318-4320`
  - `buildDocumentProjectPythonRenderEntrypoint()` → `/render/build.py` — `runtime-contract/src/index.ts:4354-4358`
  - `buildDocumentProjectPdfExportEntrypoint()` → `/render/export_pdf.py` — `runtime-contract/src/index.ts:4360-4363`
  - imported-office default render entrypoint resolves to `/render/build.py` — `runtime-contract/src/index.ts:4464-4478`
- Legacy visible-script render fallback still exists when a `.py` entrypoint is supplied — reads the visible script body from workspace: `apps/runtime/src/modules/turns/runtime-document-tool.service.ts:2907-2931`. **Delete this fallback in Slice 1** — the in-memory generator (`768-788`, `2843-2955`, sandbox `3213-3229`) is the only render path.

Shared scaffold builders `buildImportedOfficeRenderScaffold()` / `buildImportedOfficePdfExportScaffold()` (`packages/runtime-contract/src/index.ts:4366-4404`, `4406-4462`) stay as runtime-internal source generators.

## Section 5 — XLSX authored-render throw to REMOVE

- Exact throw: `apps/runtime/src/modules/turns/runtime-document-tool.service.ts:2345-2354` (`if (input.format !== "pdf" && input.format !== "docx") { throw new Error("document.content authored render currently supports format=pdf or format=docx.") }`).
- Adjacent restrictive branches (all updated in Slice 1):
  - projection restricts authored `content` to `pdf`/`docx`: `native-tool-projection.ts:1394-1403`
  - projection guidance narrows authored render to "simple new PDF or DOCX": `native-tool-projection.ts:1329-1331`
  - catalog authored guidance: `tool-catalog-data.ts:129-145`
  - bootstrap-preset authored guidance: `bootstrap-preset-data.ts:225-227`
- Change: accept `xlsx` for trivial data-only markdown-table render (`content` or `contentPath`); branch into a data-only workbook generator (`openpyxl` in-memory). Keep imported-office native same-format and Office→PDF branches unchanged (`runtime-document-tool.service.ts:2855-2883`).

## Section 6 — Document identity registry (D4) — build seam

Extend existing `AssistantDocument` domain — do **not** invent a parallel `document_path_registry` table.

Prisma schema already has the versioning domain:

- `AssistantDocument`: `apps/api/prisma/schema.prisma:2351-2375`
- `AssistantDocumentVersion`: `apps/api/prisma/schema.prisma:2377-2408`
- `AssistantDocumentRenderJob`: `apps/api/prisma/schema.prisma:2410-2451`
- `AssistantDocumentRevisionLog`: `apps/api/prisma/schema.prisma:2476-2497`

Code seams:

- `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts:785-923` (`registerVisibleWorkspaceVersion`)
- `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts:926-1001` (`findCurrentDocumentLinkByOutputPath`)
- `apps/api/src/modules/workspace-management/application/document-workspace-version-registration.service.ts:263-303`

Piggyback on `AssistantDocument.currentVersionId`, `AssistantDocumentVersion.versionNumber`, and version `sourceJson.metadata.documentWorkspace.outputPath`.

**Trigger 1 wiring point (document verb output-attach):**

- render output persist: `apps/runtime/src/modules/turns/runtime-document-tool.service.ts:805-814`
- render finalize (inspect + register): `runtime-document-tool.service.ts:825-832`, `920-956`

`document.convert` wires at the same output-registration seam.

**Trigger 2 wiring point (`files.attach` on doc-extension file):**

- attach hook: `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts:309-355`
- auto-register: `register-chat-attachment.service.ts:381-488`

**Trigger 2 document-extension list (ORCHESTRATOR DECISION):** `.pdf`, `.docx`, `.xlsx` only. No `.pptx` for ADR-132 scope — no active pptx render/convert path today (`document-workspace-version-registration.service.ts:152-159` rejects pptx). Widen later if pptx becomes first-class. No `.md` — Markdown is source, not delivered document.

Anchors for the current three-format state:

- files.attach path already gates to `.pdf`/`.docx`/`.xlsx`: `register-chat-attachment.service.ts:325-327`
- visible output format resolver recognises `.pdf`/`.pptx`/`.xlsx`/`.docx`: `document-workspace-deliverable-gating.ts:58-74`
- runtime-contract format enums use `pdf | xlsx | docx`: `packages/runtime-contract/src/index.ts:2134-2194`

## Section 7 — D5 source-markdown collocation rule

**Target rule (ADR-132):** source lives alongside output with same basename and `.md` extension. `outputPath = /workspace/x/y/report.pdf` → `sourcePath = /workspace/x/y/report.md`.

**Current code does not follow the rule** — authored source lives at `render/content.md` inside project dir:

- authored source selection: `runtime-document-tool.service.ts:1266-1281`
- edit guidance points to `render/content.md`: `runtime-document-tool.service.ts:1088-1091`
- authored render writes `render/content.md`: `runtime-document-tool.service.ts:2371-2411`

**Collision-safe seams already implemented:**

- generic `(N)` collision resolver in sandbox bridge: `apps/sandbox/src/workspace-file-bridge.service.ts:376-389`, `470-510`
- generic numeric-suffix outbound writer: `apps/runtime/src/modules/turns/write-runtime-outbound-artifact.ts:30-43`

**Trap for Slice 2/3 implementers:** current authored source writer forces exact overwrite bypassing ADR-131 collision semantics (`runtime-document-tool.service.ts:2687-2738`, quote: `args: { action: "write", path: input.path, content: input.content, replace: true }`). D5 source persistence must switch to the collision-safe seam so a stray existing file at `report.md` gets a `(1)` sibling instead of silent overwrite.

**Fallback for source name conflict:** ADR-131 Block 1 `(N)` from `resolveWorkspaceWritePath()` — `workspace-file-bridge.service.ts:470-510`.

**ORCHESTRATOR DECISION on Q2 (D5 seam):** runtime writes the source markdown, then triggers server-side registration. Reasoning: source persistence is a workspace file write (runtime's domain); D4 registry lives in `AssistantDocument` (API's domain). Split responsibility along the existing runtime-persist → API-register seam already used for output files. Do **not** move source-path allocation into the API-side registration helper — that would cross the boundary unnecessarily and duplicate write mechanics. Runtime uses the collision-safe seam for source; registration reads the resulting `sourcePath` from the runtime tool result.

Also: with ADR-132 collapsing the model-facing project surface, authored renders no longer create a visible `/workspace/projects/<slug>/render/content.md` layout. Authored source moves to the sibling location next to `outputPath`. The internal project-manifest layout (if kept at all for imported-source caching) becomes runtime-internal and invisible to the model. Confirm final shape in Slice 1.

## Section 8 — Stale-test ledger

| test file + anchor | stale behavior | slice |
| --- | --- | --- |
| `apps/runtime/test/native-tool-projection.test.ts:349-353`, `920-925`, `939-941`, `978-990` | five-verb surface (`extract`/`render`/`inspect`/`register_version`) + legacy entrypoint fallback | Slice 1 |
| `apps/api/test/tool-catalog-data.test.ts:79-147` | catalog rows for `document.extract`, `document.edit`, advanced-only `document.register_version`, `render/content.md`, legacy `build.py` path hints, Office-PDF phrasing | Slice 1 |
| `apps/api/test/bootstrap-preset-data.test.ts:98-121` | no document-specific stale wording lock — file validates XML/outer-tag structure only | none for ADR-132; note-only |
| `apps/api/test/adr119-golden-prompt-snapshot.test.ts:192-205` + fixture `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt:196-200` | golden fixture locks `action="extract"`, `document.register_version`, `action="edit"`, `render/content.md`, legacy entrypoint workflow | Slice 1 |
| `apps/runtime/test/runtime-document-tool.service.test.ts:60-170` | current `document.extract` behavior + `suggestedNextActions` wording | Slice 1 |
| `apps/runtime/test/runtime-document-tool.service.test.ts:1081-1131`, `3081-3122` | `register_version` action + inspect-gating error path | Slice 1 + Slice 2 |
| `apps/runtime/test/runtime-document-tool.service.test.ts:1733-1860` | "omitting authored content keeps the legacy entrypoint render path unchanged" | Slice 1 |
| `apps/runtime/test/runtime-document-tool.service.test.ts:1516-1537` | authored-source convention `render/content.md` + absence of visible `render/build.py` — `content.md` part becomes stale under D5; no-visible-`build.py` invariant stays good | Slice 1 for verb surface; Slice 2/3 for D5 path rewrite |
| `apps/runtime/test/runtime-document-tool.service.test.ts:3675-3854` | `document.edit` + `rerender` chaining behavior | Slice 3 |
| `apps/api/test/register-chat-attachment.service.test.ts:302-478` | current Trigger-2 auto-register on `files.attach`; refresh when D4 registry lands | Slice 2 |

Rule: no test is preserved by keeping stale wording. Every stale test above is rewritten in the slice that removes the behavior.

## Section 9 — Open questions and orchestrator decisions

**Q1 — pptx in Trigger-2 extension list?**

Anchors: `document-workspace-deliverable-gating.ts:58-74`, `document-workspace-version-registration.service.ts:152-159`, `apps/api/prisma/schema.prisma:106-109`, `runtime-contract/src/index.ts:2048`, `2849-2867`.

**Orchestrator decision: NO.** Trigger-2 extension list = `.pdf` / `.docx` / `.xlsx` only. No active pptx render/convert path; version-registration currently rejects pptx. Widening to pptx is future work, not ADR-132.

**Q2 — D5 source-markdown persistence seam.**

Anchors: `runtime-document-tool.service.ts:2371-2411`, `2687-2738`, `apps/sandbox/src/workspace-file-bridge.service.ts:470-510`.

**Orchestrator decision:** runtime writes the source markdown using the collision-safe seam (`resolveWorkspaceWritePath()` from ADR-131 Block 1); API-side registration consumes the resulting `sourcePath` via the tool result. Do not move source-path allocation into an API-side registration helper. This matches the existing runtime-persist → API-register split for output files.

**Additional decision (surfaced during audit): visible project layout for authored renders.** ADR-132 collapses the model-facing project surface. Authored source moves from `/workspace/projects/<slug>/render/content.md` to the output sibling `.md`. If any project-manifest layout is retained (e.g. for imported-source extract caching), it becomes runtime-internal and invisible. Slice 1 confirms final shape when it removes the visible project directory from the extract flow.

## Summary

- Sections completed: 1-9.
- File:line anchors cited: 80+.
- Open questions resolved by orchestrator: 2 (pptx = no; D5 seam = runtime writes, API registers).
- Notable finding: active `document.extract` no longer persists visible `render/build.py` / `render/export_pdf.py` (ADR-131 Wave 2 already fixed this). Remaining visible-script surface is metadata/guidance/path helpers + the legacy `.py` entrypoint fallback at `runtime-document-tool.service.ts:2907-2931`. Slice 1 kills those.
- No behavior changes landed in this slice. Ready for Slice 1.
