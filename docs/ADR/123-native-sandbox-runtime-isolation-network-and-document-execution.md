# ADR-123: Native sandbox runtime — isolation, lifecycle, network, secrets, and in-sandbox document execution

## Status

Accepted — 2026-06-20 (open program; bounded slices — see Work plan)

- **Slice 1 LANDED** — 2026-06-20 (commit `29a20860`)
- **Slice 2 LANDED** — 2026-06-20 (commit `a0336bed`)
- **Slice 3 LANDED** — 2026-06-20 (per-session pod reuse, idle-TTL reaper, GCS-keyed workspace snapshot; warm pool DEFERRED — see Work plan note)
- Slices 4–7 pending

> Open orchestration ADR. New long-term system rule: untrusted model-authored code runs inside a kernel-isolated, secret-free, per-session sandbox with deny-all egress behind an allowlist proxy; PDF/Excel/DOCX/data documents are produced **in** that sandbox (headless Chromium + a Python doc/data stack) rather than via an external render SaaS; and `grep`/`glob`/`shell` become first-class workspace tools. This program is executed by an orchestrator dispatching `sonnet` sub-agents. **Prod-first: no transitional flags, no permanent fallbacks, no compatibility shims — user base is still small, so we cut over cleanly.**

## Date

2026-06-20

## Relates to

ADR-069 (workspace storage quota and DinD/privileged removal — isolation lineage: we replace the removed DinD with gVisor, never privileged), ADR-072 (PersAI-native multichannel runtime), ADR-081 (unified user-files architecture), ADR-097 (autonomous document tool and async rendering — **this ADR supersedes its PDFMonkey render-backend decision**), ADR-116 (runtime file re-view / inspect / read / preview), ADR-122 (output budget and context window as model capabilities — interlocks with the large-document fix here).

**Out of program (separate ADR, do not fold in here):** unified scenario-todo / scenario step progression (skills line, ADR-118/119 sanctioned founder follow-up), Subagent/Task delegation, TodoWrite, IDE-specific edit tools (MultiEdit/NotebookEdit).

---

## Context

### Symptom (user-visible / founder-stated)

1. The sandbox is "weak": much is blocked, the model barely uses `shell`, and there are no preinstalled packages (no Python data/doc stack) the way Anthropic/OpenAI provide.
2. Network is "wrong" — not restricted the way Anthropic restricts it.
3. Document work is the priority pain: PDF exists but is fragile (large texts break), Excel/DOCX do not exist, presentations go through Gamma. The PDF path is OCR → LLM-authored HTML+CSS → external **PDFMonkey** render, with patch-based HTML edits.

### Audited current state (independently verified, file:line)

**Isolation — none beyond the pod.** The sandbox is a long-lived NestJS pod that runs model code via raw `child_process.spawn()` / `/bin/sh -lc` in its own process tree (`apps/sandbox/src/sandbox.service.ts:907`, `:798`). No `runtimeClassName`, no `securityContext`, no gVisor/Kata/Firecracker/nsjail anywhere in `infra/helm`. DinD-privileged was removed by ADR-069 and **nothing replaced the isolation boundary.**

**Secrets leak into model code.** `DATABASE_URL` and `PERSAI_INTERNAL_API_TOKEN` are injected as env into the sandbox pod (`infra/helm/values-dev.yaml:448`). Because execution shares that process environment, any `shell`/`exec` call can read them from `/proc/self/environ`. The sandbox uses `api-sa`, not a dedicated least-privilege SA (`values-dev.yaml:422`).

**Network egress is open; the "block" is a string scan.** The only NetworkPolicy is ingress-only (`infra/helm/templates/networkpolicies.yaml:44`, `policyTypes: [Ingress]`), so egress is allow-all at the kernel. `assertNetworkPolicy` (`sandbox.service.ts:2237`) only greps the command for `curl `/`http://`/`pip install`/… — trivially bypassed by `python3 -c "import socket…"`. Default policy `networkAccessEnabled: false`.

**Lifecycle — long-lived shared pool, not per-session.** `replicaCount: 2` long-lived Deployment (`values-dev.yaml:455`); jobs queue in Postgres; workspace lives in pod `tmpdir` (`resolveWorkspaceSessionRoot`, `sandbox.service.ts:1330`) rehydrated from GCS by hash. No warm pool, no idle-TTL eviction, no per-session container.

**Image — bare Node.** `node:22-bookworm-slim` + `openssl` only (`apps/sandbox/Dockerfile`). No Python, no pip, no pandas/numpy/openpyxl/matplotlib/weasyprint/reportlab, no ripgrep/fd. `python3 …` → ENOENT.

**Document pipeline runs in `apps/runtime` + external SaaS, not the sandbox.** OCR (`document-extraction.service.ts`: local `pdf-parse`/`mammoth` → Mistral OCR → LlamaParse) extracts source text; the LLM authors a full HTML document; `repairHtmlDocument` (parse5) + print CSS; render via **PDFMonkey** (`pdfmonkey-provider.client.ts:68`, `/api/v1/documents/sync`). Patch-revise / structured-revise / chunked all exist in `runtime-document-provider-adapter.service.ts`. Presentations via Gamma (`gamma-provider.client.ts`). **No Excel/XLSX, no DOCX output, no plain-text/markdown export anywhere.**

**Large texts break — primary cause.** Document HTML generation is bounded by the per-model output budget; an unseeded slot resolves to `OUTPUT_BUDGET_FALLBACK = 8_192` (`apps/runtime/src/modules/turns/model-output-budget.ts`, post-ADR-122). The truncation detector only fires when `</html>` is missing **and** body text is very short, so a model that closes the tag before token exhaustion produces a silently-shortened document; and a freeform request with no source attachment never routes to chunked.

**Tools — `shell`/`exec` off by default and discouraged; no `grep`/`glob`.** Catalog (`apps/api/prisma/tool-catalog-data.ts`): `shell`/`exec` `active:false`; `files` `active:true`. Projection (`apps/runtime/src/modules/turns/native-tool-projection.ts`): `files` runs `inline`, `exec`/`shell` run in `sandbox`. The `shell` description actively steers away ("Prefer the `files` tool… reserve shell for genuine shell composition"). There is no `grep` and no `glob` tool; content search is only possible via `shell grep`, which is off. `<tool_usage_policy>` has no category for code/sandbox execution.

### How Anthropic and OpenAI do it (verified 2026-06-20)

- **Anthropic** (Claude Code / sandbox-runtime): OS-level isolation (bubblewrap/Seatbelt) with the **network namespace removed**, so all egress must traverse an **out-of-sandbox proxy enforcing a domain allowlist** (deny-all by default). Secrets are held **outside** the sandbox; scoped credentials are injected by the proxy so code never sees the real token. Tool output can be inspected before entering context. `Grep`/`Glob` are dedicated tools the model is told to prefer over `bash grep`/`find`.
- **OpenAI** (Code Interpreter → hosted shell containers): per-session sandboxed VM/container, **idle TTL (≈20 min, activity-extended)**, persistent `/workspace`, preinstalled Python data stack, network **restricted by default + allowlist**, newer containers preinstall Python/Node/Go/Java and allow controlled package install.

**Convergent best practice → target:** kernel-isolated per-session sandbox, deny-all egress + allowlist proxy, rich preinstalled runtime, secrets strictly outside the execution unit, autonomous shell, dedicated grep/glob. Every point is the opposite of the current state.

## Decision

Rebuild the sandbox as a **native, kernel-isolated, secret-free, per-session execution runtime with allowlisted egress**, give it a **Python + Node document/data stack and headless Chromium**, move **document rendering and Excel/DOCX/data-document generation into the sandbox**, retire **PDFMonkey**, and make **`grep`/`glob`/`shell`** first-class. Clean cutover — no transitional flags, no permanent fallbacks.

### D1 — Isolation: gVisor + hardened securityContext

Run model code under **gVisor** via a GKE Sandbox node pool and `runtimeClassName: gvisor`. The execution Pod carries a strict `securityContext`: `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, `readOnlyRootFilesystem: true` with writable mounts only for `/workspace` and a sized `tmp`. No privileged, no DinD (consistent with ADR-069). Headless Chromium runs with `--no-sandbox` because gVisor is the isolation boundary (Chromium's own sandbox conflicts with gVisor).

### D2 — Execution / control-plane split (secret-free execution)

Split the single sandbox process into two roles:

- **Control plane (trusted):** job queue (Postgres), workspace leases, GCS sync, lifecycle. Holds secrets, runs only PersAI code, never executes model-authored commands.
- **Execution unit (untrusted):** the gVisor container that runs model code. **Zero secrets**: `DATABASE_URL`, `PERSAI_INTERNAL_API_TOKEN`, and any provider/GCS credentials are removed from its environment; env is scrubbed before exec. It has no direct DB or object-storage credentials. Files are placed into / collected from `/workspace` by the control plane, not by giving the execution unit storage creds. A dedicated least-privilege ServiceAccount replaces the shared `api-sa`.

### D3 — Network: deny-all egress + allowlist proxy

Egress is denied at the kernel (NetworkPolicy `Egress` + gVisor network isolation). All outbound traffic from the execution unit traverses an **egress proxy** enforcing a **domain allowlist** (package registries for controlled installs, approved API hosts). Where a privileged destination needs credentials, the **proxy injects scoped credentials**; model code never sees the real secret (Anthropic pattern). The application-level `assertNetworkPolicy` string scan is **removed** — it is not a security boundary and is replaced by the kernel + proxy boundary.

### D4 — Lifecycle: per-session container, idle-TTL, warm pool, persisted workspace

Replace the long-lived shared-process model with **per-session execution containers**: an idle TTL (target ~20–30 min, refreshed on activity), a **warm pool** of pre-provisioned containers to remove cold-start latency, and a `/workspace` that is **persisted to GCS keyed by assistant+session** and rehydrated on the next activity — so files survive within a session and across pod restarts ("like Claude Code"). Per-process wall-clock / CPU / memory / output limits stay enforced (existing policy), now backed by real kernel isolation.

### D5 — Image: Python + Node + doc/data stack + Chromium + ripgrep/fd

The sandbox image preinstalls: **Python 3** with `pandas`, `numpy`, `matplotlib`, `openpyxl`, `python-docx`, `weasyprint`, `pdfplumber`, `Pillow`; **Node** (retained); **headless Chromium** (for PDF render); **ripgrep** + **fd** (fast search backing `grep`/`glob`/`shell`). Controlled additional installs go through the D3 allowlist proxy. The package set is the runtime contract for document mode B and autonomous shell.

### D6 — PDF cutover: headless Chromium in sandbox, PDFMonkey removed

Render HTML→PDF with **headless Chromium inside the sandbox**. **Remove PDFMonkey entirely** — client, env, API key, and references — with **no transitional flag** (small user base). What is preserved (renderer-agnostic, HTML is the intermediate representation): **HTML authoring**, **patch-revise**, **structured-revise**, **OCR source extraction**. What is migrated: the **outer HTML shell + print CSS** that PDFMonkey's template provided is brought in-house into our HTML assembly (page size, margins, page counters). What is re-examined, not kept reflexively: **chunked** — re-evaluate against ADR-122 budgets and simplify if it is now redundant; and the **truncation detector** weakness (only firing on missing `</html>` + short body) is corrected so silently-shortened documents are detected.

### D7 — Documents mode B: model-writes-code for Excel / DOCX / data PDF

Add a **code-generation document path**: the model writes a short program executed in the sandbox that deterministically emits a native artifact — **Excel** (`openpyxl`), **DOCX** (`python-docx`), and **data-driven PDF** (Python/Chromium). This **decouples document size from the output-token budget** (the model writes ~hundreds of lines that emit dozens of pages), which is the structural fix for "large texts break" and the way to honestly produce data documents. This is a **new path**, not a backend swap: the HTML/prose pipeline (mode A) is unchanged. Routing between mode A (prose/editorial → HTML→Chromium) and mode B (data/structured → code) is an explicit decision in the document worker.

### D8 — Tools: grep + glob inline, shell as a first-class autonomous tool

- Add **`grep`** (ripgrep-style content search, structured `file:line`, glob/type filters) and **`glob`** (filename-pattern find, sorted) as **inline workspace tools** — they run over the workspace without spawning the sandbox container, so they are fast and cheap. This gives Claude-Code parity and matches Anthropic's guidance to prefer dedicated grep/glob over `bash grep`/`find`.
- Make **`shell`** first-class: rewrite its model-facing description to encourage proactive multi-step use and **remove the "prefer files / reserve shell" discouragement**; add a **code/sandbox-execution category to `<tool_usage_policy>`**; ensure `ripgrep`/`fd` are present (D5). `exec`/`shell` execute against the new per-session sandbox (D1–D4).
- **Activation defaults and the per-turn tool-loop budget remain plan-managed** (founder-tuned), not hardcoded — the current loop cap of 3 is a plan setting the founder raises when ready.

## Work plan

Bounded slices for the orchestrator to dispatch to `sonnet` sub-agents. Each slice ends on the `AGENTS.md` verification gate, is committed as it lands, and **the program is pushed only at the very end** (push triggers deploy). No transitional flags or fallbacks in any slice — each slice lands clean.

**Foundation (sequential):**

- **Slice 1 — Isolation & secret-free execution baseline.** D1 + D2: gVisor node pool + `runtimeClassName`, hardened `securityContext`, dedicated least-privilege SA, remove `DATABASE_URL`/internal-token from the execution env, split control-plane vs execution roles. Verify a model command cannot read pod secrets.
- **Slice 2 — Egress proxy + allowlist.** D3: NetworkPolicy Egress + proxy with domain allowlist; remove `assertNetworkPolicy` string scan; scoped-credential injection at the proxy. Verify deny-all egress and allowlisted package install. **[LANDED — 2026-06-20]**
- **Slice 3 — Per-session lifecycle + persisted workspace. [LANDED]** D4 (partial): per-session container with pod reuse across jobs, idle-TTL reaper (default 30 min, configurable), GCS-keyed `/workspace` tar snapshot (keyed by `assistantId+runtimeSessionId`) restored on pod recreate. Config: `SANDBOX_EXEC_SESSION_IDLE_TTL_MS`, `SANDBOX_EXEC_REAPER_INTERVAL_MS`. Sessionless (null `runtimeSessionId`) jobs remain ephemeral (Slice 1 behavior preserved). Serialization guarantee: existing `assistantId+workspaceId` Postgres lease mutex already serializes all session jobs — no additional locking needed. **Warm pool DEFERRED**: cold-start latency (~2–4s gVisor) is acceptable at current scale; warm pool raises infra complexity without blocking feature value. Track as a future optimization, do not open a new ADR until load evidence justifies it.
- **Slice 4 — Image stack.** D5: Python + doc/data libs + Chromium + ripgrep/fd; Node retained. Verify `python3`, `weasyprint`, `chromium`, `rg`, `fd` all run inside the sandbox.

**Consumers (after foundation; Slices 5–7 may parallelize where they touch disjoint code):**

- **Slice 5 — PDF cutover.** D6: render via in-sandbox headless Chromium; remove PDFMonkey entirely; port template shell + print CSS in-house; correct the truncation detector; re-examine/simplify chunked. Keep HTML-IR + patch/structured-revise. Verify PDF parity/superiority on long documents.
- **Slice 6 — Documents mode B.** D7: model-writes-code Excel/DOCX/data-PDF executed in sandbox; mode A/B routing in the document worker. Verify a large data document is produced without hitting the output-token ceiling.
- **Slice 7 — Tools.** D8: add `grep` + `glob` inline tools; rewrite `shell` description and add the `<tool_usage_policy>` code category; point `exec`/`shell` at the new sandbox. Plan-managed activation/loop budget unchanged. Verify the model autonomously uses shell/grep on a multi-step file task.

Docs to update as repo truth changes: `docs/ARCHITECTURE.md` (sandbox plane), `docs/API-BOUNDARY.md` (sandbox contract, removed PDFMonkey), `docs/DATA-MODEL.md` (if persisted shapes change), `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`.

## Consequences

### Positive

- Real kernel isolation for untrusted model code; secrets no longer reachable from the sandbox.
- Network restricted the Anthropic way (deny-all + allowlist proxy) instead of a bypassable string scan; controlled package install becomes possible.
- Per-session workspace with warm-pool latency — Claude-Code-like session continuity.
- One owned render path (Chromium) — PDFMonkey dependency, cost, and network hop removed; HTML-IR + edit logic preserved.
- Excel/DOCX/data documents become possible; large documents stop being bounded by the LLM's output-token budget (mode B).
- `grep`/`glob`/autonomous `shell` make the model actually use the sandbox.

### Negative / risks

- gVisor imposes some syscall/perf overhead and Chromium-under-gVisor requires `--no-sandbox` + tuning; validated in Slice 4/5.
- Per-session containers + warm pool raise infra complexity and idle resource cost vs a shared pool; bounded by TTL and pool sizing.
- Removing PDFMonkey with no fallback means Chromium parity must be confirmed in Slice 5 before the program is pushed.
- The control-plane/execution split is a real refactor of `apps/sandbox`; Slice 1 must keep the job contract (`RuntimeSandboxJobRequest/Result`) stable for `apps/runtime`.

## Alternatives considered

- **Harden raw-spawn only (non-root, seccomp, scrubbed env) without gVisor.** Rejected — still shares one kernel/process boundary with the host; not the Anthropic/OpenAI bar for untrusted code.
- **microVM/Firecracker/Kata.** Rejected for now — stronger but heavier to operate on GKE than gVisor; gVisor is the native GKE Sandbox path.
- **Keep PDFMonkey as a fallback behind a flag.** Rejected by founder — with few users a permanent dual render path is exactly the legacy tail we are avoiding; clean cutover instead. A short validation flag was also rejected as unnecessary given no production user base.
- **Fix only the HTML/token pipeline (no mode B).** Rejected — does not produce Excel/DOCX and does not structurally decouple document size from output tokens; the model-writes-code path is the honest large-document fix.
- **Add grep/glob as `files` actions instead of named tools.** Rejected — named `grep`/`glob` match what the model is trained to reach for (Claude-Code parity) and drive higher real usage.
- **Build TodoWrite / scenario step progression here.** Rejected from this program — it belongs to the skills/scenario ADR line (separate ADR), not the sandbox runtime.
