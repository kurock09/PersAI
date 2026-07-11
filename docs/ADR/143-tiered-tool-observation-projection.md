# ADR-143: Tiered tool observation projection

Status: **implemented locally / landed 2026-07-11 — S1–S5 local gate green; residual = deploy + Lavka/long-browser live smoke.**

Baseline SHA: PersAI `1503b23d`.

## Context

A single user turn can run a long native tool loop (tens of steps). Every
iteration re-sends the full in-memory `toolHistory` to the provider. Cross-turn
hydration (ADR-130 D8) also replays the last few assistant turns'
`priorToolExchanges`.

That design is correct for continuity (shell multi-step, browser multi-hop), but
the model-facing surface is wrong for heavy tools:

- `browser` returns up to 12k chars of page text plus up to 200 interactive
  elements on every `snapshot`/`act`.
- `shell` / `exec` can carry up to plan `maxStdoutBytes` (default 128 KiB).
- `files` can carry up to 16k model-visible content chars.

Replaying those full observations on every later step produces quadratic token
growth (empirically extreme on browser shopping loops). ADR-130 D8 already
persists and replays exchanges under cache discipline, but its model-facing cap
is naive char-tail truncation (`PRIOR_TOOL_RESULT_MAX_CHARS`), which neither
preserves structured tool truth nor removes the dominant fields.

This ADR replaces that model-facing policy with one production projection for
both in-turn and cross-turn paths. Canonical stored exchanges stay full.

## Decision

1. **Single owner.** Model-facing tool observation projection lives only in
   `apps/runtime/src/modules/turns/project-tool-exchanges-for-model.ts` (plus
   adjacent policy/compactor helpers). No second truncate path, no
   provider-gateway projection, no feature flag, no dual-path rollout.

2. **Canonical vs model-facing.**
   - `turnState.toolExchanges` / persisted message `toolExchanges` remain full.
   - Provider-facing `toolHistory` and hydrated `priorToolExchanges` are always
     projected before send.

3. **Exactly two call sites.**
   - `turn-execution.service.ts` → `buildToolLoopProviderRequest` (in-turn).
   - `prior-tool-exchange-replay.ts` (cross-turn).

4. **Tiers.** Each exchange is assigned exactly one of:
   - `full` — current model-visible payload after fresh sanitize
     (`stringifyToolResultPayloadForModel`), unchanged structurally.
   - `compact` — tool-aware structured reduction (no raw DOM/body/stdout dump).
   - `masked` — one-line placeholder retaining tool identity and outcome gist.

5. **Windows (locked).**
   - In-turn: newest exchange `full`; next 4 older `compact`; all older
     `masked`.
   - Cross-turn: last up to 3 prior assistant turns with exchanges remain the
     replay window. Within each replayed turn, the newest exchange is `full`;
     older exchanges in that turn are `compact` then `masked` under the same
     windows. Total projected replay stays under
     `PRIOR_TOOL_REPLAY_TOTAL_BUDGET_TOKENS` (2000); when over budget, drop the
     oldest **turn** first (existing D8 drop rule).

6. **Tool compactors (locked).**

   | Tool | compact keeps | compact drops |
   |------|---------------|---------------|
   | `browser` | action, finalUrl/title, opsSummary, elementCount, extractedCount, warning, isError gist | `page.content`, `page.elements`, large extracted bodies |
   | `shell` / `exec` | exit/reason, stdoutTail ≤ 500 chars, stderrTail ≤ 500 on error, paths | full stdout/stderr/job blob |
   | `files` | action, path, charCount, truncated | file body / content |
   | other tools | small JSON gist / counts | oversized opaque blobs |

7. **Errors.** `toolResult.isError === true` never becomes a bare mask that
   hides the failure. Minimum tier is `compact` with error/reason/stderr kept.

8. **Marker.** Projected JSON includes `_observationTier:
   "full"|"compact"|"masked"` so tests and logs can assert tier assignment.
   Canonical storage must not require this field.

9. **Fresh sanitize stays separate.** `sanitize-tool-result-for-model.ts`
   continues to shape the **fresh** result (files 16k cap, binary omit, browser
   login handoff). It is not a history projector.

10. **Cutover deletes naive replay truncate.** Implementation removes
    `capToolResultContent`, `PRIOR_TOOL_RESULT_MAX_CHARS`, and the
    “showing tail” char-slice path from `prior-tool-exchange-replay.ts`.
    Argument size bounding may remain only if owned by the same projection
    module under one policy — no parallel char-tail for results.

11. **Out of scope.** Do not change
    `MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS` (stays 200). Do not add
    per-step LLM summarization. Do not change tool loop budgets/limits.
    Do not move projection into provider-gateway.

## Relationship to ADR-130 D8

ADR-130 D8 remains the persistence + cache-discipline contract (native
`priorToolExchanges` woven at prior assistant turns; volatile/tail only;
window of 3 turns; ~2000-token replay budget). This ADR replaces only the
**model-facing content policy** for those exchanges and for in-turn
`toolHistory`. It does not reopen ADR-130 for new prompt-layering scope.

## Consequences

- Long browser/shell/files loops stop re-paying full observation cost every
  iteration while the latest page/stdout/file state remains fully visible.
- Cross-turn replay stops feeding truncated DOM/JSON tails that are neither
  small nor useful.
- Observability and audits still see full exchanges; only provider input is
  projected.
- Prompt-cache stable prefix must remain independent of projection churn
  (projection lives in tool-history / conversation tail only).

## Rejected

- keeping char-tail truncate alongside projection
- feature-flagged old/new paths
- lowering interactive element cap as a substitute for history projection
- LLM summarization of every old observation
- projecting inside Anthropic/OpenAI/DeepSeek clients

## Implementation slices

| Slice | Owner work | Done when | Status |
|-------|------------|-----------|--------|
| **S0** | This ADR | decisions locked | **done** |
| **S1** | Core projection module + unit tests + 40-step browser fixture | fixture assert projected ≪ raw; last exchange full | **done** |
| **S2** | Wire in-turn `toolHistory` | integration: older tiers compact/masked; storage full | **done** |
| **S3** | Wire cross-turn replay; delete naive truncate | grep of old truncate symbols = 0; hydration + cache-guard green | **done** |
| **S4** | Projection metrics log + TEST-PLAN / CHANGELOG / SESSION-HANDOFF | ADR status → landed locally | **done** |
| **S5** | Orchestrator verification gate | lint, format, typechecks, focused suites green | pending |

## Acceptance

1. One owner module; exactly two call sites; zero naive result char-tail path.
2. In-turn and cross-turn use the same tier policy and compactors.
3. Full `toolExchanges` storage unchanged; provider sees projected content only.
4. Last in-window exchange remains structurally full for browser (including
   `page.elements` when present).
5. Error exchanges retain failure detail at least at compact tier.
6. `MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS` remains 200.
7. Prompt-cache stable-prefix guard stays green.
8. Deploy + live Lavka/long-browser smoke is the residual after local land.
