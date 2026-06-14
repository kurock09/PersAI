# Roadmap

This roadmap tracks the active PersAI-native path only.

## Current platform baseline

Completed baseline:

- PersAI-native request-time runtime path for web and current active surfaces
- internal `runtime` and `provider-gateway` services, plus sandbox deploy wiring ready for the next dev rollout
- GitOps/Helm deploy path for `api`, `web`, `runtime`, `provider-gateway`, and the new sandbox workload
- admin/control-plane/runtime bundle materialization on the native path
- removal of OpenClaw from the active repo deploy/runtime/control-plane path

ADR-072 is closed as the historical migration ADR. ADR-078 through ADR-115 are closed program archives — see `docs/ARCHITECTURE.md` for target-state references.

## Program status

**No open orchestration program ADR.** The numbered execution programs (ADR-078, ADR-102, ADR-105–115, and peers) are complete. Do not resume their slice orders unless the user explicitly reopens scope.

Completed program waves (archive):

- create/recreate lifecycle polish
- user UI polish on the native path
- memory, knowledge, cache, and model-routing cost architecture (ADR-074 / ADR-112)
- Step 19 core deploy and operator hardening
- mobile shell reliability and rollout (ADR-075)
- media job truth and delivery (ADR-105)
- video provider catalog and Vcoin economy (ADR-106–108)
- HeyGen talking avatar (ADR-109)
- inbound safety (ADR-115)

## Near-term focus

Work is **user-priority driven** until a new ADR is opened. Likely candidates (not scheduled):

1. Skill internal flows / scenarios (e.g. marketer playbooks) — requires audit + new ADR
2. Live validation of recent media completion + series fixes on web and Telegram
3. PROD test-user readiness and ops smoke on `persai-dev`

## Roadmap rule

Future work must not reintroduce OpenClaw-specific deploy wiring, image pinning, secrets, route modes, or operational assumptions into the active path.

New product or architecture waves need explicit founder/product priority and a new ADR before multi-slice implementation.

Historical migration detail lives in ADRs, changelog entries, and session handoff logs rather than in the active roadmap.
