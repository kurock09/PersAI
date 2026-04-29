# Roadmap

This roadmap tracks the active PersAI-native path only.

## Current platform baseline

Completed baseline:

- PersAI-native request-time runtime path for web and current active surfaces
- internal `runtime` and `provider-gateway` services, plus sandbox deploy wiring ready for the next dev rollout
- GitOps/Helm deploy path for `api`, `web`, `runtime`, `provider-gateway`, and the new sandbox workload
- admin/control-plane/runtime bundle materialization on the native path
- removal of OpenClaw from the active repo deploy/runtime/control-plane path

ADR-072 is closed as the historical migration ADR. The active continuation program now lives in `docs/ADR/078-consolidated-follow-through-program.md`.

## Current active program

Primary execution order:

1. create/recreate lifecycle polish (`completed`; explicit wizard-driven recover/recreate, honest welcome handoff, and the current local-until-publish uploaded-avatar behavior are now accepted active-path truth)
2. user UI polish on the active native path (`completed`)
3. memory, knowledge, cache, and model-routing cost architecture (`Slice A`, `Slice B`, and `Slice C` completed on the active path, including the configurable early `turn_routing` layer and smart/deep-mode routing truth)
4. Step 19 core deploy and operator hardening (`completed`; deploy/restart/pod-replacement recovery is observed on the live dev rollout path, bounded self-healing recovery is landed, and `/admin` `System Overview` now carries honest pod-truth for the active path)
5. mobile shell reliability and rollout (`ADR-078`)
6. runtime/tool efficiency follow-through (`R2 -> R3`)
7. background-task verification/test cleanup plus long-tail deferred research (`ADR-078`)

## Near-term focus

1. Keep the now-observed Step 19 core closure honest in active docs: deploy/restart/pod-replacement recovery and current `/admin` `System Overview` pod truth are accepted baseline behavior on the native path
2. Leave the remaining bounded load proof plus any rollout-speed/image-pull cleanup as the very last program step rather than treating them as current blockers for the main path
3. If the final pressure-validation step is reopened, require a saved bounded load report and explicit safe-ceiling wording instead of anecdotal "felt fast" evidence
4. Keep the economics wave honest about the current landed baseline: plan-scoped model slots, a configurable early `turn_routing` layer (deterministic precheck plus optional cheap classifier), smart/deep mode that stays on `premium` / `reasoning` once user-enabled, prompt-cache-first context routing, hybrid knowledge retrieval, plan-managed retrieval budgets, and durable retrieval observability are now real active-path behavior
5. Treat further knowledge work as follow-through on top of the landed Slice C baseline rather than as unfinished `pattern_only` correction work
6. Keep any remaining follow-through consolidated under ADR-078 instead of reopening closed historical ADR tails

## Roadmap rule

Future work must not reintroduce OpenClaw-specific deploy wiring, image pinning, secrets, route modes, or operational assumptions into the active path.

Historical migration detail lives in ADRs, changelog entries, and session handoff logs rather than in the active roadmap.
