# Architecture

## System shape

PersAI is a modular monolith control plane plus three internal execution services:

- `apps/api` - public HTTP API, control plane, ingress-facing orchestration
- `apps/web` - product and admin UI
- `apps/runtime` - PersAI-native execution runtime
- `apps/provider-gateway` - internal provider transport boundary
- `apps/sandbox` - isolated **execution** boundary for `shell` / `exec` / `document.*` sandbox jobs only (ADR-137)

OpenClaw is not part of the active architecture. Historical migration traces remain only in archival documents and old migrations.

ADR-072 remains the historical migration ADR through the native-path closeout. ADR-078 is completed and archived as the consolidated follow-through program. ADR-080 is the target-state decision for admin-controlled Knowledge authoring and Skill curation. ADR-081 is the target-state decision for the unified user Files architecture. ADR-087 defines unified quota advisories and paid light mode. ADR-088 defines the unified notification platform, control plane, and delivery architecture. ADR-092 is the billing decision for split payment-method truth, SBP recurring migration, provider recurring description sync, and payment-success notification policy. ADR-093 covers agent execution discipline for PROD launch readiness and concurrency hardening. **ADR-102** (pre-PROD architectural cleanup) is **completed** (2026-05-30). ADR-098 adds the public trust-page model. Programs **ADR-100** (project chat), **ADR-105** (media jobs), **ADR-106–109** (video/vcoin/HeyGen), **ADR-112** (context/memory/tools), **ADR-114** (reserve image transport), and **ADR-115** (inbound safety) are **closed** — authoritative as target-state only, not as active slice backlogs. **Active orchestration programs at the top of `AGENTS.md`** (including ADR-139 for Browserless capability policy over persistent profiles) are the authoritative live surface for open programs; new waves outside those still require explicit user priority and usually a new ADR.

### Adaptive web/mobile shell

ADR-144 splits ownership cleanly:

- native shells own orientation permission: compact Android phone/outer-fold
  displays and iPhone stay portrait; Android large/inner-fold displays and
  iPad permit rotation
- `apps/web` owns layout only from actual CSS viewport width; `md` begins at
  600px, where the persistent sidebar/list-detail shell activates
- no device model, manufacturer, Fold name, or user-agent determines layout
- medium desktop shell uses a 240px sidebar (280px from 1024px) and matching
  22px sidebar/main rounding over the existing 8px chrome gutter

## Core boundaries

### Control plane

`apps/api` owns:

- assistants, publish/apply lifecycle, and runtime bundle materialization
- ADR-147 closed truth: Admin Role constructor exists at `/admin/roles` and `/api/v1/admin/roles*` with Skill full-replace, default/in-use protections, shared production mission/enabled-Skills preview, and five MCP Role tools over the same HTTP APIs. Every assistant has exactly one required `Assistant.roleId`; owner-facing role reads/writes remain `GET /api/v1/assistant/roles`, `GET /api/v1/assistant/{assistantId}/role`, and `PUT /api/v1/assistant/{assistantId}/role` with strict UUID path validation; effective runtime Skill truth resolves only through `Assistant.roleId -> AssistantRoleSkill -> active Skill`. S5a removed active direct Skill-selection API/MCP/web/plan-limit surfaces; deployed Release C `a11c8b6b` / bot pin `05ccaed4` completed S5b physical assignment-storage and persisted plan Skill-limit JSON removal. User setup/recreate/Settings are Role-first. Global publish uses exact `{ assistantId, expectedRoleKey, roleKey }`; the outer publish transaction locks/revalidates expected Role identity before assignment/version/apply writes and returns stable 409 on drift. Production and preview materializers share algorithm v2; new code treats every older spec as stale independently of generation/dirty timestamps.
- Voice DNA archetype seed/edit flows, prompt-template defaults, and published Voice DNA snapshot materialization
- canonical chat/message persistence
- unified user-visible Files over canonical workspace paths, `workspace_file_metadata`, and attachment/document projections
- assistant/global knowledge indexing, retrieval policy, and admin knowledge governance
- admin-authored Skill knowledge cards, Product KB text entries, and assistant-assisted admin knowledge drafts
- durable retrieval observability and workspace-scoped operator surfaces for knowledge quality
- governance, quota, admin, and audit boundaries
- Telegram webhook ingress
- durable quota-advisory threshold evaluation, assistant-authored active-surface follow-up delivery, quiet paid light-mode state, and advisory dedupe
- web/telegram compaction-state and queue/advisory reads must derive from the current materialized runtime bundle truth, tolerating either the persisted runtime-bundle object or the persisted JSON document form so UI/notification state does not drift from runtime config
- unified notification platform (ADR-088 Slices 1+2+3+2.5 implemented): global truth + auto-derived per-workspace channel availability; Postmark via `Admin > Tools` secret store. `NotificationIntentService` is the single entry point; all conversational producers and `BillingLifecycleProducerService` create intents; `NotificationDeliveryWorkerService` claims/renders/delivers via typed channel adapters using `ResolveWorkspaceNotificationChannelsService` for per-workspace availability; `notification_channel_registry`, `notification_policies`, `notification_quiet_hours` are global singletons (no `workspaceId`); per-workspace availability derived at delivery time from `AppUser.email`, `AssistantChannelSurfaceBinding`, intent context; `Admin > Notifications` is the compact operator control plane; legacy tables deleted; Postmark credentials in `Admin > Tools`; seed writes zero notification rows
- PersAI-owned billing lifecycle state, trusted provider/admin billing event snapshots, append-only lifecycle events; billing email delivered via Postmark through the notification platform (`class=transactional`, six template modules, dedupeKey, traceId=billing event id). ADR-092 is now active runtime truth: last successful payment method and the auto-renew instrument are distinct truths; managed SBP upgrade flows persist explicit `recurringMigration` state instead of implying SBP auto-renew from one-time success; provider recurring descriptions are synchronized with PersAI plan naming; payment-success communications include branded PersAI copy plus an official provider-receipt footer when available; billing intents remain visible in `Admin > Notifications` delivery history for platform-scoped admins.

### Talking-video personas and cloned voices

ADR-109 and ADR-111 add one bounded HeyGen-backed product seam inside the active PersAI-native path:

- `apps/api` owns workspace-scoped talking-video persona truth plus workspace-scoped cloned-voice truth, including limit/cost gating, create-time portrait normalization/cropping to the stored persona video format, persona materialization, and safe display labels
- `apps/web` owns the `Settings -> Characters` UX for persona CRUD, `My voices`, clone upload/record flows, and honest pending/ready/failed status rendering
- `apps/runtime` does not route on freeform voice keywords; it only receives structured `videoPersonaCatalog` guidance, may surface safe cloned-voice display labels when a saved persona already carries one, and uses stored persona `videoFormat` as the default talking-avatar aspect ratio only when the request itself does not explicitly choose a format
- provider clone ids are never user-facing product labels and must not become model-facing routing hints

### Runtime plane

`apps/runtime` owns:

- runtime bundle warm/use
- request-time turn execution
- ADR-147 Slice S2 local truth: runtime bundles now carry non-model `effectiveRoleId`; `skill.engage` / `skill.release` persistence validates internal UUIDs before raw casts, sends `expectedRoleId`, and returns honest `stale_assistant_role_snapshot` results instead of claiming durable state after a role change or role-skill drift. Skill-related mutations share the absent-link-safe order `Skill -> AssistantRole -> Assistant -> AssistantChat -> AssistantRoleSkill` (sorted ids for every multi-row class). Scenario mutation locks its parent Skill before discovering/revalidating linked Roles and taking its Assistant snapshot; release uses an unlocked Skill candidate only to enter that order, then revalidates locked chat state before writing. Future Role-Skill replacement must lock every involved Skill before any Role. Role PUT touches no Skill/link and remains a valid Role→Assistant subsequence with bounded Assistant revalidation retry.
- runtime session and turn state
- native execution health/readiness
- ADR-152 checkpoint 1 model-visible `await.wait`: one bounded observation call
  through the API-owned canonical resolver, with status-only zero timeout,
  60-second cap, one blocking wait per job per turn, and Stop aborting only the
  wait/turn. No runtime Prisma access or parallel job registry is introduced.

### Provider plane

`apps/provider-gateway` owns:

- provider client boot/warmup
- model/provider request transport
- provider health/readiness surface

### Local browser bridge path

ADR-140 closes the persistent Browserless session era. The active browser architecture is:

- `apps/api` owns browser-profile identity, TTL/recovery state, bridge session refs, product-facing re-auth state, and the browser-bridge relay/control-plane endpoints
- `apps/runtime` owns the single model-facing `browser` tool, chooses between local bridge and headless Browserless, and must speak from structured profile/bridge state instead of raw transport failures
- `apps/provider-gateway` owns only the retained headless Browserless public no-profile path (`snapshot` / `screenshot` / `pdf`) and does not own persistent sessions, BQL profile execution, or live login flows
- authenticated CRM/portal work runs only through the local bridge (Chrome extension on web, Capacitor bridge in the app); no persistent cloud Browserless path remains active
- Capacitor may surface a transient local-only browser activity thumbnail from the retained native WebView after assistant operation boundaries; the image is bounded in native code, crosses only the local plugin event bridge, is never persisted, and opens that same retained view on tap
- after a profile-backed browser command starts, that retained desktop/mobile surface remains observer-only for the whole assistant turn; local trusted input is blocked until stream completion or an explicit model-owned `request_user_action` transfers ownership
- web/app re-auth is product-owned modal/banner UX; Telegram cannot host local browser execution and must return structured `open_in_app` / `bridge_unavailable` semantics for logged-in browser work

### Sandbox plane

`apps/sandbox` owns:

- isolated process/document job execution (`shell`, `exec`, `execute_document_code`, `render_html_to_pdf`)
- assistant-workspace pod materialization and session snapshot cache (not canonical bytes authority — ADR-137)
- sandbox job health/readiness and job polling surfaces used by `apps/runtime`

**ADR-148 closed (founder live-accepted 2026-07-15):** healthy
session-scoped exec pods are warm reusable execution containers, not
single-command throwaways. After a session job, `apps/sandbox` persists
workspace/output state first, then runs control-plane-owned descendant cleanup
inside the pod, verifies the baseline process set, and only then releases the
workspace lease. Cleanup-proof failure retires the exact UID fail-closed.
Sessionless jobs remain disposable. Session package env (`HOME`,
`PYTHONUSERBASE`, `NPM_CONFIG_PREFIX`, login-shell PATH) lives under the
canonical `/workspace/assistants/<assistantId>/sessions/<sessionId>` root, and
dependency-tree quota is separated from ordinary user-file growth. Idle TTL
holds on the deployed sandbox control plane after the `2342c2ae` cleanup repair.
**ADR-150 closed (founder-accepted 2026-07-16, push `314ee37a`):** session
install-layer trees (`.local`, `.npm-global`, `node_modules`) are warm-pod
ephemeral only — not mirrored to GCS, not hydrated, not shown in Files /
`files.list`. Curated popular packages stay in the exec image (`/opt/venv`).
ADR-146 stays closed; ADR-148 supersedes only the over-broad per-job retirement
behavior and must not be reopened for new scope.

**ADR-151 closed (2026-07-17):** platform-global reusable Scripts are
immutable-versioned ordinary code, not nested PersAI agents. The control plane
owns Script, immutable published ScriptVersion, ordered
SkillScript, bounded Scenario `scriptRef`, and nullable SandboxJob invocation
identity schema. `RuntimeBundleSkillScenarioStep.scriptRef` is required
nullable (no legacy optional dual-read). Bundle materialization resolves an authored
`{scriptKey, inputMapping}` Scenario-step reference through the owning Skill's
live `SkillScript` link to `Script.currentPublishedVersion` and pins the exact
`{scriptKey, scriptId, scriptVersionId, versionNumber, contentHash,
inputMapping}` plus the bounded input schema needed for dynamic projection;
an authored non-null reference that cannot resolve fails bundle materialization
closed, while an authored null stays null. An already-admitted bundle keeps its
exact old pin even after a later republish. A dedicated
internal read boundary (`apps/api`) lets the runtime re-fetch that exact pinned
`ScriptVersion` artifact immediately before execution, live-checking the
assistant's current Role/effective active Skill, `Script.status`, and the
`SkillScript` link on every admission (older published
pins remain valid; archived/unlinked/key/hash mismatch fails closed with
stable typed errors) without ever leaking code to prompts/logs. The
provider-facing tool name is `script` (`{action:"execute", input:object}`,
internal operation/`SandboxJob.toolCode` exactly `script.execute`), projected
only when the exact current active Scenario step carries a materialized
`scriptRef`; projection is not authorization, so the runtime re-resolves the
live Skill/Scenario/step immediately before dispatch. Runtime input mapping
supports exactly `literal` / `current_user_message` / `tool_input` sources,
validates the mapped object and the Script's result against the exact
published input/output JSON Schemas with Ajv 8.18 strict Draft 2020-12, and
derives a server-only `scriptInvocationKey` (bounded SHA-256 of turn/request
identity + provider tool-call id + pinned version) that the sandbox threads to
the Script through a reserved platform environment variable.

`SandboxService.submitJob` admits `script.execute` atomically by
`(assistantId, scriptInvocationKey)` before ordinary preflight/quota
consumption: on a `P2002` race the loser refetches the winner's row and
replays queued/running/terminal state, while a same-key call pinned to a
different version or a different canonical input hash fails closed with a
stable `idempotency_conflict` — only the winner ever executes. Execution
delegates to this exact same warm session sandbox path: Assistant workspace,
`/opt/venv`, system/Python/Node/Bash tools, existing warm install layer,
Assistant `restricted | full_public` egress choice, and existing
Stop/deadline/resource/cleanup semantics. The immutable `code`/`entryCommand`
are reloaded server-side by `scriptVersionId` (never trusted from the model).
The sandbox repeats the complete authorization check immediately before
execution, recomputes the canonical executable-contract hash, and validates
input/output before durable success. Code/input/output stage transiently under
`/tmp`; an in-wrapper trap plus bound-pod control-plane cleanup removes them,
and cleanup uncertainty retires the pod fail closed, so protocol files never
enter workspace GCS/Files/snapshots. Script `workingDirectory` reuses the safe
shell/exec workspace-bounded cwd resolver. Per-invocation result framing and
the effective minimum of Script/stdout/single-file limits bound structured
output. It adds no Script-specific pod, NetworkPolicy, image,
package allowlist, stdlib-only contour, or persistent staging filesystem.
ADR-150 remains authoritative: session-installed packages do not survive cold
pod recycle or GCS/Files/snapshot/hydrate.

Scripts may be ordered full-replace links of existing Skills; they do not alter
ADR-147's Role-only effective Skills derivation. An active Scenario step may
carry a bounded structured Script reference/input mapping and model-mediate one
synchronous execution, but no automatic workflow engine. Invocation truth is
the existing `SandboxJob`, not `ScriptRun`, with exact nullable
`scriptVersionId`, stable invocation key, policy snapshot (exact
version/input-hash/runtime/limits), and idempotent admission/replay. Tool SDK,
browser executor, async/jobRef/wait/notify, and managed secrets are explicitly
outside ADR-151 (ADRs 152/153); before ADR-153, credentials placed in
code/input are unmanaged and receive no redaction, TTL, revoke, or log-history
promise. Release `f0944d31` / GitOps pin `95c7d68d`, the deployed `5fb61f3c`
`job.files` repair, and final runtime release `43f653b4` passed the final
allowed-model audit, strict model-driven Script smoke, and approved-account
Admin Scripts UI founder acceptance. ADR-151 is closed.

**ADR-152 (checkpoint 2 locally implemented):** checkpoint 1, the
API/data/delivery ownership core, exact `wait|notify` terminal control,
source-turn finalization, and serialized same-chat continuation are implemented
locally. A SchedulerLease-backed API worker now validates and claims ready
handle rows, dispatches through the ordinary runtime session lease/receipt seam,
persists one Assistant output, and conservatively reconciles stale work. The
same `assistant_async_job_handles` row now owns source-finalization, narration,
depth, claim/dispatch/receipt/retry, and terminal state. Both media and document
delivery paths consult that decision before legacy framing while preserving
their existing attachment-first file ownership. Audit repairs distinguish
typed busy-before-acceptance from ambiguous dispatch, use a full-turn dispatch
deadline, require runtime receipt/in-flight absence proof before requeue, and
CAS-own Telegram/artifact attempts before external calls. Original
user-message UUID and continuation client-turn identity remain separate through
child-job enqueue/depth inheritance. Row depth names the creating turn;
scheduler depth is `rowDepth + 1`. Persisted continuation output finalizes only
children keyed by its client-turn id, with receipt/message reconciliation for
lost completion. Internal runtime responses are strictly validated before
scheduler dereference. Checkpoint-2 audits were DIRTY; repairs await confirming
independent re-audit and make no CLEAN claim. The bounded architecture adds
only a Script browser SDK and durable canonical-job observation. Script browser
capability is exactly `{browser:{actions:["snapshot","act"]}}`: a required
structured profile input reaches the existing `RuntimeBrowserToolService`, API
local bridge, and exact user device with existing affinity, observer lock,
abort, policy/quota, progress, and telemetry. It has no headless fallback,
browser list/login/open-live/user-action SDK methods, or Script-visible bridge
credentials/identifiers. A narrow job-scoped TTL Redis broker extends live-exec
stdin/stdout framing; it is not a second browser runtime, permits one
outstanding request/job, and fails an active Script closed on loss/restart.
Browser page payloads never persist to Postgres, SandboxJob, GCS, or logs.

The universal model-visible `await` tool will observe only owned canonical
media/document jobs through opaque server-minted `jr1` handles mapped by one
additive `assistant_async_job_handles` table. `wait` is terminal-before-call,
capped at 60 seconds, one blocking wait/job/turn, and never cancels canonical
work; `notify` creates durable subscription and ends the provider loop, later
dispatching exactly one fresh-hydrated continuation in the original chat/channel
without re-delivering files. Existing attachment-first delivery remains sole
file delivery owner. Subscribed completion skips legacy isolated completion
framing; unsubscribed behavior remains byte-compatible. The continuation chain
is bounded to four unattended continuations per originating user turn.
The canonical-job adapter contract is extensible, but background work is
deliberately deferred: current `assistant_background_task_runs` lacks an
immutable exposed run identity suitable for handle minting/resolution, and a
recurring `assistant_background_tasks` row never qualifies as a job reference.
Document SDK is NO-GO because nested document SandboxJobs contend for the outer
Script's workspace queue/lease and deterministically time out within a bound.
This is not a general-purpose SDK, durable Script-execution restart, or
managed-secret program; ADR-153 owns credential guarantees.

Model-facing `files.*`, `grep`, and `glob` are **storage-plane** tools: runtime writes/reads committed bytes via GCS + `workspace_file_metadata` + internal API (`apps/api`), not sandbox `toolCode: "files"`.

**ADR-146 closed target (Slices 0–6 landed, deployed, and live-accepted
2026-07-13 on release `35024b39`):** sandbox egress is
an immediate assistant-owned operational choice stored on
`Assistant.sandboxEgressMode`. `restricted` remains the default
proxy/domain-allowlist contour. Explicit `full_public` consent gives the
whole gVisor execution pod (`shell` / `exec` / `document.*`) direct public
TCP/UDP egress: Slice 3 stamps pod labels/annotations against the Slice 2 Helm
policy and resolves mode from Prisma at last responsible moment,
while NetworkPolicy, explicit non-global/internal CIDR exclusions, an
empty-ingress policy, and a dedicated no-IAM execution ServiceAccount continue
to block Kubernetes, node, VPC, private, link-local, and metadata destinations.
The setting does not affect storage-plane tools, browser, web tools, or provider
workers. **Slice 4 (`3f498ef9`)** surfaces owner consent in Assistant
Settings → Assistant block (`Sandbox network` row): unchecked `restricted`,
checked `full_public`, enable confirmation modal, canonical GET/PUT refetch, no
optimistic UI.

**ADR-146 Slice 5 (`d23936d1` on `3f498ef9`):** D9 observability exports
egress counters/histograms from sandbox `/metrics`; audit/log fields documented
in `infra/dev/gke/ADR146-OBSERVABILITY.md`; fail-closed active-code and
cross-layer contract scripts gate legacy-field absence and S1–S5 alignment. The old plan `networkAccessEnabled` boolean is removed by Slice 1
rather than reinterpreted. Owner PUT synchronously reconciles only idle
missing/malformed/mismatched-mode pods (honest `recycled`; active exact-lease
operations and post-commit correct-mode admissions survive; post-commit failure
is stable `503`). Model jobs bind `(namespace,name,uid,leaseToken,jobId)` only
after acquiring the workspace lease; bind and every model exec also require the
exact live DB token/holder/job/expiry. Lease-free exec carries caller-captured
UID/assistant/workspace/handle/mode, and terminal writes atomically require the
exact active lease. Admission and post-persistence retirement use UID
preconditions; owner reconcile and the reaper use UID+resourceVersion snapshots,
so a same-name or newly patched replacement is never deleted. Failed
retirement withholds lease release; durable annotations, not a DB name
quarantine or process marker, carry crash contamination.

**ADR-146 Slice 2 Helm policy (`5a2fd3bd`):** additive
`sandbox-exec-full-public-egress` selects only
`app.kubernetes.io/component=sandbox-exec` +
`persai.io/sandbox-egress=full-public`. Restricted isolation keeps selecting
unlabeled/`component=sandbox-exec` pods so the live restricted contour is
preserved until S3-stamped pods replace them after deploy. Shared deny inventory binds Squid, NAT probe, and
full-public public egress. Chart fails closed if sandbox runs with
`networkPolicy.enabled=false`. Proxy env remains a Helm/pod-spec contract with
`defaultMode=restricted`; ExecPodBridge mode selection landed in Slice 3.
The rendered public rule is explicitly IPv4-only (`ipFamily: IPv4`,
`0.0.0.0/0`). IPv6 and dual-stack environments fail chart validation until a
future ADR/slice supplies an audited IPv6 internal/metadata deny inventory.

**ADR-146 Slice 0 live finding (historical):** `personal-ai-gke` originally ran
`LEGACY_DATAPATH` with Calico and Cilium disabled. Helm NetworkPolicy objects
were present but not enforced until Slice 0.1. **Slices 0.1 + 0.1b are now
live-accepted** with Calico enforcing the restricted contour (see SESSION-HANDOFF
/ ADR-146).

**ADR-146 Slice 0.1 foundation (live-accepted 2026-07-13):** the
founder-selected current-cluster contour is codified under
`infra/bootstrap/adr146-sandbox-egress-foundation.*` and is applied live at the
proof/deploy pins recorded in ADR-146 and SESSION-HANDOFF:

- enable GKE NetworkPolicy/Calico on `LEGACY_DATAPATH` (node recreation required;
  Helm `networkPolicy.enabled` only renders API objects and does not enable the
  engine; Calico readiness labels are rollout signals, not enforcement proof);
- dedicated private sandbox node pool (`sandbox-pool-private`) with
  `--sandbox=type=gvisor` / live `sandboxConfig.type=gvisor`, least-privilege
  node SA, existing `workload=sandbox` + `sandbox.gke.io/runtime=gvisor`
  scheduling, custom pod secondary `10.109.0.0/20`, and no node external IP;
  labels/taints alone are not GKE Sandbox proof;
- after private pool Ready, fail-closed cordon of the legacy public sandbox pool
  closes the dual-pool scheduling window without deleting the old pool or
  killing running jobs; maintenance-gated retirement remains separate;
- Cloud Router + static-IP Cloud NAT with NAT logging, selecting the cluster
  subnet primary plus `persai-sandbox-pods`: default GKE public Pod traffic is
  node-SNATed, so primary-range coverage is mandatory. Static attribution is
  currently sandbox-exclusive only while live verification proves every
  eligible regional/VPC no-external-IP consumer is a private sandbox node;
  subnet VPC flow logs remain enabled;
- all-protocol VPC egress deny for an explicit reviewed auto-mode VPC subnet +
  PSA/Redis/Filestore/special-use inventory; cluster node-primary
  `10.132.0.0/20`, broad `10.0.0.0/8`, Pod ranges, Service
  `34.118.224.0/20`, and metadata are deliberately excluded so whole-node
  kubelet/control-plane/Calico and node-local/post-DNAT paths are not broken;
  conflicting higher-priority EGRESS ALLOW rules targeting the sandbox tag are
  inventoried and rejected; historical S6 evidence first found the public GKE
  master endpoint reachable (`PUBLIC_MASTER_REACHABLE`), then D4 repair
  `2f73d58c` added the exact dual-layer `34.38.46.10/32` deny. Final S6 evidence
  on release `35024b39` proved `PUBLIC_MASTER_BLOCKED`; current evidence
  inventory SHA-256 is
  `589c1c0e0561645dc08cf45a58313450f90ab5c460b939ca6d60692bd2b8126d`
  (historical foundation proof SHA
  `c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`
  remains historical);
- mandatory Calico ownership of node-primary, Pod, Service, metadata, and
  same-node denies (active probes include live kube-dns Pod IP UDP/TCP 53 and
  same-namespace sandbox control-plane Pod IP); exact NodeLocal
  `169.254.20.10/32` and kube-dns Service `34.118.224.10/32` UDP/TCP 53 allows;
  a complete values-owned Squid public-egress exclusion inventory; explicit
  empty exec-pod ingress; and a dedicated identity-less/no-RBAC/no-WI
  `sandbox-exec-sa` assigned to every ephemeral/warm execution pod (final
  verification requires ≥1 Running exec pod — zero pods cannot claim wiring);
- fresh fail-closed live preflight before every mutating phase, exact-match-only
  idempotency, explicit maintenance-confirmed old-pool retirement, structural
  `verify`, and separate founder-approved `probe-restricted`; final S6 parent
  evidence proved inbound empty-ingress, redirect private-follow denial,
  private-answer DNS connect denial, and public-master denial. The parent ran
  equivalent direct probes individually rather than one exact helper
  `--execute`; the private-answer phase passed, while a timed public-to-private
  rebinding race remains optional hardening;
- S0.1b production rollout used the repository release gate: the coordinated
  founder push synced Helm
  KSA/NetworkPolicy while non-sandbox tags stay last-good; Dev Image Publish
  pins sandbox immediately after a successful sandbox build; controlled probes +
  structural/live verification run with clean-tree evidence bound to the exact
  git commit SHA and committed inventory SHA-256 (dirty/mismatched trees fail
  closed); `cleanup-controlled-probes --execute` is required on success and
  failure; any non-tag `values-dev` edit enters the release gate while
  image-tag-only bot pins cannot recurse; remaining service pins wait on ordered
  GitHub Environment approvals (`persai-dev-adr146-foundation`, then
  `persai-dev-migrations` when both apply). CI does not auto-apply foundation
  mutations or fabricate GKE attestation. Required Environment approval and live
  parent evidence were recorded for S0.1/0.1b. No feature flag. Dataplane V2
  migration remains outside ADR-146.

Final S6 acceptance also proved operator-owned public SSH/custom TCP+UDP,
restricted custom-port denial, unchanged browser/web-search behavior, Luma mode
toggle/retirement, audit rows, mode metrics, and complete fixture/pod cleanup.
The approximately 90-second hard shell process timeout is a non-egress product
residual. ADR-146 is closed; new scope requires a new ADR.

### Native Tool Runtime instruction model

ADR-117 closes the tool-instruction surface into three owned seams:

```text
Model-facing
- tools prompt block -> Native Tool Runtime selection guide (which tool / when)
- catalog -> policy -> projection -> per-tool descriptor (what tool / params)
- projection-only helpers -> per-turn runtime-state hints

Provider-facing
- runtime-contract index fragments -> provider-conditioning only (how rendering should behave)
```

Cross-tool selection rules live only in the selection guide (`apps/api` prompt-template default + admin presets). Per-tool mechanical text lives only in the descriptor path. Provider-conditioning text is shared through the canonical fragments in `packages/runtime-contract/src/index.ts` and must not be repeated in model-facing tool descriptions. These fragments live directly in the contract index module (not a sibling file) because `@persai/runtime-contract` is consumed as un-built TypeScript source at runtime and must stay a single self-contained module (extensionless relative imports are unresolvable under Node's type-stripping ESM loader).

## Active request path

### Web

1. Browser calls `apps/api`
2. `apps/api` persists canonical state and forwards request-time execution to `apps/runtime`
3. `apps/runtime` calls back into `apps/api` over the dedicated internal listener for turn-time data hydration and retrieval orchestration (for example durable memory hydration through `POST /api/v1/internal/runtime/memory/hydrate-for-turn` and bounded knowledge context through `POST /api/v1/internal/runtime/knowledge/orchestrate`)
4. `apps/runtime` calls `apps/provider-gateway`
5. when a turn uses file/process tools, `apps/runtime` also calls `apps/sandbox`
6. result returns through `apps/api`
7. `apps/api` finalizes canonical message/media/quota state
8. media/STT/TTS billing-facts are persisted on the owning durable media/attachment rows; the unified model-cost ledger (ADR-099) now records provider-priced usage so all billable media and model costs are durably tracked

### Telegram

1. Telegram webhook hits `apps/api`
2. `apps/api` resolves assistant/runtime context
3. ordinary text and blocked media requests may still run request-time through `apps/runtime`, but accepted generated `image` / `audio` / `video` requests now enqueue durable `assistant_media_jobs` and return quickly from the webhook
4. the shared backend media-job worker later calls `apps/runtime` through `POST /api/v1/internal/runtime/media-jobs/run`
5. before final delivery, backend completion processing can call `POST /api/v1/internal/runtime/media-jobs/complete` with current canonical chat history to get optional fresh-history framing text
6. `apps/api` owns canonical persistence plus backend-owned async delivery back into Telegram

## Deploy topology

The active dev namespace `persai-dev` should contain only:

- `api`
- `web`
- `runtime`
- `provider-gateway`
- `sandbox`

Ingress truth:

- `persai.dev` -> `web`
- `api.persai.dev` -> `api`
- `bot.persai.dev` `/telegram-webhook` -> `api`

ADR-091 defines the active background-scheduler control-plane pattern for `apps/api`: each scheduler kind owns one durable row in `scheduler_leases`, and leadership is coordinated through short lease acquire / heartbeat / release writes instead of long-lived advisory-lock transactions. This keeps the scheduler shape uniform across idle re-engagement, background tasks, background compaction, and media jobs while avoiding pinned Prisma connections during outbound work.

### Database connection pool sizing

`apps/api` should set the Prisma datasource `connection_limit` explicitly through the `PRISMA_CONNECTION_LIMIT` environment variable.

Documented sizing rule:

`CONNECTIONS_PER_POD = max(10, cpu_count × 4)`

Rationale:

- ADR-091's lease-based scheduler pattern removes the old "hold one DB connection for the full scheduler tick" budget.
- The four background schedulers now consume only short-lived lease and per-candidate transactions.
- User-facing API traffic and read-heavy admin traffic remain the dominant pool consumers, so the pool should be sized for request concurrency rather than for pinned scheduler leaders.

## Runtime truth

Current active config expectations:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_SANDBOX_BASE_URL=http://sandbox:3013`

## Data / contract truth

- authoritative API contract: `packages/contracts/openapi.yaml`
- generated contract artifacts: `packages/contracts/src/generated/*`
- runtime bundle is the active materialized execution artifact
- `platform_site_pages` is the canonical persisted public trust-page model for `/terms`, `/privacy`, `/requisites`, and `/contacts`
- `assistant_files` is the canonical persisted assistant-workspace/file authority on the active path
- ADR-101 Slice 1 unlocks the root assistant cardinality for the next product foundation: one workspace member may own multiple `Assistant` rows, and `WorkspaceMember.activeAssistantId` stores the selected assistant pointer. Existing assistant-scoped runtime/chat/file state remains assistant-id-owned; active assistant resolution and web switcher migration are still later ADR-101 slices.
- ADR-100 Slices 2-5 add explicit web-chat mode truth on `assistant_chats.chat_mode` (`normal | smart | project`). `deep_mode_enabled` remains a compatibility boolean during migration: `smart` and `project` still dual-write `deepMode=true` for old clients, but runtime now branches on `RuntimeTurnRequest.chatMode` so `project` uses its own retrieval-aware execution profile while `smart` keeps the existing deep/premium path. Project chats also emit a project-only visible activity/reasoning feed through additive stream events; these are bounded runtime-authored summaries, not raw hidden chain-of-thought.
- ADR-100 Slice 6B keeps the retrieval architecture PersAI-native and additive: project-mode retrieval ordering is adjusted through a small internal gather-profile hint on the existing runtime-to-API orchestration seam, rather than through a second project retrieval service or a global rewrite of ordinary active-skill behavior.
- ADR-100 Slice 6C/6D/6E completes the core pre-deploy project-file correction without adding a parallel file/knowledge subsystem: the existing `working_files` developer section remains the cheap selector seam, canonical workspace-path truth now owns lazy cached deep extraction on first use, and project-mode orchestration stages project chat files as a real source before KB while still reusing the shared API-owned extraction stack.
- ADR-100 Slice 6F adds one more bounded pre-deploy file-intelligence seam without changing the public product model: API owns durable `assistant_upload_micro_description_jobs` plus a leased scheduler/worker that can generate a tiny background semantic summary for uploads when deterministic summary is absent. Ordinary non-project/B2C upload analysis is gated by admin runtime boolean `routerPolicy.analyzeUploadsOnB2cUpload` (default `false`), while project mode always enqueues once canonical workspace-path truth exists. The helper reuses the existing `systemTool` model slot, canonical file metadata persists semantic summaries/source tags with attachment-metadata mirroring when practical, and the durable job row now also stores replay-safe helper usage (`usageJson`, `usageOccurredAt`) before API appends a non-blocking internal cost-ledger `tool_helper` row keyed by immutable job id. This is still a cheap semantic-anchor path, not parse-every-upload behavior, and it does not change user quota accounting.
- runtime knowledge access now publishes the active bounded `hybrid` retrieval contract
- document source extraction is API-owned shared infrastructure: Knowledge indexing and visible document workflows both use the API `DocumentExtractionService` for local text/PDF/DOCX extraction, provider-backed OCR/parsing, provider trace, and quality metadata. Runtime receives pre-extracted transient `sourceFiles[]` only for presentation delivery or historical persisted worker jobs and must not duplicate Knowledge OCR/provider-selection logic.
- **ADR-132 collapsed the model-facing document surface to three verbs.** `document.inspect` returns a semantic structured view of a source (internally runs extract+OCR through the same API pipeline). `document.render` authors PDF/DOCX/XLSX from Markdown `content` or `contentPath`, always persisting the Markdown source as a visible sibling `.md` file (D5) so revisions edit the source and re-render; it does not create an active `project.json` workflow for authored output. `document.convert` performs pure format conversion between PDF/DOCX/XLSX. Auto-registration of persisted outputs runs server-side as best-effort metadata (D4): `document.render` / `document.convert` at an `outputPath` and `files.attach` of a doc-extension file (`pdf`/`docx`/`xlsx`) both look up the current document identity for that `(workspaceId, outputPath)` in `AssistantDocument.currentVersion.sourceJson.metadata.documentWorkspace.outputPath` and register `v+1` against the same `doc_id` when inspection/metadata is available. The removed legacy verbs `document.extract`, `document.edit`, and `document.register_version` are hard-rejected at the parser and no longer exist on the model-facing surface. Case A (author-then-revise) edits the sibling MD via `files.write(replace: true)` and re-renders at the same `outputPath`; Case B (complex XLSX with formulas/charts, targeted edits of uploaded documents, custom layouts, data-driven assembly) runs `shell + python` (openpyxl / python-docx / weasyprint) and finalizes with `files.attach(path)`. Delivery is attachment-first: metadata enrichment failure may omit `documentLink`, but it must not block current-turn delivery of an existing model-produced PDF/DOCX/XLSX file. General workspace scope/isolation guards (ADR-131) still apply. Presentation PPTX preparation continues through Gamma document jobs as before.
- ADR-094 extends the knowledge contract: `knowledge_search` may inline a single short/medium hit (`inlinedDocument` / `inlinedSection` / `documentSummary`); `knowledge_fetch` requires `mode` (`short|section|full`) with optional `radius`. Per-plan volume caps live in `billingHints.retrievalPolicy` (`smartSearchShortDocChars`, `smartSearchMediumDocChars`, `chatSectionDefaultRadius`, `fetchFullModeMaxChars`, `fetchFullModeMaxChatMessages`); admin-owned hard ceilings live in `PlatformRuntimeProviderSettings.adminKnowledgeRetrievalPolicy` (`smartSearchEnabled`, `smartSearchLongDocSummaryChars`, `fetchFullModeAbsoluteMaxChars`, `fetchFullModeAbsoluteMaxChatMessages`). The orchestrated server path applies the same length-based smart inlining for single ready-doc turns.
- Admin Runtime owns the structured provider/model catalog: each provider catalog row carries capabilities, `active` state, token quota weights, and one billing-mode-specific pricing shape that must match the row `billingMode` (`token_metered`, `time_metered`, `fixed_operation`, or `tiered_operation`). Historical rows are archived/inactivated in the same catalog instead of being hard-deleted, while `availableModelsByProvider` remains the derived active chat-model alias for downstream selectors. Plans own quota limits and model-role selections, not provider/model economic weights. Completed native turns still charge the user-facing Credits quota from provider/runtime `usageAccounting.entries` weighted by the catalog rows, with estimator-based accounting only as a marked fallback when runtime usage is missing. ADR-099 Session C now keeps that quota flow unchanged while widening the additive money ledger: ordinary completed web chat and Telegram chat turns with concrete runtime `usageAccounting.entries` append immutable `model_cost_ledger_events` rows for both ordinary main-reply model calls (`chat_main_reply`) and the existing router/classifier system-tool calls already surfaced in `usageAccounting.entries` (`router`), and successful background-task evaluator runs now append a single `background_task` row when the persisted `assistant_background_task_runs.usageJson` snapshot carries concrete provider/model/token facts. Those background-task rows use the persisted run-start timestamp on the durable run row as the pricing timestamp seam, so the same timestamp-matched catalog lookup remains replay-safe without keying cost off a later scheduler completion clock. These rows all preserve the archived pricing context on each event without changing quota semantics. Retrieval-helper/reranker usage is still intentionally excluded because current `knowledge_retrieval_events` persistence does not yet provide a clean replay-safe per-helper source seam. ADR-099 Session D adds the first minimal read-model rollout on top of that proof set: `Admin > Business` now shows last-7-day ledger-backed model cost totals plus purpose/surface splits, and `Admin > Ops` now shows current-quota-period ledger-backed model cost totals plus top provider/model rows for the selected workspace. Both surfaces are explicitly labeled as the current covered ledger set rather than full-platform economics. Media, STT, image, video, and other remaining non-ordinary-chat ledger coverage remains later ADR-099 work. Plans also own monthly media generation/editing unit allowances for `image_generate`, `image_edit`, and `video_generate`; the monthly counter truth is subscription-period scoped, delivery-confirmed, and separate from day-keyed safety counters. Runtime reserves monthly media units before expensive provider work; API delivery settles only successfully delivered artifacts and records provider-output/no-delivery cases as reconciliation-required rather than settled user quota. ADR-087 adds unified finite-limit advisories: 90%-crossing warnings are assistant-authored follow-up messages in the current active surface, free/zero-price plans may receive warnings but not paid light mode, and paid token-budget exhaustion degrades ordinary text turns into the safe `cost_driving_restricted` light-mode path until the current quota period resets rather than surfacing budget-driven slowdown/rate-limit UX as the primary product truth. The follow-up text is grounded from post-turn `quota_status` facts plus workspace-owned `quota_advisory` policy instruction, not from static surface copy. ADR-084 Slice 3 adds PersAI-owned `workspace_payment_intents` before any provider checkout/session call, so checkout starts from persisted PersAI intent truth rather than raw client state. ADR-083 lifecycle policy is PersAI-owned: trusted provider/admin payment inputs are first recorded as billing event snapshots, then they update `WorkspaceSubscription`, after which effective plan resolution, quota/materialization visibility, and lifecycle-derived notifications read the new PersAI state. Trial fallback is plan-owned through `lifecyclePolicy.trialFallbackPlanCode`, paid grace fallback is plan-owned through optional `lifecyclePolicy.paidFallbackPlanCode` with persisted global fallback as the fallback-of-last-resort, and grace duration is persisted in billing lifecycle settings. Effective subscription resolution materializes missing workspace subscriptions from the active default registration plan, assigns real trial/current-period windows for trial registrations, keeps paid access active during grace, and persists fallback/recovery before quota/materialization visibility reads the effective plan.
- Skill, Product KB, and platform/global Knowledge sources are platform/admin-managed shared KBs, not tenant workspace-owned rows. Assistant workspace remains consumer context for private assistant knowledge, assignment validation, memory/chat/files, quota, and retrieval telemetry.
- admin-authored Knowledge entries are Knowledge sources, not Files; ADR-080 defines their draft/review/apply lifecycle before ADR-079 indexing and runtime retrieval
- historical compatibility/migration traces do not define current request-time behavior

## Files truth

ADR-081 plus ADR-133 define the active Files target state. ADR-126/127/128 remain historical migration steps, not the active model-facing filesystem shape:

- file identity is the tuple `(workspaceId, path)` with model-visible paths rooted under `/workspace/assistants/<assistantId>/sessions/<sessionId>/...` by default
- assistants widen intentionally to `/workspace/assistants/<assistantId>/...`, and then to `/workspace/...`, by ordinary path choice only
- `workspace_file_metadata` is the authoritative persisted index for reusable workspace files, while chat attachments and `documentLink` are projections over that path truth
- chat `attachmentId`, runtime `artifactId`, object-storage keys, raw sandbox paths, knowledge source ids, and retrieval references are not primary model-facing file selectors
- product open/download links use the canonical workspace-path file routes; the old attachment download route is not active target-state UI/API truth
- media storage and sandbox storage are implementation details behind one user Files model
- Knowledge remains a separate product plane and is not merged into Files

## Prompt architecture (ADR-119)

The runtime composes assistant prompts as three zones:

1. **AOT cached system prefix** (BP1 + BP2 + BP3): identity, persona (`<voice>` + `<character_notes>`), the ADR-147 `<assistant_role><mission>…</mission></assistant_role>` block immediately after assistant identity and before `<enabled_skills>`, protocol declarations (`<reminders_protocol>`, `<memory_protocol>`), `<response_contract>`, `<tool_usage_policy>` (with `<priority_order>` enumerating Skills #1), and the `<enabled_skills>` catalog. Stable across turns; provider clients mark with `cache_control: ephemeral` (Anthropic) or exact-prefix caching (OpenAI). Three system-prefix breakpoints: BP1 (identity/voice/character_notes), BP2 (protocols/response_contract/tool_policy), BP3 (enabled_skills catalog). A fourth breakpoint is reserved for rolling-window conversation history.
2. **JIT volatile context**: active scenario (`<persai_active_scenario>`), `<system-reminder>` blocks, sense-of-time (`<persai_environment>`). Marked `cacheRole: volatile_context`; provider clients reposition outside the cached prefix so per-turn rotation does not invalidate stable breakpoints. ADR-120 Slice 1 retired the always-on pushed memory block (`<persai_memory>`); durable identity/core memory stays in the AOT prefix, and cross-chat recall + retrieved knowledge are obtained on demand via the `knowledge_search` / `knowledge_fetch` tool channel rather than pushed into this zone.
3. **Conversation tail**: chat history + current user message. Anthropic: 4th `cache_control` breakpoint moves with the rolling window. OpenAI: implicit exact-prefix caching applies to the stable head.

Persona-layer precedence (ADR-130 D6): the `<voice>` block is the structural envelope and carries the system-owned `<precedence>` clause; `<character_notes>` stays verbatim and adds user-authored personality inside those mechanics, but never overrides system safety, honest result/tool-usage contracts, or hard product invariants; default archetype text yields to both. ADR-130 is now closed locally: `<enabled_skills>` is compact with lazy `skill.describe`/`skill.list`, the stable prefix owns `memory_protocol` / `response_contract` explicitly, `<persai_active_scenario>` renders only the current step, cross-tool routing lives only in `<tool_usage_policy>`, and the admin Prompt Constructor now mirrors the backend-compiled assembly instead of carrying its own stale block registry.

**ADR-135 catalog tool projection (closed locally):** plan-visible tools project as either **full** (complete description + schema every turn) or **catalog** (short `modelDescription` + load hint; full contract via `{toolCode}({ action: "describe" })` on the same tool). Platform defaults seed **13 full / 11 catalog**; admin plan editor exposes one **Full JSON on wire** checkbox per tool (`fullProjection`). After a successful describe in a turn, the next tool-loop iteration expands that tool to full wire in `tools[]`; real execution without prior describe returns structured `tool_contract_not_loaded`. Runtime logs per turn: `tools_json_char_count`, `catalog_describe_calls`, `tool_contract_not_loaded`. Media-job worker paths keep full persisted request shapes (projection-only savings).

Provider-level tool-call discipline: when `skillsEnabled === true` and tools are present, the Anthropic client sets `tool_choice: { type: "auto", disable_parallel_tool_use: true }` and the OpenAI client sets `parallel_tool_calls: false`. This is the only reliable mitigation against the model firing `skill({engage})` in parallel with a media tool in the same response.

See `docs/ADR/119-prompt-architecture-and-2026-context-engineering.md` (Closed) for the full spec and `docs/ADR/119-prompt-inventory.md` for the read-only slice reachability ledger.

## Historical material

Historical OpenClaw references may still exist in:

- `docs/ADR/*`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- old migrations

Those traces are not part of the active architecture unless a current code/config/deploy path still depends on them.
