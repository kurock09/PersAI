# ADR-117 Tool Instruction Inventory
## Slice 0 — Мир 2 Audit + Reconciliation Ledger

**Status:** Working ledger (Slice 0 deliverable)  
**Date:** 2026-06-15  
**Scope:** Model-facing Мир 2 instruction sites (selection, per-tool contract, provider-conditioning, runtime-state hints). Мир 1 persona/classifier/soul is out of scope except where leakage is noted.  
**No code was modified.** This document is documentation only.

---

## 1. Reconciliation Findings

### R1 — `action="deferred"` drift ⚠️ CONFIRMED

**Evidence.** The runtime-contract (`packages/runtime-contract/src/index.ts` L1640, L1697, L1956) defines the action union for all three media tool results as:
`action: "generated" | "skipped" | "pending_delivery"`. The string `"deferred"` is not in this union and will never appear in a real tool result.

`"deferred"` survives only in a single backward-compat guard (`apps/runtime/src/modules/turns/turn-execution.service.ts` L5176):
```
(row.action !== "deferred" && row.action !== "pending_delivery") || ... row.toolCode !== DOCUMENT_TOOL_CODE
```
This guard is scoped to `DOCUMENT_TOOL_CODE` only — unrelated to image/video tools.

**Three drifted catalog entries (all `fix-drift`, Slice 2):**
- `apps/api/prisma/tool-catalog-data.ts` L53 — `image_generate.modelUsageGuidance`: `action="deferred"` → must be `action="pending_delivery"`
- `apps/api/prisma/tool-catalog-data.ts` L68 — `image_edit.modelUsageGuidance`: same drift
- `apps/api/prisma/tool-catalog-data.ts` L82 — `video_generate.modelUsageGuidance`: same drift

**Compounding problem:** `buildPendingDeliveryHint` (`native-tool-projection.ts` L83–96) correctly uses `action='pending_delivery'` and is appended to the same tool descriptions that contain the wrong `action="deferred"` from catalog. The model currently receives **contradictory signals in the same tool description**.

---

### R2 — Legacy TOOLS markdown: DEAD in all seeded environments

`compile-prompt-constructor.service.ts` `generateToolsPrompt` (L350–362) has two branches:
1. `if (template)` → interpolate DB template (normal path)
2. else → `buildRuntimeToolPoliciesMarkdown(toolPolicies)` (fallback)

`seed.ts` `upsertPromptTemplates` (L34–37) unconditionally upserts all entries from `PROMPT_TEMPLATE_DEFAULTS`, which includes `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.tools` (`bootstrap-preset-data.ts` L147–151). After any `seed.ts` run, the `tools` row always exists, so `template !== null` and the fallback is **never reached** in dev/staging/prod.

The fallback fires only on a completely fresh DB before first seed (cold migration without seed). It is a safety net, not a live path. `buildRuntimeToolPoliciesMarkdown` and `buildPromptToolMarkdownEntry` are operationally dead.

---

### R3 — Ghost-verb strippers: DEAD (zero live matches)

**`resolveSanitizedScheduledActionDescription`** (`native-tool-projection.ts` L108–113)  
Pattern: `/assistant_check|hidden assistant follow-?up|actionPayload|actionType|audience/i`  
Live text (catalog `scheduled_action` L173–174 + projection fallback): contains `kind`, `title`, `reminderText`, `runAt`, `taskId`, `titleMatch` — no match anywhere. Function always returns description unchanged.

**`resolveSanitizedBackgroundTaskDescription`** (`native-tool-projection.ts` L116–121)  
Pattern: `/\bcreate\b[^.]*\bupdate\b|\bupdate\b[^.]*\b(pause|resume|cancel|list)\b/i`  
Live text (catalog `background_task` L186–187 + projection fallback L1462): contains "create" and control verbs, but never in the adjacent "create…update" or "update…pause" arrangement the pattern requires. No match. Function always returns unchanged.

Both strippers were written for legacy field names (`actionPayload`, `actionType`, `audience`) absent from all current live catalog text. Both are dead code (Slice 4 removal).

---

### R4 — `files` text accuracy: minor mismatch

**Hardcoded description** (`runtime-tool-policy.ts` L122): "List, search, inspect, read, write, write-and-send, edit, delete, or send…"  
**Actual `PERSAI_RUNTIME_FILES_TOOL_ACTIONS`** (`packages/runtime-contract/src/index.ts` L284–296): list, search, inspect, **get**, read, **preview**, write, write_and_send, edit, delete, send (11 actions).

`get` is deprecated (projection L1550: "Prefer 'inspect' over legacy 'get'") — acceptable omission. `preview` is real and mentioned in usage guidance (L135) but not in the description header. The catalog `files.modelUsageGuidance` (L226–227) is entirely **superseded** by the hardcoded policy override (`runtime-tool-policy.ts` L134–135) and never reaches the model.

---

### R5 — `referenceImageAlias` "ask" guidance: PARTIALLY STALE

**Catalog guidance** (`tool-catalog-data.ts` L68): "use `referenceImageAlias` only as a visual guide from another available image. If roles like 'the second photo' are still unclear, ask instead of guessing."

**Runtime behavior** (`runtime-image-edit-tool.service.ts` `resolveImageSelection` L967–973): when `imageAttachments.length > 1 && sourceImageAlias === null`, the service returns `ok: false, reason: "source_image_alias_required"` with a warning — the runtime enforces that the model must ask. The "ask instead of guessing" instruction is therefore correct.

**Stale aspect:** The guidance only mentions the legacy singular `referenceImageAlias`; it does not reflect the current multi-reference `referenceImageAliases` API (`native-tool-projection.ts` L973–977; service L963–965). The phrasing "use `referenceImageAlias` only as a visual guide from another available image" implies exactly one reference image, but the tool now accepts up to `MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES`. Mark as `fix-drift` (Slice 2).

---

### R6 — Duplication clusters: CONFIRMED (Rules A–D, 5–10 sites each)

See Section 4 for complete enumeration. Summary:
- Rule A (no collage/grid): 7 sites, 3 wording variants
- Rule B (one standalone image): 5 sites
- Rule C (reference guidance only / output rooted in source): 5 sites
- Rule D (series = N separate images): 10 sites

---

### R7 — `agents` vs tool guidance (D5): CONFIRMED OVERLAP, reduce recommended

**Overlap:** `agents` Tasks Policy (`bootstrap-preset-data.ts` L141–142) states the same cross-tool selection rules already present in both catalog entries:
- "Use `scheduled_action` only for unconditional user-visible reminders" ↔ `scheduled_action.modelUsageGuidance` L173
- "Use `background_task` for quiet checks, conditional monitoring" ↔ `background_task.modelUsageGuidance` L186

**Non-selection content** remaining in `agents` if Tasks Policy is moved: Memory Policy hygiene (L134–137: "Write one concise memory per item. Prefer refining existing memory. Skip transient context, secrets, guesses…"). This hygiene has no natural home in the selection guide and should remain in `agents`.

**Recommendation:** **Reduce** `agents` to Memory Policy hygiene only; move Tasks Policy cross-tool selection rules into the selection guide (Slice 1). Do not retire `agents` entirely.

---

## 2. Full Ledger

### 2A. Selection (WHICH/WHEN) — target owner: `tools` system block

| # | File / ~line | Symbol | Wording (≤12 words) | Verdict |
|---|---|---|---|---|
| S1 | bootstrap-preset-data.ts L147 | tools default | "Use only machine-readable tools declared for this turn" | keep-evolve (D2 rewrite) |
| S2 | bootstrap-preset-data.ts L141 | agents Tasks Policy | "Use `scheduled_action` only for unconditional user-visible reminders" | move-to-selection-guide (D5) |
| S3 | bootstrap-preset-data.ts L142 | agents Tasks Policy | "Use `background_task` for quiet checks / conditional monitoring" | move-to-selection-guide (D5) |
| S4 | tool-catalog-data.ts L53 | image_generate.modelUsageGuidance | "Use only for creating new image, not editing or video" | move-to-selection-guide |
| S5 | tool-catalog-data.ts L53 | image_generate.modelUsageGuidance | "Call immediately instead of narrating the planned call" | move-to-selection-guide |
| S6 | tool-catalog-data.ts L53 | image_generate.modelUsageGuidance | `action="deferred"` — say image is still rendering | fix-drift → `pending_delivery` |
| S7 | tool-catalog-data.ts L68 | image_edit.modelUsageGuidance | "Do not use for description, OCR, what-do-you-see questions" | move-to-selection-guide |
| S8 | tool-catalog-data.ts L68 | image_edit.modelUsageGuidance | `action="deferred"` — say edit is in progress | fix-drift → `pending_delivery` |
| S9 | tool-catalog-data.ts L82 | video_generate.modelUsageGuidance | "Use only when user explicitly wants generated video/animation" | move-to-selection-guide |
| S10 | tool-catalog-data.ts L82 | video_generate.modelUsageGuidance | "Do not use for editing existing video or image questions" | move-to-selection-guide |
| S11 | tool-catalog-data.ts L82 | video_generate.modelUsageGuidance | "Call immediately instead of narrating the planned call" | move-to-selection-guide |
| S12 | tool-catalog-data.ts L82 | video_generate.modelUsageGuidance | `action="deferred"` — say video is still rendering | fix-drift → `pending_delivery` |
| S13 | tool-catalog-data.ts L25–26 | web_search.modelUsageGuidance | "When you need sources/links and do not have exact URL" | move-to-selection-guide |
| S14 | tool-catalog-data.ts L40 | web_fetch.modelUsageGuidance | "When you already know exact URL, not search results list" | move-to-selection-guide |
| S15 | tool-catalog-data.ts L173–174 | scheduled_action.modelUsageGuidance | "Do not use for hidden checks; use `background_task` for that" | move-to-selection-guide (D5) |
| S16 | tool-catalog-data.ts L186–187 | background_task.modelUsageGuidance | "`scheduled_action` is only for unconditional user-visible reminders" | move-to-selection-guide (D5) |
| S17 | turn-execution.service.ts L347–348 | DELIVERY_HONESTY_CONTRACT | "Only say pending when turn returned `action='pending_delivery'`" | keep (correct token; developer-tail) |

### 2B. Per-tool contract (WHAT + params) — target owner: catalog → policy → projection

| # | File / ~line | Symbol | Wording (≤12 words) | Verdict |
|---|---|---|---|---|
| P1 | tool-catalog-data.ts L51 | image_generate.modelDescription | "Generate brand-new images from a text prompt" | keep |
| P2 | tool-catalog-data.ts L53 | image_generate.modelUsageGuidance | `background="transparent"` for cutout/sticker/icon/logo/PNG with alpha | keep |
| P3 | tool-catalog-data.ts L66–67 | image_edit.modelDescription | "Edit images only when user explicitly asks to modify" | keep |
| P4 | tool-catalog-data.ts L68 | image_edit.modelUsageGuidance | "Prefer current attachment; use recent reusable chat image otherwise" | keep |
| P5 | tool-catalog-data.ts L68 | image_edit.modelUsageGuidance | "set `sourceImageAlias`; use `referenceImageAlias` only as guide" | fix-drift (P6 below) |
| P6 | tool-catalog-data.ts L68 | image_edit.modelUsageGuidance | "If roles like 'the second photo' are unclear, ask" | fix-drift — does not mention `referenceImageAliases` plural |
| P7 | tool-catalog-data.ts L68 | image_edit.modelUsageGuidance | `background="transparent"` for cutout/sticker/icon/logo/PNG with alpha | keep |
| P8 | tool-catalog-data.ts L68 | image_edit.modelUsageGuidance | "Never claim edit done unless this turn produced successful result" | keep |
| P9 | tool-catalog-data.ts L80–81 | video_generate.modelDescription | "Generate short brand-new video clip from text prompt" | keep |
| P10 | tool-catalog-data.ts L82 | video_generate.modelUsageGuidance | "Guide result with one chat image via `referenceImageAlias`" | keep |
| P11 | tool-catalog-data.ts L96–97 | document.modelUsageGuidance | "Match mode to real intent: create/revise/redeliver/export" | keep |
| P12 | tool-catalog-data.ts L109–110 | tts.modelUsageGuidance | "Use only when user explicitly wants spoken voice note" | keep |
| P13 | tool-catalog-data.ts L122–123 | browser.modelUsageGuidance | "Use snapshot first; act only for interaction or unreachable state" | keep |
| P14 | tool-catalog-data.ts L137–138 | memory_search.modelUsageGuidance | "When answer depends on prior facts / chats / knowledge" | keep |
| P15 | tool-catalog-data.ts L150–151 | memory_get.modelUsageGuidance | "Use after search returned a concrete reference" | keep |
| P16 | tool-catalog-data.ts L173–174 | scheduled_action.modelUsageGuidance | `kind="user_reminder"`, title, reminderText, schedule params | keep (after selection parts moved) |
| P17 | tool-catalog-data.ts L186–187 | background_task.modelUsageGuidance | "Provide short title, precise brief, exactly one schedule" | keep (after selection parts moved) |
| P18 | tool-catalog-data.ts L212–213 | persai_tool_quota_status.modelUsageGuidance | "Use for remaining usage, quota pressure, checkout link" | keep |
| P19 | tool-catalog-data.ts L226–227 | files.modelUsageGuidance | Alias-first, write_and_send vs write, do not claim sent | superseded — policy override always wins (see P21); document as "policy-overridden" |
| P20 | runtime-tool-policy.ts L122 | resolveRuntimeToolDescription files | "List, search, inspect, read, write, write-and-send…" | fix-drift — omits `preview` action |
| P21 | runtime-tool-policy.ts L135 | resolveRuntimeToolUsageGuidance files | Comprehensive alias-first, inspect-before-read, send≠describe | keep (policy override, richer than catalog) |
| P22 | bootstrap-preset-data.ts L266–269 | ptm:memw:d / ptm:memw:u | "Write one concise durable memory per item; close open loops" | keep |
| P23 | bootstrap-preset-data.ts L274–281 | ptm:ksearch:u | "Call for uploaded docs, prior chats, subscription, product KB" | keep |
| P24 | bootstrap-preset-data.ts L278–281 | ptm:kfetch:u | "Always set mode; use full for whole document" | keep |
| P25 | native-tool-projection.ts L1690 | resolveToolDefinitionDescription | Merges `policy.description` + `policy.usageGuidance` | keep (single merge point) |
| P26 | native-tool-projection.ts L706–720 | describeKnowledgeSource | Label map: document/memory/chat/subscription/global | keep (runtime-state derived) |
| P27 | native-tool-projection.ts L1012–1029 | createVideoGenerateToolDefinition talking_avatar block | Mode choice, persona resolution, single-char, voice-precedence rules | keep (per-turn runtime-state; 9 sections warranted) |

### 2C. Provider-conditioning (HOW renders) — target owner: future constants module

| # | File / ~line | Symbol | Wording (≤12 words) | Verdict |
|---|---|---|---|---|
| C1 | native-tool-projection.ts L857 | image_generate description | "not a collage, contact sheet, grid, or multiple panels" | merge-into-constants (Rule A) |
| C2 | native-tool-projection.ts L927 | image_edit description | same collage rule for image_edit | merge-into-constants (Rule A dup) |
| C3 | native-tool-projection.ts L852–853 | image_generate outputMode desc | "each output is described as its own final image" | merge-into-constants (Rule D) |
| C4 | native-tool-projection.ts L920–921 | image_edit description | series = N separate final edited images | merge-into-constants (Rule D dup) |
| C5 | native-tool-projection.ts L977 | referenceImageAliases desc | "edited output stays rooted in source; references only guide it" | keep partial — model needs reason to pass refs; Rule C fragment → constants |
| C6 | native-tool-projection.ts L921–922 | image_edit description | "edited output still stays rooted in the source image" | merge-into-constants (Rule C dup) |
| C7 | runtime-image-generate-tool.service.ts L917 | composeSeriesPrompt | "not a collage, grid, contact sheet, or multi-panel composition" | merge-into-constants (Rule A) |
| C8 | runtime-image-generate-tool.service.ts L886–892 | resolveMultiImageExecutionPlan | "Return one final generated image only" | merge-into-constants (Rule B/D) |
| C9 | runtime-image-generate-tool.service.ts L916 | composeSeriesPrompt | "Keep same product/campaign identity across all series items" | keep (campaign-identity guidance; not Rule A–D) |
| C10 | runtime-image-edit-tool.service.ts L1284 | composeSeriesPrompt | "Use refs only as visual references; keep rooted in source" | merge-into-constants (Rule C) |
| C11 | runtime-image-edit-tool.service.ts L1290 | composeSeriesPrompt | "Return one final edited image, not a collage…" | merge-into-constants (Rule A/B) |
| C12 | runtime-image-edit-tool.service.ts L1245 | resolveMultiImageExecutionPlan variants | "Return one final edited image only" | merge-into-constants (Rule B) |
| C13 | runtime-image-edit-tool.service.ts L1251 | resolveMultiImageExecutionPlan default | "one standalone final edited image" | merge-into-constants (Rule B dup) |
| C14 | openai-provider.client.ts L347–348 | generateImage count>1 | "distinct standalone images… not collage, diptych, triptych" | merge-into-constants (Rule A/B) |
| C15 | openai-provider.client.ts L1825–1826 | buildImageEditPrompt count>1 | "distinct edited variations… not collage, diptych, triptych" | merge-into-constants (Rule A/B dup) |
| C16 | openai-provider.client.ts L1841–1842 | buildImageEditPrompt multi-ref | "Use additional reference images only as visual guidance…" | merge-into-constants (Rule C) |
| C17 | openai-provider.client.ts L1843 | buildImageEditPrompt single-ref | "Use second/reference image only as visual guidance…" | merge-into-constants (Rule C — single wording variant) |
| C18 | openai-provider.client.ts L1852 | buildImageEditPrompt with refs | "each returned image must be one standalone final image" | merge-into-constants (Rule A/B dup) |
| — | runtime-video-generate-tool.service.ts | (all) | No provider prompt instruction text | — (confirmed: video service adds no collage/series/reference prose) |

### 2D. Runtime-state hints — target owner: native-tool-projection.ts single helpers

| # | File / ~line | Symbol | Wording / purpose | Verdict |
|---|---|---|---|---|
| H1 | native-tool-projection.ts L83–96 | buildPendingDeliveryHint | "action='pending_delivery' → acknowledge only; not queued/accepted" | keep — correct token; single helper |
| H2 | native-tool-projection.ts L56–72 | describePerTurnCap | "Per-turn cap: N result units…" | keep — sourced from per-turn policy |
| H3 | native-tool-projection.ts L74–77 | appendPerTurnCapHint | Appends cap hint to base text | keep — utility, no duplication |
| H4 | native-tool-projection.ts L79–81 | appendToolDefinitionHint | Dedup-guard append | keep — utility |
| H5 | native-tool-projection.ts L124–163 | describeVideoVoiceCatalogHint | Lists available voiceKeys for voice_control cinematic | keep — credential-catalog runtime-state |
| H6 | native-tool-projection.ts L149–162 | describeTalkingAvatarVoiceCatalogHint | Lists talking-avatar voice shortlist | keep — runtime-state |
| H7 | native-tool-projection.ts L165–200 | describeVideoPersonaCatalogHint | Lists workspace saved personas with IDs and voices | keep — runtime-state |

---

## 3. Duplication Clusters

### Rule A — "no collage / grid / multi-panel composition" (7 sites, 3 wording variants)

| Site | File / ~line | Wording variant |
|---|---|---|
| A1 | native-tool-projection.ts L857 | "not a collage, contact sheet, grid, or multiple panels inside each image" |
| A2 | native-tool-projection.ts L927 | identical to A1 |
| A3 | runtime-image-generate-tool.service.ts L917 | "not a collage, grid, contact sheet, or multi-panel composition" |
| A4 | runtime-image-edit-tool.service.ts L1290 | identical to A3 |
| A5 | openai-provider.client.ts L348 | "Do not make a collage, grid, contact sheet, diptych, triptych, or multi-panel composition unless…" |
| A6 | openai-provider.client.ts L1826 | identical to A5 |
| A7 | openai-provider.client.ts L1852 | identical to A5 |

**Canonical (Slice 3):** One constant `ANTI_COLLAGE_RULE` with wording that names all formats including diptych/triptych (gateway-facing). The shorter variant (A3/A4) is adequate for the runtime series-item prompt.

### Rule B — "each returned image is one standalone final image" (5 sites)

| Site | File / ~line | Wording variant |
|---|---|---|
| B1 | runtime-image-generate-tool.service.ts L892 | "one standalone final image that stays faithful to the overall request" |
| B2 | runtime-image-edit-tool.service.ts L1251 | "one standalone final edited image that stays faithful to the overall request" |
| B3 | runtime-image-generate-tool.service.ts L886 | "Return one final generated image only" |
| B4 | openai-provider.client.ts L347 | "Return N distinct standalone images" |
| B5 | openai-provider.client.ts L1825 | "Return N distinct edited variations of the source image" |

### Rule C — "reference image is guidance only / output stays rooted in source" (5 sites)

| Site | File / ~line | Wording variant |
|---|---|---|
| C1 | native-tool-projection.ts L977 | "The edited output stays rooted in the source image; references only guide it" |
| C2 | native-tool-projection.ts L921–922 | "the edited output still stays rooted in the source image" |
| C3 | runtime-image-edit-tool.service.ts L1284 | "Use [refs] only as supporting visual references; keep the edited product rooted in [source]" |
| C4 | openai-provider.client.ts L1841–1842 | "Use the additional reference images only as visual guidance for style, appearance, makeup…" |
| C5 | openai-provider.client.ts L1843 | "Use the second/reference image only as visual guidance for style, appearance…" |

Note: C4/C5 are the same rule with different plurality phrasing. Slice 3 must produce both `REFERENCE_RULE_MULTI` and `REFERENCE_RULE_SINGLE` constants, or one parameterised builder.

### Rule D — "series = N separate images, one per item" (10 sites)

| Site | File / ~line | Wording fragment |
|---|---|---|
| D1 | native-tool-projection.ts L852 | "use outputMode='series' with seriesItems so each output is its own final image" |
| D2 | native-tool-projection.ts L857–858 | "count=N means N separate final images in this one job" |
| D3 | native-tool-projection.ts L884 | "one single-image instruction per requested output" |
| D4 | native-tool-projection.ts L920 | parallel to D1 for image_edit |
| D5 | native-tool-projection.ts L927 | parallel to D2 for image_edit |
| D6 | runtime-image-generate-tool.service.ts L886 | "Return one final generated image only" |
| D7 | runtime-image-generate-tool.service.ts L892 | "one standalone final image" |
| D8 | runtime-image-edit-tool.service.ts L1245 | "Return one final edited image only" |
| D9 | runtime-image-edit-tool.service.ts L1251 | "one standalone final edited image" |
| D10 | openai-provider.client.ts L347 | "Return N distinct standalone images" |

---

## 4. Dead-path Reachability Proofs

### Proof 1: `buildRuntimeToolPoliciesMarkdown` / `buildPromptToolMarkdownEntry` — dead in all seeded environments

1. `compile-prompt-constructor.service.ts` L350–362: `if (template) { interpolate } else { buildRuntimeToolPoliciesMarkdown(...) }`
2. `template` is `params.promptTemplates.tools ?? null` — null only when no `tools` row exists in the DB.
3. `seed.ts` L34–37: `upsertPromptTemplates()` upserts all keys from `PROMPT_TEMPLATE_DEFAULTS` (`VISIBLE_PROMPT_TEMPLATE_DEFAULTS` + `HIDDEN_PROMPT_TEMPLATE_DEFAULTS`).
4. `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.tools` (`bootstrap-preset-data.ts` L147): defines the default template.
5. `upsert` creates-or-updates — so after any seed run, the row exists.
6. **Conclusion:** In any seeded environment the fallback is unreachable. It is a cold-migration safety net only.

`buildPromptToolMarkdownEntry` is only called from `buildRuntimeToolPoliciesMarkdown` — both are dead. Safe to remove in Slice 4 (confirm no test fakes a missing `tools` template row).

### Proof 2: Ghost-verb strippers — dead (zero matches)

**`containsLegacyScheduledActionGuidance` + `resolveSanitizedScheduledActionDescription`** (L98–113)  
Pattern tokens: `assistant_check`, `hidden assistant follow-up`, `actionPayload`, `actionType`, `audience`.  
All live `scheduled_action` text (catalog L172–174; projection fallback): none of these tokens appear. The function always falls through to the unstripped description. The legacy terms were from an earlier `scheduled_action` schema (`actionType`/`actionPayload`/`audience` fields) that were removed in a past migration.

**`containsGhostBackgroundTaskAction` + `resolveSanitizedBackgroundTaskDescription`** (L104–121)  
Pattern: `create…update` or `update…(pause|resume|cancel|list)` in adjacent position.  
Live `background_task` text never puts "create" adjacent to "update" in the required pattern. Confirmed no match in catalog (L186–187) or projection fallback (L1462). Dead code.

---

## 5. Slice Handoff Notes

### Slice 1: Author the Native Tool Runtime selection guide

The `tools` block default (`bootstrap-preset-data.ts` L147–151) is 3 lines of generic boilerplate. Replace with a compact ≤40-line intent→tool map that covers (from this audit):

- Image: new image (`image_generate`) vs modify image (`image_edit`) vs animate/video (`video_generate`) vs describe/analyze (vision — no tool)
- Knowledge: `memory_search`/`memory_get` local-first → `web_search`/`web_fetch` for external; `web_search` when need sources, `web_fetch` when exact URL known
- Document: `document` tool vs inline text answer
- Memory/tasks (D5, from agents): `memory_write` for stable facts; `scheduled_action` for unconditional reminders; `background_task` for conditional/quiet follow-through
- Files: alias-first; `files.send` ≠ describe; `files.write_and_send` for immediate delivery
- Global call-don't-narrate rule (absorbs S5, S11)
- Deferred honesty: `action="pending_delivery"` (not `"deferred"`) is the real token; do not claim sent/attached unless that structural result arrived this turn

Rows S2–S16 provide the source material; move selection text only after the guide is live (additive-first, Slice 2 removes).

### Slice 2: Catalog cleanup

**Fix-drift (mandatory):**
- `image_generate.modelUsageGuidance` (L53): `action="deferred"` → `action="pending_delivery"`
- `image_edit.modelUsageGuidance` (L68): same + update single-ref wording to reflect `referenceImageAliases` plural API
- `video_generate.modelUsageGuidance` (L82): `action="deferred"` → `action="pending_delivery"`

**Move-to-selection-guide (after Slice 1 is live):** S4, S5, S7, S9, S10, S11, S13, S14, S15, S16.

**D5 `agents` template:** Remove Tasks Policy; reduce to Memory Policy hygiene only.

**`files` catalog (P19):** The catalog `files.modelUsageGuidance` is superseded by the policy hardcode and never reaches the model. Mark explicitly as "policy-overridden: see `runtime-tool-policy.ts` `resolveRuntimeToolUsageGuidance`" or drop it.

### Slice 3: Provider-conditioning constants module

**Create:** `apps/runtime/src/modules/turns/media-prompt-fragments.ts` (preferred — runtime composes; gateway does not re-add).

**Canonical fragments needed:**
- `ANTI_COLLAGE_RULE` (Rule A) — gateway-facing includes "diptych, triptych"
- `STANDALONE_IMAGE_RULE` (Rule B)
- `REFERENCE_RULE_MULTI` / `REFERENCE_RULE_SINGLE` (Rule C) or a parameterised builder
- `seriesItemHeader(index, total)` builder (Rule D header line)

Rows C1–C18 (excluding C9 and the model-facing part of C5) are replaced by imports from this module.

**Remove from model-facing tool schema:** The Rule A/B/D fragments in `native-tool-projection.ts` L857, L927 (and neighboring) are provider hygiene; the model does not render images. Keep only what the model needs to choose `outputMode`/`count` correctly (the intent — "series = N distinct images" — can stay; the "no collage" enforcement belongs in the provider prompt only).

### Slice 4: Dead-code sweep

**Remove (proven dead):**
- `buildRuntimeToolPoliciesMarkdown` (`runtime-tool-policy.ts` L426–451)
- `buildPromptToolMarkdownEntry` (`prompt-constructor-tool-metadata.ts` L252–262) — if only called from above
- `containsLegacyScheduledActionGuidance` + `resolveSanitizedScheduledActionDescription` (`native-tool-projection.ts` L98–113)
- `containsGhostBackgroundTaskAction` + `resolveSanitizedBackgroundTaskDescription` (`native-tool-projection.ts` L104–121)

**Keep (backward-compat guard):** `turn-execution.service.ts` L5176 `row.action !== "deferred"` — scoped to document tool, retain until document tool result contract removes all legacy `deferred` handling.

---

## 6. Row Count Summary

| Verdict | Count |
|---|---|
| keep / keep-evolve | ~28 |
| move-to-selection-guide | 16 |
| merge-into-constants | 14 |
| fix-drift | 7 |
| delete-dead | 4 |
| superseded (document as such) | 1 |
| **Total ledger rows** | **~70** |
