# OPENCLAW-SAAS-RUNTIME-PLAN

## Status

Working execution plan aligned with `ADR-063`.

## Resume Protocol

If a later session needs to recover context quickly, use this order:

1. `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
2. `docs/ROADMAP.md`
3. `docs/SESSION-HANDOFF.md`
4. `docs/ADR/063-tiered-openclaw-runtime-and-clean-cutover.md`

This file is the **central execution plan** for the runtime program.

## Purpose

Define one clean runtime program for PersAI that:

- hardens the current shared OpenClaw runtime for paid production
- prepares GKE and control-plane routing for tiered runtime pools
- avoids deepening one-runtime legacy assumptions
- preserves assistant “humanity” by moving risk controls into infra/runtime boundaries instead of flattening persona behavior

## Scope

This document combines the previously separate “stage 1” and “stage 2” discussions into one execution line:

- **Stage 1 inside this plan:** shared runtime hardening for production
- **Stage 2 inside this plan:** tiered runtime routing and isolated pools

They are delivered in slices, but they are one architecture.

## Principles

- **PersAI is the control plane:** plan defaults, overrides, quotas, routing, audit, and materialization stay in PersAI.
- **OpenClaw is the execution plane:** runtime execution, sessions, tool behavior, and channel delivery stay in OpenClaw.
- **No new one-runtime legacy:** new docs, settings, and future code must not assume one permanent `OPENCLAW_BASE_URL`.
- **Policy over topology in UI:** admin chooses runtime tier / isolation policy, not a pod or service name.
- **Shared runtime must be restricted:** shared pools are safe/restricted modes only.
- **Humanity is preserved:** personality and assistant feel are not the thing being “locked down”; dangerous execution paths are.

## Runtime tiers

### `free_shared_restricted`

Default low-cost pool for free users.

- strict deny-by-default tool surface
- strongest quotas and abuse limits
- sandbox always on
- minimal workspace access
- aggressive noisy-neighbor protection

### `paid_shared_restricted`

Shared pool for normal paid users.

- still restricted
- better budgets and performance than free
- no assumption of hostile-user isolation
- no broad/high-risk tool surface

### `paid_isolated`

More isolated pool for heavier or more sensitive paid tenants.

- separate OpenClaw deployment/service class
- tighter network and secret boundary
- room for stronger capabilities without exposing all paid users to the same blast radius

### Future: `enterprise_dedicated`

Only when needed.

- dedicated runtime topology per tenant
- strongest isolation and custom controls

## What the UI should expose

The UI should expose:

- runtime tier
- isolation level
- override reason
- current runtime health

The UI should not expose:

- pod names
- Kubernetes services
- Redis internals
- raw network topology

## GKE preparation baseline

This track must prepare GKE without breaking the current users or forcing a full replatform first.

### Keep initially

- one PersAI control plane
- current Redis-backed OpenClaw spec store
- current Helm/GitOps flow

### Add incrementally

- separate OpenClaw deployments/services per runtime tier
- per-tier config values instead of one implicit runtime class
- internal network isolation so only the right callers can reach runtime/internal endpoints
- runtime-aware routing config in PersAI
- observability per runtime tier

### Explicit non-goal for the first slice

Do not require per-tier Redis or per-tenant Redis on slice 1. Keep the current Redis baseline unless a measured isolation/scaling reason forces a split.

## Clean cutover rules

- Test users are migrated directly to the new runtime-tier model when the control-plane wiring lands.
- Do not add new admin/runtime flows that assume one global runtime forever.
- Old “single runtime by default” thinking should not be preserved as the target architecture.
- If a temporary compatibility layer is needed, it must have a defined removal slice.
- For any new required secret/config consumed by auto-synced GitOps workloads, update the secret source-of-truth and confirm it has reached Kubernetes **before** merging/pushing tracked Git changes. Do not rely on Argo CD auto-sync to “catch up later”.

## Sandbox activation gate

The prepared restricted sandbox config must **not** be enabled by flipping the current shared runtime in place.

Sandbox activation is allowed only when all of the following are true:

- the target OpenClaw pool has a real in-cluster sandbox backend/container strategy
- Helm/rendered config and deployment shape are validated for that pool
- runtime smoke tests pass for apply/chat/stream/channel/reminder flows
- a canary routing path exists in PersAI control plane
- rollback to the current non-sandbox pool is immediate and documented

### Required rollout order

1. **Prepare**

   - keep current shared runtime serving normal traffic
   - keep sandbox config rendered and visible in config
   - add sandbox-ready pool topology without switching all users

2. **Canary**

   - route only test/internal assistants to the sandbox-ready pool
   - verify real user-facing runtime behaviors:
     - spec apply
     - web chat
     - streaming
     - channel turns
     - reminder/task flow
     - preview flow if enabled on that pool

3. **Cutover**

   - move the intended runtime tier to the sandbox-enabled pool
   - keep rollback path live only for the bounded migration window

4. **Removal**

   - remove temporary assumptions tied to the old shared non-sandbox path
   - do not keep a forgotten compatibility route indefinitely

### Anti-patterns

Do **not**:

- enable sandbox by simply changing `agents.defaults.sandbox.mode` on the current only runtime deployment
- leave both old and new routing paths without an explicit removal slice
- treat rendered sandbox config as proof that runtime isolation is active

## Slice plan

### R15a — docs-first platform alignment

Outcome:

- ADR, roadmap, architecture, and test plan all describe the same runtime direction
- no split-brain between hardening and tiering

### R15b — shared runtime production hardening

Outcome:

- explicit deny-by-default user-facing tool surface
- explicit sandbox configuration in runtime Helm/config
- explicit workspace/resource/network limits for the shared pool
- no silent dependence on permissive OpenClaw defaults
- supporting detail: `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md`
- note: the API internal listener/service split is now in place; the remaining network step is explicit public ingress CIDR allowlisting so API `NetworkPolicy` can be enforced without breaking `api.persai.dev`
- rollout gate: run `corepack pnpm run networkpolicy:readiness:strict` before merging/pushing CIDR-dependent NetworkPolicy changes on an auto-synced branch
- source-of-truth rule: CIDRs must come from the real current ingress path, with official Google LB/GFE guidance as the primary source for GKE-backed pod ingress and Telegram webhook ranges used only as supplemental sender input when truly pod-visible
- operator/agent starting point: use the canonical starter block embedded in `infra/helm/values-dev.yaml` comments and mirrored in `infra/dev/gke/RUNBOOK.md`

### R15c — fork audit automation

Outcome:

- code-first fork inventory from `persai-fork-base..HEAD`
- high-risk native files tracked by invariant checks
- CI/agent checks fail on undocumented or unverified drift
- supporting detail: `docs/OPENCLAW-FORK-AUDIT-AUTOMATION.md`
- reduction strategy: `docs/OPENCLAW-NATIVE-REDUCTION-MAP.md`
- upstream update gate: `corepack pnpm run openclaw:fork:update-gate`
- targeted post-gate runtime/security smoke: `docs/LIVE-TEST-HYBRID.md#fork-update-smoke-pack`

### R15d — runtime assignment control plane

Outcome:

- PersAI can resolve runtime tier by plan default and admin override
- UI chooses runtime policy, not infrastructure details
- control-plane model is ready before multi-pool rollout

### R15e — GKE tiered runtime pools

Outcome:

- separate OpenClaw pool topology for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`
- tier-specific config and network boundaries
- health/rollout visibility per pool
- sandbox-enabled shared tiers activate only after the sandbox activation gate passes

### R15f — adapter/runtime router

Outcome:

- PersAI adapter boundary no longer assumes one runtime endpoint forever
- apply/chat/stream/channel turns route to the correct runtime pool
- current users continue working through the migration

### R15g — clean migration and cutover

Outcome:

- test users move to tier-based routing
- free vs paid separation is real in runtime topology
- no new legacy admin/runtime assumptions remain
- temporary compatibility routes have explicit removal

## Test and automation expectations

- shared-runtime hardening must be covered by config-generation tests and runtime smoke checks
- fork audit automation must validate current code plus git diff/history, not only `PERSAI-FORK-PATCHES.md`
- runtime-tier routing must have deterministic resolution tests
- GKE rollout work must include reachability and health checks per runtime tier

## Relation to other docs

- `ADR-063` is the architecture decision
- `ROADMAP.md` is the slice tracker
- this document is the detailed working execution plan
- `OPENCLAW-SHARED-RUNTIME-HARDENING.md` is the shared-pool hardening baseline
- `OPENCLAW-FORK-AUDIT-AUTOMATION.md` is the maintainer/agent audit workflow baseline
- `OPENCLAW-NATIVE-REDUCTION-MAP.md` is the fork-diff reduction map for H14
- this plan supersedes the older brainstorming draft in `docs/plane/OPENCLAW-SAAS-PLAN-UNAPPROVED.md`
