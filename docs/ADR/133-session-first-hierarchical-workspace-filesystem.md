# ADR-133: Session-first hierarchical workspace filesystem

## Status

Accepted — founder-directed clean filesystem program opened 2026-07-03. Slices 1-5 are landed locally. Slice 5 completed the remaining product-surface closure: the assistant-settings file gallery and public list route now use `session | assistant | workspace` semantics, default to current-session provenance, widen truthfully by hierarchical path roots, and the active web/API/docs fixtures no longer teach flat-root file examples as normal behavior. The ADR remains open only for the parent-orchestrated final end-to-end acceptance gate, deploy, and live validation. Remaining work must stay orchestrated by the parent agent with GPT-5.4/Sonnet implementation subagents.

## Date

2026-07-03

## Baseline SHA

`6c9505eb589bf89f7cd0ac04427753233c65e82a`

## Orchestration model

This ADR is intended for orchestrated execution.

- The parent agent is the orchestrator: owns this ADR, dispatches bounded implementation slices, reviews every diff, verifies invariants, reconciles docs, and decides whether a slice is closure-ready.
- Implementation subagents should use GPT-5.4 or Sonnet unless the orchestrator documents a concrete reason to use another available model.
- Subagents must not broaden scope, weaken tests, or preserve flat-workspace compatibility "for safety".
- Every slice must remove stale filesystem truth from its layer. If a slice introduces or preserves a second model-facing source of truth, the slice is not done.
- If docs and code disagree at slice start, the orchestrator pauses and reconciles before code changes.

## Founder directive

The target is a clean, production-grade filesystem hierarchy, not a metadata-only scope patch and not another local `replace` fix.

The assistant works primarily inside a session directory. Above it is the assistant directory. Above that is the workspace directory. New working files materialize in the session directory by default. When the assistant needs older files from itself or neighboring assistants, it may intentionally widen by using ordinary file tools on the parent directories.

This program exists to make that model true end-to-end:

- no flat `/workspace/<file>` default;
- no `/workspace/chats/<chatId>` pseudo-scope;
- no stale `workspace_shared` / `crossScope:true` model vocabulary;
- no compatibility fallback to old flat paths;
- no TODO scaffolding, no dead prompt copy, no leftover legacy instructions.

## Relationship to prior ADRs

- Supersedes the flat physical namespace decision from ADR-128 for active future filesystem truth. ADR-128 remains the historical clean break from `/shared/<workspaceId>/`, not the current target for session isolation.
- Supersedes ADR-131 Block 2's manifest-only chat/assistant/workspace-shared scoping for the active model-facing filesystem. ADR-131's anti-clobber and document-adjacent lessons remain historical inputs, but this ADR owns the permanent file hierarchy.
- Consumes ADR-132 document mechanics without reopening document architecture. Document render/convert/versioning continue to work through ordinary workspace paths, but those paths now live under the session hierarchy by default.
- Does not reopen ADR-126 or ADR-127. Manifest and GCS remain implementation truth behind the visible filesystem, but their path shape changes to match this ADR.
- Extends ADR-117/130 instruction ownership discipline for file/tool prompts: selection guide, per-tool descriptors, runtime developer blocks, and provider/runtime comments must not carry competing filesystem truths.

## Decision

### D1 — Physical path hierarchy

The canonical visible workspace path hierarchy is:

```text
/workspace/
  assistants/
    <assistantStableKey>/
      sessions/
        <sessionId>/
          ...
      shared/
        ...
  shared/
    ...
```

Definitions:

- `assistantStableKey` is a stable system-owned assistant path key. It must not be a user-facing display name. The implementation slice decides between `Assistant.handle` and an id-derived key, but the chosen key must be stable, path-safe, and unique inside the workspace.
- `sessionId` is the existing runtime/session identifier for the working session. It is not a UI label.
- The session root is the default working directory and default write target.
- The assistant root is the first intentional widen level.
- `/workspace/` is the maximum intentional widen level.

### D2 — Default working behavior

Default behavior after cutover:

- `shell` / `exec` cwd defaults to the current session root.
- `grep` / `glob` without an explicit path search the current session root.
- `files.list` without an explicit wider path lists the current session root.
- `files.write` with a relative/new file intent writes into the current session root.
- API uploads and staged attachments for the active turn land in the current session root.
- runtime-produced artifacts and document outputs default to the current session root unless the model explicitly chooses a valid wider path.
- the Working Files developer block lists current-session files with existing micro-description behavior.

The assistant widens by ordinary path choice, not by a separate model-facing scope vocabulary:

```text
/workspace/assistants/<assistantStableKey>/          # this assistant
/workspace/                                         # whole workspace
```

### D3 — No flat-path compatibility

This is a clean cutover. After the implementation lands:

- active ingress must reject new root-level flat file paths such as `/workspace/report.pdf`;
- active model-facing instructions must not teach `/workspace/<path>` as the ordinary shape;
- active code must not fall back from hierarchical paths to old flat paths;
- old flat GCS/object/manifest truth must be wiped or invalidated as an operational cutover step, not guessed into sessions;
- tests must not preserve old flat examples just to keep snapshots stable.

Historical ADRs, changelog entries, and old migrations may mention flat paths as archive only.

### D4 — Manifest and GCS follow visible path truth

`workspace_file_metadata.path`, chat attachment `storagePath`, document `outputPath`, and GCS object keys must mirror the visible hierarchical path. The primary model-facing selector remains path-based.

The manifest may retain provenance columns such as `originChatId` and `originAssistantId`, and may add session provenance if needed, but provenance is not the model-facing filesystem hierarchy. Path truth must be enough for an operator and the model to understand where a file belongs.

### D5 — Documents remain ordinary files plus document version truth

Document versioning remains separate from filesystem scoping.

- `document.render` / `document.convert` write under the session hierarchy by default.
- D5 sibling Markdown collocation remains next to the rendered output.
- Document identity still resolves server-side by output path.
- Case B shell-produced or uploaded document edits still finalize by `files.attach(path)`.
- No global `/workspace/projects` root remains as the active default. Any document sidecars/projects that still exist must live under the session hierarchy or be deleted as active model-facing concepts.

### D6 — Model-facing instruction ownership

The new filesystem truth must be expressed once per owned layer:

- cross-tool selection and widen behavior: `tools` prompt-template selection guide;
- per-tool mechanics: tool catalog → runtime policy → native projection descriptor path;
- current-session file facts: Working Files developer block;
- executable defaults: shell/exec/grep/glob descriptors and runtime behavior;
- API/UI docs: API boundary and product UI docs.

No layer may keep the old flat `/workspace` model as a fallback explanation.

## Known stale model-facing anchors to remove or rewrite

The read-only audit found these active anchors:

- `apps/api/prisma/bootstrap-preset-data.ts` — `tools` block currently teaches flat `/workspace/<path>`, `scope:"assistant"`, `scope:"workspace_shared"`, and `crossScope:true`.
- `apps/api/prisma/tool-catalog-data.ts` — `files` row teaches "single flat `/workspace/` namespace"; `shell` row teaches `/workspace/chats/<chatId>` cwd and old install paths; `document` row uses root-level examples.
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — `files` schema teaches every file lives directly under `/workspace/<path>`, exposes old scope enums, and documents `crossScope`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts` — Working Files labels current files as `Current chat / this session`.
- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts` — validation/result text teaches `workspace_shared` and `crossScope:true`.
- `packages/runtime-contract/src/index.ts` — `RuntimeFileScopeTier`, flat path comments, outbound comments, and `DOCUMENT_WORKSPACE_PROJECTS_ROOT`.
- Current golden/prompt tests preserve the stale model and must be rewritten as negative guardrails instead of compatibility fixtures.

## Non-goals

- No per-session pod rewrite unless the sandbox implementation audit proves it is required. The default plan may keep one warm pod per assistant/workspace while enforcing session directories as cwd/write roots.
- No content-addressed blob redesign for all files.
- No merge between Files and Knowledge.
- No browser/UI redesign beyond making scopes and file paths honest.
- No new document DSL. Document mechanics remain ADR-132's three-verb surface plus shell.

## Work plan

### Standard gate for every implementation slice

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck`
6. affected package typechecks/tests for sandbox/provider/runtime/API/web as touched
7. stale-string audit for active model-facing code and tests

### Slice 0 — Read-only keep/remove ledger

Subagent: GPT-5.4, read-only.

Produce exact file:line ledgers for:

- path builders and validators to change/delete;
- sandbox hydrate/push/pull/cwd/GC assumptions;
- API upload/stage/delivery/manifest/document path assumptions;
- runtime tool defaults and prompt descriptors;
- web/client/docs/test fixtures;
- stale model-facing strings to delete.

No code changes. Parent reviews and signs off before Slice 1.

### Slice 1 — Path contract and ADR wiring

Create the shared path contract and constants for workspace root, assistant root, and session root. Update docs that must agree before behavior changes. This slice may add tests for pure path construction but must not leave behavior half-migrated.

Landed locally 2026-07-03:

- `packages/runtime-contract/src/index.ts` is the shared owner for hierarchical workspace constants, builders, segment validation/sanitization, visible-path classification, and negative helpers for stale flat roots (`/workspace/<file>`, `/workspace/chats/...`, `/workspace/projects/...`).
- Focused pure tests live in `packages/runtime-contract/test/workspace-path-contract.test.ts`.
- Shared comments were corrected in `packages/runtime-contract` and `packages/runtime-bundle` so stale flat/outbound/project wording is marked historical-only without migrating runtime/API/sandbox behavior yet.
- No sandbox/API/runtime/web default-path behavior changes are part of this slice.

### Slice 2 — Sandbox and GCS cutover

Make the sandbox execute, list, read, write, persist, hydrate, push, pull, and GC against the hierarchical path model.

Required outcomes:

- default cwd is session root;
- GCS workspace object keys mirror hierarchical visible paths;
- root-level flat file writes are rejected on active paths;
- session, assistant, and workspace GC target the correct subtrees;
- no `/workspace/chats`, `/workspace/input`, `/workspace/outbound`, or global `/workspace/projects` active assumptions remain.

Landed locally 2026-07-03:

- `apps/sandbox/src/workspace-path.ts` now wraps the shared ADR-133 builders and derives the default visible root from `assistantHandle` + `runtimeSessionId`.
- `apps/sandbox/src/sandbox.service.ts` now resolves a physical workspace tree plus the current visible session root, defaults `shell` / `exec` cwd and `grep` / `glob` pathing to that root, preserves the hierarchical tree through hydrate/push/pull, and stages render/document-code outputs against the session-root model.
- `apps/sandbox/src/workspace-file-bridge.service.ts` now uses the default visible session root for basename-only writes/control-plane writes and rejects explicit flat root control-plane writes such as `/workspace/report.pdf`; the direct `workspaceFileWrite` path now also denies retired root-flat writes instead of silently accepting them.
- `apps/sandbox/src/sandbox-object-storage.service.ts` now mirrors visible hierarchical workspace paths in persisted GCS object keys.
- `apps/sandbox/src/workspace-gc.service.ts` and `apps/sandbox/src/workspace-audit.service.ts` now report sandbox cleanup in session/assistant/workspace subtree terms while keeping producer lease rows compatible for this slice.
- Focused coverage was updated in `apps/sandbox/test/{sandbox.service.test.ts,workspace-file-bridge.service.test.ts,workspace-gc.service.test.ts}` for session-root defaults, hierarchical object-key mirroring, explicit flat-write rejection, and subtree-targeted GC.

### Slice 3 — API manifest, uploads, delivery, and documents

Make API-owned file creation and delivery use the hierarchy:

- uploads/staged attachments land under session root;
- runtime metadata upserts validate hierarchy;
- manifest list/read/delete/download paths accept the new hierarchy and reject old flat ingress;
- attachment `storagePath` length and schema constraints are updated if needed;
- document inspect/render/convert/version registration paths live under the hierarchy;
- operational cutover/wipe plan is documented.

Landed locally 2026-07-03:

- API-owned upload/stage/inbound/delivery/document storage paths now resolve under `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/...`, and active ingress rejects retired flat root file paths.
- Active API listing/download/delete/document guards now use hierarchical path validation, and the public gallery/list surface is closed on `session | assistant | workspace` semantics instead of the retired public `chat | workspace` split.
- Document extraction/inspection/version-registration tests and link metadata now use hierarchical session-root project layouts; default project derivation no longer falls back to a global `/workspace/projects` root for active sources.
- Prisma/API/sandbox GC lease vocabulary is synchronized on `session_subtree | assistant_subtree | workspace_subtree`, with migration `20260703132500_adr133_slice3_gc_lease_kind_rename`.

### Slice 4 — Runtime tools and model instructions

Update runtime behavior and all model-facing instructions together:

- `files`, `shell`, `exec`, `grep`, `glob`, `document`;
- Working Files developer section;
- `bootstrap-preset-data.ts`;
- `tool-catalog-data.ts`;
- `native-tool-projection.ts`;
- runtime contract comments/constants that feed tests or prompt truth;
- golden snapshot and prompt guard tests.

This slice must remove the old scope vocabulary from active model-facing surfaces.

Landed locally 2026-07-03:

- Runtime `files` / `document` path defaults, tool wording, and active result/developer surfaces now teach the session-root hierarchy `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/...`, with assistant/workspace widening only by ordinary path choice.
- The Working Files developer block now reports current session files, preserves sticky labels and micro-descriptions, and no longer teaches the retired `Current chat / this session` framing.
- `apps/api/prisma/bootstrap-preset-data.ts`, `apps/api/prisma/tool-catalog-data.ts`, and `apps/runtime/src/modules/turns/native-tool-projection.ts` now agree on the hierarchical prompt truth and carry negative guard tests against stale `workspace_shared` / `crossScope:true` / flat-path wording.
- Runtime contracts/tests were updated so positive fixtures use hierarchical session-root or explicit widen paths only, and active runtime `files.write` compatibility for legacy `mode:"overwrite"` was removed instead of preserved as a model-visible shim.
- The ADR batch’s prior sandbox lint blocker in `apps/sandbox/src/sandbox.service.ts` was fixed with the minimal dead-code removal required for acceptance.

### Slice 5 — Web, OpenAPI, docs, and closure

Align product UI and docs:

- file API contract/OpenAPI coverage for list/download/preview/delete if still missing;
- web gallery scopes and translations;
- web/API/runtime/sandbox fixtures;
- `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md`, `CHANGELOG.md`, `SESSION-HANDOFF.md`, and `AGENTS.md`.

Landed locally 2026-07-03:

- Assistant Settings Files now labels the gallery widens as `Current session`, `This assistant`, and `Workspace`, defaults to current-session provenance when an active web chat is open, and falls back to assistant-wide scope instead of a misleading workspace-wide default when only a latest-chat anchor is available.
- The public web gallery list route now accepts `scope=session|assistant|workspace` and scopes rows by the real hierarchical session/assistant/workspace roots instead of the older `chat | workspace` split.
- Active web/API test fixtures were updated so positive examples use hierarchical session-root paths for file cards, gallery tiles, delete flows, delivery metadata, and discovered-file facts; remaining flat-root references in active tests/docs are explicit negative guards or historical records only.
- `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md`, `CHANGELOG.md`, `SESSION-HANDOFF.md`, and `AGENTS.md` now describe Slice 5 as landed locally while keeping the ADR open until the final full gate and live acceptance complete.

## Acceptance criteria

This ADR is not closure-ready until all are true:

1. A new upload in a live web chat lands under `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/...`.
2. `files.write`, generated media outputs, shell-produced files, and document outputs land under the same session root by default.
3. `shell`, `exec`, `grep`, and `glob` default to the session root.
4. The assistant can intentionally widen to its assistant root and then to `/workspace/` with ordinary file paths.
5. Two sessions can create same-name files without collisions or model confusion.
6. Working Files shows only current-session files by default, with micro-descriptions preserved.
7. Document render/convert, sibling Markdown, attach, and version download links work under hierarchical paths.
8. Root-level flat paths such as `/workspace/report.pdf` are not accepted on active creation paths.
9. No active model-facing prompt, descriptor, developer block, runtime result, contract comment used by prompt tests, or golden snapshot teaches:
   - `single flat /workspace`;
   - `/workspace/<path>`;
   - `/workspace/chats`;
   - `/workspace/projects`;
   - `/workspace/input`;
   - `/workspace/outbound`;
   - `workspace_shared`;
   - `crossScope:true`.
10. Docs match code and mark ADR-128/131 flat or manifest-only filesystem truth as historical, not active target state.

## Next recommended step

Run an independent cleanliness audit, then the full gate, reconcile with `origin/main`, push/deploy, and finish live validation for the locally landed Slices 1-5.
