# PersAI smoke harness (ADR-074 Slice S0)

CLI инструмент для прогонов сценариев `web_sync` / `web_stream` против реального
`apps/api` и сбора **объективных** метрик из `runtime_turn_receipts` (token usage,
tool calls, routing mode, auto-compaction).

Этот пакет — фундамент для всех последующих slices ADR-074: до и после изменения
сравниваем `summary.json` против baselines и видим прирост/регресс по токенам,
tool-loop'ам и латентности.

> Слайс S0 целенаправленно НЕ автоматизирует судейство контента (humanity check).
> На S0 founder читает ответы вручную; LLM-judge придёт в Q11-C.

---

## Что делает

1. Берёт сценарий из `scripts/smoke/scenarios/<id>.json` (одна или несколько сессий, у каждой свой `surfaceThreadKey` с уникальным суффиксом).
2. Шлёт каждый ход через `POST /assistant/chat/web` (или `/assistant/chat/web/stream`) от лица real Clerk-юзера (`SMOKE_USER_BEARER`).
3. Получает `requestId` из ответа.
4. Поллит внутренний эндпоинт `/api/v1/internal/smoke/turn-receipts?assistantId=...&requestId=...` (защищён `PERSAI_INTERNAL_API_TOKEN`) пока статус receipt'а не выйдет из `accepted`.
5. Складывает `trace.json` (полный per-turn raw) и `summary.json` (агрегаты) в `scripts/smoke/artifacts/<runId>/`.
6. Если в `scripts/smoke/baselines/<id>.summary.json` есть baseline — печатает дельту по токенам, латентности, tool-counts, успехам/фейлам.

## Структура

```
scripts/smoke/
├── run-scenario.ts              # CLI entry
├── lib/
│   ├── api-client.ts            # web sync / web stream + internal receipts client
│   ├── harness.ts               # per-scenario оркестратор
│   ├── reporter.ts              # запись artifacts + baseline diff
│   ├── scenario.ts              # JSON loader + валидация
│   ├── trace.ts                 # агрегации trace -> summary
│   └── workspace.ts             # ENV + пути
├── scenarios/                   # 6 стартовых JSON сценариев
├── baselines/                   # *.summary.json (создаются --update-baseline)
└── artifacts/                   # gitignored, выход прогонов
```

## ENV

Обязательные:

- `SMOKE_USER_BEARER` — Clerk session JWT тестового юзера (как в `LIVE-TEST-HYBRID.md`).
- `PERSAI_INTERNAL_API_TOKEN` — тот же, что у API; используется только для чтения receipts.
- `SMOKE_ASSISTANT_ID` — `assistantId` владельца юзера (uuid). Receipts фильтруются по нему.

Опциональные:

- `SMOKE_API_BASE_URL` (default `http://127.0.0.1:3001`) — куда стучимся. Под live-dev → `http://127.0.0.1:8080` после `kubectl port-forward` (см. `docs/LIVE-TEST-HYBRID.md`).
- `SMOKE_ARTIFACTS_DIR` (default `scripts/smoke/artifacts`).
- `SMOKE_FETCH_TIMEOUT_MS` (default `120000`).
- `SMOKE_RECEIPT_POLL_TIMEOUT_MS` (default `30000`).
- `SMOKE_RECEIPT_POLL_INTERVAL_MS` (default `500`).
- `SMOKE_SURFACE_THREAD_PREFIX` (default `smoke`).

## Использование

```bash
# из корня репо
pnpm smoke:run --scenario chitchat-short
pnpm smoke:run --scenario long-session-200 --update-baseline
pnpm smoke:run --scenario tool-heavy-search --scenario chitchat-short
pnpm smoke:run-all
pnpm smoke:run-all --update-baseline
```

Для воспроизводимости можно зафиксировать суффикс thread key:

```bash
pnpm smoke:run --scenario onboarding --thread-suffix s0-2026-04-20
```

После прогона:

```
scripts/smoke/artifacts/onboarding-2026-04-20T12-00-00-000Z/
├── trace.json     # полный per-turn raw (request, response text, receipt)
├── summary.json   # агрегаты (tokens, latency p50/p95/p99, tool counts, routing, auto-compaction)
└── console.txt    # человекочитаемый лог + baseline diff
```

## Сценарии (S0 starter set)

| id                         | Что проверяет (для последующих slices ADR-074)                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `onboarding`               | Базовая «человечность» приветственного флоу. M1/V1: имя должно подхватываться.        |
| `chitchat-short`           | Per-turn token cost. P1: input ≥5x ↓. L1: ≤1 tool call.                               |
| `long-session-200`         | Auto-compaction + recall. M2: суб-линейный рост токенов, recall на ходе ~22-24.       |
| `tool-heavy-search`        | Tool dispatch без регрессий. R2: ≤2 round-trips на пакет fetches. R3: compound tools. |
| `multi-session-continuity` | Cross-session memory. M3: session 2 помнит контекст session 1.                        |
| `emotional-long`           | Voice DNA. V1: средний reply ↓, нет шаблонных фраз. На S0 — ручная проверка.          |

`long-session-200.json` — стартовый набор ~30 ходов. После того как baselines стабилизируются, можно расширить до полноценных 200, чтобы P1/M2 были измерены в полном объёме.

## Зачем receipt-полл, а не парсинг ответа

`AssistantWebChatTurnState` намеренно не отдаёт token-usage наружу: usage — это
внутренняя метрика. `RuntimeTurnReceipt.resultPayload` — единственный канонический
источник `usageAccounting`, `turnRouting`, `autoCompaction`. Поэтому harness:

- получает `requestId` (уникален) от публичного API;
- через internal endpoint находит соответствующий receipt;
- маппит его в `SmokeReceipt` (см. `apps/api/src/modules/workspace-management/application/read-smoke-turn-receipts.service.ts`).

Это даёт harness'у **тот же объективный взгляд**, что и админский dashboard и
ADR-073 retrieval explorer, без дублирования усечённой логики.

## Что дальше (Slices ADR-074, использующие этот harness)

- **P1 (stable prefix engineering):** ожидается ≥5x ↓ input tokens на `chitchat-short` и `long-session-200`, без регресса на `tool-heavy-search`.
- **V1 (Voice DNA scaffold):** ожидается ↓ среднего reply length на `emotional-long`, отсутствие forbidden phrases (на S0 проверяет founder через `console.txt`).
- **M1 (durable memory):** ожидается, что `multi-session-continuity` session 2 помнит факты из session 1.
- **M2 (multi-level compaction):** `long-session-200` не упирается в context budget, рост токенов суб-линейный, recall в конце успешен.
- **L1/R2/R3 (tool loop):** `chitchat-short` ≤1 tool call, `tool-heavy-search` ≤2 round-trips для пакета fetches, ≥30% ↓ wall-clock.

Каждый из этих slices использует команду:

```bash
pnpm smoke:run --scenario <id>
```

и сравнивает текущий `summary.json` с baseline в `scripts/smoke/baselines/<id>.summary.json`.
Сначала пишется baseline (`--update-baseline`), потом катаются изменения, и diff в
`console.txt` — это дешёвая, объективная метрика результата.
