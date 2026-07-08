# AGENTS.md

## Mission

This repository contains the active PersAI platform baseline.

## Mandatory startup reading order

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. `docs/API-BOUNDARY.md`
6. `docs/DATA-MODEL.md`
7. `docs/TEST-PLAN.md`
8. relevant `docs/ADR/*` for the task at hand. Migration history: `docs/ADR/072-persai-native-multichannel-runtime-replacement.md`. **Active orchestration programs:** `docs/ADR/130-prompt-layering-cache-discipline-and-lazy-context-lookup.md` (opened 2026-06-29 — prompt-architecture cleanup program for compact cached prefixes, single-owner prompt/tool layering, and lazy action-based context lookup; use GPT-5.4 implementation subagents, with the parent agent as orchestrator/auditor). **Closed program archive** (do not treat as active backlog): `docs/ADR/078-consolidated-follow-through-program.md` through `docs/ADR/115-inbound-safety-program-contour-heuristics-and-async-moderation.md`, plus **`docs/ADR/118-skill-scenarios-and-model-owned-activation.md`** (superseded by ADR-119) and **`docs/ADR/119-prompt-architecture-and-2026-context-engineering.md`** (closed 2026-06-19 — founder acceptance; do not reopen), **`docs/ADR/120-rag-knowledge-unification-and-memory-jit.md`** (closed 2026-06-20 — all seven slices + Closure I & II landed, deployed, live-validated; HNSW `halfvec(3072)` index + legacy JSONB embedding column drop done; do not reopen), **`docs/ADR/121-two-dimensional-execution-routing-model-and-thinking-budget.md`** (closed 2026-06-20 — all five slices landed, deployed, live-validated; do not reopen), **`docs/ADR/123-native-sandbox-runtime-isolation-network-and-document-execution.md`** (closed 2026-06-22 — Slices 1–7 + all 2026-06-21 addenda landed, deployed, live-validated; sandbox image carries `rg`+`fd` on PATH in the running pod; do not reopen), **`docs/ADR/124-provider-agnostic-model-routing-prompt-cache-retention-capability-and-fallback-semantics.md`** (closed 2026-06-22 — all four slices + DeepSeek live-correctness follow-up landed, deployed, live-validated; do not reopen), **`docs/ADR/125-in-chat-todo-write-and-scenario-seeded-plan.md`** (implemented locally 2026-06-22 — all four slices landed; deploy + live validation pending the next dev rollout; do not reopen for new scope — open a new ADR if follow-up work is needed), **`docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`** + **`docs/ADR/126-v3-CUTOVER-PROGRAM.md`** (closed 2026-06-29 — path-identity cutover landed and follow-through moved to ADR-127/128; do not reopen), **`docs/ADR/127-manifest-source-of-truth-and-pod-fs-cache.md`** (closed 2026-06-29 — manifest/GCS/cache model landed; remaining namespace simplification closed by ADR-128; do not reopen), **`docs/ADR/128-single-workspace-namespace-retire-shared.md`** (closed 2026-06-29 — flat `/workspace/` namespace, `/shared/<wsid>/` retired, source/file delivery follow-ups landed; do not reopen), **`docs/ADR/129-agentic-document-workspace-extraction-render-inspect-and-versioning.md`** (closed 2026-07-02 — superseded/completed by ADR-132; all ADR-129 slices and 2026-07-01 addenda subsumed by ADR-132's landed slices; do not reopen), **`docs/ADR/131-workspace-project-isolation-and-cross-turn-delivery-safety.md`** (implemented locally 2026-07-01/02 — Block 1 anti-clobber Variant A + boolean `replace: true`, Block 2 chat-scoped `files.*` + replace-projection refresh, Block 3 stale-project guidance/guards all landed; document-scoped items closed by ADR-132; workspace-scope items await deploy + live regression; do not reopen for new scope), and **`docs/ADR/132-document-single-door-mechanics-and-honest-delivery.md`** (implemented locally 2026-07-02 — all five slices landed under parent-orchestrator supervision: atomic three-verb cutover `inspect`/`render`/`convert`, D4 identity registry with server-side `outputPath → docId` resolution, D5 sibling-Markdown collocation for Case A, Case A/B edit paths locked, document-scoped delivery walls removed, honest delivery on partial failure; deploy + live validation pending the next dev rollout; do not reopen for new scope). **Closure-mode ADR** (Slices landed, golden invariant locked, `cache-prefix rollout SHA` pending — do not reopen for new scope; only `cache-prefix rollout SHA` resolution remains): `docs/ADR/117-tool-instruction-source-of-truth-and-native-tool-runtime-selection-guide.md`.

Additional active orchestration program opened after the startup list above: `docs/ADR/133-session-first-hierarchical-workspace-filesystem.md` (opened 2026-07-03 — founder-directed clean filesystem hierarchy program: default session working directory under `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/`, assistant/workspace widen by ordinary paths, no flat `/workspace/<file>` fallback, no `/workspace/chats`, no stale `workspace_shared` / `crossScope:true` model vocabulary. Slices 1-5 are now landed locally; the ADR remains open only for the parent-orchestrated final gate, deploy, and live acceptance. Parent agent is orchestrator/auditor and implementation must be delegated to GPT-5.4/Sonnet subagents slice-by-slice).

Additional active orchestration program: `docs/ADR/134-path-based-workspace-file-micro-descriptions.md` (opened 2026-07-04 — restore path-keyed semantic index `workspace_file_metadata.shortDescription` via deterministic → generation_request → background cheap-LLM job; restore `files.search` and Working Files batch join; no `AssistantFile` revival, no attachment.metadata mirror. Slices S1–S7; parent agent orchestrator/auditor, GPT-5.4/Sonnet implementation subagents).

Additional orchestration program **closed locally 2026-07-05:** `docs/ADR/135-catalog-tool-projection-and-per-tool-describe.md` (catalog vs full tool projection via per-tool `action:"describe"` (no meta-tool); platform defaults 13 full / 11 catalog; plan `fullProjection` boolean per tool; wire-budget fixture ~8.1k tok savings on 24-tool power-config; Slices S1–S6 landed locally — deploy + live acceptance pending; do not reopen for new scope).

Additional orchestration program **closed locally 2026-07-05:** `docs/ADR/136-operator-api-access-and-cursor-mcp.md` (opened 2026-07-05 — **closed locally 2026-07-05**; deploy + live Cursor acceptance pending; do not reopen for new scope).

Additional active orchestration program: `docs/ADR/137-execution-pod-boundary-and-storage-plane-cutover.md` (opened 2026-07-05 — finish ADR-127 storage-plane truth: pod only for `shell`/`exec`/`document.*`; GCS+manifest for worker outbound, `files.*`, `grep`/`glob`; S0–S2 landed locally; S3–S5 + **S5.1 session-scoped hydrate** + S6 audit pending; parent orchestrator/auditor, GPT-5.4/Sonnet subagents per slice).

Additional orchestration program **closed locally 2026-07-08:** `docs/ADR/140-local-browser-bridge-and-browserless-headless-cutover.md` (persistent Browserless sessions replaced by the local browser bridge [Chrome extension + Capacitor prod]; Browserless retained only for fast public headless reads; S0–S8 implemented locally, Telegram/browser boundary closed, docs reconciled, and final local gate green. Deploy + manual acceptance remain pending; do not reopen for new scope).

Additional orchestration program **superseded by ADR-140 (do not implement new scope):** `docs/ADR/138-browser-persistent-profiles-and-live-login.md` and `docs/ADR/139-browserless-capability-policy-stealth-proxy-elements-and-recovery.md`.

## Repo rules

- ADR-132 has an additional local repair slice landed 2026-07-03: chat delivery for PDF/DOCX/XLSX must be attachment-first and must not wait for best-effort inspect/register/documentLink metadata enrichment; runtime `document.render` / `document.convert` must not recreate the old active `project.json` workflow for ordinary authored/convert outputs.
- one session = one bounded slice unless the user explicitly asks for broader work
- no silent architecture changes
- if docs and code diverge, surface the conflict
- if architecture/API/data model/workflow changes, update docs in the same slice
- every architectural change requires an ADR when it changes long-term system truth
- no git push unless the user explicitly asks
- no dead stubs or TODO scaffolding

## Active path rule

The active PersAI path is native-only:

- `apps/api`
- `apps/web`
- `apps/runtime`
- `apps/provider-gateway`
- `apps/sandbox`

Do not reintroduce OpenClaw-specific deploy wiring, CI workflows, secret names, route modes, or operational docs into the active repo path unless the user explicitly asks for historical analysis.

## Verification gate

Before claiming a change is clean, run:

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`

If generated artifacts changed, regenerate them before running the checks.

## CI / deploy truth

- PR CI uses `scripts/ci/detect-affected.mjs` as the affected-entrypoint.
- Default PR path is risk-oriented and scoped:
  - affected lint
  - affected typecheck
  - affected focused tests
- Full verification now lives separately in `.github/workflows/full-verification.yml` for merge queue / nightly / explicit manual runs.
- Changes in `infra/helm` or `infra/dev/gitops` run deploy-truth validation only (`helm lint` + `helm template`) unless code risk requires more.
- Docs-only and test-only changes must not trigger image publish or GitOps tag pinning.
- Bot-only commits that touch only `infra/helm/values-dev.yaml` must not re-run the main `CI` workflow.
- Prisma/schema/migration changes must not auto-pin `persai-dev`; `Dev Image Publish` now pauses on the `persai-dev-migrations` GitHub Environment and waits for approval before GitOps pinning continues.
- Risky changes escalate back to full CI instead of silently skipping coverage. Treat these as full-check paths:
  - auth / identity / Clerk
  - billing / subscription / payment flows
  - runtime concurrency / scheduling / queueing / admission
  - Prisma schema / migrations
  - root workspace dependency changes
  - CI workflow / affected-rule changes
- Dev image publish uses selective service pinning in `infra/helm/values-dev.yaml` service `image.tag` fields. `global.images.tag` remains the fallback for services that were not rebuilt in that push.

## Live validation guidance

- for local-frontend + GKE-backend checks, read `docs/LIVE-TEST-HYBRID.md`
- for deploy/bootstrap work, read `infra/dev/gke/RUNBOOK.md`
- for GitOps truth, read `infra/dev/gitops/README.md`

## Historical traces

Historical OpenClaw references may remain in ADRs, changelog entries, session handoff logs, and old migrations. Treat them as archive, not as current deploy or runtime truth.

## Required session-ending output

- what changed
- why changed
- files touched
- tests run
- risks or residuals
- next recommended step
