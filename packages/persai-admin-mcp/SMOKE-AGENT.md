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

**Smoke messages must sound like a real user** — no tool names, no `outputMode=series`, no hex codes unless the user would naturally say them. The scenario directives carry tool parameters; the tester carries product intent.

Example user thread (reuse `surfaceThreadKey`):

1. `Сделай instagram-карусель про запуск курса «Деньги без паники» для ИП. CTA — записаться на бесплатный вебинар.`
2. Answer brief questions in plain language (audience, tone, taboo).
3. `Структура ок, поехали` / `да, утверждаю копию`
4. If model asks before visuals: `да, делай картинки`
**Platform rule (in scenario, not user messages):** up to **8** `image_edit` per turn; if N slides don't fit one series call — split into 2+ `image_edit` series jobs with the same `sourceImageAlias`. **Second job may run in parallel with the first** in the same turn when the limit allows — do not wait for first-batch delivery.

| Check | PASS signal |
|-------|----------------|
| Skill engaged | `skillActivation.activeScenarioKey === "instagram_carousel"` |
| Plan seeded | `plan.todos` mirrors scenario steps (~6 items) |
| Style-ref first | `toolSignals` shows `image_generate` **before** `image_edit` when no user attachment |
| Series on source | `image_edit` ok=true with worker execution; not `image_generate` for each slide |
| Slides delivered | `chat_inspect_attachments` or follow-up messages with image attachments |
| Visual QA | Same palette/composition family across slides; copy shown beside visuals |

## Env (optional)

`PERSAI_MCP_ARTIFACT_DIR` — where inspected files are saved (default: OS temp `persai-mcp-artifacts/`).

Set in `~/.cursor/mcp.json` for stable paths, e.g. `C:/Users/alex/Documents/PersAI/.persai-smoke-artifacts`.
