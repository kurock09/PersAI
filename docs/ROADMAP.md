# Roadmap

This roadmap tracks the active PersAI-native path only.

## Current platform baseline

Completed baseline:

- PersAI-native request-time runtime path for web and current active surfaces
- internal `runtime` and `provider-gateway` services
- GitOps/Helm deploy path for `api`, `web`, `runtime`, and `provider-gateway`
- admin/control-plane/runtime bundle materialization on the native path
- removal of OpenClaw from the active repo deploy/runtime/control-plane path

ADR-072 is closed for the active migration baseline through Step 18. The active follow-through program now lives in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

## Current active program

Primary execution order:

1. create/recreate lifecycle polish (`completed`; explicit wizard-driven recover/recreate, honest welcome handoff, and the current local-until-publish uploaded-avatar behavior are now accepted active-path truth)
2. user UI polish on the active native path (`completed`)
3. memory, knowledge, cache, and model-routing cost architecture (`Slice A`, `Slice B`, and `Slice C` completed on the active path, including model-only `route_control` and smart/deep-mode routing truth)
4. Step 19 scale and deploy-recovery hardening
5. deferred Step 15a native web voice output
6. deferred Step 20 sandbox and attach-by-ref follow-through

## Near-term focus

1. Start `Step 19` by proving routine deploys, restarts, and pod replacement keep live assistants live without normal-ops fleet-wide `reapply all`
2. Treat `Step 19` as readiness proof, not just latency tuning: gather bounded load evidence that the active native path is safe under real pressure
3. Use `/admin` `System Overview` as the operator surface for `Step 19` truth, including honest discovered pod status/readiness plus aggregated pressure and trace state
4. Keep the economics wave honest about the current landed baseline: plan-scoped model slots, model-only hidden `route_control`, smart/deep mode that stays on `premium` / `reasoning` once user-enabled, prompt-cache-first context routing, hybrid knowledge retrieval, plan-managed retrieval budgets, and durable retrieval observability are now real active-path behavior
5. Treat further knowledge work as follow-through on top of the landed Slice C baseline rather than as unfinished `pattern_only` correction work
6. Keep deferred runtime work (`Step 15a`, `Step 20`, `max_ru`) behind the active lifecycle/economics and scale program

## Roadmap rule

Future work must not reintroduce OpenClaw-specific deploy wiring, image pinning, secrets, route modes, or operational assumptions into the active path.

Historical migration detail lives in ADRs, changelog entries, and session handoff logs rather than in the active roadmap.
