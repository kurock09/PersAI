# Test Plan

This document defines the current verification baseline for the active PersAI-native path.

ADR-072 is closed as the historical native migration ADR. Current continuation work should be checked against `docs/ADR/078-consolidated-follow-through-program.md`. `Step 15a` is cancelled and is not an active verification track.

## Required repo checks

Run these before calling a change clean:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Add focused tests for touched code paths when the change affects behavior.

## ADR-082 billing quota readiness focused checks

When a change touches Admin Runtime provider/model profiles, weighted token accounting, ADR-082 monthly media quota model code, or delivery-confirmed media settlement, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api run test:quota-accounting
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/runtime-provider-settings-admin.test.ts app/admin/knowledge/page.test.tsx app/admin/plans/page.test.tsx
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Admin Runtime provider/model profiles, not plan rows, own `inputTokenWeight`, `cachedInputTokenWeight`, and `outputTokenWeight`.
2. Older capability-list catalog JSON must normalize into typed model profiles without breaking existing settings.
3. API validation must reject invalid/negative weights before persistence.
4. Plan media model validation and admin model selectors must derive options from profile capabilities.
5. Weighted token accounting slices must use provider/runtime `usageAccounting.entries` first and mark estimator fallback explicitly.
6. Monthly media settlement must reserve before expensive media provider work, settle only after delivery succeeds, and release or mark reconciliation-required when provider/output work does not become user-visible delivery.
7. `image_generate`, `image_edit`, and `video_generate` must not use day-keyed tool counters as paid media quota truth.

For production slices that touch API contracts, runtime behavior, or shared control-plane seams, also run:

```bash
corepack pnpm run test
```

## ADR-083 subscription lifecycle focused checks

When a change touches plan lifecycle policy, subscription lifecycle state, trial fallback behavior, or Admin Plans lifecycle fields, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/admin-billing-lifecycle-settings.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/billing-lifecycle-notifications.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-workspace-subscription.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/plan-visibility.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/subscription-state-resolve.test.ts
corepack pnpm --filter @persai/api exec tsx test/workspace-subscription-lifecycle.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/plans/page.test.tsx app/admin/billing-settings/page.test.tsx
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Trial plans must carry an admin-selected fallback plan in `lifecyclePolicy.trialFallbackPlanCode`.
2. Plan writes must reject missing, inactive, self-referential, or otherwise invalid fallback references.
3. Admin Plans must make fallback selection visible next to trial duration and must not hard-code trial duration or fallback plan codes.
4. Plan visibility must preserve the effective trial fallback code so the lifecycle state machine can consume PersAI-owned plan truth.
5. New default-registration workspaces must materialize a `WorkspaceSubscription` with real trial/current-period boundaries when the default plan is a trial.
6. Expired trial fallback must read `lifecyclePolicy.trialFallbackPlanCode`, validate the fallback plan is active, persist the fallback state, and mark affected assistant materialization dirty.
7. Paid grace duration must come from persisted billing lifecycle settings, not code constants.
8. Failed renewal must enter `grace_period`, keep the paid plan effective, set explicit grace windows, and append `renewal_failed`/`grace_started`.
9. Grace expiry must apply plan-level `paidFallbackPlanCode` first, then global fallback, persist `expired_fallback`, and append `grace_expired`/`fallback_applied`.
10. Payment recovery must restore active paid state with provider/manual period truth and append `payment_recovered`.
11. Credits/token budget visibility, inbound enforcement, abuse quota-pressure, and admin quota-pressure surfaces must read the current `workspace_token_budget_period_counters` bucket for the effective subscription period, not stale compatibility token totals from a previous period.
12. Billing lifecycle notification schedules must come from persisted Billing Settings policy, with email required and assistant push optional.
13. Lifecycle events must create durable billing notification jobs instead of process-local timers; required email jobs stay pending until a real email adapter exists, and assistant push must reuse `assistant_notification_outbox` with required-facts static fallback copy.
14. Ops Cockpit user-directory rows should be billing-support rows: email, plan, lifecycle status, next relevant billing/trial/grace date, usage risk, and actions, not assistant setup trivia.
15. Ops Cockpit selected detail must expose PersAI-owned subscription truth, lifecycle events, notification jobs, quota period, and support identifiers without reading billing-provider state directly at request time.
16. Ops Cockpit support actions must run through lifecycle/subscription services rather than raw admin row mutation: extend trial updates trial windows, grant/extend grace preserves paid access logic, fallback now moves deterministically to configured fallback truth, manual reminder creates durable notification work, and the selected detail refreshes to the new lifecycle state after each action.

## ADR-084 payment-intent and provider-port focused checks

When a change touches PersAI payment intents, provider-neutral checkout session creation, or the authenticated billing-intent API, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/cloudpayments-constructor-billing-provider.adapter.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `POST /assistant/billing/payment-intents` must create PersAI-owned intent state before any provider checkout/session call.
2. Payment-intent creation must be idempotent per workspace and caller-supplied `idempotencyKey`; the same key with different plan/method/return-url shape must fail loudly.
3. Only active visible paid plans from the pricing source of truth may be purchased through this boundary.
4. This slice may start `new_purchase` and `upgrade`, but must not silently perform downgrade/cancel policy early.
5. The API response must stay provider-neutral and carry a normalized checkout mode (`embedded`, `redirect`, `payment_link`, `qr_code`, or current `manual_test`) rather than provider-specific UI assumptions.
6. Product/lifecycle truth must still wait for trusted server/provider confirmation; creating a payment intent or checkout session must not activate paid access by itself.
7. For the CloudPayments embedded constructor contour, checkout creation must fail loudly when the encrypted API Secret or public terminal id is not configured; it must not silently fall back to `manual_test`.

## ADR-084 web checkout and return-flow focused checks

When a change touches logged-in pricing checkout launch, manual/provider checkout handoff UI, or chat return-state banners, add focused web checks before broad verification:

```bash
corepack pnpm --filter @persai/web exec vitest run app/_components/pricing-page-view.test.tsx app/app/billing/checkout/[paymentIntentId]/page.test.tsx app/app/chat/page.test.tsx
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Logged-in pricing CTAs must create or reuse PersAI-owned payment intents through `POST /assistant/billing/payment-intents`; pricing cards must not synthesize provider checkout state client-side.
2. The web layer may launch `card` and `sbp_qr` starts, but must not activate paid access from checkout launch or return alone.
3. CloudPayments embedded checkout must mount from persisted payment-intent payload on `/app/billing/checkout/:paymentIntentId`, not from ad hoc client-side pricing state.
4. Manual/test and embedded checkout flows must return the user to chat with an explicit `success`, `failed`, or `pending` envelope so the UI can explain what happened without pretending lifecycle confirmation already landed.
5. Failure return UX must clearly preserve the old plan and provide a retry path back to pricing.

## ADR-084 webhook-to-lifecycle focused checks

When a change touches trusted billing-provider webhook ingestion, payment-intent terminal status mutation, or ADR-083 lifecycle application from provider outcomes, add focused API checks before broad verification:

```bash
corepack pnpm run prisma:generate
corepack pnpm run contracts:generate
corepack pnpm --filter @persai/api exec tsx test/admin-security.controller.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-billing-provider-credentials.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-cloudpayments-webhook.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Trusted provider outcomes must enter PersAI through a server-side webhook/controller boundary, not through chat return params or client-declared success.
2. Webhook verification must use the provider secret from PersAI-managed encrypted admin tools storage, not a second ad hoc config surface.
3. The webhook path must resolve constructor-originated payment intents from CloudPayments `externalId` and `metadata/data` as well as older `invoiceId` compatibility fields.
4. The webhook path must update `workspace_payment_intents` deterministically (`pending_confirmation`, `succeeded`, `failed`, `canceled`, `reversed`) before or alongside lifecycle application, with idempotent event refs for duplicate provider delivery.
5. Successful paid activation or renewal must flow through `ApplyWorkspaceSubscriptionBillingEventService` / ADR-083 lifecycle services, not mutate `workspace_subscriptions` directly from the controller.
6. Refund/reversal outcomes must apply immediate paid fallback through lifecycle truth rather than leaving the old paid state active.

## ADR-084 recurring billing and user-controls focused checks

When a change touches recurring-start checkout policy, provider-backed renewal/cancel lifecycle, recurring management APIs, or the `Limits & Plan -> Payment settings` UX, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/cloudpayments-constructor-billing-provider.adapter.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-cloudpayments-webhook.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-billing-subscription.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/apply-workspace-subscription-billing-event.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/workspace-subscription-lifecycle.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-quota-status-tool.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Payment-intent creation must distinguish `recurring_start` from honest `one_time` fallback; unsupported methods must surface that downgrade explicitly.
2. Provider-managed recurring ids are reconciliation inputs and must persist on PersAI subscription truth before later renewal/cancel events can reconcile correctly.
3. Trusted recurring provider events must flow through `workspace_subscription_billing_events` into ADR-083 lifecycle truth (`renewal_succeeded`, `renewal_failed`, `payment_recovered`, `subscription_cancel_scheduled`) instead of mutating subscription rows directly.
4. Disabling auto-renew must map to PersAI `cancelAtPeriodEnd` truth and preserve paid access until the stored current paid period ends.
5. Period-end fallback after cancellation must be lifecycle-owned and deterministic; UI/client state must not be the source of cancellation truth.
6. Product recurring controls must read server-truth recurring state from PersAI API, not from checkout completion heuristics or direct provider status reads in the browser.
7. `quota_status` checkout output must carry enough recurring metadata for the assistant to explain whether the selected method opens a recurring checkout or only a one-time fallback.

## ADR-084 immediate activation/materialization focused checks

When a change touches post-payment activation speed, assistant rematerialization after trusted success, or the billing-return truth refresh path, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/workspace-subscription-lifecycle.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/materialize-workspace-paid-activation.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/chat/page.test.tsx
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Trusted paid success must not stop at `workspace_subscriptions`; it must trigger immediate assistant rematerialization/warmup for published assistants in the workspace.
2. The next paid-sensitive turn must not rely on a later random refresh to pick up the new plan/runtime policy after a trusted success path.
3. Client return routing may trigger a reload of server truth, but it must not declare paid activation from client params alone.

## ADR-084 admin manual payment and Ops support focused checks

When a change touches `Admin > Ops` billing support actions, manual/admin paid activation, or latest paid-activation source visibility, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/manage-admin-ops-billing-support.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/ops/page.test.tsx
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Manual/admin payment must require an explicit paid plan and billing period instead of copying stale provider/fallback history implicitly.
2. The action must still write through PersAI lifecycle truth with `source=admin`, not through raw subscription row mutation or fake provider invoice state.
3. Ops Cockpit should show manual/admin paid activation as a visible source in current support detail, so operators can distinguish it from provider-driven billing events.

## Chat-length and plan quota UX focused checks

When a change touches plan quota fields such as internal active-web-chat admission or per-chat length policy, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/prepare-assistant-inbound-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/runtime test -- runtime-quota-status-tool.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/_components/pricing-page-view.test.tsx app/admin/ops/page.test.tsx app/admin/plans/page.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `messagesPerChat` must be plan-owned truth and enforce before the next user message is persisted into an existing chat.
2. `activeWebChatsLimit` remains an internal new-thread admission cap; user-facing pricing and chat UX must not market it as a tariff fact.
3. `0` on `messagesPerChat` and `activeWebChatsLimit` means unlimited, while blank/null preserves the existing default/fallback behavior where applicable.
4. Hitting the per-chat limit should surface a calm product-shaped UX that nudges the user toward a new chat or a paid plan, not a raw technical quota error.
5. Admin Ops quota presentation should emphasize compact monthly media limits/usage and not elevate active-web-chat count as a primary progress bar.

## ADR-084 pre-Slice-8 billing hardening focused checks

When a change touches payment-intent billing truth or provider billing-event application hardening ahead of the assistant billing tool, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/apply-workspace-subscription-billing-event.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. Trusted paid success must not fail only because `workspace_subscription` has not been initialized by an earlier read path.
2. User payment-intent creation must ignore tester/admin plan override state and resolve billing truth from the real workspace subscription or default-registration initialization path.
3. `Admin > Ops > Plan Control` must remain test-only and must not become billing truth indirectly through checkout logic.

## ADR-084 Slice 8 assistant quota-tool billing checks

When a change touches the existing assistant `quota_status` tool so it can explain plans or create checkout, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/read-internal-runtime-quota-status.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/create-internal-runtime-quota-checkout.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-quota-status-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
```

Interpretation rules:

1. `quota_status` must keep reporting quota truth while also exposing enough current/public plan context for the assistant to explain upgrades from the same existing tool surface.
2. Checkout creation must stay action-guarded (`confirmed=true` on the tool call), must not use lexical matching against raw user text, and must still go through a PersAI payment intent; the tool must not activate subscription state directly.
3. The assistant-facing result should return the existing `/app/billing/checkout/:paymentIntentId` entry plus an absolute checkout URL when public web origin config is available, not a second billing truth surface that bypasses product checkout state.

## ADR-079 grounded Skill/user-KB routing focused checks

When a change touches Skill routing, orchestrated retrieval context injection, model-role selection, or provider context-window failure mapping, add focused checks that prove:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/turn-routing.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/stream-native-web-chat-turn.service.test.ts
```

Interpretation rules:

1. A turn that combines selected Skills with user KB or current file context should not stay on `normal_reply`; it should route to at least `premium_reply` through configured model slots.
2. Users without enabled Skills and without grounded retrieval should keep existing normal/simple routing.
3. Retrieved context must be planned against `runtime.contextHydration.knowledgeHydrationBudget` rather than expanded until the provider rejects the request.
4. Provider context-window errors must surface as a distinct context-window class, not generic runtime unreachable.

## ADR-080 admin Knowledge authoring focused checks

When a change implements ADR-080 Skill knowledge cards, Product KB text entries, or assistant-assisted admin authoring, add focused checks for the touched area before broad verification:

```bash
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

If API/data-model behavior changes, also add focused service/controller tests that prove:

1. Skill knowledge cards can be created/edited/archived by an authorized admin and enqueue indexing only when active.
2. Product KB text entries can be created/edited/archived by an authorized admin and index through the existing ADR-079 pipeline.
3. Draft and archived authored entries are not used by runtime retrieval.
4. Assistant-assisted drafts never activate or overwrite saved admin knowledge without an explicit admin save/apply action.
5. Authored Knowledge entries remain Knowledge sources and do not become `AssistantFile` rows unless a separate Files action intentionally exports them.
6. The Skill authoring model is resolved from the admin Knowledge `authoringModelKey` policy slot and generated proposals remain draft-only.
7. Product KB baseline documents such as Product Overview and Product Principles are seeded/backfilled as active `ProductKnowledgeTextEntry` rows, are visible in Admin Knowledge, and are retrieved from Product KB entries/files rather than hard-coded runtime documents. Plan/tariff answers should still resolve from plan/subscription catalog state.

If the admin UI surfaces change, add focused web checks that prove:

```bash
corepack pnpm --filter @persai/web exec vitest run app/admin/knowledge/page.test.tsx app/admin/skills/page.test.tsx
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Product KB text entries live under Admin Knowledge and Skill knowledge cards live inside Admin Skills detail.
2. New authored entries are draft-first unless the admin explicitly selects `active`.
3. UI payload helpers preserve lifecycle/provenance truth and do not treat authored Knowledge entries as Files.
4. Reindex controls should be available only for active persisted authored entries.

## Voice DNA / persona-archetype focused checks

When a change touches Voice DNA archetypes, prompt-template V1 placeholders, setup/admin archetype selection, or published Voice DNA snapshotting, add the focused pack below before calling the slice clean:

```bash
corepack pnpm --filter @persai/api exec tsx test/voice-dna-modulator.test.ts
corepack pnpm --filter @persai/api exec tsx test/publish-assistant-draft.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. verify archetype localization resolves deterministically (`ru` when present, `en` fallback otherwise) and slider modulation stays conservative rather than rewriting the whole persona
2. verify forbidden openings are deduped and survive both archetype defaults and prompt-template interpolation
3. if setup/admin UI changes, verify the user-facing flow persists the real `archetypeKey` and the admin surface can still repair older `soul` templates to the V1 placeholder shape
4. if publish/materialize logic changes, verify live archetype rows are preferred and `snapshot_voice_dna` remains the deletion fallback instead of becoming a silent primary source
5. final V1-style closure still requires the live smoke pair on `persai-dev` (`emotional-long` and `chitchat-short`); do not mark the slice fully closed from local unit checks alone

## Step 20 files/sandbox/media focused checks

When a change touches the public `files` tool, sandbox execution, `AssistantFile` handling, admin prompt-tool vocabulary, `files.send` / `files.write_and_send` / internal media delivery, or shared channel media delivery, add the focused pack below before calling the slice clean:

```bash
corepack pnpm run prisma:generate
corepack pnpm --filter @persai/sandbox test
corepack pnpm --filter @persai/sandbox exec tsx test/sandbox.service.test.ts
corepack pnpm --filter @persai/sandbox run typecheck
corepack pnpm --filter @persai/runtime exec tsx test/native-tool-projection.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-tool-prompt-metadata.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/seed-tool-catalog.test.ts
corepack pnpm --filter @persai/api exec tsx test/runtime-tool-policy.test.ts
corepack pnpm --filter @persai/api exec tsx test/tool-catalog-activation.test.ts
corepack pnpm --filter @persai/api exec tsx test/prisma-assistant-plan-catalog.repository.test.ts
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/telegram-webhook-proxy.controller.test.ts
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. cover both public `files` semantics and the internal delivery/storage seams it now wraps; do not only prove one of them
2. cover both durable `fileRef` delivery and current-turn artifact delivery semantics; do not only prove one of them
3. if the public file tool surface changes, verify model-visible projection/prompt/runtime policy truth shows `files` rather than the legacy split public file tool names
4. if current-turn artifacts are reselected by `artifactId`, verify the final runtime artifact set keeps one authoritative copy with the latest metadata instead of double-counting or silently dropping overrides
5. if Telegram delivery logic changes, confirm the shared media-delivery seam receives the real channel target and preserves `caption` through the outbound adapter path
6. if sandbox input `fileRef` mounting changes, verify read-by-`fileRef` works without a duplicate output artifact and that unchanged mounted inputs are not re-persisted as fresh sandbox outputs
7. if the change touches the final user-visible delivery boundary, prove both sides of the handoff: web must persist returned runtime media through `MediaDeliveryService` and expose the resulting attachments on the assistant message, while Telegram must route media through the shared delivery seam and avoid a duplicate outbound upload after that seam already handled delivery
8. if `sandboxJobsPerDay` changes or becomes user-visible policy, verify the sandbox service blocks the request before execution starts, records a blocked job row, and returns a structured quota reason instead of failing generically later
9. if per-channel outbound byte caps change, verify the limit is applied to the final combined outbound artifact set for the turn, not only to one candidate artifact in isolation
10. if `maxCpuMsPerJob`, `maxMemoryBytesPerJob`, or `maxConcurrentProcesses` changes, verify the sandbox service enforces the limit against the full spawned process tree rather than only the root process, and confirm the resulting `SandboxJob.resourceUsage` captures the peak process/CPU/memory truth for the run that completed or was blocked
11. if admin/operator sandbox observability changes, verify `AdminOpsCockpit` exposes the effective sandbox policy plus recent `SandboxJob` truth together: active/remaining daily quota counters must match the effective plan policy, and recent jobs must surface blocked reasons plus persisted `resourceUsage` telemetry instead of raw opaque JSON
12. if sandbox same-turn continuity changes, verify a single native tool loop can complete `files.write -> shell/exec/files.read` or the equivalent internal seam against the same relative path without the second sandbox job starting from an empty workspace
13. if attachment/fileRef hydration changes, verify the model-facing attachment summaries expose stable `fileRef`s for current and prior attachments so `files.send` can resend an older file without relying on filename guessing alone
14. if assistant-level file registry storage changes, verify the Prisma migrations leave `assistant_files` as the only live file-registry truth, that current runtime lookup no longer depends on `sandbox_file_refs` fallback on the active path, and that any schema cleanup keeps operator/runtime code aligned with the canonical model
15. if sandbox file mounting or produced-file persistence changes, verify new public/runtime `fileRef`s come from `AssistantFile` ids, completed sandbox job polling returns those canonical ids on the real result path, sandbox mount resolution only accepts canonical assistant-file ids on the live path, and persisted `sourceToolCode` truth reflects the clean `files` execution model rather than sandbox-era split action names
16. if admin Prompt Constructor or model-visible tool vocabulary changes, verify the editable/admin-visible file-tool surface shows `files` rather than legacy split public file tool names and that direct admin metadata updates reject hidden legacy public file tool codes
17. if tool catalog or plan/runtime materialization changes around file tools, verify removed legacy public file tool codes are no longer active catalog truth, DB cleanup plus repository/API projection keep stale legacy rows from surfacing in `Admin Plans`, and runtime direct dispatch accepts `files` rather than the split public file tool names
18. if sandbox workspace lifecycle changes, verify one assistant can complete `write/edit -> separate later read` across separate sandbox jobs without remount-only turn state, verify edited files keep a stable `AssistantFile` id for the same relative path, and verify cold restore from `assistant_files` recreates the workspace after local session deletion without reviving removed legacy file-ref fallbacks
19. if assistant workspace coordination changes, verify one `assistantId + workspaceId` has only one active lease holder cluster-wide, a second same-workspace job stays queued until release instead of writing concurrently, a different workspace can still proceed in parallel, expired leases are reclaimable, and lease loss resets the local workspace back to canonical persisted `assistant_files` truth before the pod can keep mutating it
20. if sandbox internal file execution or admin sandbox observability changes, verify the active sandbox job/operator truth uses `files` for file operations rather than internal `read_file` / `write_file` / `edit_file` codes, and confirm `Admin > Ops` persisted file counts come from canonical `assistantFiles` rather than removed sandbox-era relations
21. if `files.send` changes, verify runtime no longer carries a separate `send_media_to_user` tool payload/service path and that send-by-`fileRef` plus current-turn `artifactId` delivery still resolve through the same canonical `files` execution result
22. if `files.write_and_send` changes or is introduced, verify one tool call persists the file, returns the canonical `fileRef`, emits the delivered artifact in the same result, and leaves model-facing guidance preferring that atomic path for “create and send in one turn” requests
23. if delivery-honesty protection changes, verify a completed turn that claims a file was sent but returns zero delivered artifacts is corrected explicitly instead of being stored as a confident false-success reply
24. if assistant workspace hydrate/reset changes, verify missing object-storage blobs do not crash the sandbox path: stale `assistant_files` rows must be removed from canonical truth, the local workspace must rebuild from the remaining accessible files, and the job must complete or fail structurally instead of taking down the pod
25. if `files.read` / `files.write` / `files.edit` or sandbox explicit mounts change, verify the normal canonical `files` path runs by hydrated workspace `relativePath` without redundant `mountedFileRefs`, and verify any remaining explicit mounted `fileRef` path is scoped to the same assistant/workspace and fails structurally after stale-row cleanup when the backing blob is missing
26. if `files.delete` or default `files.list` presentation changes, verify recursive directory delete works, root delete stays blocked, single-file delete returns the canonical deleted item, and the default list summary groups `workspace`, `uploads`, and `artifacts` without exposing raw service-noise paths unnecessarily

## ADR-081 Files authority focused checks

When a change implements ADR-081 canonical Files authority, add the focused API checks below before broad verification:

```bash
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/inbound-media.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. direct chat uploads and staged web uploads must create a chat attachment and canonical `AssistantFile` in the same logical flow, and returned attachment states must include `fileRef`
2. inbound channel media and delivered assistant attachments must also link to canonical `AssistantFile`; any generated-output model-contract changes still belong to ADR-081 Slice 2
3. Files API responses must expose `fileRef`, name/type/origin/date/size metadata, and download/update/delete actions without exposing `objectKey` as a normal selector

When a change implements ADR-081 generated/runtime output Files, add the focused runtime checks below before broad verification:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-tts-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-video-generate-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. generated image/edit/video/TTS outputs must have durable `fileRef` immediately when persisted
2. model-facing generated-output send semantics must use `fileRef`, not `artifactId`
3. API delivery must link chat attachments to existing generated `fileRef` when runtime supplies one

When a change implements ADR-081 runtime Files/Skill working-file behavior, add these focused runtime checks:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. prompt hydration must present uploaded/current chat attachments as working files with durable `fileRef`
2. `files.search/get/read/send` must operate over the unified assistant Files registry, including uploads, generated outputs, and sandbox outputs
3. `files.read`/`files.edit`/`files.delete` must mount resolved registry files into sandbox by required `fileRef`, not by storage path or object key
4. ambiguous query behavior must return clear candidate items with `fileRef`

When a change implements ADR-081 Assistant Settings Files UI or chat attachment projection, add these focused web checks:

```bash
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx app/app/_components/chat-message.test.tsx app/app/assistant-api-client.test.ts
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Assistant Settings must expose Files as an inline section, not a separate route
2. long file lists must stay scroll-bounded inside the section
3. Open/Download/Rename/Delete actions must use canonical `fileRef` APIs/routes and must not expose `objectKey` or raw storage paths
4. chat attachment cards must prefer the canonical Files route when `fileRef` exists

When a change implements ADR-081 final cleanup or contract hardening, add these checks:

```bash
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx app/app/_components/chat-message.test.tsx app/app/_components/image-lightbox.test.tsx app/app/assistant-api-client.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. product open/download links must use canonical `fileRef` routes, not `attachmentId` routes
2. assistant Files API/UI state must not expose `objectKey`, storage paths, raw sandbox paths, or checksum internals as user-facing selectors
3. any remaining `artifactId`, `objectKey`, or path usage must be internal storage/sandbox/runtime accounting, not model/product selector truth
4. API `assistant/files*` routes must be covered by `ClerkAuthMiddleware`; missing coverage appears in live logs as `401` with `userId:null` and controller text `Authenticated user context is missing`
5. chat attachments without canonical `fileRef` must not render fallback `<a href="#">` download links, because browsers can save the app shell as `chat.html`
6. full verification gate still applies before closing the slice

## Web stream latency-trace focused checks

When a change touches web SSE orchestration, replay wait behavior, pre-first-delta timing, or provider stream timing logs, add the focused pack below before calling the slice clean:

```bash
corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. verify API latency traces keep the same trace across `prepare_begin`, replay claim, prepared state, SSE `started`, runtime request, and first visible delta instead of starting only after the slow part already passed
2. verify completed/failed/interrupted runtime stream results can carry structured `trace` stages such as `prepare.*`, `provider_headers_received`, `first_provider_event`, and `first_text_delta`
3. verify provider-gateway stream logs include elapsed time to response headers or `failed-before-headers`, so live slow cases can be split between upstream-connect delay and token-generation delay
4. for any live slow-stream investigation, correlate `web_stream_timing` / `web_stream_timing_failed` from `api` with `[provider-gateway-stream]` lines from `runtime` by `requestId` before making claims about where the delay lives
5. for web-chat continuity changes, prove the ordinary first-send path still uses a single `POST /assistant/chat/web/stream` without a blocking preflight, while resume/switch paths can use `messages.activeTurn` plus `GET /assistant/chat/web/turns/:clientTurnId/stream` reattach

## Durable memory M1 focused checks

When a change touches durable assistant memory classification, the `core` / `contextual` split, the internal `runtime → api` memory hydration endpoint, the prompt-cache stable-block split between `durable_memory_core` and `durable_memory_contextual`, or the Memory Center class/kind labels, add the focused pack below before calling the slice clean:

```bash
corepack pnpm --filter @persai/api exec tsx test/hydrate-memory-for-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/write-assistant-memory.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/prompt-cache-stable-blocks.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. verify write-time classification matches the documented policy: `fact` / `preference` → `core`, `open_loop` → `contextual`, web-chat memory → `contextual`, Workspace Memory → `core`. Surprising rewrites of this policy must be justified in the slice handoff.
2. verify `MEMORY_CORE_HARD_CAP = 15` is enforced on the write path with oldest-demoted overflow, and that the cap is NOT exposed as a user-tunable setting (founder principle 1).
3. verify `HydrateMemoryForTurnService` returns the always-on core block plus a relevance-retrieved contextual tail in one call, deduplicates contextual hits against core ids, and bumps `last_used_at` on every hydrated entry — not only on contextual or only on core.
4. verify the runtime composes two distinct prompt blocks: `durable_memory_core` (always present when any core entries exist, byte-stable across turns) and `durable_memory_contextual` (per-turn relevance, omitted entirely when empty). Folding both back into one block silently breaks the cache invariant.
5. verify the prompt-cache invariant explicitly: rotating the contextual block content per turn must NOT change the stable token sequence emitted for `durable_memory_core` + `shared_compaction_summary`. This is the M1-vs-P1 contract.
6. final M1-style closure still requires the live smoke pair on `persai-dev` (`multi-session-continuity` and `chitchat-short`); do not mark the slice fully closed from local unit checks alone.

## Knowledge/admin focused checks

When a change touches the active knowledge plane, retrieval policy, or admin knowledge surfaces, the focused verification pack should include the relevant targeted tests:

```bash
corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/knowledge-indexing-job-worker.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-knowledge-sources.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-document-processing-settings.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/enabled-skills-prompt-materialization.test.ts
corepack pnpm --filter @persai/api exec tsx test/compile-prompt-constructor.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-skills.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-knowledge-sources.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-skills.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-authorization.test.ts
corepack pnpm --filter @persai/api exec tsx test/runtime-knowledge-access.test.ts
corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/shared-knowledge-platform-ownership-audit.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-routing.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/skills/page.test.tsx
corepack pnpm --filter @persai/web exec vitest run app/app/_components/activity-badge.test.tsx
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-skills-manager.test.ts app/app/setup/page.test.tsx
```

For shared admin-managed KB ownership changes, also verify:

1. selected active Skill retrieval searches by assigned/selected Skill ids and Skill source types, not by the consuming assistant workspace
2. Product KB/global retrieval reads active/ready platform rows for assistants from any workspace
3. assistant uploads, memory/chat, Files, and retrieval telemetry remain workspace-scoped
4. inactive or unassigned Skills do not contribute runtime context
5. admin Skill/Product/global KB uploads do not debit tenant workspace knowledge-storage quota
6. the post-migration audit SQL fails if shared KB tables, chunks, jobs, or vectors still have tenant workspace-owned leftovers

For runtime ordinary source priority changes (ADR-079 follow-up, 2026-05-04), also verify:

1. `turn-routing.service.test.ts` covers `personal_first` / `product_first` / `web_first` / `mixed_ambiguous` precheck outcomes plus an admin override via `Router Policy > productPriorityTerms` and the `not_applicable` path for trivial continuation turns
2. `orchestrate-runtime-retrieval.service.test.ts` covers staged ordinary retrieval ordering (`product_first` ranks Product KB above user KB, `personal_first` ranks user KB above Product KB, `web_first` records honest `ordinary_web_first` policy state for non-executed web grounding)
3. retrieval observability emits `policyState=ordinary_*` for non-Skill turns and `policyState=skill_only|escalated_to_*` for active-Skill turns
4. model-visible `knowledge_search` / `knowledge_fetch` source enums no longer include `preset` (runtime native-tool projection and API `read-assistant-knowledge.service` reject `preset` requests structurally)

## Helm / deploy truth checks

Validate rendered deploy truth:

```bash
helm lint infra/helm -f infra/helm/values.yaml
helm lint infra/helm -f infra/helm/values-dev.yaml
helm template persai infra/helm -f infra/helm/values.yaml > /dev/null
helm template persai-dev infra/helm -f infra/helm/values-dev.yaml > /dev/null
```

Expected active components:

- `api`
- `web`
- `runtime`
- `provider-gateway`
- `sandbox`

No rendered `openclaw*` workload, service, configmap, ingress, or secret wiring should remain in the active chart path.

## Live cluster checks

For `persai-dev`, verify:

```bash
kubectl -n persai-dev get deploy,svc,ingress,networkpolicy
kubectl -n persai-dev get pods -o wide
kubectl -n persai-dev get secret
kubectl get applications.argoproj.io -n argocd
```

Expected:

- only `api`, `web`, `runtime`, `provider-gateway`, and `sandbox` workloads are active
- ingress `bot.persai.dev` routes to `api`
- `persai-runtime-secrets` is the active native-runtime secret object
- no `openclaw*` resource remains in the active namespace

## Runtime path checks

Verify the active runtime path from the cluster:

```bash
kubectl -n persai-dev get deploy api -o yaml
kubectl -n persai-dev get deploy runtime -o yaml
kubectl -n persai-dev get deploy provider-gateway -o yaml
kubectl -n persai-dev get deploy sandbox -o yaml
```

Expected env truth:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_SANDBOX_BASE_URL=http://sandbox:3013`

## Final load-readiness follow-through

Core `Step 19` deploy/restart recovery and current `/admin` `System Overview` pod-truth are already observed on the active path. The remaining scale-oriented proof is the final bounded load-readiness follow-through, and it must not be treated as generic speed tuning only.

It should verify all of the following:

1. bounded load evidence demonstrates that the active native path is ready for production pressure rather than merely faster in one happy-path sample
2. the saved report preserves enough rollout/restart/admin context to reveal if the earlier deploy/operator closure regresses under pressure
3. if `/admin` `System Overview` truth or deploy/restart recovery looks weaker under load than in the earlier bounded rollout checks, that regression must be called out explicitly before the final step is considered closed

For the current bounded repo-local readiness pass, use the fixed-scale `SR10` ladder before any execution-side HPA work:

```bash
node scripts/loadtest/run-sr10.cjs --config scripts/loadtest/sr10.local.json --profile 100
node scripts/loadtest/run-sr10.cjs --config scripts/loadtest/sr10.local.json --profile 100,500,1000
```

Interpretation rules:

1. do not claim a safe ceiling above the highest profile with a saved JSON report in `artifacts/sr10-loadtest/`
2. the report must include phase summaries plus admin snapshots before/after phases so restart/degradation evidence is visible alongside latency/error gates
3. the next bottleneck must be written down explicitly after each ladder run, even if the run fails below `1000`
4. `runtime` and `provider-gateway` HPA must stay disabled in active Helm values until the fixed-2-replica path passes rollout/restart recovery and at least one bounded load ladder with honest bottleneck evidence

## User-path smoke

At minimum, prove:

1. API `/health` and `/ready` are healthy
2. authenticated `GET /api/v1/assistant/runtime/preflight` returns `live=true` and `ready=true`
3. ordinary `/app` web chat completes on the current native path
4. if validating Step 20, one real web turn can complete either `files.write_and_send` or the equivalent `files.write` -> `files.send` path over the assistant-file-backed sandbox path and produce a user-visible attachment without dropping the artifact at the final surface
5. the cluster has no active dependency on a removed legacy runtime service

## Historical traces

The following may still contain historical OpenClaw references without being treated as an active-path failure:

- `docs/ADR/*`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- old Prisma/SQL migrations

Everything else that presents current deploy/debug truth must match the PersAI-native path.
