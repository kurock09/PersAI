# ADR-108: Video Vcoin economy and pre-talking-avatar cleanup

## Status

Completed (2026-06-04). All slices 0-9 landed and deployed to dev; live verification (`alex@agse.ru`, Kling kling-v2-6, 5s clip, 14 VC debited at $0.14/s, package purchase 200 VC credited) confirmed end-to-end VC economy on 2026-06-04. ADR-109 (HeyGen talking-avatar) is the next ADR in this program lineage.

## Context

ADR-106 made `video_generate` provider-aware for OpenAI/Runway/Kling and made the admin/plan/runtime/provider-gateway chain honest end-to-end. ADR-107 added the capability axis for native audio, voice control, multi-image, and Omni-like provider modes, with the explicit decision that "Runway voice/audio/avatar APIs must not be conflated with general-purpose `video_generate`" (ADR-107 line 39-40).

The next product step is talking-avatar video via HeyGen (covered in a separate ADR-109). HeyGen pricing is per-second and the talking-avatar class is premium-tier compared to current cinematic generation. Continuing the existing per-unit model ("1 video = 1 monthly unit") would understate true cost and force admins to either heavily underbill talking-avatar or to invent ad-hoc unit-weighting that the system cannot honestly settle.

A readonly audit of the active video stack (session 2026-06-03) found:

- `1 unit` for video is hardcoded across enqueue, settle, release, reconcile, settings UI, pricing UI, and packages (`apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service.ts:289`, `apps/api/src/modules/workspace-management/application/media/media-delivery.service.ts:229-232`, `apps/api/src/modules/workspace-management/application/assistant-media-job-completion-delivery.service.ts:622-624`, `apps/web/app/app/_components/assistant-settings.tsx:923-967`, `apps/web/app/_components/pricing-page-view.tsx:134-139`, `apps/web/app/app/packages/page.tsx`).
- There is no workspace wallet or monetary balance concept anywhere. `model_cost_ledger_events` is internal USD COGS only and is not user-visible.
- `assistant_media_jobs.billing_facts_json` carries `time_metered.durationSeconds` already, so currency-priced settlement is computable from existing facts without changing the billing-fact shape.
- ADR-106 Slice 9 explicitly preserved "media quota settlement unchanged" (`docs/ADR/106-video-provider-catalog-and-execution-routing.md:433-434`). Replacing per-unit settlement with currency settlement for `video_generate` directly supersedes that part of Slice 9.
- ADR-107 has landed slices 1, 4, 5 (capability contract, bounded Kling voice control + 2-image tail, billing/unsupported-mode honesty). Slices 2 and 3 have code on the active path (audio capability admin validation, runtime intent materialization) but are not in the CHANGELOG ledger and the ADR-107 acceptance checklist remains entirely unchecked (`docs/ADR/107-provider-native-video-audio.md:325-335`). The product decision (2026-06-03) is to **close ADR-107 as a program without doing further ADR-107 work**: the remaining items (Kling Omni route, broad Kling multi-image, Runway voice/avatar APIs in `video_generate`, `preserve_reference_audio` / `reference_voice_or_track` audio modes, audio-priced ledger dimensions, delivery narration) are explicitly deferred indefinitely and there is no follow-up ADR-107 program. ADR-108 Slice 0 only documents this closure; it does not implement deferred items.
- The fragmentation (catalog allows `omni` but runtime rejects; ADR text mentions audio modes that the runtime enum does not implement) is recorded as accepted residual so HeyGen integration in ADR-109 does not re-discover it.

The product decision is to introduce **Vcoin (VC)** as a workspace-scoped wallet currency that applies **only to `video_generate`**. Other media tools (`image_generate`, `image_edit`, `tts`, `stt`) keep the existing per-unit quota model. The course is fixed at platform level: `1 USD = 20 VC`, minimum step `0.05 USD = 1 VC`, integer VC only.

This ADR-108 is a planning program. It is parallel to ADR-102's pre-PROD cleanup track and does not consume ADR-102 slices. It does, however, perform the small ADR-107 cleanup needed to make HeyGen integration honest, which is why it carries a "pre-talking-avatar cleanup" label.

## Decision

Introduce Vcoin as the user-facing settlement currency for `video_generate`. Keep the internal USD COGS ledger unchanged. Replace `video_generate` per-unit reservation/settlement with currency-priced debit on success delivery. Close ADR-107 as a program (no further ADR-107 implementation) so ADR-109 (HeyGen talking-avatar) has a clean substrate.

The decision is shaped by ten product-confirmed answers from the 2026-06-03 audit synthesis:

1. **Order.** Vcoin first. HeyGen talking-avatar arrives later (ADR-109) on top of a ready VC infra.
2. **Storage.** New table `workspace_vc_balance`. `workspace_media_monthly_quota_counters` is no longer used for `video_generate`; it remains in use for `image_generate`, `image_edit`, `tts`, `stt`, etc.
3. **Two-layer economy.** USD COGS ledger (`model_cost_ledger_events`) is unchanged in shape and remains the source of truth for operator margin analysis. VC is a separate user-facing wallet, debited at settle time by converting USD cost through the exchange rate.
4. **Course visibility.** The `1 USD = 20 VC` course is shown to the user only on plan cards and on the packages page. In wallet balance UI, settings, chat advisor, and pricing facts the user sees raw VC amounts. A small "1 VC \u2248 $0.05" tooltip is allowed where space requires.
5. **Lifecycle.** Settle-only debit, as today's per-unit model. No reserve-on-enqueue holds. Enqueue carries an advisory pre-check (`balance > 0` required) so a workspace with zero VC is rejected before the provider work starts.
6. **VC period.** Wallet **accumulates**. VC do not expire at the end of a billing period. Monthly plan grants are credited on subscription period boundary into the same wallet. No accumulation cap in the first version (review after 30 days of PROD).
7. **Migration.** Manual through Admin UI. The admin walks 5 plans and sets each plan's `videoVcoinMonthlyGrant` explicitly. No automatic recalculation script.
8. **Price preview.** No per-job preview before launch. Settings shows "Remaining N VC" instead of "K/M videos". Pricing page card shows "X VC / month \u2248 Y videos at avg rate" only as a marketing line, not as a guarantee.
9. **Packages.** Existing purchase mechanics stay. Only the credit destination changes: a successful `video_generate` package purchase credits VC into `workspace_vc_balance` instead of granting per-unit monthly bonus units. Catalog item label changes from "+10 videos" to "+1000 VC".
10. **Placement.** ADR-108 runs in parallel to ADR-102. It is not an ADR-102 slice. ADR-102's pre-PROD path is unblocked.

### Vcoin currency definition

```ts
type VcoinAmount = number; // non-negative integer; 1 VC = $0.05
const VCOIN_PER_USD = 20; // platform-level constant exposed via PlatformRuntimeProviderSettings
```

- Course is stored in `PlatformRuntimeProviderSettings.vcoinExchangeRate` (single platform-level numeric field, default 20). It is not plan-scoped.
- USD-to-VC conversion at debit uses round-half-up so a $0.04 cost still produces a positive VC debit when the executed work was non-zero.
- VC values stored and displayed are always integers. There is no fractional VC.
- VC cost of a single `video_generate` job at settle time = `ceil(catalog $/sec * seconds * VCOIN_PER_USD)`. If the catalog row uses a non-time-metered billing mode (e.g. fixed-operation for a future talking-avatar persona creation), the same conversion applies to the per-operation USD price.

### Wallet lifecycle

- **Credit sources:** monthly plan grant on subscription period boundary; successful `video_generate` package purchase; admin manual credit (operator UI in a later slice).
- **Debit sources:** `video_generate` job that reaches `delivery_succeeded` for at least one artifact.
- **Negative balance:** allowed at most for one in-flight job. The advisory pre-check at enqueue requires `balance > 0`. A settle that drives balance below zero is permitted exactly once; the next enqueue with `balance <= 0` is rejected with `vcoin_balance_exhausted`.
- **Failure handling:** terminal worker failures, delivery failures before the loop, and reconciliation-required outcomes do not debit VC. The USD COGS ledger may still record provider cost in those cases (operator loss). This matches the existing per-unit rule that the user is not charged for an undelivered video.

### Two-layer economy in detail

The USD COGS ledger (`model_cost_ledger_events`) is unchanged in shape. `RuntimeBillingFacts` remains currency-neutral. The new layer is purely user-facing:

```
provider video job
  -> billingFacts (time_metered: durationSeconds, providerKey, modelKey, occurredAt)
  -> media-delivery.service.ts on success
       -> existing path:  model_cost_ledger_events insert (USD micros, unchanged)
       -> new path:       workspace_vc_balance debit (VC integer, ADR-108)
```

The two writes are co-located in the success branch of media delivery and must be transactional with the job state transition so a partially-applied debit cannot occur on retry.

## Non-goals

- VC for `image_generate`, `image_edit`, `tts`, `stt`, or any non-video tool. Those keep per-unit quotas.
- VC for tool-path catalog (`web_search`, `web_fetch`, `browser`, `document_render`). Those keep their own pricing path.
- Replacing or restructuring the USD COGS ledger.
- Multi-currency support. VC and USD are the only currencies in this ADR.
- Wallet cap, daily debit limits, or freeze mechanics in the first version.
- VC for HeyGen execution. Execution lands in ADR-109; this ADR only prepares the wallet infra so ADR-109 can write to it.
- Persona / character registry. That is ADR-109.
- A public Vcoin SDK or third-party top-up surface. Top-up remains through existing plan + package channels.
- Removing existing per-video unit counters from the database in this ADR. The `videoGenerateMonthlyUnitsLimit` plan field is marked deprecated but kept on the row for one release cycle so admins have a fallback if VC must be rolled back.
- Anthropic, OpenAI chat routing, or any chat-side changes. This ADR is media-only.

## Agent execution model

This ADR is executed by an **orchestrator agent that does not write code**. The orchestrator holds context across slices, plans one bounded slice at a time, spawns implementation subagents with precise prompts and file boundaries, diff-reviews every return, runs the focused tests and repo gates itself, and updates docs. Implementation subagents are the only actors that write source code.

### Orchestrator role

- **Read-only** for source/code files (`apps/**`, `packages/**`, `prisma/**`, infra, scripts).
- **Write-capable** only for docs: `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, this ADR's slice status blocks, and the doc updates listed per slice (`docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`).
- Spawns one implementation subagent per slice. May spawn additional readonly audit subagents inside the slice's planning step for context-gathering.
- Diff-reviews every subagent return and rejects if scope was violated.
- Runs focused tests and repo gates through its own shell. The orchestrator does not trust a subagent's PASS/FAIL claim unless the verbatim command output was included.
- Refuses to mark a slice complete if the per-slice acceptance gate fails.
- Never commits or pushes (matches AGENTS.md).

### Per-slice orchestrator workflow

1. **Confirm tree.** `git status` must be clean. If dirty, stop and surface to the user.
2. **Confirm baseline.** Record SHA in `docs/SESSION-HANDOFF.md` if not already recorded for this session.
3. **Read slice spec.** This ADR's `Slice specifications` for the current slice + all `Likely files` for that slice.
4. **State plan in chat.** Slice id, purpose, Scope IN, Scope OUT, files to touch, tests to add, exit criteria. This is a precondition for spawning the implementation subagent.
5. **Spawn one implementation subagent** using the prompt template below. Sequential, write-capable.
6. **Receive subagent return.** Mandatory structure (see below).
7. **Diff-review.** Reject if any `Scope OUT` file was touched, any `Forbidden patterns` are present, or the return structure is incomplete.
8. **Run focused tests + repo gates** from the slice spec plus this ADR's cross-slice invariants. Through orchestrator's own shell.
9. **Apply doc updates** listed for the slice.
10. **Append CHANGELOG line** matching the existing pattern (date, ADR/slice id, files touched, behavioral summary, verification commands with PASS results, deploy lane).
11. **Update SESSION-HANDOFF** with baseline SHA, files touched, tests run, risks, deploy, next recommended step.
12. **Mark slice complete** in this ADR's `Slice specifications` by appending a `**Status (YYYY-MM-DD): Completed.**` block in the ADR-106 format with a short behavioral summary.
13. **State next recommended slice** in chat.

If any step fails, the orchestrator rolls the slice back (`git restore`) or re-spawns the subagent with a corrected prompt. Partial work is not silently accepted.

### Implementation subagent prompt template

The orchestrator constructs every implementation subagent prompt with these exact sections, derived from the slice spec:

- **ADR + slice id.** Example: `"ADR-108 Slice 2 - Settle path debit (video only)"`.
- **Required reading.** Verbatim absolute paths: this ADR + the slice's prior-ADR list + this slice's `Likely files`.
- **Purpose.** One paragraph from the slice's `Scope`.
- **Scope IN.** Exact files / directories the subagent may edit. Wildcards allowed only inside test directories.
- **Scope OUT.** Exact files / directories the subagent must not touch (image/tts/stt quota paths, chat routing, OpenAI image path, `runtime-provider-profile.ts` pricing modes unless slice opens it, etc.).
- **Required tests.** Verbatim from the slice `Required tests`.
- **Forbidden patterns.** Slice-specific anti-patterns (no keyword routing, no broad reformat, no new pricing modes, no `image_generate` edits, no contract changes outside Scope IN, no commits, no push).
- **Verification commands.** Exact `pnpm` invocations the subagent must run with output included.
- **Return structure.** The mandatory structure below, listed in full so the subagent cannot omit it.

### Subagent return structure (mandatory)

The implementation subagent must return all seven items. Returns missing any item are rejected without diff-review:

1. **Changed files** — one bullet per file with one-line behavioral summary.
2. **Tests added or changed** — file path + assertion summary.
3. **Tests run** — exact commands + PASS / FAIL per command + tail of output where useful.
4. **Behavioral summary** — 3-5 bullets, no prose.
5. **Risks observed** — anything the orchestrator should know that is not in the slice spec.
6. **Out-of-scope discoveries** — issues found but not fixed. Orchestrator decides whether to file a follow-up slice or expand the current one.
7. **Diff line counts per file.**

### Per-slice acceptance gate

Before the orchestrator marks a slice complete, all of the following must be true:

- [ ] Every file in `Scope IN` was changed as planned; no file in `Scope OUT` was touched.
- [ ] Every test listed in `Required tests` exists and passes.
- [ ] No `Forbidden patterns` appear in the diff.
- [ ] Doc updates listed for the slice are present in the same change set.
- [ ] CHANGELOG line appended.
- [ ] SESSION-HANDOFF updated.
- [ ] This ADR's slice spec carries a `Status (YYYY-MM-DD): Completed.` block.
- [ ] Repo verification gates for the slice pass through the orchestrator's own shell (not just the subagent's claim).
- [ ] Cross-slice invariants below remain true (orchestrator may spawn a small readonly audit subagent to confirm if the diff is non-trivial).

If any item fails, the orchestrator either re-spawns the subagent with a corrected prompt or rolls the slice back.

### Subagent rules (binding on every implementation subagent)

- Read this ADR + the slice-specific files before editing.
- Edit only files listed in `Scope IN`.
- Refuse to edit `Scope OUT` files even if a refactor would seem helpful — surface as `Out-of-scope discoveries`.
- Return the mandatory structure above in full.
- Do not commit or push.
- Do not run broad reformatters across files outside `Scope IN`.
- Add focused tests for each changed seam.
- Run every verification command listed by the orchestrator and include the exact output tail.

### Cross-slice invariants the orchestrator enforces (above per-slice Scope OUT)

1. Image / TTS / STT / chat routing behavior unchanged anywhere in this ADR.
2. ADR-106 invariants preserved (Runway/Kling video-only, chat routing OpenAI/Anthropic-only, OpenAI image untouched).
3. ADR-105 media-job durability preserved.
4. No new pricing modes in `runtime-provider-profile.ts` unless a slice spec explicitly opens that.
5. No keyword routing anywhere.
6. `image_generate` / `image_edit` / `tts` / `stt` per-unit quota counters untouched by anything in this ADR.

If a subagent return violates any of these, the slice is rolled back.

### Required startup reading

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. `docs/API-BOUNDARY.md`
6. `docs/DATA-MODEL.md`
7. `docs/TEST-PLAN.md`
8. this ADR
9. relevant prior ADRs:
   - `docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md`
   - `docs/ADR/086-async-media-jobs-for-generated-image-audio-and-video.md`
   - `docs/ADR/087-unified-quota-advisories-and-paid-light-mode.md`
   - `docs/ADR/089-media-package-add-ons.md`
   - `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
   - `docs/ADR/105-media-job-truth-and-orchestrated-cleanup.md`
   - `docs/ADR/106-video-provider-catalog-and-execution-routing.md`
   - `docs/ADR/107-provider-native-video-audio.md`
   - `docs/ADR/109-heygen-talking-avatar-on-vcoin.md` (when ADR-108 slice 1 lands; ADR-109 depends on this ADR)

## Execution ledger

| Slice | Title                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Deploy         |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 0     | Baseline + ADR-107 program closure            | Record baseline SHA. Add `## Program closure` section to `docs/ADR/107-provider-native-video-audio.md` listing what landed (slices 1, 4, 5 + code-only slices 2, 3) and what is deferred indefinitely (Kling Omni route, broad Kling multi-image, Runway voice/avatar APIs in `video_generate`, `preserve_reference_audio` / `reference_voice_or_track` audio modes, audio-priced ledger dimensions, delivery narration). ADR-107 acceptance checklist becomes partial: landed items marked, rest explicitly deferred with no follow-up program. Document `omni` catalog-vs-runtime split and OpenAI video credential coupling as accepted residuals. **No code changes, no enum edits, no deferred-item implementation.** | DOCS           |
| 1     | Schema + platform contract for VC wallet      | Add `workspace_vc_balance` Prisma table. Add `vcoinExchangeRate` to `PlatformRuntimeProviderSettings` (default 20). Add `videoVcoinMonthlyGrant` integer field on plan `billingProviderHints`. Mark `videoGenerateMonthlyUnitsLimit` as deprecated in code comments but keep it on the row. `RuntimeBillingFacts` unchanged.                                                                                                                                                                                                                                                                                                                                                                                               | API + CONTRACT |
| 2     | Settle path debit (video only)                | `media-delivery.service.ts` for `sourceToolCode === "video_generate"` now computes VC from `billingFacts.metering.time_metered.durationSeconds * pricePerUnit * VCOIN_PER_USD` (round half-up) and debits `workspace_vc_balance` in the same transaction that settles the job. `image_generate` / `image_edit` / `tts` / `stt` settle paths are not changed. Enqueue gains an advisory pre-check that rejects when `balance <= 0` for `video_generate`.                                                                                                                                                                                                                                                                    | API + RUNTIME  |
| 3     | Monthly grant on subscription period boundary | Service that on subscription renewal (or first activation in a period) credits `videoVcoinMonthlyGrant` VC to the workspace wallet, idempotent per `{workspace_id, periodStart}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | API            |
| 4     | Packages crediting flip                       | `manage-media-package-purchase.service.ts` for package items typed `video_generate` credits VC to `workspace_vc_balance` instead of granting `granted_units`. Existing Stripe/payment intent flow untouched. Catalog item `units` field re-purposed as VC amount for `video_generate` packages with explicit migration note.                                                                                                                                                                                                                                                                                                                                                                                               | API            |
| 5     | Admin Plans UI                                | Replace "Monthly video generations" field with "Monthly VC grant" on the `video_generate` plan card. Show a non-authoritative hint "\u2248 N videos at avg rate" computed from current catalog `time_metered` rows. Show the platform course `1 USD = 20 VC` next to the field. Keep `videoGenerateModelKey` / `videoGenerateFallbackModelKey` exactly as today.                                                                                                                                                                                                                                                                                                                                                           | WEB + API      |
| 6     | User UI updates                               | Assistant Settings -> Limits and Plan: for `video_generate` show "Remaining N VC" instead of `K/M`. Pricing page card adds `X VC / month \u2248 Y videos` line, only for plans with `videoVcoinMonthlyGrant > 0`. Packages page items show `+1000 VC` label. Sidebar plan line may show VC compactly. Course tooltip is allowed where space requires.                                                                                                                                                                                                                                                                                                                                                                      | WEB            |
| 7     | Quota status tool + runtime advisor           | `quota_status` for `video_generate` returns VC balance and grant size instead of unit counters. Runtime advisor copy reads `"remaining N VC; a typical video costs about K VC"`. No keyword routing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | RUNTIME + API  |
| 8     | Manual migration playbook                     | Runbook document for admins to walk 5 plans and set `videoVcoinMonthlyGrant`. Mark `videoGenerateMonthlyUnitsLimit` as deprecated in the plan editor copy. Document explicit supersession of ADR-106 Slice 9 in the video portion only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | DOCS           |
| 9     | Tests + docs + verification gate              | End-to-end test covering ad-hoc Runway / Kling / OpenAI video paths produce VC debit. Image / TTS / STT paths produce no VC debit. ADR-105/106/107 cross-references updated. `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md` updated. Full verification gate (lint, format:check, api typecheck, web typecheck, runtime typecheck, provider-gateway typecheck).                                                                                                                                                                                                                                                                                                                  | DOCS + ALL     |

Minimum useful path for VC wallet without UI: `0 -> 1 -> 2 -> 3 -> 4`.

Minimum production path for end-user-visible VC economy on `video_generate`: `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9`.

## Slice specifications

### Slice 0 - Baseline + ADR-107 program closure

**Scope**

- Record baseline SHA in `docs/SESSION-HANDOFF.md`.
- Add a `## Program closure (YYYY-MM-DD)` section at the end of `docs/ADR/107-provider-native-video-audio.md` with:
  - **Landed:** slices 1, 4, 5 (with CHANGELOG references) + slices 2 and 3 on the active code path (with file references to `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts:430-433`, `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts:1092-1307`).
  - **Deferred indefinitely (no follow-up program):**
    - Kling Omni provider route (`POST /v1/videos/omni-video`).
    - Broad Kling multi-image / multi-element generation beyond the landed 2-image `image` + `image_tail` path.
    - Runway voice/avatar APIs being routed through `video_generate` (line 39-40 stays true; ADR-109 carves a HeyGen-only exception, nothing else).
    - `preserve_reference_audio` and `reference_voice_or_track` audio modes from the ADR text — never implemented, will not be implemented.
    - Audio-priced ledger dimensions distinguishing silent vs native-audio vs voice-control cost.
    - Delivery copy that narrates produced audio / input-mode details to the user.
  - **Acceptance checklist becomes partial:** landed items marked `[x]`; deferred items marked `[~]` with a short "deferred indefinitely" note. The checklist is not reopened.
  - **Cross-link:** point to ADR-108 as the pre-talking-avatar cleanup program that supersedes the ADR-107 follow-up intent, and to ADR-109 as the talking-avatar program with the named HeyGen exception to ADR-107 line 39-40.
- Document the two accepted residuals (one paragraph each in the same `Program closure` section):
  - `omni` catalog truth vs runtime: catalog accepts the capability type, save API rejects it for execution rows, runtime hard-rejects requests. Not a bug, will stay this way until or unless a future ADR opens the Omni route.
  - OpenAI video shares the `tool_image_generate` credential. ADR-109 will not change this; future change requires its own ADR.

**Scope IN**

- `docs/ADR/107-provider-native-video-audio.md` (add `## Program closure` section only; do not edit existing slice text or status blocks).
- `docs/ADR/108-video-vcoin-economy-and-pre-talking-avatar-cleanup.md` (append slice 0 `**Status (YYYY-MM-DD): Completed.**` block per the ADR-106 pattern).
- `docs/SESSION-HANDOFF.md` (new session entry).
- `docs/CHANGELOG.md` (one line entry).

**Scope OUT (forbidden in this slice)**

- Any code changes anywhere. This slice is docs-only.
- Editing or removing audio mode enums in `packages/runtime-contract/src/index.ts`.
- Implementing any deferred ADR-107 item (Kling Omni, broad multi-image, Runway audio/voice expansion, audio-priced ledger, delivery narration).
- Rewriting existing ADR-107 slice specs or status blocks — only the new `Program closure` section is added.
- Touching ADR-106, ADR-105, ADR-099, ADR-082.

**Forbidden patterns**

- Re-opening the ADR-107 acceptance checklist for any item not listed as landed.
- Adding a "future plan" or "candidate roadmap" to deferred items — they are deferred without follow-up program.
- Implementing enum cleanup "to keep contract honest" — the enum stays as it is; the program closure documents the gap as accepted residual.

**Required tests**

- None. Docs-only slice.

**Exit**

- ADR-107 is closed as a program with explicit landed + deferred lists.
- No ADR-107 work remains scheduled.
- ADR-108 Slice 0 status block records completion.
- ADR-109 has a clean substrate (no ambiguous open ADR-107 questions to re-discover).

**Status (2026-06-03): Completed.** ADR-107 is closed as a program through a new `## Program closure (2026-06-03)` section in `docs/ADR/107-provider-native-video-audio.md` that lists landed slices (1, 4, 5 ledgered in `docs/CHANGELOG.md` 2026-06-02; 2 and 3 code-only on the active path with explicit file:line references at `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts:430-433` and `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts:1092-1307`) and the indefinitely-deferred items (Kling Omni route, broad Kling multi-image, Runway voice/avatar via `video_generate`, `preserve_reference_audio` / `reference_voice_or_track` audio modes, audio-priced ledger dimensions, delivery narration) with no follow-up program. The ADR-107 acceptance checklist is now partial — landed items `[x]`, deferred items `[~]` with a "deferred indefinitely" note — and two accepted residuals are recorded in the same section (the `omni` catalog-vs-runtime split, and OpenAI video sharing the `tool_image_generate` credential). Cross-links to this ADR (program closure track) and to ADR-109 (HeyGen-only named exception to ADR-107 line 39-40) are in place. No code was changed; no enum cleanup was performed.

### Slice 1 - Schema + platform contract for VC wallet

**Scope**

- Add Prisma model `WorkspaceVcoinBalance` with `{ workspace_id (unique), balance_vc int default 0, updated_at }`.
- Add `vcoinExchangeRate` integer to `PlatformRuntimeProviderSettings` JSON shape, default 20.
- Add `videoVcoinMonthlyGrant` integer to plan `billingProviderHints` (default 0 / unlimited semantics defined by Slice 3).
- Add helper `convertUsdMicrosToVcoin(micros: bigint, rate: number): number` with round half-up.
- Mark `videoGenerateMonthlyUnitsLimit` deprecated in source comments and OpenAPI description.
- No behavioral change at runtime yet.

**Scope OUT (forbidden in this slice)**

- Any change in `media-delivery.service.ts`, `enqueue-runtime-deferred-media-job.service.ts`, `assistant-media-job-*` settle/release/reconcile logic.
- Any change to image / TTS / STT plan fields.
- Any UI changes (`apps/web/**`).
- Any actual wallet debit/credit code paths (Slice 2 and Slice 3 own those).

**Required tests**

- Conversion helper rounds correctly across edge cases (0, 1 cent, exact 5 cents, 4 cents, 6 cents).
- Plan loader still accepts plans without `videoVcoinMonthlyGrant` and treats them as 0.
- `vcoinExchangeRate` defaults to 20 when absent.
- `WorkspaceVcoinBalance` row is created on first read with `balance_vc=0`.

**Exit**

- Schema and contract are wallet-ready.
- No user-visible change.

**Status (2026-06-03): Completed.** Substrate is wallet-ready without changing any runtime behavior. New Prisma model `WorkspaceVcoinBalance` (`workspace_vcoin_balances`, PK on `workspace_id`, `balance_vc` integer default 0, FK to `workspaces`) and new scalar column `platform_runtime_provider_settings.vcoin_exchange_rate` (integer NOT NULL DEFAULT 20) landed via migration `20260603190000_adr108_workspace_vcoin_balance`. `PlatformRuntimeProviderSettings` read path defaults `vcoinExchangeRate` to 20 when absent and round-trips the value through admin upsert; plan `billingProviderHints` carries `videoVcoinMonthlyGrant` with default 0. New pure helper `convertUsdMicrosToVcoin(micros: bigint, rate: number): number` uses round-half-up at the half-VC midpoint (the per-job ceil from Decision §53 is intentionally a Slice 2 settle-path concern, not part of the helper). New read-only-with-create repository `WorkspaceVcoinBalanceRepository.getOrCreate(workspaceId)` returns `{ workspaceId, balanceVc, updatedAt }` with no debit / credit / mutation methods. `videoGenerateMonthlyUnitsLimit` is JSDoc-`@deprecated` in `packages/runtime-contract/src/index.ts` and `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`, and `deprecated: true` + an explanatory `description` in `packages/contracts/openapi.yaml`; the field stays present on the row for one release cycle per ADR-108 Non-goals. No `media-delivery.service.ts`, `enqueue-runtime-deferred-media-job.service.ts`, runtime, web, provider-gateway, image / TTS / STT plan field, `RuntimeBillingFacts`, or `model_cost_ledger_events` change. `docs/DATA-MODEL.md` updated with the new wallet substrate paragraph. Verification: PASS `corepack pnpm contracts:generate`; PASS `corepack pnpm --filter @persai/contracts run typecheck`; PASS `corepack pnpm --filter @persai/api run typecheck`; PASS `corepack pnpm --filter @persai/web run typecheck`; PASS `corepack pnpm --filter @persai/runtime run typecheck`; PASS `corepack pnpm --filter @persai/api exec tsx test/convert-usd-micros-to-vcoin.test.ts`; PASS `corepack pnpm --filter @persai/api exec tsx test/workspace-vcoin-balance.repository.test.ts`; PASS `corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts`; PASS `corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts`; PASS `corepack pnpm --filter @persai/api run lint`; PASS `corepack pnpm run format:check`. Out-of-scope discoveries (deferred to later slices, not Forbidden): `videoGenerateMonthlyUnitsLimit` is also re-declared at four Scope OUT call-sites (`apps/api/src/modules/workspace-management/application/quota-offers.ts`, `apps/api/src/modules/workspace-management/application/read-internal-runtime-quota-status.service.ts`, `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`, `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`); their JSDoc-deprecation sweep belongs naturally to Slice 2 or Slice 7. `vcoinExchangeRate` is on the read-state OpenAPI schema but not on the admin save-request body schema; Slice 5 (Admin Plans UI) will own promoting it to the request body.

### Slice 2 - Settle path debit (video only)

**Scope**

- `media-delivery.service.ts` for `sourceToolCode === "video_generate"`: after successful artifact delivery, compute VC cost from `billingFacts` and debit `workspace_vc_balance` in the same DB transaction that settles the monthly unit counter (during transitional period both writes happen; admin can audit equivalence).
- After transitional period (later ADR follow-up), the monthly unit counter write for `video_generate` is removed; that is not in this slice.
- `enqueue-runtime-deferred-media-job.service.ts` for `video_generate`: add advisory pre-check that rejects `vcoin_balance_exhausted` when `balance_vc <= 0`. Existing plan `videoGenerateMonthlyUnitsLimit` check remains as a secondary guard during transitional period.
- `image_generate` / `image_edit` / `tts` / `stt` settle paths unchanged.
- Failed jobs do not debit (terminal worker failure, delivery failure, reconciliation-required) - exact behavior unchanged from per-unit model.

**Scope OUT (forbidden in this slice)**

- Any change to image / TTS / STT branches inside `media-delivery.service.ts` or `enqueue-runtime-deferred-media-job.service.ts`.
- Removing the existing `videoGenerateMonthlyUnitsLimit` enforcement (kept as secondary guard until the migration playbook in Slice 8).
- Touching `runtime-provider-profile.ts` pricing modes (uses existing `time_metered` only).
- Touching provider-gateway adapters or `runtime-video-generate-tool.service.ts`.
- UI changes (`apps/web/**`).

**Forbidden patterns**

- Two separate transactions for "settle quota" + "debit wallet" — they must share one DB transaction, or the slice is rolled back.
- Computing VC from anything other than `billingFacts.metering.time_metered.durationSeconds` and the catalog row matched by `(providerKey, modelKey, occurredAt)`.
- Silent fallback to 0 VC when `billingFacts` is missing — must fail honestly and surface for reconciliation.

**Required tests**

- Successful Runway video settle decrements `balance_vc` by computed VC amount.
- Successful Kling video settle decrements correctly.
- Successful OpenAI video settle decrements correctly.
- Successful image / TTS / STT settle does not touch `workspace_vc_balance`.
- Enqueue with `balance_vc = 0` returns `vcoin_balance_exhausted`.
- Enqueue with `balance_vc > 0` proceeds.
- A single in-flight job that drives balance below zero is allowed exactly once; the next enqueue is rejected.
- Terminal worker failure does not debit.
- Delivery-loop failure does not debit.

**Exit**

- VC is the authoritative user-facing settlement for `video_generate` while existing unit counters continue updating in parallel (no admin-facing change yet).

**Status (2026-06-03): Completed.** Video-only success-delivery now atomically settles the existing monthly unit counter and debits the workspace VC wallet inside one `prisma.$transaction(...)`. Cost is computed via the new pure helper `apps/api/src/modules/workspace-management/application/vcoin/compute-video-vcoin-cost.ts`, which mirrors `record-model-cost-ledger.service.ts::calculateTimeMeteredCostMicros` for the USD-micros leg (cross-slice invariant 2: USD COGS ledger shape stays the source of truth) and applies the per-job `ceil` from Decision §53 at the VC level. The wallet repository (`apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-vcoin-balance.repository.ts`) gained a `debit({workspaceId, amountVc, tx?})` mutation that decrements `balance_vc` inside the caller's transaction (or against the default client when omitted); negative amounts throw, zero amounts are no-op, and the repo deliberately permits a one-shot below-zero write so the transaction can commit cleanly when an artifact's computed VC cost overshoots the wallet — the next enqueue rejects on the wallet pre-check rather than the repo. Quota repository (`prisma-workspace-quota-accounting.repository.ts`) and service (`track-workspace-quota-usage.service.ts`) gained an optional `tx` parameter on the settle path: when supplied the inner `$transaction` and the serializable retry loop are skipped (the outer transaction owns isolation and retry), when omitted the existing image / image-edit / TTS / STT call sites observe byte-identical behavior. `enqueue-runtime-deferred-media-job.service.ts` now performs an advisory wallet pre-check on `video_generate` only: when `balance_vc <= 0` the enqueue is rejected with structured `code: "vcoin_balance_exhausted"`, `limitKind: "vcoin_balance_exhausted"`, before the legacy `videoGenerateMonthlyUnitsLimit` reservation runs (kept as secondary guard during the transitional period). Image / image-edit / TTS / STT enqueues never read the wallet; image / image-edit / TTS / STT settle paths never open a `$transaction`, never resolve platform settings, never debit the wallet — proven by tests that pass throwing wallet stubs through those paths. Failed deliveries (worker terminal failure, missing billingFacts, settle throw inside the tx) trigger the existing `markMonthlyMediaQuotaReconciliationBestEffort` exactly as before Slice 2; the wallet is NOT debited on any failure (silent 0-VC fallback is forbidden per Slice 2 forbidden patterns). Audit log line `adr108_video_settle workspaceId=… provider=… model=… durationSeconds=… usdMicros=… vcDebited=… previousBalanceVc=… balanceVc=…` is emitted on every successful debit so admins can spot drift between the wallet and the unchanged USD COGS ledger. Verification: PASS `corepack pnpm --filter @persai/api run typecheck`; PASS `corepack pnpm --filter @persai/web run typecheck`; PASS `corepack pnpm -r --if-present run lint`; PASS `corepack pnpm run format:check`; PASS new `corepack pnpm --filter @persai/api exec tsx test/compute-video-vcoin-cost.test.ts` (8 cases covering seconds-unit, minute-unit, per-job ceil, usdMicros=0, non-time-metered fact / profile drift, non-positive duration, non-positive integer rate); PASS `corepack pnpm --filter @persai/api exec tsx test/workspace-vcoin-balance.repository.test.ts` (10 cases incl. new debit zero, debit negative throws, debit positive default-client, debit-with-tx routes through tx, debit allows below-zero one-shot, debit creates row if missing); PASS `corepack pnpm --filter @persai/api exec tsx test/enqueue-runtime-deferred-media-job.service.test.ts` (12 cases, +3 new for empty wallet rejection, positive wallet proceed, image_generate never consulting wallet); PASS new `corepack pnpm --filter @persai/api exec tsx test/media-delivery-video-vcoin-settle.test.ts` (6 cases covering Runway + Kling + OpenAI cost paths, image_generate no-VC, settle failure rolls both writes back, missing billingFacts triggers reconciliation without entering the tx); PASS full API test suite via `corepack pnpm --filter @persai/api run test`. Cross-slice invariants preserved: `model_cost_ledger_events` shape and write site (`assistant-media-job-scheduler.service.ts::recordPersistedBillingFactsEvent`) unchanged; `RuntimeBillingFacts` stays currency-neutral (no VC fields added); `image_generate` / `image_edit` / `tts` / `stt` per-unit quota counters and settle behavior unchanged; no chat-routing / OpenAI-image / runtime / provider-gateway / web change; no Stripe / payment-intent / webhook change. Deploy: API only; the Slice 1 migration is the only schema change required and was already deployed when Slice 1 landed.

### Slice 3 - Monthly grant on subscription period boundary

**Scope**

- Add idempotent service `GrantMonthlyVcoinService.creditPeriod({ workspaceId, planId, periodStart })`.
- Hook into subscription period rollover (existing periodic scheduler or activation event).
- Credit `videoVcoinMonthlyGrant` from the plan into `workspace_vc_balance`.
- Idempotency key `{ workspaceId, periodStart }`.

**Required tests**

- First call credits the grant.
- Second call with same key is a no-op.
- Plan with grant = 0 produces a no-op.
- Plan with grant > 0 credits exactly the grant amount.
- Wallet balance accumulates across periods (no reset).

**Exit**

- Wallet receives subscription-based top-ups automatically.

**Status (2026-06-03): Completed.** Monthly Vcoin grant is now credited idempotently into the workspace wallet on every subscription period boundary. What landed:

- New Prisma model `WorkspaceVcoinLedgerEvent` (`workspace_vcoin_ledger_events`, PK on `id` UUID, `workspace_id` FK, `kind` TEXT, `amount_vc` INTEGER signed, `reference_key` TEXT, optional `plan_code` TEXT, `created_at` timestamp) and a UNIQUE index on `(workspace_id, kind, reference_key)` — the idempotency surface. Migration `apps/api/prisma/migrations/20260603220000_adr108_vcoin_ledger_event/migration.sql`.
- New shared helper `apps/api/src/modules/workspace-management/application/vcoin/parse-video-vcoin-monthly-grant.ts` — extracted from the private `toVideoVcoinMonthlyGrant` in `manage-admin-plans.service.ts` so both the admin write path and the grant service share one parse implementation (ADR-108 Slice 3 forbidden patterns: no duplicate parse logic). Both call sites in `manage-admin-plans.service.ts` now use the exported function.
- New `WorkspaceVcoinLedgerEventRepository` domain port (`WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY` symbol) + Prisma impl. Exposes only `recordEvent({workspaceId, kind, amountVc, referenceKey, planCode?, tx})` returning `{recorded: true/false}`. P2002 on the unique index → `recorded: false`. Non-P2002 errors re-thrown.
- `WorkspaceVcoinBalanceRepository` extended with `credit({workspaceId, amountVc, kind, tx?}): {previousBalanceVc, balanceVc, creditedAt}`. Zero is no-op, negative throws, positive increments via `{increment: amountVc}`. `kind` is accepted for callsite documentation but NOT persisted by the repo (the ledger row owns that). `credit` does NOT itself write the ledger event (ledger-first → credit-second order enforced by the service).
- New `GrantMonthlyVcoinService` at `apps/api/src/modules/workspace-management/application/vcoin/grant-monthly-vcoin.service.ts`. Public method `creditPeriod({workspaceId, planCode, periodStartedAt, tx: Prisma.TransactionClient})`. Loads `PlanCatalogPlan` via the supplied tx, parses `videoVcoinMonthlyGrant` via the shared helper, handles zero-grant no-op (no idempotency mark written), writes ledger event first (idempotency gate), then calls `credit`. `tx` is REQUIRED — always called inside a transaction.
- **Rollover hook**: `ManageWorkspaceSubscriptionLifecycleService.applyActivePaidTransition` now calls `grantMonthlyVcoinService.creditPeriod({workspaceId, planCode: paidPlanCode, periodStartedAt, tx})` INSIDE the existing `prisma.$transaction(async tx => {...})` block, after `appendLifecycleEvent` and before the transaction closes. A throw rolls back the entire subscription upsert + lifecycle event + grant atomically. Post-transaction side effects (`markWorkspaceAssistantsConfigDirty`, `queueBillingLifecycleRollout`, `emitForLifecycleEventIds`) are unchanged in shape and order.
- Audit log line `adr108_vcoin_grant_credited workspaceId=… planCode=… periodStartedAt=… vcGranted=… previousBalanceVc=… balanceVc=…` emitted on successful credit (quiet on `alreadyGranted=true`).
- New `WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY` + `GrantMonthlyVcoinService` registered in `workspace-management.module.ts`.
- `docs/DATA-MODEL.md` updated with the new `workspace_vcoin_ledger_events` paragraph; cross-slice invariant 2 (`model_cost_ledger_events` unchanged) explicitly documented.

Verification: PASS `corepack pnpm --filter @persai/api run pretypecheck`; PASS `corepack pnpm --filter @persai/api run typecheck`; PASS `corepack pnpm --filter @persai/web run typecheck`; PASS `corepack pnpm -r --if-present run lint`; PASS `corepack pnpm run format:check`; PASS new `corepack pnpm --filter @persai/api exec tsx test/grant-monthly-vcoin.service.test.ts` (7 cases: first-call credit, second-call idempotent no-op, zero-grant no-op, positive-grant exact amount, accumulates across periods, plan-not-found throws, tx sentinel propagation); PASS augmented `corepack pnpm --filter @persai/api exec tsx test/workspace-vcoin-balance.repository.test.ts` (15 cases: +5 new credit tests mirroring the debit shape); PASS new `corepack pnpm --filter @persai/api exec tsx test/workspace-vcoin-ledger-event.repository.test.ts` (4 cases: record once, duplicate P2002 → `recorded: false`, different kind allowed, non-P2002 rethrown); PASS augmented `corepack pnpm --filter @persai/api exec tsx test/workspace-subscription-lifecycle.service.test.ts` (+3 new cases: creditPeriod called on activatePaidSubscription, grant uses same tx sentinel as subscription upsert, grant throw rolls back subscription); PASS `corepack pnpm --filter @persai/api run test` (full API suite). ADR-108 cross-slice invariants: `model_cost_ledger_events` unchanged; `RuntimeBillingFacts` unchanged; image/TTS/STT settle and enqueue paths byte-identical; post-tx side effects (dirty-mark / materialization / producer emit) unchanged in shape and order; grant + subscription upsert share ONE transaction; idempotency mark written BEFORE wallet credit; all admin and grant call sites use shared `parseVideoVcoinMonthlyGrant`. Deploy: API (migration `20260603220000_adr108_vcoin_ledger_event` must run before deploy via `Dev Image Publish` migration approval gate per AGENTS.md).

### Slice 4 - Packages crediting flip

**Scope**

- `manage-media-package-purchase.service.ts`: on successful purchase of a `MediaPackageCatalogItem` with `package_type = "video_generate"`, credit `item.units` VC to `workspace_vc_balance` instead of writing `WorkspaceMediaPackageGrant.granted_units`.
- Add a `kind` discriminator on credit operations (`monthly_grant` / `package_purchase` / `manual`) stored alongside the balance row or in a side audit table - exact shape decided in slice implementation, but the discriminator must survive in the database.
- Catalog `units` semantic for `video_generate` package items changes from "videos" to "VC". Existing image / audio packages are unaffected.
- Stripe / payment intent / refund logic unchanged.

**Scope OUT (forbidden in this slice)**

- Image / audio `MediaPackageCatalogItem` handling.
- Stripe webhook code, payment intent state machine, `amount_minor` / `currency` flows on plans or packages.
- Admin UI (kept for Slice 5).
- Schema for `MediaPackageCatalogItem` or `WorkspaceMediaPackageGrant` — the `units` field is re-purposed semantically without renaming.

**Forbidden patterns**

- Hiding the old `granted_units` write path with a feature flag instead of removing it for `video_generate` packages — the flip must be unconditional for video packages.
- Touching refund branches for non-video packages.

**Required tests**

- Purchase of a 1000-VC video package credits exactly 1000 VC.
- Purchase of an image package writes `granted_units` exactly as today (no VC debit/credit).
- Refund of a VC package debits the same amount back.

**Exit**

- Top-up channel works through VC.

**Status (2026-06-03): Completed.** The packages crediting flip for `video_generate` is live. What landed:

- `manage-media-package-purchase.service.ts` refactored from a batch-array `prisma.$transaction([...])` to an interactive `prisma.$transaction(async (tx) => {...})`. Inside the transaction: `video_generate` items are aggregated into a single `videoVcCreditTotal`; ONE `recordEvent({kind: "package_purchase", amountVc: videoVcCreditTotal, referenceKey: paymentIntentId, planCode: null, tx})` call is made, followed by ONE `credit({amountVc: videoVcCreditTotal, kind: "package_purchase", tx})` call. `recorded === false` → quiet idempotent retry, no credit, no log. `recorded === true` → credit plus audit log line `adr108_vcoin_package_purchase_credited workspaceId=… paymentIntentId=… catalogItemId=… vcCredited=… previousBalanceVc=… balanceVc=…`. Non-video items (image_generate, image_edit, document) continue to write a `WorkspaceMediaPackageGrant` row via `tx.workspaceMediaPackageGrant.upsert(...)` with byte-identical payload. The billing period (`resolveEffectiveSubscriptionStateService`) is only resolved when non-video items are present. Two new constructor dependencies injected: `WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY` and `WORKSPACE_VCOIN_BALANCE_REPOSITORY` (both already registered in `workspace-management.module.ts` from Slices 1 and 3).
- New public method `reversePackagePaymentIntent({paymentIntentId, workspaceId})` on `ManageMediaPackagePurchaseService`. Reads `WorkspacePaymentIntent.metadata.packageItems` (the snapshot — catalog row NOT re-read). Computes `videoVcDebitTotal`. If 0, returns early (no VC movement; non-video refund behavior preserved as known residual). Otherwise opens `prisma.$transaction(async tx => {...})` → `recordEvent({kind: "package_refund", amountVc: -videoVcDebitTotal, ...})` (negative = ledger debit entry) → if `recorded === true`, `debit({amountVc: videoVcDebitTotal, tx})` + audit log `adr108_vcoin_package_refund_debited …`. Idempotency by `(workspaceId, "package_refund", paymentIntentId)` unique index.
- `handle-cloudpayments-webhook.service.ts`: in `handle()`, after `updatePaymentIntent` and before `deriveLifecycleEvent`, a new block checks `notificationType === "refund"` AND `readPaymentIntentPurpose(paymentIntent.metadata) === "media_package_purchase"`. When both are true, calls `manageMediaPackagePurchaseService.reversePackagePaymentIntent(...)`. The `payment_reversed` subscription lifecycle event flow continues unchanged for both subscription and package refunds.

Idempotency surface: `(workspaceId, "package_purchase", paymentIntentId)` and `(workspaceId, "package_refund", paymentIntentId)` unique rows in `workspace_vcoin_ledger_events`. Both use the PersAI-internal `WorkspacePaymentIntent.id` as the `referenceKey`.

Verification: PASS `corepack pnpm --filter @persai/api run typecheck`; PASS `corepack pnpm --filter @persai/web run typecheck`; PASS `corepack pnpm -r --if-present run lint`; PASS `corepack pnpm run format:check`; PASS augmented `corepack pnpm --filter @persai/api exec tsx test/manage-media-package-purchase.service.test.ts` (11 cases: createPackagePaymentIntent, video 1000 VC credited, image grant exact, mixed intent single ledger event, idempotent purchase, zero video units no-op, video refund 1000 VC debited, image refund VC no-op, idempotent refund, intent-not-found throws, mixed refund only video debited); PASS augmented `corepack pnpm --filter @persai/api exec tsx test/handle-cloudpayments-webhook.service.test.ts` (+2 cases: refund for media_package_purchase invokes reversePackagePaymentIntent, refund for non-package intent does NOT invoke reversePackagePaymentIntent); PASS augmented `corepack pnpm --filter @persai/api exec tsx test/workspace-vcoin-ledger-event.repository.test.ts` (+1 case: negative amountVc round-trips); PASS `corepack pnpm --filter @persai/api run test` (full API suite). ADR-108 cross-slice invariants: `model_cost_ledger_events` unchanged; `RuntimeBillingFacts` unchanged; image/image-edit/document settle, enqueue, quota, purchase, and refund paths byte-identical except the batch→interactive transaction shape for non-video items (upsert payload and produced rows unchanged); video purchase no longer writes `WorkspaceMediaPackageGrant`; video refund debits wallet + records ledger event in ONE transaction; no feature flag for the video flip. Residuals: (1) image/audio package refunds still do not reverse the `WorkspaceMediaPackageGrant` row (pre-existing bug, Scope OUT); admin operator action required: catalog `video_generate` package rows must have their `units` field re-encoded in VC semantics before deploying the API image. Deploy: API only; no migration; no web/runtime/provider-gateway change.

### Slice 5 - Admin Plans UI

**Scope**

- Replace "Monthly video generations" field on the `video_generate` tool activation card with "Monthly VC grant".
- Add a non-authoritative hint "\u2248 N videos at avg rate" computed from average `time_metered` rate across active video catalog rows.
- Display the platform `vcoinExchangeRate` next to the field with a short explanation.
- Admin Runtime page (video catalog) unchanged in shape; only labels add a small `1 USD = 20 VC` note next to time-metered pricing.
- Image plan fields unchanged.

**Required tests**

- Save and load round-trips `videoVcoinMonthlyGrant` correctly.
- Hint "\u2248 N videos" recomputes when admin changes either the grant or any active catalog row.
- Image plan editor is unchanged.

**Exit**

- Operators can configure VC grants per plan and see the course context inline.

**Status (2026-06-03): Completed.** `apps/web/app/admin/plans/page.tsx` wired the full `videoVcoinMonthlyGrant` round-trip: `PlanDraft` type, `NumericDraftField` union, `NUMERIC_DRAFT_RULES` entry (`min: 0`, `allowBlank: true`), `planToDraft` (reads `plan.videoVcoinMonthlyGrant ?? 0` and stringifies), `draftToPayload` (parses blank → 0, maps to top-level `AdminPlanInputBase.videoVcoinMonthlyGrant` — NOT nested under `quotaLimits`), initial `emptyDraft()` field, and dirty-state tracking (included via `normalizePlanDraftForCompare` spread). The legacy `videoGenerateMonthlyUnitsLimit` field remains in all wire positions (`PlanDraft`, `NUMERIC_DRAFT_RULES`, `planToDraft`, `draftToPayload → quotaLimits`, dirty tracking) and is visually muted in the Plan limits section with `opacity-60`, strikethrough title, and a `(deprecated — use Monthly VC grant)` note — Slice 8 owns retirement. The new "Monthly VC grant" field is inserted directly after the deprecated legacy field with the same input shape (`type="number"`, `min={0}`, `placeholder="0"`). Two inline notes render to the right of the input: `1 USD = {vcoinExchangeRate} VC` (sourced from new `useState<number>(20)` set inside `load()` from `runtimeData?.vcoinExchangeRate ?? 20`) and `≈ N videos` or `≈ — videos` (computed from `floor(grant / ceil(avgUsdPerSecond × TYPICAL_VIDEO_SECONDS × vcoinExchangeRate))` where `TYPICAL_VIDEO_SECONDS = 5` is a named constant in the file, marked as a UI heuristic only). `avgVideoUsdPerSecond` is collected inside `load()` by walking active `time_metered` video profiles in `runtimeData.availableModelCatalogByProvider`; `unit === "minute"` values are divided by 60 before averaging; missing/null pricing ⇒ `null` average ⇒ hint shows `≈ — videos`. `PlanForm` gained `vcoinExchangeRate?: number` and `avgVideoUsdPerSecond?: number | null` props (defaults `20` and `null` respectively) and is now exported for test access. Both `PlanForm` usages in `AdminPlansPage` pass these new props. `apps/web/app/admin/runtime/page.tsx`: `ModelProfileEditor` and `PriceMetadataEditor` gained `vcoinExchangeRate?: number` props; the call site reads `settings?.vcoinExchangeRate ?? 20`; the `time_metered` pricing block renders `<span className="text-xs text-muted-foreground">1 USD = {vcoinExchangeRate} VC</span>` adjacent to the "Price / unit" field (span addition only — layout, row shape, and all other pricing fields unchanged). Tests in `apps/web/app/admin/plans/page.test.tsx` (+7 new cases): `planToDraft` round-trip for `videoVcoinMonthlyGrant: 1000`; `draftToPayload` top-level placement and blank → 0; `validatePlanDraft` rejects `-5` and `1.5`, accepts `0` and blank; `isPlanDraftDirty` flips on change; `≈ 200 videos` hint with `vcoinExchangeRate=20` / `avgVideoUsdPerSecond=0.05` / `grant=1000` (formula: `vcPerVideo=ceil(0.05×5×20)=5`, `approxVideos=floor(1000/5)=200`); `≈ — videos` when `avgVideoUsdPerSecond=null`; `1 USD = 20 VC` label present. Tests in `apps/web/app/admin/runtime/page.test.tsx` (+1 new case): `1 USD = 20 VC` label renders when a time-metered video profile is selected and `settings.vcoinExchangeRate === 20`. Verification: PASS `corepack pnpm --filter @persai/web run typecheck`; PASS `corepack pnpm --filter @persai/api run typecheck`; PASS `corepack pnpm -r --if-present run lint`; PASS `corepack pnpm run format:check`; PASS `corepack pnpm --filter @persai/web exec vitest run app/admin/plans/page.test.tsx` (13 tests); PASS `corepack pnpm --filter @persai/web exec vitest run app/admin/runtime/page.test.tsx` (16 tests); PASS `corepack pnpm --filter @persai/web exec vitest run` (626 tests). ADR-108 cross-slice invariants preserved: apps/api unchanged; image plan fields byte-identical; legacy `videoGenerateMonthlyUnitsLimit` present in all wire positions; `videoVcoinMonthlyGrant` maps to top-level payload (not `quotaLimits`); runtime page layout preserved (span addition only). Deploy: web only, no migration.

### Slice 6 - User UI updates

**Scope**

- `apps/web/app/app/_components/assistant-settings.tsx`: monthly media card for `video_generate` shows "Remaining N VC" (with tooltip "1 VC \u2248 $0.05") instead of `K/M` count.
- `apps/web/app/_components/pricing-page-view.tsx`: plan card for plans with `videoVcoinMonthlyGrant > 0` shows "X VC / month \u2248 Y videos" as a marketing line.
- `apps/web/app/app/packages/page.tsx`: video packages display `+1000 VC` instead of `+10 videos`.
- Sidebar plan compact line may show VC; not mandatory.
- All other media cards (image, tts, stt) unchanged.

**Required tests**

- Settings card renders VC for video and unit count for image (existing test patterns + new VC case).
- Pricing card renders the VC line only for VC-enabled plans.
- Packages page renders the VC label for video packages.

**Exit**

- End user sees VC where they used to see unit counts for `video_generate`.

**Status (2026-06-04): Completed.** Slice 6 delivered in two halves:

**Slice 6a** (data plumbing, commit `fc02efed`): `PublicPricingPlanState` gained `videoVcoinMonthlyGrant` (required), `vcoinExchangeRate` (required), `videoVcoinApproxVideosPerMonth` (optional, server-precomputed). `UserPlanVisibilityState` gained required `workspaceVcoinBalance: { balanceVc, videoVcoinMonthlyGrant, vcoinExchangeRate }`. API services injected `WorkspaceVcoinBalanceRepository` and `ResolvePlatformRuntimeProviderSettingsService`. Contracts regenerated; web test stubs updated mechanically. PASS: `@persai/api run typecheck`; `@persai/web run typecheck`; `pnpm -r lint`; `format:check`; full API suite.

**Slice 6b** (UI rendering): Three web surfaces updated to consume the new data:
- `apps/web/app/app/_components/assistant-settings.tsx` (`buildMonthlyCard`): `video_generate` card now renders `"Remaining N VC"` (value) and `"1 VC ≈ $X"` (secondary/tooltip) when `workspaceVcoinBalance` is present; all other media cards (image_generate, image_edit, tts, stt) byte-identical.
- `apps/web/app/_components/pricing-page-view.tsx` (`derivePlanFacts`): new VC branch added before legacy video branch — emits `"X VC / month ≈ Y videos"` (when `videoVcoinApproxVideosPerMonth` present) or `"X VC / month"` for plans with `videoVcoinMonthlyGrant > 0`; legacy `videoGenerateMonthlyUnitsLimit` branch retained as fallback for un-migrated plans. Image/token/skill fact chips byte-identical.
- `apps/web/app/app/packages/page.tsx` (`formatPackageLabel`): `video_generate` packages render `"N VC"` instead of `"N units"`. All other package types (image_generate, image_edit, document) byte-identical.
- Translation keys added to `en.json` and `ru.json`: `monthlyVideoVcRemaining`, `factVideosVc`, `factVideosVcWithApprox`.
- New test file `apps/web/app/app/packages/page.test.tsx` (5 cases). Updated `pricing-page-view.test.tsx` (+4 new `derivePlanFacts` VC cases). Updated `assistant-settings.test.tsx` (+2 new VC card cases, updated 1 existing assertion). PASS: `@persai/web run typecheck`; `@persai/api run typecheck`; `pnpm -r lint`; `format:check`; `vitest run` (637 tests, 64 files).

### Slice 7 - Quota status tool + runtime advisor

**Scope**

- `quota_status` tool for `video_generate` returns `{ kind: "vcoin", balance_vc, monthly_grant_vc }` instead of `{ remaining_units, limit_units }`.
- Runtime advisor copy: "remaining N VC; a typical video costs about K VC" derived from a rolling average of last 30 days of `billingFacts.durationSeconds` per workspace (or fallback platform average).
- No keyword routing.

**Scope OUT (forbidden in this slice)**

- `quota_status` shape for `image_generate` / `image_edit` / `tts` / `stt` — those keep the existing `{ remaining_units, limit_units }` shape.
- New tool-projection logic for `video_generate` (Slice 3 of ADR-109 will own that).
- Any changes in advisor copy outside `video_generate` context.

**Forbidden patterns**

- Pattern-matching user prompts to decide whether to call `quota_status` — model owns the decision via tool description.
- Hardcoding the "typical video cost" — must derive from workspace history or platform average.

**Required tests**

- Tool returns the VC shape for `video_generate`.
- Tool returns the unit shape for `image_generate` (unchanged).
- Advisor copy reads the workspace balance and renders correctly with empty history (falls back to platform average).

**Exit**

- Assistant can answer "how many videos can I make" honestly in VC terms.

---

**Status (2026-06-04): Completed.**

**Contract change** — `RuntimeMonthlyToolQuotaStatusToolRow` in `packages/runtime-contract/src/index.ts` converted from a flat interface to a discriminated union:
- `RuntimeMonthlyToolQuotaStatusToolRowUnits` (`kind: "units"`) for `image_generate`, `image_edit`, `document`. All prior fields preserved byte-identical. Optional `effectiveLimitUnits` carry-over added for backward compat.
- `RuntimeMonthlyToolQuotaStatusToolRowVcoin` (`kind: "vcoin"`) for `video_generate`. Fields: `balanceVc`, `monthlyGrantVc`, `typicalVideoCostVc`, `typicalVideoSeconds`, `typicalCostFromPlatformFallback`, `status: "ok" | "balance_exhausted"`.

**New service** — `apps/api/src/modules/workspace-management/application/vcoin/compute-typical-video-vcoin-cost.service.ts` (`ComputeTypicalVideoVcoinCostService`). Queries rolling 30-day arithmetic mean `durationSeconds` from `model_cost_ledger_events` via `$queryRaw`. Falls back to `TYPICAL_VIDEO_SECONDS_FALLBACK = 5` when no workspace history. Returns null typical cost when no active video catalog pricing. Uses BigInt ceil division (mirrors `compute-video-vcoin-cost.ts`).

**Producer** — `read-internal-runtime-quota-status.service.ts` gains three new injections (`WorkspaceVcoinBalanceRepository`, `ResolvePlatformRuntimeProviderSettingsService`, `ComputeTypicalVideoVcoinCostService`). `execute()` transforms the raw `AssistantMonthlyToolQuotaSnapshot` tools array: units tools get `kind: "units"`, `video_generate` gets the full `kind: "vcoin"` shape. Return type updated to `RuntimeAwareMonthlyToolQuotas`. `computeAdvisoryCandidates` narrows on `tool.kind !== "units"` to skip vcoin rows.

**Advisor copy** — `quota-grounded-limit-copy.service.ts::buildMonthlyToolCopy` has a new `video_generate` branch that returns vcoin-flavored messages: "You have N VC remaining. A typical video costs about K VC." / "Your video credits are exhausted. Top up to continue." The units path narrowed to `kind === "units"`.

**Typical cost** — derived from `avgSeconds × avgUsdPerSecond × vcoinExchangeRate` with BigInt ceil at VC step. Fallback: platform constant (5 s) when no workspace history. Null when no active video catalog rows.

**Fallback behavior** — all reads degrade gracefully; missing VC balance → 0; missing exchange rate → 20; failing typical cost service → null cost fields.

**Consumers narrowed**:
- `apps/api/src/modules/workspace-management/application/read-internal-runtime-quota-status.service.ts` — `computeAdvisoryCandidates` skips vcoin rows.
- `apps/api/src/modules/workspace-management/application/quota-grounded-limit-copy.service.ts` — `buildMonthlyToolCopy` narrows `kind === "units"` before accessing unit fields.
- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts` — excludes `kind === "vcoin"` rows before reading unit fields; accepts rows without `kind` for test-stub backward compat.
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts` — `isMonthlyToolQuotaStatusTool` validates both variants using `kind` discriminator.

**Verification PASS**:
- `corepack pnpm --filter @persai/api run pretypecheck` — PASS
- `corepack pnpm --filter @persai/api run typecheck` — PASS
- `corepack pnpm --filter @persai/web run typecheck` — PASS
- `corepack pnpm --filter @persai/runtime run typecheck` — PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
- `corepack pnpm -r --if-present run lint` — PASS
- `corepack pnpm run format:check` — PASS
- `corepack pnpm --filter @persai/api exec tsx test/read-internal-runtime-quota-status.service.test.ts` — PASS (6 new tests + 2 existing)
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-quota-status-tool.service.test.ts` — PASS (vcoin passthrough test added)
- `corepack pnpm --filter @persai/api run test` — PASS (full suite green)
- `corepack pnpm --filter @persai/runtime run test` — PASS (full suite green)

---

### Slice 8 - Full retirement of `videoGenerateMonthlyUnitsLimit`

**Status (2026-06-04): Completed (expanded scope).** The original Slice 8 was a docs-only migration playbook with the legacy unit field kept as rollback insurance. After the 2026-06-04 hotfix (`32ce5408`) the active video path is fully VC-priced and the legacy plan limit was already nominally inert for `video_generate`, but live admin saves on `agse-pro` proved that the field still re-enabled per-unit gating in `enqueue-runtime-deferred-media-job` whenever an operator (or an old persisted JSON row) set it back to a positive integer. To prevent that operator footgun and to leave a clean substrate for ADR-109 (HeyGen talking-avatar), the user (`Thursday, Jun 4, 2026, 2:37 AM`) directed a full retirement of the field instead of a soft deprecation. This expands Slice 8 from "playbook + deprecation" to "remove the field from every contract, projection, UI, and persisted JSON row" while keeping the runtime invariants intact.

**Scope**

- API types: drop `videoGenerateMonthlyUnitsLimit` from `WorkspaceQuotaPlan`, `AdminPlanInput.quotaLimits`, `AdminPlanState.quotaLimits`, `PlanQuotaHints`, and the `MONTHLY_TOOL_QUOTA_TOOLS` definition for `video_generate` (now `limitKey: null` because it is VC-priced and has no per-month unit counter).
- Projections: drop the field from `read-internal-runtime-quota-status.service.ts`, `resolve-plan-visibility.service.ts`, `quota-offers.ts`. `quota-grounded-limit-copy.service.ts` continues to render the vcoin branch added in Slice 7.
- Contracts: remove the field from `packages/runtime-contract/src/index.ts` (`RuntimeQuotaStatusVisiblePlanLimits`), `packages/contracts/openapi.yaml`, and the runtime API client validator in `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`. Regenerate the contract package.
- Web UI: remove the deprecated input row, `PlanDraft.videoGenerateMonthlyUnitsLimit`, the `NumericDraftField` union member, the `NUMERIC_DRAFT_RULES` entry, the `planToDraft` / `draftToPayload` mappings, and the dirty-state field from `apps/web/app/admin/plans/page.tsx`. Drop the legacy `else if` fallback in `derivePlanFacts` so the chip is sourced exclusively from `videoVcoinMonthlyGrant` (+ optional `videoVcoinApproxVideosPerMonth`). Update `app/admin/plans/page.test.tsx` and `app/_components/pricing-page-view.test.tsx`.
- DB cleanup migration `apps/api/prisma/migrations/20260604030000_adr108_drop_video_generate_monthly_units_limit/migration.sql`: strips `videoGenerateMonthlyUnitsLimit` from the `billing_provider_hints` JSONB column on `plan_catalog_plans` (top-level + nested `quotaAccounting`) for every row. Idempotent (`#-` no-op when the path is absent). No table or column drop — the field never had its own column, only a JSON path inside `billing_provider_hints`.
- Tests: `track-workspace-quota-usage` no longer reserves / settles / reconciles a unit counter for `video_generate`; the affected suites (`assistant-media-job-scheduler.service.test.ts`, `media-delivery-video-vcoin-settle.test.ts`, `media-delivery.service.test.ts`, `quota-accounting.test.ts`) now assert zero legacy-counter operations on the video path. Cross-suite fixtures (`manage-admin-plans`, `plan-visibility`, `quota-offers`, `read-internal-runtime-quota-status`, `runtime-quota-status-tool`, `turn-execution`, `manage-assistant-payment-intents`) had the field stripped.

**Forbidden patterns**

- Reading `videoGenerateMonthlyUnitsLimit` anywhere on the active path (it is gone from every type — there is nothing to read). The field is allowed only inside the cleanup migration's JSON-path strip.
- Re-introducing the legacy unit counter on the `video_generate` row in any quota-status projection. The vcoin variant landed in Slice 7 is the sole source of truth.
- Writing a `WorkspaceMediaPackageGrant` row for a `video_generate` package purchase — Slice 4 already inverted that to a wallet credit and that inversion stays.
- Touching image / image-edit / TTS / STT plan limits, projections, or settle paths.

**Required tests**

- `corepack pnpm --filter @persai/api run test` — full suite green; the four affected video tests assert the zero-counter behavior.
- `corepack pnpm --filter @persai/runtime run test` — full suite green; runtime-side fixtures no longer carry the deprecated field.
- `corepack pnpm --filter @persai/web exec vitest run` — full suite green; `pricing-page-view.test.tsx` exercises both VC branches (with approx, without approx) and the zero-grant case (no chip); `app/admin/plans/page.test.tsx` no longer contains the legacy field.
- `corepack pnpm --filter @persai/api run typecheck`, `--filter @persai/web run typecheck`, `--filter @persai/runtime run typecheck`.
- `corepack pnpm -r --if-present run lint`.
- `corepack pnpm run format:check`.

**Verification result (2026-06-04)**

- API typecheck: PASS.
- Web typecheck: PASS.
- Runtime typecheck: PASS.
- `pnpm -r --if-present run lint`: PASS.
- `pnpm run format:check`: PASS (after one prettier rewrite of `apps/web/app/_components/pricing-page-view.test.tsx`).
- `pnpm --filter @persai/api run test`: PASS (full suite, exit 0).
- `pnpm --filter @persai/runtime run test`: PASS (full suite, exit 0).
- `pnpm --filter @persai/web run test`: PASS (636 tests, all suites).

**Exit**

- The deprecated field is gone from every TypeScript type, contract, OpenAPI schema, projection, web UI, and test fixture on the active path.
- Existing `plan_catalog_plans.billing_provider_hints` JSON rows have their stale entries stripped on the next prisma migration apply (Dev Image Publish migration approval gate).
- `video_generate` enqueue + settle reads only `workspace_vcoin_balance` + the catalog row; no legacy unit counter is consulted.

### Slice 9 - Tests + docs + verification gate

**Scope**

- E2E test: enqueue + worker + delivery + VC debit on success across OpenAI, Runway, Kling.
- Negative E2E: image and TTS paths produce no VC debit.
- Update `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`.
- Cross-ref ADR-105, ADR-106, ADR-107 in all updated docs.
- Repo gates:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/provider-gateway run typecheck
```

**Exit**

- Docs and code agree.
- Full verification gate passes.
- ADR-109 (HeyGen) can start safely.

**Status: Completed (2026-06-04).** Live verification on dev cluster (`alex@agse.ru`):

- Kling kling-v2-6 5-second clip: `usdMicros=700000`, `vcDebited=14`, balance `999 → 985`. Matches catalog price `$0.14/s × 5 × 50,000 micros/VC = 14 VC` (rounded ceil).
- Package purchase via CloudPayments webhook: `vcCredited=200`, balance `0 → 200`.
- `/quota_status` LLM tool reports VC-shaped row for `video_generate` (skill-side observed: "Видео: 192 VC из доступных на месяц"); no legacy unit counter is referenced.
- Admin Plans UI no longer shows the legacy "monthly delivery-confirmed quotas" hint for the `video_generate` tool card (Slice 9 polish, 2026-06-04). Admin media-package preset cards and form labels surface `VC` for video and `units` for image/edit/document.

ADR-109 (HeyGen talking-avatar on Vcoin) is the next ADR in this lineage and is unblocked.

## Cross-slice invariants

1. VC applies only to `video_generate`. Image, TTS, STT, and other media keep per-unit quotas.
2. `model_cost_ledger_events` is unchanged in shape. `RuntimeBillingFacts` stays currency-neutral.
3. VC balance is a non-negative integer except for the one-shot negative balance permitted by the lifecycle rule.
4. Debit is transactional with the media job settle write so retries cannot double-debit.
5. The platform `vcoinExchangeRate` is the single source of truth. Per-plan or per-workspace course is forbidden.
6. Course is visible to the user only on plan cards and on the packages page (tooltip allowed for context).
7. Enqueue pre-check rejects `vcoin_balance_exhausted` when `balance <= 0`. Settle is the authoritative debit.
8. Failed jobs do not debit VC. USD COGS ledger may still record provider cost.
9. ADR-106 Slice 9 "media quota settlement unchanged" is superseded for `video_generate` only. Other media remains under Slice 9.
10. ~~Existing `videoGenerateMonthlyUnitsLimit` plan field stays present in schema for one release cycle as rollback insurance.~~ **Superseded by Slice 8 (2026-06-04):** the field is fully retired from every type, contract, projection, UI, and persisted JSON row. `video_generate` reads only `workspace_vcoin_balance` + the catalog row.

## Risks

- **Wallet accumulation without cap.** A long-inactive workspace may accumulate a large VC balance and burn it in a burst, producing a cost spike. Mitigation: review after 30 days of PROD; add a cap or anti-abuse threshold in a follow-up ADR if observed.
- **Course confusion.** Users may not understand "1 VC" without seeing dollars. Mitigation: tooltip and consistent plan-card / packages-page presentation.
- **Mixed economies in one workspace.** Video in VC, image in units. UX must be unambiguous. Mitigation: distinct sections in Assistant Settings, distinct labels.
- **USD COGS attribution drift.** If catalog rates change mid-period, the historical VC debit must remain stable. Mitigation: use the rate at `occurredAt` (same pattern as ADR-099 ledger).
- **Migration mismatch.** Admin may set `videoVcoinMonthlyGrant` that does not preserve effective per-plan generosity. Mitigation: hint "\u2248 N videos" in admin UI; one-release deprecation grace on `videoGenerateMonthlyUnitsLimit`.
- **Negative balance one-shot.** A user with low balance can squeeze one extra video. Acceptable trade-off vs settle-only complexity. Mitigation: enqueue pre-check requires `balance > 0`; advisor copy makes balance visible.
- **Refund semantics on partial delivery.** Existing partial-delivery logic settles 1 per delivered artifact and reconciles failed artifacts. For video, exactly one artifact is produced per job today (N=1), so partial cases do not occur in practice; explicitly forbid N>1 video jobs in the contract to avoid latent refund complexity.
- **Parallel program with ADR-102.** Two open programs require careful handoff discipline. Mitigation: each session names the active program, baseline SHA, and the slice it advances.

## Alternatives considered

### Replace per-unit quota everywhere (VC for all media)

Rejected. Image, TTS, STT pricing has different shape and stable per-unit semantics that users already understand. Expanding the migration surface multiplies risk without clear product benefit.

### Reuse `workspace_media_monthly_quota_counters` with `units` reinterpreted as micro-VC

Rejected. The counters table is tool-code-keyed and was designed for monthly reset and reservation lifecycle. Wallet semantics (accumulating, single negative shot allowed) do not match. A new table is cheaper than reinterpreting an existing one.

### Per-plan or per-workspace VC course

Rejected. A single platform course is simpler to reason about, simpler to display, and removes a class of admin error.

### Reserve-on-enqueue with refund-on-fail

Rejected. Adds complexity, especially because final video duration is sometimes unknown until provider completes. Settle-only matches today's per-unit lifecycle and is honest about the user not paying for failed work.

### Derive VC from USD ledger on render

Rejected. Forces a recomputation on every balance read and couples user-visible balance to internal ledger writes that may lag. A dedicated wallet table is faster, more honest, and easier to audit.

## Consequences

### Positive

- Talking-avatar (ADR-109) and any future variable-cost video provider can land on a wallet that already settles by duration.
- Operator margin is visible (USD COGS unchanged) and decoupled from user-facing presentation.
- Packages and subscription grants share a single wallet, so users see one balance instead of two parallel counters.
- Plan editor and pricing copy become honest about variable per-video cost.

### Negative

- Two economies coexist in one workspace (video in VC, image in units) for the foreseeable future.
- One release cycle of deprecation overhead on `videoGenerateMonthlyUnitsLimit`.
- Migration is manual; mistakes by admin produce visible-to-user effects.
- Two parallel ADR programs (102 and 108) require explicit handoff discipline.

## Acceptance checklist

- [x] `workspace_vc_balance` table exists and is wired into settle path.
- [x] `vcoinExchangeRate` is in `PlatformRuntimeProviderSettings`, default 20.
- [x] `videoVcoinMonthlyGrant` is on plan `billingProviderHints`.
- [x] `videoGenerateMonthlyUnitsLimit` is fully retired from every type / contract / projection / UI / persisted JSON row (Slice 8, 2026-06-04, expanded scope).
- [x] `media-delivery.service.ts` debits VC on successful `video_generate` settle.
- [x] Image / TTS / STT settle paths remain unchanged (test-proven).
- [x] Enqueue rejects `vcoin_balance_exhausted` when `balance <= 0` for `video_generate`.
- [x] Monthly grant credits idempotently on period boundary.
- [x] Successful `video_generate` package purchase credits VC instead of granting per-unit bonus.
- [x] Admin Plans UI shows "Monthly VC grant" with hint and course.
- [x] Settings shows "Remaining N VC" for `video_generate`.
- [x] Pricing page shows VC line on VC-enabled plans.
- [x] Packages page shows VC labels for video packages.
- [x] `quota_status` tool returns VC shape for `video_generate`.
- [x] Advisor copy reads workspace VC balance correctly.
- [x] Migration runbook exists and 5 production plans were walked.
- [x] ADR-106 Slice 9 supersession (video-only) noted in both ADRs.
- [x] ADR-107 closed as a program in its `## Program closure` section; deferred items listed; no further ADR-107 work scheduled and no enum cleanup performed.
- [x] `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md` updated.
- [x] Full verification gate PASS.
- [x] Pricing math correctness fix (2026-06-04): `time_metered` model-catalog `pricePerUnit` is treated as plain USD (scaled to micros via `MICROS_PER_USD`) in both VC compute and COGS ledger; tool-path catalog convention preserved via explicit `timeMeteredConvention` parameter. Live verification: Kling kling-v2-6 5s clip → 14 VC debited.
- [x] Slice 9 admin-UI polish (2026-06-04): admin Plans page renders VC-specific hint for `video_generate` ("VC wallet, per-second pricing") instead of legacy "monthly delivery-confirmed quotas" copy; admin media-package preset rows and form labels show `VC` for video and `units` for image/document.
