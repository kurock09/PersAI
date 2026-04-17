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

1. create/recreate lifecycle polish (`in progress`; explicit recreate/recover path landed, but one backend lifecycle contract plus preview-avatar truth still remain)
2. user UI polish on the active native path (`completed`)
3. memory, knowledge, cache, and model-routing cost architecture (`Slice A completed`; `Slice B` prompt-cache-first context architecture is the next active step)
4. Step 19 scale and deploy-recovery hardening
5. deferred Step 15a native web voice output
6. deferred Step 20 sandbox and attach-by-ref follow-through

## Near-term focus

1. Finish the remaining lifecycle residue by moving preview/create/recover/reset behind one explicit backend lifecycle contract and by removing the last local-only uploaded-avatar truth gap
2. Continue the memory/knowledge/cache/model-routing economics wave after Slice A completion by landing Slice B prompt-cache-first context assembly and then Slice C knowledge correction plus retrieval-model follow-through
3. Keep that economics wave honest about the current baseline (`pattern_only` retrieval and heuristic rerank are still current truth; provider-native cached input is not yet first-class even though Slice A routing/accounting is now landed)
4. Close Step 19 so routine deploys and restarts recover without normal-ops fleet-wide `reapply all`
5. Keep deferred runtime work (`Step 15a`, `Step 20`, `max_ru`) behind the active lifecycle/economics and scale program

## Roadmap rule

Future work must not reintroduce OpenClaw-specific deploy wiring, image pinning, secrets, route modes, or operational assumptions into the active path.

Historical migration detail lives in ADRs, changelog entries, and session handoff logs rather than in the active roadmap.
