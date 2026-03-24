# ADR 046: Retention/Delete/Compliance Baseline (Step 10 G4)

## Status

Accepted

## Context

MVP already had partial delete/forget/archive behavior, but retention/compliance truth remained distributed across slices.
Step 10 G4 requires explicit, enforceable baseline behavior without enterprise overbuild and without semantic drift in reset/delete/chat flows.

## Decision

1. Formalize legal acceptance as real onboarding behavior:

- onboarding requires explicit acceptance of current MVP Terms of Service and Privacy Policy.
- accepted version + timestamp are persisted on `app_users`.
- onboarding completion state depends on workspace presence **and** required legal acceptance.

2. Formalize retention/delete baseline explicitly in product/API model:

- retention model is user-controlled with no hidden TTL auto-purge in MVP.
- delete model is explicit action-only:
  - chat hard delete (confirmation gated)
  - memory forget / do-not-remember actions
- reset remains non-delete lifecycle action.
- ownership transfer/recovery remains non-delete ownership action.

3. Preserve audit policy alignment:

- audit remains append-only and immutable.
- no audit row mutation/delete behavior introduced.

4. Apply minimal corrective hardening:

- include missing auth middleware coverage for existing protected endpoints introduced in prior slices:
  - Telegram secret lifecycle operations
  - admin abuse unblock
  - admin ownership transfer/recovery

## Consequences

Positive:

- core data handling expectations are explicit and user-visible in API state.
- retention and delete semantics are aligned with actual backend behavior.
- legal acceptance has persisted runtime truth, not only documentation intent.

Trade-offs / intentional limits:

- no enterprise retention scheduler, legal hold, or regional policy matrix in MVP.
- no full account/workspace erasure orchestration endpoint in G4.
- no automatic data aging purge jobs in G4.
