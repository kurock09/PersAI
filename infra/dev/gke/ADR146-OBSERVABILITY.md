# ADR-146 observability and operator alerts

Slice 5 operator reference for D9 abuse/exfiltration observability. No cloud
mutation; executable queries only.

## Audit event (owner mode change)

Every **changed-mode** owner `PUT /api/v1/assistant/{assistantId}/sandbox-egress`
writes one `assistant_audit_events` row:

| Field                  | Value                                          |
| ---------------------- | ---------------------------------------------- |
| `eventCategory`        | `assistant_sandbox`                            |
| `eventCode`            | `assistant.sandbox_egress_mode_updated`        |
| `actorUserId`          | authenticated owner user id                    |
| `details.previousMode` | `restricted` or `full_public` before commit    |
| `details.selectedMode` | requested mode after commit                    |
| `details.actorUserId`  | same owner id (duplicate for downstream joins) |

Same-mode PUT and GET never insert audit rows. Audit failure rolls back the mode
update.

Example SQL (read-only):

```sql
SELECT
  id,
  assistant_id,
  actor_user_id,
  event_code,
  details->>'previousMode' AS previous_mode,
  details->>'selectedMode' AS selected_mode,
  created_at
FROM assistant_audit_events
WHERE event_code = 'assistant.sandbox_egress_mode_updated'
ORDER BY created_at DESC
LIMIT 20;
```

## Sandbox logs (no secrets)

Structured sandbox logs include `assistant`, `job`, `pod`, `mode`, recycle/mismatch
reasons, and retirement outcomes. They intentionally omit URL query strings,
`Authorization` headers, credentials, and file contents.

Representative keys:

- `exec_pod_session job=… assistant=… mode=…`
- `exec_job_start job=… assistant=… pod=… mode=…`
- `exec_pod_pre_exec_mode_mismatch … expected=… actual=…`
- `sandbox_egress_owner_evict pod=… assistant=… mode=…`
- `exec_job_pod_retired job=… assistant=… pod=… uid=…`
- `sandbox_job_pod_retirement_complete … retired=true|false`
- `exec_pod_reaper_evict pod=… assistant=… workspace=… idle_ms=…`

GKE log query (Cloud Logging):

```text
resource.type="k8s_container"
resource.labels.namespace_name="persai-dev"
resource.labels.container_name="sandbox"
(
  textPayload:"exec_job_start"
  OR textPayload:"exec_pod_pre_exec_mode_mismatch"
  OR textPayload:"sandbox_egress_owner_evict"
  OR textPayload:"exec_job_pod_retired"
  OR textPayload:"exec_pod_reaper_evict"
)
```

## Prometheus metrics (`GET /metrics` on sandbox)

| Metric                                    | Labels                                    | Meaning                                         |
| ----------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `sandbox_exec_pod_create_total`           | `mode`                                    | Pods created with stamped egress mode           |
| `sandbox_exec_pod_recycle_total`          | `reason=mismatch\|malformed\|owner_evict` | UID recycle events                              |
| `sandbox_exec_egress_jobs_total`          | `mode`                                    | Jobs that resolved a canonical mode             |
| `sandbox_exec_egress_mode_mismatch_total` | —                                         | Fail-closed mode mismatch errors                |
| `sandbox_exec_pod_retirement_total`       | `outcome=retired\|skipped\|failed`        | Post-job pod retirement                         |
| `sandbox_exec_pod_reaper_evict_total`     | —                                         | Idle/stale reaper evictions                     |
| `sandbox_exec_egress_job_duration_ms`     | `mode`                                    | Started+bound terminal job wall-clock histogram |

Job duration is emitted exactly once after a conditional terminal DB write
succeeds for `completed`, `failed`, or `blocked`, using the persisted-running
transition timestamp and the canonical bound pod mode. It is not emitted when
the job never started/bound or when terminal persistence lost its conditional
race. `_max` is a separate gauge family with one HELP/TYPE declaration and one
sample per mode.

Alert thresholds (no in-repo alerting framework; evaluate manually or in your
metrics backend):

```promql
# Sustained fail-closed mismatches after deploy
increase(sandbox_exec_egress_mode_mismatch_total[15m]) > 0

# Retirement failures withholding lease release
increase(sandbox_exec_pod_retirement_total{outcome="failed"}[15m]) > 0

# Unexpected full-public fan-out (rate, not absolute count)
rate(sandbox_exec_egress_jobs_total{mode="full_public"}[1h]) > 0
and rate(sandbox_exec_pod_create_total{mode="full_public"}[1h]) > 0

# Long-running full-public jobs (p95 > 30 minutes over 1h window)
histogram_quantile(
  0.95,
  sum by (le, mode) (rate(sandbox_exec_egress_job_duration_ms_bucket[1h]))
) > 1800000
and on(mode) rate(sandbox_exec_egress_jobs_total{mode="full_public"}[1h]) > 0
```

## VPC flow logs and private/metadata denials

Foundation truth (Slice 0.1): subnet flow logs on the cluster subnet with
`aggregationInterval=INTERVAL_5_SEC`, `flowSampling=0.5`,
`metadata=INCLUDE_ALL_METADATA`. NAT logging is `ALL`. **Retention is the GCP
project default for VPC flow logs and Cloud NAT logs** — PersAI does not mutate
retention in ADR-146; operators with `roles/compute.networkViewer` and Logging
read access can query them.

Private/internal/metadata probe denials are **not** emitted as in-process
counters. Observe them through VPC flow logs and foundation
`probe-restricted` (live gate only).

Abnormal destination fan-out / bytes (full-public only):

```text
resource.type="gce_subnetwork"
logName:"compute.googleapis.com%2Fvpc_flows"
jsonPayload.connection.dest_ip!=""
jsonPayload.src_instance.vm_name=~"gke-.*-sandbox-pool-private-.*"
```

Repeated denied internal probes (example Redis PSA range from inventory):

```text
resource.type="gce_subnetwork"
logName:"compute.googleapis.com%2Fvpc_flows"
jsonPayload.connection.dest_ip:"10.107.45."
jsonPayload.reporter="SRC"
```

Threshold guidance:

- **>50 distinct denied private/metadata destination IPs** from one sandbox node
  in 15 minutes → investigate possible exfil/scan attempt.
- **>1 GiB egress bytes** from one sandbox exec pod IP to public destinations in
  1 hour → investigate abuse; correlate with
  `sandbox_exec_egress_job_duration_ms_max{mode="full_public"}`.

## IPv4-only and foundation residuals

- Chart contract is **IPv4-only** (`networkPolicy.sandboxEgress.ipFamily: IPv4`).
  IPv6/dual-stack fails Helm validation until a future audited inventory lands.
- Squid remains reachable for **restricted** pods via additive NetworkPolicy
  union (not a private-bypass hole).
- Public GKE master endpoint is a live **S6 security blocker**
  (`PUBLIC_MASTER_REACHABLE` to `34.38.46.10:443` from full-public). D4
  gap-close **implemented locally uncommitted on `bd1c3e0c`** (live re-proof
  pending): inventory public-master `/32` in shared public-deny inventory
  (Calico except + sandbox-tagged VPC firewall), fail-closed live endpoint
  equality, and firewall apply updates drifted destinations while keeping the
  public endpoint enabled. New inventory SHA-256
  `589c1c0e0561645dc08cf45a58313450f90ab5c460b939ca6d60692bd2b8126d` (do not
  retcon historical proof SHA
  `c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`).
- Inbound empty-ingress is live-proven **PASS** (`INBOUND_TIMEOUT`) on the
  full-public contour; HTTP redirect and DNS-rebind remain **unclaimed** until
  S6 parent records them (`probe-restricted` does not assert them).

## Related gates

```powershell
node scripts/ci/adr146-active-code-audit.mjs
node scripts/ci/adr146-cross-layer-contract.mjs
corepack pnpm run test:adr146-slice5
node --test scripts/ci/adr146-active-code-audit.test.mjs
node --test scripts/ci/adr146-cross-layer-contract.test.mjs
node --test infra/helm/scripts/sandbox-egress-network-policy.test.mjs
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs verify
```

Predeploy / pre-first-S2-sync structural baseline: default `verify` (absent S2
policy permitted). Post chart/policy sync and before web exposure or owner mode
enablement: `verify --require-s2-policy` (RUNBOOK D10 step 4).

`test:adr146-slice5` runs in `.github/workflows/full-verification.yml` after
checkout, Node/pnpm install, Helm setup, and Prisma checks; it performs no cloud
or deploy mutation. The active-code audit currently scans 12 required roots
(including generated contracts, runtime-contract/config, and Prisma schema),
fails on missing/read-error/symlink roots, and enforces a minimum file count.
It is a lexical non-adversarial static gate: direct and bracket legacy
identifiers plus obvious quoted concatenations are detected, but it is not a
general JavaScript parser.
