# TEST-PLAN

## SR4 first bounded runtime honesty pass

- OpenClaw readiness must stay green in default/single-replica PersAI runtime mode when channel health is otherwise healthy.
- When PersAI runtime multi-replica mode is explicitly declared, readiness must fail unless all currently required shared-runtime seams are explicitly present:
  - this pass closes with a stricter truth: readiness must still fail even with shared apply metadata, because full session continuity and execution ordering are not yet cluster-proven by code
- `/ready` and `/readyz` must surface the same not-ready truth for authenticated/local readiness callers.
- Redis-backed spec/apply storage must not be treated as proof of bounded multi-replica runtime session safety.
- Minimum verification for this pass:
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run --config vitest.gateway.config.ts src/gateway/server/readiness.test.ts src/gateway/server-http.probe.test.ts`

## Quality gate

Required in CI:

- lint
- typecheck
- unit tests
- contract tests
- e2e smoke
- prisma migrate check
- build

## Step 1 focus

- app boot
- health/ready/metrics
- config validation
- requestId propagation
- Prisma setup
- seed works

## Step 2 focus

- Clerk token validation
- app user auto-create
- GET /api/v1/me
- POST /api/v1/me/onboarding
- onboarding idempotency
- protected /app
- onboarding gate

## Step 2 smoke/e2e baseline (slice 6)

- API flow smoke/e2e script:
  - `apps/api/test/step2-auth-foundation.e2e.test.ts`
  - validates:
    - auth access guard (missing bearer token -> unauthorized)
    - app user auto-create on first authenticated request
    - `GET /api/v1/me` state before onboarding
    - `POST /api/v1/me/onboarding`
    - onboarding idempotency (no duplicate user/workspace/membership records)
- Web smoke tests:
  - `apps/web/app/app/page.test.tsx` (protected `/app` calls `auth.protect`)
  - current setup flow tests should cover `apps/web/app/app/setup/page.tsx` instead of legacy `app-flow.client.tsx`
- CI includes explicit Step 2 smoke/e2e step via `pnpm run test:step2`.

## Step 7 P1 focus

- Prisma migration validates canonical plan catalog + entitlement schema.
- Governance baseline creation resolves `quotaPlanCode` from default first-registration active plan when catalog row exists.
- Trial metadata constraints hold at DB level (`is_trial_plan` vs `trial_duration_days` check).

## Step 7 P2 focus

- Owner-gated admin endpoints validate create/update/list flows for plan management.
- Admin plan create/edit includes `toolActivations[]`, `quotaLimits` (`tokenBudgetLimit`), and `primaryModelKey`.
- Legacy `entitlements.capabilities` and `entitlements.limitsPermissions` are no longer part of the API contract or admin UI.
- Web `/app` renders a dedicated admin plan management section and supports create/edit controls for authorized admins.
- Baseline regression suite (`test:step2`) remains green after admin plan UI/API additions.

## Step 7 P3 focus

- Prisma schema/migration validates workspace subscription state model.
- Effective subscription resolution precedence is tested in API test script (`test:subscription-state`).
- Workspace-wide typecheck/lint and Step 2 regression baseline remain green.

## Step 7 P4 focus

- Capability resolution precedence and governance guardrails are validated in API test script (`test:capability-resolution`).
- Materialization integration compiles/typechecks with effective capability payload included.
- Baseline Step 2 regressions remain green.

## Step 7 P5 focus

- Prisma schema/migration validates quota accounting persistence model (`workspace_quota_accounting_state`, `workspace_quota_usage_events`).
- Quota accounting service behavior is validated in API test script (`test:quota-accounting`), including:
  - token budget usage increments
  - cost/token-driving tool-class usage increments
  - active web chats usage refresh
- Web chat/send/stream and chat list archive/delete compile with centralized quota tracking hooks and preserve prior regressions.

## Step 7 P6 focus

- Centralized enforcement behavior is validated in API test script (`test:enforcement-points`) for:
  - capability gate checks
  - active web chats cap gate
  - quota limit gate behavior
- Web chat send/stream boundaries compile and run through the enforcement layer (no ad hoc duplicate checks).
- Materialization compiles with explicit `toolAvailability` snapshot included for OpenClaw-facing documents.

## Step 7 P7 focus

- Contracts/OpenAPI generation includes new visibility read-model endpoints:
  - `GET /assistant/plan-visibility`
  - `GET /admin/plans/visibility`
- API lint/typecheck validate visibility services and role-gated admin visibility path.
- Web `/app` renders:
  - user-facing plan state + usage percentages for token budget, cost-driving tools, active chats
  - owner/admin visibility section for plan state, usage pressure, and effective entitlement snapshot (tool classes, channels/surfaces)
- Existing app flow regressions remain green with the new visibility surfaces.

## Step 8 E1 focus

- Prisma schema/migration validates governed tool catalog + plan activation persistence:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- Plan create/update flows synchronize activation rows from explicit `toolActivations[]` overrides with class-derived fallback (no scattered ad hoc writes).
- Materialization compiles with `persai.effectiveToolAvailability.v2` projection including per-tool activation truth for OpenClaw-facing documents.
- API lint/typecheck and Step 2 regression baseline remain green.

## Step 8 E2 focus

- OpenClaw-facing capability envelope projection is validated in API test script (`test:openclaw-capability-envelope`) for:
  - per-tool/per-group allow-deny truth
  - explicit denied tool suppression list
  - per-surface allowance propagation
  - quota-related restriction flags
- Materialization compiles with envelope included in governance layer snapshot + OpenClaw bootstrap/workspace documents.
- Existing E1 and Step 2 baselines remain green.

## Step 8 E3 focus

- Channel/surface binding projection is validated in API test script (`test:openclaw-channel-surface-bindings`) for:
  - explicit provider + surface + assistant-binding structure
  - MAX split into `max_bot` and `max_mini_app` surfaces (no flattening)
  - explicit unavailable-surface suppression list behavior
  - system notifications modeled as a distinct non-chat surface
- OpenClaw capability envelope test (`test:openclaw-capability-envelope`) validates embedding of `openclawChannelSurfaceBindings`.
- Existing E1/E2 and baseline capability tests remain green.

## Step 8 E4 focus

- Telegram integration flow is validated in API test script (`test:telegram-integration`) for:
  - connect flow token verification path and persisted `claim_required` state
  - post-connect configuration update persistence and response shape
  - owner-claim metadata and 6-digit code exposure in integration state
- API lint/typecheck validate Telegram endpoints/services and binding persistence wiring.
- Web app flow tests validate integrations-area Telegram connect interaction path.
- Existing E1-E3 envelope/capability tests remain green.

## Step 8 E6 focus

- Runtime provider routing baseline is validated in API test script (`test:runtime-provider-routing`) for:
  - primary path resolution
  - fallback matrix trigger mapping
  - policy override handling for model keys
  - entitlement/governance alignment fields (cost-driving restrictions)
- OpenClaw capability envelope test (`test:openclaw-capability-envelope`) validates embedding of `runtimeProviderRouting`.
- API lint/typecheck validate service wiring through materialization and module registration.

## Step 9 F1 focus

- Prisma schema/migration validates append-only audit persistence model (`assistant_audit_events`).
- DB-level immutability for audit rows is enforced via trigger (update/delete rejected).
- Critical audit coverage is verified by service wiring for:
  - lifecycle milestones (`create|draft update|publish|rollback|reset|reapply request`)
  - runtime apply transitions (`in_progress|succeeded|failed|degraded`)
  - admin plan create/update actions
  - policy marker append (`do-not-remember` -> memory forget marker)
  - Telegram binding/config and token-fingerprint update events
- API lint/typecheck and existing Step 8 baseline tests remain green.

## Step 9 F2 focus

- Prisma schema/migration validates admin RBAC persistence model (`app_user_admin_roles`).
- Admin read authorization is validated for role-based access (`ops|business|security|super-admin`) with legacy owner fallback.
- Dangerous admin writes are validated for step-up token requirement on:
  - `POST /admin/plans`
  - `PATCH /admin/plans/{code}`
- Step-up challenge issuance path validates action scoping and short-lived token generation (`POST /admin/step-up/challenge`).
- Admin audit events include actor role context and step-up verification metadata for dangerous writes.

## Step 9 F3 focus

- Contracts/OpenAPI generation includes ops cockpit endpoint:
  - `GET /admin/ops/cockpit`
- API lint/typecheck validate ops cockpit resolver/controller wiring and role-gated read path.
- Web app-flow tests validate ops cockpit section rendering and reapply control wiring from cockpit.
- Existing Step 9 F1/F2 and Step 2 baseline regressions remain green.

## Step 9 F4 focus

- Contracts/OpenAPI generation includes business cockpit endpoint:
  - `GET /admin/business/cockpit`
- API lint/typecheck validate business cockpit resolver/controller wiring and role-gated read path.
- Web app-flow tests validate business cockpit section rendering alongside existing admin surfaces.
- Existing F3 ops cockpit behavior and Step 2 baseline regressions remain green.

## Step 9 F5 focus

- Prisma schema/migration validates admin notification channel and delivery models:
  - `workspace_admin_notification_channels`
  - `admin_notification_deliveries`
- Contracts/OpenAPI generation includes admin notifications endpoints:
  - `GET /admin/notifications/channels`
  - `PATCH /admin/notifications/channels/webhook`
- API lint/typecheck validate:
  - admin notification channel RBAC enforcement
  - non-blocking delivery wiring from selected high-signal audit events
- Web app-flow tests validate admin notification channel section rendering and webhook update action.

## Step 9 F6 focus

- Prisma schema/migration validates rollout control persistence:
  - `assistant_platform_rollouts`
  - `assistant_platform_rollout_items`
- Contracts/OpenAPI generation includes rollout control endpoints:
  - `GET /admin/platform-rollouts`
  - `POST /admin/platform-rollouts`
  - `POST /admin/platform-rollouts/{rolloutId}/rollback`
- API lint/typecheck validate:
  - action-scoped dangerous step-up extension (`admin.rollout.apply|admin.rollout.rollback`)
  - rollout/rollback service wiring and governance-only mutation scope
  - audit emission for rollout apply/rollback actions
- Web app-flow tests validate platform rollout controls section rendering and apply/rollback action wiring.
- Full regression baseline remains green:
  - `pnpm run test:step2`

## Step 10 G1 focus

- Contracts/OpenAPI generation includes Telegram secret lifecycle endpoints:
  - `POST /assistant/integrations/telegram/rotate`
  - `POST /assistant/integrations/telegram/revoke`
  - `POST /assistant/integrations/telegram/emergency-revoke`
- API lint/typecheck validate:
  - managed SecretRef lifecycle envelope resolution from governance `secret_refs`
  - TTL-driven lifecycle status evaluation (`active` vs computed `expired`)
  - revoke and emergency-revoke behavior with binding disable
  - audit events for rotate/revoke/emergency-revoke actions
- Targeted API tests validate lifecycle behavior:
  - `test/telegram-integration.test.ts`
  - `test/openclaw-channel-surface-bindings.test.ts`
  - `test/assistant-secret-refs-lifecycle.test.ts`

## Step 10 G2 focus

- Prisma schema/migration validates abuse/rate-limit persistence model:
  - `assistant_abuse_guard_states`
  - `assistant_abuse_assistant_states`
- API lint/typecheck validate:
  - multi-layer abuse enforcement service wiring on web chat send + stream prepare paths
  - per-user and per-assistant-per-surface throttle behavior
  - quota-aware slowdown/temporary block hook behavior
  - quota-pressure reconciliation: persisted `quota_pressure_*` rows clear when live quota is below thresholds
  - admin unblock override endpoint wiring and RBAC gate
  - global platform admin scope (`hasGlobalPlatformAdminScope`) for null `workspace_id` admin roles vs workspace-scoped unblock
- Targeted tests validate G2 behavior:
  - `test/enforce-abuse-rate-limit.test.ts` (includes quota-pressure persisted-state clear scenario)
  - `test/manage-admin-abuse-controls.test.ts`
  - `test/admin-authorization.test.ts` (asserts `hasGlobalPlatformAdminScope`)
- Existing enforcement baseline remains valid:
  - `test/enforcement-points.test.ts`

## Step 10 G3 focus

- Contracts/OpenAPI generation includes admin ownership flow endpoints:
  - `POST /admin/assistants/ownership/transfer`
  - `POST /admin/assistants/ownership/recover`
- API lint/typecheck validate:
  - dangerous-action step-up extension (`admin.assistant.transfer_ownership|admin.assistant.recover_ownership`)
  - workspace-bound ownership guardrails (same-workspace membership + MVP one-user-one-assistant constraint)
  - explicit non-overlap of transfer/recovery vs reset/delete semantics in response/audit consequences
- Targeted API test validates ownership flow service behavior:
  - `test/manage-admin-assistant-ownership.test.ts`

## Step 10 G4 focus

- Prisma schema/migration validates MVP compliance acceptance fields on `app_users`:
  - `terms_of_service_accepted_at`, `terms_of_service_version`
  - `privacy_policy_accepted_at`, `privacy_policy_version`
- API lint/typecheck validate:
  - onboarding payload now requires explicit legal acceptance flags
  - `/me` response includes compliance baseline state and onboarding completion reflects legal acceptance + workspace membership
  - retention/delete baseline is explicit in API contract state model (no hidden TTL delete semantics)
- Regression coverage validates onboarding flow with explicit legal acceptance:
  - `test/step2-auth-foundation.e2e.test.ts`

## Step 10 G5 focus

- API lint/typecheck validate provider/surface readiness projection hardening:
  - `ResolveOpenClawChannelSurfaceBindingsService` resolves configured state from canonical provider bindings for `telegram|whatsapp|max`
  - Telegram retains managed SecretRef lifecycle gate while WhatsApp/MAX remain architecture-ready binding-gated paths
  - MAX remains split by surfaces (`max_bot`, `max_mini_app`) with no flattening
- Targeted API tests validate G5 behavior:
  - `test/openclaw-channel-surface-bindings.test.ts`
  - `test/openclaw-channel-surface-bindings-g5.test.ts`

## Step 12 H2 cleanup focus

- Dead `governedFeatures` capability flags (`assistantLifecycle`, `memoryCenter`, `tasksCenter`, `viewLimitPercentages`, `tasksExcludedFromCommercialQuotas`) removed from types, services, UI, contracts, and test mocks.
- `dailyCallLimit` enforcement infrastructure: `WorkspaceToolDailyUsageRepository` and `TrackWorkspaceQuotaUsageService.checkToolDailyLimit` / `incrementToolDailyUsage` wired and tested via `test/quota-accounting.test.ts`.
- Per-plan `primaryModelKey` resolved through `billingProviderHints` and integrated into runtime provider routing via `MaterializeAssistantPublishedVersionService`.
- Admin Runtime UI: fallback provider/model, available models per provider editor, reapply summary display.
- Admin Plans UI: removed dead checkboxes, keeps product-facing quota input (`tokenBudgetLimit`) and `primaryModelKey` field.
- Tool catalog canonical definitions maintained in single file: `apps/api/prisma/tool-catalog-data.ts`.

## Step 12 H3.1 focus — configGeneration lazy invalidation

### Schema / migration

- Prisma schema validates new `PlatformConfigGeneration` model (singleton, `generation INT @default(1)`).
- `Assistant` has `configDirtyAt` nullable timestamp column.
- `AssistantMaterializedSpec` has `materializedAtConfigGeneration INT @default(0)`.
- `prisma migrate dev` succeeds; migration seeds the singleton row.

### Generation bump coverage

- Admin runtime provider settings save: `configGeneration` incremented atomically.
- Admin plan create/update: `configGeneration` incremented.
- Admin bootstrap preset update: `configGeneration` incremented.
- Mass reapply loop (`reapplyLatestPublishedVersions`) removed from runtime settings service.
- Admin settings save returns `configGeneration` instead of `reapplySummary`.

### Per-user dirty flag coverage

- Onboarding/profile update: `assistant.configDirtyAt` set on affected assistant(s).
- Telegram connect/revoke: `assistant.configDirtyAt` set.
- Subscription change hook: `assistant.configDirtyAt` set (ready for billing adapter).

### Materialization

- `MaterializeAssistantPublishedVersionService.execute()` reads current `configGeneration`, writes to `materializedAtConfigGeneration` on spec, embeds in `openclawBootstrap.governance.configGeneration`.
- After successful materialization: `assistant.configDirtyAt` cleared to NULL.
- Existing publish/rollback/reapply flows continue to work (they call `execute()` which now records generation).

### Internal endpoints

- `GET /internal/v1/runtime/config-generation` returns `{ generation }`, authenticated with gateway token.
- `POST /internal/v1/runtime/ensure-fresh-spec` checks global generation + per-user dirty flag; returns 204 (fresh) or 200 (fresh spec); no callback to OpenClaw.

### OpenClaw freshness check

- Both chat handlers (sync + stream) check freshness before using stored spec.
- Global generation cached in-memory with configurable TTL (`PERSAI_CONFIG_GENERATION_CACHE_TTL_MS`).
- Generation mismatch → call ensure-fresh-spec → apply locally if stale.
- Per-assistant mutex prevents concurrent re-materializations.
- Fail-open on PersAI unreachable.

### Frontend

- Admin runtime settings page: `reapplySummary` removed, simple "Saved" feedback with `configGeneration`.
- Admin plans page: "Force reapply all" button — step-up auth, confirm dialog, summary display.
- API client response validation updated; `postAdminForceReapplyAll` added.

### Regression

- API lint + typecheck pass.
- Existing publish/rollback/reapply/reset flows unaffected.
- Platform rollout create/rollback unaffected (workspace-scoped, separate concern).

## Step 12 H12 focus

### Schema / lifecycle

- Prisma migration validates assistant reminder-delivery preference field and any task/reminder persistence additions.
- Assistant create/reset flow validates memory lifecycle:
  - `MEMORY.md` created when missing
  - `memory/` created when missing
  - both cleared on reset
  - edit/update does not touch memory lifecycle artifacts
- Assistant bootstrap lifecycle validates:
  - fresh assistant workspace apply creates `BOOTSTRAP.md`
  - first successful web/Telegram assistant turn consumes `BOOTSTRAP.md`
  - ordinary later applies do not recreate `BOOTSTRAP.md` while the same workspace still exists
  - full reset/recreate gets a fresh `BOOTSTRAP.md` because the assistant workspace is recreated
- Setup/recreate regression coverage validates:
  - `/me` prefill includes `displayName`, `birthday`, `gender`, and workspace `timezone`
  - birthday is normalized for browser `input[type=date]`
  - setup and settings use the same trait semantics and free-form persona text model
  - assistant draft/published snapshot preserve `assistantGender`
  - final setup step runtime preview returns a non-persisted preview response
  - setup preview does not call the normal runtime apply/live-workspace cleanup path
  - avatar upload persists across navigation/reload without repeated unnecessary refetch churn

### Reminders/tasks

- Current-state task listing validates:
  - only active/current reminders/tasks are shown
  - one-time successful tasks disappear from the current list
  - recurring items stay as one row with updated `nextRunAt`
- Pause/resume/cancel behavior remains correct for PersAI-owned items.
- Preferred notification channel and fallback ordering validate against active assistant channel bindings.

### Compatibility bridge

- If OpenClaw cron webhook callback is used as a transition seam, callback auth and assistant resolution are validated without native cron schema changes.

## Step 12 H13 focus

### Unified gateway

- Shared inbound turn orchestration validates the same enforcement path for:
  - web chat
  - Telegram/internal messenger ingress
  - reminder callback ingress
- Capability/quota/abuse/tool-limit checks are exercised from the shared path rather than duplicated surface-specific code.
- Concrete focused coverage in this slice includes:
  - `test/enforcement-points.test.ts`
  - `test/internal-runtime-turn.controller.test.ts`
  - `test/internal-runtime-tool-quota.controller.test.ts`
  - `test/handle-internal-cron-fire.test.ts`
  - `test/openclaw-runtime-adapter.test.ts`
  - `test/quota-accounting.test.ts`
  - `test/render-assistant-inbound-surface-message.test.ts`
  - `openclaw/src/gateway/persai-runtime/persai-runtime-agent-turn.test.ts`

### Structured errors

- Stable backend error codes are validated for:
  - feature unavailable
  - quota limit reached
  - tool daily limit reached
  - rate-limited / abuse slowdown-block
  - runtime unavailable/degraded
- Web non-stream and stream paths emit the same code family:
  - HTTP failures via canonical `ErrorEnvelope`
  - SSE failure payloads via structured code-bearing event payloads

### Surface formatting

- The same backend error code maps correctly to:
  - web inline guidance
  - Telegram/markdown response text
  - plain-text messenger copy
  - structured JSON callback response

## Step 12 H8 Telegram runtime readiness

### Token storage

- Connect stores encrypted bot token in `platform_runtime_provider_secrets` under key `telegram_bot:{assistantId}`.
- Revoke deletes the encrypted token.
- Rotate (re-connect) overwrites the encrypted token.

### Materialization

- Active Telegram binding → `openclawBootstrap.channels.telegram.enabled: true` with resolved `botToken`, `webhookUrl`, `webhookSecret`.
- No active binding → `channels.telegram.enabled: false`, null token/webhook fields.
- `groupReplyMode` defaults to `"mention_reply"` when not explicitly set in config.
- HMAC webhook secret derived deterministically from `assistantId` + `TELEGRAM_WEBHOOK_HMAC_SECRET`.

### OpenClaw Telegram bridge

- On `spec/apply` with `channels.telegram.enabled: true`: Grammy bot started, webhook registered with Telegram API.
- On `spec/apply` with `channels.telegram.enabled: false`: existing bot stopped, webhook deleted.
- On pod restart: bots reinitialized from Redis spec store (`getAll()`).
- Webhook handler at `/telegram-webhook/:assistantId` routes to correct bot.
- Group reply mode `mention_reply`: bot only responds to @mentions and direct replies in groups.
- Group reply mode `all_messages`: bot responds to every text message in groups.

### Group tracking

- OpenClaw sends `my_chat_member` events to PersAI `POST /api/v1/internal/runtime/telegram/group-update`.
- Join event upserts group record with status `active`.
- Leave event updates group record to status `left` with `leftAt` timestamp.
- `GET /api/v1/assistant/integrations/telegram/groups` returns current group list.
- Verify `openclaw.json` configmap includes `secrets.providers.persai-runtime` with correct `baseUrl`; without it group callbacks are silently dropped.

### UI

- Groups section visible in connected Telegram panel.
- Empty state shown when no groups connected.
- Group reply mode toggle persists via `PATCH /assistant/integrations/telegram/config`.
- `groupReplyMode` included in `configPanel.settings` response.

### Polling fallback

- When `TELEGRAM_WEBHOOK_BASE_URL` is unset, materialized `webhookUrl` is null.
- OpenClaw Telegram bridge uses `bot.start()` (long polling) instead of webhook registration.
- Stale webhook is deleted on bot start (best-effort).

### Auto-apply on connect/disconnect

- `ConnectTelegramIntegrationService` calls `ApplyAssistantPublishedVersionService` after connect.
- `RevokeTelegramIntegrationSecretService` calls `ApplyAssistantPublishedVersionService` after revoke/disconnect.
- Auto-apply failure is non-fatal (logged, does not fail the API call).

### Workspace isolation

- OpenClaw Telegram agent turns receive `workspaceDir` via `commandInput` (not `process.env`).
- Session `cwd` header is synced with runtime `workspaceDir` on every turn (no stale path drift).
- Memory tools (`memory_get`, `memory_search`) use `persaiRuntimeRequestContext.workspaceDir` before falling back to `resolveAgentWorkspaceDir`.
- Telegram bot reads/writes same `MEMORY.md` and bootstrap files as web chat for the same assistant.
- Heartbeat/background runs use a dedicated heartbeat session key and must not reuse the main user chat transcript/bootstrap set.
- Background heartbeat without an explicit heartbeat model override should prefer the PersAI admin global default model when that setting is active.

### Regression

- Existing Telegram connect/config/revoke flows unaffected.
- API lint + typecheck pass (PersAI + OpenClaw).
- Pre-existing Telegram bindings without `groupReplyMode` default to `"mention_reply"` — no seed needed.

## Step 12 H8-scale Telegram lifecycle hardening

### Freshness contract

- `POST /internal/v1/runtime/ensure-fresh-spec` returns:
  - `204` when assistant runtime state is already fresh
  - `200` with fresh `{generation, assistantId, publishedVersionId, contentHash, spec}` when only that assistant needs refresh
- Backend must not trigger `ApplyAssistantPublishedVersionService` from this path.
- OpenClaw chat-time freshness must apply the returned spec locally and continue the turn without waiting for a backend `full apply`.

### Telegram runtime idempotency

- Re-applying the same effective Telegram transport config does not stop/start the bot again.
- Changing only persona/avatar state does not restart transport; it only schedules profile reconcile.
- Pod restart reinitializes persisted Telegram bots with bounded concurrency, jitter, and retry backoff.
- Startup reinit defers non-critical profile sync until the gateway reports ready.
- Telegram profile API calls honor cooldown and do not spam `setMyName` / `setMyDescription` / `setMyProfilePhoto` on repeated no-op apply.
- repeated Telegram webhook deliveries are deduped before they can start duplicate runtime turns.
- owner-only DM gate is validated before `requestPersaiTelegramTurn`.
- unclaimed Telegram DM flow prompts for the PersAI 6-digit code and completes claim only on a matching code.
- terminal Telegram `401 Unauthorized` maps to explicit `invalid_token` state instead of infinite retry-only behavior.

### Session lifecycle

- Assistant reset clears runtime-side `agent:persai:<assistantId>:*` sessions.
- Assistant recreate path (`resetMemoryWorkspace` during create) also clears stale runtime sessions for that assistant.
- Removed session transcripts are archived with reset semantics.
- Helm-rendered OpenClaw config enables enforced session maintenance bounds for stale-session pruning and disk growth control.

### Focused verification

- OpenClaw focused tests:
  - `src/gateway/persai-runtime/persai-runtime-freshness.test.ts`
  - `src/gateway/persai-runtime/persai-runtime-session-cleanup.test.ts`
  - `src/gateway/persai-runtime/persai-runtime-spec-store.test.ts`
- PersAI API typecheck stays green after controller contract change.

## M-series: Media, attachments, and voice (ADR-059)

### M1 foundation focus

- Prisma schema/migration validates `assistant_chat_message_attachments` table and `media_storage_bytes` quota dimension extension.
- Attachment repository validates CRUD operations: create, findByMessageIds, findById, deleteByMessageIds, deleteByChatId, deleteByAssistantId.
- Chat hard-delete flow validates attachment row cleanup + workspace media directory cleanup via runtime adapter.
- Assistant reset transaction validates attachment row bulk delete (physical files already cleaned by workspace directory delete).
- Media upload endpoint validates MIME allowlist, size limit, `mediaClasses` capability gate, and workspace storage proxy.
- Media download endpoint validates authenticated proxy with ownership check.
- `media_storage_bytes` quota dimension validates increment on upload and decrement on delete.
- Contracts/OpenAPI generation includes upload, download, and extended message response shapes.

### M2 tool media delivery focus

- OpenClaw bridge `resolveAgentResponse` validates extraction of `mediaUrl`/`mediaUrls`/`audioAsVoice` from agent payloads.
- Runtime adapter validates parsing of `media[]` from sync response and stream `media` NDJSON event.
- Web chat send/stream services validate: tool media files copied to workspace media path, attachment rows created, response includes attachments.
- Web UI validates: image attachments render inline, audio attachments render with player, tool_output attachments display correctly.

### M3 web voice focus

- Web UI validates: microphone recording produces opus/webm, upload flow returns attachmentId.
- STT proxy endpoint validates: OpenClaw `transcribeAudioFile` called, transcription text returned.
- Turn service validates: voice attachment triggers STT before runtime turn, transcription used as `userMessage`, attachment `processing_status` updated.
- Voice message bubbles validate: waveform player + transcription text display.

### M4 web file upload focus

- File picker validates: allowed MIME types, max file size, max attachments per message.
- Image attachments render inline in user message bubbles.
- Document attachments render as download cards.
- Quota enforcement validates: `media_storage_bytes` limit blocks upload when exceeded.

### M5 Telegram inbound media focus

- Telegram bot handler validates: `message:voice` downloads audio and calls STT, `message:photo` downloads image, `message:document` downloads file.
- Internal Telegram turn request validates: attachment fields parsed and persisted.
- PersAI chat records for Telegram turns with media validate attachment rows created.

### M6 Telegram outbound media focus

- Telegram reply handler validates: `media[]` in turn response triggers `sendPhoto`/`sendVoice`/`sendDocument`.
- Tool-generated images sent as Telegram photos with caption.
- TTS voice output sent as Telegram voice note (opus).
- Typing indicator sent for long-running media generation.

### M7 Yandex TTS focus

- OpenClaw Yandex provider validates: API call to `tts.api.cloud.yandex.net`, opus output for voice-bubble channels, mp3 for web.
- Provider registry includes Yandex in built-in list.
- PersAI admin UI validates: Yandex selectable as TTS provider, credential stored and delivered to runtime.

## Step 15 R15 focus

- Docs-first alignment is required: `ADR-063`, `ROADMAP.md`, `ARCHITECTURE.md`, and `OPENCLAW-SAAS-RUNTIME-PLAN.md` must describe the same runtime direction.
- Fork audit automation validates actual code + git diff/history, not only `openclaw/docs/PERSAI-FORK-PATCHES.md`:
  - `persai-fork-base..HEAD` file inventory
  - high-risk native file drift
  - invariant checks for critical PersAI patches
  - `corepack pnpm run openclaw:fork:update-gate` is the canonical agent/operator gate
  - after the gate passes, `docs/LIVE-TEST-HYBRID.md#fork-update-smoke-pack` is the required targeted runtime/security smoke reference
  - current baseline: the canonical gate is expected to pass before the smoke pack is treated as meaningful
- Shared-runtime hardening tests validate:
  - explicit deny-by-default tool exposure for user-facing runtime turns
  - explicit sandbox/workspace-access/runtime config generation
  - no accidental dependence on permissive OpenClaw defaults
  - current Helm-rendered baseline explicitly denies dangerous built-ins (`gateway`, `nodes`, `canvas`, `agents_list`, `session_status`, `sessions_*`, `subagents`)
  - sandbox is active (`mode: "all"`) in all tiered pools with per-tier resource limits; dind retains `privileged: true` (rootless canary failed on GKE COS, ADR-069)
  - `corepack pnpm run shared-runtime:readiness:strict` is the canonical prepared-baseline gate before rollout
- Runtime assignment tests validate:
  - plan default + admin override resolution (`platform_fallback -> plan_default -> assistant_override`)
  - admin plan API/UI carry `runtimeTierDefault` as product control-plane state
  - assistant lifecycle exposes parsed `governance.runtimeTierOverride`
  - materialization exposes resolved runtime assignment state before `R15e/R15f` router rollout
  - user/support runtime paths do not silently bypass tier resolution:
    - memory workspace actions
    - media upload/download/transcription flows
    - reminder/cron control
    - admin ops runtime diagnostics
- GKE readiness checks validate:
  - pool-aware OpenClaw deployment/service/config scaffolding exists before router cutover
  - canonical pool services exist explicitly for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`
  - `corepack pnpm run runtime-pools:readiness:strict` passes before enabling tier-specific traffic paths
  - per-tier runtime service wiring, health visibility, and narrowed internal reachability before tenant cutover
  - adapter routing tests validate:
    - runtime tier resolves from materialized/inbound context
    - `OPENCLAW_BASE_URL_<TIER>` routes directly to the explicit tier service
    - no global runtime fallback URL remains in the active adapter path
- Sandbox and quota enforcement checks validate:
  - sandbox is active in all tiered pools with rootless dind and per-tier resource limits
  - workspace storage quota is enforced at write and exec tool entry points (ADR-069)
  - media storage quota is enforced on upload with pre-check + post-increment (ADR-067)
  - per-peer Telegram rate limit is enforced in-memory per chatId (ADR-067)
- Network/token hardening checks validate:
  - OpenClaw ingress can be reduced to API pods plus explicitly allowlisted pod-visible trusted ingress CIDRs
  - public API listener rejects `/api/v1/internal/*`
  - internal API listener/service accepts only internal runtime routes
  - OpenClaw runtime traffic uses the internal API service path
  - API ingress `NetworkPolicy` is enabled only after trusted public ingress CIDRs are explicitly configured
  - `corepack pnpm run networkpolicy:readiness:strict` fails while required CIDR inputs are still missing
  - rollout docs identify Google LB/GFE guidance as the primary source-of-truth for GKE pod-visible ingress CIDRs and treat Telegram webhook ranges as supplemental only
  - live smoke after rollout confirms:
    - `https://api.persai.dev/health` returns `200`
    - `https://bot.persai.dev/healthz` returns `200`
    - `https://api.persai.dev/api/v1/internal/...` returns `404`
    - from the OpenClaw pod, `http://api-internal:3002/api/v1/internal/...` reaches the internal listener while `http://api:3001/api/v1/internal/...` and `http://api-internal:3002/health` both return `404`

## Step 16 K16 verification focus

- Canonical control-plane truth validates:
  - admin plan catalog exposes only `plan_managed` tools as editable
  - `platform_managed` tools remain visible/read-only
  - hidden internal tools do not leak back into ordinary tariff editing
- Declared vs effective capability checks validate:
  - effective subscription precedence is `workspace subscription -> assistant override -> assistant fallback -> catalog default -> none`
  - materialized runtime tool policy is derived from effective tool availability rather than raw activation rows
  - `persai_workspace_attach` and `persai_tool_quota_status` stay always-on platform-managed tools
- Graceful limit fallback validates:
  - token-budget exhaustion degrades to the configured safe fallback path instead of killing chat entirely
  - user-facing transport/runtime metadata shows when fallback was used
  - no-fallback cases still return honest `quota_limit_reached` guidance
- User-facing plan visibility validates:
  - sidebar shows current tariff plus token usage instead of the old chat-only progress
  - assistant settings show only token/chat bars plus active per-tool daily limits from the effective plan
  - user UI no longer exposes the old `Cost tool units` product mental model
- Runtime/security matrix validates:
  - admin runtime surface shows the code-backed tier matrix for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`
  - all tiers declare sandbox-only `exec`, sandbox-workspace-only `write`, and the same restricted built-in deny baseline
- Pre-deploy commands:
  - `corepack pnpm contracts:generate`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`
  - focused tests for touched K16 slices, including `apps/api/test/plan-visibility.service.test.ts`

## Scaling readiness program verification baseline

- `ADR-070` and `docs/SCALING-READINESS-PLAN.md` are the canonical control documents for the `SR*` scaling-readiness slices.
- Before closing any `SR*` slice, docs must state:
  - active slice id
  - verification tier reached (`Tier 0` to `Tier 4`)
  - rollback/safe fallback path
  - deploy scope and observation window
- `SR1` through `SR9` should not be considered complete from static checks alone when they affect runtime, infra, storage, quota, or burst behavior.
- `SR10` is the required production gate for explicit evidence at `1000`, `3000`, and `5000` online-user targets.
- Recommended verification model for `SR*` slices:
  - `Tier 0`: lint, typecheck, contracts, config/render validation
  - `Tier 1`: focused functional smoke for touched flows
  - `Tier 2`: target-environment deploy smoke
  - `Tier 3`: observation window with metrics/log review
  - `Tier 4`: targeted load/burst validation for scale-path slices

## SR1 operational baseline

- Canonical runbook/checklist doc:
  - `docs/SR1-OBSERVABILITY-BASELINE.md`
- `SR1` close baseline for PersAI API:
  - `GET /health` returns `200`
  - `GET /ready` returns `200` in healthy baseline and `503` when DB dependencies are not ready
  - `GET /metrics` exposes readiness, dependency, request, latency, and process-memory metrics
- `SR1` close baseline for OpenClaw:
  - `GET /healthz` returns `200`
  - `GET /readyz` returns `200` in healthy baseline
  - local/authenticated readiness callers can inspect `failing[]` and `uptimeMs`
  - runtime startup/backoff and Telegram bridge failures remain log-driven signals, not Prometheus metrics
- Tier 2 deploy smoke for `SR1` must include:
  - API `/health`, `/ready`, `/metrics`
  - OpenClaw `/healthz`, `/readyz`
  - one real runtime path with matching PersAI API `runtime_route` log proof
- Tier 3 observation window for `SR1` must include:
  - `app_ready`
  - `app_dependency_ready{dependency=...}`
  - `http_error_requests_total`
  - latency histogram family `http_request_duration_ms_*`
  - OpenClaw probe stability (`healthz` / `readyz`)
  - repeated OpenClaw transport-not-ready or `[persai-telegram]` failures treated as observation-window regressions

## SR2 workload rollout baseline

- `Tier 0` config/render validation for this `SR2` sub-slice must include:
  - `helm template persai infra/helm -f infra/helm/values.yaml`
  - `helm template persai infra/helm -f infra/helm/values-dev.yaml`
  - `corepack pnpm run runtime-pools:readiness:strict`
- Canonical chart truth added by this `SR2` sub-slice:
  - explicit deployment rollout strategy for `api`, `web`, and OpenClaw runtime pools
  - explicit resource requests/limits for `api`, `web`, and OpenClaw runtime pools
  - explicit but default-disabled config seams for `HorizontalPodAutoscaler`, `PodDisruptionBudget`, and `topologySpreadConstraints`
- `SR2` is still not closeable from this sub-slice alone; final acceptance must include target-environment evidence for:
  - rollout behavior during deployment replacement and restart
  - disruption behavior under eviction/drain assumptions
  - autoscaling assumptions for workloads where HPA is later enabled

## SR2b first disruption / placement baseline

- Canonical enabled baseline after `SR2b`:
  - `web.replicaCount = 2`
  - `web.podDisruptionBudget.enabled = true` with `minAvailable: 1`
  - `web.topologySpreadConstraints` enabled across hostname and zone with `ScheduleAnyway`
- Canonical explicit-but-still-disabled baseline after `SR2b`:
  - `web.autoscaling.enabled = false`
  - `api` and OpenClaw `autoscaling` remain explicit but disabled
  - `api` and OpenClaw `podDisruptionBudget` / topology spread remain unenabled until their infra behavior is justified separately
- Required `Tier 2` smoke for `SR2b`:
  - confirm `web` deploy replacement keeps at least one ready pod throughout the rollout window
  - confirm the rendered `web` `PodDisruptionBudget` is admitted and does not deadlock ordinary rollout
  - confirm scheduled `web` pods can land on more than one node when the target environment has that capacity
- Required `Tier 3` observation for `SR2b`:
  - no unexpected `web` restart loop or readiness flapping after rollout
  - no rollout stall caused by the new `PDB`
  - no evidence that topology spread creates unschedulable pressure in the current cluster shape

## SR2 closure baseline

- Canonical `SR2` baseline after the closing pass:
  - `api.replicaCount = 2`
  - `web.replicaCount = 2`
  - `api.podDisruptionBudget.enabled = true` with `minAvailable: 1`
  - `web.podDisruptionBudget.enabled = true` with `minAvailable: 1`
  - `api.topologySpreadConstraints` enabled across hostname and zone with `ScheduleAnyway`
  - `web.topologySpreadConstraints` enabled across hostname and zone with `ScheduleAnyway`
  - `api.autoscaling.enabled = false`
  - `web.autoscaling.enabled = false`
  - OpenClaw runtime pools remain explicit and pool-aware, but do **not** count as proven multi-replica-safe runtime behavior
- `SR2` close criteria for this infra slice are now satisfied by chart truth plus `Tier 0` validation:
  - rollout/disruption/placement defaults are explicit
  - autoscaling assumptions are explicit even where disabled
  - no hidden Kubernetes-default rollout baseline remains for `api` or `web`
- What `SR2` closure does **not** claim:
  - no proof of API correctness under burst or multi-replica dependency pressure
  - no proof of OpenClaw distributed correctness
  - no HPA policy proof beyond explicit disabled baseline

## SR3 first bounded concurrency baseline

- First `SR3` fix-pass now covers one concrete API race:
  - concurrent chat-thread bootstrap on unique `assistantId + surface + surfaceThreadKey`
- Acceptance for this sub-slice:
  - repository-level `findOrCreate` behavior falls back cleanly on Prisma unique-key race (`P2002`)
  - touched API paths no longer rely on `find -> create` succeeding as if only one process handled the request
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/handle-internal-cron-fire.test.ts`

## SR3b adapter preflight pressure baseline

- This sub-slice covers one bounded dependency/backpressure risk:
  - repeated API-side OpenClaw preflight checks (`/healthz` + `/readyz`) on adjacent runtime calls
- Acceptance for this sub-slice:
  - preflight uses short TTL caching
  - concurrent preflight calls dedupe in-flight per runtime tier
  - runtime-side failures invalidate the cached preflight state so the next call rechecks live readiness
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/openclaw-runtime-adapter.test.ts`

## SR3c shared Prisma client baseline

- This sub-slice covers one bounded DB/process-pressure risk:
  - separate Prisma clients/pools for identity-access and workspace-management inside the same API process
- Acceptance for this sub-slice:
  - workspace-management resolves through the shared Prisma singleton instead of constructing a second `PrismaClient`
  - existing service/repository injection contracts remain intact
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-service-sharing.test.ts`

## SR3d distributed peer abuse baseline

- This sub-slice covers one bounded distributed abuse-correctness risk:
  - `peerKey`-based abuse throttling for inbound API paths was previously kept only in process-local memory
- Acceptance for this sub-slice:
  - the touched peer counter survives service-instance boundaries and no longer resets just because another API replica handles the next request
  - peer-attempt registration is atomic on the shared Postgres row for the same `assistantId + surface + peerKey`
  - existing user-level and assistant-level abuse state contracts remain intact
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/admin-delete-user.service.test.ts`

## SR3e distributed abuse counter closing pass

- This sub-slice covers the last clearly localized distributed abuse-correctness gap inside `SR3`:
  - user-level and assistant-level abuse counters still used `find -> compute -> upsert`, which could lose increments under burst/multi-replica contention
- Acceptance for this sub-slice:
  - user/assistant abuse attempt registration is serialized on shared Postgres state instead of depending on optimistic read/compute/write order
  - serializable transaction conflicts retry cleanly for the touched path
  - the higher-level abuse policy remains the same while the counter-registration correctness improves under contention
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-assistant-abuse-guard.repository.test.ts`

## SR5a sandbox startup path optimization baseline

- `Tier 0` config/render validation for this `SR5a` sub-slice must include:
  - `helm template persai infra/helm -f infra/helm/values.yaml`
  - `helm template persai infra/helm -f infra/helm/values-dev.yaml`
  - `corepack pnpm run runtime-pools:readiness:strict`
- Canonical preload script changes in this `SR5a` sub-slice:
  - two `docker pull` commands now run in parallel via `&` + `wait` instead of sequential
  - each pull has bounded retry (default 3 attempts, configurable via `sandboxRuntime.preloadPullRetries`)
  - timestamped `[sandbox-preload]` progress logging at socket wait, token acquisition, login, pull start, pull completion, and gateway start
- `SR5a` is closeable from `Tier 0` static validation + verified render output:
  - all three sandbox-capable pools in dev values render the parallel pull + retry script
  - `startupProbe` budget (900s) remains unchanged — tightening deferred to post-measurement sub-slice
- `SR5a` does NOT prove:
  - actual wall-clock startup improvement (requires `Tier 2` deploy observation)
  - retry resilience under real transient GAR failures (requires `Tier 3` observation)
  - dind contention or sandbox session concurrency behavior (later SR5 sub-slices)

## SR5b dind contention and sandbox capacity baseline

- `Tier 2` controlled stress test for this `SR5b` sub-slice:
  - 4× concurrent `python3 -c 'sum(i*i for i in range(10**8))'` inside sandbox containers on each pool
  - `kubectl top` for K8s-level CPU/RAM, `top` inside dind sidecar for process-level verification
  - pod readiness and restart count checked before, during, and after stress
- Confirmed findings:
  - all three tiers saturate dind CPU at limit under 4 concurrent CPU-bound sandbox exec
  - `free_shared` and `paid_shared` (1 core): ~4× slowdown, 741-1001m dind CPU
  - `paid_isolated` (2 cores): ~2× slowdown, 2000m dind CPU, completes ~2× faster
  - RAM is not the binding constraint (70-90% headroom on all tiers)
  - pod readiness never lost, 0 restarts, gateway stays healthy
  - `docker stats` CPU% inside rootless dind is unreliable — `kubectl top` is the honest signal
- `SR5b` does NOT prove:
  - what the optimal dind CPU limit should be per tier (cost/capacity tradeoff, not SR5b)
  - sandbox session GC/TTL behavior under sustained contention
  - behavior under IO-bound sandbox workloads (only CPU-bound tested)

## SR5 cross-pool isolation and closure baseline

- Cross-pool isolation test: sustained 4× CPU stress on `free_shared` while `paid_shared` and `paid_isolated` idle:
  - `free_shared` dind: 712m CPU (saturating as expected)
  - `paid_shared` dind: 3m CPU (unaffected)
  - `paid_isolated` dind: 2m CPU (unaffected)
  - all pods Ready, 0 restarts
- SR5 exit criteria "sandbox-heavy bursts degrade predictably and do not destabilize unrelated tiers" is confirmed
- Accepted known risks for later slices:
  - dind CPU limits are product/cost decisions (not SR5)
  - sandbox GC/TTL not stress-tested
  - IO-bound sandbox workloads not tested
  - node co-location bandwidth contention during pulls (~2.5 min extra)

## SR6a workspace quota cache invalidation parity baseline

- This bounded `SR6a` pass covers one concrete filesystem-pressure tail:
  - sandbox `remove` / `rename` mutations could leave the cached workspace quota reading stale even after files were freed or atomically replaced
- Acceptance for this sub-slice:
  - sandbox `writeFile`, `remove`, and `rename` all invalidate the workspace quota cache consistently
  - the fix is documented as filesystem-cost hardening under `SR6`, not as `SR9` quota/billing correctness
- Minimum verification for this sub-slice:
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`
- `SR6a` does NOT prove:
  - that cached `du -sb` is the final acceptable architecture for all GCS FUSE churn
  - that transcript/session filesystem growth is fully bounded
  - that quota correctness under concurrency or billing propagation is solved (`SR9`)
  - that media preprocessing temp-file throughput is solved (`SR7`)

## SR6b mid-exec workspace quota watch baseline

- This bounded `SR6b` pass covers one concrete active-path storage failure:
  - a single long-running `exec` command could create multi-GB files in one session because quota was checked only before spawn and after exit
- Acceptance for this sub-slice:
  - a running non-cleanup `exec` is terminated when periodic quota checks observe the workspace above limit
  - direct cleanup commands still bypass the kill path so over-quota remediation is possible
  - docs no longer claim that the burst-write window is fully closed beyond the evidence of this pass
- Minimum verification for this sub-slice:
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`
- Live verification used for SR6 operational closure:
  - oversized single-command writes are now bounded near quota instead of running away, follow-up commands are blocked, and cleanup remains allowed; strict ideal shell-exit semantics were not claimed for closure
- `SR6b` does NOT prove:
  - that periodic `du -sb` polling is the final acceptable architecture for all GCS FUSE churn
  - that backgrounded commands are fully bounded by the same mechanism
  - that transcript/session filesystem growth is fully bounded
  - that quota correctness under concurrency or billing propagation is solved (`SR9`)

## SR6d first-poll quota watch tightening baseline

- This bounded `SR6d` pass covers one concrete active-path storage failure:
  - a fast oversized single-command write could still finish before the first scheduled `SR6b` quota-watch poll, so the same command succeeded and only later commands were blocked
- Acceptance for this sub-slice:
  - the first mid-exec quota check happens early enough that a fast oversized write does not rely only on post-command blocking
  - focused regression coverage proves the old "finishes before first poll" blind window is closed
  - docs truthfully reflect that `SR6b` alone did not yet satisfy this live bar
- Minimum verification for this sub-slice:
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts src/agents/workspace-quota-guard.test.ts`
- Live verification used for SR6 operational closure:
  - with a quota such as `700 MB`, the same oversized write now gets cut off near the boundary and no longer behaves like an unbounded runaway path; remaining clean-shell-success presentation is accepted residual risk
- `SR6d` does NOT prove:
  - that periodic `du -sb` polling is the final acceptable architecture for all GCS FUSE churn
  - that backgrounded commands are fully bounded by the same mechanism
  - that transcript/session filesystem growth is fully bounded
  - that quota correctness under concurrency or billing propagation is solved (`SR9`)

## SR6e known file-mutation quota cache delta accounting baseline

- This bounded `SR6e` pass covers one concrete active-path storage-cost tail:
  - known sandbox file mutations were still invalidating the workspace quota cache unconditionally, so the next guarded operation fell back to another full `du -sb` walk even when the runtime already knew the exact byte delta
- Acceptance for this sub-slice:
  - sandbox file overwrite/delete/overwrite-rename paths update the cached workspace usage with exact byte deltas instead of always forcing the next guarded read back to `du -sb`
  - recursive or directory-shaped mutations still fail safe by invalidating the cache instead of pretending exact accounting exists
  - docs truthfully reflect that this is a cost-reduction stop-gap, not the final quota accounting architecture
- Minimum verification for this sub-slice:
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/workspace-quota-guard.test.ts src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`
- Live verification used for SR6 operational closure:
  - representative workspace-mutation-heavy flows stayed clean after deploy, with no new quota-regression symptoms on ordinary write/overwrite/delete/rename paths
- `SR6e` does NOT prove:
  - that periodic `du -sb` polling is the final acceptable architecture for all GCS FUSE churn
  - that backgrounded commands are fully bounded by the same mechanism
  - that transcript/session filesystem growth is fully bounded under all future retention settings
  - that quota correctness under concurrency or billing propagation is solved (`SR9`)

## SR6f one-shot oversized write runtime stop closure baseline

- This bounded `SR6f` pass closed `SR6` operationally but not by the original strict shell-exit criterion:
  - even after `SR6d` and `SR6e`, one oversized write above quota can still present a clean shell exit on some live `dd` paths, but the runtime now bounds the write near quota, blocks follow-up work, surfaces quota failure in the user-facing path, and preserves cleanup remediation
- Acceptance for this sub-slice:
  - oversized writes are operationally bounded near quota instead of running away
  - non-cleanup quota failure is surfaced to the user in the runtime/UI path
  - ordinary file mutations still succeed without false quota deadlocks
  - cleanup remains allowed after quota exceedance
- Minimum verification for this sub-slice:
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/workspace-quota-guard.test.ts`
- Live verification used for SR6 operational closure:
  - with a quota such as `700 MB`, one single-command oversized write above that limit was cut off around the quota boundary, follow-up commands were blocked by the guard, and cleanup remained allowed
- `SR6f` does NOT prove:
  - that periodic `du -sb` polling is the final acceptable architecture for all GCS FUSE churn
  - that backgrounded commands are fully bounded by the same mechanism
  - that transcript/session filesystem growth is fully bounded
  - that quota correctness under concurrency or billing propagation is solved (`SR9`)
  - that every one-shot oversized `dd`/shell path always ends with ideal non-zero exit-code semantics before any overshoot

## SR7a STT scratch isolation and media-stage visibility baseline

- This bounded `SR7a` pass covers one concrete media temp-file lifecycle seam:
  - PersAI-owned STT ingress paths previously staged transcriptions through shared runtime media directories (`_stt_tmp` in `MediaPreprocessorService`, `_voice_tmp` in `ManageChatMediaService`), so one transcription's cleanup could collide with another in-flight request
- Acceptance for this sub-slice:
  - media-preprocessor STT uses a per-request transient scratch directory instead of the shared `_stt_tmp` location
  - direct web voice transcription uses a per-request transient scratch directory instead of the shared `_voice_tmp` location
  - cleanup targets the same transient directory created by that request and still runs after success or STT failure
  - `/metrics` exposes bounded stage-level signals for touched media-heavy paths (`stt_transcribe`, inbound resolve, outbound delivery persist)
  - canonical docs no longer describe shared lazy `_stt_tmp` cleanup as the active baseline
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/platform-http-metrics.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/platform-readiness.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/media-preprocessor.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.transcribe-voice.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts`
- `SR7a` does NOT prove:
  - that webhook/realtime fan-in is bounded (`SR8`)
  - that media quota ordering or billing correctness under concurrency is solved (`SR9`)
  - that the entire `SR7` media pipeline no longer dominates API/runtime under burst

## SR7b web staged attachment visibility parity baseline

- This bounded `SR7b` pass covers one concrete media observability seam:
  - the web staged upload path already shared the same overall media system, but its `stageForWebThread` flow was not contributing a bounded stage-level metric, leaving web image/file uploads as an observation gap compared with the touched `SR7a` media paths
- Acceptance for this sub-slice:
  - `ManageChatMediaService.stageForWebThread` records a bounded `web_stage_attachment` metric for both success and failure outcomes
  - `/metrics` exposes `web_stage_attachment` series through the same media-stage metric families used by `SR7a`
  - canonical docs reflect this web visibility pass as the current active `SR7` sub-slice
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/platform-readiness.service.test.ts`
- `SR7b` does NOT prove:
  - that webhook/realtime fan-in is bounded (`SR8`)
  - that quota or billing correctness under concurrency is solved (`SR9`)
  - that the whole media pipeline is now capacity-safe under burst without further live observation

## SR8b Combined webhook/realtime replay closure baseline

- This bounded `SR8b` pass covers the remaining replay/idempotency seams needed for one final `SR8` closure attempt:
  - the same Telegram `updateId` could still pass through PersAI more than once when duplicate or retried webhook deliveries overlapped before the old watermark-only dedupe was written back
  - the same logical web turn could still create a second runtime turn when client retry/reconnect resent the same request
  - the same logical internal reminder callback could still fan out a duplicate reminder to web or Telegram
- Acceptance for this sub-slice:
  - PersAI claims one `assistantId + updateId` before Telegram quota/runtime work starts, so concurrent retries of the same update do not fan out into duplicate inbound turns
  - PersAI claims one web `clientTurnId` before web user-message creation/runtime execution, so replay/reconnect does not create a second user-visible turn
  - PersAI claims one logical reminder replay key before reminder fanout, so repeated callback delivery does not append/send duplicate reminders
  - successful completion advances the handled/completed replay marker and clears the in-flight claim
  - failed attempts release or age out the in-flight claim so the same logical delivery is not deadlocked forever after one broken run
- transient Telegram proxy timeout/network failure returns a retry-worthy non-2xx response instead of silent `200` success
- transient `OpenClaw -> PersAI internal Telegram turn` failures are treated as retry-worthy webhook failures instead of being rendered to the user and acknowledged as successful webhook completion
- OpenClaw cron webhook non-2xx completion is surfaced as runtime failure in logs instead of being silently treated as success
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/internal-runtime-turn.controller.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/telegram-webhook-proxy.controller.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/handle-internal-cron-fire.test.ts`
  - `corepack pnpm --filter @persai/web run test -- app/app/assistant-api-client.test.ts`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/gateway/persai-runtime/persai-runtime-telegram.test.ts src/gateway/server-cron.test.ts`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `SR8b` does NOT prove:
  - that quota/billing correctness under all duplicated-runtime side effects is globally solved (`SR9`)
  - that the final webhook/realtime burst envelope is proven (`SR10`)

## SR9a assistant plan override propagation baseline

- This bounded `SR9a` pass covers one concrete commercial-propagation seam:
  - assistant-scoped admin plan override set/reset changed effective subscription truth immediately in API reads, but did not mark the assistant stale for the existing lazy rematerialization path, so runtime/materialized plan-derived behavior could remain on the old commercial baseline until an unrelated refresh happened
- Acceptance for this sub-slice:
  - `ManageAdminAssistantPlanOverrideService` marks `assistant.configDirtyAt` on override set and reset
  - existing lazy-refresh machinery can now detect that the assistant needs rematerialization without waiting for an unrelated global generation bump
  - docs reflect the actual implemented effective subscription precedence:
    - `assistant_plan_override`
    - `workspace_subscription`
    - `assistant_plan_fallback`
    - `catalog_default_fallback`
    - `none`
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/manage-admin-assistant-plan-override.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/subscription-state-resolve.test.ts`
- `SR9a` does NOT prove:
  - that per-assistant plan changes propagate faster than the existing lazy-refresh TTL on every active OpenClaw process
  - that workspace subscription webhook writes are wired into the same invalidation path yet
  - that token/media/chat-cap quota enforcement is already atomic under concurrent requests across shared state
  - that `SR9` is closed without later shared-state or live evidence

## SR9b token budget atomic accounting baseline

- This bounded `SR9b` pass covers one concrete shared-state commercial race:
  - inbound turn paths enforced token budget before runtime, but wrote token usage only after runtime with a blind increment, so concurrent legitimate turns could push the shared token ledger above the configured limit
- Acceptance for this sub-slice:
  - token-budget writes use one serializable capped shared-state path instead of an unconditional post-turn increment
  - when the remaining budget is smaller than the requested estimated delta, only the remaining budget is applied to the ledger and to the quota event row
  - docs stay honest that this is atomicity for the current estimator-backed ledger, not yet a full pre-runtime reservation contract
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/quota-accounting.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-workspace-quota-accounting.repository.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/enforcement-points.test.ts`
- `SR9b` does NOT prove:
  - that pre-runtime degrade decisions are reservation-atomic across the whole turn lifecycle
  - that the current `chars_div_4_ceil_v1` estimator matches provider-exact token billing
  - that media-storage or active-chat-cap races are solved
  - that all of `SR9` is closed without deploy/live shared-state evidence

## SR9c media storage quota atomicity baseline

- This bounded `SR9c` pass covers one concrete shared-state commercial race:
  - media upload paths could pass a stale workspace media quota read, upload the blob, and then blindly increment `media_storage_bytes`, allowing concurrent uploads to retain quota-violating stored bytes
- Acceptance for this sub-slice:
  - media-byte writes use one serializable capped shared-state path instead of an unconditional increment
  - if the uploaded object no longer fully fits into the remaining media-storage budget, the touched path deletes the newly uploaded blob and does not retain a ready attachment row
  - docs stay honest that this pass hardens touched retain-or-rollback correctness, not the whole long-term media-byte decrement/reconciliation model
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/inbound-media.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-workspace-quota-accounting.repository.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/quota-accounting.test.ts`
- `SR9c` does NOT prove:
  - that every media delete path now decrements `media_storage_bytes` back to perfect long-term truth
  - that preprocessing cost or stage latency is redesigned (`SR7`)
  - that token-budget or active-chat-cap races are solved
  - that all of `SR9` is closed without deploy/live shared-state evidence

## SR9d active web chats cap race-safe creation baseline

- This bounded `SR9d` pass covers one concrete shared-state commercial race:
  - two or more new web threads could observe the same stale active-chat count and then each create a fresh active chat row, silently overshooting `WEB_ACTIVE_CHATS_CAP`; the staged web attachment path could also create a fresh web chat without applying that cap at all
- Acceptance for this sub-slice:
  - new active web-chat creation uses one serializable shared-state path that returns the existing thread, creates under cap, or rejects at cap
  - staged web attachment uses that same cap-aware creation contract instead of bypassing the commercial limit
  - docs stay honest that this pass hardens touched web creation seams, not the full chat lifecycle or final concurrency/load proof
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/prepare-assistant-inbound-turn.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-assistant-chat.repository.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- `SR9d` does NOT prove:
  - that broader chat archive/delete/reconciliation semantics were redesigned
  - that abuse/rate limiting behavior changed
  - that token-budget or media-storage races are solved by this pass
  - that all of `SR9` is closed without deploy/live shared-state evidence

## SR9e workspace subscription sync propagation correctness baseline

- This bounded `SR9e` pass covers one concrete commercial propagation gap:
  - API-side effective subscription resolution reads `workspace_subscriptions` live, while runtime materialization freshness depends on `configDirtyAt` / lazy rematerialization; without a write seam that marks assistants dirty, subscription truth can split between API and runtime after a billing sync write
- Acceptance for this sub-slice:
  - the touched subscription sync path persists normalized subscription rows through one application seam
  - real subscription changes or deletion mark all assistants in the workspace `configDirtyAt`, while unchanged snapshots remain no-op
  - docs stay honest that this pass creates the safe propagation contract, not the final billing webhook/provider transport surface
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/sync-workspace-subscription.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-workspace-subscription.repository.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/subscription-state-resolve.test.ts`
- `SR9e` does NOT prove:
  - that a real billing webhook/controller surface is already wired
  - that final runtime freshness was observed live after deploy
  - that token-budget, media-storage, or active-chat-cap races are solved by this pass
  - that all of `SR9` is closed without deploy/live shared-state evidence

## SR9f tool daily quota check-vs-consume concurrency baseline

- This bounded `SR9f` pass covers one concrete commercial correctness gap:
  - internal runtime tool quota `check` resolved the current control-plane plan limit, but `consume` enforced the runtime-supplied `dailyCallLimit` from a possibly stale materialized policy, allowing split-brain commercial enforcement after plan changes
- Acceptance for this sub-slice:
  - `consume` derives the effective tool daily limit from server-side plan truth instead of trusting the runtime-supplied body field for enforcement
  - `check` and `consume` now share the same control-plane tool daily quota policy source
  - docs stay honest that `check` is advisory/read-only and `consume` is the authoritative enforcement seam
- Minimum verification for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/consume-internal-runtime-tool-daily-limit.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-workspace-tool-daily-usage.repository.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/internal-runtime-tool-quota.controller.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/quota-accounting.test.ts`
- `SR9f` does NOT prove:
  - that HTTP retry/idempotency for `/tools/consume` was redesigned
  - that tool catalog or availability policy was redesigned
  - that final deploy/live proof already exists for the touched tool quota seam
  - that all of `SR9` is closed without deploy/live shared-state evidence

## SR6c workspace quota measurement fail-safe baseline

- This bounded `SR6c` pass covers one concrete quota-integrity gap:
  - `du -sb` failure or malformed output could collapse workspace usage to an effectively permissive read and weaken the guarded paths
- Acceptance for this sub-slice:
  - quota measurement failure is treated as fail-safe on guarded non-cleanup paths
  - non-cleanup `exec` is blocked or terminated when quota cannot be verified
  - sandbox `writeFile` does not proceed when quota cannot be verified
- Minimum verification for this sub-slice:
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
  - `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/workspace-quota-guard.test.ts src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`
- `SR6c` does NOT prove:
  - that `du -sb` polling cost is acceptable as the final architecture
  - that backgrounded commands are fully bounded under the same live evidence standard
  - that transcript/session filesystem growth is fully bounded
  - that quota correctness under concurrency or billing propagation is solved (`SR9`)
