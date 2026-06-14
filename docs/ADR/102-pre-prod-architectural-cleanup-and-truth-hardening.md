# ADR-102: Pre-PROD architectural cleanup and truth hardening

**Status:** Completed (2026-05-30) — all PROD-blocking + recommended slices (0–7, 9, 10) landed and deployed to `persai-dev` on `e3c78b63`; PROD preflight + human smoke passed. Optional Slice 8 (document-worker `document_generation` economics) and the safe cleanup inventory (dead shadow-comparison service, dead `uploadChatAttachment`, skill-badge i18n, narrowed document action union, stale ARCHITECTURE phrase) also landed (2026-05-30); the `native-*` filename rename was intentionally **skipped** (cosmetic/high-churn, `native` is the endorsed PersAI-native term).  
**Date:** 2026-05-30  
**Relates to:** [ADR-078](078-consolidated-follow-through-program.md) (closed continuation program — this ADR does not reopen it), [ADR-081](081-unified-user-files-architecture.md), [ADR-086](086-async-media-jobs-for-generated-image-audio-and-video.md), [ADR-093](093-clean-prod-launch-readiness-and-concurrency-hardening.md) (agent/deploy discipline), [ADR-097](097-autonomous-document-tool-and-async-rendering.md), [ADR-099](099-provider-pricing-catalog-and-unified-model-cost-ledger.md), [ADR-101](101-multi-assistant-workspace-model.md), [ARCHITECTURE.md](../ARCHITECTURE.md), [API-BOUNDARY.md](../API-BOUNDARY.md), [TEST-PLAN.md](../TEST-PLAN.md)

## Context

PersAI is PersAI-native on the active path (`api`, `web`, `runtime`, `provider-gateway`, `sandbox`). ADR-078 is closed. ADR-101 multi-assistant foundation is largely landed. Recent slices (document pending-delivery honesty, Telegram group access, token-metered credits UI) improved specific seams.

A read-only architectural audit (2026-05-30) found that **prod risk is not OpenClaw deploy residue** but **truth gaps at active seams**:

1. Runtime document/media honesty can still produce false “ready/sent” user-visible outcomes in edge tool-order cases.
2. Runtime lacks open-document-job context that media already has.
3. Multi-assistant admin tails still encode pre–ADR-101 assumptions in isolated paths.
4. OpenAPI/generated contracts lag real web/API attachment and Files truth.
5. CI affected lane can miss root `format:check` and under-escalate contract/runtime boundary changes.
6. Economics ledger covers `document_render` and delivery framing, but not internal document-worker LLM usage as `document_generation`.

This ADR is the **single execution program** for cleaning those seams before PROD test users. It is not a rewrite, not a new product feature wave, and not a reopen of ADR-078 backlog.

### Orchestrator re-verification (2026-05-30)

A second read-only pass re-checked every code-level claim against the tree (baseline `011399c8`). All substantive findings hold. Three corrections were applied to this ADR during that pass:

1. **Slice 5 demoted from PROD-blocking to recommended.** OpenAPI/web contract drift is a contract-truth hygiene gap; web already works on hand-rolled types, so it is not a user-facing PROD blocker. Minimum path updated accordingly.
2. **Slice 9 problem statement corrected.** `contracts-boundary` / `runtime-boundary` risks already escalate to the **integration** matrix (`requiresIntegration`) in `detect-affected.mjs`; they only fail to reach `requiresFullCi`. The gap is narrower than originally written.
3. **Slice 4 scope extended.** `manage-admin-assistant-ownership.service.ts` still relies on a `P2002` unique-constraint catch that ADR-101 Slice 1 made dead by removing the `(workspaceId, userId)` uniqueness; that dead catch must be removed when the uniqueness rule is replaced.

## Non-goals

- Reintroducing OpenClaw runtime/deploy wiring or compatibility shims.
- Broad refactors of document worker, media worker, billing, or provider adapters beyond listed slices.
- `document_generation` ledger wiring in the PROD-blocking path (optional follow-up slice only).
- ADR-093 load-proof ladder / HPA scaling work (separate program).
- Landing/UI polish unrelated to truth/honesty (e.g. chat pill width, workflow card contours).
- Mixing unrelated founder WIP into cleanup slices.

## Decision

### Program shape

1. **One session = one slice below.** Do not expand scope mid-session.
2. **Baseline first:** start only from a **clean git tree** after founder commit/push of unrelated WIP.
3. **Direct replace** is default. No new compatibility modes, feature flags, or TODO scaffolding.
4. **Docs in same slice** when behavior or boundary truth changes (`API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, `SESSION-HANDOFF`).
5. **Verification gate** per [AGENTS.md](../../AGENTS.md) before calling a slice clean.
6. **Deploy discipline** follows ADR-093: label each slice `DEPLOY REQUIRED` or `NO DEPLOY EXPECTED`; PROD-blocking slices expect dev deploy + short live smoke.

### Workspace vs assistant truth (canonical for this program)

| Truth                                                 | Scope                             | Notes                                                        |
| ----------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| Subscription / billing row                            | workspace                         | `workspace_subscriptions`                                    |
| Quota usage counters (tokens, storage, media monthly) | workspace                         | shared bucket                                                |
| Effective plan limits for enforcement/display         | resolved via **active assistant** | may differ when `assistantPlanOverrideCode` is set (B2B/Ops) |
| Chats, files, memory, runtime context                 | assistant                         | ADR-101                                                      |

Cleanup slices must **not** accidentally reintroduce user-only assistant lookup. UI plan refresh after assistant switch is a **consistency** fix, not a billing-model change.

### Economics truth (canonical for this program)

| Path                                                          | Ledger today                  | Purpose                                                                                      |
| ------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| PDFMonkey/Gamma render on delivery                            | yes                           | `document_render` via tool-path `billingFacts`                                               |
| Delivery framing LLM text                                     | yes                           | `chat_helper` / completion framing                                                           |
| Document OCR/extraction                                       | yes                           | extraction path                                                                              |
| Document worker internal LLM (outline, sections, HTML, patch) | **yes (Slice 8, 2026-05-30)** | usage aggregated in runtime adapter → `document_generation` ledger row appended at scheduler |

Document economics are now three-way (`document_render` + `chat_helper` framing + `document_generation` worker LLM); Admin read-model still must not overclaim "full platform economics" beyond the wired purposes.

### Mandatory pre-start baseline (Slice 0)

Agent runs read-only:

```bash
git status --short   # must be empty
git log --oneline -n 5
```

Read: `AGENTS.md`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, this ADR.

Run repo gate:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Record HEAD SHA in session handoff. **Do not start Slice 1 on a dirty tree.**

---

## Execution ledger

| Slice | Title                                    | PROD-blocking | Deploy                                                 |
| ----- | ---------------------------------------- | ------------- | ------------------------------------------------------ |
| 0     | Baseline gate                            | yes           | NO                                                     |
| 1     | Runtime document honesty                 | **yes**       | DEPLOY REQUIRED                                        |
| 2     | Runtime media honesty                    | **yes**       | DEPLOY REQUIRED                                        |
| 3     | Runtime open document jobs context       | recommended   | DEPLOY REQUIRED                                        |
| 4     | Multi-assistant admin tails              | recommended   | DEPLOY REQUIRED                                        |
| 5     | OpenAPI + web contract drift             | recommended   | NO (unless contract-only deploy policy says otherwise) |
| 6     | Web assistant-switch plan refresh        | no            | NO                                                     |
| 7     | Telegram inline tool-path ledger         | no            | DEPLOY REQUIRED                                        |
| 8     | Document worker LLM economics (optional) | no            | DEPLOY REQUIRED                                        |
| 9     | CI / deploy hygiene                      | **yes**       | NO                                                     |
| 10    | PROD preflight smoke                     | **yes**       | DEPLOY REQUIRED                                        |

**Minimum PROD path:** `0 → 1 → 2 → 9 → 10`. Slice 5 is **recommended** (contract-truth hygiene, not a user-facing PROD blocker — web already works on hand-rolled types); run it in the full cleanup before PROD if time allows.  
**Recommended full cleanup:** all slices through 10 except optional Slice 8.

---

## Slice specifications

### Slice 0 — Baseline gate

**Scope:** Confirm clean starting point and green verification gate.

**Out of scope:** Any product code changes.

**Exit:** Handoff records baseline SHA + gate commands/results.

---

### Slice 1 — Runtime document honesty

**Status: DONE (2026-05-30)** — `send`+`write_and_send` guarded, batch document-before-files reorder landed, projection copy fixed; tests green.

**Problem:** Same-turn tool order can queue an older file before a new document job registers; `write_and_send` is not guarded; model-facing copy still mentions `deferred`.

**Scope:**

1. Turn-level flag when `document` returns `pending_delivery` (`documentPendingThisTurn` or equivalent).
2. Block all delivery-queueing `files` actions for remainder of turn: `send` **and** `write_and_send`.
3. Within one tool batch, execute `document` before any `files` delivery action regardless of model order.
4. Update `native-tool-projection.ts`: `pending_delivery` / `canSendFileNow=false`, not `action='deferred'`.

**Likely files:**

- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/test/deferred-document-acknowledgement.test.ts`
- `apps/runtime/test/runtime-document-tool.service.test.ts`

**Out of scope:** API document delivery worker, PDFMonkey/Gamma adapters, quota settlement.

**Tests (required):**

```bash
corepack pnpm --filter @persai/runtime exec tsx test/deferred-document-acknowledgement.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-tool.service.test.ts
corepack pnpm --filter @persai/runtime run typecheck
```

**New tests required:**

- `[files.send, document]` same batch → send blocked or no false delivery.
- `write_and_send` with pending document → blocked.

**Deploy:** DEPLOY REQUIRED.

**Human smoke (2 checks):**

1. Create PDF in chat → honest pending copy, no old PDF resend in same turn.
2. Revise PDF → pending acknowledgement, final file arrives via worker only.

---

### Slice 2 — Runtime media honesty

**Status: DONE (2026-05-30)** — deferred-media correction now always normalizes delivery-claiming text; tests green.

**Problem:** Deferred media preserves model text like “готово, держи результат” while job is still open.

**Scope:** Align media acknowledgement correction with document: when deferred media jobs exist and no artifacts were produced, normalize delivery-claiming assistant text to honest pending acknowledgement.

**Likely files:**

- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/test/deferred-media-acknowledgement.test.ts`

**Out of scope:** Media worker, delivery worker, quota reservation.

**Tests (required):**

```bash
corepack pnpm --filter @persai/runtime exec tsx test/deferred-media-acknowledgement.test.ts
corepack pnpm --filter @persai/runtime run typecheck
```

**Deploy:** DEPLOY REQUIRED (can ship with Slice 1 in one deploy if same session boundary allows — prefer **one deploy for Slices 1+2**).

**Human smoke (1 check):** Image generate → pending honest text, final image via worker.

---

### Slice 3 — Runtime open document jobs context

**Status: DONE (2026-05-30)** — `RuntimeOpenDocumentJobContext` + `openDocumentJobs` added to the runtime contract, sourced via `AssistantDocumentJobReadService.listOpenJobsForRuntimeContext` in web sync/stream + Telegram and rendered as an `open_document_jobs` developer section, mirroring `openMediaJobs`; tests green.

**Problem:** Runtime receives `openMediaJobs` but not open document jobs; follow-up turns lack server truth about in-flight PDF renders.

**Scope:**

1. Add `openDocumentJobs` to `packages/runtime-contract` (`RuntimeTurnRequest`).
2. API turn clients pass open jobs from `AssistantDocumentJobReadService.listOpenJobsForWebChat` / chat context (web sync/stream, Telegram) — mirror `openMediaJobs`.
3. Runtime developer section analogous to `buildOpenMediaJobsDeveloperSection`.

**Likely files:**

- `packages/runtime-contract/src/index.ts`
- `apps/api/.../web-runtime-turn-client.service.ts`
- `apps/api/.../web-runtime-stream-client.service.ts`
- `apps/api/.../send-native-telegram-turn.service.ts`
- `apps/api/.../handle-internal-telegram-turn.service.ts` (if needed)
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- focused API/runtime tests

**Out of scope:** Web sidebar document job chips (already partially landed); changing delivery worker ownership.

**Tests:**

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/api run typecheck
```

**Deploy:** DEPLOY REQUIRED.

---

### Slice 4 — Multi-assistant admin tails

**Status: DONE (2026-05-30)** — ownership transfer now plan-aware (`maxAssistants`) with dead P2002 catch removed; ops cockpit web-chat counts scoped to `assistantId`; tests green.

**Problem:** Admin ownership transfer still enforces MVP “1 user = 1 assistant”; Ops cockpit mixes workspace-wide web chat counts with assistant-scoped blocks.

**Scope:**

1. `manage-admin-assistant-ownership.service.ts`: replace global user assistant uniqueness with workspace/plan-aware rules (`assistantPolicy.maxAssistants` or equivalent honest conflict). Also remove the now-dead `P2002` unique-constraint catch — ADR-101 Slice 1 removed the `(workspaceId, userId)` uniqueness it depended on, so that branch can no longer fire.
2. `resolve-admin-ops-cockpit.service.ts`: scope `activeWebChats` / `archivedWebChats` and quota `activeWebChats` to `assistantId` when block is assistant-scoped.

**Likely files:**

- `apps/api/src/modules/workspace-management/application/manage-admin-assistant-ownership.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/test/manage-admin-assistant-ownership.test.ts`
- `apps/api/test/resolve-admin-ops-cockpit.service.test.ts`

**Out of scope:** Billing/subscription workspace-level blocks in Ops (must stay workspace-level).

**Tests:**

```bash
corepack pnpm --filter @persai/api exec tsx test/manage-admin-assistant-ownership.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

**Deploy:** DEPLOY REQUIRED only if admin API behavior must be validated live; otherwise merge with next API deploy.

---

### Slice 5 — OpenAPI + web contract drift

**Status: DONE (2026-05-30)** — `AssistantWebChatMessageAttachmentState`/`...DocumentLink` + required `attachments[]`, Files read surfaces, and `stage-attachment` added to `openapi.yaml`; contracts regenerated; web client message-attachment + cleanup-summary types migrated to generated; web 78/78 + typechecks green. Note: `contracts:generate` requires a follow-up `prettier --write` on generated files before `format:check`.

**Problem:** Real API returns message `attachments[]` with `fileRef`, `documentLink`, `fileDeleted`; OpenAPI `AssistantWebChatMessageState` omits attachments; Files API and stage-attachment not in contract; web uses hand-rolled types.

**Scope:**

1. Extend `packages/contracts/openapi.yaml`:
   - `AssistantWebChatMessageAttachmentState` (+ nested `documentLink` if needed)
   - `attachments[]` on message schemas
   - `/api/v1/assistant/files/*` read surfaces used by web
   - `/api/v1/assistant/chat/web/stage-attachment`
2. Regenerate contracts.
3. Migrate `apps/web/app/app/assistant-api-client.ts` message/file read paths toward generated types where OpenAPI now covers them.

**Out of scope:** Rewriting entire assistant-api-client; SSE stream parser stays custom.

**Tests:**

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/web exec vitest run app/app/assistant-api-client.test.ts app/app/_components/chat-message.test.tsx
corepack pnpm --filter @persai/web run typecheck
```

**Docs:** Update `API-BOUNDARY.md` only if boundary wording changes.

**Deploy:** NO DEPLOY EXPECTED (contract + web only).

---

### Slice 6 — Web assistant-switch plan refresh

**Status: DONE (2026-05-30)** — `refreshAssistantScopedSlices` now also refetches `getAssistantPlanVisibility` and `setPlan`, so per-assistant plan UI no longer stays stale after switch/create; test green.

**Problem:** After switch/create assistant, `refreshAssistantScopedSlices` does not refetch plan visibility.

**Scope:** Add `getAssistantPlanVisibility(token)` to assistant-scoped refresh; test in `use-app-data.test.tsx`.

**Note:** Billing counters are workspace-level; this slice fixes **UI staleness** for multi-assistant / per-assistant override display only.

**Likely files:**

- `apps/web/app/app/_components/use-app-data.ts`
- `apps/web/app/app/_components/use-app-data.test.tsx`

**Deploy:** NO DEPLOY EXPECTED.

---

### Slice 7 — Telegram inline tool-path ledger parity

**Status: DONE (2026-05-30)** — completed-turn caller now forwards `runtimeResponse.toolInvocations` to the tool-path ledger; test + typecheck green.

**Problem:** Telegram turn path passes `usageAccounting` to ledger append but omits `runtimeResponse.toolInvocations`; web sync passes both.

**Scope:** One-line parity in `handle-internal-telegram-turn.service.ts` caller + test assertion.

**Tests:**

```bash
corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts
```

**Deploy:** DEPLOY REQUIRED with API image.

---

### Slice 8 — Document worker LLM economics (optional, post-PROD-minimum) — DONE (2026-05-30)

**Problem:** Internal document-worker LLM calls return `usage: null`; ADR-099 lists `document_generation` as not wired.

**Scope:**

1. Aggregate provider text `usage` across document-worker LLM calls into `RuntimeDocumentJobRunResult.usage`.
2. Persist durable usage on document job row if needed for replay.
3. Append ledger rows with purpose `document_generation` (non-blocking, additive to quota).

**Out of scope:** Changing user quota semantics; Admin UI claiming “full platform economics.”

**Prerequisite:** Founder explicit go-ahead after PROD-minimum path (Slices 1–2, 5, 9–10).

**Tests:** New adapter + delivery/scheduler ledger tests.

**Deploy:** DEPLOY REQUIRED.

**As-built (2026-05-30):** (1) `runtime-document-provider-adapter.service.ts` now merges every worker `generateText` `usage` (chunked outline + sections, single-shot HTML, patch-revise, structured style/section patches) into one token-summed `RuntimeUsageSnapshot` returned on `RuntimeDocumentJobRunResult.usage`; Gamma / zero-LLM paths stay `usage: null`. (2) **No DB column / migration added** — the snapshot is consumed directly from the run result at scheduler time (mirroring the media scheduler's billing-facts append), so durable per-row persistence was unnecessary. (3) `AssistantDocumentJobSchedulerService`, after the success transaction, appends one ledger row via the new `RecordModelCostLedgerService.recordDocumentGenerationUsageEvent` (`purpose: document_generation`, `source: document_job_generation`, idempotent `sourceEventId: document_render_job:${id}:generation`), wrapped in try/catch + warn (non-blocking, never blocks delivery). Quota paths untouched (`consumeAssistantMonthlyToolQuotaSuccessOnly` unchanged). Three distinct rows now exist per document job and never double-count: `document_render` (PDFMonkey/Gamma operation billing facts), `chat_helper` (delivery completion framing), `document_generation` (worker token usage). Read-model label added. Verified: recursive lint + `format:check` + recursive typecheck clean; runtime + api full suites green (adapter aggregation + scheduler append + ledger purpose tests added).

---

### Slice 9 — CI / deploy hygiene

**Status: DONE (2026-05-30)** — root `format:check` + `detect-affected` unit tests now run in the affected-quality lane; contract/runtime-boundary→integration policy and values-dev tag-pin rule documented in TEST-PLAN; tests green.

**Problem:** Affected PR lane skips root `format:check`; `contracts-boundary` / `runtime-boundary` risks already escalate to the **integration** matrix (`requiresIntegration`) but never to `requiresFullCi`, so a full lint/typecheck sweep can still be skipped on contract/runtime-contract edits; `detect-affected.mjs` lacks automated tests; `values-dev.yaml` global image tag may lag per-service pins.

**Scope:**

1. Add `corepack pnpm run format:check` to `.github/workflows/ci.yml` affected-quality job.
2. Escalate `contracts-boundary` / `runtime-boundary` to `requires_full_ci` **or** expand affected integration matrix — pick one, document in TEST-PLAN.
3. Add unit tests for `scripts/ci/detect-affected.mjs` (docs-only, test-only, migration, contracts change fixtures).
4. Add CI check or documented rule: per-service `image.tag` pins must not fall back to stale `global.images.tag`.

**Tests:**

```bash
helm lint infra/helm -f infra/helm/values-dev.yaml
helm template persai-dev infra/helm -f infra/helm/values-dev.yaml > /dev/null
node scripts/ci/detect-affected.mjs --changed-files "docs/FOO.md"
```

**Deploy:** NO DEPLOY EXPECTED.

---

### Slice 10 — PROD preflight smoke

**Status: DONE (2026-05-30)** — all PROD-blocking slices deployed to `persai-dev` on `e3c78b63` (Argo CD Synced + Healthy, five deploys `2/2`, 0 restarts, runtime started clean, api `/health`+`/ready` 200); agent `kubectl get deploy,svc,ingress,pods` checks PASS. Founder ran the 6-point human smoke on `persai-dev` — all passed: web stream + history reconcile; document create/revise → honest pending then separate delivery with `companionOriginalStatus=absent` (no same-turn old-file masquerade); image generate → honest pending then delivered; file open/download by `fileRef`; assistant switch isolates chats + refreshes plan UI; Admin Ops counts assistant-scoped. Log verification clean: `document-jobs/enqueue` 202 → `AssistantDocumentJobDeliveryService` delivered `revise_document` PDF (`companionOriginalStatus=absent`); `media-jobs` enqueue 202 → `Processed 1 assistant media job(s)`; zero error/warn-level api/runtime logs.

**Scope:** After PROD-blocking slices deploy to dev, run short human + agent checklist.

**Agent checks:**

```bash
kubectl -n persai-dev get deploy,svc,ingress
kubectl -n persai-dev get pods -o wide
```

**Human checks (5–7 min):**

1. Web: send message, stream completes, history reconciles after tab background.
2. Document: create PDF → pending → delivered file (no same-turn old-file masquerade).
3. Media: generate image → honest pending → delivered artifact.
4. Files: open/download by `fileRef` from chat card.
5. Multi-assistant (if available): switch assistant → chats isolate; plan UI refreshes (Slice 6).
6. Admin Ops (if multi-assistant): selected assistant chat counts not workspace-aggregated wrongly (Slice 4).

**Exit:** Update `SESSION-HANDOFF.md`, `CHANGELOG.md`, mark slices complete in this ADR ledger table.

---

## Cleanup inventory (Slice 9b or post-PROD — non-blocking)

Execute only after Slice 10 or in parallel if zero prod risk:

| Item                                                      | Action                                              |
| --------------------------------------------------------- | --------------------------------------------------- |
| `services/openclaw/.gitkeep`                              | Delete empty slot; keep `pnpm-workspace.yaml` valid |
| `WebRuntimeShadowComparisonService`                       | Remove dead wiring + admin overview field           |
| `send-native-*` / `native-*` filenames                    | Rename in dedicated naming slice                    |
| `uploadChatAttachment()` dead export                      | Delete from web client                              |
| Hardcoded `"Навык - ..."` in `use-chat.ts`                | i18n key                                            |
| `ARCHITECTURE.md` stale “ledger events yet” phrase        | Docs-only fix                                       |
| `RuntimeDocumentToolResult.action: "deferred"` union tail | Narrow/deprecate after Slice 1                      |

Historical OpenClaw in ADRs/migrations/tests: **do not touch** as bugs.

---

## Agent session handoff contract

When any slice completes, agent MUST update `docs/SESSION-HANDOFF.md` and output:

1. **Slice id** (e.g. `ADR-102 Slice 1`).
2. **Baseline SHA** and **end SHA**.
3. **What changed / why** (plain language).
4. **Files touched.**
5. **Tests run** (exact commands + pass/fail).
6. **Deploy:** REQUIRED or NOT; if required, cluster + UI smoke results.
7. **Risks / residuals.**
8. **Next slice** (exact ADR-102 slice number only — no scope creep).

### Copy-paste agent prompt template

```text
Execute ADR-102 Slice N only.

Mandatory reading:
- AGENTS.md
- docs/ADR/102-pre-prod-architectural-cleanup-and-truth-hardening.md (Slice N section)
- docs/SESSION-HANDOFF.md
- docs/CHANGELOG.md

Rules:
- Start from clean git tree; if dirty, stop and report.
- One slice only; no scope expansion.
- No OpenClaw reintroduction; no compatibility shims; no TODO scaffolding.
- Update docs in same slice if boundary/behavior truth changes.
- Run verification gate from slice spec before claiming clean.

Deliver:
- implementation
- focused tests from slice spec
- SESSION-HANDOFF + CHANGELOG updates
- explicit DEPLOY REQUIRED / NOT and smoke checklist if deploy
```

---

## Verification matrix (summary)

| Slice | Focused tests                                    | Broad gate                                      |
| ----- | ------------------------------------------------ | ----------------------------------------------- |
| 1     | runtime deferred-document, runtime-document-tool | runtime typecheck                               |
| 2     | deferred-media-acknowledgement                   | runtime typecheck                               |
| 3     | contracts generate + API/runtime typecheck       | —                                               |
| 4     | admin ownership, ops cockpit                     | api typecheck                                   |
| 5     | assistant-api-client, chat-message               | contracts + web typecheck                       |
| 6     | use-app-data                                     | web typecheck                                   |
| 7     | telegram turn, record-model-cost-ledger          | api typecheck                                   |
| 8     | document adapter + ledger (TBD in slice)         | api + runtime typecheck                         |
| 9     | detect-affected unit tests, helm lint/template   | —                                               |
| 10    | live smoke                                       | full lint/format/typecheck if any slice pending |

---

## Consequences

### Positive

- One canonical pre-PROD cleanup program; agents do not re-derive scope from chat history.
- PROD-blocking honesty and contract gaps closed with evidence-backed slices.
- Clear separation: workspace billing vs assistant display/enforcement vs optional economics.

### Negative

- Multiple deploys if slices are not batched (recommend batching 1+2, optionally 3+4+7).
- Slice 8 remains intentionally deferred to avoid blocking PROD on full document economics.

## Alternatives considered

1. **Fold into ADR-078** — rejected; ADR-078 is closed archive program.
2. **Fold into ADR-093** — rejected; ADR-093 targets concurrency/load; this program targets truth/honesty/contract/admin tails.
3. **Single mega-PR** — rejected; violates one-session-one-slice review discipline.
4. **Wire `document_generation` ledger before PROD** — rejected as blocking; optional Slice 8 after minimum path.
