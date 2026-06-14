# ADR-105: Media job truth and orchestrated cleanup

**Status:** Implemented (2026-05-31) — Slices 0–6 landed; single-owner media-quota reservation adopted (see Implementation outcome).  
**Date:** 2026-05-31  
**Relates to:** [ADR-082](082-billing-quota-and-delivery-confirmed-media-accounting.md), [ADR-086](086-async-media-jobs-for-generated-image-audio-and-video.md), [ADR-087](087-unified-quota-advisories-and-paid-light-mode.md), [ADR-089](089-media-package-add-ons.md), [ADR-093](093-clean-prod-launch-readiness-and-concurrency-hardening.md), [ADR-102](102-pre-prod-architectural-cleanup-and-truth-hardening.md), [AGENTS.md](../../AGENTS.md), [ARCHITECTURE.md](../ARCHITECTURE.md), [API-BOUNDARY.md](../API-BOUNDARY.md), [DATA-MODEL.md](../DATA-MODEL.md), [TEST-PLAN.md](../TEST-PLAN.md)

## Context

PersAI already has the active durable async media lane from ADR-086:

1. ordinary user turns may accept generated media requests quickly,
2. accepted work persists durable `assistant_media_jobs`,
3. scheduler and delivery workers own execution plus final delivery,
4. web/Telegram continuity reads open media jobs from server truth.

That architecture is correct in direction, but the 2026-05-31 audit found product-truth gaps that are no longer acceptable for clean PROD behavior:

1. **Pending semantics are split.** Documents already use model-visible `pending_delivery` with `canSendFileNow=false`; media still uses older `action="deferred"` while API/job state uses `completion_pending`.
2. **Per-turn cap semantics are inconsistent.** `image_generate.count` is schema-clamped but runtime per-turn budgeting still counts tool calls, not total requested result units. `image_edit` currently lacks explicit `count` even though the active OpenAI provider path supports multiple outputs per request.
3. **Single-task media requests are not defined cleanly enough.** The system does not yet explicitly lock the product rule that one structured media request should become one durable media job by default, with no silent split and no silent trim.
4. **Rejection semantics are too soft/mixed.** Queue/concurrency rejection, quota rejection, and per-turn budget rejection are not yet one explicit product/runtime truth. The assistant can receive partial or hidden feedback and then answer too generically.
5. **Async admission is not fully unit-aware end to end.** Current enqueue prechecks and later worker reservation/settlement can diverge, especially when the requested number of media results is greater than one.

This ADR does **not** reopen ADR-086's async-media decision. ADR-086 remains correct: generated media is a durable async lane. ADR-105 defines the missing product/runtime truth for how that lane must behave under batching, per-turn caps, concurrency, and pending honesty.

## Non-goals

- No prompt parsing heuristics or regex splitting of user text into tasks.
- No model-guessing layer that invents multiple media tasks from freeform wording.
- No reintroduction of sync media completion inside ordinary turns.
- No new legacy fallback mode preserving both old `deferred` and new pending semantics indefinitely.
- No expansion beyond the active generated-media tools: `image_generate`, `image_edit`, `video_generate`.
- No unrelated changes to document-tool execution beyond keeping media semantics aligned with the already-landed document pending truth.

## Decision

### 1. Canonical product truth: one structured media request = one media job

For the active generated-media lane, the canonical unit is:

```text
one structured media request -> one durable media job
```

That means:

- one `image_generate` request with `count = N` is one job,
- one `image_edit` request with `count = N` is one job,
- one `video_generate` request is one job.

Multiple jobs are allowed only when there are **multiple distinct structured requests** or when the user starts a separate task later while another job is already open.

The system must **not** silently split one request into multiple jobs just to fit a cap, queue limit, or provider batch boundary.

### 2. Per-turn cap means total result units, not tool calls

For generated media tools, `perTurnCap` means:

```text
maximum total result units allowed inside one runtime turn
```

It does **not** mean "maximum number of tool invocations."

Examples:

- `image_generate(count=4)` requests 4 result units.
- `image_edit(count=4)` requests 4 result units.
- `video_generate` requests 1 result unit.

Runtime budgeting, tool projection, and assistant-facing explanations must all use this same meaning.

### 3. No silent split, no silent trim

If a single structured media request asks for more units than the current tool path allows in one job or one turn:

- do **not** silently split it into multiple jobs,
- do **not** silently trim it to a smaller count,
- do **not** pretend the request fully started.

Instead, return a structured rejection / limit result and let the assistant answer honestly.

This is a hard product rule because silent split creates duplicate/style-drift risk and destroys quota clarity.

### 4. Media pending semantics converge on document-style `pending_delivery`

Accepted async media requests must use one model-visible pending semantic aligned with documents:

- `action: "pending_delivery"`
- `canSendFileNow: false`
- `jobId`
- `messageToUser`
- media-appropriate count metadata when relevant (`requestedCount`, `expectedResultCount`, or equivalent)

The model must not describe the result as already ready, attached, visible, uploaded, or sent until final backend delivery has actually happened.

Backend state may keep its operational statuses (`queued`, `running`, `completion_pending`, `delivered`, `failed`, etc.), but model/runtime-facing accepted state is unified around `pending_delivery`.

### 5. Explicit concurrency rejection

The bounded per-chat active media queue remains a product rule:

- at most one running media job per chat,
- at most one additional queued/open job per chat,
- current open-job ceiling = `2` unless later ADR changes it explicitly.

If the assistant/runtime tries to enqueue more than the allowed open jobs:

- the extra request must receive an explicit structured rejection,
- the rejection must be visible to the model,
- the assistant must be able to explain honestly that the current chat already has the maximum number of active media jobs.

No silent dropping of a third request is allowed.

### 6. `image_edit` gains explicit count support on the active path

The active OpenAI provider path supports multiple outputs for image editing. PersAI therefore adopts explicit `count` support for `image_edit` on the active runtime/provider contract.

That support is only valid once it is wired **end to end**:

- runtime contract,
- model-visible tool schema,
- runtime argument parsing,
- provider-gateway request,
- per-turn unit budgeting,
- monthly media quota reservation/settlement,
- async enqueue/admission,
- completion delivery copy/tests.

Until that wiring is complete, no hidden provider-only batch capability may be treated as active product truth.

### 7. Async media quota admission becomes unit-aware at enqueue

ADR-082 remains the source of truth for delivery-confirmed settlement:

- reserve before expensive provider work,
- settle only on successful user-visible delivery,
- release or mark reconciliation-required on no-delivery outcomes.

For the async media lane, the durable enqueue path is the correct reservation seam. Therefore:

- enqueue admission must be unit-aware for the requested media count,
- async media reservations must happen at enqueue admission, not only later inside the worker,
- settlement/release/reconciliation continues to happen on terminal delivery truth per ADR-082.

This prevents "accepted now, rejected later because another queued job consumed the remaining units first" as steady-state product behavior.

### 8. Structured rejection shape must be explicit

Media admission failures must be first-class structured results, not only freeform warnings.

Minimum product/runtime facts required:

- `reason` / `code`
- `limitKind` or equivalent (`per_turn_cap`, `monthly_media_quota`, `media_job_concurrency`, `tool_unavailable`)
- `requestedUnits`
- relevant limit context (`limitUnits`, `remainingUnits`, `activeJobs`, `maxActiveJobs`, etc.)
- `guidance` when the assistant should ground a soft quota/package/upgrade answer

The model should never have to infer whether a request was:

- accepted and pending,
- rejected by quota,
- rejected by concurrency,
- rejected by plan/tool availability,
- or rejected by per-turn result cap.

### 9. Blanket deferred-media correction must not hide mixed outcomes

The current "any deferred media job -> normalize the whole final assistant text to a generic pending acknowledgement" behavior is too blunt once one turn may contain both:

- accepted media requests,
- and rejected media requests.

Final assistant-text correction must preserve explicit rejected-limit/concurrency facts instead of overwriting everything with one generic pending sentence.

## Execution program

ADR-105 is intentionally an orchestrator-first program. The parent agent/orchestrator should use bounded slices and review each slice before continuing.

> Status (2026-05-31): Slices 0–6 **DONE**. Slice 5 landed as the single-owner reservation correction documented under "Implementation outcome" rather than the original framing-only scope.

### Slice 0 — doc baseline and ADR acceptance

Scope:

- accept ADR-105 as source of truth,
- update `CHANGELOG` and `SESSION-HANDOFF`,
- do not change runtime/API behavior yet.

Exit:

- ADR landed,
- current session records that no product code changed.

### Slice 1 — contract unification

Scope:

- update `packages/runtime-contract/src/index.ts`,
- add `image_edit.count`,
- define canonical media `pending_delivery` result fields,
- extend deferred/open media summaries with count-aware pending facts where needed,
- regenerate public/generated contracts if API-visible types change.

Likely files:

- `packages/runtime-contract/src/index.ts`
- `packages/contracts/openapi.yaml`
- generated contract outputs under `packages/contracts/src/generated/*`

### Slice 2 — runtime projection and unit-aware budgeting

Scope:

- make model-visible descriptions/schemas describe per-turn cap as result units, not calls,
- add `image_edit.count` to tool projection,
- make runtime per-turn media budgeting unit-aware,
- remove the schema-only gap for `image_generate.count`.

Likely files:

- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/src/modules/turns/tool-budget-policy.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`

### Slice 3 — runtime media tool normalization

Scope:

- enforce one request -> one job,
- reject oversized single requests explicitly instead of splitting,
- unify accepted async tool results onto `pending_delivery`,
- carry explicit rejection details through tool payloads,
- wire `image_edit.count` end to end.

Likely files:

- `apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`

### Slice 4 — API enqueue, reservation, and queue truth

Scope:

- make media enqueue admission unit-aware at enqueue time,
- make concurrency admission explicit and atomic enough for the open-job ceiling,
- keep ADR-082 delivery-confirmed settlement,
- ensure the API exposes consistent open-job truth.

Likely files:

- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service.ts`
- `apps/api/src/modules/workspace-management/application/assistant-media-job.service.ts`
- `apps/api/src/modules/workspace-management/application/reserve-internal-runtime-monthly-media-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/mutate-internal-runtime-monthly-media-quota.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-media-jobs-enqueue.controller.ts`

### Slice 5 — scheduler / completion honesty

Scope:

- preserve under-delivery / partial-output truth,
- align completion framing and final user text with the new pending/rejection semantics,
- ensure accepted + rejected mixed media attempts remain visible in completion copy.

Likely files:

- `apps/runtime/src/modules/turns/runtime-media-job-run.service.ts`
- `apps/api/src/modules/workspace-management/application/assistant-media-job-scheduler.service.ts`
- `apps/api/src/modules/workspace-management/application/assistant-media-job-completion-delivery.service.ts`

### Slice 6 — docs and verification closeout

Scope:

- update `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md`,
- update `CHANGELOG.md` and `SESSION-HANDOFF.md`,
- complete focused tests plus repo gate.

## Verification requirements

At minimum, implementation slices under ADR-105 must add focused checks for:

1. one structured media request becomes exactly one media job,
2. one oversized request is rejected explicitly instead of split,
3. `image_generate` and `image_edit` per-turn budgeting counts requested result units, not calls,
4. third media enqueue in a chat with two open jobs gets explicit concurrency rejection,
5. accepted pending media replies stay honest with no false "ready/sent" language,
6. mixed accepted + rejected media attempts in one turn do not collapse into one misleading pending sentence,
7. enqueue-time quota admission and later delivery-confirmed settlement remain consistent with ADR-082.

Repo gate still applies:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Add focused runtime/API/generated-contract tests before broad verification.

## Implementation outcome (2026-05-31)

All slices (0–6) landed in one orchestrated program. Two facts changed long-term system truth beyond the original slice text and are recorded here:

### Single-owner media-quota reservation (supersedes the Slice 4 "worker also releases" shape)

Slice 4 moved the durable monthly-media-quota **reservation** to enqueue admission (`reserveAssistantMonthlyMediaQuota({ units: N })`, where `N = count` for image tools, `1` for `video_generate`), but initially left the runtime worker tool services still calling `releaseMonthlyMediaQuotaReservationBestEffort(...)` on no-artifact / partial / exception paths. During Slice 5 review this was found to be unsafe:

- the monthly counter is an **aggregate** per `(workspaceId, toolCode, period)`, not per job (`prisma-workspace-quota-accounting.repository.ts` clamps `units = Math.min(input.units, counter.reservedUnits)` against the shared aggregate),
- so a worker release on retry/failure of one job could decrement a **different concurrent job's** reserved units (ADR allows ≥2 open jobs), corrupting quota cross-job (multi-release / double-release).

Adopted correction — **single-owner reservation resolution**:

```text
A job's enqueue reservation (N units) is resolved exactly once,
at the job's terminal transition, by the API layer.
The runtime worker never touches monthly media quota.
```

- Runtime: all `releaseMonthlyMediaQuotaReservationBestEffort(...)` call sites (and their private helpers) removed from `runtime-image-generate-tool.service.ts`, `runtime-image-edit-tool.service.ts`, `runtime-video-generate-tool.service.ts`. The worker now has **zero** monthly-media-quota call sites (verified by grep over `apps/runtime/src/modules/turns`; the `reserve/release/markReconciliation` methods remain only as unused client definitions on `persai-internal-api.client.service.ts`).
- API scheduler (`assistant-media-job-scheduler.service.ts`): `failJob` releases the job's full `N` **once** for every terminal failure path (`invalid_request_payload`, `assistant_not_found`\*, `runtime_bundle_missing`, `media_job_artifacts_missing`, terminal worker failure incl. `image_provider_safety_rejected`); retryable requeue touches no quota.
- API completion (`assistant-media-job-completion-delivery.service.ts`): `failDelivery` reconciles `N` once for pre-delivery-loop failures, guarded by a `loopResolved` flag so a post-`deliver()` exception cannot double-count.
- Delivery loop (`media-delivery.service.ts`) is unchanged: settles 1 per delivered artifact, reconciles 1 per failed-delivery artifact.

Net invariant: every reserved unit is resolved exactly once — settled (delivered), released (failed, no provider cost), or reconciled (provider cost, no delivery) — with no worker involvement and no double/multi-release.

### `image_edit.count` end-to-end completion + partial-leak closure (2026-05-31, follow-up)

The initial program landed `image_edit.count` through the contract, tool projection, unit budgeting, and enqueue reservation, but a follow-up review found two break points that made the "end to end" claim of Decision §6 untrue: the provider-gateway `normalizeEditInput` dropped (and did not validate) `count`, and the OpenAI client `editImage` payload omitted `n`, while `buildImageEditPrompt` forced a single output. As a result `image_edit(count=N>1)` reserved `N` but the provider returned `1`, and — under single-owner — the never-produced `N−1` leaked. Closed:

- `apps/provider-gateway/.../provider-image-generation.service.ts`: `normalizeEditInput` now validates `count` (`MIN/MAX_RUNTIME_IMAGE_EDIT_COUNT`) and forwards `count`.
- `apps/provider-gateway/.../openai/openai-provider.client.ts`: `editImage` payload sends `n: input.count`; `buildImageEditPrompt` is count-conditional (single-output wording for `count=1`, "N distinct edited variations" for `count>1`) with no content/carousel hardcoding — interpretation of a request stays with the assistant.
- `apps/api/.../assistant-media-job-completion-delivery.service.ts`: after the delivery loop resolves the `M` produced artifacts (`loopResolved=true`), `releaseUnproducedRemainderBestEffort` releases the never-produced remainder `N−M` exactly once (no-op when `M≥N`), mutually exclusive with the pre-delivery `reconcile N` path. Genuine provider under-delivery no longer leaks quota.

### Media description de-bloat + word-parse removal (2026-05-31, follow-up)

ADR-105 had appended the same facts to media tools in three places (main description + per-turn-cap hint + `count` param), so each tool description repeated "one request with count=N is one job / do not split a series / each output is one per-turn + one daily unit" 2–3×. Optimized in `native-tool-projection.ts` so each fact appears once: the cap hint now carries only the number + unit meaning + `tool_budget_exhausted` consequence (and no longer mentions `count=N`, which also de-confuses `video_generate`); the main descriptions own the "set count for a series, one job, no extra calls" rule; the `count` params own the range + per-unit accounting. Semantics unchanged; caps stay policy-driven.

Separately removed the prompt word-parse heuristic from `runtime-image-edit-tool.service.ts`: `SECOND_IMAGE_REFERENCE_PROMPT_MARKERS` (a hardcoded multilingual phrase list) and `inferReferenceGuidedSelection` are deleted. `resolveImageSelection` now uses the structural `sourceImageAlias`/`referenceImageAlias` the model already provides (all validation guards intact). **Behavior change:** a 2-image reference-guided edit now requires the model to set `referenceImageAlias` explicitly (the `image_edit` description was strengthened to instruct this) instead of inferring it from scanning prompt words. The pre-existing `isLikelyAnalysisOnlyPrompt` keyword guard and `DELIVERY_CLAIM_PATTERNS` output guardrail are left for a separate review (out of scope here). `MAX_OPEN_MEDIA_JOBS_PER_CHAT = 2` remains a documented constant (Decision §5), a candidate to become plan-driven in a later ADR.

### Open-job semantic summaries + explicit multi-image `series` mode (2026-05-31, follow-up)

The live `сова -> лев` audit found a missing model-facing truth: open async jobs were rendered with ids/status/timestamps/counts but without enough semantic meaning for the model to distinguish "older open owl job" from "new lion request in this turn". Closed:

- `RuntimeOpenMediaJobContext` and `RuntimeOpenDocumentJobContext` now carry `sourceSummary`, derived from persisted source user text / version source summary.
- `turn-execution.service.ts` open-job developer sections now render `sourceSummary`, age, and explicit current-turn safety language: older open jobs are server truth for prior tasks, **not** proof that the current turn started a new async job; the model may only claim a new acceptance when this same turn structurally returned `pending_delivery` with a real `jobId`.

The live carousel audit also found that one batched `count=N` prompt describing an entire N-slide concept is collage-prone even when the provider returns N separate files. Closed without keyword routing or multi-job split:

- `RuntimeImageGenerateRequest` / `RuntimeImageEditRequest` now support explicit `outputMode: "variants" | "series"` plus ordered `seriesItems[]`.
- `native-tool-projection.ts` now teaches the model to use `variants` for alternate versions of one image idea and `series` + `seriesItems[]` for distinct final frames/items (carousel slides, storyboard frames, etc.).
- Runtime image generate/edit execution keeps **one structured request = one durable media job**, but when `outputMode="series"` it runs multiple single-image provider calls inside that job (`count=1` per call) using one frame-specific prompt per series item. This preserves ADR-105's no-silent-split rule while removing the collage-prone "one shared prompt for the whole carousel" shape.

### Invalid-arguments refund + ref-bound series guard (2026-05-31, follow-up)

The live carousel audit uncovered two more product-truth gaps after `series` landed:

1. a malformed media tool call (`invalid_arguments`) could still consume the full per-turn media unit budget because reservation happened before worker-side argument validation, and
2. a ref-bound multi-slide request could still drift to generic `image_generate` even when a reusable current-turn source image was structurally available, leading to unrelated products instead of edits of the referenced product.

Closed:

- `ToolBudgetPolicy` now supports an explicit `refund(toolName, reservedUnits)` path, and `turn-execution.service.ts` uses it only when a previously reserved media call comes back as structural `action:"skipped" + reason:"invalid_arguments"`. This preserves the ADR-105 unit-budget meaning while ensuring malformed media JSON does **not** burn the turn and block a corrected same-turn retry.
- `turn-execution.service.ts` now passes reusable image attachments into `runtime-image-generate-tool.service.ts`, not only into edit/video tools.
- `runtime-image-generate-tool.service.ts` now returns a structural `source_image_required` rejection for `outputMode="series"` multi-frame generation when a reusable current-turn image already exists, instructing the model to switch to `image_edit` with `sourceImageAlias` instead of regenerating from scratch.
- Runtime series prompt composition in both generate/edit paths now explicitly preserves one product/campaign identity across all items and forbids collage/grid/contact-sheet composition per item, tightening the semantics of `series` from "N distinct calls" to "N distinct but continuous final frames."

### Residuals (tracked, accepted for this program)

1. `assistant_not_found` in `failJob` cannot release its reservation (no `Assistant` entity remains to resolve governance/period); it is logged for workspace-level reconciliation. Rare (assistant deleted between enqueue and scheduling).
2. User-facing **honesty framing** for provider under-delivery (telling the user that fewer than the requested count were produced) is deferred per Non-goals; no `requestedCount → LLM` framing layer was built. The quota side of under-delivery is now fully resolved (see remainder release above) — this residual is copy-only, not a quota leak.

## Consequences

### Positive

- media batching, caps, queueing, and pending semantics become one explicit product truth,
- the assistant can answer honestly about accepted vs rejected media requests,
- quota/package explanations become grounded in structured facts instead of hidden worker failures,
- `image_edit` can support counted variants cleanly instead of relying on provider-only capability,
- the orchestrator gets a bounded implementation program instead of ad hoc fixes.

### Negative

- this is a cross-boundary cleanup touching contract, runtime, API, docs, and tests,
- enqueue-time reservation for async media is a behavior change that must be implemented carefully against ADR-082 settlement rules,
- there is no cheap compatibility mode if the team wants clean semantics; old `deferred` wording and old mixed rejection behavior must be retired.

## Alternatives considered

- **Keep current `deferred` media semantics and only improve assistant copy.** Rejected: this preserves split truth across tool payloads, runtime correction, and API job state.
- **Let one oversized request split automatically into multiple jobs.** Rejected: silent split is product-confusing and risks duplicates/style drift.
- **Treat per-turn cap as tool calls, not result units.** Rejected: this is already known-bad for counted media requests and contradicts the desired product rule.
- **Leave `image_edit` single-output in PersAI even though the active provider path supports multi-output.** Rejected for target-state truth: it preserves an avoidable mismatch between product semantics and the active provider path.
