# Live Test (Hybrid)

Use this mode when you want local `apps/web` against the live dev API without redeploying the web app.

## Topology

- local web: `http://localhost:3000`
- GKE API via port-forward: `http://localhost:3001`
- browser stays same-origin through `/api/v1`

This guide validates the active PersAI-native path only. It does not rely on any OpenClaw service.

ADR-072 is closed as the historical migration ADR. Current continuation work is tracked in `docs/ADR/078-consolidated-follow-through-program.md`.

## Preconditions

- kube context points to the target dev cluster
- namespace `persai-dev` exists
- ports `3000` and `3001` are free
- local `apps/web/.env.local` contains valid Clerk values

## Required local web env

```env
NEXT_PUBLIC_API_BASE_URL=/api/v1
PERSAI_WEB_API_PROXY_TARGET=http://127.0.0.1:3001
```

## Run sequence

Start the API port-forward:

```powershell
kubectl port-forward -n persai-dev svc/api 3001:3001
```

Start local web in another terminal:

```powershell
corepack pnpm --filter @persai/web run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/app`

## Quick health checks

API:

```powershell
curl.exe -i http://127.0.0.1:3001/health
curl.exe -i http://127.0.0.1:3001/ready
```

Expected: `200 OK`.

Web rewrite:

```powershell
curl.exe -i http://127.0.0.1:3000/api/v1/me
```

Expected without auth: `401 Unauthorized`.

## Native runtime checks

Run these when validating the active runtime/provider-gateway/sandbox path:

```powershell
kubectl exec -n persai-dev deployment/api -- node -e "(async()=>{for (const url of ['http://runtime:3012/ready','http://provider-gateway:3011/ready']) { const res = await fetch(url); console.log(url); console.log(res.status); console.log(await res.text()); }} )().catch((error)=>{console.error(error); process.exit(1);})"
kubectl exec -n persai-dev deployment/runtime -- node -e "(async()=>{const res = await fetch('http://sandbox:3013/ready'); console.log('http://sandbox:3013/ready'); console.log(res.status); console.log(await res.text());})().catch((error)=>{console.error(error); process.exit(1);})"
```

Expected:

- `runtime` `/ready` returns healthy status
- `provider-gateway` `/ready` returns healthy status
- `sandbox` `/ready` returns healthy status

## Browser-path validation

With a signed-in browser session:

1. Open `/app`
2. Send a normal web message
3. If router mode is `shadow`, confirm the owner/admin viewer can see the compact under-message routing badge on fresh replies
4. Confirm the turn completes without transport failure and the stream does not degrade into pathological “slow motion” output on an otherwise ordinary reply
5. Check `/api/v1/assistant/runtime/preflight` from the same session and confirm `live=true` and `ready=true`
6. If you are validating the post-rollout bundle-recovery fix, tail fresh `runtime` logs during the turn and confirm no new `runtime_bundle_hash_mismatch` appears

## ADR-097 document checks

When validating the native `document` tool path, confirm these preconditions before the first turn:

1. `Admin > Tools` has a valid PDFMonkey credential, a valid Gamma credential, and a configured PDFMonkey template id.
2. The target assistant plan has the `document` tool enabled with a non-zero monthly document quota.
3. `api`, `runtime`, and `provider-gateway` are all deployed on the same ADR-097 code level, and the document-domain Prisma migration is already applied.

Bounded first-pass validation should cover:

1. `create_pdf_document`
2. `create_presentation`
3. `revise_document` against an existing `docId`
4. same-format `export_or_redeliver`
5. intentional cross-format export rejection

Expected product truth for the current rollout:

- the model may call `document` in chat
- the assistant should acknowledge deferred work honestly
- the final PDF/PPTX arrives later through the background document job lane
- cross-format export remains intentionally unsupported

The active path truth is:

- web sync uses PersAI native runtime
- web stream uses PersAI native runtime
- API owns canonical chat/message persistence
- runtime owns request-time execution
- provider-gateway owns provider client interaction
- sandbox owns isolated file/process execution plus canonical persisted `AssistantFile` output

### If the stream looks pathologically slow

Use this only for live debugging of the intermittent “slow motion” web-stream case:

```powershell
kubectl logs -n persai-dev deployment/api --since=10m | rg "web_stream_timing|web_stream_timing_failed"
kubectl logs -n persai-dev deployment/runtime --since=10m | rg "\[provider-gateway-stream\]|\[turn-stream\]"
```

Interpret the result as follows:

1. if `api` has a long total time but `runtime` never prints a matching `[provider-gateway-stream] ... headers-received`, the delay is still before the upstream provider call
2. if `[provider-gateway-stream] ... headers-received elapsedMs=...` is already large, the slow case is on the path to upstream headers rather than browser rendering only
3. if headers arrive quickly but `web_stream_timing firstDeltaMs=...` stays large, inspect runtime/provider stages around first provider event and first text delta
4. always compare one slow turn and one normal turn from the same deployment before concluding that the issue is “model tokens are just slower”

## Smoke harness

Repeatable scenario harness for the humanity/cost measurement path lives in `scripts/smoke/`. It runs against the same hybrid topology as this guide, but additionally needs the **internal** API listener (`API_INTERNAL_PORT=3002`, `svc/api-internal`) for the gated `/api/v1/internal/smoke/turn-receipts` endpoint — `apps/api/src/main.ts`'s `routeByListenerPort` middleware keeps internal routes off the public listener by design, so a single port-forward against `svc/api` is not enough.

Add a second port-forward in another terminal:

```powershell
kubectl port-forward -n persai-dev svc/api-internal 3002:3002
```

Then drive the harness from the repo root:

```powershell
$env:SMOKE_USER_BEARER = "<Clerk session JWT>"
$env:PERSAI_INTERNAL_API_TOKEN = "<value of persai-runtime-secrets/PERSAI_INTERNAL_API_TOKEN>"
$env:SMOKE_ASSISTANT_ID = "<assistantId uuid you own>"
pnpm smoke:run --scenario chitchat-short
pnpm smoke:run-all --update-baseline
```

Defaults assume `SMOKE_API_BASE_URL=http://127.0.0.1:3001` (public) and `SMOKE_API_INTERNAL_BASE_URL=http://127.0.0.1:3002` (internal). The harness paces turns at ~5.4/min by default to stay under dev's `ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE=8`. Full operator notes (CLI flags, env vars, scenario catalog, baseline diff semantics, why receipt correlation goes by `externalThreadKey + afterCursor` rather than `requestId`) live in `scripts/smoke/README.md`. The original S0 acceptance/landing context lives in `docs/ADR/074-humanity-and-cost-polish-program.md`; current continuation ownership for deferred smoke-harness follow-through lives in ADR-078.

## Step 20 Sandbox Smoke

Use this only after the selected assistant's effective plan enables the active `files`, `exec`, and `shell` sandbox surface.

With a signed-in browser session on `/app`:

1. Send a bounded prompt that requires sandbox execution plus delivery, for example: create a tiny text file such as `hello.txt`, then send that file back to the user in the same turn.
2. Confirm the runtime chooses the atomic create-and-deliver happy path when appropriate (the active contract now prefers `files.write_and_send` for this prompt shape rather than depending on a separate later `files.send` decision).
3. Confirm the reply completes successfully and the user-visible assistant message shows the delivered attachment instead of dropping the artifact after tool execution.
4. Confirm the assistant does not confidently claim the file was sent if no attachment actually appears on the completed message.
5. Confirm `Admin > Ops` for the same assistant now shows:
   - an increased `jobs started today` or `recent sandbox jobs` entry
   - the actual tool code (`files`, `exec`, or `shell`)
   - a completed or blocked status with persisted `resourceUsage` truth
6. If the file is blocked by policy, confirm the blocked reason is explicit rather than a generic runtime failure.
7. If the run succeeds, open/download the delivered file from the web surface to prove the final user path, not only the sandbox job path.

## Common failure signatures

- `Failed to fetch`: local web is not using same-origin `/api/v1` or the port-forward is down
- `ECONNREFUSED` on `localhost:3001`: API port-forward is not running
- `401` on `/api/v1/me`: expected when unauthenticated
- unhealthy preflight: inspect `api`, `runtime`, `provider-gateway`, and `sandbox` deployments rather than looking for removed legacy services

## Shutdown

- stop the local web dev process
- stop the `kubectl port-forward` process
