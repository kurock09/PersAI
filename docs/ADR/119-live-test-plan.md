# ADR-119 Live Test Plan — comprehensive coverage matrix

**Status:** Operational checklist. Companion to `docs/ADR/119-prompt-architecture-and-2026-context-engineering.md` and `docs/ADR/119-prompt-inventory.md`.

**Purpose:** Drive a single live-testing session against `persai-dev` (`https://persai.dev`) that exercises every meaningful prompt zone, every native tool family, the active scenario path, cache behavior across turns, and error/recovery paths. The output of a run against this plan is a structured findings report that lists every observed deviation from the ADR-119 design plus a per-turn payload snapshot.

**Pre-conditions (verify before starting):**

1. `infra/helm/values-dev.yaml` has `PERSAI_DEBUG_PROVIDER_PAYLOAD: "true"` and `PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "1.0"` on `providerGateway.env`. Confirm via `kubectl -n persai-dev describe pod -l app.kubernetes.io/name=provider-gateway | Select-String PERSAI_DEBUG`.
2. Two provider-gateway pods are `1/1 Running` on the current image.
3. Browser session at `https://persai.dev/app/chat` is authenticated as the founder account (assistant `Nica` visible in the sidebar). If the session is missing, stop and ask the user to sign in — never attempt to sign in autonomously.
4. A dedicated log tail is running and writes to a local file: `kubectl -n persai-dev logs -f -l app.kubernetes.io/name=provider-gateway --tail=0 --max-log-requests=5`.
5. A dedicated runtime log tail is running: `kubectl -n persai-dev logs -f -l app.kubernetes.io/name=runtime --tail=0 --max-log-requests=5`.
6. The git tree is clean (`git status --short` empty) — every change observed during testing should come from running code, not local edits.

If any precondition fails, stop and report which one and why. Do not improvise around it.

## Output artifact

Produce a single markdown report `docs/ADR/119-live-test-findings-<YYYY-MM-DD>.md` with the following shape:

```
# ADR-119 live test findings — <date>

## Pre-conditions
... (verbatim verification of the 6 items above) ...

## Test matrix results
For each row below: PASS / FAIL / SKIP, with one-line rationale. Link to the captured request id, expected behavior, observed behavior, and a 5-line excerpt of the relevant log dump.

## Aggregated findings
Bug-style list, ranked by severity. Each entry: title, evidence (request id + line), affected code path, suggested fix.

## Cache effectiveness summary
A small table: turn N, cache_creation_input_tokens, cache_read_input_tokens, total input tokens, output tokens, model_role. Compute hit-rate.

## Recommendations
Prioritized list of follow-up slices (P0 / P1 / P2) with brief justification.
```

## Test matrix

### Zone A — baseline conversational + persona / voice

| ID | Action | Expected | Capture |
|---|---|---|---|
| A1 | New thread. Send: "Привет, представься коротко." | One-paragraph self-intro. Gender-correct self-reference ("я готова", not "я готов"). No tool calls. No date mentioned. | request id, full provider payload dump (system + messages preview), assistant rendered reply. |
| A2 | In the same thread send: "Какое сейчас число и день недели?" | Answer must mention both weekday and absolute date (year + month + day). **Known gap:** as of today the prompt only carries `current_local_weekday` + `current_local_time`, so the model invents the year. Record verbatim. | full provider payload dump. Confirm `<persai_environment>` is present in `<persai_developer_instructions>` and inspect exact placeholders. |
| A3 | "Напиши ровно: PING-2026. Без пояснений." | Reply is the exact 9-char string `PING-2026`. | shape of follow-up assistant message envelope. |

### Zone B — memory protocol

| ID | Action | Expected | Capture |
|---|---|---|---|
| B1 | "Запомни: я предпочитаю встречи во вторник утром в 9:30." | Assistant calls `memory_write` exactly once with concise text matching the preference. Confirms in voice. UI shows "Выполнено" status. | tool_use payload arguments JSON; assistant follow-up text; `provenance` value on the resulting `AssistantMemoryRegistryItem` (use api admin endpoint or query DB). Must be `system_inferred` per Slice 9. |
| B2 | In a follow-up turn ask: "Какое моё предпочтение по встречам?" | Assistant answers from memory without re-fetching. The provider payload must contain a `<persai_memory>` block including the just-written entry with `provenance="system_inferred"`. | payload dump; verify entry surfaces in `<persai_memory>` with correct provenance attribute. |
| B3 | "Забудь это предпочтение." | Assistant calls `memory_delete` (or equivalent revoke path). Memory disappears from subsequent payloads. | tool_use args + verification that B2 follow-up no longer returns the entry. |

### Zone C — native tool selection (ADR-117 selection guide)

For each tool below, send the listed user message in a fresh thread or after `skill({action:"release"})` if a Skill is active. Capture the chosen native tool name from the assistant tool_use call.

| ID | Action | Expected tool | Notes |
|---|---|---|---|
| C1 | "Нарисуй пиксельную сову в космическом шлеме." | `image_generate` | Must NOT call `image_edit` (no source). |
| C2 | "Возьми эту картинку и сделай ярче, более насыщенные цвета." (attach an image first) | `image_edit` | Series-mode flag absent. |
| C3 | "Сделай карусель из 5 вариантов этой картинки в разных стилях." (attach image) | `image_edit` with `outputMode="series"` and `seriesItems` array of 5 prompts | Verify schema: `seriesItems` are plain strings (no `{prompt:...}` objects). |
| C4 | "Сделай короткое видео где собака виляет хвостом." | `video_generate` | Single tool, no `image_generate` precursor. |
| C5 | "Скажи это голосом: Привет, как дела?" | `tts` | No `image_generate`. |
| C6 | "Найди свежие новости про OpenAI Devday 2026." | `web_search` then optional `web_fetch` | `knowledge_search` must NOT be called (no relevant docs). |
| C7 | "У меня в загрузках есть PDF с условиями договора, найди раздел про оплату." | `knowledge_search` first, then `knowledge_fetch` | Must NOT go to `web_search` first. |
| C8 | "Сгенерируй PDF-резюме на одну страницу на основе этого диалога." | `document` | Not `files.write_and_send`. |
| C9 | "Положи этот файл мне в чат." (after a `document` call) | `files.send` | Description-only does not count as delivery. |
| C10 | "Напомни мне завтра в 10:00 позвонить маме." | `scheduled_action` | Not `background_task`. |
| C11 | "Каждое утро проверяй курс доллара и пиши, если изменится больше чем на 1%." | `background_task` | Not `scheduled_action`. |
| C12 | "Открой страницу https://example.com/login и зайди в аккаунт." | `browser` | Not `web_fetch`. |

### Zone D — Skills + scenarios (progressive disclosure)

Pre-requisite: ensure at least one Skill is enabled on Nica with at least one scenario that has a `firstStepPreview` populated (Slice 10). If absent, create one via the admin UI; if creation fails, stop and report.

| ID | Action | Expected | Capture |
|---|---|---|---|
| D1 | User message that matches the Skill's domain (use the Skill's `when_to_use` examples). | First tool call this turn is exactly `skill({action:"engage", skillId, scenarioKey?})`. NO other tool calls in the same response. | provider payload `<enabled_skills>` block must contain progressive-disclosure shape with `<first_step_preview>` (Slice 3). Confirm body / guardrails / examples are NOT inlined. |
| D2 | After `engage`, the assistant should ask the question of step 1 of the scenario. | Turn payload now contains `<persai_active_scenario>` (Slice 4) with `expectedUserResponse`, `nextStepTrigger`, and step body. | dump + verify XML tag names. |
| D3 | User pivots away from the Skill: "Забыли, давай вместо этого посчитай 17×23." | Assistant calls `skill({action:"release"})` and answers the arithmetic. | tool_use args + `<persai_active_scenario>` disappears from subsequent payloads. |
| D4 | While a scenario is active, send a deliberately off-topic short message: "ок". | The system MUST emit a `<system-reminder>` of kind `scenario_tick` (Slice 5) in the next payload reminding the model of the current step. | grep payload for `<system-reminder>`. |

### Zone E — sandbox + deferred document jobs (PDF hotfix regression)

| ID | Action | Expected | Capture |
|---|---|---|---|
| E1 | "Сделай PDF на 1 страницу про Москву: история, климат, метро." | `document` tool call succeeds. Job goes to "pending_delivery". Within reasonable time (target: under 90s), a follow-up assistant turn says the PDF is delivered and includes a file attachment. NO assistant hang. | runtime logs: `document.deferred.run.start` → `document.deferred.run.success`. Anthropic call uses streaming aggregation (no high-`max_tokens` 400). |
| E2 | "Сделай PDF на 10 страниц подробный про солнечную систему: каждая планета своя страница." | Same as E1 with longer max_tokens. Should NOT 400. | Verify `messages.stream().finalMessage()` path is used (search anthropic-provider client logs for `[anthropic-non-stream-start]` even though it's calling generateText). |
| E3 | "Сделай инфографику-PDF с диаграммой Венна про преимущества Python vs JavaScript." | Schema with `maxItems` does not crash. | Verify `sanitizeAnthropicStructuredOutputSchema` strips `maxItems`/`minItems` from log. |

### Zone F — cache effectiveness across turns

Use a fresh thread. Send three short turns in succession ("Привет 1.", "Привет 2.", "Привет 3.") within ~30 seconds.

| ID | Action | Expected | Capture |
|---|---|---|---|
| F1 | Turn 1 | `cache_creation_input_tokens` > 0, `cache_read_input_tokens` = 0 | response usage block; `cacheBreakpoints` from metadata. |
| F2 | Turn 2 | `cache_read_input_tokens` > 0 (system prefix hit). `cache_creation_input_tokens` may grow for the moving window. | usage block. |
| F3 | Turn 3 | Same as F2; the moving window keeps caching the prior turn's bytes. | usage block. |
| F4 | Compute hit rate. | After ADR-119 Slice 15 (multi-BP system blocks), expect ≥75% of system tokens to read from cache by turn 2. Currently with 1 BP, expect ≥60%. Record actual. | summary table. |

### Zone G — parallel-tool discipline (Slice 2)

| ID | Action | Expected | Capture |
|---|---|---|---|
| G1 | With a Skill enabled and active, prompt requesting two parallel-eligible actions ("Нарисуй сову и параллельно сделай tts из текста 'Привет'.") | Assistant emits ONE tool call this turn (not two). Anthropic payload contains `tool_choice` with `disable_parallel_tool_use: true`. | dump search for `disable_parallel_tool_use`. |
| G2 | With Skills disabled (`/admin/skills` toggle off, or use an assistant with zero enabled Skills), repeat G1. | Assistant MAY emit two tool calls in parallel. Anthropic payload does NOT set `disable_parallel_tool_use`. | dump. |

### Zone H — error / recovery paths

| ID | Action | Expected | Capture |
|---|---|---|---|
| H1 | Force a context-window blow by pasting ~50KB of arbitrary text and asking a question. | Recovery developer instruction kicks in; assistant responds honestly without retrying tools. | runtime logs for `context-window-recovery` branch. |
| H2 | Call a tool with intentionally invalid args (e.g. "сделай image_edit но без картинки"). | Assistant either refuses politely or calls `image_generate` instead. Does NOT retry `image_edit` with identical bad args. | tool_use sequence. |

## Operating rules for the run

- **Never sign in or change auth** in the browser. If kicked out, stop and report.
- **Never write code** during the run. If a bug is suspected in the runtime, log it as a finding — fixes go through a separate slice.
- **One thread per zone where practical** so cache observations are not contaminated.
- **Capture request ids from the metadata log line** (`[anthropic-non-stream-start]` / `[anthropic-stream-start]`) and copy the matching `provider_payload_dump` from the same log file. Reference them in the findings report.
- **Never paste secrets or personally identifying user data into the chat.** All test prompts above are PII-free; do not improvise content that would log a real email, phone, or address.
- If a step matches an already-known gap (date in A2, single cache breakpoint in F4, durable memory prose in any zone), still record it for completeness with a pointer to the open follow-up slice.
- Time budget: target the whole matrix in one focused 60–90 minute run. If stalled on any zone, skip the rest of that zone (record SKIP rationale) and continue with the next.

## Cleanup after the run

- Stop both `kubectl logs -f` tails.
- Delete the local log capture files.
- Do not unset `PERSAI_DEBUG_PROVIDER_PAYLOAD` — it lives in gitops and stays on for `persai-dev`.
- Commit the findings report on the current branch with the message: `docs(adr-119): live test findings <date>` and DO NOT push (leave it for the user to review).

## Acceptance criteria for the run

The session is "complete" when:

1. Every matrix row has a verdict (PASS / FAIL / SKIP with rationale).
2. At least one full provider payload dump is attached for each Zone (A through H).
3. Cache effectiveness table is filled with real numeric values.
4. Aggregated findings list is ranked and references concrete request ids.
5. Recommendations point at named code paths (file:line) or named follow-up slices.
