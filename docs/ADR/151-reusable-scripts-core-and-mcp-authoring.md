# ADR-151: Reusable Scripts Core and MCP Authoring

## Status

**Accepted / Open — implementation, independent audits, and local repository
gate satisfied; deploy and founder live acceptance pending.**
Founder-approved architecture checkpoint started 2026-07-16 on baseline
`36947f7544918c0fddadae6ec17f75883b1b1365` (`adr-151-reusable-scripts`).
The local Domain + Admin API block includes schema/migration, lifecycle,
ordered Skill links, bounded Scenario references, explicit auth routes,
OpenAPI/generated contracts, and focused tests. Its independent audit exercised
the full 189-migration history and Script constraints against an isolated
PostgreSQL 16 database with zero target-schema drift.

The Scenario + Runtime block, implemented locally in the same session on top
of that audited checkpoint, adds: async materialization of the authored
`{scriptKey, inputMapping}` Scenario-step reference into the exact immutable
`{scriptId, scriptVersionId, versionNumber, contentHash}` pin;
`apps/api`'s internal `ScriptVersion` artifact read boundary with live
Script/SkillScript re-authorization; the provider-facing `script`
(`{action:"execute", input:object}`) tool, dynamically projected only when
the sandbox is enabled and the active Scenario step carries a materialized
`scriptRef`, then re-resolved (not just re-projected) immediately before
dispatch; runtime-side input
mapping/Ajv 8.18 Draft-2020-12 validation and server-derived
`scriptInvocationKey`; `SandboxService.submitJob`'s atomic
create-by-`(assistantId, scriptInvocationKey)` admission with `P2002`
winner/loser resolution and `idempotency_conflict` on a version/input
mismatch; and sandbox-side `executeScriptRun` over the exact existing warm
session pod, with transient `/tmp` staging that is never mirrored to
workspace GCS/Files/snapshots. A pre-existing `LimitedCollector` retention bug
in `ExecPodBridgeService` (stdout/stderr byte-limit chunks kept accumulating
after the limit was already crossed) was also repaired as shared correctness,
not new policy. Focused tests cover materialization/pin/staleness,
projection+reauthorization, all three mapping sources, schema
validation failures, deterministic invocation keys, the full atomic
admission/idempotency matrix (winner/loser/terminal-replay/conflict,
only-winner execution), the sandbox execution-support pure helpers, and the
`LimitedCollector` bound.

The 2026-07-17 parent/independent-audit repair pass is now landed locally and
the real `@persai/api`, `@persai/runtime`, and `@persai/sandbox` package suites
are green. Authored non-null Script references fail materialization closed
instead of degrading to `null`; `scriptRef` is required-nullable in the runtime
contract. The sandbox independently re-authorizes the exact assistant/Role/
Skill/SkillScript/ScriptVersion capability before atomic admission and again
before execution, recomputes the complete executable-contract hash, validates
input before persistence and output before terminal success, and persists
invalid output as typed failure. Transient files use an in-wrapper trap plus
bound-pod control-plane cleanup; cleanup uncertainty retires the pod. Result
framing uses a per-invocation final marker and the effective minimum of Script,
stdout, and single-file limits. The wrapper redirects ordinary entry-command
stdout to diagnostic stderr so stdout is reserved for framing; a direct
`/dev/stdout` bypass that exhausts the collector budget persists the precise
`stdout_limit_exceeded` terminal diagnostic rather than
`script_output_missing`. `manifest.workingDirectory` uses the existing
safe shell/exec cwd resolver. Reserved environment names, prototype-pollution
mapping names, extra tool-call fields, and incompatible schema projection are
rejected. `LimitedCollector` now retains exactly at most its byte limit. The
runtime gate includes production-dispatch coverage proving live todo/Skill
re-authorization and `refreshVolatilePrefix` add/remove behavior, plus the
ADR-149 tool-abort suite. An independent allowed-model runtime/security
re-audit returned CLEAN after exercising those package gates and focused
runtime/sandbox assertions. Remaining live-only probes are real Kubernetes
policy/cleanup behavior, true concurrent PostgreSQL idempotency races, and a
deployed model-driven warm-session `script.execute` turn.

A later session (2026-07-17) implemented the **Admin + MCP block** locally on
top of the audited Domain+API and Scenario+Runtime checkpoints:

- an Admin Scripts page (`apps/web/app/admin/scripts/page.tsx`) patterned after
  the existing Admin Roles page — master-detail list/create/edit of localized
  Script metadata over the immutable `key`, `draft`/`published`/`archived`
  status display, draft ScriptVersion authoring (code, manifest, environment,
  input/output JSON Schema, runtime, entry command, limits) with save/validate/
  publish actions, immutable published-version history, typed conflict/error
  surfacing (`admin_script_key_conflict`, `admin_script_in_use`,
  `admin_script_version_revision_conflict`, `admin_script_version_immutable`,
  `admin_script_archived`), and a Skill-bindings section using the existing
  `GET`/`PUT .../skills/{skillId}/scripts` routes to manage one Skill's full
  ordered Script list at a time. No second executor, no runtime smoke route
  was invented — the Admin API's existing `.../versions/{versionId}/validate`
  route is the only preview/validation surface; live model-driven
  `script.execute` remains an Admin-adjacent runtime capability, not something
  this page fakes;
- a `Code2`-icon Scripts entry added to the Admin navigation
  (`apps/web/app/admin/layout.tsx`), between Skills and Roles, consistent with
  existing Admin information architecture and its Clerk-gated layout auth;
- nine thin typed MCP tools added to `@persai/admin-mcp`
  (`packages/persai-admin-mcp/src/server.ts`): `script_list`, `script_get`,
  `script_upsert`, `script_version_upsert`, `script_version_validate`,
  `script_publish`, `script_archive`, `skill_scripts_list`,
  `skill_scripts_replace` — all resolving the immutable `scriptKey` through
  `GET /api/v1/admin/scripts` exactly like the existing `role_*` tools resolve
  `roleKey`, then calling the canonical Admin HTTP routes with no duplicated
  business logic. `script_version_upsert`/`script_version_validate`/
  `script_publish` auto-resolve the Script's current draft
  `versionId`/`expectedRevision` so callers never track internal IDs. The
  existing `skill_scenario_upsert` tool's step schema gained an optional
  `scriptRef: { scriptKey, inputMapping }` field (mirroring
  `apps/api`'s `SkillScenarioScriptRef`/`SkillScenarioScriptInputSource` exactly,
  including the `literal`/`current_user_message`/`tool_input` discriminated
  union, forbidden-key rejection, 32-entry/16,384-byte mapping bounds, and
  literal depth 8) — no new Scenario-authoring tool was added;
- focused tests: 18 web tests (`apps/web/app/admin/scripts/page.test.tsx`)
  covering draft/payload round-tripping, key/localization validation, EN/RU
  rendering, Script create, draft-version creation, Skill-binding full
  replace, the key-conflict error path, and exact PATCH-before-validate /
  PATCH-before-publish sequencing (including publication with the revision
  returned by PATCH), canonical local ScriptVersion validation, and
  deterministic stale Script/Skill load and mutation response races, plus
  guarded version-loading UX; 22 MCP tests
  (`packages/persai-admin-mcp/test/admin-scripts.test.ts`) covering every
  `request*` helper's exact HTTP path/body, fail-closed missing-key/no-draft
  paths, tool registration, the typed API error contour, Zod authoring parity
  (including the required-exact core body, Ajv Draft-2020-12 schema
  validity/size/depth, manifest environment/working-directory limits, and
  forbidden-key/runtime-pattern rejection), and the `skill_scenario_upsert`
  `scriptRef` step end-to-end with byte/depth bounds.

The first and second independent allowed-model Admin/MCP audits returned
**DIRTY**. The correction passes added canonical schema/trim normalization
parity, complete local metadata/version validation, stale async load and
mutation ownership, guarded version loading, and a full binding-control lock.
The final targeted re-audit returned **CLEAN** after 18 focused web tests,
39 full Admin MCP package tests (22 Script-focused), package lint/typecheck,
and diff/format checks. This block has not been deployed or live-accepted.

A later bounded P1 repair (2026-07-17) closed a gap in the runtime
materialization path: `skill-scenario-runtime-normalization.ts`'s hand-rolled
raw-`scriptRef` normalizer duplicated (imperfectly) the canonical Admin-side
`scriptRef` parser and silently canonicalized a malformed persisted non-null
`scriptRef` or a malformed nested `inputMapping`/source entry to `null`,
letting bundle materialization succeed as if the authored reference were
explicitly absent — even though the existing `adr151-script-domain` test only
proved this fail-closed invariant for the Admin-state serializer
(`toAdminSkillScenarioState`), not the actual runtime normalize+materialize
path used by `resolveAssistantRoleEffectiveSkillsPrompt`/bundle construction.
The repair makes the runtime normalization pass carry the raw persisted value
through unparsed and makes `script-ref-materialization.ts` the single
canonical materialization boundary: it now parses every non-null `scriptRef`
with the exact same exported `parseScriptRef` the Admin path uses (no
duplicated parsing logic) and throws the existing typed
`ScriptRefMaterializationError` (same `script_ref_materialization_unresolvable`
code, now with an optional `detail` message) for any malformed shape, before
any database round-trip. Explicit `null`/absent `scriptRef` is unaffected and
still resolves to `null` with zero Script lookups. Five new focused tests in
`script-ref-materialization.test.ts` exercise the production
`normalizeSkillScenarioSteps` → `materializeScenarioStepScriptRefs` path
directly for malformed top-level refs, non-object refs, malformed nested
mapping sources, malformed mapping shapes, and explicit null/absent success.
This is a bounded correctness repair, not a scope change: status remains
Accepted/Open, and no CLEAN/deploy/live claim is made for it.

## Context

PersAI has reusable Skills, structured Skill Scenarios, a role-only effective
Skill derivation (ADR-147), and a warm session sandbox with durable existing
`SandboxJob` telemetry (ADRs 148–150). It does not yet have a first-class,
versioned, reusable Script domain.

The platform needs deterministic pre-authored code that can be shared by
multiple Skills and invoked from one active Scenario step without creating a
second agent, workflow engine, or sandbox contour. The current sandbox already
has the required execution capabilities and safety lifecycle; ADR-151 must use
that path exactly rather than create a Script-specific executor.

## Decision

### 1. Platform-global Script and immutable published version

`Script` is a platform-global reusable catalog record. It has:

- stable immutable `key`;
- required localized RU/EN name and description metadata;
- `draft | published | archived` lifecycle;
- normal actor/timestamp audit;
- no workspace, Assistant, Role, or Skill ownership.

`ScriptVersion` has `draft | published` lifecycle. The current draft is editable
under optimistic concurrency; publication freezes that row permanently, and
later changes require another draft version. A published version contains the
complete executable contract:

- code;
- strict manifest;
- validated input and output schemas;
- runtime and entry command;
- timeout/resource limits;
- content hash.

The admission path resolves an exact published `ScriptVersion` before any
execution. Code or manifest is never copied into a Skill, Scenario, Job, or
prompt as an editable substitute for the selected version.

Publishing a replacement does not rewrite an already admitted bundle's pinned
immutable version. Archive is different: every new `script.execute` admission
revalidates live Script status and fails closed for an archived Script, including
requests from a stale bundle. An already-running `SandboxJob` may finish or be
cancelled through the normal lifecycle. Archive preserves ordinary audit/history
references.

### 2. Skill links and Role-only effective Skills

`Skill ↔ Script` is an ordered, full-replace many-to-many relation. A link
references the reusable Script; it never owns copied code or a private version.
Replacement is one ordered transaction, not additive merge semantics.

ADR-147 stays unchanged:

```text
Assistant -> Assistant.roleId -> AssistantRoleSkill -> active Skill
```

Effective Skills remain only the active Skills linked to the Assistant's Role.
Script links make a Script available to a Skill; they neither add direct
Assistant Skills nor change Role ownership, Skill prompt materialization,
Knowledge, `skill.engage`, or existing Scenario mechanics.

### 3. Scenario reference and synchronous model-mediated execution

`SkillScenarioStep` gains structured `scriptRef` and an explicit, bounded input
mapping. Authoring stores the stable `scriptKey`, not a version selector.
Materialization resolves the current published version and pins its exact
`scriptVersionId`, version number, and content hash in the admitted runtime
bundle. The reference resolves only to a Script linked to the owning Skill.

Each mapping entry is one strict discriminated source:

- literal JSON;
- the current user message;
- one named `tool_input` field supplied to `script.execute`.

The mapping has exact keys and bounded entries, depth, and serialized bytes. It
is not JSONPath, a template/expression language, executable interpolation,
arbitrary code, or an unbounded context dump.

The model invokes the synchronous provider-facing `script` tool with strict
`action: "execute"` only when that exact Scenario step is active. The operation
and durable internal `SandboxJob.toolCode` are named `script.execute`; the
provider-facing function name omits the dot for cross-provider tool-name
compatibility. It receives a normal structured tool result and continues the
same turn. A Script invocation does not auto-advance a Scenario and does not
create automatic workflow execution, background orchestration, durable
Scenario/Workflow runs, or a plan engine.

### 4. Script boundary: ordinary code, not nested PersAI

A Script is ordinary pre-authored code. It may use the existing sandbox network
and user-supplied credentials to call ordinary external APIs, including an
external model API. What it does not receive is a nested PersAI agent/runtime
surface. ADR-151 explicitly excludes:

- `ctx.llm`, nested Assistant turn, Scenario invocation, or PersAI Tool SDK;
- browser executor or local-browser bridge execution;
- async abstraction, `jobRef`, `wait`, `notify`, pause/resume, or `ScriptRun`;
- package factory, stubs, TODO scaffolding, aliases, compatibility reads, or
  dead feature flags.

These are not partial ADR-151 features. Tool SDK, async execution, browser
execution, and related model-visible utilities belong to ADR-152. Managed
secret infrastructure belongs to ADR-153.

### 5. Exact existing sandbox path

`script.execute` runs on the existing warm session sandbox path with no reduced
or alternate contour:

- same Assistant workspace;
- immutable image packages at `/opt/venv`, system tools, and Python/Node/Bash;
- current warm-pod session `.local`, `.npm-global`, and `node_modules`;
- current Assistant `restricted | full_public` egress choice;
- existing Stop, turn deadlines, resource limits, pod/lease behavior, and
  cleanup.

ADR-151 creates no separate pod, NetworkPolicy, image, staging-only filesystem,
package allowlist, stdlib-only restriction, or Script-specific sandbox policy.
It must not weaken any of those existing capabilities or controls.

ADR-150 remains authoritative for install-layer persistence: session-installed
packages survive commands only in the current live warm pod, never GCS, Files,
snapshot, or hydrate, and disappear when that pod recycles. Scripts cannot
depend on session-installed packages after cold start. Immutable image packages,
including future image additions, remain available.

### 6. Credentials before ADR-153

Before ADR-153, a user may put credentials directly in Script code or input.
They are not managed secrets. PersAI makes no promise of redaction, TTL, revoke,
or log/history protection for those values. ADR-151 introduces neither secret
storage nor secret-detection heuristics.

### 7. Existing SandboxJob is the invocation record

ADR-151 creates no `ScriptRun` table. Every invocation is an existing
`SandboxJob` with:

- `toolCode: "script.execute"`;
- nullable exact `scriptVersionId` foreign key;
- stable `scriptInvocationKey`;
- validated request/result;
- policy snapshot (runtime, code hash, timeout/limits);
- existing pod/resource/timestamps/cancel truth.

Admission is idempotent through nullable
`@@unique([assistantId, scriptInvocationKey])`:

1. the same key while running polls the existing job;
2. the same key after terminal state replays the stored result;
3. a missing key atomically creates one job;
4. the same key with a different resolved version or validated input returns
   `idempotency_conflict`.

This is admission/replay idempotency, not exactly-once external side effects.
Scripts should pass the same invocation key to providers that support
idempotency.

### 8. Admin and MCP authoring

The Admin Scripts page follows the existing Admin Roles visual language and
quality. It manages catalog metadata, versions/lifecycle, and ordered Skill
links through the ordinary API.

MCP is a thin operator wrapper over those real APIs:

- Script list/get/upsert/publish/archive;
- ordered Skill–Script replacement;
- Scenario `scriptRef` authoring;
- existing real chat smoke.

There is no direct MCP Script execution or package factory. Deployment and live
acceptance happen only at the final program gate.

## Data model target

The implementation will add the following durable domain shape, with exact
names/migration details settled in the schema block:

```text
Script
  1 -> many ScriptVersion
  many <-> many Skill through ordered SkillScript

SandboxJob
  -> ScriptVersion? (exact published version)
  -> assistantId + scriptInvocationKey unique when key is present

SkillScenarioStep JSON
  -> scriptRef? + bounded inputMapping?
```

`ScriptVersion` is append-only after publication. `SkillScript` is ordered and
full-replace. `SandboxJob` remains the canonical operational/cancel/result
record; there is no duplicate Script-run lifecycle.

## API and runtime target

The future public/admin API will expose Script catalog lifecycle, ordered
Skill–Script replacement, and Scenario script-reference authoring. Exact
OpenAPI request/response names belong to the domain/API implementation block.

Runtime adds one model-facing synchronous `script` tool with
`action: "execute"` only for the active Scenario step and only when the
referenced Script is available through that step's owning effective Skill. Its
internal operation code is `script.execute`. It resolves/persists the exact
version, validates inputs and results, and delegates execution to the normal
sandbox job path. No direct MCP execution path is introduced.

## Execution blocks

1. **Domain + API:** schema/migration, Script/version lifecycle, ordered links,
   Scenario reference validation, OpenAPI/contracts, and Admin API. Requires an
   independent allowed-model audit for schema/migration work.
2. **Scenario + runtime:** active-step projection, `script.execute`, exact
   version/idempotent SandboxJob admission, result polling/replay, and existing
   sandbox delegation. Requires an independent allowed-model audit for
   runtime/security work.
3. **Admin + MCP:** Admin Scripts page matching Admin Roles, thin MCP wrappers,
   and existing real chat smoke. **Implemented locally 2026-07-17** (Admin
   Scripts page + navigation entry + nine MCP tools + `scriptRef` scenario
   authoring + focused web/MCP tests); independent audit, deploy, and live
   chat-smoke acceptance still pending.
4. **Final audits/gates:** independent schema and runtime/security audits,
   focused tests, full repository verification, deployment, and founder live
   acceptance.

No implementation block creates legacy aliases, dual reads, dead stubs, TODO
scaffolding, or deploys before the final gate.

## Consequences

Positive:

- deterministic reusable code is a versioned catalog artifact, not copied
  Scenario text;
- existing sandbox investment, egress choice, Stop, deadline, and cleanup
  controls apply unchanged;
- normal idempotent admission/replay is durable without another run model;
- Role-only effective Skill authority remains intact.

Residuals deliberately deferred:

- no managed secret guarantee before ADR-153;
- no browser, Tool SDK, async/resume, job reference, or wait/notify support
  before ADR-152;
- external effects remain at-least-once from the provider perspective unless
  the Script forwards its invocation key to an idempotent provider;
- session-installed dependencies are warm-pod-local and may disappear at cold
  start per ADR-150.

## Verification target

Implementation must add focused coverage for:

1. Script/version lifecycle, localized metadata, immutable key/version/hash,
   and archive behavior;
2. ordered full-replace Skill links and proof that Role-only effective Skills
   remain unchanged;
3. Scenario reference and bounded input-mapping validation;
4. exact-version resolution, request/result schema validation, and active-step
   projection only;
5. `SandboxJob` idempotent admission: running poll, terminal replay, atomic
   create, and `idempotency_conflict`;
6. inherited warm-pod sandbox capabilities, Stop/deadline/cancel cleanup, egress,
   and ADR-150 cold-start install-layer behavior;
7. Admin Roles-quality Scripts UI and MCP wrappers over real APIs, including
   chat smoke;
8. the repository verification gate in `AGENTS.md` before the final deployment
   gate.
