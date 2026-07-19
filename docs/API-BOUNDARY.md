# API Boundary

This document describes the current active PersAI request boundaries.

For exact request and response schemas, use `packages/contracts/openapi.yaml` and the generated client/types in `packages/contracts/src/generated`.

ADR-072 is closed as the historical native migration ADR. ADR-078 is completed as the consolidated follow-through program. ADR-080 defines admin-controlled Knowledge authoring and Skill curation. ADR-081 defines unified user Files. ADR-087 defines unified quota advisories and paid light mode. ADR-088 defines the unified notification platform, control plane, and delivery architecture. ADR-092 defines the active billing contract for split payment-method truth on `GET /api/v1/assistant/billing/subscription` (last payment vs auto-renew), explicit provider-confirmed SBP recurring migration semantics, synchronized provider recurring descriptions, payment-success notification + receipt-link policy, and acceptance that billing notification intents remain queryable via `Admin > Notifications` delivery history APIs. ADR-098 defines the active public trust-page boundary (`/public/site-pages`, `/admin/site-pages`, `/public/geo-hint`), strict market/locale validation, published-variant discovery for public switchers, and the market-aware compliance-version read model behind `/me`.

## Operator API access (ADR-136)

Founder Cursor / MCP workflows use a **machine operator bearer**, not Clerk.

- Env: `PERSAI_OPERATOR_TOKEN` + (`PERSAI_OPERATOR_ACTOR_USER_ID` **or** `PERSAI_OPERATOR_ACTOR_EMAIL`).
- `ClerkAuthMiddleware` accepts `Authorization: Bearer <operator token>` before Clerk verification and binds `req.resolvedAppUser` to the configured actor `app_users` row.
- Operator auth covers the same clerk-registered public routes used for admin Skill CRUD (`/api/v1/admin/skills*`), admin Role CRUD (`/api/v1/admin/roles*`), assistant publish/role (`/api/v1/assistant/publish`, `/api/v1/assistant/{assistantId}/role`, `/api/v1/assistant/roles`), and web chat smoke (`/api/v1/assistant/chat/web`, `/api/v1/assistant/chat/web/stage-attachment`, chat file preview/download).
- `PERSAI_INTERNAL_API_TOKEN` remains **internal-only** (`/api/v1/internal/*` on `API_INTERNAL_PORT`); it must not authorize operator/admin/chat public routes.
- MCP package: `packages/persai-admin-mcp` (stdio). Dev defaults in `infra/helm/values-dev.yaml` pin actor email `kurock09@gmail.com`.

## Public product APIs

Primary public API surface:

- web and admin routes through `apps/api`
- guest trust-page reads under `/api/v1/public/site-pages/*`
- guest country hints under `/api/v1/public/geo-hint`
- authenticated assistant routes under `/api/v1/assistant/*`
- ADR-147 closed Role boundary: `GET /api/v1/assistant/roles` lists the active system role catalog; `GET /api/v1/assistant/{assistantId}/role` and `PUT /api/v1/assistant/{assistantId}/role` require a strict UUID path and are exact owner-only role read/write endpoints; malformed ids return stable `400 assistant_role_invalid_assistant_id` before persistence. Changed PUTs read the database clock only after acquiring the Assistant lock. Catalog and current-role `AssistantRoleState` include a required read-only `skills[]` display projection (active linked Skills only: `skillId`, `displayOrder`, localized `name`, `category`, `iconEmoji`, `color`) for Settings role preview — not a Skill selection/enable contract. Assistant directory/switcher rows (`AssistantListItemState`) now include a required compact `role` projection (`key` + localized `name`) so multi-assistant workspaces can show each assistant's Role instead of a specialty placeholder — still display-only, not Role selection. Direct per-assistant Skill selection remains absent from the active API/MCP/web contract; Role links are the sole effective Skills authority. Deployed Release C `a11c8b6b` / bot pin `05ccaed4` completed S5b physical assignment-storage removal.
- Voice DNA assistant read route: `GET /api/v1/assistant/persona-archetypes`
- admin routes under `/api/v1/admin/*`
- ADR-115 admin inbound-safety policy routes under `/api/v1/admin/safety-policy/*` (`heuristic-rules`, `settings`); ops restriction controls remain `/api/v1/admin/safety-controls/*` (slice 115.4)
- admin public-site-page routes under `/api/v1/admin/site-pages*`
- Voice DNA admin routes: `GET /api/v1/admin/persona-archetypes`, `PATCH /api/v1/admin/persona-archetypes/:key`, `POST /api/v1/admin/persona-archetypes/:key/reset-to-default`
- admin knowledge routes under `/api/v1/admin/knowledge-sources*`
- admin memory backfill routes under `/api/v1/admin/memory-backfill*` (assistant-scoped dry-run preview + step-up confirmed apply for legacy durable-memory cleanup)
- admin Skill routes under `/api/v1/admin/skills*`
- ADR-147 S4 admin Role routes under `/api/v1/admin/roles*` (list/create, static `POST /preview`, get/patch/delete by `roleId`, full-replace `PUT /{roleId}/skills`)
- ADR-151 closed API: `/api/v1/admin/scripts*` owns platform-global Script
  catalog/version lifecycle, validation, publish,
  and archive; `GET`/`PUT /api/v1/admin/skills/{skillId}/scripts` read and
  full-replace ordered Skill links; Scenario authoring accepts bounded structured
  `scriptRef` input mapping (`{scriptKey, inputMapping}` only — no version is
  authored). There is still no public execute endpoint. A new internal-only
  read boundary, `POST /api/v1/internal/runtime/scripts/version`, lets the
  runtime re-fetch the exact pinned `ScriptVersion` artifact
  (`runtime`/`entryCommand`/`manifest`/`inputSchema`/`outputSchema`/`limits` —
  never `code`) with live authorization
  (assistant → effective Skill → version-published → hash/key match →
  Script-not-archived → SkillScript-still-linked); this is not published in
  the public OpenAPI surface and is bearer-guarded by the same internal
  runtime-to-API token as other `internal/runtime/*` boundaries. The
  Roles-style Admin Scripts UI and nine thin operator-auth MCP Script wrappers
  are deployed production functionality. Their first and second independent
  Admin/MCP audits returned DIRTY; after canonical schema/trim parity, complete
  local validation, guarded loading/mutation ownership, and binding-control
  corrections, the final targeted re-audit returned CLEAN. Release `f0944d31`
  / GitOps pin `95c7d68d`, the `5fb61f3c` deployed repair, and final runtime
  release `43f653b4` completed deployment and founder live acceptance.
- future ADR-080 admin authoring routes for Skill knowledge cards, Skill draft enrichment, and Product KB text entries stay under `/api/v1/admin/skills*` and `/api/v1/admin/knowledge-sources*`
- admin document-processing provider settings under `/api/v1/admin/tools/document-processing*`
- admin billing-provider credential settings under `/api/v1/admin/tools/billing`
- admin tool-path economics catalog under `/api/v1/admin/tools/economics` (`persai.toolPathPricingCatalog.v1` on `platform_runtime_provider_settings.tool_path_pricing_catalog`). Keys remain on `/api/v1/admin/runtime/tool-credentials`; per-call/per-render tariffs for `web_search`, `web_fetch`, `browser`, and `document_render` are catalog-owned. Provider-gateway and runtime emit normalized tool-path `billingFacts` on successful calls; API appends non-blocking ledger rows via `RecordToolPathBillingFactsEvent` / `RecordToolPathLedgerFromToolInvocationsService` (ordinary web/Telegram turns) and persisted billing facts on document-job delivery. Admin → Tools edits the catalog (ADR-099 Block 2, implemented).
- admin tool-credentials store under `/api/v1/admin/runtime/tool-credentials` is the canonical operator-owned secret backbone for provider/notification credentials. ADR-088 Slice 2.5 moved the Postmark Server Token and Postmark webhook HMAC token here; they are stored under the credential ids `notification/email/postmark/api-key` and `notification/email/postmark/webhook-token` (declared in `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts` as `NOTIFICATION_CREDENTIAL_IDS`). ADR-106 Slice 2 adds separate video-provider credential ids `tool/video_generate/runway/api-key` and `tool/video_generate/kling/api-key` for Runway/Kling readiness; ADR-106 Slice 5 materializes those ids only into provider-specific `video_generate` refs/fallbacks. The existing OpenAI media credential id `tool/image_generate/api-key` remains unchanged for image generation, image edit, and OpenAI video. Kling's secret value is not a single API key: it must store a JSON object with both official console values, for example `{"accessKey":"...","secretKey":"..."}`. The provider-gateway Kling adapter converts that stored JSON into a short-lived JWT and calls the official Kling video endpoints on `api-singapore.klingai.com`; no KIE proxy credential or upload flow remains in the active boundary. `EmailChannelAdapter` and `HandlePostmarkWebhookService` resolve notification values exclusively through `PlatformRuntimeProviderSecretStoreService`. `process.env`-based fallbacks for Postmark (or any new notification provider credential) are forbidden in source — the `Admin > Tools > Notifications` UI is the single edit surface, and Helm `secretEnv` slots for these values must not be reintroduced.
- admin runtime-provider settings expose both the legacy chat-model alias `availableModelsByProvider` and the structured `availableModelCatalogByProvider`. The catalog is provider-owned `models[]` rows with capabilities (`chat`, `image`, `video`), `active` state, token quota weights (`inputTokenWeight`, `cachedInputTokenWeight`, `outputTokenWeight`), and pricing metadata (`billingMode`, `effectiveFrom`, `effectiveTo`, and exactly one billing-mode-specific branch under `providerPriceMetadata`). Historical rows are archived by inactivating them in the same catalog instead of deleting them from runtime truth. ADR-106 Slice 1 splits provider concepts: chat routing providers remain `openai` and `anthropic`, while managed catalog providers are `openai`, `anthropic`, `runway`, and `kling`; Runway/Kling catalog rows are video-only and must not enter `availableModelsByProvider` or chat routing selectors. `availableModelsByProvider` is derived from active chat-capable OpenAI/Anthropic catalog rows and stays the compatibility input for downstream text-model selectors. ADR-106 Slice 4 keeps plan media selections as bare model keys and therefore rejects duplicate active video model ids across OpenAI/Runway/Kling so `videoGenerateModelKey` / fallback can resolve unambiguously. `routerPolicy` now also carries boolean `analyzeUploadsOnB2cUpload` (default `false`) on this same admin runtime surface; it gates cheap background upload semantic-summary analysis for ordinary non-project/B2C chats, while project-mode uploads always enqueue once canonical workspace-path truth exists. Plan admin payloads may select `primaryModelKey`, `imageGenerateModelKey`, `imageGenerateFallbackModelKey`, `imageEditModelKey`, `imageEditFallbackModelKey`, `videoGenerateModelKey`, and `videoGenerateFallbackModelKey`; media model keys are validated against active catalog row capabilities during plan writes and materialized into runtime tool credential refs with optional fallback chains. Plans also expose monthly media unit limits for `image_generate`, `image_edit`, and `video_generate`, plus `messagesPerChat` as the per-chat conversation-length policy field. `activeWebChatsLimit` remains an internal technical cap on concurrent web threads; `0` means unlimited, and user-facing pricing/facts should not market that field directly. API quota services resolve media usage from subscription-period media counters, not daily tool counters. ADR-083 plan lifecycle policy is also plan-owned: trial plans expose `lifecyclePolicy.trialFallbackPlanCode`, paid plans may expose `lifecyclePolicy.paidFallbackPlanCode`, and plan writes reject missing, self-referential, or inactive fallback references. ADR-084 Slice 2 pricing-card groundwork is now plan-owned too: `Admin > Plans` payloads include a `presentation` block (`showOnPricingPage`, `displayOrder`, localized `title/subtitle/notes/badge/ctaLabel`, structured `price`, and localized feature bullets) so public pricing surfaces can be rendered from admin-managed plan truth rather than a separate marketing config. User plan visibility also exposes the effective plan's same structured `price`, allowing UI to classify zero-price access by `amount === 0` instead of lifecycle status. The public pricing-read boundary is `GET /api/v1/public/plans/pricing`: no auth, active visible plans only, ordered by `displayOrder`, and intentionally limited to card-safe plan truth (`presentation`, quota highlights, trial/default flags, and core entitlements/skill policy) so guest and signed-in pricing pages can share the same source. ADR-084 Slice 3 adds authenticated user billing-intent boundaries: `POST /api/v1/assistant/billing/payment-intents` creates or reuses a PersAI-owned payment intent for a visible paid plan using a caller-supplied `idempotencyKey`, persists the selected plan/payment method/return URL before any provider call, and returns a provider-neutral checkout payload (`embedded`, `redirect`, `payment_link`, `qr_code`, or `manual_test`). Payment-intent state now also carries recurring checkout truth (`one_time` vs `recurring_start`) plus whether the selected method is really recurring-capable in the active contour. `GET /api/v1/assistant/billing/payment-intents/:paymentIntentId` reads that persisted state back for the same user/workspace. `GET /api/v1/assistant/billing/subscription` returns user-visible recurring management state (plan, status, auto-renew, next charge/access-until, payment method label, provider-managed URLs), and `POST /api/v1/assistant/billing/subscription/disable-auto-renew` schedules provider-backed cancellation through PersAI lifecycle truth instead of direct client/provider UI logic. ADR-084 Slice 5 adds two more active billing boundaries: `GET/PUT /api/v1/admin/tools/billing` now owns PersAI-managed encrypted CloudPayments credentials, and `POST /api/v1/public/billing/cloudpayments/webhooks/:notificationType` is the trusted provider ingress that verifies HMAC over the raw request body, resolves the PersAI payment intent / subscription subject, updates `workspace_payment_intents`, and then applies ADR-083 lifecycle events from that trusted signal rather than from client return state. Trusted recurring lifecycle now includes `recurrent` renewal success/recovery, renewal failure, and provider cancel events; period-end cancellation falls back through ADR-083 `cancelAtPeriodEnd` truth instead of an ad hoc UI flag. `GET/PUT /api/v1/admin/billing/lifecycle-settings` owns persisted `gracePeriodDays`, global fallback plan policy, and billing lifecycle notification policy. Effective subscription resolution materializes missing workspace subscriptions from the default registration plan, assigns real trial/current-period boundaries for trial registrations, keeps paid plans effective during `grace_period`, applies expired-trial, grace-expired, and canceled-period-end fallback through configured active fallback plans, records append-only lifecycle events, and derives durable billing notification work from those events. Email lifecycle notification work is required and persisted as billing notification jobs; optional assistant push/Telegram uses the existing assistant notification outbox. `GET /api/v1/admin/ops/users` and `GET /api/v1/admin/ops/cockpit` expose billing support projections from PersAI-owned subscription, quota, lifecycle-event, notification-job, and latest paid-activation source state; the ops quota projection now includes compact per-tool monthly media usage instead of presenting `activeWebChatsLimit` as a primary user-support quota bar. `POST /api/v1/admin/ops/users/:userId/billing-support-action` now includes explicit manual/admin paid activation (`manualPayment.planCode` + `manualPayment.billingPeriod`) alongside extend trial, grant/extend grace, manual reminder, and fallback actions, and the refreshed Ops detail continues to read PersAI-owned truth rather than request-time provider state or fake provider invoices.
- ADR-101 adds plan-owned assistant count truth under `assistantPolicy.maxAssistants` in Admin/Public plan contracts. Current B2C/default plans resolve to `1`; B2B/operator plans may set a higher value. Assistant lifecycle/bootstrap expose `assistants[]`, `activeAssistantId`, switch/create contracts, and assistant-scoped product reads through active assistant resolution. User/admin plan visibility, payment-intent checkout, media package checkout, and bounded admin billing/override actions resolve the selected active assistant/workspace rather than a user-only assistant lookup.
- ADR-101 Ops admin display support extends `GET /api/v1/admin/ops/cockpit` with optional `assistantId` and a compact `assistant.assistants[]` selector list so assistant-owned cockpit blocks can be read for the selected assistant. If `assistantId` is omitted, the cockpit may fall back to the target user's active assistant, or to the only assistant when the workspace has exactly one; it must not silently pick the first assistant from a multi-assistant workspace. `GET /api/v1/admin/ops/users` exposes `assistantCount` for compact directory display. Plan Control remains assistant-scoped because it writes `AssistantGovernance.assistantPlanOverrideCode` for the selected assistant; billing/subscription support remains workspace-level.
- ADR-108 Slice 7 (2026-06-04) changed the **runtime tool contract** (not the REST API surface) for the `quota_status` tool result shape. `RuntimeMonthlyToolQuotaStatusToolRow` in `packages/runtime-contract/src/index.ts` is now a discriminated union: `kind: "units"` for `image_generate`, `image_edit`, `document` (all prior per-unit fields preserved byte-identical); `kind: "vcoin"` for `video_generate` (fields: `balanceVc`, `monthlyGrantVc`, `typicalVideoCostVc`, `typicalVideoSeconds`, `typicalCostFromPlatformFallback`, `status: "ok" | "balance_exhausted"`). This union is used in `RuntimeMonthlyToolQuotaStatus.tools[]` which is embedded inside the `RuntimeQuotaStatusToolResult` returned by the runtime-internal `POST /api/v1/internal/runtime/tools/check` endpoint. This is NOT an OpenAPI-published REST API field — it is an internal runtime-to-API JSON boundary decoded by `persai-internal-api.client.service.ts::isMonthlyToolQuotaStatusTool`. Consumers that read `monthlyToolQuotas.tools[]` must narrow on `row.kind` before accessing kind-specific fields (`kind === "units"` for unit fields; `kind === "vcoin"` for vcoin fields). The `typicalVideoCostVc` field is null when no active time-metered video catalog pricing rows exist. The `typicalVideoSeconds` field is null when the workspace has no 30-day video generation history (in which case `typicalCostFromPlatformFallback === true` and the cost was derived from the platform constant `TYPICAL_VIDEO_SECONDS_FALLBACK = 5`).

- ADR-113 Slice 1 (2026-06-08) changed the **runtime tool contract** (not the REST API surface) for the chat `tts` worker tool. The model-facing `tts` tool no longer accepts `toneTag`; it accepts structured expressive delivery intent — `delivery` (`neutral|calm|warm|confident|playful|dramatic|whisper|narrator`), `emotion` (`neutral|happy|sad|excited|serious|curious`), `pace` (`slow|normal|fast`), `intensity` (`low|medium|high`), `pause` (`none|short|long`), `nonVerbal` (`none|laugh|chuckle|sigh|clear_throat`) — plus the existing `text` and optional `deliveryKind`. The runtime derives the legacy `toneTag` from `delivery` for the internal `ProviderGatewaySpeechGenerateRequest` (so Yandex/OpenAI tone baselines are unchanged) and forwards the structured intent. Provider-gateway compiles the intent into conservative ElevenLabs `eleven_v3` audio tags via a safe deterministic compiler (no model-authored raw tags) and defaults the ElevenLabs quality path to `model_id: "eleven_v3"`, honoring an explicit catalog `modelKey` override per ADR-110. This is an internal runtime/provider-gateway JSON contract change, not an OpenAPI-published REST field; persisted assistant voice-profile truth and the chat/Telegram media/job delivery path are unchanged.
- ADR-113 Slice 2 (2026-06-08) enriched the **REST** response of `GET assistant/voice/settings` (`AssistantVoiceSettingsState`, schema `persai.assistantVoiceSettings.v1`). The change is additive and backward-compatible. When `primaryProviderId === "elevenlabs"`, the `elevenlabs` block keeps `configured`, `loadState` (`ready|not_configured|unavailable`), `voices`, and `warning`; each `AssistantVoiceCatalogEntry` additively gains `language: string | null` and `languageBucket` (`ru|en|other`) alongside the existing `voiceId`, `name`, `gender`, `category`, `previewUrl`. (No `shortlist`/`fetchedAt` are exposed — they were considered but dropped in the same-day cleanup as unconsumed.) The voices are served from the platform-wide `platform_elevenlabs_voice_catalog_cache` (24h TTL, lazy refresh, stale-on-failure fallback) via `ElevenLabsVoiceCatalogService` rather than a live per-request ElevenLabs fetch. The active refresh source is ElevenLabs shared voice library (`/v1/shared-voices`), curated per `ru|en|other` bucket and gender as a small 50/50 featured + popularity-ranked set; `unavailable` is only returned when the cache is empty and a live refresh fails.
- ADR-108 Slice 6a (2026-06-03) extended two user-facing plan contracts. `PublicPricingPlanState` (returned by `GET /api/v1/public/plans/pricing`) now carries three new fields: `videoVcoinMonthlyGrant` (required integer ≥ 0 — the monthly VC grant credited at subscription rollover, 0 for free/grant-less plans), `vcoinExchangeRate` (required integer ≥ 1 — the platform-level course `1 USD = N VC` at response time, sourced from `PlatformRuntimeProviderSettings`), and `videoVcoinApproxVideosPerMonth` (optional integer ≥ 0 — server-precomputed marketing approximation `floor(grant / ceil(avgUsdPerSecond × 5s × exchangeRate))` from active time-metered video catalog rows; omitted when grant is 0 or no active video pricing rows exist). `UserPlanVisibilityState` (returned as part of `GET /api/v1/app/bootstrap` and the underlying plan visibility endpoint) now carries a new required top-level field `workspaceVcoinBalance: { balanceVc: integer, videoVcoinMonthlyGrant: integer ≥ 0, vcoinExchangeRate: integer ≥ 1 }`. `balanceVc` is the live workspace wallet value (may be transiently negative per ADR-108 one-shot overshoot rule). When no workspace context is available (anonymous or no subscription), the API emits the platform-default sentinel `{ balanceVc: 0, videoVcoinMonthlyGrant: 0, vcoinExchangeRate: 20 }`. The `videoVcoinApproxVideosPerMonth` computation uses `TYPICAL_VIDEO_SECONDS = 5` (same constant as the Slice 5 admin UI hint) and is intentionally a marketing approximation, not a per-job guarantee.
- ADR-111 Slice 5 keeps cloned-voice management inside the authenticated workspace product boundary:
  - `GET /api/v1/workspaces/:workspaceId/video-cloned-voices` returns workspace-scoped cloned-voice rows plus current limit/cost metadata for the `My voices` UI
  - `POST /api/v1/workspaces/:workspaceId/video-cloned-voices` is multipart (`audio` + `displayName` + optional language hint/body metadata) and may fail honestly with stable product codes such as `cloned_voice_limit_reached`, `cloned_voice_duplicate_name`, `provider_plan_upgrade_required`, `provider_resource_limit_reached`, or VC-balance exhaustion
  - `DELETE /api/v1/workspaces/:workspaceId/video-cloned-voices/:clonedVoiceId` archives the workspace-owned clone from active selection
  - `POST /api/v1/workspaces/:workspaceId/video-cloned-voices/:clonedVoiceId/default` marks the ready clone as the default workspace choice
- `POST/PATCH /api/v1/workspaces/:workspaceId/video-personas*` may carry `videoFormat` (`16:9` / `9:16` / `1:1`) plus both `heygenVoiceId` (preset fallback) and optional `clonedVoiceId`; pending/failed clones must be rejected at the API boundary rather than silently accepted
- `GET /api/v1/workspaces/:workspaceId/video-personas/voice-catalog` returns only admin-approved and enabled HeyGen catalog voices. The provider cache may contain public, private, and imported ElevenLabs voices, but unapproved rows are not exposed to users and their preview route is not available through the workspace voice-catalog boundary.
- Admin HeyGen voice curation lives under `/api/v1/admin/runtime/tool-credentials/heygen-voice-catalog/*`: `POST /refresh` updates the raw provider cache, `GET/PATCH /curation` lists and saves operator approval metadata, and `GET /:voiceId/preview` proxies previews for admin review. Curation writes require the existing dangerous-action step-up used by tool credentials.
- single-batch web bootstrap: `GET /api/v1/app/bootstrap` — bearer-protected, fans out to assistant lifecycle, web chats, telegram integration, notification preference, user plan visibility, and admin plan visibility via `Promise.allSettled`; each section is `{ ok: true, data } | { ok: false, error }` so partial failures don't block the rest. Called once during SSR by `apps/web/app/app/layout.tsx`; mutations still use the per-endpoint refresh paths
- Telegram webhook under `/telegram-webhook/*`

Trust-page boundary rules:

- `GET /api/v1/public/site-pages/:slug` accepts only contract values for `market` (`rf|intl`) and `locale` (`ru|en`); invalid explicit query values are `400`, not silent fallback.
- when `market` is omitted and there is no guest country cookie/header hint yet, anonymous public trust-page reads default to `rf`.
- successful public site-page reads return the resolved published page plus the currently published `availableVariants[]` for that slug so web switchers do not offer dead market/locale combinations.
- `GET/PUT/POST /api/v1/admin/site-pages*` is platform-owned admin surface, not generic workspace-owner surface; management requires a platform-scoped admin role.
- missing baseline rows for `platform_site_pages` are auto-seeded on API startup from the same canonical seed set used by `prisma seed`, so new environments do not boot into empty `/terms`/`/privacy`/`/requisites`/`/contacts` 404s.

### Avatar pipeline

- upload (public): `POST /api/v1/assistant/avatar` — bearer, multipart; returns `{ avatarUrl: "/api/avatar/<hash>.<ext>" }` where `<hash>` is a 16-char SHA-256 prefix of the bytes
- read (internal): `GET /api/v1/assistant/avatar/:hash` — bearer-only, called server-side by the `apps/web` BFF route handler; validates `:hash` against the assistant's current `draftAvatarUrl` and returns 404 on mismatch (no stale-content leak)
- web BFF (cookie-auth): `apps/web/app/api/avatar/[hash]/route.ts` — Clerk cookie session → server-side `auth().getToken()` → upstream fetch → streams bytes with `Cache-Control: private, max-age=31536000, immutable` and `ETag: "<hash>"`. Browsers/CDNs cache by URL, so a new upload (new hash → new URL) is automatically cache-busted.
- lifecycle envelope: `assistant.draft.avatarUrl` and `assistant.published.avatarUrl` always emit the content-addressed form `/api/avatar/<hash>.<ext>`. Legacy absolute URLs persisted in dev databases are sanitised to `null` so the UI falls back to the emoji avatar until re-uploaded — no transitional dual-mode shape.

## Volatile-context XML kinds (ADR-119)

The runtime emits the following XML-tagged volatile-context blocks into the JIT zone of the materialized prompt (Zone 2). Provider clients recognize them by `volatileKind` and reposition them outside the cached prefix:

| XML tag                    | `volatileKind` value | ADR reference    | Notes                                                                                                                                                                                       |
| -------------------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<persai_active_scenario>` | `"active_scenario"`  | ADR-119 Slice 4  | Emitted by `build-active-scenario-block.service.ts` when a scenario is active. Replaces the old prose-markdown `## Active Scenario` format from ADR-118 D4.                                 |
| `<system-reminder>`        | `"system_reminder"`  | ADR-119 Slice 5  | Injected mid-conversation by `build-system-reminder-blocks.service.ts` to reinforce critical rules under recency bias. Protocol declared once in the AOT prefix via `<reminders_protocol>`. |
| `<persai_environment>`     | `"presence"`         | ADR-074 Slice T1 | Sense-of-time block (current local time, weekday, gap since last message). Rendered by `presence-renderer.ts`.                                                                              |

All volatile-context blocks are marked `cacheRole: "volatile_context"` on the message envelope. Provider clients (`anthropic-provider.client.ts`, `openai-provider.client.ts`) reposition them adjacent to the current user message so per-turn rotation never invalidates the stable system-prefix breakpoints.

**ADR-120 Slice 1** retired the `<persai_memory>` / `"memory"` volatile kind (the always-on pushed contextual short-memory block). Cross-chat / old-fact recall is now **pull-only** via the `knowledge_search` `memory` source; durable identity/core memory stays in the AOT cached prefix. `<persai_retrieved_knowledge>` is **not** an always-on push either: ADR-120 makes retrieved knowledge flow through the `knowledge_search` / `knowledge_fetch` tool channel (the ADR-119 push expectation is superseded; the unfilled volatile kind is removed rather than left dormant).

## Runtime-related boundaries

**ADR-152 / ADR-157 universal-await (local; ADR-157 open for remaining
perception/gate)** supersedes the former media/document-only F0 contour. The
model-facing contract is strict
`await({action:"wait"|"notify", jobRef?:string, timeoutMs?:number})`:
`jobRef` is optional only for wait, notify requires it, and timeout is
wait-only `0..300000` (ADR-157). Canonical adapters are media, document, and
exact-owned warm-session shell/exec SandboxJobs. Registration is an internal
bearer-only server-derived operation and validates
assistant/workspace/user/chat/channel/thread/source turn/runtime session plus
canonical SandboxJob identity; raw SandboxJob ids are not model observation
capabilities.

Exact-id wait observes one owned job; no-id wait returns the complete,
stable-ordered max-32 snapshot of current-server-logical-turn handles plus
currently-open exact-owned media/document/sandbox jobs in the current
chat/channel/thread. Empty snapshot with positive `timeoutMs` is a real timer
(ADR-157; max `300000`). Overflow is typed `snapshot_overflow`, never
truncation.

Landed observation seams are immediate owned DB reads on
`POST …/async-jobs/v1/{status,snapshot,subscribe}` plus internal
`POST …/async-jobs/v1/perception-artifacts` (ADR-157 — image storage refs for
chat-model perception only; not model-facing). Runtime client-polls ~500ms.
Redis subscribe-before-read long-poll wake acceleration is **not landed**.
Delivery visibility remains terminal authority where implemented for
media/document. The retained scheduler poll/reconciler is recovery. Additive
migration adds sandbox handle kind / detached / runtime_session_id.
Bearer-protected `POST …/async-jobs/v1/assert-cap` admits chat-scoped
background/foreground work before shell/exec submit so Process-timeout waits
count against the unified 8-cap (same SQL as media/document/register).

Notify is non-terminal: an owned pending ref durably subscribes/reserves
continuation narration and returns `turnControl:"continue"`; terminal-before-
subscribe returns inline. Scheduler dispatch requires `sourceFinalizedAt` and
revalidates before dispatch. **ADR-159 wake/catch-up contract (Slices 1–3
CLEAN/GO local; S5 shipping pending):**
dispatch is session-queue owned — `ChatWakeCoordinator` enforces
`USER_TURN` > `JOB_CATCHUP`, durable preparing open window
(`assistant_chats.last_user_turn_started_at`) + idle-pause debounce
(`last_user_turn_terminal_at` + `CATCHUP_IDLE_PAUSE_MS`), at most one active
catch-up per chat, and ready FIFO (`claimReadyHeadForChat`; global
`claimReady` deleted). Gate is re-checked after lock acquire and the final
admission is a conditional `assistant_chats.catch_up_admission_fence` update
immediately before runtime acceptance; every web turn admits on that chat row
after chat resolution but before user-message persistence (and closes it if
preparation fails), while Telegram's inbound admission uses the same row, so
the mutation that commits first wins. The runtime session lease remains the execution
gate but must not race user turns via “whichever
acquires first.” Never `markDispatched` before lease acquired and (web) turn
attempt is running; pre-acceptance busy → `releaseClaimToReady` (no parked
`accepted`, no `requeueBusyNotStarted`). Catch-up model facts include
`wakeKind=job_catchup`, ordinal, interleaved, `jobRef`, and bounded terminal
facts (S3). Sync in-turn `await.wait` is unchanged (same bubble).
Telegram keeps blocking `async-continuations`; same queue rules. Permanent
continuation failure must surface one visible observation (contract); terminal
observations are history/result truth and never remain in the Working projection.
`async_job_accepted` SSE for mid-turn Working updates is
landed: runtime emits it immediately after opaque media/document/sandbox
`jobRef` acceptance; API relays through the web turn stream; the web client
upserts `activeMediaJobs` / `activeDocumentJobs` / `activeSandboxJobs` before
the provider loop closes. Durable/reconnect authority remains the chat
active-observation projection. Await activity uses `await-deadline:<epochMs>`
tool-progress preview for live countdown.

ADR-152 checkpoint 1 adds no public endpoint. New runtime uses the
bearer-protected internal `POST /api/v1/internal/runtime/async-jobs/v1/status`
seam with current assistant/workspace/chat/channel/thread ownership. It returns only opaque
`jobRef`, canonical kind, normalized status, and bounded safe terminal facts;
malformed, tampered, and foreign handles all return the same not-found result.
The model-visible `await` tool projects exactly `action="wait"|"notify"` (zero
wait is status-only, positive timeout is capped at 300000 ms / 5 minutes).

Checkpoint 2 adds the bearer-protected
`POST /api/v1/internal/runtime/async-jobs/v1/subscribe` seam and API-owned
same-row state operations. Source finalization has no HTTP seam: authoritative
API message-persistence owners call the in-process owner after persistence or
failure. Status/subscribe re-read canonical truth
under the locked handle and derive user ownership from the chat. Terminal status
observation claims current-turn narration before returning facts. Media/document
delivery consults the durable narration decision before invoking legacy
completion framing: continuation/current-turn owners skip it, finalized legacy
owners preserve it, and unresolved source turns no longer defer bytes
(ADR-157 — artifact delivery proceeds with `skip_legacy_frame`; chat-model /
continuation owns user text). Image success framing is removed; plan-gated
vision is perception-only for the next chat-model call. API message-persistence
owners finalize with proof of persisted output; failed/Stopped turns release
current-turn ownership.
The runtime additionally exposes bearer-protected
`POST /api/v1/internal/runtime/async-continuations` (blocking JSON
completed/busy/duplicate/failed for Telegram and fallback) and
`POST /api/v1/internal/runtime/async-continuations/stream` (same early JSON
outcomes, otherwise NDJSON `RuntimeTurnStreamEvent` vocabulary identical to
`POST /api/v1/turns/stream`). Only the internal SchedulerLease-backed
continuation worker calls these after canonical ownership/binding/entitlement
revalidation. Web notify dispatch prefers the stream path plus an
`AssistantWebChatTurnAttempt` / turn-stream bus (`WebChatTurnStreamRegistry` →
`WebChatTurnStreamBusService`) / Stop registration keyed by
`continuationClientTurnId` (`async-cont:…`) so the browser reattaches via
ordinary `GET /assistant/chat/web/turns/:clientTurnId/stream` on any API pod
when coordination Redis is configured (ADR-158); Working active-job
projections expose that id while notify is
`subscribed|ready|claimed|dispatched` (aligned with media/document/sandbox
Working list projection). Continuation attempts `markRunning` with null
`userMessageId`. It persists output without a fake user message, then
finalizes children keyed by that continuation client-turn id.
The API client accepts only exact busy/duplicate, safe failed, or essential
completed-result response shapes for the blocking path; malformed 2xx is
ambiguous and remains dispatched. Its authenticated `/status` subroute proves
the exact receipt and accepted-turn marker before an ambiguous dispatched
handle may be requeued.

### Native Tool Runtime instruction ownership

ADR-117 defines one owner per model/provider instruction concern:

- **Selection guide (`WHICH tool / WHEN`)** lives only in the DB-backed `tools` prompt-template block (`apps/api/prisma/bootstrap-preset-data.ts` default, admin-editable via presets). This is the Native Tool Runtime selection guide and the only place cross-tool comparison, mutual exclusion, call-don't-narrate rules, and `action="pending_delivery"` delivery honesty may live.
- **Per-tool mechanical contract (`WHAT tool / params`)** lives only in the catalog → runtime-tool-policy → native-tool-projection descriptor path. Per-tool `modelDescription` / `modelUsageGuidance` may explain that tool's own behavior and parameter semantics, but must not re-teach sibling-tool selection.
- **Provider-conditioning (`HOW provider renders`)** lives only in `packages/runtime-contract/src/index.ts` (the canonical fragments `ANTI_COLLAGE_RULE` / `STANDALONE_*` / `referenceGuidanceRule` / `seriesItemHeaderLine`) and is consumed by runtime media composers plus provider-gateway builders. This text is provider-only and must never be repeated in model-facing tool descriptions. (The fragments live directly in the contract index module rather than a sibling file because `@persai/runtime-contract` is consumed as un-built TypeScript source at runtime, so it must remain a single self-contained module.)

Precedence rule: if a rule compares two tools, chooses between tools, or explains when not to call a sibling tool, it belongs only in the selection guide. Descriptor text stays mechanical, and provider-rendering hygiene stays provider-only.

Canonical model-facing names are `knowledge_search`, `knowledge_fetch`, and `quota_status`. The catalog rows `memory_search`, `memory_get`, and `persai_tool_quota_status` remain hidden alias/remap plumbing for runtime wiring and credentials only; they are not separate prompt owners and must not carry competing model-facing instruction truth.

### Runtime preflight

- public API route: `GET /api/v1/assistant/runtime/preflight`
- owner: `apps/api`
- current behavior: checks PersAI-native runtime `/health` and `/ready` through `PERSAI_RUNTIME_BASE_URL`

### Web chat

- sync route: `POST /api/v1/assistant/chat/web`
- stream route: `POST /api/v1/assistant/chat/web/stream`
- stream reattach route: `GET /api/v1/assistant/chat/web/turns/:clientTurnId/stream`. **ADR-158:** SSE `reattached` sets `live: true` when the durable turn-stream bus can replay buffered events and follow live appends on this pod (Redis coordination store, or same-process memory). Soft-detach still does not Stop (ADR-149). Ordinary `POST …/stream` keeps writing the primary SSE response as today while also publishing every SSE-facing event onto the bus.
- hard-stop route: `POST /api/v1/assistant/chat/web/stop` (body: `{ "clientTurnId": string }`). **ADR-149 S1:** response `200` with `{ status: "stopped" | "already_done", clientTurnId }`, `404` `{ code: "turn_not_found" }`, or `403` `{ code: "stop_forbidden" }`. Durable Redis dispatch (`WebChatTurnStopDispatchService`) replaces the deleted in-memory registry; uses `PERSAI_TURN_COORDINATION_REDIS_URL` with fallback to `BROWSER_BRIDGE_REDIS_URL`. **ADR-158** uses the same Redis URL family for the ephemeral web turn stream bus (`WebChatTurnStreamBusService` behind `WebChatTurnStreamRegistry`; stream key `${assistantId}:${userId}:${clientTurnId}`); Postgres `AssistantWebChatTurnAttempt` remains status/terminal authority.
- turn-status route: `GET /api/v1/assistant/chat/web/turns/:clientTurnId` returns the durable logical-turn state (`unknown`, `accepted`, `running`, `completed`, `failed`, `interrupted`) plus committed user/assistant payloads where available; web/Capacitor clients use it before retrying ambiguous sends
- accepted generated-media requests on the web sync/stream routes may now complete quickly with an acknowledgement assistant message plus a durable `assistant_media_jobs` enqueue, instead of holding the request open until final artifact delivery
- accepted async document-tool requests return model-visible `pending_delivery` state (`canSendFileNow=false`) and surface `activeDocumentJobs` until backend delivery completes. Runtime open-document context now includes a compact `sourceSummary`, so the model can distinguish an older in-flight document task from the current user turn and must not claim a new document job was accepted unless this same turn actually returned a structural `pending_delivery` result with a real job id. ADR-112 Slice 7 narrows runtime-only prompt semantics: internal `RuntimeTurnRequest.openDocumentJobs` now carries only true render-in-progress jobs (`queued|running`), while post-render states (`fetching_output`, `ready_for_delivery`, very recent delivered rows) flow through the separate internal `jobDeliveryUpdates[]` seam so the model sees delivery/finalization rather than "still rendering". `AssistantDocumentJobDeliveryService` owns the final attachment and ready-message delivery.
- accepted async media-tool requests (`image_generate`, `image_edit`, `video_generate`) follow the same model-visible truth per ADR-105: `action:"pending_delivery"` with `canSendFileNow=false`, `messageToUser`, and count metadata (`requestedCount`/`expectedResultCount`); the model must not claim the media is ready/sent until backend delivery. Runtime open-media context now includes a compact `sourceSummary`, so already-open jobs are server truth about older tasks, not proof that the current turn started a new job. ADR-112 Slice 7 narrows runtime-only prompt semantics here too: internal `RuntimeTurnRequest.openMediaJobs` now carries only true worker-in-progress jobs (`queued|running`), while `completion_pending` plus very recent delivered rows move to `jobDeliveryUpdates[]` so runtime can say generation is finished and delivery is catching up or already landed. Web continuity stays unchanged through `activeMediaJobs`. One structured request remains exactly one media job — the runtime must not silently split or trim. For multi-image work, the model-facing path is now `series`-first: `image_generate` / `image_edit` should default to `outputMode="series"` with ordered `seriesItems[]` so each requested output is one distinct final frame/item (carousel slide, storyboard frame, separate poster, etc.) inside that single job. `variants` remains in the contract only as a compatibility fallback and is not the normal multi-image path. Runtime executes all multi-image outputs as multiple single-image provider calls within the same durable job so each output prompt is one-frame-specific instead of one shared collage-prone batch prompt. If a later item fails after earlier outputs were already persisted, runtime preserves the produced artifacts and returns a partial warning rather than collapsing the whole worker result to an empty failure. Media `perTurnCap` is measured in total result units (not tool calls). Enqueue admission is unit-aware and rejects the third concurrent open media job in a chat with an explicit structured `media_job_concurrency_limit` result (`limitKind`, `requestedUnits`, `activeJobs`, `maxActiveJobs`) instead of silently dropping it.
- web chat list/bootstrap rows expose compact `activeTurn` state plus optional `activeMediaJobs`, and `GET /api/v1/assistant/chats/web/:chatId/messages` returns committed history plus full `activeTurn` plus optional `activeMediaJobs`; clients render this server projection as continuity truth before falling back to local recovery hints
- web chat list management keeps archive and restore explicit: `POST /api/v1/assistant/chats/web/:chatId/archive` removes a chat from the active set without deleting history, while `POST /api/v1/assistant/chats/web/:chatId/unarchive` restores only an archived chat. Restore is atomic with the active-web-chat cap and returns `409` when the plan limit is already full.
- additive chat attachment payloads may now also expose `thumbnailStoragePath`, `posterStoragePath`, and `derivativesStatus` alongside canonical `path`. The main workspace path remains truth for runtime, download, and lightbox/playback; derivative paths are UI-only optimization hints and may be absent on legacy rows.
- ordinary multimodal direct-provider image attachments are a separate runtime consumption path from storage truth: runtime still reads canonical full/master bytes from object storage, but may transiently resize oversized images to roughly `2048px` max edge only for ordinary analysis/chat model input. `image_edit` source/reference images and media-tool reference paths continue to use canonical full/master bytes directly.
- ADR-100 Slices 2-5 add explicit chat mode to web-chat reads, updates, and the native runtime boundary. `AssistantWebChatState.chatMode` is `normal | smart | project`; `PATCH /api/v1/assistant/chats/web/:chatId` accepts `chatMode` alongside the legacy `deepModeEnabled` field. During migration, `deepModeEnabled` remains emitted for old clients and is derived from mode (`normal=false`, `smart/project=true`) when `chatMode` is supplied. Internal native web-turn calls now send both `chatMode` and the compatibility `deepMode` flag on `RuntimeTurnRequest`; runtime branches on `chatMode === "project"` for the project profile while `smart` continues to use the deep/premium path. Project chats now also stream additive project-only SSE events for activity stages and safe visible reasoning summaries; these are session-time UI hints only and do not expose raw provider thoughts.
- ADR-100 Slice 6B adds one more internal runtime/API seam for project retrieval only: runtime may send `gatherProfile: "project"` on the internal orchestrated-retrieval request so API can apply project-only source-stage ordering without changing ordinary non-project active-skill semantics. This is an internal control hint, not a public web contract.
- ADR-100 Slice 6C/6D/6E extends that same internal seam for project files without changing the public web contract: API may resolve canonical chat attachment-backed workspace paths for the current conversation, lazily run the existing internal file-extraction path once, cache the bounded extraction result on canonical file metadata, and inject bounded project-file context into the internal project gather response before KB stages. Public web APIs still expose the same file/chat truths; this is an internal runtime/API orchestration behavior change only.
- ADR-134 (path-keyed semantic index) adds an internal-only upload-analysis seam without changing the public web contract: after a hierarchical `/workspace/...` manifest row exists, API may enqueue `workspace_file_micro_description_jobs` keyed by `(workspaceId, path)` when `shortDescription` is still empty and policy allows. Deterministic STT/text_extract summaries upsert manifest `shortDescription` directly at register/upload paths; there is **no** `attachment.metadata.semanticSummary` mirror. The worker uses the existing `systemTool` model slot, persists summaries only on `workspace_file_metadata.shortDescription`, and appends non-blocking internal ledger rows (`purpose=tool_helper`, `source=upload_micro_description`, `surface=background`, `sourceEventId=workspace_file_micro_description_job:<id>`). Runtime `files.list`, restored `files.search`, and Working Files `semanticSummaryHint` join the same manifest field via `POST /api/v1/internal/runtime/files/short-descriptions`. Content changes (`replace` or `contentHash`/size/mime delta) clear stale summaries and force-refresh the background job. Runtime-generated outputs may also persist a direct bounded `generation_request` summary at creation time.
- `activeMediaJobs` is the ADR-086 continuity projection for open generated-media jobs (`queued`, `running`, `completion_pending`) backed by durable `assistant_media_jobs` state.
- web compaction-state routes (`GET /api/v1/assistant/chats/web/:chatId/compaction`, `POST /api/v1/assistant/chats/web/:chatId/compact`) read the current materialized runtime-bundle compaction config together with persisted session/compaction metadata; the config read must tolerate both the materialized runtime-bundle object and the persisted JSON-document form so banner/advisory state does not degrade when bundle storage shape varies
- ADR-087 adds a second user-visible quota path after successful turns: when an in-scope finite limit reaches the advisory threshold, API may append one assistant-authored follow-up message in the same active web chat thread. This is quota/advisory behavior, not a generic transport error banner.
- ADR-112 Slice 8 keeps quota-advisory follow-up generation on the internal background-evaluation seam but classifies it separately as `quota_advisory_evaluation`; compaction-exhausted follow-ups no longer use that runtime seam and instead create a bounded static notification intent from API-owned compaction facts after eligibility/suppression checks.
- API now also has internal runtime seams `POST /api/v1/internal/runtime/media-jobs/run` and `POST /api/v1/internal/runtime/media-jobs/complete`, used only by the backend media-job worker/delivery path. The first runs a synthetic tool-enabled media job outside the live user chat and returns assistant text plus produced artifacts; the second accepts the durable job id plus current API-built chat history context and returns optional bounded final framing text before backend-owned delivery.
- current active mode: native-only
- `apps/api` owns canonical message persistence, replay semantics, quota/media bookkeeping, and user-facing response shaping. Completed native turns should pass runtime `usageAccounting.entries` into API quota recording; API resolves Admin Runtime provider/model weights and persists one weighted Credits delta, using the text estimator only as an explicit fallback when runtime usage is absent. ADR-099 Session C keeps that quota path additive while widening the internal ledger write on high-confidence persisted paths: after the assistant reply is persisted, API appends immutable `model_cost_ledger_events` rows for both main-reply chat model usage (`chat_main_reply`) and the existing router/classifier system-tool usage entries (`router`) on the ordinary web sync, ordinary web stream, and ordinary Telegram sync paths, and successful background-task evaluator runs now append one `background_task` row after the corresponding `assistant_background_task_runs` row durably stores the evaluator `usageJson` snapshot. Those background-task rows price against the persisted run-start timestamp on the durable run row rather than a later scheduler-finished timestamp, preserving replay-safe timestamp-matched catalog lookup while leaving user quota semantics unchanged. Retrieval-helper/reranker usage remains intentionally out of this boundary because current knowledge observability persistence does not yet expose a clean replay-safe per-helper source seam. ADR-099 Session D extends the admin-read boundary additively: `GET /api/v1/admin/business/platform` now returns a compact last-7-day ledger-backed model cost summary, and `GET /api/v1/admin/ops/cockpit` now returns a compact current-quota-period ledger-backed model cost summary for the selected workspace. Both responses explicitly describe the current covered ledger set and do not claim full-platform economics. Subscription-period monthly media quota snapshots and mutations are API-owned state backed by `workspace_media_monthly_quota_counters`: runtime may reserve media units through internal API before provider work, while `MediaDeliveryService` settles only successful delivery and records no-delivery outcomes as reconciliation-required.
- `apps/runtime` owns request-time execution
- SSE socket close on the stream route does **not** abort the runtime turn. Only an explicit POST to the hard-stop route flips the runtime's abort signal. A passive disconnect (tab background, screen lock, network drop) lets the runtime finish, persists the full assistant message, and is recoverable on next history fetch.

ADR-148 adds no new public HTTP routes. Its boundary change is internal to the
sandbox control plane: after a session-scoped sandbox job reaches terminal
persistence, the pod is now either (a) cleaned and kept warm for reuse or (b)
retired fail-closed on cleanup-proof failure. Sessionless jobs still retire.

**ADR-150 (closed):** no new public routes. Install-layer paths under the session root
(`.local`, `.npm-global`, `node_modules`) are excluded from produced-file GCS
mirror, hydrate, runtime manifest upsert, Files gallery, `files.list`, and
`files.search`. Ordinary work-artifact persistence is unchanged.

**ADR-151 (closed 2026-07-17) + Scenario-scoped Script follow-through:** the
runtime boundary is one synchronous model-mediated `script.execute`, projected
to the model as the tool name `script`
(`{action:"execute", scriptKey:string, input:object}`) when the active
Scenario binds at least one materialized step `scriptRef`. Availability is
Scenario-scoped (any step of the active Scenario, not only the current
operational step). Projection is re-verified (not trusted) immediately before
dispatch by re-deriving Scenario membership from live Skill/Scenario state and
re-fetching the pinned artifact through the internal read boundary above. It
resolves the exact immutable published version, validates the bounded mapped
input/result against the published input/output JSON Schemas, derives a
server-only `scriptInvocationKey`, and uses the existing `SandboxJob`
lifecycle (`RuntimeSandboxJobRequest.scriptVersionId` /
`.scriptSkillId` / `.scriptContentHash` / `.scriptInvocationKey`) with atomic
create-by-`(assistantId,
scriptInvocationKey)` admission and stable idempotency/conflict/replay
semantics. The sandbox independently rechecks assistant Role/effective Skill,
SkillScript link, Script/ScriptVersion publish state, and complete canonical
content hash before admission and immediately before execution; request code
is never trusted. Input is validated before persistence and output before
terminal success. The internal artifact request parser accepts exact bounded
keys only. There is no new `ScriptRun` table or endpoint. It creates no
direct MCP execution boundary, no browser/Tool SDK/async `jobRef`/`wait`/
`notify` boundary, and no managed-secret API. Those remain ADR-152/153 scope.
Until ADR-153, code/input credentials are unmanaged values with no promised
redaction, TTL, revoke, or log-history protection.

**ADR-152 / ADR-157 (await follow-through):**
adds no public execute endpoint. Runtime projects one model tool, `await`, over
server-minted opaque assistant-owned job refs. `wait` resolves terminal state
first (empty/all-terminal + positive `timeoutMs` is a pure timer), caps at
300000 ms, admits up to 20 waits per dispatched turn, and does not cancel the
canonical job. Explicit shell/exec `background:true` returns an opaque `jobRef`
immediately on a warm session; sessionless pods fail closed. `notify` writes
durable same-row subscription state and returns non-terminal
`turnControl:"continue"`; a terminal completion later re-enters only the
original active chat/channel with fresh runtime hydration and no duplicated
attachment delivery. The internal runtime/API boundary resolves handles against
owned media, document, and sandbox adapters, returning foreign/tampered handles
as not found. Background-task-run adapters remain deferred.

The only Script browser boundary is an immutable-manifest capability-gated
`{browser:{actions:["snapshot","act"]}}` request through the existing
`RuntimeBrowserToolService` and ADR-140 profile/bridge seams. A structured
profile input is mandatory; Script code cannot list profiles, start login,
open live views, request user action, select another device, use a bridge URL,
or receive bridge/internal credentials. Telegram and unavailable/foreign
profiles preserve existing fail-closed or `open_in_app` responses. The
job-scoped broker is ephemeral live-exec stdin/stdout coordination, not a
public browser service or a durable Script resume API.
The runtime supplies an unguessable, expiring broker binding only on the
bearer-protected runtime-to-sandbox request. It is not persisted in the
SandboxJob payload. Sandbox and runtime exchange bounded strict Redis envelopes;
sandbox strips broker id, auth token, job id, device, and internal routing before
writing the SDK response to inherited FD 4. SDK requests leave through inherited
FD 3 while ordinary Script stdout/stderr and result-marker parsing retain their
existing boundary. Only the runtime consumer calls `RuntimeBrowserToolService`
with original turn ownership/channel/device/abort/progress context. Ordinary
Scripts use the previous buffered exec path and never initialize broker Redis.
Before broker registration, runtime may call the bearer-protected read-only
`POST /api/v1/jobs/script-terminal-replay`; sandbox returns a job only when the
assistant, server-derived invocation key, immutable Script version/content hash,
canonical input hash, and terminal state all match. This seam cannot create or
admit work. Broker transport payloads are not automatically persisted/logged,
but a Script can deliberately include SDK-derived data in ordinary authored
output, which remains persisted `SandboxJob` output.
Checkpoint 4 Admin/MCP manifest authoring is committed at `3def3fe2`:
Admin Scripts UI and MCP `script_version_upsert` may set or omit
the exact optional `manifest.capabilities` object
`{browser:{actions:["snapshot","act"]}}`; when present, authoring clients
require `inputSchema` to include a string `profile` property in `required`
(API publish/validate already enforce the same coupling). Wrong capability
shapes are rejected at the MCP Zod boundary. A first independent audit returned
DIRTY (3 P2 docs only); repairs landed and the final status re-check returned
CLEAN. Checkpoint 3/4 are not deployed or live-accepted.

**Checkpoint-5 rollout/rollback boundary (final local audits CLEAN):** new
runtime uses only
`POST /api/v1/internal/runtime/media-jobs/v1/enqueue` and
`POST /api/v1/internal/runtime/document-jobs/v1/enqueue`. API retains each
unversioned enqueue/status/subscribe route only for old runtime clients. The
new runtime has no unversioned fallback; a pre-repair API does not route `v1`
and rejects before controller work or canonical media/document enqueue side
effects. This protocol barrier survives absent Helm waves/hooks and covers all
ADR-152 runtime→API enqueue/handle seams. A real Nest HTTP test proves
legacy/v1 route binding, internal bearer denial, and v2 404 before handler
effects. Independent Terra/Sonnet final re-audits and the parent full
repository gate are CLEAN; push, deploy, and live acceptance remain pending.

- The web client performs a best-effort latest-history refresh on `focus`, `visibilitychange` back to visible, and `pageshow`, so a passive disconnect that already committed server-side is reconciled without requiring a manual page reload.
- the hard-stop route is idempotent with explicit outcomes. Terminal attempt `errorCode: "user_stopped"` on successful Stop; next-turn hydration includes explicit user-stop fact.
- **ADR-149 S2:** web stream uses `PERSAI_RUNTIME_TURN_WALL_CLOCK_MS` (default 30 min) + progress-only idle stall `PERSAI_RUNTIME_TURN_IDLE_STALL_MS` (default 5 min). Stall → public `turn_idle_stall`; wall clock → `runtime_timeout`. `video_generate` worker timeout no longer inflates the whole turn ceiling. Cadence `slow_avg` / `silent` remain disabled.
- attachment staging under `POST /api/v1/assistant/chat/web/stage-attachment` accepts `clientTurnId` and `clientAttachmentId`; repeated staging for the same logical attachment returns the existing canonical staged attachment instead of creating a duplicate bubble
- ADR-099 media/STT/TTS foundation adds an additive internal contract seam only: runtime/provider-gateway media and transcription responses may now include normalized `billingFacts`, and API persists those facts on `assistant_media_jobs` or `assistant_chat_message_attachments` without writing ledger rows yet
- before a new user message is persisted, inbound web-chat preparation now enforces two distinct limits from plan truth: internal `activeWebChatsLimit` for rare new-thread admission, and user-facing `messagesPerChat` for calm per-chat length gating. `messagesPerChat` failures are returned as product-shaped `chat_message_limit_reached` conflicts so the client can show a gentle "continue in a new chat / upgrade" banner instead of raw quota language.
- ADR-115 Slice 0 adds a read-only inbound safety gate on the API control plane before spam throttle and quota. Canonical inbound order in `PrepareAssistantInboundTurnService` and `HandleInternalTelegramTurnService` is now **`safety restriction -> abuse throttle (ADR-044) -> quota/capability -> runtime`**. An active `user_restrictions` row with `kind=safety` denies inbound with HTTP `403` and API code `safety_restricted` (`category=forbidden`, `details.reasonCode`); this is distinct from `rate_limited`. Contour-1 heuristics, Moderation API, and admin safety UX remain later slices; empty `user_restrictions` keeps prior behavior aside from the intentional abuse-before-quota reorder.
- ADR-115 Slice 1 adds contour-1 sync precheck between abuse and quota: `EvaluateInboundSafetyPrecheckService` reads `safety_heuristic_rules` + `safety_policy_settings`, routes `allow | defer_contour_2 | block_obvious`, and enqueues durable `safety_moderation_review_jobs` on defer/block_obvious when contour-2 is enabled. Admin policy API lives at `/api/v1/admin/safety-policy/*` (no web UI in this slice). Precheck never auto-creates `user_restrictions`; C1 does not deny inbound in 115.1 (hold/sync deny lands in 115.3; auto-ban in 115.2).
- ADR-115 Slice 2 adds contour-2 async worker in API: `SafetyModerationReviewSchedulerService` claims `safety_moderation_review_jobs`, `ProcessSafetyModerationReviewService` loads trigger text + recent thread messages, calls OpenAI Moderation API (`moderationModelId` from `safety_policy_settings`), persists `moderation_cases`, and upserts active `user_restrictions` on `block_user`. Block decision is moderation-driven (category scores / `flagged`), not contour-1 heuristics alone. Config: `SAFETY_MODERATION_*` in `packages/config` (`ENABLED`, poll/batch knobs, thread window, block score threshold, optional `OPENAI_API_KEY` override). Admin notification on restrict remains slice 115.5.
- ADR-115 Slice 3 adds inbound deny wiring: high-confidence `violence_extremism_explicit` routes to `hold_and_defer_contour_2_sync` (sync moderation hold up to `syncHoldTimeoutMs` before runtime). Sync `block_user` denies with HTTP `403 safety_restricted` (`details.reasonCode`) and optional system chat notice stub; defer routes still proceed with async enqueue. Web maps `safety_restricted` separately from `rate_limited`.
- ADR-115 Slice 4 adds ops safety controls: `GET/POST /api/v1/admin/safety-controls/*` for active restriction drill-down, moderation case lookup, admin unblock, and manual restrict (`admin.safety_user.restrict` step-up). Ops cockpit exposes `safetyRestriction` + `safety_restricted` incident signal; user directory exposes `safetyStatus`. Abuse unblock must not clear `user_restrictions`.
- ADR-115 Slice 6 adds runtime policy UI backing: OpenAPI/contracts for `GET/PUT /api/v1/admin/safety-policy/heuristic-rules` and `GET/PUT /api/v1/admin/safety-policy/settings`; web `/admin/runtime` **Inbound Safety** section edits contour-1 packs and routing knobs separately from router `precheckRuleOverrides`.
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
- Telegram integration config now exposes `telegramAccessMode` (`owner_only` | `group_members`) alongside the existing `groupReplyMode` (`mention_reply` | `all_messages`). `groupReplyMode` decides when group text is eligible for handling; the webhook access gate then keeps private DMs owner-only and allows non-owner group senders only for active linked `assistant_telegram_groups` rows. Accepted Telegram turns preserve clean persisted user text, store Telegram sender/chat facts in message metadata, and pass structured `channelContext.telegram` over the internal native runtime boundary so runtime can render centralized Telegram channel context without mutating the user message. Group-only privacy cautions are rendered only for group mode; Telegram audio/voice-like inbound attachments add a concise voice-reply hint when TTS is available. Telegram integration state resolve auto-renews governance SecretRef TTL for healthy active bindings (lead window before `expiresAt`); computed `expired` still counts as connected for Settings/`connectionStatus` until revoke or `invalid_token` — TTL is a rotation reminder, not a disconnect signal.
- once a Telegram text/tool turn has been accepted by runtime (`started` on the native stream), API treats a stream/bridge failure before a terminal event as ambiguous rather than terminal: it retries the same runtime stream request with the same `idempotencyKey` and waits for the persisted runtime turn receipt to replay the completed result before sending any fallback copy.
- ADR-087 applies the same quota/advisory semantics to Telegram as to web: when an in-scope finite limit reaches the advisory threshold, backend-owned delivery may append one assistant-authored follow-up message in the same Telegram thread rather than surfacing only transport-layer fixed error copy.
- accepted generated-media Telegram requests now complete the webhook quickly with an honest acknowledgement assistant reply plus a durable `assistant_media_jobs` enqueue instead of waiting for final provider/media completion inside the webhook lifecycle.
- the same backend `assistant_media_jobs` scheduler and `POST /api/v1/internal/runtime/media-jobs/run` seam now execute Telegram media work too.
- before final delivery, backend completion processing may call `POST /api/v1/internal/runtime/media-jobs/complete` with current canonical chat history to get optional fresh-history framing text; backend completion delivery still owns terminal state and actual web/Telegram delivery.
- standalone `POST /api/v1/media/transcribe` remains a live runtime seam only for now; it is intentionally not yet a ledger-covered or separately durably-rowed billing event until ADR-099 adds a dedicated replay-safe persistence seam

### Web presentation PPTX preparation BFF

- `apps/web/app/api/assistant-document/[docId]/prepare-pptx/route.ts` is the authenticated same-origin BFF for optional user-confirmed PPTX preparation from an already delivered Gamma PDF presentation.
- The client must not send an `Authorization` header to this BFF because Clerk middleware can treat it as request auth instead of using the browser session cookie. The route prefers the PersAI-owned same-origin `X-PersAI-Session-Token` header when present because the client obtains it with a fresh Clerk token call; otherwise it falls back to server-side `auth().getToken()` from cookies. The chosen token is forwarded upstream as `Authorization: Bearer ...`.
- Upstream `POST /api/v1/assistant/documents/:docId/prepare-pptx` is an authenticated assistant API route and must stay registered under `ClerkAuthMiddleware`, the same as the authenticated workspace file download routes.
- This endpoint does not call Gamma's internal `api.gamma.app/export/docs/:docId/pptx/url` web-app API. It enqueues a separate Gamma `pptx` document render through the existing document-job lane, after an explicit user confirmation, and consumes the normal monthly `document` quota only on successful delivery. Repeated clicks are idempotent against an already delivered PPTX or an active PPTX render job for the same current presentation version.

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
- `/admin/knowledge` owns the active Knowledge model truth for Product KB, Skill KB, and assistant-uploaded knowledge embeddings. `embeddingModelKey`, `retrievalModelKey`, and `authoringModelKey` live on the admin knowledge retrieval policy; plan payloads no longer own an `embeddingModelKey`
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
- delete archives a Skill rather than hard-deleting the product concept; ADR-147 S2 performs the active-Role-link guard and archive update transactionally without depending on removed direct assignments
- Skill document upload/reindex creates pending DB indexing jobs; the API indexing worker processes Skill documents through the same normalized source/chunk/vector boundary as assistant and Product knowledge
- ADR-080 Skill knowledge cards and assistant-assisted Skill drafts belong to the admin Skill surface; generated proposals must not become active runtime knowledge without explicit admin save/activation
- assistant-assisted Skill draft/enrichment is API/control-plane authoring that calls provider-gateway using the admin Knowledge `authoringModelKey`; it is not a runtime chat turn and does not mutate saved Skill or Knowledge rows unless the admin saves the proposal
- `/admin/skills` is the admin UI owner for Skill list/create/edit/archive and Skill document upload/delete/reindex/status management; `/admin/knowledge` remains Product KB and must not expose the old Skill library scope

### Admin Roles

ADR-147 S4 adds the admin Role constructor boundary (local, not deployed):

- `GET /api/v1/admin/roles`
- `POST /api/v1/admin/roles`
- `POST /api/v1/admin/roles/preview`
- `GET /api/v1/admin/roles/:roleId`
- `PATCH /api/v1/admin/roles/:roleId`
- `DELETE /api/v1/admin/roles/:roleId`
- `PUT /api/v1/admin/roles/:roleId/skills`

Active boundary rules:

- Role `key` is required on create and immutable on update
- localized `name` / `description` / `mission` require non-empty `ru` and `en`
- default Role `persai_default` keeps key/active status/empty Skills immutable; localized copy and bounded presentation remain editable
- any Role used by an Assistant cannot leave active status; archive rejects default and in-use Roles
- core Role edits dirty every Assistant using that Role without clearing chat Skill state
- Skill replacement is full ordered replace only, locks `Skill -> Role -> Assistant -> Chat -> RoleSkill`, dirties affected Assistants from the post-lock DB clock, and clears both chat Skill fields
- `POST /preview` returns production-identical `missionBlock` / `enabledSkillsBlock` from the shared renderer pipeline
- `/admin/roles` is the admin UI owner; MCP Role tools are thin HTTP wrappers over these routes plus owner `PUT /assistant/{assistantId}/role`

### Assistant Roles

ADR-147 owns assistant specialization through Role APIs only:

- `GET /api/v1/assistant/roles`
- `GET /api/v1/assistant/{assistantId}/role`
- `PUT /api/v1/assistant/{assistantId}/role`

Active boundary rules:

- Role GET/PUT requires the exact Assistant owner (`Assistant.id`, workspace, and `Assistant.userId`), not workspace membership alone. PUT accepts exactly `{roleKey}`, locks current+target Role ids in sorted order before the Assistant/chat rows, revalidates the current `roleId`, and bounded-retries from a fresh snapshot on a concurrent assignment before applying its own dirty/reset/audit.
- Effective prompt cards, compact summaries, scenarios, Skill Knowledge authorization, and invalidation resolve only through `Assistant.roleId -> AssistantRoleSkill -> active Skill`. Direct per-assistant Skill selection routes and plan Skill-count limits are removed from the active contract; S5b drops the physical assignment table/enum after idempotent plan Skill-limit JSON cleanup (local, awaiting parent audit; Release C not deployed).
- `POST /api/v1/assistant/publish` accepts exactly `{assistantId, expectedRoleKey, roleKey}`. The API locks and revalidates the Assistant's current Role against `expectedRoleKey` inside the outer publish transaction before Role assignment, published-version creation, audit, or apply-pending mutation. Drift returns stable `409 assistant_publish_role_conflict`; it is never auto-rebased to the newer Role. Setup/recreate send canonical-current expected plus the selected desired Role. Ordinary Settings Save and existing MCP `assistant_publish` preserve Role by sending expected equal to desired after canonical GET, so concurrent Role changes conflict instead of being overwritten.
- Internal engage/release requests require the materialized bundle's `expectedRoleId`. API validates `assistantId`, `expectedRoleId`, and engage `skillId` as UUIDs before raw casts; malformed values return stable typed 400 validation. Skill-related persistence locks `Skill -> AssistantRole -> Assistant -> AssistantChat -> AssistantRoleSkill`. Release first reads an unlocked chat candidate to identify the Skill, then revalidates locked chat state under canonical locks and bounded-retries a changed candidate without writing. Missing/stale Role identity or missing/inactive linkage returns `applied:false`, `stale_assistant_role_snapshot`; runtime does not retry or claim persistence.

### Internal runtime

Current active internal service endpoints are served by `apps/runtime`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/turns/create`
- `POST /api/v1/turns/stream`
- `POST /api/v1/internal/runtime/document-jobs/run`

These are internal runtime-service boundaries, not a public legacy gateway surface.

Runtime turn results may include compact `turnRouting.retrievalPlan` diagnostics. **ADR-120 (pull-first)** retired the always-on server pre-push: the router plan no longer feeds a server-side retrieval orchestration boundary. Retrieval is the model's job — it pulls knowledge via the `knowledge_search` / `knowledge_fetch` tools (Skill, user, Product, memory, chat sources) and reads project files via the `files` tool on demand. The `retrievalPlan` survives only as a compact routing/observability signal, not as a trigger for a pushed knowledge block.

ADR-097 adds one more internal runtime execution seam for the backend document worker. `POST /api/v1/internal/runtime/document-jobs/run` is an API-owned background-worker boundary: API sends persisted job truth plus the current materialized runtime bundle, runtime executes presentation delivery or historical persisted jobs, and runtime returns worker-only result truth (`artifacts`, optional `assistantText`, and provider-status metadata). **ADR-132 collapsed the model-facing document surface to exactly three verbs** — `document.inspect` (semantic structured view of a source; internally runs extract+OCR through the API-owned `DocumentExtractionService`), `document.render` (authors PDF/DOCX/XLSX from Markdown `content` or `contentPath`, always persisting the Markdown source as a visible sibling `.md` file next to the output for revisions), and `document.convert` (pure format conversion between PDF/DOCX/XLSX for an existing workspace file). The removed legacy verbs `document.extract`, `document.edit`, and `document.register_version` are hard-rejected at the parser and no longer exist as descriptorModes on the model-facing surface. Auto-registration of persisted document outputs (D4 identity registry) runs server-side as metadata enrichment on `document.render` / `document.convert` success and on `files.attach` of a doc-extension file (pdf/docx/xlsx); repeat renders/converts/attaches at the same `outputPath` register `v+1` against the same `docId` when inspection metadata is available, with historical version bytes preserved immutably in GCS keyed on `(path, version)` and the workspace path always serving the latest bytes. Chat delivery is not gated by this enrichment: `files.attach` creates the attachment row for an existing allowed workspace file first, then attempts inspect/register/documentLink enrichment best-effort. New `create_pdf_document` and `create_data_document` enqueue attempts are rejected before background job creation. Presentations still render through Gamma and deliver a persisted PDF artifact to chat; explicit user-confirmed PPTX preparation reuses the current presentation version's source/request snapshot, changes only the requested output to `pptx`, enqueues a second Gamma render through the same document-job lane, and is charged through normal successful document quota settlement.

ADR-123 Slice 6 added **documents mode B (create-only)** for data-document persistence and historical worker compatibility. ADR-129 retired that opaque normal path from the model-facing document workflow, and ADR-132 finalized the surface: native XLSX/DOCX/PDF work now goes through the three-verb model-facing surface (`document.inspect`, `document.render`, `document.convert`) plus `files.attach`, with an escape into `shell + python` (openpyxl / python-docx / weasyprint) for complex XLSX with formulas/charts, targeted edits of uploaded documents, custom layouts, or data-driven document assembly (Case B). Existing `create_data_document` rows still read back as `documentType: "data_document"` with `xlsx`/`docx` output facts, and internal compatibility code may still validate already-created artifacts, but new ordinary generation goes through the visible three-verb + optional `shell` path — not a hidden worker model.

ADR-123 Slice 7 adds two **inline** workspace tools — `grep` and `glob` — over the existing `RuntimeSandboxJobRequest`/`RuntimeSandboxJobResult` seam. They are projected to the model as `executionMode: "inline"` and dispatched (like the `files` read path) as sandbox jobs with `toolCode: "grep"` / `toolCode: "glob"`, but they execute on the sandbox **control plane** as trusted PersAI-owned subprocesses invoking the preinstalled `rg` (ripgrep) / `fd` binaries against the hydrated `workspaceRoot` — they never run in a gVisor exec pod (`ExecPodBridgeService.runInPod` is not on this path), so the D2 control-plane secret-free/trusted invariant holds (trusted binary + model **data** args, not model-authored commands). Model-supplied values (pattern, glob/type filters, path) are passed as an argv ARRAY with a `--` terminator (never a shell string), and the optional `path` is contained inside `workspaceRoot`; each run is bounded by `policy.maxProcessRuntimeMs` (hard timeout), `policy.maxStdoutBytes` (output cap), and a match/path count cap (grep 200 matches, glob 500 paths) with a `truncated` flag. Results are returned through the existing sandbox job `resultPayload.content` as JSON and surfaced to the model as the new contract result types `RuntimeGrepToolResult` (`matches[{file,line,text}]`, `matchCount`, `truncated`) and `RuntimeGlobToolResult` (sorted relative `paths`, `truncated`). `grep` is for workspace content search (preferred over `shell grep`/`bash rg`) and `glob` for filename discovery (preferred over `shell find`/`fd`); `shell` remains the autonomous multi-step execution surface. The control-plane sandbox image must carry `rg`/`fd` on PATH for this boundary to function.

ADR-097 document source extraction is API-owned. Under ADR-132 the visible document workflow calls API extraction explicitly through `document.inspect`, which internally runs the same API-owned extract+OCR pipeline (`DocumentExtractionService`, provider-backed OCR, quality metadata) and returns a semantic structured summary to the model without exposing an intermediate model-facing `extract` verb. The API-owned inspection sidecar (`<outputPath basename>.inspect.json`) is written into `/workspace` alongside the source and is consumed by the D4 registry when auto-registering a version. Transient source attachments may still be forwarded as `RuntimeDocumentJobRunRequest.sourceFiles[]` for presentation delivery or historical persisted worker jobs, but active PDF/DOCX/XLSX work should not depend on hidden transient extraction. Runtime must not duplicate Knowledge OCR/provider-selection logic or hold Mistral/LlamaParse credentials.

ADR-079 Steps 11-12 originally added an internal runtime-to-API retrieval execution **push** boundary (`POST /api/v1/internal/runtime/knowledge/orchestrate`) that returned a bounded source-aware `Retrieved Knowledge Context` block. **ADR-120 Slice 5 removed this entire always-on push subsystem** — the orchestrate service/controller/tests, the internal endpoint, the runtime client method, the flat `# Retrieved Knowledge Context` developer block, and the `RuntimeRetrievedKnowledgeContext*` contract types are all gone, and the ADR-119 `<persai_retrieved_knowledge>` push contract is **superseded by pull** (ADR-120 D6). Retrieval is now pull-first and universal (project and ordinary turns): the model locates with `knowledge_search` and reads with `knowledge_fetch`, retrieved knowledge flows back as tool results (never a pushed block), project files are read on demand via the `files` tool, and the engine returns honest ANN + reranked + floored results or nothing. The API still owns source policy, Skill assignment revalidation, ready-document enforcement, and durable source-level retrieval observability **on the tool path**; web work remains on the `web_search` / `web_fetch` tools.

ADR-094 (2026-05-13) extends the runtime knowledge contract additively. `knowledge_search` response hits may now carry optional `inlinedDocument`, `inlinedSection`, and `documentSummary` payloads when the server detects exactly one hit and the document fits the per-plan smart-search thresholds (`smartSearchShortDocChars`, `smartSearchMediumDocChars`); multi-hit results stay snippet-only. `knowledge_fetch` arguments now require `mode` (`short` | `section` | `full`) with optional `radius`; `mode = "section"` is the permanent contract default that the runtime tool layer applies when callers omit it (this is the steady-state default, not a deprecation alias). `mode = "full"` is bounded by `min(plan.fetchFullModeMaxChars, admin.fetchFullModeAbsoluteMaxChars)` for documents and `min(plan.fetchFullModeMaxChatMessages, admin.fetchFullModeAbsoluteMaxChatMessages)` for chat sources, with `truncated: true` and a structured `truncationMarker` when the cap is hit. Existing `knowledge_search` response fields and existing `knowledge_fetch` callers without `mode` keep working.

**ADR-120 Slice 6 (snippet-first default + atomic-card exception)** flips the admin `smartSearchEnabled` ceiling default to `false` (fresh/unset installs): `knowledge_search` returns snippets + reference id + score only, and content is pulled through an explicit `knowledge_fetch` (the Anthropic progressive-disclosure pattern, ADR-120 D4). This is a default change only — no stored data migrates, and the per-plan `smartSearchShortDocChars` / `smartSearchMediumDocChars` inline bands still apply when an admin re-enables smart search. The single principled exception is the atomic `skill_knowledge_card`: even when smart search is snippet-only, a card hit returns its FULL card text inline (`inlinedDocument`), bounded by `min(max(plan.fetchMaxChars, plan.smartSearchShortDocChars), admin.fetchFullModeAbsoluteMaxChars)`, because a truncated snippet of a self-contained card loses meaning. The 16 per-plan retrieval knobs are unchanged on the wire; the admin Plans UI now exposes a `lean` / `balanced` / `rich` retrieval preset that fills all 16 raw fields at once (UI fill-helper only — there is no persisted `retrievalPolicy.preset` field and no contract change).

ADR-079 follow-up (2026-05-04): the `retrievalPlan` carried over this internal boundary now also includes an `ordinarySourcePriorityMode` field with values `personal_first`, `product_first`, `web_first`, `mixed_ambiguous`, or `not_applicable`. Active-Skill turns and trivial continuation turns send `not_applicable` and continue to use the staged Skill-first policy. Ordinary non-Skill turns send the precheck/classifier-derived mode, and the API orchestrator translates it into a stage-priority merge over `skill -> user -> product` without changing which sources are searched. The `web_search` / `web_fetch` path remains the only place where actual web work happens; the orchestrator only records honest web policy state for non-executed web grounding. Runtime model-visible `knowledge_search` / `knowledge_fetch` enums are now `document`, `memory`, `chat`, `subscription`, `global`; the previous `preset` value has been removed because prompt presets are not a model-facing knowledge source. Retrieval observability adds `policyState` values `ordinary_personal_first`, `ordinary_product_first`, `ordinary_web_first`, `ordinary_mixed_ambiguous` alongside the existing active-Skill states.

### Internal runtime → API back-channel

Current active internal `runtime → api` endpoints (served by `apps/api` on the dedicated `API_INTERNAL_PORT=3002` listener, gated by `PERSAI_INTERNAL_API_TOKEN`):

- `POST /api/v1/internal/runtime/memory/hydrate-for-turn` — returns the always-on `core` durable memory block and bumps `last_used_at` on every hydrated entry. **ADR-120 Slice 1** retired the always-on relevance-retrieved `contextual` tail this endpoint used to also return (it pushed assistant-scoped facts into the recency zone, causing cross-chat bleed); cross-chat / old-fact recall is now pull-only via the `knowledge_search` `memory` source. Each hydrated `core` item still carries the existing nullable source `chatId` so runtime can render compact `this chat` / `past chat` source markers when the current chat id is known.
- `POST /api/v1/internal/runtime/memory/open-loop-refs` — returns a small latest-active unresolved open-loop ref set for the runtime-only resolver developer block, so `memory_write({ action: "close", ref })` can still target the correct row on follow-up turns even when the visible cross-session carry-over block is absent. This path is bounded and compact by design; it is not a user-visible memory listing surface.
- `POST /api/v1/internal/runtime/files/search` — **ADR-134.** Runtime-only manifest search for the model-facing `files.search` action. Accepts `workspaceId`, `assistantId`, optional `sessionId`, and a tokenized `query`; returns ranked manifest rows with hierarchical `path`, `shortDescription`, mime/size facts, and scope metadata. Matches path basename and `shortDescription` in memory after a bounded manifest fetch. Gated by `PERSAI_INTERNAL_API_TOKEN`.
- `POST /api/v1/internal/runtime/files/short-descriptions` — batch join of `workspace_file_metadata.shortDescription` for a list of paths (used by runtime `files.list` enrichment and Working Files hydration).
- `POST /api/v1/internal/runtime/files/chat-attachments` — runtime attach registration seam (`RegisterChatAttachmentService.executeFromRuntime`).
- **ADR-140 current implementation:** browser profile seams remain under `POST /api/v1/internal/runtime/browser-profiles/*` (gated by `PERSAI_INTERNAL_API_TOKEN`): `list` (runtime `browser.list_profiles`), `resolve` (profile lookup + business errors for tool execution), `start-login` (`browser.login`), `touch` (sliding TTL after successful profile use), and `complete-login` (web/app modal «Готово» path). Public assistant settings/chat routes remain `GET /api/v1/assistant/:assistantId/browser-profiles`, `DELETE …/:profileId`, `POST …/:profileId/reconnect`, `POST …/:profileId/open-live`, `POST …/:profileId/complete-login`. `open-live` accepts the current connected surface's optional `bridgeDeviceId`; successful dispatch derives `deviceKind` from the authenticated bridge registration and atomically rebinds both profile session ref and client kind to that selected device. Here `:profileId/reconnect` means reopening product-owned re-auth on the same saved profile row; it is not a revived Browserless `/reconnect` compatibility path. Web chat turn completion/stream terminal + chat list expose optional `pendingBrowserLogin` for auto-opening the local-bridge login modal. The published modal state is `{ profileId, profileKey, displayName, loginUrl, bridgeClientKind, completionMode? }`; `liveUrl` is not part of the active contract.
- Active browser-profile boundary rules:
  - persistent authenticated browser work runs only through the local browser bridge path; no revived legacy reconnect branch or persistent Browserless session path is active boundary truth
  - every interactive web/app turn declares its current extension/Capacitor kind and may carry that surface's connected bridge ID in `channelContext.web`; when present, the ID is a strict target (never a fallback preference), while a declared surface with no connected ID fails locally instead of dispatching to another installation; successful commands rebind profile affinity from relay-authenticated truth
  - `browserPreview` is a Capacitor plugin event, not an HTTP/runtime API: bounded in-memory preview bytes stay on the device and are neither accepted nor returned by PersAI server routes
  - local `observerOnly` / `set_observer_lock` command fields are bridge-client lifecycle controls, not public HTTP actions or model-facing browser operations; they keep a used profile read-only through stream completion, while ordinary `open_view` remains the explicit user-action ownership transfer
  - product-owned recovery must distinguish `pending_login`, reconnectable re-auth, and truly expired profiles before the assistant narrates expiry
  - ordinary web chat must not expose assistant-visible browser live URLs; web/app re-auth is modal/banner state owned by product UI
  - Telegram may still use headless Browserless for public no-profile reads, but logged-in/profile-backed browser work must return structured `open_in_app` / `bridge_unavailable` semantics with honest PersAI web/app handoff copy
  - `browser` `act` accepts up to 12 chained operations (`goto`, `hover`, `extract`, selector ops); `stayOnPage` requires a saved profile and skips leading navigation; results include `page.elements` and optional `page.extracted` (runtime-contract shapes; authenticated work executes through the local bridge, while no-profile public reads may still use ephemeral Browserless)
- `GET /api/v1/internal/smoke/turn-receipts` — read-only smoke harness receipt query.

Other internal `runtime ↔ api` boundaries (bundle resolution, attachment hydration, etc.) are separate runtime-bundle endpoints and are not part of this back-channel.

### Sandbox

Current active internal sandbox endpoints are served by `apps/sandbox`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/jobs`
- `GET /api/v1/jobs/:jobId`
- `POST /api/v1/jobs/workspace-write-control-plane` — API-only upload pod hydration (not a model tool)

**ADR-137 pod boundary:** sandbox jobs are **execution-only** (`shell`, `exec`, `execute_document_code`, `render_html_to_pdf`). Model-facing `files.*`, `grep`, and `glob` no longer dispatch sandbox jobs; they use the storage plane (`GCS` + `workspace_file_metadata` + internal runtime files API). Retired: `POST /api/v1/jobs/workspace-write` and sandbox `toolCode: "files"`.

These are internal runtime-to-sandbox boundaries for isolated exec/document work, not public product APIs.

**ADR-146 closed boundary (Slice 1 `775e5781`, deployed and live-accepted):**
owner-authenticated
`GET/PUT /api/v1/assistant/{assistantId}/sandbox-egress` with the exact mode
enum `restricted | full_public`. The value is immediate Assistant operational
truth, not an assistant draft/publish field. A successful mode change records
an assistant audit event. Queued/running sandbox work returns stable
`409 sandbox_egress_change_busy` rather than being killed. The old Admin
Plan/runtime `networkAccessEnabled` field is removed without an alias.

**ADR-146 Slice 2 `5a2fd3bd`:** Helm policy contracts only;
no API boundary change.

**ADR-146 Slice 3 `8d0520f4`:** owner PUT
requests synchronous warm-pod reconcile after DB/audit commit. Response
`recycled` is honest (`true` only when an idle stale-mode pod snapshot was
UID+resourceVersion delete-requested and its old UID was confirmed gone; a
same-name replacement may remain).
Post-commit eviction/reconcile failure returns stable
`503 sandbox_egress_recycle_failed` (mode already committed; no fake rollback).
Same-mode PUT reconciles stale/mislabelled pods (`stale_only`); changed-mode
requests `all`, whose safe semantics are still only idle
missing/malformed/mismatched-mode generations. Exact active lease/job pods and
new correct-mode admissions are skipped; snapshot `409` is not counted. Internal sandbox
control-plane endpoint
`POST /api/v1/control/assistants/{assistantId}/sandbox-egress/reconcile`
(Bearer `PERSAI_INTERNAL_API_TOKEN`, body `{ mode, scope }`) is not a public
product API. The sandbox control plane resolves canonical Assistant mode from
Prisma before every warm/create/reuse/execute and fails closed on DB/pod
mismatch. Model-job pod ownership is internal `(namespace,name,uid,leaseToken,jobId)`
state stamped only after workspace lease acquisition; bind/exec also requires
the exact active DB token/holder/job/expiry, and no public request can supply
it. No route in this boundary changes browser, web tools, storage plane,
or provider-worker networking.

**ADR-146 Slice 4 `3f498ef9`:** web Assistant
Settings consumes the existing owner `GET/PUT /api/v1/assistant/{assistantId}/sandbox-egress`
contract via generated client wrappers only; no API shape change.

**ADR-146 Slice 5 (`d23936d1` on `3f498ef9`):** observability contract only.
Owner mode-change audit fields: `eventCode=assistant.sandbox_egress_mode_updated`,
`details.previousMode`, `details.selectedMode`, `details.actorUserId`. Sandbox
`/metrics` exports egress counters documented in
`infra/dev/gke/ADR146-OBSERVABILITY.md`. No new public API routes.

Final S6 acceptance on deployed release `35024b39` proved this boundary through
the Luma owner toggle, exact pod retirement, two succeeded audit rows, mode
metrics, and restore to `restricted`; browser/search and storage-plane
boundaries remained unchanged. ADR-146 is closed.

### Files

ADR-081 plus ADR-133 define the active target-state file boundary.

The public/product file surface should expose assistant-scoped Files through canonical hierarchical workspace paths, backed by `workspace_file_metadata` plus chat/document projections. The default visible working area is the current session root `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/...`; wider assistant/workspace access is expressed by ordinary parent paths, not by a second scope vocabulary. Chat `attachmentId`, runtime `artifactId`, object-storage keys, raw sandbox paths, knowledge source ids, and retrieval references are internal or plane-specific implementation identifiers, not primary model-facing file selectors. Runtime prompt hydration and model-visible tool use must expose reusable chat files through human-readable aliases that resolve to canonical workspace paths server-side, rather than printing raw selectors into conversational history.

Sandbox and media delivery may continue to use their internal endpoints and storage paths, but those details must be hidden behind the single Files product/runtime contract. Knowledge remains a separate API/product plane and must not be folded into Files.

Assistant-scoped Files are now served through the path-based workspace file routes (`/api/v1/assistant/chats/web/:chatId/files`, `/api/v1/assistant/workspaces/:workspaceId/files`, and matching `/preview` variants), plus the assistant-settings gallery list route `GET /api/v1/assistant/chats/web/:chatId/workspace-files`. That gallery route accepts `scope=session|assistant|workspace`, defaults to the current session, and widens truthfully without reviving `/workspace/chats/...` or flat-root defaults. These responses expose canonical workspace paths plus product metadata, not storage internals.

The runtime model-facing contract is alias-first across uploaded chat files, generated outputs, and sandbox-created files. Runtime may still mount files into sandbox by relative path internally, but the model-facing selector passed through prompt/tool usage guidance is a human-readable working-file alias that resolves to a canonical workspace path.

ADR-116 extends the runtime `files` tool with `inspect` (metadata + `capabilities` + effective preview byte limits), `files.preview` (visual re-view for images and native PDF with ephemeral provider injection), and plan-owned preview limits on the `files` tool activation (`maxFilePreviewBytes`, `maxFilePreviewEdgePx`). `get` remains a compatibility alias with the same inspect payload shape.

**ADR-134** restores `files.search` as the seventh model-facing `files` action. Runtime dispatches tokenized natural-language queries to `POST /api/v1/internal/runtime/files/search`, which searches `workspace_file_metadata` by path basename and `shortDescription`, ranks matches in memory, and returns items carrying `shortDescription` plus discovered aliases (`found file #N`). Semantic hints on `files.list` and Working Files `semanticSummaryHint` join the same manifest field via `POST /api/v1/internal/runtime/files/short-descriptions`; there is no attachment-metadata mirror. Working Files recovery text instructs the model: if a user refers to a file not in the sticky alias list, try `files.list`, then `files.search`, before declaring the file unavailable.

`files.read` on PDF/DOCX returns model-visible text plus additive metadata: `charCount`, `truncated`, `readNote`, `extractionQuality`, and `extractionCached` (true when internal extract served from durable `assistant_files.metadata` cache). Tool-result JSON never contains raw binary or `%PDF-` prefixes. `files.preview` returns a short JSON ack (`action: "previewed"`, `alias`, `mimeType`, `visualKind`); pixels/PDF bytes are injected only via ephemeral `toolFollowUpUserContent` on the next provider call inside the tool loop, not persisted as a user chat message.

Assistant Settings consumes the assistant-scoped Files API through canonical workspace-path routes. The Files gallery now labels its widens as `Current session`, `This assistant`, and `Workspace`, and chat attachment cards prefer the same canonical path-based routes when `path` exists, so attachment cards and settings rows are projections of the same File instead of separate storage concepts.

The old attachment-download fallback is not active product/API truth. Product open/download links are canonical workspace-path links, and assistant Files API state exposes product metadata without storage-derived object keys or raw storage internals.

ADR-097 document outputs are still ordinary Files at the binary/download boundary, but the file/chat attachment API may project document-domain metadata as `documentLink` when a workspace-path attachment is the delivered output of an `AssistantDocumentVersion`. That projection is read-only UI metadata (`docId`, `versionId`, `versionNumber`, status fields, `isCurrentOutput`) so clients can show quiet version state. Clients may use the same delete affordance as ordinary files; the backend workspace-file deletion boundary is responsible for detecting delivered document outputs and translating that user action into document-aware surface deletion (archive the document and hide delivered attachments) instead of physically deleting a protected current output and breaking version truth.

### Provider gateway

Current active internal service endpoints are served by `apps/provider-gateway`:

- `GET /health`
- `GET /ready`
- provider text generation/streaming endpoints consumed by `apps/runtime`
- `POST /api/v1/providers/generate-document`

ADR-097's current document generation boundary is `POST /api/v1/providers/generate-document`. It is internal-only and consumed by the runtime document worker for the remaining deferred external-provider document paths (currently Gamma-backed presentation generation/export). Deterministic provider/config/auth/template 4xx failures return explicit non-retryable error truth with provider-status metadata; they are not active-path transient retry semantics.

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
