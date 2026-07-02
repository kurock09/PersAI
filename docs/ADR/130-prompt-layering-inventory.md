# ADR-130 Slice 0 — Prompt-layering inventory & budget ledger

Status: **Slice 0 deliverable (inventory only, no behavior change).**
Owner: parent orchestrator. Workers: 3× GPT-5.4 read-only audits (per-tool table, system-prefix owners, stale-tests/cache-guard).
Date: 2026-07-02. Baseline SHA in ADR-130: `01dfefca`.

This is the executable ledger every later ADR-130 slice follows. Each row names a concrete string with `file:line` and a keep/move/delete decision. Sizes are approximate char counts of the model-facing text (method: literal string length in source; interpolation placeholders counted as variable). No code changed in this slice.

Owner model (ADR-117): cross-tool "which/when-not" → **selection guide** (`tools` template only); per-tool mechanics/params → **descriptor path** (catalog → runtime-tool-policy → native-tool-projection); provider-rendering hygiene → **runtime-contract fragments** (provider code only); large/dynamic catalogs → **lazy read-only actions**.

---

## 0. Key structural facts (must-read before any slice)

1. **One hash over the whole system prefix.** `compile-prompt-constructor.service.ts:160-175` builds `systemPrompt` and calls `toStablePrefix(systemPrompt)`; `packages/runtime-bundle/src/index.ts:296-303` = `sha256(trimmed systemPrompt)`. BP1/BP2/BP3 are **logical zones inside one byte-stable hash**, not separately hashed segments. Runtime cache token = `ordinary_prompt.v1.<hash>` (`turn-execution.service.ts:5992-6035`).
2. **Providers cache the whole prefix as one unit.** Anthropic: single `cache_control` on `tools + system` (`anthropic-provider.client.ts:828-869`). OpenAI: exact longest-prefix match, `systemPrompt` must be `input[0]` (`openai-provider.client.ts:1420-1438`). ⇒ any prefix edit is one full-prefix invalidation event.
3. **Volatile is already positioned correctly.** `active_scenario` / `chat_plan` / `system_reminder` carry `cacheRole:"volatile_context"` and are spliced in just before the current user question by both provider clients (`turn-execution.service.ts:746-752`; anthropic `748-805`; openai `1445-1490`). D8 tool-history replay must join this volatile/tail lane, never the prefix.
4. **`TOOL_DESCRIPTION_CAP = 1024` is a false floor.** It caps only `description + usageGuidance` inside `resolveToolDefinitionDescription` (`native-tool-projection.ts:2084-2118`). Post-merge hints (`appendToolDefinitionHint`) are added **after** the cap → `video_generate` and image tools bypass it.
5. **Much projection prose is already dead.** When `policy.description` is non-null it wins, so long `native-tool-projection.ts` fallback paragraphs are maintenance debt, not live budget. Live outliers are `video_generate` and `document`.

---

## 1. Per-tool optimization table (24 model-facing tools)

Size legend: `catalog` = `modelDescription+modelUsageGuidance` (tool-catalog-data.ts); `policy` = override (runtime-tool-policy.ts); `proj` = live projected `description`+schema post-hint (native-tool-projection.ts); `bypass` = whether hints exceed the 1024 cap.

| Tool | Size (catalog / policy / proj, bypass) | KEEP INLINE | → MOVE TO ACTION (lazy) | → SELECTION-GUIDE | → PROVIDER-ONLY | DELETE (dup/stale) |
|---|---|---|---|---|---|---|
| `summarize_context` | ~0.8k / – / ~0.8k, no | read-only summary + `instructions` | – | "use compact_context instead" (bootstrap L390-391) | – | dead fallback proj L466-469 |
| `compact_context` | ~0.8k / – / ~0.8k, no | durable compaction + `instructions` | – | "use summarize_context" (bootstrap L394-395) | – | dead fallback proj L480-483 |
| `memory_write` | ~1.0k / – / ~1.8k, no | `action/kind/memory/layer/confidence/closeOpenLoop/ref` | – | "call immediately when you learn X" (catalog L491; bootstrap L197) | – | dup catalog L486-499 vs hidden default bootstrap L396-399; dead fallback proj L504-506 |
| `todo_write` | ~3.0k / – / ~2.7k, no | action set + id/parent/status schema | – | plan-open/scenario-intake orchestration (catalog L511-520) | – | scenario-intake dup with `skill` (catalog L479-480 vs L519-520) |
| `quota_status` | ~1.6k / shadow / ~1.6k, no | `action/toolCode/targetPlanCode/paymentMethodClass/confirmed` | – | "use BEFORE knowledge retrieval" (catalog L323-324; bootstrap L403) | – | shadow `persai_tool_quota_status` catalog L317-331 vs hidden `quota_status` bootstrap L400-403; dead fallback proj L637-643 |
| `knowledge_search` | ~0.8k / shadow / ~1.3k, **yes** | `source/query/maxResults` + snippet contract | – | "use BEFORE web tools" (catalog L220-221; bootstrap L185) | – | shadow `memory_search` catalog L215-227 vs hidden bootstrap L404-407; dead fallback proj L727-728 |
| `knowledge_fetch` | ~0.7k / shadow / ~1.2k, **yes** | `source/referenceId` | – | "call knowledge_search first" (catalog L239-240; bootstrap L411) | – | shadow `memory_get` catalog L235-246 vs hidden bootstrap L408-411; dead fallback proj L768-769 |
| `web_search` | ~0.55k / – / ~1.1k, **yes** | `query/count` | – | "exact URL→web_fetch / local sources first" (catalog L25-31; bootstrap L185) | – | dead fallback proj L687-692 |
| `web_fetch` | ~0.5k / – / ~1.15k, **yes** | `url/extractMode/maxChars` | – | "URL unknown→web_search / interactive→browser" (catalog L44-50) | – | dead fallback proj L814-819 |
| `browser` | ~0.6k / – / ~1.8k, no | `action/url/maxChars/operations[]` | – | "static→web_fetch / no URL→web_search" (catalog L200-207; bootstrap L245) | – | dead fallback proj L852-855 |
| `image_generate` | ~0.45k / – / ~2.0k, **yes** | `prompt/count/outputMode/seriesItems/filename/size/background` | – | "new image only, not when source exists" (catalog L62-63; bootstrap L189-194) | series/collage rules proj L938-944, L968-975 overlap runtime-contract L4194-4239 | pending-delivery honesty dup catalog L67-68 / bootstrap L211-212 / proj L85-98 |
| `image_edit` | ~0.9k / – / ~2.4k, **yes** | `prompt/sourceImageAlias/referenceImageAliases/count/outputMode/seriesItems/…` | – | "not for OCR/analysis/deliverable" (catalog L82-83; bootstrap L191-194) | reference-guidance + series proj L1008-1014, L1058 overlap runtime-contract L4210-4229 | pending-delivery honesty dup catalog L89-90 / bootstrap L211-212 |
| **`video_generate`** | ~0.6k / – / **~5-7k, yes** | `prompt/mode/speechText/speechLanguage/personaId xor portraitImageAlias/voiceKey/`cinematic refs/audio/duration/size | **`list_personas()`, `list_voices({mode,locale?})`, `describe_avatar_mode()`** ← persona catalog, voice shortlists, cinematic-vs-talking_avatar tutorial (proj L1089-1141) | "still image→image_* / audio only→tts" (catalog L103-104; bootstrap L189-193) | – (mostly dynamic-selection bloat, not provider hygiene) | dynamic catalog/tutorial bypasses cap proj L1091-1116, L1129-1138; pending honesty dup catalog L108-110 |
| `tts` | ~0.5k / – / ~1.7k, no | `text` + structured delivery + `deliveryKind` | – | "spoken audio vs text reply" (catalog L182-183; bootstrap L193) | "PersAI compiles your structured choices into provider steering" proj L1258-1260 | dead fallback proj L1257-1261; honesty dup catalog L187-188 |
| **`document`** | **~4.0k** / – / **~5.0k (schema)**, no | action enum + `path/projectPath/outputPath/format/edits/rerender/replace/docId/sourceManifestPath/inspectionPath` | **`describe_workflow({kind})`** ← 9 examples, LibreOffice import path, project/collision semantics | "use presentation / reply directly / files.attach to resend" (catalog L124-145; bootstrap L224-237) | – | dead fallback proj L1322-1333; workflow dup catalog L136-146 / bootstrap L229-237 |
| `presentation` | ~1.2k / – / ~2.4k, no | `descriptorMode/prompt/outputFormat/docId/style/imagePolicy/density/targetSlideCount` | (later) `describe_workflow({kind})` | "not for ordinary PDF/DOCX/XLSX; PPTX only export" (catalog L159-169; bootstrap L226,229-230) | – | dead fallback proj L1544-1556 |
| `scheduled_action` | ~1.1k / – / ~1.9k, no | CRUD + schedule + `reminderText` | – | conditional-vs-unconditional split (catalog L268-269; bootstrap L241-242) | – | dead fallback proj L1669-1671 |
| `background_task` | ~1.1k / – / ~1.9k, no | CRUD + `brief` + schedule + `pushPolicy` | – | quiet-monitoring routing (catalog L289-290; bootstrap L241-242) | – | dead fallback proj L1755-1759 |
| **`files`** | ~3.0k / **~3.0k (live)** / ~1.9k, no | six actions + `/workspace/...` path + `scope/crossScope/replace/maxBytes/maxDepth` | (optional later) `files.describe_scope()` | cross-tool routing (policy L139-154; catalog L348-365; bootstrap L217-224,237) | – | **shadow owner: policy override L124-154 supersedes catalog (comment L344-346)**; dead fallback proj L1831-1833 |
| `grep` | ~0.8k / – / ~1.35k, no | regex/content-search mechanics | – | "prefer grep over shell grep/rg" (catalog L424-435; bootstrap L221-223) | – | dead fallback proj L1900-1902 |
| `glob` | ~0.7k / – / ~1.2k, no | `pattern/path` | – | "prefer glob over find/fd" (catalog L447-456; bootstrap L221) | – | dead fallback proj L1946-1948 |
| `exec` | ~0.55k / – / ~1.1k, no | `command/args/cwd` | – | "plain IO→files / pipelines→shell" (catalog L377-385) | – | dead fallback proj L1972-1974 |
| `shell` | ~2.3k / – / ~1.1k (clipped), no | minimal command/cwd contract | **`shell.describe_environment()`** ← env/egress/install tutorial (catalog L396-412) | search/find/tool-choice prose (catalog L396-412; bootstrap L221-223) | – | dead fallback proj L2002-2004 |
| `skill` | ~1.6k / – / ~1.3k, no | `action/skillId/scenarioKey` | **`skill.list({category?})`, `skill.describe({skillId,scenarioKey?})`** ← scenario detail/guardrails/examples/long body | engage/release routing (catalog L469-479; bootstrap L179-180,249-252) | – | dead fallback proj L2030-2032; scenario-intake dup with `todo_write` |

### 1b. Shadow / non-model-visible inventory (creates owner drift)
| Row | Status | Evidence |
|---|---|---|
| `cron` | internal-only | tool-catalog-data.ts L252-260 |
| `persai_workspace_attach` | migration-only helper | tool-catalog-data.ts L303-314; runtime-tool-policy L121-135 |
| `memory_search` → `knowledge_search` | shadow source | runtime-tool-policy L77-79, L411-430 |
| `memory_get` → `knowledge_fetch` | shadow source | runtime-tool-policy L77-79, L411-430 |
| `persai_tool_quota_status` → `quota_status` | shadow source | runtime-tool-policy L73-79, L411-430 |

### 1c. Ranked heaviest LIVE descriptors
1. `video_generate` ~5-7k (persona/voice catalogs appended past cap; large schema L1143-1248)
2. `document` ~5.0k (schema L1336-1533)
3. `todo_write` ~2.7k (schema L565-627)
4. `image_edit` ~2.4k (cap-bypass hints L1002-1020 + schema)
5. `presentation` ~2.4k (schema L1558-1659)
6. `image_generate` ~2.0k (cap-bypass series/pending hints + schema)
7. `files` ~1.9k (capped override + schema L1835-1892)
8. ~1.8-1.9k cluster: `scheduled_action`, `background_task`, `memory_write`, `browser`

### 1d. New lazy actions required (smallest set with biggest win)
- **`video_generate`**: `list_personas()`, `list_voices({mode:"cinematic"|"talking_avatar", locale?})`, `describe_avatar_mode()`
- **`document`**: `describe_workflow({kind:"extract"|"inspect"|"render"|"edit"|"register_version"|"import_office_to_pdf"|"authored_one_call"})`
- **`skill`** (already implied by D2): `list({category?})`, `describe({skillId, scenarioKey?})`
- **`shell`** (lower priority): `describe_environment()`

---

## 2. System-prefix owner table (P2/D3)

Assembly: `system` template (bootstrap L34-72) via compile-prompt-constructor L512-532. Legacy fallback concat lives in runtime-bundle/src/index.ts L359-402 (second render path — must also be cleaned).

| Fact / block | Current owner(s) — file:line | Single target owner | Delete (dup) | Stale? |
|---|---|---|---|---|
| Assistant name | plain line compile L131-135; `<voice>` bootstrap L76; `<identity>` bootstrap L134; legacy concat runtime-bundle L362,384 | `<identity>` | plain line L134; voice name L76; legacy L362/384 | no |
| Assistant gender fact | `<voice>` bootstrap L77; `<identity>` bootstrap L135 | `<identity>` | voice gender line L77 | no |
| Gendered self-reference mechanics | `<voice><gendered_self_reference>` bootstrap L81-88; `<response_contract><must>` bootstrap L57 | `<voice>` | response-contract gender rule L57 | no |
| Avatar emoji/URL | `<identity>` bootstrap L134-138 | `<identity>` | – | no |
| User name | plain line compile L135-138; `<user>` bootstrap L124; legacy L365/387 | `<user>` | plain line L138; legacy L365/387 | no |
| User birthday/gender | `<user>` bootstrap L123-131 | `<user>` | – | no |
| Locale | plain line compile L139; `<user>` bootstrap L127; legacy L366/388 | `<user>` | plain line L139; legacy L366/388 | no |
| Timezone | plain line compile L140; `<user>` bootstrap L128; legacy L367/389 | `<user>` | plain line L140; legacy L367/389 | no |
| Voice mechanics | `<voice>` bootstrap L74-117 | `<voice>` | (only remove factual name/gender lines) | no |
| Character notes | `<character_notes>` bootstrap L119-121 + compile L216-218; legacy concat runtime-bundle L368/390 | `<character_notes>` | legacy persona-instructions concat L368/390 | no (canonical already single-owner) |
| Response contract | **inline in `system`** bootstrap L54-68 (no own block) | dedicated `response_contract` block | inline ownership L54-68 | wrong owner, not stale |
| Reminders protocol | template bootstrap L144-151; shadow fallback const compile L21-28 | `reminders_protocol` template | shadow const L21-28 | no |
| **Memory protocol** | template bootstrap L153-170; shadow fallback const compile L34-45 | `memory_protocol` template | shadow const L34-45 | **STALE — both reference pushed `<persai_memory>`, contradicts ADR-120 (ARCHITECTURE L187-189, API-BOUNDARY L76, DATA-MODEL L152/179)** |
| Enabled skills catalog | wrapper bootstrap L140-142; render enabled-skills-prompt-materialization L117-166 (per-scenario `one_line`/`first_step_preview`/`recommended_tools`) | compact `<enabled_skills>` | scenario detail lines L143-155 (move out per D2) | over-owned, not stale |
| Tool-usage policy / selection guide | `<tool_usage_policy>` bootstrap L174-255 | `tools` template | – | single owner already |

---

## 3. Numeric zone budgets (baseline → target ceiling)

Method: char count of raw template bodies + variable interpolation. **Worst case is currently unbounded** (skill `summary`/`when_to_use`/scenario name/`recommended_tools` uncapped; `character_notes` snapshotInstructions injected raw).

Constants below are **confirmed (2026-07-02)** as CI guard floors, not targets. **Do not shrink the stable prefix below the provider cache minimum** (Sonnet 1024 tok / Opus-Haiku 4096 tok) — an under-minimum prefix is not cached at all, which would erase the whole point.

| Zone | Baseline (approx) | Ceiling (confirmed) | Constant |
|---|---|---|---|
| Full stable prefix (`systemPrompt`) | ~16k-22k typical; unbounded worst case | **≤10k** | `STABLE_PREFIX_BUDGET_CHARS` |
| `enabled_skills` catalog | one full skill already >4.6k from bounded fields; worst `maxEnabledSkills×8` scenarios; unbounded | **≤4.5k**, global **24-32** scenario rows, per-row `key+name` only | `ENABLED_SKILLS_BUDGET_CHARS` |
| Selection guide (`tools`) | ~8k-9k | **≤6.5k** | `SELECTION_GUIDE_BUDGET_CHARS` |
| `<voice>` (excl. character_notes) | ~1.6k-2.0k + variable | ≤1.8k | – |
| `<response_contract>` | ~1.0k-1.1k | ≤0.8k | – |
| `<memory_protocol>` | ~1.0k-1.2k | ≤0.55k | – |
| `<reminders_protocol>` | ~0.35k-0.40k | ≤0.40k | – |
| per heavy descriptor (video/document) | 5-7k / 5k | ≤1.5k inline + lazy actions | `TOOL_DESCRIPTION_BUDGET_CHARS` |
| `character_notes` (user-authored) | variable, verbatim | soft cap ~2k + **UI warning** (no silent prod truncation) | `CHARACTER_NOTES_SOFT_CAP_CHARS` |
| system skill fields | uncapped today | hard: `summary ≤160`, `when_to_use ≤200`, `recommended_tools` bounded | `SKILL_SUMMARY_CAP` / `SKILL_WHEN_TO_USE_CAP` |
| volatile context (scenario+plan+reminders) | variable | budgeted | `VOLATILE_CONTEXT_BUDGET_CHARS` |
| tool-history replay (D8, future) | n/a | budgeted, tail-windowed | `TOOL_HISTORY_REPLAY_BUDGET_CHARS` |

Whole-prefix estimate if D2+D3 land: **~16k-22k → ~10k-14k**. Biggest win = `enabled_skills`; then duplicate identity/user facts, `memory_protocol` (~0.5-0.7k), response-contract cleanup. **Rule (confirmed):** user-authored text (`character_notes`) = soft budget + warning, kept verbatim; system-owned text (skill fields) = hard cap.

---

## 4. Stale-test ledger (each slice updates its own guards)

Rule: a slice updates the guard tests it changes; it never preserves stale wording to keep tests green. The ADR-119 golden snapshot (`apps/api/test/adr119-golden-prompt-snapshot.test.ts` + `fixtures/adr119-golden-prompt-snapshot.expected.txt`) must be regenerated by whichever slice first edits the stable prefix (likely Slice 1).

**Slice 1 (compact enabled_skills):**
- `enabled-skills-prompt-materialization.test.ts:180-193` — asserts `<one_line>`/`<first_step_preview>`/`<recommended_tools>` inline
- `…:197-215` — tag-by-tag rich scenario shape
- `…:235-257` — `SCENARIO_CATALOG_RENDER_LIMIT === 8` + exact-8 render
- `…:291-297` — `first_step_preview` required + ≤200 contract
- `…:455-463`, `…:497-500` — `firstStepPreview` override/fallback verbatim
- `adr119-golden-prompt-snapshot.test.ts:213-216,290-294` — full snapshot incl. rich skills

**Slice 2 (system-prefix single owners):**
- `compile-prompt-constructor.service.test.ts:697-707` — **`assert.match(systemPrompt, /persai_memory/)`** (the stale lock; must be removed/rewritten)
- `turn-context-hydration.service.test.ts:653-673,700-702` — **keep green** (asserts NO pushed memory in runtime); guard, don't break
- `tool-catalog-data.test.ts:138-148` — files scope/widen/crossScope wording
- `runtime-tool-policy.test.ts:264-293` — files six-action/attach ownership at policy layer
- `native-tool-projection.test.ts:601-654` — files wording + `replace` at projection layer
- `adr119-golden-prompt-snapshot.test.ts:218-234,290-294` — memory/response-contract/tools blocks

**Slice 3 (heavy descriptor re-layering):**
- `tool-catalog-data.test.ts:66-129,183-190` — document workflow/tutorial + presentation-routing locks
- `native-tool-projection.test.ts:927-1017` — document descriptor/rerender/replace prose
- `native-tool-projection.test.ts:781-790` — video_generate inline voice shortlist
- `native-tool-projection.test.ts:1450-1516,1528-1552,1594-1647` — video_generate persona catalog + talking-avatar tutorial
- golden snapshot regen if descriptor text feeds prefix

**Slice 4 (scenario/chat-plan volatile dedupe):**
- `build-active-scenario-block.service.test.ts:266-279,433-565,622-684` — full-step + sub-tags + byte-stability locks
- `build-system-reminder-blocks.service.test.ts:300-313,438-447,686-706,926-943` — reminder prose/order/intake step-list
- `turn-execution.service.test.ts:7853-7865,7910-7925,7995-8007` — reminder count/order in provider request + mid-loop refresh
- `turn-context-hydration.service.test.ts:2181-2233` — `<persai_chat_plan>` formatting

**Slice 6 (tool-history D8):**
- No existing stale test locks the absence of replay; current `toolHistory` tests are within-turn only. Slice 6 adds **new** coverage.

---

## 5. Cache-guard baseline + golden test spec (D7)

Baseline hashing: `sha256(trimmed systemPrompt)` (compile L160-175; runtime-bundle L296-303). Existing partial invariant: `compile-prompt-constructor.service.test.ts:243-251` (hash stable when only presence template changes). The repo does not store the current hex; regenerate/pin during Slice 0 close-out if desired.

New guard test: **`apps/runtime/test/prompt-cache-stable-prefix-guard.test.ts`** (new file — existing `prompt-cache-stable-blocks.test.ts` only covers token walking). Assertions (consume Slice 0 budget constants, no hardcoded literals):
1. **Byte-stability:** same bundle, two turns differing in time / active-scenario step / chat-plan / reminders / tool-history ⇒ identical `stablePrefix.text` and `.hash`.
2. **No turn/workspace-variable strings in prefix:** absent — current `HH:MM`, active-step directive, todo title, `VERY NEXT action MUST be a single todo_write`, prior tool-call id/result payload.
3. **No volatile block inside prefix:** absent — `<persai_active_scenario>`, `<system-reminder>`, `<persai_chat_plan>`, presence values, serialized `tool_use`/`tool_result`/`function_call`/`function_call_output`.
4. **Provider ordering:** OpenAI + Anthropic builders keep `systemPrompt` as first cached unit; volatile inserted just before current user question; presence/developer instructions appended as suffix.
5. **Zone budgets:** `stablePrefixChars ≤ STABLE_PREFIX_BUDGET_CHARS`, `enabledSkillsChars ≤ ENABLED_SKILLS_BUDGET_CHARS`, `volatileContextChars ≤ VOLATILE_CONTEXT_BUDGET_CHARS`, `developerInstructionsChars ≤ DEVELOPER_INSTRUCTIONS_BUDGET_CHARS`; (Slice 6) `toolHistoryReplayChars ≤ TOOL_HISTORY_REPLAY_BUDGET_CHARS`.

---

## 6. Cross-cutting cleanups (span multiple tools)

- **Kill dead projection fallbacks:** every `native-tool-projection.ts` fallback paragraph shadowed by a non-null `policy.description` (nearly all tools). Reduces maintenance debt, not live budget.
- **Resolve shadow sources:** `memory_search`/`memory_get`/`persai_tool_quota_status` catalog rows vs hidden `knowledge_search`/`knowledge_fetch`/`quota_status` defaults — one owner each.
- **Pending-delivery honesty:** single owner (selection guide `bootstrap L209-213` + `buildPendingDeliveryHint` proj L85-98); remove per-tool catalog copies (image_generate L67-68, image_edit L89-90, video_generate L108-110, presentation L169, tts L187-188).
- **Provider-fragment leak:** image series/standalone/reference intent in `native-tool-projection.ts:938-944,1008-1014,1058` overlaps canonical `runtime-contract/src/index.ts:4194-4239`; keep provider-only.
- **Legacy prefix path:** `runtime-bundle/src/index.ts:359-402` re-concats identity/user/persona outside the XML blocks — clean alongside D3.

---

## 7. Decisions — CLOSED (2026-07-02)

All four carried in ADR-130 → "Slice 0 decisions closed". Recorded here for traceability.

1. **Budget ceilings — CONFIRMED** as CI guard floors (§3), not targets; never shrink prefix below provider cache minimum (Sonnet 1024 tok / Opus-Haiku 4096 tok).
2. **`character_notes` vs skill fields — asymmetric.** `character_notes`: verbatim + soft cap ~2k + UI warning (no silent prod truncation). System skill fields: hard cap (`summary ≤160`, `when_to_use ≤200`, `recommended_tools` bounded). Rule: user text = budget+warning; system text = hard cap.
3. **`files` single owner — CONFIRMED.** Selection guide owns "when files vs exec/shell/grep/glob"; descriptor (catalog→projection) owns mechanics; **delete** the `runtime-tool-policy.ts` override + stale catalog copy. Policy layer = permissions/limits only.
4. **Lazy-action families — CONFIRMED** (priority order): `video_generate.list_personas/list_voices/describe_avatar_mode`; `skill.list/describe`; `document.describe_workflow`; `shell.describe_environment` (low).

### Provider-gateway tools-stability finding (verified 2026-07-02)

- We do **not** toggle tools on/off in ordinary chat: `toolChoice:"auto"` always, tool set is bundle-stable, per-turn variability lives in `developerInstructions` (`turn-execution.service.ts:1975-1990, 2004-2007`). `excludedToolNames` fires only for background synthetic turns (`turn-execution.service.ts:579`). ✓ matches best practice.
- **One live per-turn `tools` mutation:** the `knowledge_search`/`knowledge_fetch` source enum is rebuilt per turn (skill source added/dropped by active-skill routing — `turn-execution.service.ts:781-786, 909-923`). Since `tools` is the first cached segment, this busts the whole prefix on skill-toggle turns. **Fix:** keep the enum byte-stable + gate skill-source access at execution (ADR-120 already enforces server-side), or accept as cost. Recorded in ADR-130 D7.
- **Invariant:** any future per-turn tool gating uses provider `allowed_tools`/`tool_choice`, never `tools`-array edits.

---

*Slice 0 complete. No behavior changed. Next: founder confirms budgets/decisions in §7, then Slice 6 (D8) per the ADR sequencing note, or Slice 1 if document ADRs (129/131) are already closed.*
