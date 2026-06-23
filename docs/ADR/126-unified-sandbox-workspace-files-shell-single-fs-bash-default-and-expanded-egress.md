# ADR-126 — Unified sandbox workspace: per-assistant FS + cross-assistant shared volume, bash default, expanded egress, path-based `files.*`

Status: **Accepted v2 (doc-only)** — founder sign-off received 2026-06-22 on the original four points (bash default, unified FS, expanded egress, image baseline) and again on 2026-06-23 on the multi-assistant collaboration model (shared volume + per-assistant scratch), the `files.attach` publish tool, the prompt-economical file manifest, chat-scoped scratch namespace, snapshot/cold-start budget, GC lifecycle, audit/observability, and the `fileRef`-migration audit. Implementation is a separate bounded program (six slices) dispatched in a follow-up session. No code changes accompany this ADR.

**Amendment 2026-06-23 (during implementation Slice 2).** D3 / Resolved-decisions §1 flipped from "git push denied in v1" to "git push allowed in v1 (matches Claude Code / Anthropic posture)" per founder follow-up. The previous "deny at proxy" mechanism required SSL bumping (custom Squid-OpenSSL image, CA lifecycle, ~150 LOC operational surface) and the founder confirmed the prod product should mirror Claude Code's open-push posture. No PersAI credentials are baked into the exec pod (ADR-123 D2 remains), so push only succeeds with model-provided auth — the model brings its own PAT or short-lived token. The deny rule (POST `/git-receive-pack`) and SSL bump scaffolding are explicitly **NOT** implemented. See D3 amendment block, Acceptance criterion §7 (replaced), Threat model row (replaced), Resolved-decisions §1 (replaced), and Implementation plan Slice 2 (rewritten) below.
Date: 2026-06-23 (v2 supersedes the 2026-06-22 v1 doc-only draft on the same number)
Supersedes: none (refines long-term system truth set by ADR-123)
Superseded-by: none

## Relates to

- **ADR-123** (Native sandbox runtime — isolation, network, document execution) — **closed**. ADR-126 reopens **only the sandbox surface** (files contract + shell defaults + egress allowlist + cross-assistant workspace shape) without reopening isolation/lifecycle/document program decisions, which stay locked. The per-`(assistantId, workspaceId)` exec pod model from ADR-123 D4 stands; ADR-126 v2 adds a sibling shared volume on top, not in place of it.
- ADR-081 (unified user-files architecture) — `assistant_files` table stays the source of truth for **chat input/output artifacts**; ADR-126 narrows the role of `files.*` tool from "thin API onto `assistant_files`" to "thin API onto the per-assistant pod `/workspace` + the per-user-workspace `/shared` mount". `assistant_files` becomes a pure **delivery layer** for chat-visible attachments, not a parallel filesystem the model interacts with.
- ADR-097 (autonomous document tool) — document artifacts continue to land in `assistant_files` for chat delivery; they additionally land in `/shared/outbound/self/` so the same assistant can post-process them.
- ADR-116 (runtime file re-view / inspect / read / preview) — preview pipeline is repointed at `/shared/` + `/workspace/` paths instead of `assistant_files.id`; the `fileRef`-keyed preview cache survives only for outbound artifact delivery rendering, not for the `files.*` tool path.
- ADR-122 (model output budget) — independent.
- ADR-125 Amendment 1 (scenario plan-intake `<system-reminder>`) — independent.

## Founder symptom (verbatim, 2026-06-22)

> "Это не совсем поведение like claude code — пакетов не хватает, git соединение закрыто и тп … files.write с ~/ путём не пробрасывается в shell-песочницу — файл тупо не виден … brace expansion {data,scripts,reports} в dash не пашет"

Live trace from a model session in `persai-dev` (assistant `2f8cf38e-a6d9-4609-b83a-2b748246fcec`, founder-narrated):

1. Model wrote `~/persai-analytics/scripts/generate_data.py` via the `files.write` tool — the next `shell` step listed `/workspace` and could not see the file.
2. Model issued `mkdir -p persai-analytics/{data,scripts,reports}` in shell — only one directory `persai-analytics/{data,scripts,reports}` was created (no brace expansion).
3. Model tried `git clone …github.com…` — connection refused by the egress proxy.

## Founder follow-up (2026-06-23)

- "у меня есть мультиасистент воркспейс для b2b — user может настроить себе 2-3 асистента" → ассистенты в одном B2B workspace должны видеть общие юзерские аплоады и иметь способ передать артефакт друг другу без переаплоадов.
- "не будут ли путаться асистенты где их а где соседа файл?" → namespace per ассистент с очевидным `self/` symlink и FS-level read-only protection для чужих outbound папок.
- "блок developer сейчас вся портянка файлов с микроописанием … не эффективно когда их 100" → context-economical file manifest вместо eager full listing.
- "то что делает асистент в песочнице скрипты md планы это все к чату привязанно?" → текущий ADR-123 даёт per-assistant `/workspace`; для chat-specific scratch нужен namespace `/workspace/chats/<chatId>/`.
- "Ты уверен что все будет уже PROD четко после 126adr как у лучших на рынке?" → честный self-audit показал четыре дополнительных пункта (snapshot / cold-start budget, GC lifecycle, audit/observability, migration audit для существующих `fileRef`-зависимых артефактов) без которых решение не дотягивает до prod-level.

ADR-126 v2 закрывает каждый пункт явным разделом ниже.

## Context — audited current state (file:line)

### Two filesystems, one logical workspace

| Layer | Backing | Mutator | Reader |
| --- | --- | --- | --- |
| **Files (`files.write` / `read` / `list` / `preview`)** | `assistant_files` Prisma table → GCS object store (ADR-081) | `RuntimeFilesToolService` via internal API endpoint, never touches the sandbox pod | API `GET /assistant/chats/web/:chatId/files/:fileRef` + runtime hydration |
| **Sandbox shell (`shell` / `exec` / `grep` / `glob`)** | Per-`(assistantId, workspaceId)` exec pod `/workspace` (ADR-123 D4) | Sandbox control plane pushes a tar of the control-plane workspace shadow into the pod before each job (`workspace-push.service.ts`); the model writes files *inside* the pod via `bash` / `python3 …` | Sandbox control plane pulls a tar of `/workspace` back after each job (`workspace-pull.service.ts`) |

Right now these layers do not share storage. `files.*` and `shell` round-trip through entirely different code paths:

- `files.write` → `apps/api/src/modules/workspace-management/.../assistant-files.controller.ts` → `assistant_files` row + GCS upload. **Never touches the exec pod.**
- `shell mkdir foo` → `apps/sandbox/src/run-in-pod.service.ts:runInPod` → pod's `/workspace/foo`. **Never touches `assistant_files`.**

The model's mental model is one workspace; the code's reality is two siloes glued at the chat level. Every long-running task that mixes both tools hits this gap, including the founder's live scenario.

### Multi-assistant B2B workspace — implicit silos today

`apps/api` allows a single business workspace (`businessWorkspaceId`) to own multiple assistants (`assistantId`). The founder explicitly targets the "2–3 ассистента на один воркспейс" pattern as the long-term shape. ADR-123 D4 isolates each assistant's `/workspace` into its own exec pod. Today this means:

- A `sales.csv` uploaded into the chat with Маркетолог lands in `assistant_files` against that chat only; the Аналитик chat does not see it without a re-upload.
- An artifact generated by `image_generate` from Маркетолог lands in `assistant_files` against that chat only; Аналитик cannot pick it up as input.
- There is no cross-assistant file-passing channel inside the sandbox at all.

This is the production gap ADR-126 v2 closes with the `/shared/` mount below.

### Shell is `dash`, not `bash`

`apps/sandbox/exec-image/Dockerfile` builds `node:22-bookworm-slim` → `/bin/sh = dash` (debian default). `RuntimeShellToolService` invokes commands as `/bin/sh -lc "<command>"`, which means **no brace expansion, no `[[ ]]`, no `<(…)` process substitution, no `pipefail` by default**. `bash` is installed on the image (it ships with `bookworm-slim`) but is **not** the default shell and is not the shell the `shell` tool uses.

### Egress allowlist is LLM-host-only

`infra/helm/values-dev.yaml` `egressProxy.allowedDomains` currently lists provider hosts (`api.openai.com`, `api.anthropic.com`, `api.deepseek.com`, …) + `.github.com` + `.githubusercontent.com` (added 2026-06-21 for the document/Slice 6 ingest path) + `pypi.org` / `files.pythonhosted.org` (PyPI for runtime `pip install`). `npmjs.org` / `registry.npmjs.org`, `nodejs.org`, package mirrors, and Git operations against arbitrary hosts (`*.googlesource.com`, `gitlab.com`, `bitbucket.org`) are **not** in the allowlist. `git clone https://github.com/…` works for HTTPS over the proxy only because GitHub is allowlisted; `git clone git@github.com:…` over SSH does not, and `git push` is not exercised today.

### Image stack — close, but missing `node`/`npm`/Git ergonomics

`apps/sandbox/exec-image/Dockerfile` already installs `python3` + a doc/data stack (ADR-123 D5 + 2026-06-21 expansion), `git`, `unzip`, `zip`, `ripgrep`, `fd`. `node` / `npm` are **not** preinstalled in the exec image (only the control-plane `apps/sandbox/Dockerfile` has node); model code that tries to run JavaScript or install npm deps fails. The control-plane image has node because `apps/sandbox` itself is a NestJS process — that is orthogonal to the execution unit.

### Tool guidance does not mention runtime installs and embeds eager full listing

`apps/api/prisma/tool-catalog-data.ts` `shell.modelUsageGuidance` (post-ADR-123 Slice 7) encourages autonomous shell use but is silent on `pip install --user` and on `npm install` against `/workspace`. `files.modelUsageGuidance` is silent on the fact that the file may also be visible from `shell` (and today, it isn't). Separately, the developer-section file manifest currently embeds **every file ever attached to the chat** with a one-line description — fine at 5 files, ruinous at 100. There is no on-demand listing path; everything is eager.

### Snapshot strategy is full-tar

`apps/sandbox/src/.../workspace-push.service.ts` / `workspace-pull.service.ts` snapshot `/workspace` as a single tar.gz to GCS keyed by `(assistantId, runtimeSessionId)`. There is no incremental diff; a 200 MB `node_modules/` pays the full pull cost on every cold start. The founder's session today touches a few small files and never approaches the cost — at the moment we enable npm/pip writes into `/workspace`, this becomes the dominant cold-start contributor.

### GC for chat-scoped and assistant-scoped artefacts is implicit

Chat deletion today does not clean up per-chat workspace artefacts (none exist yet because the model has nowhere to put them — see D9). Assistant deletion clears `/workspace` snapshot eventually via lease expiry. Business-workspace deletion has no documented lifecycle for sandbox state. ADR-126 v2 makes each layer explicit.

## Decision

Make the sandbox feel like a **single Claude-Code-style dev workspace per assistant + a single Cursor-style shared project space per business workspace**, with bash by default, package managers and Git available, while preserving the isolation / secret / lifecycle decisions ADR-123 locked. Thirteen decisions (D1–D13) below correspond directly to the live regressions and the founder follow-up; they are introduced as one bounded program.

### D1 — bash as the default `/bin/sh` for `shell`

- In `apps/sandbox/exec-image/Dockerfile`, replace `/bin/sh` symlink so it points to `/bin/bash` (or invoke commands as `/bin/bash -lc "<command>"` from `RuntimeShellToolService`, removing the `dash` indirection entirely).
- `set -o pipefail` becomes safe to assume; `{data,scripts,reports}` brace expansion works; `[[ … ]]` works; `<(…)` works. The model's bash mental model from Claude Code / Cursor transfers verbatim.
- This is **not** a security boundary change — `bash` is already on the image, it just was not the default. The exec pod still runs under gVisor + `securityContext` (ADR-123 D1/D2) and writes to a writable subset of the filesystem.

### D2 — Unified workspace filesystem: per-assistant `/workspace/` + cross-assistant `/shared/`

This is the architectural core of ADR-126 v2. **`files.*` tool stops touching `assistant_files`** as a parallel filesystem and becomes a thin API onto two pod-mounted volumes.

#### Mount layout per assistant pod

```
/shared/                              ← single volume per (userId, businessWorkspaceId)
  /input/                             ← user uploads; read-only for assistants
    sales.csv
    report.pdf
  /outbound/                          ← assistant-authored artefacts visible across siblings
    /self                             ← symlink → /shared/outbound/<this-assistant-handle>/
    /<assistant-handle>/              ← per-assistant subdir (one per sibling in the workspace)
      revenue-by-month.png
      forecast.csv

/workspace/                           ← per-(assistantId, workspaceId) exec pod (ADR-123 D4 unchanged)
  /lib/                               ← reusable scripts the assistant wants to survive chat boundaries
  /chats/
    /<chatId>/                        ← chat-scoped scratch (intermediate parquet, plot.png, plan.md)
  /.local/, /.npm-global/, /.venv/    ← session-scoped install layers (pip user-site, npm prefix, venv)
  node_modules/                       ← project-local installs (npm install without -g)
```

#### Access matrix (enforced at FS level, not by tool guidance alone)

| Path | Writer | Readers |
| --- | --- | --- |
| `/shared/input/` | User uploads (via control plane at upload time) — `0444` for assistant pods | All assistants in this `businessWorkspaceId` |
| `/shared/outbound/<self>/` | The owning assistant only — `0755` for that pod, `0555` for sibling pods | All assistants in this `businessWorkspaceId` |
| `/shared/outbound/<other>/` | (Other assistant only; this pod cannot write) | This pod, read-only |
| `/workspace/` | This assistant only | This assistant only |
| `/workspace/chats/<chatId>/` | This assistant only, only during turns of this chat | This assistant only |

`/shared/outbound/self` is a per-pod symlink that resolves to `/shared/outbound/<this-assistant-handle>/`. The model writes to `self`, reads siblings by explicit handle. Skill is **not** a partition: an assistant has one outbound subdir regardless of how many skills it carries.

#### Contract change for `files.*` (single-shot, no transitional dual write)

| `files.*` action | Was | Becomes |
| --- | --- | --- |
| `write({path, content})` | `assistant_files` row + GCS upload, surfaced to the model as `fileRef` | Direct write into the resolved pod path via the sandbox control plane (`workspaceFileWrite` primitive — see Implementation plan). Allowed prefixes: `/workspace/...` and `/shared/outbound/self/...`. Writes to `/shared/input/` or `/shared/outbound/<other>/` return `path_not_writable`. Path is normalized against the prefix (no `..`, no absolute escapes). |
| `read({path})` | Reads `assistant_files` GCS object by `fileRef` | Reads `/shared/...` or `/workspace/...` from the assistant's pod. Same containment + size cap. |
| `list({path?})` | Lists `assistant_files` for the current chat | Lists the requested path (defaults to a multi-root listing: `/shared/input/`, `/shared/outbound/`, `/workspace/`). Hides system noise by default — see D11/manifest section below. |
| `preview({path})` | Renders preview from `assistant_files` object by `fileRef` | Renders preview from the pod path. Existing preview pipeline (ADR-116) is repointed at `/shared/` + `/workspace/` via the control plane. |
| `attach({path})` | (did not exist) | See D6. |

The model **never sees a `fileRef`** for files in the `files.*` tool surface. It sees paths.

#### Naming and collision

- User upload `report.pdf` arriving twice in the same `businessWorkspaceId` → `report.pdf`, `report (2).pdf`, `report (3).pdf` (macOS-style numeric suffix). The control plane assigns the suffix at upload time; the assistant_files row preserves the resolved on-disk basename in `assistant_files.metadata.workspaceRelPath`.
- Artefact filename collisions inside `/shared/outbound/<self>/` follow the same numeric-suffix rule, applied by the writing tool (`image_generate`, `document`, `files.attach`).

#### Inter-job durability

The pod-side `/workspace` remains the canonical FS for the **entire session**. The control-plane GCS snapshot (ADR-123 D4) continues to hydrate `/workspace` on pod recreate, and the control plane continues to pull `/workspace` back into the GCS snapshot when the workspace lease releases — so **inter-job durability is preserved** without any change to the snapshot protocol. The new `/shared/` mount has its own snapshot keyed by `businessWorkspaceId` — see D10.

### D3 — Expanded egress allowlist for git/PyPI/npm

Add to `infra/helm/values-dev.yaml` `egressProxy.allowedDomains` (HTTPS only, deny-all default still applies, isolation/auth boundary of ADR-123 D3 is **not** weakened):

- **Git over HTTPS — GitHub only in v1** (founder sign-off 2026-06-22): `github.com`, `*.github.com`, `gist.github.com`, `*.githubusercontent.com`, `api.github.com` (the first two already added 2026-06-21). GitLab and Bitbucket are intentionally **not** in v1 — they are an additive change that costs nothing in proxy code but widens the surface, so adding them later is a one-line follow-up if real usage demands it.
- **PyPI** — `pypi.org`, `files.pythonhosted.org` (already added 2026-06-21).
- **npm** — `registry.npmjs.org`, `npmjs.com`, `*.npmjs.com`.
- **Node binary mirror** — **not** added in v1. `node` ships preinstalled at LTS 22 on the exec image (D4 below).

**Git push policy — allowed in v1 (amended 2026-06-23).** The egress proxy enforces the domain allowlist by SNI (HTTPS) and Host header (HTTP) — that is the entire L7 boundary. `git push` traffic that targets GitHub HTTPS reaches GitHub like any other allowed-host request; the **defense against accidental publish is the absence of PersAI credentials in the exec pod** (ADR-123 D2 remains intact — no real provider tokens, no managed PATs, no SSH keys injected). A `git push` succeeds only if the model itself supplies valid auth (PAT-in-URL, `git config credential.helper`, or a model-authored `~/.gitconfig`); otherwise GitHub returns 401 at the application layer and the push fails. No proxy-level method/URL inspection. No SSL bumping.

> **Why this matters.** The previous draft of D3 mandated method filtering on `POST /git-receive-pack` via SSL bumping (custom Squid-OpenSSL image + CA cert lifecycle + selective bump on GitHub hosts). The founder confirmed on 2026-06-23 during implementation that PersAI's prod posture should match Claude Code / Anthropic's open-push model: developers / B2B assistants legitimately push code, and the no-credentials rule (ADR-123 D2) already prevents the dominant accidental-exfil scenario. The proxy-level deny is **not** implemented; reopening would require a new ADR addendum + threat-model update that articulates a concrete usage pattern requiring it.

The egress proxy continues to enforce **HTTPS only**, **deny-all + allowlist**, and the existing scoped-credential injection model (ADR-123 D3) — `git`, `pip`, and `npm` do not see real PersAI provider tokens; they see only the allowlisted host.

### D4 — Image baseline: `bash` default, `node` + `npm` preinstalled, runtime installs documented

- `apps/sandbox/exec-image/Dockerfile` (the exec image, not the control plane):
  - `/bin/sh` → `/bin/bash` (or `RuntimeShellToolService` invokes `/bin/bash -lc` explicitly; the choice is the implementing slice's, the contract is "bash-shaped semantics").
  - Add `nodejs` + `npm` at **Node 22 LTS** (founder sign-off 2026-06-22) — installed from NodeSource `setup_22.x`, matches the control-plane image's `node:22-bookworm-slim` base so the LTS line is identical on both sides.
  - Keep the existing `--system-site-packages` venv at `/opt/venv` and the `PYTHONUSERBASE=/workspace/.local` / `PIP_USER=1` ergonomics (ADR-123 warm-node addendum, 2026-06-21) so `pip install <pkg>` continues to write into the session-scoped `/workspace/.local` without weakening the read-only root FS.
  - Configure `~/.npmrc` with `prefix=/workspace/.npm-global` and pre-`PATH` `/workspace/.npm-global/bin` so `npm install -g` lands in the session workspace (mirrors the Python user-site pattern). `npm install` (no `-g`) writes a project-local `node_modules/` under whatever `cwd` the model chose — same as Claude Code.
- `apps/api/prisma/tool-catalog-data.ts` `shell.modelUsageGuidance` gains an explicit short block: "the sandbox shell is `bash`; you may `pip install <pkg>` (writes to `/workspace/.local`, session-scoped) and `npm install <pkg>` (writes to `/workspace/node_modules` or `/workspace/.npm-global` for `-g`); `git clone https://github.com/<org>/<repo>.git` works; `git push` is allowed if you supply your own credentials (no PersAI token is injected; without auth GitHub returns 401)". The companion `files.modelUsageGuidance` rewrite is covered in D8 (manifest header + path-based mental model).

### D5 — Artefacts land in `/shared/outbound/self/` alongside chat delivery

`image_generate`, `image_edit`, and `document` (autonomous PDF/XLSX tool, ADR-097) gain a dual write:

1. The generated file is materialized at `/shared/outbound/<self>/<timestamp>-<slug>.<ext>` inside the assistant pod's view of the shared volume. The basename is deterministic, collision-resolved with the numeric-suffix rule.
2. The chat delivery path is unchanged: the same bytes are uploaded to `assistant_files` for UI rendering. `assistant_files.metadata.workspaceRelPath` carries the on-disk path so the runtime can later resolve `fileRef → path` for legacy reads.

Result: the model can `files.read("/shared/outbound/self/<basename>")` immediately after generation and post-process the artefact (resize an image, add a watermark, append a row to a CSV, embed a chart into a follow-up document) — the cross-tool dead end disappears.

`image_generate` and `image_edit` continue to use the existing GCS upload path for chat delivery; the additional pod write is a control-plane primitive that streams the same bytes (no double LLM call, no double provider cost).

### D6 — `files.attach({path})` — publish an arbitrary workspace path to the chat

New tool action on `files.*`. Accepts a path under `/workspace/` or `/shared/outbound/self/` (anything else → `path_not_attachable`). Behavior:

1. If the path is under `/workspace/`, the control plane copies the file to `/shared/outbound/self/<basename>` (collision-resolved). This is the **delivery copy**; the original stays in `/workspace/` and remains private.
2. If the path is under `/shared/outbound/self/`, no copy is needed — it is already in the cross-assistant-visible zone.
3. An `assistant_files` row is created with `metadata.workspaceRelPath` pointing at the shared-outbound copy and `metadata.kind = "files.attach"`.
4. The UI rendering channel for the current chat receives the new attachment via the existing `assistant_files` SSE/REST projection (no UI rewrite needed).

This closes the "model produced a useful CSV/JSON/zip/script — how does the user get it?" gap that `document` (PDF/XLSX only) and `image_generate` (images only) leave open. The model now has one explicit publish action, not a workaround through `document` or by inlining a code block.

`files.attach` is **the only** path-to-chat delivery for arbitrary file types in v1. There is no implicit auto-attach of files written through `files.write`; the model chooses what to ship.

### D7 — Quota model for the new layout

Two quotas, two error classes, one resolution path.

- **`/workspace/` quota** — per assistant, plan-driven (existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit`, resolved into `bundle.governance.quota.workspaceQuotaBytes`). Implementation slice raises the default plan baseline to **500 MB**. Exhaustion → `workspace_quota_exhausted` from the existing quota guard.
- **`/shared/` quota** — per `businessWorkspaceId`, plan-driven via a new key `planCatalogPlan.billingProviderHints.quotaAccounting.sharedStorageBytesLimit`, resolved into `bundle.governance.quota.sharedQuotaBytes`. Default plan baseline **500 MB**. Exhaustion → `shared_quota_exhausted` (new error class; same surface contract as `workspace_quota_exhausted`).
- Operators continue to tune per-plan caps via the existing billing-hints code path. No new cap mechanism is introduced — only the second key.

### D8 — Context-economical file manifest (developer prompt does not embed full listing)

The developer-prompt file manifest is rewritten:

- The prompt embeds a **summary header** only — `{ totals: { input: 8, outbound: { self: 5, siblings: 12 }, workspace_chats: 3 }, byKind: { image: 7, pdf: 5, csv: 6, other: 10 } }` plus a hint string: *"Use `files.list({path})` to enumerate; `files.preview({path})` for content preview."*
- **Files the user attached in the current turn** are inlined verbatim under the manifest with their cached `shortDescription` (one line per file). This is the only inlined detail; everything else is on-demand.
- **All other files** — history attachments, sibling assistants' outbound, previously written workspace artefacts — are reachable only via `files.list` / `files.preview`. The model spends tokens to enumerate when it cares; we no longer pay them upfront.

`files.list({path, includeHidden?})` returns a structured array:

```json
[
  {
    "name": "sales.csv",
    "kind": "csv",
    "size": 12340,
    "shortDescription": "Sales data Jan–Sep 2026, 1240 rows, cols: date, region, revenue",
    "modifiedAt": "2026-06-22T10:14:00Z",
    "writer": null
  },
  {
    "name": "q3.pdf",
    "kind": "pdf",
    "size": 524288,
    "shortDescription": "Q3 marketing report, 18 pages, executive summary on p.1",
    "modifiedAt": "2026-06-22T11:02:00Z",
    "writer": null
  }
]
```

For sibling outbound subdirs, `writer` is the sibling assistant's `handle` and `displayName` is included in the parent enumeration so the model can tell who produced what.

`shortDescription` is materialized once at upload / write time:

- User uploads → cheap-LLM/OCR pipeline runs at upload, persists into `assistant_files.metadata.shortDescription`. Image → vision-LLM caption (one sentence); PDF → OCR-extract of first page + LLM summary; CSV → header peek + row count; binary → MIME + size.
- Artefacts from `image_generate` / `document` / `files.attach` → description from the originating tool's own context (`image_generate.prompt`, `document.title`, etc.), persisted at write time.
- Excluded from cheap-LLM description: files in `node_modules/`, `.venv/`, `.local/`, `.cache/`, `.npm-global/`, `__pycache__/`; files matching `*.pyc`, `*.log`, `*.lock`, `*.tmp`; files larger than 8 MiB.

`files.list` by default **hides** the same system-noise set (`node_modules/`, `.venv/`, dotfiles, `__pycache__/`, `*.pyc`, etc.). `includeHidden: true` surfaces them when explicitly needed.

The `files.modelUsageGuidance` block in the tool catalog is rewritten to teach this mental model: *"This tool reads and writes paths under `/shared/` and `/workspace/`. `/shared/input/` contains user uploads (read-only). `/shared/outbound/self/` is where you publish artefacts visible to the user and other assistants. `/workspace/` is your private scratch. Everything you write here is also visible from `shell`, `grep`, `glob` at the same path. To deliver a file to the user in the chat UI, use `files.attach({path})`."*

### D9 — Chat-scoped scratch namespace: `/workspace/chats/<chatId>/`

Within the per-assistant `/workspace/`:

- `/workspace/lib/` — assistant-scoped, persists across chats. The model places reusable scripts and helpers here.
- `/workspace/chats/<chatId>/` — chat-scoped. The model places plan files, intermediate data, plot images, and any other turn-specific artefact here. The runtime sets `cwd` of `shell` to this directory by default at the start of each turn.
- The install layer (`/workspace/.local/`, `/workspace/.npm-global/`, `node_modules/`, `.venv/`) remains assistant-scoped because pip / npm installs are an investment we do not want to redo each chat.

Tool guidance instructs the model: *"Your plan, scratch, and intermediate artefacts for the current chat belong in `/workspace/chats/<chatId>/` (your shell starts there). Reusable scripts you want to keep between chats go in `/workspace/lib/`. Artefacts for the user go through `files.attach` or directly through `image_generate` / `document`."*

GC for `/workspace/chats/<chatId>/` is covered in D11.

### D10 — Snapshot strategy and cold-start budget

ADR-126 v2 introduces two snapshot domains.

- **`/workspace/`** — per-`(assistantId, workspaceId)`, existing tar.gz path from ADR-123 D4. Switches to **layered snapshots**:
  - Layer A (install): `/workspace/.local/`, `/workspace/.npm-global/`, `node_modules/`, `.venv/`. Snapshotted only when changed (content-hash over `pip freeze` / `package-lock.json` / `requirements.lock`); when unchanged, the cold-start path reuses the previous tar.gz blob by pointer.
  - Layer B (scripts + scratch): `/workspace/lib/`, `/workspace/chats/`. Always snapshotted (small).
  - Excluded entirely: `__pycache__/`, `*.pyc`, `*.log`, `/tmp/` (already tmpfs).
- **`/shared/`** — per-`businessWorkspaceId`, new snapshot path with the same layered approach. `/shared/input/` versioned per user upload (immutable on rename collision); `/shared/outbound/<assistant-handle>/` snapshotted per assistant turn.
- **Warm pool** — the implementation slice introduces a warm-pool of exec pods per assistant (size 1, configurable per plan tier) so that the first `files.write` of a session does not pay a cold pull cost. ADR-123 D4 already names a warm-node hook; ADR-126 wires it.

**Budget**: warm `files.write` ≤ 300 ms p95; cold first `files.write` (no warm pod) ≤ 3 s p95 for an install-layer-cached assistant, ≤ 8 s p95 for a fresh assistant. These are commitments the implementation slice must verify with a load smoke test before push.

### D11 — GC lifecycle (chat / assistant / business workspace deletion)

Explicit retention pipeline for the new state.

- **Chat deletion** → `/workspace/chats/<chatId>/` is removed at next workspace-lease release for the owning assistant. `assistant_files` rows attached to that chat follow the existing `assistant_files` retention policy. No new retention class.
- **Assistant deletion** → the assistant's `/workspace/` snapshot in GCS is marked for delete with a 7-day grace window (matches ADR-123 D4 grace), then purged. The assistant's `/shared/outbound/<handle>/` subdir in the shared volume is moved to `/shared/outbound/_archived/<handle>-<timestamp>/` (so sibling assistants who referenced files still see them in their history) and purged 30 days later.
- **Business workspace deletion** → the entire `/shared/` snapshot for the `businessWorkspaceId` is marked for delete with a 30-day grace, then purged. All assistants under that workspace are deleted first (existing cascade in `apps/api`).
- The control plane emits domain events for each transition: `workspace_snapshot_marked_for_delete`, `workspace_snapshot_purged`, `shared_volume_purged`. Existing audit pipeline (ADR-123 D7 observability) consumes them.

No new daemon; the existing `apps/sandbox` lease-expiry sweeper executes the purge as part of its normal pass.

### D12 — Audit and observability for the new file flow

The control-plane primitives that replace `files.*` HTTP writes emit structured events:

- `workspace_file_written` — `{ assistantId, businessWorkspaceId, chatId, relPath, bytes, traceId }`. Emitted by the control plane on every `files.write` / `files.attach` / artefact write.
- `workspace_file_read` — same shape, on every `files.read` / `files.preview` (sampling at 1/N for high-frequency reads, controllable per plan).
- `shared_outbound_published` — `{ ownerAssistantId, businessWorkspaceId, relPath, deliveryChannel: "chat" | "files.attach" }`.

Metrics added to the existing Prometheus surface:

- `workspace_file_write_latency_ms` histogram, labelled `{result, layer}` (`layer` = `workspace` | `shared`).
- `snapshot_cold_pull_latency_ms` histogram, labelled `{layer}` (`install` | `scratch` | `shared`).
- `shared_quota_bytes_used` gauge, labelled `{businessWorkspaceId}`.
- `workspace_quota_bytes_used` gauge, labelled `{assistantId}` (existing label set).

The egress-proxy log shape (ADR-123 D3) is extended with `{ tool: "files.write" | "shell" | "image_generate" | "document" | "files.attach" }` to attribute each network call to its source tool.

### D13 — Migration audit for existing `fileRef`-dependent surfaces

Before cutover, an audit script (one-shot, part of the implementation program) scans:

- `apps/api/prisma/tool-catalog-data.ts` for any literal mention of `fileRef`.
- All persisted `AssistantSkill` rows for skill prompts / scenario steps mentioning `fileRef`.
- All persisted `RuntimeBundleState.materializedSpec.runtimeBundle.governance` JSON for `fileRef`.
- `apps/runtime/.../files-tool-builder` and `apps/web` chat history rendering for `fileRef` consumers.

Output: a report of every place that will need either a path-based rewrite (active surface) or an explicit "this is historical render-only" annotation (passive surface). The implementation program **does not push** until the report is empty for active surfaces (passive historical rendering paths are allowed to remain `fileRef`-keyed because they read pre-cutover messages only).

Founder live-active assistants (e.g. the `2f8cf38e-a6d9-4609-b83a-2b748246fcec` analytics assistant) are included in the audit fixture. Skill content that embeds `fileRef` in static prompt text is rewritten as part of the implementation slice that ships the tool guidance changes (slice 5).

## Scope fence

**In scope (D1–D13 above):**

- bash as default shell for the `shell` tool.
- `files.write` / `read` / `list` / `preview` / `attach` repointed at the new `/shared/` + `/workspace/` layout via control-plane primitives.
- Per-`businessWorkspaceId` `/shared/` volume with `input/` + `outbound/<assistant>/` substructure, `self` symlink, and FS-level read-only protection for sibling outbound subdirs.
- `image_generate` / `image_edit` / `document` dual-write into `/shared/outbound/self/` + existing chat delivery.
- `files.attach({path})` explicit publish tool for arbitrary file types.
- Context-economical developer manifest (summary header + on-demand listing) with cached `shortDescription` per file.
- `/workspace/chats/<chatId>/` chat-scoped scratch namespace.
- Egress allowlist expansion for HTTPS pull/clone/fetch from GitHub + PyPI + npm.
- Exec image preinstalls `node` + `npm`; `pip install --user` and `npm install` ergonomics documented in tool guidance.
- Snapshot layering + warm pool with explicit latency budget.
- GC lifecycle for chat / assistant / business-workspace deletion.
- Audit events + metrics for the new file flow.
- One-shot migration audit script and report.

**Out of scope (deliberately deferred):**

- **PersAI-managed credentials for `git push`** (no injected PAT, no per-assistant credential helper). `git push` itself is allowed (Resolved decisions §1, amended 2026-06-23), but the model must bring its own auth — PersAI does not provision GitHub tokens.
- **Cross-`businessWorkspaceId` file sharing.** `/shared/` is per business workspace; tenant boundaries remain hard.
- **Git over SSH.** Requires private-key storage in the sandbox, conflicts with ADR-123 D2.
- **GitHub Actions / private repo PAT.** Same secret-storage concern.
- **GitLab / Bitbucket / arbitrary git hosts.** One-line follow-up when demand emerges.
- **Multi-assistant locked write to a sibling's outbound.** Sibling outbound stays strictly read-only for non-owners; explicit hand-off goes through `files.attach` re-publish.
- **Tree / `.gitignore`-aware `files.list`.** v1 hides a fixed system-noise set; richer ignore rules are a follow-up.
- **Webhooks / inbound HTTP into the sandbox.** Ingress remains denied (ADR-123 NetworkPolicy `Ingress: none`).
- **Persistent `~/.bashrc` / dotfiles outside `/workspace`.** The model can stash a `/workspace/.bashrc` and source it explicitly.
- **Real-time cross-assistant notifications** (e.g. "Аналитик published forecast.csv"). Cross-assistant visibility is poll-based via `files.list` in v1; reactive cross-assistant signals are an ADR-on-top.

## Migration / data plan

**There is no data migration of `assistant_files` rows.** Founder-stated condition: "у меня реально комерческих user пока нет можно сделать сразу чисто" → prod-first cutover with **no transitional fallback** and **no dual-write** of `files.*` to both `assistant_files` and the new mounts. `assistant_files` rows from before the cutover render in history as-is (read-only back-compat); new `files.*` calls after the cutover do not produce them.

What does happen as part of the cutover:

- One-shot **plan-baseline data migration** raises every existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit` below 500 MB to exactly 500 MB and seeds `sharedStorageBytesLimit = 500 MB` on every plan that does not yet carry it. Plans at or above the ceiling are untouched. The migration is in slice 5.
- The **migration audit script** (D13) is run against the live `persai-dev` DB and reports zero outstanding active-surface `fileRef` references before the program's final push.
- The **upload pipeline** for chat-attached files (web + Telegram) is updated in slice 3 to also stream the bytes into `/shared/input/<resolved-name>` at upload time, with the resolved on-disk path persisted in `assistant_files.metadata.workspaceRelPath`. This is the only path by which `assistant_files` and the new mounts touch each other — the row is a delivery record, not a file mirror.
- The control-plane GCS snapshot for `/shared/` is created lazily on first write per `businessWorkspaceId`; no bulk pre-provisioning. Existing snapshots for `/workspace/` stay where they are.

## Threat model — what changes and what doesn't

### Unchanged (locked by ADR-123, preserved by ADR-126)

- **gVisor kernel isolation** of the execution unit.
- **No real secrets in the exec pod env.** The control plane still holds `DATABASE_URL` / `PERSAI_INTERNAL_API_TOKEN`; the egress proxy still injects scoped credentials where needed.
- **Deny-all egress by default + HTTPS-only allowlist.**
- **Per-`(assistantId, workspaceId)` exec pod + Postgres workspace lease** (single-flight per workspace).
- **NetworkPolicy `Ingress: none`** for the exec pod.
- **Cross-tenant isolation** remains hard: `/shared/` is scoped to a single `businessWorkspaceId`, mounted only into pods of assistants belonging to that workspace.

### Net new risk + mitigation

| Risk | Mitigation |
| --- | --- |
| `files.write` now actually writes into the live exec pod's `/workspace` or `/shared/outbound/self/`. A path-traversal bug (`../`) could let model code escape into the read-only root FS. | Control plane normalizes every `files.*` path argument against the allowed prefixes (`/shared/outbound/<self>/`, `/workspace/...`) **before** issuing the pod write — same argv hardening already used by `grep` / `glob` (ADR-123 Slice 7). Root FS remains `readOnly:true` (ADR-123 D1); a successful traversal only reaches `tmpfs` or the allowed mounts. |
| A compromised assistant pod could read sibling assistants' `/shared/outbound/<other>/` files. | **Accepted within the same `businessWorkspaceId`.** All sibling assistants belong to the same user / B2B workspace; intra-workspace isolation is not a goal. Cross-tenant isolation (different `businessWorkspaceId`) stays hard: different GCS prefix, different mount, different NetworkPolicy. |
| A compromised assistant could overwrite a sibling's outbound. | FS-level `0555` on sibling outbound subdirs (control plane sets this at mount time per pod identity). Tool-level path validation in `files.write` / `files.attach` rejects writes outside `/workspace/` and `/shared/outbound/self/`. |
| A compromised assistant could overwrite user uploads in `/shared/input/`. | `/shared/input/` mounted `0444` per pod (read-only). Tool-level validation rejects writes. User uploads are atomic at the control-plane upload endpoint. |
| Egress to GitHub / PyPI / npm widens the supply-chain surface. A malicious npm/PyPI package could `curl --proxy …` against the allowlist itself. | Egress proxy stays HTTPS-only + deny-all + allowlist. The proxy logs every egress request with `(assistantId, businessWorkspaceId, chatId, tool, target, bytes)` so a post-hoc audit can identify exfiltration patterns. The "no real secrets" rule of ADR-123 D2 prevents a compromised package from stealing a PersAI token. |
| `git push` would let model code stage and publish workspace content to a public host. | **Accepted by design** (amended 2026-06-23, matches Claude Code's posture). The exec pod carries no PersAI provider tokens and no injected GitHub credentials (ADR-123 D2). A `git push` succeeds only if the model itself supplies valid auth in-prompt or via a model-authored `~/.gitconfig` — i.e. the model deliberately uses its own / the user's PAT. The proxy still enforces the host allowlist (push to non-allowlisted hosts like `gitlab.com` is denied at the network layer, same as any other request). Push to GitHub without auth fails at GitHub's 401 (application layer). The no-credentials rule plus the deliberate-action threshold (model must paste / fetch a PAT) is the threat-model boundary. |
| Model writes into `/workspace/.npm-global/bin` and later `pip install`s a package that overrides a system binary. | `/opt/venv` and `/usr/local/bin` remain on root FS (`readOnly:true`); the session-scoped `/workspace/.local/bin` and `/workspace/.npm-global/bin` come **after** system paths on `PATH` for system binaries, **before** for user binaries. Preserves existing 2026-06-21 PATH layout. |
| Larger `/workspace/` and new `/shared/` due to `node_modules/` / `.venv/` / git clones blows the GCS snapshot cost. | Snapshot layering (D10) deduplicates the install layer across cold starts. Workspace cap (D7) stays plan-managed; jobs that exhaust the per-plan cap get a clean `workspace_quota_exhausted` / `shared_quota_exhausted` error, not silent loss. |
| Cached `shortDescription` becomes stale when the model rewrites a file. | `files.preview` cache and the manifest description are keyed by `(path, content_hash)`; on rewrite the cache invalidates without an explicit bust call. cheap-LLM description regeneration is deferred — preview reads the live first-N-bytes / vision call. Background regeneration is a follow-up (it does not block correctness, only token economy). |

## Implementation plan (drafted here, not yet executed)

ADR ships **doc-only**. Implementation is a separate bounded program of six slices, one push at the very end (program-style, mirroring ADR-123). Slice sketch for the future session:

- **Slice 1 — Image: bash + Node 22 + path/dotfile defaults + warm-pool entry.** `apps/sandbox/exec-image/Dockerfile` adds bash as `/bin/sh` (or shell tool invokes `/bin/bash -lc`), installs `nodejs` + `npm` from NodeSource `setup_22.x`, configures `/workspace/.npm-global` as the npm prefix, image self-checks for `bash -c '[[ 1 ]]'`, `node --version` (= `v22.*`), `npm --version`. Adds the warm-pool registration hook in `apps/sandbox` lease scheduler (size 1 per assistant, configurable). No model-facing contract change yet beyond `shell` semantics.

- **Slice 2 — Egress allowlist expansion + log shape extension** (amended 2026-06-23: git push deny removed). `infra/helm/values-dev.yaml` `egressProxy.allowedDomains` adds `.npmjs.com` (apex + subdomains, covers the npm website + auth endpoints; `registry.npmjs.org` is already there as the actual install target). PyPI hosts, GitHub hosts (`.github.com`, `.githubusercontent.com`), and the npm registry are already on the list from the 2026-06-21 ADR-123 follow-up. Squid `access_log` shape extended with a static `tool=shell` attribution per D12 (exec-pod outbound is exclusively shell-initiated through the `HTTP_PROXY` env; richer per-tool attribution for control-plane operations — `image_generate`, `document`, `files.*` — lives in control-plane logs, not the egress proxy log). **No SSL bumping. No CA lifecycle. No method/URL filtering inside HTTPS.** Smoke tests: `git clone https://github.com/sindresorhus/awesome.git` over HTTPS succeeds; `git push` to a model-supplied authed URL succeeds (or returns 401 from GitHub when auth is absent — application-layer, not proxy-layer); non-allowlisted hosts (e.g. `gitlab.com`) are denied at the proxy by SNI; `pip install rich` and `npm install left-pad` succeed.

- **Slice 3 — Unified files contract + `/shared/` mount + control-plane primitives + upload-time hydrate + GC hooks + audit events.** Sandbox control plane gains dedicated primitives `workspaceFileWrite({pod, mount, relPath, bytes})`, `workspaceFileRead`, `workspaceFileList`, `workspaceFileStat`, `workspaceFileDelete` — these run on the control plane (like `grep`/`glob`), invoking the K8s exec API for tiny `dd` / `cat` / `find` / `rm` rather than spawning a model-visible shell. Per-pod mount of `/shared/<businessWorkspaceId>/` with `self` symlink and `0555` on sibling outbound subdirs. `RuntimeFilesToolService` is rewritten end-to-end: `assistant_files` reads/writes via the `files.*` tool are deleted (no transitional dual write); paths are normalized + clamped to allowed prefixes. The chat-upload pipeline (web + TG) streams uploads into `/shared/input/<resolved-name>` at upload time and persists `metadata.workspaceRelPath`. GC hooks for chat / assistant / business-workspace deletion are wired into the existing lease-expiry sweeper. Audit events (`workspace_file_written`, `workspace_file_read`, `shared_outbound_published`) and Prometheus metrics from D12 are emitted. Tests cover: control-plane primitives, path normalization (including the `..` and absolute-escape rejections), upload-time hydrate end-to-end, sibling read-only enforcement, GC of chat scratch / assistant outbound / business-workspace shared volume, and the founder's exact failure case (`files.write({path:"foo"}) → shell({command:"cat foo"})` returns the bytes).

- **Slice 4 — Artefacts in `/shared/outbound/self/` + `files.attach`.** `image_generate`, `image_edit`, and `document` are extended to write the produced file into `/shared/outbound/self/<basename>` via the control-plane primitives in addition to the existing `assistant_files` chat delivery. `RuntimeFilesToolService` gains the `attach({path})` action with the copy-into-shared semantics from D6. `assistant_files.metadata.workspaceRelPath` is populated on every artefact write so the runtime can resolve `fileRef → path` for legacy `assistant_files` consumers. Tests cover end-to-end: `image_generate(prompt) → files.read("/shared/outbound/self/<basename>") → shell python3 PIL postprocess → files.attach("/workspace/edited.png") → assistant_files row + chat delivery`.

- **Slice 5 — Tool catalog + runtime guidance + manifest + cheap-LLM short-description + migration audit + plan baseline bump.** `apps/api/prisma/tool-catalog-data.ts` rewrites `files.modelUsageGuidance` and `shell.modelUsageGuidance` per D2/D4/D8/D9 (workspace-path mental model + `/shared/` vs `/workspace/` discipline + `files.attach` usage + `pip install --user` / `npm install` / `git clone` examples + `git push` works if the model supplies its own auth — no PersAI credentials injected). Runtime adds the developer manifest construction per D8 (summary header + current-turn-attachments inline). Cheap-LLM `shortDescription` pipeline runs at upload / artefact-write and persists into `assistant_files.metadata.shortDescription`; `files.list` reads from cache. The one-shot **migration audit script** from D13 runs against the live `persai-dev` DB and prints the active-surface `fileRef` report; the slice **does not push** until the report is empty for active surfaces. The plan-baseline data migration (workspace ≥ 500 MB, shared = 500 MB) ships alongside. Tests pin both guidance strings, the manifest shape, the description pipeline (mocking cheap-LLM), the migration script's empty-report acceptance, and the data migration on a low-cap / high-cap plan fixture.

- **Slice 6 — Snapshot layering finalisation (optional micro-slice).** Layered snapshot push/pull from D10 is implemented or — if it falls out of slice 3 naturally because the layering is a small change on top of the existing tar.gz path — folded into slice 3 at dispatch time. The implementer's call at the time of dispatch, not an architectural decision.

Each slice ends on the AGENTS gate (lint × all packages + format + typecheck × 4 + relevant tests + new tests for the new logic). Program is pushed only after slice 5 (and 6 if present) lands clean.

## Acceptance criteria (to be checked when implementation lands)

A successful ADR-126 v2 implementation must satisfy **all** of the following on live `persai-dev`:

1. `shell({command:"echo {a,b,c}"})` returns `a b c` (brace expansion in bash, was 1 literal in dash).
2. `shell({command:"[[ 1 ]] && echo ok"})` returns `ok`.
3. `files.write({path:"hello.txt", content:"hi"}) → shell({command:"cat hello.txt"})` returns `hi` (the founder's exact failure case from 2026-06-22).
4. `shell({command:"git clone --depth 1 https://github.com/sindresorhus/awesome.git"})` succeeds.
5. `shell({command:"pip install --quiet rich && python3 -c \"import rich; print(rich.__version__)\""})` succeeds; the installed package is visible under `/workspace/.local/`.
6. `shell({command:"npm install --silent left-pad && node -e \"console.log(require('left-pad'))\""})` succeeds; the package lands under `/workspace/node_modules/`.
7. `shell({command:"git push https://<user>:<pat>@github.com/<owner>/<repo>.git main"})` succeeds when the model supplies its own auth. Without auth, GitHub returns 401 (application layer) — there is no proxy-level git-push deny in v1 (amended 2026-06-23, matches Claude Code's posture). `git push https://gitlab.com/...` fails at the proxy because `gitlab.com` is not on the host allowlist.
8. A user attaches a PDF in chat → **without any explicit hydrate call** the next runtime turn of **any** assistant in the same `businessWorkspaceId` sees `/shared/input/<original-filename>.pdf` via `files.read` and via `shell ls /shared/input/`.
9. A user uploads `report.pdf` twice → the second occurrence is stored as `/shared/input/report (2).pdf`; the first remains intact.
10. Document artifacts (PDF/XLSX/DOCX) and image artifacts (`image_generate` outputs) continue to render in the chat UI exactly as today AND are also available at `/shared/outbound/self/<basename>` for the producing assistant to post-process.
11. `image_generate({prompt}) → shell python3 PIL postprocess → files.attach("/workspace/edited.png")` end-to-end works: the user sees both the original and the edited image in the chat as attachments.
12. Assistant А generates `/shared/outbound/A/forecast.csv`; in a different chat with the same user, assistant Б runs `shell ls /shared/outbound/A/` and reads the file. Assistant Б attempting `shell({command:"echo > /shared/outbound/A/x"})` fails with `Permission denied` (FS-level enforcement).
13. `files.attach({path: "/shared/input/sales.csv"})` is rejected (`path_not_attachable`); `files.write({path: "/shared/input/x"})` is rejected (`path_not_writable`); `files.write({path: "/shared/outbound/A/x", attemptedBy: B})` is rejected (`path_not_writable`).
14. Historical chats (predating the cutover) still render their existing `files.*` references correctly (read-only backward compatibility for already-stored `assistant_files`).
15. Cold first `files.write` of a fresh assistant session completes within 8 s p95; warm `files.write` completes within 300 ms p95. The published Prometheus metric `workspace_file_write_latency_ms` matches these bounds in the smoke test.
16. A plan with `sharedStorageBytesLimit < 500 MB` or `workspaceStorageBytesLimit < 500 MB` that activates D4 and exceeds its cap returns a clean `shared_quota_exhausted` / `workspace_quota_exhausted` error from the existing quota guard, not a silent truncation.
17. `files.preview({path:"/shared/outbound/self/foo.png"})` returns a fresh preview after a subsequent `shell convert ... foo.png` overwrites the same path (the new `(path, content_hash)`-keyed cache invalidates without an explicit bust call).
18. The developer prompt for a chat with 100+ files contains a summary header + current-turn attachments only — no full listing. `files.list` returns the structured array with cached `shortDescription` for input / outbound; system-noise paths (`node_modules`, `.venv`, `__pycache__`, `*.pyc`, dotfiles) are hidden unless `includeHidden: true`.
19. A chat is deleted → the assistant's `/workspace/chats/<chatId>/` is purged by the next workspace-lease sweep. An assistant is deleted → its `/workspace/` snapshot is marked for delete with the 7-day grace window and its `/shared/outbound/<handle>/` is moved to `_archived/`. A business workspace is deleted → its `/shared/` snapshot is marked for delete with the 30-day grace window.
20. The migration audit script (D13) returns an empty active-surface report against the live `persai-dev` DB before push. Founder live-active assistants are included in the audit fixture.

## Resolved decisions (founder sign-off 2026-06-22 + 2026-06-23)

Every Open Question carried in the v1 draft of this ADR was decided in the 2026-06-22 session; the multi-assistant / prompt-economy / scratch-namespace / production-grade questions were decided in the 2026-06-23 follow-up. These are the **final positions** the implementation program will execute:

1. **`git push` policy — ALLOWED in v1** (amended 2026-06-23, matches Claude Code / Anthropic's posture). No PersAI credentials are injected into the exec pod (ADR-123 D2 remains), so push to a real host succeeds only when the model supplies its own auth. The proxy continues to enforce the host allowlist; push to non-allowlisted hosts is denied at the network layer. No SSL bumping in the proxy.
2. **Node LTS line — Node 22 LTS** from NodeSource `setup_22.x`.
3. **Git hosts — GitHub only in v1.** GitLab / Bitbucket are one-line follow-ups when demand emerges.
4. **Workspace size cap — stays plan-managed.** Default plan baseline raised to **500 MB** for plans activating D4.
5. **`files.preview` cache key — `(assistantId, businessWorkspaceId, path, content_hash)`.** Replaces today's `fileRef`-keyed cache on the `files.*` path; outbound artefact previews delivered through `assistant_files` keep their existing `fileRef`-keyed cache only for legacy historical rendering.
6. **Multi-assistant model — per-assistant `/workspace/` + per-business-workspace `/shared/`** (founder sign-off 2026-06-23). One sibling assistant sees other siblings' outbound; nobody sees a sibling's `/workspace/`.
7. **Namespacing — by `assistant.handle`, not by skill** (founder correction 2026-06-23). Skills do not partition the outbound namespace.
8. **`self/` symlink** so models do not need to remember their own handle. Strict FS-level `0555` on sibling outbound subdirs.
9. **Naming on collision — numeric suffix `(2)`, `(3)`** (macOS-style), at both upload and artefact-write paths.
10. **`files.attach` is the explicit publish channel** for arbitrary file types out of `/workspace/` and `/shared/outbound/self/`. Implicit auto-attach of `files.write` outputs is **not** introduced.
11. **Developer manifest — summary header + current-turn attachments inline + on-demand `files.list`.** Cached `shortDescription` per file, generated once at upload / write.
12. **Chat-scoped scratch — `/workspace/chats/<chatId>/`** with `shell` default `cwd` set there; reusable scripts in `/workspace/lib/`; install layer remains assistant-scoped.
13. **Snapshot layering + warm pool** with the latency budget (warm ≤ 300 ms p95, cold ≤ 8 s p95).
14. **GC lifecycle** for chat / assistant / business-workspace deletion with grace windows of 0 / 7 / 30 days respectively; runs in the existing lease-expiry sweeper.
15. **Audit events + metrics** for every new file flow surface; tool attribution in egress logs.
16. **Migration audit** is a hard gate on the program's final push.

Each decision above is a hard contract for the implementation program. Any deviation requires re-opening the corresponding question in a new ADR addendum, not a silent slice-level edit.

## Consequences

### Positive

- Sandbox feels like a single Claude-Code-style dev workspace per assistant + a Cursor-style shared project per business workspace — model agency catches up to best-in-class while the multi-assistant B2B story works without re-uploads.
- `shell` is `bash` — the model's mental model from public training data transfers verbatim.
- Public git/PyPI/npm work — the model can clone real libraries and install ad-hoc dependencies, which is the actual production usage pattern of an agent.
- Tool catalog guidance becomes honest about runtime installs and the path-based mental model.
- `assistant_files` retains a clear, narrow role (chat IO boundary) — no longer a confusing "second filesystem".
- The developer prompt no longer scales linearly with the number of files in the chat; 100-file chats remain cheap.
- Chat-scoped scratch keeps per-chat work tidy without losing reusable installs across chats.
- Cold-start latency is bounded by an explicit budget that the implementation slice must verify, not an emergent property.
- GC is explicit per deletion class, with grace windows — operators no longer carry "ghost" sandbox state for deleted entities.
- Audit events and metrics make the new file flow observable from day one.

### Negative / risks

- Egress surface widens; proxy logging + audit hook become the primary detection mechanism for misuse (already in place from ADR-123).
- `/workspace/` and `/shared/` snapshots get larger; GCS storage cost goes up linearly with session activity (bounded by per-plan caps).
- Implementation touches `apps/sandbox` + `apps/runtime` + `apps/api` + tool catalog + Dockerfile + Helm + chat upload pipeline + plan data migration — substantial program, must land clean per program-style (no transitional flag).
- Tool catalog guidance change is a **model-behaviour** change too: the model needs one or two turns to internalize the new "files = workspace path" + `/shared/` vs `/workspace/` mental model. Risk mitigated because the new model-facing description is direct ("everything you write here is also visible from shell").
- Cross-assistant visibility within a `businessWorkspaceId` is **by design**, not a side effect: one compromised assistant in a workspace can read all siblings' outbound and all user uploads. Acceptable because all assistants belong to one user / B2B tenant; cross-tenant isolation stays hard.
- `git push` is allowed in v1 (amended 2026-06-23). The defense against accidental publish is the deliberate-action threshold — the model must supply its own auth in-prompt or via a self-authored config — combined with the no-credentials rule from ADR-123 D2. Reopens (e.g. proxy-level method filtering as defense-in-depth) are explicit ADR addenda, not a silent drift.

## Alternatives considered

- **Dual write (`files.*` writes to both `assistant_files` AND `/workspace/`).** Rejected. AGENTS.md "no parallel code paths" + founder direction "сразу чисто". The whole point is to make the FS singular.
- **Keep `files.*` against `assistant_files` and tell the model "if you want shell visibility, use `shell cat <<EOF`".** Rejected. That is exactly the workaround the model improvised on 2026-06-22; ADR-126 exists to retire it, not bless it.
- **Make `/workspace/` the chat-delivery channel too (delete `assistant_files` entirely).** Rejected. Chat artefacts have UX/quota/sharing/billing semantics distinct from session-scoped workspace files. Conflating them would force a much larger ADR and break ADR-097 / ADR-116 / image-gen flows. `files.attach` solves the only real gap (arbitrary file types) without conflating storage.
- **One global `/workspace/` shared by all sibling assistants in the same business workspace.** Rejected. Erases per-assistant isolation of installs / scratch / scripts; one compromised assistant pollutes everyone's `node_modules`. Pure shared workspace is a Cursor concept, not a multi-agent concept. Per-assistant `/workspace/` + per-business `/shared/` is the right shape.
- **Per-skill outbound namespace (`/shared/outbound/<assistant>/<skill>/`).** Rejected (founder correction 2026-06-23). Skills are modes, not identities. One artefact per assistant, regardless of skill.
- **Lazy hydrate of user uploads on first `files.read`.** Rejected. Eager hydrate at upload time means `shell ls /shared/input/` shows the file immediately, matching Claude Code's drop-into-workspace UX. Lazy hydrate forces the model to know "I should call `files.read` first to surface this", which is exactly the kind of magic invariant we are trying to remove.
- **Eager full-listing in the developer prompt for every chat.** Rejected. Does not scale beyond a handful of files. The summary-header + on-demand `files.list` shape is the standard pattern in best-in-class agent surfaces and is what we adopt.
- **Use Git over SSH for git clone.** Rejected for v1. SSH requires storing a private key in the exec pod env, which conflicts with ADR-123 D2 "no real secrets in execution unit". HTTPS clone covers the public-repo use case.
- **Always run `/bin/bash` but keep `/bin/sh -lc` as the entry point for backward compatibility.** Rejected. The whole point of the bash default is consistent semantics; a `sh` indirection invites the exact dash-vs-bash drift this ADR is closing.
- **Land all thirteen points in one mega-slice.** Possible but rejected for risk control. The 6-slice plan is the conservative breakdown so each lands cleanly on the AGENTS gate; collapsing is an implementer's call at dispatch time, not an architectural decision.
- **Defer `files.attach` to a follow-up ADR.** Rejected. Without `files.attach` the model has no way to deliver arbitrary file types to the user; the `/workspace/` + `/shared/` plumbing works but the round trip from "model produced output" to "user sees it" remains broken for CSV / JSON / zip / script / arbitrary text. `files.attach` is small, well-scoped, and removing it from v1 would force the same gap in production.
- **Defer migration audit (D13) to "we'll see at deploy time".** Rejected. The founder's own active assistants in `persai-dev` carry `fileRef`-laden skill content that will fail silently if not rewritten. A one-shot audit script is cheap and is the only way to guarantee the program is push-safe.
