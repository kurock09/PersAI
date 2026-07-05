# ADR-137: Execution pod boundary and storage-plane cutover

## Status

**Opened 2026-07-05** — parent-orchestrated program. **S0 + S1 + S2 + S3 + S4 + S5 + S5.1 + shell/exec storage seam repair landed locally**; **S6 grep gate PASS** (2026-07-05 independent audit); **program closes after deploy + live smoke** on `persai-dev`.

## Date

2026-07-05

## Baseline SHA

`a50ef764` — recorded in `docs/SESSION-HANDOFF.md` at program start (tree was dirty: S0 + unrelated slices mixed).

## Founder-locked decisions (audit checklist)

| # | Decision | Locked answer |
|---|----------|---------------|
| 1 | **Pod purpose** | Pod is an **execution surface only** — arbitrary code / document toolchain in the sandbox image. Not a blob ingress router. |
| 2 | **Pod-required tools** | `shell`, `exec`, `document.inspect`, `document.render`, `document.convert` only. |
| 3 | **Storage-plane tools** | `files.*` (all actions), model-facing `grep` / `glob`, and **all provider worker outbound bytes** use **GCS + `workspace_file_metadata` (+ internal API)** — **no session pod** for correctness. |
| 4 | **Path identity** | Unchanged ADR-128/133: `/workspace/assistants/<assistantId>/sessions/<sessionId>/...` is the only visible session path vocabulary. This ADR does **not** reopen flat-root or `/shared/<wsid>/`. |
| 5 | **Bytes authority** | GCS via `buildWorkspaceObjectKey(workspaceId, workspaceRelPath)` — same as ADR-127 D2. |
| 6 | **Index authority** | `workspace_file_metadata` — same as ADR-127 D1. Pod FS is **cache** for in-flight exec only. |
| 7 | **Worker media** | `image_generate`, `image_edit`, `tts`, `video_generate` persist via runtime `PersaiMediaObjectStorageService.saveObject` — **never** `sandbox workspace-write`. |
| 8 | **Gamma presentations** | Provider PDF/PPTX bytes are **worker outbound**, same as video — GCS-direct; **not** `writeRuntimeOutboundArtifactViaSandbox`. |
| 9 | **`rg` / `fd` in image** | Stay on PATH in sandbox image for **in-pod** `shell` scripts and document jobs. Model tools `grep` / `glob` **do not** dispatch standalone sandbox jobs. |
| 10 | **Grep semantics** | Model `grep` must search **committed file bytes** (GCS/manifest-visible paths). Mid-exec pod-only scratch files are **out of scope** for model `grep`; use `shell` if live FS search is required during a script. |
| 11 | **No parallel write paths** | After cutover: **one** runtime write seam for non-exec bytes (`writeRuntimeOutboundArtifact` + shared files-write service). No runtime → sandbox HTTP for model-visible file bytes. |
| 12 | **No shims** | No `// W3-shim`, no dual code paths “until later”, no feature flags. Slice lands complete behavior or does not land. |
| 13 | **Closure** | Program closes only after **S6 independent audit** passes with **zero** forbidden grep matches and dead code removed. |

### Explicitly rejected (do not reintroduce)

- “Single write owner = sandbox” for **provider blobs** or **model `files.write`** (ADR-126 W3.2 overreach — see Context).
- Raising session pod for avatar/video/image/tts delivery, Gamma outbound, `files.list`, or standalone `grep`/`glob`.
- Keeping `writeRuntimeOutboundArtifactViaSandbox` “for document provider only” after S1.
- Runtime `SandboxClientService.writeWorkspaceFile` for any model-visible outbound path.
- Model `grep`/`glob` as thin wrappers that still call `executeGrepActionViaPodExec` / `executeGlobActionViaPodExec`.
- Second object-key namespace (`assistant-media/runtime-output/...`) for new artefacts.
- Reopening ADR-126, ADR-127, ADR-128, or ADR-133 program scope — this ADR **corrects misapplied cutover**, it does not rewrite closed decisions.

## Orchestration model

- **Parent agent** owns ADR-137, dispatches S0–S6, audits every slice, reconciles docs, runs S6 gate.
- **Implementation subagents:** GPT-5.4 or Sonnet per slice; no scope broadening.
- **S6 (audit + garbage purge)** is **parent-only** — no implementation subagent may mark the program closed.
- One bounded slice per session unless founder explicitly widens.

## Founder directive

PersAI must stop treating the session pod as a **universal filesystem API**. The 2026-07-05 avatar video **413** (`sandbox workspace-write` + 20 MB JSON body cap) proved the failure mode: provider bytes routed through pod ingress add **latency**, **cold-start coupling**, and **hard size limits** without execution benefit.

The **correct** model was already stated in ADR-127: **manifest + GCS = truth; pod = cache for exec**. ADR-126 v3 W3.2 temporarily mandated “sandbox single write owner” to force path-identity migration; that rule was **misapplied beyond exec** and never should have covered worker media or CRUD file tools.

This program restores ADR-127 semantics **completely**, with a hard pod boundary and a final repo-wide purge of parallel paths.

## Relationship to prior ADRs

| ADR | Relationship |
|-----|----------------|
| **ADR-126 / v3 cutover** | **Closed.** Path identity landed. W3.2 “NEVER `saveObject`” applied to worker media was a **migration tactic**, not eternal architecture. ADR-137 supersedes that tactic for non-exec paths. **Do not reopen** ADR-126. |
| **ADR-127** | **Closed but incompletely enforced.** D1–D5 (manifest index, GCS bytes, pod cache) are the **target truth** this program finishes. |
| **ADR-128 / 133** | **Closed.** Session path hierarchy unchanged. |
| **ADR-132** | **Closed.** `document.*` exec verbs stay on pod; delivery honesty rules unchanged. |
| **ADR-134** | **`files.search`** is the manifest/path search owner; ADR-137 extends usage for `glob` and path discovery; content grep is S4. |
| **ADR-135 / 136** | Orthogonal; do not mix slices. |

## Context

### What went wrong (root cause, not “pod = workspace fantasy”)

ADR-126 v3 needed one **visible path** under `/workspace/...` instead of legacy `assistant-media/runtime-output/...` object keys. The cutover program (W3.2) required routing new artefact bytes through `sandbox workspace-write` so sandbox mirrored GCS and collision/quota stayed centralized **during migration**.

That was defensible **only while** every write originated from sandbox exec. It was **wrong** when applied to:

1. **Provider worker outputs** (image/tts/video/Gamma) — bytes never touch the pod until incorrectly pushed through HTTP.
2. **Model `files.*`** — CRUD on durable workspace files, not code execution.
3. **Model `grep` / `glob`** — index queries disguised as pod `rg`/`fd` jobs.

ADR-127 already decided manifest + GCS are authoritative; pod FS staleness is **not a correctness bug**. The W3.2 “sandbox only writer” rule contradicted ADR-127 when extended to non-exec paths. Agents implementing W3.2 treated it as “pod = unified workspace” — that was **over-interpretation**, not founder intent.

### Current code map (pre-program)

| Surface | Today | Problem |
|---------|-------|---------|
| `image_*` / `tts` / `video_generate` outbound | ~~sandbox `workspace-write`~~ → **GCS (S0 local)** | Fixed locally in S0 |
| Gamma `document` provider PDF/PPTX | `writeRuntimeOutboundArtifactViaSandbox` | Same 413/latency class as video |
| `files.write` / `read` / `list` / … | `RuntimeFilesToolService` → `sandboxClient.waitForCompletion` → pod bridge | Pod for non-exec |
| `grep` / `glob` | `RuntimeGrepGlobToolService` → sandbox `executeGrepActionViaPodExec` | Pod for index query |
| `shell` / `exec` | `RuntimeSandboxToolService` → pod exec | **Correct** |
| `document.inspect/render/convert` | `RuntimeDocumentToolService` → pod jobs | **Correct** |
| API web upload / inbound | `workspace-write-control-plane` | **Correct** (control-plane ingress; not model tool) |
| Sandbox image | `rg`, `fd` on PATH | **Keep** for in-pod scripts |

### Incident that triggered ADR-137

- Job class `0a8dc123`: HeyGen accepted + charged; failure at **artifact persist** (`413` sandbox body limit), not provider.
- Short mp4 (~13 MB) passed; longer speech mp4 exceeded sandbox HTTP JSON cap.

**Correct model (founder-locked):** unified **session path** (ADR-128/133) + **split planes** — not “pod owns everything.”

### Two planes

```text
┌─────────────────────────────────────────────────────────────┐
│ STORAGE PLANE (no pod required)                              │
│  GCS bytes  +  workspace_file_metadata  +  API internal      │
│  Used by: files.*, files.search, worker media, Gamma outbound│
│           web upload, chat delivery, gallery (manifest join) │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ EXECUTION PLANE (session pod)                                │
│  shell / exec / document.inspect | render | convert          │
│  Pod FS = working cache during job; mirror to GCS after job  │
│  rg/fd available INSIDE scripts — not as standalone pod jobs   │
└─────────────────────────────────────────────────────────────┘
```

## Decision

### D1 — Execution pod boundary (hard)

```text
needsSessionPod(tool) :=
  tool ∈ { shell, exec, document.inspect, document.render, document.convert }
  OR tool is an internal sandbox job code invoked only from those surfaces
  (e.g. execute_document_code, render_html_to_pdf)
```

Everything else is **storage-plane** or **provider-worker** and must not call `ensureSessionPodRunning` for correctness.

### D2 — Storage plane (single write seam)

Non-exec writes:

```text
bytes → PersaiMediaObjectStorageService.saveObject(objectKey from buildWorkspaceObjectKey)
     → upsertWorkspaceFileMetadata (API internal seam)
     → return storagePath under buildAssistantSessionRoot
```

Reads:

```text
manifest row exists → downloadByWorkspacePath from GCS
```

List / search / glob (path):

```text
workspace_file_metadata (+ files.search for token match)
```

**Quota:** enforce at API upsert / storage service (same rules sandbox quota checked today); do not require pod lease for quota on storage-plane writes.

### D3 — Worker outbound (all provider bytes)

| `sourceToolCode` | Persist |
|------------------|---------|
| `image_generate`, `image_edit`, `tts`, `video_generate` | `writeRuntimeOutboundArtifact` (GCS) — S0 |
| `document` (Gamma PDF/PPTX) | Same function — S1 |
| `document.render/convert` outputs | Pod job → existing shell sync → metadata upsert (unchanged) |

Delete `write-runtime-outbound-artifact-via-sandbox.ts` after S1.

### D4 — `files.*` on storage plane

| Action | Target implementation |
|--------|----------------------|
| `write` | GCS put + metadata upsert; collision via API (ADR-131 `replace` / numeric suffix policy ported to API layer) |
| `read` | GCS download; no pod |
| `list` | Manifest query scoped per ADR-131 chat/session rules — **not** pod `find` |
| `delete` | GCS delete + manifest delete (atomic API) |
| `attach` | Existing chat attachment registration; no pod |
| `search` | ADR-134 internal search — already API; ensure parity with retired pod list |

`RuntimeFilesToolService` must not call `sandboxClient.waitForCompletion` for any action after S3.

### D5 — `grep` and `glob` without pod

| Tool | v1 behavior |
|------|-------------|
| `glob` | Manifest path glob / prefix filter on `workspace_file_metadata.path` (session-scoped). Equivalent to `fd` on committed paths. |
| `grep` | **Path + content:** internal API scans **GCS bytes** for committed manifest paths matching scope (streaming, size-capped). Not pod `rg`. |

**Inside `shell`:** model may still run `rg`/`fd` in bash when pod is already up — unchanged.

**Explicit non-goal:** searching pod-only ephemeral files before shell job completes. Model must finish `shell` (which syncs `producedFiles` + metadata) before `grep` sees new outputs.

### D6 — Sandbox service retention

Keep in `apps/sandbox`:

- Pod lifecycle, `runInPod`, `execShellInSessionPod` for **exec** jobs.
- `WorkspaceFileBridgeService` writes **only** from:
  - document pipeline staging inside pod jobs;
  - shell `producedFiles` sync path;
  - control-plane upload ingress (`workspace-write-control-plane`).
- `executeGrepActionViaPodExec` / `executeGlobActionViaPodExec` — **delete** model-tool dispatch paths after S4; may retain **private** helpers only if `shell` internals need them (default: delete).

Remove or narrow:

- `/api/v1/jobs/workspace-write` when no caller remains (runtime must not call it).
- Sandbox `case "grep"` / `case "glob"` / `case "files"` branches used **only** for model tools (after S3/S4).

## Slices

### S0 — Worker media outbound GCS-direct ✅ (landed locally 2026-07-05)

**Scope:** `image_generate`, `image_edit`, `tts`, `video_generate` → `writeRuntimeOutboundArtifact` + `saveObject`.

**Files:** `write-runtime-outbound-artifact.ts`, `persai-media-object-storage.service.ts`, four worker tool services, tests, CHANGELOG/HANDOFF.

**Acceptance:**

- No runtime worker media path calls `sandboxClient.writeWorkspaceFile`.
- Large mp4 persist does not hit sandbox HTTP body limit.

**Residual:** deploy + live long-script avatar smoke on `persai-dev`.

---

### S1 — Gamma provider outbound GCS-direct ✅ (landed locally 2026-07-05)

**Scope:** `runtime-document-provider-adapter.service.ts` uses `writeRuntimeOutboundArtifact` (GCS). Delete `write-runtime-outbound-artifact-via-sandbox.ts`.

**Acceptance:**

- `rg writeRuntimeOutboundArtifactViaSandbox apps/` → **0**.
- `rg writeWorkspaceFile apps/runtime/src` → **0** (entire runtime app).
- Gamma tests pass with `saveObject` mock.

---

### S2 — `files.read` + `files.write` storage plane ✅ (landed locally 2026-07-05)

**Scope:** `RuntimeStoragePlaneFilesService`; persisted `/workspace/...` read/write via GCS + manifest; API `storage-bytes-used` for quota; `/tmp` stays sandbox.

**Acceptance:**

- `files.write` on `/workspace/...` in tests never stubs `waitForCompletion`.
- Written bytes go to GCS + manifest upsert before tool success.
- ADR-131 collision (`replace`, `create_only`, numeric suffix) preserved.

---

### S3 — `files.list` / `delete` / `attach` / `search` alignment

**Scope:** Remaining `files` actions off sandbox; list from manifest; delete updates manifest + GCS; Working Files batch join unchanged (ADR-134).

**Acceptance:**

- `RuntimeFilesToolService` has **zero** `sandboxClientService` usage.
- Cold chat with only `files.list` never creates sandbox job rows.

---

### S4 — `grep` / `glob` storage plane

**Scope:**

- `RuntimeGrepGlobToolService` → internal API (new `files/grep` or extend search).
- Remove sandbox model-tool grep/glob dispatch.

**Acceptance:**

- `grep`/`glob` tests pass without pod mocks.
- `rg executeGrepActionViaPodExec` in sandbox **only** referenced from shell-internal paths, or **0** if deleted.

---

### S5 — Sandbox + runtime dead path removal

**Scope:**

- Remove runtime `SandboxClientService.writeWorkspaceFile` if unused.
- Deprecate sandbox `/api/v1/jobs/workspace-write` when caller graph is empty (or restrict to document-internal staging with explicit comment).
- Update `API-BOUNDARY.md`, `ARCHITECTURE.md`, `DATA-MODEL.md` one paragraph each — pod boundary table.

**Acceptance:**

- `rg workspace-write apps/runtime` → **0**.
- `rg writeWorkspaceFile apps/runtime` → **0**.
- Sandbox `helm` / deploy unchanged unless route removed (document staging must still work).

---

### S5.1 — Session-scoped pod hydrate (not whole workspace)

**Runs after S5, before S6 audit gate.**

**Problem:** `hydrateWorkspaceMountFromGcs` today lists the entire GCS prefix `workspaces/<workspaceId>/workspace/` and materializes every object into the pod on cold bootstrap — O(workspace size), not O(session). Large accounts pay multi‑GB hydrate for `shell`/`document` that only need the current session tree.

**Scope:**

- Change pod bootstrap hydrate to **session prefix only**:
  - Primary: `assistants/<assistantId>/sessions/<runtimeSessionId>/` (ADR-133 path under `/workspace/...`).
  - Optional second pass: `assistants/<assistantId>/shared/` (assistant-wide shared subtree only — **not** other sessions, **not** whole workspace).
- Pass `assistantId` + `runtimeSessionId` from sandbox job request into `ensureWorkspaceMountBootstrapped` / `hydrateWorkspaceMountFromGcs` (today hydrate only receives `workspaceId`).
- **Do not** hydrate `workspaces/<workspaceId>/workspace/` root in full on bootstrap.
- **On-demand widen (v1 minimal):** when `shell`/`document` job targets a path **outside** the hydrated session+shared subtree but still under active ADR-133 hierarchy, fetch **that path only** from GCS into the pod before exec (single-file or single-prefix lazy hydrate — not full workspace). If path missing in GCS, fail honestly.
- `files.read` / list / attach remain storage-plane (no change) — they never depend on full workspace hydrate.
- Session tar snapshot overlay (`saveSessionWorkspaceSnapshot` / restore) unchanged — still session-scoped ephemera on top of per-file GCS objects.
- Metrics/logs: log hydrate object count + bytes scope (`session` vs `shared` vs `on_demand`); alert-friendly if session hydrate object count explodes.

**Explicitly out of S5.1 scope:**

- Warm-pod grep/glob overlay (separate post–ADR-137 follow-up).
- Workspace-wide hydrate toggle for admin/migration.
- Changing pod keying `(assistantId, workspaceId)` — still one pod per assistant+workspace.

**Acceptance:**

- Cold pod bootstrap for a workspace with 2 GB total but 5 MB in current session hydrates **≈ session+shared object count only** (test with mocked prefix listing or integration fixture).
- `rg 'listPrefix\\(workspacePrefix\\)' apps/sandbox/src/exec-pod-bridge` — hydrate path uses **session subprefix**, not bare `buildWorkspacePrefix({ workspaceId })` without `subPath`.
- `shell` in session can read/write files under current session root without regression.
- `document.render` in session still works.
- Reading a file in another session via `files.read` (storage plane) still works without full hydrate.
- `@persai/sandbox` focused exec-pod-bridge / hydrate tests green; typecheck green.

---

### S6 — Independent audit and garbage purge (closure gate)

**Owner:** parent agent only.

**Mandatory grep gate (all must be 0 in active paths):**

```bash
rg "writeRuntimeOutboundArtifactViaSandbox|write-runtime-outbound-artifact-via-sandbox" apps/
rg "writeWorkspaceFile" apps/runtime/src
rg "W3\.2-shim|W3-shim|single write owner" apps/ docs/ --glob '!**/ADR/**'
rg "assistant-media/runtime-output" apps/
rg 'case "grep"|case "glob"' apps/sandbox/src/sandbox.service.ts   # unless exec-internal only
```

**Manual audit checklist:**

| Check | Pass criterion |
|-------|----------------|
| Pod boundary | Only `shell`/`exec`/`document.*` dispatch `waitForCompletion` / `runInPod` for model tools |
| Provider bytes | All worker outbound uses GCS `saveObject` + session `storagePath` |
| Manifest truth | Every storage-plane write updates `workspace_file_metadata` before tool success |
| No dual list | No pod `find` for model `files.list` |
| Image tools | `rg`/`fd` still in sandbox Dockerfile for shell |
| Session hydrate | Cold bootstrap hydrates **session + optional shared only** — not full workspace prefix (S5.1) |
| Docs | ADR-137 closed; HANDOFF/CHANGELOG updated; ADR-126 W3.2 “NEVER saveObject” noted as **superseded** in ADR-137 Context only |
| Tests | Full verification gate green; focused files/grep/glob/worker tests green |
| Live | Avatar long video + `files.write` + `document.render` smoke on `persai-dev` |

**Garbage to delete if still present (non-exhaustive):**

- `apps/runtime/src/modules/turns/write-runtime-outbound-artifact-via-sandbox.ts`
- Runtime `writeWorkspaceFile` client method
- Test helpers `createFakeSandboxClientForOutboundWrite` if unused
- Sandbox HTTP handlers with no callers
- Stale CHANGELOG/HANDOFF claims that worker media uses sandbox

Program **closes** only when S6 table is all pass + founder deploy acceptance.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `grep` content scan cost | Cap file size / match count; session-scope paths only |
| Manifest lag after `shell` | Existing `producedFiles` sync must complete before tool returns (already required for attach honesty) |
| Quota bypass without sandbox | Port `checkStorageQuotaBeforeWrite` logic to API write seam |
| Document job staging | Keep pod writes **inside** document job lifecycle only — not model CRUD |

## Verification gate (every slice)

Per `AGENTS.md`: lint, format:check, api/web/runtime typecheck; slice-focused tests; S6 adds full gate + live smoke.

## Out of scope

- Reopening ADR-126 shared-namespace or flat `/workspace/<file>` debates.
- Anthropic/tool projection work (ADR-135).
- New pod warm-pool redesign (optional follow-up beyond S5.1).
- Full-text search index product (future ADR if `grep` needs ES-scale).
