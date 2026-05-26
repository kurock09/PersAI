# ADR-101: Multi-assistant workspace model

## Status

Accepted for execution. In progress.

Implementation progress:

- Slice 1 (`Schema unlock and plan assistant limit`) implemented on 2026-05-26.
- Slice 2 (`Active assistant resolution service`) implemented on 2026-05-26.
- Slice 3 (`API lifecycle and bootstrap contracts`) implemented on 2026-05-26.
- Slice 4 (`Chat and runtime entry points`) implemented on 2026-05-26.
- Slice 5 (`Assistant-scoped surfaces`) implemented on 2026-05-26.
- Slice 6 (`Web shell and switcher`) implemented on 2026-05-26.
- Slice 7 (`Live validation and rollout checkpoint`) is in progress on 2026-05-26; live remediation keeps `findByUserId` unchanged and hardens the API image/start path after `persai-dev` proved the setup-preview source was fixed but stale compiled `dist` still called `findByUserId`. API image publishes now bypass Docker cache, rebuild `apps/api/dist` in one layer, and assert the compiled preview service at build and startup.
- Ops admin display support implemented on 2026-05-26: Admin Ops directory now shows compact assistant count for multi-assistant rows, cockpit accepts optional `assistantId`, returns a compact assistant selector list, and scopes assistant-owned cockpit blocks/Plan Control to the selected assistant while keeping billing/subscription support workspace-level.
- Slice 8 active product/admin hot-path cleanup implemented on 2026-05-26: plan visibility, payment intents, media package checkout, Admin Plan Control, Admin workspace subscription, and Ops billing support now resolve active assistant/workspace context instead of `findByUserId`; a source guard prevents new active-source callers. `findByUserId` remains only as an honest legacy repository/interface method for now.

## Date

2026-05-26

## Relates to

ADR-024, ADR-079, ADR-080, ADR-081, ADR-083, ADR-087, ADR-088, ADR-091, ADR-097, ADR-100

## Context

PersAI currently behaves as a one-human, one-workspace, one-assistant product. That model is now too small for the product direction. The next platform foundation must support:

```text
1 user = 1 workspace = N assistants
```

This ADR intentionally does not add AI employee roles, role templates, work queues, departments, outstaffing workflows, or role-specific operating models. Those are later product layers. The bounded target here is only the clean platform capability: one user in one workspace can own and switch between multiple assistants, and all assistant-specific state follows the selected assistant.

The founder decision is explicit:

1. Build the universal multi-assistant workspace foundation now.
2. Keep tariff/plan limits as the only availability gate.
3. For B2C plans, set the assistant limit to `1`.
4. For B2B plans, set the assistant limit to `>1`.
5. Do not add extra sales/UI complexity for "buy another assistant" in this slice.
6. Do not leave legacy single-assistant logic as target-state code.

The audit found that runtime execution and most child data are already assistant-id-shaped, but the product shell, root ownership model, and API resolution path still encode a single assistant per user.

## Current Code Audit Summary

### Root Data Model

Current hard blockers:

- `Assistant.userId @unique` prevents one user from owning multiple assistants.
- `Assistant @@unique([workspaceId, userId])` prevents one workspace member from owning multiple assistants in the same workspace.
- `AppUser.assistant Assistant?` is modeled as one-to-one.
- `WorkspaceMember.assistant Assistant?` is modeled as one-to-one.
- Prisma repository methods rely on unique lookup by `userId`, especially `findByUserId`.

Current useful shape:

- Most durable child tables already carry `assistantId`.
- Workspace-level billing/subscription/quota state is already separate from assistant-owned runtime/chat/file/memory state.
- Composite assistant/user foreign keys generally remain compatible if `assistantId` is the real selector.

Conclusion: the root `Assistant` ownership model must be unlocked first. The child data plane does not need a wholesale redesign.

### API And Application Services

Current hard blockers:

- Assistant lifecycle, chat, memory, tasks, knowledge, skills, files, Telegram settings, notification preference, and bootstrap paths frequently infer "the assistant" from authenticated `userId`.
- `CreateAssistantService` rejects or prevents second-assistant creation by design.
- `GetAssistantAppBootstrapService` builds one singular assistant shell.
- `ManageWebChatListService`, web turn preparation, stream/send services, runtime context resolution, and settings routes use implicit user-to-assistant resolution.

Current useful shape:

- Runtime-bound requests already become `AssistantScope` once a concrete assistant is known.
- Internal runtime context can resolve by explicit `assistantId` in several places.
- Web chat turn attempts are already keyed by assistant/user/thread/client turn once the assistant is known.

Conclusion: API must introduce one central active-assistant resolution boundary and then remove `findByUserId` from hot product paths.

### Web Product Shell

Current hard blockers:

- Bootstrap data carries a singular `assistant`.
- `useAppData` and sidebar state assume one assistant.
- The assistant card is not a selector.
- Settings panels edit the only assistant.
- Chat route/state keys are mostly thread-key-oriented; local draft and streaming registries are not consistently namespaced by `assistantId`.

Current useful shape:

- The sidebar already has a natural assistant-card location for selection.
- Settings already edit assistant-owned state and can be pointed at the active assistant.
- Chat state already has enough internal structure to add `assistantId` to keys and API calls.

Conclusion: web needs a real active assistant context: `assistants[]`, `activeAssistantId`, switch action, and assistant-id namespacing for chat/session/local state.

### Runtime, Sandbox, Provider Gateway

Current blockers:

- Runtime correctness still depends on API and web selecting the correct assistant before the turn enters runtime.
- Some notification or dedupe keys need review so assistant-specific events do not suppress another assistant in the same workspace.

Current useful shape:

- `AssistantScope` already carries `assistantId` and `workspaceId`.
- Runtime Redis/session/conversation keyspace is assistant-scoped.
- Files, memory hydration, background tasks, media/document jobs, and sandbox materialization are mostly assistant-scoped.
- Provider-gateway has no user/assistant ownership model and should not need product changes.

Conclusion: this is not a runtime rewrite. Runtime mostly needs focused isolation regression tests and any missed dedupe/key cleanup.

## Decision

PersAI will make `Workspace` the user's stable product container and `Assistant` a plural workspace child selected by active assistant context.

Target ownership:

```text
AppUser
  owns/joins one active Workspace for the current product path

Workspace
  owns billing, subscription, plan, quota pool, workspace settings, members
  owns many Assistants

WorkspaceMember
  belongs to one AppUser + Workspace
  stores activeAssistantId for that user's current selection in that workspace

Assistant
  belongs to one Workspace
  has a creator/owner user id for audit and authorization
  owns persona, chats, files, memory, tasks, skills, KB, integrations, runtime bundle
```

Target API rule:

```text
No assistant-scoped route may mutate assistant-owned state by resolving only userId.
```

Assistant-scoped API work must resolve through one of:

1. explicit `assistantId` validated against the authenticated user's workspace membership
2. the member's `activeAssistantId`
3. a bootstrap/setup fallback only when the workspace has exactly one assistant

Target web rule:

```text
The app shell receives assistants[] + activeAssistantId, not one assistant as global truth.
```

Target plan rule:

```text
Plan/catalog truth owns max assistant count.
B2C plans set maxAssistants = 1.
B2B plans set maxAssistants > 1.
```

This limit is enforced on assistant creation and exposed only where needed for normal disabled-state/error copy. It does not create a new tariff UI, add-on store, per-assistant billing entity, or role-based product surface in this ADR.

## Product Boundary

### Changes When Active Assistant Switches

The selected assistant controls:

- assistant name, avatar, persona, archetype, instructions, published/draft runtime bundle
- chats, messages, active streams, compaction/session state
- files and file refs
- assistant-private knowledge sources
- enabled Skills and skill assignment state
- memory registry
- user reminders and assistant background tasks
- generated media/document jobs
- Telegram binding/config if the binding belongs to the assistant
- assistant notification preference if currently modeled assistant-side
- runtime/sandbox workspace state

### Stays Workspace-Level

The workspace controls:

- subscription, billing lifecycle, payment intents, provider customer references
- plan code and plan-derived limits
- shared quota pool unless a later ADR explicitly introduces per-assistant quota
- workspace storage quota pool
- workspace members and admin roles
- compliance acceptance and user identity profile
- workspace-level notification channel availability
- admin/operator state

### Deferred

These are explicitly out of scope:

- AI employee role entity
- role templates
- department/team structure
- work queues
- autonomous job assignment between assistants
- per-assistant billing or per-assistant plan purchase
- marketplace or UI for buying assistant seats
- company profile model beyond existing workspace/assistant knowledge settings

## Data Model Target

### Required Prisma Changes

1. Remove `@unique` from `Assistant.userId`.
2. Remove `@@unique([workspaceId, userId])` from `Assistant`.
3. Add non-unique indexes for common reads:
   - `@@index([userId])`
   - `@@index([workspaceId])`
   - `@@index([workspaceId, userId])`
4. Change one-to-one relations:
   - `AppUser.assistant Assistant?` becomes `AppUser.assistants Assistant[]`.
   - `WorkspaceMember.assistant Assistant?` becomes `WorkspaceMember.assistants Assistant[]` or drops the direct relation if the relation is redundant.
5. Add `WorkspaceMember.activeAssistantId String?`.
6. Add a foreign-key constraint that ensures `activeAssistantId` points to an assistant in the same workspace where practical. If Prisma cannot express the exact composite constraint cleanly, enforce it in the service layer and with focused tests.
7. Add plan-owned assistant limit truth, preferably under the existing plan metadata/entitlement boundary as `assistantPolicy.maxAssistants`.

### Existing Data Migration

Current production-like data should already have at most one assistant per `(workspaceId, userId)`. The migration must:

1. Preserve every existing assistant id.
2. Backfill each `WorkspaceMember.activeAssistantId` to the existing assistant for that workspace/member.
3. Backfill plan assistant limits:
   - current B2C/default plans: `maxAssistants = 1`
   - hidden or B2B operator plans: explicit configured `maxAssistants > 1` when the founder/admin sets it
4. Add read-side fallback only during implementation if needed, but no fallback may remain as accepted target-state code.

## API Target

### New Central Resolution Boundary

Add `ResolveActiveAssistantService`.

Inputs:

- authenticated `userId`
- optional explicit `assistantId`
- optional workspace context when a route has it
- route purpose/read-or-write hint only if needed for error shaping

Responsibilities:

1. Load the user's workspace membership.
2. Validate explicit `assistantId` belongs to the same workspace and is accessible to the user.
3. If no explicit id is provided, use `WorkspaceMember.activeAssistantId`.
4. If active pointer is missing and exactly one assistant exists, set/use that assistant.
5. If active pointer is missing and multiple assistants exist, return a product-shaped "active assistant required" error.
6. Return a normalized context:

```text
{
  userId,
  workspaceId,
  workspaceMemberId,
  assistantId,
  assistant,
  plan,
  assistantLimit
}
```

Rules:

- Do not let routes directly call `findByUserId` for assistant-owned state.
- Do not silently pick the newest or first assistant when multiple assistants exist.
- Do not resolve billing/subscription through assistant ownership when workspace membership is the real source.

### New/Changed Public API Shape

Bootstrap:

- `GET /api/v1/app/bootstrap`
- returns `assistants[]`
- returns `activeAssistantId`
- returns active assistant detail as a derived convenience only if useful
- keeps workspace/billing/plan state workspace-scoped

Assistant list/create/switch:

- list assistants for current workspace
- create assistant if plan limit allows
- switch active assistant by writing `WorkspaceMember.activeAssistantId`
- update/delete assistant by explicit assistant id or active assistant context

Assistant-scoped existing APIs:

- chat list/send/stream/reattach/status/stop
- memory center
- tasks/background actions
- skills assignment
- assistant KB/files
- avatar/persona/settings/publish/materialization
- Telegram connect/revoke/settings
- assistant notification preference

These routes must either accept explicit `assistantId` or consistently use the active assistant context. For web app default UX, active assistant context is acceptable. Internal/runtime routes should keep explicit assistant ids.

### Repository Cleanup

Target repository shape:

- keep `findById` and workspace/member-aware list methods
- add `listByWorkspaceMember`
- add `findAccessibleById`
- add `findDefaultForMemberOnlyIfSingle` only inside the active-resolution service if needed
- remove or quarantine `findByUserId`

Acceptance rule:

```text
No production hot path may call AssistantRepository.findByUserId after the cleanup slice.
```

If an implementation slice needs a short-lived bridge to keep typecheck green while API routes are being migrated, the bridge must:

- be named as temporary
- be covered by a deletion checklist
- not be accepted as final ADR completion
- be removed in the final cleanup slice

## Web Target

### Bootstrap And App State

`AppBootstrapInitialData` and `useAppData` become multi-assistant:

```text
assistants: AssistantSummary[]
activeAssistantId: string
activeAssistant: AssistantSummary | null
assistantLimit: {
  maxAssistants: number
  usedAssistants: number
}
```

The app shell must derive active assistant from `activeAssistantId`, not from array position.

### Assistant Switcher

Implemented Slice 6 product shape:

- for B2C `maxAssistants = 1`, the ordinary single-assistant UI stays visually unchanged
- the sidebar assistant card remains the settings entry point; it is not promoted into a noisy always-visible switcher
- the sidebar card adds only a quiet 3px premium gradient accent when `assistantLimit.maxAssistants > 1`
- assistant switching lives inside the assistant settings character section behind a quiet `Switch assistant` / `Сменить ассистента` button
- the switch modal lists assistants with avatar/name, keeps specialty as a future placeholder, and offers `Select` for switching
- the create-assistant CTA appears only while slots remain; when the limit is reached, the full-state remains calm and relies on the existing backend plan truth instead of sales-style upsell UI
- settings always edit the current active assistant

### State Isolation

All assistant-owned client state must include `assistantId` in its key:

- draft chat thread storage
- active stream registry
- pending send state
- optimistic message state
- local file staging state where applicable
- settings panel caches

Minimum key shape:

```text
persai.<feature>.vN.<assistantId>.<thread-or-client-key>
```

Switching assistant must:

- stop rendering stale active stream state from previous assistant
- refresh chat list and active settings for the new assistant
- preserve workspace-level billing/plan/admin state
- avoid leaking previous assistant's files/memory/chats into the active assistant panels

## Runtime And Integration Target

Runtime target state stays `AssistantScope`-first:

- no new workspace-owned runtime session model
- no provider-gateway ownership changes
- no sandbox workspace state shared across assistants unless explicitly keyed by assistant/workspace and validated

Required cleanup/review points:

1. Confirm runtime state keyspace includes assistant id for sessions, conversations, compaction, file registries, tool state, background runs, and media/document jobs.
2. Confirm assistant-specific notification dedupe keys include assistant id when two assistants can create the same notification source in one workspace.
3. Confirm Telegram UI connect/revoke targets selected assistant; webhook execution remains explicit assistant id.
4. Confirm file refs from assistant A cannot be resolved by assistant B.
5. Confirm memory hydration/writes for assistant A are absent from assistant B.

## Implementation Program

This ADR must be executed as a director-led program with bounded subagent slices. Each slice must leave the repo typechecking and must not hide broken migration work behind permanent legacy fallbacks.

### Slice 1: Schema Unlock

Goal:

- remove single-assistant uniqueness from Prisma
- pluralize relations
- add `WorkspaceMember.activeAssistantId`
- add indexes and migration/backfill
- add plan-owned `assistantPolicy.maxAssistants`

Required tests:

- one user can have two assistants in the same workspace
- active assistant pointer backfills for existing data
- invalid active assistant from another workspace is rejected
- default B2C plan limit is one assistant

High risk:

- old code using `findUnique({ userId })` will fail or pick incorrectly once uniqueness is gone.

Acceptance:

- generated Prisma client updated
- schema and migration are clean
- old one-to-one relation names no longer exist

### Slice 2: Active Assistant Resolution Service

Goal:

- add `ResolveActiveAssistantService`
- centralize membership/assistant validation
- add active assistant switch service
- add assistant limit enforcement service for creation

Required tests:

- explicit assistant id wins after validation
- active pointer is used when no explicit id is passed
- single-assistant fallback works only when exactly one assistant exists
- multiple assistants without active pointer fails honestly
- create assistant is denied when plan limit is reached

Acceptance:

- no route invents its own active assistant rules
- billing/workspace reads do not depend on assistant lookup

### Slice 3: API Lifecycle And Bootstrap

Goal:

- migrate assistant lifecycle routes
- migrate `GET /api/v1/app/bootstrap`
- return `assistants[]`, `activeAssistantId`, active assistant data, and assistant-limit state
- add list/create/switch API contracts

Required tests:

- bootstrap with one assistant is backward-safe for current product behavior
- bootstrap with two assistants returns both and marks the active one
- switching active assistant changes subsequent active-scoped assistant reads
- create assistant respects plan limit

Acceptance:

- bootstrap no longer treats one assistant as global app truth
- contracts are regenerated

### Slice 4: Chat And Runtime Entry Points

Goal:

- migrate web chat list/send/stream/reattach/status/stop to active/explicit assistant context
- ensure runtime requests carry the selected assistant id
- namespace turn attempt and stream recovery by assistant id where needed

Required tests:

- assistant A and assistant B can each have a chat with the same surface/thread key without collision
- sending under assistant B uses B runtime bundle/persona/files/memory
- reattach/status for A cannot observe B's active turn
- hard stop targets the selected assistant's turn only

Acceptance:

- wrong-assistant turn delivery is structurally prevented

### Slice 5: Assistant-Scoped Surfaces

Goal:

- migrate memory, tasks/background actions, skills assignment, assistant KB, files, avatar/persona/settings, publish/materialization, Telegram connect/revoke, notification preference

Required tests:

- memory write under A is not visible under B
- skill assignment under A does not mutate B
- fileRef from A is not resolvable under B
- Telegram UI binds/revokes the selected assistant
- assistant notification preference/dedupe does not suppress another assistant

Acceptance:

- every assistant-owned settings panel follows active assistant context

### Slice 6: Web Shell And Switcher

Goal:

- update `useAppData`
- land the quiet web-shell switcher UX without changing the single-assistant shell
- add create/switch UX with plan-limit disabled state
- update settings panels to active assistant
- namespace local/session state by assistant id

Required tests:

- B2C one-assistant plan does not show noisy extra UI
- B2B/multi-assistant plan can create/switch assistants
- switching assistant refreshes chats/settings/files
- draft/stream state from assistant A does not render under B
- workspace billing/plan state does not change on switch

Acceptance:

- user can operate multiple assistants without stale UI leakage
- landed UX keeps the sidebar card as the settings affordance and moves assistant switching into Assistant Settings rather than turning the sidebar card into a permanent selector

### Slice 7: Runtime/Integration Isolation Audit

Goal:

- add focused runtime/API integration regressions proving assistant isolation
- fix any missed keyspace/dedupe/integration issue

Required tests:

- runtime session/conversation keys include assistant id
- file registry lookup is assistant-scoped
- memory hydration is assistant-scoped
- background tasks/media/document jobs remain assistant-scoped
- notification dedupe includes assistant id for assistant-specific intents

Acceptance:

- runtime needs no parallel workspace-owned state model

### Slice 8: Final Cleanup

Goal:

- remove all temporary bridges and legacy single-assistant assumptions
- delete dead tests/helpers/types introduced only for migration
- update docs to target-state truth

2026-05-26 implementation checkpoint:

- Active product/admin source files no longer call `AssistantRepository.findByUserId`; only the repository contract and Prisma implementation keep the method as an honest legacy bridge.
- Plan visibility uses `ResolveActiveAssistantService`, so `/api/v1/assistant/plan-visibility` reads the selected active assistant/workspace plan, quota, media, package-offer, and entitlement truth for multi-assistant users.
- Payment intent creation/read, media package checkout, Admin Plan Control, Admin workspace subscription edits, and Ops billing-support actions now resolve workspace context through the active assistant resolver instead of a user-only assistant lookup.
- `apps/api/test/adr101-find-by-userid-guard.test.ts` is the guard against reintroducing active source callers.

Required cleanup commands/checks:

```bash
rg "findByUserId" apps/api/src apps/api/test
rg "AppUser\\.assistant|WorkspaceMember\\.assistant" apps/api/prisma apps/api/src
rg "activeAssistantId" apps/api apps/web packages/contracts
rg "assistantId" apps/web/app/app/_components apps/web/app/app
```

Acceptance:

- no production route resolves assistant-owned state by `userId` alone
- no one-to-one assistant relation remains in Prisma or app code
- no temporary compatibility comment/TODO remains
- no web local/session key for assistant-owned state lacks assistant id
- no old single-assistant bootstrap shape remains as current contract truth

## Verification Matrix

Before ADR-101 can be called complete, run focused tests for the touched slices plus repo gates.

Minimum focused proof:

- schema allows one user to create two assistants in one workspace
- plan limit blocks B2C second assistant
- bootstrap returns `assistants[]` and `activeAssistantId`
- switch endpoint changes active assistant for the workspace member only
- assistant A/B chat lists are isolated
- assistant A/B stream send/reattach/status are isolated
- same `surfaceThreadKey` under A and B does not collide
- assistant B turn uses B runtime bundle, memory, files, skills, and persona
- memory A is absent from memory B
- fileRef A cannot be used by B
- Telegram UI bind targets selected assistant
- Admin Ops cockpit can switch selected assistant without showing a long assistant list in the directory or Assistant card
- billing/subscription remains workspace-scoped through assistant switching
- notification dedupe does not cross-suppress assistant-specific events

Required broad gates after implementation:

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Prisma/schema migration work is high-risk and must use the repo's full verification path, not a docs-only or affected-only shortcut.

## Risks And Mitigations

### Wrong Assistant Receives A Turn

Severity: high.

Mitigation:

- central active assistant resolver
- assistant id on chat send/stream/reattach/status
- focused A/B runtime bundle tests

### Dropping Unique Constraints While Old Code Remains

Severity: high.

Mitigation:

- schema unlock and API resolver migration must be coordinated
- final cleanup blocks acceptance while `findByUserId` remains in hot paths

### Stale Web State Leaks Across Assistants

Severity: high.

Mitigation:

- namespace all assistant-owned local/session state by assistant id
- clear active stream/pending-send state on switch
- switcher regression tests

### Workspace Billing Accidentally Becomes Assistant Billing

Severity: medium.

Mitigation:

- subscription/payment/quota pool stays workspace-scoped
- assistant limit is plan-owned only
- billing tests switch assistant and assert plan state is unchanged

### Telegram Binding Mutates Wrong Assistant

Severity: medium.

Mitigation:

- UI connect/revoke uses selected assistant context
- webhook execution remains explicit assistant id

### Temporary Migration Code Becomes Permanent

Severity: high.

Mitigation:

- final cleanup slice is mandatory
- temporary helpers must be named as temporary and deleted before ADR completion
- no TODO scaffolding accepted

## Consequences

### Positive

- PersAI gains the clean base required for future AI outstaffing and role-based employees without mixing those concepts into the foundation.
- B2C and B2B packaging stays simple: plan limit decides how many assistants can exist.
- Runtime remains mostly unchanged because it already isolates by assistant id.
- Workspace billing and assistant behavior become cleaner separated concepts.
- Future Role Template / Company Profile / Work Queue work can attach to assistants/workspaces without fighting the old one-assistant root model.

### Negative

- This is a cross-layer migration touching Prisma, API contracts, web app shell, chat hot path, and settings surfaces.
- It is not safe as a tiny single-file change.
- During implementation, partial migration can be dangerous if schema uniqueness is removed before hot API paths stop using user-only resolution.
- Web state leakage bugs are likely unless assistant id namespacing is done thoroughly.

## Alternatives Considered

### Keep One Assistant And Add Roles Inside It

Rejected. It would make AI outstaffing look easier at first, but it would overload one assistant with many personas, memories, chats, files, and integrations. It would also make role switching ambiguous and increase cleanup cost later.

### Add AI Employee Entity Immediately

Rejected for this ADR. AI employee roles are a product layer on top of multi-assistant foundation. Adding them now would mix two decisions: cardinality of assistants and role/outstaffing operating model.

### Workspace-Owned Assistant Without User Ownership

Rejected as the immediate model. The current product path is one user workspace. Assistants should be workspace children with creator/owner audit fields. A later multi-member workspace model can refine member permissions without blocking this migration.

### Preserve `findByUserId` As Long-Term Default

Rejected. It is the root of the single-assistant assumption. It may only exist as a temporary migration bridge and must be removed before ADR-101 is considered complete.

## Director-Agent Execution Prompt

Use this prompt to start the implementation session:

```text
You are the director agent for PersAI ADR-101 implementation.

Goal:
Implement `1 user = 1 workspace = N assistants` cleanly, production-grade, with no permanent legacy single-assistant logic.

Source of truth:
- Read `AGENTS.md`.
- Read `docs/SESSION-HANDOFF.md`.
- Read `docs/CHANGELOG.md`.
- Read `docs/ADR/101-multi-assistant-workspace-model.md`.
- Then read `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, and only the ADRs referenced by ADR-101 if needed.

Hard constraints:
- One bounded slice at a time.
- Do not implement AI employee roles, role templates, work queues, departments, or outstaffing UX.
- The only target is `1 user = 1 workspace = N assistants`.
- Plan truth controls assistant count: B2C plans have `maxAssistants = 1`, B2B plans may have `maxAssistants > 1`.
- Do not leave target-state `findByUserId` assistant resolution in production hot paths.
- Do not preserve one-to-one Prisma assistant relations as target truth.
- Do not add permanent compatibility shims, dead stubs, TODO scaffolding, or legacy branches.
- If a temporary migration bridge is absolutely required to keep the repo compiling between sub-slices, name it temporary, track it in the director checklist, and delete it in the final cleanup slice before claiming ADR completion.

Execution model:
- You are the senior/director agent, preferably GPT-5.5.
- Use subagents for audits and bounded implementation slices, preferably GPT-5.4 where model selection is available.
- Subagents must return exact files touched, risks, tests run, and remaining cleanup.
- You must review every subagent result before continuing.
- Final step must be a cleanup slice that searches for and removes legacy single-assistant assumptions.

Recommended slice order:
1. Schema unlock and plan assistant limit.
2. Active assistant resolution service and switch service.
3. API lifecycle/bootstrap/contracts.
4. Chat/runtime entrypoint migration.
5. Assistant-scoped settings surfaces.
6. Web shell/switcher/state namespacing.
7. Runtime/integration isolation tests and fixes.
8. Final cleanup: remove temporary bridges and legacy assumptions.

Required final acceptance checks:
- `rg "findByUserId" apps/api/src apps/api/test`
- `rg "AppUser\\.assistant|WorkspaceMember\\.assistant" apps/api/prisma apps/api/src`
- verify assistant-owned web local/session keys include `assistantId`
- `corepack pnpm contracts:generate`
- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/runtime run typecheck`

Start by restating the current ADR-101 slice, what is in scope, what is out of scope, likely files/modules, and which subagents you will launch. Do not code before confirming the slice boundary.
```
