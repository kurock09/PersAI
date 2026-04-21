# Test Plan

This document defines the current verification baseline for the active PersAI-native path.

ADR-072 is closed for the native migration baseline through Step 18. Any follow-through work on create/recreate polish, memory/knowledge economics, Step 19 scale hardening, Step 15a, or Step 20 should also be checked against `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

## Required repo checks

Run these before calling a change clean:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Add focused tests for touched code paths when the change affects behavior.

For production slices that touch API contracts, runtime behavior, or shared control-plane seams, also run:

```bash
corepack pnpm run test
```

## Voice DNA / persona-archetype focused checks

When a change touches Voice DNA archetypes, prompt-template V1 placeholders, setup/admin archetype selection, or published Voice DNA snapshotting, add the focused pack below before calling the slice clean:

```bash
corepack pnpm --filter @persai/api exec tsx test/voice-dna-modulator.test.ts
corepack pnpm --filter @persai/api exec tsx test/publish-assistant-draft.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. verify archetype localization resolves deterministically (`ru` when present, `en` fallback otherwise) and slider modulation stays conservative rather than rewriting the whole persona
2. verify forbidden openings are deduped and survive both archetype defaults and prompt-template interpolation
3. if setup/admin UI changes, verify the user-facing flow persists the real `archetypeKey` and the admin surface can still repair older `soul` templates to the V1 placeholder shape
4. if publish/materialize logic changes, verify live archetype rows are preferred and `snapshot_voice_dna` remains the deletion fallback instead of becoming a silent primary source
5. final V1 closure still requires the ADR-074 live smoke pair on `persai-dev` (`emotional-long` and `chitchat-short`); do not mark the slice fully closed from local unit checks alone

## Step 20 files/sandbox/media focused checks

When a change touches the public `files` tool, sandbox execution, `AssistantFile` handling, admin prompt-tool vocabulary, `files.send` / `files.write_and_send` / internal media delivery, or shared channel media delivery, add the focused pack below before calling the slice clean:

```bash
corepack pnpm run prisma:generate
corepack pnpm --filter @persai/sandbox test
corepack pnpm --filter @persai/sandbox exec tsx test/sandbox.service.test.ts
corepack pnpm --filter @persai/sandbox run typecheck
corepack pnpm --filter @persai/runtime exec tsx test/native-tool-projection.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-tool-prompt-metadata.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/seed-tool-catalog.test.ts
corepack pnpm --filter @persai/api exec tsx test/runtime-tool-policy.test.ts
corepack pnpm --filter @persai/api exec tsx test/tool-catalog-activation.test.ts
corepack pnpm --filter @persai/api exec tsx test/prisma-assistant-plan-catalog.repository.test.ts
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/telegram-webhook-proxy.controller.test.ts
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. cover both public `files` semantics and the internal delivery/storage seams it now wraps; do not only prove one of them
2. cover both durable `fileRef` delivery and current-turn artifact delivery semantics; do not only prove one of them
3. if the public file tool surface changes, verify model-visible projection/prompt/runtime policy truth shows `files` rather than the legacy split public file tool names
4. if current-turn artifacts are reselected by `artifactId`, verify the final runtime artifact set keeps one authoritative copy with the latest metadata instead of double-counting or silently dropping overrides
5. if Telegram delivery logic changes, confirm the shared media-delivery seam receives the real channel target and preserves `caption` through the outbound adapter path
6. if sandbox input `fileRef` mounting changes, verify read-by-`fileRef` works without a duplicate output artifact and that unchanged mounted inputs are not re-persisted as fresh sandbox outputs
7. if the change touches the final user-visible delivery boundary, prove both sides of the handoff: web must persist returned runtime media through `MediaDeliveryService` and expose the resulting attachments on the assistant message, while Telegram must route media through the shared delivery seam and avoid a duplicate outbound upload after that seam already handled delivery
8. if `sandboxJobsPerDay` changes or becomes user-visible policy, verify the sandbox service blocks the request before execution starts, records a blocked job row, and returns a structured quota reason instead of failing generically later
9. if per-channel outbound byte caps change, verify the limit is applied to the final combined outbound artifact set for the turn, not only to one candidate artifact in isolation
10. if `maxCpuMsPerJob`, `maxMemoryBytesPerJob`, or `maxConcurrentProcesses` changes, verify the sandbox service enforces the limit against the full spawned process tree rather than only the root process, and confirm the resulting `SandboxJob.resourceUsage` captures the peak process/CPU/memory truth for the run that completed or was blocked
11. if admin/operator sandbox observability changes, verify `AdminOpsCockpit` exposes the effective sandbox policy plus recent `SandboxJob` truth together: active/remaining daily quota counters must match the effective plan policy, and recent jobs must surface blocked reasons plus persisted `resourceUsage` telemetry instead of raw opaque JSON
12. if sandbox same-turn continuity changes, verify a single native tool loop can complete `files.write -> shell/exec/files.read` or the equivalent internal seam against the same relative path without the second sandbox job starting from an empty workspace
13. if attachment/fileRef hydration changes, verify the model-facing attachment summaries expose stable `fileRef`s for current and prior attachments so `files.send` can resend an older file without relying on filename guessing alone
14. if assistant-level file registry storage changes, verify the Prisma migrations leave `assistant_files` as the only live file-registry truth, that current runtime lookup no longer depends on `sandbox_file_refs` fallback on the active path, and that any schema cleanup keeps operator/runtime code aligned with the canonical model
15. if sandbox file mounting or produced-file persistence changes, verify new public/runtime `fileRef`s come from `AssistantFile` ids, completed sandbox job polling returns those canonical ids on the real result path, sandbox mount resolution only accepts canonical assistant-file ids on the live path, and persisted `sourceToolCode` truth reflects the clean `files` execution model rather than sandbox-era split action names
16. if admin Prompt Constructor or model-visible tool vocabulary changes, verify the editable/admin-visible file-tool surface shows `files` rather than legacy split public file tool names and that direct admin metadata updates reject hidden legacy public file tool codes
17. if tool catalog or plan/runtime materialization changes around file tools, verify removed legacy public file tool codes are no longer active catalog truth, DB cleanup plus repository/API projection keep stale legacy rows from surfacing in `Admin Plans`, and runtime direct dispatch accepts `files` rather than the split public file tool names
18. if sandbox workspace lifecycle changes, verify one assistant can complete `write/edit -> separate later read` across separate sandbox jobs without remount-only turn state, verify edited files keep a stable `AssistantFile` id for the same relative path, and verify cold restore from `assistant_files` recreates the workspace after local session deletion without reviving removed legacy file-ref fallbacks
19. if assistant workspace coordination changes, verify one `assistantId + workspaceId` has only one active lease holder cluster-wide, a second same-workspace job stays queued until release instead of writing concurrently, a different workspace can still proceed in parallel, expired leases are reclaimable, and lease loss resets the local workspace back to canonical persisted `assistant_files` truth before the pod can keep mutating it
20. if sandbox internal file execution or admin sandbox observability changes, verify the active sandbox job/operator truth uses `files` for file operations rather than internal `read_file` / `write_file` / `edit_file` codes, and confirm `Admin > Ops` persisted file counts come from canonical `assistantFiles` rather than removed sandbox-era relations
21. if `files.send` changes, verify runtime no longer carries a separate `send_media_to_user` tool payload/service path and that send-by-`fileRef` plus current-turn `artifactId` delivery still resolve through the same canonical `files` execution result
22. if `files.write_and_send` changes or is introduced, verify one tool call persists the file, returns the canonical `fileRef`, emits the delivered artifact in the same result, and leaves model-facing guidance preferring that atomic path for “create and send in one turn” requests
23. if delivery-honesty protection changes, verify a completed turn that claims a file was sent but returns zero delivered artifacts is corrected explicitly instead of being stored as a confident false-success reply
22. if assistant workspace hydrate/reset changes, verify missing object-storage blobs do not crash the sandbox path: stale `assistant_files` rows must be removed from canonical truth, the local workspace must rebuild from the remaining accessible files, and the job must complete or fail structurally instead of taking down the pod
23. if `files.read` / `files.write` / `files.edit` or sandbox explicit mounts change, verify the normal canonical `files` path runs by hydrated workspace `relativePath` without redundant `mountedFileRefs`, and verify any remaining explicit mounted `fileRef` path is scoped to the same assistant/workspace and fails structurally after stale-row cleanup when the backing blob is missing
24. if `files.delete` or default `files.list` presentation changes, verify recursive directory delete works, root delete stays blocked, single-file delete returns the canonical deleted item, and the default list summary groups `workspace`, `uploads`, and `artifacts` without exposing raw service-noise paths unnecessarily

## Web stream latency-trace focused checks

When a change touches web SSE orchestration, replay wait behavior, pre-first-delta timing, or provider stream timing logs, add the focused pack below before calling the slice clean:

```bash
corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. verify API latency traces keep the same trace across `prepare_begin`, replay claim, prepared state, SSE `started`, runtime request, and first visible delta instead of starting only after the slow part already passed
2. verify completed/failed/interrupted runtime stream results can carry structured `trace` stages such as `prepare.*`, `provider_headers_received`, `first_provider_event`, and `first_text_delta`
3. verify provider-gateway stream logs include elapsed time to response headers or `failed-before-headers`, so live slow cases can be split between upstream-connect delay and token-generation delay
4. for any live slow-stream investigation, correlate `web_stream_timing` / `web_stream_timing_failed` from `api` with `[provider-gateway-stream]` lines from `runtime` by `requestId` before making claims about where the delay lives

## Durable memory M1 focused checks

When a change touches durable assistant memory classification, the `core` / `contextual` split, the internal `runtime → api` memory hydration endpoint, the prompt-cache stable-block split between `durable_memory_core` and `durable_memory_contextual`, or the Memory Center class/kind labels, add the focused pack below before calling the slice clean:

```bash
corepack pnpm --filter @persai/api exec tsx test/hydrate-memory-for-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/write-assistant-memory.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/prompt-cache-stable-blocks.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. verify write-time classification matches the documented policy: `fact` / `preference` → `core`, `open_loop` → `contextual`, web-chat memory → `contextual`, Workspace Memory → `core`. Surprising rewrites of this policy must be justified in the slice handoff.
2. verify `MEMORY_CORE_HARD_CAP = 15` is enforced on the write path with oldest-demoted overflow, and that the cap is NOT exposed as a user-tunable setting (founder principle 1).
3. verify `HydrateMemoryForTurnService` returns the always-on core block plus a relevance-retrieved contextual tail in one call, deduplicates contextual hits against core ids, and bumps `last_used_at` on every hydrated entry — not only on contextual or only on core.
4. verify the runtime composes two distinct prompt blocks: `durable_memory_core` (always present when any core entries exist, byte-stable across turns) and `durable_memory_contextual` (per-turn relevance, omitted entirely when empty). Folding both back into one block silently breaks the cache invariant.
5. verify the prompt-cache invariant explicitly: rotating the contextual block content per turn must NOT change the stable token sequence emitted for `durable_memory_core` + `shared_compaction_summary`. This is the M1-vs-P1 contract.
6. final M1 closure still requires the ADR-074 live smoke pair on `persai-dev` (`multi-session-continuity` and `chitchat-short`); do not mark the slice fully closed from local unit checks alone.

## Knowledge/admin focused checks

When a change touches the active knowledge plane, retrieval policy, or admin knowledge surfaces, the focused verification pack should include the relevant targeted tests:

```bash
corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-knowledge-sources.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-knowledge-sources.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-authorization.test.ts
corepack pnpm --filter @persai/api exec tsx test/runtime-knowledge-access.test.ts
```

## Helm / deploy truth checks

Validate rendered deploy truth:

```bash
helm lint infra/helm -f infra/helm/values.yaml
helm lint infra/helm -f infra/helm/values-dev.yaml
helm template persai infra/helm -f infra/helm/values.yaml > /dev/null
helm template persai-dev infra/helm -f infra/helm/values-dev.yaml > /dev/null
```

Expected active components:

- `api`
- `web`
- `runtime`
- `provider-gateway`
- `sandbox`

No rendered `openclaw*` workload, service, configmap, ingress, or secret wiring should remain in the active chart path.

## Live cluster checks

For `persai-dev`, verify:

```bash
kubectl -n persai-dev get deploy,svc,ingress,networkpolicy
kubectl -n persai-dev get pods -o wide
kubectl -n persai-dev get secret
kubectl get applications.argoproj.io -n argocd
```

Expected:

- only `api`, `web`, `runtime`, `provider-gateway`, and `sandbox` workloads are active
- ingress `bot.persai.dev` routes to `api`
- `persai-runtime-secrets` is the active native-runtime secret object
- no `openclaw*` resource remains in the active namespace

## Runtime path checks

Verify the active runtime path from the cluster:

```bash
kubectl -n persai-dev get deploy api -o yaml
kubectl -n persai-dev get deploy runtime -o yaml
kubectl -n persai-dev get deploy provider-gateway -o yaml
kubectl -n persai-dev get deploy sandbox -o yaml
```

Expected env truth:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_SANDBOX_BASE_URL=http://sandbox:3013`

## Final load-readiness follow-through

Core `Step 19` deploy/restart recovery and current `/admin` `System Overview` pod-truth are already observed on the active path. The remaining scale-oriented proof is the final bounded load-readiness follow-through, and it must not be treated as generic speed tuning only.

It should verify all of the following:

1. bounded load evidence demonstrates that the active native path is ready for production pressure rather than merely faster in one happy-path sample
2. the saved report preserves enough rollout/restart/admin context to reveal if the earlier deploy/operator closure regresses under pressure
3. if `/admin` `System Overview` truth or deploy/restart recovery looks weaker under load than in the earlier bounded rollout checks, that regression must be called out explicitly before the final step is considered closed

For the current bounded repo-local readiness pass, use the fixed-scale `SR10` ladder before any execution-side HPA work:

```bash
node scripts/loadtest/run-sr10.cjs --config scripts/loadtest/sr10.local.json --profile 100
node scripts/loadtest/run-sr10.cjs --config scripts/loadtest/sr10.local.json --profile 100,500,1000
```

Interpretation rules:

1. do not claim a safe ceiling above the highest profile with a saved JSON report in `artifacts/sr10-loadtest/`
2. the report must include phase summaries plus admin snapshots before/after phases so restart/degradation evidence is visible alongside latency/error gates
3. the next bottleneck must be written down explicitly after each ladder run, even if the run fails below `1000`
4. `runtime` and `provider-gateway` HPA must stay disabled in active Helm values until the fixed-2-replica path passes rollout/restart recovery and at least one bounded load ladder with honest bottleneck evidence

## User-path smoke

At minimum, prove:

1. API `/health` and `/ready` are healthy
2. authenticated `GET /api/v1/assistant/runtime/preflight` returns `live=true` and `ready=true`
3. ordinary `/app` web chat completes on the current native path
4. if validating Step 20, one real web turn can complete either `files.write_and_send` or the equivalent `files.write` -> `files.send` path over the assistant-file-backed sandbox path and produce a user-visible attachment without dropping the artifact at the final surface
5. the cluster has no active dependency on a removed legacy runtime service

## Historical traces

The following may still contain historical OpenClaw references without being treated as an active-path failure:

- `docs/ADR/*`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- old Prisma/SQL migrations

Everything else that presents current deploy/debug truth must match the PersAI-native path.
