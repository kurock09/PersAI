# SESSION-HANDOFF

> Archive: handoff sections from 2026-05-19 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`. Keep using this file for the active 2026-05-20 working set, including all ADR-099 entries.

## 2026-05-29 — Light palette + landing background reset

### Scope

Bounded visual reset after the broader UI polish was reverted:

- change only light color tokens toward the provided cream/peach/sage reference
- remove public landing aurora/noise background layers
- adjust only public landing CTA button styling after visual approval
- apply the same compact material treatment to chat file attachment pills
- do not change cards, chat/settings/sidebar structure, or dark mode

### What changed

`apps/web/app/globals.css` light tokens now use a warmer milk/peach base (`chrome`, `bg`, `surface`, `surface-raised`) with quiet sage accents. `apps/web/app/page.tsx` no longer renders the fixed aurora glow blobs or SVG grain overlay, leaving the landing on a clean warm `bg-chrome` foundation with the existing top hairline only. Landing hero/finale primary CTAs now use calm sage filled pills without glow/shimmer, and secondary CTAs use warm raised cream pills. Both CTA styles include a subtle outer edge, top inset highlight, bottom inset shade, and soft drop shadow so they read slightly convex like the reference. Dark-theme CTA overrides preserve the same raised edge on a graphite landing: lighter sage primary, darker raised secondary, and lower-contrast dark bevel shadows. Chat file attachment pills are now compact full pills with smaller type/badge and matching raised edge/highlight treatment in both themes.

### Files / modules

- `apps/web/app/globals.css`
- `apps/web/app/page.tsx`
- `apps/web/app/_components/landing/hero-section.tsx`
- `apps/web/app/_components/landing/finale-section.tsx`
- `apps/web/app/app/_components/chat-message.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Checks passed:

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/web run test`
6. `git diff --check`

### Risks / residuals

- This intentionally does not tune component-level colors, cards, buttons, or settings rows yet. Further UI changes should be done screen-by-screen after visual approval.

### Next recommended step

Review the landing and authenticated app in light mode with the new baseline colors, then choose one screen for the next tightly scoped pass.

## 2026-05-29 — Document pending-delivery honesty guard

### Scope

Bounded document-generation reliability fix:

- make accepted async document jobs model-visible as pending delivery, not ready/sent
- prevent same-turn `files.send` from sending an older document while the new job is pending
- keep backend `AssistantDocumentJobDeliveryService` as the owner of final file delivery
- remove structured-render duplicate headings
- avoid broader document-worker or provider rewrites

### What changed

Runtime document-tool accepted results now use `action: "pending_delivery"` with `canSendFileNow=false`, durable `jobId`, `docId`, `versionId`, and pending user copy. The follow-up developer instruction explicitly tells the model that backend delivery has not happened yet and forbids `files.send` for the pending document or older document files in the same turn.

Same-turn assistant text for pending document jobs is normalized to the standard "request accepted / will send separately when ready" acknowledgement instead of preserving model-authored ready/sent claims. Runtime also guards `files.send` after a pending document job by returning `document_pending_delivery` without queuing artifacts, so an older delivered PDF cannot masquerade as the new output.

Structured document rendering now drops a first heading block when it duplicates the section heading, preventing repeated edits from producing visible heading duplication through the `h2` + `h3` render path.

### Files / modules

- `packages/runtime-contract/src/index.ts`
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`
- `apps/runtime/src/modules/turns/runtime-document-tool.service.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/src/modules/turns/persai-document-structure.ts`
- `apps/runtime/test/deferred-document-acknowledgement.test.ts`
- `apps/runtime/test/deferred-media-acknowledgement.test.ts`
- `apps/runtime/test/runtime-document-tool.service.test.ts`
- `apps/runtime/test/persai-document-structure.test.ts`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-tool.service.test.ts`
2. `corepack pnpm --filter @persai/runtime exec tsx test/deferred-document-acknowledgement.test.ts`
3. `corepack pnpm --filter @persai/runtime exec tsx test/persai-document-structure.test.ts`
4. `corepack pnpm --filter @persai/runtime exec tsx test/deferred-media-acknowledgement.test.ts`
5. `corepack pnpm --filter @persai/runtime run typecheck`

### Risks / residuals

- This fixes same-turn honesty and old-file send prevention in runtime. Existing already-open document jobs still depend on the API document-job delivery worker to create final attachments and ready messages.
- Full repo verification gate remains to run before calling the whole repo clean.

### Next recommended step

Run the required repo verification gate, then deploy and live-smoke a PDF create/revise flow with styling and repeated edits.

## 2026-05-27 — Telegram group access mode

### Scope

Bounded Telegram integration feature:

- add `telegramAccessMode` with `owner_only` and `group_members`
- keep `groupReplyMode` as the existing group trigger control
- keep private DMs and owner claim flow owner-only
- allow non-owner group access only from active linked Telegram groups
- avoid OpenClaw legacy and broad refactors

### What changed

Telegram binding metadata now parses and persists `telegramAccessMode`, defaulting to `owner_only`. Telegram integration state and config PATCH contracts expose that setting, with generated contracts refreshed from OpenAPI.

The Telegram webhook access gate now ignores bot-originated messages, applies `groupReplyMode` before access checks, keeps private chats owner-only, preserves the owner claim flow, and in `group_members` mode accepts non-owner group messages only when `(assistantId, telegramChatId)` is an active `assistant_telegram_groups` row. Unknown/inactive groups are ignored without noisy replies. Accepted Telegram turns keep the persisted user message content clean, store Telegram chat/sender facts in message metadata, and send structured `channelContext.telegram` to runtime. Runtime renders current group/sender facts as a developer context section, and canonical Telegram group history labels prior user messages with their stored sender name.

The Telegram settings panel now adds "Who can message the assistant in a group" access-mode buttons and saves the selected mode through the existing config PATCH endpoint.

### Files / modules

- `apps/api/src/modules/workspace-management/application/telegram-integration.metadata.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-channel-runtime-config.service.ts`
- `apps/api/src/modules/workspace-management/application/sync-telegram-group-membership.service.ts`
- `apps/api/src/modules/workspace-management/application/telegram-channel-adapter.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/send-native-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-chat-message.entity.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts`
- `apps/api/test/telegram-channel-adapter.service.test.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/api/test/send-native-telegram-turn.service.test.ts`
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/test/turn-context-hydration.service.test.ts`
- `apps/runtime/test/turn-execution.service.test.ts`
- `apps/web/app/app/_components/telegram-connect.tsx`
- `apps/web/app/app/_components/telegram-connect.test.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `packages/runtime-contract/src/index.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/**`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/telegram-channel-adapter.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/send-native-telegram-turn.service.test.ts`
3. `corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts`
4. `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
5. `corepack pnpm --filter @persai/api exec tsx test/telegram-integration.test.ts`
6. `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts`
7. `corepack pnpm --filter @persai/web exec vitest run app/app/_components/telegram-connect.test.tsx`
8. `corepack pnpm --filter @persai/api run typecheck`
9. `corepack pnpm --filter @persai/runtime run typecheck`
10. `corepack pnpm --filter @persai/web run typecheck`
11. `corepack pnpm -r --if-present run lint`
12. `corepack pnpm run format:check`

### Risks / residuals

- Telegram group context is now structured runtime/API metadata rather than a mutation of the persisted user text. The model still sees sender labels in runtime-only prompt context for prior group messages.
- `group_members` intentionally authorizes by active linked group row, not by Telegram member roster expansion; leaving a group or unlinking it must keep that row status accurate.

### Next recommended step

Review the Telegram group access UX/API diff, then commit or deploy when ready.

## 2026-05-27 — Auth incident hotfix — Clerk profile lookup fallback for existing users

### Scope

Bounded live-incident auth fix after ADR-101 Slice 8:

- keep Clerk JWT verification strict
- stop intermittent `users.getUser(sub)` failures from turning already-known users into 401s
- allow fallback only for existing PersAI `AppUser` rows keyed by `clerkUserId`
- do not create new users or relax unknown-subject rejection

### What changed

`ClerkAuthService` now owns one narrow fallback path after successful `verifyToken`: if the token contains a valid `sub` but Clerk profile lookup fails, the service checks `app_users.clerk_user_id = sub`. When a matching `AppUser` already exists, auth resolution returns that persisted email/displayName and logs an explicit warning that Clerk profile lookup failed and DB fallback was used.

If no matching `AppUser` exists, auth remains strict and still throws `UnauthorizedException`. The fallback therefore protects existing users from intermittent Clerk profile outages without creating accounts from partial identity data or silently accepting unknown Clerk subjects.

### Files / modules

- `apps/api/src/modules/identity-access/infrastructure/identity/clerk-auth.service.ts`
- `apps/api/test/clerk-auth.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/clerk-auth.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/step2-auth-foundation.e2e.test.ts`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm -r --if-present run lint`
6. `corepack pnpm run format:check`
7. `git diff --check`

### Risks / residuals

- Existing users continue through auth during Clerk profile-read outages, but brand-new Clerk subjects without a persisted `AppUser` still fail until Clerk profile lookup works again; that is intentional to avoid creating users without a trusted email.
- The fallback reuses the persisted PersAI email/displayName, so profile changes made in Clerk during the outage window are not reflected until `users.getUser(sub)` succeeds again.

### Next recommended step

Deploy this API hotfix to the affected environment and verify the live bootstrap/chat fan-out no longer splits into `assistant = null` plus loaded chats during intermittent Clerk `users.getUser` failures.

## 2026-05-27 — ADR-101 legacy cleanup follow-through — remove user-only repository mutations

### Scope

Bounded ADR-101 cleanup after Slice 8:

- delete the remaining user-only `AssistantRepository` mutation signatures and Prisma bridges
- expand the ADR-101 source guard so those method names cannot return in active source
- remove two risky multi-assistant tails that still silently chose the first assistant
- keep API contracts unchanged and preserve unrelated workspace changes

### What changed

`AssistantRepository` and `PrismaAssistantRepository` no longer expose the old user-only methods at all: `findByUserId`, `updateDraft(userId)`, and `markApply*(userId)` are deleted. Active lifecycle flows were already on assistant-id writes, so the cleanup was limited to the repository surface plus test doubles. `apps/api/test/adr101-find-by-userid-guard.test.ts` now fails if active source reintroduces any of those user-only method names.

`BillingLifecycleProducerService` no longer invents assistant notification context with `assistant.findFirst({ workspaceId, userId })`. It now prefers the member's active assistant, falls back only when the workspace/user pair has exactly one assistant, and otherwise sends the workspace-level billing email without ambiguous assistant-scoped push delivery.

`ResolveAdminOpsCockpitService` no longer falls back to the first assistant for multi-assistant users when there is no explicit `assistantId` and no active assistant pointer. In that ambiguous state the cockpit now returns the assistant selector options honestly, leaves assistant-owned blocks empty, and reports that assistant selection is required; single-assistant fallback still works when the workspace truly has exactly one assistant.

### Files / modules

- `apps/api/src/modules/workspace-management/domain/assistant.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts`
- `apps/api/src/modules/workspace-management/application/billing-lifecycle-producer.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/test/adr101-find-by-userid-guard.test.ts`
- `apps/api/test/billing-lifecycle-producer.service.test.ts`
- `apps/api/test/resolve-admin-ops-cockpit.service.test.ts`
- `apps/api/test/reset-assistant.service.test.ts`
- `docs/API-BOUNDARY.md`
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks required for this slice:

1. `corepack pnpm --filter @persai/api exec tsx test/billing-lifecycle-producer.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/adr101-find-by-userid-guard.test.ts`
4. `corepack pnpm --filter @persai/api run typecheck`
5. `corepack pnpm -r --if-present run lint`
6. `corepack pnpm run format:check`
7. `git diff --check`

### Risks / residuals

- Billing lifecycle email delivery remains workspace-level even when assistant-scoped push is skipped for ambiguous multi-assistant users; that is intentional to avoid arbitrary assistant attribution.
- Admin Ops cockpit now reports an honest selection-required state for ambiguous multi-assistant users; any UI follow-up beyond the existing selector remains outside this bounded cleanup.

### Next recommended step

Run the remaining broad ADR-101 acceptance search/verification set when ready, then audit any non-repository historical references/docs/tests that still mention the removed `findByUserId` bridge.

## 2026-05-26 — ADR-101 Slice 8 — active assistant plan/billing cleanup

### Scope

Bounded Slice 8 cleanup for remaining active `findByUserId` assumptions:

- first fix live tariff/free UI by moving plan visibility to active assistant/workspace truth
- migrate bounded adjacent payment/media/admin billing support callers
- leave `PrismaAssistantRepository.findByUserId` honest as a legacy repository method
- do not change live cluster state, push, or commit

### What changed

`ResolvePlanVisibilityService` now resolves the caller's active assistant through `ResolveActiveAssistantService` before reading governance, effective subscription, plan catalog, quota, monthly media quota, package offers, and capability visibility. Multi-assistant users therefore read the selected active assistant/workspace instead of hitting the ambiguous `findByUserId` path that caused live `/api/v1/assistant/plan-visibility` 500s and the free/gray UI fallback.

The remaining bounded active billing/admin callers were migrated off user-only assistant lookup: payment-intent creation/read context, media package checkout, Admin Plan Control, Admin workspace subscription set/reset, and Ops billing-support actions now resolve active assistant/workspace context. `AssistantRepository.findByUserId` remains only in the repository contract/Prisma implementation and legacy tests; a new ADR-101 guard test fails if active source files add new callers.

Deploy truth was checked for persistent command/args overrides or stale-preview workarounds. The repo already relies on image CMD/startup assertion for the API; Helm command/args entries are only Cloud SQL proxy/migration plumbing, so no infra override was removed.

### Files / modules

- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-assistant-payment-intents.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-media-package-purchase.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-assistant-plan-override.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-workspace-subscription.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-ops-billing-support.service.ts`
- `apps/api/test/plan-visibility.service.test.ts`
- `apps/api/test/manage-assistant-payment-intents.service.test.ts`
- `apps/api/test/manage-media-package-purchase.service.test.ts`
- `apps/api/test/manage-admin-assistant-plan-override.service.test.ts`
- `apps/api/test/manage-admin-workspace-subscription.service.test.ts`
- `apps/api/test/manage-admin-ops-billing-support.service.test.ts`
- `apps/api/test/adr101-find-by-userid-guard.test.ts`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/plan-visibility.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/manage-media-package-purchase.service.test.ts`
4. `corepack pnpm --filter @persai/api exec tsx test/manage-admin-assistant-plan-override.service.test.ts`
5. `corepack pnpm --filter @persai/api exec tsx test/manage-admin-workspace-subscription.service.test.ts`
6. `corepack pnpm --filter @persai/api exec tsx test/manage-admin-ops-billing-support.service.test.ts`
7. `corepack pnpm --filter @persai/api exec tsx test/adr101-find-by-userid-guard.test.ts`
8. `corepack pnpm --filter @persai/api run typecheck`
9. `corepack pnpm run format:check`

### Risks / residuals

- Full recursive lint and web typecheck were not run in this bounded pass.
- `findByUserId` remains available as an honest legacy repository/interface method and in legacy tests; target-state deletion can happen later if no remaining legacy tests need it.
- Live `persai-dev` still needs deployment of these source changes before `/assistant/plan-visibility` is fixed in cluster.

### Next recommended step

Run the remaining broad repo gates if desired, then deploy/verify `persai-dev` plan visibility after the normal no-push/no-commit approval path.

## 2026-05-26 — ADR-101 Ops admin display — multi-assistant support

### Scope

Bounded Ops UI/API slice for ADR-101:

- keep the User Directory table quiet by showing assistant count only for multi-assistant rows
- add one assistant selector in the selected-user cockpit summary row
- scope assistant-owned Ops cockpit blocks to the selected assistant
- verify Plan Control ownership before labeling it assistant-scoped
- do not touch setup preview or Prisma assistant repository hotfix files

### What changed

`GET /api/v1/admin/ops/cockpit` now accepts optional `assistantId` and returns a compact `assistant.assistants[]` selector list. The service defaults to the workspace member's active assistant when available and otherwise falls back to the first assistant for display; assistant-scoped reads such as runtime apply, chat stats, channel bindings, sandbox state, effective plan, and assistant override state use the selected assistant.

`GET /api/v1/admin/ops/users` now includes `assistantCount`, letting the Admin Ops directory show `No assistant`, the existing single-assistant status, or `N assistants` without rendering a long assistant list in the table.

The web cockpit top summary row now owns the single assistant selector/dropdown for multi-assistant users. The Assistant card remains compact, and Plan Control is labeled against the selected assistant because the code path writes `AssistantGovernance.assistantPlanOverrideCode` for a concrete assistant id; billing/subscription support stays workspace-level and visually separate.

### Files / modules

- `apps/api/src/modules/workspace-management/application/admin-ops-user-directory.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-assistant-plan-override.service.ts`
- `apps/api/src/modules/workspace-management/application/ops-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-ops.controller.ts`
- `apps/api/test/admin-ops-user-directory.service.test.ts`
- `apps/api/test/resolve-admin-ops-cockpit.service.test.ts`
- `apps/web/app/admin/ops/page.tsx`
- `apps/web/app/admin/ops/page.test.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `packages/contracts/openapi.yaml`
- generated `packages/contracts/src/generated/*`
- `docs/API-BOUNDARY.md`
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/contracts run generate`
2. `corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/admin-ops-user-directory.service.test.ts`
4. `corepack pnpm --filter @persai/web exec vitest run --config vitest.config.ts app/admin/ops/page.test.tsx`
5. `corepack pnpm --filter @persai/api run typecheck`
6. `corepack pnpm --filter @persai/web run typecheck`
7. `corepack pnpm -r --if-present run lint`
8. `corepack pnpm run format:check`

### Risks / residuals

- Reapply remains the existing user-level Ops action; this slice did not redesign it into a per-assistant directory action.
- Slice 8 still needs final cleanup of remaining legacy `findByUserId` residue outside this bounded Ops display work.

### Next recommended step

Run the remaining verification gate for touched API/web surfaces, then continue ADR-101 Slice 8 cleanup of temporary user-only assistant lookup bridges.

## 2026-05-26 — ADR-101 Slice 7 — live setup-preview stale image remediation

### Scope

Bounded live-remediation slice for the still-visible setup preview error:

- diagnose why `persai-dev` still returned `Assistant lookup by userId is ambiguous for multi-assistant users` after the source-level preview hotfix
- prevent API images from carrying stale compiled preview code
- do not broaden into the remaining Slice 8 `findByUserId` cleanup
- do not push without explicit founder confirmation

### What changed

Cluster inspection showed API pods were running image `87325cb6`, and the TypeScript source inside that image already used `ResolveActiveAssistantService` for setup preview. The compiled runtime file at `apps/api/dist/apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.js` was stale and still called `assistantRepository.findByUserId(userId)`, so live setup preview kept throwing the multi-assistant ambiguity error.

The initial Dockerfile guard was not enough because the API image path still used GitHub Actions Docker layer cache. The hotfix now keeps `findByUserId` behavior unchanged, disables Docker build cache for API image publishes, deletes and rebuilds `apps/api/dist` in one Docker layer, and runs the same compiled-preview assertion both during image build and at container startup. A stale compiled preview can no longer serve traffic: if the built JS lacks `ResolveActiveAssistantService` or still contains `findByUserId`, the image build or API process fails hard instead of returning a live 500.

### Files / modules

- `apps/api/Dockerfile`
- `apps/api/scripts/assert-compiled-preview-fresh.cjs`
- `.github/workflows/dev-image-publish.yml`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/ADR/101-multi-assistant-workspace-model.md`

Unrelated local web Slice 7 UX changes remain unpushed and should stay separate unless the founder explicitly approves bundling them.

### Verification

Local checks passed:

1. `Remove-Item -Recurse -Force apps/api/dist -ErrorAction SilentlyContinue; corepack pnpm --filter @persai/api run build`
2. `node apps/api/scripts/assert-compiled-preview-fresh.cjs`

Live checks before the fix confirmed the failure source:

1. `kubectl -n persai-dev get deploy api web -o wide` showed API on `87325cb6`.
2. Runtime source in the API pod was correct, but compiled `dist` for setup preview was stale.

### Risks / residuals

- The Dockerfile/workflow/startup guard is not deployed until committed and pushed; live will keep failing setup preview until a new API image rolls out.
- Slice 8 still needs final target-state cleanup of remaining legacy `findByUserId` call sites in non-hot-path/admin/billing support services.
- After rollout, verify the API pod starts cleanly, re-check the compiled preview file in the live pod, and run the setup preview flow again.

### Next recommended step

With founder approval, commit and push this API build/startup remediation separately from the pending web UX changes, wait for Dev Image Publish rollout, then verify the live compiled file and setup preview flow.

## 2026-05-26 — ADR-101 Slice 6 — web shell switcher and assistant-scoped client state

### Scope

Bounded ADR-101 web-only slice:

- keep the ordinary single-assistant shell visually unchanged
- land the quiet multi-assistant switch/create UX inside Assistant Settings instead of turning the sidebar card into a loud selector
- scope chat/session/streaming thread state by `assistantId` so assistant A UI state cannot leak into assistant B
- refresh the active assistant's lifecycle/chat/Telegram/notification surfaces on switch/create without changing backend contracts

Out of scope:

- backend/API contract changes beyond the already landed Slice 1-5 surfaces
- deploy/live verification for the new multi-assistant shell
- final cleanup of remaining legacy user-only assistant lookup bridges
- downgrade/delete-extra-assistants policy redesign beyond the current backend truth

### What changed

Implemented the sixth bounded ADR-101 slice:

1. Preserved the normal single-assistant shell for `assistantLimit.maxAssistants = 1`, so B2C users do not see noisy new selector chrome.
2. Kept the sidebar assistant card as the settings entry point and added only a quiet 3px premium gradient accent when the workspace can have more than one assistant.
3. Moved assistant switching into the assistant settings character section behind a quiet `Switch assistant` / `Сменить ассистента` button instead of promoting the sidebar card into a permanent selector.
4. Added a switch modal that lists assistants with avatar/name plus a future specialty placeholder, exposes `Select` per assistant, and shows the create-assistant CTA only while slots remain; the full-limit state stays calm and relies on existing backend plan truth.
5. Scoped web chat/session/streaming thread state by `assistantId` and refreshed lifecycle/chat/Telegram/notification slices after switch/create so the product shell no longer leaks assistant A state into assistant B while preserving workspace-level billing/plan/admin state.

### Files / modules

Primary Slice 6 web modules touched:

- `apps/web/app/app/_components/sidebar.tsx`
- `apps/web/app/app/_components/sidebar.test.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/assistant-settings.test.tsx`
- `apps/web/app/app/_components/use-app-data.ts`
- `apps/web/app/app/_components/use-app-data.test.tsx`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/_components/use-chat.test.tsx`
- `apps/web/app/app/_components/streaming-threads.tsx`
- `apps/web/app/app/chat/page.tsx`
- `apps/web/app/app/chat/page.test.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/assistant-api-client.test.ts`
- `apps/web/app/app/_server/fetch-app-bootstrap.ts`
- `apps/web/app/admin/plans/page.tsx`
- `apps/web/app/admin/plans/page.test.tsx`
- `apps/web/app/_components/pricing-page-view.test.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused verification already passed for the implemented Slice 6 web surface:

1. Focused web Vitest suite covering `apps/web/app/app/_components/use-app-data.test.tsx`, `apps/web/app/app/_components/sidebar.test.tsx`, `apps/web/app/app/_components/assistant-settings.test.tsx`, `apps/web/app/app/_components/use-chat.test.tsx`, and `apps/web/app/app/chat/page.test.tsx` — PASS (`5` files, `163` tests).
2. `corepack pnpm -r --if-present run lint` — PASS
3. `corepack pnpm run format:check` — PASS
4. `corepack pnpm --filter @persai/api run typecheck` — PASS
5. `corepack pnpm --filter @persai/web run typecheck` — PASS
6. `corepack pnpm --filter @persai/contracts run typecheck` — PASS

### Risks / residuals

- Slice 7 still needs deploy/live smoke plus the runtime/integration isolation audit; this handoff records the already verified local web implementation, not live environment proof.
- Slice 8 still must remove the remaining legacy `findByUserId` / user-only assistant lookup residue before ADR-101 can be called complete.
- Downgrade/delete-extra-assistants policy remains backend residual truth; the Slice 6 UI stays calm and only reflects the current backend assistant-limit state instead of adding new product policy.

### Next recommended step

Proceed to ADR-101 Slice 7: run the runtime/integration isolation audit and deploy/live smoke for the landed multi-assistant shell, with special attention to assistant-scoped session keys, dedupe behavior, and cross-assistant state separation after real switch/create flows.

## 2026-05-26 — ADR-101 Slice 5 — assistant-scoped surface isolation

### What changed

Implemented the fifth bounded ADR-101 slice:

1. Migrated the remaining user-facing assistant-scoped memory surfaces off legacy user-only assistant lookup so workspace-memory CRUD, Memory Center list/forget, do-not-remember, and UI close-by-ref now resolve the active assistant before reading or mutating assistant-owned rows.
2. Migrated assistant task/background-task product surfaces onto active assistant context so list and control operations no longer read or mutate another assistant's rows for the same user.
3. Migrated the remaining assistant-owned product configuration surfaces onto active assistant resolution: Skill assignment, assistant knowledge source CRUD/reindex, avatar upload/download, voice settings/runtime-tier reads, direct/staged file upload plus voice transcription, Telegram integration connect/state/config/revoke/resend, and the lifecycle/settings mutation path (`draft`, `publish`, `reapply`, `rollback`, `reset`, `setup preview`).
4. Added assistant-id-backed repository mutations for draft/apply lifecycle writes so publish/reapply/rollback and related auto-apply flows no longer rely on ambiguous user-keyed assistant mutation in multi-assistant workspaces.
5. Added focused regressions proving representative assistant isolation across memory, tasks, skills, and file/media surfaces while keeping existing single-assistant flows green.

### Files touched

- `apps/api/src/modules/workspace-management/domain/assistant.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts`
- `apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-assistant-workspace-memory.service.ts`
- `apps/api/src/modules/workspace-management/application/list-assistant-memory-items.service.ts`
- `apps/api/src/modules/workspace-management/application/forget-assistant-memory-item.service.ts`
- `apps/api/src/modules/workspace-management/application/do-not-remember-assistant-memory.service.ts`
- `apps/api/src/modules/workspace-management/application/close-assistant-memory-by-ref.service.ts`
- `apps/api/src/modules/workspace-management/application/list-assistant-task-items.service.ts`
- `apps/api/src/modules/workspace-management/application/list-assistant-background-task-items.service.ts`
- `apps/api/src/modules/workspace-management/application/control-assistant-background-task.service.ts`
- `apps/api/src/modules/workspace-management/application/enable-assistant-task-registry-item.service.ts`
- `apps/api/src/modules/workspace-management/application/disable-assistant-task-registry-item.service.ts`
- `apps/api/src/modules/workspace-management/application/cancel-assistant-task-registry-item.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-assistant-skills.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-assistant-knowledge-sources.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-assistant-avatar.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-voice-settings.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-runtime-tier.service.ts`
- `apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts`
- `apps/api/src/modules/workspace-management/application/resend-telegram-owner-message.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/media-attachment.controller.ts`
- `apps/api/test/manage-assistant-workspace-memory.service.test.ts`
- `apps/api/test/assistant-task-active-assistant.service.test.ts`
- `apps/api/test/manage-assistant-skills.service.test.ts`
- `apps/api/test/media-attachment.controller.test.ts`
- updated focused API tests under `apps/api/test/*` for media, avatar, knowledge, Telegram, lifecycle, reset, preview, and close-by-ref
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/manage-assistant-workspace-memory.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/assistant-task-active-assistant.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/manage-assistant-skills.service.test.ts`
4. `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts`
5. `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.transcribe-voice.test.ts`
6. `corepack pnpm --filter @persai/api exec tsx test/manage-assistant-avatar.service.test.ts`
7. `corepack pnpm --filter @persai/api exec tsx test/manage-assistant-knowledge-sources.service.test.ts`
8. `corepack pnpm --filter @persai/api exec tsx test/update-assistant-draft.service.test.ts`
9. `corepack pnpm --filter @persai/api exec tsx test/publish-assistant-draft.service.test.ts`
10. `corepack pnpm --filter @persai/api exec tsx test/telegram-integration.test.ts`
11. `corepack pnpm --filter @persai/api exec tsx test/resend-telegram-owner-message.service.test.ts`
12. `corepack pnpm --filter @persai/api exec tsx test/reset-assistant.service.test.ts`
13. `corepack pnpm --filter @persai/api exec tsx test/preview-assistant-setup.service.test.ts`
14. `corepack pnpm --filter @persai/api exec tsx test/close-assistant-memory-by-ref.service.test.ts`
15. `corepack pnpm --filter @persai/api exec tsx test/media-attachment.controller.test.ts`

Additional verification:

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/contracts run typecheck` — PASS

### Risks / residuals

- Remaining `findByUserId` / user-only assistant lookup residue is now concentrated in explicit later-slice or out-of-scope surfaces such as billing/payment/package purchase, plan visibility, and admin ops/support tooling; do not claim ADR-101 complete until Slice 8 removes those bridges.
- Slice 5 intentionally does not add the Slice 6 web switcher or client-side assistant-state namespacing; current UX still depends on active-assistant fallback until the switcher lands.
- No Slice 7 live/deploy/runtime isolation audit was done here; this slice only migrates application-level assistant-scoped product surfaces and focused regressions around them.

### Next recommended step

Proceed to ADR-101 Slice 6: add the web shell assistant switcher and assistant-id-scoped client state so the newly isolated API surfaces are fully reflected in the product UI.

## 2026-05-26 — ADR-101 Slice 4 — active-assistant web chat isolation

### What changed

Implemented the fourth bounded ADR-101 slice:

1. Migrated the web chat list/bootstrap read path off the legacy user-only assistant lookup so `ManageWebChatListService` now resolves the active assistant through `ResolveActiveAssistantService` before listing, reading, mutating, compacting, or deleting web chats.
2. Migrated inbound web chat runtime context resolution off `findByUserId`, so send/stream preparation now resolves the current active assistant before selecting the published version/runtime bundle used for a turn.
3. Tightened web turn status lookup to the resolved active assistant instead of a user-only assistant selection, so `/assistant/chat/web/turns/:clientTurnId` no longer sees another assistant's turn state for the same user.
4. Namespaced the in-memory reattach/hard-stop registries by `assistantId + clientTurnId`, and updated the SSE controller reattach/stop flow to resolve the current active assistant before attaching/stopping, preventing same-user cross-assistant collisions when client turn ids are reused.
5. Added focused regressions proving active-assistant chat list selection, inbound runtime-context resolution, assistant-scoped turn-status lookup, and assistant-scoped hard-stop dispatch.

### Files touched

- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-inbound-runtime-context.service.ts`
- `apps/api/src/modules/workspace-management/application/web-chat-turn-attempt.service.ts`
- `apps/api/src/modules/workspace-management/application/web-chat-turn-hard-stop-registry.service.ts`
- `apps/api/src/modules/workspace-management/application/web-chat-turn-stream-registry.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/test/manage-web-chat-list.service.test.ts`
- `apps/api/test/resolve-assistant-inbound-runtime-context.service.test.ts`
- `apps/api/test/web-chat-turn-attempt.service.test.ts`
- `apps/api/test/web-chat-turn-hard-stop-registry.test.ts`
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/manage-web-chat-list.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/web-chat-turn-attempt.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/web-chat-turn-hard-stop-registry.test.ts`
4. `corepack pnpm --filter @persai/api exec tsx test/resolve-assistant-inbound-runtime-context.service.test.ts`
5. `corepack pnpm --filter @persai/api exec tsx test/get-assistant-app-bootstrap.service.test.ts`
6. `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts`
7. `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
8. `corepack pnpm --filter @persai/api exec tsx test/prepare-assistant-inbound-turn.service.test.ts`

Additional verification:

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/contracts run typecheck` — PASS

### Risks / residuals

- Slice 4 keeps the public chat contract shape unchanged and relies on active-assistant fallback; it does not add explicit `assistantId` request/query parameters or any Slice 6 client-side assistant-state namespacing.
- Broader assistant-scoped settings/surfaces such as memory, tasks, files, skills, Telegram, and notification/UI reads remain Slice 5 work.
- Final production cleanup of remaining non-chat `findByUserId` residue remains Slice 8 work.

### Next recommended step

Proceed to ADR-101 Slice 5: migrate the remaining assistant-scoped product surfaces (memory, tasks/background actions, skills, files/settings, Telegram, and related reads/mutations) onto the same active-assistant resolution boundary.

## 2026-05-26 — ADR-101 Slice 3 — lifecycle/bootstrap contracts + active assistant list/switch

### What changed

Implemented the third bounded ADR-101 slice:

1. Added resolver-backed lifecycle view state with explicit `assistants[]`, `activeAssistantId`, and `assistantLimit`, including the honest "selection required" bootstrap/list case when a workspace has multiple assistants but no active pointer.
2. Exposed public `GET /api/v1/assistant/list` and `POST /api/v1/assistant/switch` contracts, with switch validation delegated to `SwitchActiveAssistantService`.
3. Updated `GET /api/v1/assistant`, `POST /api/v1/assistant`, and the existing lifecycle mutation responses touched by the current contract boundary (`draft`, `publish`, `rollback`, `reset`, `reapply`) so they now return active assistant detail plus the assistant list/active metadata needed for future web switching.
4. Migrated bootstrap's assistant section off the legacy singular assistant read and onto the new lifecycle view service, preserving the existing sectioned bootstrap envelope while returning multi-assistant state.
5. Updated the web contract/client boundary so bootstrap seeding and client reloads understand the richer lifecycle view, and added explicit list/switch client helpers without widening into Slice 6 UI work.
6. Regenerated the OpenAPI contract artifacts and updated Clerk middleware coverage for the new list/switch routes.

### Files touched

- `apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts`
- `apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-lifecycle-view.service.ts`
- `apps/api/src/modules/workspace-management/application/get-assistant-app-bootstrap.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/api/test/get-assistant-app-bootstrap.service.test.ts`
- `apps/api/test/identity-access.module.test.ts`
- `apps/api/test/resolve-assistant-lifecycle-view.service.test.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/assistant-api-client.test.ts`
- `apps/web/app/app/_components/use-app-data.ts`
- `apps/web/app/app/_components/use-app-data.test.tsx`
- `apps/web/app/app/_components/sidebar.test.tsx`
- `apps/web/app/app/_server/fetch-app-bootstrap.ts`
- `packages/contracts/openapi.yaml`
- generated `packages/contracts/src/generated/*`
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/get-assistant-app-bootstrap.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/resolve-assistant-lifecycle-view.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts`
4. `corepack pnpm --filter @persai/api exec tsx test/create-assistant.service.test.ts`
5. `corepack pnpm --filter @persai/api exec tsx test/switch-active-assistant.service.test.ts`
6. `corepack pnpm --filter @persai/web exec vitest run app/app/_components/use-app-data.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts`
7. `corepack pnpm --filter @persai/api run typecheck`
8. `corepack pnpm --filter @persai/web run typecheck`
9. `corepack pnpm contracts:generate`

Additional verification:

- `corepack pnpm -r --if-present run lint` — PASS.
- `corepack pnpm run format:check` — PASS.
- `corepack pnpm --filter @persai/api run typecheck` — PASS.
- `corepack pnpm --filter @persai/web run typecheck` — PASS.
- `corepack pnpm --filter @persai/contracts run typecheck` — PASS.

### Risks / residuals

- Slice 3 intentionally does not migrate chat/runtime entrypoints; bootstrap still contains the existing chat section, but broader active-assistant chat routing remains Slice 4 work.
- The public lifecycle/bootstrap contract is now multi-assistant aware, but broader assistant-scoped settings/mutation surfaces still rely on pre-Slice-5 user-only service paths behind those endpoints.
- No Slice 6 switcher UI or assistant-id local-state namespacing was added; the richer web contract/client surface is present, but the product shell still needs the dedicated switcher/state follow-up.
- Final `findByUserId` cleanup remains blocked on later slices, especially Slice 8.

### Next recommended step

Proceed to ADR-101 Slice 4: migrate web chat list/send/stream/reattach/status/stop and the bootstrap-adjacent chat reads onto active/explicit assistant context so assistant A/B chat state cannot collide.

## 2026-05-26 — ADR-101 Slice 2 — active assistant resolution + creation limit enforcement

### What changed

Implemented the second bounded ADR-101 API slice:

1. Added `ResolveActiveAssistantService` as the central workspace-member-first resolution boundary for explicit `assistantId`, active assistant fallback, single-assistant bootstrap fallback, and honest multi-assistant/no-pointer failure.
2. Added `SwitchActiveAssistantService` at the application layer to validate and persist active assistant changes without inventing a public contract ahead of Slice 3.
3. Added `EnforceAssistantCreationLimitService` so assistant creation now resolves workspace plan truth from subscription/default plan catalog state and blocks creation when `assistantPolicy.maxAssistants` is reached.
4. Updated `CreateAssistantService` to use the new limit enforcement service and to set the creating member's `activeAssistantId` to the newly created assistant.
5. Replaced the small set of Slice 1 stopgap ambiguity checks already added on assistant-scoped API surfaces (`notification preference`, `Telegram group refresh`, `knowledge indexing jobs`, and `assistant/integrations/telegram/groups`) so they now share the same active-assistant rules instead of hand-rolling their own.

### Files touched

- `apps/api/src/modules/workspace-management/application/assistant-policy.ts`
- `apps/api/src/modules/workspace-management/application/resolve-active-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/switch-active-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/enforce-assistant-creation-limit.service.ts`
- `apps/api/src/modules/workspace-management/application/create-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/list-knowledge-indexing-jobs.service.ts`
- `apps/api/src/modules/workspace-management/application/refresh-telegram-groups.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-notification-preference.service.ts`
- `apps/api/src/modules/workspace-management/application/update-assistant-notification-preference.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/create-assistant.service.test.ts`
- `apps/api/test/update-assistant-notification-preference.service.test.ts`
- `apps/api/test/resolve-active-assistant.service.test.ts`
- `apps/api/test/enforce-assistant-creation-limit.service.test.ts`
- `apps/api/test/switch-active-assistant.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/resolve-active-assistant.service.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/enforce-assistant-creation-limit.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/switch-active-assistant.service.test.ts`
4. `corepack pnpm --filter @persai/api exec tsx test/create-assistant.service.test.ts`
5. `corepack pnpm --filter @persai/api exec tsx test/update-assistant-notification-preference.service.test.ts`
6. `corepack pnpm --filter @persai/api run typecheck`

### Risks / residuals

- Slice 2 adds the shared application services and wires a few already-touched assistant-scoped reads, but it intentionally does not add the public list/create/switch/bootstrap contracts from Slice 3.
- `GetAssistantByUserIdService`, `findByUserId`, and other legacy user-only assistant hot paths still exist outside this bounded slice; ADR-101 remains incomplete until later slices migrate and finally delete them.
- No public switch endpoint was added yet. `SwitchActiveAssistantService` is ready, but exposing it cleanly belongs with the Slice 3 lifecycle/bootstrap contract work.
- Chat/runtime entrypoints, broader assistant-scoped settings surfaces, and multi-assistant web shell/state namespacing remain out of scope for this slice.

### Next recommended step

Proceed to ADR-101 Slice 3: expose assistant list/create/switch/bootstrap contracts, return `assistants[]` plus `activeAssistantId`, and route lifecycle/bootstrap reads through the new Slice 2 services.

## 2026-05-26 — ADR-101 Slice 1 — schema unlock + plan assistant limit

### What changed

Implemented the first bounded ADR-101 implementation slice:

1. Removed Prisma's root single-assistant uniqueness from `Assistant.userId` and `(workspaceId, userId)`.
2. Changed `AppUser` / `WorkspaceMember` assistant relations to plural and added `WorkspaceMember.activeAssistantId`.
3. Added a migration that backfills each existing workspace member's active assistant pointer from current one-assistant data, adds non-unique assistant ownership indexes, and constrains the active pointer to an assistant in the same workspace.
4. Added plan-owned `assistantPolicy.maxAssistants` under existing `billingProviderHints`, with default/B2C fallback `1` and B2B/operator support for values greater than `1`.
5. Exposed the assistant policy through Admin/Public plan contracts and the Admin Plans operator UI.
6. Updated default-plan seed/backfill behavior so fresh environments also get `assistantPolicy.maxAssistants = 1`.
7. Patched Prisma uniqueness fallout so remaining pre-Slice-2 user-only assistant lookups compile and fail on ambiguous multi-assistant data instead of silently selecting a first/newest assistant.
8. Remediated the Slice 1 admin delete-user blocker: `AdminDeleteUserService` now clears `workspace_members.active_assistant_id` references before deleting the owned assistant row, so migrated users with a populated active pointer can still be deleted.

### Files touched

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260526140000_adr101_multi_assistant_schema_unlock/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/application/*`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/test/admin-delete-user.service.test.ts`
- `apps/api/test/adr101-schema-unlock.test.ts`
- `apps/api/test/manage-admin-plans.service.test.ts`
- `apps/api/test/seed-tool-catalog.test.ts`
- `apps/web/app/admin/plans/page.tsx`
- `apps/web/app/admin/plans/page.test.tsx`
- `apps/web/app/_components/pricing-page-view.test.tsx`
- `packages/contracts/openapi.yaml`
- generated `packages/contracts/src/generated/*`
- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused checks passed:

1. `corepack pnpm --filter @persai/api exec tsx test/adr101-schema-unlock.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/seed-tool-catalog.test.ts`
4. `corepack pnpm --filter @persai/api exec tsx test/admin-delete-user.service.test.ts`
5. `corepack pnpm --filter @persai/web exec vitest run app/admin/plans/page.test.tsx app/_components/pricing-page-view.test.tsx --config vitest.config.ts`
6. `corepack pnpm --filter @persai/api run typecheck`
7. `corepack pnpm --filter @persai/web run typecheck`

Broad gates passed:

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck`
6. `corepack pnpm --filter @persai/contracts run typecheck`

Additional acceptance searches:

1. `rg "AppUser\\.assistant|WorkspaceMember\\.assistant" apps/api` — no matches.
2. `rg "findByUserId" apps/api/src` — still has expected pre-Slice-2/cleanup residue; do not claim ADR-101 complete until Slice 8 removes production hot-path usage.

### Risks / residuals

- Slice 1 intentionally does not implement active assistant resolution, switch API, multi-assistant bootstrap, chat/runtime entrypoint migration, assistant-scoped settings migration, or web switcher/state namespacing.
- `findByUserId` and user-only assistant routes still exist as temporary pre-Slice-2/cleanup residue; ADR-101 completion remains blocked until Slice 8 removes them from production hot paths.
- `CreateAssistantService` still preserves current one-assistant product behavior until Slice 2 adds plan-limit enforcement and active assistant creation semantics.
- The admin delete-user path is now compatible with Slice 1's migrated `WorkspaceMember.activeAssistantId` foreign key, but broader multi-assistant delete semantics remain intentionally unchanged until later ADR-101 slices.

### Next recommended step

Proceed to ADR-101 Slice 2: add `ResolveActiveAssistantService`, active assistant switch service, and assistant creation limit enforcement from `assistantPolicy.maxAssistants`.

## 2026-05-26 — ADR-101 multi-assistant workspace model

### What changed

Created the architecture/execution ADR for the clean multi-assistant foundation:

1. Accepted `1 user = 1 workspace = N assistants` as the next platform model.
2. Kept AI employee roles, role templates, work queues, departments, and outstaffing UX explicitly out of scope.
3. Defined plan-owned assistant count as the only availability gate: B2C plans set `maxAssistants = 1`, B2B plans may set `maxAssistants > 1`.
4. Documented the hard blockers found in the audit: Prisma one-to-one assistant uniqueness, API `findByUserId` resolution, single-assistant bootstrap/web shell, and non-namespaced assistant-owned client state.
5. Defined the target data/API/web/runtime shape: plural assistant relations, `WorkspaceMember.activeAssistantId`, central `ResolveActiveAssistantService`, multi-assistant bootstrap, assistant switcher, assistant-id state namespacing, assistant-scoped surface migration, runtime isolation proof, and mandatory final cleanup.
6. Added a director-agent execution prompt inside the ADR for the next implementation session.

### Files touched

- `docs/ADR/101-multi-assistant-workspace-model.md`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Docs-only architecture slice. No code checks were run.

### Risks / residuals

- ADR-101 is accepted for execution but not implemented yet.
- The highest implementation risk is removing Prisma uniqueness while API hot paths still resolve assistant-owned state by `userId` alone.
- The final implementation cleanup slice is mandatory: no temporary bridge, `findByUserId` hot path, one-to-one assistant relation, or non-namespaced assistant-owned web state may remain before ADR completion is claimed.

### Next recommended step

Start a new director-led implementation session from `docs/ADR/101-multi-assistant-workspace-model.md`. The first bounded slice should be Schema Unlock + plan-owned assistant limit only, with subagents auditing the exact Prisma/API breakpoints before code changes.

## 2026-05-26 — PDF document cleanup audit — remove dead recent-PDF hint plumbing

### What changed

Audited the active PDF document path for stale tails and removed the lowest-risk dead plumbing that no longer affects runtime behavior.

1. Deleted the unused turn-time `recentChatPdfs` hint path from the active runtime contract and API web/Telegram turn entrypoints; the runtime had already stopped consuming this after the Working Files migration.
2. Removed `AssistantDocumentJobReadService` helper methods that existed only to build that hint and deleted the orphaned focused API test file that covered those methods.
3. Dropped the dead internal document operation enum member `verbatim_transfer`.
4. Updated active tool/runtime/API comments so they describe the real revise split (`structured` vs `patch`) instead of the older patch-only wording, and aligned active user/model-facing wording to camelCase `fileRef` / `docId`.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/api/src/modules/workspace-management/application/assistant-document-job-read.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/web-runtime-turn-client.service.ts`
- `apps/api/src/modules/workspace-management/application/web-runtime-stream-client.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/send-native-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts`
- `apps/runtime/src/modules/turns/persai-document-structure.ts`
- `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/test/turn-execution.service.test.ts`
- `apps/api/test/send-web-chat-turn.service.test.ts`
- `apps/api/test/stream-web-chat-turn.service.test.ts`
- `apps/api/test/handle-internal-telegram-turn.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

1. `corepack pnpm --filter @persai/api run typecheck` — PASS
2. `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts` — PASS
3. `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts` — PASS
4. `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts` — PASS

### Risks / residuals

- This slice intentionally removes only dead hint/plumbing residue and comment drift; it does not change active PDF create/revise routing logic.
- Historical ADR/changelog sections still mention the old recent-PDF hint because they record what shipped at the time; current repo truth is now the Working Files path, not `recentChatPdfs`.
- The cross-chat `fileRef` version-resolution behavior still points at the latest document version; that product behavior was audited but left unchanged in this cleanup slice.

### Next recommended step

If you want the next cleanup pass, do the higher-risk refactor seam next: collapse the triplicated document-job payload parsing/types across `assistant-document-job.service.ts`, `assistant-document-job-scheduler.service.ts`, and the PPTX prepare service so `contentIntent` / `editOperation` / `targetSectionIds` cannot drift again.

## 2026-05-26 — Structured document prod path follow-up — explicit content intent + preserve-first routing

### What changed

Hardened the document worker so large attached-source jobs no longer infer rewrite intent from wording or silently default to content rewrite on extracted-source documents.

1. Added additive document-tool/runtime field `contentIntent: preserve_content | rewrite_content` and updated model-facing tool guidance so omitted intent defaults to preserving content.
2. `RuntimeDocumentProviderAdapterService` now treats `contentIntent` as the execution guardrail: large extracted-source `create_pdf_document` jobs stay on the structured source-preserving path unless the tool explicitly passes `rewrite_content`.
3. Structured large `revise_document` now defaults to `style_only` when neither `editOperation` nor explicit rewrite intent is present; no keyword parsing was added.
4. Chunked create remains available only when rewrite is explicitly allowed or when attachment text extraction is unavailable; the fallback routing threshold now uses attachment `sizeBytes` when no extracted text exists.
5. Focused runtime regressions now cover explicit preserve intent on large transform create, preserve-safe default when `contentIntent` is omitted, and preserve-safe default on structured revise without `editOperation`.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts`
- `apps/api/src/modules/workspace-management/application/assistant-document-job-scheduler.service.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts`
- `apps/runtime/test/runtime-document-provider-adapter.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

1. `corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-provider-adapter.service.test.ts` — PASS
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
3. `corepack pnpm -r --if-present run lint` — PASS
4. `corepack pnpm run format:check` — PASS
5. `corepack pnpm --filter @persai/api run typecheck` — PASS
6. `corepack pnpm --filter @persai/web run typecheck` — PASS

### Risks / residuals

- This slice intentionally does not change the parallel local Working Files refactor already present in the working tree; `turn-execution.service.ts` and related files remain outside scope.
- Large extracted-source create now preserves content by default. If the model truly wants semantic rewriting, it must pass `contentIntent=rewrite_content` explicitly.
- Existing create callers that still rely only on `transferMode=transform` remain safe for preserve-first behavior, but explicit `contentIntent` should be adopted as the primary signal.

### Next recommended step

Deploy this bounded runtime/API slice to `persai-dev`, then rerun the failed large-DOCX contract scenario and confirm the runtime logs show `document-pdf-route-structured-source-create` instead of `document-pdf-route-chunked`.

## 2026-05-26 — Working Files honest chronological history

### What changed

Replaced the model-visible `Working Files` role buckets with one chronological file journal so the runtime now exposes one honest, newest-first view of reusable files instead of splitting truth across legacy sections.

1. `TurnExecutionService` now renders `## File history (newest first)` with one line per file in the format `createdAt | author | alias | filename | microdescription`.
2. The same rendering removes `HISTORY` / `OTHER_FILES`-style primary grouping, keeps only a short PDF priority note, sorts by canonical `AssistantFile.createdAt`, formats timestamps deterministically in UTC, and appends an 8-char `fileRef` suffix when duplicate filenames need disambiguation.
3. `RuntimeFileRef` now carries optional `createdAt` and strict `authorLabel` (`user | model | sandbox`), populated from the assistant-file registry and sandbox-produced file refs.
4. Attachment-backed file upserts now preserve existing `AssistantFile.metadata` truth on update, so upload/generated `semanticSummary` values do not get erased during later hydration or alias resolution.
5. Recent discovered file refs now reuse the registry truth directly instead of applying a second semantic-summary truncation path in hydration.
6. The model-visible 20-file cap now keeps `CURRENT_SOURCE` / `LAST_DELIVERED_RESULT` document anchors visible even when an older delivered PDF would otherwise fall out of the newest-first window.
7. `image_edit` and `image_generate` now opt into `allowWeakRequestFallback: true`, so short edit/generate requests can still produce a durable semantic summary that the history block will show when metadata exists.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/src/modules/turns/runtime-assistant-file-registry.service.ts`
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts`
- `apps/sandbox/src/sandbox.service.ts`
- `apps/runtime/test/working-files-developer-section.test.ts`
- `apps/runtime/test/runtime-assistant-file-registry.service.test.ts`
- `apps/runtime/test/generated-file-semantic-summary.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Focused:

1. `corepack pnpm --filter @persai/runtime exec tsx --test test/working-files-developer-section.test.ts test/runtime-image-edit-tool.service.test.ts test/runtime-assistant-file-registry.service.test.ts test/generated-file-semantic-summary.test.ts` — PASS

Repo gates:

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm --filter @persai/api run typecheck` — PASS
3. `corepack pnpm --filter @persai/web run typecheck` — PASS
4. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
5. `corepack pnpm --filter @persai/sandbox run typecheck` — PASS
6. `corepack pnpm run format:check` — FAIL only because pre-existing unrelated `apps/runtime/test/runtime-document-provider-adapter.service.test.ts` is not formatted in the current working tree; touched slice files were formatted and rechecked.

### Risks / residuals

- `format:check` is not globally green yet because of the unrelated pre-existing formatting issue in `apps/runtime/test/runtime-document-provider-adapter.service.test.ts`, which was intentionally left untouched in this bounded slice.
- The developer block now trusts `AssistantFile.createdAt`; any older file refs without that truth will render `unknown`, though current registry/sandbox paths now populate it and timestamps now render in deterministic UTC rather than host-local time.
- This slice intentionally does not change document structured-prod behavior, web UI rendering, or any tool contract beyond additive `RuntimeFileRef` metadata.

### Next recommended step

Run one live file-heavy turn in `persai-dev` with duplicate image filenames and one short `image_edit` prompt to confirm the model now picks the intended alias/fileRef from the single chronological history without falling back to old role assumptions.

## 2026-05-26 — Structured document prod path (migration `20260524120000_adr098_structured_document_versions`)

### What changed

Implemented the structured document production path so large PDF documents edit against versioned `structureJson` + `styleProfileJson` instead of whole-HTML SEARCH/REPLACE patches.

1. Added additive `AssistantDocumentVersion` fields: `structureJson`, `styleProfileJson`, `editStrategy`, `structureVersion` (+ migration `20260524120000_adr098_structured_document_versions`).
2. Large create/revise routes build or lazy-upgrade structured snapshots, render derived `renderedHtml`, and persist structure fields through the document job scheduler.
3. Revise routing is language-agnostic: `transferMode`, `editOperation`, `targetSectionIds` on the document tool contract + persisted version state + internal worker modes (`style_only`, `content_patch`, `section_rewrite`).
4. Small documents and explicit `fast_small` versions keep the existing patch-revise fast path.

### Files touched

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260524120000_adr098_structured_document_versions/`
- `packages/runtime-contract/src/index.ts`
- `apps/runtime/src/modules/turns/persai-document-structure.ts`
- `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts`
- `apps/api/src/modules/workspace-management/application/assistant-document-job-scheduler.service.ts`
- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts`
- `apps/runtime/test/persai-document-structure.test.ts`
- `apps/runtime/test/runtime-document-provider-adapter.service.test.ts`
- API document job tests updated for expanded revision context
- `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`

### Verification

1. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
2. `corepack pnpm --filter @persai/api run typecheck` — PASS
3. `corepack pnpm --filter @persai/runtime exec node --import tsx --test test/persai-document-structure.test.ts` — PASS
4. Focused runtime document adapter tests (structured revise + patch-revise) — PASS
5. `corepack pnpm --filter @persai/api exec node --import tsx --test test/assistant-document-job.service.test.ts test/assistant-document-job-scheduler.service.test.ts` — PASS

### Polish follow-up (same day)

- Persist `editStrategy: fast_small` on small create and patch-revise outcomes.
- Structured revise honors `metadata.preserveText` / `metadata.styleOnly` as explicit model flags for `style_only` (not user-language keywords).
- `transferMode` no longer affects revise operation resolution.
- Lazy upgrade reuses `previousVersionStyleProfileJson` when present.
- Added scheduler persistence test for `structureJson` / `styleProfileJson` / `editStrategy` and runtime test for large verbatim structured create.

### Risks / residuals

- Models should pass `transferMode=verbatim` and `editOperation=style_only` (or `metadata.preserveText`) for style-only revises; default remains `content_patch`.
- Legacy large HTML-only versions lazy-upgrade on first structured revise; monitor cluster revise jobs after deploy.
- `docs/ADR/098-country-aware-site-pages-and-legal-market.md` is unrelated legal content — do not confuse with this document-structure migration label.

### Next recommended step

Deploy to dev, then validate on cluster: large verbatim create → structured snapshot persisted; large style-only revise on prior PDF; one targeted section content_patch. Confirm patch-revise is no longer the default for large revise jobs.

## 2026-05-26 — Runtime background-turn economics follow-up

### What changed

Audited the remaining runtime background/helper LLM paths after the document worker cleanup and removed the clearest unnecessary chat-persona / expensive-slot carry-over.

The bounded runtime changes are now:

1. `RuntimeBackgroundTaskEvaluationService` starts its synthetic tool-enabled run on `system_tool` instead of `premium_reply`.
2. The same background-task evaluator no longer prepends the full ordinary chat `systemPrompt` or `heartbeat` when it is only returning structured `push | no_push | complete` JSON.
3. `TurnExecutionService.createBackgroundTaskToolRun()` now uses an explicit internal `background_worker` prompt mode with a short non-conversational worker system prompt instead of the ordinary chat persona prefix.
4. Async `RuntimeDocumentJobCompletionService` and `RuntimeMediaJobCompletionService` switched their short completion/failure framers from `normal_reply` to `system_tool`.
5. Those async completion framers also stopped appending the ordinary `heartbeat` tail. They still keep the ordinary `systemPrompt`, because their final text remains user-facing assistant copy.

No public API/schema changed. No user-visible product flow changed besides cheaper internal model routing/prompt composition for these background paths.

### Files touched

- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/src/modules/turns/runtime-background-task-evaluation.service.ts`
- `apps/runtime/src/modules/turns/runtime-document-job-completion.service.ts`
- `apps/runtime/src/modules/turns/runtime-media-job-completion.service.ts`
- `apps/runtime/test/runtime-background-task-evaluation.service.test.ts`
- `apps/runtime/test/runtime-document-job-completion.service.test.ts`
- `apps/runtime/test/runtime-media-job-completion.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Focused:

1. `corepack pnpm --filter @persai/runtime exec tsx test/runtime-background-task-evaluation.service.test.ts` — PASS
2. `corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-job-completion.service.test.ts` — PASS
3. `corepack pnpm --filter @persai/runtime exec tsx test/runtime-media-job-completion.service.test.ts` — PASS
4. `corepack pnpm --filter @persai/runtime run typecheck` — PASS

### Risks / residuals

- This slice intentionally leaves the ordinary `systemPrompt` in document/media completion framing because those messages are still delivered as user-facing assistant copy.
- `preview-assistant-setup.service.ts` still uses `premium_reply`, but that path is an explicit user-facing preview turn rather than a hidden background worker/helper.
- Other API-side helper paths already use narrow dedicated prompts (`upload micro-description`, retrieval helper, image safety rewrite, admin Skill authoring) and were not changed in this slice.

### Next recommended step

Check live provider/runtime cost logs for `background_task_evaluation`, `document_job_completion`, and `media_job_completion` after deploy to confirm the expected slot/prompt-token drop, then decide whether any remaining user-facing-but-short helper paths still merit a smaller style prompt instead of the full ordinary persona.

## 2026-05-26 — Idle re-engagement greeting-first topic continuation

### What changed

Adjusted the idle re-engagement prompt contract after founder feedback: the model should not be told to avoid continuing an older topic outright.

The bounded prompt change is now:

1. Start the notification with a brief natural greeting or soft check-in.
2. Allow the model to continue an earlier topic after that greeting/check-in.
3. Require wording that acknowledges time passed and gently asks whether the user still wants help or wants to continue.
4. Keep the existing non-pushy constraints: no guilt, no exact idle duration, and no implication that PersAI was continuously waiting on the user.

No runtime routing, schema, delivery channel, or scheduling cadence changed. This is a bounded LLM-instruction/brief correction only.

### Files touched

- `apps/api/src/modules/workspace-management/application/persai-idle-reengagement-scheduler.service.ts`
- `apps/api/test/persai-idle-reengagement-scheduler.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

1. `corepack pnpm --filter @persai/api exec tsx test/persai-idle-reengagement-scheduler.service.test.ts` — PASS
2. `corepack pnpm -r --if-present run lint` — PASS
3. `corepack pnpm run format:check` — PASS
4. `corepack pnpm --filter @persai/api run typecheck` — PASS
5. `corepack pnpm --filter @persai/web run typecheck` — PASS

### Risks / residuals

- This slice changes instruction wording only; actual notification tone quality still depends on model behavior in live traffic.
- We now permit topic continuation again, so future live review should confirm the greeting/check-in consistently appears before topic follow-up.

### Next recommended step

Observe a few live idle re-engagement pushes in `persai-dev` and confirm they now open with a greeting/check-in before softly returning to the earlier topic.

## 2026-05-26 — Honest image-provider safety rejection + one safer retry

### What changed

Closed the concrete media failure seam found in live usage where OpenAI image generate/edit safety rejects were being flattened into generic provider/runtime failures and could later show up as `media_job_artifacts_missing`.

The bounded runtime/provider behavior is now:

1. `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` detects OpenAI image safety rejects for both generate/edit and returns a typed `image_provider_safety_rejected` bad-request payload with preserved provider request id/status metadata.
2. `apps/runtime/src/modules/turns/provider-gateway.client.service.ts` maps that payload to a dedicated `ProviderGatewaySafetyRejectedError` instead of a generic gateway exception.
3. `apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts` and `runtime-image-edit-tool.service.ts` now do exactly one bounded safer paraphrase via the existing `systemTool` model slot, retry the provider call once, and if the retry succeeds they keep the safer wording on `revisedPrompt` plus an honest retry warning.
4. If the rewrite or the single retry still fails, the tool result stays `reason="image_provider_safety_rejected"` with honest warning text instead of degrading into a fake "render still running" or later "no artifacts" explanation.
5. `apps/runtime/src/modules/turns/runtime-media-job-run.service.ts` now converts that typed image-tool failure into an honest async media-job execution failure so the API can surface the real safety rejection instead of `media_job_artifacts_missing`.

No schema changed. No UI protocol/state machine was added. No docs besides this handoff/changelog reconciliation were changed.

### Files touched

- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `apps/runtime/src/modules/turns/provider-gateway.client.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-media-job-run.service.ts`
- `apps/runtime/src/modules/turns/image-provider-safety-rewrite.ts`
- `apps/runtime/test/provider-gateway.client.service.test.ts`
- `apps/runtime/test/runtime-image-generate-tool.service.test.ts`
- `apps/runtime/test/runtime-image-edit-tool.service.test.ts`
- `apps/runtime/test/runtime-media-job-run.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Focused:

1. `corepack pnpm --filter @persai/provider-gateway exec tsx --test test/openai-provider.client.test.ts` — PASS
2. `corepack pnpm --filter @persai/runtime exec tsx --test test/provider-gateway.client.service.test.ts test/runtime-image-generate-tool.service.test.ts test/runtime-image-edit-tool.service.test.ts test/runtime-media-job-run.service.test.ts` — PASS

Repo gates / full suites:

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
6. `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
7. `corepack pnpm --filter @persai/api run test` — PASS
8. `corepack pnpm --filter @persai/runtime run test` — PASS
9. `corepack pnpm --filter @persai/provider-gateway run test` — PASS
10. `corepack pnpm --filter @persai/web run test` — PASS

### Risks / residuals

- This slice intentionally adds only one safer rewrite + one retry; it does not introduce an open-ended retry framework.
- The user-visible intermediate "retrying with a safer phrasing" remains warning-level tool/result semantics, not a new async job-progress state.
- Safety-reject detection is intentionally narrow to the provider's explicit image safety-reject shape/message rather than broad keyword heuristics.

### Next recommended step

Run the live `persai-dev` image cases that originally failed (`image_generate` and `image_edit`) and confirm both branches: one safer retry succeeds for benign intent, and repeated provider rejection now surfaces as an honest safety error.

## 2026-05-26 — Working Files document-role priority cleanup

### What changed

Closed the model-facing document-context gap that was causing conflicting source signals between the old `RECENT PDFS YOU CAN REVISE` block and the `Working Files` block.

The runtime-only prompt cleanup is:

1. Removed the separate `RECENT PDFS YOU CAN REVISE` developer section.
2. Folded revisable-PDF truth directly into `Working Files`, including explicit `fileRef` UUID anchors on relevant PDF lines.
3. Added explicit roles for document-relevant files: `CURRENT_SOURCE`, `LAST_DELIVERED_RESULT`, `HISTORY`, `RECENT_DISCOVERED`, `OTHER_FILES`.
4. Added priority guidance so current source attachments win when the user is asking to create a new document, while revisable delivered PDFs remain available when the user is clearly editing an existing document.
5. Kept semantic hints visible even for weak filenames and stopped mixing conflicting historical aliases on the same document-role line.

No API/schema behavior changed. This is a runtime prompt-shaping correction only.

### Files touched

- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/test/working-files-developer-section.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Focused:

1. `corepack pnpm --filter @persai/runtime exec tsx --test test/working-files-developer-section.test.ts` — PASS

Repo gates / full suites:

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
6. `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
7. `corepack pnpm --filter @persai/api run test` — PASS
8. `corepack pnpm --filter @persai/runtime run test` — PASS
9. `corepack pnpm --filter @persai/provider-gateway run test` — PASS
10. `corepack pnpm --filter @persai/web run test` — PASS

### Risks / residuals

- This slice improves prompt truth but does not add any server-side hard guard that forbids the model from choosing the wrong document action.
- The broader turn-entrypoint cleanup and the new media safety-reject slice are independent workstreams and stay intentionally separate at the code level.

### Next recommended step

Watch live document turns for the original failure mode: when a new source file is present beside an older delivered PDF, the model should now prefer create-from-current-source instead of blindly revising the old result.

## 2026-05-25 — Turn-entrypoint consolidation Slice 4 — honest internal web runtime session/compaction client naming

### What changed

Completed the final bounded residue-cleanup slice explicitly left after today's Slice 3 rename: the two remaining internal web session/compaction transport helpers now use honest web-runtime client naming instead of implying they are separate "native web chat session" services.

The hot-path behavior stayed unchanged:

1. `apps/api/src/modules/workspace-management/application/compact-native-web-chat-session.service.ts` was replaced by `web-runtime-compaction-client.service.ts`, and `CompactNativeWebChatSessionService` / `CompactNativeWebChatSessionInput` were renamed to `WebRuntimeCompactionClientService` / `WebRuntimeCompactionClientInput`.
2. `apps/api/src/modules/workspace-management/application/resolve-native-web-chat-session-state.service.ts` was replaced by `web-runtime-session-state-client.service.ts`, and `ResolveNativeWebChatSessionStateService` / `ResolveNativeWebChatSessionStateInput` were renamed to `WebRuntimeSessionStateClientService` / `WebRuntimeSessionStateClientInput`.
3. `manage-web-chat-list.service.ts` and `workspace-management.module.ts` now use the honest client names consistently for the compaction/action and session-state read paths.
4. The two focused helper test files kept their existing filenames for continuity in the current verification plan, but their imports/descriptions now point at the honest internal client names.
5. Error text inside the renamed adapters now refers honestly to the internal web runtime compaction/session-state clients instead of "native runtime web" helpers.

No public HTTP/SSE route changed. No schema changed. No Telegram behavior changed. No config/shadow residue cleanup was included in this slice.

### Files touched

- `apps/api/src/modules/workspace-management/application/web-runtime-compaction-client.service.ts`
- `apps/api/src/modules/workspace-management/application/web-runtime-session-state-client.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/compact-native-web-chat-session.service.test.ts`
- `apps/api/test/resolve-native-web-chat-session-state.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Focused:

1. `corepack pnpm --filter @persai/api exec tsx test/compact-native-web-chat-session.service.test.ts` — PASS
2. `corepack pnpm --filter @persai/api exec tsx test/resolve-native-web-chat-session-state.service.test.ts` — PASS
3. `corepack pnpm --filter @persai/api exec tsx test/manage-web-chat-list.service.test.ts` — PASS
4. `corepack pnpm --filter @persai/api run typecheck` — PASS
5. `corepack pnpm --filter @persai/api exec eslint src/modules/workspace-management/application test` — PASS

### Risks / residuals

- This slice is naming cleanup only; it does not reduce the remaining historical `native` wording in route metrics, env/config flags, shadow-comparison seams, or older archive docs.
- The two focused helper test files still keep their old filenames for verification continuity, even though their class/import names are now honest.
- `ManageWebChatListService` still owns both the compaction-state read path and the manual compaction action path; this slice only renames the helper clients, it does not refactor that service structure.

### Next recommended step

If more residue cleanup is needed later, keep it separate from this finished rename slice: either tackle config/shadow naming residue or pursue a larger architectural consolidation, but do not mix either with route/behavior changes in the same session.

## 2026-05-25 — Turn-entrypoint consolidation Slice 3 — honest internal web runtime client naming

### What changed

Completed the next bounded API turn-entry cleanup slice after the late-path hardening: renamed the misleading internal web runtime transport adapters so the code no longer reads like these are user-facing "native web chat turn services".

The hot-path behavior stayed unchanged:

1. `apps/api/src/modules/workspace-management/application/send-native-web-chat-turn.service.ts` was replaced by `web-runtime-turn-client.service.ts`, and `SendNativeWebChatTurnService` / `SendNativeWebChatTurnInput` were renamed to `WebRuntimeTurnClientService` / `WebRuntimeTurnClientInput`.
2. `apps/api/src/modules/workspace-management/application/stream-native-web-chat-turn.service.ts` was replaced by `web-runtime-stream-client.service.ts`, and `StreamNativeWebChatTurnService` / `StreamNativeWebChatTurnInput` were renamed to `WebRuntimeStreamClientService` / `WebRuntimeStreamClientInput`.
3. `send-web-chat-turn.service.ts`, `stream-web-chat-turn.service.ts`, and `workspace-management.module.ts` now use the new internal client names consistently. Helper names and test descriptions were updated to match.
4. The two focused adapter test files kept their existing filenames for continuity in the current verification plan, but their imports/descriptions now point at the honest internal client names.
5. Error text inside the renamed adapter classes now refers to the internal web runtime client/stream honestly instead of "native runtime web sync/stream". Public route behavior, runtime request shape, Telegram path, and config/shadow residue were intentionally left untouched.

No public HTTP/SSE route changed. No schema changed. No Telegram behavior changed. No shadow/config cleanup was included in this slice.

### Files touched

- `apps/api/src/modules/workspace-management/application/web-runtime-turn-client.service.ts`
- `apps/api/src/modules/workspace-management/application/web-runtime-stream-client.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/send-native-web-chat-turn.service.test.ts`
- `apps/api/test/stream-native-web-chat-turn.service.test.ts`
- `apps/api/test/send-web-chat-turn.service.test.ts`
- `apps/api/test/stream-web-chat-turn.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Focused:

1. `corepack pnpm --filter @persai/api exec tsx test/send-native-web-chat-turn.service.test.ts` — PASS
2. `corepack pnpm --filter @persai/api exec tsx test/stream-native-web-chat-turn.service.test.ts` — PASS
3. `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts` — PASS
4. `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts` — PASS
5. `corepack pnpm --filter @persai/api run typecheck` — PASS
6. `corepack pnpm --filter @persai/api exec eslint src/modules/workspace-management/application test` — PASS

### Risks / residuals

- This slice is naming cleanup only; it does not reduce the remaining `native` wording in config flags, route metrics, shadow comparison, or other historical residue outside these two internal client adapters.
- The two focused adapter test files still keep their old filenames for verification continuity, even though their class/import names are now honest.
- Because this remains the web turn-entry hot path, later cleanup should keep reusing these focused send/stream suites before removing more residue or folding layers together.

### Next recommended step

Take the next bounded residue slice separately: either rename the remaining internal `native` web session-state/compaction helpers, or clean up the config/shadow naming residue, but do not mix that with route or behavior changes.

## 2026-05-25 — Turn-entrypoint consolidation Slice 2 follow-up — bounded late-path failure hardening

### What changed

Applied a narrow correctness fix on top of the just-landed shared web post-runtime completion seam without widening into route, schema, Telegram, or rename/consolidation work.

The hot-path behavioral changes are intentionally small:

1. `complete-web-post-runtime-turn.ts` now treats web quota/compaction follow-up delivery as **best-effort**. If `deliverIntentNow()` or related follow-up work fails after the main assistant reply is already persisted, the turn still completes and no late-path exception escapes the helper.
2. `send-web-chat-turn.service.ts` and `stream-web-chat-turn.service.ts` now treat post-replay skill-state persistence / background-check queueing as **best-effort**. A failure there logs a warning but no longer downgrades an already completed main reply into a failed/interrupted turn.
3. `stream-web-chat-turn.service.ts` now explicitly avoids creating a second interrupted assistant message if an unexpected late-path error happens after the main assistant reply was already persisted.
4. `web-chat-turn-attempt.service.ts` now refuses terminal downgrades: `markFailed()` / `markInterrupted()` only update attempts that are still `accepted` or `running`, and `markCompleted()` also no-ops cleanly when the row is already terminal. This preserves the completed-attempt idempotency truth instead of letting a later failure write overwrite it.

No public HTTP/SSE route changed. No schema changed. No Telegram behavior changed. The shared helper/module naming introduced in Slice 2 remains as-is; this is only the bounded failure-path hardening that was missing on that seam.

### Files touched

- `apps/api/src/modules/workspace-management/application/complete-web-post-runtime-turn.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/web-chat-turn-attempt.service.ts`
- `apps/api/test/send-web-chat-turn.service.test.ts`
- `apps/api/test/stream-web-chat-turn.service.test.ts`
- `apps/api/test/web-chat-turn-attempt.service.test.ts`
- `docs/SESSION-HANDOFF.md`
- `docs/CHANGELOG.md`

### Verification

Focused:

1. `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts` — PASS
2. `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts` — PASS
3. `corepack pnpm --filter @persai/api exec tsx test/web-chat-turn-attempt.service.test.ts` — PASS
4. `corepack pnpm --filter @persai/api run typecheck` — PASS
5. `corepack pnpm --filter @persai/api exec eslint src/modules/workspace-management/application/send-web-chat-turn.service.ts src/modules/workspace-management/application/stream-web-chat-turn.service.ts src/modules/workspace-management/application/complete-web-post-runtime-turn.ts src/modules/workspace-management/application/web-chat-turn-attempt.service.ts test/send-web-chat-turn.service.test.ts test/stream-web-chat-turn.service.test.ts test/web-chat-turn-attempt.service.test.ts` — PASS

### Risks / residuals

- This slice intentionally hardens only the bounded **late optional** path after the main assistant reply exists; it does not redesign the broader sync/stream completion flow.
- Core failures before assistant-message persistence still fail the turn honestly, and required replay-completion/binding writes still remain part of the main path.
- The later `web` vs `native-web` naming/service cleanup remains separate and unchanged.

### Next recommended step

Keep the next slice tight: continue the planned service-layer naming/consolidation cleanup without changing routes, and preserve these new late-path safety guarantees while doing it.

## 2026-05-25 — Turn-entrypoint consolidation Slice 2 — shared web post-runtime completion seam

### What changed

Finished the next bounded API cleanup slice after the shared assistant-message persistence helper: extracted a new shared web-only post-runtime helper module,
`apps/api/src/modules/workspace-management/application/complete-web-post-runtime-turn.ts`,
and switched both `send-web-chat-turn.service.ts` and `stream-web-chat-turn.service.ts` to use it after the assistant message has already been persisted.

A tiny follow-up cleanup removed one unused local left behind in `stream-web-chat-turn.service.ts` during the extraction so the workspace lint gate stays green. No runtime behavior changed in that follow-up.

The extracted seam now centralizes the overlapping web completion path that was still hand-copied in both services:

1. read active web media/document jobs for the final transport payload
2. deliver runtime-produced media to the web chat thread
3. apply and persist final-delivery honesty correction when delivery outcome differs from assistant text
4. record memory, quota, model-cost ledger, and tool-path ledger from the finalized assistant content
5. create and immediately deliver quota/compaction follow-up messages
6. write replay-complete state for `clientTurnId`
7. persist post-turn skill routing state and queue the background recheck when needed

Stream-only behavior remains local to `StreamWebChatTurnService`: stall retry, SSE callbacks, interrupted partial persistence, and timing/metrics were intentionally **not** pushed into the shared helper. No public HTTP/SSE route changed. No schema changed. No Telegram behavior changed. `send-native-web-chat-turn.service.ts` and `stream-native-web-chat-turn.service.ts` were left in place unchanged.

### Files touched

- `apps/api/src/modules/workspace-management/application/complete-web-post-runtime-turn.ts` — new shared web post-runtime helper module
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts` — helper adoption
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` — helper adoption
- `docs/SESSION-HANDOFF.md` — this section
- `docs/CHANGELOG.md` — top entry

### Verification

Focused:

1. `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts` — PASS
2. `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS

Repo gates / full suites:

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
6. `corepack pnpm --filter @persai/api run test` — PASS
7. `corepack pnpm --filter @persai/runtime run test` — PASS
8. `corepack pnpm --filter @persai/web run test` — PASS

Note: an earlier parallelized verification attempt produced unrelated Vitest timeouts under local machine contention; rerunning the full `@persai/web` suite alone passed clean, so no persistent web regression was attributed to this slice.

### Risks / residuals

- This slice intentionally keeps `send-native-web-chat-turn.service.ts` and `stream-native-web-chat-turn.service.ts` untouched; the naming/consolidation step is still later.
- Only the honest post-runtime overlap was extracted. Pre-runtime input-building, replay-state rebuild helpers, and stream-specific interrupted/stall paths still live in the individual services.
- Because this is still a hot-path turn-entry slice, later consolidation work should keep reusing the focused send/stream regression suites before any rename/removal step.

### Next recommended step

Prepare the next honest consolidation slice: reduce the remaining `web` vs `native-web` naming/service-layer ambiguity without changing routes, and only extract any further shared code where sync and stream semantics are still truly aligned.

## 2026-05-25 — Turn-entrypoint consolidation Slice 1 — shared assistant-message persistence helper

### What changed

Started the API-side turn-entrypoint cleanup from the readonly audit with the safest bounded slice first: centralize the assistant-reply persistence seam before renaming/removing any services or touching HTTP routes.

Added `apps/api/src/modules/workspace-management/application/persist-assistant-message.ts` and switched the three hot-path orchestrators that actually persist assistant replies today:

- `send-web-chat-turn.service.ts`
- `stream-web-chat-turn.service.ts`
- `handle-internal-telegram-turn.service.ts`

The helper now owns the two duplicated behaviors that mattered for future consolidation:

1. persist `discoveredFileRefIds` onto assistant-message metadata in one place
2. attach the created assistant acknowledgement message id onto queued deferred media jobs in one place

No public route changed. No runtime request contract changed. No schema/migration changed. This slice is intentionally preparatory: it reduces duplication in the turn-entry hot path so later consolidation of `web`/`native-web` layering can be done with less drift risk.

### Files touched

- `apps/api/src/modules/workspace-management/application/persist-assistant-message.ts` — new shared helper
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts` — helper adoption
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` — helper adoption
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts` — helper adoption
- `apps/api/test/persist-assistant-message.test.ts` — new focused helper coverage
- `docs/SESSION-HANDOFF.md` — this section
- `docs/CHANGELOG.md` — top entry

### Verification

Focused:

1. `corepack pnpm --filter @persai/api exec tsx test/persist-assistant-message.test.ts` — PASS
2. `corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts` — PASS
3. `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts` — PASS
4. `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts` — PASS

Repo gates / full suites:

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
6. `corepack pnpm --filter @persai/api run test` — PASS
7. `corepack pnpm --filter @persai/web run test` — PASS
8. `corepack pnpm --filter @persai/runtime run test` — PASS

Note: the first full `@persai/web` run hit one transient timeout in `app/admin/runtime/page.test.tsx`; isolated rerun of that file passed, and the repeated full web suite then passed clean.

### Risks / residuals

- This slice intentionally does **not** remove `send-native-web-chat-turn.service.ts` / `stream-native-web-chat-turn.service.ts` yet.
- The audited config/doc residue around `PERSAI_WEB_CHAT_*_RUNTIME_MODE` and `web-runtime-shadow-comparison.service.ts` is still present and remains the next cleanup area.
- The turn-entry hot path remains risky for replay/stream/compaction behavior, so later slices should keep using focused send/stream/telegram regression suites plus full repo gates.

### Next recommended step

Slice 2: extract the shared web-turn post-runtime orchestration seam and prepare the honest rename/consolidation plan for the `web` vs `native-web` service split, while keeping current HTTP routes and Telegram behavior unchanged.

## 2026-05-24 — ADR-097 hotfix — retrying DB-truth revision version allocation

### What changed

**Production diagnostic:** cross-chat revise now reaches enqueue successfully, but a second quick revise against the same document can still fail with Prisma unique constraint `assistant_document_versions_doc_version_number_key` on `(doc_id, version_number)`. Root cause: `AssistantDocumentJobService.enqueueRevision()` was allocating `versionNumber = currentVersionNumber + 1`, but `currentVersionId/currentVersionNumber` are only promoted on delivery, so two fast enqueues could both choose the same next number.

**Fix:** `AssistantDocumentJobService.enqueueRevision()` now allocates the next revision `versionNumber` inside the transaction from the latest persisted `AssistantDocumentVersion` row for that `docId` (ordered by `versionNumber DESC`) instead of trusting the delivered `currentVersionNumber`. This keeps same-chat and cross-chat revise on the shared DB-truth path without changing revision ancestry, delivery-time current-version promotion, or schema.

**Retry path:** when a concurrent enqueue still wins the race between read and insert, the service now catches the specific Prisma `P2002` conflict for `(doc_id, version_number)`, re-reads DB truth in a fresh transaction, and retries up to 3 bounded attempts. No global lock and no migration added.

### Files touched

- `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts` — DB-truth allocator + bounded unique-conflict retry
- `apps/api/test/assistant-document-job.service.test.ts` — focused allocator and retry regressions
- `docs/ADR/097-autonomous-document-tool-and-async-rendering.md` — hotfix note
- `docs/SESSION-HANDOFF.md` — this section
- `docs/CHANGELOG.md` — top entry

### Verification (all PASS)

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
6. `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
7. `corepack pnpm --filter @persai/api run test` — PASS
8. `corepack pnpm --filter @persai/runtime run test` — PASS
9. `corepack pnpm --filter @persai/provider-gateway run test` — PASS

### Next recommended step

Deploy to `persai-dev` and manually verify two back-to-back `revise_document` requests against the same PDF (same-chat and cross-chat). Confirm both enqueues succeed, version numbers advance monotonically, and only delivery still controls `currentVersionId/currentVersionNumber` promotion.

## 2026-05-24 — ADR-097 Slice 5 — cross-chat recent-PDFs hint + descriptor sharpening

### What changed

**Production diagnostic:** Slice 4 shipped but the model kept passing aliases (`"last generated file"`, `"previous attachment #1"`) instead of UUIDs in `fileRef`. DB showed zero UUID fileRef calls. Root cause: the `RECENT PDFS IN THIS CHAT` hint only covered the current chat, so cross-chat revises had no server-resolved UUID anchor.

**Fix 1 — Assistant-scope hint:** `AssistantDocumentJobReadService.listRecentAssistantPdfsForTurn()` added — queries PDFs across ALL chats of the assistant (not just current chat), returns `fileRef` (= `assistantFileId`), `filename`, `chatId`, `currentVersionId`, `deliveredAt`. Cap 6, ordered by `updatedAt DESC`, only documents with non-null `renderedHtml`. Per-chat `listRecentChatPdfsForTurn` kept for backwards compat.

`RuntimeRecentChatPdf` extended with `fileRef?`, `chatRef?` (`"current_chat" | "other_chat"`), `relativeAge?`. All 5 API entry points (stream-web, send-web, send-native-web, handle-internal-telegram, send-native-telegram) now call `listRecentAssistantPdfsForTurn` and pass `recentChatPdfs` with the new fields.

`TurnExecutionService.buildRecentChatPdfsHintSection()` updated to render `fileRef:`, `origin:`, `age:` per row with an explicit anti-alias warning: do NOT use aliases like `"last generated file"` or `"previous attachment #1"` as `fileRef` values.

**Fix 2 — Descriptor sharpening:** `native-tool-projection.ts` `fileRef` field description rewritten to explicitly say "MUST be a UUID" with an example UUID and list of invalid alias patterns. All `file_ref` (snake-case) references in the tool description replaced with `fileRef` (camelCase).

**Fix 3 — Log:** `[document-tool] fileRef-not-uuid` log line added when model passes a non-UUID fileRef.

### Files touched

- `packages/runtime-contract/src/index.ts` — `fileRef?`, `chatRef?`, `relativeAge?` on `RuntimeRecentChatPdf`
- `apps/api/src/modules/workspace-management/application/assistant-document-job-read.service.ts` — `listRecentAssistantPdfsForTurn()`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` — switch to new method
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts` — add call + pass through
- `apps/api/src/modules/workspace-management/application/send-native-web-chat-turn.service.ts` — `recentChatPdfs` on input type
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts` — new dep + call
- `apps/api/src/modules/workspace-management/application/send-native-telegram-turn.service.ts` — `recentChatPdfs` on input type
- `apps/runtime/src/modules/turns/turn-execution.service.ts` — updated hint format
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — sharpened descriptor
- `apps/runtime/src/modules/turns/runtime-document-tool.service.ts` — `[document-tool] fileRef-not-uuid` log
- `apps/api/test/assistant-document-job-read.service.test.ts` — 5 new `listRecentAssistantPdfsForTurn` tests
- `apps/runtime/test/turn-execution.service.test.ts` — updated hint tests + 2 new cross-chat tests
- `apps/api/test/stream-web-chat-turn.service.test.ts` — mock switched + 3 new contract tests
- `apps/api/test/send-web-chat-turn.service.test.ts` — mock updated
- `apps/api/test/handle-internal-telegram-turn.service.test.ts` — all 9 instantiations updated
- `apps/runtime/test/native-tool-projection.test.ts` — 4 new descriptor assertions
- `apps/runtime/test/runtime-document-tool.service.test.ts` — 1 new log test
- `docs/ADR/097-autonomous-document-tool-and-async-rendering.md` — Phase 11 section
- `docs/SESSION-HANDOFF.md` — this section
- `docs/CHANGELOG.md` — top entry

### Verification (all PASS)

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
6. `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
7. `corepack pnpm --filter @persai/api run test` — PASS
8. `corepack pnpm --filter @persai/runtime run test` — PASS
9. `corepack pnpm --filter @persai/provider-gateway run test` — PASS

### Next recommended step

Deploy to `persai-dev`. Validate cross-chat revise end-to-end: create a PDF in chat A, open chat B, call `revise_document`. Confirm the model now picks up the fileRef UUID from the `RECENT PDFS YOU CAN REVISE` developer block and passes it as `fileRef` (not an alias). Confirm `[document-pdf-patch-revise-success]` log emits with a valid UUID fileRef.

## 2026-05-24 — ADR-097 Slice 4 — cross-chat PDF revise via file_ref

### What changed

`file_ref` added as an alternative to `doc_id` on `revise_document`. The model may now pass an `AssistantFile.id` (discovered via `files.search` or Working Files) to revise a PDF from any earlier chat. The API resolves it via `AssistantDocumentDeliveredFile.assistantFileId`, security-checks `AssistantFile.assistantId`, fetches the latest version, and feeds `renderedHtml` into the existing Slice 2 patch-revise loop. The new revision version is written to the **current chat**; only the read crosses chats.

Three new typed errors: `revise_document_file_ref_not_found`, `revise_document_file_ref_not_a_pdf_document`, `revise_document_ambiguous_source`. Existing `document_revise_unsupported_legacy_version` guard active on the cross-chat path. `listRecentChatPdfsForTurn` unchanged (stays per-chat; cross-chat visibility already covered by ADR-100 Working Files).

### Files touched

- `packages/runtime-contract/src/index.ts` — `fileRef` in `RuntimeDocumentJobRunRequest.directToolExecution.request`
- `apps/runtime/src/modules/turns/runtime-document-tool.service.ts` — parse `fileRef`; `resolveEffectiveDescriptorMode` now treats valid `fileRef` as confirmed revise intent; `normalizePresentationRequest` types updated
- `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts` — `findRevisionContextByFileRef()` new method; `AssistantDocumentRevisionContext` imported from here
- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts` — `fileRef` on `DocumentDirectToolExecutionPayload`; `enqueueRevisionByFileRef()` + `resolveFileRefToRevisionContext()` private methods; ambiguity check in `execute()`
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — `fileRef` field in schema; updated `docId` + description
- `apps/api/test/enqueue-runtime-deferred-document-job-file-ref-resolver.service.test.ts` — NEW (9 cases)
- `docs/ADR/097-autonomous-document-tool-and-async-rendering.md` — Phase 10 section
- `docs/SESSION-HANDOFF.md` — this section
- `docs/CHANGELOG.md` — top entry

### Verification (all PASS)

1. `corepack pnpm --filter @persai/api run typecheck` — PASS
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
3. `corepack pnpm --filter @persai/api run test` — PASS (all existing + 9 new)
4. `corepack pnpm --filter @persai/runtime run test` — PASS
5. lint + format:check — PASS

### Next recommended step

Deploy to `persai-dev`. Validate cross-chat revise end-to-end: create a PDF in chat A, copy the `AssistantFile.id` from `files.search`, open chat B, call `revise_document` with `file_ref`. Confirm `[document-pdf-patch-revise-success]` log emits in chat B with `parentVersionId` pointing to the chat A ancestor.

## 2026-05-24 — ADR-097 Slice 3 — single-shot timeout re-route + recent-PDFs developer hint

### What changed

**Gap A — Provider-gateway timeout hardening:**

- `ProviderGatewayTimeoutError` (typed, exported from `provider-gateway.client.service.ts`) replaces a generic `ServiceUnavailableException` for timeout cases; `fetchWithSignal` now throws this typed error on `AbortError`.
- `RuntimeDocumentProviderAdapterService.run()` catches `ProviderGatewayTimeoutError` on the single-shot path: logs `[document-pdf-single-shot-timeout]`, flips `useChunked`, counts the attempt against the retry budget. Parallels the existing truncation re-route.
- Chunked pipeline `ProviderGatewayTimeoutError` → logs `[document-pdf-chunked-timeout]`, sets `document_pdf_chunked_timeout` failure code, breaks loop. No further re-route.
- `ProviderGatewayTextGenerateRequest.timeoutMsHint?: number` added to runtime-contract. Worker passes `DOCUMENT_CLASSIFICATION_TIMEOUT_MS = 240_000` for `document_html_generation`, `document_pdf_outline`, `document_pdf_patch_revise`. OpenAI and Anthropic provider clients use `max(default, hint)` capped at `600_000ms`. Gateway `assertValidRequest` validates: positive integer, ≤ 600_000.

**Gap B — Contextual revise hint:**

- `AssistantDocumentJobReadService.listRecentChatPdfsForTurn()`: queries up to 3 `pdf_document` rows with `currentVersion.renderedHtml IS NOT NULL` and `updatedAt >= windowFloor` (oldest of last N=10 messages), ordered `updatedAt DESC`.
- `RuntimeRecentChatPdf` interface + `RuntimeTurnRequest.recentChatPdfs?: RuntimeRecentChatPdf[] | null` added to runtime-contract.
- `StreamWebChatTurnService.stream()` calls `listRecentChatPdfsForTurn` and passes result as `recentChatPdfs` in `StreamNativeWebChatTurnInput` → `RuntimeTurnRequest`.
- `TurnExecutionService.buildBaseDeveloperInstructionSections()` now calls `buildRecentChatPdfsHintSection()` which injects `RECENT PDFS IN THIS CHAT (server-resolved, not user-typed)` + `revise_document` guidance into the `recent_pdfs_hint` developer section when document tool is in scope and list is non-empty. No prompt cost when list is empty.
- `DeveloperInstructionSectionKey` extended with `"recent_pdfs_hint"`.
- `native-tool-projection.ts` `document` tool description: one sentence added: "When a developer hint lists recent PDFs in this chat, prefer `revise_document` over `create_pdf_document` for any modification to one of those PDFs."
- NO keyword routing. NO server-side reject of `create_pdf_document`.

### Files touched

- `packages/runtime-contract/src/index.ts` — `timeoutMsHint`, `RuntimeRecentChatPdf`, `RuntimeTurnRequest.recentChatPdfs`
- `apps/runtime/src/modules/turns/provider-gateway.client.service.ts` — `ProviderGatewayTimeoutError`, `fetchWithSignal` throw, `generateText` effective timeout
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` — `effectiveTimeoutMs` with `timeoutMsHint`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` — same
- `apps/provider-gateway/src/modules/providers/provider-text-generation.service.ts` — `assertValidTimeoutMsHint`
- `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts` — timeout re-route + `timeoutMsHint` on 3 classification builds
- `apps/api/src/modules/workspace-management/application/assistant-document-job-read.service.ts` — `listRecentChatPdfsForTurn`
- `apps/api/src/modules/workspace-management/application/stream-native-web-chat-turn.service.ts` — `recentChatPdfs` field + wiring
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` — query + pass `recentChatPdfs`
- `apps/runtime/src/modules/turns/turn-execution.service.ts` — `DeveloperInstructionSectionKey` + `buildRecentChatPdfsHintSection` + hint injection
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — descriptor reinforcement
- `apps/runtime/test/runtime-document-provider-adapter.service.test.ts` — 2 new timeout tests
- `apps/runtime/test/turn-execution.service.test.ts` — 4 new developer-block hint tests (`runRecentPdfsHintTests`)
- `apps/provider-gateway/test/provider-text-generation.service.test.ts` — 3 new `timeoutMsHint` validation tests
- `apps/api/test/assistant-document-job-read.service.test.ts` — 5 new `listRecentChatPdfsForTurn` tests (new file)
- `apps/api/test/stream-web-chat-turn.service.test.ts` — mock updated with `listRecentChatPdfsForTurn`
- `apps/runtime/test/run-suite.ts` + `run-suite-isolated.ts` — registered `runRecentPdfsHintTests`
- `docs/ADR/097-autonomous-document-tool-and-async-rendering.md` — Phase 9 + dated log entry
- `docs/SESSION-HANDOFF.md` — this section
- `docs/CHANGELOG.md` — top entry

### Verification (all PASS)

1. `corepack pnpm -r --if-present run lint` — PASS
2. `corepack pnpm run format:check` — PASS
3. `corepack pnpm --filter @persai/api run typecheck` — PASS
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime run typecheck` — PASS
6. `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
7. Focused new tests — PASS (embedded in full suite runs below)
8. `corepack pnpm --filter @persai/runtime run test` — PASS
9. `corepack pnpm --filter @persai/api run test` — PASS
10. `corepack pnpm --filter @persai/provider-gateway run test` — PASS

### Next recommended step

Deploy to `persai-dev` and run the 10-page PDF scenario to validate that the timeout re-route path fires and jobs complete via chunked generation. Also test the "modify only item 5" scenario to validate the developer-block hint steers the model to `revise_document`.

## 2026-05-24 — ADR-100 follow-up — token-aware files.search + Working Files recovery

### What changed

- Live transcript showed the model trying `files.search` three times with multi-token natural-language queries (`hudi nature photo`, `худи природа кепка фото`, `photo hoodie nature cap`) and getting empty results even though a stored file's `semanticSummary` covered the subject. Root cause was in `RuntimeAssistantFileRegistryService.search()` performing a single Postgres `contains: query` ILIKE across `displayName` / `relativePath` / `metadata.semanticSummary` — multi-word queries failed unless the literal phrase appeared verbatim. Secondary cause was the Working Files developer block phrasing the alias list as a closed world (`Use only these aliases ...`) with no explicit recovery instruction, so the model gave up and told the user the file was unavailable.
- `RuntimeAssistantFileRegistryService.search()` is now multi-step: lowercase + whitespace-split + `len ≥ 2` + dedupe → token list. Empty token list (e.g. single-char queries) falls back to the previous single-substring `buildSearchWhere` path. Otherwise SQL fetches up to `min(max(limit*5, 50), 200)` candidates via `OR` of every token across the three fields (each token using `contains: token, mode: insensitive` for string fields and `string_contains` for `metadata.semanticSummary` JSON path), then ranks in memory by the number of distinct tokens that substring-match across `displayName` / `relativePath` / `semanticSummary`, ordered by score desc and Postgres-side `createdAt desc` as tiebreaker. Public method signature unchanged; no prisma migration, no `pg_trgm`/`tsvector` index.
- `TurnExecutionService.buildWorkingFilesDeveloperSection()` rewords the alias block from `Server-owned reusable file aliases for this turn. Use only these aliases ...` to `These are the reusable file handles the system has already prepared for this turn. They are not the complete set of files available to you. Prefer these aliases ...`. A new recovery line is appended after the existing `files` / `image_edit` hints: `If the user refers to a file that is not in this list, do not assume it is unavailable. First call files.list to scan the assistant's full file corpus with its semantic hints, and if needed follow up with files.search for a narrower lookup. Only then, if nothing matches, tell the user the file is not available.` Other lines and helpers (`formatWorkingFileDeveloperLine`, `selectWorkingFilesForSemanticHints`, `limitModelVisibleWorkingFiles`) are untouched.
- Hard constraints respected: no change to `turn-routing.service.ts`, `project-execution-profile.ts`, `orchestrate-runtime-retrieval.service.ts`, `read-assistant-knowledge.service.ts`, public `RuntimeFilesToolResult` / `RuntimeFilesToolItem` / `RuntimeFileRef` schemas, or any keyword matching anywhere.

### Verification

- Repo gates (`AGENTS.md`):
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`
  - `corepack pnpm --filter @persai/runtime run typecheck`
- Focused tests:
  - `corepack pnpm --filter @persai/runtime exec tsx test/runtime-assistant-file-registry.service.test.ts` (new file, 6 tests covering multi-token semantic match, createdAt-desc tiebreaker on equal score, 3-token vs 1-token ranking, short-token fallback without throw, token dedupe, limit respected after ranking)
  - `corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts` (extended with one new multi-token search assertion)
  - `corepack pnpm --filter @persai/runtime exec tsx test/working-files-developer-section.test.ts` (extended with one new test asserting closed-world phrasing gone and recovery instruction present)
  - `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
  - `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution-discovered-file-refs.test.ts`
  - `corepack pnpm --filter @persai/runtime exec tsx test/project-execution-profile.test.ts`
  - Full `corepack pnpm --filter @persai/runtime run test` suite

### Residual risks

- `working-files-developer-section.test.ts` carries two unrelated pre-existing failures on HEAD (test 1 `pruneClosedOpenLoopRefsDeveloperBlock` undefined on `Object.create`-built service, and test 5 trailing-newline mismatch on `stripDeveloperOpenLoopArtifacts`). Both reproduce on clean `origin/main` without this slice's changes — confirmed by stash-and-rerun — so they belong to an earlier slice's residual and are out of scope. The new test 2 added by this slice passes.
- Ranking still uses simple substring token matching, not stemming/lemmatization or trigram similarity. For long-tail natural-language queries where no token substring appears in any field this will still return empty. Mitigation is the new Working Files recovery instruction telling the model to fall back to `files.list` (full corpus with semantic hints) before declaring the file unavailable.
- Candidate cap of 200 rows per search query is generous but bounded; in extreme corpora (thousands of assistant files with broad token coverage) some long-tail matches might be cut before in-memory ranking. Mitigation deferred until a real assistant hits the cap; current production assistants are well under it.

### Next recommended step

- Live-test in `persai-dev`: ask the assistant to find a file by subject in Russian (e.g. `найди фото где я в худи на природе`) and confirm `files.search` returns the right file on the first try. If it does not, the recovery instruction should now prompt a `files.list` fallback rather than a `file unavailable` response.
- Then proceed with Slice 2 from the file-lifecycle plan: add `lifecycleClass` / `retentionExpiresAt` on `AssistantFile`, classifier on file creation sites, `AssistantFileRetentionReaperService`, and wire the existing "Clear cache" Assistant Settings button.

## 2026-05-24 — ADR-097 follow-up — patch-revise PDF loop (Slice 2)

### What changed

- **Patch-revise path:** `revise_document` for PDF now routes to `RuntimeDocumentProviderAdapterService.runPdfPatchRevise()` when `previousVersionRenderedHtml` is present. One LLM call with `document_pdf_patch_revise` classification returns a strict JSON envelope `{ mode: "document_pdf_patch_revise", patches: [{ search, replace }] }`. Patches applied sequentially with uniqueness validation, then `repairHtmlDocument`, then PDFMonkey.
- **Silent fallback removed:** `RuntimeDocumentToolService.resolveEffectiveDescriptorMode` no longer converts PDF `revise_document` without a valid UUID docId into `create_pdf_document`. The mode stays `revise_document` and the API resolves or honestly rejects.
- **Legacy rejection:** PDF revise on a version with `renderedHtml === null` returns `document_revise_unsupported_legacy_version` at enqueue time. No silent full-regeneration fallback.
- **No-document rejection:** PDF revise with no resolvable document in chat returns `revise_document_requires_existing_pdf`.
- **Context plumbing:** `AssistantDocumentRevisionContext` now carries `currentVersionRenderedHtml`; `findRevisionContext` and `findLatestRevisionContextForChat` select it from the DB. Scheduler forwards it through `DocumentJobRequestPayload` → `RuntimeDocumentJobRunRequest.previousVersionRenderedHtml`.
- **UX:** Delivery service emits "Applying edits…" / "Применяю правки…" for PDF revise jobs.
- **Contract:** `PERSAI_PROVIDER_REQUEST_CLASSIFICATIONS` extended with `"document_pdf_patch_revise"`; `RuntimeDocumentJobRunRequest` extended with `previousVersionRenderedHtml?: string | null`.
- **Tool descriptor:** `native-tool-projection.ts` updated to describe revise as patch-based; silent fallback hint removed.
- **Tests:** 6 new adapter tests, 3 new tool-service tests, 3 new API enqueue tests added in-file.
- **Docs:** ADR-097 updated with Slice 2 section and Phase 8 implementation shape; CHANGELOG entry added.

### Verification

Run in order:

1. `corepack pnpm --filter @persai/runtime run typecheck` — must pass
2. `corepack pnpm --filter @persai/api run typecheck` — must pass
3. `corepack pnpm --filter @persai/runtime run test` — must pass (pre-existing timing flake in `admin-system-notification-producer.service.test.ts` is out of scope)
4. `corepack pnpm --filter @persai/api run test` — must pass
5. `corepack pnpm -r --if-present run lint` — must pass
6. `corepack pnpm run format:check` — must pass

### Residual risks

- **LLM hallucination on search blocks:** if the model returns a `search` block that doesn't match the previous HTML character-for-exactly, the job fails with `document_pdf_patch_revise_search_not_found`. This is the intended honest failure; no fuzzy retry. Model prompt discipline is the mitigation.
- **Large patch for full rewrites:** a full-body patch with `search = <body>...</body>` is technically valid but burns large context on both input (previous HTML) and output (entire new body). For very large documents this may approach token limits. Mitigation deferred to Slice 3 (chunked patch-revise or hybrid path).
- **No streaming progress for patch-revise:** one LLM call → one PDFMonkey call → done. No intermediate progress events. The "Applying edits…" placeholder is the only signal. Acceptable for now.
- **Presentations untouched:** Gamma revise path still uses the old behaviour. Patch-revise is PDF-only.

### Next recommended step

- **Slice 3 (if needed):** Chunked patch-revise for very large documents — split the previous HTML into sections, patch each section independently, reassemble. Only needed if token-limit failures are observed in production.
- Alternatively: Model prompt hardening based on production search-not-found error rates.

## 2026-05-24 — ADR-097 follow-up — chunked PDF generation + sticky HTML

### What changed

- **Routing:** One deterministic routing decision per job before any LLM call. If `sourceFiles[]` present AND total inlined source bytes > 20 KB → chunked path; otherwise single-shot. One allowed re-route: single-shot truncation (no `</body>`/`</html>` + short body text) switches to chunked once, logged as `[document-pdf-single-shot-truncated]`.
- **Chunked pipeline:** Outline call (strict JSON, fail with `document_pdf_outline_invalid` on invalid) → style anchor (no LLM, synthesized from bundle) → sequential section generation (1 LLM call each, proportional source slice, tail summary) → assembly (concat → boilerplate wrap → `repairHtmlDocument` → PDFMonkey). No parallel section calls.
- **Output-token ceiling:** `DOCUMENT_HTML_MAX_OUTPUT_TOKENS = 16_000` removed. Effective ceiling = `min(bundle.modelSlots[slot].maxOutputTokens, DEFENSIVE_OUTPUT_TOKEN_CAP=64_000)`.
- **Timeouts:** Single-shot keeps `DEFAULT_DOCUMENT_TIMEOUT_MS` (6 min). Chunked uses `CHUNKED_DOCUMENT_TIMEOUT_MS = 15 min`.
- **Sticky HTML:** `AssistantDocumentVersion.renderedHtml TEXT` added (migration `20260524000000_adr097_persist_rendered_html`). Worker returns `renderedHtml` in `RuntimeDocumentJobRunResult`; scheduler persists it in the `ready_for_delivery` transition. No retroactive backfill.
- **Progress:** Progress milestones logged as structured log lines with localized text (en/ru). Live in-chat progress requires a callback endpoint (Slice 2 infrastructure, not implemented here).

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/runtime run typecheck`
- Focused: `corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-provider-adapter.service.test.ts`
- Focused: `corepack pnpm --filter @persai/api exec tsx test/assistant-document-job-scheduler.service.test.ts`
- Full: `corepack pnpm --filter @persai/runtime run test`
- Full: `corepack pnpm --filter @persai/api run test`

### Residual risks

- **Live progress UX:** Progress is logged but not visible to the user mid-execution. A progress-callback API endpoint and a chat message update mechanism are needed for live UX (Slice 2+).
- **Parallel section generation:** Explicitly not implemented per founder anchor. Sequential is correct for style consistency but makes long documents slower; Slice 2+ can explore parallel with a style-consistency evaluation framework.
- **Smart source retrieval:** Section source slicing uses simple proportional weight split (v1 per ADR-097). Semantic retrieval per section is Slice 2+ territory.
- **revise_document patch loop:** `AssistantDocumentVersion.renderedHtml` is now populated but `revise_document` does not yet use it. Slice 2 will reject patch-revise of versions without `renderedHtml` with a `rendered_html_missing` error and implement the diff-based revision.
- **Gamma/PPTX:** Not affected by this slice. Gamma path unchanged.

### Next recommended step

Slice 2: implement patch-revise using `renderedHtml`. In `revise_document` mode, read `AssistantDocumentVersion.renderedHtml` for the current version, apply the diff requested, run `repairHtmlDocument`, send to PDFMonkey, create a new version. Reject with `rendered_html_missing` if the field is null (old version).

## 2026-05-24 — ADR-100 follow-up — files-tool discovery aliases + knowledge relevance floor

### What changed

- Architectural finalization of the assistant's file search/send/edit loop so a `files.search` result reliably drives the next `files.send` / `image_edit` instead of the model falling back to a stale `previous attachment #N` ordinal that points to an unrelated past upload.
- Fix A — Runtime files tool now emits `discoveredFileRefs: RuntimeFileRef[]` on its internal execution outcome for `search` / `list` / `get` / `read`. Each discovered ref carries fresh, unambiguous working-files aliases: ordinal `found image #N` / `found file #N` for search results, `listed image #N` / `listed file #N` for directory listings, singular `fetched image` / `fetched file` for single-target `get`, and `read image` / `read file` for `read`. The same aliases are populated on the already-optional `aliases` field of the model-visible `RuntimeFilesToolItem`, so the model sees them directly in the search result JSON.
- `TurnExecutionService.applyToolExecutionOutcome` now merges `discoveredFileRefs` into `turnState.fileRefs` (push if absent, otherwise merge aliases case-insensitively without duplicating the entry). The existing `TurnContextHydrationService.upsertWorkingFileRef` already merges incoming `fileRef.aliases` via `mergeAliases`, so the next iteration's Working Files developer block now lists discovered files with both the discovery alias (`found image #1`) and the standard ordinal (`current file #N`), and the model can address them through `files.send` / `image_edit` without guessing.
- Fix C — `read-assistant-knowledge.service` now propagates whole-token `exactTokenHits` from `scoreFieldMatch` through `rankStructuredCandidate` into a new `RankedSearchCandidate.exactTokenHits` field. The four `.filter((row) => row.score > 0)` filter sites (text knowledge documents, memory rows, chat messages, product knowledge text entries) are replaced with a single exported `passesRelevanceFloor` helper.
- `passesRelevanceFloor` rules: `score <= 0` rejected; any candidate with at least one exact whole-token hit always passes (recall protection); single-token queries reject fuzzy/trigram-only candidates; multi-token queries pass fuzzy-only candidates only when `score >= 0.5 * topScore`. Scoring weights, ranking order, and `selectRankedCandidates` are untouched — only the final pass-through filter changes.
- Hard constraints respected: no change to `turn-routing.service.ts`, `project-execution-profile.ts`, `orchestrate-runtime-retrieval.service.ts`, or any public schema. No keyword-matching anywhere in routing.

### Verification

- Repo gates (`AGENTS.md`):
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- Focused tests:
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution-discovered-file-refs.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/project-execution-profile.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts`
- Full `corepack pnpm --filter @persai/api run test` and `corepack pnpm --filter @persai/runtime run test` suites
- Focused typecheck:
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm --filter @persai/api run typecheck`

### Residual risks

- Fix A is bounded to runtime turnState propagation. Live verification should confirm that on a real `files.search` → `files.send` flow the model picks the `found file #N` alias from Working Files instead of a `previous attachment #N` from history; the failure mode prior to this slice was sending a cat photo when the user asked for a logo.
- Fix C's relative-floor threshold (`0.5 * topScore` for multi-token fuzzy-only) is conservative on purpose. If live retrieval shows that some legitimate fuzzy-only multi-token recall is being dropped (rare; needs both no exact hits at all and a long tail of weak fuzzy candidates), the threshold is in a single helper and trivial to relax.
- No routing change was made (keyword precheck was explicitly rejected by founder). If a future slice wants to also stop the orchestrator from pre-loading knowledge for clearly file-handling intents, that decision will come from the LLM router itself, not from new keyword precheck branches.

### Next recommended step

- Live-test in `persai-dev`: ask the assistant to find a specific file by subject (no exact filename), then ask it to send the file — confirm the right file is delivered. Separately probe a single-token nonsense query against knowledge so the relevance floor visibly drops irrelevant documents from Retrieved Knowledge Context.

## 2026-05-24 — ADR-100 follow-up — LLM-authored async media replies for Web/TG

### What changed

- Telegram inbound uploads now enqueue the same canonical upload micro-description helper as web uploads after `InboundMediaService.resolve()` has persisted attachments and `AttachmentObjectAvailabilityService` has confirmed runtime readability. This covers both a single Telegram attachment and finalized Telegram albums with multiple files.
- The enqueue uses the existing `AssistantUploadMicroDescriptionJobService.enqueueIfNeeded()` policy: project chats always analyze, ordinary/B2C surfaces obey `routerPolicy.analyzeUploadsOnB2cUpload`, and duplicate/summarized canonical files are deduped by `assistantFileId`.
- Telegram enqueue is best-effort and logs a warning per attachment if queueing fails, so a temporary helper/DB issue does not break the user-facing Telegram turn after the file itself was accepted.
- Mini-audit of async Web/TG media completion found three concrete user-visible seams: runtime deferred media/document acknowledgements replaced valid model copy with canned text, media completion retries could reuse an existing acknowledgement message instead of fresh completion framing, and Telegram suppressed the separate final text whenever delivered media had any caption.
- Runtime now preserves non-empty LLM acknowledgement text for deferred media/document jobs and uses the localized canned acknowledgement only as an empty-text fallback.
- Media completion delivery now attempts fresh LLM completion framing even when a completion message id already exists, then updates that message with the fresh copy. If framing fails, delivery falls back to stored result/existing text rather than failing the artifact delivery.
- Telegram now skips a final text reply only when the media caption is the same text; a different LLM-authored final message is sent separately even when the media has already been delivered with a caption.
- The temporary document-delivery placeholder is now localized through the existing document-job locale inference path (`Готовлю документ...` for Russian requests, `Preparing your document...` for English/default requests).

### Verification

- Repo gate:
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`
- Focused tests:
  - `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/assistant-media-job-completion-delivery.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/telegram-bot.client.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/assistant-document-job-failure-copy.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/assistant-document-job-delivery.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts`
- Focused typecheck:
  - `corepack pnpm --filter @persai/runtime run typecheck`
  - `corepack pnpm --filter @persai/api run typecheck`

### Residual risks

- The runtime canned acknowledgement strings still intentionally exist as empty-output fallbacks. They should no longer replace valid model text, but live TG/Web verification should confirm the model produces non-empty ack copy for the typical media request path.
- Document delivery still has a temporary localized container message while the delivery state machine finalizes and updates the assistant message. It is not the final copy source.
- Telegram upload micro-description enqueue is intentionally best-effort. If queueing fails, the turn continues and logs a warning; live verification should check the job row appears for a representative Telegram single-file upload and a two-file album.

### Next recommended step

- Live-test one Telegram image generation/edit request, one Telegram uploaded image/file, one two-file Telegram album, and one web request after deploy. Confirm async media replies are model-authored, Telegram sends final text when it differs from the media caption, and upload micro-description jobs are created for Telegram attachments when policy allows them.

## 2026-05-24 — ADR-100 follow-up — files semantic-summary search + generated summary truth

### What changed

- Runtime Files now exposes `semanticSummaryHint` on model-visible `files` results and search matches canonical `AssistantFile.metadata.semanticSummary` in addition to name/path, while still hiding raw `fileRef` from the model-facing selector contract.
- Generated media/document outputs no longer depend on final user-facing assistant text to get a durable micro-description. Runtime now writes a bounded `generation_request` semantic summary directly onto canonical file metadata when the request itself is strong enough.
- API delivery now reuses the existing `assistant_upload_micro_description_jobs` helper lane as a fallback for generated files that still have no durable summary after delivery, so image/document outputs with weak/generic request wording can still be analyzed later against the canonical `fileRef`.
- Focused regressions cover the new pure summary-selection helper, runtime files search/model sanitization, media-delivery fallback enqueue, and the new `generation_request` source being treated as already summarized canonical truth.

### Verification

- Focused tests:
  - `corepack pnpm --filter @persai/runtime exec tsx test/generated-file-semantic-summary.test.ts`
  - `corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts`
  - `corepack pnpm --filter @persai/runtime exec tsx test/sanitize-tool-result-for-model.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/assistant-upload-micro-description-job.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts`
- Focused typecheck:
  - `corepack pnpm --filter @persai/runtime run typecheck`
  - `corepack pnpm --filter @persai/api run typecheck`

### Residual risks

- The direct `generation_request` path is intentionally conservative. Weak image/document requests fall back to background analysis only after delivery, so the very first completion turn may still land before the helper enriches canonical truth.
- The existing background helper still only understands the currently supported MIME set (not every generated media type equally well), so images/PDF/text-like outputs benefit most from fallback today. Audio/video still rely primarily on the direct bounded request-based summary.
- Full repo gates and affected web/api verification still need to be run before calling the slice fully clean.

### Next recommended step

- Run the required repo gates from `AGENTS.md`, then do one live sanity check where a generated image/document is later found through `files.search` by subject wording rather than filename.

## 2026-05-23 — ADR-100 live follow-up — OpenAI media false-abort hardening

### What changed

- Live provider investigation showed two different failure classes were being conflated in OpenAI media paths. `image_edit` uses a single synchronous provider request, so it does not have the same poll-status false-failure seam as video, but its prior `5 minute` local timeout was still too short for slower edits.
- `OpenAIProviderClient.editImage()` now uses a dedicated `7 minute` bounded timeout instead of sharing the shorter image-generate timeout.
- `pollOpenAIVideoJob()` no longer treats a single transient poll failure (`408`, `429`, or any `5xx`, including the observed `504`) as terminal. The poll loop now simply retries on the next interval and still preserves the existing overall request timeout plus terminal handling for explicit failed/cancelled provider statuses.
- Focused provider-gateway coverage now locks both truths: image-edit timeout resolution is `420_000 ms`, and a video job still completes successfully after one transient `504` status poll response.

### Verification

- Repo gate:
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`
- Focused provider checks:
  - `corepack pnpm --filter @persai/provider-gateway run typecheck`
  - `corepack pnpm --filter @persai/provider-gateway exec tsx --test test/openai-provider.client.test.ts test/provider-image-generation.service.test.ts test/provider-video-generation.service.test.ts`

### Residual risks

- This hardens the currently confirmed OpenAI false-abort seam for video polling and raises the local edit timeout, but live verification is still required to confirm the exact provider-side long-running `image_edit` and `video_generate` flows now finish cleanly after deploy.
- `image_edit` still does not have a polling seam by design; if edits continue to fail after roughly `7 minutes`, the next likely cause is a real upstream request timeout or provider error rather than the specific transient poll-status bug fixed here.

### Next recommended step

- Redeploy `provider-gateway`, then rerun one known slow `image_edit` and one known flaky `video_generate` case. Confirm the edit path no longer aborts around the old `5 minute` bound and confirm a transient upstream `504` during video status polling no longer fails the job if later polls recover.

## 2026-05-23 — ADR-100 live follow-up — remove project cadence abort and drop silent stall kills

### What changed

- Live `persai-dev` evidence after the previous watchdog slice showed the remaining project-turn cutoffs were no longer coming from `slow_avg`; they were now hitting the same API-side cadence watchdog through the separate `silent` path during long quiet follow-up/reasoning spans after initial visible progress.
- The fix is structural rather than another threshold tweak. `chatMode === "project"` is now completely removed from the API cadence-abort path, and ordinary web turns no longer let the `silent` timer kill the stream at all. Non-project web turns still keep `slow_avg` detection for obviously dribbling text streams, but truly silent waits now fall back to the lower-level runtime/provider request bounds instead of an API-side fake-stall abort.
- `cadence-watchdog` now supports explicitly disabling `silent` independently from `slow_avg`, and stream-option resolution now sets `project` to fully disable cadence abort while ordinary modes keep only `slow_avg`.

### Verification

- Focused API tests:
  - `corepack pnpm --filter @persai/api exec tsx test/cadence-watchdog.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- Focused typecheck:
  - `corepack pnpm --filter @persai/api run typecheck`

### Residual risks

- This deliberately removes one whole class of API-side false aborts instead of trying to re-tune another timeout, but live verification is still required to confirm the exact long project scenario now runs cleanly end to end after redeploy.
- Ordinary non-project web turns still keep `slow_avg` recovery. If a future regression appears there, it should now be a real `slow_avg` issue rather than a silent-gap false positive.

### Next recommended step

- Redeploy `api`, then rerun the exact project prompt that was visibly cutting off after initial progress lines. Confirm there is no `web_stream_stall_detected ... reason=silent` for that turn and that the assistant reaches a normal final answer without an abrupt mid-turn pause/cutoff.

## 2026-05-23 — ADR-100 live follow-up — upload micro-description binary limit raised

### What changed

- Live code review on ordinary web-chat uploads showed the cheap background upload micro-description helper was still capping binary files too aggressively at `2 MB`, which is too small for realistic PNG/PDF inputs.
- `AssistantUploadMicroDescriptionService` now raises `UPLOAD_MICRO_DESCRIPTION_MAX_BINARY_BYTES` from `2 * 1024 * 1024` to `4 * 1024 * 1024`, keeping the same bounded helper path and MIME allowlist while allowing moderately larger image/PDF uploads to reach the helper instead of being silently dropped before provider invocation.
- Added a focused regression test that asserts `image/png` at exactly `4 MB` is still accepted for helper input construction while `4 MB + 1 byte` is still rejected.

### Verification

- Focused API tests:
  - `corepack pnpm --filter @persai/api exec tsx test/assistant-upload-micro-description.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/assistant-upload-micro-description-job.service.test.ts`
- Focused typecheck:
  - `corepack pnpm --filter @persai/api run typecheck`

### Residual risks

- The founder reported at least one PNG around `1.6 MB` still not triggering visible description behavior, so the `2 MB` cutoff was definitely too strict but may not be the only live failure path. If the issue reproduces after this limit increase, the next honest target is the post-enqueue helper/result path rather than the binary-size gate itself.

### Next recommended step

- Redeploy `api`, then recheck the same ordinary web-chat PNG flow with `analyzeUploadsOnB2cUpload` enabled. If it still fails for sub-`4 MB` PNGs, inspect whether the job is being enqueued and completed with `generated === null` rather than being rejected by the size gate.

## 2026-05-23 — ADR-100 live follow-up — project slow-mo guard + progress line breaks

### What changed

- Live investigation showed the remaining project-chat cutoff risk had moved from the earlier pre-start/header seam to the mid-stream `slow_avg` cadence watchdog path. Long project turns can legitimately dribble text while the model is iterating through retrieval/tool/replan work, so treating project turns like ordinary steady text streaming was still too aggressive.
- `StreamWebChatTurnService` now resolves cadence options per chat mode and disables only the `slow_avg` recovery path for `chatMode === "project"`. The existing silent watchdog, runtime/provider timeouts, and ordinary non-project slow-stream protection remain intact.
- `cadence-watchdog` now supports explicitly disabling `slow_avg` without disabling the silent timer, and focused API regressions cover both the raw watchdog option and the project-mode stream selection path.
- Web assistant markdown paragraphs now render with `whitespace-pre-wrap`, so single line breaks from project progress/thought output (`· ...`) stay on separate lines instead of collapsing into one paragraph.

### Verification

- Focused API tests:
  - `corepack pnpm --filter @persai/api exec tsx test/cadence-watchdog.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- Focused web tests:
  - `corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-message-blocks.test.tsx app/app/_components/chat-message.test.tsx --config vitest.config.ts`
- Repo gate:
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`

### Residual risks

- This removes the currently confirmed `slow_avg` false-positive recovery path for project turns, but live verification is still required to confirm the exact long project scenario no longer hits any other detach/abort path after deploy.
- Project turns still retain the silent watchdog and upstream runtime/provider timeouts by design, so a truly silent hung stream should still fail rather than run forever.
- `whitespace-pre-wrap` intentionally preserves single newlines in assistant paragraph text. That is the desired behavior for project progress lines, but live UI verification should still confirm it looks acceptable on ordinary multiline answers too.

### Next recommended step

- Redeploy `api` and `web`, then rerun the exact long project turn that previously cut off under slow-mo/stall conditions. Confirm together that the turn now reaches a final answer, project progress lines render on separate lines in web chat, and the UI no longer looks like it abruptly stopped during the project loop.

## 2026-05-23 — ADR-100 live follow-up — pre-start stream abort hardening

### What changed

- The web chat stream path had one more real hard-abort seam beyond the already fixed cadence-watchdog issue: `AssistantController.streamWebChatTurn()` still waited for `streamWebChatTurnService.prepare()` before opening SSE headers, while the web client still treated `2xx headers arrived` as both transport-open and request-accepted truth.
- That old coupling meant a heavy pre-start path (for example attachment/document-heavy preparation before the first runtime/tool chunk) could spend too long before the first headers, trip the client-side pre-header timeout, and look exactly like a user-stop / abrupt stream abort even though the runtime had not yet started the normal streamed turn.
- The server now opens the SSE response immediately, sends an early keepalive comment, and only then awaits `prepare()`. If `prepare()` fails, the endpoint now emits a terminal SSE `failed` event instead of relying on a late non-stream HTTP failure.
- On the client side, `useChat` no longer treats `onHeadersOk` as "turn accepted". Pending-send cleanup now happens only once the stream reaches a real accepted phase (`started`) or a terminal event, and an early `failed` before `started` is treated as a non-accepted turn: the optimistic bubbles are removed and the issue is surfaced instead of leaving the turn in a misleading partial/stop-like state.

### Verification

- Focused web tests:
  - `corepack pnpm --filter @persai/web exec vitest run app/app/_components/use-chat.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts`
- Repo gate:
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`

### Residual risks

- This removes the known "heavy pre-start prepare never opened headers in time" failure class, but live verification is still required to confirm the specific PDF/document scenario is truly the same path and not a later provider-side stall after `started`.
- The client-side `HEADERS_TIMEOUT_MS` watchdog still exists by design for truly dead requests; the fix here is that valid long pre-start preparation should now reach the client as an open SSE stream instead of being indistinguishable from a dead request.

### Next recommended step

- Redeploy `api` and `web`, then rerun the exact long project turn that was dying around PDF assembly before the first normal streamed answer/tool output. Confirm three things together: the stream opens immediately, the turn no longer dies around the old ~8-10 second pre-start window, and any genuine pre-start failure now lands as a surfaced terminal issue instead of a fake stop-like abort.

## 2026-05-23 — ADR-100 project files sidebar follow-up — upload + delete actions

### What changed

- `ProjectFilesPanel` is no longer read-only for active project chats: the sidebar now exposes a compact `+` action to upload files directly into the current project chat and a per-row trash action to remove a canonical file globally through the existing assistant-file delete path.
- Sidebar uploads are intentionally bounded: the client rejects batches larger than 3 files, reuses the existing web attachment staging path, and leaves the earlier soft help/info affordance out of scope for now.
- Project files now refresh more reliably after upload/delete work. The panel listens for a small client-side `project-files-changed` event keyed by `chatId`, and the normal chat upload flow now dispatches that event after staged attachments succeed so the left sidebar can refresh without waiting for a full navigation/reload.
- Localized sidebar copy now covers the new project-file action/error states (`add`, upload-limit, upload-failed, delete-failed).

### Verification

- Focused web tests:
  - `corepack pnpm --filter @persai/web exec vitest run --config vitest.config.ts app/app/_components/sidebar.test.tsx app/app/_components/use-chat.test.tsx`
- Repo gate:
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`

### Residual risks

- Sidebar upload intentionally reuses the existing staged web-attachment path rather than a new dedicated project-file ingest endpoint. That keeps the slice small and consistent with current chat/file truth, but live verification is still needed to confirm the resulting chat-history UX is acceptable on mobile and desktop.
- The requested soft help/info affordance for delete remains intentionally deferred.

### Next recommended step

- Redeploy `web`, then live-verify one active project chat end to end: upload 1-3 files from the sidebar, confirm the file list refreshes immediately, confirm the same canonical files can still be added through the ordinary composer upload path and appear in the sidebar, and confirm the trash action removes the file globally while the existing micro-description/background analysis path still runs for newly uploaded project files.

## 2026-05-23 — ADR-100 live follow-up — follow-up pass abort + project-status localization

### What changed

- Live verification exposed a real project-turn failure mode after the earlier orchestrator work: synthetic retrieval/project status events were still feeding the API-side cadence watchdog, so a healthy long follow-up provider pass could be misclassified as stalled and aborted before headers on the next tool-loop iteration.
- `StreamWebChatTurnService` no longer treats retrieval/project status markers as cadence-resetting runtime activity for stall detection. Real text/thinking/tool/media/done traffic still counts, but pre-answer progress banners no longer arm the watchdog and accidentally cut a healthy next pass.
- Web activity rendering now localizes the fixed runtime-authored project-summary/status copy instead of showing those canned English strings raw in Russian UI. Known project summary labels and their fixed detail lines now resolve through `ActivityBadge` translation keys.
- Project-mode developer instructions now also constrain the model's visible progress formatting more tightly: one short update per line, no `Status 2/6`-style numbering, and no multi-sentence narrated progress paragraphs when a lightweight `·` marker is enough.

### Verification

- Focused web tests:
  - `corepack pnpm --filter @persai/web test -- app/app/_components/activity-badge.test.tsx app/app/_components/use-chat.test.tsx`
- Focused API tests:
  - `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
- Focused runtime tests:
  - `corepack pnpm --filter @persai/runtime exec tsx test/project-execution-profile.test.ts`
  - `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- Focused typecheck:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`
  - `corepack pnpm --filter @persai/runtime run typecheck`

### Residual risks

- This closes the known false-positive stall path for synthetic retrieval/project events, but live `persai-dev` verification is still required to confirm that no other client-side detach/stop path is aborting long turns.
- Only fixed runtime-authored project summaries/details are localized here. Model-authored free-text reasoning summaries can still appear in whatever language the model emits unless the prompt/locale path constrains them.
- The new progress-format instruction should reduce noisy narrated step logs, but live behavior still depends on how strongly the active model follows that presentation guidance in long-turn answers.

### Next recommended step

- Redeploy `api` and `web` to `persai-dev`, then rerun the exact long project prompt that previously stopped after `web_search` / follow-up planning. Confirm three things together: the next provider pass is no longer aborted, the assistant reaches a real final answer instead of a partial cutoff, and fixed project-status badges stay localized in Russian while tool activity still remains visible.

## 2026-05-22 — ADR-100 post-6H follow-up — source progression + activity prioritization

## 2026-05-22 — ADR-100 post-6H follow-up — source progression + activity prioritization

### What changed

- Tightened the bounded ADR-100 follow-up around the existing orchestrator instead of adding a new routing tree.
- Project-mode precheck now always allows web participation when the tool exists, so the model can escalate from local context to external verification inside the same bounded tool loop instead of being pre-narrowed away from web on knowledge-heavy turns.
- Runtime project stream cadence is now less noisy before the first answer text: the old burst of early `plan/gather/analyze` status events was collapsed into fewer, more meaningful checkpoints.
- Tool-loop follow-up now adds a dynamic `Source progression` developer block: if the model already checked local/project context and the answer is still not direct, it is explicitly told to continue to the next missing source; if it already pulled external context, it is told to compare that back against local files/Skills before finalizing.
- Web chat now prioritizes concrete live tool/retrieval work over generic project banners, preserves project `summary` / `detail` text, and no longer lets later project-summary events overwrite an in-flight tool badge.
- ADR-100 now records the intended steady-state truth more honestly: model-owned sufficiency checks, source progression inside the existing tool loop, and live activity priority that favors real work over generic stage labels.

### Verification

- Focused runtime tests:
  - `corepack pnpm --filter @persai/runtime exec tsx test/project-execution-profile.test.ts`
  - `corepack pnpm --filter @persai/runtime exec tsx test/project-stream-events.test.ts`
  - `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- Focused web tests:
  - `corepack pnpm --filter @persai/web exec vitest run app/app/_components/use-chat.test.tsx app/app/_components/activity-badge.test.tsx --config vitest.config.ts`
- Repo gate:
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`

### Residual risks

- This is still an orchestrator/prompt/UI follow-up, not a fully deterministic source arbiter; live quality still needs verification on real project prompts.
- Project activity remains session-ephemeral on the client side; no DB persistence was added.
- Current-thread chat is still not a separate first-class orchestrated retrieval source; the earlier explicit-recall boundary remains unchanged.

### Next recommended step

- Redeploy the touched runtime/web surfaces to `persai-dev`, then run live project smoke focused on three truths: early project banners are no longer the dominant visible status, real tool/retrieval work stays visible while it runs, and the model actually progresses from local context to external verification when the first evidence is partial or off-target. Do not start the hidden B2B cluster plan until that live behavior is verified end to end.

## 2026-05-22 — ADR-100 Slice 6H live follow-up — retrieval helper pruning fix

### What changed

- Live `persai-dev` verification against the already deployed `api/runtime:27541a81` exposed a real post-6H retrieval bug on project/domain queries: the hidden retrieval helper could correctly return `rankedReferenceIds: []` or a strict subset, but API treated that output as reorder-only semantics instead of an allowlist.
- `KnowledgeRetrievalHelperService.rerankCandidates()` now returns a real ranking result even when the helper keeps zero references, so an explicit empty allowlist is no longer collapsed into `null`.
- `ReadAssistantKnowledgeService` now treats helper output as an allowlist for both assistant-document and global/product-plan search paths: references omitted by the helper are dropped instead of merely pushed lower in the sort order.
- `OrchestrateRuntimeRetrievalService` now applies the same allowlist pruning for the active-skill helper path before later project/user/product staging, so helper-pruned skill references do not survive as fallback noise.
- Focused regressions now lock the real failure mode: helper subset keeps only that subset, and helper empty result removes all helper-ranked candidates instead of leaking product/plan junk through.

### Verification

- Live cluster audit:
  - `kubectl get pods -n persai-dev`
  - `kubectl get deploy api runtime -n persai-dev -o jsonpath=...`
  - confirmed live pods were running `27541a81`
  - inspected live request/log evidence plus deployed code path for helper prompt and post-processing
- Focused tests:
  - `corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts`
- Repo gate:
  - `corepack pnpm -r --if-present run lint`
  - `corepack pnpm run format:check`
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/web run typecheck`

### Residual risks

- `persai-dev` is still running the old `27541a81` image until `api` is redeployed with this fix.
- This fix closes helper-pruning semantics only; it does not redesign source admission or add richer live retrieval diagnostics to logs.
- Current-thread chat still is not a separate first-class orchestrated source; current truth only blocks broad assistant-wide recall leakage unless recall intent is explicit.

### Next recommended step

- Redeploy `api` to `persai-dev`, then rerun the live project/domain query that previously surfaced `product-text-entry` and `global:plan:*` noise. Confirm that helper-empty or helper-subset outcomes now prune those candidates completely instead of merely reordering them.

## 2026-05-22 — ADR-100 doc reconciliation after Slice 6H

### What changed

- Reconciled `docs/ADR/100-project-chat-mode-and-b2b-analysis-profile.md` with current repo truth after the already landed Slice 6H closeout.
- Removed stale workflow wording such as `working tree` / slice-local parent-subagent scaffolding where it no longer helped continuation.
- Compressed the implementation ledger so ADR-100 now reads as a clean continuation document rather than an accumulated session prompt.
- Clarified the steady-state boundary between `normal | smart | project`, Skills as the domain layer, Product KB/subscription facts, explicit cross-thread recall, and project files on existing `AssistantFile` / `fileRef` truth.
- Kept the honest next step unchanged: deploy prep + live project verification before any hidden B2B cluster-plan work.
- No runtime/API/web behavior changed in this session.

### Verification

- Read-only reconciliation against `AGENTS.md`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, `docs/ADR/078-consolidated-follow-through-program.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, and current `docs/ADR/100-project-chat-mode-and-b2b-analysis-profile.md`
- Repo/code spot-checks for landed ADR-100 Slice 6 facts via current branch + source search (`gatherProfile`, `project_file`, `analyzeUploadsOnB2cUpload`, `upload_micro_description`, `semanticSummarySource`, `precheckRuleOverrides`)

### Residual risks

- This session was doc-only; deploy/materialization truth for project retrieval quality is still unverified in the target environment.
- `pinnedSkillId` remains deferred and must stay separate from ordinary skill activation if added later.
- Current-thread chat is still not a separate first-class orchestrated source; current truth only blocks broad assistant-wide recall leakage unless recall intent is explicit.

### Next recommended step

- Run **deploy prep + live project verification**: validate source admission, project-file gather priority, lazy extraction cache, and upload micro-description jobs in the target environment. Do not create the hidden B2B cluster plan until live project retrieval quality is confirmed end to end.

## 2026-05-22 — ADR-100 Slice 6H — retrieval source admission closeout

### What changed

- Closed the live retrieval-quality finding where irrelevant Product KB, subscription/tariff facts, old chats, and memory could be stuffed into ordinary/smart/project prompts.
- Runtime source admission now distinguishes generic retrieval from product intent. Product KB is still available for PersAI/product/pricing/subscription questions, but generic external/domain/project questions no longer get Product KB just because retrieval is active.
- Project-mode precheck follows the same Product KB intent gate.
- Generic `plan` / `план` no longer triggers product intent by itself.
- Non-empty Admin Runtime `routerPolicy.precheckRuleOverrides` trigger lists are now authoritative: filled lists replace built-in defaults instead of merging with them. Empty lists still fall back to defaults.
- Explicit recall intent is marked in the runtime retrieval plan reason code, and API orchestration searches assistant-wide `memory` / `chat` only when that recall marker is present.
- Ordinary user documents remain searchable without pulling cross-thread memory/chat by default.
- Runtime hydration now ranks `project_file` retrieved items above ordinary user documents and Product KB.
- Admin Runtime helper copy now explains the override semantics.

### Verification

- `corepack pnpm --filter @persai/runtime exec tsx test/turn-routing.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/project-execution-profile.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts`
- `corepack pnpm --filter @persai/web exec vitest run app/admin/runtime/page.test.tsx --config vitest.config.ts`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Residual risks

- Current-thread chat context is not yet a separate first-class orchestrated source; this slice only stops broad assistant-wide `chat` / `memory` leakage unless explicit recall intent is present.
- Product/subscription facts are still bundled under existing Product KB retrieval when product intent is present; a later split into separate fact classes remains optional.
- Live environment still needs verification after deploy/materialization before Slice 7.

### Next recommended step

- Run **deploy prep + live project verification**: validate source admission, project-file gather priority, lazy extraction cache, and upload micro-description jobs in the target environment. Do not create the hidden B2B cluster plan until live project retrieval quality is confirmed end to end.

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
