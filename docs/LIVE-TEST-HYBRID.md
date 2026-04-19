# Live Test (Hybrid)

Use this mode when you want local `apps/web` against the live dev API without redeploying the web app.

## Topology

- local web: `http://localhost:3000`
- GKE API via port-forward: `http://localhost:3001`
- browser stays same-origin through `/api/v1`

This guide validates the active PersAI-native path only. It does not rely on any OpenClaw service.

ADR-072 is closed for the active migration baseline through Step 18. Current follow-through after that baseline is tracked in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

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

The active path truth is:

- web sync uses PersAI native runtime
- web stream uses PersAI native runtime
- API owns canonical chat/message persistence
- runtime owns request-time execution
- provider-gateway owns provider client interaction
- sandbox owns isolated file/process execution plus canonical persisted `AssistantFile` output

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
