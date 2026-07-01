# ADR-131: Workspace file identity, isolation, and safe delivery

## Status

Accepted — all founder-decision points closed on 2026-07-01. Implementation proceeds in three ordered slices (Block 1 → Block 2 → Block 3). Slice 1 (Block 1 anti-clobber Variant A) landed locally on 2026-07-01 and awaits push/deploy. Original scope was cross-turn delivery safety for the document tool only; broadened on 2026-07-01 after founder review because the underlying causes (mutable-path identity, absent visibility scope) affect every file the model touches, not only documents.

## Date

2026-07-01 (opened, doc-only). 2026-07-01 (broadened to full workspace file identity, isolation, and safe delivery). 2026-07-01 (founder-closed all four remaining decision points; implementation-ordered). 2026-07-01 (Slice 1 landed locally: Block 1 anti-clobber Variant A).

## Purpose

`ADR-128` collapsed the sandbox workspace to a single flat `/workspace/` namespace and made file identity a bare tuple `(workspaceId, path)`. `ADR-129` gave the document flow a visible, structurally honest lifecycle. Live PROD validation on 2026-07-01 uncovered a class of failures that these two ADRs do not close and that span every model-touched file, not only documents:

- **Byte identity is not stable.** Any write to an existing path silently replaces the bytes that previously delivered messages, gallery tiles, and mobile-share previews point to.
- **Visibility is not scoped.** The model sees the entire workspace as one bag through `files.list` / `files.read` / `files.preview` / `files.attach`, so files from unrelated chats and other assistants pollute the current session.
- **Cross-turn delivery is not guarded.** Inside a single chat, a stale project directory from a prior turn can end up as the source of the current attach.

Any one of these being present is a P0 correctness risk in PROD — from silent data loss (Block 1) to wrong-file share on mobile (Block 1) to model confusing another chat's file for the current one (Block 2) to `files.attach` delivering placeholder bytes from a stale directory (Block 3).

Two prior landings close most of Block 3 Problem F already: (a) the 2026-06-30 `document.render(format=pdf)` change that architecturally restricts imported DOCX/XLSX renders to the seeded LibreOffice `export_pdf.py` entrypoint (no model-supplied non-canonical entrypoint accepted inside `document.render`), and (b) the 2026-07-01 auto-register-on-render addendum that also added `suggestedNextActions` to `document.extract` handing the model the exact next call to run. What remains of Problem F is only the pathological path where the model skips `document.render` entirely and hand-assembles a PDF via `shell` + `weasyprint`; that residual is closed by prompt reinforcement ("must follow `suggestedNextActions` when present"), not by runtime heuristics on `shell`. Blocks 1 and 2 and Problems E and G are still open work.

## What "safe workspace" must mean

Three invariants must hold at PROD closure:

1. **Stable identity.** A file the user saw in message N is the file they get when they open, download, or share it later — regardless of what any actor wrote to the same path afterwards.
2. **Scoped visibility.** The model's default view of `/workspace/` is the current chat session. Files from other chats, other assistants, or workspace-shared surfaces exist but must be requested explicitly by the model, not shown by default.
3. **Truthful delivery.** A file "delivered" in turn N must be a file the model actually produced or deliberately re-attached in turn N, never a leftover from an unrelated earlier turn or chat.

## Block 1 — Anti-clobber and stable byte identity

### Problem

Every write path treats "same name" as "replace bytes":

- **Model `files.write`.** Default `mode: "overwrite"`; the model-facing description in `apps/runtime/src/modules/turns/native-tool-projection.ts` literally teaches "creates or overwrites" and "to edit an uploaded file, write to its exact listed path".
- **`shell` / `exec` from the model.** No policy layer over the sandbox filesystem. Any Python or bash write to a fixed name (`report.docx`, `main.pdf`) clobbers whatever was there.
- **`document.render` `outputPath`.** `apps/runtime/src/modules/turns/runtime-document-tool.service.ts::executeRenderToolCall` checks only that the entrypoint file is not the output path; it does not check that the output path is already occupied by a prior delivered version or by a user upload.
- **Control-plane writes.** `apps/sandbox/src/workspace-file-bridge.service.ts::workspaceFileWrite` defaults to `mode: "overwrite"`; `writeWorkspaceFileControlPlane`'s explicit-path branch always writes with overwrite semantics. Callers may guard upstream (`document.extract` does), but the primitive itself is unconditional.

### Impact

File identity in this codebase is `(workspaceId, path)` (see `docs/DATA-MODEL.md` §Sandbox and assistant workspace state). No content hash, no immutable blob id, no snapshot marker is stored on `AssistantChatMessageAttachment` or on `workspace_file_metadata`. As a result, once bytes at a path are replaced, every historical reference to that path — chat message attachment, gallery tile, mobile share sheet, workspace-file gallery — silently starts serving the new bytes.

Live evidence:

- **Wrong-file mobile share.** User taps share on a chat attachment. Preview renders through `GET /api/v1/assistant/workspaces/:wsId/files/preview?path=...` with `Cache-Control: private, max-age=3600` (`apps/api/src/modules/workspace-management/interface/http/media-attachment.controller.ts:455`); download goes through the same-shaped URL freshly to GCS. If any actor overwrote the underlying object between the preview cache and the share fetch (or between share fetch and preview refresh), the preview and the shared bytes disagree. The user sees one file and sends another; support cannot tell them why.
- **Historic attachment mutation.** A user upload of `report.pdf` sits at `/workspace/report.pdf`. Later, the model or a `shell` script writes to the same path. The user's original chat message attachment row still declares `storagePath = /workspace/report.pdf`, but opening it returns the new bytes. History has silently mutated.

### Direction (founder-confirmed: Variant A — vendor-standard collision behavior with `replace: true` boolean opt-in)

- Every model-visible and control-plane write defaults to macOS-Finder / Google-Drive style behavior: **if the target path already exists, resolve to a new sibling name (` (1)`, ` (2)`, …)**. `apps/sandbox/src/workspace-file-bridge.service.ts::writeWorkspaceFileWithCollision` and `apps/runtime/src/modules/turns/write-runtime-outbound-artifact.ts` already do this for user uploads and generated media; the same policy extends to `files.write`, to `document.render` `outputPath`, and to any control-plane explicit-path write. This is one rule, applied uniformly — no path refuses a write purely because a file already exists at that name; it just resolves the name.
- Overwrite becomes an explicit action: the model must pass an explicit `replace: true` (or equivalent named flag) together with the exact existing path. Prompt teaches that replace is a deliberate destructive action, not a shortcut for "save my new file". `document.render` and control-plane writes accept the same `replace: true` opt-in for the same reason.
- `shell` / `exec` cannot be guarded at the shell level. The prompt stops teaching "just write to the existing name" and the doc-render seeded entrypoints are updated to allocate fresh output filenames per invocation.

### Variant B (deferred, not the base)

Content-addressed blob store: attachments and gallery rows carry an immutable `storageContentHash`; canonical GCS layout adds `fs/blobs/<hash>` and `path` becomes an operational alias resolved through the manifest. This is the correct long-term move — it makes historical references immune even to intentional overwrites — but it is broader than what baseline correctness requires and is deferred to a dedicated ADR if Variant A proves insufficient in live tests.

## Block 2 — Scope tiers and default visibility

### Problem

The `Working Files` developer-block that the runtime pushes each turn is already chat-scoped (`apps/runtime/src/modules/turns/turn-execution.service.ts::buildWorkingFilesDeveloperSection` filters by `scopeTier === "chat"`). That is good and stays.

The model-visible `files.*` tool surface is not scoped:

- **`files.list`.** `apps/runtime/src/modules/turns/runtime-files-tool.service.ts::executeListFromManifest` calls the API manifest with `{ workspaceId, pathPrefix, assistantHandle }` — no `chatId`. The model receives every file in the workspace, from every chat and every assistant.
- **`files.read` / `files.preview` / `files.attach`.** Address a file only by pod-absolute `/workspace/...` path. No scope check is performed. The model can read, preview, and attach any file in the workspace regardless of which chat or which assistant produced it.

The manifest already carries the columns needed for scope: `workspace_file_metadata.originChatId` and `originAssistantId` exist and are populated on writes and uploads. Only the model-facing tool surface fails to consult them.

### Impact

The model repeatedly confuses files across chats, especially when names repeat: a `report.pdf` from a prior test in another chat becomes indistinguishable from the current chat's `report.pdf` in the `files.list` output, and the model may `files.read` / `files.attach` the wrong one. This is the "модель путает файлы" symptom that motivated broadening this ADR.

### Direction (founder-confirmed: three explicit scope tiers, manifest-backed, chat as default)

No physical migration required — `/workspace/` stays flat per `ADR-128`. Scope is a thin logical layer on top of the existing manifest columns:

1. **Chat scope (default).** `files.list` / `files.read` / `files.preview` / `files.attach` operate on files where `originChatId === currentChatId`, plus files written by the current turn itself. This is what the Working Files block already reflects; the change extends it to the whole `files.*` action set.
2. **Assistant scope (on-demand widen).** Model calls `files.list({ scope: "assistant" })` (or equivalent shape TBD in the implementation slice). Widens the visible set to any file where `originAssistantId === currentAssistantId`. Prompt teaches this is the correct move when the user asks for "что-то из моих прошлых чатов" and the current chat does not contain it.
3. **Workspace-shared scope (further widen).** `files.list({ scope: "workspace_shared" })` widens further to files owned by other assistants of the same workspace (assistant-A wrote it, assistant-B needs it). Prompt teaches this is the last-resort widen.

Cross-scope reads / previews / attaches (touching a file outside the current scope) require the model to either widen `files.list` first (surface it explicitly) or pass a `crossScope: true` marker together with the concrete path. The prompt teaches the model that cross-scope operations are the exceptional path and should be explained to the user.

### Optional physical layout (not required)

A physical `/workspace/chats/<chatId>/...` subtree would harden isolation and remove the possibility of stale-project cross-turn pollution (Block 3 Problem E) at the filesystem level. This ADR intentionally does **not** propose it — it partially reverses `ADR-128`'s flat-namespace decision — and instead keeps scope in the manifest layer. A later slice may reconsider if manifest-only scoping proves insufficient in live tests.

## Block 3 — Cross-turn delivery safety (Problems E, F, G)

This block is the original narrow ADR-131 scope. It is preserved because the evidence is still current, but each problem is now positioned as a specialisation of Block 1 or Block 2.

### Problem E — Cross-turn workspace pollution → wrong-file attachment

**What was observed.** In the 25-step DOCX → PDF live test in the browser session, the model was asked to convert an attached DOCX to PDF. During the turn the model wrote a small placeholder HTML file to `/workspace/report/` (a directory left over from a completely unrelated previous test in the same chat), rendered a small placeholder PDF there via `weasyprint`, and then called `files.attach` on that placeholder PDF instead of the file it was supposed to produce. The final delivered PDF was a few hundred bytes of placeholder content, not the converted DOCX.

**Why.** The workspace is flat and single-namespace (`/workspace/...`). `/workspace/report/`, `/workspace/projects/<slug>/`, and any other project directory persists across turns in the same chat. When the model chooses a project path from imagination or from partial memory, it can pick a directory that already contains stale files from a different task, and every downstream action (`files.write`, `document.render`, `files.attach`) operates on that stale directory.

**Impact.** Highest-severity data-integrity issue in the document path — the user is silently handed a wrong file. Overlaps with Block 1 (attach delivers bytes from a path the model did not author this turn) and Block 2 (a chat-scoped default view would not surface unrelated directories in the first place).

### Problem F — Model bypasses the seeded `export_pdf.py` for imported Office → PDF

**What was observed.** In the same 25-step DOCX → PDF test, `document.extract` correctly created `/workspace/projects/<slug>/render/export_pdf.py` seeded with the LibreOffice conversion. The model ignored that entrypoint and instead spent multiple turns reading the DOCX text via `files.read`, assembling HTML from what it managed to read, and calling `weasyprint`. The result was a low-quality, structurally degraded PDF unrelated to the original DOCX layout.

**Why.** Two independent affordances let the model skip the seeded exporter: (a) before 2026-06-30, `document.render(format=pdf)` accepted model-supplied entrypoints for imported Office projects, so the model could re-route the render internally; (b) at any time, the model can skip `document.render` entirely and call `shell` with a python one-liner that writes a PDF via `weasyprint` and then `files.attach` it directly.

**Status (closed on 2026-07-01).** Path (a) is closed architecturally: the 2026-06-30 `document.render(format=pdf)` change restricts imported DOCX/XLSX to the seeded LibreOffice `export_pdf.py` entrypoint, and the extracted-text → HTML fallback is blocked for imported Office → PDF. Path (b) is closed by the 2026-07-01 `suggestedNextActions` addendum on `document.extract` plus prompt reinforcement teaching the model that `suggestedNextActions` must be followed when present. No runtime heuristic over `shell` is introduced (deliberate — that would be a costly guess).

**Impact (if reopened).** Quality of imported-Office → PDF output would again degrade to "hand-assembled from partial reads" when the model is coaxed off the canonical path.

### Problem G — `shell` `stdout_limit_exceeded` on large document dumps

**What was observed.** During the same test, the model tried to dump the full DOCX body via `shell` (Python one-liner). The dump exceeded the sandbox `shell` stdout buffer (approximately 131 KB) and returned `stdout_limit_exceeded`. This made every attempt to "just read the file" via `shell` fail hard, without a clear alternative surface.

**Why.** `shell` is the only tool with an obvious "dump the whole file" affordance. `files.read` has a chunked interface that the model uses less naturally.

**Impact.** Model wastes turns and tokens on shell attempts that structurally cannot succeed, then falls back to progressively worse workarounds (see Problem F).

### Candidate directions per problem

For **Problem E**:

- Per-turn project slug: `document.extract` always allocates a fresh `/workspace/projects/<slug>-<turn-id>/` and never reuses an existing project directory from a prior turn. Naturally implied by Block 1 (Variant A collision behavior) when `document.extract` writes into an already-populated project path.
- Attach freshness guard: `files.attach` on a document project output requires either that the file's last write happened in the current turn or that the model passes an explicit "re-attach existing" flag.
- Turn-scoped clean slate: any `/workspace/projects/<slug>/` that was not touched by the current turn's own `document.extract` / `files.write` cannot be a `document.render` `projectPath`.

For **Problem F** (closed on 2026-07-01):

- Runtime already restricts `document.render(format=pdf)` on imported DOCX/XLSX to the seeded `export_pdf.py` entrypoint (2026-06-30). No further runtime work needed inside `document.render`.
- `document.extract` returns `suggestedNextActions` with the exact next call for imported Office → PDF (2026-07-01 addendum).
- Prompt reinforcement (part of the next prompt update slice, not a fresh runtime slice): "when `suggestedNextActions` is present in the previous tool result, follow it verbatim; do not hand-assemble outputs via `shell` + `weasyprint`."
- No runtime heuristic guarding `shell` for "looks like a PDF write" — explicitly rejected as a costly guess. The `shell` bypass is closed at the prompt boundary or not at all.

For **Problem G**:

- Prompt guidance: "for documents over 32 KB, use `files.read` with `offset`/`limit`, never `shell`".
- Optional small dedicated `document.read_text` action returning bounded excerpts from `extract/extracted.md`.
- No changes to `shell` stdout limits.

## Interaction between blocks

- **Block 1** fixes what "the file" means — bytes stay bound to the message that delivered them.
- **Block 2** fixes what the model sees by default — narrows to the current chat, widens only on explicit action.
- **Block 3** fixes what the model touches inside a turn — project isolation, canonical entrypoint routing, chunked read.

Fixing only Block 1 leaves the model confused about which file to touch. Fixing only Block 2 leaves silent clobber and mobile-share mismatch. Fixing only Block 3 remains a doc-only patch that does not cover generic `files.write` or `share` mismatch. All three blocks must land for closure.

## Non-goals

- Not reversing `ADR-128`'s flat single-namespace decision. `/workspace/` stays flat physically; scope is a manifest-layer overlay.
- Not introducing versioned blobs or content-hash identity in this ADR (Variant B is a separate later ADR if needed).
- Not changing GCS layout (`fs/workspaces/<wsid>/workspace/...`).
- Not merging Files with the Knowledge plane.
- Not raising sandbox `shell` stdout limits (Problem G is closed with prompt / new action, not by loosening the cap).
- Not re-opening `ADR-126` / `ADR-127`.

## Decisions confirmed by the founder

All five decisions below are founder-confirmed as of 2026-07-01. This ADR is now the implementation contract; no further founder decisions are needed before slice work begins.

- **This ADR is the umbrella.** Original E / F / G stay inside; anti-clobber and scope-tier work do not spin off into separate ADRs.
- **Anti-clobber base:** Variant A (macOS-Finder / Google-Drive style ` (N)` collision by default, plus explicit `replace: true` boolean opt-in for deliberate overwrite). Applied uniformly on `files.write`, `document.render` `outputPath`, and control-plane explicit-path writes. Content-addressed Variant B is deferred to a later ADR only if Variant A proves insufficient in live tests.
- **Anti-clobber overwrite-contract shape:** boolean `replace: true` on `files.write`, `document.render`, and control-plane writes. No enum modes, no `existingPath` double-confirmation, no removal of `replace` (bare `(N)`-collision alone is not enough because the model does legitimately need to publish a new version of a delivered file — that path uses `replace: true`).
- **Block 2 default scope tier:** `chat`. Widening to `assistant` and `workspace_shared` is on-demand only, requested by the model per action. The shape of the widen argument (`scope: "chat" | "assistant" | "workspace_shared"` on `files.list` plus a `crossScope: true` marker on cross-scope reads / previews / attaches) is the parent-orchestrator design and enters the implementation slice as-is unless a slice-time obstacle appears.
- **Implementation slice order:** Block 1 → Block 2 → Block 3. Data integrity first (anti-clobber + mobile-share correctness), then visibility (model confusion across chats), then Block 3 specialisations. Problem F in Block 3 is already closed on 2026-07-01 by the existing seeded-exporter enforcement in `document.render` plus `suggestedNextActions` from `document.extract` plus prompt reinforcement; only Problem E and Problem G remain live inside Block 3.

## Implementation plan (no further decisions required)

Slice 1 — Block 1 anti-clobber Variant A. Introduce `(N)`-collision as default on `files.write`, `document.render`, and control-plane explicit-path writes. Add `replace: true` boolean opt-in on the same three surfaces. Update model-facing tool description in `native-tool-projection.ts` to teach: default is auto-suffix collision, `replace: true` is a deliberate destructive action. Update `document.render` `outputPath` handling in `runtime-document-tool.service.ts` and control-plane writes in `workspace-file-bridge.service.ts`. Deliver in one focused slice.

Slice 2 — Block 2 chat-scoped `files.*`. Extend `runtime-files-tool.service.ts::executeListFromManifest` and the read/preview/attach paths to consult `workspace_file_metadata.originChatId` under the chat-scope default; add the `scope` argument on `files.list` and the `crossScope: true` marker on the other actions. Update model-facing tool description accordingly. Deliver in one focused slice.

Slice 3 — Block 3 residuals (Problem E + Problem G). Problem E: per-turn project slug allocation in `document.extract` plus attach-freshness guard in `files.attach` for document project outputs. Problem G: prompt guidance for large-document reads via chunked `files.read`, and — if evidence recurs — a small dedicated `document.read_text` bounded-excerpt action. Deliver together as one focused slice, since both are prompt-heavy plus a single small runtime surface.

The prompt reinforcement of `suggestedNextActions` for Problem F is folded into Slice 3 (or the next prompt-owner slice, whichever lands first), not a separate slice.

## Implementation progress

### 2026-07-01 — Slice 1: Block 1 anti-clobber Variant A (landed locally)

Status: implemented locally after the ADR-131 founder-closure push and awaiting push/deploy. Scope stayed inside Block 1.

- `files.write` defaults to collision-safe sibling allocation when the requested path already exists. The returned `path` / `resolvedPath` is the actual path written, and manifest upsert uses that resolved path.
- `document.render` resolves occupied `outputPath` values to sibling ` (N)` names before rendering, persists the rendered file at the resolved path, and auto-registers the resolved path rather than the originally requested path.
- Control-plane explicit-path writes route through the same collision-aware writer and return the resolved path.
- Boolean `replace: true` is the explicit exact-overwrite opt-in on `files.write`, `document.render`, and control-plane writes. Legacy `mode: "overwrite"` is accepted as compatibility and maps to exact overwrite; `mode: "create_only"` still fails on exact collision.
- Model-facing guidance, tool catalog guidance, runtime contract, and tests were updated so production policy and runtime fallback teach the same rule: default preserves earlier deliveries, `replace: true` is destructive and must be user-requested.
- No Block 2 chat-scope implementation and no Block 3 residual implementation landed in this slice.

Verification: GPT-5.4 read-only audit found one blocker (stale API catalog `document` guidance); fixed and re-audited as resolved. Focused tests passed for `@persai/runtime`, `@persai/sandbox`, and `@persai/api`; full AGENTS gate passed after the blocker fix.

## Consequences

- Not fixing Block 1 leaves silent data loss on `files.write` / `shell` / `document.render` and leaves the wrong-file mobile-share class in PROD.
- Not fixing Block 2 leaves the model confusing cross-chat and cross-assistant files as if they belong to the current session.
- Not fixing Block 3 leaves `files.attach` capable of delivering placeholder bytes from a stale directory.

## References

- `ADR-126`, `ADR-127`, `ADR-128` — workspace path identity, manifest source of truth, single-namespace retirement of `/shared/<wsid>/`.
- `ADR-129` — visible-workspace document lifecycle for PDF / DOCX / XLSX (and 2026-07-01 addendum: auto-register on render + extract `nextAction`).
- `ADR-123` — native sandbox runtime isolation, network, and document execution.
