# ADR-130: Prompt layering, cache discipline, and lazy context lookup

## Status

Closed locally 2026-07-03

## Date

2026-06-29

## Baseline SHA

`01dfefca`

## Relationship to prior ADRs

- Extends ADR-117 as the active cleanup program for model-facing prompt/tool instruction ownership.
- Extends ADR-119 as the active cleanup program for prompt size, cache discipline, and scenario/render strategy.
- Extends ADR-125 only where scenario-seeded todos and volatile-context duplication now need a new source-of-truth boundary.
- Does **not** reopen ADR-117, ADR-119, or ADR-125. Their landed behavior remains the baseline until each slice in this ADR replaces it cleanly.

## Founder directive

The current PersAI prompt architecture is too heavy, too duplicated, and too mixed in responsibility for stable long-term operation. The system prompt, enabled-skills catalog, and several tool descriptors currently carry overlapping instructions, stale contract text, and dynamic workspace data that should not sit in the cached prefix. Prompt-cache stability matters, tool-selection rules must have one owner, and large or dynamic context should load lazily through action-based lookups instead of living inline by default.

This program exists to make that cleanup production-grade rather than cosmetic.

## Orchestration model

This ADR is intended for orchestrated execution.

- The parent agent is the orchestrator: owns the ADR, dispatches bounded implementation slices, reviews every diff, verifies invariants, reconciles docs, and decides whether a slice is actually closure-ready.
- Implementation subagents should use GPT-5.4 unless the orchestrator documents a concrete reason to use another available model.
- Subagents must not broaden scope, weaken tests, or preserve duplicate prompt sources "for safety".
- Every slice must leave one clear owner per instruction kind. If a slice introduces a second source of truth, the slice is not done.
- If docs and code disagree at slice start, the orchestrator pauses and reconciles before code changes.

## Context

### Problem in one sentence

PersAI's current prompt stack is architecturally correct in broad shape but still too expensive and too noisy in the details: stable prefix content is larger than necessary, instruction ownership is still duplicated across prompt templates and tool descriptors, and dynamic workspace-specific catalogs are still being pushed inline instead of loaded on demand.

### Current pain points

#### P1 — AOT cached prefix still carries too much catalog detail

`<enabled_skills>` currently scales poorly when many skills are enabled. Scenario-level `one_line`, `first_step_preview`, and `recommended_tools` are repeated for every rendered scenario even though only a tiny subset is relevant in a given turn. This pushes variable task detail into BP3, increases cache cost, and fights the progressive-disclosure design that ADR-119 intended.

#### P2 — System-prefix ownership is still partially blurred

Several prompt facts are duplicated or stale:

- identity/user facts are still too easy to render in more than one place;
- `response_contract` behavior is still not cleanly isolated as its own owned block;
- `memory_protocol` still carries legacy wording around `<persai_memory>` even though ADR-120 retired the pushed memory block;
- `files` guidance still has more than one effective owner across catalog, runtime policy, and projection.

These are not just wording issues; they increase drift risk and expand the stable prefix without adding signal.

#### P3 — Some tool descriptors are overloaded with dynamic or comparative context

`video_generate` and `document` are the clearest examples. Their model-facing text currently mixes:

- tool selection guidance that belongs in the selection guide;
- parameter/mechanical rules that belong in the descriptor;
- workspace-specific catalogs and dynamic hints that should be looked up lazily;
- provider/path-specific rendering constraints that should not be repeated to the model inline.

The result is descriptor bloat and poor prompt-cache hygiene.

#### P4 — Scenario state is duplicated across volatile surfaces

After scenario engage and todo seeding, the same work can be represented simultaneously in:

- `<persai_active_scenario>`;
- `<persai_chat_plan>`;
- repeated `<system-reminder>` text;
- and the historical `skill.engage` tool result in conversation history.

The chat plan is useful and the engage result is acceptable as history, but the volatile prefix currently repeats more scenario detail than the model needs each turn.

#### P5 — `character_notes` precedence is insufficiently explicit

ADR-119 correctly preserved `<voice>` and `<character_notes>` as layered blocks, but the active architecture still needs one explicit rule for precedence when user-authored character text conflicts with structural voice mechanics or other system-owned invariants. The field is user-owned and must remain verbatim, but its priority relative to other prompt owners must be stated clearly.

#### P6 — No cross-turn tool memory (tool_use / tool_result are not persisted and replayed) [added 2026-07-02]

The turn loop does not persist prior `tool_use` + `tool_result` blocks into the thread transcript and replay them on the next turn. `toolHistoryCount` resets per turn, so the model begins each turn with no memory of what it already did in this thread. This is a **platform-level root cause**, not a document quirk, and it was observed causing concrete production damage in the document workflow (2026-07-01 live, reproduced twice):

- on a re-visited uploaded DOCX the model re-ran `document.extract` every turn, creating duplicate projects (`doc-…`, `-2`, `-3`);
- it re-seeded scaffolds and, lacking memory of the render door, bypassed `document.render` by running `soffice` manually through `shell`;
- it burned the per-turn tool budget without ever converging on a delivered file, then reported a false "готово" while the actual output was blocked and left as an unregistered orphan.

The failure class is general to any multi-step tool workflow. A durable compact "active project" state fact would only patch the document symptom; the correct fix is persisting and replaying thread tool history under strict cache discipline so the model can see its own prior actions on every turn.

## Decision

### D1 — Four instruction/data layers, one owner each

We formalize four distinct prompt/tool layers and assign one owner to each:

| Concern                                      | Owner                               | Lives in                                |
| -------------------------------------------- | ----------------------------------- | --------------------------------------- |
| Cross-tool selection and "which tool / when" | Native Tool Runtime selection guide | `tools` prompt template                 |
| Per-tool mechanical contract and parameters  | Tool descriptor path                | catalog -> runtime policy -> projection |
| Provider/rendering hygiene                   | provider/runtime contract fragments | provider-facing code only               |
| Large or dynamic reference data              | lazy action lookup                  | existing tool family action/result      |

Rules:

- If text compares tools or tells the model when **not** to call a sibling tool, it belongs only in the selection guide.
- If text explains one tool's own actions, arguments, or result contract, it belongs only in the descriptor path.
- If text exists only to shape provider output, it must not be repeated in model-facing prompt/descriptors.
- If text is large, workspace-specific, or turn-variable, it must not live in the stable prefix by default; it must load lazily through an action lookup or a tool result returned only when needed.

### D2 — `<enabled_skills>` becomes compact again

The AOT `<enabled_skills>` catalog is reduced to a compact routing surface.

Per skill, the stable prefix may include:

- `id`
- `key`
- `display_name`
- short `summary`
- `when_to_use`
- `category`
- bounded tags

Per scenario, the stable prefix may include only:

- `key`
- `name`

The following scenario data moves out of the AOT prefix:

- `one_line`
- `first_step_preview`
- `recommended_tools`
- long instruction-card body
- guardrails
- examples

Those details must load lazily through the `skill` family:

- `skill({ action: "describe", skillId, scenarioKey? })` for read-only details before engage when needed
- `skill({ action: "engage", ... })` result for the active full instruction payload

Additional guardrail:

- the renderer must enforce a total rendered scenario cap for the catalog (target 24-32 scenario rows total), with an explicit compact tail such as "more scenarios available via `skill.list` / `skill.describe`".

This decision intentionally supersedes ADR-119's richer AOT scenario payload on scale grounds. The governing invariant changes from "show step-1 preview in prefix" to "keep the prefix compact and make scenario detail cheap to load on demand".

### D3 — System prefix is cleaned to true stable owners only

The stable prefix must contain only information that is both durable and worth paying for every turn.

Required cleanup:

- identity/user facts render exactly once in their owned blocks (`<identity>`, `<user>`, `<voice>`, `<character_notes>`);
- `response_contract` is an explicit owned block, not ad hoc wording mixed into other sections;
- `memory_protocol` must describe the current ADR-120 truth and must not imply a pushed `<persai_memory>` block;
- `files` guidance must resolve to one model-facing owner and one descriptor owner, with no runtime-policy shadow source that can drift.

The `system` template must stop acting as a second catch-all container for facts already rendered elsewhere.

### D4 — Heavy tool descriptors move to lazy action lookup

Large or dynamic tool context must leave inline descriptors.

#### `video_generate`

Inline descriptor text should keep only:

- what the tool does;
- the core action/parameter contract;
- the honest result contract (`pending_delivery`, etc.);
- truly invariant constraints.

Dynamic persona/voice/workspace guidance must move to lazy actions in the same tool family, for example:

- `video_generate({ action: "list_personas" })`
- `video_generate({ action: "list_voices" })`
- `video_generate({ action: "describe_avatar_mode" })`

Runtime projection may still surface compact state hints such as counts, availability, or default persona labels, but must not inline large catalogs into the descriptor text.

#### `document`

Inline descriptor text should keep only the current visible-workspace workflow contract and parameter semantics. Long examples, branchy workflow tutorials, and dynamic path/catalog text must move to action-style lookups inside the `document` family or to existing visible workspace evidence such as Working Files and tool results.

#### General rule

If a descriptor includes:

- a list of workspace-specific resources,
- long branch-specific tutorials,
- or repeated comparative selection logic,

that content is a candidate for lazy lookup and should not remain inline.

#### Lazy-action contract (shared by D2 and D4) [added 2026-07-02]

Every detail moved out of the prefix/descriptor loads through a read-only action in the owning tool family, under one uniform contract:

- the action is **read-only**: no side effects, no state mutation, safe to call speculatively;
- it returns a **bounded** payload (its own char cap) as a normal tool result, never a pushed prompt block;
- the result is **volatile/tail** content only — it must never re-enter the stable prefix;
- the descriptor keeps a one-line pointer to the action (e.g. "details: `skill.describe`") instead of the content itself.

Concrete lazy actions this ADR introduces:

| Family           | Action                                                 | Serves                                                                                                         |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `skill`          | `describe(skillId, scenarioKey?)`, `list`              | scenario `one_line` / `first_step_preview` / `recommended_tools` / guardrails / examples, long skill-card body |
| `video_generate` | `list_personas`, `list_voices`, `describe_avatar_mode` | workspace persona catalog, voice shortlists, cinematic-vs-talking_avatar selection detail                      |
| `document`       | `describe_workflow`                                    | multi-step examples, LibreOffice import path, project/path/collision semantics                                 |

### D5 — Scenario/todo truth is split deliberately, not duplicated

While a scenario is active and a chat plan exists:

- `<persai_chat_plan>` owns the ordered plan/status list;
- `<persai_active_scenario>` owns only the current operational step plus exit condition;
- `<system-reminder>` owns only truly recency-critical nudges that are not already obvious from those two blocks.

Concretely:

- `<persai_active_scenario>` should render the current `in_progress` step in full, plus `exit_condition`;
- non-current future/past step bodies should not be repeated there once the same scenario has already been seeded into chat-plan todos;
- the generic active-scenario tick reminder should be removed or rewritten if it only repeats the active-scenario header;
- scenario plan-intake reminder must continue to fire only when the scenario is active and there are no open chat-plan rows.

Conversation history may still contain the original `skill.engage` result; that is accepted as tail history, not as a volatile-prefix owner.

### D6 — `character_notes` stays verbatim, but precedence becomes explicit

`<character_notes>` remains user-owned and must continue to render verbatim.

Precedence rule:

1. system-owned safety and hard product invariants win;
2. `<voice>` owns speech mechanics and structural delivery behavior;
3. `<character_notes>` owns user-authored personality/color inside those mechanics;
4. defaults/fallback archetype text loses to the three layers above.

This means:

- we do **not** rewrite or sanitize user-authored `character_notes` in this ADR;
- we do state clearly that `character_notes` does not overrule hard safety, result-contract honesty, or tool-usage invariants;
- when `<voice>` and `<character_notes>` pull in different directions, the compiler does not merge them by heuristic prose; it preserves both, with `<voice>` as the structural envelope.

### D7 — Prompt-cache discipline becomes an explicit, testable rollout invariant [expanded 2026-07-02]

BP1/BP2/BP3 are **logical invalidation groups**, not physical provider breakpoints. Verified cache reality (2026-07-02):

- **Anthropic** places a single `cache_control` marker on the whole `tools + system` zone — there are no per-zone markers (the ADR-119 Slice 2 multi-block path was rejected). Any change anywhere in the system prefix invalidates the whole cached prefix.
- **OpenAI** caches by exact longest-prefix match — ordering is load-bearing; volatile content must never be interleaved into the stable prefix.

The governing invariant is therefore **zone order + byte-stability**, not breakpoint bookkeeping:

```text
[ STABLE PREFIX (byte-stable across turns) ]
    -> [ VOLATILE CONTEXT ]
        -> [ CONVERSATION TAIL + tool-history replay ]
```

Rules:

- the stable prefix must be byte-identical across turns for the same materialized bundle; nothing turn-variable or workspace-variable may appear inside it;
- volatile and tail content (active scenario, chat plan, reminders, environment, D8 tool-history replay) must always sit **after** the stable prefix, never spliced into it;
- every slice classifies its effect on BP1/BP2/BP3 content and treats any prefix change as a single deliberate rollout event with a documented one-time cache invalidation + materialization path;
- a golden cache-guard test (defined in Slice 0) asserts (a) the stable prefix holds no turn/workspace-variable strings, (b) no volatile `volatileKind` block appears inside the stable prefix, and (c) each zone stays within its char/token budget.

Tools-array stability (verified 2026-07-02):

- The `tools` array is the FIRST cached segment (Anthropic order `tools -> system -> messages`; OpenAI exact prefix). Any per-turn byte change to `tools` invalidates the entire downstream prefix.
- Current good state: ordinary chat keeps `toolChoice: "auto"` and a bundle-stable tool set; per-turn variability (presence, routing) correctly lives in `developerInstructions`, not in `tools`/`system`. `excludedToolNames` is used only for background synthetic turns. This is aligned with OpenAI/Anthropic guidance and must be preserved.
- **Known per-turn `tools` mutation to fix or accept:** the `knowledge_search` / `knowledge_fetch` source enum is rebuilt per turn (the `skill` source is added/dropped based on active-skill routing — `turn-execution.service.ts:781-786, 909-923`). Because `tools` is first, this busts the whole prefix on skill-toggle turns. Preferred fix: keep the enum byte-stable and enforce skill-source access at execution time (ADR-120 already gates access server-side), or document it as an accepted cache cost. Do not solve it by editing the array shape per turn.
- Invariant for any FUTURE per-turn tool gating: restrict via provider `allowed_tools` / `tool_choice`, never by editing the `tools` array bytes (both providers cache-preserve the former, bust on the latter).

### D8 — Persist and replay thread tool history under cache discipline [added 2026-07-02]

The thread must persist `tool_use` + `tool_result` blocks and replay them on subsequent turns so the model retains cross-turn memory of its own actions (parity with Claude/Cursor), instead of re-deriving state from scratch each turn.

To keep this from bloating or thrashing the cached prefix, the replay is explicitly governed:

- replayed tool history is **volatile context**, never baked into BP1/BP2/BP3 stable prefixes;
- replay is tail-oriented: recent tool exchanges are replayed in full;
- old or large `tool_result` payloads are compacted/elided with an explicit "earlier tool results truncated" marker — but never at the cost of the durable facts the model needs to continue (e.g. the active document project path/version);
- growth of the replayed history must not silently invalidate the cached prefix; its churn stays in the volatile zone.

Replay contract (concrete):

- **Where persisted:** tool exchanges are stored as replayable thread state (canonical transcript metadata or runtime-session state — the implementation slice picks exactly one owner and documents it), keyed to the chat so a later turn can rebuild them.
- **Replay window:** the last N tool exchanges are replayed in full; older ones collapse to a single compact marker (`[earlier tool results truncated]`) plus preserved durable continuation facts (active project path/version, produced file paths, last delivery outcome).
- **Position:** replay is emitted in the conversation-tail/volatile zone after the stable prefix, tagged so Anthropic (`tool_use` / `tool_result`) and OpenAI (`function_call` / `function_call_output`) render it natively without touching the cached prefix.
- **Not a new provider path:** the runtime already builds in-turn `toolHistory` (runtime -> provider-gateway -> native blocks); D8 adds the cross-turn persistence + bounded replay layer on top. P6's "`toolHistoryCount` resets per turn" refers to that per-turn in-memory array being re-initialized empty each turn — D8 is the durable layer it currently lacks.

Landed design [2026-07-02] — supersedes the hypothesis above where they differ. During implementation the "separate volatile block" framing was rejected in favour of the provider-native, cache-correct shape (Path A):

- **Where persisted (6a):** a dedicated server-only nullable JSONB column `assistant_chat_messages.tool_exchanges` stores each assistant turn's full `ProviderGatewayToolExchange[]` (`tool_use` + `tool_result`, result content included). Written only on the repository path; never projected to any client-facing entity/DTO.
- **Representation (6b):** replay is NOT a tagged volatile block. Prior exchanges are woven into the transcript as **native `tool_use`/`tool_result` blocks at their own turn's position** (between that turn's user question and its final assistant text) via a new `ProviderGatewayTextMessage.priorToolExchanges` field. All three providers (Anthropic `tool_use`/`tool_result`, OpenAI `function_call`/`function_call_output`, DeepSeek `tool_calls` + `role:"tool"`) reuse their existing exchange renderer — one representation only, no digest, no parallel path.
- **Window + budget:** the last 3 prior assistant turns that carry exchanges are replayed; a total replay budget (~2000 tokens) drops the oldest turn first when exceeded. Older turns are not replayed (their final text stays, exactly as before). The current inbound turn is never attached (its in-turn loop still flows via `toolHistory`).
- **Per-result / per-args caps:** each `tool_result` is capped to 2000 chars keeping the TAIL with a top marker `[tool result truncated: N chars omitted, showing tail]`; binary content collapses to `[binary content omitted]` (shared detector reused from `sanitize-tool-result-for-model`); `tool_use` arguments cap at 600 serialized chars. All caps are size-based and deterministic (position-independent).
- **Cache correctness (why no volatile block is needed):** the replay lives inside the recent conversation tail, which is already the uncached window (`ANTHROPIC_HISTORY_BREAKPOINT_MIN_TOKENS` = 3000 tokens sits below the Anthropic moving history breakpoint; OpenAI/DeepSeek automatic prefix caching only re-processes the tail). Adding the newest turn's blocks and dropping the oldest as it ages both happen in this tail, so the deep cached prefix (system + tools + older history) is never mutated. Anthropic's moving-breakpoint byte accounting counts the replayed blocks naturally because they become ordinary history messages. A cache-stable-prefix guard test pins that replay changes only tail messages and that identical replay state is byte-identical.

This decision **supersedes the "compact durable-state fact" band-aid**: document-project reuse (no `-2`/`-3` proliferation), no-shell convergence on the render door, and honest delivery all follow naturally once the model can see its own prior tool actions. The document polishing slice may still add idempotent project reuse as an independent safety net, but it is no longer the primary fix for cross-turn amnesia.

## Non-goals

- Reopening ADR-119's three-zone prompt architecture itself.
- Reintroducing pushed memory blocks or undoing ADR-120.
- Removing `character_notes` or forcing users into persona modes.
- Replacing chat-plan todos with server-owned scenario progression logic.
- Moving provider-conditioning prose back into model-facing descriptors.
- Starting broad product behavior changes unrelated to prompt/tool layering.

## Target architecture

```text
STABLE PREFIX
├── identity / user / voice / character_notes
├── protocols / response_contract / selection guide
└── compact enabled_skills catalog

VOLATILE CONTEXT
├── current active scenario step
├── chat plan window
├── system reminders with no duplicate ownership
└── environment / other existing volatile blocks

ON-DEMAND LOOKUP
├── skill.describe / skill.engage full details
├── video_generate dynamic persona/voice detail
└── document workflow/resource detail when needed
```

## Work plan

### Standard verification gate

Every implementation slice ends with:

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck`
6. affected focused tests for touched prompt/tool surfaces

Prompt-focused minimum tests, when relevant:

- `apps/api/test/adr119-golden-prompt-snapshot.test.ts`
- `apps/api/test/bootstrap-preset-data.test.ts`
- `apps/api/test/tool-catalog-data.test.ts`
- `apps/api/test/runtime-tool-policy.test.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `apps/runtime/test/turn-execution.service.test.ts`
- `apps/runtime/test/build-system-reminder-blocks.service.test.ts`

### Slice 0 — Executable inventory, per-tool optimization table, and budget ledger [expanded 2026-07-02]

Subagent: GPT-5.4. Orchestrator reviews and signs off before any behavior-changing slice starts.

Goal:

- produce the executable ledger every later slice follows: a per-tool decision table, a system-prefix owner table, numeric zone budgets, the stale-test ledger, and the cache-guard baseline.

Do:

- **Per-tool table (all model-facing tools, ~26).** One row per tool with columns: current model-facing size (chars) · keep-inline (mechanical contract) · -> move to action (lazy) · -> selection-guide (cross-tool) · -> provider-only · delete (duplicate/stale). Every non-empty cell names the concrete string with its `file:line`. Example decided rows (from the 2026-07-02 audit): `video_generate` -> persona/voice catalogs + mode tutorial move to `list_personas`/`list_voices`/`describe_avatar_mode`; `skill` -> scenario detail moves to `skill.describe`/`skill.list`; `document` -> multi-step tutorial moves to `document.describe_workflow`; `files` -> delete the runtime-tool-policy shadow override, keep one descriptor + one selection-guide entry.
- **System-prefix owner table.** One row per stable-prefix block/fact (identity, user, locale, timezone, voice, character_notes, response_contract, reminders_protocol, memory_protocol, enabled_skills, tool_usage_policy): current owner(s) -> single target owner -> duplicates to delete.
- **Numeric budgets.** Record current char/token size per zone (stable-prefix total, enabled_skills, each heavy descriptor, selection guide, volatile blocks) and set a target ceiling per zone. These ceilings are the measurable acceptance bar for later slices.
- **Stale-test ledger.** List every test that currently locks stale behavior (e.g. the `persai_memory` assertion in `compile-prompt-constructor.service.test.ts`, `SCENARIO_CATALOG_RENDER_LIMIT=8`, the ADR-119 golden snapshot) with the slice that will update each. A slice updates its own guard tests; it never preserves stale wording just to keep tests green.
- **Cache-guard baseline.** Capture the current stable-prefix hash and define the golden cache-guard test (D7): stable prefix byte-stable, no turn/workspace-variable strings inside it, no volatile block inside it, each zone within budget.

Deliverable:

- **LANDED 2026-07-02:** `docs/ADR/130-prompt-layering-inventory.md` — per-tool optimization table (24 model-facing tools + 5 shadow rows), system-prefix owner table, numeric zone budgets (baseline → target ceiling), stale-test ledger by slice, and the cache-guard test spec. Produced by 3 GPT-5.4 read-only worker audits, compiled by the orchestrator. No behavior change.

Acceptance (met):

- every later slice has a concrete move/delete/keep row with `file:line`;
- every zone has a baseline number and a proposed target ceiling (§3 constants pending founder confirmation);
- the cache-guard test spec and stale-test ledger exist before any code deletion starts.

#### Slice 0 decisions closed (2026-07-02, best-practice-grounded)

Grounded in current OpenAI + Anthropic caching guidance (order `tools -> system -> messages`; any prefix byte change busts everything downstream; keep a small stable core catalog and load detail on demand; vary tool access via `allowed_tools`/`tool_choice`, never by editing the array).

1. **Budget ceilings — confirmed as CI guard floors, not targets.** `STABLE_PREFIX ≤ 10k`, `ENABLED_SKILLS ≤ 4.5k` (24-32 scenario rows, `key+name` only), `SELECTION_GUIDE ≤ 6.5k`, inline `TOOL_DESCRIPTION ≤ 1.5k` (+ lazy actions). Guard rule: never shrink the stable prefix below the provider cache minimum (Sonnet 1024 tok / Opus-Haiku 4096 tok) — under-minimum prefixes are not cached at all.
2. **`character_notes` + uncapped skill fields — asymmetric.** `character_notes` stays verbatim (D6); apply a generous soft cap with a UI warning (~2k chars), never a silent prod truncation — it is stable per assistant so it does not hurt cache. System-owned skill fields ARE hard-capped: `summary ≤160`, `when_to_use ≤200`, `recommended_tools` bounded. Rule: user-authored text = budget + warning; system text = hard cap.
3. **`files` single owner — collapse to two.** Selection guide owns "when files vs exec/shell/grep/glob"; the descriptor (catalog -> projection) owns mechanics. Delete the hardcoded `runtime-tool-policy.ts` override (the shadow owner) and the stale catalog copy. General rule: the policy layer carries permissions/limits only, never model-facing prose.
4. **Lazy-action families/signatures — confirmed (priority by weight):** `video_generate.list_personas()` / `list_voices({mode,locale?})` / `describe_avatar_mode()`; `skill.list({category?})` / `describe({skillId,scenarioKey?})`; `document.describe_workflow({kind})`; `shell.describe_environment()` (low priority). Contract per the D2/D4 lazy-action table.
5. **Tools-array cache invariant added to D7** (see D7): ordinary tool set stays bundle-stable + `toolChoice:"auto"`; the one live per-turn `tools` mutation is the `knowledge_search`/`knowledge_fetch` skill-source enum — fix by execution-time gating or accept as cost; future tool gating uses `allowed_tools`/`tool_choice`, never array edits.

### Slice 1 — Compact `<enabled_skills>` and add lazy skill detail lookup

Subagent: GPT-5.4.

Goal:

- restore progressive disclosure and shrink BP3.

Do:

- reduce scenario rows in `<enabled_skills>` to `key + name`;
- add total-cap behavior for rendered scenario rows;
- add `skill.describe` (or the equivalent read-only action in the same tool family);
- move scenario detail and long skill-body detail out of the prefix.

Acceptance:

- large enabled-skill sets no longer explode the cached prefix;
- skill detail remains accessible on demand.

### Slice 2 — System-prefix cleanup and single owners

Subagent: GPT-5.4.

Goal:

- remove duplicate/stale stable-prefix owners.

Do:

- dedupe identity/user rendering;
- isolate `response_contract`;
- fix `memory_protocol` to match ADR-120 reality;
- collapse `files` guidance to one model-facing and one descriptor owner.

Acceptance:

- no stale `<persai_memory>` implication remains in active prompt defaults;
- no duplicate identity/user render path remains in the stable prefix.

### Slice 3 — Heavy descriptor re-layering

Subagent: GPT-5.4.

Goal:

- move dynamic/heavy descriptor text to lazy lookup.

Do:

- re-layer `video_generate`;
- re-layer `document`;
- keep projection-only runtime hints compact and state-dependent only;
- delete comparative selection text from descriptors once the selection guide owns it.

Acceptance:

- descriptors become short mechanical contracts again;
- workspace-specific catalogs no longer live inline in the descriptor text.

### Slice 4 — Scenario/chat-plan volatile dedupe

Subagent: GPT-5.4.

Goal:

- reduce per-turn volatile duplication without losing plan control.

Do:

- narrow `<persai_active_scenario>` to current step + exit condition;
- keep chat-plan as the visible ordered plan/status list;
- remove or rewrite redundant active-scenario reminders.

Acceptance:

- the same scenario step body is not repeated across multiple volatile owners every turn.

### Slice 5 — Character precedence, docs closure, and rollout notes

Subagent: GPT-5.4.

Goal:

- lock the final precedence model and closure docs.

Do:

- codify `character_notes` precedence in active docs and prompt defaults where needed;
- update `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, and `SESSION-HANDOFF.md` to match landed code;
- record cache-prefix rollout notes and closure residuals.

Acceptance:

- next-session readers do not have to rediscover the precedence or prompt-owner model.

Closed [2026-07-02]: D6 precedence codified in code (`20e1792c`) and in `ARCHITECTURE.md` (persona-layer precedence note). **Cache-prefix rollout SHA = `f1a7ca44c545dd7a957e908e7c8107cc64df2fcd`** — the deploy SHA that shipped the full ADR-130 prompt-layering/cache-discipline program (Slices 0–6b) to `origin/main` after a green gate. No further prompt-owner residuals; this also resolves the ADR-117 "cache-prefix rollout SHA pending" note for the layering cutover.

### Slice 6 — Cross-turn tool-history persistence and replay (D8) [added 2026-07-02]

Subagent: GPT-5.4.

Goal:

- give the model durable cross-turn memory of its own `tool_use` / `tool_result` actions under cache discipline.

Do:

- persist thread `tool_use` + `tool_result` blocks and replay them on subsequent turns as volatile context;
- implement tail replay + compaction/elision of old/large tool results with an explicit truncation marker, preserving durable continuation facts;
- verify no BP1/BP2/BP3 stable-prefix regression and no cache thrash from history growth.

Acceptance:

- across turns the model sees its prior tool actions and does not re-derive state (e.g. does not re-extract a document project it already created);
- prefix cache discipline (D7) holds.

Sequencing note (founder-approved 2026-07-02): this slice is **recorded now but scheduled after** the standalone document polishing/delivery-safety slice that closes the document ADRs. Order: (1) record D8 here; (2) land document polishing + honest delivery and close doc ADRs (129/131); (3) implement ADR-130 including this slice.

Landed [2026-07-02] — local, uncommitted-then-committed, no push:

- **6a (persistence):** dedicated server-only `assistant_chat_messages.tool_exchanges` JSONB column; runtime turn result threads `toolExchanges` through the API persist path into the repository; never client-projected. (committed `77969bd4`)
- **6b (replay):** native `priorToolExchanges` replay per the "Landed design" contract above — window 3 / ~2000-token budget / per-result 2000-char tail cap / args 600-char cap / binary placeholder — woven into the transcript tail, reusing each provider's existing exchange renderer; deterministic; cache-stable-prefix guard extended. Verified: provider-gateway + runtime suites green (re-run by the auditor), api/web/runtime/provider typechecks, lint, format:check.

### Follow-through slices [added 2026-07-03]

Reconciliation note: Slices 0–6 landed and were pushed, but a 2026-07-03 re-audit against acceptance criteria #2/#7 and inventory §6 found the D1 descriptor dedup and the §6 cross-cutting cleanups were **not** actually executed (they were implied by Slice 3 + §6 but never landed). These follow-through slices make that remaining ADR-130 scope explicit in the ledger, plus one newly-found adjacent item (Slice 10). Baseline for these: prod hotfix `b1e8f9d3`.

#### Slice 7 — D1 descriptor/template dedup (completes Slice 3's D1 obligation + criterion #7)

Subagent: GPT-5.4. Goal: one owner for cross-tool routing = `<tool_usage_policy>` selection guide.

Do:

- DELETE from tool descriptors (`tool-catalog-data.ts`) and synthetic per-tool templates (`bootstrap-preset-data.ts`) every cross-tool "which / when-not / prefer X / use X first" clause that already exists in `<tool_usage_policy>`;
- MOVE the unique routing rules (exact-URL→`web_fetch`, unknown-URL→`web_search`, no-URL→`web_search`, `knowledge_fetch` needs prior `knowledge_search`, `quota_status` before knowledge retrieval, `tts`/`presentation` "reply directly", `exec` vs `shell`/`files`) into the guide, then delete from the descriptor;
- keep self-referential lazy-action pointers (e.g. `video_generate` → its own `describe_avatar_mode`/`list_personas`/`list_voices`);
- update guard tests + regenerate the ADR-119 golden snapshot; keep the cache-guard green.

Acceptance: criterion #7 holds; no routing rule lost (every MOVE present in the guide).

#### Slice 8 — §6 cross-cutting cleanups

Subagent: GPT-5.4. Do:

- remove dead projection fallback description strings in `native-tool-projection.ts` (shadowed by non-null `policy.description`) — maintenance-debt removal, not live-token savings;
- resolve shadow-source rows (`memory_search`/`memory_get`/`persai_tool_quota_status`) so the canonical `knowledge_search`/`knowledge_fetch`/`quota_status` synthetic owners are the only source;
- dedupe pending-delivery honesty to a single owner (guide + one projection helper), removing per-tool catalog/projection copies (image_generate, image_edit, video_generate, presentation, tts).

Acceptance: no dead fallback prose remains; one owner per shadow source; one pending-delivery honesty owner.

#### Slice 9 — lazy-action completion (criterion #2 remainder), re-scoped for ADR-132

Subagent: GPT-5.4. Note: the old inventory `document.describe_workflow({kind:"extract"|"edit"|"register_version"|…})` signature is **stale** — ADR-132 collapsed `document` to a strict three-verb surface, so `extract`/`edit`/`register_version` no longer exist. Do: after Slice 7 pruning, re-measure the `document` and `shell` descriptors; only add a lazy action if the pruned descriptor is still heavy, and if so scope it to current ADR-132 truth. `shell.describe_environment()` remains low priority (env/install/egress/git-auth tutorial off-prefix).

Acceptance: criterion #2 holds for the current (post-ADR-132) tool surface; no stale lazy-action shape is introduced.

#### Slice 10 — prompt-constructor admin registry single-source-of-truth

Subagent: GPT-5.4. Problem (found 2026-07-03): the admin Prompt Constructor front (`apps/web/app/admin/presets/page.tsx`) drifted from the backend assembly: its block palette (L144-155) still lists retired legacy blocks (`assistant_identity_block`, `user_identity_block`, `locale_block`, `timezone_block`, `persona_instructions_block`, `heartbeat_block`) and omits the three blocks the live default assembly actually uses (`reminders_protocol_block`, `memory_protocol_block`, `response_contract_block`), and its hardcoded preview/reset-default (L392-414) diverges from the real backend default (`bootstrap-preset-data.ts:34-50`). This does not corrupt the compiled prompt (backend null-drops unknown tokens) but makes the control plane misleading and unsafe to edit.

Do: make the admin palette + preview/reset-default reflect the backend truth (add the three real blocks, drop/label legacy, align the default order to `bootstrap L34-50`, fix stale hints like `agents_block` "memory policy block"); prefer sourcing the canonical default from one place rather than a divergent hardcoded copy. Keep backward-compat for legacy tokens in the compiler (they stay supported/null-dropped, just not advertised).

Acceptance: the admin constructor palette/default match the backend-compiled assembly; no dangling/yellow tokens; one source of truth for the default order.

### Closure note [2026-07-03]

Slices 7, 8, and 10 landed locally and closed the remaining post-audit scope:

- **Slice 7 / D1** made `<tool_usage_policy>` the single owner of cross-tool routing.
- **Slice 8 / §6** removed dead projection fallback prose, cleared shadow prompt-owner drift on the hidden alias/remap rows, and deduped pending-delivery honesty to the real live owners.
- **Slice 10** brought the admin Prompt Constructor UI back into alignment with the backend-compiled assembly and removed the stale local preview/default copy.

Founder direction on 2026-07-03 explicitly skipped Slice 9. Under the current post-ADR-132 tool surface this does **not** re-open a stale lazy-action shape: `document` is now the strict three-verb surface (`inspect` / `render` / `convert`), and no new `document.describe_workflow(...)` compat path was introduced. `shell.describe_environment()` remains deliberately out of prefix scope.

## Acceptance criteria

This ADR is not complete until all of the following are true:

1. `enabled_skills` stays within its Slice 0 char/token ceiling regardless of how many skills are enabled (scenario rows = `key + name`, global cap ~24-32 + compact tail).
2. no heavy descriptor exceeds its Slice 0 ceiling; dynamic/workspace catalogs (personas, voices, skill/scenario detail, document tutorials) load via lazy actions, not inline.
3. the stable prefix contains no stale pushed-memory wording (`memory_protocol` matches ADR-120 reality).
4. `files` model-facing guidance has a single clear owner (no runtime-policy shadow override).
5. scenario/todo volatile duplication is materially reduced: `<persai_active_scenario>` renders only the current step + exit condition, and no step body is repeated across volatile owners in the same turn.
6. `character_notes` precedence is explicit and documented (D6 four-tier rule).
7. every cross-tool "which / when-not" rule lives only in the selection guide; descriptors carry no sibling-tool routing (D1).
8. the cache-guard test passes: stable prefix is byte-stable, holds no turn/workspace-variable data, and no volatile block appears inside it (D7).
9. thread `tool_use` / `tool_result` history is persisted and replayed across turns under cache discipline (D8), so the model retains cross-turn memory of its own actions.
10. all prompt-owner decisions are reflected in the active program ledger, not only in code.
11. the admin Prompt Constructor (`apps/web/app/admin/presets/page.tsx`) block palette and preview/reset-default match the backend-compiled system assembly (`bootstrap-preset-data.ts` + `compile-prompt-constructor.service.ts`): no dangling/unregistered tokens, no retired legacy blocks advertised, one source of truth for the default order (Slice 10).

All criteria above are satisfied on the local tree as of 2026-07-03.

## Residual risk

- Compacting `<enabled_skills>` too aggressively could reduce first-turn scenario discoverability; Slice 1 must verify that `skill.describe` and engage flow preserve practical usability.
- Re-layering `video_generate` changes wording on a quality-sensitive tool; Slice 3 must keep focused regression tests around descriptor/projection behavior.
- Volatile dedupe must not accidentally remove the cues that keep scenario progression reliable; Slice 4 needs focused turn-execution coverage, not only snapshots.

## Next recommended step

Push/deploy the verified local batch and run the usual live regression on prompt assembly, tool routing, and document workflow continuity against dev before treating the closure as rollout-complete.
