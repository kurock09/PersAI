# SESSION-HANDOFF

> Archive: handoff sections from 2026-05-19 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`. Keep using this file for the active 2026-05-20 working set, including all ADR-099 entries.

## 2026-05-22 — ADR-100 Slice 6F follow-up — internal upload micro-description ledger

### What changed

- Added the missing internal себес closeout for the bounded upload micro-description helper without touching user quota semantics.
- `assistant_upload_micro_description_jobs` now durably stores replay-safe helper usage on `usageJson` and the durable call-time seam on `usageOccurredAt`.
- `AssistantUploadMicroDescriptionService.describeCanonicalFile()` now returns the summary result together with `usage`, `respondedAt`, and provider/model so the worker can persist the seam first.
- `AssistantUploadMicroDescriptionJobService.processClaimedJob()` now writes helper usage/time onto the durable job row in the same success transaction as any semantic-summary updates. If the helper spent tokens but yielded no usable summary, the job still records usage/time and completes honestly.
- After that durable write succeeds, API appends a non-blocking ledger row through `RecordModelCostLedgerService.recordToolHelperEvent()` with honest labels: `purpose=tool_helper`, `source=upload_micro_description`, `surface=background`, `sourceEventId=upload_micro_description_job:<jobId>`.

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm --filter @persai/api exec tsx test/assistant-upload-micro-description-job.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`

### Residual risks

- This slice still does **not** change user quota accounting, plans, or UI behavior; it is internal ledger only by founder directive.
- Ordinary non-project upload analysis remains opt-in through `routerPolicy.analyzeUploadsOnB2cUpload`; live deploy verification is still needed before treating that path as operational truth.
- If the provider omits usage entirely, the durable job row still captures the call-time seam when available but no money ledger row can be priced from missing usage.

### Next recommended step

- Resume **deploy prep + live project verification** only: confirm the upload micro-description helper now lands both semantic-summary truth and internal ledger rows in the target environment, then prepare deploy. Do not start the hidden B2B cluster plan until the pre-deploy Slice 6 behavior is live-verified end to end.

## 2026-05-22 — ADR-100 Slices 2–6F — **Complete in working tree (uncommitted)** 

### What changed

- **Slice 2 + 2.1:** explicit chat mode contract (`assistant_chats.chat_mode`, API/web/contracts, migration, OpenAPI turn request closeout, parseUpdateInput tests).
- **Slice 3A (subagent):** `project-files-panel.tsx` — lower sidebar lists deduped attachments from paginated chat history when active chat is project mode.
- **Slice 3B (subagent):** mode control moved to composer (desktop 3-pill; mobile chip + menu); header pills removed.
- **Slice 4 (subagent):** runtime now reads `chatMode === "project"` distinctly from smart/deep, adds retrieval-aware project precheck before the current `reasoning_request` trap, appends a staged project developer contract, and keeps loop/tool budgets on existing reasoning-plan policy. Native send/stream helper coverage now includes `chatMode` consistently.
- **Slice 5 (subagent):** runtime now emits project-only `project_activity` / `project_reasoning_summary` stream events, API maps them to new SSE event names, and web appends them into the existing timeline via `ActivityBadge`/`activities[]` instead of `ThoughtBlock`. Generic tool live badges are suppressed in project mode to keep the feed quieter.
- **Slice 6A (subagent):** added bounded deterministic `semanticSummary` / `semanticSummarySource` metadata for uploads when cheap signals already exist (`textExtract`, `transcription`), mirrored that hint into canonical file truth, and exposed tiny token-capped working-file hints for weak/generic filenames only. No schema migration, no upload-time vision captioning, no heavy parse-on-upload behavior.
- **Slice 6B (GPT 5.4 subagent):** added a narrow project-only retrieval ordering improvement. Active-skill project turns now keep the skill stage and still stage user knowledge before product knowledge even when skill hits already exist, while ordinary non-project active-skill behavior stays unchanged. This is gated by an internal `gatherProfile: "project"` flag only; no pinned-skill schema or chat-file retrieval stage was added.
- **Founder follow-up readonly audits recorded in ADR-100:** complex-doc extraction for chat files currently comes from shared `DocumentExtractionService` only when `files.read` / KB indexing / document jobs invoke it; ordinary web upload still stores only a small local preview plus `fileRef`. ADR-100 now explicitly prefers lazy project-mode extraction on demand during `gather`, with any future cache attached to existing `fileRef` truth instead of parsing every upload. The audit also confirmed a real current gap for images/files with weak filenames (`image1.png`): later turns do not get a durable semantic description, so ADR-100 now preserves a future clean path of tiny semantic summaries on canonical attachment/file truth. Ordinary foreground/background auto-skill activation can still be reused in project mode when no explicit skill is pinned, so any future project-only skill picker should use a separate optional pin field rather than rewriting ordinary skill state.
- **ADR correction (founder clarification):** the remaining Slice 6 work is now treated as must-have before deploy, not a soft follow-up. ADR-100 now explicitly requires `6C/6D/6E`: Project File Intelligence in the existing developer/working-files context, one-time deep extraction with persisted/cache truth on existing `fileRef`/attachment records, and runtime core correction so project chat files become a real gather source rather than an opportunistic `files.read` fallback.
- **Slice 6C/6D/6E (GPT 5.4 subagent):** project chat files now act as a real staged source before KB in project mode, deep extraction is cached lazily on `AssistantFile.metadata`, and the runtime/API project gather loop uses that cached file intelligence instead of relying on opportunistic `files.read`. No new schema, no second KB, and no UI churn were added.
- **Slice 6F (parent-verified bounded slice):** uploads that still lack a deterministic semantic summary can now enqueue a cheap background micro-description pass. Admin Runtime adds `routerPolicy.analyzeUploadsOnB2cUpload` (default `false`) for ordinary non-project/B2C upload analysis, while project mode always enqueues once canonical `fileRef` truth exists. API now owns durable `assistant_upload_micro_description_jobs` plus a leased scheduler/worker, reuses the existing `systemTool` model slot for the helper, persists canonical summary truth on `AssistantFile.metadata.semanticSummary` / `semanticSummarySource`, mirrors attachment metadata when practical, and extends `semanticSummarySource` with `upload_micro_description`. Enqueue timing is intentionally bounded: existing project chats may enqueue on stage after `fileRef` exists, while prepared inbound turns enqueue only after staged-attachment merge and final `chatMode` resolution.
- Parent verification: API focused tests 46/46 plus orchestrate-runtime-retrieval and extraction-cache tests pass, web tests 119/119 across touched suites, runtime focused tests pass, and full lint/format/api+web+runtime typecheck are green.

### Verification

- API focused tests: send-web-chat 9/9, manage-web-chat-list 12/12
- API native tests: send-native 5/5, stream-native 8/8
- API semantic summaries: media-semantic-summary 3/3, manage-chat-media.stage-web-thread pass
- API upload micro-description job: assistant-upload-micro-description-job pass
- API inbound enqueue timing: prepare-assistant-inbound-turn pass
- API runtime/admin settings: platform-runtime-provider-settings pass, manage-admin-runtime-provider-settings pass
- API retrieval ordering: orchestrate-runtime-retrieval pass
- API extraction cache: extract-internal-runtime-assistant-file pass
- Web: sidebar 20/20, chat-area 14/14, use-chat 78/78, activity-badge 7/7
- Web admin/client settings: admin runtime page pass, assistant-api-client pass, runtime-provider-settings-admin pass
- Runtime: project-execution-profile 3/3, project-stream-events 2/2, focused turn-routing + turn-execution tests pass, working-files semantic-hint test pass
- Gate: lint, format:check, api/web/runtime typecheck — pass

### Residual risks

- Legacy `deepModeEnabled`-only PATCH can downgrade `project → smart` (accepted).
- Project files panel does not yet live-sync with optimistic composer uploads.
- Shadow router mode still does not force orchestrated pre-retrieval for project turns; Slice 4 intentionally stayed on the existing precheck + tool-loop path.
- Project activity/reasoning feed is session-ephemeral in client state; no DB persistence in this slice.
- Reattach tool-badge suppression is not fully chat-mode-aware when project mode is unknown client-side.
- `pinnedSkillId` remains deferred by design; project mode still reuses ordinary auto-skill activation when no explicit pin exists.
- Richer image-only visual summaries remain later work; current file intelligence is anchored by cheap summaries plus lazy deep extraction/cache.
- Ordinary non-project upload micro-description stays opt-in through the new admin runtime toggle; live deploy verification is still needed before treating that path as operational truth.

### Next recommended step

- Parent moves to **deploy prep + live project verification**: validate the new project-file gather path, lazy extraction cache, and upload micro-description job path against the target environment, then prepare deploy. Do not start the hidden B2B cluster plan until live verification confirms the new pre-deploy Slice 6 behavior end to end.

## 2026-05-22 — Support API auth correction + compact mobile voice cancel UX — **Implemented**

### What changed

- **Independent audit corrected the previous explanation:** runtime evidence in dev showed the earlier BFF-only fix was not sufficient. At audit time, running `web` was already on `cee076e92dbde54850eb9591c556cbe8898f2fb8`, running `api` was still on `a21beef24c2d578e5a94614680d7af97d6ac2a66`, and `infra/helm/values-dev.yaml` still pinned `web` to the older `2b87029e642d7613875b434107c88b8027bc0cd9`.
- **Actual support regression root cause:** live browser checks with the same Clerk session proved `GET /api/v1/support/tickets/:ticketId` succeeded while `POST /api/support-ticket/:ticketId/read`, direct `POST /api/v1/support/tickets/:ticketId/read`, `GET /api/support-attachment/:attachmentId`, and direct `GET /api/v1/support/attachments/:attachmentId` all returned `401 auth_required`. Root cause: `apps/api/src/modules/identity-access/identity-access.module.ts` had not registered the new support read/download endpoints with `ClerkAuthMiddleware`, so `req.resolvedAppUser` stayed unset and the controllers rejected those requests before business logic.
- **API fix applied:** added the missing guarded routes for:
  - `POST /api/v1/support/tickets/:ticketId/read`
  - `GET /api/v1/support/attachments/:attachmentId`
  - `GET /api/v1/admin/support/attachments/:attachmentId`
- **Regression lock added:** `apps/api/test/identity-access.module.test.ts` now asserts those support endpoints stay covered by `ClerkAuthMiddleware`, so this exact missing-`forRoutes` failure mode cannot silently return.
- **Why the previous fix did not work:** the `web` BFF/session-token bridge could forward a fresh token, but the failing API endpoints were still unguarded on the backend. The token arrived and was then ignored by the route pipeline that never ran Clerk middleware, so support attachments and mark-read still 401ed in live dev.
- **Mobile voice UX corrected again:** `apps/web/app/app/_components/chat-input.tsx` now renders a compact centered status pill instead of the wide banner/progress rail. Cancel arming requires a longer, mostly horizontal left swipe with more slop/hysteresis and a vertical-drift guard, so small thumb movement no longer cancels recording.

### Verification

- `corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts`
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-input.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Next recommended step

- Redeploy at least `api` to `persai-dev` and reconcile the `web` GitOps pin drift, then rerun live smoke on one real support ticket:
  - user unread dot clears and stays cleared after full refresh
  - user attachment opens through `/api/support-attachment/:id`
  - admin attachment preview/lightbox opens through `/api/admin-support-attachment/:id`
  - mobile hold-to-record shows the compact pill and only cancels on a deliberate left swipe

## 2026-05-22 — Support unread + admin attachment auth follow-up — **Implemented**

### What changed

- **Fresh session-token bridge for support BFFs:** live dev logs after the `web` redeploy still showed `401 userId: null` on `GET /api/v1/admin/support/attachments/:id` and `POST /api/v1/support/tickets/:id/read`. Root cause: the dedicated support BFF routes were forwarding only `auth().getToken()` from the server request, while the working generic `/api/v1` proxy path can still ride a fresh browser token. The support BFF routes now prefer `x-persai-session-token` from the same-origin browser request before falling back to Clerk server auth, the browser attachment blob helper sends that header on same-origin `/api/...` fetches, and browser `mark read` does the same on `/api/support-ticket/:ticketId/read`.
- **Mobile voice rollback + stricter cancel gesture:** the experimental two-column left cancel rail above the composer was removed. Touch recording is back to a compact centered status card, and the cancel gesture now requires a larger deliberate left swipe with more slop/hysteresis so small thumb drift or `pointercancel` noise does not discard the recording.
- **Web support auth path:** support attachment URLs now use the dedicated same-origin BFF routes (`/api/support-attachment/:attachmentId`, `/api/admin-support-attachment/:attachmentId`) instead of hitting `/api/v1/...` directly from the browser. The image fetch helper now avoids adding a client bearer header for same-origin routes and relies on the session cookie/BFF proxy path.
- **Unread persistence:** the user-side `mark read` action now goes through a dedicated same-origin BFF route (`POST /api/support-ticket/:ticketId/read`) instead of the generic browser bearer path, so `userLastReadAt` is actually persisted and unread dots do not come back after refresh.
- **Clerk consistency:** the new support BFF routes are now included in `apps/web/middleware.ts` protected-route matching alongside the existing authenticated BFF surfaces.
- **Quiet UI continuity:** the sidebar assistant card now swaps the usual live/apply status for a short support status when unread support replies exist, and the mobile hamburger gets a small unread-count badge tied to the same signal instead of a louder pulsing indicator.
- **Cluster evidence:** dev API logs showed repeated `401` on `POST /api/v1/support/tickets/:ticketId/read` and `GET /api/v1/admin/support/attachments/:attachmentId` with `userId: null`, matching the founder-reported symptoms.

### Verification

- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-input.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/web run lint`
- `corepack pnpm exec prettier --check "apps/web/app/api/support-ticket/[ticketId]/read/route.ts" "apps/web/app/api/support-attachment/[attachmentId]/route.ts" "apps/web/app/api/admin-support-attachment/[attachmentId]/route.ts" "apps/web/app/app/_components/authenticated-attachment-image.tsx" "apps/web/app/app/assistant-api-client.ts" "apps/web/app/app/_components/chat-input.tsx" "apps/web/app/app/assistant-api-client.test.ts" "apps/web/app/app/_components/chat-input.test.tsx"`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts`
- `corepack pnpm --filter @persai/web exec vitest run app/middleware.test.ts app/app/_components/sidebar.test.tsx app/app/_components/assistant-settings.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts`

### Next recommended step

- Redeploy `web` to `persai-dev`, then smoke one real support ticket in both surfaces: confirm the admin thumbnail opens, opening the ticket clears the unread dot, and the dot stays cleared after full page refresh.

## 2026-05-22 — User support tickets (base system) — **Implemented**

### What changed

- **Data model:** `support_tickets` + `support_ticket_messages` with statuses `open | pending | answered | closed`.
- **User APIs:** `POST /api/v1/support/tickets`, `GET /api/v1/support/assistants/:assistantId/tickets`, `GET /api/v1/support/tickets/:ticketId`.
- **Admin APIs:** `GET/POST` under `/api/v1/admin/support/tickets` for list, detail, reply, pending, close.
- **Notifications:** new `user_support` source (email `support.reply` + `user_preferred` push on admin reply); `admin_system` event `support_ticket_opened` on new ticket.
- **UI:** `Admin -> Support` queue page; assistant settings section **Поддержка** with ticket list + thread.

### Verification

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm --filter @persai/api exec tsx test/manage-user-support.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-support.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/support-reply.template.test.ts`

### Next recommended step

- Apply migration `20260522120000_user_support_tickets` on dev, enable `support_ticket_opened` in `admin_system` recipients if needed, smoke: user submits ticket -> admin replies -> user sees `answered` + email/push.

## 2026-05-22 — `admin_system` daily-report test button — **Implemented**

### What changed

- **Admin UI:** `Admin -> Notifications -> admin_system` now exposes a dedicated **Test daily report** button next to the digest settings.
- **Backend test-send path:** `ManageNotificationPlatformService.testSendForSource(..., source="admin_system", eventCode="daily_report")` now builds a synthetic daily digest body and sends it through the first configured recipient assistant's effective `user_preferred` channel, so operators can validate the digest end-to-end without waiting for the scheduler.

### Verification

- `corepack pnpm --filter @persai/api exec tsx test/manage-notification-platform.service.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`

### Residual / note

- `corepack pnpm run test` still fails in unrelated `apps/sandbox/test/sandbox.service.test.ts` (`assert.ok(usage !== null)`), outside the admin notifications slice.

### Next recommended step

- Smoke the button in dev with a real `recipientAssistantIds` config and confirm the synthetic digest lands in the expected Telegram or web notification surface for that assistant.

## 2026-05-22 — `admin_system` audit cleanup — **Implemented**

### What changed

- **Billing timing:** admin-system billing fan-out now preserves future lead-time scheduling for `trial_ending` / `grace_ending` instead of pushing those alerts immediately at lifecycle-event ingest time.
- **Daily digest resilience:** the scheduler now ticks immediately on module init, and digest eligibility is “after target local time, once per local day” rather than a fragile 5-minute-only window. Dedupe remains per recipient/day.
- **Legacy row normalization:** effective `admin_system` routing/test-send is forced to `user_preferred` even if an older persisted `notification_policies` row still contains `admin_webhook`.
- **Auth boundary:** global notification control-plane singleton actions (channels, policies, quiet hours, preview/test) now require `hasGlobalPlatformAdminScope`; scoped admins still only see delivery/dead-letter history for their own workspace.
- **Validation:** malformed `admin_system.config.dailyReportTimeLocal` values are rejected at write time instead of being silently accepted and later disabling the report.

### Verification

- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/admin-system-notification-producer.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/billing-lifecycle-producer.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/manage-notification-platform.service.test.ts`

### Next recommended step

- Run one real dev smoke for each path: a scoped admin trying to open/edit `Admin -> Notifications`, a lead-time billing event (`trial_started` or `grace_started`), and a same-day late API restart after the configured digest time to confirm the intended once-per-day behavior on live data.

## 2026-05-22 — `admin_system` admin push + daily report — **Implemented**

### What changed

- **API notification control plane / producers:** `admin_system` is now the single source for admin push delivery. Its policy config stores `recipientAssistantIds[]`, enabled admin event codes, and `dailyReportEnabled` + `dailyReportTimeLocal`. New `AdminSystemNotificationProducerService` fans out deterministic `admin_system` intents to configured admin assistants through the existing `user_preferred` delivery path; sources wired in this slice are first-assistant registration/onboarding completion (`CreateAssistantService`), billing lifecycle events, and selected admin/runtime audit events appended via `AppendAssistantAuditEventService`.
- **API scheduler:** new `AdminSystemDailyReportSchedulerService` (leased like the other singleton schedulers) checks each configured admin assistant in its own workspace timezone and emits one deduplicated daily digest at the configured local wall-clock time.
- **Admin UI:** `Admin -> Notifications -> Policies -> admin_system` now exposes recipient assistant IDs, event checkboxes, and a daily report toggle/time input directly inside the existing policy editor. No separate "Admin PUSH" entity/channel was introduced.
- **Semantics cleanup:** `admin_system` default routing moved from `admin_webhook` to `user_preferred`; render strategy is now deterministic `static_fallback`. `system_event` remains separate and webhook-oriented.

### Verification

- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/admin-system-notification-producer.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/manage-notification-platform.service.test.ts`

### Next recommended step

- Configure real `recipientAssistantIds` in `Admin -> Notifications -> admin_system`, enable the desired event checklist, and smoke one real billing/admin/runtime event plus the 21:00 digest on dev to confirm delivery lands in the chosen assistants' actual preferred surfaces.

## 2026-05-21 — ADR-099 doc closeout — **Implemented**

### What changed (docs only)

- **`docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`:** status **Implemented**; audit summary reconciled with `main` (Block 1 + Block 2 shipped; optional follow-ups listed explicitly).
- **`docs/API-BOUNDARY.md`:** tool-path economics boundary updated — emission + ledger append + Admin Tools UI are no longer marked as follow-up.
- **No code changes** in this slice.

### Repo truth (unchanged code)

- Block 1 + Block 2 economics core on `main` (see ADR § Current code audit summary).
- Migrations: `20260520215000_adr099_session_b_ledger_foundation`, `20260521153000_adr099_block1_ledger_coverage_completion`, `20260521160000_adr099_block2_tool_path_pricing_catalog`.

### Next recommended step (post-ADR-099)

- Pick work from **ADR-078** or a **new ADR** for Business margin-by-plan / extra ledger purposes — do not reopen ADR-099 Block 1/2 without founder direction.
- **Operations:** deploy `api` + `web` + `runtime` to `persai-dev`; set tool-path tariffs; smoke `web_search` + `document_render` ledger rows; confirm `quota_status` quotes package prices via `priceLabel` (200 ₽ not 20 000).

## 2026-05-21 — Media package price labels for quota_status + Admin Plans stat styling

### What landed

- **`quota_status` / package offers:** each media package offer now includes `amountMajor` and `priceLabel` (ru/en) so the model quotes 200 ₽ instead of misreading `amountMinor` 20000 as rubles.
- **`quota_status` tool guidance:** bootstrap copy tells the model to use `priceLabel` / `amountMajor`, never raw `amountMinor`, for plans and packages.
- **Admin → Plans:** collapsed plan summary chips and package preset rows restyled (left-accent stats, soft package tiles) so they do not look like text inputs.

### Verification (session)

- `pnpm -r --if-present run lint`, `pnpm run format:check`, `@persai/api` + `@persai/web` typecheck, `@persai/api` + `@persai/web` test — all green.

### Next recommended step

- Redeploy `api` + `web` to `persai-dev`; ask the assistant for document package pricing and confirm it says **200 ₽** (not 20 000) when catalog has `amountMinor: 20000`.

## 2026-05-21 — Admin UI polish + Business all-time economics

### What landed

- **Admin → Plans:** compact collapsed cards, structured expanded read-only panels, aligned tool-activation edit grid, sticky Save/Cancel with unsaved-change guard.
- **Admin → Tools / Ops:** full-width tools layout, shared field styles, Ops ledger card stretches to column height (no inner scroll).
- **Admin → Business:** ledger-backed model cost is **all time** (`periodSource: all_time`); new **Payments · RUB** card (succeeded `workspace_payment_intents` all time; USD line when international payments exist).
- **Runtime TTS:** `sourceToolCode: "tts"` on artifacts so delivered TTS can append ledger rows from persisted billing facts.

### Verification (session)

- `pnpm -r --if-present run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm --filter @persai/api|runtime|web run test`, `pnpm run build` — all green.

### Next recommended step

- Redeploy `api` + `runtime` + `web` to `persai-dev`; smoke Business all-time totals vs Ops per-user subscription-period ledger; record new TTS after runtime deploy to confirm ledger row.

## 2026-05-21 — ADR-099 Block 2 — committed & pushed (`27868c40`)

- **Git:** `feat(adr099): land Block 2 tool-path economics and ledger wiring` on `main`, pushed to `origin/main`.
- **Verification (session):** lint, format:check, typecheck, full `pnpm run test`, `pnpm run build` — all green. `prisma:migrate:check` skipped locally (no Postgres on `localhost:5432`).
- **CI note:** Prisma schema + migration → full CI / dev deploy needs `persai-dev-migrations` approval before GitOps pin.

## 2026-05-21 — ADR-099 Block 2 Step D (Admin Tools economics UI) — complete

### What landed

- **Admin → Tools** economics panels on Web & Browser and Document Generation: per-provider unit prices bound to `GET/PUT /api/v1/admin/tools/economics` with step-up `admin.tool_path_pricing.update`.
- **Default tier seeds** for `document_render` (pdfmonkey pdf tier; gamma pdf/pptx tiers) so PUT validates without empty tier arrays.
- **Ledger read-model** purpose labels (`web_search`, `web_fetch`, `browser`, `document_render`) and updated coverage note for Block 2 tool paths.
- **Verification:** `@persai/web` + `@persai/api` typecheck; `app/admin/tools/page.test.tsx`; `tool-path-pricing-catalog.test.ts`; ledger tool-path subtest in `record-model-cost-ledger.service.test.ts`.

### Next recommended step

- Dev/prod: set real tool-path tariffs on Admin → Tools (use the same numeric scale as Runtime fixed-operation prices — ledger stores `actualCostMicros` as `round(operationCount × pricePerOperation)` with no extra FX multiplier). Smoke: one `web_search` turn + one `document_render` job, confirm `model_cost_ledger_events` purposes `web_search` / `document_render`.
- Optional: expand Business/Ops breakdown filters if operators need tool-path purposes isolated in charts.
- Optional UX: economics field helper text clarifying micro-unit scale (fractional inputs like `0.05` round to `0` cost today).

## 2026-05-21 — ADR-099 Block 2 Step C (tool-path billing facts + ledger append)

### What landed

- **Shared builders** `buildToolPathOperationBillingFacts` / `buildToolPathTimeBillingFacts` in `@persai/runtime-contract`.
- **Provider-gateway** emits `billingFacts` on successful web_search, web_fetch (firecrawl), browser (browserless), document_render (pdfmonkey/gamma).
- **Runtime** passes facts through tool payloads, `RuntimeTurnToolInvocation` (`toolCallId`, `billingFacts`), document job artifacts, and stream `done` chunks (`toolInvocations`).
- **API ledger** `RecordToolPathLedgerFromToolInvocationsService` appends non-blocking tool-path rows from ordinary web sync/stream + Telegram sync; document jobs record via `assistant-document-job-delivery.service.ts` on delivery start.

### Next recommended step

- **Block 2 Step D:** Admin Tools UI price fields bound to `GET/PUT /admin/tools/economics`; optional Ops/Business purpose labels for tool-path ledger rows.

## 2026-05-21 — ADR-099 Block 2 Step B (tool-path pricing catalog + ledger purposes)

### What landed

- **Tool-path pricing catalog** (`persai.toolPathPricingCatalog.v1`) on `platform_runtime_provider_settings.tool_path_pricing_catalog` with default rows for web_search, web_fetch, browser, document_render providers.
- **Admin API** `GET/PUT /api/v1/admin/tools/economics` + step-up `admin.tool_path_pricing.update`.
- **Ledger** `RecordModelCostLedgerService.recordToolPathBillingFactsEvent()` and purposes `web_search`, `web_fetch`, `browser`, `document_render`; `RuntimeBillingFacts` capabilities extended in `@persai/runtime-contract`.
- **OpenAPI/contracts** schemas for tool-path economics state/request.

### Next recommended step

- **Block 2 Step C:** provider-gateway/runtime emit `billingFacts` on successful web_search, web_fetch, browser, document_render paths.
- **Block 2 Step D:** Admin Tools UI price fields per section + non-blocking ledger append at persistence boundaries.

## 2026-05-21 — Admin Tools Step A (Block 2 UI regroup)

### What landed

- **Admin → Tools:** two-column layout (`max-w-6xl`, `lg:grid-cols-2`); sections Document Processing (full width), Document Generation, Web & Browser, Text to Speech, Media (link to Runtime), Billing, Notifications; single **Save tool credentials** for grouped runtime keys + Postmark.
- **Removed from admin surface:** `tool_memory_search` / “Knowledge Search / Embedding Index API Key” — hidden via `ADMIN_TOOL_CREDENTIAL_KEYS` in `buildAdminToolCredentialsState` (retrieval/embeddings use Runtime OpenAI + internal API).

### Next recommended step

- Block 2 Step C/D (billing facts wiring + Tools price UI); catalog API is ready at `/admin/tools/economics`.

## 2026-05-21 — ADR-099 image token + video per-second billing facts

### What landed

- **Image (`gpt-image-*`):** provider-gateway now emits `token_metered` billing facts from OpenAI `usage` (input/cached/output tokens + `dimensions.operation` for generate vs edit). Ledger `recordPersistedBillingFactsEvent` prices `token_metered` image catalog rows.
- **Video (`sora-*`):** provider-gateway now emits `time_metered` billing facts with `durationSeconds` from request `seconds`. Ledger prices `time_metered` video catalog rows.
- **Catalog defaults:** new/legacy catalog normalization infers `token_metered` for `image`, `time_metered` for `video` (was `fixed_operation`).

### Next recommended step

- On dev/prod Admin Runtime, set real OpenAI Standard prices: image models use **image token** $/1M (output dominant); video models use **$/second\*\*. Redeploy `provider-gateway` + `api` so new billing facts flow into media jobs.

## 2026-05-21 — ADR-099 Ops period economics + knowledge indexing embedding ledger

### What landed

- **Ops period economics (no margin/FX):** `readWorkspacePeriodEconomics` sums succeeded `workspace_payment_intents` in the current quota window (RUB minor units) and USD `model_cost_ledger_events` spend for the same window. Exposed on `AdminOpsUserDirectoryService` user rows and `ResolveAdminOpsCockpitService` as `periodEconomics`.
- **Admin > Ops UI:** user table columns **Paid (period)** and **Cost (USD)**; cockpit card **Period economics** with window, paid total, and ledger USD cost.
- **Knowledge indexing embeddings ledger:** `KnowledgeIndexingService` returns `embeddingUsage`; `KnowledgeIndexingJobWorkerService` appends non-blocking `knowledge_embedding` ledger rows via `RecordModelCostLedgerService.recordKnowledgeIndexingEmbeddingEvent` after successful index jobs.
- **OpenAPI/contracts:** `AdminOpsPeriodEconomicsSnapshot` on `AdminOpsUserRow` and `AdminOpsCockpitState`.

### Still deferred

- Margin / USD↔RUB indication (Business cockpit).
- Provider document render economics (Block 2).
- Async failure framing ledger.

### Verification

- `corepack pnpm run contracts:generate`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- Focused tests: `admin-ops-user-directory`, `resolve-admin-ops-cockpit`, `knowledge-indexing-job-worker`, `record-model-cost-ledger`, `apps/web` ops page vitest

### Next recommended step

- Run dev migration smoke for a knowledge reindex + confirm `knowledge_embedding` rows in ledger; optionally add `knowledge_embedding` to Ops ledger purpose breakdown labels if operators need it visible in the existing ledger card.

## 2026-05-21 — ADR-099 Block 1 / ledger coverage for remaining model-priced paths

### What landed

- **Migration `20260521153000_adr099_block1_ledger_coverage_completion`:** `assistant_media_jobs.completion_usage_json`, `assistant_document_render_jobs.completion_usage_json`, and durable `assistant_voice_transcription_events` for standalone voice HTTP transcribe.
- **Ledger service extensions:** `recordRetrievalHelperEvent`, `recordCompletionFramingUsageEvent`, shared `recordTokenMeteredUsageSnapshot`; purposes `retrieval_helper`, `chat_helper`, `ocr_or_document_parsing`; `ocr_or_document_parsing` capability in runtime contract + Admin Runtime catalog normalization.
- **Non-blocking append wiring:**
  - `knowledge-retrieval-observability.service.ts` — retrieval-helper reranker (`knowledge_retrieval_helper`)
  - `assistant-media-job-completion-delivery.service.ts` / `assistant-document-job-delivery.service.ts` — async completion framing (`chat_helper`, persists `completionUsageJson`)
  - `manage-chat-media.service.ts` — standalone `/media/transcribe` durable row + ledger from persisted `billingFacts`
  - `document-extraction.service.ts` — Mistral OCR synthetic `billingFacts` → `ocr_or_document_parsing`
- **Admin honesty:** `coverageScope` is now `adr099_block1_model_priced_paths`; coverage note lists the expanded Block 1 set. OpenAPI/contracts enum updated to match.

### Still outside Block 1 ledger (explicit)

- Provider document **render** jobs without model-priced `billingFacts` (pdfmonkey/gamma worker path).
- Async **failure** framing (`maybeFrameFailure`) — no usage snapshot persisted yet.
- Non-model tool/path economics (ADR-099 Block 2).

### Verification

- `corepack pnpm exec prisma generate` (apps/api)
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm run contracts:generate`
- Focused API tests: `record-model-cost-ledger`, `assistant-media-job-completion-delivery`, `assistant-document-job-delivery`, `manage-chat-media.*`, `resolve-admin-business-platform`, `resolve-admin-ops-cockpit`

### Next recommended step

- Apply migration `20260521153000_adr099_block1_ledger_coverage_completion` in dev, seed real Admin Runtime prices for STT/TTS/image models used in smoke, and run a short ledger smoke (web chat + voice transcribe + media completion). Decide separately whether document **render** jobs need runtime `billingFacts` or stay explicitly deferred.

## 2026-05-21 — ADR-099 Block 1 / ledger writes from persisted billing facts (media/STT/TTS)

### What landed

- **`RecordModelCostLedgerService.recordPersistedBillingFactsEvent`** now prices replay-safe ledger rows from normalized `RuntimeBillingFacts` using Admin Runtime catalog rows matched by model + timestamp across provider catalogs (`time_metered`, `text_chars_metered`, `fixed_operation`, `tiered_operation`).
- **Non-blocking append wiring** after durable persistence:
  - `assistant-media-job-scheduler.service.ts` — image/video jobs (`media_job_completion`, `sourceEventId=media_job:{id}`)
  - `manage-chat-media.service.ts` — attachment STT ingest (`attachment_stt_ingest`, `sourceEventId=attachment:{id}`)
  - `media-delivery.service.ts` — delivered TTS attachments only (`attachment_tts_deliver`)
- **New ledger purposes:** `image_generation`, `image_edit`, `video_generation`, `stt`, `tts`.
- **Admin read-model honesty:** `ADMIN_MODEL_COST_LEDGER_COVERAGE_NOTE` and `coverageScope` now include persisted media/STT/TTS while still excluding retrieval-helper, standalone voice-transcribe, and other non-persisted paths.

### Verification

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/assistant-media-job-scheduler.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-business-platform.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts`

### Next recommended step

- Superseded by **2026-05-21 — ADR-099 Block 1 / ledger coverage for remaining model-priced paths** above.

## 2026-05-21 — ADR-099 Block 1 follow-up / reviewed billing-facts corrections

### What changed

- API-side Admin Runtime catalog normalization now fully accepts and preserves `text_chars_metered` model profiles instead of silently excluding that branch.
- Video attachment ingest now keeps STT-derived normalized `billingFacts` from the video-audio transcription path and persists them on the ingested attachment row.
- Delivered attachment persistence now matches the documented ownership split: image/video billing facts stay on `assistant_media_jobs`, while delivered attachment rows keep billing facts only for TTS outputs.

### Verification

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/media-preprocessor.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts`

### Next recommended step

- Resume the next ADR-099 non-ledger follow-up only after keeping these corrected ownership boundaries stable: media jobs own image/video billing facts, attachment-ingest owns STT facts, and delivered attachments own TTS facts only.

## 2026-05-21 — ADR-099 Block 1 / media-STT-TTS billing-facts persistence foundation

### What landed

- **Media/STT/TTS now have a normalized additive `billingFacts` contract without ledger writes.** `packages/runtime-contract/src/index.ts` now defines normalized billing facts for token, time, text-char, and operation metering, and the runtime/provider-gateway path can return those facts for image, video, STT, and TTS results.
- **Durable media-job and attachment persistence now stores billing facts on API-owned rows.** `assistant_media_jobs.billing_facts_json` now holds background media-job billing facts for image/video, while `assistant_chat_message_attachments.billing_facts_json` now stores STT attachment-ingest facts and TTS-delivered attachment facts.
- **Runtime/provider catalog truth now honestly covers STT/TTS pricing modes.** Admin Runtime catalog semantics now recognize `speech_to_text`, `text_to_speech`, and `text_chars_metered` while keeping existing chat-model selector behavior derived only from active chat-capable rows.
- **Standalone voice-transcribe was intentionally deferred.** The current `/api/v1/media/transcribe` path still lacks its own dedicated durable event row, so this slice stops at attachment-ingest STT persistence instead of inventing a new cross-cutting source seam mid-session.

### Why

ADR-099 Block 1 still needed a durable non-ledger foundation for non-text provider-priced paths. This slice lands only the persisted facts needed for later honest ledger writes, without changing quota semantics, Business/Ops behavior, or downstream selector rules.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/elevenlabs/elevenlabs-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/yandex/yandex-provider.client.ts`
- `apps/runtime/src/modules/turns/provider-gateway.client.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-tts-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-media-job-run.service.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260520215000_adr099_session_b_ledger_foundation/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-chat-message-attachment.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-chat-message-attachment.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat-message-attachment.repository.ts`
- `apps/api/src/modules/workspace-management/application/assistant-runtime.facade.ts`
- `apps/api/src/modules/workspace-management/application/assistant-media-job-scheduler.service.ts`
- `apps/api/src/modules/workspace-management/application/internal-runtime-media-job.client.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
- `apps/api/src/modules/workspace-management/application/media/media.types.ts`
- `apps/api/src/modules/workspace-management/application/media/media-preprocessor.service.ts`
- `apps/api/src/modules/workspace-management/application/media/media-delivery.service.ts`
- `apps/api/src/modules/workspace-management/application/media/native-media-transcription.service.ts`
- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
- `apps/web/app/app/runtime-provider-settings-admin.ts`
- `apps/web/app/admin/runtime/page.tsx`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/model/index.ts`
- `packages/contracts/src/generated/model/runtimeProviderBillingMode.ts`
- `packages/contracts/src/generated/model/runtimeProviderModelCapability.ts`
- `packages/contracts/src/generated/model/runtimeProviderModelProfileState.ts`
- `packages/contracts/src/generated/model/runtimeProviderPriceMetadataState.ts`
- `packages/contracts/src/generated/model/runtimeProviderTextCharsMeteredModelProfileState.ts`
- `packages/contracts/src/generated/model/runtimeProviderTextCharsMeteredModelProfileStateAllOf.ts`
- `packages/contracts/src/generated/model/runtimeProviderTextCharsMeteredModelProfileStateAllOfBillingMode.ts`
- `packages/contracts/src/generated/model/runtimeProviderTextCharsMeteredPriceMetadataState.ts`
- `packages/contracts/src/generated/model/runtimeProviderTextCharsPriceMetadataState.ts`
- `apps/api/test/manage-chat-media.stage-web-thread.test.ts`
- `apps/api/test/assistant-media-job-scheduler.service.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/contracts run typecheck`
- `corepack pnpm --filter @persai/provider-gateway run typecheck`
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts`
- `corepack pnpm --filter @persai/api exec tsx --test test/assistant-media-job-scheduler.service.test.ts`

### Risks / residuals

- This slice still does **not** append `model_cost_ledger_events` for media/STT/TTS; it only stores normalized durable billing facts on the owning rows.
- OpenAI STT duration-based billing facts currently depend on local `ffprobe` availability; if probing fails, STT billing facts stay `null` instead of fabricating duration.
- Standalone voice-transcribe remains outside the durable-proof set until it has its own API-owned persistent event row or another clean replay-safe seam.

### Next recommended step

- Stay inside ADR-099 Block 1: append replay-safe ledger rows for image/video/STT/TTS only after pricing reads from the newly persisted `billing_facts_json` seams, and decide a dedicated durable row/seam for standalone voice-transcribe before including that path.

## 2026-05-21 — ADR-099 Block 1 / Session C closeout: background-task evaluator ledger

### What landed

- **Successful background-task evaluator runs now append replay-safe ledger rows from durable run facts.** `apps/api/src/modules/workspace-management/application/persai-background-task-scheduler.service.ts` now appends a non-blocking ledger write after the corresponding `assistant_background_task_runs` row is durably updated, using the persisted run id as the source event id and the same token-priced catalog lookup discipline as the ordinary-chat proof set.
- **Background-task pricing now keys off the durable run-start timestamp seam, not scheduler finish time.** The background-task ledger append now prices the evaluator call against the persisted `assistant_background_task_runs.startedAt` timestamp so historical catalog lookup stays anchored to the actual call window instead of a later completion clock.
- **`RecordModelCostLedgerService` now covers the first non-ordinary-chat Session C path without changing quota semantics.** `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts` adds a single-snapshot `background_task` writer for token-metered evaluator usage already persisted in `assistant_background_task_runs.usageJson`, reusing the canonical immutable event shape, historical price snapshot/versioning, and deterministic duplicate skipping.
- **Shared Business/Ops ledger coverage metadata is now honest about the widened proof set.** The shared admin ledger read-model contract now says the current coverage set includes ordinary chat plus background-task evaluator rows, and the common coverage note no longer incorrectly claims background is excluded.
- **Retrieval-helper / reranker was intentionally deferred.** Inspection showed that current `knowledge_retrieval_events` persistence keeps helper provider/model/token metrics for observability, but it still does not provide a clean replay-safe per-helper source seam and durable user attribution suitable for honest canonical ledger writes, so this slice stops instead of fabricating cost truth.

### Why

The remaining implementation-ready Session C closeout work was to widen the ledger only where provider/model/usage facts were already durably persisted. Background-task evaluator runs satisfied that bar through `assistant_background_task_runs`, while retrieval-helper/reranker did not yet meet the same honesty threshold.

### Files touched

- `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts`
- `apps/api/src/modules/workspace-management/application/model-cost-ledger-read-model.ts`
- `apps/api/src/modules/workspace-management/application/persai-background-task-scheduler.service.ts`
- `apps/api/test/record-model-cost-ledger.service.test.ts`
- `apps/api/test/persai-background-task-scheduler.service.test.ts`
- `apps/api/test/resolve-admin-business-platform.service.test.ts`
- `apps/api/test/resolve-admin-ops-cockpit.service.test.ts`
- `apps/web/app/admin/business/page.test.tsx`
- `apps/web/app/admin/ops/page.test.tsx`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/model/adminModelCostLedgerWindowStateCoverageScope.ts`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/persai-background-task-scheduler.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-business-platform.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Risks / residuals

- Session C is still not full Block 1 coverage: retrieval-helper/reranker, media/document completion copy, STT, image/video, and other non-ordinary-chat provider-priced paths remain separate follow-up work.
- Background-task coverage is intentionally limited to the evaluator model call whose usage snapshot is durably stored on the run row; the separate tool-enabled synthetic background turn is not priced here because its usage is not yet persisted in the same canonical replay-safe seam.
- Business and Ops now include this widened ledger truth automatically where their existing ledger-backed windows overlap it, but they still must be read as current covered-cost views rather than final full-platform economics.

### Next recommended step

- Stay on ADR-099 Block 1 / Session C only: land retrieval-helper/reranker cost rows only after a clean per-helper source event / attribution seam exists, or move to the next provider-priced non-ordinary-chat path whose raw usage facts are already durably persisted as honestly as background-task evaluator runs.

## 2026-05-20 — ADR-099 Session D: Business/Ops read models

### What landed

- **`Admin > Business` now has the first ledger-backed model-cost block.** `apps/api/src/modules/workspace-management/application/resolve-admin-business-platform.service.ts` now adds a compact last-7-day summary sourced from `model_cost_ledger_events`, and `apps/web/app/admin/business/page.tsx` renders that summary ahead of the old runtime-token section. The UI explicitly frames this as current ledger-backed model cost for the presently covered ordinary-chat paths, not final full-platform economics.
- **`Admin > Ops` now has a current-period ledger-backed cost block for the selected workspace.** `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts` now adds a current quota-period summary plus top provider/model/purpose rows from the same ledger, and `apps/web/app/admin/ops/page.tsx` renders that beside the existing quota/chat/support cards without changing billing or quota controls.
- **Both admin read models now reuse one shared ledger summary helper.** New `apps/api/src/modules/workspace-management/application/model-cost-ledger-read-model.ts` centralizes the ordinary-chat coverage note plus the ledger grouping logic so Business and Ops read the same current-proof truth instead of diverging into separate pricing/cost calculations.

### Why

ADR-099 Session D needed the first minimal Business/Ops rollout on top of the existing catalog + ledger proof set, but current ledger coverage is still intentionally narrow. This slice keeps the rollout honest by exposing only the current ledger-backed ordinary-chat cost truth, labeling the gap to uncovered paths explicitly, and leaving quota semantics plus existing support surfaces unchanged.

### Files touched

- `apps/api/src/modules/workspace-management/application/model-cost-ledger-read-model.ts`
- `apps/api/src/modules/workspace-management/application/platform-business.types.ts`
- `apps/api/src/modules/workspace-management/application/ops-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-business-platform.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/test/resolve-admin-business-platform.service.test.ts`
- `apps/api/test/resolve-admin-ops-cockpit.service.test.ts`
- `apps/web/app/admin/business/page.tsx`
- `apps/web/app/admin/ops/page.tsx`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-business-platform.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Risks / residuals

- Session D is still intentionally limited by Session C ledger coverage: ordinary web sync, ordinary web stream completion, and ordinary Telegram sync with current `chat_main_reply` + `router` entries only.
- Business still does not show authoritative revenue/margin, and Ops still does not show full-platform cost; both new blocks are current ledger-backed model-cost truth only.
- If pricing rows ever span multiple currencies in one read window, the UI now shows per-currency totals rather than pretending there is one merged money figure, but richer multi-currency business treatment remains later work if needed.

### Next recommended step

- Return to ADR-099 Block 1 on the coverage side before richer economics: widen ledger attribution to the next high-confidence non-ordinary-chat provider-priced path, then only expand Business/Ops beyond this compact cost-only rollout once that broader ledger truth exists.

## 2026-05-20 — ADR-099 Session C follow-up: Telegram claim completion + ledger idempotency

### What landed

- **Successful ordinary Telegram turns now finalize their dedupe claim durably.** `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts` now calls the existing completion helper on the ordinary success path after persistence/follow-up work, so successful Telegram turns mark the update handled instead of leaving the claim open until stale expiry. The existing failure behavior stays bounded: failed completion falls back to claim release, and assistant-message persistence failure still does not mark the update handled.
- **Ordinary-chat ledger writes now have a deterministic idempotency guard.** `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts` derives a stable per-entry event id from the ordinary-chat logical source event plus entry identity and writes with duplicate skipping, so replay/retry of the same ordinary web/Telegram priced call does not append duplicate money rows while event rows remain immutable once inserted.
- **Focused tests cover both follow-up fixes.** `apps/api/test/handle-internal-telegram-turn.service.test.ts` now asserts successful turns complete Telegram claims and completion-failure fallback releases them cleanly, while `apps/api/test/record-model-cost-ledger.service.test.ts` now proves repeated ordinary-chat ledger writes for the same logical entries insert once only.

### Why

Readonly review found two concrete Session C correctness gaps in the widened ordinary-chat rollout: Telegram dedupe still depended on stale-claim expiry on success, and the money ledger had no deterministic replay guard for the same logical source event. This follow-up keeps the scope inside the existing ordinary-chat coverage set while making Session C safer for retries and replays.

### Files touched

- `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/test/record-model-cost-ledger.service.test.ts`
- `apps/api/test/handle-internal-telegram-turn.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Risks / residuals

- Session C coverage is still intentionally limited to ordinary chat only: web sync, web stream, and Telegram sync.
- Background-task evaluation, media/document completion copy, STT, and other non-ordinary-chat provider-priced paths still need separate attribution/metering review before ledger rollout.

### Next recommended step

- Stay on ADR-099 Block 1 / Session C only: audit the next non-ordinary-chat provider-priced path and land only the first path whose attribution and raw usage facts are already persisted cleanly enough for replay-safe ledger writes.

## 2026-05-20 — ADR-099 Session C path expansion: ordinary Telegram + router classifier usage

### What landed

- **Ordinary chat ledger coverage now includes the next high-confidence router/classifier entries.** `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts` still uses the Session B canonical event shape and strict timestamp-matched catalog lookup, but now also records `router` money events for the existing `turn_routing` and `skill_state_routing` system-tool entries already present in ordinary-chat `usageAccounting.entries`.
- **Ordinary Telegram chat now writes the same additive ledger events as web chat.** `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts` appends non-blocking ledger writes after successful assistant-message persistence, using the existing Telegram attribution and the same replay-safe pricing lookup as web.
- **Focused tests cover the widened slice.** `apps/api/test/record-model-cost-ledger.service.test.ts` now proves router plus main-reply writes from one ordinary-chat accounting payload, and `apps/api/test/handle-internal-telegram-turn.service.test.ts` asserts the Telegram path forwards its completed-turn ledger append without changing quota behavior.

### Why

ADR-099 Session C needed a smaller clean expansion beyond Session B's web main-reply proof. Ordinary Telegram turns already carried the same reliable attribution as web, and router/classifier calls were already surfaced in ordinary-chat `usageAccounting.entries`, so this slice widens ledger coverage without inventing new metering or touching broader background/media economics.

### Files touched

- `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/test/record-model-cost-ledger.service.test.ts`
- `apps/api/test/handle-internal-telegram-turn.service.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`

### Risks / residuals

- This Session C slice is still deliberately bounded to ordinary chat paths with existing `usageAccounting.entries` truth: web sync, web stream, and Telegram sync.
- Background-task evaluation, media/document completion copy, STT, and other non-ordinary-chat provider-priced paths still need separate Session C/D follow-up once their attribution/metering seams are reviewed.

### Next recommended step

- Stay on ADR-099 Block 1 / Session C only: audit the next non-ordinary-chat provider-priced paths and land the first additional path whose raw usage/provider-model attribution is already persisted cleanly enough for replay-safe ledger writes.

## 2026-05-20 — ADR-099 Session B follow-up: deployable migration chain + strict timestamp match

### What landed

- **Session B now has one deployable migration path.** The duplicate earlier ledger migration was removed, leaving `apps/api/prisma/migrations/20260520215000_adr099_session_b_ledger_foundation/migration.sql` as the single correct migration for `model_cost_ledger_events`.
- **Historical price lookup no longer falls back to the wrong catalog row.** `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts` now returns `null` when no provider/model catalog row covers the event timestamp instead of silently choosing a non-matching profile.
- **Ledger proof coverage now explicitly tests the no-match skip case.** `apps/api/test/record-model-cost-ledger.service.test.ts` adds focused coverage asserting that Session B does not write a misleading money row when catalog history has a gap for the event timestamp.

### Why

Readonly review found two correctness gaps in the first Session B landing: duplicate Prisma migrations would make the deploy chain ambiguous, and the timestamp lookup could misprice historical events by falling back to a row that was not effective at the event time. This follow-up keeps the slice bounded while making the ledger foundation replay-safe and deployable.

### Files touched

- `apps/api/prisma/migrations/20260520214500_adr099_session_b_model_cost_ledger_foundation/migration.sql` (removed duplicate)
- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
- `apps/api/test/record-model-cost-ledger.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`

### Risks / residuals

- Session B remains intentionally narrow: completed ordinary web-chat main replies only.
- When catalog history has a gap for an event timestamp, Session B now drops that ledger write rather than guessing a price. Broader reconciliation/reporting for such gaps remains later work if needed.

### Next recommended step

- Stay on ADR-099 Block 1 / Session C only: expand ledger coverage to the next provider/model-priced paths, keeping the same strict timestamp-match rule and additive quota semantics.

## 2026-05-20 — ADR-099 Session B ledger foundation

### What landed

- **The first immutable provider/model cost-ledger table is now in the API data model.** `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/20260520215000_adr099_session_b_ledger_foundation/migration.sql` add append-only `model_cost_ledger_events` with attribution ids, provider/model/capability/purpose/surface/source, billing mode, raw usage JSON, integer `actualCostMicros`, currency, hashed `priceCatalogVersion`, full `priceCatalogSnapshot`, correlation ids, and `occurredAt`.
- **Web chat now has the first money-first write path.** New `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts` writes ledger rows for completed ordinary web-chat reply entries using runtime `usageAccounting.entries`, filters this proof to `chat_main_reply` reply-generation rows only, resolves the provider/model catalog row effective at the turn timestamp, and snapshots that historical pricing context onto each immutable event.
- **Completed web sync and stream turns are now wired end-to-end.** `send-web-chat-turn.service.ts` and `stream-web-chat-turn.service.ts` append non-blocking ledger events after successful persistence/quota handling, while keeping existing user quota semantics unchanged and leaving partial/interrupted streams on the old quota-only path.

### Why

ADR-099 Session B needed the first money ledger foundation without widening into helper/router/background/media coverage or dashboard redesign. This slice lands one canonical persisted event shape plus one high-confidence provider/model-priced path so later sessions can expand onto stable cost truth instead of inventing per-surface economics.

### Files touched

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260520215000_adr099_session_b_ledger_foundation/migration.sql`
- `apps/api/src/modules/workspace-management/application/record-model-cost-ledger.service.ts`
- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/record-model-cost-ledger.service.test.ts`
- `apps/api/test/send-web-chat-turn.service.test.ts`
- `apps/api/test/stream-web-chat-turn.service.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/api run prisma:generate`
- `corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/quota-accounting.test.ts`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Risks / residuals

- Session B proof writes ledger events only for **completed ordinary web chat** provider/model reply rows (`web_chat_turn_sync` and `web_chat_turn_stream_completed`) when runtime returns concrete `usageAccounting.entries`.
- Router/helper/system-tool/background/STT/image/video/document and Telegram paths are still out of scope for this slice and do not write the new ledger yet.
- Business/Ops dashboards still do not read the new ledger in this session; this is foundation-only.

### Next recommended step

- Move to ADR-099 Block 1 / Session C only: expand ledger coverage from the same canonical event shape into the next high-confidence provider/model-priced paths (Telegram ordinary chat, then helper/router/background/media/STT paths) without changing quota semantics or jumping to dashboards.

## 2026-05-20 — ADR-099 Session A follow-up: single-branch pricing + archive-safe catalog rows

### What landed

- **Each runtime catalog row now has one clean pricing branch that matches its `billingMode`.** `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`, `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`, and `packages/contracts/openapi.yaml` now model `providerPriceMetadata` as a billing-mode-specific shape instead of one object that can carry unrelated token/time/fixed/tiered branches at once.
- **`Admin > Runtime` now archives catalog history instead of deleting it.** `apps/web/app/admin/runtime/page.tsx` replaced the destructive row action with archive/version-safe behavior: persisted rows become inactive historical entries (with `effectiveTo` bounded when first archived), while brand-new unsaved blank drafts may still be discarded locally before save.
- **The actual runtime editor page now has focused UI coverage.** `apps/web/app/admin/runtime/page.test.tsx` exercises billing-mode switching, pricing-branch payload shaping, and archive/version-safe row handling through the rendered page, not just helper-level tests.

### Why

Readonly review of Session A found that the original catalog foundation still allowed ambiguous multi-branch pricing payloads and a hard-delete row action that could erase historical truth. This follow-up closes both gaps while staying inside the same bounded Session A slice and keeps later ledger work attached to one unambiguous catalog row shape.

### Files touched

- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
- `apps/api/test/platform-runtime-provider-settings.test.ts`
- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/admin/runtime/page.test.tsx`
- `apps/web/app/app/runtime-provider-settings-admin.ts`
- `apps/web/app/admin/knowledge/page.test.tsx`
- `apps/web/app/app/assistant-api-client.test.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm contracts:generate`
- `corepack pnpm --filter @persai/contracts run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/materialize-assistant-published-version.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/apply-assistant-published-version.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/generate-skill-authoring-draft.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/quota-accounting.test.ts`
- `corepack pnpm --filter @persai/web exec vitest run app/app/runtime-provider-settings-admin.test.ts app/admin/knowledge/page.test.tsx app/admin/plans/page.test.tsx app/app/assistant-api-client.test.ts app/admin/runtime/page.test.tsx --config vitest.config.ts`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Risks / residuals

- Session A still does **not** write the unified model cost ledger or change Business/Ops economics surfaces; this follow-up only makes the catalog foundation stricter and safer for later ledger work.
- Catalog row versioning is still date-bounded/inactive-state based; there is not yet a dedicated immutable catalog-row id or ledger foreign key in this slice.

### Next recommended step

- Move to ADR-099 Block 1 / Session B only: add the first immutable model cost-ledger write path that reads pricing exclusively from the now-unambiguous archived catalog rows.

## 2026-05-20 — ADR-099 Session A catalog foundation

### What landed

- **`Admin > Runtime` now edits a structured provider/model catalog instead of a pipe-delimited profile textarea.** `apps/web/app/admin/runtime/page.tsx` now renders provider-scoped model cards with structured fields for model key, capabilities, `active`, `billingMode`, effective dates, token weights, notes, and mode-specific pricing metadata. Catalog versioning now starts from ordinary card duplication/deactivation rather than one lossy text blob.
- **Runtime provider settings now persist pricing-aware catalog rows as the primary structured truth.** `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts` and `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts` now normalize/store catalog rows with `active`, `billingMode`, `effectiveFrom`, `effectiveTo`, and structured `providerPriceMetadata` (`currency` plus token/time/fixed/tiered price shapes). Legacy weight-only rows still normalize forward on read.
- **Downstream model-pick semantics stay unchanged for active models.** The compatibility alias `availableModelsByProvider` is still emitted, but it is now derived from active chat-capable catalog rows. Plan/knowledge/materialization paths continue to select from the active model list without changing user-facing picker semantics, while inactive historical rows stay out of ordinary selectors.

### Why

ADR-099 Session A required replacing the old textarea-centric runtime catalog truth with a real provider/model catalog foundation while preserving existing downstream model-pick behavior. Landing the structured catalog now makes later ledger work attach to one pricing source instead of retrofitting price truth into a text parser or into secondary analytics tables.

### Files touched

- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/admin/plans/page.tsx`
- `apps/web/app/admin/knowledge/page.tsx`
- `apps/web/app/app/runtime-provider-settings-admin.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- `corepack pnpm contracts:generate`
- `corepack pnpm --filter @persai/contracts run typecheck`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/materialize-assistant-published-version.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/apply-assistant-published-version.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/generate-skill-authoring-draft.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/quota-accounting.test.ts`
- `corepack pnpm --filter @persai/web exec vitest run app/app/runtime-provider-settings-admin.test.ts app/admin/knowledge/page.test.tsx app/admin/plans/page.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts`

### Risks / residuals

- Session A does **not** write the unified model cost ledger yet. Pricing metadata is now catalog truth, but no money ledger rows or Business/Ops ledger-backed read models land in this slice.
- Historical catalog rows can now be kept inactive beside the active version, but there is still no dedicated ledger/version-id linkage yet; Session B will need that canonical pricing-version reference when cost events start writing.
- The new admin runtime catalog has focused test coverage plus typechecks, but it does not yet have a dedicated page-level UI test for the full card editor surface.

### Next recommended step

- Execute ADR-099 Block 1 / Session B only: add the first unified model cost-ledger write path and canonical event shape, wiring only the first high-confidence provider/model-priced paths needed for end-to-end proof while reading pricing exclusively from the new catalog foundation.

## 2026-05-20 — ADR-099 provider pricing catalog + unified model cost ledger audit

### What landed

- **Completed a full audit of current economics-relevant code paths.** The audit covered visible chat replies plus helper/router calls, background model calls, STT, image, video, document-related model/provider paths, current runtime model admin surfaces, and the existing `Admin > Business` / `Admin > Ops` analytics inputs.
- **Proposed a new architecture ADR for long-term unit economics.** `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md` is added as the planning document for a clean split between user-facing quota truth and internal money-first cost truth.
- **Fixed the scope split for future implementation.** ADR-099 now treats Block 1 as all provider/model-priced paths (text, image, video, STT, helper/router/background model calls, and the required admin/runtime/business/ops surfaces) and reserves Block 2 for later non-model tool/path economics only.
- **Made the ADR execution-ready for future agent work.** ADR-099 now includes explicit execution rules for a parent agent and readonly subagents, a mandatory bounded-slice rule, ordered Block 1 session sequencing, and a reusable implementation-session prompt so future model/subagent work can execute under one controlling agent without parallel write drift.

### Why

Discussion confirmed that PersAI should keep simple user-facing quota semantics while separately calculating real себестоимость and margin. The repo already had enough quota and billing structure to support this, but not one clean provider-pricing catalog or one unified model cost ledger. The audit and ADR capture exactly where current code diverges from that target so implementation can proceed in bounded blocks instead of mixing new economics into existing quota logic ad hoc.

### Files touched

- `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

- Read-only audit only; no runtime code changed.
- Verified current model/quota/cost surfaces against:
  - `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`
  - `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
  - `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
  - `packages/runtime-contract/src/index.ts`
  - `apps/web/app/app/runtime-provider-settings-admin.ts`
  - `apps/web/app/admin/runtime/page.tsx`
  - `apps/api/src/modules/workspace-management/application/resolve-admin-business-platform.service.ts`
  - `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`

### Risks / residuals

- ADR-099 is proposed architecture, not implemented code. Current repo truth remains weight-first for text quota, unit-based for media/document quotas, and split across multiple analytics inputs.
- Business and Ops still do not read one unified money ledger. The next implementation block must add the catalog/ledger/read-model layers before any pricing or margin decisions are treated as authoritative in admin surfaces.

### Next recommended step

- Execute ADR-099 Block 1 only: replace the runtime model textarea with a real provider/model catalog in `Admin > Runtime`, keep downstream model selection list semantics unchanged, and add the first unified model cost ledger plus `Business` / `Ops` read models for provider/model-priced paths only.

## 2026-05-20 — Preset avatar in personality scene + media portrait tile removal

### What landed

- **`Name, voice, character` now uses a real PersAI preset avatar instead of the placeholder silhouette tile.** In `apps/web/app/_components/landing/workflow-surface.tsx`, `AvatarTile` now renders `apps/web/public/avatar-presets/luma.png` via `next/image`, keeping the same card size and frame treatment but replacing the schematic head/shoulders drawing with an actual product preset.
- **`Images and video` no longer includes the intrusive schematic portrait tile.** The extra portrait-style media tile that sat at the lower-left and visually climbed into the message area was removed from `MediaScene`, leaving the image, abstract, and video artifacts as the only outputs around the chat.

### Why

Founder review in production surfaced two clarity issues: the placeholder avatar in the personality scene looked too schematic compared with the rest of the product, and the portrait tile in the media scene read as accidental overlap rather than a useful artifact. Replacing the first with a real preset and removing the second makes both scenes feel more intentional.

### Files touched

- `apps/web/app/_components/landing/workflow-surface.tsx`
- `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`

### Verification

- `corepack pnpm -r --if-present run lint` — clean.
- `corepack pnpm run format:check` — clean.
- `corepack pnpm --filter @persai/api run typecheck` — clean.
- `corepack pnpm --filter @persai/web run typecheck` — clean.
- `corepack pnpm --filter @persai/web exec vitest run app/page.test.tsx` — `3/3` green.

### Risks / residuals

- `luma.png` is now part of the active landing visual language, not only the assistant setup/catalog surface. If founder later wants the workflow scenes to stay more abstract, the follow-up would be to swap it for a smaller cropped preset variant rather than return to the old placeholder illustration.

### Next recommended step

- Quick production glance at `Name, voice, character` and `Images and video` in both light and dark themes, then leave the workflow scenes alone unless another concrete mobile overlap appears.

## 2026-05-20 — Document-job live UI continuity for PPTX prep + chat-list activity

### What landed

- **PPTX preparation now materializes as active work immediately in the current chat.**
  `apps/web/app/app/_components/presentation-pptx-prepare-action.tsx` now
  notifies the parent when the explicit PPTX render request is accepted, and
  `apps/web/app/app/chat/page.tsx` routes that through
  `useChat.noteDocumentJobStarted()` plus `reloadChats()`. Result: the chat
  starts showing document work without a manual page refresh, and the existing
  history refresh loop can materialize the finished PPTX banner as soon as
  delivery lands.
- **`useChat` now tracks document-job activity through the shared live-thread path.**
  `apps/web/app/app/_components/use-chat.ts` now marks active document jobs in
  the shared registry the same way it already marked media jobs, including an
  optimistic queued job when PPTX preparation is accepted.
- **Sidebar live indicators now include document jobs.**
  `apps/web/app/app/_components/streaming-threads.tsx` gained document-job
  tracking, and `apps/web/app/app/_components/sidebar.tsx` now treats either
  registry-tracked document work or server-provided `activeDocumentJobs` as
  enough to show the pulsing indicator in the chat list.
- **Focused regression coverage was extended.**
  `presentation-pptx-prepare-action.test.tsx` now asserts the parent
  notification callback, and `sidebar.test.tsx` now covers document-job-driven
  live indicators.

### Why

Founder reported two remaining UX failures in the new PPTX flow: after
confirming the second PPTX render, the chat still looked idle until a manual
refresh, and background document jobs did not pulse in the sidebar like
streaming or media work. Backend job truth was already correct; the gap was
entirely in frontend continuity between "accepted" and "visible as active".

### Files touched

- `apps/web/app/app/_components/presentation-pptx-prepare-action.tsx`
- `apps/web/app/app/_components/presentation-pptx-prepare-action.test.tsx`
- `apps/web/app/app/_components/chat-message.tsx`
- `apps/web/app/app/_components/chat-area.tsx`
- `apps/web/app/app/_components/chat-area.test.tsx`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/_components/streaming-threads.tsx`
- `apps/web/app/app/_components/sidebar.tsx`
- `apps/web/app/app/_components/sidebar.test.tsx`
- `apps/web/app/app/chat/page.tsx`
- `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`

### Verification

- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/presentation-pptx-prepare-action.test.tsx app/app/_components/sidebar.test.tsx app/app/_components/chat-area.test.tsx app/app/_components/streaming-threads.test.tsx`
  — `36/36` green.
- `corepack pnpm --filter @persai/web run typecheck` — clean.

### Risks / residuals

- The optimistic document-job marker is intentionally generic (`queued`) until
  the server snapshot comes back. That keeps UI continuity honest, but if
  future product asks for richer per-job copy in the gap between accept and
  first refresh, the optimistic local shape may need a small UX-specific label
  field instead of borrowing backend job fields only.

### Next recommended step

- Run one real browser pass on the deployed chat surface: confirm the PPTX
  "working" state appears immediately after confirmation, the final PPTX banner
  lands without full-page reload, and the same thread pulses in the sidebar
  throughout the background render.

## 2026-05-20 — Dark SBP visibility + auth footer parity + narrow document-label cleanup

### What landed

- **SBP mark is now visible in dark mode.** In `apps/web/app/_components/landing/finale-section.tsx`, the small `SBP` logo inside the finale trust chip now gets a dark-mode invert/brightness treatment, so it no longer disappears into the dark footer surface.
- **`sign-in` / `sign-up` now use the same footer treatment as legal pages.** `apps/web/app/_components/public-auth-shell.tsx` footer spacing and border rhythm now mirror the legal/static pages (`border-t`, centered max width, top padding). `apps/web/app/sign-in/[[...sign-in]]/page.tsx` and `apps/web/app/sign-up/[[...sign-in]]/page.tsx` now enable that footer in their loading, main, and sign-up-complete states.
- **Document scene no longer ships fragile slide-count labels on narrow screens.** `apps/web/app/_components/landing/workflow-surface.tsx` removed the `Slide 1 / 12` captions from the `PDF`, `PPTX`, and `DOCX` cards and also dropped the small `12 slides` footer label from the `PPTX` card, leaving the document compositions clean and stable on narrow mobile widths.
- **Landing workflow test was aligned to the new document-card truth.** `apps/web/app/page.test.tsx` no longer expects `Slide 1 / 12` inside the workflow scene.

### Why

Founder validated the previous mobile layout pass in production and flagged three remaining polish issues: the `SBP` mark was too faint in dark mode, auth pages still closed with a simpler footer than legal pages, and the slide-count labels inside document cards were the next thing to break on narrow screens. All three fixes are surface-level presentation adjustments with no product-flow change.

### Files touched

- `apps/web/app/_components/landing/finale-section.tsx`
- `apps/web/app/_components/public-auth-shell.tsx`
- `apps/web/app/sign-in/[[...sign-in]]/page.tsx`
- `apps/web/app/sign-up/[[...sign-in]]/page.tsx`
- `apps/web/app/_components/landing/workflow-section.tsx`
- `apps/web/app/_components/landing/workflow-surface.tsx`
- `apps/web/app/page.test.tsx`
- `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`

### Verification

- `corepack pnpm -r --if-present run lint` — clean.
- `corepack pnpm run format:check` — clean.
- `corepack pnpm --filter @persai/api run typecheck` — clean.
- `corepack pnpm --filter @persai/web run typecheck` — clean.
- `corepack pnpm --filter @persai/web exec vitest run app/page.test.tsx` — `3/3` green.

### Risks / residuals

- The auth footer now uses legal-page framing through the shared `PublicAuthShell`, so public pricing inherits the same calmer footer rhythm as well. That is visually consistent with founder direction, but if pricing later needs a stronger merchandising footer it should become an explicit shell option rather than a silent divergence.
- The `deckCaption` i18n keys still exist in locale files even though the workflow scene no longer renders them. They are harmless, but can be removed in a future cleanup pass if founder wants the message catalogs trimmed.

### Next recommended step

- Do one last visual pass in dark mode on the finale trust row and on `sign-in` / `sign-up` to confirm the new footer and `SBP` contrast feel correct in production, then stop the landing/public polish slice.
