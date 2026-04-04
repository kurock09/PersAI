# OPENCLAW-SHARED-RUNTIME-HARDENING

## Purpose

Define the hardening baseline required before PersAI treats a shared OpenClaw runtime as acceptable for paid production.

This document is intentionally pragmatic:

- it describes the current code-informed risk shape
- it defines the minimum shared-runtime target
- it keeps “humanity” at the product layer while moving dangerous execution control into runtime and infra boundaries

## Current code-informed findings

### 1. Tool exposure is broader than the PersAI catalog alone

OpenClaw's built-in tool list is wide (`browser`, `canvas`, `nodes`, `cron`, `gateway`, `sessions_*`, `subagents`, `message`, `pdf`, `image`, etc.), while PersAI's current tool catalog only governs a subset of that runtime surface.

Implication:

- PersAI must not assume that “not in the product catalog” automatically means “not reachable in runtime”
- shared runtime needs explicit deny-by-default tool policy for user-facing turns

### 2. Current Helm config had no explicit sandbox/tool hardening baseline

Current OpenClaw config rendered from `infra/helm/templates/openclaw-configmap.yaml` mostly sets:

- model
- secret resolver
- session maintenance
- TTS mode
- control UI origins

That gap is now partially addressed:

- Helm now renders an explicit top-level OpenClaw `tools.deny` baseline for dangerous built-ins that PersAI does not want exposed by default in shared user-facing runtime (`gateway`, `nodes`, `canvas`, `sessions_*`, `subagents`)
- Helm now also carries a prepared restricted `agents.defaults.sandbox` shape for later tiered/shared-runtime rollout

However, the following still remain open:

- sandbox is intentionally still `mode: "off"` in the current GKE shape until the runtime has a real in-cluster sandbox backend/container strategy
- the current restricted tool deny list is a safe baseline, not the final per-tier policy model

### 3. Split bearer auth is now the required baseline

The token boundary is now intentionally split:

- `OPENCLAW_GATEWAY_TOKEN` is for `PersAI -> OpenClaw` runtime ingress auth
- `PERSAI_INTERNAL_API_TOKEN` is for `OpenClaw -> PersAI internal API` auth

Implication:

- shared runtime protection must also include strict internal network isolation
- token possession must not be treated as the only meaningful boundary

Current implementation improvement:

- internal runtime traffic now targets `api-internal:3002` instead of the public API service
- this materially reduces accidental exposure of internal runtime routes

Current reduction:

- a leaked OpenClaw-side internal API token no longer grants direct OpenClaw ingress auth
- a leaked OpenClaw gateway token no longer grants PersAI internal runtime API auth

Remaining production risk:

- both token families are still long-lived shared secrets within their respective directions
- network policy and secret handling still matter because the system is not yet on short-lived workload identity for this runtime boundary

### 4. Infra-level isolation is now live and must stay codified in the docs baseline

The shared-runtime production story now includes a live GKE baseline for runtime reachability:

- `api-internal` is deployed as a dedicated ClusterIP service on port `3002`
- the public API listener returns `404` for `/api/v1/internal/*`
- the internal API listener/service returns `404` for non-internal routes
- `api-ingress-baseline` and `openclaw-ingress-baseline` `NetworkPolicy` objects are live in `persai-dev`
- external smoke confirms `https://api.persai.dev/api/v1/internal/...` is no longer reachable from the public ingress path

## Shared-runtime production baseline

The first paid-production shared pool is `free_shared_restricted` or `paid_shared_restricted`.

Shared pools are allowed only if all of the following are true.

### Runtime tool surface

- deny-by-default for user-facing runtime turns
- explicitly allow only the product-approved minimum
- do not expose high-risk built-ins by default:
  - `gateway`
  - `cron`
  - `nodes`
  - `sessions_*`
  - `subagents`
  - `canvas`
- any exception must be explicit and documented

Current implemented baseline in Helm/OpenClaw config:

- explicit deny for `gateway`
- explicit deny for `nodes`
- explicit deny for `canvas`
- explicit deny for `agents_list`
- explicit deny for `session_status`
- explicit deny for `sessions_list`
- explicit deny for `sessions_history`
- explicit deny for `sessions_send`
- explicit deny for `sessions_spawn`
- explicit deny for `sessions_yield`
- explicit deny for `subagents`

Intentional note:

- `browser` is **not** globally denied because it is part of the PersAI governed product catalog
- `cron` is **not** globally denied in this first Helm baseline because PersAI currently also uses native cron paths for internal runtime control and reminder plumbing; that tool still needs a narrower follow-up hardening slice instead of a blind global deny
- `agents_list` and `session_status` are now globally denied in the shared baseline because they are not part of the PersAI product catalog for normal user-facing runtime turns and expose internal runtime/session metadata with no product need

### Sandbox

- sandbox must be explicitly configured, not left to permissive/default assumptions
- target baseline:
  - sandbox enabled for user-facing turns
  - constrained workspace access
  - explicit CPU/memory/PID limits
  - no host-elevation path for user-facing runtime

Current implemented baseline in Helm values:

- prepared `agents.defaults.sandbox` shape
- `scope: "agent"`
- `workspaceAccess: "rw"`
- `sessionToolsVisibility: "spawned"`
- `docker.network: "none"`
- `docker.readOnlyRoot: true`
- `docker.capDrop: ["ALL"]`
- `docker.pidsLimit: 256`
- `docker.memory: "1g"`
- `docker.memorySwap: "1g"`
- `docker.cpus: 1`

Current rollout constraint:

- sandbox remains `mode: "off"` in the present GKE deployment until the runtime gains an actual sandbox backend/container strategy in-cluster; enabling it prematurely would create a false sense of isolation and a real outage risk

### Sandbox activation strategy

The prepared sandbox config exists so PersAI can move cleanly toward sandbox-enabled shared tiers without editing config shape later.

However, activation must happen through a **new runtime path**, not by mutating the only currently working runtime in place.

Required rule:

- current shared runtime remains stable while the sandbox-ready pool is introduced separately
- PersAI control plane routes only canary/test assistants first
- full cutover happens only after runtime smoke and rollback checks pass
- temporary compatibility routing must have an explicit removal slice

### Workspace and storage

- bounded workspace growth
- bounded media growth
- bounded temporary artifacts
- bounded session/transcript growth
- no silent dependence on cleanup-by-luck

### Network

- only the correct PersAI callers may reach OpenClaw internal runtime endpoints
- only the correct runtime callers may reach PersAI internal runtime endpoints
- this must be enforced by GKE/network policy and service topology, not only by shared token checks

Current implementation status:

- Helm now includes `infra/helm/templates/networkpolicies.yaml`
- `openclaw` ingress can now be narrowed to API pods plus explicitly configured pod-visible trusted ingress CIDRs
- `values-dev.yaml` now carries the verified GKE pod-visible CIDR baseline (`35.191.0.0/16`, `130.211.0.0/22`) so both API and OpenClaw ingress policies render and deploy
- `corepack pnpm run networkpolicy:readiness:strict` now provides a repeatable gate for CIDR-dependent rollout readiness

- PersAI `api` now exposes a dedicated internal listener/service path (`api-internal:3002`) for OpenClaw runtime traffic
- the public API listener rejects `/api/v1/internal/*` routes, while the internal listener rejects non-internal routes
- OpenClaw runtime-facing calls now target the internal API service instead of the public API service
- the live `persai-dev` cluster now enforces GKE-level ingress restriction with `api-ingress-baseline` and `openclaw-ingress-baseline`

### Operations

- health and readiness per runtime tier
- runtime-specific smoke tests before rollout
- no broad “one shared runtime forever” assumptions in admin/ops flows

## What this hardening does not do

It does not:

- remove assistant personality
- flatten the assistant into a dry enterprise bot
- replace future isolated runtime tiers

Instead it ensures the shared pool is a **restricted execution tier**, not a trust-all runtime.

## Required next implementation slices

### R15b1 — codify current runtime exposure

- enumerate the effective built-in OpenClaw tools reachable in PersAI runtime turns
- compare them to the PersAI product catalog and approved tool surface

### R15b2 — explicit shared-runtime config

- render sandbox/tool/workspace limits through Helm/config instead of relying on implicit defaults

### R15b3 — internal boundary hardening

- codify GKE reachability and internal caller restrictions for runtime/internal endpoints

### R15b4 — production readiness verification

- add shared-runtime smoke checks and rollout gates before paid launch
- canonical prepared-baseline gate: `corepack pnpm run shared-runtime:readiness`
- strict rollout gate: `corepack pnpm run shared-runtime:readiness:strict`
- required-secret baseline: `PERSAI_INTERNAL_API_TOKEN` must exist in the secret source-of-truth and in Kubernetes before treating runtime hardening as delivery-ready

## Related files

- `infra/helm/templates/openclaw-configmap.yaml`
- `infra/helm/values-dev.yaml`
- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `openclaw/src/agents/openclaw-tools.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-http.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-tool-policy.ts`
