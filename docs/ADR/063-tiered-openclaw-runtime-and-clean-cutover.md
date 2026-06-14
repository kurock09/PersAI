# ADR-063: Tiered OpenClaw runtime and clean cutover

## Status

Accepted

## Context

PersAI is moving from a functional single-runtime baseline toward a paid production SaaS model with materially higher expectations for:

- runtime isolation
- cost control
- noisy-neighbor protection
- clean OpenClaw fork maintenance
- GKE readiness for growth beyond one shared runtime

The current implementation still assumes one OpenClaw runtime endpoint per environment:

- one `OPENCLAW_BASE_URL`
- one shared internal bearer model via `OPENCLAW_GATEWAY_TOKEN`
- one shared runtime deployment topology in GKE

That model was acceptable for bringing up the product, but it is too narrow as the long-term production shape because:

1. OpenClaw itself does not claim hostile multi-tenant isolation on one shared gateway/runtime.
2. Stage 1 shared-runtime hardening and Stage 2 tiered/dedicated runtime routing are tightly related; treating them as separate architecture tracks would create avoidable legacy.
3. The product already has the right control-plane shape in PersAI:
   - plans
   - quotas
   - governance
   - admin overrides
   - runtime materialization/apply
4. The missing part is a clean runtime segmentation model and the GKE/runtime-preparation work around it.

The user constraints for this slice are:

- preserve assistant “humanity” and product feel; security must constrain execution, not flatten persona
- avoid legacy split-brain architecture
- accept a clean docs-first cutover while users are still test users
- prepare GKE early enough that the later runtime split does not require a redesign

## Decision

1. **One combined program, not two disconnected stages**

   Shared-runtime hardening and tiered runtime routing are treated as one platform track with staged delivery, not as two competing designs.

2. **PersAI remains the single control plane**

   PersAI owns:
   - runtime tier assignment
   - plan defaults and admin overrides
   - quota and abuse policy
   - materialization
   - routing to the correct runtime pool

   OpenClaw remains the execution plane.

3. **The target topology is tiered runtime segmentation**

   The default runtime classes are:
   - `free_shared_restricted`
   - `paid_shared_restricted`
   - `paid_isolated`

   A later enterprise/dedicated class may be added without changing the control-plane model.

4. **UI selects policy, not infrastructure**

   Admin/product surfaces must choose runtime class / isolation policy.

   They must not expose pod names, service names, or low-level GKE topology as the primary product control.

5. **Shared runtime is allowed only in restricted mode**

   Any shared pool must be explicitly hardened with:
   - deny-by-default tool exposure for user-facing turns
   - explicit sandbox configuration
   - explicit workspace access limits
   - explicit resource and network limits

   Shared runtime is not the target place for broad or high-risk agent capability.

6. **GKE preparation starts in the same program**

   GKE work is part of this architecture, not a later add-on. The runtime segmentation track includes:
   - tier-specific OpenClaw deployments/services
   - internal network isolation
   - per-tier config/secrets surfaces
   - routing readiness in PersAI

7. **Clean cutover, no new one-runtime legacy**

   New docs, roadmap items, and future code slices must assume the tiered runtime target state. Do not add new admin/runtime flows that deepen the one-runtime assumption.

8. **OpenClaw fork safety becomes code-first**

   `docs/PERSAI-FORK-PATCHES.md` remains useful, but fork safety must be enforced by automated diff/invariant checks against the actual git history and current code, not by the document alone.

## Consequences

### Positive

- Shared-runtime hardening and future runtime routing now live on one coherent line.
- GKE preparation happens before the product is trapped behind one-runtime assumptions.
- Free vs paid vs isolated runtime classes become product and platform concepts, not ad hoc infra hacks.
- The product can preserve assistant personality while moving risk controls into runtime/infra boundaries.
- The OpenClaw fork gets a cleaner long-term maintenance model.

### Negative

- The initial docs/program slice is larger than a narrow bug fix.
- Future adapter/config changes must be more disciplined because they cannot assume one runtime forever.
- GKE and routing work must start earlier than a purely single-runtime rollout would require.

## Alternatives considered

- **Keep one shared runtime as the long-term architecture**: rejected because it creates a weak long-term security and noisy-neighbor story for paid production.
- **Treat shared-runtime hardening and tiered runtime routing as separate tracks**: rejected because it would create legacy and duplicated planning.
- **Go fully per-user runtime immediately**: rejected as too expensive and operationally heavy for the current product phase.
