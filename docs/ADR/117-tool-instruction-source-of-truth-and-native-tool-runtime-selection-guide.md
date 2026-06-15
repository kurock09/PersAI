# ADR-117: Tool Instruction Source-of-Truth Consolidation and the Native Tool Runtime Selection Guide

## Status

Accepted

> Open program. Supersedes the scattered tool-instruction handling described in
> ADR-074 P1 (`tools` template note) and the per-tool guidance seeded in
> ADR-031 / ADR-106 / ADR-107 / ADR-086. This ADR governs **"Мир 2" only**:
> model-facing instructions about **which tool to call, when, and how the
> provider should render the result**. It does **not** touch the persona /
> system-prefix / classifier stack ("Мир 1"), which already has a clean
> DB-template source of truth via `bootstrap-preset-data.ts`.

---

## Context

### Problem in one sentence

The model frequently misfires on **tool selection** (calls the wrong tool, narrates a call instead of issuing it, or claims a deferred media result is already delivered) because the instructions that should teach it _which tool to use and when_ are **scattered across four+ layers, duplicated 3× for media tools, and partially drifted away from what the code actually does**.

### How tool instructions reach the model today

There are three distinct _kinds_ of model-facing tool instruction, and today each kind is written in **more than one place**, with no declared owner or precedence:

**Kind 1 — "WHICH tool / WHEN" (cross-tool selection & routing).**
There is no single home. Selection logic is smeared across:

- Per-tool `modelUsageGuidance` in `apps/api/prisma/tool-catalog-data.ts` (e.g. `image_generate` ~L52-53, `image_edit` ~L67-68, `video_generate` ~L81-82) — each tool independently re-explains how it differs from its neighbours ("use this only for creating a new image, not for editing", "do not use this for image description"). The cross-tool map only exists implicitly, by reading every entry.
- The current `tools` system-prompt block (`bootstrap-preset-data.ts` ~L147-151) is generic boilerplate ("Use only the machine-readable tools declared for this turn…") and carries **none** of the actual selection rules.
- Hardcoded behavioral hints in `apps/runtime/src/modules/turns/native-tool-projection.ts` (e.g. image series/anti-collage hints ~L857, ~L927; talking-avatar mode-choice block ~L1012-1029).

**Kind 2 — "WHAT a tool is + its parameters" (per-tool mechanical contract).**
This has a _mostly_ coherent path, but with a duplicate dead branch:

- Catalog `modelDescription` / `modelUsageGuidance` (DB-editable; seeded by `tool-catalog-data.ts`) →
  `runtime-tool-policy.ts` `resolveRuntimeToolDescription` / `resolveRuntimeToolUsageGuidance` (~L114-138, with hardcoded overrides for `files` and migration-hidden tools) →
  `RuntimeToolPolicy.description` / `.usageGuidance` →
  `native-tool-projection.ts` `resolveToolDefinitionDescription` (~L1690) merges policy text with **hardcoded fallback prose** and **runtime-only hints**.
- A parallel **legacy** path, `runtime-tool-policy.ts` `buildRuntimeToolPoliciesMarkdown` (~L426), re-emits the same catalog as a markdown TOOLS block. It is only used when there is no DB `tools` template — which never happens in seeded environments (the default `tools` template always exists). **Suspected dead path.**

**Kind 3 — "HOW the provider should render" (provider-conditioning prose).**
Pure provider hygiene ("don't produce a collage/grid", "return one standalone final image", "use the reference image only as guidance", "series = N separate images"). This is duplicated across **three layers**:

- Tool schema text in `native-tool-projection.ts` (`createImageGenerateToolDefinition` ~L836-889, `createImageEditToolDefinition` ~L912-977).
- Runtime prompt composers: `runtime-image-generate-tool.service.ts` `composeSeriesPrompt` (~L907-920) and `resolveMultiImageExecutionPlan` (~L875-894); `runtime-image-edit-tool.service.ts` `composeSeriesPrompt` (~L1254-1293) and `resolveMultiImageExecutionPlan` (~L1234-1253).
- Provider builder: `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` `generateImage` count>1 branch (~L347-348) and `buildImageEditPrompt` (~L1811-1860).

For a single `image_edit` series-with-references call, the "no collage" rule is therefore sent to the provider **three times**, in three slightly different wordings ("multi-panel composition" vs "diptych, triptych" vs "multiple panels inside each image").

### Documented duplication clusters (from the read-only audit)

- **Rule A — "no collage / grid / contact sheet / multi-panel":** 7 sites (projection ~L857, ~L927; image-generate composer ~L917; image-edit composer ~L1290; OpenAI client ~L348, ~L1826, ~L1852).
- **Rule B — "each returned image is one standalone final image":** 4 sites.
- **Rule C — "reference image is guidance only; output stays rooted in source":** 3 sites (projection param ~L977; image-edit composer ~L1281-1284; OpenAI client ~L1841-1846).
- **Rule D — "series = N separate images, one per item":** 8 sites.
- **Rule E — delivery/pending honesty:** spread across `buildPendingDeliveryHint` (projection), `DELIVERY_HONESTY_CONTRACT` (`turn-execution.service.ts` ~L347), open-job developer sections (~L2130-2228), deferred follow-ups (~L4460-4498), and catalog `modelUsageGuidance`.

### Concrete instruction-vs-code drift (the real danger)

This is not only cosmetic duplication. At least one instruction is **factually wrong against the code**, which actively teaches the model a falsehood:

- Catalog `modelUsageGuidance` for `image_generate`, `image_edit`, and `video_generate` all instruct the model: _"If the result says `action="deferred"` …"_. **The runtime tool result never returns `action="deferred"`.** The media tool services return `action: "pending_delivery"` (`runtime-image-edit-tool.service.ts`, `runtime-image-generate-tool.service.ts`; contract `RuntimeImageEditToolResult.action: "generated" | "skipped" | "pending_delivery"`). The string `"deferred"` survives only in a backward-compat guard at `turn-execution.service.ts` ~L5176 (`row.action !== "deferred" && row.action !== "pending_delivery"`). The model is told to look for a status token it will never see, so the "do not claim it was already sent" guardrail does not bind on the field the guidance names.

This is the canonical example of why the task is **reconcile-against-code, not merely tidy-up**: every retained instruction must be re-verified against the actual result contract and runtime behavior, and stale strings deleted.

### Constraints that shape the solution

1. **Byte-stable cached system prefix (ADR-074 P1, ADR-110).** The compiled `promptConstructor.ordinary.systemPrompt` is a prompt-cache prefix. Any change to the `tools` block changes the prefix and invalidates cache for every assistant; this is acceptable but must be a **deliberate, one-time** rollout via materialization, not churned repeatedly.
2. **Admin-editable templates.** The `tools` template is editable through `ManagePromptTemplatesService` / `/admin/presets`. Whatever we put there must remain admin-editable and have a sane TS default in `bootstrap-preset-data.ts`.
3. **Materialization rollout.** Changing seeds / template defaults / catalog guidance requires re-materializing published assistant versions (`MaterializeAssistantPublishedVersionService`). Slices that change defaults must trigger / document the rollout.
4. **No behavior regression for the model's _intended_ behavior.** The goal is to make the existing intended rules clearer and singular, not to silently change policy. Where we _do_ change behavior (e.g. fixing the `deferred` drift), it is called out explicitly.
5. **Production-grade, not a stopgap.** No TODO scaffolding, no compatibility shims left behind, no "temporary" second source of truth.

---

## Decision

### D1 — Three concerns, one source of truth each

We formally separate model-facing tool instructions into the three kinds above and assign **exactly one owning layer** to each. Nothing else may define that kind of instruction.

| Concern                                                                                                                             | Single owner (source of truth)                                            | Storage / editability                                                                                                                       | Reaches model via                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **WHICH tool / WHEN** (cross-tool selection, mutual exclusion, "call don't narrate", deferred-media honesty as a _behavioral_ rule) | **Native Tool Runtime selection guide** = the `tools` system-prompt block | DB `PromptTemplate` key `tools`, TS default in `bootstrap-preset-data.ts`, admin-editable                                                   | Cached system prefix                                                                                          |
| **WHAT a tool is + its parameters** (per-tool mechanical contract, parameter semantics, tool-specific constraints)                  | **Tool descriptor** built from the catalog                                | `tool-catalog-data.ts` `modelDescription` / `modelUsageGuidance` (+ DB admin overrides) → `RuntimeToolPolicy` → `native-tool-projection.ts` | Per-tool `ProviderGatewayToolDefinition` description + JSON-schema param descriptions                         |
| **HOW the provider renders** (anti-collage, standalone-image, series-cardinality, reference-is-guidance)                            | **Provider-conditioning constants module** (new)                          | One TS module (`packages/runtime-contract` or a runtime-local `media-prompt-fragments.ts`); not DB-editable                                 | Appended to the **provider** prompt only (runtime composers + gateway builders), never re-stated to the model |

**Precedence rule (must be documented in code and in `docs/API-BOUNDARY.md`):**

- Cross-tool selection rules live **only** in the selection guide. Per-tool catalog guidance must **not** re-explain how a tool differs from sibling tools; it may reference the concept ("see selection guide") but the comparative logic has one home.
- Per-tool mechanical contract lives **only** in the descriptor path. `native-tool-projection.ts` keeps **only** hints that depend on **per-turn runtime state** (per-turn cap, pending-delivery availability) — and those are deduplicated into single helpers, not re-inlined per tool.
- Provider-conditioning prose lives **only** in the constants module and is appended to the provider prompt. It is **removed** from tool schema text and from any place the model reads (the model does not need to be told "don't make a collage" — that is the provider's job).

### D2 — The Native Tool Runtime selection guide (the key new artifact)

The `tools` system-prompt block is promoted from generic boilerplate to the **canonical, compact, model-facing tool-selection guide**. This is the single place that answers the question the model is currently getting wrong: _"given what the user wants, which tool do I call, and when do I not?"_

It must be:

- **Compact and scannable** (the model reads it every turn; it is in the cached prefix). Target ≤ ~40 lines. It is a _map_, not a manual.
- **Cross-tool, intent-first.** Organized by user intent → tool, with explicit mutual exclusions. It must cover at minimum:
  - new image vs edit existing image vs generate video vs answer-questions-about-an-image (vision, no tool);
  - knowledge_search vs knowledge_fetch vs web_search vs web_fetch (local-first, then external);
  - document (create/revise) vs inline answer;
  - memory_write / scheduled_action / background_task selection (this currently lives in the `agents` template — see D5);
  - files surface (alias-first; send ≠ describe);
  - **call the tool immediately, never print a fake call / JSON / fenced pseudo-call as a substitute** (this "narration" anti-pattern is currently repeated in several catalog entries; it becomes one global rule here);
  - **deferred-media honesty as a behavioral rule** stated against the _real_ result contract (`action: "pending_delivery"`), not the stale `"deferred"` token.
- **Provider/parameter-free.** It must not restate parameter mechanics or provider-rendering prose; those belong to D1 owners 2 and 3.
- **Admin-editable** with a strong TS default; resettable via `resetToDefault`.

Rationale for choosing the `tools` block (vs the router classifier, vs per-tool guidance):

- The router classifier (`router_classifier`) is a hidden cost/latency-tier picker and does not select tools for the model; expanding it would mix concerns and still leave the main turn uninformed.
- Per-tool guidance cannot express cross-tool _mutual exclusion_ without duplication (today's failure mode).
- The `tools` block is already in the cached prefix, already admin-editable, and is exactly where "Native Tool Runtime" semantics belong. The user's instinct ("use the Native Tool Runtime field that gives rules when and which tool is appropriate") is the correct seam.

### D3 — Reconciliation mandate (verify against code, then delete drift)

Every instruction string retained anywhere in Мир 2 must be **verified against the actual code path / result contract** before it is kept. Where the instruction is wrong or unreachable, it is corrected or deleted, not preserved "to be safe". Known starting items (subagents must find more during Slice 0):

- Fix the `action="deferred"` → `action="pending_delivery"` drift in all three media catalog entries (and anywhere else the model is told to read `action`).
- Verify and either keep-with-correct-wording or remove the `referenceImageAlias` "if roles like 'the second photo' are unclear, ask" guidance against the actual `resolveImageSelection` behavior (now multi-reference per ADR-of-record for that change).
- Verify the `files` hardcoded description/guidance in `runtime-tool-policy.ts` (~L121-135) still matches the real `files.*` action set.

### D4 — Dead-code and drift removal

Subagents must **prove reachability before deleting**, then remove genuinely dead instruction code so the model surface has one path:

- `buildRuntimeToolPoliciesMarkdown` + `buildPromptToolMarkdownEntry` (legacy TOOLS markdown) and the `generateToolsPrompt` fallback branch — if the DB `tools` template is always present in every environment (seed + materialize), remove the dead fallback and its supporting helpers; otherwise document precisely when it triggers and gate it.
- Sanitized "ghost verb" strippers in `native-tool-projection.ts` (`resolveSanitizedScheduledActionDescription` ~L108-114, `resolveSanitizedBackgroundTaskDescription` ~L116-122) — verify whether any current catalog/policy text still contains the legacy verbs they strip; if not, the strippers are dead and should go.
- Any catalog `description` (the non-model `description` field) that is stale relative to `modelDescription` should be reconciled or explicitly documented as non-model-facing.

### D5 — `agents` (memory/tasks) selection rules

The memory/tasks selection logic currently in the `agents` template (`bootstrap-preset-data.ts` ~L130-145) overlaps the `memory_write` / `scheduled_action` / `background_task` catalog `modelUsageGuidance`. Decision: **the cross-tool selection portion** ("use memory_write for X, scheduled_action for simple reminders, background_task for conditional follow-through") **moves into / is unified with the Native Tool Runtime selection guide**; the `agents` template is either retired or reduced to non-selection policy (e.g. memory hygiene like "one concise memory per item") to avoid a second selection source. Subagents decide retire-vs-reduce based on what non-selection content remains, and document it.

---

### Admin surface impact (no new admin page)

Both editable owners already have an admin surface — the existing prompt-presets page `apps/web/app/admin/presets/page.tsx` (`/admin/presets`), backed by `admin-bootstrap-presets.controller.ts` (`ManagePromptTemplatesService`) and `admin-tool-metadata.controller.ts` (`ManageAdminToolPromptMetadataService`). **No new admin page or capability is introduced.** Required adjustments are UI-sync only:

- **Selection guide:** the `tools` template is already an editable key (`page.tsx:~74`). Today the page frames the `tools` block as an assembled `tools_catalog_block` ("assembled from the actual model-facing tool metadata surface", `page.tsx:~203-214`). After D2 the `tools` block is the **selection guide**, not a catalog dump — update that section's label/hint/preview so admins understand they are editing the cross-tool selection guide. The preview that synthesizes per-tool catalog text should move/relabel to the per-tool metadata section (which remains the descriptor owner).
- **Per-tool metadata editor:** unchanged (it is the descriptor owner). No work needed beyond keeping it the place to edit `modelDescription` / `modelUsageGuidance`.
- **`agents` template:** if D5 retires/reduces it, update its list entry and section (`page.tsx:~75, ~214`) accordingly.
- **Provider-conditioning constants:** intentionally **not** surfaced in admin (TS-only provider hygiene).

Subagents touching `tools` / `agents` defaults (Slices 1-2) must update `apps/web/app/admin/presets/page.tsx` (and its test `page.test.tsx`) in the **same slice**, and run `--filter @persai/web run typecheck` + web lint as part of the gate.

## Target architecture (end state)

```
MODEL-FACING (read by the assistant every turn / per tool)
├── System prefix `tools` block  ──►  Native Tool Runtime SELECTION GUIDE   [D2]   (DB template `tools`)
│        the single "which tool / when / call-don't-narrate / deferred-honesty" map
├── Per-tool descriptor          ──►  WHAT + params                          [D1-2] (catalog → policy → projection)
│        mechanical contract only; no cross-tool comparison, no provider prose
└── Runtime-state hints          ──►  per-turn cap, pending-delivery          (single helpers in projection)

PROVIDER-FACING (read by the image/video provider, never by the assistant)
└── media-prompt-fragments.ts    ──►  anti-collage / standalone / series / reference-guidance  [D1-3]
         consumed by runtime composers AND provider-gateway builders; one wording
```

Invariant to enforce by test: **each Мир-2 rule string appears in exactly one source module.** (See Slice 5 golden tests.)

---

## Work plan (slices for executor subagents)

Each slice is a self-contained unit sized for one Sonnet subagent. Slices are ordered; a later slice may assume the earlier landed. Every slice ends with the **standard verification gate** (below) and must leave the tree green and committed-ready (no half-states, no TODOs). Subagents must **read the live code first** and treat the line numbers in this ADR as approximate anchors, not literal truth.

### Standard verification gate (run at the end of every slice)

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck` and `--filter @persai/provider-gateway run typecheck` and `--filter @persai/runtime-contract run typecheck`
6. Affected package tests (`runtime`, `provider-gateway`, `api`). If seeds/templates changed, re-run the relevant seed/catalog tests (`apps/api/test/seed-tool-catalog.test.ts`, `runtime-tool-policy.test.ts`).
7. If any default template, seed, or catalog guidance changed: regenerate/seed artifacts and confirm materialization output, then note the cache-prefix change.

---

### Slice 0 — Authoritative instruction inventory + reconciliation ledger (no behavior change)

**Goal:** produce the single source document that drives every later slice. No instruction text is changed yet.

**Do:**

- Walk every Мир-2 instruction site (use this ADR's audit as the starting index; expand it). For each string record: file + symbol + approx line, **kind** (selection / per-tool contract / provider-conditioning / runtime-state), current wording, and a **verified-against-code verdict**: `keep` / `move-to-selection-guide` / `merge-into-constants` / `fix-drift` / `delete-dead`.
- Confirm or refute each suspected-dead path in D4 by tracing reachability (seed presence of `tools` template; whether ghost strippers ever match live text).
- Confirm the `action` token the model actually receives for deferred media, and list every place that tells the model to read `action`.

**Deliverable:** `docs/ADR/117-tool-instruction-inventory.md` (a working ledger; may be deleted at program closure or folded into API-BOUNDARY). This is documentation only.

**Acceptance:** ledger covers ≥ every site listed in this ADR plus any newly found; each row has a verdict; dead-path reachability is proven, not assumed.

**Gate:** lint/format (docs only; no code change). **Risk:** none (read-only + doc).

---

### Slice 1 — Author and wire the Native Tool Runtime selection guide (D2)

**Goal:** the `tools` block becomes the canonical selection guide; later slices delete the duplicated selection logic it absorbs.

**Do:**

- Rewrite the `tools` default in `apps/api/prisma/bootstrap-preset-data.ts` into the compact selection guide per D2 (intent→tool map, mutual exclusions, call-don't-narrate, deferred honesty against `pending_delivery`, knowledge/web local-first, files alias-first/send≠describe). Keep ≤ ~40 lines.
- Keep it admin-editable; confirm `ManagePromptTemplatesService` visible keys and `resetToDefault` still cover `tools`.
- Re-seed (`seed.ts upsertPromptTemplates`) and confirm `CompilePromptConstructorService.generateToolsPrompt` renders the new template into `systemPrompt` / `stablePrefix`.
- Trigger / document materialization rollout so the new prefix lands; explicitly note the one-time prompt-cache invalidation.

**Do NOT yet:** remove the duplicated selection text from catalog guidance (that is Slice 2) — Slice 1 is additive so the model is never left with _less_ guidance mid-program.

**Acceptance:** new prefix contains the selection guide; `seed-tool-catalog`/prompt-template tests updated; materialized bundle shows the guide; cache-prefix change documented.

**Risk:** medium (cache prefix change). Mitigation: single deliberate rollout, behavior-additive.

---

### Slice 2 — Consolidate per-tool contract; strip cross-tool duplication from catalog (D1-2, D3, D5)

**Goal:** catalog guidance becomes purely per-tool mechanical; cross-tool selection logic now lives only in the guide.

**Do:**

- Edit `tool-catalog-data.ts`: remove the comparative/selection sentences now owned by the guide (e.g. image_generate "not for editing… not video", image_edit "do not use for description/OCR", video "not for editing video/image questions"), **keeping** genuinely per-tool mechanical guidance (parameter usage, `background="transparent"` rule, etc.). **Fix the `action="deferred"` → `pending_delivery` drift here.**
- In `native-tool-projection.ts`: remove hardcoded fallback prose that duplicates catalog text; keep only state-dependent hints, and dedupe them into single helpers (`buildPerTurnCapHint`, `buildPendingDeliveryHint`). Ensure `resolveToolDefinitionDescription` is the one merge point.
- Apply D5: move memory/tasks selection rules into the guide; retire-or-reduce the `agents` template accordingly; reconcile with `memory_write`/`scheduled_action`/`background_task` catalog guidance so the selection rule has one home.
- Re-materialize; update `runtime-tool-policy.test.ts` expectations.

**Acceptance:** no catalog entry re-explains a sibling tool; no `action="deferred"` remains in model-facing text; memory/tasks selection has one home; tests green.

**Risk:** medium (touches seeded guidance for live tools). Mitigation: Slice 1 already added the guide, so net guidance is preserved; diff reviewed string-by-string.

---

### Slice 3 — Provider-conditioning constants module (D1-3)

**Goal:** anti-collage / standalone / series / reference-guidance exist once, provider-side only.

**Do:**

- Create one constants/helper module (recommended: `apps/runtime/src/modules/turns/media-prompt-fragments.ts`, or in `packages/runtime-contract` if `provider-gateway` must share the exact strings — pick based on import boundaries and document the choice). Define canonical fragments + small composers for series/variants/reference wording with a single agreed phrasing.
- Refactor `runtime-image-generate-tool.service.ts` and `runtime-image-edit-tool.service.ts` (`composeSeriesPrompt`, `resolveMultiImageExecutionPlan`) to consume the module.
- Refactor `provider-gateway` `openai-provider.client.ts` (`generateImage` count>1, `buildImageEditPrompt`) to consume the same fragments (or receive already-composed text from runtime — decide and document who owns final composition; preference: runtime composes, gateway does not re-add rules).
- Remove provider-conditioning prose from **model-facing** tool schema text in `native-tool-projection.ts` (the model does not need "no collage"); keep only what the model needs to _choose_ `outputMode`/`count` correctly (e.g. "series = N distinct images").
- Preserve the existing single-reference wording where tests assert it, or update those tests deliberately (see `apps/provider-gateway/test/openai-provider.client.test.ts`).

**Acceptance:** each of Rules A/B/C/D resolves to one definition; runtime + gateway both reference it; provider output unchanged in spirit; tests updated and green.

**Risk:** medium (provider prompt wording drives image quality). Mitigation: keep semantics identical; snapshot/assert composed provider prompts in tests.

---

### Slice 4 — Dead-code & drift sweep (D4)

**Goal:** one path only; no zombie sources.

**Do (only what Slice 0 proved dead):**

- Remove `buildRuntimeToolPoliciesMarkdown` / `buildPromptToolMarkdownEntry` and the `generateToolsPrompt` legacy fallback **iff** proven unreachable; otherwise document the trigger and leave gated.
- Remove ghost-verb strippers if proven non-matching.
- Reconcile stale non-model `description` fields or document them as non-model-facing.
- Grep for any remaining `action="deferred"` model-facing reference and any remaining duplicated rule strings; fail the slice if the golden test (Slice 5) finds duplicates.

**Acceptance:** no dead instruction path remains; reachability proofs recorded in the ledger / ADR closure.

**Risk:** medium (deleting code). Mitigation: reachability proof required before deletion; full gate.

---

### Slice 5 — Golden tests, docs, ADR closure

**Goal:** lock the invariant so the mess cannot silently return.

**Do:**

- Add a "single-source" golden test: assert each canonical Мир-2 rule (collage/standalone/series/reference; the selection-guide-only rules) appears in exactly one module (e.g. count occurrences across `native-tool-projection.ts`, image services, gateway client, catalog, templates).
- Add/extend tests that the selection guide renders into the materialized prefix and that catalog guidance no longer contains cross-tool comparison or `action="deferred"`.
- Update `docs/API-BOUNDARY.md` (precedence rules D1), `docs/ARCHITECTURE.md` (the three-concern model + selection-guide seam), `docs/TEST-PLAN.md` (golden tests), `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`.
- Close ADR-117: record reachability proofs, the final owner table, and the cache-prefix rollout SHA.

**Acceptance:** golden test green; docs updated; ADR closed with evidence.

**Risk:** low.

---

## Consequences

### Positive

- The model gets **one clear, intent-first selection guide** every turn → fewer wrong-tool calls, less narration-instead-of-calling, correct deferred-media honesty bound to the real `action` value.
- Each rule has **one editable home**; admins edit the selection guide via `/admin/presets`, per-tool mechanics via tool-metadata admin, provider hygiene via one TS module.
- Eliminates the 3× media duplication and the `action="deferred"` falsehood; removes dead legacy paths.
- A golden test makes regression to "scattered instructions" fail CI.

### Negative

- One deliberate prompt-cache prefix invalidation when the new `tools` guide ships (Slice 1) and again if Slice 2 changes the prefix; mitigated by batching and documenting.
- Moving selection rules out of per-tool guidance means the guide and catalog must be reviewed together; the precedence doc + golden test enforce this.
- Provider-conditioning centralization risks subtle wording changes affecting image output; mitigated by keeping semantics identical and snapshotting composed provider prompts.

## Alternatives considered

- **Expand the router classifier to pick tools.** Rejected: it is a hidden cost-tier picker; the main turn still needs the guidance, and this mixes concerns.
- **Keep selection rules per-tool but cross-link.** Rejected: cross-tool mutual exclusion cannot be expressed without duplication — the current failure mode.
- **Leave provider prose in the tool schema (model-facing).** Rejected: the model does not render images; "no collage" is provider hygiene and bloats the cached prefix and per-tool descriptions.
- **One-shot full refactor in a single change.** Rejected: prefix-cache, materialization, and image-quality risk demand additive-then-subtractive slicing.

## Rollout & safety

- Slices are additive-first (guide added before duplicates removed) so the model is never left with _less_ guidance mid-program.
- Default-template / seed / catalog changes require materialization rollout; each such slice documents the cache-prefix impact and the rollout SHA.
- No git push and no deploy without explicit user direction (repo rule). Each slice leaves a clean, green, commit-ready tree.

## Closure (2026-06-15)

Status note: ADR status remains **Accepted**. Implementation for Slices 0-5 has landed in the working tree; materialization rollout + deploy are still pending.

### Slice status

- Slice 0 — authoritative instruction inventory + reconciliation ledger: **done**
- Slice 1 — Native Tool Runtime selection guide: **done**
- Slice 2 — catalog consolidation + `agents` reduction: **done**
- Slice 3 — provider-conditioning constants module: **done**
- Slice 4 — dead-code & drift sweep: **done**
- Slice 5 — golden tests, docs, and closure: **done**

### Final owner table (shipped reality)

| Concern                                                                                                                  | Final single owner                      | Shipped path                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **WHICH tool / WHEN** (cross-tool selection, mutual exclusion, call-don't-narrate, pending-delivery honesty as behavior) | **Native Tool Runtime selection guide** | DB `tools` prompt-template block, seeded in `apps/api/prisma/bootstrap-preset-data.ts`, admin-editable via presets                |
| **WHAT a tool is + its parameters** (per-tool mechanical contract)                                                       | **Tool descriptor path**                | `apps/api/prisma/tool-catalog-data.ts` -> runtime-tool-policy -> `apps/runtime/src/modules/turns/native-tool-projection.ts`       |
| **HOW the provider renders** (anti-collage, standalone-image, series-cardinality, reference-guidance)                    | **Provider-conditioning fragments**     | `packages/runtime-contract/src/media-prompt-fragments.ts`, consumed by runtime media composers and provider-gateway builders only |

Precedence rule reaffirmed: cross-tool comparison lives only in the selection guide; per-tool descriptor text stays mechanical; provider-conditioning text stays provider-only and must not be repeated in model-facing tool descriptions.

### Reachability proofs behind Slice 4 deletions

The Slice 4 removals remain justified by the inventory ledger in `docs/ADR/117-tool-instruction-inventory.md`, Section 4:

- **Proof 1:** legacy TOOLS markdown path is dead in every seeded environment because the DB `tools` template is always upserted; therefore `buildRuntimeToolPoliciesMarkdown`, `buildPromptToolMarkdownEntry`, and the old `generateToolsPrompt` fallback were removable.
- **Proof 2:** the ghost-verb sanitizers were dead because current live catalog text had zero matches for the stripped legacy tokens/patterns; they were no longer sanitizing any reachable model-facing text.

The inventory document remains the historical ledger for the audit and proof set; it is intentionally retained.

### Intentionally kept residual

- The document-tool backward-compat guard `action !== "deferred"` remains intentionally kept in `turn-execution.service.ts`. It is not part of the active image/video selection-guide surface, but it still protects the document path's older compatibility seam.

### Rollout note

- **cache-prefix rollout SHA: PENDING**
- Fill this in only when the materialization rollout + GKE deploy actually happen. No SHA is recorded here yet, and this closure does **not** imply deployment occurred.
