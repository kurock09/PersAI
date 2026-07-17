# @persai/admin-mcp

Stdio MCP server for PersAI operator workflows (ADR-136 + ADR-147 S4 + ADR-151): admin Skill authoring, admin Role authoring/assignment, admin Script authoring/publishing + Skill-Script bindings, assign/publish, and web chat smoke with attachments.

## Cursor setup

Add to `~/.cursor/mcp.json` (recommended — keeps secrets out of git):

```json
{
  "mcpServers": {
    "persai": {
      "command": "node",
      "args": ["C:/Users/alex/Documents/PersAI/packages/persai-admin-mcp/dist/index.js"],
      "env": {
        "PERSAI_API_BASE_URL": "https://api.persai.dev",
        "PERSAI_OPERATOR_TOKEN": "<from helm / dev secret>",
        "PERSAI_OPERATOR_ACTOR_EMAIL": "kurock09@gmail.com"
      }
    }
  }
}
```

Build first: `corepack pnpm --filter @persai/admin-mcp run build`

## Env

| Variable | Required | Description |
|----------|----------|-------------|
| `PERSAI_API_BASE_URL` | yes | e.g. `https://api.persai.dev` |
| `PERSAI_OPERATOR_TOKEN` | yes | Operator bearer (not Clerk) |
| `PERSAI_OPERATOR_ACTOR_USER_ID` | one of | Founder `app_users.id` |
| `PERSAI_OPERATOR_ACTOR_EMAIL` | one of | e.g. `kurock09@gmail.com` |

Optional: `PERSAI_MCP_CHAT_TIMEOUT_MS` (default 310000), `PERSAI_MCP_INDEXING_TIMEOUT_MS` (600000).

## Tools

- `skill_list`, `skill_upsert`, `skill_get`, `skill_card_upsert`, `skill_document_upload`, `skill_scenario_upsert`
- `role_upsert`, `role_get`, `role_list`, `role_skills_replace`, `assistant_role_assign`
- `script_list`, `script_get`, `script_upsert`, `script_version_upsert`, `script_version_validate`, `script_publish`, `script_archive`
- `skill_scripts_list`, `skill_scripts_replace`
- `indexing_wait`, `assistant_publish`
- `chat_stage_attachment`, `chat_smoke`, `chat_list_deliverables`, `chat_inspect_attachments`, `chat_fetch_attachment`

Role tools use immutable `roleKey`, resolve `roleId` through `GET /api/v1/admin/roles`, then call the roleId Admin HTTP routes. `role_skills_replace` is full replacement only. `assistant_role_assign` requires exact `assistantId` + `roleKey` and calls `PUT /api/v1/assistant/{assistantId}/role`.

Script tools (ADR-151) use immutable `scriptKey`, resolve `scriptId` through `GET /api/v1/admin/scripts`, then call the scriptId Admin HTTP routes. `script_upsert` only writes core metadata (name/description/category/icon/color/displayOrder); `script_version_upsert` authors the draft `code`/`manifest`/`inputSchema`/`outputSchema`/`runtime`/`entryCommand`/`limits` and auto-resolves `expectedRevision` against the Script's existing draft (creates the first draft if none exists). `script_version_validate` checks the draft's executable contract without publishing. `script_publish` auto-resolves the current draft's `versionId`/`expectedRevision` and permanently freezes it. `script_archive` fails with `admin_script_in_use` while a live Skill or Scenario still references the Script. `skill_scripts_replace` is full replacement only (all `scriptIds` must reference published Scripts). `skill_scenario_upsert` step bodies additionally accept an optional `scriptRef: { scriptKey, inputMapping }` to bind a step to a published Script.

`skill_list({})` returns the canonical unfiltered `GET /api/v1/admin/skills` payload, including Skill UUIDs and current metadata. Use it before `skill_get`, `role_skills_replace`, or catalog migration; it does not add local filtering, sorting, pagination, or response projection.

**Cursor agents:** read [`SMOKE-AGENT.md`](./SMOKE-AGENT.md) for PASS/FAIL workflow (skill/scenario/todos + vision QA on delivered images).

`chat_smoke` returns:

- `skillActivation` — merged skill/scenario state (`status`, `activeSkillId`, `activeScenarioKey`, `engagementSummary`, `retrievalPlan`)
- `toolSignals` — grouped `skill` / `todo_write` / `memory_write` tool calls from the turn
- `plan` — chat todo list from `GET /assistant/chats/web/:chatId/plan`
- `assistantMessage`, attachments, legacy `skillState` / `turnRouting`
- `pendingDelivery` + `deliveryCheck` when media tools ran (poll deliverables next)

Optional: `PERSAI_MCP_ARTIFACT_DIR` — local folder for `chat_inspect_attachments` / `chat_fetch_attachment` saves.

## Typical flow

1. `skill_list` → `skill_get` for canonical existing Skill ids/metadata
2. `skill_upsert` → cards → documents → `indexing_wait`
3. `script_upsert` → `script_version_upsert` → `script_version_validate` → `script_publish`
4. `skill_scripts_replace` (full ordered Script ids) and/or `skill_scenario_upsert` step `scriptRef`
5. `skill_scenario_upsert` (status active)
6. `role_upsert` → `role_skills_replace` (full ordered Skill ids) → `assistant_role_assign`
7. `assistant_publish`
8. `chat_smoke` with `goal` for Cursor-side PASS/FAIL
