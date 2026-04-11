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
kubectl port-forward -n persai-dev svc/openclaw-free-shared-restricted-sandbox 18789:18789
```

Probes (no auth required for typical `healthz`/`readyz` usage in this chart):

```powershell
curl.exe -s http://127.0.0.1:18789/healthz
curl.exe -s http://127.0.0.1:18789/readyz
```

`POST /api/v1/runtime/spec/apply` and chat routes require a **Bearer** token matching the cluster secret (`persai-openclaw-secrets` / `OPENCLAW_GATEWAY_TOKEN`). Do not paste tokens into logs or tickets; use direct calls only for local debugging.

### Deploy / image note

OpenClaw image tag and digest are pinned in `infra/helm/values-dev.yaml`. CI updates those pins after pushes to `main` per [infra/dev/gitops/README.md](infra/dev/gitops/README.md). If preflight stays unhealthy, inspect the tier-specific OpenClaw Deployments (`openclaw-free-shared-restricted`, `openclaw-paid-shared-restricted`, `openclaw-paid-isolated`) and Argo CD sync for `persai-dev`.
For sandbox-capable tiers, also verify the corresponding runtime Deployment/Service (`*_sandbox` shared lanes and `openclaw-paid-isolated`) and confirm the pod actually has a working Docker-backed sandbox backend before treating the pool as isolated.

**Changing the fork pin:** push the new commit to **`kurock09/openclaw` on GitHub before** (or immediately re-run CI after) updating `openclaw-approved-sha.txt` on PersAI `main`; otherwise workflows fail with `not our ref` (see gitops README).

Current dev chart state in `infra/helm/values-dev.yaml`:

- OpenClaw apply-store runs in `redis` mode via `PERSAI_RUNTIME_SPEC_STORE=redis`

## Phase C: ADR-072 native sync web smoke

Use this only after the API deploy has all of these:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL` pointing at the Step 9 `apps/runtime` Service
- `PERSAI_PROVIDER_GATEWAY_BASE_URL` still configured for the current Step 7/9 warm path

What this proves:

- `POST /api/v1/assistant/chat/web` is now routed by `apps/api` to native `POST /api/v1/turns/create`
- the API keeps canonical replay/message persistence ownership around the native result
- sync-path failures are surfaced honestly instead of silently falling back to OpenClaw

What this does **not** prove yet:

- streaming UX is native
- attachment refs are native object-storage inputs
- Step 10 web cutover is complete

Important:

- do **not** use the normal `/app` message composer as proof of this slice; current web UI still sends `POST /api/v1/assistant/chat/web/stream`
- for sync proof, call `POST /api/v1/assistant/chat/web` directly
- for agent-driven validation, do not waste time on raw Clerk `POST /v1/sessions`, raw ticket accept URLs, or manual fresh-user password login flows; use the fast auth path below

### Native service checks

Fast path from the running API pod (preferred, no extra port-forwards):

```powershell
kubectl exec -n persai-dev deployment/api -- node -e "(async()=>{for (const url of ['http://provider-gateway:3011/ready','http://runtime:3012/ready']) { const res = await fetch(url); console.log(url); console.log(res.status); console.log(await res.text()); }} )().catch((error)=>{console.error(error); process.exit(1);})"
Invoke-WebRequest -UseBasicParsing https://api.persai.dev/ready | Select-Object -ExpandProperty Content
```

Expect:

- `provider-gateway` `/ready` returns `200` with provider cache ready
- `runtime` `/ready` returns `200` with `ready: true`
- external API `/ready` returns `status: "ready"`

Optional direct port-forwards only when you need deeper cluster debugging:

```powershell
kubectl port-forward -n persai-dev svc/runtime 3003:3003
kubectl port-forward -n persai-dev svc/provider-gateway 3004:3004
```

Probes:

```powershell
curl.exe -s http://127.0.0.1:3003/ready
curl.exe -s http://127.0.0.1:3004/ready
```

Expect both to report ready before trusting the sync cutover test.

### Fast agent-only auth bootstrap (recommended)

Use this when a coding session needs to run the sync smoke itself instead of asking a human to sign in manually.

1. Install temporary browser tooling outside the repo:

```powershell
New-Item -ItemType Directory -Path "$env:TEMP\clerk-playwright-smoke" -Force | Out-Null
npm install --prefix "$env:TEMP\clerk-playwright-smoke" playwright @clerk/testing
npx --prefix "$env:TEMP\clerk-playwright-smoke" playwright install chromium
```

2. Read `CLERK_SECRET_KEY` from `persai-api-secrets` and set:

```powershell
$env:CLERK_SECRET_KEY = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl get secret persai-api-secrets -n persai-dev -o jsonpath='{.data.CLERK_SECRET_KEY}')))
$env:CLERK_FAPI = 'clerk.persai.dev'
```

3. Preferred auth sequence:

- create a fresh Clerk user with `POST https://api.clerk.com/v1/users`
- launch Playwright and navigate to `https://persai.dev/sign-in`
- use `@clerk/testing/playwright` `clerk.signIn({ page, emailAddress, setupClerkTestingTokenOptions: { frontendApiUrl: 'clerk.persai.dev' } })`
- wait for `window.Clerk.session.id`
- mint a short-lived bearer with `POST https://api.clerk.com/v1/sessions/{sessionId}/tokens`

4. Important gotchas that already cost time once:

- `POST /v1/sessions` is dev-instance-only and is **not** the fast path on the current production Clerk instance
- `POST /v1/sessions/{sessionId}/tokens` requires `Content-Type: application/json` and a JSON body such as `{}`
- direct raw `sign_in_token` / `actor_token` accept URLs can get stuck in Clerk edge challenge flow; let Clerk JS plus the testing helper perform the ticket flow instead
- wrap direct `https://api.persai.dev` calls in short retry/backoff because transient `ECONNRESET` happened during the successful smoke

5. After auth, run the actual Step 9 smoke as direct HTTP, not by driving the web UI.

### Through the authenticated browser session

If a human is already signed in and wants the quickest manual proof, use a same-origin browser call from the signed-in `/app` session:

```javascript
await fetch("/api/v1/assistant/chat/web", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    surfaceThreadKey: `adr072-sync-smoke-${Date.now()}`,
    message: "Reply with exactly: native sync smoke ok",
    clientTurnId: crypto.randomUUID()
  })
}).then(async (r) => ({ status: r.status, body: await r.json() }));
```

Expected:

- HTTP `201`
- one completed transport payload with assistant message text
- if native runtime is misconfigured/unhealthy, an honest `5xx`/conflict response instead of a hidden OpenClaw success path

### Follow-up check

Immediately retry the same payload with the same `clientTurnId` and confirm the API replays the stored completion state instead of creating a second assistant reply.
- do not rely only on a `transport.replayed` field
- verify the replay returns the same `chatId` and same `assistantMessageId`
- fetch `GET /api/v1/assistant/chats/web/:chatId/messages` and confirm the chat still contains exactly one user message and one assistant message
- OpenClaw runtime model/policy authority comes from PersAI admin-managed runtime settings materialized into bootstrap/profile, not from `agents.defaults.model.primary`
- OpenClaw receives `OPENAI_API_KEY` from `persai-openclaw-secrets`
- PersAI API uses `OPENCLAW_ADAPTER_TIMEOUT_MS=90000` in dev (and the same default in `loadApiConfig` when unset) to avoid premature stream aborts on long OpenClaw turns

If the fork is running with `PERSAI_RUNTIME_SPEC_STORE=memory`, an OpenClaw process restart clears applied PersAI specs and you must apply again before expecting native chat output. For restart-safe / multi-replica runtime behavior, run the fork with `PERSAI_RUNTIME_SPEC_STORE=redis` and a valid `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL`.

## Phase D: ADR-072 native stream web smoke

Use this only after the API deploy has all of these:

- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL` pointing at the Step 9 `apps/runtime` Service
- `PERSAI_PROVIDER_GATEWAY_BASE_URL` still configured for the current Step 7/9 warm path

What this proves:

- `POST /api/v1/assistant/chat/web/stream` is now routed by `apps/api` to native `POST /api/v1/turns/stream`
- the API keeps canonical replay/message persistence, SSE shaping, and interruption ownership around the native runtime stream
- stream-path failures are surfaced honestly instead of silently falling back to OpenClaw

What this does **not** prove yet:

- attachment refs are native object-storage inputs
- runtime media artifacts are fully native
- Step 10 shadow/primary web cutover is complete

### Through the authenticated browser session

If a human is already signed in and wants the quickest manual proof, use a same-origin browser call from the signed-in `/app` session:

```javascript
const clientTurnId = crypto.randomUUID();
const response = await fetch("/api/v1/assistant/chat/web/stream", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    surfaceThreadKey: `adr072-stream-smoke-${Date.now()}`,
    message: "Reply with exactly: native stream smoke ok",
    clientTurnId
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const events = [];

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  while (true) {
    const boundary = buffer.indexOf("\n\n");
    if (boundary === -1) break;
    const frame = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const event = frame.match(/^event: (.+)$/m)?.[1] ?? "message";
    const data = frame.match(/^data: (.+)$/m)?.[1];
    if (data) events.push({ event, data: JSON.parse(data) });
  }
}

({ status: response.status, clientTurnId, events });
```

Expected:

- HTTP `201`
- SSE includes `started`, one or more `delta`, `runtime_done`, then terminal `completed`
- `completed.transport.assistantMessage.content` is exactly `native stream smoke ok`
- if native runtime is misconfigured/unhealthy, the stream fails honestly instead of ending as a hidden OpenClaw success path

### Follow-up checks

1. Immediately retry the same payload with the same `clientTurnId` and confirm the API replays the stored completion state instead of creating a second assistant reply.
2. Fetch `GET /api/v1/assistant/chats/web/:chatId/messages` and confirm the chat still contains exactly one user message and one assistant message.
3. Optional interruption proof: repeat the call with an `AbortController`, abort after the first `delta`, then verify the chat/history reflects an interrupted partial-output outcome rather than a silent full completion.

## Phase E: ADR-072 bounded web shadow window

Use this only if operators temporarily switch web route modes back to `shadow`
after the Step 10 closeout. The ordinary dev web path is now `native`, so this
phase is historical/diagnostic rather than the default validation path.

Use this after the Step 10 package is deployed with:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=shadow`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=shadow`
- `PERSAI_RUNTIME_BASE_URL` pointing at `apps/runtime`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL` still configured for the current warm path

What this proves:

- the user-visible web reply still comes from the legacy OpenClaw bridge
- `apps/api` also runs one bounded native comparison in the background
- Step 10 parity evidence is visible through logs and Admin Overview before default-path cutover

What this does **not** prove yet:

- native web is the ordinary default path
- shadow drift is acceptably low enough for final cutover without inspection

Recommended checks during the bounded window:

1. In `/admin`, confirm recent samples appear under `Web Runtime Shadow Compare`.
2. Confirm the same serving pod also reports `web_runtime_route` and `web_runtime_shadow_compare` for both sync and stream traffic.
3. For stream traffic, check terminal status, content drift, error-class drift, runtime duration, first-delta timing, and delta counts before deciding the first honest cutover target.

After the bounded `shadow` window shows acceptable semantic parity, flip both
`PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE` and `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE`
to `native` and use Phase C + Phase D plus the ordinary `/app` composer flow as
the post-shadow cutover proof. At that point the Admin Overview shadow panel is
historical evidence only and no longer the main validation surface.

Current closeout truth: that native flip and ordinary web-path validation have
already been completed in dev, so new regressions should be checked first
through the normal native web flow unless there is a specific reason to reopen a
bounded `shadow` window.

### ADR-048 direct contract check (optional)

After port-forward to `svc/openclaw-free-shared-restricted` and with Bearer from `persai-openclaw-secrets` / `OPENCLAW_GATEWAY_TOKEN`, you can POST `/api/v1/runtime/spec/apply` then `/api/v1/runtime/chat/web` and expect `200`, header `X-Persai-Runtime-Session-Key`, and `assistantMessage` from the **embedded agent** when apply is present (requires provider credentials in OpenClaw runtime secrets for non-trivial replies; current dev chart expects `OPENAI_API_KEY`). Without apply, the runtime now returns **503** instead of a compat echo body. Shapes: [API-BOUNDARY.md](API-BOUNDARY.md#persai-to-openclaw-http-runtime-contract-v1).

### Fork update smoke pack

Use this pack after `corepack pnpm run openclaw:fork:update-gate` passes and before calling a fork update deploy-ready:

1. PersAI API preflight returns `live=true` and `ready=true`.
2. `/app` streaming turn completes without transport errors.
3. Direct `GET /healthz` and `GET /readyz` on the target tier service (start with `svc/openclaw-free-shared-restricted`) are healthy.
4. Direct `POST /api/v1/runtime/spec/apply` then `POST /api/v1/runtime/chat/web` succeeds with the expected runtime contract.
5. If the upstream merge touched bridge/security-sensitive fork areas, also run one focused path:
   - Telegram inbound/outbound turn when `persai-runtime-telegram.ts` changed
   - reminder/task flow when `cron-tool.ts` or task sync paths changed
   - provider secret resolution path when `src/secrets/*` or secret-provider config changed
   - freshness/materialization-sensitive web turn when `src/gateway/persai-runtime/*` changed

### Tiered cutover proof

When validating `R15g`, do not stop at "the plan default changed" or "the pool pod is healthy".

Prove the actual bridge path:

1. Confirm the target assistant's latest materialized `runtimeAssignment` shows the expected:
   - `planDefaultTier`
   - `runtimeTierOverride`
   - `effectiveTier`
   - `source`
2. Trigger a real runtime path for that assistant (streaming web turn, Telegram inbound turn, reminder/task control, memory/media path, etc.).
3. Inspect API logs for the adapter's `runtime_route` line and verify:
   - `assistantId=<target assistant>`
   - `tier=<expected effective tier>`
   - `host=<expected pool service>`
4. Treat old startup-only signals (for example Telegram webhook reinit lines during pod boot) as insufficient proof of cutover by themselves.

Current adapter log shape:

```text
runtime_route method=POST path=/api/v1/runtime/chat/web/stream tier=paid_shared_restricted source=tier_specific host=openclaw-paid-shared-restricted:18789 assistantId=<uuid>
```

For sandbox-capable pools, add one more check before calling the cutover honest:

1. `kubectl exec` into the target OpenClaw pod and confirm `docker` is available in `PATH`.
2. Confirm the configured sandbox image is present in rendered config (`agents.defaults.sandbox.docker.image`).
3. Confirm the pool has an active Docker backend path (`DOCKER_HOST` / socket mount) before relying on `runtime_route` as sandbox proof.

## Shutdown

- stop web dev process (`Ctrl+C`)
- stop `kubectl port-forward` process (`Ctrl+C`)
