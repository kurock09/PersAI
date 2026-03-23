# API-BOUNDARY

## API style

REST only.
Path versioning: /api/v1/...

## Step 1 endpoints

- GET /health
- GET /ready
- GET /metrics

## Step 2 endpoints

- GET /api/v1/auth/verify
- GET /api/v1/me
- POST /api/v1/me/onboarding

## Step 3 A2 assistant lifecycle skeleton endpoints

- POST /api/v1/assistant
- GET /api/v1/assistant
- PATCH /api/v1/assistant/draft
- POST /api/v1/assistant/publish
- POST /api/v1/assistant/rollback
- POST /api/v1/assistant/reset
- POST /api/v1/assistant/reapply
- GET /api/v1/assistant/runtime/preflight

### POST /api/v1/assistant

Behavior baseline:

- authenticated caller only
- creates assistant for current user if absent
- rejects create when assistant already exists for current user (`1 user = 1 assistant`)
- requires caller workspace membership (assistant is workspace-scoped)
- no OpenClaw/runtime calls

### GET /api/v1/assistant

Behavior baseline:

- authenticated caller only
- returns assistant lifecycle skeleton state:
  - `id`, `userId`, `workspaceId`
  - `draft.displayName`, `draft.instructions`, `draft.updatedAt`
  - `latestPublishedVersion` (nullable)
  - `runtimeApply`:
    - `status`: `not_requested | pending | in_progress | succeeded | failed | degraded`
    - `targetPublishedVersionId`
    - `appliedPublishedVersionId`
    - `requestedAt`, `startedAt`, `finishedAt`
    - `error` (`code`, `message`) nullable
  - `governance`:
    - `capabilityEnvelope`
    - `secretRefs`
    - `policyEnvelope`
    - `quotaPlanCode`
    - `quotaHook`
    - `auditHook`
    - `platformManagedUpdatedAt`
  - `materialization`:
    - `latestSpecId`
    - `publishedVersionId`
    - `sourceAction`
    - `algorithmVersion`
    - `contentHash`
    - `generatedAt`
    - `openclawBootstrapDocument`
    - `openclawWorkspaceDocument`
  - `createdAt`, `updatedAt`
- returns not found if assistant has not been created yet

### PATCH /api/v1/assistant/draft

Request body fields (at least one required):

- `displayName` (string | null)
- `instructions` (string | null)

Behavior baseline:

- authenticated caller only
- updates mutable draft fields only
- does not create published versions
- does not perform runtime apply/openclaw actions
- returns not found when assistant does not exist

### POST /api/v1/assistant/publish (Step 3 A3 baseline)

Behavior baseline:

- authenticated caller only
- requires existing assistant for caller
- creates new immutable published snapshot version from current draft
- version number is per-assistant incremental (`1,2,3,...`)
- returns assistant lifecycle state with `latestPublishedVersion` set to newly published version
- sets `runtimeApply` target to the newly published version and executes runtime apply through adapter
- final apply state is explicit in response (`succeeded|failed|degraded`, or `in_progress` if runtime is still ongoing)
- does not mutate historical published versions

### POST /api/v1/assistant/rollback (Step 3 A4 baseline)

Request body fields:

- `targetVersion` (integer, >= 1)

Behavior baseline:

- authenticated caller only
- requires existing assistant and existing published target version
- **does not mutate** old published rows
- creates a new latest published version snapshot copied from `targetVersion`
- updates current draft to the same rolled-back snapshot values
- sets `runtimeApply` target to rollback-created published version and executes runtime apply through adapter
- final apply state is explicit in response (`succeeded|failed|degraded`, or `in_progress` if runtime is still ongoing)

### POST /api/v1/assistant/reset (Step 3 A4 baseline)

Behavior baseline:

- authenticated caller only
- requires existing assistant
- creates new assistant state without deleting platform attachment layer
- creates new latest published version with blank snapshot (`displayName=null`, `instructions=null`)
- resets draft to blank values (`displayName=null`, `instructions=null`)
- sets `runtimeApply` target to reset-created published version and executes runtime apply through adapter
- preserves:
  - ownership/user binding
  - workspace scope
  - billing scope (not modified in this slice)
  - secret bindings/integration attachment layer (not modified in this slice)
- final apply state is explicit in response (`succeeded|failed|degraded`, or `in_progress` if runtime is still ongoing)

### POST /api/v1/assistant/reapply (Step 3 A8 baseline)

Behavior baseline:

- authenticated caller only
- requires existing assistant and existing latest published version
- does not create a new published version
- executes runtime apply against latest materialized published spec with `reapply=true`
- updates `runtimeApply` state with explicit lifecycle outcome

### GET /api/v1/assistant/runtime/preflight (Step 3 A8 baseline)

Behavior baseline:

- authenticated caller only
- executes adapter preflight probes:
  - `GET /healthz`
  - `GET /readyz`
- returns minimal preflight state:
  - `live`
  - `ready`
  - `checkedAt`

## Step 3 A5 apply-state separation rule

- Publish truth and apply truth are distinct:
  - publish/rollback/reset produce published version truth in `latestPublishedVersion`
  - runtime apply progress/outcome is tracked separately in `runtimeApply`
- In A8, runtime adapter now drives apply-state transitions:
  - `pending -> in_progress -> succeeded|failed|degraded`
- runtime failures are persisted with coarse stable error code/message in `runtimeApply.error`.

## Step 3 A6 governance separation rule

- Governance is modeled as platform-managed control-plane layer, separate from user-owned draft/version truth.
- Governance baseline is storage + response shape only:
  - no behavior routing engine
  - no runtime/OpenClaw calls
  - no full quotas/tools engines
- User-owned lifecycle truth remains:
  - draft state in `assistants`
  - immutable published versions in `assistant_published_versions`
- Platform-managed governance truth is separate:
  - envelopes/hooks in `assistant_governance`

## Step 3 A7 materialization rule

- Backend materializes assistant deterministically from layered inputs:
  - user-owned published version layer
  - platform governance layer
  - ownership/apply context layer
- Materialization is projected into OpenClaw-native outputs:
  - `openclaw_bootstrap`
  - `openclaw_workspace`
- Materialization artifacts are versionable/auditable:
  - stored per published version (`published_version_id` unique)
  - deterministic diff documents (`layers_document`, `openclaw_*_document`)
  - integrity hash (`content_hash`)
- A8 consumes these materialized artifacts for runtime apply/reapply.

### GET /api/v1/me (slice 2 baseline response)

- Returns current internal app user (`app_users`) for authenticated caller.
- Includes onboarding status:
  - `completed` when a workspace membership exists
  - `pending` when no workspace membership exists yet
- Includes current workspace summary if one exists:
  - `id`, `name`, `locale`, `timezone`, `status`, `role`

### POST /api/v1/me/onboarding (slice 3 baseline request/behavior)

Request body fields:

- `displayName`
- `workspaceName`
- `locale`
- `timezone`

Behavior baseline:

- authenticated caller only
- idempotent upsert-style flow
- updates `app_users.display_name`
- creates workspace if user has no membership yet
- creates/updates workspace membership for caller
- updates current workspace summary fields (`name`, `locale`, `timezone`) consistently

## Auth model

- web protects routes
- web sends Bearer token
- api validates Clerk JWT itself
- api resolves/auto-creates internal `app_users` record on first authenticated access
- web uses a typed client module for `/api/v1/me` and `/api/v1/me/onboarding` calls (no scattered raw fetch in UI)

## Error envelope

```json
{
  "error": {
    "code": "SOME_CODE",
    "category": "validation|auth|forbidden|conflict|infra|unknown",
    "message": "Human-readable message",
    "details": {}
  },
  "requestId": "..."
}
```

## Contract source of truth (Step 2 + Step 3 A2-A8)

- OpenAPI spec: `packages/contracts/openapi.yaml`
- Generated typed client (Orval): `packages/contracts/src/generated/*`
- Frontend consumption baseline remains typed-client only via `@persai/contracts`

## OpenClaw integration contract baseline (Step 3 O6 + A8)

This section defines backend-to-OpenClaw adapter rules.
Runtime calls are implemented only through dedicated infrastructure adapter.

Transport choice for first adapter step:

- **HTTP** (not WebSocket) for first integration boundary.
- Why:
  - control-plane request/response shape is easier to bound
  - timeout/retry/failure mapping is deterministic
  - aligns with already verified dev endpoints (`/healthz`, `/readyz`)

First supported adapter interactions:

- runtime preflight:
  - `GET /healthz`
  - `GET /readyz`
- minimal adapter output to backend:
  - `live: boolean`
  - `ready: boolean`
  - `checkedAt: string` (timestamp)
- runtime apply/reapply:
  - `POST /api/v1/runtime/spec/apply`
  - payload source is A7 materialized documents (`openclawBootstrap`, `openclawWorkspace`, `contentHash`)
  - `reapply` flag is explicit in request body

Allowed backend knowledge:

- OpenClaw base URL and token config references
- timeout/retry settings
- coarse runtime status (`live`, `ready`, degraded)

Forbidden leakage into backend/domain language:

- provider/channel/tool execution internals
- memory/reasoning/runtime-behavior internals
- OpenClaw-specific internal endpoint or state semantics outside approved boundary

Expected boundary error classes:

- `runtime_unreachable`
- `auth_failure`
- `timeout`
- `invalid_response`
- `runtime_degraded`
