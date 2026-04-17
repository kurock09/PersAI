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

1. create/recreate lifecycle polish
2. user UI polish on the active native path
3. memory, knowledge, cache, and model-routing cost architecture
4. Step 19 scale and deploy-recovery hardening
5. deferred Step 15a native web voice output
6. deferred Step 20 sandbox and attach-by-ref follow-through

## Near-term focus

1. Remove friction and duplicated writes from the assistant setup, preview, publish, and recreate path
2. Tighten user-facing lifecycle honesty around draft, applying, failed, and live assistant states
3. Replace the current pattern-only retrieval baseline with an honest program toward hybrid retrieval, stable cache layers, and explicit smart-model routing
4. Close Step 19 so routine deploys and restarts recover without normal-ops fleet-wide `reapply all`
5. Keep deferred runtime work (`Step 15a`, `Step 20`, `max_ru`) behind the active polish and scale program

## Roadmap rule

Future work must not reintroduce OpenClaw-specific deploy wiring, image pinning, secrets, route modes, or operational assumptions into the active path.

Historical migration detail lives in ADRs, changelog entries, and session handoff logs rather than in the active roadmap.
