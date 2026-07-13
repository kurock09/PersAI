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

Additional UX ADR **closed locally 2026-07-11:** `docs/ADR/141-native-browser-activity-thumbnail.md` (Capacitor-only bounded local browser miniatures after assistant operation boundaries, tap reopens the same retained native view, no server persistence or desktop extension change, no Fold/tablet/UA heuristics; Android 1.0.24 built/exported, deploy/install/live acceptance and iOS Xcode/device acceptance pending; do not reopen for new scope).

Additional UX ADR **closed 2026-07-11:** `docs/ADR/142-turn-scoped-local-browser-observer-lock.md` (mobile + desktop retained browser profiles remain observer-only across the whole assistant turn; trusted user click/scroll/swipe/keyboard input is blocked until stream completion or explicit `request_user_action`; Android 1.0.37 built/exported/installed, web + extension deploy and live acceptance pending; do not reopen for new scope).

Additional orchestration program **closed locally 2026-07-11:** `docs/ADR/143-tiered-tool-observation-projection.md` (S1–S5 local gate green — one production model-facing projection for in-turn `toolHistory` and cross-turn `priorToolExchanges`: tiers `full`/`compact`/`masked`, tool-aware compactors for browser/shell/exec/files, full canonical storage unchanged, naive D8 char-tail truncate deleted, `[toolHistoryProjection]` metrics log; `MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS` stays 200; deploy + Lavka live smoke pending; do not reopen for new scope).

Additional UX ADR **closed locally 2026-07-12:** `docs/ADR/144-adaptive-native-orientation-and-medium-window-shell.md` (ordinary native phones portrait-only; iPad/Android large windows and unfolded foldables rotate; web shell switches by actual viewport at 600px; matching Telegram-like 22px desktop panel rounding; Android 1.0.39 built/exported, Fold device + iOS Xcode acceptance pending; do not reopen for new scope).

Additional UX ADR **closed locally 2026-07-12:** `docs/ADR/145-telegram-like-chat-list-archive-and-mobile-row-actions.md` (mobile axis-locked archive/restore swipes, pull-to-reveal Archive before refresh, inline Delete/Rename with idle/outside close, persistent desktop Archive group, explicit cap-safe unarchive API; automated local gate green, logged-in visual acceptance pending; do not reopen for new scope).

Additional active orchestration program: `docs/ADR/146-assistant-owned-full-public-sandbox-egress.md` (opened 2026-07-12 — assistant-owner `restricted | full_public` sandbox egress choice; restricted allowlist proxy remains default, explicit opt-in gives the whole gVisor execution pod direct public internet while cluster/VPC/private/metadata remain blocked; dead plan `networkAccessEnabled` is removed with no alias or transition mode. **Slice 0 completed with implementation NO-GO** on `LEGACY_DATAPATH` (Calico/Cilium disabled). **Slices 0.1 + 0.1b are live-accepted** on current remote/deployed bot pin **`64be77d6`**: `api`/`web`/`runtime`/`provider-gateway` exact **`3cd2ea4f`** (2/2 Ready each); sandbox remains **`8a0043dd`** (2/2); Argo Synced. Final restricted foundation gate **PASS** at proof pin `e5c249c3` / inventory SHA-256 `c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7` remains the enforcement evidence (HTTP redirect / DNS-rebind still explicitly unclaimed RUNBOOK checks; inbound later live-proven PASS on full-public contour). GitHub Environment `persai-dev-adr146-foundation` **approved** by required reviewer; deferred-pin resume workflow run **`29237479924`** validate + Environment-gated pin both success (historical first resume failed on pin-assert EOF mismatch; EOF CLI/lib repair landed; successful second run is current). Post-rollout public `https://persai.dev/api/health` 200 `{status:ok}`, `https://persai.dev/api/ready` 200 `{status:ready}`, PersAI MCP chat smoke exact `ADR146_POST_ROLLOUT_OK`. **Slice 1 committed locally at `775e5781`** — canonical `Assistant.sandboxEgressMode`, owner GET/PUT `/sandbox-egress`, legacy `networkAccessEnabled` deletion. **Slice 2 committed locally at `5a2fd3bd`** — Helm public-only policy / additive full-public NP / shared deny inventory / restricted-default egress-mode contract. **Slice 3 committed locally at `8d0520f4`** — last-responsible-moment DB mode authority, pod label/annotation + recycle, owner sync eviction with honest `recycled`/`503`, mandatory exact-pod retirement after persistence and before lease release. **Slice 4 committed locally at `3f498ef9`** — Assistant Settings consent UX. **Slice 5 committed locally at `d23936d1` on baseline `3f498ef9`** — cross-layer audit, D9 observability, legacy active-code audit, contract tests, deploy/rollback runbook (`infra/dev/gke/ADR146-OBSERVABILITY.md`). ADR-146 stays open; **S6 in progress**: earlier **shell/full_public/metadata smokes PASS** preserved; **S6 restricted live `probe-restricted` PASS** at release/main **`7e385bbe`**; **inbound live-proven PASS** (`INBOUND_TIMEOUT` on full-public pod `ses-97982c194f5602591e016a81c3352e53`); **public-master `PUBLIC_MASTER_REACHABLE` FAIL/blocker** (TCP to `34.38.46.10:443` succeeded) — D4 dual-layer `/32` repair **implemented locally uncommitted on `bd1c3e0c`** (shared public-deny inventory → Calico except + sandbox-tagged VPC firewall; fail-closed live endpoint equality; firewall apply updates drifted destinations; keep public endpoint enabled; optional MAN/endpoint-disable are future hardening only; live re-proof pending; new inventory SHA-256 `589c1c0e0561645dc08cf45a58313450f90ab5c460b939ca6d60692bd2b8126d`; do not retcon historical proof SHA `c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`). Chat-smoke hard 90s process timeout is not an ADR-146 network failure. HTTP redirect / DNS-rebind remain unclaimed; broader S6 helper still needs operator-owned SSH/TCP/UDP/redirect/DNS fixtures. Do not claim full S6 or ADR closure. Continuity-doc recording is local documentation on top of release pin `7e385bbe`. Dataplane V2 migration is outside ADR-146. Parent agent is orchestrator/auditor; Cursor Grok 4.5 subagents implement one bounded slice at a time; parent alone owns the final gate, deploy, live acceptance, and closure).

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
- ADR-146 foundation marker paths force a split-pin path: `sandbox` pins immediately after a successful sandbox image build; remaining affected service tags wait on ordered GitHub Environment approvals (`persai-dev-adr146-foundation`, then `persai-dev-migrations` when both apply — neither may be bypassed). Fail closed if the sandbox build/pin is missing. Non-foundation pushes keep the ordinary immediate/migration pin behavior. CI never auto-applies foundation cluster mutations.
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
