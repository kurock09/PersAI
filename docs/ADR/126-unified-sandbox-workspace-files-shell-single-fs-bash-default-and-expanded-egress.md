# ADR-126 — Unified sandbox workspace: per-assistant FS + cross-assistant shared volume, bash default, expanded egress, **path identity end-to-end** (v3)

Status: **Accepted v3** — founder sign-off received 2026-06-22 on the original four points (bash default, unified FS, expanded egress, image baseline); 2026-06-23 on the multi-assistant collaboration model, `files.attach`, the prompt-economical file manifest, chat-scoped scratch namespace, snapshot/cold-start budget, GC lifecycle, audit/observability; and 2026-06-23 (late) on the **v3 clean cutover** that retires `assistant_files`, `fileRef`, and `assistant-media/` entirely from the live system. v3 supersedes v2 + Amendment 3 in full. Implementation is a single bounded program (slices 1–3 already landed under the path-only foundation; v3 cutover is one large push on top).

**Amendment 2026-06-23 (during implementation Slice 2) — preserved unchanged in v3.** D3 / Resolved-decisions §1 flipped from "git push denied in v1" to "git push allowed in v1 (matches Claude Code / Anthropic posture)" per founder follow-up. The previous "deny at proxy" mechanism required SSL bumping (custom Squid-OpenSSL image, CA lifecycle, ~150 LOC operational surface) and the founder confirmed the prod product should mirror Claude Code's open-push posture. No PersAI credentials are baked into the exec pod (ADR-123 D2 remains), so push only succeeds with model-provided auth — the model brings its own PAT or short-lived token. The deny rule (POST `/git-receive-pack`) and SSL bump scaffolding are explicitly **NOT** implemented. See D3 amendment block, Acceptance criterion §7 (replaced), Threat model row (replaced), Resolved-decisions §1 (replaced), and Implementation plan Slice 2 (rewritten) below.

**Amendment 2026-06-25 (live-regression fix-up) — model-facing canonical `/shared/...` paths omit the workspaceId segment; api hot-pod-pushes inbound bytes.** Two coupled live-regression fixes after dev rollout of v3:

1. **Path translation.** `resolveUniqueSharedInputStoragePath` (api) and the sandbox `files.attach` result already used the model-facing form `/shared/input/<name>` and `/shared/outbound/self/<name>` — i.e. **without** the workspaceId segment — because the model never sees workspaceId. The pod's physical layout (D2) puts those files under `/shared/<workspaceId>/...`. `assertAllowedMountPrefix` only accepted the wsId-prefixed form, so a model `files.read("/shared/input/3470.png")` after an inbound upload returned `outside_allowed_mount` even when the file existed in the pod. The bridge now translates model-canonical `/shared/...` → pod-physical `/shared/<workspaceId>/...` in `assertAllowedMountPrefix` before the prefix check. Existing wsId-prefixed paths still work (idempotent). Tests in `apps/sandbox/test/workspace-path.test.ts` pin both shapes for input + outbound roles.

2. **Hot-pod inbound bytes-push.** The cold-start hydrate path (`hydrateSharedMountFromGcs`) populates `/shared/<wsId>/input/` only during `ensureSharedMountBootstrapped` — i.e. once per cold pod. A web upload arriving while a pod is already warm never reached the pod's FS, so the model saw "file 0 byte" (the chat-attachment metadata row was correct, but the underlying bytes were not in the pod). The api now best-effort pushes the uploaded bytes through a new sandbox control-plane endpoint `POST /api/v1/jobs/shared-inbound-write` (symmetric to `shared-outbound-write`) immediately after the GCS upload completes. The sandbox uses `ExecPodBridgeService.tryExecShellInExistingSessionPod` to write _only_ into a `Running` pod (never triggers cold-start — `hydrateSharedMountFromGcs` remains the recovery path on the next pod boot), with an atomic `chmod 0744 input/ && cat > input/<basename> && chmod 0444 input/<basename> && chmod 0444 input/` script that respects the bootstrap's D2 access matrix (input dir is 0444 after bootstrap). GCS remains the **single canonical store** for inbound bytes — the api never double-writes; the pod copy is a latency optimisation. Helm `api.env.PERSAI_SANDBOX_BASE_URL` is set to `http://sandbox:3013` in dev (`infra/helm/values-dev.yaml`), and the `sandbox-ingress-runtime-only` NetworkPolicy is extended to allow api as a second pod selector. Failure of the push (sandbox unreachable, pod cold, exec exit ≠ 0) never blocks the upload — it is logged at warn and the cold-start hydrate is the authoritative fallback. No quota accounting on the push hop: `media_storage_quota` on the api side remains the single accounting source for inbound bytes.

Touched files: `apps/sandbox/src/workspace-path.ts` + tests, `apps/sandbox/src/workspace-file-bridge.service.ts` (+ `writeSharedInputControlPlane`) + tests, `apps/sandbox/src/exec-pod-bridge.service.ts` (+ `tryExecShellInExistingSessionPod`), `apps/sandbox/src/sandbox.service.ts` (+ `writeSharedInbound`), `apps/sandbox/src/sandbox.controller.ts` (+ `POST /api/v1/jobs/shared-inbound-write`), `apps/api/src/modules/workspace-management/application/sandbox-control-plane.client.service.ts` (new), `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts` (best-effort hook in `stageForWebThread`), `apps/api/src/modules/workspace-management/workspace-management.module.ts`, `infra/helm/values-dev.yaml` + `infra/helm/values.yaml` (`PERSAI_SANDBOX_BASE_URL` + `PERSAI_SANDBOX_TIMEOUT_MS` on api), `infra/helm/templates/networkpolicies.yaml` (api → sandbox ingress), test fixtures in `apps/api/test/manage-chat-media.*`. No data migration. No model-surface API change. No identity change — file identity remains `(workspaceId, path)`.

**Amendment 2026-06-24 (post-Closure, after independent Opus-4.8 audit) — `assistant-media/` is an operational bucket prefix, not file identity.** The independent auditor (`Opus-4.8`) flagged that ADR D5 / D13 / Migration-plan text says new v3 GCS keys live at `workspaces/<businessWorkspaceId>/shared/...` while live production code (`apps/sandbox/src/sandbox-object-storage.service.ts:22/37/56/68`, `apps/sandbox/src/workspace-gc.service.ts:370`) and Helm values (`infra/helm/values.yaml`, `infra/helm/values-dev.yaml`) prepend the `PERSAI_MEDIA_OBJECT_PREFIX` operational prefix (defaulting to `"assistant-media"`) — so the live shape is `assistant-media/workspaces/<wsid>/shared/<...>`, `assistant-media/assistants/<aid>/sandbox-sessions/<sid>/workspace.tar`. The founder reviewed and confirmed the **operational prefix is config, not identity**: the **file identity** end-to-end is `(workspaceId, path)`, which the code does enforce faithfully; the bucket sub-tree under which path-keyed blobs live is a deploy-time operator choice managed through `PERSAI_MEDIA_OBJECT_PREFIX`. **D13's retired symbol `assistant-media/`** therefore reads, post-amendment, as the **legacy v1/v2 `<fileRef>`-shaped blob layout under that prefix** (`assistant-media/<fileRef>`, `assistant-media/uploads/<filename>`, `assistant-media/generated/<filename>`, `assistant-media/assistants/<aid>/chats/<chatId>/messages/<msgId>/<filename>`, `assistant-media/assistants/<aid>/runtime-output/sessions/<sid>/requests/<rid>/<aid>.<ext>`) — **not** the prefix itself. The v3 sub-trees `assistant-media/workspaces/<wsid>/shared/...` and `assistant-media/assistants/<aid>/sandbox*/...` are v3 production keys and are preserved. The wipe runbook (`infra/dev/gke/ADR-126-V3-GCS-WIPE-RUNBOOK.md`) reflects this: the founder-approved option for the dev cluster is a hard wipe of the whole `assistant-media/` prefix (legacy + any v3 dev state) and a re-bootstrap from a clean slate, which is operationally simplest given there are no commercial users and v3 dev state is regeneratable. Operators retain the option to set `PERSAI_MEDIA_OBJECT_PREFIX=""` (bucket root) at a future deploy to physically separate v3 keys from any remaining historical sub-tree; that is a one-line Helm change with no code follow-up.

**Why v3 supersedes v2 + Amendment 3 (2026-06-23, late).** v2 kept `assistant_files` as a "chat IO delivery layer" — a parallel reckoning of files alongside the sandbox FS. Amendment 3 reduced that table to "metadata-only delivery row" but left it standing, kept `fileRef` UUID as identity on the chat-UI side, and left the legacy `assistant-media/<fileRef>` GCS prefix as a passive read-only back-compat. The founder identified this as a half-measure ("МНЕ НУЖНА ЧИСТАЯ НОВАЯ ФАЙЛОВАЯ СИСТЕМА А НЕ ХУЙНЯ ЭТА") and rejected the compromise: there is to be **one** identity for a file, end-to-end, and that identity is its **`(workspaceId, path)`** pair. No `fileRef` UUID anywhere. No `assistant_files` table. No `assistant-media/` GCS prefix. No `materializeMountedFiles` document-tool staging into `/workspace/`. No two code paths for "new" vs "historical" rows. v3 captures this directly: full clean cutover, no transitional shims, no parallel structures, no follow-up tail. The dev-only window (no commercial users) is the explicit reason this is feasible without a data migration project.

Date: 2026-06-23 (v3 supersedes v2 of 2026-06-23 and v1 doc-only draft of 2026-06-22)
Supersedes: ADR-126 v2 + Amendment 3 (2026-06-23). Refines long-term system truth set by ADR-123. Retires the v2 wording around `assistant_files` / `fileRef` / `assistant-media/`.
Superseded-by: none

## Relates to

- **ADR-123** (Native sandbox runtime — isolation, network, document execution) — **closed**. ADR-126 reopens **only the sandbox surface** (files contract + shell defaults + egress allowlist + cross-assistant workspace shape) without reopening isolation/lifecycle/document program decisions, which stay locked. The per-`(assistantId, workspaceId)` exec pod model from ADR-123 D4 stands; ADR-126 v3 adds a sibling shared volume on top, not in place of it.
- **ADR-081** (unified user-files architecture) — **superseded by ADR-126 v3 for the chat-IO file surface.** ADR-081 introduced `assistant_files` as the source of truth for chat input/output artifacts; v3 retires that model. The single source of truth becomes the sandbox FS (`/shared/<wsid>/...` + `/workspace/<aid>/<wsid>/...`) with one mirrored GCS prefix per workspace; chat-attached files are referenced by `(workspaceId, path)` directly. `assistant_files` table is **dropped** (no commercial-user blocker, founder dev-only window). The cache layer (`shortDescription`, `contentHash`, mime/size memoization) moves to a new `workspace_file_metadata` table keyed by `(workspaceId, path)`.
- **ADR-097** (autonomous document tool) — document artifacts land in `/shared/outbound/self/<basename>` as the **single** source of bytes; chat attachment row references the canonical path; no second per-file GCS blob, no `assistant_files` row. The same assistant post-processes the artefact in place.
- **ADR-116** (runtime file re-view / inspect / read / preview) — preview pipeline keyed by `(assistantId, workspaceId, path, content_hash)` end-to-end; the `fileRef`-keyed preview cache is **deleted** along with the rest of the `fileRef` surface (no v3 leftovers).
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

ADR-126 v3 закрывает каждый пункт явным разделом ниже.

## Context — audited current state (file:line)

### Two filesystems, one logical workspace

| Layer                                                   | Backing                                                             | Mutator                                                                                                                                                                                               | Reader                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Files (`files.write` / `read` / `list` / `preview`)** | `assistant_files` Prisma table → GCS object store (ADR-081)         | `RuntimeFilesToolService` via internal API endpoint, never touches the sandbox pod                                                                                                                    | API `GET /assistant/chats/web/:chatId/files/:fileRef` + runtime hydration                           |
| **Sandbox shell (`shell` / `exec` / `grep` / `glob`)**  | Per-`(assistantId, workspaceId)` exec pod `/workspace` (ADR-123 D4) | Sandbox control plane pushes a tar of the control-plane workspace shadow into the pod before each job (`workspace-push.service.ts`); the model writes files _inside_ the pod via `bash` / `python3 …` | Sandbox control plane pulls a tar of `/workspace` back after each job (`workspace-pull.service.ts`) |

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

Chat deletion today does not clean up per-chat workspace artefacts (none exist yet because the model has nowhere to put them — see D9). Assistant deletion clears `/workspace` snapshot eventually via lease expiry. Business-workspace deletion has no documented lifecycle for sandbox state. ADR-126 v3 makes each layer explicit.

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

| Path                         | Writer                                                                      | Readers                                      |
| ---------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `/shared/input/`             | User uploads (via control plane at upload time) — `0444` for assistant pods | All assistants in this `businessWorkspaceId` |
| `/shared/outbound/<self>/`   | The owning assistant only — `0755` for that pod, `0555` for sibling pods    | All assistants in this `businessWorkspaceId` |
| `/shared/outbound/<other>/`  | (Other assistant only; this pod cannot write)                               | This pod, read-only                          |
| `/workspace/`                | This assistant only                                                         | This assistant only                          |
| `/workspace/chats/<chatId>/` | This assistant only, only during turns of this chat                         | This assistant only                          |

`/shared/outbound/self` is a per-pod symlink that resolves to `/shared/outbound/<this-assistant-handle>/`. The model writes to `self`, reads siblings by explicit handle. Skill is **not** a partition: an assistant has one outbound subdir regardless of how many skills it carries.

#### Contract change for `files.*` (single-shot, no transitional dual write)

| `files.*` action         | Was                                                                    | Becomes                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write({path, content})` | `assistant_files` row + GCS upload, surfaced to the model as `fileRef` | Direct write into the resolved pod path via the sandbox control plane (`workspaceFileWrite` primitive — see Implementation plan). Allowed prefixes: `/workspace/...` and `/shared/outbound/self/...`. Writes to `/shared/input/` or `/shared/outbound/<other>/` return `path_not_writable`. Path is normalized against the prefix (no `..`, no absolute escapes). |
| `read({path})`           | Reads `assistant_files` GCS object by `fileRef`                        | Reads `/shared/...` or `/workspace/...` from the assistant's pod. Same containment + size cap.                                                                                                                                                                                                                                                                    |
| `list({path?})`          | Lists `assistant_files` for the current chat                           | Lists the requested path (defaults to a multi-root listing: `/shared/input/`, `/shared/outbound/`, `/workspace/`). Hides system noise by default — see D11/manifest section below.                                                                                                                                                                                |
| `preview({path})`        | Renders preview from `assistant_files` object by `fileRef`             | Renders preview from the pod path. Existing preview pipeline (ADR-116) is repointed at `/shared/` + `/workspace/` via the control plane.                                                                                                                                                                                                                          |
| `attach({path})`         | (did not exist)                                                        | See D6.                                                                                                                                                                                                                                                                                                                                                           |

The model **never sees a `fileRef`** for files in the `files.*` tool surface. It sees paths.

#### Naming and collision

- User upload `report.pdf` arriving twice in the same `businessWorkspaceId` → `report.pdf`, `report (2).pdf`, `report (3).pdf` (macOS-style numeric suffix). The control plane assigns the suffix at upload time; the resolved on-disk basename becomes the `storagePath` of the `assistant_chat_message_attachment` row and the `path` of the `workspace_file_metadata` row.
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

### D5 — Artefacts land in `/shared/outbound/self/` as the single source of bytes; chat attachment is path-keyed (v3)

`image_generate`, `image_edit`, and `document` (autonomous PDF/XLSX tool, ADR-097) write each produced artefact **exactly once**, end-to-end:

1. The generated file is materialized at `/shared/outbound/<self>/<basename>` inside the assistant pod's view of the shared volume, and at the corresponding GCS key `workspaces/<businessWorkspaceId>/shared/outbound/<handle>/<basename>`. The GCS write IS the persistence; the pod path IS the live working-set view of the same bytes. The basename is deterministic, collision-resolved with the numeric-suffix rule.
2. A `workspace_file_metadata` cache row is upserted: `{ workspaceId, path, mimeType, sizeBytes, contentHash, shortDescription, createdAt }`. Keyed by `(workspaceId, path)`. This is a pure cache — wipeable and reconstructable from the FS at any time. **No `assistant_files` row.** **No `fileRef` UUID anywhere.**
3. An `assistant_chat_message_attachment` row is created against the originating chat message: `{ messageId, chatId, assistantId, workspaceId, storagePath = "/shared/outbound/<handle>/<basename>", attachmentType, mimeType, sizeBytes, originalFilename, processingStatus = "ready", metadata.kind = "image_generate" | "image_edit" | "document" }`. `storagePath` is the canonical FS path — not a GCS object key, not a UUID.
4. The chat UI rendering channel receives the new attachment via the existing SSE/REST projection; the payload carries `{ path, mimeType, sizeBytes, displayName, kind }` (no `fileRef`). The chat-UI download endpoint is `GET /assistant/chats/web/:chatId/files?path=<path>` — one code path, path validated against the chat's attachment rows, bytes streamed from the shared GCS key derived from `(workspaceId, path)`.

Result: the model can `files.read("/shared/outbound/self/<basename>")` immediately after generation and post-process the artefact (resize an image, add a watermark, append a row to a CSV, embed a chart into a follow-up document) — the cross-tool dead end disappears. There is **no second GCS object** for any artefact — chat-UI rendering and `files.read` operate on the same bytes. There is **no parallel DB reckoning** of files — the FS is the registry; `workspace_file_metadata` is a regeneratable cache; `assistant_chat_message_attachment` is the chat-membership relation, not a file identity.

`image_generate` and `image_edit` continue to call their provider exactly once (no double LLM call, no double provider cost); the provider's returned bytes are written directly to the shared GCS key via the control-plane primitive. `document` writes its produced PDF/XLSX/DOCX to the shared GCS key in the same fashion.

### D6 — `files.attach({path})` — publish a workspace path to the chat, path-only (v3)

New tool action on `files.*`. Accepts a path under `/workspace/` or `/shared/outbound/self/` (anything else → `path_not_attachable`). Behavior:

1. If the path is under `/workspace/`, the sandbox control plane copies the file to `/shared/outbound/<self>/<basename>` (collision-resolved). The copy lands at the corresponding GCS key `workspaces/<businessWorkspaceId>/shared/outbound/<handle>/<basename>` as the single source of bytes (pod-side `cp -f` + GCS mirror, both atomic, both inside the `workspaceFileCopy` primitive). The original stays in `/workspace/` and remains private.
2. If the path is under `/shared/outbound/self/`, no copy is needed — it is already in the cross-assistant-visible zone and the GCS key already exists.
3. `workspace_file_metadata` is upserted for the final shared-outbound path (cache row, same shape as D5 step 2).
4. An `assistant_chat_message_attachment` row is created against the current chat message with `storagePath = "/shared/outbound/<handle>/<basename>"` and `metadata.kind = "files.attach"`. Same shape as D5 step 3. **The API layer does NOT download bytes and does NOT re-upload them to any second location.** **No `assistant_files` row.** **No `fileRef` UUID.**
5. The UI rendering channel receives the new attachment via the existing SSE/REST projection; payload is `{ path, mimeType, sizeBytes, displayName, kind }`. Chat-UI download/preview targets the path-based route.

This closes the "model produced a useful CSV/JSON/zip/script — how does the user get it?" gap that `document` (PDF/XLSX only) and `image_generate` (images only) leave open. The model now has one explicit publish action, not a workaround through `document` or by inlining a code block.

`files.attach` is **the only** path-to-chat delivery for arbitrary file types in v3. There is no implicit auto-attach of files written through `files.write`; the model chooses what to ship.

### D7 — Quota model for the new layout

Two quotas, two error classes, one resolution path.

- **`/workspace/` quota** — per assistant, plan-driven (existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit`, resolved into `bundle.governance.quota.workspaceQuotaBytes`). Implementation slice raises the default plan baseline to **500 MB**. Exhaustion → `workspace_quota_exhausted` from the existing quota guard.
- **`/shared/` quota** — per `businessWorkspaceId`, plan-driven via a new key `planCatalogPlan.billingProviderHints.quotaAccounting.sharedStorageBytesLimit`, resolved into `bundle.governance.quota.sharedQuotaBytes`. Default plan baseline **500 MB**. Exhaustion → `shared_quota_exhausted` (new error class; same surface contract as `workspace_quota_exhausted`).
- Operators continue to tune per-plan caps via the existing billing-hints code path. No new cap mechanism is introduced — only the second key.

### D8 — Context-economical file manifest (developer prompt does not embed full listing)

The developer-prompt file manifest is rewritten:

- The prompt embeds a **summary header** only — `{ totals: { input: 8, outbound: { self: 5, siblings: 12 }, workspace_chats: 3 }, byKind: { image: 7, pdf: 5, csv: 6, other: 10 } }` plus a hint string: _"Use `files.list({path})` to enumerate; `files.preview({path})` for content preview."_
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

`shortDescription` is materialized once at upload / write time and persisted to `workspace_file_metadata.shortDescription` keyed by `(workspaceId, path)`:

- User uploads → cheap-LLM/OCR pipeline runs at upload, upserts the metadata row. Image → vision-LLM caption (one sentence); PDF → OCR-extract of first page + LLM summary; CSV → header peek + row count; binary → MIME + size.
- Artefacts from `image_generate` / `document` / `files.attach` → description from the originating tool's own context (`image_generate.prompt`, `document.title`, etc.), persisted at write time into the same `workspace_file_metadata` row.
- Excluded from cheap-LLM description: files in `node_modules/`, `.venv/`, `.local/`, `.cache/`, `.npm-global/`, `__pycache__/`; files matching `*.pyc`, `*.log`, `*.lock`, `*.tmp`; files larger than 8 MiB.

The cache is regeneratable from the FS at any time — wiping `workspace_file_metadata` does not lose any chat-IO byte; it only forces re-description on next list. There is no `assistant_files`-style row whose loss would orphan an attachment.

`files.list` by default **hides** the same system-noise set (`node_modules/`, `.venv/`, dotfiles, `__pycache__/`, `*.pyc`, etc.). `includeHidden: true` surfaces them when explicitly needed.

The `files.modelUsageGuidance` block in the tool catalog is rewritten to teach this mental model: _"This tool reads and writes paths under `/shared/` and `/workspace/`. `/shared/input/` contains user uploads (read-only). `/shared/outbound/self/` is where you publish artefacts visible to the user and other assistants. `/workspace/` is your private scratch. Everything you write here is also visible from `shell`, `grep`, `glob` at the same path. To deliver a file to the user in the chat UI, use `files.attach({path})`."_

### D9 — Chat-scoped scratch namespace: `/workspace/chats/<chatId>/`

Within the per-assistant `/workspace/`:

- `/workspace/lib/` — assistant-scoped, persists across chats. The model places reusable scripts and helpers here.
- `/workspace/chats/<chatId>/` — chat-scoped. The model places plan files, intermediate data, plot images, and any other turn-specific artefact here. The runtime sets `cwd` of `shell` to this directory by default at the start of each turn.
- The install layer (`/workspace/.local/`, `/workspace/.npm-global/`, `node_modules/`, `.venv/`) remains assistant-scoped because pip / npm installs are an investment we do not want to redo each chat.

Tool guidance instructs the model: _"Your plan, scratch, and intermediate artefacts for the current chat belong in `/workspace/chats/<chatId>/` (your shell starts there). Reusable scripts you want to keep between chats go in `/workspace/lib/`. Artefacts for the user go through `files.attach` or directly through `image_generate` / `document`."_

GC for `/workspace/chats/<chatId>/` is covered in D11.

### D10 — Snapshot strategy and cold-start budget

ADR-126 v3 introduces two snapshot domains.

- **`/workspace/`** — per-`(assistantId, workspaceId)`, existing tar.gz path from ADR-123 D4. Switches to **layered snapshots**:
  - Layer A (install): `/workspace/.local/`, `/workspace/.npm-global/`, `node_modules/`, `.venv/`. Snapshotted only when changed (content-hash over `pip freeze` / `package-lock.json` / `requirements.lock`); when unchanged, the cold-start path reuses the previous tar.gz blob by pointer.
  - Layer B (scripts + scratch): `/workspace/lib/`, `/workspace/chats/`. Always snapshotted (small).
  - Excluded entirely: `__pycache__/`, `*.pyc`, `*.log`, `/tmp/` (already tmpfs).
- **`/shared/`** — per-`businessWorkspaceId`, new snapshot path with the same layered approach. `/shared/input/` versioned per user upload (immutable on rename collision); `/shared/outbound/<assistant-handle>/` snapshotted per assistant turn.
- **Warm pool** — the implementation slice introduces a warm-pool of exec pods per assistant (size 1, configurable per plan tier) so that the first `files.write` of a session does not pay a cold pull cost. ADR-123 D4 already names a warm-node hook; ADR-126 wires it.

**Budget**: warm `files.write` ≤ 300 ms p95; cold first `files.write` (no warm pod) ≤ 3 s p95 for an install-layer-cached assistant, ≤ 8 s p95 for a fresh assistant. These are commitments the implementation slice must verify with a load smoke test before push.

### D11 — GC lifecycle (chat / assistant / business workspace deletion)

Explicit retention pipeline for the new state.

- **Chat deletion** → `/workspace/chats/<chatId>/` is removed at next workspace-lease release for the owning assistant. `assistant_chat_message_attachment` rows attached to that chat are deleted by the existing cascade; the `workspace_file_metadata` cache rows for paths under the chat's scratch are evicted in the same sweep. No new retention class.
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
- `snapshot_cold_pull_latency_ms` histogram, labelled `{layer}` (`session` | `shared`). The session layer covers per-session snapshot overlay restoration (the only persistent per-pod snapshot layer in v3); the shared layer covers the `/shared/<workspaceId>/` mount hydrate. Earlier ADR drafts named three layers (`install` | `scratch` | `shared`); v3 collapses install/scratch into the single session-scoped restore because there is no separate per-assistant install layer in the unified-workspace model.
- `shared_quota_bytes_used` gauge, labelled `{businessWorkspaceId}`.
- `workspace_quota_bytes_used` gauge, labelled `{assistantId}` (existing label set).

The egress-proxy log shape (ADR-123 D3) is extended with `{ tool: "files.write" | "shell" | "image_generate" | "document" | "files.attach" }` to attribute each network call to its source tool.

### D13 — Migration audit for retired `fileRef` / `assistant_files` / `assistant-media/` surfaces (v3)

Before the v3 cutover push, the audit script scans the **entire** repository and the live `persai-dev` DB for residual references to any of the retired symbols. The set is closed and exhaustive:

- `fileRef`
- `assistant_files` (and the Prisma model `AssistantFile`)
- `assistant-media/<fileRef>` GCS blob layout (the legacy `<fileRef>`-shaped objects under the `PERSAI_MEDIA_OBJECT_PREFIX` bucket subtree — including `assistant-media/uploads/<filename>`, `assistant-media/generated/<filename>`, `assistant-media/assistants/<aid>/chats/...`, `assistant-media/assistants/<aid>/runtime-output/...`). The **operational bucket prefix `PERSAI_MEDIA_OBJECT_PREFIX` itself** is not retired — it is a deploy-time config knob that may default to `"assistant-media"` to keep prior operator runbooks unchanged. v3 production keys are path-keyed under `<prefix>/workspaces/<wsid>/shared/...` and `<prefix>/assistants/<aid>/sandbox*/...`, where the file identity is `(workspaceId, path)` and the prefix is operator-chosen. See "Amendment 2026-06-24 (post-Closure)" at the top of this ADR.
- `AssistantFileRegistryService` / `RuntimeAssistantFileRegistryService`
- `materializeMountedFiles` / `mountFileRefs`
- `ensureUploadedFile` / `ensureAttachmentFile` / `ensureAttachmentBackedFile`
- `buildFileRefKey`

Search surfaces:

- All `apps/`, `packages/`, `prisma/` source (TS/JS/SQL/JSON/YAML).
- `apps/api/prisma/tool-catalog-data.ts` and `apps/api/prisma/bootstrap-preset-data.ts` for literal occurrences in any model-facing string.
- All persisted `AssistantSkill` rows in `persai-dev` for skill prompts / scenario steps mentioning any of the symbols.
- All persisted `RuntimeBundleState.materializedSpec.runtimeBundle.governance` JSON in `persai-dev`.
- `apps/web` chat history rendering and download/preview hooks.

Output: a flat report `path:line` of every hit. **The v3 cutover slice does not push until the report is empty.** There is no "passive historical surface allowed to remain `fileRef`-keyed" carve-out — v3 retires the symbols entirely, including historical render code paths. Founder live-active assistants (e.g. the `2f8cf38e-a6d9-4609-b83a-2b748246fcec` analytics assistant) are included in the audit fixture and any skill content that embeds the retired symbols in static prompt text is rewritten in the same slice.

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

## Migration / data plan (v3 clean cutover)

Founder-stated condition: "у меня реально комерческих user пока нет можно сделать сразу чисто" → prod-first cutover with **no transitional fallback**, **no dual-write**, **no historical back-compat layer**, **no parallel structures**. v3 retires `assistant_files`, `fileRef`, and `assistant-media/` from the live system in one push.

What happens in the cutover slice:

- **DB migration (Prisma):**
  - `DROP TABLE assistant_files` and all dependent derivative tables (`assistant_media_semantic_derivative` and any other `assistant_files`-referencing satellites — enumerated in the slice's checklist with the live `prisma db pull` against `persai-dev`).
  - On `assistant_chat_message_attachment`:
    - DROP column `fileRef` (and any other `assistant_files`-FK columns).
    - The existing `storagePath` column changes semantics from "GCS object key (`assistant-media/<fileRef>`)" to "canonical FS path (`/shared/<wsid>/...` or `/workspace/<aid>/<wsid>/...`)". A one-shot data fill in the migration sets `storagePath = NULL` (or deletes the row, founder's call at slice dispatch) for all rows whose `fileRef` resolved to an `assistant-media/` blob — historical attachments lose their concrete bytes pointer because the prefix is wiped (see GCS step). The chat history rows remain, with the attachment block rendered as "(file no longer available)" until any retention sweep clears them.
    - DROP any other `fileRef`-typed FK columns elsewhere in the schema (`runtime_session_files`, etc — enumerated in the slice).
  - CREATE TABLE `workspace_file_metadata` `{ workspaceId, path, mimeType, sizeBytes, contentHash, shortDescription, createdAt, updatedAt }` with PK `(workspaceId, path)`.
- **GCS wipe (runbook step):** `gsutil -m rm -r gs://persai-dev-media/assistant-media/` after the DB migration applies. The `assistant-media/<fileRef>` GCS prefix is no longer a write target and not a read target — it ceases to exist.
- **Upload pipeline (web + Telegram):** chat-attached files are streamed **exactly once** into the shared input GCS key `workspaces/<businessWorkspaceId>/shared/input/<resolved-name>` and registered through the new path-based chat-attachment service which inserts the `assistant_chat_message_attachment` row with `storagePath = "/shared/<wsid>/input/<resolved-name>"`. No `assistant_files` row, no `assistant-media/` blob, no `fileRef` UUID.
- **One-shot plan-baseline data migration** raises every existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit` below 500 MB to exactly 500 MB and seeds `sharedStorageBytesLimit = 500 MB` on every plan that does not yet carry it. Plans at or above the ceiling are untouched. Ships in the same slice (no separate "Slice 5" — v3 collapses the program tail into one push, see Implementation plan).
- **Migration audit script** (D13) is run against the live `persai-dev` DB and reports zero remaining references to `fileRef` / `assistant_files` / `assistant-media/` / `AssistantFileRegistryService` / `materializeMountedFiles` / `mountFileRefs` across `apps/api`, `apps/runtime`, `apps/web`, `apps/sandbox`, `packages/`, `prisma/`, and the live skill/prompt content in `persai-dev`. The slice **does not push** until the report is empty.
- **The control-plane GCS snapshot** for `/shared/` is created lazily on first write per `businessWorkspaceId`; no bulk pre-provisioning. Existing snapshots for `/workspace/` stay where they are.

## Threat model — what changes and what doesn't

### Unchanged (locked by ADR-123, preserved by ADR-126)

- **gVisor kernel isolation** of the execution unit.
- **No real secrets in the exec pod env.** The control plane still holds `DATABASE_URL` / `PERSAI_INTERNAL_API_TOKEN`; the egress proxy still injects scoped credentials where needed.
- **Deny-all egress by default + HTTPS-only allowlist.**
- **Per-`(assistantId, workspaceId)` exec pod + Postgres workspace lease** (single-flight per workspace).
- **NetworkPolicy `Ingress: none`** for the exec pod.
- **Cross-tenant isolation** remains hard: `/shared/` is scoped to a single `businessWorkspaceId`, mounted only into pods of assistants belonging to that workspace.

### Net new risk + mitigation

| Risk                                                                                                                                                                                      | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `files.write` now actually writes into the live exec pod's `/workspace` or `/shared/outbound/self/`. A path-traversal bug (`../`) could let model code escape into the read-only root FS. | Control plane normalizes every `files.*` path argument against the allowed prefixes (`/shared/outbound/<self>/`, `/workspace/...`) **before** issuing the pod write — same argv hardening already used by `grep` / `glob` (ADR-123 Slice 7). Root FS remains `readOnly:true` (ADR-123 D1); a successful traversal only reaches `tmpfs` or the allowed mounts.                                                                                                                                                                                                                                                                                                                                                            |
| A compromised assistant pod could read sibling assistants' `/shared/outbound/<other>/` files.                                                                                             | **Accepted within the same `businessWorkspaceId`.** All sibling assistants belong to the same user / B2B workspace; intra-workspace isolation is not a goal. Cross-tenant isolation (different `businessWorkspaceId`) stays hard: different GCS prefix, different mount, different NetworkPolicy.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A compromised assistant could overwrite a sibling's outbound.                                                                                                                             | FS-level `0555` on sibling outbound subdirs (control plane sets this at mount time per pod identity). Tool-level path validation in `files.write` / `files.attach` rejects writes outside `/workspace/` and `/shared/outbound/self/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A compromised assistant could overwrite user uploads in `/shared/input/`.                                                                                                                 | `/shared/input/` mounted `0444` per pod (read-only). Tool-level validation rejects writes. User uploads are atomic at the control-plane upload endpoint, which under v3 writes the bytes to exactly one shared GCS key per upload (no `assistant-media/` mirror, no `assistant_files` row, no `fileRef`). The chat-attachment row references the canonical path; there is no second copy of the bytes that could drift from the canonical one.                                                                                                                                                                                                                                                                           |
| Egress to GitHub / PyPI / npm widens the supply-chain surface. A malicious npm/PyPI package could `curl --proxy …` against the allowlist itself.                                          | Egress proxy stays HTTPS-only + deny-all + allowlist. The proxy logs every egress request with `(assistantId, businessWorkspaceId, chatId, tool, target, bytes)` so a post-hoc audit can identify exfiltration patterns. The "no real secrets" rule of ADR-123 D2 prevents a compromised package from stealing a PersAI token.                                                                                                                                                                                                                                                                                                                                                                                           |
| `git push` would let model code stage and publish workspace content to a public host.                                                                                                     | **Accepted by design** (amended 2026-06-23, matches Claude Code's posture). The exec pod carries no PersAI provider tokens and no injected GitHub credentials (ADR-123 D2). A `git push` succeeds only if the model itself supplies valid auth in-prompt or via a model-authored `~/.gitconfig` — i.e. the model deliberately uses its own / the user's PAT. The proxy still enforces the host allowlist (push to non-allowlisted hosts like `gitlab.com` is denied at the network layer, same as any other request). Push to GitHub without auth fails at GitHub's 401 (application layer). The no-credentials rule plus the deliberate-action threshold (model must paste / fetch a PAT) is the threat-model boundary. |
| Model writes into `/workspace/.npm-global/bin` and later `pip install`s a package that overrides a system binary.                                                                         | `/opt/venv` and `/usr/local/bin` remain on root FS (`readOnly:true`); the session-scoped `/workspace/.local/bin` and `/workspace/.npm-global/bin` come **after** system paths on `PATH` for system binaries, **before** for user binaries. Preserves existing 2026-06-21 PATH layout.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Larger `/workspace/` and new `/shared/` due to `node_modules/` / `.venv/` / git clones blows the GCS snapshot cost.                                                                       | Snapshot layering (D10) deduplicates the install layer across cold starts. Workspace cap (D7) stays plan-managed; jobs that exhaust the per-plan cap get a clean `workspace_quota_exhausted` / `shared_quota_exhausted` error, not silent loss.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Cached `shortDescription` becomes stale when the model rewrites a file.                                                                                                                   | `files.preview` cache and the manifest description are keyed by `(path, content_hash)`; on rewrite the cache invalidates without an explicit bust call. cheap-LLM description regeneration is deferred — preview reads the live first-N-bytes / vision call. Background regeneration is a follow-up (it does not block correctness, only token economy).                                                                                                                                                                                                                                                                                                                                                                 |

## Implementation plan (drafted here, not yet executed)

ADR ships **doc-only**. Implementation is a separate bounded program of six slices, one push at the very end (program-style, mirroring ADR-123). Slice sketch for the future session:

- **Slice 1 — Image: bash + Node 22 + path/dotfile defaults + warm-pool entry.** `apps/sandbox/exec-image/Dockerfile` adds bash as `/bin/sh` (or shell tool invokes `/bin/bash -lc`), installs `nodejs` + `npm` from NodeSource `setup_22.x`, configures `/workspace/.npm-global` as the npm prefix, image self-checks for `bash -c '[[ 1 ]]'`, `node --version` (= `v22.*`), `npm --version`. Adds the warm-pool registration hook in `apps/sandbox` lease scheduler (size 1 per assistant, configurable). No model-facing contract change yet beyond `shell` semantics.

- **Slice 2 — Egress allowlist expansion + log shape extension** (amended 2026-06-23: git push deny removed). `infra/helm/values-dev.yaml` `egressProxy.allowedDomains` adds `.npmjs.com` (apex + subdomains, covers the npm website + auth endpoints; `registry.npmjs.org` is already there as the actual install target). PyPI hosts, GitHub hosts (`.github.com`, `.githubusercontent.com`), and the npm registry are already on the list from the 2026-06-21 ADR-123 follow-up. Squid `access_log` shape extended with a static `tool=shell` attribution per D12 (exec-pod outbound is exclusively shell-initiated through the `HTTP_PROXY` env; richer per-tool attribution for control-plane operations — `image_generate`, `document`, `files.*` — lives in control-plane logs, not the egress proxy log). **No SSL bumping. No CA lifecycle. No method/URL filtering inside HTTPS.** Smoke tests: `git clone https://github.com/sindresorhus/awesome.git` over HTTPS succeeds; `git push` to a model-supplied authed URL succeeds (or returns 401 from GitHub when auth is absent — application-layer, not proxy-layer); non-allowlisted hosts (e.g. `gitlab.com`) are denied at the proxy by SNI; `pip install rich` and `npm install left-pad` succeed.

- **Slice 3 — Unified files contract + `/shared/` mount + control-plane primitives + GC hooks + audit events (landed).** Sandbox control plane gained dedicated primitives `workspaceFileWrite({pod, mount, relPath, bytes})`, `workspaceFileRead`, `workspaceFileList`, `workspaceFileStat`, `workspaceFileDelete`, `workspaceFileCopy` — these run on the control plane (like `grep`/`glob`), invoking the K8s exec API for tiny `dd` / `cat` / `find` / `rm` / `cp` rather than spawning a model-visible shell, and each pod-side write is mirrored to the corresponding GCS key in the same primitive. Per-pod mount of `/shared/<businessWorkspaceId>/` with `self` symlink and `0555` on sibling outbound subdirs. `RuntimeFilesToolService` is path-only end-to-end; paths are normalized + clamped to allowed prefixes. GC hooks for chat / assistant / business-workspace deletion are wired into the existing lease-expiry sweeper. Audit events (`workspace_file_written`, `workspace_file_read`, `shared_outbound_published`) and Prometheus metrics from D12 are emitted. Tests cover: control-plane primitives, path normalization (including the `..` and absolute-escape rejections), sibling read-only enforcement, GC of chat scratch / assistant outbound / business-workspace shared volume, and the founder's exact failure case (`files.write({path:"foo"}) → shell({command:"cat foo"})` returns the bytes). **The Slice 3 v2-era upload-mirror path** (`AssistantFileRegistryService.ensureUploadedFile`, which inserted an `assistant_files` row alongside the shared-input write) **and the Slice 4 Wave 1 `files.attach` implementation** (`create-assistant-attachment-from-workspace-path.service.ts`, which downloaded the shared blob and re-uploaded via `ensureAttachmentFile`) are both **reverted** as part of Slice 4 (v3 cutover) below — they were the half-measures that v3 retires.

- **Slice 4 (v3 clean cutover) — DROP `assistant_files` / `fileRef` / `assistant-media/` + single-write artefacts + `files.attach` + path identity end-to-end + tool catalog + manifest + cheap-LLM short-description + migration audit + plan baseline bump + UI rewrite.** One large bounded push that collapses the previous v2 slice 4 + slice 5 + slice 6 program into a single cutover. The v2 wave 1 (`create-assistant-attachment-from-workspace-path.service.ts` and its callers in runtime + API + tests) is **reverted** as part of this slice. Concretely:
  1. **DB migration (Prisma):** new migration file `apps/api/prisma/migrations/<ts>_adr126_v3_drop_assistant_files_and_path_identity/migration.sql`:
     - `DROP TABLE` `assistant_files` and all dependent satellite tables (enumerated by `prisma db pull` against `persai-dev` and codified in the slice's checklist).
     - `ALTER TABLE assistant_chat_message_attachment` DROP COLUMN `fileRef` (and any other `assistant_files`-FK columns).
     - Repurpose `assistant_chat_message_attachment.storagePath` from GCS object key to canonical FS path. Data fill: rows whose `storagePath` starts with `assistant-media/` are either (a) updated to NULL with `processingStatus = "unavailable"` (history-row preservation) or (b) `DELETE`d (cleanest cut). Founder picks one at slice dispatch — both options are documented; either way the GCS prefix is wiped (next step).
     - DROP any other `fileRef`-typed FK columns elsewhere (`runtime_session_files` etc — enumerated).
     - `CREATE TABLE workspace_file_metadata { workspaceId, path, mimeType, sizeBytes, contentHash, shortDescription, createdAt, updatedAt }` PK `(workspaceId, path)`.

  2. **GCS wipe (post-migration runbook step):** `gsutil -m rm -r gs://persai-dev-media/assistant-media/`. The prefix ceases to exist.

  3. **Code deletes (the slice removes these files entirely):**
     - `apps/api/.../assistant-file-registry.service.ts` (the parallel registry; replaced by a thin path-based service).
     - `apps/api/.../create-assistant-attachment-from-workspace-path.service.ts` (v2 Wave 1 halтура — revert).
     - Any `apps/api/.../*assistant-files-*` controller routes (`POST /create-from-workspace-path`, file-by-fileRef download/preview routes).
     - `apps/api/.../media/persai-media-object-storage.service.ts buildFileRefKey` (or the whole file if `assistant-media/` is its only purpose).
     - `apps/runtime/.../runtime-assistant-file-registry.service.ts`.
     - `apps/runtime/.../persai-internal-api.client.service.ts` methods that referenced `fileRef` / `assistant-media/` / `assistant_files`.
     - `materializeMountedFiles` / `mountFileRefs` in `apps/sandbox/.../sandbox.service.ts` and any document-tool staging that relied on them.
     - All Wave 1 tests that mocked the above (`create-assistant-attachment-from-workspace-path.service.test.ts`, `runtime-files-tool.attach.test.ts` — rewritten under v3 below).

  4. **Code additions (new path-based surface):**
     - `apps/api/.../register-chat-attachment.service.ts` — thin service: takes `{ assistantId, workspaceId, chatId, messageId, storagePath, mimeType, sizeBytes, originalFilename, attachmentType, kind }`, inserts `assistant_chat_message_attachment` row, upserts `workspace_file_metadata`. No `fileRef`, no GCS upload (bytes are already at the shared key by the time this is called).
     - `apps/api/.../workspace-file-metadata.service.ts` — read/list/upsert for the new metadata cache table.
     - `apps/api/.../assistant-files.controller.ts` (or replacement) — path-based routes:
       - `GET /assistant/chats/web/:chatId/files?path=<path>` — download. Path validated against the chat's attachment rows. Bytes streamed from shared GCS key derived from `(workspaceId, path)`.
       - `GET /assistant/chats/web/:chatId/files/preview?path=<path>` — preview.
     - `apps/runtime/.../runtime-artefact-publisher.service.ts` (or refactor of existing tool plumbing) — `image_generate` / `image_edit` / `document` pipeline writes bytes once via `workspaceFileWrite` to the shared GCS key, upserts `workspace_file_metadata`, calls `register-chat-attachment` with the canonical `storagePath`.
     - `RuntimeFilesToolService.executeAttachAction` — rewritten clean: control-plane `workspaceFileCopy` (when `src` is `/workspace/`), then runtime calls internal API `register-chat-attachment` with `storagePath = "/shared/<wsid>/outbound/<handle>/<basename>"`.
     - `apps/web` chat-message attachment components: identity is `path`, download URL is `/files?path=<path>`. All `fileRef` references in `apps/web` are deleted.
     - SSE/REST projection payload for attachments: `{ path, mimeType, sizeBytes, displayName, kind }`.

  5. **Tool catalog + runtime guidance + manifest:** `apps/api/prisma/tool-catalog-data.ts` rewrites `files.modelUsageGuidance` per D2/D4/D8/D9 with `files.attach` EXAMPLES (path-only); `shell.modelUsageGuidance` already in place from Slice 1. `bootstrap-preset-data.ts` `documents` category rule references `files.attach` (the v2 forward-reference becomes live). Runtime developer manifest per D8 (summary header from `workspace_file_metadata` totals + current-turn-attachments inline using `storagePath`). Cheap-LLM `shortDescription` pipeline writes to `workspace_file_metadata.shortDescription`.

  6. **Plan baseline data migration** (workspace ≥ 500 MB, shared = 500 MB) — same migration file or sibling, idempotent.

  7. **Audit events:** `shared_outbound_published` for every artefact write (`image_generate`, `image_edit`, `document`, `files.attach`) with `{ ownerAssistantId, businessWorkspaceId, path, deliveryChannel }`.

  8. **Migration audit script** (D13, v3 form) — scans the entire repo and the live `persai-dev` DB for residual `fileRef` / `assistant_files` / `assistant-media/` / `AssistantFileRegistryService` / `materializeMountedFiles` / `mountFileRefs` / `ensureUploadedFile` / `ensureAttachmentFile` references. The slice **does not push** until the report is empty.

  Tests cover end-to-end: `image_generate(prompt) → files.read("/shared/outbound/self/<basename>") → shell python3 PIL postprocess → files.attach("/workspace/edited.png") → assistant_chat_message_attachment row + chat delivery`; download endpoint returns bytes for path-attached files in the chat and rejects path traversal; `files.attach` chat resolution succeeds when runtime passes `(channel, externalThreadKey)` for both web and Telegram; `files.attach` rejects paths under `/shared/input/` and `/shared/outbound/<other>/`; full anti-compromise grep suite asserts zero residual references to retired symbols across `apps/`, `packages/`, `prisma/`.

The slice ends on the full v3 closure gate (AGENTS gate + the anti-compromise grep audit + full test suites api/runtime/sandbox/web + an independent audit subagent on the diff). Program is pushed only after the closure gate is empty. There is no Slice 5 or Slice 6 in v3 — they collapsed into this slice.

## Acceptance criteria (to be checked when implementation lands)

A successful ADR-126 v3 implementation must satisfy **all** of the following on live `persai-dev`:

1. `shell({command:"echo {a,b,c}"})` returns `a b c` (brace expansion in bash, was 1 literal in dash).
2. `shell({command:"[[ 1 ]] && echo ok"})` returns `ok`.
3. `files.write({path:"hello.txt", content:"hi"}) → shell({command:"cat hello.txt"})` returns `hi` (the founder's exact failure case from 2026-06-22).
4. `shell({command:"git clone --depth 1 https://github.com/sindresorhus/awesome.git"})` succeeds.
5. `shell({command:"pip install --quiet rich && python3 -c \"import rich; print(rich.__version__)\""})` succeeds; the installed package is visible under `/workspace/.local/`.
6. `shell({command:"npm install --silent left-pad && node -e \"console.log(require('left-pad'))\""})` succeeds; the package lands under `/workspace/node_modules/`.
7. `shell({command:"git push https://<user>:<pat>@github.com/<owner>/<repo>.git main"})` succeeds when the model supplies its own auth. Without auth, GitHub returns 401 (application layer) — there is no proxy-level git-push deny in v1 (amended 2026-06-23, matches Claude Code's posture). `git push https://gitlab.com/...` fails at the proxy because `gitlab.com` is not on the host allowlist.
8. A user attaches a PDF in chat → **without any explicit hydrate call** the next runtime turn of **any** assistant in the same `businessWorkspaceId` sees `/shared/input/<original-filename>.pdf` via `files.read` and via `shell ls /shared/input/`.
9. A user uploads `report.pdf` twice → the second occurrence is stored as `/shared/input/report (2).pdf`; the first remains intact.
10. Document artifacts (PDF/XLSX/DOCX) and image artifacts (`image_generate` outputs) render in the chat UI via the path-based download endpoint `GET /assistant/chats/web/:chatId/files?path=<path>`. Bytes come from the single shared GCS key `workspaces/<businessWorkspaceId>/shared/outbound/<handle>/<basename>` resolved from `(workspaceId, path)`. The producing assistant post-processes the same bytes by reading `/shared/outbound/self/<basename>` directly. There is no `fileRef` in the payload, no second GCS object, no `assistant-media/` prefix anywhere in the request path. Historical chat-attachment rows whose bytes lived at `assistant-media/<fileRef>` (pre-cutover) have no `storagePath` post-migration and render as "(file no longer available)" — by design, founder dev-only window.
11. `image_generate({prompt}) → shell python3 PIL postprocess → files.attach("/workspace/edited.png")` end-to-end works: the user sees both the original and the edited image in the chat as attachments.
12. Assistant А generates `/shared/outbound/A/forecast.csv`; in a different chat with the same user, assistant Б runs `shell ls /shared/outbound/A/` and reads the file. Assistant Б attempting `shell({command:"echo > /shared/outbound/A/x"})` fails with `Permission denied` (FS-level enforcement).
13. `files.attach({path: "/shared/input/sales.csv"})` is rejected (`path_not_attachable`); `files.write({path: "/shared/input/x"})` is rejected (`path_not_writable`); `files.write({path: "/shared/outbound/A/x", attemptedBy: B})` is rejected (`path_not_writable`).
14. The repo and the live `persai-dev` DB contain **zero** references to `fileRef`, `assistant_files`, the **legacy `<fileRef>`-shaped `assistant-media/...` blob layout** (see D13 + 2026-06-24 Amendment), `AssistantFileRegistryService`, `materializeMountedFiles`, `mountFileRefs`, `ensureUploadedFile`, `ensureAttachmentFile` after v3 cutover (verified by the migration audit script across `apps/`, `packages/`, `prisma/`, skill content). Allowed and **not** counted as residual: (a) operational references to the `PERSAI_MEDIA_OBJECT_PREFIX` config knob, including its `"assistant-media"` default value and Helm `values.yaml` settings; (b) v3 path-keyed sub-trees `<prefix>/workspaces/<wsid>/shared/...` and `<prefix>/assistants/<aid>/sandbox*/...`; (c) test fixtures and negating documentation that document the absence of `fileRef` / `assistant_files` / legacy blob layout. Historical chat-attachment rows pointing at the wiped legacy layout render as "(file no longer available)" — by design, dev-only window, no commercial-user data loss.
15. Cold first `files.write` of a fresh assistant session completes within 8 s p95; warm `files.write` completes within 300 ms p95. The published Prometheus metric `workspace_file_write_latency_ms` matches these bounds in the smoke test.
16. A plan with `sharedStorageBytesLimit < 500 MB` or `workspaceStorageBytesLimit < 500 MB` that activates D4 and exceeds its cap returns a clean `shared_quota_exhausted` / `workspace_quota_exhausted` error from the existing quota guard, not a silent truncation.
17. `files.preview({path:"/shared/outbound/self/foo.png"})` returns a fresh preview after a subsequent `shell convert ... foo.png` overwrites the same path (the new `(path, content_hash)`-keyed cache invalidates without an explicit bust call).
18. The developer prompt for a chat with 100+ files contains a summary header + current-turn attachments only — no full listing. `files.list` returns the structured array with cached `shortDescription` (read from `workspace_file_metadata`) for input / outbound; system-noise paths (`node_modules`, `.venv`, `__pycache__`, `*.pyc`, dotfiles) are hidden unless `includeHidden: true`.
19. A chat is deleted → the assistant's `/workspace/chats/<chatId>/` is purged by the next workspace-lease sweep. An assistant is deleted → its `/workspace/` snapshot is marked for delete with the 7-day grace window and its `/shared/outbound/<handle>/` is moved to `_archived/`. A business workspace is deleted → its `/shared/` snapshot is marked for delete with the 30-day grace window.
20. The v3 migration audit script (D13 rewritten) returns an empty report against both the repo and the live `persai-dev` DB before push. Symbols searched: `fileRef`, `assistant_files`, **the legacy `<fileRef>`-shaped `assistant-media/...` blob layout** (per D13 + 2026-06-24 Amendment), `AssistantFileRegistryService`, `materializeMountedFiles`, `mountFileRefs`, `ensureUploadedFile`, `ensureAttachmentFile`, `buildFileRefKey`. Founder live-active assistants are included in the audit fixture. References to the **operational `PERSAI_MEDIA_OBJECT_PREFIX` config knob** (including default value `"assistant-media"`) and v3 path-keyed sub-trees `<prefix>/workspaces/...` / `<prefix>/assistants/...` are **excluded** from the audit — they are deploy config, not identity.

## Resolved decisions (founder sign-off 2026-06-22 + 2026-06-23)

Every Open Question carried in the v1 draft of this ADR was decided in the 2026-06-22 session; the multi-assistant / prompt-economy / scratch-namespace / production-grade questions were decided in the 2026-06-23 follow-up. These are the **final positions** the implementation program will execute:

1. **`git push` policy — ALLOWED in v1** (amended 2026-06-23, matches Claude Code / Anthropic's posture). No PersAI credentials are injected into the exec pod (ADR-123 D2 remains), so push to a real host succeeds only when the model supplies its own auth. The proxy continues to enforce the host allowlist; push to non-allowlisted hosts is denied at the network layer. No SSL bumping in the proxy.
2. **Node LTS line — Node 22 LTS** from NodeSource `setup_22.x`.
3. **Git hosts — GitHub only in v1.** GitLab / Bitbucket are one-line follow-ups when demand emerges.
4. **Workspace size cap — stays plan-managed.** Default plan baseline raised to **500 MB** for plans activating D4.
5. **`files.preview` cache key — `(assistantId, businessWorkspaceId, path, content_hash)` end-to-end.** The legacy `fileRef`-keyed cache is **deleted** as part of v3. There is no parallel cache for "historical" rows — `fileRef` is no longer an identity in the system.
6. **Multi-assistant model — per-assistant `/workspace/` + per-business-workspace `/shared/`** (founder sign-off 2026-06-23). One sibling assistant sees other siblings' outbound; nobody sees a sibling's `/workspace/`.
7. **Namespacing — by `assistant.handle`, not by skill** (founder correction 2026-06-23). Skills do not partition the outbound namespace.
8. **`self/` symlink** so models do not need to remember their own handle. Strict FS-level `0555` on sibling outbound subdirs.
9. **Naming on collision — numeric suffix `(2)`, `(3)`** (macOS-style), at both upload and artefact-write paths.
10. **`files.attach` is the explicit publish channel** for arbitrary file types out of `/workspace/` and `/shared/outbound/self/`. Implicit auto-attach of `files.write` outputs is **not** introduced. Under v3, `files.attach` creates an `assistant_chat_message_attachment` row with `storagePath = canonical FS path` and upserts `workspace_file_metadata` — no `assistant_files` row, no `fileRef`, no bytes re-upload.
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
- **One identity for a file end-to-end: `(workspaceId, path)`.** Sandbox tools, chat attachments, web UI, download endpoint, preview cache, manifest, audit events, and metadata cache all key on the same thing. No `fileRef` UUID, no `assistant_files` parallel registry, no "DB row for delivery vs FS for bytes" split. The FS is the registry.
- **Halved GCS storage per artefact** and **single source of bytes**: every chat-IO artefact lives at exactly one GCS object in the `workspaces/<wsid>/shared/...` prefix. The `assistant-media/<fileRef>` prefix is wiped — does not exist as a write target or a read fallback.
- **`materializeMountedFiles` / `mountFileRefs` document-tool staging deleted**: document tool reads inputs from `/shared/<wsid>/input/` directly. No third copy path.
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
- **Metadata-only `assistant_files` middleground (kept in v2 + Amendment 3, retired in v3).** Rejected on founder review during Slice 4 dispatch: keeping `assistant_files` as a "metadata-only delivery row" alongside the FS still leaves a parallel DB-side registry of files, a second identity (`fileRef` UUID on the chat-UI side), and a legacy `assistant-media/<fileRef>` GCS prefix in the read path (router-with-fallback). The founder identified this as a half-measure — the system still carries two identities for the same file and two code paths for read. v3 retires all three in one cutover.
- **Keep `fileRef` as identity on the chat-UI side and switch sandbox to path** (the half-and-half option). Rejected. Two identities for the same file are exactly the "залипуха" the founder rejected. v3 unifies on `(workspaceId, path)` end-to-end including the chat-UI components.
- **Preserve historical chat-attachment bytes via a one-shot copy from `assistant-media/` into the new shared prefix.** Rejected for v3. Founder dev-only window means there is no commercial-user data loss; the engineering cost of a migration job that would later be deleted is not worth carrying. Historical attachment rows render as "(file no longer available)" and that is the explicit trade-off.
- **Keep `files.*` against `assistant_files` and tell the model "if you want shell visibility, use `shell cat <<EOF`".** Rejected. That is exactly the workaround the model improvised on 2026-06-22; ADR-126 exists to retire it, not bless it.
- **Make `/workspace/` and `/shared/` the chat-delivery channel too (delete `assistant_files` entirely, identity = `(workspaceId, path)`).** **Accepted in v3** (was Rejected in v2). The v2 wording argued chat artefacts have UX/quota/sharing/billing semantics distinct from session-scoped workspace files and that conflating them would force a much larger ADR and break ADR-097 / ADR-116 / image-gen flows. v3 retires that argument: chat-attachment membership stays in `assistant_chat_message_attachment` (UX/quota/sharing/billing concerns live on the relation, not on a parallel file registry); the file identity is its `(workspaceId, path)` pair; ADR-097 / ADR-116 / image-gen flows are rewired to the path-based registration service in the same cutover. The "larger ADR" cost is real but is the right one to pay — v2's split bookkeeping was the structural defect founder rejected.
- **One global `/workspace/` shared by all sibling assistants in the same business workspace.** Rejected. Erases per-assistant isolation of installs / scratch / scripts; one compromised assistant pollutes everyone's `node_modules`. Pure shared workspace is a Cursor concept, not a multi-agent concept. Per-assistant `/workspace/` + per-business `/shared/` is the right shape.
- **Per-skill outbound namespace (`/shared/outbound/<assistant>/<skill>/`).** Rejected (founder correction 2026-06-23). Skills are modes, not identities. One artefact per assistant, regardless of skill.
- **Lazy hydrate of user uploads on first `files.read`.** Rejected. Eager hydrate at upload time means `shell ls /shared/input/` shows the file immediately, matching Claude Code's drop-into-workspace UX. Lazy hydrate forces the model to know "I should call `files.read` first to surface this", which is exactly the kind of magic invariant we are trying to remove.
- **Eager full-listing in the developer prompt for every chat.** Rejected. Does not scale beyond a handful of files. The summary-header + on-demand `files.list` shape is the standard pattern in best-in-class agent surfaces and is what we adopt.
- **Use Git over SSH for git clone.** Rejected for v1. SSH requires storing a private key in the exec pod env, which conflicts with ADR-123 D2 "no real secrets in execution unit". HTTPS clone covers the public-repo use case.
- **Always run `/bin/bash` but keep `/bin/sh -lc` as the entry point for backward compatibility.** Rejected. The whole point of the bash default is consistent semantics; a `sh` indirection invites the exact dash-vs-bash drift this ADR is closing.
- **Land all thirteen points in one mega-slice.** Possible but rejected for risk control. The 6-slice plan is the conservative breakdown so each lands cleanly on the AGENTS gate; collapsing is an implementer's call at dispatch time, not an architectural decision.
- **Defer `files.attach` to a follow-up ADR.** Rejected. Without `files.attach` the model has no way to deliver arbitrary file types to the user; the `/workspace/` + `/shared/` plumbing works but the round trip from "model produced output" to "user sees it" remains broken for CSV / JSON / zip / script / arbitrary text. `files.attach` is small, well-scoped, and removing it from v1 would force the same gap in production.
- **Defer migration audit (D13) to "we'll see at deploy time".** Rejected. The founder's own active assistants in `persai-dev` carry `fileRef`-laden skill content that will fail silently if not rewritten. A one-shot audit script is cheap and is the only way to guarantee the program is push-safe.
