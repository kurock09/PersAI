# ADR 028: Step 7 P5 quota accounting baseline

Date: 2026-03-26
Status: Accepted

## Context

Step 7 P5 requires explicit quota accounting for commercial dimensions that materially impact cost and plan governance, while preserving prior boundaries:

- control-plane ownership in `apps/api`
- provider-agnostic plan/subscription model from P1-P3
- centralized capability truth from P4
- no backend behavior routing and no BI platform expansion

The required dimensions in this slice are:

- token budget
- cost-driving or token-driving tool class usage
- active web chats cap

Tasks/reminders must remain explicitly outside commercial quota dimensions.

## Decision

Introduce a backend quota accounting baseline with two persistence structures:

- `workspace_quota_accounting_state` (latest normalized counters/limits per workspace)
- `workspace_quota_usage_events` (append-only usage/snapshot events by dimension)

Introduce dimension enum:

- `token_budget`
- `cost_or_token_driving_tool_class`
- `active_web_chats_cap`

Introduce centralized application service:

- `TrackWorkspaceQuotaUsageService`

Responsibilities:

- record token-budget usage for web chat turns (sync/stream completed/stream partial) using deterministic estimator `chars_div_4_ceil_v1`
- record cost/token-driving tool-class usage units when capability state marks cost-driving tool class as quota-governed
- refresh active web chats current usage on:
  - web chat prepare/new turn
  - web chat archive
  - web chat hard delete
- resolve effective quota limits from:
  - plan provider-agnostic hints (`billingProviderHints.quotaAccounting.*`) and optional entitlement limits keys
  - fallback API config defaults (`QUOTA_TOKEN_BUDGET_DEFAULT`, `QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT`, `WEB_ACTIVE_CHATS_CAP`)

## Consequences

Positive:

- Quota accounting is explicit, queryable, and reusable for future enforcement and user-facing percentage views.
- Logic stays centralized in control plane and aligned with plan/subscription/capability context.
- No runtime-specific hidden accounting in OpenClaw adapters.

Intentional limits in P5:

- No billing provider integration, invoicing, tax, or BI analytics expansion.
- No generalized enforcement policy matrix yet (reserved for P6).
- No tasks/reminders quota accounting; tasks remain excluded from commercial quota dimensions.
- No new public quota API surface in this slice.
