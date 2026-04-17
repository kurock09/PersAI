# Live Test (Hybrid)

Use this mode when you want local `apps/web` against the live dev API without redeploying the web app.

## Topology

- local web: `http://localhost:3000`
- GKE API via port-forward: `http://localhost:3001`
- browser stays same-origin through `/api/v1`

This guide validates the active PersAI-native path only. It does not rely on any OpenClaw service.

## Preconditions

- kube context points to the target dev cluster
- namespace `persai-dev` exists
- ports `3000` and `3001` are free
- local `apps/web/.env.local` contains valid Clerk values

## Required local web env

```env
NEXT_PUBLIC_API_BASE_URL=/api/v1
PERSAI_WEB_API_PROXY_TARGET=http://127.0.0.1:3001/api/v1
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

Run these when validating the active runtime/provider-gateway path:

```powershell
kubectl exec -n persai-dev deployment/api -- node -e "(async()=>{for (const url of ['http://runtime:3012/ready','http://provider-gateway:3011/ready']) { const res = await fetch(url); console.log(url); console.log(res.status); console.log(await res.text()); }} )().catch((error)=>{console.error(error); process.exit(1);})"
```

Expected:

- `runtime` `/ready` returns healthy status
- `provider-gateway` `/ready` returns healthy status

## Browser-path validation

With a signed-in browser session:

1. Open `/app`
2. Send a normal web message
3. Confirm the turn completes without transport failure
4. Check `/api/v1/assistant/runtime/preflight` from the same session and confirm `live=true` and `ready=true`

The active path truth is:

- web sync uses PersAI native runtime
- web stream uses PersAI native runtime
- API owns canonical chat/message persistence
- runtime owns request-time execution
- provider-gateway owns provider client interaction

## Common failure signatures

- `Failed to fetch`: local web is not using same-origin `/api/v1` or the port-forward is down
- `ECONNREFUSED` on `localhost:3001`: API port-forward is not running
- `401` on `/api/v1/me`: expected when unauthenticated
- unhealthy preflight: inspect `api`, `runtime`, and `provider-gateway` deployments rather than looking for removed legacy services

## Shutdown

- stop the local web dev process
- stop the `kubectl port-forward` process
