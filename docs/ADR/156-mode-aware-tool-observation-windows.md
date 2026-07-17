# ADR-156: Mode-Aware Tool Observation Windows

## Status

**Closed 2026-07-17 — founder-approved, implemented, independently audited
CLEAN, deployed, and founder-live-accepted.**

## Context

ADR-143 closed the single model-facing projection path for canonical full tool
exchanges and established `full | compact | masked` tiers. Its one-window
policy made an exact tool result compact immediately after enough later calls
inside the same assistant tool loop. Live ADR-151 acceptance exposed the
practical failure: a Script result was exact on the immediate next iteration,
then later `todo_write` and `skill` calls aged it to compact before the final
answer.

This is a global observation-window issue, not a Script result-shape issue.
ADR-143 remains closed and authoritative for projection ownership, compactors,
canonical storage, masking, and metrics.

## Decision

Tier assignment is mode-aware and has no exception by tool name or type:

- `in_turn`: newest 3 exchanges `full`, next 3 older `compact`, all older
  `masked`;
- `cross_turn`: newest 1 exchange `full`, next 4 older `compact`, all older
  `masked` (the existing ADR-143 window);
- in either mode, an error assigned `masked` is upgraded to `compact`.

The policy owner is `tool-observation-policy.ts`. Projection metrics count the
effective tiers emitted after mode-aware assignment. Canonical stored exchanges
remain full and projection does not mutate them.

The abandoned dedicated Script compact reducer, 2,000-character output cap, and
truncated-JSON representation are removed. Script uses the same global windows
and ordinary compact/mask reducers as every other tool.

## Scope boundaries

This ADR does not reopen ADR-143 and does not change:

- compact reducer shapes for browser, shell/exec, files, or generic tools;
- canonical exchange persistence;
- tool-call argument bounding;
- error diagnostic projection;
- runtime tool execution or sandbox produced-file handling.

Dynamic windows, token-threshold compaction, and per-tool/type exceptions are
out of scope.

## Verification

- Seven-exchange boundary fixtures prove in-turn
  `masked, compact×3, full×3` and cross-turn
  `masked×2, compact×4, full`.
- Old masked errors upgrade to compact in both modes.
- A live-shaped `script → todo_write → skill` list is naturally all-full
  in-turn without Script-specific logic and remains
  `compact, compact, full` cross-turn.
- Real turn-execution integration covers six in-turn exchanges as
  `compact×3, full×3` and a declaration-ordered parallel three-tool batch as
  all-full.
- Existing browser/shell/files/generic compactor tests remain green.
- Metrics reflect effective tiers and source exchanges remain canonical/full.

## Closure evidence

- Commit `43f653b4` passed CI and image publish; Argo was Synced/Healthy and
  runtime was 2/2 Ready on exact image `43f653b49bd5938a79af82cf635176475f472531`.
- Strict live request `82498e42-6656-40e0-8b33-42ea49061c87` progressed through
  projection metrics `1/0`, `2/0`, `3/0`, `3/1`, then `3 full / 2 compact /
0 masked`, matching the five-call in-turn sequence.
- `adr151-live-turn-adr156-2` executed
  `skill → todo_write → script → todo_write → skill`; the final model answer
  reproduced all four exact structured Script output fields without
  Script-specific projection logic.
- Cross-turn `1 full + 4 compact` remains locked by focused boundary tests.
  Canonical storage remains full and closed ADR-143 is not reopened.
