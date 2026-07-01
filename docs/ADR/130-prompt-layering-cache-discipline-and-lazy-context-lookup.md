# ADR-130: Prompt layering, cache discipline, and lazy context lookup

## Status

Open

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

| Concern | Owner | Lives in |
| --- | --- | --- |
| Cross-tool selection and "which tool / when" | Native Tool Runtime selection guide | `tools` prompt template |
| Per-tool mechanical contract and parameters | Tool descriptor path | catalog -> runtime policy -> projection |
| Provider/rendering hygiene | provider/runtime contract fragments | provider-facing code only |
| Large or dynamic reference data | lazy action lookup | existing tool family action/result |

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

### D7 — Prompt-cache discipline becomes an explicit rollout invariant

Every slice in this ADR must classify its effect on the three ADR-119 stable breakpoints:

- BP1: identity/voice/character notes
- BP2: protocols/response contract/tool policy
- BP3: enabled skills catalog

Rules:

- stable-prefix changes are allowed only as deliberate rollout events;
- no slice may move turn-variable or workspace-variable data into BP1/BP2/BP3;
- any seed/default/template change must document the one-time cache invalidation and the required materialization path.

### D8 — Persist and replay thread tool history under cache discipline [added 2026-07-02]

The thread must persist `tool_use` + `tool_result` blocks and replay them on subsequent turns so the model retains cross-turn memory of its own actions (parity with Claude/Cursor), instead of re-deriving state from scratch each turn.

To keep this from bloating or thrashing the cached prefix, the replay is explicitly governed:

- replayed tool history is **volatile context**, never baked into BP1/BP2/BP3 stable prefixes;
- replay is tail-oriented: recent tool exchanges are replayed in full;
- old or large `tool_result` payloads are compacted/elided with an explicit "earlier tool results truncated" marker — but never at the cost of the durable facts the model needs to continue (e.g. the active document project path/version);
- growth of the replayed history must not silently invalidate the cached prefix; its churn stays in the volatile zone.

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

### Slice 0 — Inventory and budget ledger

Subagent: GPT-5.4.

Goal:

- produce the implementation ledger before behavior changes.

Do:

- inventory every current prompt/descripor string touched by this ADR;
- classify each as stable-prefix / volatile / descriptor / lazy-lookup candidate;
- record prompt-budget baselines for the current `enabled_skills` and heavy descriptors;
- confirm exact duplicate/stale owners before code deletion starts.

Deliverable:

- `docs/ADR/130-prompt-layering-inventory.md`

Acceptance:

- every later slice has a concrete move/delete/keep ledger to follow.

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

## Acceptance criteria

This ADR is not complete until all of the following are true:

1. `enabled_skills` stays compact with many enabled skills.
2. dynamic catalogs are no longer injected inline into heavy descriptors.
3. the stable prefix contains no stale pushed-memory wording.
4. `files` model-facing guidance has a single clear owner.
5. scenario/todo volatile duplication is materially reduced.
6. `character_notes` precedence is explicit and documented.
7. all prompt-owner decisions are reflected in active docs, not only in code.
8. thread `tool_use` / `tool_result` history is persisted and replayed across turns under cache discipline (D8), so the model retains cross-turn memory of its own actions.

## Residual risk

- Compacting `<enabled_skills>` too aggressively could reduce first-turn scenario discoverability; Slice 1 must verify that `skill.describe` and engage flow preserve practical usability.
- Re-layering `video_generate` changes wording on a quality-sensitive tool; Slice 3 must keep focused regression tests around descriptor/projection behavior.
- Volatile dedupe must not accidentally remove the cues that keep scenario progression reliable; Slice 4 needs focused turn-execution coverage, not only snapshots.

## Next recommended step

Founder-approved sequence (2026-07-02): D8 (cross-turn tool history) is **recorded here now**, but the **next actual implementation work is the standalone document polishing + honest-delivery slice** (remove the provenance delivery wall so attach auto-registers and always delivers; idempotent durable document project with latest-version editing; render as the single door without steering the model into `shell`; self-sufficient/hidden exporter) which then **closes the document ADRs (129/131)**. Only after that does ADR-130 implementation begin — starting with Slice 0 (inventory/budget ledger), then the highest-value slices, with Slice 6 (tool-history persistence) as the platform-root fix for cross-turn amnesia.
