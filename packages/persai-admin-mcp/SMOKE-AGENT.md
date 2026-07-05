# Cursor agent — PersAI smoke evaluation

Use this playbook when testing skills, scenarios, and media delivery via `@persai/admin-mcp`.

## Turn workflow (text + tools)

1. **`chat_smoke`** with `goal` and reuse `surfaceThreadKey` for multi-turn.
2. Check **`skillActivation`**: `status`, `activeScenarioKey`, `engagementSummary`.
3. Check **`toolSignals`**: `skill`, `todo_write`, media tools (`image_generate`, `image_edit`).
4. Check **`plan.todos`**: scenario steps mirrored as in_progress / pending / completed.

Do **not** fail the turn only because `pendingDelivery: true` — that is normal web UX.

## Media / carousel workflow (after turn)

When `deliveryCheck` is set or `toolSignals` show image tools:

1. **`chat_list_deliverables(chatId)`** — poll until `attachmentMessages` is non-empty.
2. **`chat_inspect_attachments(chatId)`** — downloads **full** files to disk.
3. **Read each `localPath`** in Cursor — vision-check slides (copy on image, layout, count, brand).

Optional: **`chat_fetch_attachment`** for a single `path` (`variant: "full"`, `saveLocally: true`).

## Scenario example (Marketer `instagram_carousel`)

| Check | PASS signal |
|-------|----------------|
| Skill engaged | `skillActivation.activeScenarioKey === "instagram_carousel"` |
| Plan seeded | `plan.todos` has ~5 items after engage turn |
| Slides delivered | `chat_inspect_attachments` returns 4 image `localPath`s |
| Visual QA | Read images: approved copy visible, narrative arc hook→offer |

## Env (optional)

`PERSAI_MCP_ARTIFACT_DIR` — where inspected files are saved (default: OS temp `persai-mcp-artifacts/`).

Set in `~/.cursor/mcp.json` for stable paths, e.g. `C:/Users/alex/Documents/PersAI/.persai-smoke-artifacts`.
