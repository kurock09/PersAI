# LIVE TEST (HYBRID): LOCAL WEB + GKE API

## Purpose

This guide defines a stable live-test mode for this repo:

- frontend (`apps/web`) runs locally on `http://localhost:3000`
- backend API comes from dev GKE via `kubectl port-forward` on `http://localhost:3001`

Use this when validating UI slices against real dev backend state without redeploying web.

## Preconditions

- kubectl context points to dev GKE cluster
- namespace `persai-dev` exists
- local machine has free ports `3000` and `3001`
- Clerk keys are valid in `apps/web/.env.local`

## Required local web env

Set these values in `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=/api/v1
PERSAI_WEB_API_PROXY_TARGET=http://127.0.0.1:3001/api/v1
```

Notes:

- `NEXT_PUBLIC_API_BASE_URL=/api/v1` forces same-origin browser requests.
- rewrite proxy in `apps/web/next.config.ts` forwards `/api/v1/*` to GKE API forward.
- avoid direct browser calls to `http://localhost:3001` to prevent CORS/preflight issues.

## Run sequence

1. Start API port-forward from GKE:

```powershell
kubectl port-forward -n persai-dev svc/api 3001:3001
```

2. In a separate terminal, start local web:

```powershell
corepack pnpm --filter @persai/web run dev
```

3. Open:

- `http://localhost:3000/`
- `http://localhost:3000/app`

## Quick health checks

API forward:

```powershell
curl.exe -i http://127.0.0.1:3001/health
```

Expected: `200 OK` with JSON `{"status":"ok", ...}`.

Web-to-API rewrite path:

```powershell
curl.exe -i http://127.0.0.1:3000/api/v1/me
```

Expected without token: `401 Unauthorized` (this is good; it proves routing works).

## Known failure signatures

- `Unable to load state: Failed to fetch`
  - usually means browser did not use same-origin `/api/v1` path or port-forward is down.

- `Request failed with status 404` right after onboarding
  - for first-time users, `GET /assistant` can be `404` until assistant is created.
  - web client must treat this as "assistant not created yet", not a fatal error.

- `ERR_CONNECTION_REFUSED` on `localhost:3000`
  - local web process is not running.

## Phase B: OpenClaw runtime smoke (after deploy)

Normative PersAI→OpenClaw HTTP contract (paths, bodies, errors): [API-BOUNDARY.md](API-BOUNDARY.md#persai-to-openclaw-http-runtime-contract-v1).

### Through PersAI API (recommended in hybrid)

With the API port-forward and local web running as above, sign in with Clerk. Using the same browser session (same-origin `/api/v1`):

1. `GET /api/v1/assistant/runtime/preflight` — expect `preflight.live` and `preflight.ready` both `true` when the OpenClaw pod is healthy and the adapter is configured.
2. In `/app`, send a web chat message on the **streaming** path — expect a completed turn without transport/`500` failures when backend DB and OpenClaw are aligned.

### Direct to OpenClaw gateway (optional cluster debugging)

Second port-forward to the gateway Service:

```powershell
kubectl port-forward -n persai-dev svc/openclaw 18789:18789
```

Probes (no auth required for typical `healthz`/`readyz` usage in this chart):

```powershell
curl.exe -s http://127.0.0.1:18789/healthz
curl.exe -s http://127.0.0.1:18789/readyz
```

`POST /api/v1/runtime/spec/apply` and chat routes require a **Bearer** token matching the cluster secret (`persai-openclaw-secrets` / `OPENCLAW_GATEWAY_TOKEN`). Do not paste tokens into logs or tickets; use direct calls only for local debugging.

### Deploy / image note

OpenClaw image tag and digest are pinned in `infra/helm/values-dev.yaml`. CI updates those pins after pushes to `main` per [infra/dev/gitops/README.md](infra/dev/gitops/README.md). If preflight stays unhealthy, inspect the `openclaw` Deployment pods and Argo CD sync for `persai-dev`.

**Changing the fork pin:** push the new commit to **`kurock09/openclaw` on GitHub before** (or immediately re-run CI after) updating `openclaw-approved-sha.txt` on PersAI `main`; otherwise workflows fail with `not our ref` (see gitops README).

Current dev chart state in `infra/helm/values-dev.yaml`:

- OpenClaw apply-store runs in `redis` mode via `PERSAI_RUNTIME_SPEC_STORE=redis`
- OpenClaw default model is `openai/gpt-5.4` via `agents.defaults.model.primary`
- OpenClaw receives `OPENAI_API_KEY` from `persai-openclaw-secrets`
- PersAI API uses `OPENCLAW_ADAPTER_TIMEOUT_MS=15000` in dev to avoid premature stream aborts

If the fork is running with `PERSAI_RUNTIME_SPEC_STORE=memory`, an OpenClaw process restart clears applied PersAI specs and you must apply again before expecting native chat output. For restart-safe / multi-replica runtime behavior, run the fork with `PERSAI_RUNTIME_SPEC_STORE=redis` and a valid `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL`.

### ADR-048 direct contract check (optional)

After port-forward to `svc/openclaw` and with Bearer from `persai-openclaw-secrets` / `OPENCLAW_GATEWAY_TOKEN`, you can POST `/api/v1/runtime/spec/apply` then `/api/v1/runtime/chat/web` and expect `200`, header `X-Persai-Runtime-Session-Key`, and `assistantMessage` from the **embedded agent** when apply is present (requires provider credentials in OpenClaw runtime secrets for non-trivial replies; current dev chart expects `OPENAI_API_KEY`). Without apply, the runtime now returns **503** instead of a compat echo body. Shapes: [API-BOUNDARY.md](API-BOUNDARY.md#persai-to-openclaw-http-runtime-contract-v1).

## Shutdown

- stop web dev process (`Ctrl+C`)
- stop `kubectl port-forward` process (`Ctrl+C`)
