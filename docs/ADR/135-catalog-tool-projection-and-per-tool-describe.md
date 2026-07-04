# ADR-135: Catalog tool projection and per-tool `action: "describe"`

## Status

**Closed locally 2026-07-05** — Slices S1–S6 landed locally; deploy + live acceptance pending the next dev rollout.

## Date

2026-07-05

## Baseline SHA

`f6e2f23a` on `main`. Implementation starts only from a **clean git tree**.

## Founder-locked decisions (audit checklist)

Use this section to verify the ADR matches what was agreed in review. If any row disagrees with code during implementation, stop and reconcile.

| # | Decision | Locked answer |
|---|---|---|
| 1 | Loader mechanism | **`{toolCode}({ action: "describe" })` on the same tool** — family-lazy pattern like `video_generate` + `list_personas`, `skill` + `describe` |
| 2 | Separate meta-tool `tools` | **No** |
| 3 | `tools.list` | **No** — active tools already visible as catalog stubs + selection guide |
| 4 | Anthropic/OpenAI `defer_loading` hybrid | **No** in v1 — one provider-agnostic path |
| 5 | Plan control | **One boolean per plan-visible tool:** `fullProjection` — ☑ = full JSON, ☐ = catalog stub |
| 6 | Three-way inherit/full/catalog | **No** — defaults live in plan seed template (13 ☑ / 11 ☐), not runtime inherit |
| 7 | Platform defaults | **13 full / 11 catalog** (tables in D2) |
| 8 | Plan override | Founder may flip **any** plan-visible tool ☑/☐ per tariff — no hard platform clamp |
| 9 | Wire expansion (S3) | After describe, **next tool-loop iteration** expands catalog stub → full projection in `tools[]` |
| 10 | Catalog stub body | Reuse existing `modelDescription` — no new short-text field required |

### Explicitly rejected (do not reintroduce)

- Meta-tool `tools` with `action: "describe"` or `action: "list"`
- `tools.list` as a discovery mechanism
- `modelExposure` tri-state (`inherit` / `full` / `catalog`) on plan rows in v1 UX
- Platform-invariant 13 tools that plan cannot set to ☐
- Anthropic `defer_loading` + custom fallback in the same turn

## Orchestration model

This ADR is intended for orchestrated execution.

- The **parent agent** owns this ADR, dispatches bounded slices S1–S6, reviews every diff, verifies invariants, reconciles docs, and decides closure.
- **Implementation subagents** use GPT-5.4 or Sonnet unless the orchestrator documents a concrete reason otherwise.
- Subagents must not broaden scope, introduce a separate meta-tool, provider-specific hybrid paths (Anthropic `defer_loading`), or duplicate full-json projection for catalog-tier tools.
- If docs and code disagree at slice start, the orchestrator pauses and reconciles before code changes.
- Every slice must land production-grade behavior. No TODO scaffolding, no silent truncation regressions.

## Founder directive

Power-user assistants with most tools enabled currently pay **~10–12k tokens** on the tools JSON layer alone (~17k total fresh-turn input after ADR-130 compression and `TOOL_DESCRIPTION_CAP=4096` correctness fix). That cost is disproportionately driven by **rare heavy generators** (`video_generate`, `document`, `presentation`) shipped on every turn.

PersAI will adopt a **single provider-agnostic mechanism**:

1. **Full projection** — complete tool `description` + `inputSchema` on every turn (current behavior).
2. **Catalog projection** — short header only (`modelDescription` + load hint); **full contract via `action: "describe"` on the same tool**.
3. **Platform defaults** (13 ☑ full / 11 ☐ catalog on new plan seed); **per-tariff `fullProjection` boolean** on every plan-visible tool.

## Relationship to prior ADRs

- **Extends ADR-117 / ADR-130** — selection guide remains cross-tool routing owner; per-tool mechanics stay in descriptor path; catalog stub is a **projection mode**, not a second routing source.
- **Same pattern as ADR-130 family lazy actions** — `action: "describe"` is one more read-only action on catalog-tier tools, alongside existing family actions (`video_generate` `list_personas`/`list_voices`/`describe_avatar_mode`, `skill` `action:"list"` / `action:"describe"`).
- **Does not reopen** ADR-130 closed slices, ADR-119 golden prefix ownership, or ADR-132 document three-verb surface.
- **Does not** adopt Anthropic `defer_loading` or OpenAI `tool_search` in v1.

## Context

### Problem

| Layer | Typical power-config | Issue |
|---|---:|---|
| Tools JSON (description + schema) | ~10–12k tok | Dominant fresh-turn cost |
| Stable prefix | ~6–10k tok | Already compressed under ADR-130 |
| Developer tail | ~0.5k tok | Minor |

### Scope note — model-visible tool codes

D2 tier tables use **runtime model-visible `toolCode` names** (as projected in `native-tool-projection.ts`), not every `ToolCatalogEntry.code` in `tool-catalog-data.ts`. Examples:

- `quota_status` on wire (catalog DB row may be `persai_tool_quota_status`)
- `knowledge_search` / `knowledge_fetch` are synthetic/bootstrap tools, not separate catalog rows
- Legacy or admin-only catalog rows (`memory_search`, `cron`, `persai_workspace_attach`, …) are **out of D2** unless they become plan-visible model tools in a future slice

S1 must map `defaultModelExposure` for every **plan-visible model tool**; D2 is the founder default for the 24-tool power-config fixture.

### Existing fields (inventory)

| Field | Location | Role today |
|---|---|---|
| `modelDescription` | `tool-catalog-data.ts` / bootstrap synthetic | Short one-line — **catalog stub body** |
| `modelUsageGuidance` | same | Long guidance — **full projection + describe result only** |
| `displayName` | catalog + `RuntimeToolPolicy` | Human label |
| `action` on some tools | runtime execution | Precedent: `video_generate`, `skill` read-only actions |

**Missing today:** `defaultModelExposure`, plan `fullProjection`, catalog projection branch, per-tool `describe` on catalog tools without it, per-turn describe cache, catalog-call guard.

## Decision

### D1 — Two projection tiers + plan boolean

```text
modelExposure: "full" | "catalog"   // materialized on RuntimeToolPolicy
```

| Tier | On wire each turn | Full contract |
|---|---|---|
| `full` | `description` + `usageGuidance` + full `inputSchema` + hints | immediate |
| `catalog` | `modelDescription` + load hint; **minimal schema** (`action` includes `"describe"`) | `{toolCode}({ action: "describe" })` on **that same tool** |

```text
effectiveExposure =
  inactive ? none
  : plan.fullProjection === true ? "full"
  : plan.fullProjection === false ? "catalog"
  : catalog.defaultModelExposure   // migration only — backfill sets explicit boolean on all plan rows
```

**Plan UX:** one checkbox per plan-visible tool — ☑ Full JSON / ☐ catalog stub. New plans seed 13 ☑ / 11 ☐ from catalog `defaultModelExposure`. Founder edits per tariff by toggling only.

### D2 — Platform default tier table (founder-locked v1)

#### Default `full` (13 tools)

`skill`, `todo_write`, `files`, `shell`, `grep`, `glob`, `exec`, `knowledge_search`, `knowledge_fetch`, `web_search`, `web_fetch`, `memory_write`, `image_edit`

#### Default `catalog` (11 tools)

| Tool | ~savings vs full | Caveat |
|---|---:|---|
| `image_generate` | ~400 tok | |
| `video_generate` | ~1.0–1.5k tok | Catalog stub may still expose read-only `list_personas` / `list_voices` / `describe_avatar_mode` — savings lower than pure one-action stub |
| `document` | ~1.1k tok | |
| `presentation` | ~500 tok | |
| `browser` | ~350 tok | |
| `tts` | ~325 tok | |
| `scheduled_action` | ~375 tok | |
| `background_task` | ~375 tok | |
| `quota_status` | ~300 tok | |
| `summarize_context` | ~100 tok | |
| `compact_context` | ~100 tok | |

**Estimated net savings** at platform defaults (all 24 active): **~4–4.5k tok** on tools JSON per fresh turn (fixture-measured in S6; not a guarantee for every tariff mix).

Plan may flip any plan-visible tool ☑/☐ independently per tariff. Admin UI may warn when ☐ on tools whose platform default is ☑ (`files`, `shell`, `skill`).

### D3 — Per-tool `action: "describe"` (no meta-tool)

Catalog-tier tools stay **in `tools[]` under their own name**. Model loads full contract by calling **that tool**:

```text
video_generate({ action: "describe" })
document({ action: "describe" })
presentation({ action: "describe" })
```

| Property | Rule |
|---|---|
| Execution | read-only; short-circuits before worker/provider; `artifacts: []`; 0 quota units |
| Result payload | full `description` + `usageGuidance` + param/schema reference (same content as full projection builders — single source) |
| Family lazy actions | unchanged — e.g. after describe, model may still call `video_generate({ action: "list_personas" })`; pointers live inside describe result |
| `skill` when ☑ full | unchanged — existing `skill({ action: "describe", skillId })` |
| `skill` when ☐ catalog | same read-only surface; catalog stub + `skill({ action: "describe", ... })` before `engage` |

**Catalog stub shape:**

```text
description: {modelDescription}
Call {toolCode}({action:"describe"}) before the first real execution call.
```

**Catalog stub schema:** `action` enum includes `"describe"` plus any existing read-only family actions for that tool; **excludes** heavy execution params until turn cache expands wire (D4).

**Tools that already have `action`:** extend enum with `"describe"` (e.g. `video_generate`: `describe` | `list_personas` | `list_voices` | `describe_avatar_mode` | `generate` guarded). Tools without `action` today (`document`, `presentation`, …): add `action` with at least `"describe"` + real verbs; catalog wire exposes only `describe` (+ read-only if any) until expanded.

### D4 — Per-turn describe cache, wire expansion, guards

**Wire expansion in plain terms:** after a successful `{tool}({action:"describe"})`, the **next** provider request in the **same user turn** (next tool-loop iteration) must send **full projection** for that tool in `tools[]` so the provider accepts real execution parameters.

1. **Describe cache (turn-local):** after successful `{tool}({action:"describe"})`, mark tool as described for this turn.
2. **Wire expansion (tool loop):** on the next provider request in the same turn, runtime replaces that tool's catalog stub with **full projection** in `tools[]`.
3. **Guard:** real execution call on catalog tool without prior describe in this turn → structured skip (`tool_contract_not_loaded`) pointing to `{tool}({action:"describe"})`.
4. **Media jobs:** catalog applies to model-facing projection only; worker `directToolExecution` always uses full persisted request shape.
5. **Selection guide:** one rule — for catalog-tier tools, call `{tool}({action:"describe"})` before first real use; routing *which* tool stays in guide only.

### D5 — Data model

- `ToolCatalogEntry.defaultModelExposure: "full" | "catalog"` (for plan-visible model tools)
- `AssistantPlanCatalogToolActivation.fullProjection: boolean`
- `RuntimeToolPolicy.modelExposure: "full" | "catalog"` (materialized at compile from `fullProjection`)

No `catalogSummary` required — reuse `modelDescription`.

### D6 — Implementation owners

| Concern | Owner |
|---|---|
| Cross-tool routing | `<tool_usage_policy>` |
| Full descriptor + schema | existing `create*ToolDefinition` builders |
| Catalog stub | `native-tool-projection.ts` |
| `action: "describe"` execution | each tool's runtime service (or shared read-only helper) — **not** a new top-level tool |
| Describe payload | reuse full builders — no duplicated literals |
| Wire expansion | `turn-execution.service.ts` + projection recompute per iteration |

### D7 — Non-goals (v1)

- Meta-tool `tools`, `tools.list`, `tools.describe` as a separate projected tool
- Anthropic/OpenAI native `defer_loading` hybrid
- `document.describe_workflow` (ADR-132: inspect/render/convert only)
- Silent truncation regression on full-tier tools
- Per-assistant `fullProjection` override or dynamic mid-turn tier flip without republish

## Work plan

### Standard gate (every slice)

lint, format:check, api/web/runtime typecheck, focused tests, wire-budget assert (≥3.5k tok savings on power-config fixture vs baseline).

### S1 — Contract + plan boolean + catalog defaults

- Add `defaultModelExposure` to catalog/bootstrap for plan-visible model tools; set D2 values.
- Add `fullProjection: boolean` to plan activation; derive `RuntimeToolPolicy.modelExposure` at materialize.
- Seed new plan templates 13 `true` / 11 `false`; migration backfill for existing plans.
- Tests: defaults, boolean → exposure, plan seed parity.

### S2 — Catalog stub projection + per-tool `describe` read-only path

- Branch `native-tool-projection` on `modelExposure`.
- Add `action: "describe"` to catalog-tier tool execution (extend existing read-only patterns).
- Describe result = output of full definition builders.

### S3 — Turn loop: describe cache + wire expansion + guard

- Turn-local set of described tool codes; recompute `tools[]` before each provider iteration.
- Tests: describe → full wire on next iteration; guard without describe; same-turn real call succeeds.

### S4 — Selection guide rule + golden if needed

- One `<tool_usage_policy>` rule: catalog-tier tools require `{tool}({action:"describe"})` before first real execution; no duplicate routing prose per tool.
- Touch: `apps/api/prisma/bootstrap-preset-data.ts` only if guide text changes; do not move per-tool mechanics into the guide.
- Regenerate `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` only if stable prefix bytes change.
- Tests: `bootstrap-preset-data.test.ts`, `adr119-golden-prompt-snapshot.test.ts` if golden regenerated.

**Slice exit:** guide has exactly one catalog-describe rule; golden green if touched.

### S5 — Plan editor ☑ Full JSON checkbox (may ship as v1.1 after S1–S4)

- Admin plan tool row: checkbox **Full JSON on wire** maps to `fullProjection: boolean`.
- New plan / clone seeds ☑/☐ from catalog `defaultModelExposure` (13 ☑ / 11 ☐).
- Optional warning when ☐ on default-full tools (`files`, `shell`, `skill`).
- Touch likely: plan catalog entity/API, admin web plan editor, OpenAPI if public admin surface changes.
- Tests: plan seed parity, save/load round-trip for `fullProjection`.

**Slice exit:** founder can flip any plan-visible tool ☑/☐ in admin; materialized bundle reflects boolean.

### S6 — Metrics + live acceptance + close

- Log per turn: `tools_json_char_count`, `catalog_describe_calls`, `tool_contract_not_loaded` guard hits.
- Wire-budget fixture test: power-config (24 tools active, platform-default ☑/☐) saves **≥3.5k tok** on `tools[]` vs `f6e2f23a` baseline.
- Live on dev (hybrid): (1) ordinary `files` turn — no describe; (2) `video_generate` catalog path — describe once → generate same turn; (3) `image_edit` ☑ full — unchanged; (4) media-job worker + checkpoint unchanged.
- Docs on close: `CHANGELOG.md`, `SESSION-HANDOFF.md`, `ARCHITECTURE.md` tool-layering subsection; close ADR.

**Slice exit:** acceptance criteria 1–6 below satisfied on clean tree.

## Orchestrator dispatch reference

Parent agent: one slice per subagent session; review diff against **Founder-locked decisions** before merge; run standard gate after each slice.

| Slice | Primary packages | Key files (starting points) | Focused tests |
|---|---|---|---|
| **S1** | `@persai/api` | `tool-catalog-data.ts`, `bootstrap-preset-data.ts` (synthetic tools), `assistant-plan-catalog.entity.ts`, `runtime-tool-policy.ts`, `materialize-assistant-published-version.service.ts` | `runtime-tool-policy.test.ts`, `tool-catalog-data.test.ts`, `materialize-assistant-published-version.service.test.ts` |
| **S2** | `@persai/runtime` | `native-tool-projection.ts`, per-tool services (`runtime-video-generate-tool.service.ts` pattern), tool dispatch router | `native-tool-projection.test.ts`, per-tool service tests |
| **S3** | `@persai/runtime` | `turn-execution.service.ts` (recompute `tools[]` per iteration), projection entry used by turn loop | new focused test: describe → full wire next iteration; guard without describe |
| **S4** | `@persai/api` | `bootstrap-preset-data.ts` | `bootstrap-preset-data.test.ts`, golden snapshot if changed |
| **S5** | `@persai/api`, `@persai/web` | plan admin API + UI | plan editor tests |
| **S6** | all touched | metrics hooks, wire-budget fixture | full gate + live checklist |

### Implementation notes for subagents

- **`skill` + `action:"describe"`:** skill already uses `describe` with `skillId`. When `skill` is ☐ catalog, `skill({action:"describe"})` **without** `skillId` returns the **tool-level** full contract; `skill({action:"describe", skillId})` remains the existing skill-card lookup. Do not merge or rename `describe_avatar_mode` on `video_generate`.
- **Synthetic tools:** `knowledge_search`, `knowledge_fetch`, `summarize_context`, `compact_context`, `quota_status` need `defaultModelExposure` in bootstrap/synthetic metadata path, not only `tool-catalog-data.ts` rows.
- **Catalog stub vs family read-only:** catalog wire may keep existing read-only actions (`list_personas`, …) but must **exclude** heavy execution params until described + wire-expanded (D4).
- **Do not touch:** provider-gateway defer_loading, ADR-119 prefix ownership beyond one guide rule, ADR-132 document verbs, media-job worker rehydrate shape.

## Risks and residuals

| Risk | Mitigation |
|---|---|
| S3 breaks tool loop or provider schema validation | Focused iteration tests; parent audit before S4 |
| Model skips describe on catalog tool | Runtime guard `tool_contract_not_loaded` + one guide rule |
| `skill` / `video_generate` describe naming confusion | Distinct actions documented above; tests for both shapes |
| Savings lower than ~4k if many tools ☑ full on tariff | Expected; wire-budget assert uses platform-default seed fixture only |
| Provider cache miss mid-turn when `tools[]` expands | Accepted tradeoff; savings target is fresh-turn start |
| Describe cache not persisted across turns | By design; describe is cheap read-only |

## Acceptance criteria

1. D2 defaults in catalog/bootstrap + tests for all 24 plan-visible model tools in power-config fixture.
2. ≥3.5k tok tools JSON savings vs baseline on that fixture at platform-default ☑/☐ seed.
3. No meta-tool `tools` in projection or runtime.
4. Catalog tool: `{tool}({action:"describe"})` returns full contract; then real call succeeds same turn after wire expansion.
5. Full-tier tools (☑) unchanged vs baseline projection.
6. `video_generate` media-job worker + checkpoint unchanged.

## References

- ADR-130 lazy-action precedent (`video_generate`, `skill`)
- Founder review 2026-07-05 — per-tool describe (not meta-tool), 13/11 defaults, `fullProjection` boolean, plan may flip any tool
