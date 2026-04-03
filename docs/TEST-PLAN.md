# TEST-PLAN

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
- Admin plan create/edit includes `toolActivations[]`, `quotaLimits` (`tokenBudgetLimit`, `costToolUnitsLimit`), and `primaryModelKey`.
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
  - connect flow token verification path and persisted connected state
  - post-connect configuration update persistence and response shape
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
- Admin Plans UI: removed dead checkboxes, added quota limit inputs (`tokenBudgetLimit`, `costToolUnitsLimit`) and `primaryModelKey` field.
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
