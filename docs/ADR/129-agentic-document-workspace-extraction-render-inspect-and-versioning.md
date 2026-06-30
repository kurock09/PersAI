# ADR-129: Production document workspace for PDF, DOCX, and XLSX

## Status

Open. The repo contains a partial local implementation of the new document system, but the production closure is not complete yet.

## Date

2026-06-29

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
