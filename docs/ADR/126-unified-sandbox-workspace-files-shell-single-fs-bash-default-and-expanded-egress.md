# ADR-126 — Unified sandbox workspace: files↔shell single-FS contract, bash default, expanded egress

Status: **Accepted (doc-only)** — founder sign-off received 2026-06-22 on every Open Question; implementation is a separate bounded program (4 slices) dispatched in a follow-up session. No code changes accompany this ADR.
Date: 2026-06-22
Supersedes: none (refines long-term system truth set by ADR-123)
Superseded-by: none

## Relates to

- **ADR-123** (Native sandbox runtime — isolation, network, document execution) — **closed**. ADR-126 reopens **only the sandbox surface** (files contract + shell defaults + egress allowlist) without reopening isolation/lifecycle/document program decisions, which stay locked.
- ADR-081 (unified user-files architecture) — `assistant_files` table stays the source of truth for **chat input/output artifacts**; ADR-126 narrows the role of `files.*` tool from "thin API onto `assistant_files`" to "thin API onto the sandbox `/workspace`".
- ADR-097 (autonomous document tool) — document artifacts continue to land in `assistant_files` (delivery to user).
- ADR-116 (runtime file re-view / inspect / read / preview) — preview pipeline is repointed at `/workspace` paths instead of `assistant_files.id`.
- ADR-122 (model output budget) — independent.
- ADR-125 Amendment 1 (scenario plan-intake `<system-reminder>`) — independent.

## Founder symptom (verbatim, 2026-06-22)

> "Это не совсем поведение like claude code — пакетов не хватает, git соединение закрыто и тп … files.write с ~/ путём не пробрасывается в shell-песочницу — файл тупо не виден … brace expansion {data,scripts,reports} в dash не пашет"

Live trace from a model session in `persai-dev` (assistant `2f8cf38e-a6d9-4609-b83a-2b748246fcec`, founder-narrated):

1. Model wrote `~/persai-analytics/scripts/generate_data.py` via the `files.write` tool — the next `shell` step listed `/workspace` and could not see the file.
2. Model issued `mkdir -p persai-analytics/{data,scripts,reports}` in shell — only one directory `persai-analytics/{data,scripts,reports}` was created (no brace expansion).
3. Model tried `git clone …github.com…` — connection refused by the egress proxy.

These are **three architectural mismatches** with the Claude-Code / Cursor agent surface that the founder targets as the long-term baseline; this ADR enumerates each one and locks the cutover terms.

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

### Shell is `dash`, not `bash`

`apps/sandbox/exec-image/Dockerfile` builds `node:22-bookworm-slim` → `/bin/sh = dash` (debian default). `RuntimeShellToolService` invokes commands as `/bin/sh -lc "<command>"`, which means **no brace expansion, no `[[ ]]`, no `<(…)` process substitution, no `pipefail` by default**. `bash` is installed on the image (it ships with `bookworm-slim`) but is **not** the default shell and is not the shell the `shell` tool uses.

### Egress allowlist is LLM-host-only

`infra/helm/values-dev.yaml` `egressProxy.allowedDomains` currently lists provider hosts (`api.openai.com`, `api.anthropic.com`, `api.deepseek.com`, …) + `.github.com` + `.githubusercontent.com` (added 2026-06-21 for the document/Slice 6 ingest path) + `pypi.org` / `files.pythonhosted.org` (PyPI for runtime `pip install`). `npmjs.org` / `registry.npmjs.org`, `nodejs.org`, package mirrors, and Git operations against arbitrary hosts (`*.googlesource.com`, `gitlab.com`, `bitbucket.org`) are **not** in the allowlist. `git clone https://github.com/…` works for HTTPS over the proxy only because GitHub is allowlisted; `git clone git@github.com:…` over SSH does not, and `git push` is not exercised today.

### Image stack — close, but missing `node`/`npm`/Git ergonomics

`apps/sandbox/exec-image/Dockerfile` already installs `python3` + a doc/data stack (ADR-123 D5 + 2026-06-21 expansion), `git`, `unzip`, `zip`, `ripgrep`, `fd`. `node` / `npm` are **not** preinstalled in the exec image (only the control-plane `apps/sandbox/Dockerfile` has node); model code that tries to run JavaScript or install npm deps fails. The control-plane image has node because `apps/sandbox` itself is a NestJS process — that is orthogonal to the execution unit.

### Tool guidance does not mention runtime installs

`apps/api/prisma/tool-catalog-data.ts` `shell.modelUsageGuidance` (post-ADR-123 Slice 7) encourages autonomous shell use but is silent on `pip install --user` and on `npm install` against `/workspace`. `files.modelUsageGuidance` is silent on the fact that the file may also be visible from `shell` (and today, it isn't).

## Decision

Make the sandbox feel like a **single Claude-Code-style dev workspace**: one filesystem visible to both tools, bash by default, package managers and Git available, while preserving the isolation/secret/lifecycle decisions ADR-123 locked. Four points (A–D) below correspond directly to the live regressions and are introduced as one bounded program.

### D1 — bash as the default `/bin/sh` for `shell` (the "A" point)

- In `apps/sandbox/exec-image/Dockerfile`, replace `/bin/sh` symlink so it points to `/bin/bash` (or invoke commands as `/bin/bash -lc "<command>"` from `RuntimeShellToolService`, removing the `dash` indirection entirely).
- `set -o pipefail` becomes safe to assume; `{data,scripts,reports}` brace expansion works; `[[ … ]]` works; `<(…)` works. The model's bash mental model from Claude Code / Cursor transfers verbatim.
- This is **not** a security boundary change — `bash` is already on the image, it just was not the default. The exec pod still runs under gVisor + `securityContext` (ADR-123 D1/D2) and writes to a writable subset of the filesystem.

### D2 — Unified workspace filesystem: `files.*` now reads and writes `/workspace` (the "B" point)

This is the architectural core of ADR-126. **`files.*` tool stops touching `assistant_files`** and becomes a thin API onto the exec pod's `/workspace`.

Contract change (single-shot, no transitional dual write):

| `files.*` action | Was | Becomes |
| --- | --- | --- |
| `write({path, content})` | `assistant_files` row + GCS upload, surfaced to the model as `fileRef` | Direct write into the assistant-`workspaceId` exec pod's `/workspace/<path>` via the sandbox control plane (`runInPod` with a tiny dedicated control-plane primitive — no exec round-trip to a model-runnable shell). Path is normalized against `/workspace/` containment (no `..`, no absolute paths outside `/workspace`) by the control plane, same as `grep`/`glob` argv validation today (ADR-123 Slice 7). |
| `read({path})` | Reads `assistant_files` GCS object by `fileRef` | Reads `/workspace/<path>` from the same exec pod. Same containment + size cap. |
| `list({path?})` | Lists `assistant_files` for the current chat | Lists `/workspace/<path>` (defaults to `/workspace`). Uses the same path-containment + glob-style entry rendering used by the new `glob` tool. |
| `preview({path|fileRef})` | Renders preview from `assistant_files` object | Renders preview from `/workspace/<path>`. Existing preview pipeline (ADR-116) is repointed at the pod's `/workspace` via the control plane. |

The pod-side `/workspace` remains the canonical FS for the **entire session**. The control-plane GCS workspace snapshot (ADR-123 D4) continues to hydrate `/workspace` on pod recreate, and the control plane continues to pull `/workspace` back into the GCS snapshot when the workspace lease releases — so **inter-job durability is preserved** without any change to the snapshot protocol. The model never sees a `fileRef` for files it authored via `files.write`: it sees the path `it just wrote`, and any subsequent `shell` / `grep` / `glob` / `read` over the same path sees the same bytes.

**`assistant_files` table is preserved** as the storage for two **separate** kinds of artifact, neither of which goes through the `files.*` tool any more:

1. **Chat-attached uploads from the user** (the existing input channel — user attaches a PDF in chat, it lands in `assistant_files`). On the **first** runtime turn of the session that needs it, the runtime / sandbox control plane hydrates the file into `/workspace/input/<original-filename>` (mirroring how the document worker's "two-tier source ingestion" already mounts sources at `/workspace/sources/`, ADR-123 Slice 6). The file shows up as a path under `/workspace/input/` — exactly the same model API surface as a file the model itself wrote.
2. **Outbound artifacts the model wants to deliver to the user in the chat UI** (PDFs from the document tool, generated images from `image_generate`, etc.). These continue to land in `assistant_files` via their respective tool paths (`document`, `image_generate`, …) — not via `files.*`. The "promote a `/workspace/<path>` to a chat artifact" flow is a **deliberate, explicit** future tool (out of scope for this ADR — see Out of scope below).

This keeps `assistant_files` honest: it is the chat-IO boundary, not a parallel filesystem. The `files.*` tool becomes a workspace API, exactly as in Claude Code / Cursor.

### D3 — Expanded egress allowlist for git/PyPI/npm (the "C" point)

Add to `infra/helm/values-dev.yaml` `egressProxy.allowedDomains` (HTTPS only, deny-all default still applies, isolation/auth boundary of ADR-123 D3 is **not** weakened):

- **Git over HTTPS — GitHub only in v1** (founder sign-off 2026-06-22): `github.com`, `*.github.com`, `gist.github.com`, `*.githubusercontent.com`, `api.github.com` (the first two already added 2026-06-21). GitLab and Bitbucket are intentionally **not** in v1 — they are an additive change that costs nothing in proxy code but widens the surface, so adding them later is a one-line follow-up if real usage demands it.
- **PyPI** — `pypi.org`, `files.pythonhosted.org` (already added 2026-06-21).
- **npm** — `registry.npmjs.org`, `npmjs.com`, `*.npmjs.com`.
- **Node binary mirror** — **not** added in v1. `node` ships preinstalled at LTS 22 on the exec image (D4 below), so `nvm`/`n`/`pnpm` ad-hoc Node-version installs against `nodejs.org` are not needed. If a future workload requires multiple Node versions, this is a one-line proxy-config follow-up.

**Git push policy — denied in v1 (founder sign-off 2026-06-22).** The egress proxy enforces HTTPS-method filtering: `POST` to `…/git-receive-pack` is blocked at the proxy regardless of the destination host being on the allowlist. This keeps the data-exfiltration surface narrow — the model cannot silently stage and push a file to a public gist. Reopen is an **explicit follow-up addendum on this ADR**, not an implementation flag, and would require a written threat-model update (which org / which branch / what audit hook).

The egress proxy continues to enforce **HTTPS only**, **deny-all + allowlist**, and the existing scoped-credential injection model (ADR-123 D3) — `git`, `pip`, and `npm` do not see real PersAI provider tokens; they see only the allowlisted host.

### D4 — Image baseline: `bash` default, `node` + `npm` preinstalled, model knows about runtime installs (the "D" point)

- `apps/sandbox/exec-image/Dockerfile` (the exec image, not the control plane):
  - `/bin/sh` → `/bin/bash` (or `RuntimeShellToolService` invokes `/bin/bash -lc` explicitly; the choice is the implementing slice's, the contract is "bash-shaped semantics").
  - Add `nodejs` + `npm` at **Node 22 LTS** (founder sign-off 2026-06-22) — installed from NodeSource `setup_22.x`, matches the control-plane image's `node:22-bookworm-slim` base so the LTS line is the same on both sides.
  - Keep the existing `--system-site-packages` venv at `/opt/venv` and the `PYTHONUSERBASE=/workspace/.local` / `PIP_USER=1` ergonomics (ADR-123 warm-node addendum, 2026-06-21) so `pip install <pkg>` continues to write into the session-scoped `/workspace/.local` without weakening the read-only root FS.
  - Add a tiny `~/.npmrc` / `prefix=/workspace/.npm-global` and pre-PATH `/workspace/.npm-global/bin` so `npm install -g` lands in the session workspace (mirrors the Python user-site pattern). `npm install` (no `-g`) writes a project-local `node_modules/` under whatever `cwd` the model chose — same as Claude Code.
- `apps/api/prisma/tool-catalog-data.ts`:
  - `shell.modelUsageGuidance` gains an explicit short block: "the sandbox shell is `bash`; you may `pip install <pkg>` (writes to `/workspace/.local`, session-scoped) and `npm install <pkg>` (writes to `/workspace/node_modules` or `/workspace/.npm-global` for `-g`); `git clone https://github.com/<org>/<repo>.git` works; `git push` is denied by the egress proxy". No `WHEN NOT TO USE` change beyond this.
  - `files.modelUsageGuidance` is **rewritten** from "this is a chat-attached file (fileRef)" to "this is a workspace path under `/workspace/`; everything you write here is also visible from `shell` / `grep` / `glob` / `read` at the same path. To deliver a file to the user in the chat UI, use the dedicated artifact tool (`document` / `image_generate` / etc.) — `files.*` is not the chat-delivery channel." This is the model-facing source of truth for the D2 contract change.

## Scope fence

**In scope (D1–D4 above):**

- bash as default shell for the `shell` tool.
- `files.write` / `read` / `list` / `preview` repointed at the assistant-`workspaceId` exec pod's `/workspace`.
- User chat uploads hydrated into `/workspace/input/<original-filename>` on first touch (so the model sees them as a workspace path).
- Egress allowlist expansion for HTTPS pull/clone/fetch from GitHub + PyPI + npm.
- Exec image preinstalls `node` + `npm`; `pip install --user` and `npm install` ergonomics documented in tool guidance.
- Tool catalog `modelUsageGuidance` rewrite for `files` and `shell`.

**Out of scope (deliberately deferred):**

- **`git push` to public Git hosts.** Denied in v1 (see Resolved decisions §1). Revisit only via an explicit follow-up addendum on ADR-126.
- **A "promote `/workspace/<path>` to a chat artifact" tool.** The user-facing channel for delivering files (PDF / XLSX / images) is the existing artifact tools (`document` / `image_generate` / `image_edit`). If we later want a generic "publish this workspace file to the chat as an attachment", that is a separate, sign-off-gated future ADR — it changes UX/privacy/quota behavior and deserves its own scope fence.
- **Git over SSH.** `git clone git@github.com:…` requires an SSH client + agent + key material in the sandbox, which conflicts with D2/D3's "no real secrets in execution unit" rule from ADR-123. HTTPS clone covers the public-repo use case in v1.
- **GitHub Actions / runners / private repo pulls with PAT.** Anything that requires storing a Git credential in the sandbox is a separate ADR — it reopens ADR-123 D2 (secret-free execution).
- **Multi-workspace sharing of `/workspace`.** The per-`(assistantId, workspaceId)` exec pod model from ADR-123 D4 stands; `files.*` operates against the **current** assistant's workspace, period. Cross-workspace transfer happens through the user-facing artifact tools, not silently through `/workspace`.
- **Code-mode for `files.list`** (e.g. tree view, gitignore semantics). v1 ports the existing `assistant_files` listing shape onto `/workspace` so the chat UI keeps working. Power-user listing semantics (tree, gitignore, size limits) are a follow-up.
- **Webhooks / inbound HTTP into the sandbox.** Ingress remains denied (ADR-123 NetworkPolicy `Ingress: none`).
- **Persistent `~/.bashrc` / dotfiles per assistant.** Sandbox starts each session from the GCS-snapshot hydrate; user dotfiles outside `/workspace` are reset on pod recreate by design (read-only root FS, ADR-123 D1). The model can stash its own `/workspace/.bashrc` and source it explicitly if it wants per-session ergonomics.

## Migration / data plan

**There is no data migration.** Founder-stated condition: "у меня реально комерческих user пока нет можно сделать сразу чисто" → prod-first cutover with **no transitional fallback** and **no dual-write** of `files.*` to both `assistant_files` and `/workspace`.

- `assistant_files` table stays — it remains the storage for chat-input uploads (incoming) and chat-output artifacts (outgoing via the artifact tools). Existing historical chat rows that reference `assistant_files` by `fileRef` continue to render correctly (read path is unchanged for ADR-097 / ADR-116 consumers).
- `files.*` tool calls in historical chats (before the cutover) referenced `assistant_files` paths. Those historical messages will read fine — the model just sees the same rendered text in history. New turns after the cutover will see `/workspace` paths. No DB rewrite needed.
- The control-plane GCS snapshot of `/workspace` is **already** keyed by `(assistantId, runtimeSessionId)` (ADR-123 D4). After the cutover it will simply carry more files (the ones the model used to write through `files.*`). No bucket migration, no new prefix.

## Threat model — what changes and what doesn't

### Unchanged (locked by ADR-123, preserved by ADR-126)

- **gVisor kernel isolation** of the execution unit.
- **No real secrets in the exec pod env.** The control plane still holds `DATABASE_URL` / `PERSAI_INTERNAL_API_TOKEN`; the egress proxy still injects scoped credentials where needed.
- **Deny-all egress by default + HTTPS-only allowlist.**
- **Per-`(assistantId, workspaceId)` exec pod + Postgres workspace lease** (single-flight per workspace).
- **NetworkPolicy `Ingress: none`** for the exec pod.

### Net new risk + mitigation

| Risk | Mitigation |
| --- | --- |
| `files.write` now actually writes into the live exec pod's `/workspace`. A path-traversal bug (`../`) could let model code escape into the read-only root FS. | Control plane normalizes every `files.*` path argument against `/workspace/` containment **before** issuing the pod write — same argv hardening already used by `grep` / `glob` (ADR-123 Slice 7). Root FS remains `readOnly:true` (ADR-123 D1); a successful traversal only reaches `tmpfs` or `/workspace`, both already writable. |
| Egress to GitHub / PyPI / npm widens the supply-chain surface. A malicious npm/PyPI package could `curl --proxy …` against the allowlist itself. | Egress proxy stays HTTPS-only + deny-all + allowlist. The proxy logs every egress request with `(assistantId, workspaceId, jobId, target, bytes)` so a post-hoc audit can identify exfiltration patterns. The "no real secrets" rule of ADR-123 D2 prevents a compromised package from stealing a PersAI token (there is none in the env). |
| `git push` would let model code stage and publish workspace content to a public host. | **Not in v1 (founder sign-off 2026-06-22).** Egress allowlist permits HTTPS read methods only by request-envelope filtering; `git push` over HTTPS sends a `POST` to `/info/refs?service=git-receive-pack` which is **blocked** by the v1 proxy rule (`HTTPS pull/clone/fetch only`). Reopen is an explicit follow-up addendum on ADR-126 (requires a written threat-model update — which org / which branch / what audit hook). |
| Model writes into `/workspace/.npm-global/bin` and later `pip install`s a package that overrides a system binary. | `/opt/venv` and `/usr/local/bin` remain on root FS (`readOnly:true`); the session-scoped `/workspace/.local/bin` and `/workspace/.npm-global/bin` come **after** system paths on `PATH` for system binaries, **before** for user binaries — i.e. `pip install -U pip` cannot replace `/usr/bin/python3`. This is the existing 2026-06-21 PATH layout, preserved. |
| Larger `/workspace` due to `node_modules/` / `.venv/` / git clones blows the GCS snapshot. | Workspace cap stays **plan-managed** (existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit`, resolved into `bundle.governance.quota.workspaceQuotaBytes`). Implementation slice raises the default plan baseline to **500 MB** for plans that activate D4. Plans below that get a clean `workspace_quota_exhausted` error from the existing quota guard, not silent loss. Per-plan tuning continues to flow through the existing billing-hints code path; ADR-126 introduces no new cap mechanism. |

## Implementation plan (drafted here, not yet executed)

This ADR ships **doc-only**. Implementation is a separate bounded program of four slices, one push at the very end (program-style, mirroring ADR-123). Slice sketch for the future session:

- **Slice 1 — Image: bash + Node 22 + path/dotfile defaults.** `apps/sandbox/exec-image/Dockerfile` adds bash as `/bin/sh` (or shell tool invokes `/bin/bash -lc`), installs `nodejs` + `npm` from NodeSource `setup_22.x`, configures `/workspace/.npm-global` as the npm prefix, image self-checks for `bash -c '[[ 1 ]]'`, `node --version` (= `v22.*`), `npm --version`. No model-facing contract change yet beyond `shell` semantics.
- **Slice 2 — Egress allowlist expansion (GitHub + PyPI + npm; HTTPS pull/clone/fetch only).** `infra/helm/values-dev.yaml` `egressProxy.allowedDomains` adds the GitHub hosts (`github.com`, `*.github.com`, `gist.github.com`, `*.githubusercontent.com`, `api.github.com`) + npm hosts (`registry.npmjs.org`, `npmjs.com`, `*.npmjs.com`). PyPI is already on the list. **Method filtering** in the proxy adds the `POST /…/git-receive-pack` deny rule. Proxy logging shape extended with the new categories. Smoke test: `git clone https://github.com/sindresorhus/awesome.git` over HTTPS succeeds; `git push` is denied at the proxy with a clear `egress_denied` error; non-allowlisted hosts (e.g. `gitlab.com`) are denied; `pip install rich` and `npm install left-pad` succeed.
- **Slice 3 — Unified files contract.** Sandbox control plane gains tiny dedicated primitives `workspaceFileWrite({pod, relPath, bytes})`, `workspaceFileRead({pod, relPath})`, `workspaceFileList({pod, relPath})`, `workspaceFileStat({pod, relPath})` — these run **on the control plane** (like `grep`/`glob`), invoking the K8s exec API for a tiny `dd` / `cat` / `find` rather than spawning a model-visible shell. `RuntimeFilesToolService` is rewritten to route through these. `assistant_files` reads/writes via the `files.*` tool are deleted (no transitional dual write). Tool projection unchanged (`files` still runs `inline`). **`files.preview` cache** repointed at `(assistantId, workspaceId, relPath, content_hash)` for `/workspace` paths; the `fileRef`-keyed cache survives for outbound artifact previews (`document`, `image_generate`) since those stay on `assistant_files`. Tests: full reshape of `runtime-files-tool.service.test.ts`, plus new control-plane primitives tests, plus an end-to-end test that `files.write({path:"foo"}) → shell({command:"cat foo"})` returns the bytes (the founder's exact failure case), plus a preview-invalidation test that a `shell`-overwrite of `/workspace/foo.png` invalidates the cache cleanly.
- **Slice 4 — Tool catalog + runtime guidance + chat uploads hydrate + plan baseline bump.** `apps/api/prisma/tool-catalog-data.ts` rewrites `files.modelUsageGuidance` and `shell.modelUsageGuidance` per D2/D4 (workspace-path mental model + explicit `pip install --user` / `npm install` / `git clone` examples + explicit "`git push` is denied" warning so the model does not waste turns trying). Runtime adds the "hydrate chat-uploaded `assistant_files` into `/workspace/input/<filename>` on first turn that needs them" hook (mirroring the ADR-123 Slice 6 source-mount path). **Plan baseline bump**: a one-shot data migration raises every existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit` that is below 500 MB to exactly 500 MB; plans already at or above that ceiling are untouched. Tests pin both guidance strings + the hydration path + the data migration on a fixture of low-cap and high-cap plans.

Each slice ends on the AGENTS gate (lint × all packages + format + typecheck × 4 + relevant tests). Program is pushed only after Slice 4 lands clean.

## Acceptance criteria (to be checked when implementation lands)

A successful ADR-126 implementation must satisfy **all** of the following on live `persai-dev`:

1. `shell({command:"echo {a,b,c}"})` returns `a b c` (brace expansion in bash, was 1 literal in dash).
2. `shell({command:"[[ 1 ]] && echo ok"})` returns `ok`.
3. `files.write({path:"hello.txt", content:"hi"}) → shell({command:"cat hello.txt"})` returns `hi` (the founder's exact failure case from 2026-06-22).
4. `shell({command:"git clone --depth 1 https://github.com/sindresorhus/awesome.git"})` succeeds.
5. `shell({command:"pip install --quiet rich && python3 -c \"import rich; print(rich.__version__)\""})` succeeds; the installed package is visible under `/workspace/.local/`.
6. `shell({command:"npm install --silent left-pad && node -e \"console.log(require('left-pad'))\""})` succeeds; the package lands under `/workspace/node_modules/`.
7. `shell({command:"git push origin main"})` fails at the egress proxy with a clear "egress denied" classification (not at the application layer).
8. A user attaches a PDF in chat → the next runtime turn that needs it sees `/workspace/input/<original-filename>.pdf` via `files.read` and via `shell ls /workspace/input/`.
9. Document artifacts (PDF/XLSX/DOCX) and image artifacts (`image_generate` outputs) continue to render in the chat UI exactly as today — i.e. the `assistant_files` delivery channel for outgoing artifacts is unchanged.
10. Historical chats (predating the cutover) still render their existing `files.*` references correctly (read-only backward compatibility for already-stored `assistant_files`).
11. Cold start latency on the first `files.write` of a fresh session is bounded by the existing pod-provisioning budget from ADR-123 (no new round-trips that don't already exist for `shell`).

12. A plan with `workspaceStorageBytesLimit < 500 MB` that activates D4 and exceeds its cap returns a clean `workspace_quota_exhausted` error from the existing quota guard, not a silent truncation; plans at or above 500 MB run npm/pip workloads end-to-end without artificial sandbox-side limits.

13. `files.preview({path:"/workspace/foo.png"})` returns a fresh preview after a subsequent `shell({command:"convert ... foo.png"})` overwrites the same path (the new content-hash-keyed cache invalidates without an explicit bust call).

## Resolved decisions (founder sign-off 2026-06-22)

Every Open Question carried in the first draft of this ADR was decided in the 2026-06-22 session. These are the **final positions** the implementation program will execute:

1. **`git push` policy — DENY in v1.** The egress proxy filters HTTPS methods so `POST` to `…/git-receive-pack` is blocked at the proxy boundary regardless of host. `git clone` / `git fetch` / `git pull` / read-only API calls against GitHub work; `git push` does not. Reopening this is an **explicit follow-up addendum on ADR-126**, not a flag or env toggle — adding `git push` requires a written threat-model update (which org / which branch / what audit hook) before any code change.

2. **Node LTS line — Node 22 LTS.** Installed from NodeSource `setup_22.x` on the exec image; matches the control-plane image's `node:22-bookworm-slim` base so the LTS line is identical on both planes. No `nvm` / `n` runtime version-switching needed in v1.

3. **Git hosts — GitHub only in v1.** `github.com`, `*.github.com`, `gist.github.com`, `*.githubusercontent.com`, `api.github.com`. GitLab, Bitbucket, and other public Git hosts are intentionally **out of v1**. Adding them is a one-line proxy-config follow-up once real usage shows demand; doing it pre-emptively widens the allowlist surface without a clear win.

4. **Workspace size cap — stays plan-managed (existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit`).** ADR-126 does **not** introduce a new sandbox-side cap and does **not** override the existing per-plan setting that `MaterializeAssistantPublishedVersionService.resolveWorkspaceQuotaBytes` resolves into `bundle.governance.quota.workspaceQuotaBytes`. The only ADR-mandated change: the implementation slice **raises the default plan baseline** (currently single-digit MB, sized for doc/data) to **500 MB** for any plan that activates the new D4 capabilities (npm/pip installs land in `/workspace/.local` and `/workspace/.npm-global`, so heavy plans naturally accumulate hundreds of MB). Plans that stay below 500 MB continue to work; jobs that exhaust their per-plan cap get a clean `workspace_quota_exhausted` error from the existing quota guard, not silent loss. Founders/operators can tune each plan independently via the existing billing-hints path; nothing new to learn.

5. **`files.preview` cache key — `(assistantId, workspaceId, relPath, content_hash)`.** The cache rebuilds on content rewrite: a model that overwrites `/workspace/foo.png` invalidates cleanly without an explicit cache-bust call. This replaces today's `fileRef`-keyed cache (ADR-116) on the `files.*` path; the existing `fileRef`-keyed cache for outbound artifact previews (`document`, `image_generate`) is **untouched** — those still flow through `assistant_files` and keep their existing cache key.

Each decision above is a hard contract for the implementation program. Any deviation requires re-opening the corresponding question in a new ADR addendum, not a silent slice-level edit.

## Consequences

### Positive

- Sandbox feels like one workspace, not two glued surfaces — model agency catches up to Claude-Code / Cursor parity.
- `shell` is `bash` — the model's mental model from public training data transfers verbatim.
- Public git/PyPI/npm work — the model can clone real libraries and install ad-hoc dependencies, which is the actual production usage pattern of an agent.
- Tool catalog guidance becomes honest about runtime installs.
- `assistant_files` retains a clear, narrow role (chat IO boundary) — no longer a confusing "second filesystem".

### Negative / risks

- Egress surface widens; proxy logging + audit hook become the primary detection mechanism for misuse (already in place from ADR-123).
- `/workspace` snapshots get larger; GCS storage cost goes up linearly with session activity (still bounded by per-workspace cap).
- Implementation touches `apps/sandbox` + `apps/runtime` + `apps/api` + tool catalog + Dockerfile + Helm — non-trivial slice, must land clean per program-style (no transitional flag).
- Tool catalog guidance change is a **model-behavior** change too: the model needs one or two turns to internalize the new "files = workspace path" mental model. Risk mitigated because the new model-facing description is direct ("everything you write here is also visible from shell").
- `git push` stays denied. Reopens are explicit, not a silent drift.

## Alternatives considered

- **Dual write (`files.*` writes to both `assistant_files` AND `/workspace`).** Rejected. AGENTS.md "no parallel code paths" + founder direction "сразу чисто". The whole point is to make the FS singular.
- **Keep `files.*` against `assistant_files` and tell the model "if you want shell visibility, use `shell cat <<EOF`".** Rejected. That is exactly the workaround the model improvised on 2026-06-22; ADR-126 exists to retire it, not bless it.
- **Make `/workspace` the chat-delivery channel too (delete `assistant_files` entirely).** Rejected. Chat artifacts have UX/quota/sharing/billing semantics distinct from session-scoped workspace files. Conflating them would force a much larger ADR and break ADR-097 / ADR-116 / image-gen flows.
- **Use Git over SSH for git clone.** Rejected for v1. SSH requires storing a private key in the exec pod env, which conflicts with ADR-123 D2 "no real secrets in execution unit". HTTPS clone is enough for public repos.
- **Always run `/bin/bash` but keep `/bin/sh -lc` as the entry point for backward compatibility.** Rejected. The whole point of the bash default is consistent semantics; a `sh` indirection invites the exact dash-vs-bash drift this ADR is closing.
- **Land all four points in one mega-slice.** Possible. The 4-slice plan above is the conservative breakdown so each lands cleanly on the AGENTS gate; collapsing to one big slice is an implementer's call at the time of dispatch, not an architectural decision.
