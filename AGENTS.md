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
8. relevant `docs/ADR/*` for the task at hand. Migration history: `docs/ADR/072-persai-native-multichannel-runtime-replacement.md`. **Active orchestration programs:** `docs/ADR/129-agentic-document-workspace-extraction-render-inspect-and-versioning.md` (opened 2026-06-29 — redesigns the `document` tool into a workspace-visible extraction/render/inspect/version workflow; 2026-07-01 addendum landed for auto-register on render + extract `nextAction` hint; use GPT-5.4 implementation subagents, with the parent agent as orchestrator/auditor), `docs/ADR/130-prompt-layering-cache-discipline-and-lazy-context-lookup.md` (opened 2026-06-29 — prompt-architecture cleanup program for compact cached prefixes, single-owner prompt/tool layering, and lazy action-based context lookup; use GPT-5.4 implementation subagents, with the parent agent as orchestrator/auditor), and `docs/ADR/131-workspace-project-isolation-and-cross-turn-delivery-safety.md` (opened 2026-07-01, broadened same day, all founder-decision points closed same day — umbrella implementation contract for workspace file identity, isolation, and safe delivery across the whole model-facing `files.*` surface; Slices 1–3 landed locally 2026-07-01 and await final batched verification/push: default `(N)` collision + boolean `replace: true`, replace projection refresh for attachments/cache, chat default scope, assistant/workspace_shared on-demand widens, `crossScope:true` for deliberate cross-scope operations, and Block 3 residual guidance/guard documentation for fresh document projects, suggestedNextActions, and large-document shell-dump avoidance. **2026-07-02 delivery-safety correction landed locally** (Addendum 2026-07-02, awaiting deploy+live): the Wave 13B `files.attach` provenance wall was itself a P0 delivery bug, so attach now auto-registers project-owned outputs server-side and delivers exactly once (supersedes Wave 13B refusal); `document.extract` is idempotent per source identity with latest-version editing; `document.render` is the single door with no `export_pdf.py`/shell steering (shell not gated); seeded exporter reads `PERSAI_OUTPUT_PATH` from `os.environ`. Cross-turn tool-memory root cause is owned by ADR-130 D8. Full-close of ADR-129 + ADR-131 is deferred until post-deploy live regression passes; use GPT-5.4 implementation subagents, with the parent agent as orchestrator/auditor). **Closed program archive** (do not treat as active backlog): `docs/ADR/078-consolidated-follow-through-program.md` through `docs/ADR/115-inbound-safety-program-contour-heuristics-and-async-moderation.md`, plus **`docs/ADR/118-skill-scenarios-and-model-owned-activation.md`** (superseded by ADR-119) and **`docs/ADR/119-prompt-architecture-and-2026-context-engineering.md`** (closed 2026-06-19 — founder acceptance; do not reopen), **`docs/ADR/120-rag-knowledge-unification-and-memory-jit.md`** (closed 2026-06-20 — all seven slices + Closure I & II landed, deployed, live-validated; HNSW `halfvec(3072)` index + legacy JSONB embedding column drop done; do not reopen), **`docs/ADR/121-two-dimensional-execution-routing-model-and-thinking-budget.md`** (closed 2026-06-20 — all five slices landed, deployed, live-validated; do not reopen), **`docs/ADR/123-native-sandbox-runtime-isolation-network-and-document-execution.md`** (closed 2026-06-22 — Slices 1–7 + all 2026-06-21 addenda landed, deployed, live-validated; sandbox image carries `rg`+`fd` on PATH in the running pod; do not reopen), **`docs/ADR/124-provider-agnostic-model-routing-prompt-cache-retention-capability-and-fallback-semantics.md`** (closed 2026-06-22 — all four slices + DeepSeek live-correctness follow-up landed, deployed, live-validated; do not reopen), and **`docs/ADR/125-in-chat-todo-write-and-scenario-seeded-plan.md`** (implemented locally 2026-06-22 — all four slices landed; deploy + live validation pending the next dev rollout; do not reopen for new scope — open a new ADR if follow-up work is needed), **`docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`** + **`docs/ADR/126-v3-CUTOVER-PROGRAM.md`** (closed 2026-06-29 — path-identity cutover landed and follow-through moved to ADR-127/128; do not reopen), **`docs/ADR/127-manifest-source-of-truth-and-pod-fs-cache.md`** (closed 2026-06-29 — manifest/GCS/cache model landed; remaining namespace simplification closed by ADR-128; do not reopen), and **`docs/ADR/128-single-workspace-namespace-retire-shared.md`** (closed 2026-06-29 — flat `/workspace/` namespace, `/shared/<wsid>/` retired, source/file delivery follow-ups landed; do not reopen). **Closure-mode ADR** (Slices landed, golden invariant locked, `cache-prefix rollout SHA` pending — do not reopen for new scope; only `cache-prefix rollout SHA` resolution remains): `docs/ADR/117-tool-instruction-source-of-truth-and-native-tool-runtime-selection-guide.md`.

## Repo rules

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
