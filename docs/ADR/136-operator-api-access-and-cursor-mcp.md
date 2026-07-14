# ADR-136: Operator API access and Cursor MCP for skill authoring + chat smoke

## Status

**Closed locally 2026-07-05** — Slices S1–S3 landed locally; deploy + live Cursor acceptance pending the next dev rollout.

## Date

2026-07-05

## Baseline SHA

`2739c833` on `main`. Implementation starts only from a **clean git tree**.

## Founder-locked decisions (audit checklist)

Use this section to verify the ADR matches what was agreed in review. If any row disagrees with code during implementation, stop and reconcile.

| # | Decision | Locked answer |
|---|----------|---------------|
| 1 | Auth for Cursor / MCP | **`PERSAI_OPERATOR_TOKEN`** + **`PERSAI_OPERATOR_ACTOR_USER_ID`** or **`PERSAI_OPERATOR_ACTOR_EMAIL`** — not Clerk JWT |
| 2 | Reuse `PERSAI_INTERNAL_API_TOKEN` on public routes | **No** — internal token stays `/internal/*` only |
| 3 | In-process Nest bootstrap / Prisma from MCP | **No** — HTTP-only thin wrapper over existing API |
| 4 | Second user bearer for chat vs admin | **No** — one operator token impersonates one actor `app_users.id` |
| 5 | Goal in smoke tests | **MCP parameter only** — echoed in tool result for Cursor model; **not** persisted in API |
| 6 | Scenario schema in MCP | **Full pass-through** — same JSON as `POST/PATCH /admin/skills/:id/scenarios/:key` (all step fields) |
| 7 | Skill assign semantics | **`PUT /assistant/skills` replaces full `skillIds[]`** — MCP must merge with current list |
| 8 | Publish before scenario smoke | **Anthropic workflow** — `assistant_publish` before each scenario test |
| 9 | Anthropic working table | **Out of product scope** — model maintains its own table in Cursor |
| 10 | Clerk in `mcp.json` | **No** — operator env only |

### Explicitly rejected (do not reintroduce)

- Clerk JWT or refresh flow in MCP config
- `PERSAI_INTERNAL_API_TOKEN` on `/admin/*` or `/assistant/chat/web`
- Automated PASS/FAIL scorer in API (goal evaluation stays in Cursor model)
- CSV/table import endpoint or PersAI-owned authoring spreadsheet
- `authoring/draft` as required MCP path (optional later; scenarios + PDF upload are manual/tool-driven)
- New admin UI for operator workflow

## Orchestration model

This ADR is a **single bounded slice**, not a multi-week program.

- The **parent agent** owns this ADR, dispatches S1–S3, reviews every diff, verifies invariants, reconciles docs, and decides closure.
- **Implementation subagents** use GPT-5.4 or Sonnet unless the orchestrator documents a concrete reason otherwise.
- Subagents must not broaden scope, add provider-specific MCP transports beyond stdio v1, or duplicate existing `scripts/smoke` as the product MCP server.
- If docs and code disagree at slice start, the orchestrator pauses and reconciles before code changes.
- No TODO scaffolding.

## Founder directive

Founder and Anthropic in Cursor need **fast, simple tools** to:

1. Fill admin Skills end-to-end: core fields, text knowledge cards, PDF documents, scenarios (many per skill, full step schema).
2. Assign skills to the founder's active assistant, publish materialized bundle, wait for indexing when needed.
3. Run **chat smoke** against real web chat transport so Cursor can read assistant replies, **inbound and outbound attachments**, tool calls (`skill.engage`, knowledge retrieval), and compare against a **goal** string the model supplies per test.

Clerk login is for the web app only. Operator MCP must work with three env vars and Cursor `mcp.json`.

## Relationship to prior ADRs

- **Builds on ADR-079** — admin Skills, documents, knowledge cards, assignments, indexing jobs already exist.
- **Builds on ADR-118 / ADR-119** — scenario schema, `skill.engage`, bundle materialization; MCP does not change runtime semantics.
- **Builds on ADR-016 / ADR-017** — sync web chat `POST /api/v1/assistant/chat/web` and staged attachments (`stage-attachment` + `clientTurnId` merge).
- **Does not reopen** ADR-130, ADR-133, ADR-134, ADR-135, or closed skill/prompt programs.
- **Does not replace** `scripts/smoke` — that harness remains Clerk-based CI smoke; operator MCP is founder Cursor workflow only.

## Context

### Problem

Today the founder must use admin UI + Clerk session to author skills and web UI to smoke-test scenarios. Anthropic in Cursor has no first-class API bridge. Existing APIs are complete but require Clerk JWT on every public route. `PERSAI_INTERNAL_API_TOKEN` authorizes runtime→`/internal/*` only and must not be exposed to Cursor on public ingress.

### What already exists (no new domain work)

| Surface | Endpoints |
|---------|-----------|
| Skill core | `POST/PATCH /api/v1/admin/skills/:id` |
| Text KB | `POST/PATCH /api/v1/admin/skills/:id/knowledge-cards` |
| File KB | `POST /api/v1/admin/skills/:id/documents` (multipart) |
| Scenarios | `POST/PATCH/GET /api/v1/admin/skills/:id/scenarios/:key` |
| Indexing jobs | `GET /api/v1/admin/knowledge-indexing/jobs` |
| Assign | `GET/PUT /api/v1/admin/skills` **not** — `GET/PUT /api/v1/assistant/skills` |
| Publish | `POST /api/v1/assistant/publish` |
| Chat sync | `POST /api/v1/assistant/chat/web` |
| Stage user attachment | `POST /api/v1/assistant/chat/web/stage-attachment` |
| Fetch chat file bytes | `GET /api/v1/assistant/chats/web/:chatId/files/preview?path=...` |

Admin skill routes use `assertCanWriteGlobalKnowledge` (platform-scoped admin role). Skills/scenarios/publish **do not** require step-up.

### Actor prerequisites

`PERSAI_OPERATOR_ACTOR_USER_ID` must resolve to an `app_users` row that has:

- platform-scoped admin role (`super_admin` or other role allowed by `assertCanWriteGlobalKnowledge`);
- email allowed when `PERSAI_ADMIN_ALLOWLIST_EMAILS` is set;
- an **active assistant** for `ResolveActiveAssistantService`.

## Decision

### D1 — Operator authentication

Add two API env vars:

```text
PERSAI_OPERATOR_TOKEN              — long random secret (dev helm secret v1)
PERSAI_OPERATOR_ACTOR_USER_ID      — uuid of founder app user
```

Extend `ClerkAuthMiddleware` (or equivalent single choke point on clerk-protected routes):

1. If `Authorization: Bearer <token>` equals configured `PERSAI_OPERATOR_TOKEN` (timing-safe compare), load `app_users` by `PERSAI_OPERATOR_ACTOR_USER_ID` and set `req.resolvedAppUser` / `req.userId` — **skip Clerk**.
2. Otherwise existing Clerk JWT path unchanged.
3. If operator token is configured but actor user missing → `401` with clear message at request time (or fail-fast at boot — pick one in S1 and document).

Operator auth applies to the same route allowlist already registered in `identity-access.module.ts` for clerk middleware (includes `/admin/skills/*`, ADR-147 S4 `/admin/roles/*`, `/assistant/skills`, `/assistant/{assistantId}/role`, `/assistant/publish`, `/assistant/chat/web`, `/assistant/chat/web/stage-attachment`, chat file preview routes).

**v1 scope:** dev environment only; document rotation runbook; no separate operator ingress / IP allowlist in v1.

### D2 — MCP package (`packages/persai-admin-mcp`)

Stdio MCP server (`@modelcontextprotocol/sdk`) started from Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "persai": {
      "command": "node",
      "args": ["packages/persai-admin-mcp/dist/index.js"],
      "env": {
        "PERSAI_API_BASE_URL": "https://api.persai.dev",
        "PERSAI_OPERATOR_TOKEN": "...",
        "PERSAI_OPERATOR_ACTOR_USER_ID": "..."
      }
    }
  }
}
```

HTTP client: `fetch` + `FormData` for multipart. Types: reuse `packages/contracts` OpenAPI shapes where practical; scenario/step JSON documented in tool schemas.

**Not in MCP env:** `CLERK_*`, `PERSAI_INTERNAL_API_TOKEN`.

### D3 — MCP tool surface (v1)

#### Skill authoring (admin)

| Tool | API | Notes |
|------|-----|-------|
| `skill_upsert` | `POST` or `PATCH /admin/skills` | core + `instructionCard`; default `status: active` when creating for smoke |
| `skill_get` | `GET /admin/skills/:id` + `GET .../scenarios` | aggregate view incl. documents, cards, scenarios, job hints |
| `skill_card_upsert` | `POST` or `PATCH .../knowledge-cards` | default `lifecycleStatus: active`, `provenanceKind: manual` |
| `skill_document_upload` | `POST .../documents` | local `filePath` → multipart |
| `skill_scenario_upsert` | `POST` or `PATCH .../scenarios/:key` | **full API body** — all scenario + step fields |
| `indexing_wait` | poll jobs + `skill_get` statuses | by `jobIds[]` and/or `skillId`; timeout configurable |

#### Assistant (actor user scope)

| Tool | API | Notes |
|------|-----|-------|
| `assistant_skills_assign` | `GET` + `PUT /assistant/skills` | **merge** new ids into `assignedSkillIds` then replace |
| `assistant_publish` | `POST /assistant/publish` | sync materialize + apply |

#### Chat smoke + attachments (actor user scope)

| Tool | API | Notes |
|------|-----|-------|
| `chat_stage_attachment` | `POST .../chat/web/stage-attachment` | `surfaceThreadKey`, `clientTurnId`, local file → staged attachment |
| `chat_smoke` | `stage` (optional) + `POST .../chat/web` | see D4 |
| `chat_fetch_attachment` | `GET .../chats/web/:chatId/files/preview?path=` | returns base64 or temp path metadata so Cursor can inspect PDF/image/text |

`chat_smoke` may accept `attachmentPaths[]` — tool stages each file with shared `clientTurnId` then sends message (same contract as web UI).

### D4 — Chat smoke result shape (Cursor-readable)

`chat_smoke` calls sync transport (`POST /assistant/chat/web`), not stream v1.

**Inputs:**

- `surfaceThreadKey` (reuse across multi-turn scenario test)
- `message`
- optional `clientTurnId` (generate if omitted)
- optional `attachmentPaths[]`
- optional `goal` — **evaluation hint only**; returned in tool output, not written to API

**Outputs (structured JSON for Cursor model):**

```json
{
  "goal": "<echo if provided>",
  "thread": { "surfaceThreadKey": "...", "chatId": "...", "clientTurnId": "..." },
  "userMessage": {
    "content": "...",
    "attachments": [{ "id", "path", "mimeType", "originalFilename", "processingStatus", "documentLink" }]
  },
  "assistantMessage": {
    "content": "...",
    "attachments": [{ "...": "same shape" }],
    "toolInvocations": [{ "name", "ok", "iteration", ... }],
    "workingNotes": ["..."]
  },
  "skillState": {
    "status", "activeSkillId", "activeSkillName", "activeScenarioKey", "activeScenarioDisplayName"
  },
  "engagementSummary": { "skillDisplayName", "scenarioDisplayName" },
  "turnRouting": { "...": "subset of transport.runtime.turnRouting" },
  "activeMediaJobs": [],
  "activeDocumentJobs": [],
  "evaluationHint": "Compare assistantMessage and toolInvocations to goal. PASS/FAIL is model-owned."
}
```

**Timeouts:** MCP HTTP client must allow ≥ `PERSAI_RUNTIME_TURN_TIMEOUT_MS` (300s default).

**Multi-turn:** same `surfaceThreadKey` across `chat_smoke` calls; new `clientTurnId` per turn unless replay semantics needed.

### D5 — Indexing wait semantics

- After text cards (`lifecycleStatus: active`) or document upload, indexing jobs are created automatically.
- `indexing_wait` polls `GET /admin/knowledge-indexing/jobs` and/or re-fetches `skill_get` until relevant documents/cards are `ready` or jobs `completed` / fails with last error.
- No new `?skillId=` query param on API in v1 — track `jobId` from upload/create responses.

### D6 — Security and ops

| Topic | Rule |
|-------|------|
| Token storage | Helm dev secret + founder global `~/.cursor/mcp.json`; never commit token |
| Audit | Log `authMode: operator` on request context when operator branch used (nice-to-have in S1) |
| Abuse limits | Operator chat smokes consume real quota / abuse counters — document pacing for bulk scenario tests |
| Prod | v1 documents dev-only; prod ingress requires explicit follow-up ADR slice |

### D7 — Non-goals (v1)

- Clerk in MCP
- Automated goal assertion in API
- Scenario generation inside `authoring/draft`
- SSE/stream chat MCP tool
- Operator access to step-up-gated admin actions (billing credentials, plan delete, …)
- Extending `scripts/smoke` to operator token

## Work plan

### Standard gate (closure)

- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- focused tests: operator auth middleware, one MCP client unit test (mock fetch)
- manual: Cursor connects MCP, `skill_upsert` + `chat_smoke` with attachment round-trip on dev

### S1 — Operator auth + config

- Add `PERSAI_OPERATOR_TOKEN`, `PERSAI_OPERATOR_ACTOR_USER_ID` to `packages/config` `api-config.ts` (optional vars; operator branch active only when both set).
- Implement operator branch in `ClerkAuthMiddleware`.
- Tests: valid operator token → resolved actor; invalid token → 401; clerk path unchanged; admin skill route with operator + super_admin actor → 200.
- Touch `docs/API-BOUNDARY.md` operator section.

### S2 — `packages/persai-admin-mcp`

- New workspace package, stdio server, shared `PersaiOperatorClient`.
- Implement D3 tools with full scenario JSON pass-through.
- `chat_smoke` + `chat_stage_attachment` + `chat_fetch_attachment` per D4.
- README: build, `mcp.json`, env, example Anthropic workflow (fill skill → wait index → assign → publish → smoke with goal).

### S3 — Dev deploy truth + closure

- `infra/helm/values-dev.yaml` secret key placeholders for operator env (empty default until founder sets).
- Update `CHANGELOG.md`, `SESSION-HANDOFF.md`, `AGENTS.md` active program → closed.
- Manual acceptance on dev API with Cursor.

## Orchestrator dispatch reference

| Slice | Primary packages | Key files | Focused tests |
|-------|------------------|-----------|---------------|
| **S1** | `@persai/api`, `@persai/config` | `clerk-auth.middleware.ts`, `api-config.ts`, `identity-access.module.test.ts` | new operator auth tests |
| **S2** | `packages/persai-admin-mcp` | new package | client unit tests |
| **S3** | `infra/helm`, docs | `values-dev.yaml`, README | manual Cursor checklist |

## Risks and residuals

| Risk | Mitigation |
|------|------------|
| Operator token leak | Dev-only v1, rotation doc, separate from internal token |
| `PUT assistant/skills` clobber | `assistant_skills_assign` always merge |
| Smoke without publish | Document + tool description: publish before scenario test |
| 300s chat timeout | MCP fetch timeout aligned with API config |
| Bulk smoke hits abuse rate limit | Document ~8 req/min user slowdown; pace tests |
| Large PDF upload in MCP | Same `MAX_MEDIA_FILE_BYTES` as API; clear errors |
| Preview binary in MCP context | `chat_fetch_attachment` size cap + text extract for PDFs where practical |

## Acceptance criteria

1. Operator token + actor userId authenticate on `/admin/skills` and `/assistant/chat/web` without Clerk.
2. `PERSAI_INTERNAL_API_TOKEN` unchanged — cannot call admin/chat public routes.
3. MCP `skill_scenario_upsert` accepts full scenario + step schema; API validation errors surface verbatim.
4. MCP `chat_smoke` returns assistant text, `toolInvocations`, `skillState`, and **attachment metadata** for user and assistant messages.
5. MCP can **stage a local file** and send a turn; assistant reply attachments can be **fetched** via `chat_fetch_attachment`.
6. `goal` appears only in MCP tool I/O, not in persisted scenario or chat rows.
7. Cursor `mcp.json` documented; no Clerk vars required.

## References

- ADR-079 — Skills and knowledge architecture
- ADR-118 / ADR-119 — scenarios and skill tool engage
- ADR-016 — web chat sync transport
- `scripts/smoke/lib/api-client.ts` — sync chat response parsing precedent (not dependency)
- Founder review 2026-07-05 — operator MCP scope, no Clerk, full scenario schema, chat attachments for Cursor smoke
