# ADR-146: Assistant-owned full-public sandbox egress

## Status

Accepted — founder-directed production orchestration program opened 2026-07-12.
Slice 0 read-only code/live-cluster audit completed 2026-07-12 with implementation
**NO-GO**. **Slices 0.1 + 0.1b are live-accepted** (2026-07-13). **Slice 1 is
committed locally at `775e5781`**. **Slice 2 is committed locally at
`5a2fd3bd`**. **Slice 3 is committed locally at `8d0520f4` on baseline `5a2fd3bd`**:
last-responsible-moment DB mode authority, pod label/annotation enforcement,
mismatch recycle, owner sync eviction with honest `recycled` + `503`, and
mandatory post-persistence exec-pod retirement before workspace lease release.
**Slice 4 is committed locally at `3f498ef9` on baseline `8d0520f4`**: Assistant
Settings consent UX. **Slice 5 is committed locally at `d23936d1` on baseline
`3f498ef9` (unpushed/undeployed)**: cross-layer audit, D9 observability, legacy active-code audit,
cross-layer contract tests, deploy/rollback runbook. This ADR is **not** closed.
Deploy/live validation of S1–S5 is deferred.

Live foundation + deferred-pin acceptance (2026-07-13): prepare, exact
NAT/firewall, Calico (`calico-node` 5/5), private `sandbox-pool-private` Ready
with exact contour, idempotent legacy cordon, and maintenance-gated public-pool
retirement completed earlier. Coordinated push **`3cd2ea4f`** and Squid
logformat + checksum repair **`04b1d0d1`**, proxy-env repair **`dc2fa914`**, and
Squid CONNECT denial probe repair **`8a0043dd`** remain the enforcement path.
**Final live restricted foundation gate PASS** at proof pin **`e5c249c3`**
(sandbox image `8a0043dd`) with evidence inventory SHA-256
`c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`: structural
RESULT **PASS**; all trusted positive controls **PASS**; NAT identity reserved
IP `34.76.34.111` **PASS**; DNS **PASS**; Squid allowlisted HTTPS **PASS**;
Squid CONNECT denial for non-allowlisted `example.com` **PASS**; direct-public
bypass denial **PASS**; Kubernetes API, metrics-server, Redis, Filestore, Cloud
SQL, kube-dns Pod UDP/TCP, same-namespace sandbox control-plane Pod, every node
kubelet, and metadata `169.254.169.254` denial **PASS**. Controlled-probe
cleanup **PASS** (no controlled Pods remaining). Inbound denial, HTTP redirect,
and DNS-rebind remain **explicitly unclaimed** RUNBOOK checks.

Current remote/deployed bot pin **`64be77d6`**: `api`/`web`/`runtime`/
`provider-gateway` exact **`3cd2ea4f`** (2/2 Ready each); sandbox remains
**`8a0043dd`** (2/2); Argo Synced. Deferred-pin resume workflow run
**`29237479924`**: both `validate-resume` and Environment-gated pin **success**;
protected Environment **approved** by required reviewer. Historical first resume
attempt failed after validate/GAR/pin on pin-assert EOF mismatch (extra CLI
`` `${join}\n` `` vs `applyPinDevImageTags`); EOF CLI/lib repair landed on
`main`; the successful second run is current. Post-rollout public
`https://persai.dev/api/health` 200 `{status:ok}`,
`https://persai.dev/api/ready` 200 `{status:ready}`, PersAI MCP chat smoke exact
`ADR146_POST_ROLLOUT_OK`. **S1 committed locally at `775e5781`**. **S2 committed
locally at `5a2fd3bd`**. **S3 is committed locally at `8d0520f4`**. **S4 is
committed locally at `3f498ef9`**. **S5 is committed locally at `d23936d1` on
baseline `3f498ef9` (unpushed/undeployed)**. **Slice 6 parent-only final gate
started** (2026-07-13): local final gates PASS; predeploy default structural
`verify` **RESULT PASS** at `40d7a927`/inventory
`c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7` after
`chat_smoke` shell `pwd` exact `ADR146_S6_PREDEPLOY_EXEC_OK`; no
push/deploy/chart sync/migration/live S2 acceptance yet. Do not claim S6
complete or close this ADR.

## Date

2026-07-12

## Baseline SHA

Program-open baseline: `a0c3e997f40baeb05d62bbd80ac89abfafc4fed7`.

Slice 0 audit baseline: `e137d7d46d07475d2e74d66704ef483dc6b103c0`.

Slice 0.1 repo-local land: `edef3c0bc2d839ac8ddac1c5b60fd39440d5e947`
(`edef3c0b` after rebase onto `origin/main`).

Slice 0.1b release-gate baseline: clean `main` at `d847cb61ac0c393fd3f0e58de4c56e507045bd69`
(implementation lands locally on top of this SHA; not pushed).

Slice 5 committed land: `d23936d19ec24e5ce3a8e0a78f409220c1dd44d8` on baseline
`3f498ef9` (unpushed/undeployed).

Live foundation checkpoint baseline (local, unpushed): `1300970f9452694418513336a01f9eba68219c44`
(`1300970f`). Resume/retire/verify + Environment-existence docs are committed on
the clean local pre-push branch through
`ebbc5fe41f2fe51d5db0711ac6f341fc5ef4664c` (`ebbc5fe4`). Coordinated push live
at `3cd2ea4fa0c82d319c2e8e63724c5753f03b5e0f` (`3cd2ea4f`). Squid logformat +
checksum repair live at `04b1d0d190d19ebda5787694cbd257270647a61e`
(`04b1d0d1`; proxy Ready). Live-verifier Kubernetes normalization repair live
at `bf8eeef1bfc0db3ca5f7ebe58b34543da8aba247` (`bf8eeef1`; structural `verify`
PASS including a real production exec Pod). Controlled-probe toleration
`operator: Equal` casing repair live at
`42a4f42549d71f52e6d6a838b30fadea95790e54` (`42a4f425`; sandbox bot pin
`87907361ceabc226c2a06c756c5b5b7a62e06da9` / `87907361`). Live collector
tolerations preservation repair pushed/live at `97042c45` with bot pin
`fe3e1f59`. Live admitted toleration normalization repair **pushed/live at
`838789c4` with bot pin `c5716b97`**. Executable/TLS image repair
**pushed/live at `5045431e` with bot pin `71eb9c0c`**. Restricted-probe
proxy-env repair **pushed/live at `dc2fa914`** (bot pin path through
`188722f9`). Squid CONNECT denial probe repair **pushed/live at `8a0043dd`**
with proof pin **`e5c249c3`** (sandbox image `8a0043dd`). Final live restricted
foundation gate **PASS** at that proof pin; evidence inventory SHA-256
`c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`. Current
remote/deployed bot pin **`64be77d6`**: deferred services exact `3cd2ea4f`;
sandbox remains `8a0043dd`. Environment `persai-dev-adr146-foundation`
**approved**; resume run `29237479924` success; S0.1/0.1b live-accepted; ADR
open; **S1 committed locally at `775e5781`**; **S2 committed locally at
`5a2fd3bd`**; **S3 committed locally at `8d0520f4`**; **S4 committed locally at
`3f498ef9`**; **S5 committed locally at `d23936d1` on baseline `3f498ef9`
(unpushed/undeployed)**; **S6 started** (local gates PASS; predeploy default
structural verify PASS at `40d7a927`; push/deploy/live acceptance pending).

## Slice 3 local land (2026-07-13)

Baseline: clean `main` at `5a2fd3bde507ab67bbbfa8de857997103529869b` (S1 at
`775e5781`, S2 at `5a2fd3bd`; ahead of remote; no push).

Landed locally (uncommitted; no commit/push/deploy/cloud mutation):

- sandbox control plane resolves `Assistant.sandboxEgressMode` from Prisma
  immediately before every warm/create/reuse/execute decision; DB failure or
  missing/invalid mode fails closed with no runtime/model/job field authority;
- every new exec pod stamps exact label **and** annotation
  `persai.io/sandbox-egress=restricted|full-public` (`full_public` →
  `full-public` only at the K8s boundary); proxy env (exact six-entry contour)
  injects only for `restricted`;
- missing/malformed/mismatched mode on warm lookup, reuse, or create-conflict
  UID-deletes the observed pod generation, waits until that UID is gone, and
  recreates exact mode; an immediate pre-exec race fails closed and the
  job-finalizer retires only its previously bound UID;
- cross-replica create `409` re-validates cluster pod mode against DB and
  recycles wrong-mode pods rather than trusting process memory;
- internal
  `POST /api/v1/control/assistants/:assistantId/sandbox-egress/reconcile`
  (Bearer `PERSAI_INTERNAL_API_TOKEN`) with body
  `{ mode, scope: "all"|"stale_only" }` and response
  `{ recycled, deletedPodCount }`;
- owner PUT commits DB+audit first, then requests reconcile (`all` on mode
  change, `stale_only` on same-mode), but both scopes delete only idle
  missing/malformed/mismatched-mode generations; busy `queued|running` returns `409`
  before mutation/eviction; reconcile failure after commit returns stable
  `503 sandbox_egress_recycle_failed` with honest no-fake-rollback semantics;
  `recycled` is true only when pods were deleted and confirmed absent;
- only after workspace lease acquisition, model-job admission stamps
  `persai.io/sandbox-job-id` + `persai.io/sandbox-lease-token`, reads back
  immutable `metadata.uid`/`resourceVersion`, and binds the exact tuple
  `(namespace,name,uid,leaseToken,jobId)` plus assistant/workspace/handle/mode;
  every hydrate/exec gate revalidates caller-captured identity, current DB mode,
  and the exact live DB lease token/holder/job/expiry immediately before opening
  the exec WebSocket;
- after workspace/output/artifact and terminal job-state persistence, every
  bound model-authored job re-reads its validated pod's fresh `resourceVersion`,
  retires with both UID+resourceVersion preconditions, and waits for `404` or a
  different UID before releasing the workspace lease.
  Same-name replacements survive. Running/terminal writes are conditional on
  nonterminal job state plus the exact active DB lease, so a lost worker cannot
  overwrite stale-recovery truth. Delete/wait or terminal persistence failure
  withholds lease release; there is no DB pod-name quarantine;
- stale lease annotations are durable cluster contamination. The next acquired
  lease marks an annotated queued/running prior job failed when identity matches,
  then UID-retires before any work. It does not overwrite an existing terminal
  result. Best-effort workspace pull is intentionally not attempted during crash
  recovery because it cannot be made non-corrupting against unknown partial
  output; unpersisted crashed-job output may therefore be lost;
- the reaper protects arbitrarily long jobs only when the annotated job and
  exact token are backed by the same non-expired DB lease. Missing/expired/
  mismatched lease marks the stale nonterminal job conditionally failed and
  retires that UID. Reaper and owner reconcile use snapshot
  `uid+resourceVersion` delete preconditions; owner reconcile rechecks active
  lease/job state and never evicts a newly admitted correct-mode operation;
- observability counters/logs for create/recycle/jobs by mode without
  URL/query/auth/file contents;
- OpenAPI PUT adds `503`; `recycled` description updated. Generated TypeScript
  is unchanged because neither change alters a generated response model;
  focused api/sandbox suites cover the Slice 3 matrix.

Out of scope: a user cancellation writer/endpoint (none exists in the current
system), S4 Settings UX, Helm policy redesign, deploy/live acceptance, and ADR
closure. Timeout closes the exec WebSocket best-effort; UID pod retirement is
authoritative.

## Slice 2 local land (2026-07-13)

Baseline: clean `main` at `775e5781c0bed5d43266a2494e373d8960b78e14` (S1
committed locally; ahead of remote; no push).

Committed locally at `5a2fd3bde507ab67bbbfa8de857997103529869b` (no push):

- additive `sandbox-exec-full-public-egress` NetworkPolicy selecting only
  `app.kubernetes.io/component=sandbox-exec` +
  `persai.io/sandbox-egress=full-public` (exact matchLabels); empty ingress;
  DNS via exact audited `/32` ipBlocks; direct public TCP/UDP with shared
  `publicDeniedCidrs` except inventory — no pod/namespace peers and no
  control-plane pod selection;
- preserved `sandbox-exec-isolation` restricted default contour on
  `component=sandbox-exec` (live unlabeled pods keep DNS + Squid-only egress
  until S3 stamps mode labels);
- shared restricted-proxy / NAT-probe / full-public deny inventory + fail-closed
  template validation; exact `peerMode: ipBlockOnly` DNS contract and explicit
  IPv4-only `sandboxEgress.ipFamily: IPv4` contract (missing/IPv6/dual-stack
  fail rendering);
- dedicated identity-less `sandbox-exec-sa` (no WI email, no annotations, label
  `persai.io/sandbox-exec-identity=none`);
- production chart assertion: `sandbox.enabled` requires
  `networkPolicy.enabled=true`;
- Helm/pod-spec egress-mode contract ConfigMap + helpers
  (`persai.sandboxExec.proxyEnvForMode`) with fail-closed
  `defaultMode=restricted` and proxy env only for restricted — ExecPodBridge
  unwired (S3 owns runtime selection);
- Cloud NAT / VPC-firewall deploy-truth extended via shared deny inventory bind
  and rendered full-public matcher in `runStaticDeployTruth` / foundation live
  structural check. Historical default `verify` permits policy absence before
  deploy but rejects malformed-present; S5/S6 must run
  `node infra/bootstrap/adr146-sandbox-egress-foundation.mjs verify --require-s2-policy`
  to require presence plus exact structure;
- Helm defaults/dev values +
  `infra/helm/scripts/sandbox-egress-network-policy.test.mjs` for both modes.

Out of scope for this land: S4 Settings UX; deploy/live full-public acceptance;
ADR closure. No second Squid, no Dataplane V2, no compatibility alias.
(S3 mode authority / recycle / descendant cleanup landed separately on
baseline `5a2fd3bd`.)

## Slice 1 local land (2026-07-13)

Baseline: clean `main` at `6fe4356a4c1c71a17678d4dca47eaba239b89a74`.

Committed locally at `775e5781c0bed5d43266a2494e373d8960b78e14` (no push):

- Prisma enum `AssistantSandboxEgressMode` (`restricted | full_public`) and
  required `Assistant.sandboxEgressMode` / `assistants.sandbox_egress_mode`
  NOT NULL DEFAULT `restricted`;
- migration `20260713120000_adr146_s1_assistant_sandbox_egress_mode` with
  one-way default/backfill and plan JSON cleanup deleting
  `billing_provider_hints.sandboxPolicy.networkAccessEnabled` with no alias;
- owner-only `GET/PUT /api/v1/assistant/{assistantId}/sandbox-egress` with exact
  body `{ "mode": "restricted" | "full_public" }`;
- stable `400` for unknown/extra body; stable `409 sandbox_egress_change_busy`
  while any `SandboxJob` for the assistant is `queued|running` (assistant-only
  fail-closed query; denormalized `workspaceId` cannot narrow it);
- changed-mode PUT uses one Prisma interactive transaction, locks the
  tenant-constrained Assistant row (`id + owner + workspace`) `FOR UPDATE`,
  re-reads canonical mode, checks busy jobs, updates mode, and inserts the
  audit row atomically. The real `sandbox_jobs.assistant_id -> assistants.id`
  FK makes enqueue participate: PostgreSQL FK validation takes a parent
  `KEY SHARE` row lock, which conflicts with `FOR UPDATE`, so an earlier enqueue
  commits and is visible to the busy check or a later enqueue waits and admits
  after the completed mode mutation;
- idempotent same-mode PUT returns state without duplicate audit; changed mode
  writes `AssistantAuditEvent` with previous/selected mode and actor;
- response honestly reports `recycled: false` until Slice 3 eviction;
- complete removal of plan/runtime `networkAccessEnabled` from
  `runtime-contract`, OpenAPI `AdminPlanSandboxPolicy`, parsers/materializers,
  Admin Plans UI, ops display, fixtures/tests; no compatibility alias.

Out of scope for this land: S2 Helm/NetworkPolicy, S3 ExecPodBridge recycle,
S4 Settings UX, deploy/live validation, ADR closure.

## Orchestration model

This ADR is implemented only as a parent-orchestrated program.

- The parent agent owns the ADR, dispatches one bounded slice at a time, reviews
  every diff, reconciles docs, runs the final repository/infra gate, and alone
  decides whether the program may close.
- Read-only and implementation subagents use Cursor Grok 4.5. A subagent may not
  broaden scope, add a fallback, commit, push, deploy, or mark the ADR complete.
- Every slice starts from a clean tree and the current `main` baseline. The
  parent records each landed SHA and updates this ADR, `SESSION-HANDOFF`, and
  `CHANGELOG`.
- No implementation push occurs merely because a slice is locally green.
  Deploy/push remains an explicit founder action.

## Founder directive

The sandbox has two honest assistant-level network choices:

1. `restricted` — the default for every existing and new assistant. Execution
   traffic remains behind PersAI's domain-allowlist proxy.
2. `full_public` — the assistant owner explicitly permits that assistant's
   sandbox to connect directly, without the allowlist proxy, to arbitrary
   **publicly routable** internet destinations.

This is a clean production target:

- no legacy network flag;
- no transitional dual read/write;
- no feature flag;
- no per-chat permission;
- no “full internet” route that can reach PersAI/Kubernetes/VPC/metadata/private
  destinations;
- no change to browser, `web_search`, `web_fetch`, Knowledge, or storage-plane
  tools.

The user control belongs in `Assistant Settings -> Assistant`, because the
sandbox execution identity and warm pod are assistant-owned. The choice is
operational and immediate; it is not a draft persona field and does not wait for
publish/apply.

## Relationship to prior ADRs

- **ADR-123 remains closed.** ADR-146 supersedes only D3's statement that every
  execution pod always uses deny-all + allowlist-proxy egress. ADR-123 D1/D2/D4
  remain binding: gVisor, hardened non-root execution, zero execution-unit
  secrets, bounded resources, warm assistant/workspace pods, and persisted
  session workspace.
- **ADR-126 remains closed.** Its restricted proxy allowlist, HTTPS Git posture,
  package-manager ergonomics, and no-PersAI-credentials invariant remain the
  `restricted` mode. ADR-146 does not reopen filesystem or Git-product scope.
- **ADR-133 remains binding.** Session-first paths and assistant/workspace widen
  semantics are unchanged.
- **ADR-137 remains binding.** Network choice applies only to the execution pod
  used by `shell`, `exec`, and `document.*`. `files.*`, model `grep`/`glob`, and
  provider worker bytes remain storage-plane operations and do not gain network
  behavior.
- Browser ADRs are orthogonal. Local browser profiles and headless public reads
  do not consult this setting.

## Current-state finding

Slice 0 proved that the deployed cluster does **not** currently enforce the
NetworkPolicy resources rendered by Helm:

- `personal-ai-gke` is Standard GKE on `LEGACY_DATAPATH`;
- the Calico NetworkPolicy addon is disabled;
- the Cilium plugin is disabled;
- `sandbox-exec-deny-egress` and the other NetworkPolicy objects exist in
  `persai-dev`, but they are API objects without an enforcing dataplane;
- every exec pod receives `HTTP_PROXY` / `HTTPS_PROXY` from
  `ExecPodBridgeService.buildProxyEnv`, and Squid enforces its domain allowlist
  only for clients that honor those variables;
- direct bypass is therefore not currently proven blocked at L3/L4;
- exec pods disable service-account token automount but use the namespace
  default ServiceAccount; the sandbox node ServiceAccount has broad project
  roles, including Editor;
- sandbox nodes have external IPs, there is no Cloud NAT, no subnet flow logs,
  and no VPC egress deny policy.

The existing `restricted` product behavior is thus proxy convention + Squid,
not the kernel-enforced deny-all boundary previously documented by ADR-123.
ADR-146 must repair this baseline before adding `full_public`.

`RuntimeSandboxPolicy.networkAccessEnabled` is not this enforcement boundary.
It is a plan JSON/OpenAPI/admin field, defaults false, is copied into sandbox job
snapshots, and does not select a different pod NetworkPolicy or proxy path. It
therefore cannot remain as a second ambiguous network truth.

The read-only audit also found production gaps that ADR-146 must close
rather than copy into the new mode:

- the live cluster has no NetworkPolicy enforcement engine;
- exec pods have an egress policy but no explicit empty-ingress policy;
- exec pods disable token automount but do not name a dedicated no-IAM/no-Workload
  Identity ServiceAccount;
- the proxy's public egress exclusions cover RFC1918 only, not the complete
  link-local/metadata/non-global set;
- the live Service CIDR is non-RFC1918 `34.118.224.0/20` and is absent from the
  current exclusions;
- the node primary range is `10.132.0.0/20`, Pod range is
  `10.107.128.0/17`, and PSA/Redis/Filestore peers must remain denied;
- direct public egress currently uses node one-to-one external NAT without the
  Cloud NAT/flow-log contour required by D4/D9;
- base Helm values permit `networkPolicy.enabled: false`, which is invalid for
  any production sandbox deployment.

### Slice 0 verdict

- **Code ledger (historical Slice 0 finding):** GO for the then-future S1
  data/API cutover in isolation; S1 was implemented from `6fe4356a` and later
  committed locally at `775e5781`;
  `networkAccessEnabled` is confirmed vestigial, sandbox already has Prisma
  access to Assistant, and exact warm/create/reuse/delete seams are known.
- **Program gate:** NO-GO for S1/S2 implementation as a deployable program. D10
  forbids landing partial product contracts before the enforcement foundation.
- **Additional required repair:** current command timeout/return paths do not
  kill the full descendant process tree, so background children can survive in
  a warm pod. S3 must close this before either mode is production-safe.

No implementation subagent may start until the founder chooses and approves the
network-enforcement prerequisite below.

## Decision

### D0 — Harden the current Standard cluster before product implementation

Founder decision 2026-07-12: harden the current Standard cluster as the bounded
ADR-146 foundation. Enable GKE NetworkPolicy (Calico) on the current
`LEGACY_DATAPATH`, prove the exact live `ipBlock` behavior, isolate sandbox
egress with explicit environment CIDRs plus VPC/L3 firewall defense, move
sandbox execution to a private/dedicated egress contour, and add Cloud NAT/flow
logging.

A new Dataplane V2 cluster cutover is not part of ADR-146. It would be a
separate platform migration ADR if later prioritized.

Dataplane V2 cannot be assumed from Helm and must not be simulated by comments
or tests. Calico must not be treated as equivalent until its live negative
matrix passes. A second allow-all Squid is not an allowed workaround.

This current-cluster contour is Slice 0.1 and lands before S1; no app/API/UI
implementation lands first.

### D1 — One canonical assistant-level mode

Add a required Prisma enum and column:

```text
AssistantSandboxEgressMode = restricted | full_public
assistants.sandbox_egress_mode NOT NULL DEFAULT restricted
```

Rules:

- existing assistants are backfilled to `restricted`;
- new assistants start `restricted`;
- the field lives directly on `Assistant`, not `AssistantGovernance`, draft,
  published version, materialized persona snapshot, plan JSON, chat, or runtime
  session;
- only the assistant owner may change it;
- there is no nullable/inherit/legacy value and no “enabled” boolean;
- no plan owns a second network switch. Existing plan sandbox/tool activation
  and resource quotas still decide whether sandbox execution is available, but
  they do not reinterpret the owner's network choice.

This is a founder lock, not an unresolved plan decision: every owner whose
effective plan enables sandbox execution may choose either assistant mode. ADR-146
does not add an `egressModeCeiling`, tariff feature, or admin bypass.

`restricted | full_public` is an enum because the values name two concrete
security postures. A boolean such as `networkAccessEnabled` cannot distinguish
allowlisted access from direct public access and is rejected.

### D2 — Scope is the whole untrusted execution pod

The selected mode applies to every process in that assistant's execution pod:

- `shell`;
- `exec`;
- `document.inspect`;
- `document.render`;
- `document.convert`;
- internal sandbox document-code/render commands that execute in the same pod.

The UI must not claim this is shell-only. Kubernetes network policy is pod-level,
and all model-authored code inside that pod shares the same boundary.

The mode does not apply to:

- `files.*`, model-facing `grep`, or `glob`;
- API uploads, GCS/manifest operations, media workers, or provider gateway;
- `browser`, `web_search`, `web_fetch`, or Knowledge tools;
- PersAI control-plane pods.

### D3 — `restricted` remains proxy-only

`restricted` is the default and preserves the current product capability:

- kernel/network-policy egress isolation;
- DNS only to the specifically selected cluster DNS pods on TCP/UDP 53;
- HTTP(S) only through the trusted `sandbox-egress-proxy` Service;
- proxy domain allowlist for approved Git/package destinations;
- both upper- and lower-case proxy environment variables in the execution pod;
- unsetting proxy variables cannot bypass the policy;
- no direct public-IP route.

The current broad `namespaceSelector: kube-system` DNS rule is tightened to the
actual DNS workload labels. A restricted pod must not reach an arbitrary
`kube-system` pod merely because it listens on port 53.

Both modes receive an explicit empty-ingress NetworkPolicy. The sandbox is
outbound-only; enabling public egress does not create an inbound listener.

The restricted proxy's own public egress policy is hardened with the same
non-global/private/metadata exclusions required for `full_public`. This closes a
current defense-in-depth gap without changing its domain allowlist behavior.

### D4 — `full_public` means direct public TCP/UDP, not unrestricted networking

A full-public pod:

- has label `persai.io/sandbox-egress=full-public`;
- receives no `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, or `https_proxy`;
- is selected by an additive NetworkPolicy that permits direct outbound TCP and
  UDP to globally routable destinations;
- retains the base DNS rule;
- may use public HTTP(S), SSH, Git, package registries, APIs, and public custom
  ports without a PersAI domain allowlist.

The public product term “full internet” means full **public** internet. It never
means access to the cluster, VPC, node, control plane, metadata service, local
machine, or private address space.

The Helm policy owns an explicit reviewed `deniedCidrs` set covering, at
minimum:

- IPv4 loopback, link-local, RFC1918, carrier-grade NAT, benchmark, multicast,
  reserved/non-routable, and documentation ranges;
- `169.254.0.0/16`, including GKE/Compute metadata endpoints;
- the real cluster node, Pod, Service, control-plane, and peered-VPC ranges even
  if a future environment allocates them outside the common RFC1918 blocks;
- the current chart is explicitly IPv4-only (`sandboxEgress.ipFamily: IPv4`);
  IPv6 and dual-stack fail rendering until a future audited inventory covers
  IPv6 loopback, link-local, unique-local, multicast, documentation, metadata,
  and environment cluster/internal ranges.

The chart must fail rendering or deploy-truth validation when full-public mode
is enabled without the environment-specific internal CIDR inventory. An empty
or guessed deny set is not valid production configuration.

Defense is layered:

1. Kubernetes NetworkPolicy selects only labelled full-public exec pods.
2. GKE Dataplane V2's `ipBlock` behavior excludes Pod traffic from broad
   external CIDRs; cluster Pod access is never added with a pod/namespace
   selector.
3. Explicit CIDR exclusions cover non-Pod internal, Service, node, VPC,
   control-plane, and metadata destinations.
4. The exec pod names a dedicated ServiceAccount with no Workload Identity
   annotation or IAM role and keeps `automountServiceAccountToken: false`.
5. The sandbox node pool uses direct VPC-native egress through the environment's
   Public Cloud NAT/firewall contour; Cloud NAT is an L3 source-NAT service, not
   an HTTP proxy. Its static source identity, metrics, and flow logs provide
   operator attribution without inspecting TLS.
6. gVisor and the secret-free environment remain mandatory.

The implementation must verify the real GKE dataplane and VPC firewall behavior
for Pod-to-node traffic in Slice 0. If NetworkPolicy plus the dedicated
ServiceAccount cannot prove denial of node/metadata/internal targets on the
actual cluster, implementation stops and adds an L3/L4 VPC firewall or egress
gateway boundary. It must not silently fall back to a second allow-all HTTP
proxy, because the founder explicitly requested direct/unproxied public egress.

Redirects and DNS rebinding do not receive a special application exception:
after name resolution, the destination IP still has to pass the L3/L4 policy.
A redirect or DNS answer pointing at a denied range must fail.

Kubernetes NetworkPolicy is not an HTTP policy, DLP product, anti-malware
scanner, or per-domain audit system. The product warning must say that
assistant-visible/user-provided files and values can be transmitted to public
destinations once permission is enabled.

### D5 — Pod mode is cluster-enforced and stale pods cannot be reused

Every warm execution pod carries:

```text
label:      persai.io/sandbox-egress = restricted | full-public
annotation: persai.io/sandbox-egress = restricted | full-public
```

The sandbox control plane resolves the current `Assistant.sandboxEgressMode`
from canonical database truth immediately before warm/create/reuse. It does not
trust a stale runtime bundle or model-supplied job field.

After acquiring the workspace lease and before hydrate or model execution, the
control plane stamps `persai.io/sandbox-job-id` and
`persai.io/sandbox-lease-token`, reads back immutable `metadata.uid`, and binds
the exact generation tuple `(namespace,name,uid,leaseToken,jobId)`. Every
immediate pre-exec check re-resolves current DB mode and validates that tuple
plus assistant/workspace/handle/mode. Bind and every model pre-exec gate also
query `AssistantWorkspaceLease` and require exact assistant/workspace, token,
holder, job, and `expiresAt > now`; pod annotations alone are never lease
authority. Lease-free file/hydrate/GC paths carry the caller-captured
`(namespace,name,uid,assistantId,workspaceId,handle,mode)` into the final guard,
never identity learned from a replacement pod. Caller metadata cannot override
these canonical fields.

A stale/foreign token is never reused. Under a current acquired lease, admission
marks an identity-matching nonterminal prior job failed without replacing an
already persisted terminal result, UID-deletes the contaminated generation with
`DeleteOptions.preconditions.uid`, waits for `404` or a different UID, and only
then creates/binds a clean generation. Lease-free warm work neither deletes nor
executes through a contaminated pod.

Failure to resolve, label, delete, or recreate is fail-closed: the job does not
run. There is no “temporarily use restricted/full” fallback and no unlabeled
exec pod.

After durable workspace/output/artifact persistence and terminal DB write, the
bound UID is retired before lease release. A same-name replacement UID survives.
Running and terminal job writes atomically require the expected nonterminal
status and the exact active DB lease relation; count zero means stale/lost
ownership and cannot clobber recovery payload/audit truth. Retirement or
terminal persistence failure withholds release. There is no
DB name-based quarantine and no process-marker/process-group proof; durable pod
annotations carry crash contamination until a later admission safely recycles
that UID. Pod namespace destruction proves no model-started descendant survives.

### D6 — Setting changes are immediate operational changes

Add owner-authenticated boundaries:

```text
GET /api/v1/assistant/{assistantId}/sandbox-egress
PUT /api/v1/assistant/{assistantId}/sandbox-egress
body: { "mode": "restricted" | "full_public" }
```

The response returns canonical mode and whether an existing warm pod was
recycled. It does not return a “pending legacy mode”.

Mutation behavior:

- validate that the caller owns the assistant in its workspace;
- reject with `409 sandbox_egress_change_busy` while that assistant has a queued
  or running sandbox job; never kill a live user operation silently;
- persist the new mode and an `AssistantAuditEvent` with old/new mode and actor;
- synchronously reconcile all warm **idle stale** generations for the assistant:
  delete only missing/malformed/mismatched-mode pods, skip an exact active
  lease/job generation, and never delete a newly admitted correct-mode pod;
- capture `uid+resourceVersion`, re-read active lease/job immediately before
  delete, and send both delete preconditions. A `409` snapshot conflict is a
  safe skip/re-evaluation and is never counted as recycled;
- report success only after every actually deleted stale UID is absent;
- if reconciliation fails, return a stable `503` and keep future execution
  fail-closed on the database/pod mode mismatch. A retry/reconciler may complete
  eviction, but there is no user-visible dual-mode runtime.

Publish/apply is not involved. The next sandbox operation reads the current
database value and creates the correct pod.

Idempotent PUT of the already-selected mode returns the current state and still
reconciles a stale/mislabelled warm pod.

### D7 — Assistant Settings UX and consent

The control is placed in the existing `Assistant` settings block under a compact
“Sandbox network” permission row.

UI:

- unchecked = `restricted`;
- checked = `full_public`;
- enabling requires an explicit confirmation modal;
- disabling is immediate;
- while a turn/sandbox job is active, the control is disabled or an attempted
  save renders the stable busy response without optimistic success;
- on success, the settings state is reloaded from the server;
- the control is not shown as a browser/web-search permission.

Required honest enable copy:

> Full public internet lets code in this assistant's sandbox connect directly
> to any public address and send files or data there. PersAI internal networks,
> Kubernetes, private addresses, and metadata remain blocked.

The localized Russian copy must preserve the same facts. “Без ограничений” is
not acceptable because private/internal destinations remain intentionally
unreachable.

### D8 — Remove the false legacy network contract

In the same program:

- delete `RuntimeSandboxPolicy.networkAccessEnabled`;
- delete `AdminPlanSandboxPolicy.networkAccessEnabled`;
- delete Admin Plans `Allow sandbox network`;
- remove the key from stored plan `sandboxPolicy` JSON with the migration;
- regenerate OpenAPI/contracts;
- remove parser/default/materializer/runtime/sandbox fixtures and docs that
  accept or emit the old key;
- reject stale clients that still send the removed plan field through normal
  strict contract validation.

There is no compatibility alias from `networkAccessEnabled=true` to
`full_public`, because old plan data never represented assistant consent or an
enforced direct route.

Historical ADRs/migrations may retain the old term as archive. Active code,
contracts, prompts, settings, and current architecture docs may not.

### D9 — Abuse, exfiltration, and observability

Full-public permission accepts a larger intentional risk surface:

- prompt-injected/model-authored code can send user-visible workspace data to a
  public endpoint;
- the pod can scan public hosts, scrape, download malware, join abuse traffic,
  or consume bandwidth while a bounded job runs;
- public services can return hostile files/content.

The following existing controls remain non-negotiable:

- no PersAI, database, provider, GCS, Kubernetes, or service-account secrets in
  the execution unit;
- gVisor, non-root, read-only root FS, dropped capabilities, no privilege
  escalation, and no host networking;
- CPU, memory, wall-clock, process-count, stdout/stderr, workspace-size,
  artifact-count, daily-job, and pending-job limits;
- persist-time artifact safety validation and delivery limits;
- no Docker socket, DinD, privileged mount, or node credential.

Add observability:

- audit event for every owner mode change;
- sandbox job/pod logs include mode, assistant id, and job id, but no URL query,
  Authorization header, credential, or file contents;
- counters for pod creates/recycles by mode, denied private/metadata probes,
  mode-mismatch failures, and full-public jobs;
- GKE/VPC flow logging for the sandbox node pool with bounded retention and
  operator access;
- operational alerting for abnormal destination fan-out, bytes, job duration,
  and repeated denied internal probes.

ADR-146 does not introduce a content-inspecting MITM, credential injection,
per-domain user history, or TLS interception for full-public traffic.

### D10 — No partial production contour

The program is deployable only when all of the following are true together:

- assistant field/API/UX;
- old plan flag removal;
- restricted and full-public NetworkPolicies;
- pod mode enforcement and recycle;
- private/internal/metadata negative tests;
- audit/metrics/runbook;
- generated contracts, docs, migration, and deploy truth.

Shipping the checkbox before enforcement, the policy before owner consent, or
the enum while retaining the old plan switch is prohibited.

## Security references

- Kubernetes NetworkPolicy rules are additive and operate at L3/L4:
  <https://kubernetes.io/docs/concepts/services-networking/network-policies/>.
- GKE Dataplane V2 does not include Pod traffic in broad `ipBlock` rules and
  requires pod/namespace selectors to permit Pod traffic:
  <https://cloud.google.com/kubernetes-engine/docs/how-to/network-policy>.
- GKE metadata server endpoints are link-local and can mint workload identity
  credentials when permitted; execution pods deliberately receive no metadata
  exception:
  <https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity>.

These properties must be re-verified against the actual cluster dataplane and
CIDR inventory in Slice 0. The ADR does not infer cluster truth from defaults.

## Non-goals

- Per-chat, per-turn, per-command, per-domain, or temporary approval.
- Giving the sandbox access to PersAI internal APIs, databases, Redis, GCS,
  provider credentials, Kubernetes API, node metadata, or private customer
  networks.
- Replacing `browser`, `web_search`, or `web_fetch`.
- Adding a VPN, customer VPC peering, static inbound port, public listener, or
  inbound internet access.
- TLS interception, DLP inspection, malware scanning, or user-visible
  destination history.
- A new billing plan/tier or a separate plan-level full-internet entitlement.
- Reopening sandbox filesystem, document, browser, or storage-plane programs.
- Preserving the old plan boolean for rollback.

## Rejected alternatives

### Reuse `networkAccessEnabled`

Rejected. The boolean is plan-owned, defaults false while allowlisted traffic
still exists, and is not a network enforcement selector. Reinterpreting it would
silently turn historical plan JSON into owner consent.

### Make `full_public` the default

Rejected. Public egress materially increases exfiltration and abuse risk.
Consent is explicit per assistant.

### Keep every request on Squid and change to an allow-all ACL

Rejected. The founder requires direct, non-allowlist public access. It would
also retain one L7 bottleneck and falsely describe proxied traffic as direct.
The restricted proxy remains for restricted assistants only.

### Remove NetworkPolicy for full-public pods

Rejected. That would expose cluster/VPC/metadata destinations and make
“internet” an internal-network bypass. Full-public is an additive reviewed
external CIDR policy, never an unisolated pod.

### Put the choice in draft/publish or in a chat

Rejected. Network permission is an immediate assistant-owned operational
security setting. Persona publishing and chat mode do not own pod identity.

### Allow full-public only for `shell`

Rejected. `shell`, `exec`, and document code share one warm execution pod and
one Kubernetes policy. Product copy and enforcement must describe the real
pod-level boundary.

### Keep old pods and mutate only environment variables

Rejected. Environment variables are not the security boundary, cannot revoke a
surviving child process, and do not change an existing pod's selected network
policy. A mode mismatch recreates the pod.

## Implementation program

Every implementation slice runs:

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. affected runtime/sandbox/config/contract typechecks and focused tests
6. generated-artifact regeneration before format/typecheck
7. slice-specific stale-string and Helm checks

### Slice 0 — Read-only cluster/code ledger

Subagent: Cursor Grok 4.5, read-only.

Status: **complete 2026-07-12 — NO-GO issued.**

Produce:

- exact writer/readers for plan `networkAccessEnabled`;
- assistant lifecycle/API/UI insertion points;
- sandbox pod create/reuse/delete and workspace-lease call graph;
- actual dev/prod dataplane, IP family, node/Pod/Service/control-plane/VPC CIDRs,
  Cloud NAT, DNS labels, metadata endpoint, and NetworkPolicy enforcement;
- exact keep/remove file ledger and migration/generated-contract list.

No code lands in S0. If cluster facts cannot prove the D4 boundary, stop before
implementation.

Historical Slice 0 result: code seams were fully inventoried, but the live
cluster then had no enforcing NetworkPolicy engine and lacked the required
private egress/identity/observability foundation. S1/S2 were blocked at that
checkpoint; S0.1/0.1b later cleared the foundation gate and S1 is now landed
locally.

### Slice 0.1 — Enforcing cluster egress foundation

Subagent: Cursor Grok 4.5.

Status: **live-accepted (2026-07-13).** Repo land on clean `main` at
`edef3c0b` (2026-07-12); live restricted foundation gate PASS at proof pin
`e5c249c3` (sandbox image `8a0043dd`); deferred non-sandbox pins live at bot
pin `64be77d6` (exact `3cd2ea4f`). Audits and local gates passed for the repo
land. Live prepare/NAT/firewall/Calico/private pool/legacy retirement,
proxy-env + CONNECT denial repairs, and the final restricted
`probe-restricted` enforcement matrix completed (see Live foundation checkpoint
below). Evidence inventory SHA-256
`c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`. Inbound
denial / HTTP redirect / DNS-rebind remain explicitly unclaimed RUNBOOK
checks. ADR-146 is **not** closed. This is dated S0.1 history; S1 was later
committed locally at `775e5781`.

### Slice 0.1b — Repository release gate (split-pin)

Subagent: Cursor Grok 4.5.

Status: **live-accepted (2026-07-13).** Release-gate implementation pushed/live;
final restricted foundation gate and controlled-probe cleanup PASS at proof pin
`e5c249c3` (sandbox image `8a0043dd`). GitHub Environment
`persai-dev-adr146-foundation` **approved** by required reviewer; deferred-pin
resume workflow run **`29237479924`** completed both `validate-resume` and the
Environment-gated pin successfully; current bot pin **`64be77d6`** with `api`/`web`/`runtime`/
`provider-gateway` exact `3cd2ea4f` and sandbox remaining `8a0043dd`; Argo
Synced; post-rollout `https://persai.dev/api/health` 200 `{status:ok}`,
`https://persai.dev/api/ready` 200 `{status:ready}`, MCP smoke exact
`ADR146_POST_ROLLOUT_OK`. ADR-146 stays open. This is dated S0.1/0.1b history;
S1 was later committed locally at `775e5781`.

Lands:

- `detect-affected` exact ADR-146 foundation marker paths (including
  `infra/helm/values.yaml` and exact `infra/bootstrap/lib/foundation.mjs` +
  `cidr.mjs`) + fail-closed `values-dev.yaml` classifier (only exact
  `pin-dev-image-tags.mjs` per-service `image.tag` scalars, proven by full
  base/head compare against the shared pin service map, skip
  `foundation_rollout`; missing/empty/unavailable base|head content fails
  closed; `global.images.tag` is not exempt; any other values-dev semantic
  edit — including deep list items, `networkPolicy.enabled`,
  `egressProxy.enabled`, SA/config, blanks/comments, unknown/nested tags,
  indentation tricks, or mixed tag+other — gates foundation); Dev Image
  Publish push paths include `values-dev.yaml` so non-tag edits
  enter the gate while image-tag-only bot pins may start detect-affected but
  yield empty deploy (no build/pin loop); main CI still path-ignores
  `values-dev.yaml`;
  `foundation_rollout` / immediate (`sandbox`) / deferred service partition;
  root `package.json` fanout cannot pin api/web/runtime/provider-gateway before
  foundation approval when markers are present;
- Dev Image Publish split pin:
  A) sandbox-only tag pin after successful sandbox build;
  B) foundation-only remaining pins after `persai-dev-adr146-foundation`;
  C) migration-only remaining pins after `persai-dev-migrations`;
  D) foundation+migration: ordered dual gate — foundation Environment
  approval-only job, then migrations Environment pin job (neither bypassed);
- fail-closed if sandbox build/pin is missing; non-foundation pushes retain the
  prior immediate/migration pin behavior; bot-only image-tag `values-dev.yaml`
  commits still skip main CI and cannot recurse Dev Image Publish;
- dedicated foundation-only deferred-pin resume workflow
  (`adr146-foundation-deferred-pin-resume.yml`) for rejected Environment waits:
  no rebuild, no Dev Image Publish push-guard bypass, explicit target/proof/
  inventory inputs, exact four-service set, sandbox excluded, ancestor + full
  root build-context drift + GAR + sandbox proof-tag binding; the gated job
  validates fresh `origin/main`, revalidates after every rejected-push rebase,
  and proves the bot commit contains only authoritative deferred tag scalars;
  every GAR auth step is access-token-only with
  `create_credentials_file: false` so no `gha-creds-*.json` can pollute that
  commit-shape invariant; pin CLI and `applyPinDevImageTags` share one write
  body (no historical extra EOF blank after `join`), and resume mutation assert
  compares that body exactly after CRLF→LF (EOF blank-line drift fails closed);
  `migration_changed` accepts only boolean `false` or exact string `"false"`
  (every other representation fails closed);
- hardened local controlled restricted + NAT probe Pod manifests (controlled-probe
  label, bounded deadline, non-root/read-only/seccomp/resources, exact inventory
  gVisor Toleration `operator: Equal` — lowercase/`EQUAL`/other casings rejected);
  NAT probe uses inventory-owned digest-pinned
  `curlimages/curl:8.21.0@sha256:7c12af72ceb38b7432ab85e1a265cff6ae58e06f95539d539b654f2cfa64bb13`
  (compatible with hardened `runAsUser: 1000`) and zero proxy env; restricted
  generation resolves the exact production `sandbox-exec` image from committed
  `values-dev.yaml` registry/project/repository/name/tag fields with no
  inventory dynamic tag, global-tag, or BusyBox fallback, plus the ordered
  exact six proxy/no_proxy env entries matching real exec
  (`HTTP_PROXY`/`HTTPS_PROXY`/`http_proxy`/`https_proxy` = proxy URL;
  `NO_PROXY`/`no_proxy` = no-proxy value); live validation requires equality
  with one consistent current real exec `{image, env}` contour across valid
  non-controlled Running real exec Pods and rejects zero, missing,
  conflicting, controlled-label spoof, wrong-order, or mismatch evidence. This
  equality is the proof basis for its `getent`/`curl`/`python3` commands; static
  tests do not claim the binaries were executed. Builder/renderer/validators
  fail closed on NAT image drift;
  active `nat-egress-ip` exec uses `curl --noproxy * -fsS --max-time 20` with
  certificate verification (no `-k`/`--insecure`/`--no-check-certificate`/wget);
  generated-shape validation and the renderer require exactly one non-null
  canonical gVisor toleration before emitting YAML and throw instead of supplying
  a missing/empty/null/wrong/extra fallback; live-admitted validation separately
  requires the exact order-independent set of three API-visible tolerations
  (canonical gVisor plus the exact Kubernetes `not-ready` and `unreachable`
  defaults, each `Exists`/`NoExecute`/`tolerationSeconds: 300`) with no unknown,
  extra, duplicate, or malformed entries; validators enforce the remaining
  hardening; `exec-ksa-live-wiring` excludes controlled probes and requires
  ≥1 real Running exec pod; `cleanup-controlled-probes`
  (dry-run default, `--execute` required) deletes only the two known probe Pods
  by exact name/label on success and failure paths;
- plan/verify/generate-probe-manifests/probe evidence fail-closed on dirty trees,
  unavailable git, or disk≠commit inventory mismatch (no `UNAVAILABLE`);
- inventory `releaseGate.repositoryEnforced: true` with honest human residuals.

Live foundation checkpoint (2026-07-13; restricted gate PASS at `e5c249c3`;
Environment later approved; deferred pins live at `64be77d6`; ADR open; S1 was
not yet implemented at this dated checkpoint):

- prepare is complete: node SA/roles, NAT IPs, subnet flow logs, Private Google
  Access, and the dedicated sandbox secondary range;
- exact Cloud NAT and reviewed firewall are applied;
- Calico is enabled; live cluster now has **5 total nodes**, all Ready /
  Calico-ready, with `calico-node` 5/5. This readiness does **not** alone prove
  policy enforcement (active probes below do);
- two earlier private-pool create attempts failed HTTP 400 before resource
  creation because GKE-managed label/taint flags were supplied; preceding local
  commits repaired those flags;
- casing/resume repair landed locally on `e53b07d6`; subsequent
  `apply-sandbox-pool` **resume completed exact**: private `sandbox-pool-private`
  Ready with exact contour (live GKE `sandboxConfig.type=GVISOR`), and the
  legacy public pool was idempotently re-cordoned;
- maintenance retirement then executed with explicit
  `NO_ACTIVE_SANDBOX_JOBS_CONFIRMED`; both gates passed (zero exec pods on the
  old pool, private Ready, old nodes unschedulable); legacy public
  `sandbox-pool` was **deleted successfully**;
- structural `verify` bound to local HEAD `1300970f` + inventory hash ran and
  **failed only on the expected unpushed Helm boundary**: exec KSA absent, zero
  real exec pods, new exec NetworkPolicy absent, legacy exec NetworkPolicy still
  present, old proxy NetworkPolicy shape, NAT probe NetworkPolicy absent. All
  GCP / Calico / private pool / NAT / firewall / metadata / trusted-control
  checks passed. No enforcement proof yet at that checkpoint; no active probes;
- coordinated push **`3cd2ea4f` is live**: Dev Image Publish built all services
  and pinned **sandbox only**; deferred remaining pins wait on Environment
  (not approved; non-sandbox pins last-good). Argo applied KSA/NetworkPolicy
  but `sandbox-egress-proxy` CrashLoopBackOff on unsupported
  `logformat … %ssl::>sni` (Squid 6.14 GnuTLS / no SSL-Bump). Squid logformat +
  checksum repair **`04b1d0d1` is live**: Argo Synced/Healthy;
  `sandbox-egress-proxy` Ready (ConfigMap + `checksum/squid-conf` recreate);
- structural `verify` on live `04b1d0d1` then failed only on verifier↔API-server
  shape mismatches (not missing objects): Argo-managed exec KSA inert
  annotations, omitted empty NetworkPolicy `ingress`, and non-strict matcher
  boolean. Live-verifier normalization repair **live at `bf8eeef1`**
  (structural `verify` PASS including a real production exec Pod). Controlled
  `generate-probe-manifests` then succeeded, but Kubernetes initially rejected
  both probe Pods before creation (`spec.tolerations[0].operator` lowercase
  `"equal"`; apiserver requires canonical `"Equal"`). Equal-casing repair
  **live at `42a4f425`** (sandbox bot pin **`87907361`**). Collector
  tolerations preservation **pushed/live at `97042c45` with bot pin
  `fe3e1f59`**. Live admitted toleration normalization **pushed/live at
  `838789c4` with bot pin `c5716b97`**. At that pin, controlled Pods were
  API-admitted/Ready; pre-structural foundation **PASS** and trusted positive
  controls **PASS**; active probe then **FAIL**ed at `nat-egress-ip` because
  the NAT Pod still used `busybox:1.36` while the script execs `curl` (binary
  absent) — before identity comparison. Manual BusyBox `wget` observed
  reserved NAT IP `34.76.34.111` but warned TLS is not implemented; that is
  **not** accepted proof. Cleanup **PASS**. Controlled-probe executable/TLS
  repair is **pushed/live at `5045431e` with bot pin `71eb9c0c`**.
  Post-image-repair probes passed pre-structural, trusted positive controls,
  reserved NAT identity, and DNS, then `Squid allowlisted HTTPS` timed out
  because generated restricted `env: []` went direct (Calico drop; no Squid
  access log). Cleanup **PASS**. Restricted-probe proxy-env repair is
  **pushed/live at `dc2fa914`** (bot pin path through `188722f9`): generation
  emits the exact ordered six-entry proxy env set matching real exec, and live
  validation requires exact production `{image, env}` equality. Squid CONNECT
  denial probe repair is **pushed/live at `8a0043dd`** (asserts curl
  `%{http_connect}` exact `403`; `%{http_code}`/`000` must not pass) with
  current deployed/pin HEAD **`e5c249c3`** (sandbox image `8a0043dd`);
- **Final live restricted foundation gate PASS** at `e5c249c3` with evidence
  inventory SHA-256
  `c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`:
  structural RESULT **PASS**; all trusted positive controls **PASS**; NAT
  identity reserved IP `34.76.34.111` **PASS**; DNS **PASS**; Squid allowlisted
  HTTPS **PASS**; Squid CONNECT denial for non-allowlisted `example.com`
  **PASS**; direct-public bypass denial **PASS**; Kubernetes API,
  metrics-server, Redis, Filestore, Cloud SQL, kube-dns Pod UDP/TCP,
  same-namespace sandbox control-plane Pod, every node kubelet, and metadata
  `169.254.169.254` denial **PASS**. Controlled-probe cleanup **PASS** (no
  controlled Pods remaining). Inbound denial, HTTP redirect, and DNS-rebind
  remain **explicitly unclaimed** RUNBOOK checks;
- GitHub Environment `persai-dev-adr146-foundation` **exists live**
  (required reviewer `kurock09` / user id `126346824`,
  `prevent_self_review=false`, custom deployment branch policy exactly `main`,
  residual `can_admins_bypass=true` — documented honestly, not mutated here)
  and is **approved** for the deferred-pin resume path (see below). This was the
  pre-S1 checkpoint; S1 has since landed locally. Do **not** close this ADR.

Exact push-last sequence (founder-coordinated; live GCP/Calico/private-pool/
retirement + Environment creation + coordinated push + proxy Ready + verifier/
toleration/collector/image/proxy-env/CONNECT repairs + restricted gate +
Environment approval + deferred pins above are done):

1. create protected GitHub Environment `persai-dev-adr146-foundation` —
   **done**: Environment exists live with required reviewer `kurock09`
   (user id `126346824`), `prevent_self_review=false`, and custom deployment
   branch policy exactly `main`; residual `can_admins_bypass=true`; later
   **approved** for deferred-pin resume. Create `persai-dev-migrations` when
   that gate is needed;
2. run the final full local gate from a clean tree;
3. one coordinated founder push of the ADR-146 commit range — **done at
   `3cd2ea4f`**; Squid logformat CrashLoop + checksum rollout repair —
   **done/live at `04b1d0d1`** (proxy Ready);
4. observe Argo apply repaired `sandbox-egress-proxy` ConfigMap **and**
   checksum-driven Pod recreate to Ready while non-sandbox image tags remain
   last-good (sandbox already pinned). Do **not** treat ConfigMap-only sync as
   sufficient under `subPath` — **done at `04b1d0d1`**;
5. push live-verifier Kubernetes normalization repair (**done at `bf8eeef1`**;
   structural `verify` PASS including a real production exec Pod), push
   controlled-probe Toleration `Equal` casing repair (**done at `42a4f425` /
   sandbox bot pin `87907361`**; prior apply rejected lowercase `"equal"` before
   Pod creation), push collector tolerations preservation repair (**done:
   pushed/live at `97042c45` with bot pin `fe3e1f59`**), push live admitted
   toleration normalization (**done: pushed/live at `838789c4` with bot pin
   `c5716b97`**; pre-structural + trusted positive controls PASS;
   `nat-egress-ip` FAIL on absent curl in busybox NAT image before comparison;
   manual insecure wget reserved-IP observation not accepted proof; cleanup
   PASS), push restricted/NAT probe executable/TLS image repair (**done/live
   at `5045431e` with bot pin `71eb9c0c`**; post-repair pre-structural +
   controls + NAT identity + DNS PASS; allowlisted HTTPS timed out because
   generated restricted env was empty/direct; no Squid access log; cleanup
   PASS), push restricted-probe proxy-env repair (**done/live at `dc2fa914`**;
   bot pin path through `188722f9`; exact generated ordered six env entries +
   live production `{image, env}` equality), push Squid CONNECT denial probe
   repair (**done/live at `8a0043dd`** with deployed/pin HEAD **`e5c249c3`** /
   sandbox image `8a0043dd`; `%{http_connect}` exact `403`), regenerate/apply
   controlled probes, re-run active probes — **final restricted foundation gate
   PASS** (evidence inventory SHA-256
   `c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`), then
   `cleanup-controlled-probes --execute` — **PASS** (no controlled Pods
   remaining);
6. approve GitHub Environment `persai-dev-adr146-foundation` — **done**
   (required reviewer approved the Environment-gated resume pin);
7. when migrations are also present, approve `persai-dev-migrations` after step 6
   (not required for this foundation-only resume);
8. remaining service image tags pin — **done** via resume bot pin
   **`64be77d6`** (`api`/`web`/`runtime`/`provider-gateway` exact `3cd2ea4f`;
   sandbox remains `8a0043dd`).

Failure/rollback: remain on last-good non-sandbox pins if verification fails;
sandbox tag may roll back independently; never disable Calico; never restore the
removed plan `networkAccessEnabled` boolean.

**Deferred-pin resume (foundation-only):** the historical Environment wait on
Dev Image Publish run for coordinated push `3cd2ea4f` was rejected and cannot
be recreated by ordinary `workflow_dispatch` — split-pin / migration / ordinary
pin jobs remain guarded by `github.event_name == 'push'`. Do **not** relax those
guards. The approved resume path is the dedicated workflow
`.github/workflows/adr146-foundation-deferred-pin-resume.yml`: explicit
decoupled `target_image_sha` / `sandbox_proof_commit_sha` /
`evidence_inventory_sha256` / `deferred_services`, no image rebuild, sandbox
excluded, exact `api,web,runtime,provider-gateway` set, ancestor + complete
root-context drift fail-closed (`apps`, `packages`, `extensions`, `services`,
`scripts/smoke`, workspace manifests, `.dockerignore`), GAR manifest existence,
and `values-dev` sandbox proof-tag binding. After Environment approval the pin
job checks out/fetches fresh `origin/main`; every rejected-push rebase reruns
the request and exact tag-only commit validators before retry. This slice is
**foundation-only** (`migration_changed` accepts only boolean `false` or exact
string `"false"`); dual-gate migration resume is intentionally unsupported
rather than weakly implemented. A real temporary bare-origin/runner-clone test
proves newer protected-path drift is rejected after rebase and before push.
**Historical:** a first live resume attempt failed after successful
validate/GAR/pin when historical `pin-dev-image-tags.mjs` `` `${join}\n` `` EOF
blank mismatched `applyPinDevImageTags`; EOF CLI/lib repair landed on `main`
and keeps exact mutation validation fail-closed on EOF/unrelated drift.
**Current:** second resume workflow run **`29237479924`** completed both
`validate-resume` and the Environment-gated pin **successfully**; Environment
approved by required reviewer; bot pin **`64be77d6`** with locked inputs target
`3cd2ea4fa0c82d319c2e8e63724c5753f03b5e0f`, services
`api,web,runtime,provider-gateway`, proof
`e5c249c3dbb9d16406b85637e9dcdd9a418a8a79`, inventory
`c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`. Argo
Synced; post-rollout `https://persai.dev/api/health` 200 `{status:ok}` and
`https://persai.dev/api/ready` 200 `{status:ready}`; MCP smoke
`ADR146_POST_ROLLOUT_OK`.

Historical next step at this checkpoint was **Slice 1**. S1 was later committed
locally at `775e5781`; do **not** close this ADR.

This is the first implementation slice on the founder-selected current-cluster
Calico contour. Its acceptance is fixed:

- an enforcing Calico or Dataplane V2 network-policy engine is live and proven
  by active probes (Calico readiness labels alone are not enforcement proof);
- private sandbox pool is created with `--sandbox=type=gvisor` and live
  `sandboxConfig.type` of gVisor only (`gvisor` / `GVISOR` casing; labels/taints
  alone are insufficient);
- after the private pool is Ready, the legacy public sandbox pool is cordoned
  (fail-closed, no delete, running jobs undisturbed) before the phase claims
  success; maintenance-gated retirement remains separate;
- sandbox execution has an explicit dedicated no-IAM/no-WI ServiceAccount and
  no broad node identity exposure path; final verification requires at least one
  Running exec pod on that KSA (zero pods cannot claim live wiring);
- sandbox public egress uses an approved private-node/NAT or equivalent L3
  contour with flow observability;
- generated restricted probes carry exactly the ordered six-entry proxy env
  set resolved from committed `values-dev.yaml` (`HTTP_PROXY`, `HTTPS_PROXY`,
  `http_proxy`, `https_proxy`, `NO_PROXY`, `no_proxy`), with no credentials,
  secrets, aliases, extra entries, or empty/default fallback;
- live restricted-probe validation requires exact `{image, env}` equality with
  one consistent set of valid Running non-controlled production exec Pods;
  missing, extra, duplicate, wrong-order, conflicting, credential-bearing, or
  mismatched env evidence fails closed, while NAT requires zero env;
- the denied inventory includes special-use ranges plus live
  `34.118.224.0/20` Services, `10.132.0.0/20` nodes,
  `10.107.128.0/17` Pods, and current PSA/Redis/Filestore peers;
- active denial covers Calico-owned kube-dns Pod IP and same-namespace sandbox
  control-plane Pod IP (TCP/UDP where meaningful), with trusted positive
  controls first; `ECONNREFUSED` is never treated as denial;
- restricted direct bypass, Squid non-allowlisted HTTPS CONNECT denial via curl
  `%{http_connect}` exact `403` (`%{http_code}`/`000` must not pass), Pod/Service/
  node/control-plane/metadata access all fail in a founder-approved test pod;
- inbound denial, HTTP redirect, and DNS-rebind remain **explicitly unclaimed**
  by automated `probe-restricted` and stay RUNBOOK-only;
- the ordinary restricted Squid allowlist path still works.

S0.1 restricted live foundation gate is recorded PASS at `e5c249c3` (evidence
inventory SHA-256
`c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`). S0.1b
Environment approval + deferred pins are live-accepted at bot pin `64be77d6`.
**S1 is committed locally at `775e5781`** (implemented from baseline
`6fe4356a`; not pushed/deployed). **S2 is committed locally at `5a2fd3bd`.**
**S3 is landed locally (uncommitted) on `5a2fd3bd`.**
A locally rendered policy alone is not live acceptance.

### Slice 1 — Canonical data/API contract and legacy-field deletion

Subagent: Cursor Grok 4.5.

Status: **committed locally at `775e5781`** (implemented from baseline
`6fe4356a`; not pushed/deployed).

Landed:

- Prisma enum/assistant field + one-way restricted backfill;
- plan JSON cleanup migration;
- domain/repository/lifecycle state;
- GET/PUT contracts and generated artifacts;
- complete removal of plan/runtime `networkAccessEnabled`, including Admin
  Plans;
- owner authorization, validation, audit event, idempotency, and focused API
  tests.

Honest S1 residual: PUT/GET report `recycled: false` until Slice 3 implements
synchronous warm-pod eviction. The route remains unexposed in Assistant
Settings UI until Slice 4.

### Slice 2 — Helm public-only policy

Subagent: Cursor Grok 4.5.

Land:

- explicit restricted/full-public pod labels;
- explicit empty-ingress policy for every exec pod;
- restricted DNS selector tightening;
- dedicated no-IAM/no-Workload-Identity exec ServiceAccount;
- additive full-public egress NetworkPolicy;
- shared restricted-proxy/full-public non-global and metadata deny inventory;
- environment-specific cluster/VPC CIDR inventory + template validation;
- production chart assertion that sandbox execution cannot run with
  `networkPolicy.enabled: false`;
- Cloud NAT/VPC-firewall validation for the sandbox node pool;
- proxy env only on restricted pod specs;
- Helm defaults/dev values and deploy-truth fixtures;
- `helm lint` and rendered-policy assertions for both modes.

Acceptance includes proof that rendered full-public policy does not select
control-plane pods or grant pod/namespace destinations.

### Slice 3 — Sandbox mode authority, recycle, and descendant cleanup

Subagent: Cursor Grok 4.5.

Land:

- last-responsible-moment assistant-mode resolve in sandbox control plane;
- mode annotation validation on warm, create, and reuse paths;
- mismatch delete-and-recreate;
- owner-mode reconcile/eviction internal endpoint;
- queued/running busy protection;
- mandatory exact-pod retirement after persistence and before lease release,
  making pod namespace destruction the descendant-cleanup proof;
- fail-closed errors and observability;
- focused sandbox tests, including cross-replica/cluster-truth behavior.

No runtime/model field is accepted as authority for the mode.

### Slice 4 — Assistant Settings consent UX

Subagent: Cursor Grok 4.5.

**Status: landed locally (uncommitted) on baseline `8d0520f4`.**

Land:

- `Assistant -> Sandbox network` checkbox;
- RU/EN warning and confirmation;
- busy/error/success/refetch behavior;
- no optimistic checked state before canonical success;
- focused API-client/settings accessibility and interaction tests.

### Slice 5 — Cross-layer audit, docs, and runbook

Subagent: Cursor Grok 4.5.

Land:

- architecture/API/data/test/runbook reconciliation;
- metrics/logging/alert hooks agreed in D9;
- negative active-code audit for the old field and stale copy;
- deploy and rollback runbook.

Rollback is operational, not dual-runtime: export and review the exact
full-public Assistant UUID set, transactionally set only that bounded set to
`restricted`, then invoke per-assistant reconcile until no stale full-public
generation remains. Reconcile scope `all|stale_only` is an intent hint; both
paths UID/resourceVersion-delete only idle missing/malformed/mismatched
generations and preserve active or correct-mode pods. Then roll back
application/chart images if needed. The removed old plan boolean is not
restored.

**Local land (committed locally at `d23936d1` on baseline `3f498ef9`;
unpushed/undeployed):**

- `infra/dev/gke/ADR146-OBSERVABILITY.md` + RUNBOOK deploy/rollback sequence
  (D10: predeploy default `verify`; post chart/policy sync
  `verify --require-s2-policy` before web exposure);
- sandbox D9 metrics hooks (`mode_mismatch`, retirement/reaper, job duration);
- `scripts/ci/adr146-active-code-audit.mjs` + tests;
- `scripts/ci/adr146-cross-layer-contract.mjs` + tests;
- composite `test:adr146-slice5` wired into Full Verification;
- fail-fast Bash/PowerShell rollback loops with guaranteed process-token cleanup;
- bounded `infra/bootstrap/adr146-s6-live-acceptance.mjs` preparation plus
  operator-owned fixture/smoke/cleanup contracts; no default public endpoint,
  live execution, deploy, or acceptance claim;
- docs reconciled (AGENTS, ARCHITECTURE, API-BOUNDARY, DATA-MODEL, TEST-PLAN,
  SESSION-HANDOFF, CHANGELOG, gitops README).

### Slice 6 — Parent-only final gate, deploy, and live acceptance

The parent agent:

1. reviews every landed diff and SHA;
2. runs the full AGENTS gate and all focused suites;
3. runs Helm lint/template and generated-artifact checks;
4. proves zero active old-field references;
5. verifies the migration approval path;
6. deploys only on explicit founder instruction;
7. provisions approved operator-owned fixtures, runs the bounded S6 helper plus
   manual inbound/public-master and mode-toggle checks, and records cleanup;
8. performs live restricted/full/private-negative/browser/web-search acceptance;
9. closes the ADR only after evidence is recorded.

No subagent may close S6.

## Automated acceptance

Required focused coverage:

1. Existing/new assistant reads `restricted`.
2. Non-owner cannot read or mutate another assistant's mode.
3. Unknown mode is 400; busy mutation is stable 409.
4. Idempotent PUT reconciles stale pod state and does not duplicate audit truth.
5. Plan payloads/contracts reject and never emit `networkAccessEnabled`.
6. Restricted pod:
   - has proxy env;
   - reaches an allowlisted package host through Squid;
   - receives proxy denial for a non-allowlisted host;
   - cannot connect directly after unsetting proxy env.
7. Full-public pod:
   - has no proxy env;
   - reaches unrelated public HTTP(S), public SSH, and a public custom TCP/UDP
     fixture directly;
   - is not selected by any control-plane policy.
8. Full-public negative matrix blocks:
   - loopback;
   - RFC1918/VPC;
   - Pod and Service destinations;
   - Kubernetes API/control-plane;
   - node addresses;
   - GKE/Compute metadata;
   - link-local and carrier-grade NAT;
   - redirect and DNS-rebinding fixtures resolving to denied destinations.
9. Warm pod mode mismatch deletes and recreates before command.
10. Two assistants in one workspace can hold different modes without sharing a
    pod or policy.
11. Mode change during queued/running job is rejected; after completion the old
    pod is evicted and the workspace rehydrates on next use.
12. A background child process cannot survive job completion.
13. `files.*`, `grep`, `glob`, browser, web tools, and worker media are unchanged.
14. Audit/log/metric payloads carry mode but no secret URL/query/header content.

## Live acceptance

After approved migration/deploy:

1. Confirm all existing assistants read `restricted`.
2. Run an allowlisted install and a non-allowlisted public request; confirm
   restricted behavior and direct-bypass denial.
3. Enable the checkbox with confirmation. Verify the old pod UID disappears and
   the next pod has `full-public`, no proxy env, and direct public access.
4. Probe every private/internal/metadata target from the negative matrix. Every
   probe must fail while ordinary public destinations succeed.
5. Create a redirect and DNS-rebinding test whose final IP is denied; verify no
   connection reaches the target. Use the bounded
   `infra/bootstrap/adr146-s6-live-acceptance.mjs` operator-fixture helper for
   SSH/custom TCP+UDP, redirect, private DNS answer, restricted proxy/direct
   bypass, different-assistant, browser, web-search, and mandatory cleanup
   checks. Its local presence is preparation only, not live evidence.
6. Disable the checkbox. Verify the full-public pod is gone before success is
   shown and the next job is proxy-only.
7. Verify another assistant remains restricted throughout.
8. Verify audit events, mode metrics, NetworkPolicy drops, and bounded flow logs.
9. Verify no browser/web-search behavior changed.

## Closure conditions

ADR-146 closes only when:

- all S1-S5 implementation SHAs are recorded;
- parent final gate is green;
- migration, chart, and rollback truth are verified;
- live acceptance proves public success plus internal/private failure;
- no active `networkAccessEnabled` contract remains;
- founder accepts the Assistant Settings behavior.
