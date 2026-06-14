# ADR-115: Inbound safety program — contour-1 heuristics and contour-2 async moderation

**Status:** Closed (program complete 2026-06-14; slices 115.0–115.7 + follow-through polish)  
**Date:** 2026-06-13  
**Relates to:** [ADR-044](044-abuse-and-rate-limit-enforcement-g2.md) (spam throttle — complementary, not replaced), [ADR-067](067-application-layer-security-hardening.md), [ADR-088](088-unified-notification-platform-control-plane-and-delivery.md) (ops alerts), [ADR-102](102-pre-prod-architectural-cleanup-and-truth-hardening.md) (slice discipline), [API-BOUNDARY.md](../API-BOUNDARY.md), [DATA-MODEL.md](../DATA-MODEL.md), [TEST-PLAN.md](../TEST-PLAN.md), [AGENTS.md](../../AGENTS.md)

## Context

PersAI needs platform safety controls that catch **serious misuse** of assistants and tools — not casual chat toxicity or profanity.

Founder intent (canonical):

1. **Contour 1 (sync):** deterministic heuristics + basic policy routing only for `safety`, `harmful content`, `flagged content`, and escalation to deeper review.
2. **Contour 2 (async):** OpenAI Moderation API plus optional thread-history review (10–20 recent messages) when contour 1 confidence is low or moderation flags content.
3. **User-wide enforcement:** if any assistant owned by a user triggers a confirmed safety block, **the entire user** is restricted across all assistants and surfaces.
4. **Primary targets:** extremism, terrorism, hacking/credential abuse, unsolicited porn/spam distribution — **not** interpersonal profanity or “chat moderation”.
5. **Ops:** block/unblock must be visible and actionable in admin; audit trail required.
6. **Reuse, don’t duplicate:** one inbound gate and one admin unblock seam; do **not** build a parallel “ban system” separate from existing ops patterns.

ADR-044 explicitly placed content moderation out of scope. This ADR closes that gap without collapsing spam throttle (ADR-044) into safety policy.

### Existing code truth (baseline)

| Area                   | Today                                                                                                   | Gap                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Inbound layer order    | `PrepareAssistantInboundTurnService` and `HandleInternalTelegramTurnService` run **quota before abuse** | Reorder to canonical **safety → abuse → quota** in slice **115.0** (PROD-correct from day one) |
| Spam / flood           | `EnforceAbuseRateLimitService` + `assistant_abuse_*` tables (ADR-044)                                   | Works; cleanup deferred (see Non-goals)                                                        |
| Quota                  | `EnforceAssistantCapabilityAndQuotaService`                                                             | Must stay separate                                                                             |
| Runtime routing        | `TurnRoutingService` (`precheckRuleOverrides`, term lists)                                              | Model/skills routing — **not** safety; do not reuse those lists                                |
| Content safety         | Provider policy errors on media tools (reactive)                                                        | No preventive inbound safety gate                                                              |
| Admin unblock          | `POST /api/v1/admin/abuse-controls/unblock`                                                             | Rate-limit scoped; no user-wide safety restriction model                                       |
| Admin safety policy UI | `/admin/runtime` (router/provider only); `/admin/ops` (user cockpit); `/admin/abuse` (spam)             | No contour-1 heuristic editor; no per-user safety restriction UX                               |
| User notice            | `rate_limited` / error-class UX                                                                         | Tone/copy deferred to a later slice                                                            |

## Non-goals

- Profanity / casual toxicity / “мат” lists.
- Full semantic moderation on every token or every short message in contour 1.
- Replacing or refactoring ADR-044 abuse tables in this program (**deferred follow-up**).
- Quota-pressure coupling inside abuse/restriction code (remove only in the deferred abuse cleanup).
- User-facing copy tone and localization polish (**in scope for inbound warn/restrict paths; outbound moderation not planned**).
- Appeal workflow, legal export beyond audit log.
- WhatsApp/MAX safety enforcement until those inbound paths are active (schema may reserve surfaces).
- Building a large open-source profanity dictionary.

## Decision

### D1 — Three independent inbound layers (never merge semantics)

| Layer                   | Purpose                             | Persistence                         | Scope                            |
| ----------------------- | ----------------------------------- | ----------------------------------- | -------------------------------- |
| Quota / entitlement     | plan limits, billing                | existing quota tables               | workspace / assistant resolution |
| Spam throttle (ADR-044) | request flood                       | `assistant_abuse_guard_states` etc. | assistant + user + surface       |
| **Safety restriction**  | harmful / illegal / platform misuse | **`user_restrictions`** (new)       | **user-wide**                    |

**Canonical PROD enforcement order** at API inbound boundaries (`PrepareAssistantInboundTurnService`, `HandleInternalTelegramTurnService`):

```
1. active user safety restriction?  → deny inbound (reason code only; copy deferred)
2. spam throttle (ADR-044)?         → deny inbound (unchanged policy in this program)
3. contour-1 safety precheck?       → route (allow | defer_c2 | block_obvious)  [slice 115.1+]
4. quota / capability               → existing
5. runtime turn
6. contour-2 async job (non-blocking by default)  [slice 115.2+]
```

**Inbound order correction (slice 115.0, not deferred):** both inbound services currently call quota before abuse. Slice **115.0** must land the full canonical prefix **`safety → abuse → quota`** in the same change set as the safety gate skeleton. Do not ship safety-first while leaving quota-before-abuse in place.

**Intentional semantic on reorder:** `EnforceAbuseRateLimitService.enforceAndRegisterAttempt` registers a distributed attempt even when quota would later deny the turn. That is desired PROD behavior — repeated quota-denied retries count toward flood protection instead of bypassing abuse counters. Document in tests; do not “optimize away” registration after quota.

### D2 — Contour 1: sync heuristics + policy routing

**Service:** `EvaluateInboundSafetyPrecheckService` (API control plane).

**Input:** `userId`, `assistantId`, `workspaceId`, `surface`, message text, attachment metadata (type/size/count), optional recent message hashes.

**Output:** `InboundSafetyPrecheckOutcome`:

| Field            | Type                                            | Notes                        |
| ---------------- | ----------------------------------------------- | ---------------------------- |
| `route`          | `allow` \| `defer_contour_2` \| `block_obvious` | `block_obvious` is rare      |
| `confidence`     | `none` \| `low` \| `medium` \| `high`           | drives routing               |
| `reasonCode`     | string                                          | machine-readable             |
| `rulePack`       | string \| null                                  | which heuristic pack matched |
| `matchedSignals` | string[]                                        | for audit; no PII in logs    |

**Rule packs (v1 intent, not profanity):**

| Pack                          | Examples                                                                 | Typical route                                        |
| ----------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `violence_extremism_explicit` | explicit terrorism / mass-violence instructions (RU+EN curated patterns) | `defer_c2` or `block_obvious` when confidence `high` |
| `hack_abuse_request`          | credential theft, unauthorized intrusion, malware distribution requests  | usually `defer_c2` (legit security questions exist)  |
| `unsolicited_adult_spam`      | mass porn link spam, “разошли порно”, flood of adult URLs                | `defer_c2`; `block_obvious` only on very high signal |
| `structural_abuse_signal`     | empty/link-only repeats, base64 noise, attachment anomaly                | `defer_c2`                                           |

**Routing rules (canonical):**

- `confidence: none` → `allow` (no contour-2 enqueue unless other signals).
- `confidence: low` \| `medium` → `defer_contour_2` (turn proceeds unless policy table says otherwise for a specific high-risk category).
- `confidence: high` + pack `violence_extremism_explicit` or provider-equivalent CSAM/violence class → **`hold_and_defer_contour_2_sync`** (short Moderation API timeout, default 500ms): do not start runtime until C2 returns or timeout → timeout defaults to `defer_contour_2` async (configurable).
- `block_obvious` → create **pending** restriction only after C2 confirms OR when rule pack is on an explicit allowlist for instant block (founder-configured; default empty in v1).

**Heuristic storage (canonical):**

| Layer            | Location                                      | Notes                                                                                                   |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **PROD truth**   | `safety_heuristic_rules` table                | pattern/regex, `pack`, `locale`, `weight`, `enabled`, audit timestamps                                  |
| **Baseline**     | versioned seed under `apps/api/prisma/`       | reproducible ~50–100 curated rules on migrate/deploy (same pattern as tool-catalog / bootstrap presets) |
| **Runtime read** | `EvaluateInboundSafetyPrecheckService`        | in-memory cache loaded from DB; reload on admin policy save                                             |
| **Admin edit**   | `/admin/runtime` → **Inbound safety** section | see **D5**; **not** ops, **not** abuse                                                                  |

**Explicit non-storage:**

- **Not** `platform_runtime_provider_settings.routerPolicy.precheckRuleOverrides` — skills/routing terms only.
- **Not** `TurnRoutingService` term lists.
- **Not** profanity dictionaries.

**Routing knobs** (sync C2 hold timeout, instant-block pack allowlist, contour-2 model id) live in `safety_policy_settings` singleton row or equivalent — same admin API + `/admin/runtime` section; **not** mixed into provider/router JSON blobs.

### D3 — Contour 2: async moderation + optional history review

**Trigger:** `defer_contour_2` from contour 1, OR Moderation API flagged on inbound/outbound text, OR admin manual review queue (future).

**Job:** `ProcessSafetyModerationReviewJob` (background worker in API; reuse scheduler patterns from media/document jobs where practical).

**Steps:**

1. Load trigger message + last **10–20** messages from the same chat thread (user + assistant text; strip system noise).
2. Call **OpenAI Moderation API** on trigger text; optionally batch thread excerpts.
3. Optional classifier pass (short JSON schema): `decision: allow | warn | block_user`, `categories[]`, `confidence`.
4. Persist **`moderation_cases`** row (append-only evidence): snapshot, scores, decision, `sourceAssistantId`, `chatId`, `surface`.
5. On `block_user` with sufficient confidence → upsert **`user_restrictions`** (active).
6. Emit admin realtime notification (`safety_user_restricted` — new admin_system event code) with user email.

**Default:** contour 2 does **not** retroactively delete an already-delivered assistant reply unless a separate outbound review flags it (v1: inbound-focused; outbound review enqueue is slice 115.4 optional).

### D4 — User-wide safety restriction

**Table:** `user_restrictions`

| Column                                        | Purpose                                                           |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `userId`                                      | PK / unique active row per kind                                   |
| `kind`                                        | `safety` (v1); reserve `spam_global` for future                   |
| `status`                                      | `active` \| `cleared`                                             |
| `blockedUntil`                                | null = until manual clear                                         |
| `reasonCode`                                  | e.g. `violence_extremism`, `unsolicited_adult_spam`, `hack_abuse` |
| `source`                                      | `moderation_auto` \| `admin`                                      |
| `sourceAssistantId`                           | triggering assistant                                              |
| `sourceModerationCaseId`                      | FK to case                                                        |
| `createdAt` / `clearedAt` / `clearedByUserId` | audit                                                             |

**Rule:** any active `safety` restriction on `userId` denies **all** inbound turns for that user (all assistants, all surfaces).

### D5 — Admin surfaces (split by concern; extend, don’t fork)

Three existing admin pages — **no fourth nav item** for v1. Do **not** bolt heuristic regex editing onto `/admin/ops` (already a large user cockpit) or `/admin/abuse` (ADR-044 spam only).

| Admin page           | Safety scope                                                                                                         | v1 UI                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **`/admin/runtime`** | **Platform policy** — contour-1 heuristic rules, routing knobs, optional C2 config display                           | New **Inbound safety** section (pack tabs, rule table, enable/disable, routing knobs)          |
| **`/admin/ops`**     | **Per-user incidents** — restriction badge, incident signal, unblock/restrict from user cockpit, link to source case | Thin layer on existing user directory + detail panel (no global cases browser, no rule editor) |
| **`/admin/abuse`**   | **Spam throttle only** (ADR-044)                                                                                     | Unchanged; operators must **not** use abuse unblock for `user_restrictions`                    |

**Auth:** same roles as abuse controls — `ops_admin` \| `security_admin` \| `super_admin`; permanent restrict / policy edit may require `super_admin` or step-up (match ADR-038).

#### D5a — Safety policy API (`/admin/runtime` backing)

| Endpoint                                          | Purpose                                                         |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/v1/admin/safety-policy/heuristic-rules` | list contour-1 rules (filter by pack/locale/enabled)            |
| `PUT /api/v1/admin/safety-policy/heuristic-rules` | bulk upsert rules from runtime admin save                       |
| `GET /api/v1/admin/safety-policy/settings`        | routing knobs + C2 display config                               |
| `PUT /api/v1/admin/safety-policy/settings`        | update knobs (sync hold timeout, instant-block allowlist, etc.) |

Implement via `ManageAdminSafetyPolicyService` + `AdminSafetyPolicyController`. Reuse save/validation patterns from `ManageAdminRuntimeProviderSettingsService`, but **separate** persistence from `platform_runtime_provider_settings`.

#### D5b — Safety controls API (`/admin/ops` backing)

| Endpoint                                         | Purpose                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `GET /api/v1/admin/safety-controls/restrictions` | list active user restrictions (ops global count + user drill-down)         |
| `GET /api/v1/admin/safety-controls/cases`        | fetch moderation case(s) by id or `userId` (not a full global queue in v1) |
| `POST /api/v1/admin/safety-controls/unblock`     | clear user `safety` restriction + audit                                    |
| `POST /api/v1/admin/safety-controls/restrict`    | manual restrict user (admin source)                                        |

Extend `ResolveAdminOpsCockpitService` / ops contracts with `safetyRestriction` summary + `incidentSignals` entry when active. Reuse patterns from `ManageAdminAbuseControlsService`; **do not** require abuse unblock for safety.

**Audit events:**

- `admin.safety_user_restricted`
- `admin.safety_user_unrestricted`
- `admin.safety_policy_updated`
- `safety.moderation_case_decided`

### D6 — User-visible notice (mechanism only; tone deferred)

On safety deny at inbound:

- Return a dedicated API error family (not `rate_limited`): `safety_restricted` with `details.reasonCode`.
- Persist optional assistant thread notice via existing chat message patterns (implementation in slice 115.3).
- **Copy/tone** is explicitly out of scope for this ADR; use placeholder English in tests.

### D7 — Relationship to ADR-044

- ADR-044 remains authoritative for **spam throttle** only.
- ADR-044 §quota-pressure in abuse repository is **obsolete**; remove only in the deferred abuse cleanup slice, not required for 115.0–115.4.
- Safety and spam checks are separate code paths in the inbound gate.

## Consequences

### Positive

- Clear separation: spam vs harmful-content policy vs quota.
- User-wide block matches operator mental model.
- Contour 1 stays cheap; contour 2 handles ambiguity.
- Split admin UX: runtime for policy tuning, ops for per-user restrict/unblock — no duplicate ban systems.

### Negative

- False positive on one assistant blocks entire user account.
- Moderation API cost + latency on deferred/sync paths.
- New tables, background jobs, and admin UI surface area.
- Policy tuning (rule packs, thresholds) is ongoing operational work.

## Alternatives considered

| Alternative                                                 | Verdict                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Reuse `assistant_abuse_guard_states` for safety blocks      | Rejected — mixes counters with semantic policy; wrong granularity (assistant vs user) |
| Only OpenAI Moderation, no contour 1                        | Rejected — no routing/throttle for obvious patterns; higher cost                      |
| Only contour 1 heuristics, no C2                            | Rejected — unacceptable false positive/negative tradeoff for hacking/extremism        |
| Per-assistant safety block                                  | Rejected — founder rule is user-wide                                                  |
| Block profanity via word lists                              | Rejected — explicit non-goal                                                          |
| Store C1 heuristics in `routerPolicy.precheckRuleOverrides` | Rejected — routing skills/terms, not safety semantics                                 |
| Single new `/admin/safety` page for everything              | Rejected — reuse runtime (policy) + ops (incidents); avoid nav sprawl                 |
| Full safety UI on `/admin/ops` (rules + cases + unblock)    | Rejected — ops cockpit already large; ops gets user-level actions only                |

## Agent execution program

**Rules for agents:**

1. One session = **one slice** below unless explicitly coupled in the slice spec.
2. Start from a **clean git tree**; record baseline SHA in `docs/SESSION-HANDOFF.md`.
3. Update `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md`, `CHANGELOG.md`, and this ADR slice row when behavior lands.
4. Run AGENTS.md verification gate before claiming clean.
5. **Do not** implement abuse refactor or user-facing copy tone unless the slice explicitly says so.

| Slice     | Title                                                        | Deploy                     | Depends             |
| --------- | ------------------------------------------------------------ | -------------------------- | ------------------- |
| **115.0** | Data model + inbound gate skeleton + canonical inbound order | DEPLOY REQUIRED (api)      | —                   |
| **115.1** | Contour 1 heuristics + routing + safety-policy API           | DEPLOY REQUIRED (api)      | 115.0               |
| **115.2** | Contour 2 async job + Moderation API                         | DEPLOY REQUIRED (api)      | 115.0               |
| **115.3** | User deny at inbound + reason codes                          | DEPLOY REQUIRED (api)      | 115.0, 115.2        |
| **115.4** | Safety controls API + Ops user-level UI                      | DEPLOY REQUIRED (api, web) | 115.0, 115.2        |
| **115.5** | Admin notifications + focused tests                          | DEPLOY REQUIRED (api)      | 115.2, 115.4        |
| **115.6** | Runtime inbound-safety policy UI                             | DEPLOY REQUIRED (web)      | 115.1               |
| **115.7** | User warn UX + strike escalation                             | DEPLOY REQUIRED (api, web) | 115.2, 115.3        |
| **—**     | Abuse cleanup (ADR-044 hygiene)                              | separate program           | **not part of 115** |
| **—**     | User notice tone/i18n                                        | separate program           | after 115.3         |

**Minimum path:** `115.0 → 115.1 → 115.2 → 115.3 → 115.4`. Slice **115.6** (runtime policy UI) ships after **115.1**; may trail **115.4** if ops unblock is higher priority than live rule editing.

---

### Slice 115.0 — Data model + inbound gate skeleton + canonical inbound order

**Purpose:** Introduce `user_restrictions` and `moderation_cases`; wire read-only safety gate; **reorder inbound to canonical `safety → abuse → quota`** in both web prepare and telegram paths. No heuristics or Moderation yet.

**Likely files/modules:**

- `apps/api/prisma/schema.prisma` + migration
- `apps/api/src/modules/workspace-management/domain/` (entities + repositories)
- `apps/api/src/modules/workspace-management/application/enforce-inbound-safety-gate.service.ts` (new)
- `prepare-assistant-inbound-turn.service.ts`, `handle-internal-telegram-turn.service.ts`

**Acceptance:**

- Inbound order in both services: **safety gate → abuse throttle → quota** (before any runtime work).
- Active `user_restrictions` row blocks inbound with `safety_restricted` before abuse/quota/runtime.
- Empty `user_restrictions`: no safety deny; abuse-before-quota reorder is the only other behavior delta (intentional).
- Tests: gate unit; prepare integration stub asserting call order; focused test that quota-denied path still registers abuse attempt when abuse surface applies.

---

### Slice 115.1 — Contour 1 heuristics + routing + safety-policy API

**Purpose:** `safety_heuristic_rules` + `safety_policy_settings`; seed baseline rules; `EvaluateInboundSafetyPrecheckService`; admin safety-policy API (no web UI yet — seed + API suffice until 115.6).

**Likely files:**

- `evaluate-inbound-safety-precheck.service.ts`
- `safety-heuristic-rule.repository.ts` + Prisma migration (if not created in 115.0)
- `apps/api/prisma/` seed for v1 rule packs
- `manage-admin-safety-policy.service.ts`, `admin-safety-policy.controller.ts`
- enqueue hook to contour-2 job on `defer_contour_2`

**Acceptance:**

- Pack fixtures in tests (violence explicit, hack abuse, adult spam, structural).
- `low`/`medium` confidence never auto-creates `user_restrictions` without C2.
- No profanity packs in seed data.
- Policy API reads/writes DB truth; precheck service reloads from DB (not from `routerPolicy`).

---

### Slice 115.2 — Contour 2 async job + Moderation API

**Purpose:** Background review with 10–20 message thread window; persist `moderation_cases`; auto `user_restrictions` on `block_user`.

**Likely files:**

- `process-safety-moderation-review.service.ts`
- scheduler registration (workspace-management module)
- OpenAI Moderation client in provider-gateway or API (follow existing provider boundary patterns)

**Acceptance:**

- Idempotent job per trigger key.
- Case row contains snapshot + decision.
- User-wide restriction created on block decision.
- Config: `SAFETY_MODERATION_*` env keys documented in `packages/config`.

---

### Slice 115.3 — User deny at inbound + reason codes

**Purpose:** Wire contour-1 `hold_and_defer_contour_2_sync` path; unified `safety_restricted` error; optional assistant thread notice stub.

**Acceptance:**

- Distinct from `rate_limited` in API error filter + web client mapping.
- Placeholder message only (tone slice deferred).

---

### Slice 115.4 — Safety controls API + Ops user-level UI

**Purpose:** Per-user safety ops on existing **`/admin/ops`** cockpit — **not** a new page, **not** heuristic editing.

**Likely files:**

- `admin-safety-controls.controller.ts`, `manage-admin-safety-controls.service.ts`
- `resolve-admin-ops-cockpit.service.ts` + `@persai/contracts` ops types (`safetyRestriction`, incident signal)
- `apps/web/app/admin/ops/page.tsx` — badge on user row, restriction panel, unblock/restrict actions, case id link

**Acceptance:**

- User directory shows `safety_restricted` when active `user_restrictions` row exists.
- User detail panel: `reasonCode`, `source`, `sourceAssistantId`, `sourceModerationCaseId`, unblock CTA.
- `security_admin` can unblock; permanent restrict requires `super_admin` or step-up (match ADR-038).
- Audit events appended.
- **Out of scope:** global moderation-case queue, contour-1 rule editor (→ 115.6 on runtime).

---

### Slice 115.6 — Runtime inbound-safety policy UI

**Purpose:** **Inbound safety** section on existing **`/admin/runtime`** — manage contour-1 rules and routing knobs via safety-policy API.

**Likely files:**

- `apps/web/app/admin/runtime/page.tsx` — new section (pack tabs, rule table, settings form)
- `apps/web/app/app/assistant-api-client.ts` — safety-policy client helpers

**Acceptance:**

- List/edit/disable heuristic rules by pack; save round-trips to `safety_heuristic_rules`.
- Routing knobs (sync C2 hold timeout, instant-block allowlist) editable separately from router `precheckRuleOverrides`.
- Visual separation from router term lists (distinct section heading + copy).
- No user restriction or case management on this page (→ ops 115.4).

---

### Slice 115.5 — Admin notifications + test hardening

**Purpose:** `safety_user_restricted` admin_system notification; expand `TEST-PLAN.md`; end-to-end focused tests.

**Acceptance:**

- Notification includes user email (per ADR admin notification user-label pattern).
- CI focused tests for gate + job + admin unblock.

---

### Slice 115.7 — User warn UX + strike escalation (PROD)

**Purpose:** Make contour-2 `warn` user-visible and operationally meaningful: pack-aware moderation thresholds, rolling strike window, system thread notice, and repeat-offense block before runtime.

**Policy (canonical):**

| Pack / class                                                              | First incident                    | Repeat within strike window                        |
| ------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| `violence_extremism_explicit`, `sexual/minors`                            | Block (sync hold or immediate)    | Block                                              |
| `hack_abuse_request`, `structural_abuse_signal`, `unsolicited_adult_spam` | **Warn** (no `user_restrictions`) | Block at inbound (sync review)                     |
| Other deferred medium/high                                                | Warn when below block threshold   | Block when prior warn exists for same `reasonCode` |

**Strike truth:** count `moderation_cases` with `decision = warn` for `userId + reasonCode` in rolling window (`SAFETY_MODERATION_STRIKE_WINDOW_DAYS`, default 30). Second qualifying incident escalates to `block_user` + `user_restrictions`.

**User UX:**

- System chat message: `author: system`, `metadata.kind: safety_inbound_warn`, localized web render (amber notice + support CTA).
- Restrict path unchanged (`safety_restricted` banner + `safety_inbound_restricted` notice).

**Config:**

- `SAFETY_MODERATION_WARN_SCORE_THRESHOLD` (default 0.5)
- `SAFETY_MODERATION_WARN_FIRST_BLOCK_SCORE_THRESHOLD` (default 0.92 for warn-first packs)
- `SAFETY_MODERATION_STRIKE_WINDOW_DAYS` (default 30)

**Acceptance:**

- Hack/structural flagged below 0.92 → `warn` case, thread notice, chat still works.
- Prior warn + same `reasonCode` → inbound deny before user message on repeat.
- Violence / minors → block without warn.
- Web history exposes `platformNotice` on messages API.

---

## Verification (all slices)

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck   # when web touched
```

Focused tests per slice as listed in `TEST-PLAN.md` § ADR-115 (to be added in slice 115.0).

## References

- OpenAI Moderation API (contour 2 provider)
- ADR-044 post-acceptance quota-pressure note — **superseded for new work**; removal deferred
- Runtime `TurnRoutingService` — **do not import** for safety heuristics

## Execution ledger

| Slice | Status   | Baseline SHA | Notes                                                     |
| ----- | -------- | ------------ | --------------------------------------------------------- |
| 115.0 | complete | `aa0d69fb`   | schema + read-only gate + inbound order                   |
| 115.1 | complete | `aa0d69fb`   | contour-1 precheck + policy API + C2 enqueue stub         |
| 115.2 | complete | `aa0d69fb`   | contour-2 worker + Moderation API + cases + auto restrict |
| 115.3 | complete | `e797a172`   | sync hold + safety_restricted deny + web mapping          |
| 115.4 | complete | `e797a172`   | safety controls API + ops UI                              |
| 115.5 | complete | `c36208e4`   | safety_user_restricted admin_system + user email labels   |
| 115.6 | complete | `e797a172`   | runtime inbound-safety policy UI                          |
| 115.7 | complete | `a35d17c3`   | warn UX, strikes, pack thresholds, platformNotice         |

## Program closure (2026-06-14)

All core slices shipped. Follow-through polish (not new slice numbers):

| Item                                         | Status          | Baseline SHA | Notes                                                           |
| -------------------------------------------- | --------------- | ------------ | --------------------------------------------------------------- |
| Warn banner above composer (web)             | complete        | `989fc2b8`   | Matches restrict-banner layout; no in-thread card               |
| TG warn in-chat + restrict i18n              | complete        | `989fc2b8`   | `DeliverSafetyInboundWarnNoticeService`; `reasonCode` copy      |
| Admin `safety_user_restricted` notifications | complete        | `989fc2b8`   | Slice 115.5 follow-through                                      |
| Sidebar safety standing icons + modal        | complete        | `4f72286e`   | `userSafety` bootstrap; warn/block affordance on assistant card |
| Warn copy chat-context framing               | complete        | `4f72286e`   | Web/TG/sidebar text references prior messages in thread         |
| Outbound message moderation                  | **not planned** | —            | Explicitly out of program scope                                 |

**Residual / ops:** live validation on dev after deploy; strike window remains config (`SAFETY_MODERATION_STRIKE_WINDOW_DAYS`, default 30).
