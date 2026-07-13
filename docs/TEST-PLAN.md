# Test Plan

This document defines the current verification baseline for the active PersAI-native path.

ADR-072 is closed as the historical native migration ADR. Current continuation work should be checked against `docs/ADR/078-consolidated-follow-through-program.md`. `Step 15a` is cancelled and is not an active verification track. ADR-087 defines the unified quota-advisory and paid light-mode target state. ADR-088 defines the unified notification platform target state.

## ADR-146 assistant-owned full-public sandbox egress (accepted target)

Slice 0 read-only audit is complete and implementation was NO-GO until the live
foundation passed: live `personal-ai-gke` had no enforcing NetworkPolicy engine
until Slice 0.1 was applied. **Slices 0.1 + 0.1b are live-accepted**
(2026-07-13). Slice 0.1 is the founder-selected current-cluster Calico plus
private/dedicated sandbox egress, Cloud NAT/flow-log, and L3 firewall
foundation under `infra/bootstrap/adr146-sandbox-egress-foundation.*`. **Final
live restricted foundation gate PASS** at proof pin `e5c249c3` (sandbox image
`8a0043dd`) with evidence inventory SHA-256
`c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7` (structural
RESULT; trusted controls; NAT `34.76.34.111`; DNS; allowlisted HTTPS; Squid
CONNECT denial for `example.com`; direct-public bypass denial; Kubernetes API;
metrics-server; Redis; Filestore; Cloud SQL; kube-dns Pod UDP/TCP;
same-namespace sandbox control-plane Pod; every node kubelet; metadata
`169.254.169.254` denial; controlled-probe cleanup with no pods remaining).
Inbound denial, HTTP redirect, and DNS-rebind remain explicitly unclaimed
RUNBOOK checks. GitHub Environment `persai-dev-adr146-foundation` is
**approved**; deferred-pin resume run `29237479924` succeeded; current bot pin
`64be77d6` has `api`/`web`/`runtime`/`provider-gateway` exact `3cd2ea4f` and
sandbox remaining `8a0043dd` (Argo Synced; post-rollout
`https://persai.dev/api/health` 200 `{status:ok}`,
`https://persai.dev/api/ready` 200 `{status:ready}`, MCP smoke
`ADR146_POST_ROLLOUT_OK`). ADR-146 stays open; **S1 is explicitly authorized as
the next slice** and is **not** implemented. Each later slice runs the full AGENTS gate plus affected
API/runtime/sandbox/web tests; infra slices additionally run Helm lint/template
and live negative acceptance.

### ADR-146 Slice 0.1 local foundation checks

When a change touches the ADR-146 GKE foundation inventory, bootstrap planner,
or RUNBOOK sequencing, run:

```powershell
corepack pnpm run test:adr146-foundation
node --test infra/helm/scripts/sandbox-egress-proxy-squid-conf.test.mjs
node infra/helm/scripts/sandbox-egress-proxy-squid-conf.mjs
# Optional explicit parse gate (no normal-test network pull; use --pull only when requested):
#   node infra/helm/scripts/sandbox-egress-proxy-squid-conf.mjs --require-parse
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs static-check
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs plan
# Windows-native (no bash wrapper required):
#   node infra/bootstrap/adr146-sandbox-egress-foundation.mjs <phase>
helm lint infra/helm -f infra/helm/values.yaml -f infra/helm/values-dev.yaml
helm template persai-dev infra/helm -f infra/helm/values.yaml -f infra/helm/values-dev.yaml > $null
corepack pnpm exec prettier --check docs/TEST-PLAN.md docs/ARCHITECTURE.md docs/SESSION-HANDOFF.md docs/CHANGELOG.md docs/ADR/146-assistant-owned-full-public-sandbox-egress.md infra/bootstrap/README.md infra/bootstrap/adr146-sandbox-egress-foundation.mjs infra/bootstrap/adr146-sandbox-egress-foundation.test.mjs infra/bootstrap/lib/foundation.mjs infra/bootstrap/lib/cidr.mjs infra/dev/gke/RUNBOOK.md infra/helm/scripts/sandbox-egress-proxy-squid-conf.mjs infra/helm/scripts/sandbox-egress-proxy-squid-conf.test.mjs
```

Required local invariants:

1. Inventory CIDRs include live Service `34.118.224.0/20`, nodes `10.132.0.0/20`,
   Pods `10.107.128.0/17`, sandbox secondary `10.109.0.0/20`, and PSA/Redis/Filestore
   peers with no critical overlap.
2. Plans require Calico enablement with explicit node recreation; Helm
   `networkPolicy.enabled` is not treated as the engine. Structural verify must
   not call Calico readiness labels “enforcement proof”; active probes remain
   required.
3. Private sandbox pool create uses `--sandbox=type=gvisor` and live verification
   requires `sandboxConfig.type=gvisor` plus `workload=sandbox` + gVisor taint,
   least-privilege node SA (no Editor), and `--enable-private-nodes`. Labels/
   taints alone are insufficient.
4. After private pool Ready, `apply-sandbox-pool` fail-closed cordons the legacy
   public pool (exact nodepool selector; all old nodes unschedulable) without
   deleting it or killing running jobs. Maintenance-gated retirement stays
   separate.
5. VPC firewall denies all protocols only to explicit reviewed _other_ VPC
   subnets, PSA/Redis/Filestore, and safe special-use CIDRs. Tests reject the
   own node-primary `10.132.0.0/20`, broad `10/8`, Pod, Service, or metadata
   denies unless higher-priority required-path ALLOWs exist. Conflicting higher-
   priority EGRESS ALLOW rules targeting the sandbox tag/destinations fail
   closed. Calico owns node/Pod/Service/metadata/same-node enforcement.
6. Rendered Helm has identity-less/no-RBAC/no-WI `sandbox-exec-sa`, every exec
   pod names it with token automount false, empty ingress, exact NodeLocal +
   kube-dns Service `/32` UDP/TCP 53 (ipBlock-only peers), exact Squid proxy
   port, and the complete values-owned proxy deny inventory. Exec/proxy/NAT-probe
   top-level and peer selectors have exact matchLabels and reject
   namespaceSelector/podSelector/matchExpressions widening. Helm fails if required
   denies are absent. Live structural verify for that KSA allows only the
   explicit inert controller bookkeeping annotation allowlist
   (`argocd.argoproj.io/tracking-id`,
   `kubectl.kubernetes.io/last-applied-configuration`) and fail-closes on
   WIF/GCP identity, arbitrary, or security-relevant annotations. Live
   NetworkPolicy structural verify treats omitted/null `spec.ingress` as
   semantically empty deny-all (Kubernetes omits submitted `ingress: []`) and
   still rejects any non-empty ingress; matcher helpers return strict booleans.
   `sandbox-egress-proxy` ConfigMap `logformat persai_egress`
   must render exact static `tool=shell`, retain `%ru` destination audit, and must
   not include unsupported `%ssl::*` tokens (pinned `ubuntu/squid:6.6-24.04_edge`
   → Squid 6.14 GnuTLS / no OpenSSL SSL-Bump). Deployment pod template must carry
   `checksum/squid-conf` as sha256 of the exact
   `persai.sandboxEgressProxy.squidConf` helper body (not a manual revision
   counter) so ConfigMap content changes recreate the Pod despite `subPath`;
   ConfigMap-only sync is not a heal path. Local regression:
   `node --test infra/helm/scripts/sandbox-egress-proxy-squid-conf.test.mjs`
   (includes checksum change on config-driving values) plus optional
   `squid -k parse` when the pinned image is already present (no normal-test
   network pull).
7. Final structural verify cannot claim exec KSA wiring with zero qualifying
   Running exec pods; default-SA pods fail. Object-level KSA readiness alone is
   pre-rollout structure, not live wiring proof. Zero real Running exec pods
   before controlled restricted probe apply is an expected live-wiring fail and
   must not be weakened.
8. Every mutating execute phase starts with fresh live preflight; existing
   resource drift fails closed rather than existence-skipping.
9. Structural verify and founder-approved dynamic probes are separate; local
   tests never count as live proof. Automated `probe-restricted` does **not**
   claim inbound denial, HTTP redirect, or DNS-rebind.
10. Rollback forbids disabling NetworkPolicy; no feature flag or dual runtime.
11. NAT is `MANUAL_ONLY`/static/`ALL`-logged and selects the cluster subnet
    primary plus dedicated sandbox Pod secondary. Default GKE public Pod traffic
    remains node-SNATed; no cluster-wide nonMasquerade/disable-SNAT change is
    allowed. Structural verification rejects any eligible regional/VPC
    no-external-IP consumer that is not a tagged private sandbox node.
12. The repository release gate is enforced for ADR-146 foundation marker
    pushes: sandbox pins immediately after a successful sandbox image build;
    remaining service pins wait on ordered GitHub Environment approvals —
    foundation-only → `persai-dev-adr146-foundation`; migration-only →
    `persai-dev-migrations`; foundation+migration → foundation Environment
    approval first, then migrations Environment pin (neither bypassed). Exact
    markers include `infra/helm/values.yaml` and both bootstrap lib files;
    `values-dev.yaml` is on the Dev Image Publish path trigger and uses a
    fail-closed base/head classifier: only exact `pin-dev-image-tags.mjs`
    per-service `image.tag` scalar substitutions (authoritative service map in
    `pin-dev-image-tags-lib.mjs`) may skip foundation (empty deploy / no
    build-pin loop). Missing/empty/unavailable base or head content, empty
    unexpected diffs, `global.images.tag`, unknown/nested tags, indentation
    tricks, blanks/comments, or mixed edits force foundation rollout + sandbox
    gate. Main CI still path-ignores `values-dev.yaml`. Tests prove the workflow
    contract and fail closed without a sandbox build/pin. CI does not auto-apply
    foundation mutations or claim live GKE attestation; human Environment
    approval and live parent evidence remain required. Non-foundation pushes keep
    the ordinary immediate / migration pin behavior. Ordinary Dev Image Publish
    pin jobs remain `github.event_name == 'push'` only — do not bypass via
    dispatch. Rejected foundation waits resume through
    `.github/workflows/adr146-foundation-deferred-pin-resume.yml` +
    `scripts/ci/adr146-foundation-release-gate.mjs` validators: decoupled
    target/proof/inventory inputs, no rebuild, sandbox excluded, exact four-service
    set, ancestor + all root build-context inputs (`apps`, `packages`,
    `extensions`, `services`, `scripts/smoke`, workspace manifests,
    `.dockerignore`) fail-closed, GAR manifests, sandbox proof-tag binding, and
    authoritative tag-scalar-only bot commit. The Environment-gated job must
    checkout/fetch fresh `origin/main`; every `pull --rebase` retry must rerun
    request and commit-shape validation before push. Every resume
    `google-github-actions/auth@v3` step must set
    `create_credentials_file: false`; tests reject `gha-creds-*.json` worktree
    pollution. Foundation-only: only boolean `false` or exact string `"false"`
    is accepted for `migration_changed`; true/numeric/empty/missing/mixed-case/
    garbage values fail closed. Authoritative resume pin mutation must equal
    `applyPinDevImageTags` / `pin-dev-image-tags.mjs` output byte-for-byte after
    CRLF→LF only (no trailing-newline strip): the historical CLI
    `` `${lines.join("\n")}\n` `` extra EOF blank line is rejected as unrelated
    mutation; a real-CLI integration test on live `values-dev` accepts only the
    exact four deferred tags and rejects unrelated edits. A real temporary
    bare-origin/runner-clone test commits protected-path drift on newer
    `origin/main`, rebases the stale pin, and proves post-rebase validation
    rejects before push. Locked current case in tests:
    target `3cd2ea4fa0c82d319c2e8e63724c5753f03b5e0f`, services
    `api,web,runtime,provider-gateway`, proof
    `e5c249c3dbb9d16406b85637e9dcdd9a418a8a79`, inventory
    `c9abf3e86a55768937584ae8f105495897da79dda475a5490c927e0986a217f7`. Run
    `corepack pnpm run test:adr146-release-gate`.
13. Active denial acceptance first proves the same live-resolved Service,
    managed-listener, Calico-owned kube-dns Pod IP, trusted control-plane Pod IP,
    and node targets are reachable from a trusted existing control-plane Pod.
    Metadata denial additionally requires a ready `gke-metadata-server`
    DaemonSet. A controlled private-sandbox probe must observe one reserved NAT
    IP from the fixed no-query plain-IP endpoint. Restricted probe also proves
    Squid CONNECT denial for fixed non-allowlisted `example.com` HTTPS via curl
    `%{http_connect}` exact `403` (`%{http_code}` / `000` must not pass). `ECONNREFUSED`
    is never treated as denial; absent targets refuse to false-pass.
14. Local `generate-probe-manifests` produces restricted/NAT probe Pod YAML that
    satisfies the contour validators (private selector, gVisor,
    `sandbox-exec-sa`, automount false, required labels, controlled-probe label,
    canonical gVisor Toleration `operator: Equal` with exact
    `sandbox.gke.io/runtime=gvisor:NoSchedule` — lowercase/`EQUAL`/other casings
    rejected to match apiserver enum failure). Rendering requires exactly one
    non-null exact toleration and throws for missing/empty/null/wrong-casing/
    extra tolerations; it never supplies a fallback. The manifests also keep
    bounded `activeDeadlineSeconds`, non-root/read-only/seccomp/resources, and
    no proxy env on NAT. NAT probe image is inventory-owned digest-pinned
    `curlimages/curl:8.21.0@sha256:7c12af72ceb38b7432ab85e1a265cff6ae58e06f95539d539b654f2cfa64bb13`
    (compatible with hardened `runAsUser: 1000`). Restricted generation resolves
    the exact current production image from committed `values-dev.yaml` as
    `${global.images.registryHost}/${global.images.projectId}/${global.images.repository}/${sandboxExec.image.name}:${sandboxExec.image.tag}`
    and the exact ordered six-entry proxy env from
    `sandbox.env.SANDBOX_EXEC_EGRESS_PROXY_URL` + `SANDBOX_EXEC_NO_PROXY`
    (`HTTP_PROXY`/`HTTPS_PROXY`/`http_proxy`/`https_proxy` = proxy URL;
    `NO_PROXY`/`no_proxy` = no-proxy value). Missing/duplicate/malformed fields,
    credentials, empty proxy/no-proxy, wrong order, and missing builder image/env
    fail closed, with no inventory tag, global-tag, BusyBox, or empty-env
    fallback. A dedicated unit test swaps two otherwise-valid entries and
    requires both env validation and manifest construction to reject it. Live
    restricted validation requires equality with exactly one production contour
    `{image, env}` across valid non-controlled Running real exec Pods used for
    KSA proof; zero real Pods, missing image/env, conflicting images/envs,
    controlled-label spoof, duplicate/extra/wrong-order/credential env, and
    mismatch all fail. Equality is the proof basis for `getent`/`curl`/`python3`; static tests
    do not claim those binaries were executed. Active restricted source contract:
    allowlisted HTTPS curl inherits proxy env; direct public bypass explicitly
    unsets `HTTP_PROXY`/`HTTPS_PROXY`/`http_proxy`/`https_proxy`. NAT
    builder/validators fail closed on image drift (tag-only/busybox/wget/override)
    and require zero proxy/no_proxy env. Active `nat-egress-ip` source contract
    execs `curl --noproxy * -fsS --max-time 20` with certificate verification (no
    `-k`/`--insecure`/`--no-check-certificate`/wget).
    `exec-ksa-live-wiring` excludes controlled probes and
    requires ≥1 real Running exec pod. `collectLive` exec-pod normalization
    must preserve exact live `spec.tolerations` so admitted controlled probes
    pass contour validation; live admitted Pod validators require the exact set
    of three tolerations (one canonical gVisor plus the two known Kubernetes
    default injected tolerations; no extras/duplicates/wrong seconds/casing)
    while generated manifests/renderer remain fail-closed on exactly one explicit
    gVisor toleration. Tests map kubectl Pod items through
    `mapExecPodFromKubectlItem` and prove generated one-only, live exact-three
    pass, and missing/wrong/extra/default failures.
    Operators must run
    `cleanup-controlled-probes --execute` after probes on success and failure
    paths (exact names/labels only; never broad-delete production exec pods).
    Verify reports any controlled probe Pods still present. Plan/verify/
    generate-probe/probe evidence fails closed on dirty trees, unavailable git,
    or disk≠commit inventory mismatch (never `UNAVAILABLE`). Manifest generation
    never applies to the cluster from CI.

Live-only (founder-approved `--execute`, not part of ordinary local gate):

```bash
./infra/bootstrap/adr146-sandbox-egress-foundation.sh apply --execute
./infra/bootstrap/adr146-sandbox-egress-foundation.sh retire-public-pool \
  --execute \
  --maintenance-confirm NO_ACTIVE_SANDBOX_JOBS_CONFIRMED
./infra/bootstrap/adr146-sandbox-egress-foundation.sh verify
./infra/bootstrap/adr146-sandbox-egress-foundation.sh probe-restricted \
  --execute \
  --probe-pod adr146-restricted-probe \
  --nat-probe-pod adr146-nat-probe
./infra/bootstrap/adr146-sandbox-egress-foundation.sh cleanup-controlled-probes \
  --execute
```

Windows operators may invoke the same phases directly:

```powershell
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs plan
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs static-check
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs verify
```

Automated acceptance must prove:

1. Existing/new assistants default to `restricted`; non-owners cannot read or
   mutate another assistant's mode.
2. The removed plan/runtime `networkAccessEnabled` field is absent from active
   contracts, parsers, admin UI, fixtures, and generated artifacts.
3. Restricted pods have proxy env and can reach only DNS + allowlist Squid;
   direct bypass still fails when proxy env is unset.
4. Full-public pods have no proxy env and can reach unrelated public TCP/UDP
   fixtures directly.
5. Both modes have empty ingress. Full-public cannot reach loopback, RFC1918,
   CGNAT, link-local, GKE/Compute metadata, node, Pod, Service, Kubernetes API,
   control-plane, or peered-VPC destinations; redirect and DNS-rebinding
   fixtures to those ranges also fail.
6. Exec pods use the dedicated no-IAM/no-Workload-Identity ServiceAccount and
   keep `automountServiceAccountToken: false`, gVisor, non-root, read-only root,
   and existing resource limits.
7. A warm pod with the wrong egress-mode label is deleted and recreated before
   command execution; a queued/running job blocks a mode change.
8. Model-started descendant processes cannot survive job completion.
9. Two assistants in one workspace can use different modes; `files.*`,
   `grep`/`glob`, browser/web tools, and provider workers are unchanged.
10. Audit/log/metric payloads identify mode and assistant/job without recording
    URL query strings, auth headers, credentials, or file contents.

Live GKE acceptance after an explicitly approved deploy repeats the restricted
allowlist test, full-public success test, complete private/internal/metadata
negative matrix, warm-pod UID replacement on enable/disable, secret-free env,
audit/flow logs, and rollback to all-`restricted`.

## ADR-145 chat-list archive + mobile row actions

Automated:

```powershell
corepack pnpm --filter @persai/web exec vitest run app/app/_components/sidebar.test.tsx app/app/_components/pull-to-refresh.test.tsx
corepack pnpm --filter @persai/api exec tsx --test test/manage-web-chat-list.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Manual phone:

1. Confirm assistant name and New chat are 16px; rows are about 10% taller and
   the three-dot target is comfortably tappable.
2. Swipe an active row left. Archive copy must follow the finger; releasing
   below threshold snaps back, above threshold archives without opening chat.
3. Pull down at list top. The first qualifying pull reveals Archive instead of
   refreshing. Tap Archive to expand/collapse; a later pull refreshes.
4. Swipe an archived row right to restore it. Vertical scroll must not trigger
   either horizontal action.
5. Tap three dots: `Delete | Rename` slides in within the row. Delete requires
   a second confirmation. Re-tap, outside tap, and 10s idle close it; only one
   row may remain open.

Manual desktop / medium shell:

1. Archive is visible at the top only when non-empty and expands/collapses.
2. Row actions retain the compact portal menu; archived rows show Restore
   instead of Archive.
3. Restoring at the active-chat plan limit leaves the row archived and the API
   returns 409.

## ADR-144 adaptive orientation + medium shell

Automated:

```powershell
# PersAI
corepack pnpm --filter @persai/web exec vitest run app/app/_components/app-shell.test.tsx app/app/_components/sidebar.test.tsx
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/web run build

# persai-mobile/android
.\gradlew.bat :app:compileDebugJavaWithJavac :app:testDebugUnitTest
npm run android:release
```

Manual Android:

1. Ordinary phone: rotate the device; PersAI must stay portrait.
2. Fold outer display: PersAI stays portrait and single-pane.
3. Unfold without restarting: rotation becomes available; at width `>=600px`
   the persistent 240px sidebar appears and chat state is preserved.
4. Rotate unfolded to landscape and back; no stale split, clipped right pane,
   or WebView/chat reset.
5. Fold again: shell returns to single-pane and portrait policy.

Manual iOS/iPadOS:

1. iPhone simulator/device: portrait only.
2. iPad: all four declared orientations work; landscape uses the desktop
   shell and preserves active chat state.
3. iPad multitasking narrower than 600px returns to the mobile shell without
   requiring a native device-class branch.

Web geometry:

1. Check 599px/600px/767px/768px/1024px viewport widths.
2. At 600–1023px sidebar is 240px; at 1024px it is 280px.
3. Desktop sidebar and main surface have matching 22px rounding and 8px gutter;
   compact mobile remains full-bleed/unrounded.

## Chat plan pill + thread-state isolation (focused checks)

When changing plan chrome or thread-switch state, run:

```bash
corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-plan-card.test.tsx app/app/_components/chat-area.test.tsx
corepack pnpm --filter @persai/web exec vitest run app/app/_components/use-chat.test.tsx -t "chat plan integration"
corepack pnpm --filter @persai/web run typecheck
```

Manual phone:

1. Confirm the plan circle and expanded pill share the header's left edge and sit about 8px below it.
2. Confirm the circle shows `completed/total`; first tap opens the compact pill and second tap opens the list.
3. Confirm 10s idle or tapping outside returns compact/list state to the circle with a width transition.

Manual desktop:

1. Confirm the compact plan pill shares both header edges and the same 8px vertical gap.
2. Confirm opening the list and waiting 10s or clicking outside returns to the compact pill (never the mobile circle).
3. From a chat with active skill + plan, click New chat; neither old value may appear while the fresh draft initializes. A delayed old-plan response must also remain invisible.

## ADR-143 tiered tool observation projection (focused checks)

When a change touches model-facing tool history projection, prior-tool-exchange replay, or in-turn `toolHistory` wiring, run:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/project-tool-exchanges-for-model.test.ts runProjectToolExchangesForModelTest
corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/turn-execution.service.test.ts runTurnExecutionServiceTest
corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/turn-context-hydration.service.test.ts runTurnContextHydrationServiceTest
corepack pnpm --filter @persai/runtime run typecheck
```

Regression / live (post-deploy):

1. Long browser loop / Lavka: the model still completes the turn with projected history (newest exchange structurally full; older steps compact/masked); provider input must not reintroduce a second truncate path alongside projection.
2. Cluster logs for tool-loop iterations include one `[toolHistoryProjection] requestId=… rawChars=… projectedChars=… fullCount=… compactCount=… maskedCount=…` line per projected in-turn provider build; `projectedChars` should be materially below `rawChars` on multi-step browser turns.
3. Canonical stored `toolExchanges` remain full; only provider-facing history is projected.

## ADR-140 local browser bridge + headless Browserless boundary (focused checks)

When a change touches browser profiles, the local bridge relay/runtime path, Telegram/browser handoff copy, headless Browserless public-read behavior, or browser settings/modal UX, run:

```bash
corepack pnpm --filter @persai/api exec tsx test/assistant-browser-profile.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/extract-pending-browser-login-from-turn.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-pending-browser-login-for-web-chat.test.ts
corepack pnpm --filter @persai/api exec tsx test/runtime-browser.test.ts
corepack pnpm --filter @persai/api exec tsx test/tool-catalog-data.test.ts
corepack pnpm --filter @persai/api exec tsx test/telegram-channel-adapter.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-browser-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/native-tool-projection.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/sanitize-tool-result-for-model.test.ts
corepack pnpm --filter @persai/provider-gateway exec tsx test/provider-browser.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/browser-bridge-client.test.ts app/app/browser-bridge-page-runner-source.test.ts app/app/_components/browser-login-modal.test.tsx app/app/_components/browser-bridge-connection-maintainer.test.tsx app/app/_components/assistant-settings.test.tsx app/app/_components/chat-area.test.tsx app/app/_components/use-chat.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/provider-gateway run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Live acceptance (post-deploy):

1. Public `browser.snapshot` without `profile` still uses headless Browserless and returns text plus `page.elements`.
2. Public `browser.snapshot` with `format:"png"|"pdf"` and no `profile` still returns attachable artifacts through the headless path.
3. `browser.login` with `displayName` + login `url` on desktop web auto-opens the local-bridge modal and completes to `active`.
4. `browser.login` on Capacitor opens the native bridge view inside the system-bar/display-cutout safe area; after manual login, Back → Done completes through lightweight `check_view` (cookie flush + liveness, no page runner) and reaches `active` without a long spinner or `Failed to fetch`.
5. `browser.snapshot` / `browser.act` with `profile` returns authenticated content through the local bridge without re-login.
6. Profile-backed `act` using a selector from `page.elements` succeeds or returns an honest per-operation warning, never a transport-shaped live-link fallback.
7. Page text, selectors, form attributes, and typed values never infer `needs_user_action`; ordinary profile `snapshot`/`act` continues regardless of CAPTCHA/OTP/payment vocabulary.
8. From the first assistant-owned profile `snapshot`/`act` until that assistant's stream ends, the same configured desktop/mobile session is observer-only between commands as well as during them: click, scroll, swipe, wheel, context-menu, and keyboard page input are blocked; tapping the mobile miniature remains read-only; assistant coordinate/DOM actions still reach the underlying page; screenshots do not contain the ownership overlay. At stream completion input returns. An explicit `browser.request_user_action` Open transfers ownership before stream completion.
9. For CAPTCHA, OTP/verification, payment, irreversible confirmation, or another manual step, the model calls `browser.request_user_action` with the saved profile and exact `userActionPrompt`. PersAI shows the handoff card without opening the page, even when the current local bridge is temporarily disconnected; bridge availability is checked only when the user presses Open. User Open reveals the current surface or reports the connection issue; Done hides it and starts a continuation turn; no browser command is retried before that turn.
10. Mobile Back from an observer or user-action view hides the native overlay and returns to PersAI without destroying the retained profile/session.
11. A profile snapshot whose requested URL is equivalent to the retained page (including empty-path versus `/`) skips navigation and returns without paying the former ~31-second navigation-timeout + DOM-wait path.
12. Forced true expiry still returns `browser_profile_expired` business error, not stack trace.
13. Web re-auth reopens the modal/banner without any assistant-visible `liveUrl`.
14. Start a new desktop browser login and press Cancel before Open; repeat by pressing Open and immediately Cancel before the request settles. Pending UI clears immediately, the profile is deleted, the open request is aborted, targeted Close is ordered after any accepted Open, and no extension window is created, focused, resized, flashed, or revealed late.
15. Telegram public no-profile browser reads still work through headless Browserless.
16. Telegram logged-in/profile-backed browser work returns structured `open_in_app` / `bridge_unavailable` semantics with PersAI web/app copy, not login links or live URLs.
17. Delete profile from settings removes the row and prevents reuse.
18. On Android/iOS, snapshot `https://ya.ru` from an active profile whose page enforces a strict `script-src` without `unsafe-eval`. The packaged runner returns normal page state; it must not fail with a CSP `Evaluating a string as JavaScript` error.
19. Keep a connected bridge idle for at least 15 minutes, then run a profile-backed snapshot: the same stable `bridgeDeviceId` remains targetable (or renews in place) and no `bridge_unavailable` occurs.
20. With two Chrome installations connected, log a profile in on one installation, renew/reconnect that installation, and verify the profile remains pinned to its original stable device id rather than becoming ambiguous.
21. On the first desktop `snapshot`/`act`, the extension opens a focused, non-technical PersAI browser-access window (not the bridge-status popup), explains Chrome's broad-access requirement, waits for the explicit user click, and resumes the original command. Later text and PNG/JPEG commands succeed without another permission prompt or the `activeTab` / `<all_urls>` capture error.
22. Click an active configured-session card in desktop settings: only one consistently sized extension window opens; no web modal is shown. Force an open error and verify a quiet inline connection error appears instead of the login modal; the active profile remains listed, and no Cancel/close action deletes it. Explicit trash remains the only settings deletion action.
23. Click an active configured-session card in mobile settings: the native browser overlay opens directly without the web modal; one system Back press hides the overlay and returns to the app, while the configured-session card remains mounted during background reconciliation.
24. On Android, return from an active Mail.ru profile to PersAI, then invoke hidden profile-backed `snapshot` and `act`: page-runner Promise/timer work completes while the overlay remains absent and does not end in `Timed out waiting for page execution` / secondary `bridge_connection_closed`. While the command is pending, the underlying PersAI UI remains tappable/typeable.
25. From a retained `https://mail.ru/` Capacitor profile, execute direct goto to `https://account.mail.ru/login` and follow its cross-origin redirect chain. A late commit/finish from the old page must not complete the command; destination-origin cookies must be activated without replacing the original command/deadline; returned `finalUrl` must reflect the committed destination or an honest navigation error. The existing profile must remain active without recreation.
26. Click a normal HTTP(S) anchor that navigates away (Mail.ru `Войти в почту` is the live fixture). The page runner must return its `navigationUrl` before navigation destroys the JavaScript context; native must perform the cookie-aware navigation and continue later segments without a ~110-second page-execution timeout or an equivalent duplicate goto.
27. With desktop extension and mobile bridge both connected, tap an active profile card on mobile. `open-live` targets the phone's current `bridgeDeviceId`, persists matching `bridgeSessionRef + bridgeClientKind: capacitor`, and the next assistant profile command remains on mobile (never returning a Chrome host-permission error). Repeat from desktop and verify the pair atomically rebinds to the selected extension.
28. Without opening settings first, send a fresh browser instruction from Capacitor while desktop Chrome is also connected. Runtime logs `bridgeTarget=current_turn bridgeKind=capacitor`; Android receives the command; Chrome receives nothing. Then send from connected desktop and verify only that extension receives it. Disconnect each current surface in turn and verify the request fails honestly without falling back to the other device. Each successful switch persists the relay-authenticated ref/kind pair.
29. On a retained Lavka Capacitor profile, run an ordinary non-anchor `act` such as focusing or typing into search. An absent declarative navigation target must be omitted by the runner and decoded as null by native; it must never attempt to load the literal `"null"` or return `Target URL must include a valid http or https origin`.
30. From a different retained Lavka path, run `act` with top-level URL `https://lavka.yandex.ru/search` and no `stayOnPage`. If Yandex immediately canonicalizes it to `/`, the observed valid main-frame navigation action must start the pending redirect chain and complete normally; it must not wait for the 30-second navigation deadline. A stale commit callback without a corresponding main-frame navigation action must remain rejected.
31. On Android, start a background profile-backed `snapshot` or `act` and leave the phone untouched longer than the system display timeout. The screen remains awake until the final success/error result, then the normal display-timeout policy resumes. Repeating with concurrent commands must keep the screen awake until the last command completes.
32. On desktop extension and Capacitor, open a page that builds content after `DOMContentLoaded`. Snapshot must wait for an `interactive` document with a body and 750 ms of DOM quiet, without text-length/control-count/site heuristics or a second readiness wait. A continuously mutating page must still return within the 10-second cap with current content and `page.loadStatus: "partial"`; a quiet page returns `"stable"`.
33. Start a new desktop or mobile browser login. The completion surface shows only the completion title, centered `Open <profile>` pill, concise helper copy, quiet connected indicator, and pill Done/Cancel actions. Detailed help appears only after `?`; connected state has no status card. Missing desktop extension shows a compact two-line warning with its retry button centered on a separate row; that extension-only block never renders in the Capacitor flow.
34. On desktop, reveal a saved profile from Settings or an assistant handoff after it was minimized or previously small. The same extension window restores centered at 70% of the largest normal Chrome window in 16:9, rather than retaining minimized/popup dimensions. Also verify the first assistant `snapshot`/`act` that creates a new profile window (hidden/`showWindow: false`) still allocates that canonical 16:9 size before minimize — not Chrome's narrow default popup. On mobile, the native browser opens only after explicit Open and system Back returns to the concise completion surface.
35. Reload/navigate the PersAI tab while the Chrome extension has a fresh registration. Content-port disconnect must not throw `Attempting to use a disconnected port object` or intentionally close the registered relay socket. Immediately send an assistant browser instruction while the cached bridge status is still `connected:false`; web must re-probe the live extension and include its exact `bridgeDeviceId`, so assistant-triggered `open_live` reaches the same extension window as the Settings card.
36. In the Capacitor app, run a profile-backed `act` containing multiple operations. A small image-only browser miniature appears after native capture, refreshes after every operation, preserves the current viewport ratio, and has only a small favicon treatment; tapping it reveals the same retained native browser profile. It briefly lingers after completion and disappears. Repeat on a narrow phone, an open Fold/tablet-sized window, and after rotation: sizing follows only the available viewport and safe area, with no device/UA/Fold branch. Desktop web renders no miniature and keeps the extension's 16:9 window unchanged. Capture/listener failure or an older APK must not alter the browser command result.
37. On desktop extension, run profile-backed acts that navigate across long-lived or poorly reachable pages such as ria.ru, lenta.ru, habr.com, and spacex.com. Navigation must proceed after a new main-frame `webNavigation.onCommitted` document and then use the existing 10-second DOM-stability gate; it must not wait for `tab.status=complete`. Page-runner inject is capped at 15 seconds, the default bridge command budget is 45 seconds (max remains 120), and unreachable sites must return a structured executor/timeout error well under the old exact-120-second `bridge_command_timeout` hang. A commit carrying the previous main-frame `documentId` must not release the command, while canonical/server redirect commits remain valid.

## ADR-133 Slice 1 path-contract focused checks

When a change touches only the shared hierarchical workspace path contract (constants/builders/classifiers/docs) without migrating sandbox/API/runtime behavior yet, run:

```bash
corepack pnpm --filter @persai/runtime-contract exec tsx --test test/workspace-path-contract.test.ts
corepack pnpm --filter @persai/runtime-contract run typecheck
corepack pnpm run format:check
```

Interpretation rules:

1. `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/...` must classify as valid hierarchical session space, and assistant/workspace widen roots must stay valid.
2. Root-level flat paths such as `/workspace/report.pdf` must be rejected/classified as `rootFlatFile`.
3. `/workspace/chats/...` and `/workspace/projects/...` must classify as stale/invalid for the active ADR-133 default model, even if later behavior slices still carry temporary compatibility code elsewhere.
4. Slice 1 is pure contract wiring only: comments/tests may mark legacy flat/project/outbound surfaces as historical, but no sandbox/API/runtime/web default-path behavior should change in this slice.

## ADR-133 Slice 2 sandbox/GCS focused checks

When a change touches sandbox default cwd/search/list/write behavior, sandbox workspace persistence, or sandbox GC for ADR-133, run:

```bash
corepack pnpm --filter @persai/sandbox exec tsx --test test/workspace-file-bridge.service.test.ts test/workspace-gc.service.test.ts test/sandbox.service.test.ts
corepack pnpm --filter @persai/sandbox run typecheck
corepack pnpm run format:check
```

Interpretation rules:

1. `shell` / `exec` cwd and `grep` / `glob` default paths must stay under `/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/...` when a runtime session exists.
2. Basename-only sandbox writes and hot control-plane writes must land under the current session root; explicit flat root writes such as `/workspace/report.pdf` must not silently remain the default creation path.
3. Persisted sandbox workspace object keys must mirror the visible hierarchical path tree rather than flattening to `/workspace/<file>`.
4. Session, assistant, and workspace cleanup must target the correct subtrees and expose subtree-oriented audit semantics even if producer lease rows still use historical enum names.
5. Slice 2 remains sandbox-only: API upload/manifest/delivery/document-path ingress and model-facing prompt/runtime/web teaching are verified in later ADR-133 slices, not here.

## ADR-133 Slice 4 runtime/prompt-owner focused checks

When a change touches runtime `files` / `document` behavior, Working Files wording, native tool projection, bootstrap/tool-catalog prompt owners, or ADR-133 stale-string guards, run:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.attach.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/native-tool-projection.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/working-files-developer-section.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-delivery-facts.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/tool-catalog-data.test.ts test/runtime-tool-policy.test.ts test/adr119-golden-prompt-snapshot.test.ts
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Active runtime behavior must use the real session root as the default working area, but model-facing write guidance must not ask the model to construct assistant/session IDs. New files use `requestedName`, basename, or relative paths; the runtime owns the actual session-root path.
2. Positive fixtures and prompt text must not preserve flat `/workspace/<file>` examples, `workspace_shared`, `crossScope:true`, or `Current chat / this session` wording except as explicit negative guards.
3. Working Files must describe current session files while preserving sticky aliases, micro-descriptions, and exact-path addressing rules.
4. `files.write` exact overwrite stays boolean `replace: true`; Slice 4 must not preserve active runtime/model-facing `mode:"overwrite"` compatibility teaching.
5. Slice 4 remains runtime/prompt-owner scoped: web/UI/OpenAPI/docs closure and final product wording alignment are verified in Slice 5.

## ADR-134 workspace file micro-description focused checks

When a change touches `workspace_file_metadata.shortDescription`, path-keyed micro-description jobs, `files.search`, Working Files semantic hints, or upload enqueue policy, run:

```bash
corepack pnpm --filter @persai/api exec tsx test/workspace-file-micro-description.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/search-workspace-files-from-manifest.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/tool-catalog-data.test.ts test/runtime-tool-policy.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. The sole durable semantic index is `workspace_file_metadata.shortDescription`; there must be no active mirror in `assistant_chat_message_attachment.metadata` and no revived `AssistantFile` / `assistant_upload_micro_description_jobs` enqueue path.
2. Project-mode uploads always enqueue a background job when `shortDescription` is still empty; ordinary/B2C uploads enqueue only when `routerPolicy.analyzeUploadsOnB2cUpload === true` (default `false`); model-generated paths (`files.write`, delivery, attach binary) bypass the B2C gate.
3. Deterministic STT / text_extract one-liners must upsert `shortDescription` synchronously without enqueueing LLM when informative.
4. Working Files lines for normal session attachments must carry non-empty `semanticSummaryHint` when manifest has a description (not `unknown | - | -`).
5. **`files.search` acceptance:** tokenized natural-language query (e.g. `"photo cap"`) against manifest rows whose `shortDescription` mentions the subject must return the correct hierarchical `/workspace/assistants/<assistantId>/sessions/<sessionId>/...` path; results include `shortDescription` and discovered aliases (`found file #N`).
6. After deploy, live acceptance must cover B2C toggle ON/OFF upload behavior, NL discovery via `files.search`, and generated-file summary via `generation_request` and/or background job lag (~30–60s).

## ADR-133 Slice 5 web/UI/docs focused checks

When a change touches the assistant-settings file gallery, the public workspace-files list route, web/client scope wording, or the ADR-133 docs closure, run:

```bash
corepack pnpm --filter @persai/api exec tsx test/list-chat-workspace-files.service.test.ts test/media-attachment.controller.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/assistant-api-client.test.ts app/app/_components/assistant-settings.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm run format:check
```

Interpretation rules:

1. Public gallery/list request shapes and visible labels must use `session | assistant | workspace` (or the final approved equivalent) and default to current-session provenance when an active web chat is available.
2. Assistant Settings Files must widen truthfully to `Current session`, `This assistant`, and `Workspace`; it must not fall back to stale `This chat` / `All files` wording.
3. Positive active web/API/docs fixtures must not keep flat-root `/workspace/*.pdf|txt|csv|docx|xlsx` examples, `/workspace/chats`, `/workspace/projects`, `workspace_shared`, or `crossScope:true` except as explicit negative guards or historical changelog/archive references.
4. `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `ADR-133`, `CHANGELOG.md`, and `SESSION-HANDOFF.md` must agree that Slice 5 is landed locally while the final full acceptance gate remains pending.

## ADR-132 document surface focused checks

When a change touches `document.inspect`, `document.render`, `document.convert`, document auto-registration, or `files.attach` delivery of `pdf`/`docx`/`xlsx`, run these focused checks before the broad gate:

```bash
corepack pnpm --filter @persai/api exec tsx test/register-chat-attachment.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/document-workspace-version-registration.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/document-workspace-inspection.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/upsert-workspace-file-metadata-from-runtime.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-delivery-facts.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-sandbox-tool.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. `files.attach` for an existing allowed PDF/DOCX/XLSX workspace file must create the chat attachment row before best-effort inspect/register/documentLink metadata enrichment; enrichment failure must log a warning and must not drop delivery.
2. Active document outputs and attachment paths must live under the real current runtime session root; root-flat `/workspace/*.pdf|docx|xlsx` outputs are rejected for active ingress, while document metadata facts remain nullable and must not block chat delivery. Model-facing document creation uses `requestedName`, not a model-authored absolute session path.
3. `document.render` and `document.convert` must not recreate the old active `project.json` workflow for ordinary authored/convert outputs. Authored revisions use the sibling `.md` file and re-render at the same `outputPath`.
4. Removed model-facing verbs (`document.extract`, `document.edit`, `document.register_version`) remain hard-rejected. Internal extraction/OCR code may keep extraction naming only behind `document.inspect`.
5. Shell overwrite registration flows through sandbox `producedFiles` → metadata upsert → `documentSync` → PROD auto-attach rules (`v+1` always; single `v1` yes; multi `v1` no).
6. After deploy, live validation must prove real chat delivery and download links for net-new render, convert, Case A source edit/re-render, and Case B shell-produced document attach.

## ADR-131 / ADR-137 bounded file/session execution repair focused checks

When a change touches canonical chat-id threading for real web/Telegram turns, chat-scoped manifest gating, `document.render` origin tagging, session-pod hydrate/recovery, or fresh-session `shell` / `exec` execution, run:

```bash
corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts test/stream-web-chat-turn.service.test.ts test/stream-native-web-chat-turn.service.test.ts test/send-native-telegram-turn.service.test.ts test/handle-internal-telegram-turn.service.test.ts test/register-chat-attachment.service.test.ts test/upsert-workspace-file-metadata-from-runtime.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts test/runtime-files-tool.attach.test.ts test/runtime-document-tool.service.test.ts test/turn-context-hydration.service.test.ts test/turn-execution.service.test.ts test/turn-execution-discovered-file-paths.test.ts
corepack pnpm --filter @persai/sandbox exec tsx test/exec-pod-bridge.service.test.ts test/workspace-mount-hydrate.test.ts test/workspace-file-bridge.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/sandbox run typecheck
corepack pnpm run format:check
```

Interpretation rules:

1. Web sync (`send-web-chat-turn`) and web stream (`stream-web-chat-turn` / `stream-native-web-chat-turn`) must propagate the same canonical `assistant_chat.id` into runtime-facing current-chat context. Real Telegram turns must carry or derive that same canonical chat UUID through `send-native-telegram-turn` / `handle-internal-telegram-turn`. Synthetic/background paths must not invent a chat UUID just to satisfy scope checks.
2. Chat-scoped manifest list/read/attach behavior must fail closed when the current chat id is missing or not a UUID. No `unknown`, `web`, `telegram`, or other non-UUID sentinel may widen the manifest query.
3. `document.render` and related runtime storage-plane upserts must persist `originChatId` from the canonical current chat so later chat-scoped `files.list` and attachment delivery stay aligned with the producing turn.
4. GCS + `workspace_file_metadata` remain canonical. Session-pod hydrate/recovery is cache only: a fresh storage-plane write from `files.write`, `document.render`, or delivery must become visible to later `shell` / `exec` through targeted hydrate/recovery, not by treating existing pod bytes as authority.
5. `shell` / `exec` must create the effective cwd when it does not exist and must still run successfully in a brand-new empty session with zero hydrated objects.
6. Zero-object bootstrap hydrate must not mark the mount/session hydrated in a way that suppresses later targeted hydrate/recovery for fresh storage-plane writes.
7. The focused local proof set for this repair is: web sync turn, web stream turn, real Telegram turn, one `document.render` write, then a later `shell` in the same session seeing that fresh file without a full workspace reset.
8. After deploy, live validation must prove: (a) web sync and web stream expose identical current-chat file visibility, (b) a Telegram real turn gets that same scoped file truth, (c) a fresh empty session can run `shell` before any files exist, and (d) a storage-plane write becomes visible to later `shell` through targeted hydrate/recovery without manual pod recycle.
9. This focused pack does not replace the standard AGENTS broad gate; run the repo-wide lint, format, and required typechecks before calling the slice clean.

## ADR-093 clean PROD launch readiness — verification discipline

When work is executed under [`docs/ADR/093-clean-prod-launch-readiness-and-concurrency-hardening.md`](ADR/093-clean-prod-launch-readiness-and-concurrency-hardening.md), verification is **not** “ship and hope”:

1. **Deploy-bearing slices** — After cluster rollout, follow the ADR’s **agent kubectl / Argo** checklist and the session-specific **short human UI smoke** (2–5 checks). Do not substitute open-ended manual exploration for that list.
2. **Intermediate audits** — Before starting the next ADR-093 session, run the five readonly audits in the ADR (code-cleanliness, legacy/tail, failure-model, deploy-truth, load/evidence). **Critical findings block** progression.
3. **Load-proof gate** — Claims about concurrent-user ceilings require **saved** ladder output under `artifacts/sr10-loadtest/*.json` (see **SR10 load test** below and `scripts/loadtest/README.md`). Do not claim readiness above the highest **passing** profile with artifacts checked in or referenced from the session handoff.

Repo checks below (lint, typecheck, etc.) still apply to every code change; ADR-093 adds **deploy discipline** and **evidence discipline** on top.

## ADR-100 project chat mode focused checks

When a change touches chat-mode contract, project-mode UI, project runtime profile, or project activity feed, add focused checks before broad verification:

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/send-native-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/stream-native-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/workspace-file-micro-description.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts
corepack pnpm --filter @persai/api exec tsx test/prepare-assistant-inbound-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-runtime-provider-settings.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-area.test.tsx app/app/_components/sidebar.test.tsx app/app/_components/use-chat.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/runtime/page.test.tsx app/app/assistant-api-client.test.ts app/app/runtime-provider-settings-admin.test.ts --config vitest.config.ts
corepack pnpm --filter @persai/runtime exec tsx --test test/project-execution-profile.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/project-stream-events.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/turn-routing.service.test.ts runTurnRoutingServiceTest
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/activity-badge.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Slice-specific expectations:

1. `chatMode` is the explicit product behavior contract (`normal | smart | project`).
2. `deepModeEnabled` stays synchronized as a compatibility boolean until all clients are migrated.
3. `project` mode now reaches a dedicated retrieval-aware runtime profile; `smart` keeps the existing deep/smart runtime path.
4. Project-mode activity and visible reasoning summaries must not expose raw hidden chain-of-thought.
5. Project activity feed may reuse existing timeline UI, but project-only summaries must not be routed through `ThoughtBlock`.
6. Project-only retrieval ordering changes must remain gated to project orchestrate inputs and must not silently change ordinary non-project active-skill behavior.
7. Project-file intelligence must remain token-bounded in the steady-state prompt: working-files stays a cheap selector seam, while deep extraction is lazy and cached on canonical file truth.
8. Cheap background upload micro-description (ADR-134) must stay bounded: ordinary non-project/B2C chats obey `routerPolicy.analyzeUploadsOnB2cUpload` (default `false`), while project mode always enqueues after manifest path truth exists; model-generated paths bypass the B2C gate.
9. Canonical semantic-summary truth is `workspace_file_metadata.shortDescription` only (ADR-134); there is no active `AssistantFile.metadata.semanticSummary` mirror or attachment-metadata duplicate. Sync `generation_request` and deterministic STT/text_extract writes upsert the same field; background helper completion upserts it from `workspace_file_micro_description_jobs`.
10. Path-keyed micro-description cost remains internal-ledger only: successful helper calls persist durable `usageJson` + `usageOccurredAt` on `workspace_file_micro_description_jobs` first, then append a non-blocking `tool_helper` ledger row keyed by immutable job id (`source=upload_micro_description`). No user quota path should change.

## Required repo checks

Run these before calling a change clean:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Add focused tests for touched code paths when the change affects behavior.

When a change touches chat attachment derivatives, thumbnail/poster selection, or ordinary multimodal image-input resizing, add these focused checks before broad verification:

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/api exec tsx test/media-preprocessor.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/assistant-file-registry.cleanup.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-message.test.tsx app/app/_components/use-chat.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. `fileRef` remains canonical full/master truth for runtime, lightbox/playback, and download even when thumbnail/poster refs are present.
2. Web chat bubbles may prefer `thumbnailFileRef` / `posterFileRef`, but legacy attachments with no derivatives must render correctly through `fileRef` fallback.
3. Derivative artifacts must not count toward user/workspace storage usage and must be removed together with the parent file.
4. Ordinary multimodal model-input resizing must be path-based only: ordinary analysis/chat image blocks may transiently shrink, while `image_edit` source/reference inputs keep full/master bytes.

When a change touches Admin Knowledge embedding-model truth, assistant knowledge indexing/search model resolution, or plan removal of `embeddingModelKey`, add these focused checks before broad verification:

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-knowledge-retrieval-policy.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/plans/page.test.tsx app/admin/knowledge/page.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Plan save/read paths must no longer round-trip `embeddingModelKey`.
2. Assistant knowledge search must resolve embeddings from Admin Knowledge policy and fall back to lexical mode when the admin embedding model is unset or same-model embedding generation fails.
3. Admin Knowledge embedding-model changes must expose impact counts and require dangerous-action confirmation when the embedding model actually changes.
4. Backfill/no-op coverage must include global Product KB uploads, Product KB text entries, Skill documents, Skill knowledge cards, and assistant-uploaded knowledge.

---

## ADR-102 Slice 9 — CI / deploy hygiene policy

### CI lane overview

The affected-quality job (PR lane when `requiresFullCi !== true` and not docs-only) runs:

1. `corepack pnpm run format:check` — whole-repo Prettier check (root, all apps/packages).
2. `corepack pnpm run test:ci-detect-affected` — unit tests for the `detect-affected.mjs` classifier itself.
3. Affected lint — `pnpm --filter <workspace> lint` for each affected project.
4. Affected typecheck — `pnpm --filter <workspace> typecheck` for each affected project.

Full CI (`full-checks` job) covers the same ground plus Prisma, integration tests, and build, and runs on push-to-main and on PRs where `requiresFullCi === true`.

### Escalation policy: contract and runtime-boundary changes → integration matrix, not full CI

**Deliberate policy:** changes to `packages/contracts/`, `openapi.yaml`, `src/generated/`, `packages/runtime-contract/`, or `packages/runtime-bundle/` escalate to the `affected-integration` job (sets `requiresIntegration=true`) rather than to `full-checks` (`requiresFullCi`).

Rationale: full CI on every contract tweak is too costly; the integration matrix (`test:step2`) already exercises cross-app consumers of the contract surface. This is encoded in `scripts/ci/detect-affected.mjs` via `requiresIntegration` risks `contracts-boundary` and `runtime-boundary`.

**Known gap:** the `affected-integration` job runs `corepack pnpm run test:step2`, which covers API ↔ runtime integration. It does not currently exercise the web app's contract consumer path independently. If a contract change only breaks the web client (not the API), that gap would not be caught by the integration matrix alone — it would surface in the full-checks build or in downstream review. This gap is accepted for now; if web contract coverage becomes critical, add a dedicated web integration step to `affected-integration`.

**Do NOT add `contracts-boundary` or `runtime-boundary` to `requiresFullCi`.** Those risks belong only in `requiresIntegration`.

The risks that trigger `requiresFullCi` are: `auth`, `billing`, `runtime-concurrency`, `root-workspace`, and `ci-config` changes. Migration changes also escalate to full CI (they need DB provisioning).

### values-dev image tag rule

When a service is rebuilt and published in a Dev Image Publish run, its per-service `image.tag` field in `infra/helm/values-dev.yaml` **must** be pinned to the new digest. `global.images.tag` is only the fallback for services that were **not** rebuilt in that push.

- **Never** rely on `global.images.tag` for a newly rebuilt service. This causes the old global tag to shadow the new image until the next global-rebuild push.
- Selective pinning is the mechanism: only the rebuilt service's `<service>.image.tag` changes; unrelated services continue to resolve through `global.images.tag`.
- Prisma/schema/migration changes gate behind the `persai-dev-migrations` GitHub Environment approval before GitOps pinning proceeds.

A full automated CI check for stale fallback is out of scope (the tag values require runtime knowledge of which services were rebuilt). The rule is enforced through the deploy pipeline logic in `scripts/ci/pin-dev-image-tags.mjs` and human review of `values-dev.yaml` diffs.

---

When a change touches ADR-101 schema, plan assistant limits, active assistant resolution, bootstrap, chat entrypoints, assistant-scoped settings, web assistant switching, or runtime isolation, add focused checks before broad verification:

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
corepack pnpm --filter @persai/api exec tsx test/adr101-schema-unlock.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/seed-tool-catalog.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/plans/page.test.tsx app/_components/pricing-page-view.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Slice 1 must prove Prisma no longer encodes one-to-one assistant ownership and that existing workspace members receive an active assistant pointer.
2. Plan truth owns assistant count through `assistantPolicy.maxAssistants`; B2C/default plans resolve to `1`, and B2B/operator plans may set values greater than `1`.
3. Until later ADR-101 slices land, any remaining user-only assistant resolution is temporary fallout and must fail honestly on ambiguous multi-assistant users rather than silently picking a different assistant.

## ADR-098 country-aware site pages focused checks

When a change touches `platform_site_pages`, `/api/v1/public/site-pages`, `/api/v1/admin/site-pages`, market-aware compliance baselines, or setup country capture, run these focused checks before broad verification:

```bash
corepack pnpm contracts:generate
corepack pnpm prisma:generate
corepack pnpm --filter @persai/api exec tsx test/site-pages-and-compliance.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-authorization.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/api exec tsx test/billing-templates.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/site-pages/page.test.tsx app/app/setup/page.test.tsx app/page.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `GET /api/v1/public/site-pages/:slug` must reject invalid explicit `market` / `locale` with `400`; it must not silently ignore bad query values.
2. Public site-page payloads must expose only real published switch targets so the web UI cannot offer dead market/locale combinations.
3. Anonymous public trust-page reads with no explicit `market` and no country hint must now default to `rf`.
4. `/api/v1/admin/site-pages*` must stay platform-scoped; ordinary workspace-owner access is insufficient.
5. Publishing from `Admin > Site Pages` must persist the current editor state before the publish call so unsaved edits cannot ship stale published text.
6. Compliance fallback versions and billing-email legal links must stay market-aware even when published CMS rows are temporarily missing.
7. Freshly migrated environments must not require a separate manual backfill just to serve baseline `/terms`, `/privacy`, `/requisites`, and `/contacts`.

## ADR-094 backfill + long-doc path focused checks

When a change touches smart-inline backfill across non-document sources, multi-hit top-hit inline behavior, document-inspector visibility, or long-document/full-chat fetch behavior, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `knowledge_search` smart-inline must not be limited to assistant-private documents; top-hit inline should also work for Product KB/global and subscription text when the top hit is short/medium enough.
2. Multi-hit search must not regress to forced snippet-only if the top hit is clearly short enough to inline; only non-top hits should remain snippet-only.
3. Long-document path 3a is configuration truth, not paginated fetch truth: verify raised caps and real truncation behavior before proposing ADR-095/3b.
4. Minimal document inspection must show what the system actually extracted/indexed (`sizeBytes`, `textChars`, `chunkCount`, processor/quality, first/chunk previews), not just what the user originally uploaded.
5. Chat `mode="section"` / `mode="full"` checks must confirm chronological output with timestamps and a real thread-wide/full-path read up to the configured caps.

## CI verification lanes

Current CI is intentionally split into three lanes:

1. **Affected PR lane** in `.github/workflows/ci.yml`
   - `detect-affected`
   - affected lint
   - affected typecheck
   - affected focused tests
   - conditional integration gate when risky boundaries are touched
2. **Escalated full lane** in `.github/workflows/ci.yml`
   - used when the affected detector marks a PR as high-risk (`auth`, `billing`, runtime concurrency/scheduling/admission, Prisma schema/migrations, root workspace dependency changes, or CI/affected-rule changes)
3. **Full verification lane** in `.github/workflows/full-verification.yml`
   - merge queue / `merge_group`
   - nightly schedule
   - manual operator-triggered full runs

Interpretation rules:

1. Docs-only and test-only changes must not trigger deploy publication.
2. `infra/helm` and `infra/dev/gitops` changes must always keep Helm validation, even when app checks are skipped.
3. `infra/helm/values-dev.yaml` bot-only tag-pin commits are GitOps bookkeeping and should not retrigger the main `CI` workflow by themselves.
4. Affected-only is an optimization layer, not a waiver: when a path is risky, the repo must fall back to full verification rather than silently reducing coverage.
5. Prisma/schema/migration pushes may build images automatically, but GitOps pinning must wait at the `persai-dev-migrations` GitHub Environment approval lane.

## ADR-093 Session 2 — runtime/API execution isolation and fairness foundations

When a change touches runtime execution admission, queue fairness, heavy-vs-light turn isolation, or background/media execution class separation, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/runtime-execution-admission.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-observability.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-background-task-evaluation.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-media-job-run.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-media-job-completion.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. Interactive turns, heavy interactive turns, and background/media work must no longer compete through one undifferentiated per-pod execution lane.
2. Light interactive turns must keep a reserved path so queued heavy/background work cannot starve ordinary chat sends under mixed load.
3. Fairness changes must stay technical: no prompt changes, no business-rule routing, no reduced model/tool parallelism just to make load easier.
4. Queue pressure must be operator-visible through runtime `/metrics`; do not introduce an unbounded or silent waiting path.
5. Any claimed concurrency/readiness improvement still requires saved SR10 load evidence before stating a user ceiling.

## ADR-093 Session 3 — provider-gateway, SSE transport efficiency, and web reconcile pressure

When a change touches provider-gateway/runtime stream flushing, web stream reattach/resume, or web client reconcile pressure, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/provider-gateway exec tsx test/provider-text-generation.controller.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turns.controller.test.ts
corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/use-chat.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts
corepack pnpm --filter @persai/provider-gateway run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Flush coalescing may reduce internal socket flush frequency, but first payloads, non-delta activity, and terminal events must still flush promptly enough to preserve visible streaming behavior.
2. Web resume/reattach cleanup must not remove idempotent replay, soft detach, active media-job visibility, or `clientTurnId` retry/status semantics.
3. Reconcile-pressure reductions should avoid overlapping client requests for the same thread/turn instead of reducing tool parallelism or changing assistant behavior.
4. Any claimed throughput/readiness improvement still requires saved SR10 load evidence before stating a user ceiling.

## ADR-093 Session 4 — sandbox isolation and completion-path cleanup

When a change touches sandbox backlog bounds, sandbox status polling/completion cleanup, sandbox operator metrics, or sandbox replica/PDB deploy truth, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/sandbox exec tsx test/sandbox.service.test.ts
corepack pnpm --filter @persai/sandbox exec tsx test/sandbox-metrics.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/sandbox-client.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/sandbox run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. Sandbox backlog protection must stay technical only: no weakened isolation, no skipped authorization, and no product/business routing shortcuts.
2. Queue growth must be bounded and operator-visible. If sandbox accepts only finite pending work, the resulting rejection path must return a structured reason instead of silently waiting forever.
3. Completion cleanup may reduce poll chatter with bounded long-polling or similar server-truth waiting, but runtime callers must still receive terminal `completed` / `blocked` / `failed` truth without ad hoc hidden flags.
4. Stale queued/running sandbox jobs must fail predictably enough that runtime callers do not sit behind an indefinite polling path after the real execution path is gone.
5. Helm scaling/PDB adjustments for sandbox remain deploy-truth only; no 500-1000 user readiness ceiling may be claimed without saved SR10 evidence.

## Focused checks for destructive cleanup and compaction-state slices

When a change touches destructive admin delete flows, web compaction-state reads, background compaction notice classification, or related persisted runtime-bundle parsing seams, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/admin-delete-user.service.test.ts
corepack pnpm --filter @persai/api exec tsx --test test/manage-web-chat-list.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. `AdminDeleteUserService` must delete newer assistant/workspace-owned registries before removing the assistant, workspace, and user rows.
2. Trigger-disable helper refactors for destructive cleanup must preserve the real root error rather than replacing it with a follow-up transaction-aborted noise error.
3. Web compaction-state reads and background compaction notice classification must parse both materialized-object and persisted JSON-document runtime bundle shapes.
4. Compaction execution success is not enough on its own; the read path behind `GET /assistant/chats/web/:chatId/compaction` must remain green so the UI can render the actual banner state.

## ADR-082 billing quota readiness focused checks

When a change touches Admin Runtime provider/model profiles, weighted token accounting, ADR-082 monthly media quota model code, or delivery-confirmed media settlement, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api run test:quota-accounting
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/runtime-provider-settings-admin.test.ts app/admin/knowledge/page.test.tsx app/admin/plans/page.test.tsx
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Admin Runtime provider/model profiles, not plan rows, own `inputTokenWeight`, `cachedInputTokenWeight`, and `outputTokenWeight`.
2. Older capability-list catalog JSON must normalize into typed model profiles without breaking existing settings.
3. API validation must reject invalid/negative weights before persistence.
4. Plan media model validation and admin model selectors must derive options from profile capabilities.
5. Weighted token accounting slices must use provider/runtime `usageAccounting.entries` first and mark estimator fallback explicitly.
6. Monthly media settlement must reserve before expensive media provider work, settle only after delivery succeeds, and release or mark reconciliation-required when provider/output work does not become user-visible delivery.
7. `image_generate`, `image_edit`, and `video_generate` must not use day-keyed tool counters as paid media quota truth.

## ADR-105 media job truth focused checks

When a change touches the async media lane (media tool projection/budgeting, media tool services, media enqueue/reservation, scheduler/completion media paths, or the media runtime contract), add these focused checks before broad verification:

1. One structured media request with `count=N` becomes exactly one media job — no silent split, no silent trim.
2. Media `perTurnCap` budgeting counts total requested result units, not tool calls (`tool-budget-policy` `reserve(requestedUnits)`); an oversized single request is rejected as a whole.
3. `image_edit.count` is honored end to end (schema → parse → provider → unit budgeting → enqueue reservation units).
4. Multi-image media requests are `series`-first: the model-facing path should default to ordered `seriesItems[]`, and runtime execution should still keep one job while producing one single-image provider call per output so carousel/storyboard requests yield distinct frames instead of collage-prone repeated batch prompts. `variants` may remain in the schema for compatibility but must not be the normal advertised path.
5. Accepted async media results are model-visible `action:"pending_delivery"` (`canSendFileNow=false`) with no false ready/sent language. Per the model-owned-reply policy for deferred jobs (image + document) the runtime preserves any non-empty assistant text alongside a `pending_delivery` job verbatim — including reply text that explains a mixed accepted+rejected outcome — and applies the canonical "Запрос принят / Request accepted…" acknowledgement strictly as a fallback when the model produced no text after the deferred job. Honesty about pending delivery is enforced via the developer-tail `buildDeferredMediaFollowUpInstruction` / `buildDeferredDocumentFollowUpInstruction` and the global `DELIVERY_HONESTY_CONTRACT`.
6. Runtime open-job context (media + document) includes a compact `sourceSummary`, and developer instructions explicitly forbid treating older open jobs as proof that the current turn started a new async job.
7. The third concurrent open media job in a chat gets an explicit structured `media_job_concurrency_limit` rejection.
8. **Single-owner quota invariant:** the runtime worker makes zero monthly-media-quota calls (grep `apps/runtime/src/modules/turns`); reservation happens once at enqueue admission; each reservation is resolved exactly once — scheduler `failJob` releases the full `N` once per terminal failure, completion `failDelivery` reconciles `N` once for pre-delivery failures (guarded against post-`deliver()` double-count), delivery loop settles/reconciles per artifact. No double/multi-release across concurrent jobs.
9. A malformed media tool call that returns structural `invalid_arguments` must refund any previously reserved per-turn media units so a corrected same-turn retry is not blocked by `tool_budget_exhausted`.
10. When a reusable current-turn image already exists, a multi-frame ref-bound request must not continue as generic `image_generate` series; runtime should structurally steer the model to `image_edit` with `sourceImageAlias`, and `series` item prompts must preserve one product/campaign identity across outputs.
11. If a later multi-image item fails after earlier artifacts were already persisted, the worker result must preserve those artifacts and carry an honest partial warning; API scheduler should move that job to `completion_pending` rather than terminal `media_job_artifacts_missing`.

Focused suites:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/tool-budget-policy.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-image-generate-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-image-edit-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-video-generate-tool.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/assistant-media-job-scheduler.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/assistant-media-job-completion-delivery.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/enqueue-runtime-deferred-media-job.service.test.ts
```

### ADR-117 single-source golden test

`apps/runtime/test/native-tool-projection.test.ts` exports `runMediaPromptFragmentsSanityTest`, the ADR-117 Slice 5 golden guard. It reads the real source files from disk and fails if tool-instruction ownership drifts:

1. the collage/contact-sheet/diptych rule is re-inlined outside `packages/runtime-contract/src/index.ts`;
2. runtime media services or the OpenAI gateway stop referencing the shared `@persai/runtime-contract` fragments;
3. `apps/api/prisma/tool-catalog-data.ts` reintroduces `action="deferred"` or cross-tool comparison prose;
4. `apps/api/prisma/bootstrap-preset-data.ts` loses the Native Tool Runtime selection-guide marker or reintroduces an `agents` Tasks Policy section.

Run it through the runtime temp-runner path when isolating the test:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/_tmp-run.ts
```

Where `test/_tmp-run.ts` temporarily imports `runMediaPromptFragmentsSanityTest` (and any adjacent projection sanity export you also want) and awaits them, then is deleted after the run.

## ADR-099 Session A catalog foundation focused checks

When a change touches the structured Admin Runtime provider/model catalog, pricing metadata fields, or the compatibility alias that downstream model pickers still consume, add these focused checks before broad verification:

```bash
corepack pnpm contracts:generate
corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts
corepack pnpm --filter @persai/api exec tsx test/materialize-assistant-published-version.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/apply-assistant-published-version.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/generate-skill-authoring-draft.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/quota-accounting.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/runtime-provider-settings-admin.test.ts app/admin/knowledge/page.test.tsx app/admin/plans/page.test.tsx app/app/assistant-api-client.test.ts --config vitest.config.ts
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `Admin > Runtime` must edit the provider/model catalog as structured fields, not as one pipe-delimited textarea source of truth.
2. Catalog rows must carry at least `active`, `billingMode`, `effectiveFrom` / `effectiveTo`, token quota weights, and structured pricing metadata so later ledger work does not invent a second pricing store.
3. A catalog row must not persist conflicting pricing branches: `providerPriceMetadata` must carry exactly the one pricing shape that matches the row `billingMode`.
4. Admin Runtime archive/version actions must preserve historical rows in the catalog instead of hard-deleting them from runtime truth.
5. `availableModelsByProvider` must remain a derived compatibility alias from active chat-capable catalog rows so downstream text-model pickers keep the same behavior.
6. Capability-filtered selectors for plans/authoring/materialization must read only active matching catalog rows; inactive historical rows stay catalog truth but must not leak into ordinary picker UX.
7. The runtime page itself should have focused UI coverage for billing-mode editor switching and archive/version-safe row handling.
8. Historical catalog rows may coexist for the same provider/model key, but active selection must stay unambiguous.

## ADR-106 video provider routing final checks

When a change touches the Runway/Kling `video_generate` provider path, run the focused checks below before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/runtime-provider-profile.test.ts
corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/materialize-assistant-published-version.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/runtime-provider-settings-admin.test.ts app/admin/runtime/page.test.tsx app/admin/tools/page.test.tsx app/admin/plans/page.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/runtime exec tsx --test test/runtime-video-generate-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx --test test/runtime-image-generate-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx --test test/runtime-image-edit-tool.service.test.ts
corepack pnpm --filter @persai/provider-gateway run test
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/provider-gateway run typecheck
```

Interpretation rules:

1. Runway/Kling are managed catalog and credential providers for `video_generate` only; they must not enter chat routing, `availableModelsByProvider`, `image_generate`, or `image_edit`.
2. Plan video model keys stay bare strings, so duplicate active video model ids across OpenAI/Runway/Kling must be rejected or disabled before save/materialization.
3. Materialized `video_generate` refs must carry the resolved provider id, model key, provider-specific secret id, and optional provider-aware fallback ref.
4. Runtime/provider-gateway video result validation must reject provider mismatches and unsupported providers explicitly.
5. Billing facts and cost-ledger lookup must use the executing provider/model/catalog row. Media quota settlement remains separate user-quota truth.
6. Before operational readiness claims, deploy affected services and live-smoke one OpenAI video and at least one real Runway/Kling video path with operator credentials.

## ADR-099 Session B/C ledger focused checks

When a change touches the unified model cost ledger, ordinary-chat money-event writes, or the catalog-price lookup used for those writes, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
corepack pnpm --filter @persai/api exec tsx test/record-model-cost-ledger.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/send-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-internal-telegram-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/persai-background-task-scheduler.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. Ledger writes must stay additive to quota; quota semantics and weighted Credits accounting are unchanged.
2. Current proof coverage writes immutable events only when the provider/model/timestamp facts are durably present: completed ordinary web/Telegram chat paths with concrete runtime `usageAccounting.entries`, plus background-task evaluator runs whose persisted `assistant_background_task_runs.usageJson` carries a concrete runtime usage snapshot. Interrupted/estimator-only paths must not fabricate money rows.
3. Cost calculation must read pricing exclusively from the structured Admin Runtime catalog, not from plans, hand-coded constants, or Business/Ops projections.
4. Historical pricing context must remain replay-safe: when multiple catalog rows exist for one provider/model key, the ledger must choose the row effective at the event timestamp and persist the price snapshot/version on the event.
5. Session C may widen the proof only where provider/model/usage attribution is already persisted cleanly enough for replay-safe additive writes. Current covered paths are ordinary-chat main replies plus router/classifier entries and the background-task evaluator call. Retrieval-helper/reranker, media, STT, image, video, and other non-ordinary-chat paths still need their own explicit follow-up slice.

## ADR-099 media/STT/TTS billing-facts foundation focused checks

When a change touches the additive non-ledger media/STT/TTS billing-facts foundation, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts
corepack pnpm --filter @persai/api exec tsx --test test/assistant-media-job-scheduler.service.test.ts
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/provider-gateway run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. The slice may persist normalized `billingFacts` on owning media/attachment rows, but it must not append ledger rows yet.
2. `assistant_media_jobs.billing_facts_json` is the durable seam for generated image/video facts; `assistant_chat_message_attachments.billing_facts_json` is the durable seam for attachment-ingest STT and delivered TTS facts.
3. Standalone voice-transcribe must stay deferred unless the slice also lands a dedicated replay-safe durable row/seam for that endpoint.
4. Admin Runtime catalog truth may widen to honest STT/TTS capabilities and billing modes, but downstream chat-model selector semantics must remain driven by active chat-capable rows only.

## ADR-099 Session D Business/Ops read-model focused checks

When a change touches the first ledger-backed Business/Ops economics rollout, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-business-platform.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Business and Ops must read the existing `model_cost_ledger_events` truth; they must not invent a second pricing or cost source.
2. The UI/API copy must stay explicit that Session D is showing the current ledger-backed coverage set only, not full-platform final economics.
3. Session D may show compact cost summaries and breakdowns, but it must not imply uncovered paths (background/media/STT/image/video/document/etc.) are already included.
4. Quota semantics and existing billing/support controls must stay unchanged; the new read-model blocks are additive observability only.

## ADR-087 unified quota advisories and paid light-mode focused checks

When a change touches 90%-threshold advisories, paid token light mode, `quota_status` advisory facts, free-vs-paid warning/light-mode gating, or quiet light-mode UI state, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/plan-visibility.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/prepare-assistant-inbound-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts
corepack pnpm --filter @persai/api exec tsx test/read-internal-runtime-quota-status.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/read-internal-runtime-quota-status.service.test.ts
corepack pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/send-web-chat-turn.service.test.ts
corepack pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/stream-web-chat-turn.service.test.ts
corepack pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/handle-internal-telegram-turn.service.test.ts
corepack pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/render-assistant-inbound-surface-message.test.ts
corepack pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/internal-runtime-tool-quota.controller.test.ts
corepack pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/assistant-inbound-error.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-quota-status-tool.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/assistant-api-client.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/use-chat.test.tsx app/app/_components/chat-area.test.tsx app/app/_components/sidebar.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. 90% warnings must apply only to finite in-scope limits and must not fire for unlimited limits.
2. The initial ADR-087 in-scope limits are token/Credits budget, monthly media limits, daily tool limits, and storage limits; `activeWebChatsLimit` and `messagesPerChat` stay on their existing UX paths unless a later ADR expands scope.
3. Warning delivery must be assistant-authored from real quota/plan facts and deduplicated once per chat/thread per limit per reset window.
4. Free/zero-price plans may receive warnings but must not enter paid light mode.
5. Paid token-budget exhaustion must not surface as generic budget-driven `rate_limited`; ordinary text turns should continue through the safe `cost_driving_restricted` light-mode path until the current quota period resets.
6. The quiet web light-mode indicator should stay low-noise and consistent with server truth rather than competing with chat banners.
7. Upgrade nudges must appear only when a higher visible paid plan exists; ADR-087 currently defines the maximum plan as the highest-priced visible paid plan.

For production slices that touch API contracts, runtime behavior, or shared control-plane seams, also run:

```bash
corepack pnpm run test
```

## ADR-115 inbound safety program focused checks

When a change touches inbound safety restrictions, the safety gate, or canonical inbound layer order, run:

```bash
corepack pnpm --filter @persai/api exec tsx test/enforce-inbound-safety-gate.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/prisma-user-restriction.repository.test.ts
corepack pnpm --filter @persai/api exec tsx test/evaluate-inbound-safety-precheck.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/enqueue-safety-moderation-review.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/safety-moderation-decision.test.ts
corepack pnpm --filter @persai/api exec tsx test/process-safety-moderation-review.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/enforce-inbound-safety-precheck-follow-through.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-safety-controls.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/ops/page.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/runtime/inbound-safety-policy.helpers.test.ts --config vitest.config.ts
corepack pnpm --filter @persai/api exec tsx test/assistant-inbound-error.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/assistant-api-client.test.ts --config vitest.config.ts
corepack pnpm --filter @persai/api exec tsx test/prepare-assistant-inbound-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/assistant-inbound-error.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. Active `user_restrictions` with `kind=safety` must deny inbound before abuse, quota, and runtime with `safety_restricted` (not `rate_limited`).
2. Canonical inbound order is `safety -> abuse -> contour-1 precheck -> quota`; abuse attempt registration must still run before a quota deny.
3. Contour-1 `low`/`medium`/`high` matches must not create `user_restrictions` in slice 115.1; defer/block routes enqueue `safety_moderation_review_jobs` only.
4. Slice 115.2 worker must persist `moderation_cases`, upsert active `user_restrictions` only on `block_user`, and treat OpenAI Moderation `flagged`/score threshold as the block decision (not C1 alone).
5. Slice 115.3 sync hold must deny inbound with `safety_restricted` (not `rate_limited`) when sync moderation returns `block_user`; web client must map `safety_restricted` to a distinct UX class.
6. Slice 115.4 ops must show `safety_restricted` on user directory rows, expose restriction details on ops cockpit, allow admin unblock without abuse-controls, and require step-up for manual restrict.
7. Slice 115.6 runtime UI must round-trip heuristic rules and routing knobs via safety-policy API without mixing router `precheckRuleOverrides`.
8. Empty `user_restrictions` must not change safety-deny behavior; abuse-before-quota reorder remains intentional from slice 115.0.
9. Slice 115.7 warn path must persist `moderation_cases` with `decision: warn` without `user_restrictions`; repeat warn for same `reasonCode` in strike window must escalate to `block_user` at inbound; web must render `platformNotice.kind = safety_inbound_warn`.
10. Slice 115.5 admin*system must emit `safety_user_restricted` on auto `block_user` and admin manual restrict; notification message must include user email (not bare UUID). User-scoped admin_system events (`billing*_`, `support*ticket_opened`, `runtime_apply*_`, `safety_user_restricted`) must resolve `userEmail`/`recipientEmail` before label enrichment.
11. Follow-through: web warn banner above composer (not in-thread); TG warn via `DeliverSafetyInboundWarnNoticeService` once per `triggerKey`; `GET /app/user-safety-standing` + bootstrap `userSafety` for sidebar icons.
12. `apps/api/test/resolve-user-safety-standing.service.test.ts`, `safety-moderation-review-core.service.test.ts` (warn delivery idempotency), `apps/web/app/app/_components/sidebar.test.tsx` (safety icon modals).

```bash
corepack pnpm --filter @persai/api exec tsx test/append-assistant-audit-event.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-system-notification-producer.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-safety-controls.service.test.ts
```

## ADR-116 runtime file re-view focused checks

When a change touches `files.inspect`, `files.read`, `files.preview`, preview plan limits, or ephemeral `toolFollowUpUserContent` injection, run:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-read-metadata.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-file-capabilities.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/sanitize-tool-result-for-model.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/extract-internal-runtime-assistant-file.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/provider-gateway run typecheck
```

Interpretation rules:

1. `files.inspect` / legacy `files.get` must return `capabilities` with `visual` only when `sizeBytes ≤ effectiveMaxPreviewBytes` from materialized bundle policy.
2. `files.preview` on oversize files must return `preview_size_limit` without base64 in tool JSON; success must populate `pendingFilePreviewBlocks` (text + image or native PDF block).
3. `files.read` document payloads must surface `charCount`, `truncated`, `readNote`, `extractionQuality`, `extractionCached`; sanitizer must set `truncated: true` when clipping to 16k; tool-result string must not contain `%PDF-`.
4. Current-turn attachment hydration must use bundle `effectiveMaxPreviewBytes` / `effectiveMaxPreviewEdgePx`, not hardcoded 8 MB / 2048 px.
5. Plan admin save/load must round-trip `maxFilePreviewBytes` / `maxFilePreviewEdgePx` on the `files` tool activation row.
6. Provider-gateway must validate and forward ephemeral `toolFollowUpUserContent` after `toolHistory` (OpenAI + Anthropic).

Live acceptance (post-deploy smoke on `persai-dev`): image re-view via `files.preview` across turns; low plan `maxFilePreviewBytes` → `preview_size_limit` + inspect without `visual`; raised limit → `file_preview` runtime log with `capSource=plan`.

## ADR-088 unified notification platform focused checks

When a change touches notification intent modeling, channel routing, delivery backbones, admin notification governance, billing/email notification migration, or active-thread conversational notification unification, add checks that cover both the newly touched domain and the shared delivery backbone before broad verification:

```bash
# Slice 1 focused tests (all pass after Slice 1 closeout)
corepack pnpm --filter @persai/api exec tsx test/notification-intent.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-routing.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-delivery-worker.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/email-channel.adapter.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-postmark-webhook.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-notifications.controller.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm run test
```

Slice 1 focused test coverage (as of Slice 1 closeout):

| Test file                                      | Scenarios covered                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification-intent.service.test.ts`          | basic creation, deduplication, quiet-hours deferral, immediate override, scheduled intent                                                                                                         |
| `notification-routing.service.test.ts`         | active quiet hours → deferred; immediate override; source not in list; disabled; no config; outside window; respectQuietHours=false                                                               |
| `notification-delivery-worker.service.test.ts` | all ADR §11 fields present in delivery.attempted; latencyMs from intent.createdAt; delivery.delivered userId+outcome; delivery.failed errorCode; intent.dead_letter lastError; delivery.escalated |
| `email-channel.adapter.test.ts`                | full Postmark request shape; List-Unsubscribe headers; no List-Unsubscribe without URL; 4xx→not retryable; 5xx→retryable; no HtmlBody when html=null                                              |
| `handle-postmark-webhook.service.test.ts`      | valid HMAC accepted; invalid HMAC rejected; unsigned accepted in dev; unsigned rejected in prod; 5 failures→healthStatus=down                                                                     |
| `admin-notifications.controller.test.ts`       | all 8 endpoint shapes match OpenAPI (bare views, no wrappers; 204 discard; deadLetters key; pagination fields)                                                                                    |

Slice 2.5 — multi-user correction (LANDED 2026-05-09 closeout):

```bash
corepack pnpm --filter @persai/api exec tsx test/resolve-workspace-notification-channels.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-postmark-webhook.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-notifications.controller.authz.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-intent.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-delivery-worker.service.test.ts
```

| Test file                                                 | Scenarios covered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resolve-workspace-notification-channels.service.test.ts` | email available iff owner `AppUser.email` non-empty; telegram requires `AssistantChannelSurfaceBinding` `bindingState=active`; `web_thread` / `web_notification_center` always available even with no registry row or registry row disabled; `admin_webhook` unavailable when `webhookUrl` empty; `admin_webhook` disabled-globally → `channel_disabled_globally`; `resolvePolicy` / `resolveQuietHours` fall back to `notification-defaults.ts` when DB empty; DB row overrides defaults when present |
| `handle-postmark-webhook.service.test.ts`                 | HMAC verified via `PlatformRuntimeProviderSecretStoreService` only (no `process.env` fallback); invalid HMAC rejected; unsigned accepted in dev; unsigned rejected in prod; 5-failure escalation to `down`; `SpamComplaint` increments `consecutiveFailures`                                                                                                                                                                                                                                           |
| `admin-notifications.controller.authz.test.ts`            | non-admin `userId` → `ForbiddenException` on every notifications admin endpoint, including `POST /channels/:type/test-send` (the dry-run endpoint must run the same admin gate as the rest of the surface)                                                                                                                                                                                                                                                                                             |

Interpretation rules (Slice 2.5):

1. `notification_channel_registry`, `notification_policies`, and `notification_quiet_hours` are global singleton tables — code must never reintroduce a `workspaceId` column or per-workspace lookup on these models.
2. Per-workspace channel availability must be derived at delivery time through `ResolveWorkspaceNotificationChannelsService.resolveChannel` and consume the discriminated `ChannelResolution` shape — no silent `null` returns.
3. Postmark Server Token and Webhook Token must be resolved exclusively via `PlatformRuntimeProviderSecretStoreService` using `NOTIFICATION_CREDENTIAL_IDS`. `process.env["POSTMARK_*"]` fallbacks are forbidden.
4. `notification_delivery_attempts` derives workspace via the parent `notification_intents` join; admin queries must not rely on a column on the attempt row.
5. The dry-run `POST /admin/notifications/channels/:type/test-send` endpoint must run the same admin authorization gate as every other notifications admin endpoint.

Slice 2 focused tests (all pass after Slice 2 landing 2026-05-08):

```bash
corepack pnpm --filter @persai/api exec tsx test/notification-intent.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-routing.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-delivery-worker.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-notifications.controller.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-intent.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/persai-idle-reengagement-scheduler.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-routing.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/notification-delivery-worker.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-internal-cron-fire.test.ts
corepack pnpm --filter @persai/api exec tsx test/billing-lifecycle-notifications.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/read-internal-runtime-quota-status.service.test.ts
```

| Test file                                            | Scenarios covered                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `persai-idle-reengagement-scheduler.service.test.ts` | no policy → skips; skippable intent created; cooldown dedup check against notification_intents                                                                                             |
| `handle-internal-cron-fire.test.ts`                  | reminder intent created; respectQuietHours=false; deliveredTo="none"                                                                                                                       |
| `billing-lifecycle-notifications.service.test.ts`    | transactional intent created; assistantNotificationOutboxId references removed                                                                                                             |
| `read-internal-runtime-quota-status.service.test.ts` | advisoryCandidates empty when no threshold crossed                                                                                                                                         |
| `notification-intent.service.test.ts`                | quiet-hours deferral via notification_intents                                                                                                                                              |
| `notification-routing.service.test.ts`               | 7 quiet-hours routing scenarios                                                                                                                                                            |
| `notification-delivery-worker.service.test.ts`       | ADR §11 structured log fields + latencyMs + dead-letter (Part A); quiet-hours deferral end-to-end, dedupe collision at intent-service level, primary failure → escalation success (Part B) |
| `admin-notifications.controller.test.ts`             | all 8 endpoint shapes; no legacy policy endpoints                                                                                                                                          |

Interpretation rules:

1. Conversational, transactional, operational, and administrative notifications must stay explicitly classified; do not silently collapse them into one freeform send path.
2. Billing/admin/ops notifications must remain deterministic/template-safe unless a later ADR explicitly expands grounded rendering.
3. New notification features should not bypass durable enqueue, policy resolution, routing, and delivery audit with ad hoc direct sends.
4. `Admin > Notifications` should gain control-plane authority over policy/routing/history rather than accumulating one-off feature cards.
5. All delivery log events must carry the full ADR §11 field set: `intentId`, `workspaceId`, `assistantId?`, `userId?`, `source`, `class`, `priority`, `renderStrategy`, `channel`, `attemptNumber`, `latencyMs` (from `intent.createdAt`), `outcome`, `errorCode?`, `traceId`.
6. `latencyMs` must be computed from `intent.createdAt`, not from worker pickup time.
7. Dead-letter `resolvedAt` must be set by both replay and discard; only `resolvedAt IS NULL` rows are returned by default list.

## ADR-083 subscription lifecycle focused checks

When a change touches plan lifecycle policy, subscription lifecycle state, trial fallback behavior, or Admin Plans lifecycle fields, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/admin-billing-lifecycle-settings.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/billing-lifecycle-notifications.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-plans.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-workspace-subscription.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/plan-visibility.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/subscription-state-resolve.test.ts
corepack pnpm --filter @persai/api exec tsx test/workspace-subscription-lifecycle.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/plans/page.test.tsx app/admin/billing-settings/page.test.tsx
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Trial plans must carry an admin-selected fallback plan in `lifecyclePolicy.trialFallbackPlanCode`.
2. Plan writes must reject missing, inactive, self-referential, or otherwise invalid fallback references.
3. Admin Plans must make fallback selection visible next to trial duration and must not hard-code trial duration or fallback plan codes.
4. Plan visibility must preserve the effective trial fallback code so the lifecycle state machine can consume PersAI-owned plan truth.
5. New default-registration workspaces must materialize a `WorkspaceSubscription` with real trial/current-period boundaries when the default plan is a trial.
6. Expired trial fallback must read `lifecyclePolicy.trialFallbackPlanCode`, validate the fallback plan is active, persist the fallback state, and mark affected assistant materialization dirty.
7. Paid grace duration must come from persisted billing lifecycle settings, not code constants.
8. Failed renewal must enter `grace_period`, keep the paid plan effective, set explicit grace windows, and append `renewal_failed`/`grace_started`.
9. Grace expiry must apply plan-level `paidFallbackPlanCode` first, then global fallback, persist `expired_fallback`, and append `grace_expired`/`fallback_applied`.
10. Payment recovery must restore active paid state with provider/manual period truth and append `payment_recovered`.
11. Credits/token budget visibility, inbound quota enforcement, and admin quota-pressure surfaces must read the current `workspace_token_budget_period_counters` bucket for the effective subscription period, not stale compatibility token totals from a previous period.
12. Legacy `assistant_abuse_*` rows with `block_reason` `quota_pressure_*` must be cleared on the next distributed abuse attempt; abuse enforcement must not reintroduce quota-driven slowdown/block (ADR-044 cleanup + ADR-087).
13. Billing lifecycle notification schedules must come from persisted Billing Settings policy, with email required and assistant push optional.
14. Lifecycle events must create durable `notification_intents` (class: `transactional`) via `NotificationIntentService` instead of process-local timers; required email jobs stay pending until Slice 3 adds MJML templates and a real Postmark email delivery path.
15. Ops Cockpit user-directory rows should be billing-support rows: email, plan, lifecycle status, next relevant billing/trial/grace date, usage risk, and actions, not assistant setup trivia.
16. Ops Cockpit selected detail must expose PersAI-owned subscription truth, lifecycle events, notification jobs, quota period, and support identifiers without reading billing-provider state directly at request time.
17. Ops Cockpit support actions must run through lifecycle/subscription services rather than raw admin row mutation: extend trial updates trial windows, grant/extend grace preserves paid access logic, fallback now moves deterministically to configured fallback truth, manual reminder creates durable notification work, and the selected detail refreshes to the new lifecycle state after each action.

## ADR-084 payment-intent and provider-port focused checks

When a change touches PersAI payment intents, provider-neutral checkout session creation, or the authenticated billing-intent API, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/cloudpayments-constructor-billing-provider.adapter.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `POST /assistant/billing/payment-intents` must create PersAI-owned intent state before any provider checkout/session call.
2. Payment-intent creation must be idempotent per workspace and caller-supplied `idempotencyKey`; the same key with different plan/method/return-url shape must fail loudly.
3. Only active visible paid plans from the pricing source of truth may be purchased through this boundary.
4. This slice may start `new_purchase` and `upgrade`, but must not silently perform downgrade/cancel policy early.
5. The API response must stay provider-neutral and carry a normalized checkout mode (`embedded`, `redirect`, `payment_link`, `qr_code`, or current `manual_test`) rather than provider-specific UI assumptions.
6. Product/lifecycle truth must still wait for trusted server/provider confirmation; creating a payment intent or checkout session must not activate paid access by itself.
7. For the CloudPayments embedded constructor contour, checkout creation must fail loudly when the encrypted API Secret or public terminal id is not configured; it must not silently fall back to `manual_test`.

## ADR-084 web checkout and return-flow focused checks

When a change touches logged-in pricing checkout launch, manual/provider checkout handoff UI, or chat return-state banners, add focused web checks before broad verification:

```bash
corepack pnpm --filter @persai/web exec vitest run app/_components/pricing-page-view.test.tsx app/app/billing/checkout/[paymentIntentId]/page.test.tsx app/app/chat/page.test.tsx
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Logged-in pricing CTAs must create or reuse PersAI-owned payment intents through `POST /assistant/billing/payment-intents`; pricing cards must not synthesize provider checkout state client-side.
2. The web layer may launch `card` and `sbp_qr` starts, but must not activate paid access from checkout launch or return alone.
3. CloudPayments embedded checkout must mount from persisted payment-intent payload on `/app/billing/checkout/:paymentIntentId`, not from ad hoc client-side pricing state.
4. Manual/test and embedded checkout flows must return the user to chat with an explicit `success`, `failed`, or `pending` envelope so the UI can explain what happened without pretending lifecycle confirmation already landed.
5. Failure return UX must clearly preserve the old plan and provide a retry path back to pricing.

## ADR-084 webhook-to-lifecycle focused checks

When a change touches trusted billing-provider webhook ingestion, payment-intent terminal status mutation, or ADR-083 lifecycle application from provider outcomes, add focused API checks before broad verification:

```bash
corepack pnpm run prisma:generate
corepack pnpm run contracts:generate
corepack pnpm --filter @persai/api exec tsx test/admin-security.controller.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-billing-provider-credentials.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-cloudpayments-webhook.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Trusted provider outcomes must enter PersAI through a server-side webhook/controller boundary, not through chat return params or client-declared success.
2. Webhook verification must use the provider secret from PersAI-managed encrypted admin tools storage, not a second ad hoc config surface.
3. The webhook path must resolve constructor-originated payment intents from CloudPayments `externalId` and `metadata/data` as well as older `invoiceId` compatibility fields.
4. The webhook path must update `workspace_payment_intents` deterministically (`pending_confirmation`, `succeeded`, `failed`, `canceled`, `reversed`) before or alongside lifecycle application, with idempotent event refs for duplicate provider delivery.
5. Successful paid activation or renewal must flow through `ApplyWorkspaceSubscriptionBillingEventService` / ADR-083 lifecycle services, not mutate `workspace_subscriptions` directly from the controller.
6. Refund/reversal outcomes must apply immediate paid fallback through lifecycle truth rather than leaving the old paid state active.

## ADR-084 recurring billing and user-controls focused checks

When a change touches recurring-start checkout policy, provider-backed renewal/cancel lifecycle, recurring management APIs, or the `Limits & Plan -> Payment settings` UX, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/cloudpayments-constructor-billing-provider.adapter.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-cloudpayments-webhook.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-billing-subscription.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/apply-workspace-subscription-billing-event.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/workspace-subscription-lifecycle.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-quota-status-tool.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Payment-intent creation must distinguish `recurring_start` from honest `one_time` fallback; unsupported methods must surface that downgrade explicitly.
2. Provider-managed recurring ids are reconciliation inputs and must persist on PersAI subscription truth before later renewal/cancel events can reconcile correctly.
3. Trusted recurring provider events must flow through `workspace_subscription_billing_events` into ADR-083 lifecycle truth (`renewal_succeeded`, `renewal_failed`, `payment_recovered`, `subscription_cancel_scheduled`) instead of mutating subscription rows directly.
4. Disabling auto-renew must map to PersAI `cancelAtPeriodEnd` truth and preserve paid access until the stored current paid period ends.
5. Period-end fallback after cancellation must be lifecycle-owned and deterministic; UI/client state must not be the source of cancellation truth.
6. Product recurring controls must read server-truth recurring state from PersAI API, not from checkout completion heuristics or direct provider status reads in the browser.
7. `quota_status` checkout output must carry enough recurring metadata for the assistant to explain whether the selected method opens a recurring checkout or only a one-time fallback.

## ADR-092 SBP recurring migration and split billing payment-method truth

When a change touches managed SBP upgrades, provider recurring migration, `AssistantBillingSubscriptionManagementState` / `paymentMethodLabel`, CloudPayments `subscriptions/update` description fields, billing payment-success email, provider receipt payload, or `Admin > Notifications` visibility for billing sources, read `docs/ADR/092-sbp-recurring-migration-and-billing-truth-split.md` first and add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/cloudpayments-constructor-billing-provider.adapter.test.ts
corepack pnpm --filter @persai/api exec tsx test/handle-cloudpayments-webhook.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-billing-subscription.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/apply-workspace-subscription-billing-event.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/billing-lifecycle-producer.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/contracts run typecheck
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. **Split truth:** API and UI must distinguish **last payment method** from **auto-renew method**; a single ambiguous label must not be long-term source of truth.
2. **SBP migration:** one-time SBP success without provider-confirmed recurring migration must not surface SBP as the auto-renew instrument.
3. **Provider parity:** recurring amount/date updates must ship with provider description/name sync aligned to PersAI plan display naming.
4. **Idempotency:** webhook replay and duplicate provider events must not corrupt recurring migration state.
5. **Notifications:** billing and payment-success communications must flow through `NotificationIntentService` / unified platform paths; delivery history must remain visible under `GET /api/v1/admin/notifications/deliveries` for billing sources after ADR-092 implementation closes the audit items in the ADR.
6. **Receipt policy:** branded PersAI payment email must link to the official provider/cash-register receipt when available, without pretending the marketing email is the fiscal document.

## ADR-085 billing/system rollout focused checks

When a change touches billing/system subscription transitions, post-payment propagation, admin workspace subscription writes, or the billing-return truth refresh path, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/workspace-subscription-lifecycle.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/subscription-state-resolve.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-workspace-subscription.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/chat/page.test.tsx
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Trusted paid success must not stop at `workspace_subscriptions`; it must mark workspace assistants dirty, bump config generation, and enqueue visible `billing_lifecycle_change` rollout work for published assistants in the workspace.
2. System-created subscription initialization/fallback and admin workspace subscription writes must use the same visible rollout contract instead of hidden synchronous or lazy-only propagation.
3. Client return routing may trigger a reload of server truth, but it must not declare paid activation from client params alone.

## ADR-085 materialization rollout foundation focused checks

When a change touches queued materialization rollouts, manual reapply, rollout workers, rollout status persistence, or the replacement of synchronous reapply paths, add these focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
corepack pnpm --filter @persai/api exec tsx test/materialization-rollout.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/materialization-rollout-worker.service.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `Admin > Rollouts > Force reapply all` must enqueue a `manual_reapply` rollout job instead of synchronously looping every assistant in the request/response path.
2. The rollout worker must skip assistants that already have a fresh-enough materialized spec for the target generation.
3. Rollout processing must continue to use the existing safe apply/materialize/warmup path rather than inventing a parallel partial apply seam.
4. The old JSON governance `/admin/rollouts` product path must not be silently treated as equivalent truth to the new materialization rollout path during the migration.
5. Prisma/schema slices here are deploy-bearing and must be followed by the normal migration-aware deploy discipline from `AGENTS.md` / ADR-093.

## ADR-084 admin manual payment and Ops support focused checks

When a change touches `Admin > Ops` billing support actions, manual/admin paid activation, or latest paid-activation source visibility, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/manage-admin-ops-billing-support.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/ops/page.test.tsx
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Manual/admin payment must require an explicit paid plan and billing period instead of copying stale provider/fallback history implicitly.
2. The action must still write through PersAI lifecycle truth with `source=admin`, not through raw subscription row mutation or fake provider invoice state.
3. Ops Cockpit should show manual/admin paid activation as a visible source in current support detail, so operators can distinguish it from provider-driven billing events.

## Chat-length and plan quota UX focused checks

When a change touches plan quota fields such as internal active-web-chat admission or per-chat length policy, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/contracts run generate
corepack pnpm --filter @persai/api exec tsx test/prepare-assistant-inbound-turn.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/resolve-admin-ops-cockpit.service.test.ts
corepack pnpm --filter @persai/runtime test -- runtime-quota-status-tool.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/_components/pricing-page-view.test.tsx app/admin/ops/page.test.tsx app/admin/plans/page.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `messagesPerChat` must be plan-owned truth and enforce before the next user message is persisted into an existing chat.
2. `activeWebChatsLimit` remains an internal new-thread admission cap; user-facing pricing and chat UX must not market it as a tariff fact.
3. `0` on `messagesPerChat` and `activeWebChatsLimit` means unlimited, while blank/null preserves the existing default/fallback behavior where applicable.
4. Hitting the per-chat limit should surface a calm product-shaped UX that nudges the user toward a new chat or a paid plan, not a raw technical quota error.
5. Admin Ops quota presentation should emphasize compact monthly media limits/usage and not elevate active-web-chat count as a primary progress bar.

## ADR-084 pre-Slice-8 billing hardening focused checks

When a change touches payment-intent billing truth or provider billing-event application hardening ahead of the assistant billing tool, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/apply-workspace-subscription-billing-event.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-payment-intents.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. Trusted paid success must not fail only because `workspace_subscription` has not been initialized by an earlier read path.
2. User payment-intent creation must ignore tester/admin plan override state and resolve billing truth from the real workspace subscription or default-registration initialization path.
3. `Admin > Ops > Plan Control` must remain test-only and must not become billing truth indirectly through checkout logic.

## ADR-084 Slice 8 assistant quota-tool billing checks

When a change touches the existing assistant `quota_status` tool so it can explain plans or create checkout, add focused checks before broad verification:

```bash
corepack pnpm --filter @persai/api exec tsx test/read-internal-runtime-quota-status.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/create-internal-runtime-quota-checkout.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-quota-status-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
```

Interpretation rules:

1. `quota_status` must keep reporting quota truth while also exposing enough current/public plan context for the assistant to explain upgrades from the same existing tool surface.
2. Checkout creation must stay action-guarded (`confirmed=true` on the tool call), must not use lexical matching against raw user text, and must still go through a PersAI payment intent; the tool must not activate subscription state directly.
3. The assistant-facing result should return the existing `/app/billing/checkout/:paymentIntentId` entry plus an absolute checkout URL when public web origin config is available, not a second billing truth surface that bypasses product checkout state.

## ADR-079 grounded Skill/user-KB routing focused checks

When a change touches Skill routing, orchestrated retrieval context injection, model-role selection, or provider context-window failure mapping, add focused checks that prove:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/turn-routing.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/stream-native-web-chat-turn.service.test.ts
```

Interpretation rules:

1. A turn that combines selected Skills with user KB or current file context should not stay on `normal_reply`; it should route to at least `premium_reply` through configured model slots.
2. Users without enabled Skills and without grounded retrieval should keep existing normal/simple routing.
3. Retrieved context must be planned against `runtime.contextHydration.knowledgeHydrationBudget` rather than expanded until the provider rejects the request.
4. Provider context-window errors must surface as a distinct context-window class, not generic runtime unreachable.

## ADR-080 admin Knowledge authoring focused checks

When a change implements ADR-080 Skill knowledge cards, Product KB text entries, or assistant-assisted admin authoring, add focused checks for the touched area before broad verification:

```bash
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

If API/data-model behavior changes, also add focused service/controller tests that prove:

1. Skill knowledge cards can be created/edited/archived by an authorized admin and enqueue indexing only when active.
2. Product KB text entries can be created/edited/archived by an authorized admin and index through the existing ADR-079 pipeline.
3. Draft and archived authored entries are not used by runtime retrieval.
4. Assistant-assisted drafts never activate or overwrite saved admin knowledge without an explicit admin save/apply action.
5. Authored Knowledge entries remain Knowledge sources and do not become `AssistantFile` rows unless a separate Files action intentionally exports them.
6. The Skill authoring model is resolved from the admin Knowledge `authoringModelKey` policy slot and generated proposals remain draft-only.
7. Product KB baseline documents such as Product Overview and Product Principles are seeded/backfilled as active `ProductKnowledgeTextEntry` rows, are visible in Admin Knowledge, and are retrieved from Product KB entries/files rather than hard-coded runtime documents. Plan/tariff answers should still resolve from plan/subscription catalog state.

If the admin UI surfaces change, add focused web checks that prove:

```bash
corepack pnpm --filter @persai/web exec vitest run app/admin/knowledge/page.test.tsx app/admin/skills/page.test.tsx
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Product KB text entries live under Admin Knowledge and Skill knowledge cards live inside Admin Skills detail.
2. New authored entries are draft-first unless the admin explicitly selects `active`.
3. UI payload helpers preserve lifecycle/provenance truth and do not treat authored Knowledge entries as Files.
4. Reindex controls should be available only for active persisted authored entries.

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
5. final V1-style closure still requires the live smoke pair on `persai-dev` (`emotional-long` and `chitchat-short`); do not mark the slice fully closed from local unit checks alone

## ADR-113 TTS 2.0 expressive delivery focused checks

When a change touches the chat `tts` worker tool, the structured TTS delivery intent, the ElevenLabs `eleven_v3` tag compiler, or the speech provider path, add this focused pack before broad verification:

```bash
corepack pnpm --filter @persai/provider-gateway exec tsx test/run-suite.ts
corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/runtime-tts-tool.service.test.ts runRuntimeTtsToolServiceTest
corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/native-tool-projection.test.ts runNativeToolProjectionTest
corepack pnpm --filter @persai/provider-gateway run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. The model-facing `tts` tool accepts only structured intent (`delivery`, `emotion`, `pace`, `intensity`, `pause`, `nonVerbal`) plus `text`/`deliveryKind`; the legacy `toneTag` argument must be rejected as unknown, and the runtime must derive `toneTag` internally for Yandex/OpenAI baselines.
2. The safe compiler must stay conservative: whisper suppresses `[excited]`/`[dramatic]` and high-intensity escalation, the tag budget caps at `MAX_ELEVEN_V3_TAGS`, and model-authored `[...]` tags must be stripped from `text` on the v3 path so the model cannot inject raw tags.
3. ElevenLabs defaults the quality path to `model_id: "eleven_v3"` (catalog `modelKey` overrides per ADR-110); non-`eleven_v3` ElevenLabs models and non-ElevenLabs providers must ignore v3 tags and keep prior tone-based behavior.
4. The structured delivery intent is request-time only; it must not change the persisted `persai.assistantVoiceProfile.v1` schema or the saved ElevenLabs `voiceId`, and chat/Telegram audio delivery must keep flowing through the existing media/job path.

When a change touches the ElevenLabs voice catalog cache (`ElevenLabsVoiceCatalogService`, `platform_elevenlabs_voice_catalog_cache`) or `GET assistant/voice/settings`, add this focused check:

```bash
corepack pnpm --filter @persai/api exec tsx test/elevenlabs-voice-catalog.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. The catalog is a platform-wide read-through cache, not per-workspace truth: a fresh cache row (within the 24h TTL) must be served without any network call, and a successful live fetch must upsert the single cache row.
2. Load state must stay honest: `not_configured` when no ElevenLabs key (no network), `unavailable` only when the cache is empty and a live refresh fails, and `ready` otherwise — including serving the last known (stale) row with a warning when a refresh fails.
3. The `GET assistant/voice/settings` response is additive: existing fields stay, and per-entry `language`/`languageBucket` are added without breaking existing web consumers. (The catalog result intentionally exposes no `shortlist`/`fetchedAt` — there is no consumer.)
4. Admin curation must preserve two surfaces: regular users see only approved public ElevenLabs voices (capped to 24 per language bucket + gender), while admins can still browse/select from the expanded candidate list for their own assistant and curate the public set.

When a change touches the premium voice picker (`apps/web/app/app/_components/voice-picker.tsx`, `filterVoicePickerEntries`, or the assistant-settings voice section), add this focused pack:

```bash
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-voice-options.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx app/app/setup/page.test.tsx
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. `filterVoicePickerEntries` must AND together the active filters (gender + languageBucket + category + query) and match the query against label/language/category; inactive filters (`"all"`) must not exclude anything.
2. The picker is shared across all three providers but keeps the ElevenLabs surface intentionally narrow: `RU | EN | OTHER` bucket switch, compact name + play rows, and no secondary gender/category/meta chips. The assistant-gender constraint on the selectable set is preserved from assistant settings.
3. ElevenLabs non-ready states (`loading`/`not_configured`/`unavailable`) must render the honest inline message instead of the voice list, and preview playback applies only to entries that carry a `previewUrl`.

## ADR-111 talking-video cloned voice focused checks

When a change touches `Settings -> Characters`, workspace video personas, cloned-voice UI, or runtime persona guidance, add this focused pack before broad verification:

```bash
corepack pnpm --filter @persai/web exec vitest run app/app/assistant-api-client.test.ts app/app/_components/assistant-settings.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api exec tsx test/heygen-voice-catalog.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/tools/page.test.tsx
corepack pnpm --filter @persai/runtime exec tsx test/native-tool-projection.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. `My voices` must render honest ready/pending/failed state, visible legal guidance, and VC/limit gating without pretending clone creation is instant.
2. Persona forms may attach only ready active cloned voices; pending/failed rows stay visible in management UI but never become selectable persona voice truth.
3. Persona create/update payloads must preserve preset `heygenVoiceId` fallback while forwarding optional `clonedVoiceId`, and persona create must persist the resolved `videoFormat` (`auto` is UI-only; API truth is stored as `16:9` / `9:16` / `1:1`).
4. Persona portrait normalization must crop to the stored persona `videoFormat` before HeyGen avatar creation, so later talking-avatar renders do not rely on provider-added letterboxing/pillarboxing.
5. Runtime `video_generate` guidance may mention safe cloned-voice display labels only when talking video is enabled and the materialized persona catalog already carries that label; it must not expose provider ids or add keyword/fuzzy routing.
6. Talking-avatar aspect precedence must stay `explicit request > stored persona videoFormat > provider/admin default`.
7. HeyGen provider refresh must not overwrite `platform_heygen_voice_curation`; user-facing Characters catalogs require `approved && enabled`, and model-facing talking-avatar shortlists additionally require `modelShortlist`.

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
23. if delivery-honesty protection changes, verify it is structural, not prose-meaning: markdown links to local/internal file paths (`sandbox:`, `attachment://`, bare relative paths) are neutralized (href removed, link text kept), technical attachment-summary lines and delivered-attachment links are stripped, and an empty body with delivered attachments falls back to a localized "file sent" line; a bare prose claim with no link/attachment is left untouched (no keyword/regex meaning detection), and the model is instructed (delivery-honesty contract) not to announce attachment/delivery in prose because the UI renders delivered files structurally
24. if assistant workspace hydrate/reset changes, verify missing object-storage blobs do not crash the sandbox path: stale `assistant_files` rows must be removed from canonical truth, the local workspace must rebuild from the remaining accessible files, and the job must complete or fail structurally instead of taking down the pod
25. if `files.read` / `files.write` / `files.edit` or sandbox explicit mounts change, verify the normal canonical `files` path runs by hydrated workspace `relativePath` without redundant `mountedFileRefs`, and verify any remaining explicit mounted `fileRef` path is scoped to the same assistant/workspace and fails structurally after stale-row cleanup when the backing blob is missing
26. if `files.delete` or default `files.list` presentation changes, verify recursive directory delete works, root delete stays blocked, single-file delete returns the canonical deleted item, and the default list summary groups `workspace`, `uploads`, and `artifacts` without exposing raw service-noise paths unnecessarily

## ADR-081 Files authority focused checks

When a change implements ADR-081 canonical Files authority, add the focused API checks below before broad verification:

```bash
corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma
corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/inbound-media.service.test.ts
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. direct chat uploads and staged web uploads must create a chat attachment and canonical `AssistantFile` in the same logical flow, and returned attachment states must include `fileRef`
2. inbound channel media and delivered assistant attachments must also link to canonical `AssistantFile`; any generated-output model-contract changes still belong to ADR-081 Slice 2
3. Files API responses must expose `fileRef`, name/type/origin/date/size metadata, and download/update/delete actions without exposing `objectKey` as a normal selector

When a change implements ADR-081 generated/runtime output Files, add the focused runtime checks below before broad verification:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-tts-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-video-generate-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/api run typecheck
```

Interpretation rules:

1. generated image/edit/video/TTS outputs must have durable `fileRef` immediately when persisted
2. model-facing generated-output send semantics must use `fileRef`, not `artifactId`
3. API delivery must link chat attachments to existing generated `fileRef` when runtime supplies one

When a change implements ADR-081 runtime Files/Skill working-file behavior, add these focused runtime checks:

```bash
corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts
corepack pnpm --filter @persai/runtime run typecheck
```

Interpretation rules:

1. prompt hydration must present uploaded/current chat attachments as working files with durable `fileRef`
2. `files.search/inspect/get/read/send` must operate over the unified assistant Files registry, including uploads, generated outputs, and sandbox outputs
3. `files.inspect` / legacy `files.get` must return `capabilities` gated by materialized `maxFilePreviewBytes`; plan save must round-trip `maxFilePreviewBytes` / `maxFilePreviewEdgePx` on the `files` activation row
4. `files.read`/`files.edit`/`files.delete` must mount resolved registry files into sandbox by required `fileRef`, not by storage path or object key
5. ambiguous query behavior must return clear candidate items with `fileRef`

When a change implements ADR-081 Assistant Settings Files UI or chat attachment projection, add these focused web checks:

```bash
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx app/app/_components/chat-message.test.tsx app/app/assistant-api-client.test.ts
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. Assistant Settings must expose Files as an inline section, not a separate route
2. long file lists must stay scroll-bounded inside the section
3. Open/Download/Rename/Delete actions must use canonical `fileRef` APIs/routes and must not expose `objectKey` or raw storage paths
4. chat attachment cards must prefer the canonical Files route when `fileRef` exists

When a change implements ADR-081 final cleanup or contract hardening, add these checks:

```bash
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx app/app/_components/chat-message.test.tsx app/app/_components/image-lightbox.test.tsx app/app/assistant-api-client.test.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Interpretation rules:

1. product open/download links must use canonical `fileRef` routes, not `attachmentId` routes
2. assistant Files API/UI state must not expose `objectKey`, storage paths, raw sandbox paths, or checksum internals as user-facing selectors
3. any remaining `artifactId`, `objectKey`, or path usage must be internal storage/sandbox/runtime accounting, not model/product selector truth
4. API `assistant/files*` routes must be covered by `ClerkAuthMiddleware`; missing coverage appears in live logs as `401` with `userId:null` and controller text `Authenticated user context is missing`
5. chat attachments without canonical `fileRef` must not render fallback `<a href="#">` download links, because browsers can save the app shell as `chat.html`
6. full verification gate still applies before closing the slice

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
5. verify the three hot-path `/metrics` surfaces stay aligned with those logs: `apps/api` exposes `web_stream_*`, `apps/runtime` exposes `runtime_stream_*`, and `apps/provider-gateway` exposes `provider_gateway_stream_*`
6. verify the API trace/request id used in `web_stream_timing` is the same request id propagated into runtime/provider-gateway stream logs for the same turn, so operators do not need to guess cross-service correlation keys
7. for web-chat continuity changes, prove the ordinary first-send path still uses a single `POST /assistant/chat/web/stream` without a blocking preflight, while resume/switch paths can use `messages.activeTurn` plus `GET /assistant/chat/web/turns/:clientTurnId/stream` reattach

## Durable memory M1 focused checks

When a change touches durable assistant memory classification, the write-time `core` / `contextual` class, the internal `runtime → api` memory hydration endpoint, the `durable_memory_core` cached prefix block, or the Memory Center class/kind labels, add the focused pack below before calling the slice clean. (ADR-120 Slice 1 retired the always-on pushed `durable_memory_contextual` block; `contextual` is now a write-time class recalled on demand via the `knowledge_search` `memory` source, not a per-turn push.)

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
3. verify `HydrateMemoryForTurnService` returns the always-on `core` block only (ADR-120 Slice 1; the relevance-retrieved contextual tail was removed) and bumps `last_used_at` on every hydrated core entry.
4. verify the runtime composes the `durable_memory_core` prompt block (always present when any core entries exist, byte-stable across turns) and that NO `<persai_memory>` / contextual block is ever pushed (ADR-120 Slice 1). A fact written in one chat must never surface in another chat's prompt.
5. verify the prompt-cache invariant explicitly: the stable token sequence emitted for `durable_memory_core` + `shared_compaction_summary` stays byte-stable across turns regardless of the per-turn volatile content (scenario / system-reminder).
6. final M1-style closure still requires the live smoke pair on `persai-dev` (`multi-session-continuity` and `chitchat-short`); do not mark the slice fully closed from local unit checks alone.

## Knowledge/admin focused checks

When a change touches the active knowledge plane, retrieval policy, or admin knowledge surfaces, the focused verification pack should include the relevant targeted tests:

```bash
corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/knowledge-indexing-job-worker.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-knowledge-sources.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-document-processing-settings.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/enabled-skills-prompt-materialization.test.ts
corepack pnpm --filter @persai/api exec tsx test/compile-prompt-constructor.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-admin-skills.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-knowledge-sources.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/manage-assistant-skills.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts
corepack pnpm --filter @persai/api exec tsx test/admin-authorization.test.ts
corepack pnpm --filter @persai/api exec tsx test/runtime-knowledge-access.test.ts
corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts
corepack pnpm --filter @persai/api exec tsx test/shared-knowledge-platform-ownership-audit.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-routing.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/skills/page.test.tsx
corepack pnpm --filter @persai/web exec vitest run app/app/_components/activity-badge.test.tsx
corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-skills-manager.test.ts app/app/setup/page.test.tsx
```

For shared admin-managed KB ownership changes, also verify:

1. selected active Skill retrieval searches by assigned/selected Skill ids and Skill source types, not by the consuming assistant workspace
2. Product KB/global retrieval reads active/ready platform rows for assistants from any workspace
3. assistant uploads, memory/chat, Files, and retrieval telemetry remain workspace-scoped
4. inactive or unassigned Skills do not contribute runtime context
5. admin Skill/Product/global KB uploads do not debit tenant workspace knowledge-storage quota
6. the post-migration audit SQL fails if shared KB tables, chunks, jobs, or vectors still have tenant workspace-owned leftovers

For runtime ordinary source priority changes (ADR-079 follow-up, 2026-05-04), also verify:

1. `turn-routing.service.test.ts` covers `personal_first` / `product_first` / `web_first` / `mixed_ambiguous` precheck outcomes plus an admin override via `Router Policy > productPriorityTerms` and the `not_applicable` path for trivial continuation turns
2. `orchestrate-runtime-retrieval.service.test.ts` covers staged ordinary retrieval ordering (`product_first` ranks Product KB above user KB, `personal_first` ranks user KB above Product KB, `web_first` records honest `ordinary_web_first` policy state for non-executed web grounding)
3. retrieval observability emits `policyState=ordinary_*` for non-Skill turns and `policyState=skill_only|escalated_to_*` for active-Skill turns
4. model-visible `knowledge_search` / `knowledge_fetch` source enums no longer include `preset` (runtime native-tool projection and API `read-assistant-knowledge.service` reject `preset` requests structurally)

For ADR-094 smart `knowledge_search` and flexible `knowledge_fetch` (2026-05-13), also verify:

1. `read-assistant-knowledge.service.test.ts` covers the smart-search branches: 1 hit + short doc → `inlinedDocument` attached; 1 hit + medium doc → `inlinedSection`; 1 hit + long doc → `inlinedSection` + `documentSummary` capped by `smartSearchLongDocSummaryChars`; multi-hit results stay snippet-only
2. `read-assistant-knowledge.service.test.ts` covers flexible fetch: `mode = "short" | "section" | "full"` with optional `radius`; chat `mode = "section"` returns tens of messages assembled chronologically (not `± 1`); `mode = "full"` over the cap produces `truncated: true` plus structured `truncationMarker`
3. `orchestrate-runtime-retrieval.service.test.ts` covers smart inlining on the orchestrated path: a single ready short doc lands whole inside `# Retrieved Knowledge Context`; long docs land as section + summary; per-call limits derive from policy, not in-file `MAX_ITEM_CHARS` / `MAX_CONTEXT_ITEMS` literals
4. `manage-admin-plans.service.test.ts` covers the additive `billingHints.retrievalPolicy` keys (`smartSearchShortDocChars`, `smartSearchMediumDocChars`, `chatSectionDefaultRadius`, `fetchFullModeMaxChars`, `fetchFullModeMaxChatMessages`); existing plan rows without these keys still resolve to the Start-tier-grade default
5. `runtime-knowledge-tool.service.test.ts` covers the runtime contract: `knowledge_fetch` arguments accept `mode` plus optional `radius`, default `mode = "section"` is applied at parse time when callers omit it (this is the permanent contract default, not a deprecation alias)
6. effective per-call limit equals `min(plan.fetchFullModeMaxChars, admin.fetchFullModeAbsoluteMaxChars)` for documents and `min(plan.fetchFullModeMaxChatMessages, admin.fetchFullModeAbsoluteMaxChatMessages)` for chat; admin ceilings live in `PlatformRuntimeProviderSettings.adminKnowledgeRetrievalPolicy` and no plan can exceed them
7. `apps/web/app/admin/plans/page.test.tsx` round-trips the five new per-plan smart-retrieval fields through `planToDraft` / `draftToPayload` / `validatePlanDraft`, asserting both the Start-tier-grade defaults and that explicit overrides persist back into `billingHints.retrievalPolicy`
8. `apps/web/app/admin/knowledge/page.test.tsx` covers the new "Smart Retrieval Limits" section: the four admin ceilings (`smartSearchEnabled`, `smartSearchLongDocSummaryChars`, `fetchFullModeAbsoluteMaxChars`, `fetchFullModeAbsoluteMaxChatMessages`) hydrate from the loaded admin policy and are sent back through `updateAdminKnowledgeRetrievalPolicy` on save
9. `KnowledgeRetrievalEvent` rows persist `modeUsed` (VARCHAR(32), sliced defensively at the persistence boundary) and `bytesReturned` for search / fetch / orchestrate paths: document searches tag `smart_inline_full` / `smart_inline_section` / `smart_inline_summary`; non-document searches (memory / chat / subscription / global) and orchestrator aggregate per-source rows tag `snippet_only` with `bytesReturned = 0`; fetches tag `short` / `section` / `full` with `bytesReturned` = actual returned content length; orchestrator skill-window inlining tags `orchestrate_inline` with `bytesReturned = fetchedChars`; pre-ADR-094 rows keep both columns NULL after the additive migration

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

## ADR-088 Slice 1 — Unified Notification Platform (Foundation)

These are focused tests for the new services, adapters, and API. Run them in CI alongside the standard gate.

### Notification Intent Service (`notification-intent.service.ts`)

- `createIntent` with valid args persists a `notification_intents` row with `status=pending`
- `createIntent` with a duplicate `deduplicationKey` within the dedup window returns the existing intent and does not create a duplicate row
- `createIntent` with an unknown `source` enum value is rejected with a validation error before DB write

### Notification Routing Service (`notification-routing.service.ts`)

- `resolveChannels` for a `conversational` class intent resolves only `telegram_thread` and `web_thread` channels when both are enabled
- `resolveChannels` returns an empty list when all channels are disabled in the registry
- quiet-hours check correctly suppresses a channel when the current time falls inside the quiet window (tested with a fixed UTC clock and `workspace_tz` mode)
- quiet-hours check does not suppress the channel when the current time is outside the quiet window

### Notification Delivery Worker (`notification-delivery-worker.service.ts`)

- claiming an intent transitions `status` from `pending` to `routing` atomically (no double-claim under concurrent workers — use `$transaction` + optimistic lock assertion)
- a successful adapter `deliver()` call sets attempt status to `delivered` and intent status to `delivered`
- a failed adapter `deliver()` call (throws) increments attempt count, records `lastError`, and leaves intent for retry or escalation
- after `maxAttempts` failures, the intent is moved to `notification_dead_letters` with a serialized failure reason

### Channel Adapters

- `EmailChannelAdapter.deliver()` in dev (no `POSTMARK_SERVER_TOKEN`) returns `{ status: "skipped" }` without throwing
- `EmailChannelAdapter.deliver()` with a mock Postmark client returns `{ status: "delivered", providerRef: "<messageId>" }` on success
- `TelegramThreadChannelAdapter.deliver()` delegates to the existing Telegram message-send path and does not duplicate its send logic
- `WebPushChannelAdapter.deliver()` and `MobilePushChannelAdapter.deliver()` return `{ status: "skipped" }` (stubs)
- `AdminWebhookChannelAdapter.deliver()` posts a JSON body to the configured URL and returns `delivered` on 2xx, `failed` on non-2xx

### Postmark Webhook (`POST /api/v1/internal/notifications/postmark-webhook`)

- request with valid HMAC signature is accepted and updates `healthStatus` and `consecutiveFailures` in `notification_channel_registry`
- request with invalid/missing HMAC is rejected with 403 and does not mutate the registry
- bounce event correctly sets `healthStatus=degraded` when `consecutiveFailures` threshold is crossed

### Preview Endpoint (`POST /api/v1/admin/notifications/preview`)

- `strategy=template` + valid `templateId` returns rendered HTML/text without calling Postmark live send
- `strategy=grounded_llm` returns a dry-run response string without calling the LLM in live mode
- missing required body fields return 400

### Admin Notifications Page (E2E intent)

- `GET /api/v1/admin/notifications/channels` returns the seeded `telegram_thread`, `web_thread`, `web_notification_center`, `email`, `admin_webhook` channel rows
- toggling a channel via `PATCH /api/v1/admin/notifications/channels/:type` persists `isEnabled` change
- `GET /api/v1/admin/notifications/dead-letters` returns an empty list when no dead letters exist
- `POST /api/v1/admin/notifications/dead-letters/:id/replay` re-queues the intent and removes the dead-letter record

### Legacy path non-regression

- All pre-existing notification paths (idle reengagement, quota advisory, billing lifecycle, admin webhook) must continue to function unchanged after Slice 1 deploy — no production user notification path should touch `notification_intents`

---

## ADR-088 Slice 2 — Conversational Migration

These are focused tests for the Slice 2 conversational producer migration and real adapter delivery. All live in `apps/api/test/` and run via tsx.

### Telegram Thread Channel Adapter (`telegram-thread-channel.adapter.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/telegram-thread-channel.adapter.test.ts
```

Covers:

- `deliver` with a valid surfaceThreadKey and bot token → `status: "delivered"`, `providerRef: "telegram:<chatId>:<messageId>"`
- 4xx Telegram HTTP response → `status: "failed"`, `error.httpStatus` present
- network fetch rejection → `status: "failed"`
- missing bot token → `status: "failed"`, `error.reason === "telegram_bot_token_not_configured"`
- missing chatId (no surfaceThreadKey, no config, no binding) → `status: "failed"`, `error.reason === "telegram_chat_id_not_resolved"`

### Web Thread Channel Adapter (`web-thread-channel.adapter.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/web-thread-channel.adapter.test.ts
```

Covers:

- `deliver` with chatId + assistantId → `status: "delivered"`, `providerRef: "web_thread:<chatId>:<messageId>"`
- missing chatId → `status: "failed"`, `error.reason === "web_thread_context_missing"`
- `createMessage` throws → `status: "failed"`

### Web Notification Center Channel Adapter (`web-notification-center-channel.adapter.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/web-notification-center-channel.adapter.test.ts
```

Covers:

- `deliver` calls `findOrCreateChatBySurfaceThread` with `surfaceThreadKey === "system:notifications"`
- `providerRef === "web_nc:<chatId>:<messageId>"`

### Quota Advisory Follow-Up Service (`quota-advisory-follow-up.service.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/quota-advisory-follow-up.service.test.ts
```

Covers:

- Web surface turn → `createIntent` called with `allowedChannels: ["web_thread"]`, `surface: "web"`, `traceId` forwarded
- Telegram surface turn → `createIntent` called with `allowedChannels: ["telegram_thread"]`, `surface: "telegram"`, `traceId` forwarded
- LLM decides `no_push` → returns `null`, `createIntent` not called
- No eligible advisory candidates → returns `null`, `createIntent` not called

### ADR-088 Slice 3 — Billing Templates (`billing-templates.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/billing-templates.test.ts
```

Covers (both `ru` and `en` locales for each rule):

- `trial_ending`, `trial_expired`, `renewal_failed`, `grace_ending`, `grace_expired`, `payment_recovered` templates produce non-empty `subject`, `html`, `plainText`
- Determinism: calling the same render function twice returns bit-identical output
- `html` contains `<!DOCTYPE html>`, plan name, no MJML tags
- `plainText` contains unsubscribe-related footer text
- Six short-form templates (`.short.template.ts`) produce concise `plainText` (< 500 chars), non-empty, deterministic
- Unknown locale falls back to `ru`
- Null date fields produce a graceful fallback (`—`)

### ADR-088 Slice 3 — Billing Lifecycle Producer (`billing-lifecycle-producer.service.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/billing-lifecycle-producer.service.test.ts
```

Covers:

- `payment_recovered`, `renewal_failed`, `grace_started`, `trial_started`, `trial_expired`, `grace_expired` events each produce one email intent with `class=transactional`, `source=billing_lifecycle`, `priority=scheduled`, `renderStrategy=template`, correct `templateId`, `allowedChannels=["email"]`, `respectQuietHours=false`, `traceId=eventId`, `dedupeKey=rule:workspaceId:eventId`, `factPayload.recipientEmail` from event user email
- `assistantPushEnabled=true` → second intent with `class=conversational`, `allowedChannels=["web_notification_center"]`, same `traceId`, distinct dedupe key (`:push` suffix)
- `policyEnabled=false` → no intents
- `null` event → no intents (early exit)
- Same `(rule, workspace, eventId)` called twice → one intent only (dedupe)
- Rule disabled in policy config → no intent for that rule
- Unknown `eventCode` → no intent

### ADR-088 Slice 3 — Email Channel Adapter Slice 3 Extension (`email-channel.adapter.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/email-channel.adapter.test.ts
```

Extended with (Slice 3 addition — test 7):

- Billing template content flows through correctly: `To` = `recipientEmail`, `From` = `notifications.persai.dev` address, `Subject` matches template, `Tag=billing_lifecycle`, `X-Trace-Id` carries billing event id, `List-Unsubscribe` present

### Notification Delivery Worker Extended (`notification-delivery-worker.service.test.ts`)

Run:

```bash
corepack pnpm --filter @persai/api exec tsx test/notification-delivery-worker.service.test.ts
```

Part A (original — ADR §11 structured log fields):

- All `notification.delivery.attempted`, `.delivered`, `.failed`, `.escalated`, `.dead_letter` events carry required `intentId`, `workspaceId`, `assistantId`, `userId`, `source`, `class`, `priority`, `renderStrategy`, `channel`, `attemptNumber`, `latencyMs`, `outcome`, `traceId` fields
- `latencyMs` measured from `intent.createdAt`, not worker pickup

Part B (Slice 2 addition — real worker instantiation with in-memory Prisma + mock adapters):

- Deferred intent with a future `scheduledAt` is **not** claimed by the worker's WHERE clause
- Deferred intent whose `scheduledAt` has elapsed **is** claimed and delivered
- Two `createIntent` calls with the same `dedupeKey` return the same intent ID — only one row exists in the store (deduplication at intent-service level, not worker level)
- Primary channel failure + `escalationChannel` configured → escalation attempt succeeds, `notification.delivery.escalated` event emitted

---

## ADR-120 Slice 6 — snippet-first default + atomic-card exception + retrieval presets

```bash
corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts
corepack pnpm --filter @persai/web exec vitest run app/admin/plans/page.test.tsx --config vitest.config.ts
```

- `read-assistant-knowledge.service.test.ts` (`runSkillPull`) asserts that with `smartSearchEnabled=false` a normal `skill_document` hit stays snippet-only (no `inlinedDocument` / `inlinedSection`), and that a `skill_knowledge_card` hit returns its FULL card text inline (`inlinedDocument`, all card chunks joined, `truncated=false`).
- `plans/page.test.tsx` asserts the retrieval preset dropdown fills all 16 raw retrieval draft fields atomically for `rich` / `lean` / `balanced`, and that the dropdown reflects `custom` when the draft matches no preset (UI fill-helper only; no persisted `retrievalPolicy.preset`).

## ADR-119 golden tests

Six golden tests lock the invariants from the ADR-119 prompt architecture program. All six must pass on every PR. Failure of any golden test indicates a structural regression in the prompt assembly pipeline.

**GT1 — Full materialized system-prefix byte-snapshot** (`apps/api/test/adr119-golden-prompt-snapshot.test.ts`)
Compiles the full AOT cached system prefix for a representative fixture: Lyra assistant (warm_quiet archetype + flirty `<character_notes>`), one enabled Marketer Skill with a 5-step Instagram-carousel scenario. On first run the expected file is generated at `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` and committed. Subsequent runs assert byte equality. Catches any unintended template change, persona compiler regression, or enabled-skills materialization drift.

**GT1b — Runtime volatile-context zone structure** (`apps/runtime/test/adr119-golden-prompt-snapshot.test.ts`)
Runtime-side companion to GT1. Validates that the three-zone boundary (stable prefix / volatile context / conversation tail) is respected, that the durable_memory_core block stays in the stable prefix, and that the remaining volatile kinds (`<persai_active_scenario>`, `<system-reminder>`) are repositioned correctly. As of ADR-120 Slice 1 it also asserts that NO `<persai_memory>` contextual block is emitted. Catches any regression in the runtime's volatile-context construction.

**GT2 — Cache-prefix byte-stability across 5 state variants** (`apps/runtime/test/prompt-cache-stable-blocks.test.ts`)
Asserts that the stable-prefix tokens (BP1 + BP2) are byte-identical across distinct state variants: (a) no Skill engaged, (b) Skill engaged no scenario, (c) Skill engaged with active scenario, (d) Skill released, (e) rotating per-turn volatile content (scenario / system-reminder). Catches any code path that accidentally promotes volatile content into the stable-prefix family, which would cause unnecessary provider cache invalidation.

**GT3 — `<priority_order>` enumerates Skills #1** (`apps/runtime/test/native-tool-projection.test.ts`, `runAdr119Invariantstest`)
Reads `apps/api/prisma/bootstrap-preset-data.ts` and asserts that the `tools` template contains a `<priority_order>` block with "Skills are the gate" as the first entry, followed by Knowledge, Media, and other rules in the correct order. Also verifies `<parallelism>` states `skill({engage})` is ALWAYS solo and `<failure_handling>` mentions `pending_delivery`. Catches selection-guide template edits that would demote Skills from position #1, re-enable parallel skill calls, or remove critical delivery honesty rules.

**GT4 — Provider request payload flags** (`apps/provider-gateway/test/anthropic-provider.client.test.ts` and `openai-provider.client.test.ts`)
Verifies: when `skillsEnabled === true` and tools are present, Anthropic sets `tool_choice: { type: "auto", disable_parallel_tool_use: true }` and OpenAI sets `parallel_tool_calls: false`. When `skillsEnabled === false` or `undefined`, those flags must not be set (back-compat). Catches any provider-client regression that would re-enable parallel tool calls when Skills are active, which has been observed to cause model misbehavior in production.

**GT5 — Persona deduplication** (`apps/api/test/compile-prompt-constructor.service.test.ts`, `runAdr119GoldenTest5PersonaDedup`)
Asserts `<character_notes>` appears exactly once when `snapshotInstructions` is non-empty, `<voice>` and `<character_notes>` are textually adjacent with no intervening XML open tags, and `snapshotInstructions` content appears exactly once in the materialized prompt. Also asserts the old compiler bug (snapshotInstructions appearing before `<voice>` as a standalone section) does not regress. Catches any soul-template edit or compile-service change that would re-introduce the persona duplication failure mode [F1] from ADR-119.

**GT6 — Memory provenance set on write paths** (`apps/api/test/write-assistant-memory.service.test.ts`)
Verifies all four `AssistantMemoryProvenance` values (`user_explicit`, `system_inferred`, `auto_extracted`, `legacy`) are set correctly at write time by their respective services. ADR-120 Slice 1 retired the `<persai_memory>` contextual render (and `formatDurableMemoryContextualBlock`), so provenance is now a persisted column surfaced read-only in the Memory Center rather than an XML attribute in the prompt. Catches any regression that would drop or mis-tag provenance on the write path.

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
