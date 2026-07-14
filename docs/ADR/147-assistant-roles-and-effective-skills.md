# ADR-147: Assistant Roles and Effective Skills

## Status

Closed 2026-07-14 — S0–S6 accepted. S1 schema/expand, S2 Role-only
API/runtime/prompt, S3 user Role UX, S4 Admin Role constructor/MCP, S5a active
contract cutover, and S5b physical contract/drop are implemented,
parent-audited CLEAN, deployed, and live-accepted. Release C `a11c8b6b` deployed
through migration-approved bot pin `05ccaed4`; all 189 migrations, exact
images, Argo health, public readiness, and live DB postconditions pass.
Authenticated B2C/B2B Role behavior, Skill/scenario indication, refreshed
Settings current-Role rendering, Admin Role preview, and the five Role MCP tools
in a newly opened post-reload Agent chat are founder-accepted. Direct user Skill
management and its physical assignment/plan-limit residue are absent while
existing Skill/Scenario/Knowledge/runtime mechanics remain intact behind Role
authority. Do not reopen ADR-147 for new scope; use a new ADR.

## Date

2026-07-13

## Baseline

`5e66f1e58488d861ad9644d88db95fdd370b3695` on `main`, equal to
`origin/main` when the S0 audit started.

## Orchestration model

ADR-147 is a parent-orchestrated program.

- The parent owns architecture, slice boundaries, subagent dispatch, diff review,
  verification, documentation truth, deploy sequencing, and live acceptance.
- Implementation is delegated one bounded slice at a time. Cursor Grok 4.5 is
  the default implementation/audit model; GPT-5.4 is used only when the slice
  demonstrably needs stronger reasoning or Grok fails. The parent avoids
  unnecessary expensive-model usage.
- The parent writes the slice contract, audits every resulting diff, requires
  focused evidence, and rejects compatibility hacks, dead code, stale
  vocabulary, generated drift, or unowned abstractions.
- No parallel implementation slices.
- S1 starts only after this ADR and its slice plan pass parent/founder audit.
- S1-S5 land locally without intermediate push or deploy. One final push occurs
  only after the S6 full-repository pre-push gate is green.
- Deploy occurs only after that push and under parent supervision; live
  acceptance and closure follow the deployed release.
- Closed ADRs remain closed. ADR-147 builds on their landed behavior without
  reopening them.
- If docs and code disagree at a slice boundary, reconcile truth before code.

## Founder invariants

1. `AssistantRole` is a reusable system-catalog record.
2. Every `Assistant` has exactly one required active Role.
3. Character, name, memory, files, and Role are independent concepts.
4. Role has a many-to-many relation with existing Skills.
5. Effective Skills are exactly the Skills of the current Role. There are no
   additional direct Skill assignments or add-ons.
6. Skills continue to own:
   - prompt/instructions;
   - Knowledge Cards and file-backed Skill KB;
   - `SkillScenario`;
   - the existing runtime `skill` tool behavior.
7. Role owns only:
   - immutable stable key;
   - localized name and description;
   - localized compact mission;
   - category;
   - bounded icon/presentation fields;
   - status and display order;
   - links to Skills;
   - ordinary audit timestamps.
8. Role does not own Knowledge, Scenarios, Scripts, runs, or workflow state.
9. Scripts and ADR-148+ are outside this program.
10. The Role layer changes which Skills are effective; it does not redesign how
    Skills, scenarios, Skill retrieval, or the model-facing `skill` tool work.

## Account and assistant cardinality

PersAI has both:

- accounts/plans where one assistant is allowed;
- B2B/operator accounts where one workspace member may own several assistants.

Role is always assistant-owned:

```text
AppUser / WorkspaceMember
  -> one or many Assistant rows
       -> exactly one Assistant.roleId
            -> one reusable AssistantRole
                 -> zero or many AssistantRoleSkill links
                      -> existing Skill rows
```

Consequences:

- there is no account-level, workspace-level, or active-member Role;
- each assistant in a multi-assistant account may use a different Role;
- switching the active assistant does not copy or mutate Roles;
- user Role reads/writes carry an explicit `assistantId`, so a concurrent active
  assistant switch cannot apply a Role to the wrong assistant;
- access control validates that the caller may manage that exact assistant;
- plan-owned `assistantPolicy.maxAssistants` remains unchanged;
- no Role-count or Skills-inside-Role billing limit replaces
  `maxEnabledSkills`.

## Default Role

The protected default Role is:

- deterministic internal id:
  `00000000-0000-4000-8000-000000000147`;
- key: `persai_default`;
- status: `active`;
- display order: `0`;
- category: `general`;
- zero `AssistantRoleSkill` rows;
- assigned to every existing assistant during expand;
- assigned automatically to every newly created assistant;
- protected from key changes, archive, and delete;
- protected from adding Skills, so zero Skills remains a permanent invariant.

Initial localized copy:

```json
{
  "name": {
    "ru": "Универсальный помощник",
    "en": "Universal assistant"
  },
  "description": {
    "ru": "Универсальная роль для повседневных вопросов и задач без профессиональной специализации.",
    "en": "A general role for everyday questions and tasks without a professional specialization."
  },
  "mission": {
    "ru": "Помогай с повседневными вопросами и задачами, используя базовые возможности модели и доступные инструменты.",
    "en": "Help with everyday questions and tasks using the model's core capabilities and available tools."
  }
}
```

The default Role preserves ordinary model behavior: no Skill is enabled, the
model-facing `skill` tool is not projected, and all unrelated model/tool
capabilities continue to follow the existing plan/runtime bundle.

Admins may edit the default Role's localized copy and bounded presentation
fields. Such an edit invalidates every assistant using it. Its key, active
status, and empty Skill set are immutable.

## Role data model

### `AssistantRole`

Target fields:

- `id UUID` primary key;
- `key VARCHAR(64)` unique and immutable;
- `name JSONB` localized, requiring non-empty `ru` and `en`;
- `description JSONB` localized, requiring non-empty `ru` and `en`;
- `mission JSONB` localized, requiring non-empty `ru` and `en`;
- `category VARCHAR(64)`;
- `iconEmoji VARCHAR(16) NULL`;
- `color VARCHAR(32) NULL`;
- `status AssistantRoleStatus`;
- `displayOrder INTEGER`;
- `createdAt`, `updatedAt`.

`AssistantRoleStatus` is:

- `draft`;
- `active`;
- `archived`.

There is no generic presentation JSON in v1. The bounded `iconEmoji`, `color`,
and `displayOrder` fields are the complete presentation shape.

### `AssistantRoleSkill`

Target fields:

- `roleId UUID`;
- `skillId UUID`;
- `displayOrder INTEGER`;
- `createdAt`.

Constraints:

- composite primary/unique key `(roleId, skillId)`;
- Role deletion cascades to links, although product APIs archive Roles and never
  delete the default;
- Skill physical deletion cascades to links, while normal admin behavior is
  archive;
- only active Skills may be added to a Role;
- archiving a Skill is blocked while it belongs to any active Role;
- replacing Role Skills is a full replacement, never a merge or add-on.

### `Assistant.roleId`

`Assistant.roleId` is:

- required;
- an FK to `AssistantRole`;
- the only canonical assistant specialization selector;
- immediate Assistant configuration, not draft/published-version state;
- independent from character, name, memory, files, plan, chat, and session.

The expand migration inserts `persai_default` before adding the FK, backfills
every assistant, and supplies a database default for old pod revisions that may
still create assistants during the expand rollout.

## Current truth established by S0

No Role model exists today. Effective Skills are currently derived directly
from `AssistantSkillAssignment` in several independent paths:

- user `GET/PUT /api/v1/assistant/skills`;
- setup/recreate and Assistant Settings checkbox cards;
- prompt/runtime-bundle materialization;
- server-side Skill Knowledge authorization;
- admin Skill/scenario invalidation fanout;
- plan `skillPolicy.maxEnabledSkills`;
- pricing facts and admin plan controls;
- PersAI MCP `assistant_skills_assign`.

The existing runtime already consumes materialized `bundle.skills.enabled`.
Runtime does not query `AssistantSkillAssignment` directly. This is the seam
that keeps ADR-147 bounded: API materialization changes the source, while the
runtime Skill mechanics keep the same effective-Skills bundle shape.

Current chat Skill state is stored on `AssistantChat`:

- `skillDecisionState` contains inactive/active Skill and scenario activation;
- `skillRetrievalState` contains cached Skill retrieval state.

There is no separate durable activation column. There is no `WorkflowRun`,
`RoleRun`, or Role lifecycle state.

## Effective Skills

The single target derivation is:

```text
Assistant.id
  -> Assistant.roleId
  -> AssistantRoleSkill.roleId
  -> Skill
```

Effective Skills include only linked Skills that remain active. In normal
operation an active Role cannot retain an archived Skill because Skill archive
is blocked until active Role links are removed.

The derivation must be shared by:

- materialized prompt cards;
- runtime bundle Skill summaries/scenarios;
- Skill Knowledge search/fetch authorization;
- admin invalidation fanout;
- role preview.

There is:

- no direct-assignment overlay;
- no user/admin/operator Skill add-on;
- no plan truncation;
- no dual-read;
- no fallback to `AssistantSkillAssignment`;
- no role-owned copy of Skill instructions, KB, cards, or scenarios.

## Existing Skill mechanics preserved

ADR-147 does not change:

- Skill CRUD and admin authoring;
- Skill instruction-card schema;
- Skill Knowledge Cards, documents, chunks, vectors, and indexing jobs;
- `SkillScenario` schema or activation semantics;
- `skill.list`, `skill.describe`, `skill.engage`, or `skill.release`;
- runtime routing over effective Skill summaries;
- scenario volatile-context rendering;
- Skill-first Knowledge retrieval behavior;
- provider parallel-tool discipline when effective Skills are non-empty;
- the `bundle.skills.enabled` runtime shape, except for source-authority tests;
- AOT/JIT separation established by ADR-119/130.

The Role layer is resolved before those existing mechanics:

```text
Role -> effective Skills -> existing materialization -> existing runtime Skill mechanics
```

## Prompt architecture

Role contributes one compact stable-prefix block:

```xml
<assistant_role>
  <mission>Localized Role mission.</mission>
</assistant_role>
```

Rules:

- the block is placed after assistant identity and before
  `<enabled_skills>`;
- only the localized mission is model-facing;
- Role name, description, category, presentation, and Skill list are not
  repeated in this block;
- Role never embeds Skill instruction text;
- the block is AOT stable configuration;
- changing Role or editing its mission deliberately invalidates the stable
  prefix;
- scenario activation remains JIT/volatile and does not invalidate the Role
  block;
- the Admin preview uses the same renderer as production materialization.

`persai_default` still renders its compact mission while its
`<enabled_skills>` block remains empty.

## Role assignment

### Public application boundary

Target user endpoints:

- `GET /api/v1/assistant/roles` — active system catalog, ordered for setup and
  Settings; returns user-safe Role identity/presentation only, never Skill
  composition;
- `GET /api/v1/assistant/{assistantId}/role` — current Role for one authorized
  assistant;
- `PUT /api/v1/assistant/{assistantId}/role` — exact body
  `{ "roleKey": "<immutable key>" }`.

The explicit `assistantId` is required for both single-assistant and
multi-assistant accounts. The selected active-assistant pointer is UI
navigation state, not mutation authority.

Authorization is owner-only, matching the existing explicit-assistant sandbox
boundary:

- resolve the caller's workspace/member context;
- fetch the exact `Assistant.id = assistantId` in that workspace;
- require `Assistant.userId = callerUserId`;
- return not-found/forbidden without revealing another member's assistant.

Same-workspace membership alone is insufficient. This prevents an explicit-id
request from mutating another B2B member's Assistant.

### Atomic change

A changed Role assignment performs a bounded retry around one database
transaction:

1. from the unlocked current-role snapshot, lock current plus target Role rows
   in sorted id order;
2. lock the exact owner-constrained Assistant and revalidate `roleId`;
3. if `roleId` changed while waiting, commit no writes and retry from that fresh
   Role id (at most three attempts);
4. lock the Assistant's chats in sorted id order;
5. read `clock_timestamp()` only after acquiring the Assistant lock;
6. update `Assistant.roleId` and set `Assistant.configDirtyAt` from that database
   timestamp;
7. reset every chat of that assistant:
   - `skillDecisionState = NULL`;
   - `skillRetrievalState = NULL`;
8. append `assistant.role_updated` audit truth with previous and selected Role
   keys;
9. commit.

A same-Role retry is idempotent and does not reset state or duplicate audit.

The next turn runs the existing materialization freshness path and therefore
uses the new Role. No explicit Role apply job or lifecycle exists.

### In-flight turn safety

A turn already admitted before the change may finish using its immutable old
bundle snapshot. It must not restore old Role/Skill state after the assignment
transaction.

Materialization writes a non-model-visible top-level
`AssistantRuntimeBundle.effectiveRoleId`. It does not change
`bundle.skills.enabled`. Runtime carries that value through the internal
`SkillStateInput.expectedRoleId` request. API accepts engage/release persistence
only when:

- `expectedRoleId` still equals canonical `Assistant.roleId`;
- the target Skill is still linked to that active Role.

If either check fails, API returns a typed non-retryable
`stale_assistant_role_snapshot` result with `applied: false`. Runtime does not
retry and does not claim durable engage/release. The already admitted turn may
finish ordinary text/tool work from its immutable bundle; only stale durable
Skill-state persistence is discarded. The next turn rematerializes canonical
Role truth. Role assignment is not blocked on an active turn.

This is an authority/race guard at the internal persistence boundary, not a new
model-facing Skill action. It also protects Role Skill replacement while an old
turn is in flight.

All mutations that overlap durable Skill state use this global row-lock order,
skipping row classes they do not need:

1. `Skill` rows, sorted by id;
2. `AssistantRole` rows, sorted by id;
3. `Assistant` rows, sorted by id;
4. `AssistantChat` rows, sorted by assistant id then chat id;
5. `AssistantRoleSkill`, sorted by role id then Skill id.

Runtime engage/release, Skill archive, Skill-scenario mutation, and S4
Role-Skill replacement must not acquire a later class and then return to an
earlier class. Scenario mutation first locks the parent Skill, then discovers
and locks/revalidates active linked Roles, snapshots and locks affected
Assistants/chats, and finally locks link rows. Owning the Skill before discovery
makes an absent link safe: S4 must lock every involved Skill (sorted) before any
Role, so no link can appear or disappear during scenario scope discovery. A
release performs an unlocked candidate chat read only to identify the Skill,
then acquires canonical locks and revalidates the locked chat/state; a changed
candidate causes a bounded fresh-candidate retry with no write. Role PUT does
not touch Skill/link rows and remains the valid sorted `Role -> Assistant ->
Chat` subsequence. Its `SkillScenario` row is locked only after the shared
authority hierarchy.

Generic `AssistantChatTodo` rows are not cleared on Role change. They have no
scenario provenance and are model-authored chat plans; deleting them would
destroy unrelated user work. Clearing `skillDecisionState` removes active
scenario authority, while the existing plan remains ordinary chat-plan truth.

### Materialization race safety

Materialization clears `configDirtyAt` conditionally on the dirty value observed
by the materialization attempt. A concurrent newer Role/Skill edit therefore
leaves the assistant dirty.

Freshness comparison must fail safe when dirty and materialized timestamps are
equal at persisted precision. S2 must change both owners:

- `MaterializeAssistantPublishedVersionService` uses conditional
  compare-and-clear rather than unconditional `configDirtyAt = NULL`;
- `EnsureAssistantMaterializedSpecCurrentService` treats equal dirty and
  materialized timestamps as stale (`>=`, not only `>`);
- one shared `CURRENT_ASSISTANT_MATERIALIZATION_ALGORITHM_VERSION` is `2` for
  role-only bundles and is used by production and preview materializers;
- freshness treats every existing spec with `algorithmVersion < 2` as stale
  independently of generation and dirty timestamps. Old pods may still write
  v1 during a rolling deploy, but new code will always reject/rematerialize it,
  so a v1 rewrite cannot defeat the cutover.

## Role catalog UX

### User product

Users configure Role, not Skills.

- Every user-visible string is localized in RU and EN.
- Copy is short, plain, premium, and system-consistent: no slang, internal
  architecture terms, duplicated explanations, or noisy helper text.
- Existing design tokens, spacing, typography, focus states, motion discipline,
  responsive behavior, and accessibility patterns are reused; no parallel
  visual system or one-off styling is introduced.
- Setup and recreate use one shared active Role catalog.
- The existing Skill checkbox block is replaced in the same setup stage; Role
  does not absorb or replace character/archetype controls.
- Setup/recreate submit exact
  `{ assistantId, expectedRoleKey, roleKey }` in their canonical
  publish/recreate command. `expectedRoleKey` is the canonical current Role from
  the paired catalog/current GET; `roleKey` is the desired Role. The application
  service locks and revalidates the expected Role before calling the same Role
  assignment primitive inside the publish/recreate transaction. Drift returns
  stable `409 assistant_publish_role_conflict` before version/apply mutation; the
  web client never performs a racy `PUT role` followed by a separate publish.
- Full Assistant reset preserves the current `roleId`, because Role is
  independent Assistant configuration. A subsequent recreate command may
  explicitly select a different Role.
- Assistant Settings renames the `skills` section to `role`.
- The section shows the current Role's interactive card, localized
  name/description/mission, category/icon presentation, and `Change role`.
- `Change role` opens the shared single-select catalog.
- Cancel makes no mutation.
- Confirm performs one Role assignment request, validates its `assistantId`,
  then refetches catalog/current. Success is shown only after that GET confirms
  the selected Role as displayed canonical state; an ambiguous write failure
  also refetches before presenting the error.
- Role changes apply immediately to the assistant and from the next turn.
- Each assistant in a B2B account displays and changes its own Role.

No user surface shows:

- Skill selection cards;
- Skill enable/disable controls;
- effective Skill counts;
- plan Skill limits;
- Role Skill composition;
- Skill add-ons.

Existing runtime scenario/working behavior remains intact. User-facing
configuration and Role cards do not expose Skills as a configurable product
concept.

### Admin product

Admin gets a dedicated `/admin/roles` constructor:

- its information architecture, table/card density, forms, actions, validation,
  empty/loading/error states, and responsive behavior follow the existing Admin
  Skills constructor;
- differences are only those required by the Role domain, not a new admin visual
  language;
- all Admin Role copy is localized RU/EN, concise, and free of implementation
  vocabulary;
- list/create/edit/archive;
- localized name, description, and mission;
- category, icon, color, order, status;
- full-replace Skill selection;
- preview of the exact Role mission block;
- preview of effective Skills and the existing compact enabled-Skills block;
- default Role protection;
- in-use Role archive protection.

Role core edits mark every assistant with that `roleId` dirty. Role Skill
replacement also resets chat Skill decision/retrieval state for affected
assistants. No admin endpoint can add Skills directly to an Assistant.

Admin Skills authoring remains at `/admin/skills`.

## MCP boundary

PersAI MCP remains a thin HTTP wrapper over the same application services and
public/admin APIs. It is not a second factory or orchestrator.

New tools:

- `role_upsert`;
- `role_get`;
- `role_list`;
- `role_skills_replace`;
- `assistant_role_assign`.

External Role selectors use immutable `roleKey`. `assistant_role_assign`
requires both `assistantId` and `roleKey`, which is necessary for B2B
multi-assistant accounts.

`role_skills_replace` is full replacement. MCP never merges old and new Skill
lists. `assistant_skills_assign` is removed during the clean contract cutover.
S4 updates the ADR-136 operator allowlist and `docs/API-BOUNDARY.md` explicitly;
MCP Role tools cannot rely on an implicit admin-only route or a second
authorization implementation.

## Skill and Role mutation invalidation

Existing admin mutation paths discover affected assistants through
`AssistantSkillAssignment`. They must switch to:

```text
Skill
  -> AssistantRoleSkill
  -> AssistantRole
  -> Assistant.roleId
```

Rules:

- Skill core/instruction changes mark all assistants whose Role links that
  Skill dirty;
- retrieval-only Skill KB changes clear affected chats'
  `skillRetrievalState`;
- every Skill-scenario create/update/archive locks and mutates in one
  transaction, marks every Role-linked Assistant dirty from the database clock,
  and clears both `skillDecisionState` and `skillRetrievalState` for all of
  their chats;
- Role mission/presentation/status edits mark assistants using that Role dirty;
- Role Skill replacement marks those assistants dirty and clears decision and
  retrieval state;
- archived/in-use Role and linked-Skill protections are enforced transactionally
  so assignment/archive races cannot violate the required-active-Role invariant.

## Legacy deletion

Final active truth contains none of:

- `AssistantSkillAssignment`;
- direct Skill assignments;
- user/admin/operator Skill add-ons;
- `/assistant/skills`;
- `assistant_skills_assign`;
- Skill-selection frontend state, components, or generated types;
- `skillPolicy.maxEnabledSkills`;
- `enabled_skills_limit`, `max_enabled_skills`, or
  `skill_assignments_limit`;
- plan/pricing copy advertising a Skill count;
- dual-read, aliases, or transition vocabulary.

Historical migrations and archived historical docs are not rewritten. The final
active-vocabulary gate scans active code, current contracts, current docs, and
generated artifacts. It explicitly allowlists:

- immutable historical migrations that created the old table;
- the contract migration that drops it;
- archived changelog/handoff/ADR history;
- tests that intentionally assert rejection of removed vocabulary.

## Migration and production rollout

This is a safe expand -> role-only -> contract/drop rollout. It is not
compatibility mode.

### Release A — expand

- Create `assistant_roles` and `assistant_role_skills`.
- Insert protected `persai_default`.
- Add `assistants.role_id` with the deterministic default.
- Backfill every assistant, including unpublished/in-setup assistants.
- Enforce NOT NULL and FK.
- Update new-assistant creation to set the default explicitly.
- Defer Role catalog/admin application services to Release B/S2; Release A adds
  no unused Role service abstractions and does not change effective-Skill reads.
- Keep old pods valid through the database default.

Release A uses the normal `persai-dev-migrations` approval path.

The default backfill intentionally does not translate arbitrary legacy
per-assistant Skill sets into generated Roles. Before Release B, the parent
exports and records:

- count of assistants with non-empty direct assignments;
- distinct assignment-set counts;
- assistant ids and Skill ids in an access-controlled rollback artifact;
- the curated Role assignment plan, if any, approved by the founder/operator.

Existing assignment rows remain recoverable until Release C, but they are not
active fallback truth. Every assistant stays on `persai_default` unless an
operator/user explicitly chooses a curated system Role. The Release B go/no-go
therefore includes explicit founder acceptance of this deliberate behavior
cutover; silently synthesizing one Role per old assignment set is forbidden.

### Release B — role-only cutover

- Materialization and retrieval read only Role links.
- Role assignment, prompt mission, Admin, MCP, and user Role UX become active.
- Direct Skill-selection APIs/UI/MCP are removed from active behavior.
- Plan Skill-limit behavior is removed.
- The physical assignment table remains for old revision safety but new code
  never reads or writes it.
- API/runtime become Ready before the new web image is exposed.
- Verify all running revisions are role-only.

There is no assignment fallback if Role reads fail.

### Release C — contract/drop

Only after proving that no old API/runtime/web revision remains:

- remove the legacy Prisma model and enum;
- drop `assistant_skill_assignments`;
- remove residual generated contract vocabulary;
- delete persisted plan Skill-limit JSON keys and entitlement rows;
- run the active-vocabulary zero gate;
- deploy through `persai-dev-migrations`.

The destructive drop is never included in the first role-only deployment.
Rollback before Release C is code rollback over the expanded schema. Rollback
after Release C requires an explicit restore migration/backup and is not
represented as an automatic compatibility path.

## Slice plan

ADR-147 has seven slices: S0 through S6.

### S0 — audit, ADR, and exact cutover map

- Read-only schema/API/runtime/web/admin/MCP/plan audit.
- Record current direct-assignment truth.
- Lock this ADR, slice boundaries, file map, migration contour, and gates.
- Reconcile continuity docs.
- No implementation.

### S1 — Role schema and expand migration

- Add Role models, status enum, relations, indexes, and default Role.
- Add/backfill required `Assistant.roleId`.
- Update assistant domain/repository/create coverage and lock reset-preserves-
  Role behavior.
- Add Role schema persistence and focused migration/source-contract tests;
  defer application Role catalog services to S2.
- Do not change effective-Skill reads.

Primary files/modules:

- `apps/api/prisma/schema.prisma`;
- new `apps/api/prisma/migrations/*adr147*`;
- `apps/api/prisma/seed.ts`;
- assistant domain/repository/create/reset services;
- deterministic default-Role seed constants/helper only;
- focused Prisma/domain tests.

### S2 — role-only API/runtime/prompt cutover

- Add explicit-assistant Role read/assign APIs.
- Enforce exact owner-only authorization, atomic assignment, and the typed
  in-flight snapshot guard.
- Resolve materialization, scenarios, retrieval, and admin invalidation through
  Role links only.
- Add the compact Role mission block.
- Keep existing runtime Skill bundle/tool/scenario mechanics.
- Carry top-level non-model-visible `effectiveRoleId` through runtime/internal
  Skill-state requests without changing `bundle.skills.enabled`.
- Harden both `configDirtyAt` compare-and-clear and equal-timestamp freshness
  handling.

Primary files/modules:

- Role application/controller/module wiring;
- `materialize-assistant-published-version.service.ts`;
- `compile-prompt-constructor.service.ts`;
- prompt defaults and runtime-bundle types;
- `read-assistant-knowledge.service.ts`;
- admin Skill/scenario invalidation services;
- internal runtime Skill-state service/controller;
- runtime-bundle schema and runtime internal API client;
- prompt/cache/golden and focused runtime tests.

Local status update (2026-07-14): landed locally, not deployed. Effective runtime
Skill reads now resolve only through `Assistant.roleId -> AssistantRoleSkill ->
active Skill`; malformed Role path ids fail with stable 400 validation; the
localized role mission is XML-text escaped inside exactly one stable-prefix
block. Runtime bundle/preview materialization share algorithm v2, reject every
older algorithm independently of other freshness signals, and use conditional
`configDirtyAt` compare-and-clear. Runtime Skill-state persistence rejects stale role snapshots with
`stale_assistant_role_snapshot`. Persistence serializes the exact
`Skill -> AssistantRole -> Assistant -> AssistantChat -> AssistantRoleSkill`
rows; S4 Role-Skill replacement must lock all involved Skills first and use
that same remaining order (sorted ids for every multi-row class) before mutating
links or invalidating chats. Role assignment
locks current plus target Roles first and retries after Assistant revalidation
detects a concurrent change because it is a Skill/link-free valid subsequence.
Skill archive locks its Skill before discovering/revalidating active linked
Roles. Scenario create/update/archive locks the parent Skill before Role
discovery and the affected-Assistant snapshot, then atomically resets both chat
Skill-state fields and writes
post-lock database dirty timestamps for every affected Assistant. Internal
Assistant/expected-Role/engage-Skill UUIDs are validated before raw casts. The existing
`GET/PUT /api/v1/assistant/skills` management endpoint and
`AssistantSkillAssignment` storage remain physically available for the
unchanged S3 UI through S2, but neither contributes effective runtime truth.

S6 clean-DB repair (2026-07-14, local, undeployed): the S2 prompt migration
required `bootstrap_document_presets.id='system'`, but historical migrations
never inserted that row (application seed did). On a pristine migration-only DB
(`assistants` and `workspaces` both empty) the undeployed S2 migration now
inserts the canonical visible system default minus only
`{{assistant_role_block}}`, then runs the existing one-time role-placeholder
insertion/order validation. A populated DB missing `system` remains fail-closed.
Existing production rows stay lock-and-patch / idempotent as before. Historical
migrations are not rewritten. This repair is not a full S6 acceptance claim.

### S3 — user Role UX

- **Local status update (2026-07-14): landed locally, not deployed.**
- Deleted `AssistantSkillsManager` and direct user Skill-selection tests/types.
- Replaced setup/recreate Skill cards with one shared single-select Role catalog.
  Selection fails closed unless the exact canonical current Role exists in the
  active catalog; there is no first-row fallback. Canonical publish/recreate
  carries `{ assistantId, expectedRoleKey, roleKey }`.
- Renamed the user Settings section from Skills to Role and added the current
  Role card plus confirmed Change Role flow.
- Preserved character/name/memory/files independence.
- Added assistant/generation guards, AbortSignal propagation, response
  `assistantId` validation, and refetch-after-ambiguity handling for
  multi-assistant switching/out-of-order role reads/writes.
- Repaired global publish callers: setup sends canonical-current expected plus
  desired Role; ordinary Settings Save and existing MCP `assistant_publish`
  preserve Role with expected equal to desired, so a concurrent Role change
  conflicts instead of being silently overwritten. No S4 Role tools were added.
- Role categories resolve from RU/EN message maps; setup uses embedded selector
  chrome without duplicate Current+Selected badges; mission detail stays on
  current/selected cards only.
- Focused local verification covers selector/settings/setup/API-wrapper vitest,
  honest publish transaction outcomes/rollback/ownership/idempotency/conflict,
  Role service retry/exhaustion, and the existing MCP package suite. Full
  repository lint/format/build/contracts-twice/diff gate is green before parent
  re-audit.

Primary files/modules:

- setup page/tests;
- Assistant Settings/tests;
- assistant API client;
- new shared Role card/catalog component/tests;
- EN/RU messages.

### S4 — Admin Role constructor and MCP

- **Local status update (2026-07-14): implemented locally, awaiting parent
  audit; not committed/pushed/deployed.** Baseline before S4 was committed
  S3 `32a209c1`.
- Added `/admin/roles` admin HTTP surface mirroring Admin Skills auth:
  list/create, static `POST /preview`, get/patch/delete by `roleId`, and
  full-replace `PUT /{roleId}/skills`.
- Enforced immutable Role key, required ru+en copy/mission, default Role
  protections, in-use archive rejection, core-edit dirtying without chat
  clear, and bounded optimistic Skill-replace locking
  (`Skill -> Role -> Assistant -> Chat -> RoleSkill`) with chat Skill-state
  clear on replace.
- Extracted one shared production/Admin effective-Skills prompt pipeline with
  deterministic `AssistantRoleSkill.displayOrder`, normalized locale keys,
  active scenarios, instruction cards, and XML escaping. The service-level
  preview test proves byte-identical `missionBlock` / `enabledSkillsBlock`.
- Activation uses bounded fresh-link retry in `Skill -> Role` order. API state
  exposes authoritative `assistantCount` / `inUse`; empty replacement repairs
  corrupted default-role links under the canonical lock hierarchy.
- Added next-intl-backed RU/EN `/admin/roles` UI + localized nav,
  OpenAPI/generated contracts, and five MCP
  tools (`role_upsert`, `role_get`, `role_list`, `role_skills_replace`,
  `assistant_role_assign`) with exact request-mapping tests, while keeping
  `assistant_skills_assign` until S5.
- Keep `/admin/skills` authoring unchanged. No S5 deletion in this slice.

Primary files/modules:

- Admin Role services/controllers/types/tests;
- Admin Role web page/tests and nav;
- OpenAPI/generated contracts;
- `packages/persai-admin-mcp`;
- MCP README/operator docs and ADR-136 operator route allowlist;
- `docs/API-BOUNDARY.md`.

### S5 — legacy contract and storage deletion

S5 has two ordered operational phases, not additional product slices:

1. S5a removes active APIs/types/UI/MCP/plan-limit behavior while retaining the
   unused physical table for old-revision safety.
2. S5b runs only after Release B old-revision proof and drops the table/enum plus
   persisted plan-limit JSON.

**Local status update (2026-07-14): S5a landed and parent-audited CLEAN; S5b
implemented locally against `d8195d1d`; first parent audit rejected one MEDIUM,
now repaired and awaiting re-audit; Release C not deployed.** S5a removed active direct-assignment
controller/service/OpenAPI/web wrappers/MCP tool and plan Skill-count limit
read/write behavior. The S5b audit discovered that S5a's “zero production
readers” inventory was incomplete: the user-visible indexing-job status list
still used the residual relation. Runtime/prompt/Knowledge content authority
was already Role-only. The repair makes that list resolve shared Skill jobs
through the active Assistant's exact current Role and requires active Role plus
active, non-archived Skill, while preserving the assistant-private exact
Assistant/workspace branch. Focused runtime coverage proves B2B active-Assistant
switch isolation and unchanged Admin listing. S5b adds monotonic migration
`20260714003000_adr147_s5b_drop_assistant_skill_assignments`: idempotent JSON
cleanup of `plan_catalog_plans.billing_provider_hints` top-level `skillPolicy`
and `plan_catalog_entitlements.limits_permissions` entries whose `key` is
exactly `enabled_skills_limit`, `max_enabled_skills`, or
`skill_assignments_limit` (order-preserving; arrays never nulled), then
`DROP TABLE IF EXISTS assistant_skill_assignments`, then
`DROP TYPE IF EXISTS AssistantSkillAssignmentStatus`. Prisma
`AssistantSkillAssignment` model/enum and Workspace/WorkspaceMember/Assistant/
Skill relation fields are removed. Historical create/read migrations remain
immutable. Admin Plan create/update still preserves neutral unowned JSON
without inventing removed Skill-limit keys. Active-vocabulary zero gate keeps
fail-closed exact path+term+exactCount allowances only (schema residue zero;
historical migrations exact; S5b migration exact). Optional
`EnabledSkillPromptAssignmentStatus` cleanup is out of scope. This is not the
S6 full-repository gate, commit, push, or deploy.

Read-only production pre-drop inventory records the intentional Release C
cleanup set: 41 assignment rows across 10 Assistants (24 active, 17
non-active), 6 billing-hint rows, and 6 entitlement rows/entries. No deletion
or deployment is claimed.

Primary files/modules:

- old assistant Skills controller/service/types;
- OpenAPI/generated contracts;
- old web selection component and API wrappers;
- Admin Plans and pricing Skill-limit fields/copy;
- MCP `assistant_skills_assign`;
- Prisma contract migration (S5b only);
- active-vocabulary audit test.

### S6 — final audit, gates, deploy, and live acceptance

- Cross-layer source-of-truth audit.
- Docs reconciliation.
- Re-run all focused Role/Skill/runtime/web/Admin/MCP/contract suites.
- Run the complete repository test/build/verification contour used by ADR-146,
  not only affected checks.
- Generated-contract zero-diff.
- Clean-database Prisma migration validation (S6 exposed that the S2 system
  preset bootstrap was required for migration-only DBs; local repair landed
  2026-07-14 — parent must re-prove the isolated migrate before claiming S6).
- Active legacy/dead-code/vocabulary zero audit.
- Commit all locally accepted slices; verify clean tracked/untracked state.
- Perform one parent-authorized push only after every pre-push gate is green.
- Supervise CI/image publication/GitOps rollout and exact revision inventory.
- Execute Release A/B/C migration safety in its required operational order;
  destructive Release C waits for role-only old-revision proof.
- B2C and B2B live Role acceptance.
- Admin/MCP authoring and invalidation acceptance.
- Founder closure only after evidence.

Authenticated acceptance follow-up (2026-07-14, local repair committed at
`d8195d1d`): production Clerk/B2B evidence confirmed three Assistants have
independently addressable required Roles, all ADR-147 routes are
middleware-registered, and a real Marketer `instagram_carousel` engage renders
`Маркетолог · Instagram-карусель` under the chat title. The audit repaired four
bounded issues without changing Role/Skill architecture: unstable auth callback
identity could self-abort Settings Role loading; Admin preview returned Nest's
default 201 instead of contract 200; inactive completion omitted explicit
`engagementSummary: null`; and a background completion lacked a visible-thread
guard. Focused regressions pin resolver stability, HTTP status, nullable
normal/replay send+stream transport, SSE set/clear, cross-thread/B2B isolation,
and publish middleware coverage. Founder authorized S5b after that repair;
S5b is implemented locally and awaits parent audit — not yet committed, pushed,
or deployed as Release C.

## Exact S0 conflict ledger

The S0 audit found and resolved documentation status drift:

- `.cursor/rules/persai-session-continuity.mdc` called ADR-146 active; S0 now
  records ADR-146 closed and ADR-147 active;
- `AGENTS.md` listed ADR-130 as active; S0 now records it closed locally.

Current API/data docs correctly describe direct Skill assignments as current
implemented truth. They must not be rewritten as though ADR-147 code has landed;
S0 may only record ADR-147 as the accepted target program.

## Verification

Every implementation slice runs focused tests plus the repository gate:

```powershell
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Before the single final push, S6 additionally runs:

- full workspace tests, not only affected/focused suites;
- all production builds;
- generated OpenAPI/client/MCP/runtime-contract regeneration followed by
  zero-diff;
- clean isolated-database Prisma deploy/status validation through all migrations;
- explicit active-code search for removed direct-assignment, Skill-limit,
  compatibility, dead-code, and transition vocabulary;
- `git diff --check`, Prettier/format, lint, API/web/runtime/package
  typechecks, and repository-specific release contracts;
- a final parent diff audit proving that founder-owned unrelated files are not
  accidentally included.

Any failure blocks push. No partial green gate, skipped check, or later-fix
promise is acceptable.

Required cross-program checks:

- Role schema/default/backfill and new-assistant creation;
- explicit assistant isolation across B2C and B2B accounts;
- same-workspace/different-owner explicit-assistant denial;
- atomic Role assignment and same-Role idempotency;
- stale in-flight Skill-state write typed non-retryable discard while the old
  admitted turn can finish;
- top-level `effectiveRoleId` bundle/internal-request propagation without a
  `skills.enabled` shape change;
- Role Skill replacement and archive race tests;
- existing `skill` tool/scenario/runtime suites unchanged except fixtures/source
  authority;
- Role mission prompt golden and cache-stability guards;
- Skill Knowledge access through Role links only;
- Admin Role preview byte-equal to production renderer;
- setup/recreate/Settings Role UX;
- reset preserves Role; recreate may explicitly change it;
- pre-cutover legacy assignment inventory and founder go/no-go evidence;
- Admin/MCP Role authoring;
- plan Skill-limit removal;
- generated contracts regenerated and then zero-diff;
- Prisma migrations applied and status-clean against a fresh isolated database;
- active assignment/limit vocabulary search with only documented historical
  allowlist hits.

## Live acceptance

Release B acceptance must prove:

1. Existing assistants use `persai_default` until explicitly changed.
2. A zero-Skill default assistant retains ordinary model and non-Skill tool
   abilities.
3. Role change affects the next turn without changing the current admitted
   turn's snapshot.
4. Old Role Skill state cannot reappear after the change.
5. Effective Skill prompt, scenario, and Knowledge behavior match the existing
   mechanics for a Role containing those Skills.
6. B2C: the sole assistant changes independently.
7. B2B: two assistants under one account hold different Roles; changing one
   never changes the other or the active-assistant pointer.
8. Setup and recreate use the same Role catalog as Settings.
9. Admin Role edits invalidate every affected assistant.
10. MCP Role tools produce the same canonical API state as Admin/web.
11. No user/admin/operator direct Skill add-on remains.

Release C acceptance must additionally prove:

- no old pod revision remains before migration;
- assignment table/enum and limit JSON are absent;
- active vocabulary scan is clean;
- health/readiness and one B2C + one B2B smoke remain green after drop.

## Non-goals

- changing Skill tool actions or model-facing semantics;
- changing SkillScenario activation/progression;
- changing Skill Knowledge ownership/indexing;
- adding Role-owned Knowledge, scenarios, scripts, or runs;
- adding plan Role tiers or Role limits;
- account/workspace-level Roles;
- preserving direct assignments through generated per-assistant Roles;
- marketplace/community Roles;
- ADR-148+ Scripts work;
- reopening closed prompt/Skill programs.

## Closure conditions

ADR-147 closes only when:

- S0-S6 are complete;
- role-only active truth is deployed;
- Release C contract/drop is complete;
- B2C and B2B live acceptance passes;
- all required local gates pass;
- current docs describe Role-only truth;
- historical assignment vocabulary remains only in the explicit immutable
  allowlist;
- founder accepts the recorded evidence.
