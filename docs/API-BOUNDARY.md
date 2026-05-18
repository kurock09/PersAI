# API Boundary

This document describes the current active PersAI request boundaries.

For exact request and response schemas, use `packages/contracts/openapi.yaml` and the generated client/types in `packages/contracts/src/generated`.

ADR-072 is closed as the historical native migration ADR. ADR-078 is completed as the consolidated follow-through program. ADR-080 defines admin-controlled Knowledge authoring and Skill curation. ADR-081 defines unified user Files. ADR-087 defines unified quota advisories and paid light mode. ADR-088 defines the unified notification platform, control plane, and delivery architecture. ADR-092 defines the active billing contract for split payment-method truth on `GET /api/v1/assistant/billing/subscription` (last payment vs auto-renew), explicit provider-confirmed SBP recurring migration semantics, synchronized provider recurring descriptions, payment-success notification + receipt-link policy, and acceptance that billing notification intents remain queryable via `Admin > Notifications` delivery history APIs.

## Public product APIs

Primary public API surface:

- web and admin routes through `apps/api`
- authenticated assistant routes under `/api/v1/assistant/*`
- Voice DNA assistant read route: `GET /api/v1/assistant/persona-archetypes`
- admin routes under `/api/v1/admin/*`
- Voice DNA admin routes: `GET /api/v1/admin/persona-archetypes`, `PATCH /api/v1/admin/persona-archetypes/:key`, `POST /api/v1/admin/persona-archetypes/:key/reset-to-default`
- admin knowledge routes under `/api/v1/admin/knowledge-sources*`
- admin Skill routes under `/api/v1/admin/skills*`
- future ADR-080 admin authoring routes for Skill knowledge cards, Skill draft enrichment, and Product KB text entries stay under `/api/v1/admin/skills*` and `/api/v1/admin/knowledge-sources*`
- admin document-processing provider settings under `/api/v1/admin/tools/document-processing*`
- admin billing-provider credential settings under `/api/v1/admin/tools/billing`
- admin tool-credentials store under `/api/v1/admin/runtime/tool-credentials` is the canonical operator-owned secret backbone for provider/notification credentials. ADR-088 Slice 2.5 moved the Postmark Server Token and Postmark webhook HMAC token here; they are stored under the credential ids `notification/email/postmark/api-key` and `notification/email/postmark/webhook-token` (declared in `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts` as `NOTIFICATION_CREDENTIAL_IDS`). `EmailChannelAdapter` and `HandlePostmarkWebhookService` resolve these values exclusively through `PlatformRuntimeProviderSecretStoreService`. `process.env`-based fallbacks for Postmark (or any new notification provider credential) are forbidden in source — the `Admin > Tools > Notifications` UI is the single edit surface, and Helm `secretEnv` slots for these values must not be reintroduced.
- admin runtime-provider settings expose both the legacy chat-model alias `availableModelsByProvider` and the quota-weighted `availableModelCatalogByProvider`. The catalog is provider-owned `models[]` profile rows with capabilities (`chat`, `image`, `video`) plus token quota weights (`inputTokenWeight`, `cachedInputTokenWeight`, `outputTokenWeight`). Plan admin payloads may select `primaryModelKey`, `imageGenerateModelKey`, `imageGenerateFallbackModelKey`, `imageEditModelKey`, `imageEditFallbackModelKey`, `videoGenerateModelKey`, and `videoGenerateFallbackModelKey`; media model keys are validated against profile capabilities during plan writes and materialized into runtime tool credential refs with optional fallback chains. Plans also expose monthly media unit limits for `image_generate`, `image_edit`, and `video_generate`, plus `messagesPerChat` as the per-chat conversation-length policy field. `activeWebChatsLimit` remains an internal technical cap on concurrent web threads; `0` means unlimited, and user-facing pricing/facts should not market that field directly. API quota services resolve media usage from subscription-period media counters, not daily tool counters. ADR-083 plan lifecycle policy is also plan-owned: trial plans expose `lifecyclePolicy.trialFallbackPlanCode`, paid plans may expose `lifecyclePolicy.paidFallbackPlanCode`, and plan writes reject missing, self-referential, or inactive fallback references. ADR-084 Slice 2 pricing-card groundwork is now plan-owned too: `Admin > Plans` payloads include a `presentation` block (`showOnPricingPage`, `displayOrder`, localized `title/subtitle/notes/badge/ctaLabel`, structured `price`, and localized feature bullets) so public pricing surfaces can be rendered from admin-managed plan truth rather than a separate marketing config. User plan visibility also exposes the effective plan's same structured `price`, allowing UI to classify zero-price access by `amount === 0` instead of lifecycle status. The public pricing-read boundary is `GET /api/v1/public/plans/pricing`: no auth, active visible plans only, ordered by `displayOrder`, and intentionally limited to card-safe plan truth (`presentation`, quota highlights, trial/default flags, and core entitlements/skill policy) so guest and signed-in pricing pages can share the same source. ADR-084 Slice 3 adds authenticated user billing-intent boundaries: `POST /api/v1/assistant/billing/payment-intents` creates or reuses a PersAI-owned payment intent for a visible paid plan using a caller-supplied `idempotencyKey`, persists the selected plan/payment method/return URL before any provider call, and returns a provider-neutral checkout payload (`embedded`, `redirect`, `payment_link`, `qr_code`, or `manual_test`). Payment-intent state now also carries recurring checkout truth (`one_time` vs `recurring_start`) plus whether the selected method is really recurring-capable in the active contour. `GET /api/v1/assistant/billing/payment-intents/:paymentIntentId` reads that persisted state back for the same user/workspace. `GET /api/v1/assistant/billing/subscription` returns user-visible recurring management state (plan, status, auto-renew, next charge/access-until, payment method label, provider-managed URLs), and `POST /api/v1/assistant/billing/subscription/disable-auto-renew` schedules provider-backed cancellation through PersAI lifecycle truth instead of direct client/provider UI logic. ADR-084 Slice 5 adds two more active billing boundaries: `GET/PUT /api/v1/admin/tools/billing` now owns PersAI-managed encrypted CloudPayments credentials, and `POST /api/v1/public/billing/cloudpayments/webhooks/:notificationType` is the trusted provider ingress that verifies HMAC over the raw request body, resolves the PersAI payment intent / subscription subject, updates `workspace_payment_intents`, and then applies ADR-083 lifecycle events from that trusted signal rather than from client return state. Trusted recurring lifecycle now includes `recurrent` renewal success/recovery, renewal failure, and provider cancel events; period-end cancellation falls back through ADR-083 `cancelAtPeriodEnd` truth instead of an ad hoc UI flag. `GET/PUT /api/v1/admin/billing/lifecycle-settings` owns persisted `gracePeriodDays`, global fallback plan policy, and billing lifecycle notification policy. Effective subscription resolution materializes missing workspace subscriptions from the default registration plan, assigns real trial/current-period boundaries for trial registrations, keeps paid plans effective during `grace_period`, applies expired-trial, grace-expired, and canceled-period-end fallback through configured active fallback plans, records append-only lifecycle events, and derives durable billing notification work from those events. Email lifecycle notification work is required and persisted as billing notification jobs; optional assistant push/Telegram uses the existing assistant notification outbox. `GET /api/v1/admin/ops/users` and `GET /api/v1/admin/ops/cockpit` expose billing support projections from PersAI-owned subscription, quota, lifecycle-event, notification-job, and latest paid-activation source state; the ops quota projection now includes compact per-tool monthly media usage instead of presenting `activeWebChatsLimit` as a primary user-support quota bar. `POST /api/v1/admin/ops/users/:userId/billing-support-action` now includes explicit manual/admin paid activation (`manualPayment.planCode` + `manualPayment.billingPeriod`) alongside extend trial, grant/extend grace, manual reminder, and fallback actions, and the refreshed Ops detail continues to read PersAI-owned truth rather than request-time provider state or fake provider invoices.
- single-batch web bootstrap: `GET /api/v1/app/bootstrap` — bearer-protected, fans out to assistant lifecycle, web chats, telegram integration, notification preference, user plan visibility, and admin plan visibility via `Promise.allSettled`; each section is `{ ok: true, data } | { ok: false, error }` so partial failures don't block the rest. Called once during SSR by `apps/web/app/app/layout.tsx`; mutations still use the per-endpoint refresh paths
- Telegram webhook under `/telegram-webhook/*`

### Avatar pipeline

- upload (public): `POST /api/v1/assistant/avatar` — bearer, multipart; returns `{ avatarUrl: "/api/avatar/<hash>.<ext>" }` where `<hash>` is a 16-char SHA-256 prefix of the bytes
- read (internal): `GET /api/v1/assistant/avatar/:hash` — bearer-only, called server-side by the `apps/web` BFF route handler; validates `:hash` against the assistant's current `draftAvatarUrl` and returns 404 on mismatch (no stale-content leak)
- web BFF (cookie-auth): `apps/web/app/api/avatar/[hash]/route.ts` — Clerk cookie session → server-side `auth().getToken()` → upstream fetch → streams bytes with `Cache-Control: private, max-age=31536000, immutable` and `ETag: "<hash>"`. Browsers/CDNs cache by URL, so a new upload (new hash → new URL) is automatically cache-busted.
- lifecycle envelope: `assistant.draft.avatarUrl` and `assistant.published.avatarUrl` always emit the content-addressed form `/api/avatar/<hash>.<ext>`. Legacy absolute URLs persisted in dev databases are sanitised to `null` so the UI falls back to the emoji avatar until re-uploaded — no transitional dual-mode shape.

## Runtime-related boundaries

### Runtime preflight

- public API route: `GET /api/v1/assistant/runtime/preflight`
- owner: `apps/api`
- current behavior: checks PersAI-native runtime `/health` and `/ready` through `PERSAI_RUNTIME_BASE_URL`

### Web chat

- sync route: `POST /api/v1/assistant/chat/web`
- stream route: `POST /api/v1/assistant/chat/web/stream`
- stream reattach route: `GET /api/v1/assistant/chat/web/turns/:clientTurnId/stream`
- hard-stop route: `POST /api/v1/assistant/chat/web/stop` (body: `{ "clientTurnId": string }`, response: 204)
- turn-status route: `GET /api/v1/assistant/chat/web/turns/:clientTurnId` returns the durable logical-turn state (`unknown`, `accepted`, `running`, `completed`, `failed`, `interrupted`) plus committed user/assistant payloads where available; web/Capacitor clients use it before retrying ambiguous sends
- accepted generated-media requests on the web sync/stream routes may now complete quickly with an acknowledgement assistant message plus a durable `assistant_media_jobs` enqueue, instead of holding the request open until final artifact delivery
- web chat list/bootstrap rows expose compact `activeTurn` state plus optional `activeMediaJobs`, and `GET /api/v1/assistant/chats/web/:chatId/messages` returns committed history plus full `activeTurn` plus optional `activeMediaJobs`; clients render this server projection as continuity truth before falling back to local recovery hints
- `activeMediaJobs` is the ADR-086 continuity projection for open generated-media jobs (`queued`, `running`, `completion_pending`) backed by durable `assistant_media_jobs` state.
- web compaction-state routes (`GET /api/v1/assistant/chats/web/:chatId/compaction`, `POST /api/v1/assistant/chats/web/:chatId/compact`) read the current materialized runtime-bundle compaction config together with persisted session/compaction metadata; the config read must tolerate both the materialized runtime-bundle object and the persisted JSON-document form so banner/advisory state does not degrade when bundle storage shape varies
- ADR-087 adds a second user-visible quota path after successful turns: when an in-scope finite limit reaches the advisory threshold, API may append one assistant-authored follow-up message in the same active web chat thread. This is quota/advisory behavior, not a generic transport error banner.
- API now also has internal runtime seams `POST /api/v1/internal/runtime/media-jobs/run` and `POST /api/v1/internal/runtime/media-jobs/complete`, used only by the backend media-job worker/delivery path. The first runs a synthetic tool-enabled media job outside the live user chat and returns assistant text plus produced artifacts; the second accepts the durable job id plus current API-built chat history context and returns optional bounded final framing text before backend-owned delivery.
- current active mode: native-only
- `apps/api` owns canonical message persistence, replay semantics, quota/media bookkeeping, and user-facing response shaping. Completed native turns should pass runtime `usageAccounting.entries` into API quota recording; API resolves Admin Runtime provider/model weights and persists one weighted Credits delta, using the text estimator only as an explicit fallback when runtime usage is absent. Subscription-period monthly media quota snapshots and mutations are API-owned state backed by `workspace_media_monthly_quota_counters`: runtime may reserve media units through internal API before provider work, while `MediaDeliveryService` settles only successful delivery and records no-delivery outcomes as reconciliation-required.
- `apps/runtime` owns request-time execution
- SSE socket close on the stream route does **not** abort the runtime turn. Only an explicit POST to the hard-stop route flips the runtime's abort signal. A passive disconnect (tab background, screen lock, network drop) lets the runtime finish, persists the full assistant message, and is recoverable on next history fetch.
- The web client performs a best-effort latest-history refresh on `focus`, `visibilitychange` back to visible, and `pageshow`, so a passive disconnect that already committed server-side is reconciled without requiring a manual page reload.
- the hard-stop route is idempotent and returns 204 whether or not a matching in-flight turn exists; the client treats it as fire-and-forget
- attachment staging under `POST /api/v1/assistant/chat/web/stage-attachment` accepts `clientTurnId` and `clientAttachmentId`; repeated staging for the same logical attachment returns the existing canonical staged attachment instead of creating a duplicate bubble
- before a new user message is persisted, inbound web-chat preparation now enforces two distinct limits from plan truth: internal `activeWebChatsLimit` for rare new-thread admission, and user-facing `messagesPerChat` for calm per-chat length gating. `messagesPerChat` failures are returned as product-shaped `chat_message_limit_reached` conflicts so the client can show a gentle "continue in a new chat / upgrade" banner instead of raw quota language.
- assistant-facing `quota_status` remains the single plan/quota tool surface. Runtime reads live quota + current/public plan context through `POST /api/v1/internal/runtime/tools/check`, including the same visible-plan facts needed for comparison and selection. ADR-087 extends this boundary semantically: quota/light-mode explanations, 90% advisories, effective reset windows, upgrade/package hints, and paid token-budget light-mode copy must be grounded in quota/plan truth from this same surface rather than in hardcoded web/Telegram copy. Slice 2 also makes this internal boundary thread-aware: when runtime supplies `channel` + `externalThreadKey`, the response can include durable-dedupe-aware advisory candidates for the active thread rather than only raw quota percentages. The boundary now carries structured `packageOffers` truth (per-tool concrete package rows, `offerableNow`, `preferredOfferKind`, preferred package ids, and plan-upgrade candidates) plus `packagesPurchase { path, url, paymentMethodClasses }`, so runtime/chat copy and the web packages page can read the same package/upgrade decision layer instead of inventing separate rules. Advisory candidates are now warning-only (`warning_90_percent`); hard-limit cases stay on the inline grounded-copy path instead of creating `quota_advisory` follow-ups. Paid token-budget exhaustion should degrade ordinary text turns into the safe `cost_driving_restricted` light-mode path until the current quota period resets; free/zero-price plans may still receive warnings but do not enter paid light mode. Guarded checkout-link creation goes through `POST /api/v1/internal/runtime/tools/quota-status/checkout`. For paid upgrades (and ordinary paid purchases) that path now routes through the active billing-management truth instead of the old raw payment-intent-only seam: it either returns a normal `/app/billing/checkout/:paymentIntentId` entry plus absolute URL variants when checkout is really needed, or returns an explicit `subscription_updated` outcome when a paid downgrade / `FREE` transition was scheduled at period end instead of opening checkout. When checkout is returned, the payload still carries recurring contour truth (`recurringCheckoutKind`, `recurringSupportedBySelectedMethod`, `recurringUnsupportedReason`) so the assistant can explain whether the selected method will actually start auto-renew or only open a one-shot fallback. The guard is action-based (`confirmed=true` on the tool call), not lexical matching against user text. The checkout page still renders the configured CloudPayments embedded constructor from persisted intent payload instead of bypassing payment-intent truth or directly activating subscription state.
- **ADR-088 Slice 1 + Slice 2 are now implemented.** The unified notification platform admin API is live at `/api/v1/admin/notifications/`:
  - `GET /channels` — list unified channel registry (`NotificationChannelView[]`)
  - `PATCH /channels/:channelType` — enable/disable/configure a channel
  - `GET /policies` — list notification policies (now includes `idle_reengagement`, `quota_advisory` migrated from legacy `workspace_notification_policies`)
  - `PATCH /policies/:source` — update a policy
  - `GET /quiet-hours` / `PATCH /quiet-hours` — timezone-aware quiet hours
  - `GET /deliveries` — paginated delivery history (filters: `source`, `class`, `channel`, `status`, `dateFrom`, `dateTo`)
  - `GET /deliveries/:intentId` — delivery detail with attempt log
  - `GET /dead-letters` / `POST /dead-letters/:id/replay` / `POST /dead-letters/:id/discard`
  - `POST /preview` — renderer dry-run (never sends)
  - `POST /api/v1/internal/notifications/postmark-webhook` — HMAC-verified Postmark bounce/complaint ingress
  - **Removed (Slice 2):** `GET/PATCH /policies/idle-reengagement`, `GET/PATCH /policies/quota-advisory` — these sources are now managed via the unified `GET/PATCH /policies/:source` endpoints
  - **Removed (Slice 2 closeout):** `PATCH /channels/webhook` — deleted from `openapi.yaml` and contracts; unified `PATCH /channels/:channelType` handles all channel types including `admin_webhook`
  - All conversational notification producers now create intents through `NotificationIntentService`; legacy `assistant_notification_outbox` path is deleted.
  - **Removed (Slice 3):** `AdminBillingLifecycleNotificationCode`, `AdminBillingLifecycleNotificationRule`, `AdminBillingLifecycleNotificationPolicy` schema types and `notificationPolicy` field from `AdminBillingLifecycleSettingsState/Request`. The billing lifecycle notification policy is now managed exclusively via `GET/PATCH /api/v1/admin/notifications/policies/billing_lifecycle`.
  - **Removed (Slice 3):** `AdminOpsCockpitBillingNotificationJob` schema and `latestNotificationJobs` field from `AdminOpsCockpitBillingSupport`. Billing delivery history is visible in `Admin > Notifications`.
  - **Slice 3 (LANDED):** `billing_lifecycle_notification_jobs` table is dropped. All six billing rules (`trial_ending`, `trial_expired`, `renewal_failed`, `grace_ending`, `grace_expired`, `payment_recovered`) now flow through `NotificationIntentService` with `class=transactional`, `renderStrategy=template`, real Postmark email delivery via `EmailChannelAdapter`. Operator manages billing notification policy from `Admin > Notifications` (source: billing_lifecycle).

### Telegram webhook

- Telegram webhook ingress remains `/telegram-webhook/*` through `apps/api`.
- ordinary Telegram text turns still use the native request-time execution path.
- ADR-087 applies the same quota/advisory semantics to Telegram as to web: when an in-scope finite limit reaches the advisory threshold, backend-owned delivery may append one assistant-authored follow-up message in the same Telegram thread rather than surfacing only transport-layer fixed error copy.
- accepted generated-media Telegram requests now complete the webhook quickly with an honest acknowledgement assistant reply plus a durable `assistant_media_jobs` enqueue instead of waiting for final provider/media completion inside the webhook lifecycle.
- the same backend `assistant_media_jobs` scheduler and `POST /api/v1/internal/runtime/media-jobs/run` seam now execute Telegram media work too.
- before final delivery, backend completion processing may call `POST /api/v1/internal/runtime/media-jobs/complete` with current canonical chat history to get optional fresh-history framing text; backend completion delivery still owns terminal state and actual web/Telegram delivery.

## Knowledge boundaries

### Assistant knowledge

- assistant-owned uploaded knowledge stays under `/api/v1/assistant/knowledge-sources/*`
- upload/reindex returns quickly with `processing` status by creating a DB-backed indexing job; the API indexing worker owns extraction/chunking/embedding/vector writes and terminal `ready` / `failed` / `needs_review` state
- request-time `knowledge_search` / `knowledge_fetch` execute through the native runtime knowledge contract
- current active runtime contract publishes `ragMode: "hybrid"` with bounded reference-first fetch semantics

### Admin global knowledge

Current admin knowledge routes are served by `apps/api`:

- `GET /api/v1/admin/knowledge-sources?scope=product`
- `GET /api/v1/admin/knowledge-sources/observability`
- `GET /api/v1/admin/knowledge-sources/connectors?scope=product`
- `GET /api/v1/admin/knowledge-sources/retrieval-policy`
- `POST /api/v1/admin/knowledge-sources/retrieval-policy`
- `POST /api/v1/admin/knowledge-sources/:scope`
- `DELETE /api/v1/admin/knowledge-sources/:sourceId`
- `POST /api/v1/admin/knowledge-sources/:sourceId/reindex`
- `GET /api/v1/admin/knowledge-indexing/jobs`
- `GET /api/v1/assistant/knowledge-indexing/jobs`

Active boundary rules:

- admin global-knowledge writes are platform-scoped and require a platform-scoped admin role
- admin-managed Skill/Product/global KB uploads are not charged to a tenant workspace knowledge-storage quota; tenant quota remains for user-private assistant knowledge
- upload/reindex creates DB-backed indexing jobs for Product sources; processing is source-agnostic and shares the ADR-079 worker path with assistant knowledge and Skill documents
- `/admin/knowledge` owns the admin Product/Skill KB retrieval and authoring model slots (`embeddingModelKey`, `retrievalModelKey`, `authoringModelKey`); user-uploaded assistant knowledge remains plan-slot owned
- retrieval observability is a durable API surface, not a process-local debug cache
- ADR-080 Product KB text entries are admin-authored Knowledge sources, not user Files; save/activate is explicit and indexing remains async through the existing jobs
- Product KB is the model-facing product knowledge concept and is platform-wide. Product Overview and Product Principles are single Product KB text entries visible in `/admin/knowledge`; runtime retrieval must not inject separate hard-coded product overview/principle documents. Pricing, plans, quotas, and plan differences remain sourced from the plan/subscription catalog and current workspace subscription state.

### Admin document processing

Current admin document-processing settings routes are served by `apps/api`:

- `GET /api/v1/admin/tools/document-processing`
- `PUT /api/v1/admin/tools/document-processing`
- `POST /api/v1/admin/tools/document-processing/test-connection`

Active boundary rules:

- admins configure provider policy under `/admin/tools`, not per upload
- Mistral OCR and LlamaParse keys use PersAI-managed encrypted provider-secret storage
- test connection currently verifies local parser availability or remote key decryptability; live OCR/provider pings belong with provider adapter execution

### Admin Skills

Current admin Skill routes are served by `apps/api`:

- `GET /api/v1/admin/skills`
- `POST /api/v1/admin/skills`
- `GET /api/v1/admin/skills/:skillId`
- `PATCH /api/v1/admin/skills/:skillId`
- `DELETE /api/v1/admin/skills/:skillId`
- `POST /api/v1/admin/skills/:skillId/authoring/draft`
- `POST /api/v1/admin/skills/:skillId/documents`
- `DELETE /api/v1/admin/skills/:skillId/documents/:documentId`
- `POST /api/v1/admin/skills/:skillId/documents/:documentId/reindex`

Active boundary rules:

- Skills are an admin-managed platform catalog, not admin global knowledge `scope=skill`; Skill rows, documents, cards, chunks, indexing jobs, and vectors are not tenant workspace-owned
- `Skill.category` is the current group key shown in admin/user UI (`work`, `engineering`, `personal`, `education`)
- delete archives a Skill and disables active assignments rather than hard-deleting the product concept
- Skill document upload/reindex creates pending DB indexing jobs; the API indexing worker processes Skill documents through the same normalized source/chunk/vector boundary as assistant and Product knowledge
- ADR-080 Skill knowledge cards and assistant-assisted Skill drafts belong to the admin Skill surface; generated proposals must not become active runtime knowledge without explicit admin save/activation
- assistant-assisted Skill draft/enrichment is API/control-plane authoring that calls provider-gateway using the admin Knowledge `authoringModelKey`; it is not a runtime chat turn and does not mutate saved Skill or Knowledge rows unless the admin saves the proposal
- `/admin/skills` is the admin UI owner for Skill list/create/edit/archive and Skill document upload/delete/reindex/status management; `/admin/knowledge` remains Product KB and must not expose the old Skill library scope

### Assistant Skills

Current assistant Skill routes are served by `apps/api`:

- `GET /api/v1/assistant/skills`
- `PUT /api/v1/assistant/skills`

Active boundary rules:

- only the user can replace enabled Skill assignments for their assistant
- assignment accepts active platform-catalog Skills only
- configured plan limits cap enabled Skill count
- the web setup/recreate flow and `Assistant Settings -> Skills` are the current user-facing clients for these routes
- enabling Skills now changes prompt materialization through the Prompt Constructor-managed `Enabled Skills` block and contributes compact summaries to the runtime router's `retrievalPlan`; orchestrated retrieval/context injection and calm source-aware activity are active on the runtime web path
- Skill retrieval revalidates active assistant assignments, then searches selected Skill ids and Skill source types without filtering Skill sources by the consuming assistant workspace. User-private knowledge remains assistant/workspace-scoped.

### Internal runtime

Current active internal service endpoints are served by `apps/runtime`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/turns/create`
- `POST /api/v1/turns/stream`
- `POST /api/v1/internal/runtime/document-jobs/run`

These are internal runtime-service boundaries, not a public legacy gateway surface.

Runtime turn results may include compact `turnRouting.retrievalPlan` diagnostics. On the active runtime path, the router plan feeds the internal API retrieval boundary when Skill, user, Product, or web grounding is requested.

ADR-097 adds one more internal runtime execution seam for the backend document worker. `POST /api/v1/internal/runtime/document-jobs/run` is an API-owned background-worker boundary: API sends persisted document job truth plus the current materialized runtime bundle, runtime executes the provider-specific document path, and runtime returns worker-only result truth (`artifacts`, optional `assistantText`, and provider-status metadata). The current active scope is still intentionally narrow and async-first: `create_pdf_document` may execute through PDFMonkey only when the operator-owned template prerequisite is configured in `Admin > Tools` and present in the materialized runtime bundle; `create_presentation` may execute through Gamma and now delivers a persisted PDF artifact to chat by default while optionally retaining companion original-PPTX export metadata for on-demand download through a PersAI-owned endpoint; `revise_document` creates a new persisted version and runs through the same async worker lane; and `export_or_redeliver` now supports honest same-format redelivery/re-render on existing PersAI documents while cross-format export remains intentionally unsupported. The model-visible `document` tool is projected through the native runtime as an async/deferred tool surface; the final PDF/PPTX is still delivered later through the background document job lane rather than inline in the same model reply.

ADR-097 document source extraction is API-owned. Transient source attachments captured from the user message are extracted by the shared API `DocumentExtractionService` before the runtime call and are forwarded as `RuntimeDocumentJobRunRequest.sourceFiles[]` with extracted text/markdown, notes, provider trace, and quality metadata. Runtime consumes that pre-extracted payload for both PDFMonkey and Gamma generation and must not duplicate Knowledge OCR/provider-selection logic or hold Mistral/LlamaParse credentials. These transient generation attachments are not persisted into user Knowledge unless the user explicitly saves them through Knowledge flows.

ADR-079 Steps 11-12 add an internal runtime-to-API retrieval execution boundary: `POST /api/v1/internal/runtime/knowledge/orchestrate`. The runtime sends the current query and validated router plan, and the API returns a bounded source-aware `Retrieved Knowledge Context` block for executable Skill/user/Product sources. The API owns source policy, Skill assignment revalidation, ready-document enforcement, context shaping, and durable source-level retrieval observability. Web grounding is not fabricated by orchestration; `useWeb` is recorded honestly when not executed and real web work remains on the `web_search` / `web_fetch` tool path. Runtime web streams may emit compact retrieval activity events for source classes that actually contributed context; users do not see the internal plan. Heavy grounded Skill turns that also use user KB/files are raised to at least the configured `premium_reply` slot before generation, and runtime replans injected retrieved context under the plan-managed context hydration budget. Provider context-window overflow is surfaced as a distinct runtime context-window failure instead of generic runtime unreachable. This endpoint is internal only and does not expose old admin `scope=skill` or a public `skill` knowledge-search source.

ADR-094 (2026-05-13) extends the runtime knowledge contract additively. `knowledge_search` response hits may now carry optional `inlinedDocument`, `inlinedSection`, and `documentSummary` payloads when the server detects exactly one hit and the document fits the per-plan smart-search thresholds (`smartSearchShortDocChars`, `smartSearchMediumDocChars`); multi-hit results stay snippet-only. `knowledge_fetch` arguments now require `mode` (`short` | `section` | `full`) with optional `radius`; `mode = "section"` is the permanent contract default that the runtime tool layer applies when callers omit it (this is the steady-state default, not a deprecation alias). `mode = "full"` is bounded by `min(plan.fetchFullModeMaxChars, admin.fetchFullModeAbsoluteMaxChars)` for documents and `min(plan.fetchFullModeMaxChatMessages, admin.fetchFullModeAbsoluteMaxChatMessages)` for chat sources, with `truncated: true` and a structured `truncationMarker` when the cap is hit. Existing `knowledge_search` response fields and existing `knowledge_fetch` callers without `mode` keep working.

ADR-079 follow-up (2026-05-04): the `retrievalPlan` carried over this internal boundary now also includes an `ordinarySourcePriorityMode` field with values `personal_first`, `product_first`, `web_first`, `mixed_ambiguous`, or `not_applicable`. Active-Skill turns and trivial continuation turns send `not_applicable` and continue to use the staged Skill-first policy. Ordinary non-Skill turns send the precheck/classifier-derived mode, and the API orchestrator translates it into a stage-priority merge over `skill -> user -> product` without changing which sources are searched. The `web_search` / `web_fetch` path remains the only place where actual web work happens; the orchestrator only records honest web policy state for non-executed web grounding. Runtime model-visible `knowledge_search` / `knowledge_fetch` enums are now `document`, `memory`, `chat`, `subscription`, `global`; the previous `preset` value has been removed because prompt presets are not a model-facing knowledge source. Retrieval observability adds `policyState` values `ordinary_personal_first`, `ordinary_product_first`, `ordinary_web_first`, `ordinary_mixed_ambiguous` alongside the existing active-Skill states.

### Internal runtime → API back-channel

Current active internal `runtime → api` endpoints (served by `apps/api` on the dedicated `API_INTERNAL_PORT=3002` listener, gated by `PERSAI_INTERNAL_API_TOKEN`):

- `POST /api/v1/internal/runtime/memory/hydrate-for-turn` — returns the always-on `core` durable memory plus a relevance-retrieved `contextual` tail for the current turn and bumps `last_used_at` on every hydrated entry.
- `POST /api/v1/internal/runtime/memory/open-loop-refs` — returns a small latest-active unresolved open-loop ref set for the runtime-only resolver developer block, so `memory_write({ action: "close", ref })` can still target the correct row on follow-up turns even when the visible cross-session carry-over block is absent. This path is bounded and compact by design; it is not a user-visible memory listing surface.
- `GET /api/v1/internal/smoke/turn-receipts` — read-only smoke harness receipt query.

Other internal `runtime ↔ api` boundaries (bundle resolution, attachment hydration, etc.) are separate runtime-bundle endpoints and are not part of this back-channel.

### Sandbox

Current active internal sandbox endpoints are served by `apps/sandbox`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/jobs`
- `GET /api/v1/jobs/:jobId`

These are internal runtime-to-sandbox boundaries for isolated `files` / `exec` / `shell` work, not public product APIs.

### Files

ADR-081 defines the active target-state file boundary.

The public/product file surface should expose assistant-scoped Files through canonical `fileRef` handles backed by `AssistantFile`. Chat `attachmentId`, runtime `artifactId`, object-storage `objectKey`, storage paths, raw sandbox paths, knowledge source ids, and retrieval references are internal or plane-specific implementation identifiers, not primary model-facing file selectors. Runtime prompt hydration and model-visible tool use must expose reusable chat files through human-readable aliases that resolve to canonical `fileRef` server-side, rather than printing raw selectors into conversational history.

Sandbox and media delivery may continue to use their internal endpoints and storage paths, but those details must be hidden behind the single Files product/runtime contract. Knowledge remains a separate API/product plane and must not be folded into Files.

ADR-081 Slice 1 exposes the first assistant-scoped Files API under `/api/v1/assistant/files`: list/search, metadata by `fileRef`, download, display-name update, and registry-row delete/archive semantics. These responses expose `fileRef` and product metadata, not `objectKey`.

ADR-081 follow-up (2026-05-07) keeps `fileRef` as the canonical runtime/API file identity but changes the runtime model-facing contract to alias-first across uploaded chat files, generated outputs, and sandbox-created files. Runtime may still mount files into sandbox by relative path internally, and tool execution still resolves to canonical `fileRef`, but the model-facing selector passed through prompt/tool usage guidance is a human-readable working-file alias; sandbox/object storage paths and raw `fileRef` remain internal implementation details.

ADR-081 Slice 4 adds the first visible product Files surface inside Assistant Settings. The web UI consumes the assistant-scoped Files API by `fileRef` and uses a Clerk-authenticated web proxy for open/download links. Chat attachment cards prefer the same canonical file route when `fileRef` exists, so attachment cards and settings rows are projections of the same File instead of separate storage concepts.

ADR-081 Slice 5 removes the old attachment-download fallback from the active product/API path. Product open/download links are now canonical `fileRef` links only, and assistant Files API state exposes product metadata without storage-derived `relativePath`, `sha256`, `objectKey`, or raw path fields.

ADR-097 document outputs are still ordinary Files at the binary/download boundary, but the file/chat attachment API may project document-domain metadata as `documentLink` when an `AssistantFile` is a delivered output of an `AssistantDocumentVersion`. That projection is read-only UI metadata (`docId`, `versionId`, `versionNumber`, status fields, `isCurrentOutput`) so clients can show quiet version state. Clients may use the same delete affordance as ordinary files; the backend `deleteAssistantFile(fileRef)` boundary is responsible for detecting delivered document outputs and translating that user action into document-aware surface deletion (archive the document and hide delivered attachments) instead of physically deleting a protected file row and breaking version truth.

### Provider gateway

Current active internal service endpoints are served by `apps/provider-gateway`:

- `GET /health`
- `GET /ready`
- provider text generation/streaming endpoints consumed by `apps/runtime`
- `POST /api/v1/providers/generate-document`

ADR-097's current document-provider boundary is `POST /api/v1/providers/generate-document`. It is internal-only and consumed by the runtime document worker. The active narrow path is PDFMonkey-first: provider-gateway resolves the encrypted PDFMonkey secret through PersAI internal secret resolution, sends the provider request, downloads the returned PDF, and returns the PDF bytes plus provider operational metadata to runtime. Deterministic provider/config/auth/template 4xx failures now return explicit non-retryable error truth with provider-status metadata; they are not active-path transient retry semantics.

## Secret and credential flow

Current active secret split:

- `persai-api-secrets`: API/web/database/admin secrets
- `persai-runtime-secrets`: runtime/provider-gateway secrets and provider API keys

Current runtime/provider path:

1. `apps/api` resolves the active runtime bundle and forwards request-time execution to `apps/runtime`
2. `apps/runtime` uses `apps/provider-gateway` for provider calls
3. `apps/provider-gateway` prewarms text-generation providers from `persai-runtime-secrets` env vars when present, and falls back to PersAI-managed runtime provider keys stored by the admin runtime-provider settings flow through `POST /api/v1/internal/runtime/provider-secrets/resolve`
4. tool credentials continue to resolve through the same internal secret resolver when tool calls need per-provider keys

## Deploy truth

Current active deploy surface in `persai-dev`:

- `api`
- `web`
- `runtime`
- `provider-gateway`
- `sandbox`

Current ingress truth:

- `persai.dev` -> `web`
- `api.persai.dev` -> `api`
- `bot.persai.dev` `/telegram-webhook` -> `api`

## Historical traces

Historical OpenClaw bridge contracts may still appear in ADRs, changelog entries, session handoff logs, or migrations. They are not active boundary truth unless the current code, chart, or cluster still routes through them.
