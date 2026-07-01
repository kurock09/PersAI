# ADR-131: Workspace file identity, isolation, and safe delivery

## Status

Open — problem statement plus candidate directions. No implementation is proposed here. Original scope was cross-turn delivery safety for the document tool only; broadened on 2026-07-01 after founder review because the underlying causes (mutable-path identity, absent visibility scope) affect every file the model touches, not only documents.

## Date

2026-07-01 (opened, doc-only). 2026-07-01 (broadened to full workspace file identity, isolation, and safe delivery).

## Purpose

`ADR-128` collapsed the sandbox workspace to a single flat `/workspace/` namespace and made file identity a bare tuple `(workspaceId, path)`. `ADR-129` gave the document flow a visible, structurally honest lifecycle. Live PROD validation on 2026-07-01 uncovered a class of failures that these two ADRs do not close and that span every model-touched file, not only documents:

- **Byte identity is not stable.** Any write to an existing path silently replaces the bytes that previously delivered messages, gallery tiles, and mobile-share previews point to.
- **Visibility is not scoped.** The model sees the entire workspace as one bag through `files.list` / `files.read` / `files.preview` / `files.attach`, so files from unrelated chats and other assistants pollute the current session.
- **Cross-turn delivery is not guarded.** Inside a single chat, a stale project directory from a prior turn can end up as the source of the current attach.

Any one of these being present is a P0 correctness risk in PROD — from silent data loss (Block 1) to wrong-file share on mobile (Block 1) to model confusing another chat's file for the current one (Block 2) to `files.attach` delivering placeholder bytes from a stale directory (Block 3).

The auto-register-on-render addendum to `ADR-129` (2026-07-01) closed the "PDF vs Office" `v1` badge asymmetry and removed the model-owned `document.register_version` step from the standard render → attach flow. The same addendum also added `suggestedNextActions` to `document.extract`, which partially mitigates Problem F in Block 3 by handing the model the exact next call to run. It does not close Problem F (the hint is still overridable), and it does not address Blocks 1 or 2 or the rest of Block 3.

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

### Candidate direction (chosen: Variant A — vendor-standard collision behavior)

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

### Candidate direction (proposed: three explicit scope tiers, manifest-backed)

**Status of this candidate.** Anti-clobber (Block 1) has a founder-confirmed base (Variant A). Scope tiering here does not yet — it is the parent-orchestrator's proposal, drafted directly from the founder's problem framing ("модель путает файлы: сначала файлы чата, потом ассистента on-demand, потом workspace shared on-demand"). Confirmation that chat is the correct default (versus, e.g., assistant-scope default) is one of the decisions still pending below.

No physical migration required — `/workspace/` stays flat per `ADR-128`. Scope is a thin logical layer on top of the existing manifest columns:

1. **Chat scope (proposed default).** `files.list` / `files.read` / `files.preview` / `files.attach` operate on files where `originChatId === currentChatId`, plus files written by the current turn itself. This is what the Working Files block already reflects; the proposal is to extend it to the whole `files.*` action set.
2. **Assistant scope (on-demand widen).** Model calls `files.list({ scope: "assistant" })` (or equivalent shape TBD in the implementation ADR). Widens the visible set to any file where `originAssistantId === currentAssistantId`. Prompt teaches this is the correct move when the user asks for "что-то из моих прошлых чатов" and the current chat does not contain it.
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

**Why (partially addressed by ADR-129 addendum 2026-07-01).** Before the addendum, extract returned only file paths and no explicit "do this next" instruction. The addendum now returns `suggestedNextActions` with the exact `document.render(format=pdf, projectPath, outputPath)` call, and the guidance now says to follow it verbatim. This is a strong hint, but it is still a hint — the model can override it. In particular, if the model is following a scenario-driven persona and the persona's steps say "read the source and reformat it", the model can still pick that path over the suggested action.

**Impact.** Quality of imported-Office → PDF output degrades to "hand-assembled from partial reads" when the model is coaxed off the canonical path.

### Problem G — `shell` `stdout_limit_exceeded` on large document dumps

**What was observed.** During the same test, the model tried to dump the full DOCX body via `shell` (Python one-liner). The dump exceeded the sandbox `shell` stdout buffer (approximately 131 KB) and returned `stdout_limit_exceeded`. This made every attempt to "just read the file" via `shell` fail hard, without a clear alternative surface.

**Why.** `shell` is the only tool with an obvious "dump the whole file" affordance. `files.read` has a chunked interface that the model uses less naturally.

**Impact.** Model wastes turns and tokens on shell attempts that structurally cannot succeed, then falls back to progressively worse workarounds (see Problem F).

### Candidate directions per problem

For **Problem E**:

- Per-turn project slug: `document.extract` always allocates a fresh `/workspace/projects/<slug>-<turn-id>/` and never reuses an existing project directory from a prior turn. Naturally implied by Block 1 (Variant A collision behavior) when `document.extract` writes into an already-populated project path.
- Attach freshness guard: `files.attach` on a document project output requires either that the file's last write happened in the current turn or that the model passes an explicit "re-attach existing" flag.
- Turn-scoped clean slate: any `/workspace/projects/<slug>/` that was not touched by the current turn's own `document.extract` / `files.write` cannot be a `document.render` `projectPath`.

For **Problem F**:

- Runtime-enforced routing for `document.render(format=pdf)` on an imported DOCX/XLSX project: the runtime picks the seeded `export_pdf.py` entrypoint automatically and rejects model-supplied entrypoints that read the source through a non-LibreOffice path.
- Prompt-level enforcement: strengthen the `suggestedNextActions` guidance to "must follow when present".
- Both, with runtime enforcement as the hard guarantee.

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

- **Anti-clobber base:** Variant A (macOS-style ` (N)` collision + explicit `replace: true` for overwrite). Content-addressed Variant B is not the baseline.
- **This ADR is the umbrella.** Original E / F / G stay inside; anti-clobber and scope-tier work do not spin off into separate ADRs.

## Decisions still required from the founder before implementation

1. **Default scope tier for Block 2.** Parent-orchestrator proposal: chat. Founder framed the problem as "chat first, assistant on-demand, workspace-shared on-demand" but has not literally confirmed chat as the default versus, e.g., assistant-scope default with an explicit `scope: "chat"` narrow. Needs founder sign-off before implementation.
2. Priority order across blocks. Recommendation: Block 1 first (data integrity — clobber and share mismatch), Block 2 second (visibility — model confusion across chats), Block 3 as specialisations that partially fall out of Block 1 and Block 2.
3. Exact shape of the widening `files.list({ scope })` contract, plus the shape of the anti-clobber `replace` flag on `files.write`, `document.render`, and control-plane writes.
4. Whether Problem F fix is prompt-only or runtime-enforced.

Once decided, this ADR is converted into an implementation ADR or superseded by a new numbered ADR that implements the chosen design.

## Consequences

- Not fixing Block 1 leaves silent data loss on `files.write` / `shell` / `document.render` and leaves the wrong-file mobile-share class in PROD.
- Not fixing Block 2 leaves the model confusing cross-chat and cross-assistant files as if they belong to the current session.
- Not fixing Block 3 leaves `files.attach` capable of delivering placeholder bytes from a stale directory.

## References

- `ADR-126`, `ADR-127`, `ADR-128` — workspace path identity, manifest source of truth, single-namespace retirement of `/shared/<wsid>/`.
- `ADR-129` — visible-workspace document lifecycle for PDF / DOCX / XLSX (and 2026-07-01 addendum: auto-register on render + extract `nextAction`).
- `ADR-123` — native sandbox runtime isolation, network, and document execution.
