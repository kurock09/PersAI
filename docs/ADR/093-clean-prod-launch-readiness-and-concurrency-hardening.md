# ADR-093: Clean PROD launch readiness and concurrency hardening

**Status:** Accepted  
**Date:** 2026-05-11  
**Relates to:** [ADR-070](070-scaling-readiness-program-and-clean-delivery-discipline.md) (scaling program discipline), [ADR-091](091-production-grade-background-scheduler-architecture.md) (scheduler + pool sizing precedent), [ADR-086](086-async-media-jobs-for-generated-image-audio-and-video.md) (async media path already exists)  
**Deploy truth:** [infra/dev/gitops/README.md](../../infra/dev/gitops/README.md), [infra/dev/gke/RUNBOOK.md](../../infra/dev/gke/RUNBOOK.md)

## Context

PersAI is approaching a **clean PROD launch with test users**. The product must stay **high quality**: no dumbing down assistant behavior, no keyword routing in chat, no breaking existing parallel tool execution, no hardcoding important policy as ad hoc literals.

At the same time, evidence from architecture review shows **shared capacity pressure** when many concurrent users run heavy turns (long-lived streams, tool loops, internal fan-out, sandbox work). Tail latency and variance can grow before averages look bad. **Saved bounded load evidence** for a 500–1000 concurrent-user ladder is not yet a repo artifact; claims must stay evidence-first per ADR-070.

This ADR is **not** a reopen of historical migration ADRs (072–078). It is a **new execution program**: how agents deliver hardening **cleanly**, with **few deploys**, **mandatory audits**, and **explicit session boundaries**.

## Non-goals

- Changing product/business rules, tool semantics, or “simplifying” turns to reduce load.
- Introducing chat routing based on user text keywords.
- Leaving indefinite dual code paths, hidden feature flags, or TODO scaffolding.
- Micro-slicing work into many tiny pushes (each push triggers deploy cost).

## Decision

### Program shape

1. **One umbrella ADR (this document)** is the canonical spec for the program. Ordered work lives in **4–6 large sessions** below. Each session is **one coherent reviewable unit**, not a swarm of micro-PRs.
2. **Agent discipline** follows [AGENTS.md](../../AGENTS.md): one session = one bounded slice unless the user explicitly expands scope; no silent architecture changes; docs updated in the same slice when truth moves.
3. **Transition modes** are **disallowed by default**. Prefer **direct replace** to target state while real external user load is absent. Use a **temporary dual path** only when a technical cutover requires it; then it MUST name: owner, removal condition, and removal slice. No “forever compat”.
4. **Deploy discipline**: `persai-dev` uses **Argo CD auto-sync**; **push → image publish → GitOps pin → sync** ([infra/dev/gitops/README.md](../../infra/dev/gitops/README.md)). Therefore:
  - Group risky changes so **one session → ideally one deploy** (one coherent merge/push), not many small pushes.
  - Every session that expects cluster rollout MUST be labeled `**DEPLOY REQUIRED`** and include the post-deploy checklist below.
5. **Verification split** after any deploy:
  - **Agent (kubectl / GitOps):** cluster health, rollout, migrations hook, targeted logs/metrics as needed.
  - **Human (UI):** short smoke list only (2–5 checks). No open-ended “click around”.
6. **Progression gate:** before starting the next session, run the **mandatory intermediate audits** for the finished session. **Critical findings block** starting the next session. **Quality findings** are fixed in the same session or explicitly deferred with reason in CHANGELOG / handoff.
7. **Session boundary:** when a session completes, the agent **stops**. It outputs the **next-session prompt** for **GPT-5.4** (see §Session handoff contract). It does not silently continue across the boundary.

### Mandatory intermediate audits (per risky session, before next session)

Run in parallel readonly passes where possible:


| Audit                     | Question                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code-cleanliness**      | No dead code paths, no duplicate “shadow” helpers, no unexplained magic numbers; changes match session scope.                                                                                         |
| **Legacy / tail cleanup** | Temporary paths removed or have explicit removal slice; no stale flags.                                                                                                                               |
| **Failure-model**         | Timeouts, retries, and degradation behave predictably; no unbounded queues without operator visibility.                                                                                               |
| **Deploy-truth**          | Helm values, secrets wiring, and Argo app still match [infra/dev/gitops/README.md](../../infra/dev/gitops/README.md).                                                                                 |
| **Load / evidence**       | If the session touches scale paths, cite existing or new evidence (e.g. SR10 JSON under `artifacts/sr10-loadtest/` per [TEST-PLAN.md](../TEST-PLAN.md)); do not claim ceilings without saved reports. |


### Deploy policy and post-deploy template

**Path (dev):** GitOps application `persai-dev` → chart `infra/helm` → values `infra/helm/values-dev.yaml`; `api-migrate` **PreSync** before API rollout; failed migration blocks rollout ([infra/dev/gitops/README.md](../../infra/dev/gitops/README.md)).

**Pre-deploy (when Helm / deploy truth changes):**

```bash
helm lint infra/helm -f infra/helm/values-dev.yaml
helm template persai-dev infra/helm -f infra/helm/values-dev.yaml > /dev/null
```

**Agent post-deploy (every `DEPLOY REQUIRED` session):**

```bash
kubectl get applications.argoproj.io -n argocd
kubectl -n persai-dev get deploy,svc,ingress,networkpolicy
kubectl -n persai-dev get pods -o wide
kubectl -n persai-dev get jobs -l app.kubernetes.io/name=api-migrate
# If migration ran: kubectl -n persai-dev logs job/api-migrate --tail=120
# Slice-specific: kubectl top pods -n persai-dev, kubectl logs deploy/<name> --tail=..., deployment env spot-checks per RUNBOOK
```

**Human UI post-deploy (customize per session, keep 2–5 checks):** examples — open `/app`, send one short web message; open admin smoke if session touched admin; billing smoke only if session touched billing. **List the exact checks in the session handoff for that session.**

**Observation window:** at least a short window (e.g. 15–60 minutes) after deploy before calling the session “closed”, unless the session doc defines otherwise.

### Session handoff contract (for GPT-5.4)

When a session ends, the agent MUST append to [SESSION-HANDOFF.md](../SESSION-HANDOFF.md) and output a **copy-paste prompt** containing:

1. **Session id** (e.g. `ADR-093 Session 3`).
2. **Mandatory reading:** this ADR, relevant slice section, [AGENTS.md](../../AGENTS.md), [TEST-PLAN.md](../TEST-PLAN.md) gates touched.
3. **Exact scope** (in / out).
4. **Forbidden shortcuts:** no business-logic hacks, no keyword routing, no silent flags.
5. `**DEPLOY REQUIRED` or `NO DEPLOY EXPECTED`** and why.
6. **Audit expectation:** which of the five audits run and outcomes.
7. **Completion checklist:** tests run, cluster checks, UI checks, residuals.

## Execution sessions (large slices — do not subdivide without updating this ADR)

### Session 1 — Observability, measurement truth, and hot-path tracing

- **Scope:** Consolidate what operators and agents need to see under concurrent load: structured logs, metrics, trace correlation across `api` / `runtime` / `provider-gateway`, and clear “first bottleneck” signals. Align with existing timing hooks where they already exist (e.g. web stream timing) without changing product behavior.
- **Likely touch areas:** `apps/api`, `apps/runtime`, `apps/provider-gateway`, optional `infra/helm` for scrape/config only if already pattern-supported.
- **Out of scope:** Changing tool loop limits, plan quotas, or assistant prompts.
- **Deploy:** `DEPLOY REQUIRED` only if runtime flags or scrape endpoints need cluster validation; otherwise `NO DEPLOY EXPECTED` for doc-only / local-only changes — **decide per implementation and record in handoff**.
- **Human UI:** Minimal — confirm `/app` still loads and one chat send works if anything ingress-adjacent changed.
- **Exit:** Audits pass; documented “what to watch” for Sessions 2–5; no new orphan debug paths.

### Session 2 — Runtime / API execution isolation and fairness foundations

- **Scope:** Technical isolation and fairness so heavy turns do not starve light turns **without** changing business outcomes: admission limits, queueing, or execution-class separation as implemented in code/config — **design in this session must be validated against ADR-070 evidence-first rule** before claiming PROD-ready ceilings.
- **Likely touch areas:** `apps/api`, `apps/runtime`, `infra/helm` (replicas, resources, HPA policy when evidence allows — note [TEST-PLAN.md](../TEST-PLAN.md) guidance on HPA for runtime/provider-gateway).
- **Out of scope:** Product-facing “routing” by chat keywords; reducing tool parallelism for convenience.
- **Deploy:** `DEPLOY REQUIRED` when behavior or Helm defaults change.
- **Human UI:** Short web chat + optional one tool-heavy scenario **if** session enables new limits (exact scenario in handoff).
- **Exit:** Audits pass; no dual-path scheduler semantics; pool/DB implications documented.

### Session 3 — Provider-gateway, SSE transport efficiency, and web client reconcile pressure

- **Scope:** Reduce **technical** overhead of streaming and unnecessary client-driven request amplification (reconcile/polling, flush frequency) while preserving UX contracts (soft detach, resume, media job visibility).
- **Likely touch areas:** `apps/provider-gateway`, `apps/runtime` stream clients, `apps/web` (`use-chat`, `assistant-api-client`), `infra/helm` (e.g. backend timeout already documented for long SSE).
- **Out of scope:** Removing idempotent replay or breaking `clientTurnId` semantics.
- **Deploy:** `DEPLOY REQUIRED` when any of web/runtime/provider-gateway changes ship.
- **Human UI:** Focus/visibility resume smoke + one streaming turn + active media job row if touched.
- **Exit:** Audits pass; measurable reduction in redundant calls or stream overhead **or** documented trade-off with evidence.

### Session 4 — Sandbox isolation and completion-path cleanup

- **Scope:** Sandbox must not be a single unbounded bottleneck for file/exec/shell workloads: scaling, health, and less chatty completion/polling patterns **without** changing sandbox security model.
- **Likely touch areas:** `apps/sandbox`, `apps/runtime` sandbox client, `infra/helm` (`sandbox` replicas, PDB, resources).
- **Out of scope:** Weakening isolation or skipping tool authorization.
- **Deploy:** `DEPLOY REQUIRED`.
- **Human UI:** One file or sandbox-backed flow if available in test workspace.
- **Exit:** Audits pass; sandbox failure modes observable; no silent queue growth.

### Session 5 — Bounded load proof and PROD sign-off

- **Scope:** Execute bounded load ladder per [TEST-PLAN.md](../TEST-PLAN.md) / `scripts/loadtest/README.md`; save JSON under `artifacts/sr10-loadtest/`; record first bottleneck; **do not claim a ceiling above the highest passing profile**.
- **Likely touch areas:** `scripts/loadtest`, docs, optional small harness fixes — **no fake results**.
- **Deploy:** `DEPLOY REQUIRED` only if production candidate config must be validated in cluster; otherwise may be `NO DEPLOY EXPECTED` for harness-only work.
- **Human UI:** Optional sanity — pricing/login if billing path stressed.
- **Exit:** ADR-093 status may move to **Accepted** only after: Session 5 audits pass, evidence attached or referenced, and explicit “known residuals” list is empty or accepted by owner.

### Final status note (2026-05-12)

ADR-093 is now **Accepted** for the bounded repo-local hardening/evidence program itself:

1. Sessions 1-4 were landed and documented as the active technical hardening path.
2. Session 5 produced saved evidence showing that the old SR10 runner shape was not an honest concurrent-user proof when only a tiny bearer-token identity pool was available.
3. The invalid concurrency contour has now been corrected at the harness boundary: the runner no longer reuses the same small token set across many workers, no longer relies on synthetic thread-pool collisions, and now fails fast if the selected profile asks for more unique identities than the config provides.
4. The polluted test chats created by the invalid rerun were removed through the normal authenticated chat-delete API path, leaving the dev environment clean for future work.

Acceptance of this ADR does **not** mean PersAI now has a proven `60/100 unique-user` readiness ceiling. It means the clean-launch hardening program and its evidence discipline are complete for this slice, and future capacity claims must come from either:

- a real unique-identity load pool sized to the claimed concurrency, or
- a separately defined and explicitly named online-equivalent load model that does not pretend to be unique-user proof.

## Cleanup rules (every session)

1. **Direct replace** is default; remove old code in the same session when safe.
2. **Temporary dual path** only with: name, owner, removal condition, removal slice — all recorded in CHANGELOG + handoff.
3. **No dead stubs**, no `TODO` scaffolding, no undocumented env toggles.
4. Each session lists **what must disappear** before the session is marked complete.

## Consequences

### Positive

- One clear program for agents; fewer accidental micro-deploys.
- PROD launch stays **clean** and evidence-backed.
- Business logic preserved; improvements are technical and measurable.

### Negative

- Large sessions require discipline and time.
- Some work may wait until prior session audits complete.

## Alternatives considered

- **Many small ADRs** — rejected: fragments agent context and encourages micro-deploys.
- **No ADR, only chat** — rejected: violates repo truth and [AGENTS.md](../../AGENTS.md) discipline.
- **Always transitional dual paths** — rejected: conflicts with clean launch; allowed only when technically necessary.

