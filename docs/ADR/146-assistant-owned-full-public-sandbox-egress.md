# ADR-146: Assistant-owned full-public sandbox egress

## Status

Accepted — founder-directed production orchestration program opened 2026-07-12.
Slice 0 read-only code/live-cluster audit completed 2026-07-12 with implementation
**NO-GO**. Slice 0.1 repository automation for the founder-selected current-cluster
Calico + private sandbox egress contour **landed on clean `main` at
`edef3c0b`** (audits + local gates passed). Slice **0.1b release-gate** lands the
repository-enforced split-pin Dev Image Publish path (`sandbox` immediate;
remaining services behind GitHub Environment `persai-dev-adr146-foundation`) plus
probe-manifest generation and commit/inventory evidence binding.

Live foundation progress (2026-07-13; **not** acceptance): prepare, exact NAT/
firewall, Calico (`calico-node` 5/5), private `sandbox-pool-private` Ready with
exact contour, idempotent legacy cordon, and maintenance-gated public-pool
retirement have completed; structural `verify` bound to local HEAD `1300970f`
passed all GCP/Calico/private-pool/NAT/firewall/metadata/trusted-control checks
and failed only on the expected unpushed Helm boundary. GitHub Environment
`persai-dev-adr146-foundation` **exists live** (required reviewer `kurock09`
user id `126346824`, `prevent_self_review=false`, custom deployment branch
policy exactly `main`, residual `can_admins_bypass=true`) but is **not**
approved or deployed. Environment existence docs are already on the clean local
pre-push branch (through `ebbc5fe4`); a repo-local migration-pin `if` grouping
repair may sit on top uncommitted. No push, no image publish, no active probes,
and no enforcement proof yet. S0.1 is **not** live-complete and this ADR is
**not** closed. S1 app/API/UI work stays blocked until S0.1 is live-accepted.
Next: commit any pending repair, final full local gate, one coordinated push,
Argo KSA/NP apply with last-good non-sandbox tags + sandbox-only pin, then
probes/verify/cleanup/Environment approval(s).

## Date

2026-07-12

## Baseline SHA

Program-open baseline: `a0c3e997f40baeb05d62bbd80ac89abfafc4fed7`.

Slice 0 audit baseline: `e137d7d46d07475d2e74d66704ef483dc6b103c0`.

Slice 0.1 repo-local land: `edef3c0bc2d839ac8ddac1c5b60fd39440d5e947`
(`edef3c0b` after rebase onto `origin/main`).

Slice 0.1b release-gate baseline: clean `main` at `d847cb61ac0c393fd3f0e58de4c56e507045bd69`
(implementation lands locally on top of this SHA; not pushed).

Live foundation checkpoint baseline (local, unpushed): `1300970f9452694418513336a01f9eba68219c44`
(`1300970f`). Resume/retire/verify + Environment-existence docs are committed on
the clean local pre-push branch through
`ebbc5fe41f2fe51d5db0711ac6f341fc5ef4664c` (`ebbc5fe4`).

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

- **Code ledger:** GO for the future S1 data/API cutover in isolation;
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
- IPv6 loopback, link-local, unique-local, multicast, documentation, and the
  environment's cluster/internal ranges when IPv6 is enabled.

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

Before executing any command:

1. resolve the current assistant mode;
2. inspect the existing pod's mode;
3. if it differs or is absent, delete the pod and wait for termination;
4. create a new pod with the correct NetworkPolicy label and proxy environment;
5. only then execute the job.

Failure to resolve, label, delete, or recreate is fail-closed: the job does not
run. There is no “temporarily use restricted/full” fallback and no unlabeled
exec pod.

Job completion must terminate the command's complete descendant process tree.
No model-started background process may survive lease release. This is required
so an idle pod is inert while a setting change is being reconciled.

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
- synchronously request eviction of all warm execution pods for the assistant;
- report success only after those pods are absent;
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

Result: code seams are fully inventoried, but the live cluster has no enforcing
NetworkPolicy engine and lacks the required private egress/identity/observability
foundation. S1/S2 are blocked.

### Slice 0.1 — Enforcing cluster egress foundation

Subagent: Cursor Grok 4.5.

Status: **repo-local land on clean `main` at `edef3c0b` (2026-07-12); live
foundation mutations partially complete as of 2026-07-13.** Audits and local
gates passed for the repo land. Live prepare/NAT/firewall/Calico/private pool/
legacy retirement progressed (see Live foundation checkpoint below). Active
probes and enforcement proof are still incomplete — S0.1 is **not**
live-complete. App S1 remains blocked.

### Slice 0.1b — Repository release gate (split-pin)

Subagent: Cursor Grok 4.5.

Status: **repo-local implementation on baseline `d847cb61` (2026-07-12),
including final audit repairs.** No live mutation and no push yet. S1 remains
blocked until foundation live acceptance.

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
- hardened local controlled restricted + NAT probe Pod manifests (controlled-probe
  label, bounded deadline, non-root/read-only/seccomp/resources); validators
  enforce that hardening; `exec-ksa-live-wiring` excludes controlled probes and
  requires ≥1 real Running exec pod; `cleanup-controlled-probes` (dry-run
  default, `--execute` required) deletes only the two known probe Pods by exact
  name/label on success and failure paths;
- plan/verify/generate-probe-manifests/probe evidence fail-closed on dirty trees,
  unavailable git, or disk≠commit inventory mismatch (no `UNAVAILABLE`);
- inventory `releaseGate.repositoryEnforced: true` with honest human residuals.

Live foundation checkpoint (2026-07-13; partial, not acceptance):

- prepare is complete: node SA/roles, NAT IPs, subnet flow logs, Private Google
  Access, and the dedicated sandbox secondary range;
- exact Cloud NAT and reviewed firewall are applied;
- Calico is enabled; live cluster now has **5 total nodes**, all Ready /
  Calico-ready, with `calico-node` 5/5. This readiness does **not** prove
  policy enforcement;
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
  checks passed. No enforcement proof yet; no active probes run;
- no push yet; Helm KSA/NetworkPolicy from the unpushed repository is not
  applied; GitHub Environment `persai-dev-adr146-foundation` **exists live**
  (required reviewer `kurock09` / user id `126346824`,
  `prevent_self_review=false`, custom deployment branch policy exactly `main`,
  residual `can_admins_bypass=true` — documented honestly, not mutated here)
  but is **not** approved or deployed; S1 remains incomplete. Foundation
  completion and enforcement are **not** claimed.

Exact push-last sequence (founder-coordinated; live GCP/Calico/private-pool/
retirement + Environment creation above are done; Helm apply + probes +
approvals remain):

1. create protected GitHub Environment `persai-dev-adr146-foundation` —
   **done**: Environment exists live with required reviewer `kurock09`
   (user id `126346824`), `prevent_self_review=false`, and custom deployment
   branch policy exactly `main`; residual `can_admins_bypass=true`; not
   approved/deployed. Create `persai-dev-migrations` when that gate is needed;
2. run the final full local gate from a clean tree (Environment docs already on
   the clean local branch; commit any pending migration-pin repair first);
3. one coordinated founder push of the ADR-146 commit range;
4. observe Argo apply KSA/NetworkPolicy from `HEAD` while non-sandbox image
   tags remain last-good, then Dev Image Publish pins **sandbox only** after
   the sandbox image build succeeds;
5. create real/controlled probes, re-run structural `verify` (clean-tree
   evidence bound to commit SHA + inventory SHA-256), run active probes, then
   `cleanup-controlled-probes --execute` (required on success and failure);
6. approve GitHub Environment `persai-dev-adr146-foundation`;
7. when migrations are also present, approve `persai-dev-migrations` after step 6;
8. remaining service image tags pin.

Failure/rollback: remain on last-good non-sandbox pins if verification fails;
sandbox tag may roll back independently; never disable Calico; never restore the
removed plan `networkAccessEnabled` boolean.

Next: commit any pending migration-pin repair → final full local gate → one
coordinated push → observe Argo KSA/NP apply with last-good non-sandbox tags and
sandbox-only pin → real/controlled probes → structural verify → active probes →
cleanup → Environment approval(s). Do **not** claim foundation complete. Push
remains blocked until that coordinated step. S1 remains blocked.

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
- the denied inventory includes special-use ranges plus live
  `34.118.224.0/20` Services, `10.132.0.0/20` nodes,
  `10.107.128.0/17` Pods, and current PSA/Redis/Filestore peers;
- active denial covers Calico-owned kube-dns Pod IP and same-namespace sandbox
  control-plane Pod IP (TCP/UDP where meaningful), with trusted positive
  controls first; `ECONNREFUSED` is never treated as denial;
- restricted direct bypass, Squid non-allowlisted HTTPS denial, Pod/Service/
  node/control-plane/metadata access all fail in a founder-approved test pod;
- inbound denial, HTTP redirect, and DNS-rebind remain **explicitly unclaimed**
  by automated `probe-restricted` and stay RUNBOOK-only;
- the ordinary restricted Squid allowlist path still works.

S0.1 must be deployed and live-accepted before S1. A locally rendered policy is
not sufficient evidence.

### Slice 1 — Canonical data/API contract and legacy-field deletion

Subagent: Cursor Grok 4.5.

Land:

- Prisma enum/assistant field + one-way restricted backfill;
- plan JSON cleanup migration;
- domain/repository/lifecycle state;
- GET/PUT contracts and generated artifacts;
- complete removal of plan/runtime `networkAccessEnabled`, including Admin
  Plans;
- owner authorization, validation, audit event, idempotency, and focused API
  tests.

The route may remain unexposed in UI until enforcement lands locally, and the
branch is not deployed between slices.

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
- complete descendant-process cleanup after each job;
- fail-closed errors and observability;
- focused sandbox tests, including cross-replica/cluster-truth behavior.

No runtime/model field is accepted as authority for the mode.

### Slice 4 — Assistant Settings consent UX

Subagent: Cursor Grok 4.5.

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

Rollback is operational, not dual-runtime: set every assistant to `restricted`,
evict full-public pods, verify only restricted pods remain, then roll back
application/chart images if needed. The removed old plan boolean is not restored.

### Slice 6 — Parent-only final gate, deploy, and live acceptance

The parent agent:

1. reviews every landed diff and SHA;
2. runs the full AGENTS gate and all focused suites;
3. runs Helm lint/template and generated-artifact checks;
4. proves zero active old-field references;
5. verifies the migration approval path;
6. deploys only on explicit founder instruction;
7. performs live restricted/full/private-negative/mode-toggle acceptance;
8. closes the ADR only after evidence is recorded.

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
   connection reaches the target.
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
